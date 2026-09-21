-- Add 2v1 / 1v2 without rewriting any existing battles or participant records.
-- battle_size remains the first team's size for compatibility. Participants are
-- authoritative for each team's size and split of the existing whole-team stake.
-- Preserve all API signatures, permissions, row/advisory locks and score allocation.

CREATE OR REPLACE FUNCTION private.create_three_sided_rider_battle(p_team_one uuid[], p_team_two uuid[], p_team_three uuid[] DEFAULT '{}'::uuid[], p_duration_days integer DEFAULT 7, p_reward_points integer DEFAULT 5)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_is_coach boolean;
  v_size integer := coalesce(cardinality(p_team_one), 0);
  v_second_size integer := coalesce(cardinality(p_team_two), 0);
  v_team_count integer := case when coalesce(cardinality(p_team_three),0) > 0 then 3 else 2 end;
  v_all uuid[];
  v_athlete uuid;
  v_battle_id uuid;
  v_week_start date := ((date_trunc('week', timezone('Australia/Brisbane', now()) + interval '1 day') - interval '1 day')::date);
begin
  if v_user_id is null then raise exception 'You must be signed in'; end if;
  select role in ('coach', 'admin') into v_is_coach from public.profiles where id = v_user_id;
  if not (
    (v_size between 1 and 6 and v_second_size = v_size
      and (v_team_count = 2 or cardinality(p_team_three) = v_size))
    or (v_team_count = 2 and ((v_size = 2 and v_second_size = 1)
      or (v_size = 1 and v_second_size = 2)))
  ) then
    raise exception 'Choose 2v1, 1v2, or two or three equal teams with 1 to 6 riders on each team';
  end if;
  if coalesce(p_duration_days,0) not between 1 and 7 then raise exception 'Choose a battle length from 1 to 7 days'; end if;
  if coalesce(p_reward_points, 0) not between 1 and greatest(20, v_size * 5) then
    raise exception 'Choose a battle value from 1 to % points for this team size', greatest(20, v_size * 5);
  end if;
  v_all := p_team_one || p_team_two || coalesce(p_team_three,'{}'::uuid[]);
  if (select count(distinct chosen.rider_id) from unnest(v_all) as chosen(rider_id)) <> cardinality(v_all) then raise exception 'Each rider can only appear once'; end if;
  if not coalesce(v_is_coach, false) and not (v_user_id = any(p_team_one)) then raise exception 'Your own team must include you'; end if;
  if not coalesce(v_is_coach, false) and not exists (select 1 from public.profiles where id = v_user_id and role = 'athlete') then raise exception 'Only riders or coaches can create battles'; end if;

  for v_athlete in select chosen from unnest(v_all) chosen order by chosen loop
    if not exists (select 1 from public.profiles where id = v_athlete and role = 'athlete' and not coalesce(ghost_mode, false)) then raise exception 'One selected rider is unavailable'; end if;
    if coalesce(v_is_coach, false) and not exists (select 1 from public.coach_athletes where coach_id = v_user_id and athlete_id = v_athlete) then raise exception 'You can only create battles for riders in your crew'; end if;
    perform pg_advisory_xact_lock(hashtextextended(v_athlete::text, 0));
    if (select count(distinct participant.battle_id)
        from public.weekly_rider_battle_participants participant
        join public.weekly_rider_battles battle on battle.id = participant.battle_id
        where participant.athlete_id = v_athlete and battle.status in ('pending', 'accepted')) >= 3 then
      raise exception 'Every rider can have a maximum of 3 active battles';
    end if;
  end loop;

  insert into public.weekly_rider_battles (
    challenger_id, opponent_id, week_start, duration_days, reward_points, created_by, battle_size, team_count, status
  ) values (p_team_one[1], p_team_two[1], v_week_start, p_duration_days, p_reward_points, v_user_id, v_size, v_team_count, 'pending')
  returning id into v_battle_id;

  insert into public.weekly_rider_battle_participants (battle_id, athlete_id, team_number, response, responded_at)
  select v_battle_id, rider_id, 1,
    case when not coalesce(v_is_coach, false) and rider_id = v_user_id then 'accepted' else 'pending' end,
    case when not coalesce(v_is_coach, false) and rider_id = v_user_id then now() else null end
  from unnest(p_team_one) rider_id;
  insert into public.weekly_rider_battle_participants (battle_id, athlete_id, team_number, response)
  select v_battle_id, rider_id, 2, 'pending' from unnest(p_team_two) rider_id;

  insert into public.weekly_rider_battle_participants (battle_id, athlete_id, team_number, response)
  select v_battle_id, rider_id, 3, 'pending' from unnest(p_team_three) rider_id;

  insert into public.push_notification_queue (recipient_id, notification_type, title, body, url, payload, dedupe_key)
  select participant.athlete_id, 'rider_battle_request',
    'New ' || array_to_string(case when v_team_count = 3 then array[v_size,v_second_size,cardinality(p_team_three)] else array[v_size,v_second_size] end,'v') || ' battle',
    coalesce(creator.display_name, 'Coach JK') || ' invited you to a ' || p_duration_days || '-day battle for ' || (p_reward_points * (v_team_count - 1)) || ' winning points. Tap to accept or decline.',
    './?push=challenges', jsonb_build_object('view', 'challenges', 'battle_id', v_battle_id, 'reward_points', p_reward_points),
    'rider-battle:' || v_battle_id::text || ':' || participant.athlete_id::text
  from public.weekly_rider_battle_participants participant
  left join public.profiles creator on creator.id = v_user_id
  where participant.battle_id = v_battle_id and participant.response = 'pending'
  on conflict (dedupe_key) do nothing;
  return v_battle_id;
end;
$function$
;

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
        row_number() over (partition by participant.team_number order by participant.athlete_id) as team_rank,
        count(*) over (partition by participant.team_number)::integer as team_size
      from public.weekly_rider_battle_participants participant
      where participant.battle_id = v_battle.id
    )
    update public.weekly_rider_battle_participants participant
    set is_winner = case when v_winning_team is null then null else participant.team_number = v_winning_team end,
        points_delta = case
          when v_winning_team is null then 0
          when participant.team_number = v_winning_team then
            (v_prize_points / ranked.team_size)
            + case when ranked.team_rank <= (v_prize_points % ranked.team_size) then 1 else 0 end
          else -((v_battle.reward_points / ranked.team_size)
            + case when ranked.team_rank <= (v_battle.reward_points % ranked.team_size) then 1 else 0 end)
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
$function$
;

CREATE OR REPLACE FUNCTION public.forfeit_rider_battle(p_battle_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_battle public.weekly_rider_battles;
  v_losing_team integer;
  v_winning_team integer;
  v_winner_id uuid;
begin
  if v_user_id is null then raise exception 'You must be signed in'; end if;

  select battle.* into v_battle
  from public.weekly_rider_battles battle
  where battle.id = p_battle_id
  for update;

  if v_battle.id is null then raise exception 'Battle not found'; end if;
  if v_battle.status <> 'accepted' then raise exception 'Only a live battle can be forfeited'; end if;

  select participant.team_number into v_losing_team
  from public.weekly_rider_battle_participants participant
  where participant.battle_id = p_battle_id and participant.athlete_id = v_user_id;

  if v_losing_team is null then raise exception 'You are not part of this battle'; end if;
  if v_battle.team_count = 3 then
    if exists (select 1 from public.weekly_rider_battle_participants where battle_id=p_battle_id and athlete_id=v_user_id and forfeited_at is not null) then
      raise exception 'Your team has already forfeited';
    end if;
    if v_battle.ends_at <= now() then
      perform public.settle_expired_rider_battles();
      return 'completed';
    end if;
    update public.weekly_rider_battle_participants set forfeited_at=now()
      where battle_id=p_battle_id and team_number=v_losing_team;
    update public.weekly_rider_battles set forfeited_by=v_user_id,forfeited_at=now(),updated_at=now() where id=p_battle_id;
    if (select count(distinct team_number) from public.weekly_rider_battle_participants where battle_id=p_battle_id and forfeited_at is null)=1 then
      update public.weekly_rider_battles set ends_at=now() where id=p_battle_id;
      perform public.settle_expired_rider_battles();
      return 'completed';
    end if;
    return 'accepted';
  end if;
  v_winning_team := case when v_losing_team = 1 then 2 else 1 end;

  select participant.athlete_id into v_winner_id
  from public.weekly_rider_battle_participants participant
  where participant.battle_id = p_battle_id and participant.team_number = v_winning_team
  order by participant.athlete_id limit 1;

  with ranked as (
    select participant.battle_id, participant.athlete_id, participant.team_number,
      row_number() over (partition by participant.team_number order by participant.athlete_id) as team_rank,
        count(*) over (partition by participant.team_number)::integer as team_size
    from public.weekly_rider_battle_participants participant
    where participant.battle_id = p_battle_id
  )
  update public.weekly_rider_battle_participants participant
  set is_winner = participant.team_number = v_winning_team,
      points_delta = case
        when participant.team_number = v_winning_team then
          (v_battle.reward_points / ranked.team_size)
          + case when ranked.team_rank <= (v_battle.reward_points % ranked.team_size) then 1 else 0 end
        else -((v_battle.reward_points / ranked.team_size)
          + case when ranked.team_rank <= (v_battle.reward_points % ranked.team_size) then 1 else 0 end)
      end
  from ranked
  where participant.battle_id = ranked.battle_id and participant.athlete_id = ranked.athlete_id;

  insert into public.leaderboard_point_adjustments (athlete_id, coach_id, points, reason, week_start, created_at)
  select participant.athlete_id, coalesce(v_battle.created_by, v_battle.challenger_id), participant.points_delta,
    'Rider battle ' || v_battle.id::text || case when participant.points_delta > 0 then ' win by forfeit' else ' forfeit loss' end,
    v_battle.week_start, now()
  from public.weekly_rider_battle_participants participant
  where participant.battle_id = v_battle.id and participant.points_delta <> 0;

  update public.weekly_rider_battles
  set status = 'completed', winning_team = v_winning_team, winner_id = v_winner_id,
      forfeited_by = v_user_id, forfeited_at = now(), updated_at = now()
  where id = p_battle_id;

  insert into public.push_notification_queue (recipient_id, notification_type, title, body, url, payload, dedupe_key)
  select participant.athlete_id, 'rider_battle_result',
    case when participant.athlete_id = v_user_id then 'Battle forfeited'
         when participant.team_number = v_winning_team then 'Battle won by forfeit'
         else 'Battle ended by forfeit' end,
    case when participant.athlete_id = v_user_id then 'You forfeited this battle.'
         when participant.team_number = v_winning_team then 'The other team forfeited. Your share of the ' || v_battle.reward_points || ' leaderboard points was added.'
         else 'A teammate forfeited this battle.' end,
    './?push=challenges', jsonb_build_object('view', 'challenges', 'battle_id', v_battle.id),
    'rider-battle-forfeit:' || v_battle.id::text || ':' || participant.athlete_id::text
  from public.weekly_rider_battle_participants participant
  where participant.battle_id = v_battle.id
  on conflict (dedupe_key) do nothing;

  return 'completed';
end;
$function$
;

notify pgrst, 'reload schema';
