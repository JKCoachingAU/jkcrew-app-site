-- Allow equal teams of up to six riders in existing two- and three-sided battles.
-- Existing authorization, invitations, scoring and whole-team prize splits stay intact.
alter table public.weekly_rider_battles
  drop constraint weekly_rider_battles_battle_size_check;
alter table public.weekly_rider_battles
  add constraint weekly_rider_battles_battle_size_check check (battle_size between 1 and 6);

alter table public.weekly_rider_battles
  drop constraint weekly_rider_battles_team_count_check;
alter table public.weekly_rider_battles
  add constraint weekly_rider_battles_team_count_check check (team_count in (2, 3));

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
  v_team_count integer := case when coalesce(cardinality(p_team_three),0) > 0 then 3 else 2 end;
  v_all uuid[];
  v_athlete uuid;
  v_battle_id uuid;
  v_week_start date := ((date_trunc('week', timezone('Australia/Brisbane', now()) + interval '1 day') - interval '1 day')::date);
begin
  if v_user_id is null then raise exception 'You must be signed in'; end if;
  select role in ('coach', 'admin') into v_is_coach from public.profiles where id = v_user_id;
  if v_size not between 1 and 6 or coalesce(cardinality(p_team_two),0) <> v_size or (v_team_count = 3 and cardinality(p_team_three) <> v_size) then raise exception 'Choose two or three equal teams with 1 to 6 riders on each team'; end if;
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


revoke all on function private.create_three_sided_rider_battle(uuid[],uuid[],uuid[],integer,integer) from public, anon;
grant execute on function private.create_three_sided_rider_battle(uuid[],uuid[],uuid[],integer,integer) to authenticated;

notify pgrst, 'reload schema';
