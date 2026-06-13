-- Make next-week planning explicit and safe.
--
-- Current-week assignments remain in weekly_trick_assignments. Upcoming plans
-- live separately in weekly_assignment_plans and are only copied into the
-- active table when the new week is ensured.

alter table public.weekly_assignment_plans
  drop constraint if exists weekly_assignment_plans_status_check;

alter table public.weekly_assignment_plans
  add constraint weekly_assignment_plans_status_check
  check (
    status in (
      'active_current_week',
      'draft_next_week',
      'scheduled_next_week',
      'archived_previous_week',
      -- legacy statuses kept readable while older clients finish updating
      'draft',
      'published',
      'archived'
    )
  );

create index if not exists weekly_assignment_plans_active_lookup_idx
  on public.weekly_assignment_plans (coach_id, athlete_id, target_week_start, status, sort_order);

create index if not exists weekly_assignment_plans_duplicate_guard_idx
  on public.weekly_assignment_plans (
    athlete_id,
    target_week_start,
    status,
    category,
    lower(coalesce(venue, '')),
    lower(btrim(trick_name))
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
  set status = 'archived_previous_week',
      updated_at = now()
  where coach_id = v_coach
    and athlete_id = p_athlete_id
    and target_week_start = p_target_week_start
    and status in ('draft', 'draft_next_week', 'scheduled_next_week');

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
  with normalized as (
    select
      ordinality,
      left(btrim(item->>'trick_name'), 120) as trick_name,
      coalesce(nullif(item->>'category', ''), 'daily') as category,
      greatest(1, least(100, coalesce(nullif(item->>'target_reps', '')::integer, 1))) as target_reps,
      left(coalesce(item->>'notes', ''), 500) as notes,
      case
        when coalesce(item->>'category', 'daily') = 'daily'
          then left(coalesce(item->>'venue', ''), 80)
        else ''
      end as venue
    from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb)) with ordinality as entries(item, ordinality)
    where btrim(coalesce(item->>'trick_name', '')) <> ''
  ),
  deduped as (
    select distinct on (lower(trick_name), category, lower(coalesce(venue, '')))
      *
    from normalized
    where category in ('daily', 'dialled', 'one_bang', 'percentage', 'foam_pit', 'bonus')
    order by lower(trick_name), category, lower(coalesce(venue, '')), ordinality
  )
  select
    v_coach,
    p_athlete_id,
    p_target_week_start,
    trick_name,
    category,
    target_reps,
    notes,
    row_number() over (order by ordinality) - 1,
    venue,
    'scheduled_next_week'
  from deduped
  order by ordinality;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.save_weekly_assignment_plan(uuid, date, jsonb, jsonb) from public;
revoke execute on function public.save_weekly_assignment_plan(uuid, date, jsonb, jsonb) from anon;
grant execute on function public.save_weekly_assignment_plan(uuid, date, jsonb, jsonb) to authenticated;

create or replace function public.accept_trick_request_into_plan(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coach uuid := auth.uid();
  v_request public.trick_requests%rowtype;
  v_plan_id uuid;
  v_status text;
  v_sort_order integer := 0;
begin
  if v_coach is null then
    raise exception 'You must be signed in to accept rider requests.';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = v_coach
      and p.role::text in ('coach', 'admin')
  ) then
    raise exception 'Only coaches can accept rider trick requests.';
  end if;

  select *
  into v_request
  from public.trick_requests tr
  where tr.id = p_request_id
  for update;

  if not found then
    raise exception 'Could not find that trick request.';
  end if;

  if not exists (
    select 1
    from public.coach_athletes ca
    where ca.coach_id = v_coach
      and ca.athlete_id = v_request.athlete_id
  ) then
    raise exception 'This rider is not linked to your coach account.';
  end if;

  if v_request.status = 'accepted' and v_request.planned_assignment_id is not null then
    return v_request.planned_assignment_id;
  end if;

  if v_request.status = 'declined' then
    raise exception 'This request has already been declined.';
  end if;

  v_status := case
    when exists (
      select 1
      from public.weekly_assignment_plans plan
      where plan.coach_id = v_coach
        and plan.athlete_id = v_request.athlete_id
        and plan.target_week_start = v_request.target_week_start
        and plan.status = 'scheduled_next_week'
    )
      then 'scheduled_next_week'
    else 'draft_next_week'
  end;

  select plan.id
  into v_plan_id
  from public.weekly_assignment_plans plan
  where plan.coach_id = v_coach
    and plan.athlete_id = v_request.athlete_id
    and plan.target_week_start = v_request.target_week_start
    and plan.status in ('draft', 'draft_next_week', 'scheduled_next_week')
    and plan.category = v_request.category
    and lower(btrim(plan.trick_name)) = lower(btrim(v_request.trick_name))
    and lower(coalesce(plan.venue, '')) = lower(case when v_request.category = 'daily' then coalesce(v_request.venue, '') else '' end)
  order by case plan.status when 'scheduled_next_week' then 0 when 'draft_next_week' then 1 else 2 end, plan.sort_order
  limit 1;

  if v_plan_id is null then
    select coalesce(max(plan.sort_order) + 1, 0)
    into v_sort_order
    from public.weekly_assignment_plans plan
    where plan.coach_id = v_coach
      and plan.athlete_id = v_request.athlete_id
      and plan.target_week_start = v_request.target_week_start
      and plan.status in ('draft', 'draft_next_week', 'scheduled_next_week');

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
    values (
      v_coach,
      v_request.athlete_id,
      v_request.target_week_start,
      left(btrim(v_request.trick_name), 120),
      v_request.category,
      case when v_request.category = 'dialled' then 3 when v_request.category = 'percentage' then 10 else 1 end,
      left(coalesce(v_request.notes, ''), 500),
      v_sort_order,
      case when v_request.category = 'daily' then left(coalesce(v_request.venue, ''), 80) else '' end,
      v_status
    )
    returning id into v_plan_id;
  end if;

  update public.trick_requests tr
  set status = 'accepted',
      planned_assignment_id = v_plan_id,
      coach_id = v_coach,
      reviewed_by = v_coach,
      reviewed_at = now(),
      updated_at = now()
  where tr.id = p_request_id;

  return v_plan_id;
end;
$$;

revoke all on function public.accept_trick_request_into_plan(uuid) from public;
revoke execute on function public.accept_trick_request_into_plan(uuid) from anon;
grant execute on function public.accept_trick_request_into_plan(uuid) to authenticated;

create or replace function public.ensure_current_week_assignments(p_athlete_id uuid, p_week_start date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  source_week date;
  inserted_count integer := 0;
  source_status text;
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

  select plan.status
  into source_status
  from public.weekly_assignment_plans plan
  where plan.athlete_id = p_athlete_id
    and plan.target_week_start = p_week_start
    and plan.status in ('scheduled_next_week', 'draft_next_week', 'draft')
  order by case plan.status when 'scheduled_next_week' then 0 when 'draft_next_week' then 1 else 2 end
  limit 1;

  if source_status is not null then
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
      and plan.status = source_status
    order by plan.sort_order;

    get diagnostics inserted_count = row_count;

    if inserted_count > 0 then
      update public.weekly_assignment_plans plan
      set status = 'archived_previous_week',
          published_at = coalesce(plan.published_at, now()),
          updated_at = now()
      where plan.athlete_id = p_athlete_id
        and plan.target_week_start = p_week_start
        and plan.status = source_status;

      return inserted_count;
    end if;
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
    and w.week_start = source_week
  order by w.sort_order;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke all on function public.ensure_current_week_assignments(uuid, date) from public;
revoke execute on function public.ensure_current_week_assignments(uuid, date) from anon;
grant execute on function public.ensure_current_week_assignments(uuid, date) to authenticated;
