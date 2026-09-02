-- A complete rider request represents the requested weekly lists, not extra
-- assignments to append. Replace only the six requestable lists, preserving
-- Foam, Dailys at other locations, and progress for unchanged tricks.

create or replace function public.review_edited_rider_sheet_proposal(
  p_proposal_id uuid,
  p_title text,
  p_venue text,
  p_items jsonb,
  p_coach_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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
  v_result jsonb;
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

  -- Match the existing app's complete-sheet save safety: retain a readable
  -- archive of the lists that this approval is about to replace.
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
      assignment.category in ('one_bang', 'dialled', 'percentage', 'lines', 'bonus')
      or (
        assignment.category = 'daily'
        and pg_catalog.lower(
          pg_catalog.regexp_replace(assignment.venue, '[^[:alnum:]]+', '', 'g')
        ) in (v_venue_identity, v_canonical_identity)
      )
    );

  -- Fold case/punctuation variants and the retired Hotbox/Beenleigh aliases
  -- onto the canonical location before the list replacement runs.
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

  foreach v_category in array array['daily', 'one_bang', 'dialled', 'percentage', 'lines', 'bonus']
  loop
    select coalesce(pg_catalog.jsonb_agg(entry.item order by entry.ordinality), '[]'::jsonb)
    into v_category_items
    from pg_catalog.jsonb_array_elements(p_items) with ordinality as entry(item, ordinality)
    where entry.item->>'category' = v_category;

    v_saved := public.save_weekly_assignment_list(
      v_proposal.athlete_id,
      v_proposal.week_start,
      v_category,
      case when v_category = 'daily' then v_venue else '' end,
      v_category_items
    );
    v_total_saved := v_total_saved + v_saved;
  end loop;

  -- This records the approval and uses the existing notification trigger. The
  -- assignments already match, so the legacy add-only loop inserts nothing.
  v_result := public.review_rider_sheet_proposal(
    v_proposal.id,
    'accepted',
    pg_catalog.left(coalesce(p_coach_note, ''), 500)
  );

  return v_result || pg_catalog.jsonb_build_object(
    'assignments_updated', v_total_saved,
    'venue', v_venue
  );
end;
$function$;

revoke all on function public.review_edited_rider_sheet_proposal(uuid, text, text, jsonb, text) from public, anon;
grant execute on function public.review_edited_rider_sheet_proposal(uuid, text, text, jsonb, text) to authenticated, service_role;

comment on function public.review_edited_rider_sheet_proposal(uuid, text, text, jsonb, text)
  is 'Atomically replaces the six requestable weekly lists with a linked coach correction, then approves and notifies the rider.';

notify pgrst, 'reload schema';
