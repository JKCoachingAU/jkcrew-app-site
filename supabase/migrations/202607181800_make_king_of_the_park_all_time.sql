create or replace function private.jkcrew_current_park_king(p_venue text)
returns table (
  venue_key text,
  venue_name text,
  athlete_id uuid,
  display_name text,
  avatar jsonb,
  points integer
)
language sql
stable
security definer
set search_path = public, private
as $function$
  with requested as (
    select lower(btrim(coalesce(p_venue, ''))) as venue_key
  ),
  scores as (
    select
      requested.venue_key,
      max(award.venue) as venue_name,
      profile.id as athlete_id,
      profile.display_name,
      profile.avatar,
      sum(
        case
          when split_part(award.award_key, ':', 1) in ('daily', 'daily-complete') then 1
          else greatest(award.points, 0)
        end
      )::integer as points,
      max(award.created_at) as latest_point_at
    from requested
    join public.assignment_point_awards award
      on lower(btrim(award.venue)) = requested.venue_key
    join public.profiles profile
      on profile.id = award.athlete_id
     and profile.role = 'athlete'
    where requested.venue_key <> ''
      and split_part(award.award_key, ':', 1) in (
        'daily', 'daily-complete', 'dialled', 'one_bang', 'percentage', 'bonus'
      )
    group by requested.venue_key, profile.id, profile.display_name, profile.avatar
  )
  select
    scores.venue_key,
    coalesce(nullif(scores.venue_name, ''), initcap(scores.venue_key)),
    scores.athlete_id,
    scores.display_name,
    scores.avatar,
    scores.points
  from scores
  where scores.points > 0
  order by scores.points desc, scores.latest_point_at asc, scores.display_name asc
  limit 1;
$function$;

revoke all on function private.jkcrew_current_park_king(text) from public, anon, authenticated;

insert into public.park_king_snapshots (
  venue_key, venue_name, athlete_id, display_name, avatar, points, updated_at
)
select king.venue_key, king.venue_name, king.athlete_id, king.display_name, king.avatar, king.points, now()
from (
  select distinct btrim(award.venue) as venue
  from public.assignment_point_awards award
  where btrim(award.venue) <> ''
) venue
cross join lateral private.jkcrew_current_park_king(venue.venue) king
on conflict (venue_key) do update set
  venue_name = excluded.venue_name,
  athlete_id = excluded.athlete_id,
  display_name = excluded.display_name,
  avatar = excluded.avatar,
  points = excluded.points,
  updated_at = excluded.updated_at;
