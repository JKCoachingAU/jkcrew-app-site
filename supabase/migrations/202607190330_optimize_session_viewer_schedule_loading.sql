create or replace function public.get_coach_session_viewer_assignments(
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
  using_fallback boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with viewer as (
    select p.role::text as role
    from public.profiles p
    where p.id = auth.uid()
      and p.role::text in ('coach', 'admin')
  ),
  requested as (
    select input.athlete_id, input.requested_week_start
    from unnest(p_athlete_ids, p_week_starts) as input(athlete_id, requested_week_start)
    where input.athlete_id is not null
      and input.requested_week_start is not null
  ),
  allowed as (
    select distinct requested.athlete_id, requested.requested_week_start
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
  selected_weeks as (
    select
      allowed.athlete_id,
      allowed.requested_week_start,
      latest.week_start as source_week_start
    from allowed
    left join lateral (
      select assignment.week_start
      from public.weekly_trick_assignments assignment
      where assignment.athlete_id = allowed.athlete_id
        and assignment.week_start <= allowed.requested_week_start
        and assignment.week_start >= allowed.requested_week_start - 56
      group by assignment.week_start
      order by assignment.week_start desc
      limit 1
    ) latest on true
  )
  select
    assignment.id,
    assignment.coach_id,
    assignment.athlete_id,
    assignment.week_start,
    assignment.trick_name,
    assignment.category,
    assignment.target_reps,
    assignment.notes,
    assignment.sort_order,
    assignment.created_at,
    assignment.updated_at,
    assignment.venue,
    selected_weeks.requested_week_start,
    assignment.week_start <> selected_weeks.requested_week_start as using_fallback
  from selected_weeks
  join public.weekly_trick_assignments assignment
    on assignment.athlete_id = selected_weeks.athlete_id
   and assignment.week_start = selected_weeks.source_week_start
  where assignment.week_start = selected_weeks.requested_week_start
     or assignment.category = 'daily'
  order by assignment.athlete_id, assignment.sort_order, assignment.id;
$$;

revoke all on function public.get_coach_session_viewer_assignments(uuid[], date[]) from public;
grant execute on function public.get_coach_session_viewer_assignments(uuid[], date[]) to authenticated;

comment on function public.get_coach_session_viewer_assignments(uuid[], date[]) is
  'Returns one bounded, coach-authorized assignment week per rider. Uses the requested week when available and the newest saved prior week as a read-only viewer fallback.';
