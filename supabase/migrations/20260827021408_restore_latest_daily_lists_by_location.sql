-- Daily lists are persistent per riding location. A rider's current weekly
-- categories still come from the requested week, but each Daily location uses
-- the newest saved list at or before that week. This keeps older parks visible
-- without rewriting or deleting any historical assignment records.

create index if not exists weekly_trick_assignments_latest_daily_location_idx
  on public.weekly_trick_assignments (
    athlete_id,
    private.jkcrew_venue_key(venue),
    week_start desc,
    sort_order
  )
  include (updated_at)
  where category = 'daily';

create or replace function public.get_effective_weekly_assignments(
  p_athlete_id uuid,
  p_week_start date
)
returns table (
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
  using_fallback boolean
)
language sql
stable
security definer
set search_path = public, private, pg_temp
as $function$
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
  daily_weeks as (
    select
      assignment.athlete_id,
      allowed.requested_week_start,
      private.jkcrew_venue_key(assignment.venue) as venue_key,
      assignment.week_start,
      max(assignment.updated_at) as saved_at
    from allowed
    join public.weekly_trick_assignments assignment
      on assignment.athlete_id = allowed.athlete_id
     and assignment.category = 'daily'
     and assignment.week_start <= allowed.requested_week_start
    group by
      assignment.athlete_id,
      allowed.requested_week_start,
      private.jkcrew_venue_key(assignment.venue),
      assignment.week_start
  ),
  latest_daily_weeks as (
    select distinct on (athlete_id, requested_week_start, venue_key)
      athlete_id,
      requested_week_start,
      venue_key,
      week_start as source_week_start
    from daily_weeks
    order by athlete_id, requested_week_start, venue_key, week_start desc, saved_at desc
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
    from latest_daily_weeks latest
    join public.weekly_trick_assignments assignment
      on assignment.athlete_id = latest.athlete_id
     and assignment.category = 'daily'
     and assignment.week_start = latest.source_week_start
     and private.jkcrew_venue_key(assignment.venue) = latest.venue_key
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

revoke all on function public.get_effective_weekly_assignments(uuid, date) from public, anon;
grant execute on function public.get_effective_weekly_assignments(uuid, date) to authenticated;

comment on function public.get_effective_weekly_assignments(uuid, date) is
  'Returns current non-Daily assignments plus the newest saved Daily list independently for every canonical riding location authorized to the caller.';

create or replace function public.get_coach_session_viewer_plan_data(
  p_athlete_ids uuid[],
  p_week_starts date[]
)
returns table (
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
  percentage_attempts jsonb,
  assignment_attempts jsonb,
  awards jsonb
)
language sql
stable
security definer
set search_path = public, private, pg_temp
as $function$
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
  daily_weeks as (
    select
      assignment.athlete_id,
      allowed.requested_week_start,
      private.jkcrew_venue_key(assignment.venue) as venue_key,
      assignment.week_start,
      max(assignment.updated_at) as saved_at
    from allowed
    join public.weekly_trick_assignments assignment
      on assignment.athlete_id = allowed.athlete_id
     and assignment.category = 'daily'
     and assignment.week_start <= allowed.requested_week_start
    group by
      assignment.athlete_id,
      allowed.requested_week_start,
      private.jkcrew_venue_key(assignment.venue),
      assignment.week_start
  ),
  latest_daily_weeks as (
    select distinct on (athlete_id, requested_week_start, venue_key)
      athlete_id,
      requested_week_start,
      venue_key,
      week_start as source_week_start
    from daily_weeks
    order by athlete_id, requested_week_start, venue_key, week_start desc, saved_at desc
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
    from latest_daily_weeks latest
    join public.weekly_trick_assignments assignment
      on assignment.athlete_id = latest.athlete_id
     and assignment.category = 'daily'
     and assignment.week_start = latest.source_week_start
     and private.jkcrew_venue_key(assignment.venue) = latest.venue_key
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
$function$;

revoke all on function public.get_coach_session_viewer_plan_data(uuid[], date[]) from public, anon;
grant execute on function public.get_coach_session_viewer_plan_data(uuid[], date[]) to authenticated;

comment on function public.get_coach_session_viewer_plan_data(uuid[], date[]) is
  'Returns coach-authorized current non-Daily assignments and the newest saved Daily list independently for every canonical riding location.';
