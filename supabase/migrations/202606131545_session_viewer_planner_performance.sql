create index if not exists weekly_trick_assignments_athlete_week_sort_idx
  on public.weekly_trick_assignments(athlete_id, week_start, sort_order);

create index if not exists weekly_trick_assignments_athlete_week_created_idx
  on public.weekly_trick_assignments(athlete_id, week_start desc, created_at desc);

create index if not exists assignment_progress_assignment_idx
  on public.assignment_progress(assignment_id);

create index if not exists percentage_attempts_assignment_attempt_idx
  on public.percentage_attempts(assignment_id, attempt_number);

create index if not exists run_plans_athlete_active_updated_idx
  on public.run_plans(athlete_id, updated_at desc)
  where archived_at is null;

create index if not exists run_checklist_progress_run_plan_idx
  on public.run_checklist_progress(run_plan_id, athlete_id);

create index if not exists coach_group_sessions_coach_status_started_idx
  on public.coach_group_sessions(coach_id, status, started_at desc);

create index if not exists coach_group_session_participants_session_athlete_idx
  on public.coach_group_session_participants(group_session_id, athlete_id);
