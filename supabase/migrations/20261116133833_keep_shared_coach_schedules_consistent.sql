-- Collaborators edit one rider schedule rather than creating parallel copies.
-- Resource/approval wrappers remain unchanged and all edits keep the rider/week lock.
-- Deleting an admitted family account keeps its invitation permanently spent.
alter table private.coach_team_invites drop constraint coach_team_invites_consumed_by_fkey;
alter table private.coach_team_invites add constraint coach_team_invites_consumed_by_fkey
foreign key(consumed_by) references public.profiles(id) on delete set null;

CREATE OR REPLACE FUNCTION private.approved_68077b424824703f5ee1c3bb(p_athlete_id uuid, p_week_start date, p_assignments jsonb, p_venues jsonb DEFAULT NULL::jsonb)
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
  where private.jkcrew_profiles_share_team(coach_id,v_coach)
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
    where category in ('daily', 'dialled', 'one_bang', 'percentage', 'foam_pit', 'bonus', 'lines', 'trick_links', 'other')
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
    where private.jkcrew_profiles_share_team(coach_id,v_coach);

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
    where private.jkcrew_profiles_share_team(current_row.coach_id,v_coach)
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
    where private.jkcrew_profiles_share_team(current_row.coach_id,v_coach)
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
    where private.jkcrew_profiles_share_team(current_row.coach_id,v_coach)
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
  where private.jkcrew_profiles_share_team(current_row.coach_id,v_coach)
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

CREATE OR REPLACE FUNCTION private.approved_f24ef0e431ed758cd240280e(p_athlete_id uuid, p_target_week_start date, p_assignments jsonb, p_venues jsonb DEFAULT NULL::jsonb)
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

  perform pg_advisory_xact_lock(hashtextextended('jkcrew-weekly-list:'||p_athlete_id::text||':'||v_target_week_start::text,0));

  if p_venues is not null then
    delete from public.coach_venues
    where private.jkcrew_profiles_share_team(coach_id,v_coach);

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
  where private.jkcrew_profiles_share_team(coach_id,v_coach)
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
$function$;

CREATE OR REPLACE FUNCTION private.approved_10201c0e07885f3cc9b19a40(p_athlete_id uuid, p_target_week_start date, p_assignments jsonb, p_venues jsonb DEFAULT NULL::jsonb)
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

  perform pg_advisory_xact_lock(hashtextextended('jkcrew-weekly-list:'||p_athlete_id::text||':'||p_target_week_start::text,0));

  if exists (
    select 1
    from public.weekly_assignment_plans plan
    where private.jkcrew_profiles_share_team(plan.coach_id,v_coach)
      and plan.athlete_id = p_athlete_id
      and plan.target_week_start = p_target_week_start
      and plan.status in ('scheduled_next_week', 'published')
  ) then
    raise exception 'This rider already has a scheduled plan. Use Update Scheduled Plan instead.';
  end if;

  if p_venues is not null then
    delete from public.coach_venues
    where private.jkcrew_profiles_share_team(coach_id,v_coach);

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
  where private.jkcrew_profiles_share_team(coach_id,v_coach)
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
$function$;

CREATE OR REPLACE FUNCTION private.approved_fa3589edda720f475175da2b(p_athlete_id uuid, p_target_week_start date)
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

  perform pg_advisory_xact_lock(hashtextextended('jkcrew-weekly-list:'||p_athlete_id::text||':'||p_target_week_start::text,0));

  if exists (
    select 1
    from public.weekly_assignment_plans plan
    where private.jkcrew_profiles_share_team(plan.coach_id,v_coach)
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
      where private.jkcrew_profiles_share_team(existing.coach_id,v_coach)
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
$function$;

CREATE OR REPLACE FUNCTION private.approved_85079e7d62a4c2fba7e0021e(p_athlete_id uuid, p_week_start date, p_assignments jsonb DEFAULT '[]'::jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_coach uuid:=auth.uid(); v_item jsonb; v_name text; v_notes text; v_existing_id uuid; v_used_ids uuid[]:=array[]::uuid[]; v_index integer:=0; v_base_order integer:=0;
begin
 if v_coach is null then raise exception 'You must be signed in to save Lines.'; end if;
 if not exists(select 1 from public.profiles p where p.id=v_coach and p.role::text in ('coach','admin')) then raise exception 'Only coaches can save rider Lines.'; end if;
 if not exists(select 1 from public.coach_athletes ca where ca.coach_id=v_coach and ca.athlete_id=p_athlete_id) then raise exception 'This rider is not linked to your coach account.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('jkcrew-weekly-list:'||p_athlete_id::text||':'||p_week_start::text,0));
 with target_rows as (select wta.id,row_number() over(order by wta.sort_order,wta.id) row_number from public.weekly_trick_assignments wta where private.jkcrew_profiles_share_team(wta.coach_id,v_coach) and wta.athlete_id=p_athlete_id and wta.week_start=p_week_start and wta.category='lines')
 update public.weekly_trick_assignments wta set sort_order=-300000000-target_rows.row_number,updated_at=now() from target_rows where wta.id=target_rows.id;
 select coalesce(max(sort_order)+1,0) into v_base_order from public.weekly_trick_assignments where private.jkcrew_profiles_share_team(coach_id,v_coach) and athlete_id=p_athlete_id and week_start=p_week_start and sort_order>=0;
 for v_item in select value from jsonb_array_elements(coalesce(p_assignments,'[]'::jsonb)) loop
  v_existing_id:=null; v_name:=left(btrim(coalesce(v_item->>'trick_name','')),120); if v_name='' then continue; end if; v_notes:=left(coalesce(v_item->>'notes',''),500);
  select id into v_existing_id from public.weekly_trick_assignments where private.jkcrew_profiles_share_team(coach_id,v_coach) and athlete_id=p_athlete_id and week_start=p_week_start and category='lines' and lower(btrim(trick_name))=lower(v_name) and not(id=any(v_used_ids)) order by sort_order limit 1;
  if v_existing_id is null then
   insert into public.weekly_trick_assignments(coach_id,athlete_id,week_start,trick_name,category,target_reps,notes,sort_order,venue)
   values(v_coach,p_athlete_id,p_week_start,v_name,'lines',1,v_notes,v_base_order+v_index,'') returning id into v_existing_id;
  else
   update public.weekly_trick_assignments set trick_name=v_name,notes=v_notes,target_reps=1,sort_order=v_base_order+v_index,venue='',updated_at=now() where id=v_existing_id;
  end if;
  v_used_ids:=array_append(v_used_ids,v_existing_id); v_index:=v_index+1;
 end loop;
 delete from public.weekly_trick_assignments where private.jkcrew_profiles_share_team(coach_id,v_coach) and athlete_id=p_athlete_id and week_start=p_week_start and category='lines' and not(id=any(v_used_ids));
 return coalesce(array_length(v_used_ids,1),0);
end; $function$;

-- One team catalogue prevents colleague classifications from conflicting.
create function private.jkcrew_team_catalog_coach(p_actor uuid)
returns uuid language plpgsql stable security definer set search_path='' as $$
declare result uuid;
begin
 if p_actor is distinct from auth.uid() or not private.jkcrew_is_team_coach(p_actor) then raise exception 'Approved team coach required.' using errcode='42501'; end if;
 select head.coach_id into result from private.coach_team_memberships actor
 join private.coach_team_memberships head on head.team_id=actor.team_id and head.status='active' and head.role='head_coach'
 where actor.coach_id=p_actor and actor.status='active' order by head.joined_at limit 1;
 return coalesce(result,p_actor);
end $$;
revoke all on function private.jkcrew_team_catalog_coach(uuid) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION private.read_tricktionary_catalog(p_athlete_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := auth.uid();
  v_role text := private.tricktionary_automation_role();
  v_athlete uuid := coalesce(p_athlete_id, v_user);
  v_result jsonb;
begin
  if v_role in ('coach','admin') then
    if p_athlete_id is not null and v_role <> 'admin' and not exists (
      select 1 from public.coach_athletes where coach_id = v_user and athlete_id = p_athlete_id
    ) then raise exception 'Choose a rider in your crew.' using errcode = '42501'; end if;
  elsif not (
    (v_role = 'athlete' and v_athlete = v_user)
    or (v_role = 'parent' and exists (
      select 1 from public.parent_athletes where parent_id = v_user and athlete_id = v_athlete
    ))
  ) then raise exception 'You cannot view this rider''s catalog.' using errcode = '42501'; end if;

  with visible as (
    select catalog.* from private.tricktionary_catalog catalog
    where (v_role in ('coach','admin') and private.jkcrew_profiles_share_team(catalog.coach_id,v_user))
      or (v_role in ('athlete','parent') and exists (
        select 1 from public.coach_athletes link join public.profiles coach on coach.id = link.coach_id
        where link.athlete_id = v_athlete and link.coach_id = catalog.coach_id and coach.role::text in ('coach','admin')
      ))
  ), agreed as (
    -- Conflicting coaches do not silently reclassify a rider's trick.
    select source_key from visible group by source_key
    having count(distinct jsonb_build_array(category, subcategory)) = 1
  ), entries as (
    select distinct on (source_key) source_key, display_title as title, category, subcategory
    from visible join agreed using (source_key)
    order by source_key, updated_at desc, coach_id
    limit 2000
  )
  select coalesce(jsonb_agg(to_jsonb(entries) order by source_key), '[]'::jsonb) into v_result from entries;
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION private.save_tricktionary_catalog_entry(p_source_key text, p_title text, p_category text, p_subcategory text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := auth.uid();
  v_role text := private.tricktionary_automation_role();
  v_key text := lower(btrim(regexp_replace(coalesce(p_source_key, ''), '[[:space:]]+', ' ', 'g')));
  v_title text := btrim(regexp_replace(coalesce(p_title, ''), '[[:space:]]+', ' ', 'g'));
  v_category text := lower(btrim(coalesce(p_category, '')));
  v_subcategory text := case when p_subcategory is null then null else lower(btrim(p_subcategory)) end;
begin
  if v_role not in ('coach','admin') then
    raise exception 'Only coaches can approve shared Tricktionary entries.' using errcode = '42501';
  end if;
  v_user:=private.jkcrew_team_catalog_coach(v_user);
  if char_length(v_key) not between 1 and 120 or char_length(v_title) not between 1 and 120 then
    raise exception 'Trick names must be between 1 and 120 characters.' using errcode = '22023';
  end if;
  if private.tricktionary_subcategory_is_valid(v_category, v_subcategory) is not true then
    raise exception 'Choose a valid Tricktionary location.' using errcode = '22023';
  end if;
  -- Serialize the size check and writes to this coach's catalog, including retries.
  perform 1 from public.profiles where id = v_user for update;
  if not exists (select 1 from private.tricktionary_catalog where coach_id = v_user and source_key = v_key)
     and (select count(*) from private.tricktionary_catalog where coach_id = v_user) >= 2000 then
    raise exception 'The shared catalog is full. Remove an unused entry first.' using errcode = '22023';
  end if;
  insert into private.tricktionary_catalog(coach_id, source_key, display_title, category, subcategory)
  values(v_user, v_key, v_title, v_category, v_subcategory)
  on conflict (coach_id, source_key) do update
    set display_title = excluded.display_title, category = excluded.category,
      subcategory = excluded.subcategory, updated_at = now()
    where (tricktionary_catalog.display_title, tricktionary_catalog.category, tricktionary_catalog.subcategory)
      is distinct from (excluded.display_title, excluded.category, excluded.subcategory);
  return jsonb_build_object('source_key', v_key, 'title', v_title, 'category', v_category, 'subcategory', v_subcategory);
end;
$function$;

CREATE OR REPLACE FUNCTION private.delete_tricktionary_catalog_entry(p_source_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := auth.uid();
  v_role text := private.tricktionary_automation_role();
  v_key text := lower(btrim(regexp_replace(coalesce(p_source_key, ''), '[[:space:]]+', ' ', 'g')));
begin
  if v_role not in ('coach','admin') then
    raise exception 'Only coaches can remove shared Tricktionary entries.' using errcode = '42501';
  end if;
  v_user:=private.jkcrew_team_catalog_coach(v_user);
  if char_length(v_key) not between 1 and 120 then
    raise exception 'Choose a valid trick name.' using errcode = '22023';
  end if;
  delete from private.tricktionary_catalog where coach_id = v_user and source_key = v_key;
  return found;
end;
$function$;

notify pgrst,'reload schema';

