-- Route one rider's Brisbane session day to another team in the same battle.
-- This affects battle contributions only: roster, stakes and personal ledgers stay intact.
-- One override per rider/battle keeps the non-negative score cap deterministic.
create table private.rider_battle_day_allocations (
  battle_id uuid not null,
  athlete_id uuid not null,
  score_date date not null,
  team_number integer not null check (team_number between 1 and 3),
  created_by uuid not null references public.profiles(id),
  reason text not null check (length(trim(reason)) > 0),
  created_at timestamptz not null default now(),
  primary key (battle_id, athlete_id),
  foreign key (battle_id, athlete_id)
    references public.weekly_rider_battle_participants(battle_id, athlete_id) on delete cascade
);
alter table private.rider_battle_day_allocations enable row level security;
revoke all on table private.rider_battle_day_allocations from public, anon, authenticated;

create function private.validate_rider_battle_day_allocation()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_battle public.weekly_rider_battles;
  v_day_start timestamptz := new.score_date::timestamp at time zone 'Australia/Brisbane';
begin
  select * into v_battle from public.weekly_rider_battles where id = new.battle_id for update;
  if v_battle.status <> 'accepted' or v_battle.ends_at <= now() then
    raise exception 'Only an active battle can receive a session allocation';
  end if;
  if new.team_number > v_battle.team_count or not exists (
    select 1 from public.weekly_rider_battle_participants
    where battle_id = new.battle_id and team_number = new.team_number and forfeited_at is null
  ) then raise exception 'Choose an active team in this battle'; end if;
  if not exists (
    select 1 from public.weekly_rider_battle_participants
    where battle_id = new.battle_id and athlete_id = new.athlete_id
      and team_number <> new.team_number and forfeited_at is null
  ) then raise exception 'Choose a rider from another active team'; end if;
  if v_day_start >= v_battle.ends_at or v_day_start + interval '1 day' <= v_battle.starts_at then
    raise exception 'The session day must overlap the battle';
  end if;
  if not exists (
    select 1 from public.profiles p join public.coach_athletes c on c.coach_id = p.id
    where p.id = new.created_by and p.role in ('coach', 'admin') and c.athlete_id = new.athlete_id
  ) then raise exception 'The allocation must be recorded for a linked coach'; end if;
  return new;
end;
$$;
revoke all on function private.validate_rider_battle_day_allocation() from public, anon, authenticated;
create trigger validate_rider_battle_day_allocation before insert or update
on private.rider_battle_day_allocations for each row execute function private.validate_rider_battle_day_allocation();

CREATE OR REPLACE FUNCTION private.jkcrew_rider_battle_points_between(p_battle_id uuid, p_athlete_id uuid, p_from timestamptz, p_until timestamptz)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with battle_window as (
    select
      greatest(battle.starts_at, p_from) as score_from,
      least(p_until, case
        when battle.status = 'completed' and battle.forfeited_at is not null and battle.team_count = 2 then battle.forfeited_at
        else least(coalesce(battle.ends_at, now()), coalesce((
          select participant.forfeited_at from public.weekly_rider_battle_participants participant
          where participant.battle_id=battle.id and participant.athlete_id=p_athlete_id
        ), now()), now())
      end) as score_until
    from public.weekly_rider_battles battle
    where battle.id = p_battle_id
      and battle.starts_at is not null
      and exists (
        select 1
        from public.weekly_rider_battle_participants participant
        where participant.battle_id = battle.id
          and participant.athlete_id = p_athlete_id
      )
  )
  select coalesce((
    select greatest(0,
      coalesce((
        select sum(award.points)
        from public.assignment_point_awards award
        where award.athlete_id = p_athlete_id
          and award.created_at >= battle_window.score_from
          and award.created_at < battle_window.score_until
      ), 0)
      + coalesce((
        select sum(session.total_points)
        from public.training_sessions session
        where session.athlete_id = p_athlete_id
          and session.started_at >= battle_window.score_from
          and session.started_at < battle_window.score_until
          and not exists (
            select 1
            from public.assignment_point_awards award
            where award.session_id = session.id
          )
      ), 0)
      + coalesce((
        select sum(adjustment.points)
        from public.leaderboard_point_adjustments adjustment
        where adjustment.athlete_id = p_athlete_id
          and adjustment.created_at >= battle_window.score_from
          and adjustment.created_at < battle_window.score_until
          and adjustment.reason not ilike 'All-time score correction%'
      ), 0)
    )::integer
    from battle_window
  ), 0);
$function$;

revoke all on function private.jkcrew_rider_battle_points_between(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;

create function private.jkcrew_rider_battle_score_allocations(p_battle_id uuid, p_athlete_id uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_team integer;
  v_total integer;
  v_allocation private.rider_battle_day_allocations;
  v_day_start timestamptz;
  v_routed integer;
begin
  select team_number into v_team from public.weekly_rider_battle_participants
  where battle_id = p_battle_id and athlete_id = p_athlete_id;
  if not found then return '{}'::jsonb; end if;
  v_total := private.jkcrew_rider_battle_points(p_battle_id, p_athlete_id);
  select * into v_allocation from private.rider_battle_day_allocations
  where battle_id = p_battle_id and athlete_id = p_athlete_id;
  if not found then return jsonb_build_object(v_team::text, v_total); end if;
  v_day_start := v_allocation.score_date::timestamp at time zone 'Australia/Brisbane';
  -- Cap at the whole-battle score, including any negative corrections on other days.
  v_routed := least(v_total, private.jkcrew_rider_battle_points_between(
    p_battle_id, p_athlete_id, v_day_start, v_day_start + interval '1 day'));
  return jsonb_build_object(v_team::text, v_total - v_routed,
    v_allocation.team_number::text, v_routed);
end;
$$;
revoke all on function private.jkcrew_rider_battle_score_allocations(uuid, uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_my_rider_battles()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform public.settle_expired_rider_battles();
  select coalesce(jsonb_agg(row_data order by (row_data->>'created_at')::timestamptz desc), '[]'::jsonb) into v_result
  from (
    select jsonb_build_object(
      'id', battle.id, 'week_start', battle.week_start, 'status', battle.status,
      'duration_days', battle.duration_days, 'starts_at', battle.starts_at, 'ends_at', battle.ends_at,
      'reward_points', battle.reward_points, 'battle_size', battle.battle_size, 'team_count', battle.team_count,
      'winning_team', battle.winning_team, 'created_at', battle.created_at,
      'participants', (
        select jsonb_agg(jsonb_build_object(
          'athlete_id', participant.athlete_id, 'team_number', participant.team_number, 'forfeited_at', participant.forfeited_at,
          'response', participant.response, 'is_winner', participant.is_winner,
          'points_delta', participant.points_delta, 'display_name', profile.display_name,
          'avatar', profile.avatar, 'level', profile.level,
          'battle_points', private.jkcrew_rider_battle_points(battle.id, participant.athlete_id),
          'score_allocations', private.jkcrew_rider_battle_score_allocations(battle.id, participant.athlete_id),
          'score_allocation_date', (select a.score_date from private.rider_battle_day_allocations a where a.battle_id = battle.id and a.athlete_id = participant.athlete_id),
          'weekly_points', private.jkcrew_rider_battle_points(battle.id, participant.athlete_id)
        ) order by participant.team_number, profile.display_name)
        from public.weekly_rider_battle_participants participant
        join public.profiles profile on profile.id = participant.athlete_id
        where participant.battle_id = battle.id
      )
    ) row_data
    from public.weekly_rider_battles battle
    where exists (select 1 from public.weekly_rider_battle_participants mine where mine.battle_id = battle.id and mine.athlete_id = auth.uid())
  ) rows;
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_coach_rider_battles_v2(p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      'battle_size', battle.battle_size, 'team_count', battle.team_count,
      'winning_team', battle.winning_team,
      'created_at', battle.created_at,
      'archived_at', battle.archived_at,
      'archived_by', battle.archived_by,
      'participants', (
        select jsonb_agg(jsonb_build_object(
          'athlete_id', participant.athlete_id,
          'team_number', participant.team_number, 'forfeited_at', participant.forfeited_at,
          'response', participant.response,
          'is_winner', participant.is_winner,
          'points_delta', participant.points_delta,
          'display_name', profile.display_name,
          'avatar', profile.avatar,
          'battle_points', private.jkcrew_rider_battle_points(battle.id, participant.athlete_id),
          'score_allocations', private.jkcrew_rider_battle_score_allocations(battle.id, participant.athlete_id),
          'score_allocation_date', (select a.score_date from private.rider_battle_day_allocations a where a.battle_id = battle.id and a.athlete_id = participant.athlete_id),
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

CREATE OR REPLACE FUNCTION public.settle_expired_rider_battles()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_battle record;
  v_prize_points integer;
  v_winning_team integer;
  v_winner_id uuid;
  v_settled integer := 0;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;

  for v_battle in
    select battle.*
    from public.weekly_rider_battles battle
    where battle.status = 'accepted' and battle.ends_at <= now()
    for update skip locked
  loop
    with eligible_teams as (
      select distinct team_number from public.weekly_rider_battle_participants
      where battle_id = v_battle.id and forfeited_at is null
    ), source_scores as materialized (
      select private.jkcrew_rider_battle_score_allocations(v_battle.id, athlete_id) as allocation
      from public.weekly_rider_battle_participants
      where battle_id = v_battle.id and forfeited_at is null
    ), scores as (
      select target.team_number, coalesce(sum((source.allocation
        ->> target.team_number::text)::integer), 0) as score
      from eligible_teams target cross join source_scores source
      group by target.team_number
    ), leaders as (select team_number from scores where score=(select max(score) from scores))
    select case when count(*)=1 then min(team_number) else null end into v_winning_team from leaders;
    v_prize_points := v_battle.reward_points * (v_battle.team_count - 1);
    select participant.athlete_id into v_winner_id
    from public.weekly_rider_battle_participants participant
    where participant.battle_id = v_battle.id and participant.team_number = v_winning_team
    order by participant.athlete_id limit 1;

    with ranked as (
      select participant.battle_id, participant.athlete_id, participant.team_number,
        row_number() over (partition by participant.team_number order by participant.athlete_id) as team_rank
      from public.weekly_rider_battle_participants participant
      where participant.battle_id = v_battle.id
    )
    update public.weekly_rider_battle_participants participant
    set is_winner = case when v_winning_team is null then null else participant.team_number = v_winning_team end,
        points_delta = case
          when v_winning_team is null then 0
          when participant.team_number = v_winning_team then
            (v_prize_points / v_battle.battle_size)
            + case when ranked.team_rank <= (v_prize_points % v_battle.battle_size) then 1 else 0 end
          else -((v_battle.reward_points / v_battle.battle_size)
            + case when ranked.team_rank <= (v_battle.reward_points % v_battle.battle_size) then 1 else 0 end)
        end
    from ranked
    where participant.battle_id = ranked.battle_id and participant.athlete_id = ranked.athlete_id;

    if v_winning_team is not null then
      insert into public.leaderboard_point_adjustments (athlete_id, coach_id, points, reason, week_start, created_at)
      select participant.athlete_id, coalesce(v_battle.created_by, v_battle.challenger_id), participant.points_delta,
        'Rider battle ' || v_battle.id::text || case when participant.points_delta > 0 then ' win' else ' loss' end,
        v_battle.week_start, now()
      from public.weekly_rider_battle_participants participant
      where participant.battle_id = v_battle.id and participant.points_delta <> 0;
    end if;

    update public.weekly_rider_battles
    set status = 'completed', winning_team = v_winning_team, winner_id = v_winner_id,
        responded_at = coalesce(responded_at, now()), updated_at = now()
    where id = v_battle.id;

    insert into public.push_notification_queue (recipient_id, notification_type, title, body, url, payload, dedupe_key)
    select participant.athlete_id, 'rider_battle_result',
      case when v_winning_team is null then 'Battle draw' when participant.team_number = v_winning_team then 'Battle won!' else 'Battle complete' end,
      case when v_winning_team is null then 'The battle finished level.'
           when participant.team_number = v_winning_team then 'Your team won. ' || abs(participant.points_delta) || ' leaderboard points were added.'
           else 'The other team won this battle. Time for the rematch.' end,
      './?push=challenges', jsonb_build_object('view', 'challenges', 'battle_id', v_battle.id),
      'rider-battle-result:' || v_battle.id::text || ':' || participant.athlete_id::text
    from public.weekly_rider_battle_participants participant
    where participant.battle_id = v_battle.id
    on conflict (dedupe_key) do nothing;

    v_settled := v_settled + 1;
  end loop;
  return v_settled;
end;
$function$;
