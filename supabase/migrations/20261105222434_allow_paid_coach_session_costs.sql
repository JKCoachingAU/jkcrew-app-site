-- Record a confirmed reimbursement/payment without issuing invoices or
-- collecting money. Existing records retain their current status and version.
alter table public.coach_tracked_sessions
  drop constraint coach_tracked_sessions_invoice_status_check,
  add constraint coach_tracked_sessions_invoice_status_check check (invoice_status in ('expected', 'invoiced', 'paid')),
  add constraint coach_tracked_sessions_paid_extra_known_check check (
    invoice_status <> 'paid' or session_kind <> 'additional' or extra_fee_cents is not null
  );
comment on column public.coach_tracked_sessions.invoice_status is
  'Coach-recorded expected, invoiced or paid status for the costs of every rider selected in this record. Paid is a confirmation, not an automatic collection or invoice action.';

create or replace function private.validate_coach_tracked_session_costs()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.session_kind is null or new.session_kind not in ('regular', 'additional') then
    raise exception 'Choose a regular or additional session.' using errcode = '22023';
  end if;
  if new.session_completed is null or new.park_fee_paid_by_coach is null then
    raise exception 'Choose whether the session is complete and whether the coach paid the park fee.' using errcode = '22023';
  end if;
  if new.extra_fee_cents is not null and new.extra_fee_cents not between 0 and 1000000 then
    raise exception 'Enter an additional session fee between $0 and $10,000, or leave it to be confirmed.' using errcode = '22023';
  end if;
  if new.session_kind = 'regular' and new.extra_fee_cents is not null then
    raise exception 'Additional session fees only apply to additional sessions.' using errcode = '22023';
  end if;
  if new.park_fee_paid_by_coach and new.park_fee_cents <= 0 then
    raise exception 'Enter a positive park fee before marking it as paid by the coach.' using errcode = '22023';
  end if;
  if new.invoice_date is not null and not isfinite(new.invoice_date) then
    raise exception 'Choose a valid invoice date.' using errcode = '22023';
  end if;
  if new.invoice_status is null or new.invoice_status not in ('expected', 'invoiced', 'paid') then
    raise exception 'Choose an expected, invoiced or paid billing status.' using errcode = '22023';
  end if;
  if new.invoice_status = 'paid' and new.session_kind = 'additional' and new.extra_fee_cents is null then
    raise exception 'Confirm the additional session fee before marking these costs as paid.' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_coach_tracked_session_costs() from public, anon, authenticated;

comment on function public.get_parent_session_costs(uuid,integer,integer) is
  'Read-only cost notes and coach-recorded billing status for one currently linked child. Excludes archived sessions, other riders and coach-wide amounts. Shared park fees are divided in integer cents with sorted rider UUIDs receiving any remainder.';

notify pgrst, 'reload schema';
