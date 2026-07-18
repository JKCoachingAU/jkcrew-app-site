revoke all on function public.get_coach_session_viewer_assignments(uuid[], date[]) from anon;
revoke all on function public.get_coach_session_viewer_plan_data(uuid[], date[]) from anon;

grant execute on function public.get_coach_session_viewer_assignments(uuid[], date[]) to authenticated;
grant execute on function public.get_coach_session_viewer_plan_data(uuid[], date[]) to authenticated;
