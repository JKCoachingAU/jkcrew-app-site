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
