alter table public.weekly_challenges drop constraint if exists weekly_challenges_category_check;
alter table public.weekly_challenges add constraint weekly_challenges_category_check
  check (category in ('daily','one_bang','dialled','lines','percentage','foam_pit','bonus'));

create or replace function public.create_weekly_challenge(
  p_title text, p_description text, p_category text, p_target_count integer, p_audience_group text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $function$
declare v_user_id uuid := auth.uid(); v_id uuid; v_start timestamptz;
begin
  if not exists (select 1 from public.profiles where id = v_user_id and role in ('coach','admin')) then raise exception 'Only coaches can create weekly challenges'; end if;
  if p_category not in ('daily','one_bang','dialled','lines','percentage','foam_pit','bonus') then raise exception 'Choose a valid sheet category'; end if;
  if p_target_count not between 1 and 50 then raise exception 'Choose a target from 1 to 50'; end if;
  v_start := date_trunc('day', timezone('Australia/Brisbane', now())) at time zone 'Australia/Brisbane';
  update public.weekly_challenges set status = 'archived' where status = 'active';
  insert into public.weekly_challenges (title, description, category, target_count, audience_group, starts_at, ends_at, created_by)
  values (trim(p_title), trim(coalesce(p_description,'')), p_category, p_target_count, nullif(trim(coalesce(p_audience_group,'')),''), v_start, v_start + interval '7 days', v_user_id)
  returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.get_public_rider_battle_record(p_athlete_id uuid)
returns table(wins bigint, losses bigint, win_percent integer)
language plpgsql
security definer
set search_path = public
as $function$
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if not exists (select 1 from public.profiles where id = p_athlete_id and role = 'athlete') then raise exception 'Rider not found'; end if;
  return query
  with record as (
    select count(*) filter (where participant.is_winner)::bigint as wins,
      count(*) filter (where participant.is_winner = false)::bigint as losses
    from public.weekly_rider_battle_participants participant
    join public.weekly_rider_battles battle on battle.id = participant.battle_id
    where participant.athlete_id = p_athlete_id and battle.status = 'completed'
  )
  select record.wins, record.losses,
    case when record.wins + record.losses = 0 then 0 else round(100.0 * record.wins / (record.wins + record.losses))::integer end
  from record;
end;
$function$;

-- Ensure riders see a real challenge immediately on release. A coach can replace it at any time.
insert into public.weekly_challenges (
  title, description, category, target_count, reward_points, starts_at, ends_at, created_by
)
select 'Line Linker', 'Complete 3 full lines this week', 'lines', 3, 5,
  date_trunc('day', timezone('Australia/Brisbane', now())) at time zone 'Australia/Brisbane',
  (date_trunc('day', timezone('Australia/Brisbane', now())) at time zone 'Australia/Brisbane') + interval '7 days',
  coach.id
from public.profiles coach
where coach.role in ('coach','admin')
  and not exists (select 1 from public.weekly_challenges where status = 'active')
order by coach.created_at
limit 1;

revoke all on function public.create_weekly_challenge(text,text,text,integer,text) from public, anon;
revoke all on function public.get_public_rider_battle_record(uuid) from public, anon;
grant execute on function public.create_weekly_challenge(text,text,text,integer,text), public.get_public_rider_battle_record(uuid) to authenticated;

notify pgrst, 'reload schema';
