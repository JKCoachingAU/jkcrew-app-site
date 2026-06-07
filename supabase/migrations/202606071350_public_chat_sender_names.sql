update public.crew_posts cp
set metadata = coalesce(cp.metadata, '{}'::jsonb) || jsonb_build_object(
  'author_name', p.display_name,
  'author_role', p.role,
  'avatar', p.avatar
)
from public.profiles p
where p.id = cp.author_id
  and cp.post_type = 'chat'
  and nullif(cp.metadata->>'author_name', '') is null;

create or replace function public.get_crew_feed()
returns table(feed_type text, body text, author_id uuid, author_name text, avatar jsonb, points integer, created_at timestamp with time zone)
language sql
security definer
set search_path = public
as $$
  select
    cp.post_type as feed_type,
    cp.body,
    cp.author_id,
    coalesce(nullif(cp.metadata->>'author_name', ''), p.display_name) as author_name,
    coalesce(cp.metadata->'avatar', p.avatar) as avatar,
    null::integer as points,
    cp.created_at
  from public.crew_posts cp
  join public.profiles p on p.id = cp.author_id
  union all
  select
    'landed'::text as feed_type,
    ta.trick_name || ' landed' as body,
    ta.athlete_id as author_id,
    p.display_name as author_name,
    p.avatar,
    ta.points,
    ta.created_at
  from public.trick_attempts ta
  join public.profiles p on p.id = ta.athlete_id
  where ta.status = 'landed'
  order by created_at desc
  limit 60;
$$;

revoke all on function public.get_crew_feed() from public;
grant execute on function public.get_crew_feed() to authenticated;
