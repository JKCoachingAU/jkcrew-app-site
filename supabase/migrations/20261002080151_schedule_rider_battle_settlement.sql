-- Settlement used to wait until somebody opened a battle feed. Run the same
-- locked, atomic payout every minute so an expired battle pays without an app open.
-- Historical outcomes and point adjustments are intentionally untouched.
-- Only the database owner can call the internal worker. The existing protected
-- public wrapper is retained for feed/forfeit compatibility.

CREATE OR REPLACE FUNCTION private.settle_expired_rider_battles()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO ''
AS $function$
declare
  v_battle record;
  v_prize_points integer;
  v_winning_team integer;
  v_winner_id uuid;
  v_settled integer := 0;
begin

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


REVOKE ALL ON FUNCTION private.settle_expired_rider_battles() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.settle_expired_rider_battles()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'You must be signed in'; END IF;
  RETURN private.settle_expired_rider_battles();
END;
$function$;
-- CREATE OR REPLACE preserves this existing API's grants. Do not grant it to
-- clients: authorized battle feeds call it from their existing definer context.

-- Named schedules are updated in place by pg_cron, avoiding duplicate workers.
SELECT cron.schedule(
  'jkcrew-settle-rider-battles',
  '* * * * *',
  'select private.settle_expired_rider_battles();'
);
