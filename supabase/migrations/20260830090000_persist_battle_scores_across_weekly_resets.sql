-- Battle scores belong to the battle window, not to the current leaderboard week.
-- This keeps a live battle's accumulated score intact when the Sunday reset runs.
create or replace function private.jkcrew_rider_battle_points(
  p_battle_id uuid,
  p_athlete_id uuid
)
returns integer
language sql
stable
set search_path = ''
as $function$
  with battle_window as (
    select
      battle.starts_at as score_from,
      case
        when battle.status = 'completed' and battle.forfeited_at is not null then battle.forfeited_at
        else least(coalesce(battle.ends_at, now()), now())
      end as score_until
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

revoke all on function private.jkcrew_rider_battle_points(uuid, uuid) from public, anon, authenticated;

create or replace function public.settle_expired_rider_battles()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_battle record;
  v_team_1_score integer;
  v_team_2_score integer;
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
    select coalesce(sum(private.jkcrew_rider_battle_points(v_battle.id, participant.athlete_id)), 0)
      into v_team_1_score
    from public.weekly_rider_battle_participants participant
    where participant.battle_id = v_battle.id and participant.team_number = 1;

    select coalesce(sum(private.jkcrew_rider_battle_points(v_battle.id, participant.athlete_id)), 0)
      into v_team_2_score
    from public.weekly_rider_battle_participants participant
    where participant.battle_id = v_battle.id and participant.team_number = 2;

    v_winning_team := case when v_team_1_score > v_team_2_score then 1 when v_team_2_score > v_team_1_score then 2 else null end;
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
            (v_battle.reward_points / v_battle.battle_size)
            + case when ranked.team_rank <= (v_battle.reward_points % v_battle.battle_size) then 1 else 0 end
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

create or replace function public.get_my_rider_battles()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform public.settle_expired_rider_battles();
  select coalesce(jsonb_agg(row_data order by (row_data->>'created_at')::timestamptz desc), '[]'::jsonb) into v_result
  from (
    select jsonb_build_object(
      'id', battle.id, 'week_start', battle.week_start, 'status', battle.status,
      'duration_days', battle.duration_days, 'starts_at', battle.starts_at, 'ends_at', battle.ends_at,
      'reward_points', battle.reward_points, 'battle_size', battle.battle_size,
      'winning_team', battle.winning_team, 'created_at', battle.created_at,
      'participants', (
        select jsonb_agg(jsonb_build_object(
          'athlete_id', participant.athlete_id, 'team_number', participant.team_number,
          'response', participant.response, 'is_winner', participant.is_winner,
          'points_delta', participant.points_delta, 'display_name', profile.display_name,
          'avatar', profile.avatar, 'level', profile.level,
          'battle_points', private.jkcrew_rider_battle_points(battle.id, participant.athlete_id),
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

create or replace function public.get_coach_rider_battles_v2(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare v_user_id uuid := auth.uid(); v_result jsonb;
begin
  if not exists (select 1 from public.profiles where id = v_user_id and role in ('coach', 'admin')) then raise exception 'Only coaches can view rider battles'; end if;
  perform public.settle_expired_rider_battles();
  select coalesce(jsonb_agg(row_data order by (row_data->>'created_at')::timestamptz desc), '[]'::jsonb) into v_result
  from (
    select jsonb_build_object(
      'id', battle.id, 'status', battle.status, 'duration_days', battle.duration_days,
      'starts_at', battle.starts_at, 'ends_at', battle.ends_at, 'reward_points', battle.reward_points,
      'battle_size', battle.battle_size, 'winning_team', battle.winning_team, 'created_at', battle.created_at,
      'participants', (
        select jsonb_agg(jsonb_build_object(
          'athlete_id', participant.athlete_id, 'team_number', participant.team_number,
          'response', participant.response, 'is_winner', participant.is_winner,
          'points_delta', participant.points_delta, 'display_name', profile.display_name,
          'avatar', profile.avatar,
          'battle_points', private.jkcrew_rider_battle_points(battle.id, participant.athlete_id),
          'weekly_points', private.jkcrew_rider_battle_points(battle.id, participant.athlete_id)
        ) order by participant.team_number, profile.display_name)
        from public.weekly_rider_battle_participants participant join public.profiles profile on profile.id = participant.athlete_id
        where participant.battle_id = battle.id
      )
    ) row_data
    from public.weekly_rider_battles battle
    where exists (
      select 1 from public.weekly_rider_battle_participants participant
      join public.coach_athletes link on link.athlete_id = participant.athlete_id
      where participant.battle_id = battle.id and link.coach_id = v_user_id
    )
    limit least(greatest(coalesce(p_limit, 100), 1), 250)
  ) rows;
  return v_result;
end;
$function$;

notify pgrst, 'reload schema';
