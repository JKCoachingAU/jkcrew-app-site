-- Let riders and coaches choose the leaderboard stake for each battle.
-- Existing and legacy-created battles keep the original five-point default.
alter table public.weekly_rider_battles
  drop constraint if exists weekly_rider_battles_reward_points_check;

alter table public.weekly_rider_battles
  add constraint weekly_rider_battles_reward_points_check
  check (reward_points between 1 and 20);

alter table public.weekly_rider_battles
  alter column reward_points set default 5;

create or replace function public.request_rider_battle_v2(
  p_team_one uuid[],
  p_team_two uuid[],
  p_duration_days integer default 7,
  p_reward_points integer default 5
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_is_coach boolean;
  v_size integer := coalesce(cardinality(p_team_one), 0);
  v_all uuid[];
  v_athlete uuid;
  v_battle_id uuid;
  v_week_start date := ((date_trunc('week', timezone('Australia/Brisbane', now()) + interval '1 day') - interval '1 day')::date);
begin
  if v_user_id is null then raise exception 'You must be signed in'; end if;
  select role in ('coach', 'admin') into v_is_coach from public.profiles where id = v_user_id;
  if v_size not between 1 and 3 or cardinality(p_team_two) <> v_size then raise exception 'Choose equal 1, 2 or 3 rider teams'; end if;
  if p_duration_days not between 1 and 7 then raise exception 'Choose a battle length from 1 to 7 days'; end if;
  if coalesce(p_reward_points, 0) not between 1 and 20 then raise exception 'Choose a battle value from 1 to 20 points'; end if;
  v_all := p_team_one || p_team_two;
  if (select count(distinct chosen.rider_id) from unnest(v_all) as chosen(rider_id)) <> cardinality(v_all) then raise exception 'Each rider can only appear once'; end if;
  if not coalesce(v_is_coach, false) and not (v_user_id = any(p_team_one)) then raise exception 'Your own team must include you'; end if;
  if not coalesce(v_is_coach, false) and not exists (select 1 from public.profiles where id = v_user_id and role = 'athlete') then raise exception 'Only riders or coaches can create battles'; end if;

  foreach v_athlete in array v_all loop
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
    challenger_id, opponent_id, week_start, duration_days, reward_points, created_by, battle_size, status
  ) values (p_team_one[1], p_team_two[1], v_week_start, p_duration_days, p_reward_points, v_user_id, v_size, 'pending')
  returning id into v_battle_id;

  insert into public.weekly_rider_battle_participants (battle_id, athlete_id, team_number, response, responded_at)
  select v_battle_id, rider_id, 1,
    case when not coalesce(v_is_coach, false) and rider_id = v_user_id then 'accepted' else 'pending' end,
    case when not coalesce(v_is_coach, false) and rider_id = v_user_id then now() else null end
  from unnest(p_team_one) rider_id;
  insert into public.weekly_rider_battle_participants (battle_id, athlete_id, team_number, response)
  select v_battle_id, rider_id, 2, 'pending' from unnest(p_team_two) rider_id;

  insert into public.push_notification_queue (recipient_id, notification_type, title, body, url, payload, dedupe_key)
  select participant.athlete_id, 'rider_battle_request',
    case when v_size = 1 then 'New 1v1 battle' else 'New ' || v_size || 'v' || v_size || ' team battle' end,
    coalesce(creator.display_name, 'Coach JK') || ' invited you to a ' || p_duration_days || '-day battle for ' || p_reward_points || ' points. Tap to accept or decline.',
    './?push=challenges', jsonb_build_object('view', 'challenges', 'battle_id', v_battle_id, 'reward_points', p_reward_points),
    'rider-battle:' || v_battle_id::text || ':' || participant.athlete_id::text
  from public.weekly_rider_battle_participants participant
  left join public.profiles creator on creator.id = v_user_id
  where participant.battle_id = v_battle_id and participant.response = 'pending'
  on conflict (dedupe_key) do nothing;
  return v_battle_id;
end;
$function$;

-- Preserve the original RPC for installed clients that still send no point value.
create or replace function public.request_rider_battle(
  p_team_one uuid[],
  p_team_two uuid[],
  p_duration_days integer default 7
)
returns uuid
language sql
security definer
set search_path = public
as $function$
  select public.request_rider_battle_v2(p_team_one, p_team_two, p_duration_days, 5);
$function$;

create or replace function public.forfeit_rider_battle(p_battle_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $function$
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
$function$;

revoke all on function public.request_rider_battle_v2(uuid[], uuid[], integer, integer) from public, anon;
grant execute on function public.request_rider_battle_v2(uuid[], uuid[], integer, integer) to authenticated;

notify pgrst, 'reload schema';
