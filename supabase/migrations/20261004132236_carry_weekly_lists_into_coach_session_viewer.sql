-- Coach Session Viewer must carry unchanged lists into the rider-local week
-- before reading them. Keep new assignment IDs so prior progress/attempts/awards
-- stay in history. Preserve deployed scheduled-plan and save behaviour.
-- No production rider rows are deleted or reset by applying this migration.

CREATE OR REPLACE FUNCTION public.ensure_current_week_assignments(p_athlete_id uuid, p_week_start date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  source_week date;
  inserted_count integer := 0;
  source_status text;
  current_count integer := 0;
  plan_count integer := 0;
  current_matches_plan boolean := false;
  current_has_progress boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not (
    auth.uid() = p_athlete_id
    or exists (select 1 from public.profiles actor where actor.id = auth.uid() and actor.role::text = 'admin')
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

  -- Serialize rollover and coach saves for the same rider/week. A second
  -- device rechecks the committed sheet instead of inserting another copy.
  perform pg_advisory_xact_lock(hashtextextended(
    'jkcrew-weekly-list:' || p_athlete_id::text || ':' || p_week_start::text, 0
  ));

  select count(*)
  into current_count
  from public.weekly_trick_assignments current_week
  where current_week.athlete_id = p_athlete_id
    and current_week.week_start = p_week_start;

  select plan.status
  into source_status
  from public.weekly_assignment_plans plan
  where plan.athlete_id = p_athlete_id
    and plan.target_week_start = p_week_start
    and plan.status in ('scheduled_next_week', 'published')
  group by plan.status
  order by case plan.status when 'scheduled_next_week' then 0 when 'published' then 1 else 2 end
  limit 1;

  if source_status is not null then
    select count(*)
    into plan_count
    from public.weekly_assignment_plans plan
    where plan.athlete_id = p_athlete_id
      and plan.target_week_start = p_week_start
      and plan.status = source_status;

    if plan_count > 0 and current_count > 0 then
      with plan_rows as (
        select
          plan.trick_name,
          plan.category,
          plan.target_reps,
          plan.notes,
          plan.sort_order,
          plan.venue
        from public.weekly_assignment_plans plan
        where plan.athlete_id = p_athlete_id
          and plan.target_week_start = p_week_start
          and plan.status = source_status
      ),
      current_rows as (
        select
          current_week.trick_name,
          current_week.category,
          current_week.target_reps,
          current_week.notes,
          current_week.sort_order,
          current_week.venue
        from public.weekly_trick_assignments current_week
        where current_week.athlete_id = p_athlete_id
          and current_week.week_start = p_week_start
      ),
      diff_rows as (
        (select * from plan_rows except all select * from current_rows)
        union all
        (select * from current_rows except all select * from plan_rows)
      )
      select not exists (select 1 from diff_rows)
      into current_matches_plan;

      if current_matches_plan then
        update public.weekly_assignment_plans plan
        set status = 'archived_previous_week',
            published_at = coalesce(plan.published_at, now()),
            updated_at = now()
        where plan.athlete_id = p_athlete_id
          and plan.target_week_start = p_week_start
          and plan.status = source_status;

        return 0;
      end if;

      select exists (
        select 1
        from public.weekly_trick_assignments current_week
        where current_week.athlete_id = p_athlete_id
          and current_week.week_start = p_week_start
          and (
            exists (
              select 1
              from public.assignment_progress ap
              where ap.assignment_id = current_week.id
                and (
                  ap.completed_at is not null
                  or ap.progress_date is not null
                  or coalesce(ap.streak_count, 0) > 0
                )
            )
            or exists (
              select 1
              from public.percentage_attempts pa
              where pa.assignment_id = current_week.id
            )
            or exists (
              select 1
              from public.assignment_point_awards apa
              where apa.assignment_id = current_week.id
            )
            or exists (
              select 1
              from public.assignment_attempts aa
              where aa.assignment_id = current_week.id
            )
          )
      )
      into current_has_progress;

      if current_has_progress then
        return 0;
      end if;

      delete from public.weekly_trick_assignments current_week
      where current_week.athlete_id = p_athlete_id
        and current_week.week_start = p_week_start;

      current_count := 0;
    end if;

    if plan_count > 0 and current_count = 0 then
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
  end if;

  if current_count > 0 then
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
    and w.week_start = source_week
  order by w.sort_order;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$function$;


CREATE OR REPLACE FUNCTION public.get_coach_session_viewer_plan_data(p_athlete_ids uuid[], p_week_starts date[])
 RETURNS TABLE(id uuid, coach_id uuid, athlete_id uuid, week_start date, trick_name text, category text, target_reps integer, notes text, sort_order integer, created_at timestamp with time zone, updated_at timestamp with time zone, venue text, requested_week_start date, using_fallback boolean, progress jsonb, percentage_attempts jsonb, assignment_attempts jsonb, awards jsonb)
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_request record;
begin
  -- Coach-first viewing must run the same rollover as the rider's Session.
  -- Historical/future views stay read-only; only each rider's current local
  -- week is materialized. Sort lock acquisition to avoid cross-roster deadlocks.
  for v_request in
    select distinct input.athlete_id, input.requested_week_start
    from unnest(p_athlete_ids, p_week_starts) as input(athlete_id, requested_week_start)
    join public.profiles rider on rider.id = input.athlete_id
    cross join lateral public.jkcrew_week_bounds(coalesce(rider.country_code, 'AU')) bounds
    join public.profiles actor on actor.id = auth.uid()
      and actor.role::text in ('coach', 'admin')
    where input.requested_week_start = bounds.week_start_date
      and (actor.role::text = 'admin' or exists (
        select 1 from public.coach_athletes link
        where link.coach_id = auth.uid() and link.athlete_id = input.athlete_id
      ))
    order by input.athlete_id, input.requested_week_start
  loop
    perform public.ensure_current_week_assignments(v_request.athlete_id, v_request.requested_week_start);
  end loop;

  return query
  with viewer as (
    select profile.role::text as role
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.role::text in ('coach', 'admin')
  ),
  requested as (
    select distinct input.athlete_id, input.requested_week_start
    from unnest(p_athlete_ids, p_week_starts) as input(athlete_id, requested_week_start)
    where input.athlete_id is not null
      and input.requested_week_start is not null
  ),
  allowed as (
    select requested.athlete_id, requested.requested_week_start
    from requested
    cross join viewer
    where viewer.role = 'admin'
       or exists (
         select 1
         from public.coach_athletes link
         where link.coach_id = auth.uid()
           and link.athlete_id = requested.athlete_id
       )
  ),
  daily_lists as (
    select
      assignment.athlete_id,
      allowed.requested_week_start,
      private.jkcrew_venue_key(assignment.venue) as venue_key,
      lower(regexp_replace(btrim(assignment.venue), '[^[:alnum:]]+', '', 'g')) as source_venue_key,
      assignment.week_start,
      max(assignment.updated_at) as saved_at,
      max(assignment.created_at) as created_at,
      max(assignment.sort_order) as last_sort_order
    from allowed
    join public.weekly_trick_assignments assignment
      on assignment.athlete_id = allowed.athlete_id
     and assignment.category = 'daily'
     and assignment.week_start <= allowed.requested_week_start
    group by
      assignment.athlete_id,
      allowed.requested_week_start,
      private.jkcrew_venue_key(assignment.venue),
      lower(regexp_replace(btrim(assignment.venue), '[^[:alnum:]]+', '', 'g')),
      assignment.week_start
  ),
  latest_daily_lists as (
    select distinct on (daily_lists.athlete_id, daily_lists.requested_week_start, daily_lists.venue_key)
      daily_lists.athlete_id,
      daily_lists.requested_week_start,
      daily_lists.venue_key,
      daily_lists.source_venue_key,
      daily_lists.week_start as source_week_start
    from daily_lists
    order by
      daily_lists.athlete_id,
      daily_lists.requested_week_start,
      daily_lists.venue_key,
      daily_lists.saved_at desc,
      daily_lists.created_at desc,
      daily_lists.week_start desc,
      daily_lists.last_sort_order desc,
      daily_lists.source_venue_key desc
  ),
  selected as (
    select
      assignment.*,
      allowed.requested_week_start,
      false as using_fallback
    from allowed
    join public.weekly_trick_assignments assignment
      on assignment.athlete_id = allowed.athlete_id
     and assignment.week_start = allowed.requested_week_start
     and assignment.category <> 'daily'

    union all

    select
      assignment.*,
      latest.requested_week_start,
      assignment.week_start <> latest.requested_week_start as using_fallback
    from latest_daily_lists latest
    join public.weekly_trick_assignments assignment
      on assignment.athlete_id = latest.athlete_id
     and assignment.category = 'daily'
     and assignment.week_start = latest.source_week_start
     and private.jkcrew_venue_key(assignment.venue) = latest.venue_key
     and lower(regexp_replace(btrim(assignment.venue), '[^[:alnum:]]+', '', 'g')) = latest.source_venue_key
  )
  select
    selected.id,
    selected.coach_id,
    selected.athlete_id,
    selected.week_start,
    selected.trick_name,
    selected.category,
    selected.target_reps,
    selected.notes,
    selected.sort_order,
    selected.created_at,
    selected.updated_at,
    selected.venue,
    selected.requested_week_start,
    selected.using_fallback,
    to_jsonb(progress_row) as progress,
    coalesce((
      select jsonb_agg(to_jsonb(percentage_row) order by percentage_row.attempt_number)
      from public.percentage_attempts percentage_row
      where percentage_row.assignment_id = selected.id
    ), '[]'::jsonb) as percentage_attempts,
    coalesce((
      select jsonb_agg(to_jsonb(attempt_row) order by attempt_row.attempted_at desc)
      from public.assignment_attempts attempt_row
      where attempt_row.assignment_id = selected.id
        and attempt_row.week_start = selected.requested_week_start
    ), '[]'::jsonb) as assignment_attempts,
    coalesce((
      select jsonb_agg(to_jsonb(award_row) order by award_row.created_at desc)
      from public.assignment_point_awards award_row
      where award_row.assignment_id = selected.id
        and award_row.created_at >= now() - interval '8 days'
    ), '[]'::jsonb) as awards
  from selected
  left join public.assignment_progress progress_row
    on progress_row.assignment_id = selected.id
  order by selected.athlete_id, selected.sort_order, selected.id;
end;
$function$;


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
  v_base_order integer := 0;
begin
  if v_coach is null then
    raise exception 'You must be signed in to save a schedule.';
  end if;

  if v_category not in ('daily', 'dialled', 'one_bang', 'percentage', 'foam_pit', 'bonus', 'lines') then
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
    where category in ('daily', 'dialled', 'one_bang', 'percentage', 'foam_pit', 'bonus', 'lines')
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
$function$;

revoke all on function public.ensure_current_week_assignments(uuid, date) from public, anon;
grant execute on function public.ensure_current_week_assignments(uuid, date) to authenticated;
revoke all on function public.get_coach_session_viewer_plan_data(uuid[], date[]) from public, anon;
grant execute on function public.get_coach_session_viewer_plan_data(uuid[], date[]) to authenticated;
revoke all on function public.save_weekly_assignment_list(uuid, date, text, text, jsonb) from public, anon;
grant execute on function public.save_weekly_assignment_list(uuid, date, text, text, jsonb) to authenticated;
revoke all on function public.save_weekly_assignments(uuid, date, jsonb, jsonb) from public, anon;
grant execute on function public.save_weekly_assignments(uuid, date, jsonb, jsonb) to authenticated;

comment on function public.get_coach_session_viewer_plan_data(uuid[], date[]) is
'Linked coach/admin Session Viewer: materializes unchanged lists for the current rider-local week before returning fresh progress; historical/future reads never roll forward.';
notify pgrst, 'reload schema';
