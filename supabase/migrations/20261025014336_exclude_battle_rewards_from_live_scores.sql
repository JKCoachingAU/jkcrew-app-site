-- A payout from an earlier battle must not become a score in an overlapping
-- battle. Keep published historical results on their original calculation;
-- pending/live battles and all future battles use the corrected rule, including
-- after they finish. This changes no awards, leaderboard totals or payouts.
-- ALTER TABLE holds the battle table lock until commit, serializing this switch
-- with the existing row-locked settlement worker.
alter table public.weekly_rider_battles
  add column if not exists exclude_battle_rewards boolean not null default false;

update public.weekly_rider_battles
set exclude_battle_rewards = true
where status in ('pending', 'accepted') and not exclude_battle_rewards;

alter table public.weekly_rider_battles
  alter column exclude_battle_rewards set default true;

comment on column public.weekly_rider_battles.exclude_battle_rewards is
  'Scoring rule fixed per battle: ignore other battle payouts/losses in contributions. False preserves battles finished before the correction.';

-- CREATE OR REPLACE preserves existing private-helper privileges. These stay
-- SECURITY INVOKER with an empty search_path and expose no new client API.
CREATE OR REPLACE FUNCTION private.jkcrew_rider_battle_points(p_battle_id uuid, p_athlete_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with battle_window as (
    select
      battle.exclude_battle_rewards,
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
          and (not battle_window.exclude_battle_rewards
            or adjustment.reason not ilike 'Rider battle %')
      ), 0)
    )::integer
    from battle_window
  ), 0);
$function$;

CREATE OR REPLACE FUNCTION private.jkcrew_rider_battle_points_between(p_battle_id uuid, p_athlete_id uuid, p_from timestamptz, p_until timestamptz)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with battle_window as (
    select
      battle.exclude_battle_rewards,
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
          and (not battle_window.exclude_battle_rewards
            or adjustment.reason not ilike 'Rider battle %')
      ), 0)
    )::integer
    from battle_window
  ), 0);
$function$;

notify pgrst, 'reload schema';
