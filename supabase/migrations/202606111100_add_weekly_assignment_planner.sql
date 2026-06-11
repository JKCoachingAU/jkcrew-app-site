create table if not exists public.weekly_assignment_plans (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  target_week_start date not null,
  trick_name text not null,
  category text not null default 'daily',
  target_reps integer not null default 1,
  notes text not null default '',
  sort_order integer not null default 0,
  venue text not null default '',
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  constraint weekly_assignment_plans_category_check check (
    category in ('daily', 'dialled', 'one_bang', 'percentage', 'foam_pit', 'bonus')
  ),
  constraint weekly_assignment_plans_status_check check (
    status in ('draft', 'published', 'archived')
  )
);

alter table public.weekly_assignment_plans enable row level security;

grant select, insert, update, delete on public.weekly_assignment_plans to authenticated;
grant select, insert, update, delete on public.weekly_assignment_plans to service_role;

create index if not exists weekly_assignment_plans_coach_week_idx
  on public.weekly_assignment_plans (coach_id, target_week_start, status);

create index if not exists weekly_assignment_plans_athlete_week_idx
  on public.weekly_assignment_plans (athlete_id, target_week_start, status);

drop policy if exists "Coaches manage weekly assignment plans" on public.weekly_assignment_plans;
create policy "Coaches manage weekly assignment plans"
on public.weekly_assignment_plans
for all
to authenticated
using (
  coach_id = (select auth.uid())
  and exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role::text in ('coach', 'admin')
  )
  and exists (
    select 1
    from public.coach_athletes ca
    where ca.coach_id = (select auth.uid())
      and ca.athlete_id = weekly_assignment_plans.athlete_id
  )
)
with check (
  coach_id = (select auth.uid())
  and exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role::text in ('coach', 'admin')
  )
  and exists (
    select 1
    from public.coach_athletes ca
    where ca.coach_id = (select auth.uid())
      and ca.athlete_id = weekly_assignment_plans.athlete_id
  )
);

create or replace function public.save_weekly_assignment_plan(
  p_athlete_id uuid,
  p_target_week_start date,
  p_assignments jsonb,
  p_venues jsonb default null::jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coach uuid := auth.uid();
  v_count integer := 0;
begin
  if v_coach is null then
    raise exception 'You must be signed in to save a planned schedule.';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = v_coach
      and p.role::text in ('coach', 'admin')
  ) then
    raise exception 'Only coaches can save planned rider schedules.';
  end if;

  if not exists (
    select 1
    from public.coach_athletes ca
    where ca.coach_id = v_coach
      and ca.athlete_id = p_athlete_id
  ) then
    raise exception 'This rider is not linked to your coach account.';
  end if;

  if p_venues is not null then
    delete from public.coach_venues
    where coach_id = v_coach;

    insert into public.coach_venues (coach_id, name, sort_order)
    select v_coach, venue_name, row_number() over (order by first_seen) - 1
    from (
      select distinct on (lower(venue_name))
        venue_name,
        first_seen
      from (
        select
          btrim(value->>'name') as venue_name,
          ordinality as first_seen
        from jsonb_array_elements(coalesce(p_venues, '[]'::jsonb)) with ordinality
      ) raw
      where venue_name <> ''
        and char_length(venue_name) <= 80
      order by lower(venue_name), first_seen
    ) deduped
    order by first_seen;
  end if;

  update public.weekly_assignment_plans
  set status = 'archived',
      updated_at = now()
  where coach_id = v_coach
    and athlete_id = p_athlete_id
    and target_week_start = p_target_week_start
    and status = 'draft';

  insert into public.weekly_assignment_plans (
    coach_id,
    athlete_id,
    target_week_start,
    trick_name,
    category,
    target_reps,
    notes,
    sort_order,
    venue,
    status
  )
  select
    v_coach,
    p_athlete_id,
    p_target_week_start,
    left(btrim(item->>'trick_name'), 120),
    coalesce(nullif(item->>'category', ''), 'daily'),
    greatest(1, least(100, coalesce(nullif(item->>'target_reps', '')::integer, 1))),
    left(coalesce(item->>'notes', ''), 500),
    ordinality - 1,
    case
      when coalesce(item->>'category', 'daily') = 'daily'
        then left(coalesce(item->>'venue', ''), 80)
      else ''
    end,
    'draft'
  from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb)) with ordinality as entries(item, ordinality)
  where btrim(coalesce(item->>'trick_name', '')) <> '';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.save_weekly_assignment_plan(uuid, date, jsonb, jsonb) from public;
grant execute on function public.save_weekly_assignment_plan(uuid, date, jsonb, jsonb) to authenticated;

create or replace function public.ensure_current_week_assignments(p_athlete_id uuid, p_week_start date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  source_week date;
  inserted_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not (
    auth.uid() = p_athlete_id
    or exists (
      select 1
      from public.coach_athletes ca
      where ca.coach_id = auth.uid()
        and ca.athlete_id = p_athlete_id
    )
    or exists (
      select 1
      from public.parent_athletes pa
      where pa.parent_id = auth.uid()
        and pa.athlete_id = p_athlete_id
    )
  ) then
    raise exception 'Not allowed to roll over this rider schedule';
  end if;

  if exists (
    select 1
    from public.weekly_trick_assignments current_week
    where current_week.athlete_id = p_athlete_id
      and current_week.week_start = p_week_start
  ) then
    return 0;
  end if;

  insert into public.weekly_trick_assignments (
    coach_id,
    athlete_id,
    week_start,
    trick_name,
    category,
    target_reps,
    notes,
    sort_order,
    venue,
    created_at,
    updated_at
  )
  select
    plan.coach_id,
    plan.athlete_id,
    p_week_start,
    plan.trick_name,
    plan.category,
    plan.target_reps,
    plan.notes,
    plan.sort_order,
    plan.venue,
    now(),
    now()
  from public.weekly_assignment_plans plan
  where plan.athlete_id = p_athlete_id
    and plan.target_week_start = p_week_start
    and plan.status = 'draft'
  order by plan.sort_order;

  get diagnostics inserted_count = row_count;

  if inserted_count > 0 then
    update public.weekly_assignment_plans plan
    set status = 'published',
        published_at = now(),
        updated_at = now()
    where plan.athlete_id = p_athlete_id
      and plan.target_week_start = p_week_start
      and plan.status = 'draft';

    return inserted_count;
  end if;

  select max(w.week_start)
  into source_week
  from public.weekly_trick_assignments w
  where w.athlete_id = p_athlete_id
    and w.week_start < p_week_start;

  if source_week is null then
    return 0;
  end if;

  insert into public.weekly_trick_assignments (
    coach_id,
    athlete_id,
    week_start,
    trick_name,
    category,
    target_reps,
    notes,
    sort_order,
    venue,
    created_at,
    updated_at
  )
  select
    w.coach_id,
    w.athlete_id,
    p_week_start,
    w.trick_name,
    w.category,
    w.target_reps,
    w.notes,
    w.sort_order,
    w.venue,
    now(),
    now()
  from public.weekly_trick_assignments w
  where w.athlete_id = p_athlete_id
    and w.week_start = source_week;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke all on function public.ensure_current_week_assignments(uuid, date) from public;
grant execute on function public.ensure_current_week_assignments(uuid, date) to authenticated;
