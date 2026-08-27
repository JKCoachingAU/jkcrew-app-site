alter table public.run_plans
  add column if not exists contest_item_id uuid references public.dashboard_items(id) on delete set null;

create index if not exists run_plans_contest_item_idx
  on public.run_plans(contest_item_id)
  where contest_item_id is not null;
