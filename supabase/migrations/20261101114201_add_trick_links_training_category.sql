-- Trick Links are two back-to-back tricks stored as one weekly assignment.
-- One completion earns two ordinary points. Existing awards, XP history,
-- permissions and all other category rules remain intact.
begin;

create or replace function private.trick_link_name_valid(p_name text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(
    cardinality(parts) = 2
    and btrim(parts[1]) <> '' and btrim(parts[2]) <> ''
    and char_length(p_name) <= 120
    and char_length(btrim(parts[1]) || ' → ' || btrim(parts[2])) <= 120,
    false
  ) from (select regexp_split_to_array(p_name, '→|->') as parts) split;
$$;

create or replace function private.normalize_trick_link(p_name text)
returns text language plpgsql immutable set search_path = '' as $$
declare v_parts text[];
begin
  if not private.trick_link_name_valid(p_name) then
    raise exception 'Enter two tricks as First trick → Second trick (maximum 120 characters).'
      using errcode = '22023';
  end if;
  v_parts := regexp_split_to_array(p_name, '→|->');
  return btrim(v_parts[1]) || ' → ' || btrim(v_parts[2]);
end;
$$;

revoke all on function private.trick_link_name_valid(text) from public, anon;
revoke all on function private.normalize_trick_link(text) from public, anon;
grant execute on function private.trick_link_name_valid(text) to authenticated, service_role;
grant execute on function private.normalize_trick_link(text) to authenticated, service_role;


alter table public.weekly_trick_assignments drop constraint weekly_trick_assignments_category_check;
alter table public.weekly_trick_assignments add constraint weekly_trick_assignments_category_check check (category in ('daily', 'one_bang', 'dialled', 'percentage', 'foam_pit', 'bonus', 'lines', 'trick_links'));

alter table public.weekly_trick_assignments add constraint weekly_trick_assignments_trick_link_pair_check
  check (category <> 'trick_links' or private.trick_link_name_valid(trick_name));

alter table public.weekly_assignment_plans drop constraint weekly_assignment_plans_category_check;
alter table public.weekly_assignment_plans add constraint weekly_assignment_plans_category_check check (category in ('daily', 'dialled', 'one_bang', 'percentage', 'foam_pit', 'bonus', 'lines', 'trick_links'));

alter table public.weekly_assignment_plans add constraint weekly_assignment_plans_trick_link_pair_check
  check (category <> 'trick_links' or private.trick_link_name_valid(trick_name));

alter table public.trick_requests drop constraint trick_requests_category_check;
alter table public.trick_requests add constraint trick_requests_category_check check (category in ('daily', 'one_bang', 'dialled', 'percentage', 'trick_links'));

alter table public.trick_requests add constraint trick_requests_trick_link_pair_check
  check (category <> 'trick_links' or private.trick_link_name_valid(trick_name));

alter table public.weekly_challenges drop constraint weekly_challenges_category_check;
alter table public.weekly_challenges add constraint weekly_challenges_category_check check (category in ('daily', 'one_bang', 'dialled', 'lines', 'percentage', 'foam_pit', 'bonus', 'trick_links'));

CREATE OR REPLACE FUNCTION public.save_weekly_assignments(p_athlete_id uuid, p_week_start date, p_assignments jsonb, p_venues jsonb DEFAULT NULL::jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Serialize rollover and coach saves for the same rider/week. A second
  -- device rechecks the committed sheet instead of inserting another copy.
  perform pg_advisory_xact_lock(hashtextextended(
    'jkcrew-weekly-list:' || p_athlete_id::text || ':' || p_week_start::text, 0
  ));

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
      case when item->>'category' = 'trick_links'
        then private.normalize_trick_link(item->>'trick_name')
        else left(btrim(item->>'trick_name'), 120) end as trick_name,
      coalesce(nullif(item->>'category', ''), 'daily') as category,
      case when item->>'category' = 'trick_links' then 1
        else greatest(1, least(100, coalesce(nullif(item->>'target_reps', '')::integer, 1))) end as target_reps,
      left(coalesce(item->>'notes', ''), 500) as notes,
      case
        when coalesce(item->>'category', 'daily') = 'daily'
          then left(coalesce(item->>'venue', ''), 80)
        else ''
      end as venue
    from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb)) with ordinality as entries(item, ordinality)
    where item->>'category' = 'trick_links' or btrim(coalesce(item->>'trick_name', '')) <> ''
  ),
  deduped as (
    select distinct on (lower(trick_name), category, lower(coalesce(venue, '')))
      *
    from normalized
    where category in ('daily', 'dialled', 'one_bang', 'percentage', 'foam_pit', 'bonus', 'lines', 'trick_links')
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

  -- Move the existing week out of the destination sort range first. The unique
  -- key includes sort_order, and Postgres checks it row-by-row during updates.
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
$function$
;

CREATE OR REPLACE FUNCTION public.save_weekly_assignment_draft(p_athlete_id uuid, p_target_week_start date, p_assignments jsonb, p_venues jsonb DEFAULT NULL::jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_coach uuid := auth.uid();
  v_count integer := 0;
begin
  if v_coach is null then
    raise exception 'You must be signed in to save a weekly draft.';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = v_coach
      and p.role::text in ('coach', 'admin')
  ) then
    raise exception 'Only coaches can save weekly drafts.';
  end if;

  if not exists (
    select 1
    from public.coach_athletes ca
    where ca.coach_id = v_coach
      and ca.athlete_id = p_athlete_id
  ) then
    raise exception 'This rider is not linked to your coach account.';
  end if;

  if exists (
    select 1
    from public.weekly_assignment_plans plan
    where plan.coach_id = v_coach
      and plan.athlete_id = p_athlete_id
      and plan.target_week_start = p_target_week_start
      and plan.status in ('scheduled_next_week', 'published')
  ) then
    raise exception 'This rider already has a scheduled plan. Use Update Scheduled Plan instead.';
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
    and status in ('draft', 'draft_next_week');

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
      case when item->>'category' = 'trick_links'
        then private.normalize_trick_link(item->>'trick_name')
        else left(btrim(item->>'trick_name'), 120) end as trick_name,
      coalesce(nullif(item->>'category', ''), 'daily') as category,
      case when item->>'category' = 'trick_links' then 1
        else greatest(1, least(100, coalesce(nullif(item->>'target_reps', '')::integer, 1))) end as target_reps,
      left(coalesce(item->>'notes', ''), 500) as notes,
      case
        when coalesce(item->>'category', 'daily') = 'daily'
          then left(coalesce(item->>'venue', ''), 80)
        else ''
      end as venue
    from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb)) with ordinality as entries(item, ordinality)
    where item->>'category' = 'trick_links' or btrim(coalesce(item->>'trick_name', '')) <> ''
  ),
  deduped as (
    select distinct on (lower(trick_name), category, lower(coalesce(venue, '')))
      *
    from normalized
    where category in ('daily', 'dialled', 'one_bang', 'percentage', 'foam_pit', 'bonus', 'trick_links')
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
    'draft_next_week'
  from deduped
  order by ordinality;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_weekly_assignment_plan(p_athlete_id uuid, p_target_week_start date, p_assignments jsonb, p_venues jsonb DEFAULT NULL::jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_coach uuid := auth.uid();
  v_count integer := 0;
  v_target_week_start date := p_target_week_start;
  v_current_week_start date;
  v_local_now timestamp;
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

  select b.week_start_date
  into v_current_week_start
  from public.jkcrew_week_bounds('AU') as b;

  v_local_now := now() at time zone 'Australia/Brisbane';

  if v_target_week_start = (v_current_week_start + 7)
     and extract(dow from v_local_now) = 0 then
    v_target_week_start := v_current_week_start;
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
    and target_week_start = v_target_week_start
    and status in ('draft', 'draft_next_week', 'scheduled_next_week', 'published');

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
      case when item->>'category' = 'trick_links'
        then private.normalize_trick_link(item->>'trick_name')
        else left(btrim(item->>'trick_name'), 120) end as trick_name,
      coalesce(nullif(item->>'category', ''), 'daily') as category,
      case when item->>'category' = 'trick_links' then 1
        else greatest(1, least(100, coalesce(nullif(item->>'target_reps', '')::integer, 1))) end as target_reps,
      left(coalesce(item->>'notes', ''), 500) as notes,
      case
        when coalesce(item->>'category', 'daily') = 'daily'
          then left(coalesce(item->>'venue', ''), 80)
        else ''
      end as venue
    from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb)) with ordinality as entries(item, ordinality)
    where item->>'category' = 'trick_links' or btrim(coalesce(item->>'trick_name', '')) <> ''
  ),
  deduped as (
    select distinct on (lower(trick_name), category, lower(coalesce(venue, '')))
      *
    from normalized
    where category in ('daily', 'dialled', 'one_bang', 'percentage', 'foam_pit', 'bonus', 'trick_links')
    order by lower(trick_name), category, lower(coalesce(venue, '')), ordinality
  )
  select
    v_coach,
    p_athlete_id,
    v_target_week_start,
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
$function$
;

CREATE OR REPLACE FUNCTION public.save_weekly_assignment_list(p_athlete_id uuid, p_week_start date, p_category text, p_venue text DEFAULT ''::text, p_assignments jsonb DEFAULT '[]'::jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_link_names text[] := array[]::text[];
  v_base_order integer := 0;
begin
  if v_coach is null then
    raise exception 'You must be signed in to save a schedule.';
  end if;

  if v_category not in ('daily', 'dialled', 'one_bang', 'percentage', 'foam_pit', 'bonus', 'lines', 'trick_links') then
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

  -- Serialize rollover and coach saves for the same rider/week. A second
  -- device rechecks the committed sheet instead of inserting another copy.
  perform pg_advisory_xact_lock(hashtextextended(
    'jkcrew-weekly-list:' || p_athlete_id::text || ':' || p_week_start::text, 0
  ));

  -- Carry the rest of an untouched sheet before changing this one list.
  -- Rollover never backfills individual categories over a populated sheet
  -- containing the coach's current-week edits.
  if exists (
    select 1 from public.profiles rider
    cross join lateral public.jkcrew_week_bounds(coalesce(rider.country_code, 'AU')) bounds
    where rider.id = p_athlete_id and bounds.week_start_date = p_week_start
  ) then
    perform public.ensure_current_week_assignments(p_athlete_id, p_week_start);
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
    if v_category = 'trick_links' then
      v_trick_name := private.normalize_trick_link(v_item->>'trick_name');
      if lower(v_trick_name) = any(v_link_names) then continue; end if;
      v_link_names := array_append(v_link_names, lower(v_trick_name));
    else
      v_trick_name := left(btrim(coalesce(v_item->>'trick_name', '')), 120);
    end if;
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
$function$
;

CREATE OR REPLACE FUNCTION public.ensure_weekly_assignment_draft(p_athlete_id uuid, p_target_week_start date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_coach uuid := auth.uid();
  v_source_week date;
  v_inserted integer := 0;
begin
  if v_coach is null then
    raise exception 'You must be signed in to prepare a weekly draft.';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = v_coach
      and p.role::text in ('coach', 'admin')
  ) then
    raise exception 'Only coaches can prepare weekly drafts.';
  end if;

  if not exists (
    select 1
    from public.coach_athletes ca
    where ca.coach_id = v_coach
      and ca.athlete_id = p_athlete_id
  ) then
    raise exception 'This rider is not linked to your coach account.';
  end if;

  if exists (
    select 1
    from public.weekly_assignment_plans plan
    where plan.coach_id = v_coach
      and plan.athlete_id = p_athlete_id
      and plan.target_week_start = p_target_week_start
      and plan.status in ('scheduled_next_week', 'published')
  ) then
    return 0;
  end if;

  if exists (
    select 1
    from public.weekly_trick_assignments w
    where w.athlete_id = p_athlete_id
      and w.week_start = (p_target_week_start - 7)
  ) then
    v_source_week := p_target_week_start - 7;
  else
    select max(w.week_start)
    into v_source_week
    from public.weekly_trick_assignments w
    where w.athlete_id = p_athlete_id
      and w.week_start < p_target_week_start;
  end if;

  if v_source_week is null then
    return 0;
  end if;

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
    left(btrim(w.trick_name), 120),
    w.category,
    greatest(1, least(100, coalesce(w.target_reps, 1))),
    left(coalesce(w.notes, ''), 500),
    w.sort_order,
    case when w.category = 'daily' then left(coalesce(w.venue, ''), 80) else '' end,
    'draft_next_week'
  from public.weekly_trick_assignments w
  where w.athlete_id = p_athlete_id
    and w.week_start = v_source_week
    and w.category in ('daily', 'dialled', 'one_bang', 'percentage', 'foam_pit', 'bonus', 'trick_links')
    and btrim(coalesce(w.trick_name, '')) <> ''
    and not exists (
      select 1
      from public.weekly_assignment_plans existing
      where existing.coach_id = v_coach
        and existing.athlete_id = p_athlete_id
        and existing.target_week_start = p_target_week_start
        and existing.status in ('draft', 'draft_next_week')
        and existing.category = w.category
        and lower(btrim(existing.trick_name)) = lower(btrim(w.trick_name))
        and lower(coalesce(existing.venue, '')) = lower(case when w.category = 'daily' then coalesce(w.venue, '') else '' end)
    )
  order by w.sort_order;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.accept_trick_request_into_plan(p_request_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  if v_request.category = 'trick_links' then
    v_request.trick_name := private.normalize_trick_link(v_request.trick_name);
  end if;

  if v_request.status = 'accepted' and v_request.planned_assignment_id is not null then
    return v_request.planned_assignment_id;
  end if;

  if v_request.status = 'declined' then
    raise exception 'This request has already been declined.';
  end if;

  if not exists (
    select 1
    from public.weekly_assignment_plans plan
    where plan.coach_id = v_coach
      and plan.athlete_id = v_request.athlete_id
      and plan.target_week_start = v_request.target_week_start
      and plan.status in ('scheduled_next_week', 'published')
  ) then
    perform public.ensure_weekly_assignment_draft(v_request.athlete_id, v_request.target_week_start);
  end if;

  v_status := case
    when exists (
      select 1
      from public.weekly_assignment_plans plan
      where plan.coach_id = v_coach
        and plan.athlete_id = v_request.athlete_id
        and plan.target_week_start = v_request.target_week_start
        and plan.status in ('scheduled_next_week', 'published')
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
    and plan.status in ('draft', 'draft_next_week', 'scheduled_next_week', 'published')
    and plan.category = v_request.category
    and lower(btrim(plan.trick_name)) = lower(btrim(v_request.trick_name))
    and lower(coalesce(plan.venue, '')) = lower(case when v_request.category = 'daily' then coalesce(v_request.venue, '') else '' end)
  order by case plan.status when 'scheduled_next_week' then 0 when 'published' then 1 when 'draft_next_week' then 2 else 3 end, plan.sort_order
  limit 1;

  if v_plan_id is null then
    select coalesce(max(plan.sort_order) + 1, 0)
    into v_sort_order
    from public.weekly_assignment_plans plan
    where plan.coach_id = v_coach
      and plan.athlete_id = v_request.athlete_id
      and plan.target_week_start = v_request.target_week_start
      and plan.status in ('draft', 'draft_next_week', 'scheduled_next_week', 'published');

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
$function$
;

CREATE OR REPLACE FUNCTION public.rider_sheet_items_are_complete(p_items jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select coalesce(
    pg_catalog.jsonb_typeof(p_items) = 'array'
    and pg_catalog.jsonb_array_length(p_items) = 27 + pg_catalog.count(*) filter (where item->>'category' = 'trick_links')
    and pg_catalog.count(*) filter (where item->>'category' = 'daily') = 10
    and pg_catalog.count(*) filter (where item->>'category' = 'one_bang') = 5
    and pg_catalog.count(*) filter (where item->>'category' = 'dialled') = 5
    and pg_catalog.count(*) filter (where item->>'category' = 'percentage') = 3
    and pg_catalog.count(*) filter (where item->>'category' = 'lines') = 3
    and pg_catalog.count(*) filter (where item->>'category' = 'bonus') = 1
    and pg_catalog.bool_and(
      pg_catalog.jsonb_typeof(item) = 'object'
      and pg_catalog.char_length(pg_catalog.btrim(coalesce(item->>'trick_name', ''))) between 1 and 120
      and item->>'category' in ('daily', 'one_bang', 'dialled', 'percentage', 'lines', 'bonus', 'trick_links')
      and (item->>'category' <> 'trick_links' or private.trick_link_name_valid(item->>'trick_name'))
    ),
    false
  )
  from pg_catalog.jsonb_array_elements(
    case when pg_catalog.jsonb_typeof(p_items) = 'array' then p_items else '[]'::pg_catalog.jsonb end
  ) as entries(item);
$function$
;

CREATE OR REPLACE FUNCTION public.review_edited_rider_sheet_proposal(p_proposal_id uuid, p_title text, p_venue text, p_items jsonb, p_coach_note text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_proposal public.rider_sheet_proposals%rowtype;
  v_title text := coalesce(nullif(pg_catalog.btrim(p_title), ''), 'My weekly lists');
  v_raw_venue text := pg_catalog.btrim(coalesce(p_venue, ''));
  v_venue_identity text;
  v_venue text;
  v_canonical_identity text;
  v_category text;
  v_category_items jsonb;
  v_saved integer;
  v_total_saved integer := 0;
begin
  if v_uid is null then
    raise exception 'Sign in required.';
  end if;

  select proposal.*
  into v_proposal
  from public.rider_sheet_proposals proposal
  where proposal.id = p_proposal_id
  for update;

  if not found then
    raise exception 'Rider sheet proposal not found.';
  end if;
  if v_proposal.status <> 'pending' then
    raise exception 'This rider sheet has already been reviewed.';
  end if;
  if v_proposal.coach_id <> v_uid
    or not exists (
      select 1
      from public.profiles profile
      where profile.id = v_uid
        and profile.role::text in ('coach', 'admin')
    )
    or not exists (
      select 1
      from public.coach_athletes link
      where link.coach_id = v_uid
        and link.athlete_id = v_proposal.athlete_id
    ) then
    raise exception 'You cannot review this rider sheet.';
  end if;

  if pg_catalog.char_length(v_title) > 100 then
    raise exception 'Request name must be 100 characters or fewer.';
  end if;
  if v_raw_venue = '' then
    raise exception 'Add the skate park or location for the 10 Dailys.';
  end if;

  v_venue_identity := pg_catalog.lower(
    pg_catalog.regexp_replace(v_raw_venue, '[^[:alnum:]]+', '', 'g')
  );
  v_venue := case v_venue_identity
    when 'hotbox' then 'HOTBOX - Aus National Training Facility'
    when 'hotboxausnationaltrainingfacility' then 'HOTBOX - Aus National Training Facility'
    when 'beenleighskatepark' then 'Beenleigh'
    when 'beenleigh' then 'Beenleigh'
    else v_raw_venue
  end;
  v_canonical_identity := pg_catalog.lower(
    pg_catalog.regexp_replace(v_venue, '[^[:alnum:]]+', '', 'g')
  );

  if pg_catalog.char_length(v_venue) > 80 then
    raise exception 'Location must be 80 characters or fewer.';
  end if;
  if not public.rider_sheet_items_are_complete(p_items) then
    raise exception 'Finish the exact lists before approving: 10 Dailys, 5 One Bangs, 5 Dialled, 3 Percentage, 3 Lines and 1 Bonus.';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_items) entry(item)
    where pg_catalog.char_length(coalesce(item->>'notes', '')) > 500
  ) then
    raise exception 'Each trick note must be 500 characters or fewer.';
  end if;

  update public.rider_sheet_proposals
  set title = v_title,
      venue = v_venue,
      items = p_items,
      updated_at = pg_catalog.now()
  where id = v_proposal.id;

  insert into private.rider_sheet_replacement_backups (
    proposal_id,
    assignment_id,
    assignment,
    assignment_progress,
    assignment_attempts,
    percentage_attempts,
    assignment_point_awards,
    xp_ledger
  )
  select
    v_proposal.id,
    assignment.id,
    pg_catalog.to_jsonb(assignment),
    coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(progress))
      from public.assignment_progress progress
      where progress.assignment_id = assignment.id
    ), '[]'::jsonb),
    coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(attempt))
      from public.assignment_attempts attempt
      where attempt.assignment_id = assignment.id
    ), '[]'::jsonb),
    coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(attempt))
      from public.percentage_attempts attempt
      where attempt.assignment_id = assignment.id
    ), '[]'::jsonb),
    coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(award))
      from public.assignment_point_awards award
      where award.assignment_id = assignment.id
    ), '[]'::jsonb),
    coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(entry))
      from public.xp_ledger entry
      where entry.assignment_id = assignment.id
    ), '[]'::jsonb)
  from public.weekly_trick_assignments assignment
  where assignment.coach_id = v_uid
    and assignment.athlete_id = v_proposal.athlete_id
    and assignment.week_start = v_proposal.week_start
    and (
      (assignment.category in ('one_bang', 'dialled', 'percentage', 'lines', 'bonus')
        or (assignment.category = 'trick_links' and exists (
          select 1 from pg_catalog.jsonb_array_elements(p_items) incoming(item)
          where incoming.item->>'category' = 'trick_links'
        )))
      or (
        assignment.category = 'daily'
        and pg_catalog.lower(
          pg_catalog.regexp_replace(assignment.venue, '[^[:alnum:]]+', '', 'g')
        ) in (v_venue_identity, v_canonical_identity)
      )
    )
  on conflict (proposal_id, assignment_id) do nothing;

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
    assignment.coach_id,
    assignment.athlete_id,
    assignment.week_start,
    assignment.trick_name,
    assignment.category,
    assignment.target_reps,
    pg_catalog.left(
      pg_catalog.concat_ws(
        E'\n',
        nullif(assignment.notes, ''),
        'Auto backup before rider-request approval'
      ),
      500
    ),
    assignment.sort_order,
    assignment.venue,
    'archived',
    assignment.created_at,
    pg_catalog.now(),
    pg_catalog.now()
  from public.weekly_trick_assignments assignment
  where assignment.coach_id = v_uid
    and assignment.athlete_id = v_proposal.athlete_id
    and assignment.week_start = v_proposal.week_start
    and (
      (assignment.category in ('one_bang', 'dialled', 'percentage', 'lines', 'bonus')
        or (assignment.category = 'trick_links' and exists (
          select 1 from pg_catalog.jsonb_array_elements(p_items) incoming(item)
          where incoming.item->>'category' = 'trick_links'
        )))
      or (
        assignment.category = 'daily'
        and pg_catalog.lower(
          pg_catalog.regexp_replace(assignment.venue, '[^[:alnum:]]+', '', 'g')
        ) in (v_venue_identity, v_canonical_identity)
      )
    );

  update public.weekly_trick_assignments assignment
  set venue = v_venue,
      updated_at = pg_catalog.now()
  where assignment.coach_id = v_uid
    and assignment.athlete_id = v_proposal.athlete_id
    and assignment.week_start = v_proposal.week_start
    and assignment.category = 'daily'
    and pg_catalog.lower(
      pg_catalog.regexp_replace(assignment.venue, '[^[:alnum:]]+', '', 'g')
    ) in (v_venue_identity, v_canonical_identity)
    and assignment.venue <> v_venue;

  -- A Line's notes contain the rest of its run. If those steps changed, it is
  -- a different Line and must not inherit completion from the old sequence.
  delete from public.weekly_trick_assignments assignment
  where assignment.coach_id = v_uid
    and assignment.athlete_id = v_proposal.athlete_id
    and assignment.week_start = v_proposal.week_start
    and assignment.category = 'lines'
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_items) incoming(item)
      where incoming.item->>'category' = 'lines'
        and pg_catalog.lower(pg_catalog.btrim(incoming.item->>'trick_name')) = pg_catalog.lower(pg_catalog.btrim(assignment.trick_name))
        and pg_catalog.lower(pg_catalog.btrim(coalesce(incoming.item->>'notes', ''))) = pg_catalog.lower(pg_catalog.btrim(coalesce(assignment.notes, '')))
    );

  foreach v_category in array array['daily', 'one_bang', 'dialled', 'percentage', 'lines', 'bonus', 'trick_links']
  loop
    select coalesce(pg_catalog.jsonb_agg(incoming.item order by incoming.ordinality), '[]'::jsonb)
    into v_category_items
    from pg_catalog.jsonb_array_elements(p_items) with ordinality as incoming(item, ordinality)
    where incoming.item->>'category' = v_category;

    -- Optional links are an addition; an older 27-item request must not erase
    -- a coach's existing Trick Links list.
    if v_category = 'trick_links' and pg_catalog.jsonb_array_length(v_category_items) = 0 then
      continue;
    end if;

    v_saved := public.save_weekly_assignment_list(
      v_proposal.athlete_id,
      v_proposal.week_start,
      v_category,
      case when v_category = 'daily' then v_venue else '' end,
      v_category_items
    );
    v_total_saved := v_total_saved + v_saved;
  end loop;

  if not exists (
    select 1
    from public.weekly_trick_assignments assignment
    where assignment.coach_id = v_uid
      and assignment.athlete_id = v_proposal.athlete_id
      and assignment.week_start = v_proposal.week_start
    having pg_catalog.count(*) filter (
        where assignment.category = 'daily' and assignment.venue = v_venue
      ) = 10
      and pg_catalog.count(*) filter (where assignment.category = 'one_bang') = 5
      and pg_catalog.count(*) filter (where assignment.category = 'dialled') = 5
      and pg_catalog.count(*) filter (where assignment.category = 'percentage') = 3
      and pg_catalog.count(*) filter (where assignment.category = 'lines') = 3
      and pg_catalog.count(*) filter (where assignment.category = 'bonus') = 1
  ) then
    raise exception 'The corrected lists could not be saved at their exact required counts.';
  end if;

  -- Mark accepted last. The established status trigger now notifies the rider
  -- only after every list and safety snapshot succeeded.
  update public.rider_sheet_proposals
  set status = 'accepted',
      coach_note = pg_catalog.left(coalesce(p_coach_note, ''), 500),
      reviewed_by = v_uid,
      reviewed_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where id = v_proposal.id;

  return pg_catalog.jsonb_build_object(
    'proposal_id', v_proposal.id,
    'status', 'accepted',
    'assignments_added', 0,
    'assignments_updated', v_total_saved,
    'venue', v_venue
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_weekly_challenge(p_title text, p_description text, p_category text, p_target_count integer, p_audience_group text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_user_id uuid := auth.uid(); v_id uuid; v_start timestamptz;
begin
  if not exists (select 1 from public.profiles where id = v_user_id and role in ('coach','admin')) then raise exception 'Only coaches can create weekly challenges'; end if;
  if p_category not in ('daily','one_bang','dialled','lines','percentage','foam_pit','bonus','trick_links') then raise exception 'Choose a valid sheet category'; end if;
  if p_target_count not between 1 and 50 then raise exception 'Choose a target from 1 to 50'; end if;
  v_start := date_trunc('day', timezone('Australia/Brisbane', now())) at time zone 'Australia/Brisbane';
  update public.weekly_challenges set status = 'archived' where status = 'active';
  insert into public.weekly_challenges (title, description, category, target_count, audience_group, starts_at, ends_at, created_by)
  values (trim(p_title), trim(coalesce(p_description,'')), p_category, p_target_count, nullif(trim(coalesce(p_audience_group,'')),''), v_start, v_start + interval '7 days', v_user_id)
  returning id into v_id;
  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_assignment_action(p_assignment_id uuid, p_action text DEFAULT 'landed'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_assignment public.weekly_trick_assignments%rowtype;
  v_actor_role public.user_role;
  v_can_manage boolean := false;
  v_actor_is_athlete boolean := false;
  v_session public.training_sessions%rowtype;
  v_group_session public.coach_group_sessions%rowtype;
  v_progress public.assignment_progress%rowtype;
  v_today date;
  v_points integer := 0;
  v_removed_points integer := 0;
  v_deleted_award record;
  v_message text := '';
  v_award_key text;
  v_daily_venue text := '';
  v_daily_complete_key text := '';
  v_daily_under_20_key text := '';
  v_daily_legacy_key text := '';
  v_all_daily_done boolean := false;
  v_has_live_session boolean := false;
  v_elapsed_seconds integer := 0;
  v_group_pause_seconds integer := 0;
begin
  if v_uid is null then
    raise exception 'Sign in required';
  end if;

  select wta.* into v_assignment
  from public.weekly_trick_assignments wta
  where wta.id = p_assignment_id
    and wta.category in ('daily','dialled','one_bang','foam_pit','bonus','trick_links');
  if not found then
    raise exception 'Assigned trick not found';
  end if;

  if v_assignment.category = 'daily' then
    return public.record_daily_trick_action(p_assignment_id, p_action, '', null);
  end if;

  select p.role into v_actor_role
  from public.profiles p
  where p.id = v_uid;

  v_actor_is_athlete := v_assignment.athlete_id = v_uid;
  v_can_manage := v_actor_is_athlete
    or (
      v_actor_role in ('coach', 'admin')
      and exists (
        select 1
        from public.coach_athletes ca
        where ca.coach_id = v_uid
          and ca.athlete_id = v_assignment.athlete_id
      )
    );

  if not v_can_manage then
    raise exception 'You cannot update this rider''s tricks';
  end if;

  -- Serialize link toggles so rapid retries and an undo cannot interleave.
  if v_assignment.category = 'trick_links' then
    perform 1 from public.weekly_trick_assignments
    where id = v_assignment.id for update;
  end if;

  select b.local_today into v_today
  from public.profiles p
  cross join lateral public.jkcrew_week_bounds(p.country_code) b
  where p.id = v_assignment.athlete_id;

  if v_today is null then
    v_today := (now() at time zone 'Australia/Brisbane')::date;
  end if;

  if p_action not in ('landed', 'unlanded') then
    raise exception 'Unknown action';
  end if;

  v_daily_venue := coalesce(nullif(trim(v_assignment.venue), ''), 'default');
  v_daily_complete_key := 'daily-complete:' || v_daily_venue || ':' || v_today::text;
  v_daily_under_20_key := 'daily-under-20:' || v_daily_venue || ':' || v_today::text;
  v_daily_legacy_key := 'daily:' || v_daily_venue || ':' || v_today::text;

  select ts.* into v_session
  from public.training_sessions ts
  where ts.athlete_id = v_assignment.athlete_id
    and ts.ended_at is null
  order by ts.started_at desc
  limit 1;
  v_has_live_session := found;

  if v_has_live_session then
    select cgs.* into v_group_session
    from public.coach_group_session_participants cgsp
    join public.coach_group_sessions cgs on cgs.id = cgsp.group_session_id
    where cgsp.training_session_id = v_session.id
    order by cgs.started_at desc
    limit 1;

    if found then
      v_group_pause_seconds := coalesce(v_group_session.total_paused_seconds, 0)
        + case
          when v_group_session.status = 'paused' and v_group_session.paused_at is not null
            then greatest(0, extract(epoch from (now() - v_group_session.paused_at))::integer)
          else 0
        end;
      v_elapsed_seconds := greatest(0, extract(epoch from (now() - v_group_session.started_at))::integer - v_group_pause_seconds);
      v_has_live_session := v_group_session.status = 'running';
    else
      v_elapsed_seconds := greatest(0, extract(epoch from (now() - v_session.started_at))::integer);
    end if;
  end if;

  insert into public.assignment_progress (assignment_id, athlete_id)
  values (v_assignment.id, v_assignment.athlete_id)
  on conflict (assignment_id) do nothing;

  if p_action = 'unlanded' then
    if v_assignment.category = 'daily' then
      -- Daily checklist state resets/changes independently from earned score.
      -- Once the full list has awarded daily-complete or under-20 points for a
      -- local date, never remove those earned point awards from an untick.
      v_removed_points := 0;

      update public.assignment_progress ap
      set progress_date = null,
          updated_at = now()
      where ap.assignment_id = v_assignment.id
      returning ap.* into v_progress;

      v_message := 'Daily trick unticked';
    else
      v_award_key := v_assignment.category || ':' || v_assignment.id::text;

      for v_deleted_award in
        delete from public.assignment_point_awards apa
        where apa.athlete_id = v_assignment.athlete_id
          and apa.award_key = v_award_key
        returning apa.points, apa.session_id
      loop
        v_removed_points := v_removed_points + coalesce(v_deleted_award.points, 0);
        if v_assignment.category = 'trick_links' and v_deleted_award.session_id is not null then
          -- Undo the receipt in the session where this pair earned its points,
          -- even when the rider has since opened a different session.
          delete from public.trick_attempts ta
          where ta.id = (
            select latest.id from public.trick_attempts latest
            where latest.session_id = v_deleted_award.session_id
              and latest.athlete_id = v_assignment.athlete_id
              and latest.category = 'trick_links'
              and latest.trick_name = v_assignment.trick_name
            order by latest.created_at desc limit 1
          );
        end if;
        if v_deleted_award.session_id is not null then
          update public.training_sessions ts
          set total_points = greatest(0, coalesce(ts.total_points, 0) - coalesce(v_deleted_award.points, 0))
          where ts.id = v_deleted_award.session_id;
        end if;
      end loop;

      update public.assignment_progress ap
      set completed_at = null,
          streak_count = case when v_assignment.category = 'dialled' then 0 else ap.streak_count end,
          updated_at = now()
      where ap.assignment_id = v_assignment.id
      returning ap.* into v_progress;

      v_message := case
        when v_assignment.category = 'dialled' then 'Dialled trick unticked'
        when v_assignment.category = 'foam_pit' then 'Foam Pit trick unticked'
        when v_assignment.category = 'bonus' then 'Bonus Trick unticked'
        when v_assignment.category = 'trick_links' then 'Trick Link unticked'
        else 'One Bang unticked'
      end;
    end if;

    if v_session.id is not null and v_assignment.category <> 'trick_links' then
      delete from public.trick_attempts ta
      where ta.id in (
        select ta2.id
        from public.trick_attempts ta2
        where ta2.session_id = v_session.id
          and ta2.athlete_id = v_assignment.athlete_id
          and ta2.category = v_assignment.category
          and ta2.trick_name = v_assignment.trick_name
        order by ta2.created_at desc
        limit 1
      );
    end if;

    if v_group_session.id is not null then
      update public.coach_group_session_participants cgsp
      set last_activity_at = now()
      where cgsp.group_session_id = v_group_session.id
        and cgsp.athlete_id = v_assignment.athlete_id;
    end if;

    select ap.* into v_progress
    from public.assignment_progress ap
    where ap.assignment_id = v_assignment.id;

    return jsonb_build_object(
      'assignment_id', v_assignment.id,
      'category', v_assignment.category,
      'venue', v_assignment.venue,
      'progress_date', v_progress.progress_date,
      'streak_count', v_progress.streak_count,
      'completed_at', v_progress.completed_at,
      'points_awarded', 0,
      'points_removed', coalesce(v_removed_points, 0),
      'message', v_message,
      'live_session', v_has_live_session,
      'elapsed_seconds', v_elapsed_seconds
    );
  end if;

  if v_assignment.category = 'daily' then
    update public.assignment_progress ap
    set progress_date = v_today,
        updated_at = now()
    where ap.assignment_id = v_assignment.id
    returning ap.* into v_progress;

    select not exists (
      select 1
      from public.weekly_trick_assignments a
      left join public.assignment_progress ap on ap.assignment_id = a.id
      where a.athlete_id = v_assignment.athlete_id
        and a.week_start = v_assignment.week_start
        and a.category = 'daily'
        and coalesce(nullif(trim(a.venue), ''), 'default') = v_daily_venue
        and ap.progress_date is distinct from v_today
    ) into v_all_daily_done;

    if v_all_daily_done then
      if not exists (
        select 1
        from public.assignment_point_awards apa
        where apa.athlete_id = v_assignment.athlete_id
          and apa.award_key in (v_daily_complete_key, v_daily_legacy_key)
      ) then
        insert into public.assignment_point_awards (athlete_id, session_id, assignment_id, award_key, points)
        values (
          v_assignment.athlete_id,
          case when v_session.id is not null then v_session.id else null end,
          v_assignment.id,
          v_daily_complete_key,
          1
        )
        on conflict (athlete_id, award_key) do nothing;
        if found then
          v_points := v_points + 1;
        end if;
      end if;

      if v_has_live_session and v_elapsed_seconds <= 1200 then
        insert into public.assignment_point_awards (athlete_id, session_id, assignment_id, award_key, points)
        values (v_assignment.athlete_id, v_session.id, v_assignment.id, v_daily_under_20_key, 1)
        on conflict (athlete_id, award_key) do nothing;
        if found then
          v_points := v_points + 1;
        end if;
      end if;

      if v_group_session.id is not null and v_group_session.status = 'running' then
        v_award_key := 'group-first-finish:' || v_group_session.id::text;
        if not exists (
          select 1
          from public.assignment_point_awards apa
          where apa.award_key = v_award_key
        ) then
          insert into public.assignment_point_awards (athlete_id, session_id, assignment_id, award_key, points)
          values (v_assignment.athlete_id, v_session.id, v_assignment.id, v_award_key, 1)
          on conflict (athlete_id, award_key) do nothing;
          if found then
            v_points := v_points + 1;
          end if;
        end if;
      end if;
    end if;

    v_message := case
      when v_points >= 3 then 'Daily Tricks complete, under 20 minutes, and first in the group'
      when v_points = 2 and v_has_live_session and v_elapsed_seconds <= 1200 then 'Daily Tricks complete inside 20 minutes'
      when v_points = 2 then 'Daily Tricks complete plus first finish bonus'
      when v_points = 1 and v_all_daily_done then 'Daily Tricks list complete'
      when v_has_live_session then 'Daily trick ticked'
      else 'Daily progress saved outside a live session'
    end;

  elsif v_assignment.category in ('one_bang', 'trick_links') then
    update public.assignment_progress ap
    set completed_at = coalesce(ap.completed_at, now()),
        updated_at = now()
    where ap.assignment_id = v_assignment.id
    returning ap.* into v_progress;

    v_award_key := v_assignment.category || ':' || v_assignment.id::text;
    insert into public.assignment_point_awards (athlete_id, session_id, assignment_id, award_key, points)
    values (v_assignment.athlete_id, case when v_session.id is not null then v_session.id else null end, v_assignment.id, v_award_key, 2)
    on conflict (athlete_id, award_key) do nothing;
    if found then
      v_points := 2;
    end if;
    v_message := case when v_assignment.category = 'trick_links' then 'Trick Link complete' else 'One Bang complete' end;

  elsif v_assignment.category = 'dialled' then
    update public.assignment_progress ap
    set completed_at = coalesce(ap.completed_at, now()),
        streak_count = 1,
        updated_at = now()
    where ap.assignment_id = v_assignment.id
    returning ap.* into v_progress;

    v_award_key := 'dialled:' || v_assignment.id::text;
    insert into public.assignment_point_awards (athlete_id, session_id, assignment_id, award_key, points)
    values (v_assignment.athlete_id, case when v_session.id is not null then v_session.id else null end, v_assignment.id, v_award_key, 2)
    on conflict (athlete_id, award_key) do nothing;
    if found then
      v_points := 2;
    end if;
    v_message := 'Dialled trick complete';

  elsif v_assignment.category = 'bonus' then
    update public.assignment_progress ap
    set completed_at = coalesce(ap.completed_at, now()),
        updated_at = now()
    where ap.assignment_id = v_assignment.id
    returning ap.* into v_progress;

    v_award_key := 'bonus:' || v_assignment.id::text;
    insert into public.assignment_point_awards (athlete_id, session_id, assignment_id, award_key, points)
    values (v_assignment.athlete_id, case when v_session.id is not null then v_session.id else null end, v_assignment.id, v_award_key, 5)
    on conflict (athlete_id, award_key) do nothing;
    if found then
      v_points := 5;
    end if;
    v_message := 'Bonus Trick complete';

  elsif v_assignment.category = 'foam_pit' then
    update public.assignment_progress ap
    set completed_at = coalesce(ap.completed_at, now()),
        updated_at = now()
    where ap.assignment_id = v_assignment.id
    returning ap.* into v_progress;

    v_points := 0;
    v_message := 'Foam Pit practice ticked';
  end if;

  if v_session.id is not null and (v_assignment.category <> 'trick_links' or v_points > 0) then
    insert into public.trick_attempts (session_id, athlete_id, trick_name, category, status, duration_seconds, points)
    values (v_session.id, v_assignment.athlete_id, v_assignment.trick_name, v_assignment.category, 'landed', v_elapsed_seconds, v_points);

    if v_points > 0 then
      update public.training_sessions ts
      set total_points = coalesce(ts.total_points, 0) + v_points
      where ts.id = v_session.id;
    end if;
  end if;

  if v_group_session.id is not null then
    update public.coach_group_session_participants cgsp
    set last_activity_at = now()
    where cgsp.group_session_id = v_group_session.id
      and cgsp.athlete_id = v_assignment.athlete_id;
  end if;

  select ap.* into v_progress
  from public.assignment_progress ap
  where ap.assignment_id = v_assignment.id;

  return jsonb_build_object(
    'assignment_id', v_assignment.id,
    'category', v_assignment.category,
    'venue', v_assignment.venue,
    'progress_date', v_progress.progress_date,
    'streak_count', v_progress.streak_count,
    'completed_at', v_progress.completed_at,
    'points_awarded', v_points,
    'points_removed', 0,
    'message', v_message,
    'live_session', v_has_live_session,
    'elapsed_seconds', v_elapsed_seconds
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION private.jkcrew_current_park_king(p_venue text)
 RETURNS TABLE(venue_key text, venue_name text, athlete_id uuid, display_name text, avatar jsonb, points integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  with requested as (
    select private.jkcrew_venue_key(p_venue) as venue_key
  ), eligible_sessions as (
    select distinct award.session_id
    from public.assignment_point_awards award
    cross join requested
    where award.session_id is not null
      and requested.venue_key <> ''
      and btrim(award.venue) <> ''
      and private.jkcrew_venue_key(award.venue) = requested.venue_key
  ), session_awards as (
    select
      session.id as session_id,
      session.athlete_id,
      award.created_at,
      award.points,
      split_part(award.award_key, ':', 1) as award_type,
      private.jkcrew_venue_key(award.venue) as venue_key,
      btrim(award.venue) as venue_name,
      (award.created_at at time zone public.jkcrew_country_timezone(profile.country_code))::date as riding_day
    from eligible_sessions eligible
    join public.training_sessions session on session.id = eligible.session_id
    join public.profiles profile on profile.id = session.athlete_id and profile.role = 'athlete'
    join public.assignment_point_awards award
      on award.session_id = session.id
     and award.athlete_id = session.athlete_id
  ), session_day_venues as (
    -- Older Lines awards have no venue. Retain them only if the same session
    -- and day have exactly one known park; never guess across multiple parks.
    select session_id, riding_day,
      count(distinct venue_key) filter (where venue_key <> '') as venue_count,
      max(venue_key) filter (where venue_key <> '') as venue_key,
      max(venue_name) filter (where venue_key <> '') as venue_name
    from session_awards
    group by session_id, riding_day
  ), located_awards as (
    select award.*,
      case when award.venue_key <> '' then award.venue_key
        when locations.venue_count = 1 then locations.venue_key else '' end as resolved_venue_key,
      case when award.venue_key <> '' then award.venue_name
        when locations.venue_count = 1 then locations.venue_name else '' end as resolved_venue_name
    from session_awards award
    join session_day_venues locations using (session_id, riding_day)
  ), daily_completions as (
    -- Retain the existing same-rider/park/day recovery for detached daily
    -- awards, but compare to the award day, never an old session start day.
    -- A legacy under-20 row is completion evidence only: it adds no bonus.
    select award.athlete_id,
      (award.created_at at time zone public.jkcrew_country_timezone(profile.country_code))::date as riding_day,
      min(award.created_at) as completed_at
    from public.assignment_point_awards award
    join public.profiles profile on profile.id = award.athlete_id and profile.role = 'athlete'
    cross join requested
    where requested.venue_key <> ''
      and private.jkcrew_venue_key(award.venue) = requested.venue_key
      and award.points > 0
      and split_part(award.award_key, ':', 1) in ('daily', 'daily-complete', 'daily-under-20')
    group by award.athlete_id,
      (award.created_at at time zone public.jkcrew_country_timezone(profile.country_code))::date
  ), session_day_scores as (
    select award.session_id, award.athlete_id, award.riding_day,
      award.resolved_venue_key as venue_key,
      max(award.resolved_venue_name) as venue_name,
      coalesce(sum(award.points) filter (where award.points > 0 and award.award_type in
        ('dialled', 'one_bang', 'percentage', 'lines', 'bonus', 'trick_links')), 0)::integer as trick_points,
      max(award.created_at) filter (where award.points > 0 and award.award_type in
        ('dialled', 'one_bang', 'percentage', 'lines', 'bonus', 'trick_links')) as tricks_achieved_at,
      min(award.created_at) filter (where award.points > 0 and award.award_type in
        ('daily', 'daily-complete', 'daily-under-20')) as daily_completed_at
    from located_awards award
    cross join requested
    where award.resolved_venue_key = requested.venue_key
      and requested.venue_key <> ''
    group by award.session_id, award.athlete_id, award.riding_day, award.resolved_venue_key
  ), scored_sessions as (
    select scored.venue_key, scored.venue_name, scored.athlete_id,
      (scored.trick_points + case when coalesce(scored.daily_completed_at, daily.completed_at) is not null
        then 1 else 0 end)::integer as points,
      -- Only contributing scores determine when the record was achieved.
      -- First-finish, under-20 bonus points and later unrelated awards cannot
      -- change who won a tied record. Daily completion is capped at one.
      greatest(scored.tricks_achieved_at, least(scored.daily_completed_at, daily.completed_at)) as achieved_at
    from session_day_scores scored
    left join daily_completions daily using (athlete_id, riding_day)
  )
  select scored.venue_key, scored.venue_name, scored.athlete_id,
    coalesce(nullif(btrim(profile.display_name), ''), 'Rider') as display_name,
    coalesce(profile.avatar, '{}'::jsonb) as avatar,
    scored.points
  from scored_sessions scored
  join public.profiles profile on profile.id = scored.athlete_id
  where scored.points > 0
  order by scored.points desc, scored.achieved_at asc,
    coalesce(nullif(btrim(profile.display_name), ''), 'Rider') asc, scored.athlete_id asc
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION private.queue_due_parent_weekly_summaries()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_queued integer := 0;
begin
  with candidates as (
    select
      pa.parent_id,
      pa.athlete_id,
      pa.coach_id,
      athlete.display_name,
      target_bounds.week_start_date,
      target_bounds.week_start_ts,
      target_bounds.next_week_start_ts,
      private.jkcrew_points_for_window(
        pa.athlete_id,
        target_bounds.week_start_ts,
        target_bounds.next_week_start_ts,
        target_bounds.week_start_date
      ) as weekly_points
    from public.parent_athletes pa
    join public.profiles athlete on athlete.id = pa.athlete_id
    left join public.weekly_progress_notification_settings settings on settings.coach_id = pa.coach_id
    cross join lateral public.jkcrew_week_bounds(athlete.country_code, now()) current_bounds
    cross join lateral public.jkcrew_week_bounds(
      athlete.country_code,
      current_bounds.week_start_ts - interval '1 second'
    ) target_bounds
    left join public.push_preferences preference on preference.user_id = pa.parent_id
    where coalesce(settings.enabled, true)
      and coalesce(settings.parent_summaries_enabled, true)
      and coalesce(preference.parent_weekly_summary, true)
      and extract(dow from (now() at time zone coalesce(settings.timezone, 'Australia/Brisbane')))::integer = coalesce(settings.send_day, 0)
      and (now() at time zone coalesce(settings.timezone, 'Australia/Brisbane'))::time >= coalesce(settings.send_time, time '19:30')
      and exists (
        select 1
        from public.push_subscriptions subscription
        where subscription.user_id = pa.parent_id
          and subscription.enabled
      )
  ), completion as (
    select
      candidate.*,
      coalesce(progress.total_items, 0) as total_items,
      coalesce(progress.completed_items, 0) as completed_items,
      case
        when coalesce(progress.total_items, 0) = 0 then 0
        else round((progress.completed_items::numeric / progress.total_items::numeric) * 100)::integer
      end as completion_percent
    from candidates candidate
    left join lateral (
      select
        count(*)::integer as total_items,
        count(*) filter (
          where (
            assignment.category = 'percentage'
            and (
              select count(*)
              from public.percentage_attempts attempt
              where attempt.assignment_id = assignment.id
                and attempt.athlete_id = assignment.athlete_id
            ) >= 10
          ) or (
            assignment.category <> 'percentage'
            and exists (
              select 1
              from public.assignment_progress assignment_done
              where assignment_done.assignment_id = assignment.id
                and assignment_done.athlete_id = assignment.athlete_id
                and assignment_done.completed_at is not null
            )
          )
        )::integer as completed_items
      from public.weekly_trick_assignments assignment
      where assignment.athlete_id = candidate.athlete_id
        and assignment.week_start = candidate.week_start_date
        and assignment.category in ('dialled', 'one_bang', 'foam_pit', 'foam', 'bonus', 'percentage', 'trick_links')
    ) progress on true
  ), recorded as (
    insert into public.weekly_progress_notifications (
      coach_id,
      athlete_id,
      recipient_type,
      recipient_id,
      week_start,
      week_end,
      title,
      summary,
      status,
      stats,
      sent_at
    )
    select
      completion.coach_id,
      completion.athlete_id,
      'parent',
      completion.parent_id,
      completion.week_start_date,
      completion.week_start_date + 6,
      completion.display_name || '''s weekly BMX update',
      completion.display_name || ' earned ' || completion.weekly_points || ' points and completed ' || completion.completion_percent || '% of their weekly BMX program this week.',
      'sent',
      jsonb_build_object(
        'weekly_points', completion.weekly_points,
        'completion_percent', completion.completion_percent,
        'completed_items', completion.completed_items,
        'total_items', completion.total_items
      ),
      now()
    from completion
    on conflict (athlete_id, recipient_type, recipient_id, week_start) do update set
      title = excluded.title,
      summary = excluded.summary,
      status = 'sent',
      stats = excluded.stats,
      sent_at = coalesce(public.weekly_progress_notifications.sent_at, excluded.sent_at)
    returning recipient_id, athlete_id, week_start, title, summary, stats
  )
  insert into public.push_notification_queue (
    recipient_id,
    notification_type,
    title,
    body,
    url,
    payload,
    dedupe_key
  )
  select
    recorded.recipient_id,
    'parent_weekly_summary',
    recorded.title,
    recorded.summary,
    './?push=home',
    recorded.stats || jsonb_build_object('view', 'home', 'athlete_id', recorded.athlete_id),
    'parent-weekly:' || recorded.recipient_id || ':' || recorded.athlete_id || ':' || recorded.week_start
  from recorded
  on conflict (dedupe_key) do nothing;

  get diagnostics v_queued = row_count;
  return v_queued;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.queue_parent_engagement_alerts()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row record;
  v_bounds record;
  v_timezone text;
  v_local_now timestamp;
  v_last_activity timestamptz;
  v_total integer;
  v_completed integer;
  v_remaining integer;
  v_percent integer;
  v_inactive boolean;
  v_low_progress boolean;
  v_title text;
  v_body text;
  v_count integer := 0;
begin
  for v_row in
    select
      link.parent_id,
      link.athlete_id,
      athlete.display_name,
      athlete.country_code,
      athlete.created_at,
      athlete.last_app_opened_at
    from public.parent_athletes link
    join public.profiles athlete
      on athlete.id = link.athlete_id
     and athlete.role = 'athlete'
    join public.profiles parent
      on parent.id = link.parent_id
     and parent.role = 'parent'
    left join public.push_preferences preference
      on preference.user_id = link.parent_id
    where coalesce(preference.sheet_updates, true)
  loop
    v_timezone := coalesce(public.jkcrew_country_timezone(v_row.country_code), 'Australia/Brisbane');
    v_local_now := timezone(v_timezone, now());
    if extract(hour from v_local_now)::integer <> 18 then
      continue;
    end if;

    select * into v_bounds
    from public.jkcrew_week_bounds(v_row.country_code, now())
    limit 1;

    select greatest(
      coalesce(v_row.last_app_opened_at, v_row.created_at),
      coalesce((select max(attempt.attempted_at) from public.assignment_attempts attempt where attempt.athlete_id = v_row.athlete_id), '-infinity'::timestamptz),
      coalesce((select max(progress.updated_at) from public.assignment_progress progress where progress.athlete_id = v_row.athlete_id), '-infinity'::timestamptz),
      coalesce((select max(session.started_at) from public.training_sessions session where session.athlete_id = v_row.athlete_id), '-infinity'::timestamptz),
      coalesce((select max(award.created_at) from public.assignment_point_awards award where award.athlete_id = v_row.athlete_id), '-infinity'::timestamptz)
    ) into v_last_activity;

    select
      count(*)::integer,
      count(*) filter (
        where (
          assignment.category = 'percentage'
          and (select count(*) from public.percentage_attempts attempt where attempt.assignment_id = assignment.id and attempt.athlete_id = assignment.athlete_id) >= 10
        ) or (
          assignment.category <> 'percentage'
          and exists (
            select 1 from public.assignment_progress progress
            where progress.assignment_id = assignment.id
              and progress.athlete_id = assignment.athlete_id
              and progress.completed_at is not null
          )
        )
      )::integer
    into v_total, v_completed
    from public.weekly_trick_assignments assignment
    where assignment.athlete_id = v_row.athlete_id
      and assignment.week_start = v_bounds.week_start_date
      and assignment.category in ('one_bang', 'dialled', 'lines', 'percentage', 'bonus', 'trick_links');

    v_remaining := greatest(0, coalesce(v_total, 0) - coalesce(v_completed, 0));
    v_percent := case when coalesce(v_total, 0) = 0 then 0 else round((v_completed::numeric / v_total::numeric) * 100)::integer end;
    v_inactive := v_last_activity <= now() - interval '4 days';
    v_low_progress := extract(dow from v_local_now)::integer in (4, 5, 6)
      and coalesce(v_total, 0) > 0
      and v_percent < 35
      and v_remaining > 0;

    if not v_inactive and not v_low_progress then
      continue;
    end if;

    v_title := case
      when v_inactive then split_part(v_row.display_name, ' ', 1) || ' may need a gentle check-in'
      else split_part(v_row.display_name, ' ', 1) || '''s weekly sheet needs attention'
    end;
    v_body := case
      when v_inactive and v_low_progress then
        'No JKCREW activity has been recorded for 4 days and ' || v_remaining || ' weekly item' || case when v_remaining = 1 then ' remains.' else 's remain.' end
      when v_inactive then
        'No JKCREW activity has been recorded for 4 days. A little encouragement may help.'
      else
        v_remaining || ' weekly item' || case when v_remaining = 1 then ' remains.' else 's remain.' end || ' A gentle check-in may help.'
    end;

    perform private.emit_jkcrew_notification(
      v_row.parent_id,
      'parent_engagement_checkin',
      v_title,
      v_body,
      'home',
      jsonb_build_object(
        'athlete_id', v_row.athlete_id,
        'week_start', v_bounds.week_start_date,
        'remaining_items', v_remaining,
        'completion_percent', v_percent,
        'last_activity_at', v_last_activity
      ),
      'parent-engagement:' || v_row.parent_id::text || ':' || v_row.athlete_id::text || ':' || v_bounds.week_start_date::text,
      'sheet'
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$
;

commit;
