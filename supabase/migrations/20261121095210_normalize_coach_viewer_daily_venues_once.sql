-- Preserve coach scope, current-week rollover, every result field and tie.
-- Cache canonical/raw Daily labels once in each existing viewer read.
set local lock_timeout='5s';
set local statement_timeout='60s';
CREATE OR REPLACE FUNCTION private.approved_6f8c1399070419b6446b33e6(p_athlete_ids uuid[], p_week_starts date[])
 RETURNS TABLE(id uuid, coach_id uuid, athlete_id uuid, week_start date, trick_name text, category text, target_reps integer, notes text, sort_order integer, created_at timestamp with time zone, updated_at timestamp with time zone, venue text, requested_week_start date, using_fallback boolean, progress jsonb, percentage_attempt_count integer, recent_award_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  v_request record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Keep the same current-week materialisation as the full viewer read. The
  -- requests are sorted so simultaneous coach tabs acquire locks consistently.
  FOR v_request IN
    SELECT DISTINCT input.athlete_id, input.requested_week_start
    FROM unnest(p_athlete_ids, p_week_starts) AS input(athlete_id, requested_week_start)
    JOIN public.profiles rider ON rider.id = input.athlete_id
    CROSS JOIN LATERAL public.jkcrew_week_bounds(coalesce(rider.country_code, 'AU')) bounds
    JOIN public.profiles actor ON actor.id = auth.uid()
      AND actor.role::text IN ('coach', 'admin')
    WHERE input.requested_week_start = bounds.week_start_date
      AND (actor.role::text = 'admin' OR EXISTS (
        SELECT 1
        FROM public.coach_athletes link
        WHERE link.coach_id = auth.uid()
          AND link.athlete_id = input.athlete_id
      ))
    ORDER BY input.athlete_id, input.requested_week_start
  LOOP
    PERFORM public.ensure_current_week_assignments(v_request.athlete_id, v_request.requested_week_start);
  END LOOP;

  RETURN QUERY
  WITH viewer AS (
    SELECT profile.role::text AS role
    FROM public.profiles profile
    WHERE profile.id = auth.uid()
      AND profile.role::text IN ('coach', 'admin')
  ),
  requested AS (
    SELECT DISTINCT input.athlete_id, input.requested_week_start
    FROM unnest(p_athlete_ids, p_week_starts) AS input(athlete_id, requested_week_start)
    WHERE input.athlete_id IS NOT NULL
      AND input.requested_week_start IS NOT NULL
  ),
  allowed AS (
    SELECT requested.athlete_id, requested.requested_week_start
    FROM requested
    CROSS JOIN viewer
    WHERE viewer.role = 'admin'
       OR EXISTS (
         SELECT 1
         FROM public.coach_athletes link
         WHERE link.coach_id = auth.uid()
           AND link.athlete_id = requested.athlete_id
       )
  ),
  daily_rows as materialized (
    -- Scope each historical row once, including multi-week requests.
    select assignment.*
    from public.weekly_trick_assignments assignment
    where assignment.category='daily' and exists(
      select 1 from allowed where allowed.athlete_id=assignment.athlete_id
       and assignment.week_start<=allowed.requested_week_start
    )
  ),
  daily_venue_keys as materialized (
    select source.venue,coalesce(source.venue,'')as source_label,
      source.venue is null as source_is_null,
      private.jkcrew_venue_key(source.venue)as venue_key,
      lower(regexp_replace(btrim(source.venue),'[^[:alnum:]]+','','g'))as source_venue_key
    from(select distinct daily_rows.venue from daily_rows)source
  ),
  daily_lists as (
    select assignment.athlete_id,allowed.requested_week_start,
      keys.venue_key,keys.source_venue_key,assignment.week_start,
      max(assignment.updated_at)as saved_at,max(assignment.created_at)as created_at,
      max(assignment.sort_order)as last_sort_order
    from allowed join daily_rows assignment
      on assignment.athlete_id=allowed.athlete_id
      and assignment.week_start<=allowed.requested_week_start
    join daily_venue_keys keys
      on keys.source_label=coalesce(assignment.venue,'')
      and keys.source_is_null=(assignment.venue is null)
    group by assignment.athlete_id,allowed.requested_week_start,
      keys.venue_key,keys.source_venue_key,assignment.week_start
  ),
  latest_daily_lists AS (
    SELECT DISTINCT ON (daily_lists.athlete_id, daily_lists.requested_week_start, daily_lists.venue_key)
      daily_lists.athlete_id,
      daily_lists.requested_week_start,
      daily_lists.venue_key,
      daily_lists.source_venue_key,
      daily_lists.week_start AS source_week_start
    FROM daily_lists
    ORDER BY
      daily_lists.athlete_id,
      daily_lists.requested_week_start,
      daily_lists.venue_key,
      daily_lists.saved_at DESC,
      daily_lists.created_at DESC,
      daily_lists.week_start DESC,
      daily_lists.last_sort_order DESC,
      daily_lists.source_venue_key DESC
  ),
  selected AS (
    SELECT
      assignment.*,
      allowed.requested_week_start,
      false AS using_fallback
    FROM allowed
    JOIN public.weekly_trick_assignments assignment
      ON assignment.athlete_id = allowed.athlete_id
     AND assignment.week_start = allowed.requested_week_start
     AND assignment.category <> 'daily'

    UNION ALL

    SELECT
      assignment.*,
      latest.requested_week_start,
      assignment.week_start <> latest.requested_week_start AS using_fallback
    from latest_daily_lists latest
    join daily_rows assignment
      on assignment.athlete_id=latest.athlete_id
     and assignment.week_start=latest.source_week_start
    join daily_venue_keys keys
      on keys.source_label=coalesce(assignment.venue,'')
     and keys.source_is_null=(assignment.venue is null)
     and keys.venue_key=latest.venue_key
     -- Retain legacy NULL source-key equality: NULL never matches NULL here.
     and keys.source_venue_key=latest.source_venue_key
  )
  SELECT
    selected.id,
    selected.coach_id,
    selected.athlete_id,
    selected.week_start,
    selected.trick_name,
    selected.category,
    selected.target_reps,
    selected.notes,
    selected.sort_order,
    selected.created_at,
    selected.updated_at,
    selected.venue,
    selected.requested_week_start,
    selected.using_fallback,
    to_jsonb(progress_row) AS progress,
    CASE WHEN selected.category = 'percentage' THEN (
      SELECT count(*)::integer
      FROM public.percentage_attempts percentage_row
      WHERE percentage_row.assignment_id = selected.id
    ) ELSE 0 END AS percentage_attempt_count,
    (
      SELECT max(award_row.created_at)
      FROM public.assignment_point_awards award_row
      WHERE award_row.assignment_id = selected.id
        AND award_row.created_at >= now() - interval '8 days'
        AND award_row.points > 0
    ) AS recent_award_at
  FROM selected
  LEFT JOIN public.assignment_progress progress_row
    ON progress_row.assignment_id = selected.id
  ORDER BY selected.athlete_id, selected.sort_order, selected.id;
END;
$function$;

CREATE OR REPLACE FUNCTION private.approved_03246fa1717a62e5d1456625(p_athlete_ids uuid[], p_week_starts date[])
 RETURNS TABLE(id uuid, coach_id uuid, athlete_id uuid, week_start date, trick_name text, category text, target_reps integer, notes text, sort_order integer, created_at timestamp with time zone, updated_at timestamp with time zone, venue text, requested_week_start date, using_fallback boolean, progress jsonb, percentage_attempts jsonb, assignment_attempts jsonb, awards jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_request record;
begin
  -- Coach-first viewing must run the same rollover as the rider's Session.
  -- Historical/future views stay read-only; only each rider's current local
  -- week is materialized. Sort lock acquisition to avoid cross-roster deadlocks.
  for v_request in
    select distinct input.athlete_id, input.requested_week_start
    from unnest(p_athlete_ids, p_week_starts) as input(athlete_id, requested_week_start)
    join public.profiles rider on rider.id = input.athlete_id
    cross join lateral public.jkcrew_week_bounds(coalesce(rider.country_code, 'AU')) bounds
    join public.profiles actor on actor.id = auth.uid()
      and actor.role::text in ('coach', 'admin')
    where input.requested_week_start = bounds.week_start_date
      and (actor.role::text = 'admin' or exists (
        select 1 from public.coach_athletes link
        where link.coach_id = auth.uid() and link.athlete_id = input.athlete_id
      ))
    order by input.athlete_id, input.requested_week_start
  loop
    perform public.ensure_current_week_assignments(v_request.athlete_id, v_request.requested_week_start);
  end loop;

  return query
  with viewer as (
    select profile.role::text as role
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.role::text in ('coach', 'admin')
  ),
  requested as (
    select distinct input.athlete_id, input.requested_week_start
    from unnest(p_athlete_ids, p_week_starts) as input(athlete_id, requested_week_start)
    where input.athlete_id is not null
      and input.requested_week_start is not null
  ),
  allowed as (
    select requested.athlete_id, requested.requested_week_start
    from requested
    cross join viewer
    where viewer.role = 'admin'
       or exists (
         select 1
         from public.coach_athletes link
         where link.coach_id = auth.uid()
           and link.athlete_id = requested.athlete_id
       )
  ),
  daily_rows as materialized (
    -- Scope each historical row once, including multi-week requests.
    select assignment.*
    from public.weekly_trick_assignments assignment
    where assignment.category='daily' and exists(
      select 1 from allowed where allowed.athlete_id=assignment.athlete_id
       and assignment.week_start<=allowed.requested_week_start
    )
  ),
  daily_venue_keys as materialized (
    select source.venue,coalesce(source.venue,'')as source_label,
      source.venue is null as source_is_null,
      private.jkcrew_venue_key(source.venue)as venue_key,
      lower(regexp_replace(btrim(source.venue),'[^[:alnum:]]+','','g'))as source_venue_key
    from(select distinct daily_rows.venue from daily_rows)source
  ),
  daily_lists as (
    select assignment.athlete_id,allowed.requested_week_start,
      keys.venue_key,keys.source_venue_key,assignment.week_start,
      max(assignment.updated_at)as saved_at,max(assignment.created_at)as created_at,
      max(assignment.sort_order)as last_sort_order
    from allowed join daily_rows assignment
      on assignment.athlete_id=allowed.athlete_id
      and assignment.week_start<=allowed.requested_week_start
    join daily_venue_keys keys
      on keys.source_label=coalesce(assignment.venue,'')
      and keys.source_is_null=(assignment.venue is null)
    group by assignment.athlete_id,allowed.requested_week_start,
      keys.venue_key,keys.source_venue_key,assignment.week_start
  ),
  latest_daily_lists as (
    select distinct on (daily_lists.athlete_id, daily_lists.requested_week_start, daily_lists.venue_key)
      daily_lists.athlete_id,
      daily_lists.requested_week_start,
      daily_lists.venue_key,
      daily_lists.source_venue_key,
      daily_lists.week_start as source_week_start
    from daily_lists
    order by
      daily_lists.athlete_id,
      daily_lists.requested_week_start,
      daily_lists.venue_key,
      daily_lists.saved_at desc,
      daily_lists.created_at desc,
      daily_lists.week_start desc,
      daily_lists.last_sort_order desc,
      daily_lists.source_venue_key desc
  ),
  selected as (
    select
      assignment.*,
      allowed.requested_week_start,
      false as using_fallback
    from allowed
    join public.weekly_trick_assignments assignment
      on assignment.athlete_id = allowed.athlete_id
     and assignment.week_start = allowed.requested_week_start
     and assignment.category <> 'daily'

    union all

    select
      assignment.*,
      latest.requested_week_start,
      assignment.week_start <> latest.requested_week_start as using_fallback
    from latest_daily_lists latest
    join daily_rows assignment
      on assignment.athlete_id=latest.athlete_id
     and assignment.week_start=latest.source_week_start
    join daily_venue_keys keys
      on keys.source_label=coalesce(assignment.venue,'')
     and keys.source_is_null=(assignment.venue is null)
     and keys.venue_key=latest.venue_key
     -- Retain legacy NULL source-key equality: NULL never matches NULL here.
     and keys.source_venue_key=latest.source_venue_key
  )
  select
    selected.id,
    selected.coach_id,
    selected.athlete_id,
    selected.week_start,
    selected.trick_name,
    selected.category,
    selected.target_reps,
    selected.notes,
    selected.sort_order,
    selected.created_at,
    selected.updated_at,
    selected.venue,
    selected.requested_week_start,
    selected.using_fallback,
    to_jsonb(progress_row) as progress,
    coalesce((
      select jsonb_agg(to_jsonb(percentage_row) order by percentage_row.attempt_number)
      from public.percentage_attempts percentage_row
      where percentage_row.assignment_id = selected.id
    ), '[]'::jsonb) as percentage_attempts,
    coalesce((
      select jsonb_agg(to_jsonb(attempt_row) order by attempt_row.attempted_at desc)
      from public.assignment_attempts attempt_row
      where attempt_row.assignment_id = selected.id
        and attempt_row.week_start = selected.requested_week_start
    ), '[]'::jsonb) as assignment_attempts,
    coalesce((
      select jsonb_agg(to_jsonb(award_row) order by award_row.created_at desc)
      from public.assignment_point_awards award_row
      where award_row.assignment_id = selected.id
        and award_row.created_at >= now() - interval '8 days'
    ), '[]'::jsonb) as awards
  from selected
  left join public.assignment_progress progress_row
    on progress_row.assignment_id = selected.id
  order by selected.athlete_id, selected.sort_order, selected.id;
end;
$function$;
