-- Allow a linked coach to correct a complete rider-submitted sheet and approve
-- it in one transaction. Direct table UPDATE remains unavailable to clients.

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
  v_venue text := pg_catalog.btrim(coalesce(p_venue, ''));
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
  if v_venue = '' then
    raise exception 'Add the skate park or location for the 10 Dailys.';
  end if;
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

  -- Reuse the established add-only assignment creation, audit fields and
  -- approval notification. Both function calls share this transaction.
  return public.review_rider_sheet_proposal(
    v_proposal.id,
    'accepted',
    pg_catalog.left(coalesce(p_coach_note, ''), 500)
  );
end;
$function$;

revoke all on function public.review_edited_rider_sheet_proposal(uuid, text, text, jsonb, text) from public, anon;
grant execute on function public.review_edited_rider_sheet_proposal(uuid, text, text, jsonb, text) to authenticated, service_role;

comment on function public.review_edited_rider_sheet_proposal(uuid, text, text, jsonb, text)
  is 'Atomically saves a linked coach correction to a pending complete rider sheet and approves it.';

notify pgrst, 'reload schema';
