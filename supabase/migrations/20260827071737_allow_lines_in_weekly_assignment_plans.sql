alter table public.weekly_assignment_plans
  drop constraint if exists weekly_assignment_plans_category_check;

alter table public.weekly_assignment_plans
  add constraint weekly_assignment_plans_category_check
  check (category in ('daily', 'dialled', 'one_bang', 'percentage', 'foam_pit', 'bonus', 'lines'));
