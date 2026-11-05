-- Planning costs and invoice notes only. This migration does not issue bills,
-- collect payments, infer attendance, change rider points or send notifications.
alter table public.coach_tracked_sessions
  add column session_kind text not null default 'regular' check (session_kind in ('regular', 'additional')),
  add column session_completed boolean not null default false,
  add column extra_fee_cents integer check (extra_fee_cents between 0 and 1000000),
  add column park_fee_paid_by_coach boolean not null default false,
  add column invoice_date date check (invoice_date is null or isfinite(invoice_date)),
  add column invoice_status text not null default 'expected' check (invoice_status in ('expected', 'invoiced')),
  add constraint coach_tracked_sessions_extra_fee_kind_check check (session_kind = 'additional' or extra_fee_cents is null),
  add constraint coach_tracked_sessions_paid_park_fee_check check (not park_fee_paid_by_coach or park_fee_cents > 0);
comment on column public.coach_tracked_sessions.session_completed is 'Coach-confirmed completion; never inferred from a past session date.';
comment on column public.coach_tracked_sessions.extra_fee_cents is 'Additional-session fee per selected rider, in AUD cents. NULL means to be confirmed; zero is a confirmed free session.';
comment on column public.coach_tracked_sessions.park_fee_paid_by_coach is 'Coach reports having paid the park entry fee; not a parent payment or balance status.';
comment on column public.coach_tracked_sessions.invoice_date is 'Coach-entered expected or issued invoice date, as indicated by invoice_status.';
grant insert (session_kind, session_completed, extra_fee_cents, park_fee_paid_by_coach, invoice_date, invoice_status)
  on public.coach_tracked_sessions to authenticated;
grant update (session_kind, session_completed, extra_fee_cents, park_fee_paid_by_coach, invoice_date, invoice_status)
  on public.coach_tracked_sessions to authenticated;

create function private.validate_coach_tracked_session_costs()
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
  if new.invoice_status is null or new.invoice_status not in ('expected', 'invoiced') then
    raise exception 'Choose an expected or invoiced status.' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_coach_tracked_session_costs() from public, anon, authenticated;
create trigger validate_coach_tracked_session_costs
  before insert or update on public.coach_tracked_sessions
  for each row execute function private.validate_coach_tracked_session_costs();

-- V1 and V2 remain unchanged: cached clients cannot clear newer financial
-- notes or completion state merely by editing a date, location or park fee.
create function public.save_coach_tracked_session_v3(
  p_id uuid,
  p_session_date date,
  p_start_time time without time zone,
  p_venue text,
  p_rider_ids uuid[],
  p_expected_updated_at timestamptz default null,
  p_block_id uuid default null,
  p_park_fee_cents integer default 0,
  p_park_fee_basis text default 'per_rider',
  p_session_kind text default 'regular',
  p_session_completed boolean default false,
  p_extra_fee_cents integer default null,
  p_park_fee_paid_by_coach boolean default false,
  p_invoice_date date default null,
  p_invoice_status text default 'expected'
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_row public.coach_tracked_sessions;
  v_venue text := btrim(regexp_replace(coalesce(p_venue, ''), '[[:space:]]+', ' ', 'g'));
  v_riders uuid[];
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid() and role in ('coach', 'admin')) then
    raise exception 'Only coaches can save sessions.' using errcode = '42501';
  end if;
  if p_id is null then
    raise exception 'The session could not be identified. Please reopen the form.' using errcode = '22023';
  end if;
  if p_rider_ids is null or cardinality(p_rider_ids) not between 1 and 200
     or array_position(p_rider_ids, null) is not null then
    raise exception 'Choose between 1 and 200 riders.' using errcode = '22023';
  end if;
  v_riders := array(select distinct rider_id from unnest(p_rider_ids) as riders(rider_id) order by rider_id);
  perform pg_advisory_xact_lock(hashtextextended('coach-session-tracker:' || p_id::text, 0));
  select * into v_row from public.coach_tracked_sessions where id = p_id for update;
  if found then
    if v_row.archived_at is not null then
      raise exception 'This session was removed. Restore it before making changes.' using errcode = '55000';
    end if;
    if v_row.session_date is not distinct from p_session_date
       and v_row.start_time is not distinct from p_start_time
       and v_row.venue = v_venue and v_row.rider_ids = v_riders
       and v_row.block_id is not distinct from p_block_id
       and v_row.park_fee_cents is not distinct from p_park_fee_cents
       and v_row.park_fee_basis is not distinct from p_park_fee_basis
       and v_row.session_kind is not distinct from p_session_kind
       and v_row.session_completed is not distinct from p_session_completed
       and v_row.extra_fee_cents is not distinct from p_extra_fee_cents
       and v_row.park_fee_paid_by_coach is not distinct from p_park_fee_paid_by_coach
       and v_row.invoice_date is not distinct from p_invoice_date
       and v_row.invoice_status is not distinct from p_invoice_status then
      return to_jsonb(v_row);
    end if;
    if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
      raise exception 'This session has changed. Refresh the session before saving your changes.' using errcode = '40001';
    end if;
    update public.coach_tracked_sessions
      set session_date = p_session_date, start_time = p_start_time, venue = v_venue, rider_ids = v_riders,
          block_id = p_block_id, park_fee_cents = p_park_fee_cents, park_fee_basis = p_park_fee_basis,
          session_kind = p_session_kind, session_completed = p_session_completed, extra_fee_cents = p_extra_fee_cents,
          park_fee_paid_by_coach = p_park_fee_paid_by_coach, invoice_date = p_invoice_date, invoice_status = p_invoice_status
      where id = p_id returning * into v_row;
  else
    if p_expected_updated_at is not null then
      raise exception 'This session is no longer available. Refresh your sessions.' using errcode = '40001';
    end if;
    insert into public.coach_tracked_sessions (
      id, session_date, start_time, venue, rider_ids, block_id, park_fee_cents, park_fee_basis,
      session_kind, session_completed, extra_fee_cents, park_fee_paid_by_coach, invoice_date, invoice_status
    ) values (
      p_id, p_session_date, p_start_time, v_venue, v_riders, p_block_id, p_park_fee_cents, p_park_fee_basis,
      p_session_kind, p_session_completed, p_extra_fee_cents, p_park_fee_paid_by_coach, p_invoice_date, p_invoice_status
    ) on conflict (id) do nothing returning * into v_row;
    if not found then
      raise exception 'This session could not be saved. Reopen the form and try again.' using errcode = '42501';
    end if;
  end if;
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.save_coach_tracked_session_v3(uuid,date,time,text,uuid[],timestamptz,uuid,integer,text,text,boolean,integer,boolean,date,text)
  from public, anon, authenticated;
grant execute on function public.save_coach_tracked_session_v3(uuid,date,time,text,uuid[],timestamptz,uuid,integer,text,text,boolean,integer,boolean,date,text)
  to authenticated;

-- The definer is limited to this read-only child projection. The raw planning
-- tables stay coach-only. Current links are checked on every request/page.
create function private.parent_session_costs(
  p_athlete_id uuid,
  p_offset integer default 0,
  p_limit integer default 100
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_offset integer := coalesce(p_offset, 0);
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 100);
  v_result jsonb;
begin
  if v_user is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false)
     or not exists (select 1 from public.profiles where id = v_user and role::text = 'parent') then
    raise exception 'Sign in as a linked parent to view session costs.' using errcode = '42501';
  end if;
  if p_athlete_id is null or not exists (
    select 1 from public.parent_athletes as links
    join public.coach_athletes as coaching on coaching.coach_id = links.coach_id and coaching.athlete_id = links.athlete_id
    join public.profiles as child on child.id = links.athlete_id and child.role::text = 'athlete'
    join public.profiles as coach on coach.id = links.coach_id and coach.role::text in ('coach', 'admin')
    where links.parent_id = v_user and links.athlete_id = p_athlete_id
  ) then
    raise exception 'This rider''s session costs are not available to your account.' using errcode = '42501';
  end if;
  if v_offset < 0 or v_offset > 100000 then
    raise exception 'Refresh session costs to load a valid page.' using errcode = '22023';
  end if;
  with matching as materialized (
    select sessions.*, block.name as block_name, block.start_date as block_start_date, block.updated_at as block_updated_at
    from public.coach_tracked_sessions as sessions
    left join public.coach_training_blocks as block on block.id = sessions.block_id and block.coach_id = sessions.coach_id
    where sessions.archived_at is null
      and p_athlete_id = any(sessions.rider_ids)
      and exists (
        select 1 from public.parent_athletes as links
        join public.coach_athletes as coaching on coaching.coach_id = links.coach_id and coaching.athlete_id = links.athlete_id
        join public.profiles as coach on coach.id = links.coach_id and coach.role::text in ('coach', 'admin')
        where links.parent_id = v_user and links.athlete_id = p_athlete_id and links.coach_id = sessions.coach_id
      )
  ), candidates as materialized (
    select * from matching order by session_date desc, id
    offset v_offset limit v_limit + 1
  ), page as materialized (
    select * from candidates order by session_date desc, id limit v_limit
  ), projected as (
    select page.session_date, page.id, jsonb_build_object(
      'id', page.id, 'session_date', page.session_date, 'start_time', page.start_time, 'venue', page.venue,
      'block_id', page.block_id, 'block_name', page.block_name, 'block_start_date', page.block_start_date,
      'session_kind', page.session_kind, 'session_completed', page.session_completed,
      'park_fee_cents', case when page.park_fee_basis = 'per_rider' then page.park_fee_cents
        else page.park_fee_cents / cardinality(page.rider_ids)
          + case when array_position(page.rider_ids, p_athlete_id) <= mod(page.park_fee_cents, cardinality(page.rider_ids)) then 1 else 0 end end,
      'park_fee_allocation', case when page.park_fee_basis = 'per_rider' then 'per_rider' else 'shared' end,
      'extra_fee_cents', page.extra_fee_cents, 'park_fee_paid_by_coach', page.park_fee_paid_by_coach,
      'invoice_date', page.invoice_date, 'invoice_status', page.invoice_status
    ) as data
    from page
  )
  select jsonb_build_object(
    'sessions', coalesce((select jsonb_agg(data order by session_date desc, id) from projected), '[]'::jsonb),
    'hasMore', (select count(*) > v_limit from candidates),
    -- An opaque snapshot lets the client reject mixed pages if a session was
    -- edited, archived or added between requests, rather than show wrong totals.
    'snapshot', (select md5(coalesce(string_agg(id::text || ':' || updated_at::text || ':' || coalesce(block_updated_at::text, ''), '|' order by session_date desc, id), '')) from matching)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function private.parent_session_costs(uuid,integer,integer) from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.parent_session_costs(uuid,integer,integer) to authenticated;

create function public.get_parent_session_costs(
  p_athlete_id uuid,
  p_offset integer default 0,
  p_limit integer default 100
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.parent_session_costs(p_athlete_id, p_offset, p_limit);
$$;
revoke all on function public.get_parent_session_costs(uuid,integer,integer) from public, anon, authenticated;
grant execute on function public.get_parent_session_costs(uuid,integer,integer) to authenticated;
comment on function public.get_parent_session_costs(uuid,integer,integer) is
  'Read-only cost notes for one currently linked child. Excludes archived sessions, other riders, coach-wide amounts and parent payment status. Shared park fees are divided in integer cents with sorted rider UUIDs receiving any remainder.';

notify pgrst, 'reload schema';
