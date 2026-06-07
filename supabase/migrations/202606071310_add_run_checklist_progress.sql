create table if not exists public.run_checklist_progress (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  run_plan_id uuid not null references public.run_plans(id) on delete cascade,
  point_index integer not null check (point_index >= 0),
  completed boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (athlete_id, run_plan_id, point_index)
);

alter table public.run_checklist_progress enable row level security;

grant select, insert, update, delete on public.run_checklist_progress to authenticated;

drop policy if exists "Athletes manage own run checklist progress" on public.run_checklist_progress;
create policy "Athletes manage own run checklist progress"
on public.run_checklist_progress
for all
to authenticated
using (athlete_id = auth.uid())
with check (
  athlete_id = auth.uid()
  and exists (
    select 1
    from public.run_plans rp
    where rp.id = run_checklist_progress.run_plan_id
      and rp.athlete_id = auth.uid()
  )
);

drop policy if exists "Linked coaches manage rider run checklist progress" on public.run_checklist_progress;
create policy "Linked coaches manage rider run checklist progress"
on public.run_checklist_progress
for all
to authenticated
using (
  exists (
    select 1
    from public.coach_athletes ca
    where ca.coach_id = auth.uid()
      and ca.athlete_id = run_checklist_progress.athlete_id
  )
)
with check (
  exists (
    select 1
    from public.coach_athletes ca
    join public.run_plans rp on rp.id = run_checklist_progress.run_plan_id
    where ca.coach_id = auth.uid()
      and ca.athlete_id = run_checklist_progress.athlete_id
      and rp.athlete_id = run_checklist_progress.athlete_id
  )
);
