-- Bound the feed to the current coach's existing participant links before
-- unchanged all-participant tenant visibility and score projection.
-- Settlement, approval, public API, signatures and grants are unchanged.
set local lock_timeout='5s';
set local statement_timeout='8s';

CREATE OR REPLACE FUNCTION private.approved_62c8b56b3a620c7b49a107ab(p_limit integer DEFAULT 100)
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

  -- Resolve the exact legacy own-coach participant relation before invoking
  -- tenant visibility or participant score projections on candidate battles.
  with own_roster as materialized (
    select link.athlete_id
    from public.coach_athletes link
    where link.coach_id = v_user_id
  ), candidate_battle_ids as materialized (
    select distinct participant.battle_id
    from own_roster roster
    join public.weekly_rider_battle_participants participant
      on participant.athlete_id = roster.athlete_id
  ), visible_battles as materialized (
    select battle.*
    from candidate_battle_ids candidate
    cross join lateral (
      select scoped_battle.*
      from public.weekly_rider_battles scoped_battle
      where scoped_battle.id = candidate.battle_id
      offset 0
    ) battle
    where private.jkcrew_team_battle_visible(battle.id)
    order by
      case when battle.status in ('pending', 'accepted') then 0 else 1 end,
      battle.created_at desc
    limit least(greatest(coalesce(p_limit, 100), 1), 250)
  )
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
    from visible_battles battle
    offset 0
  ) rows;

  return v_result;
end;
$function$;

notify pgrst, 'reload schema';
