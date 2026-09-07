-- Three-sided rider battles. Existing matches default to two teams.
alter table public.weekly_rider_battles add column if not exists team_count integer not null default 2;
alter table public.weekly_rider_battles add constraint weekly_rider_battles_team_count_check check (team_count in (2,3) and (team_count = 2 or battle_size <= 2));
alter table public.weekly_rider_battles drop constraint weekly_rider_battles_winning_team_check;
alter table public.weekly_rider_battles add constraint weekly_rider_battles_winning_team_check check (winning_team between 1 and team_count);
alter table public.weekly_rider_battle_participants drop constraint weekly_rider_battle_participants_team_number_check;
alter table public.weekly_rider_battle_participants add constraint weekly_rider_battle_participants_team_number_check check (team_number in (1,2,3));
alter table public.weekly_rider_battle_participants add column if not exists forfeited_at timestamptz;
-- A three-sided matchup must not collide with a separate head-to-head match.
drop index public.weekly_rider_battles_active_pair_idx;
create unique index weekly_rider_battles_active_pair_idx on public.weekly_rider_battles
(week_start,least(challenger_id::text,opponent_id::text),greatest(challenger_id::text,opponent_id::text))
where team_count=2 and status in ('pending','accepted');


CREATE OR REPLACE FUNCTION public.request_rider_battle_v3(p_team_one uuid[], p_team_two uuid[], p_team_three uuid[] DEFAULT '{}'::uuid[], p_duration_days integer DEFAULT 7, p_reward_points integer DEFAULT 5)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_is_coach boolean;
  v_size integer := coalesce(cardinality(p_team_one), 0);
  v_team_count integer := case when coalesce(cardinality(p_team_three),0) > 0 then 3 else 2 end;
  v_all uuid[];
  v_athlete uuid;
  v_battle_id uuid;
  v_week_start date := ((date_trunc('week', timezone('Australia/Brisbane', now()) + interval '1 day') - interval '1 day')::date);
begin
  if v_user_id is null then raise exception 'You must be signed in'; end if;
  select role in ('coach', 'admin') into v_is_coach from public.profiles where id = v_user_id;
  if v_size not between 1 and 3 or coalesce(cardinality(p_team_two),0) <> v_size or (v_team_count = 3 and (v_size > 2 or cardinality(p_team_three) <> v_size)) then raise exception 'Choose equal teams: 1v1, 2v2, 3v3, 1v1v1 or 2v2v2'; end if;
  if coalesce(p_duration_days,0) not between 1 and 7 then raise exception 'Choose a battle length from 1 to 7 days'; end if;
  if coalesce(p_reward_points, 0) not between 1 and 20 then raise exception 'Choose a battle value from 1 to 20 points'; end if;
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
    'New ' || array_to_string(array_fill(v_size,array[v_team_count]),'v') || ' battle',
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

revoke all on function public.request_rider_battle_v3(uuid[],uuid[],uuid[],integer,integer) from public, anon;
grant execute on function public.request_rider_battle_v3(uuid[],uuid[],uuid[],integer,integer) to authenticated;
create or replace function public.request_rider_battle_v2(p_team_one uuid[], p_team_two uuid[], p_duration_days integer default 7, p_reward_points integer default 5)
returns uuid language sql security invoker set search_path = public
as $$ select public.request_rider_battle_v3(p_team_one,p_team_two,'{}'::uuid[],p_duration_days,p_reward_points); $$;


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
    with scores as (
      select participant.team_number, sum(private.jkcrew_rider_battle_points(v_battle.id,participant.athlete_id)) as score
      from public.weekly_rider_battle_participants participant
      where participant.battle_id=v_battle.id and participant.forfeited_at is null
      group by participant.team_number
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
      row_number() over (partition by participant.team_number order by participant.athlete_id) as team_rank
    from public.weekly_rider_battle_participants participant
    where participant.battle_id = p_battle_id
  )
  update public.weekly_rider_battle_participants participant
  set is_winner = participant.team_number = v_winning_team,
      points_delta = case
        when participant.team_number = v_winning_team then
          (v_battle.reward_points / v_battle.battle_size)
          + case when ranked.team_rank <= (v_battle.reward_points % v_battle.battle_size) then 1 else 0 end
        else -((v_battle.reward_points / v_battle.battle_size)
          + case when ranked.team_rank <= (v_battle.reward_points % v_battle.battle_size) then 1 else 0 end)
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
$function$
;

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
$function$
;

CREATE OR REPLACE FUNCTION public.respond_rider_battle(p_battle_id uuid, p_response text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_battle public.weekly_rider_battles;
begin
  if v_user_id is null then raise exception 'You must be signed in'; end if;
  if p_response is null or p_response not in ('accepted', 'declined') then raise exception 'Choose accept or decline'; end if;
  select * into v_battle from public.weekly_rider_battles where id=p_battle_id for update;
  if v_battle.id is null or v_battle.status <> 'pending' then raise exception 'That battle request is no longer pending'; end if;
  update public.weekly_rider_battle_participants
  set response = p_response, responded_at = now()
  where battle_id = p_battle_id and athlete_id = v_user_id and response = 'pending';
  if not found then raise exception 'That battle request is no longer available'; end if;
  select * into v_battle from public.weekly_rider_battles where id = p_battle_id for update;
  if p_response = 'declined' then
    update public.weekly_rider_battles set status = 'declined', responded_at = now(), updated_at = now() where id = p_battle_id;
    return 'declined';
  end if;
  if not exists (select 1 from public.weekly_rider_battle_participants where battle_id = p_battle_id and response = 'pending') then
    update public.weekly_rider_battle_participants participant
    set baseline_points = public.current_rider_weekly_points(participant.athlete_id)
    where participant.battle_id = p_battle_id;
    update public.weekly_rider_battles
    set status = 'accepted', starts_at = now(), ends_at = now() + make_interval(days => duration_days), responded_at = now(), updated_at = now()
    where id = p_battle_id;
    return 'accepted';
  end if;
  return 'pending';
end;
$function$
;

CREATE OR REPLACE FUNCTION private.jkcrew_rider_battle_points(p_battle_id uuid, p_athlete_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with battle_window as (
    select
      battle.starts_at as score_from,
      case
        when battle.status = 'completed' and battle.forfeited_at is not null and battle.team_count = 2 then battle.forfeited_at
        else least(coalesce(battle.ends_at, now()), coalesce((
          select participant.forfeited_at from public.weekly_rider_battle_participants participant
          where participant.battle_id=battle.id and participant.athlete_id=p_athlete_id
        ), now()), now())
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
$function$
;
