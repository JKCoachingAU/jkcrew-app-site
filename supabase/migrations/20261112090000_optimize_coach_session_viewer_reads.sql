-- Keep the coach Session Viewer responsive for larger teams.
--
-- The full Session Viewer RPC returns every percentage attempt, assignment
-- attempt and recent award as nested JSON for every rider on every render.
-- That is useful when a rider's list is open, but wasteful for the collapsed
-- roster cards and makes tab/filter changes compete with active sessions.
-- This summary RPC keeps the same rollover and venue fallback rules while
-- returning only the fields needed for roster counters. The existing full RPC
-- remains available for the one rider whose list is open.

CREATE OR REPLACE FUNCTION public.get_coach_session_viewer_plan_summary(
  p_athlete_ids uuid[],
  p_week_starts date[]
)
RETURNS TABLE (
  id uuid,
  coach_id uuid,
  athlete_id uuid,
  week_start date,
  trick_name text,
  category text,
  target_reps integer,
  notes text,
  sort_order integer,
  created_at timestamptz,
  updated_at timestamptz,
  venue text,
  requested_week_start date,
  using_fallback boolean,
  progress jsonb,
  percentage_attempt_count integer,
  recent_award_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, private, pg_temp
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
  daily_lists AS (
    SELECT
      assignment.athlete_id,
      allowed.requested_week_start,
      private.jkcrew_venue_key(assignment.venue) AS venue_key,
      lower(regexp_replace(btrim(assignment.venue), '[^[:alnum:]]+', '', 'g')) AS source_venue_key,
      assignment.week_start,
      max(assignment.updated_at) AS saved_at,
      max(assignment.created_at) AS created_at,
      max(assignment.sort_order) AS last_sort_order
    FROM allowed
    JOIN public.weekly_trick_assignments assignment
      ON assignment.athlete_id = allowed.athlete_id
     AND assignment.category = 'daily'
     AND assignment.week_start <= allowed.requested_week_start
    GROUP BY
      assignment.athlete_id,
      allowed.requested_week_start,
      private.jkcrew_venue_key(assignment.venue),
      lower(regexp_replace(btrim(assignment.venue), '[^[:alnum:]]+', '', 'g')),
      assignment.week_start
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
    FROM latest_daily_lists latest
    JOIN public.weekly_trick_assignments assignment
      ON assignment.athlete_id = latest.athlete_id
     AND assignment.category = 'daily'
     AND assignment.week_start = latest.source_week_start
     AND private.jkcrew_venue_key(assignment.venue) = latest.venue_key
     AND lower(regexp_replace(btrim(assignment.venue), '[^[:alnum:]]+', '', 'g')) = latest.source_venue_key
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

REVOKE ALL ON FUNCTION public.get_coach_session_viewer_plan_summary(uuid[], date[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_coach_session_viewer_plan_summary(uuid[], date[]) TO authenticated;

COMMENT ON FUNCTION public.get_coach_session_viewer_plan_summary(uuid[], date[]) IS
  'Lightweight coach Session Viewer read for collapsed rider cards; full attempt and award JSON is loaded only for an open rider.';

NOTIFY pgrst, 'reload schema';
