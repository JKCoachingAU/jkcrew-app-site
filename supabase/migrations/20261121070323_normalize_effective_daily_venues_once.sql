-- Retain the existing private core authorization and public wrappers.
-- Only avoid repeated venue normalization over historical Daily assignments.
CREATE OR REPLACE FUNCTION private.approved_05f77af94420251eceb5d1b2(p_athlete_id uuid, p_week_start date)
 RETURNS TABLE(id uuid, coach_id uuid, athlete_id uuid, week_start date, trick_name text, category text, target_reps integer, notes text, sort_order integer, created_at timestamp with time zone, updated_at timestamp with time zone, venue text, requested_week_start date, using_fallback boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
  with actor as (
    select profile.role::text as role
    from public.profiles profile
    where profile.id = auth.uid()
  ),
  allowed as (
    select p_athlete_id as athlete_id, p_week_start as requested_week_start
    from actor
    where p_athlete_id is not null
      and p_week_start is not null
      and (
        auth.uid() = p_athlete_id
        or actor.role = 'admin'
        or (
          actor.role = 'coach'
          and exists (
            select 1
            from public.coach_athletes link
            where link.coach_id = auth.uid()
              and link.athlete_id = p_athlete_id
          )
        )
        or exists (
          select 1
          from public.parent_athletes link
          where link.parent_id = auth.uid()
            and link.athlete_id = p_athlete_id
        )
      )
  ),
  daily_rows as materialized (
    select assignment.*
    from allowed
    join public.weekly_trick_assignments assignment
      on assignment.athlete_id = allowed.athlete_id
     and assignment.category = 'daily'
     and assignment.week_start <= allowed.requested_week_start
  ),
  daily_venue_keys as materialized (
    -- Normalize each distinct raw label once, even across years of Daily rows.
    -- Keep the source spelling key separate from the canonical park alias.
    select source.venue,
      private.jkcrew_venue_key(source.venue) as venue_key,
      lower(regexp_replace(btrim(source.venue), '[^[:alnum:]]+', '', 'g')) as source_venue_key
    from (select distinct venue from daily_rows) source
  ),
  daily_lists as (
    select
      assignment.athlete_id,
      allowed.requested_week_start,
      keys.venue_key,
      keys.source_venue_key,
      assignment.week_start,
      max(assignment.updated_at) as saved_at,
      max(assignment.created_at) as created_at,
      max(assignment.sort_order) as last_sort_order
    from allowed
    join daily_rows assignment on assignment.athlete_id = allowed.athlete_id
    join daily_venue_keys keys on keys.venue is not distinct from assignment.venue
    group by assignment.athlete_id, allowed.requested_week_start,
      keys.venue_key, keys.source_venue_key, assignment.week_start
  ),
  latest_daily_lists as (
    select distinct on (athlete_id, requested_week_start, venue_key)
      athlete_id,
      requested_week_start,
      venue_key,
      source_venue_key,
      week_start as source_week_start
    from daily_lists
    order by
      athlete_id,
      requested_week_start,
      venue_key,
      saved_at desc,
      created_at desc,
      week_start desc,
      last_sort_order desc,
      source_venue_key desc
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
      on assignment.athlete_id = latest.athlete_id
     and assignment.week_start = latest.source_week_start
    join daily_venue_keys keys on keys.venue is not distinct from assignment.venue
     and keys.venue_key = latest.venue_key
     and keys.source_venue_key = latest.source_venue_key
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
    selected.using_fallback
  from selected
  order by selected.sort_order, selected.id;
$function$;
