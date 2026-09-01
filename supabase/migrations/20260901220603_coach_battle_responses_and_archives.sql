-- Let a linked coach accept a battle invitation for a rider who cannot access
-- the app, and let coaches archive finished battles without deleting results,
-- leaderboard transfers, or win/loss records.

alter table public.weekly_rider_battles
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id) on delete set null;

create index if not exists weekly_rider_battles_archived_by_idx
  on public.weekly_rider_battles (archived_by);

create or replace function public.coach_respond_rider_battle(
  p_battle_id uuid,
  p_athlete_id uuid,
  p_response text default 'accepted'
)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_battle public.weekly_rider_battles;
begin
  if not exists (
    select 1 from public.profiles
    where id = v_user_id and role in ('coach', 'admin')
  ) then raise exception 'Only coaches can respond for riders'; end if;

  if p_response <> 'accepted' then
    raise exception 'Coaches can only accept an invitation for a rider';
  end if;

  if not exists (
    select 1 from public.coach_athletes
    where coach_id = v_user_id and athlete_id = p_athlete_id
  ) then raise exception 'You can only respond for riders in your crew'; end if;

  select battle.* into v_battle
  from public.weekly_rider_battles battle
  where battle.id = p_battle_id
  for update;

  if v_battle.id is null then raise exception 'Battle not found'; end if;
  if v_battle.status <> 'pending' then raise exception 'That battle request is no longer pending'; end if;

  update public.weekly_rider_battle_participants
  set response = 'accepted', responded_at = now()
  where battle_id = p_battle_id
    and athlete_id = p_athlete_id
    and response = 'pending';

  if not found then raise exception 'That rider has already responded'; end if;

  if not exists (
    select 1 from public.weekly_rider_battle_participants
    where battle_id = p_battle_id and response = 'pending'
  ) then
    update public.weekly_rider_battle_participants participant
    set baseline_points = public.current_rider_weekly_points(participant.athlete_id)
    where participant.battle_id = p_battle_id;

    update public.weekly_rider_battles
    set status = 'accepted',
        starts_at = now(),
        ends_at = now() + make_interval(days => duration_days),
        responded_at = now(),
        updated_at = now()
    where id = p_battle_id;
    return 'accepted';
  end if;

  update public.weekly_rider_battles
  set updated_at = now()
  where id = p_battle_id;
  return 'pending';
end;
$function$;

create or replace function public.set_rider_battle_archived(
  p_battle_id uuid,
  p_archived boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_status text;
begin
  if not exists (
    select 1 from public.profiles
    where id = v_user_id and role in ('coach', 'admin')
  ) then raise exception 'Only coaches can archive battles'; end if;

  select battle.status into v_status
  from public.weekly_rider_battles battle
  where battle.id = p_battle_id
  for update;

  if v_status is null then raise exception 'Battle not found'; end if;
  if v_status in ('pending', 'accepted') then
    raise exception 'Only finished battles can be archived';
  end if;

  if not exists (
    select 1
    from public.weekly_rider_battle_participants participant
    join public.coach_athletes link on link.athlete_id = participant.athlete_id
    where participant.battle_id = p_battle_id and link.coach_id = v_user_id
  ) then raise exception 'You can only archive battles for riders in your crew'; end if;

  update public.weekly_rider_battles
  set archived_at = case when p_archived then now() else null end,
      archived_by = case when p_archived then v_user_id else null end,
      updated_at = now()
  where id = p_battle_id;
  return true;
end;
$function$;

create or replace function public.get_coach_rider_battles_v2(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
begin
  if not exists (
    select 1 from public.profiles
    where id = v_user_id and role in ('coach', 'admin')
  ) then raise exception 'Only coaches can view rider battles'; end if;

  perform public.settle_expired_rider_battles();

  select coalesce(
    jsonb_agg(row_data order by (row_data->>'created_at')::timestamptz desc),
    '[]'::jsonb
  ) into v_result
  from (
    select jsonb_build_object(
      'id', battle.id,
      'status', battle.status,
      'duration_days', battle.duration_days,
      'starts_at', battle.starts_at,
      'ends_at', battle.ends_at,
      'reward_points', battle.reward_points,
      'battle_size', battle.battle_size,
      'winning_team', battle.winning_team,
      'created_at', battle.created_at,
      'archived_at', battle.archived_at,
      'archived_by', battle.archived_by,
      'participants', (
        select jsonb_agg(jsonb_build_object(
          'athlete_id', participant.athlete_id,
          'team_number', participant.team_number,
          'response', participant.response,
          'is_winner', participant.is_winner,
          'points_delta', participant.points_delta,
          'display_name', profile.display_name,
          'avatar', profile.avatar,
          'battle_points', private.jkcrew_rider_battle_points(battle.id, participant.athlete_id),
          'weekly_points', private.jkcrew_rider_battle_points(battle.id, participant.athlete_id),
          'coach_can_respond', exists (
            select 1 from public.coach_athletes link
            where link.coach_id = v_user_id
              and link.athlete_id = participant.athlete_id
          )
        ) order by participant.team_number, profile.display_name)
        from public.weekly_rider_battle_participants participant
        join public.profiles profile on profile.id = participant.athlete_id
        where participant.battle_id = battle.id
      )
    ) row_data
    from public.weekly_rider_battles battle
    where exists (
      select 1
      from public.weekly_rider_battle_participants participant
      join public.coach_athletes link on link.athlete_id = participant.athlete_id
      where participant.battle_id = battle.id and link.coach_id = v_user_id
    )
    order by
      case when battle.status in ('pending', 'accepted') then 0 else 1 end,
      battle.created_at desc
    limit least(greatest(coalesce(p_limit, 100), 1), 250)
  ) rows;

  return v_result;
end;
$function$;

revoke all on function public.coach_respond_rider_battle(uuid, uuid, text) from public, anon;
revoke all on function public.set_rider_battle_archived(uuid, boolean) from public, anon;
revoke all on function public.get_coach_rider_battles_v2(integer) from public, anon;
grant execute on function public.coach_respond_rider_battle(uuid, uuid, text) to authenticated;
grant execute on function public.set_rider_battle_archived(uuid, boolean) to authenticated;
grant execute on function public.get_coach_rider_battles_v2(integer) to authenticated;

notify pgrst, 'reload schema';
