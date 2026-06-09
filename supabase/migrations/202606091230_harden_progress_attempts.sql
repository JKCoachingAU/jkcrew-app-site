revoke execute on function public.record_assignment_attempt(uuid, uuid) from anon;
revoke execute on function public.finish_group_session_daily(uuid, uuid, integer) from anon;
revoke execute on function public.recalculate_athlete_points(uuid) from anon;

create index if not exists assignment_attempts_session_idx
  on public.assignment_attempts (session_id)
  where session_id is not null;

create index if not exists assignment_attempts_group_session_idx
  on public.assignment_attempts (group_session_id)
  where group_session_id is not null;

drop policy if exists "Riders view own assignment attempts" on public.assignment_attempts;
drop policy if exists "Coaches view linked assignment attempts" on public.assignment_attempts;
drop policy if exists "Parents view linked assignment attempts" on public.assignment_attempts;

create policy "Allowed users view assignment attempts"
on public.assignment_attempts
for select
to authenticated
using (
  athlete_id = (select auth.uid())
  or exists (
    select 1
    from public.coach_athletes ca
    where ca.coach_id = (select auth.uid())
      and ca.athlete_id = assignment_attempts.athlete_id
  )
  or exists (
    select 1
    from public.parent_athletes pa
    where pa.parent_id = (select auth.uid())
      and pa.athlete_id = assignment_attempts.athlete_id
  )
  or exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('coach', 'admin')
  )
);
