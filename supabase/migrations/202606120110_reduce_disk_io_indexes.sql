-- Reduce Postgres disk IO for the high-traffic app screens.
-- These indexes match the filtered reads used by the session, leaderboard,
-- coach dashboard, session viewer, parent, and video review flows.

create index if not exists weekly_trick_assignments_athlete_week_sort_idx
  on public.weekly_trick_assignments (athlete_id, week_start, sort_order);

create index if not exists weekly_trick_assignments_week_athlete_category_idx
  on public.weekly_trick_assignments (week_start, athlete_id, category);

create index if not exists assignment_progress_assignment_idx
  on public.assignment_progress (assignment_id);

create index if not exists assignment_progress_athlete_assignment_idx
  on public.assignment_progress (athlete_id, assignment_id);

create index if not exists assignment_point_awards_assignment_created_idx
  on public.assignment_point_awards (assignment_id, created_at desc);

create index if not exists assignment_point_awards_athlete_created_idx
  on public.assignment_point_awards (athlete_id, created_at desc);

create index if not exists assignment_attempts_assignment_week_attempted_idx
  on public.assignment_attempts (assignment_id, week_start, attempted_at desc);

create index if not exists assignment_attempts_athlete_week_attempted_idx
  on public.assignment_attempts (athlete_id, week_start, attempted_at desc);

create index if not exists percentage_attempts_assignment_number_idx
  on public.percentage_attempts (assignment_id, attempt_number);

create index if not exists percentage_attempts_athlete_assignment_idx
  on public.percentage_attempts (athlete_id, assignment_id);

create index if not exists training_sessions_athlete_started_idx
  on public.training_sessions (athlete_id, started_at desc);

create index if not exists training_sessions_athlete_active_idx
  on public.training_sessions (athlete_id, started_at desc)
  where ended_at is null;

create index if not exists training_sessions_athlete_daily_done_idx
  on public.training_sessions (athlete_id, daily_completed_at desc)
  where daily_completed_at is not null;

create index if not exists coach_athletes_coach_athlete_idx
  on public.coach_athletes (coach_id, athlete_id);

create index if not exists coach_athlete_groups_coach_athlete_group_idx
  on public.coach_athlete_groups (coach_id, athlete_id, group_name);

create index if not exists dashboard_items_owner_due_created_idx
  on public.dashboard_items (owner_id, due_at, created_at desc);

create index if not exists trick_help_requests_athlete_created_idx
  on public.trick_help_requests (athlete_id, created_at desc);

create index if not exists trick_help_requests_status_created_idx
  on public.trick_help_requests (status, created_at desc);

create index if not exists trick_requests_athlete_status_created_idx
  on public.trick_requests (athlete_id, status, created_at desc);

create index if not exists coach_calendar_events_coach_starts_idx
  on public.coach_calendar_events (coach_id, starts_at);

create index if not exists crew_posts_type_created_idx
  on public.crew_posts (post_type, created_at desc);

create index if not exists crew_post_reactions_post_user_idx
  on public.crew_post_reactions (post_id, user_id);

create index if not exists parent_athletes_coach_athlete_idx
  on public.parent_athletes (coach_id, athlete_id);
