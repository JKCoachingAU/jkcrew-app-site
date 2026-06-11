revoke execute on function public.save_weekly_assignment_plan(uuid, date, jsonb, jsonb) from public;
revoke execute on function public.save_weekly_assignment_plan(uuid, date, jsonb, jsonb) from anon;
revoke execute on function public.ensure_current_week_assignments(uuid, date) from public;
revoke execute on function public.ensure_current_week_assignments(uuid, date) from anon;

grant execute on function public.save_weekly_assignment_plan(uuid, date, jsonb, jsonb) to authenticated;
grant execute on function public.ensure_current_week_assignments(uuid, date) to authenticated;
