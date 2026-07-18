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
set search_path = public, pg_temp
as $$
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
  sources as (
    select
      allowed.athlete_id,
      allowed.requested_week_start,
      exists (
        select 1
        from public.weekly_trick_assignments current_assignment
        where current_assignment.athlete_id = allowed.athlete_id
          and current_assignment.week_start = allowed.requested_week_start
      ) as has_current_week,
      exists (
        select 1
        from public.weekly_trick_assignments current_daily
        where current_daily.athlete_id = allowed.athlete_id
          and current_daily.week_start = allowed.requested_week_start
          and current_daily.category = 'daily'
      ) as has_current_daily,
      latest_daily.week_start as fallback_daily_week
    from allowed
    left join lateral (
      select daily_assignment.week_start
      from public.weekly_trick_assignments daily_assignment
      where daily_assignment.athlete_id = allowed.athlete_id
        and daily_assignment.category = 'daily'
        and daily_assignment.week_start < allowed.requested_week_start
        and daily_assignment.week_start >= allowed.requested_week_start - 56
      group by daily_assignment.week_start
      order by daily_assignment.week_start desc
      limit 1
    ) latest_daily on true
  ),
  selected as (
    select assignment.*, sources.requested_week_start, false as using_fallback
    from sources
    join public.weekly_trick_assignments assignment
      on assignment.athlete_id = sources.athlete_id
     and assignment.week_start = sources.requested_week_start

    union all

    select assignment.*, sources.requested_week_start, true as using_fallback
    from sources
    join public.weekly_trick_assignments assignment
      on assignment.athlete_id = sources.athlete_id
     and assignment.week_start = sources.fallback_daily_week
     and assignment.category = 'daily'
    where not sources.has_current_daily
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
$$;

revoke all on function public.get_coach_session_viewer_plan_data(uuid[], date[]) from public;
revoke all on function public.get_coach_session_viewer_plan_data(uuid[], date[]) from anon;
grant execute on function public.get_coach_session_viewer_plan_data(uuid[], date[]) to authenticated;

comment on function public.get_coach_session_viewer_plan_data(uuid[], date[]) is
  'Returns coach-authorized current assignments and a prior Daily-only visibility fallback, with progress data combined into one bounded read.';
