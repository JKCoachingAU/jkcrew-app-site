create table if not exists public.dismissed_coach_tasks (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null default auth.uid(),
  task_key text not null,
  week_start date not null,
  dismissed_at timestamptz not null default now(),
  unique (coach_id, task_key, week_start)
);

alter table public.dismissed_coach_tasks enable row level security;

grant select, insert, delete on public.dismissed_coach_tasks to authenticated;

drop policy if exists "Coaches manage dismissed coach tasks" on public.dismissed_coach_tasks;
create policy "Coaches manage dismissed coach tasks"
on public.dismissed_coach_tasks
for all
to authenticated
using (
  coach_id = auth.uid()
  and exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.role in ('coach', 'admin')
  )
)
with check (
  coach_id = auth.uid()
  and exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.role in ('coach', 'admin')
  )
);
