create or replace function public.save_weekly_assignments(
  p_athlete_id uuid,
  p_week_start date,
  p_assignments jsonb,
  p_venues jsonb default null::jsonb
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_coach uuid := auth.uid();
  v_count integer := 0;
  v_existing_count integer := 0;
  v_incoming_count integer := 0;
  v_existing_daily_venues integer := 0;
  v_incoming_daily_venues integer := 0;
  v_existing_non_daily_categories integer := 0;
  v_incoming_non_daily_categories integer := 0;
begin
  if v_coach is null then
    raise exception 'You must be signed in to save a schedule.';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = v_coach
      and p.role::text in ('coach', 'admin')
  ) then
    raise exception 'Only coaches can save rider schedules.';
  end if;

  if not exists (
    select 1
    from public.coach_athletes ca
    where ca.coach_id = v_coach
      and ca.athlete_id = p_athlete_id
  ) then
    raise exception 'This rider is not linked to your coach account.';
  end if;

  select
    count(*),
    count(distinct lower(coalesce(nullif(venue, ''), '(none)'))) filter (where category = 'daily'),
    count(distinct category) filter (where category <> 'daily')
  into v_existing_count, v_existing_daily_venues, v_existing_non_daily_categories
  from public.weekly_trick_assignments
  where coach_id = v_coach
    and athlete_id = p_athlete_id
    and week_start = p_week_start;

  drop table if exists pg_temp._jkcrew_incoming_weekly_assignments;

  create temp table _jkcrew_incoming_weekly_assignments on commit drop as
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
    row_number() over (order by ordinality) - 1 as sort_order,
    trick_name,
    category,
    target_reps,
    notes,
    venue,
    lower(btrim(trick_name)) as trick_key,
    lower(coalesce(venue, '')) as venue_key
  from deduped
  order by ordinality;

  select
    count(*),
    count(distinct lower(coalesce(nullif(venue, ''), '(none)'))) filter (where category = 'daily'),
    count(distinct category) filter (where category <> 'daily')
  into v_incoming_count, v_incoming_daily_venues, v_incoming_non_daily_categories
  from _jkcrew_incoming_weekly_assignments;

  if v_existing_count >= 20
     and v_incoming_count > 0
     and v_incoming_count < v_existing_count
     and (
       v_incoming_count < ceiling(v_existing_count * 0.70)::integer
       or v_incoming_daily_venues < v_existing_daily_venues
       or v_incoming_non_daily_categories < v_existing_non_daily_categories
     ) then
    raise exception 'This save looks like it only contains part of the weekly schedule. Open the full schedule or use the single-list editor so the rest of the rider schedule is not removed.';
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

  if v_existing_count > 0 then
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
      status,
      created_at,
      updated_at,
      published_at
    )
    select
      current_row.coach_id,
      current_row.athlete_id,
      current_row.week_start,
      current_row.trick_name,
      current_row.category,
      current_row.target_reps,
      left(
        concat_ws(
          E'\n',
          nullif(current_row.notes, ''),
          'Auto backup before complete schedule save'
        ),
        500
      ),
      current_row.sort_order,
      current_row.venue,
      'archived',
      current_row.created_at,
      now(),
      now()
    from public.weekly_trick_assignments current_row
    where current_row.coach_id = v_coach
      and current_row.athlete_id = p_athlete_id
      and current_row.week_start = p_week_start;
  end if;

  drop table if exists pg_temp._jkcrew_matched_weekly_assignments;

  create temp table _jkcrew_matched_weekly_assignments on commit drop as
  select
    incoming.*,
    existing.id as assignment_id
  from _jkcrew_incoming_weekly_assignments incoming
  left join lateral (
    select current_row.id
    from public.weekly_trick_assignments current_row
    where current_row.coach_id = v_coach
      and current_row.athlete_id = p_athlete_id
      and current_row.week_start = p_week_start
      and lower(btrim(current_row.trick_name)) = incoming.trick_key
      and current_row.category = incoming.category
      and lower(coalesce(current_row.venue, '')) = incoming.venue_key
    order by current_row.sort_order, current_row.id
    limit 1
  ) existing on true;

  -- Avoid immediate unique-key collisions while reordering a full weekly sheet.
  with displaced as (
    select
      current_row.id,
      row_number() over (order by current_row.sort_order, current_row.id) as row_number
    from public.weekly_trick_assignments current_row
    where current_row.coach_id = v_coach
      and current_row.athlete_id = p_athlete_id
      and current_row.week_start = p_week_start
  )
  update public.weekly_trick_assignments current_row
  set sort_order = -100000000 - displaced.row_number,
      updated_at = now()
  from displaced
  where current_row.id = displaced.id;

  update public.weekly_trick_assignments current_row
  set
    trick_name = matched.trick_name,
    target_reps = matched.target_reps,
    notes = matched.notes,
    sort_order = matched.sort_order,
    venue = matched.venue,
    updated_at = now()
  from _jkcrew_matched_weekly_assignments matched
  where current_row.id = matched.assignment_id;

  insert into public.weekly_trick_assignments (
    coach_id,
    athlete_id,
    week_start,
    trick_name,
    category,
    target_reps,
    notes,
    sort_order,
    venue
  )
  select
    v_coach,
    p_athlete_id,
    p_week_start,
    matched.trick_name,
    matched.category,
    matched.target_reps,
    matched.notes,
    matched.sort_order,
    matched.venue
  from _jkcrew_matched_weekly_assignments matched
  where matched.assignment_id is null;

  delete from public.weekly_trick_assignments current_row
  where current_row.coach_id = v_coach
    and current_row.athlete_id = p_athlete_id
    and current_row.week_start = p_week_start
    and not exists (
      select 1
      from _jkcrew_matched_weekly_assignments matched
      where matched.assignment_id = current_row.id
    )
    and not exists (
      select 1
      from _jkcrew_incoming_weekly_assignments incoming
      where lower(btrim(current_row.trick_name)) = incoming.trick_key
        and current_row.category = incoming.category
        and lower(coalesce(current_row.venue, '')) = incoming.venue_key
    );

  select count(*) into v_count
  from _jkcrew_incoming_weekly_assignments;

  return v_count;
end;
$function$;

create or replace function public.save_weekly_assignment_list(
  p_athlete_id uuid,
  p_week_start date,
  p_category text,
  p_venue text default ''::text,
  p_assignments jsonb default '[]'::jsonb
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_coach uuid := auth.uid();
  v_category text := lower(btrim(coalesce(p_category, '')));
  v_venue text := left(btrim(coalesce(p_venue, '')), 80);
  v_count integer := 0;
  v_index integer := 0;
  v_item jsonb;
  v_trick_name text;
  v_notes text;
  v_target_reps integer;
  v_existing_id uuid;
  v_used_ids uuid[] := array[]::uuid[];
  v_base_order integer := 0;
begin
  if v_coach is null then
    raise exception 'You must be signed in to save a schedule.';
  end if;

  if v_category not in ('daily', 'dialled', 'one_bang', 'percentage', 'foam_pit', 'bonus') then
    raise exception 'Unsupported trick list category.';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = v_coach
      and p.role::text in ('coach', 'admin')
  ) then
    raise exception 'Only coaches can save rider schedules.';
  end if;

  if not exists (
    select 1
    from public.coach_athletes ca
    where ca.coach_id = v_coach
      and ca.athlete_id = p_athlete_id
  ) then
    raise exception 'This rider is not linked to your coach account.';
  end if;

  with target_rows as (
    select
      wta.id,
      row_number() over (order by wta.sort_order, wta.id) as row_number
    from public.weekly_trick_assignments wta
    where wta.coach_id = v_coach
      and wta.athlete_id = p_athlete_id
      and wta.week_start = p_week_start
      and wta.category = v_category
      and (
        v_category <> 'daily'
        or btrim(coalesce(wta.venue, '')) = v_venue
      )
  )
  update public.weekly_trick_assignments wta
  set sort_order = -200000000 - target_rows.row_number,
      updated_at = now()
  from target_rows
  where wta.id = target_rows.id;

  select coalesce(max(wta.sort_order) + 1, 0) into v_base_order
  from public.weekly_trick_assignments wta
  where wta.coach_id = v_coach
    and wta.athlete_id = p_athlete_id
    and wta.week_start = p_week_start
    and wta.sort_order >= 0;

  for v_item in
    select value
    from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb))
  loop
    v_existing_id := null;
    v_trick_name := left(btrim(coalesce(v_item->>'trick_name', '')), 120);
    if v_trick_name = '' then
      continue;
    end if;

    v_notes := left(coalesce(v_item->>'notes', ''), 500);
    v_target_reps := case
      when v_category = 'dialled' then 3
      when v_category = 'percentage' then 10
      else 1
    end;

    select wta.id into v_existing_id
    from public.weekly_trick_assignments wta
    where wta.coach_id = v_coach
      and wta.athlete_id = p_athlete_id
      and wta.week_start = p_week_start
      and wta.category = v_category
      and (
        v_category <> 'daily'
        or btrim(coalesce(wta.venue, '')) = v_venue
      )
      and lower(btrim(wta.trick_name)) = lower(v_trick_name)
      and not (wta.id = any(v_used_ids))
    order by wta.sort_order
    limit 1;

    if v_existing_id is null then
      insert into public.weekly_trick_assignments (
        coach_id,
        athlete_id,
        week_start,
        trick_name,
        category,
        target_reps,
        notes,
        sort_order,
        venue
      )
      values (
        v_coach,
        p_athlete_id,
        p_week_start,
        v_trick_name,
        v_category,
        v_target_reps,
        v_notes,
        v_base_order + v_index,
        case when v_category = 'daily' then v_venue else '' end
      )
      returning id into v_existing_id;
    else
      update public.weekly_trick_assignments wta
      set trick_name = v_trick_name,
          target_reps = v_target_reps,
          notes = v_notes,
          sort_order = v_base_order + v_index,
          venue = case when v_category = 'daily' then v_venue else '' end,
          updated_at = now()
      where wta.id = v_existing_id;
    end if;

    v_used_ids := array_append(v_used_ids, v_existing_id);
    v_index := v_index + 1;
  end loop;

  delete from public.weekly_trick_assignments wta
  where wta.coach_id = v_coach
    and wta.athlete_id = p_athlete_id
    and wta.week_start = p_week_start
    and wta.category = v_category
    and (
      v_category <> 'daily'
      or btrim(coalesce(wta.venue, '')) = v_venue
    )
    and not (wta.id = any(v_used_ids));

  v_count := coalesce(array_length(v_used_ids, 1), 0);
  return v_count;
end;
$function$;
