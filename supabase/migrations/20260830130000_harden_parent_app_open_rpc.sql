-- The app-open RPC only updates the signed-in user's own profile and can rely
-- on the existing self-update RLS policy. Keep it invoker-scoped so it never
-- receives elevated table privileges.

alter function public.record_my_app_open() security invoker;
