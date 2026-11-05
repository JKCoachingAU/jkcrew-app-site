-- Private ten-week coaching plans. This extends tracker records without
-- changing live sessions, attendance, billing, training points or rider data.
create table public.coach_training_blocks (
  id uuid primary key,
  coach_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  start_date date not null check (isfinite(start_date) and extract(isodow from start_date) = 1),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
comment on table public.coach_training_blocks is 'Coach-owned ten-week planning blocks; invoice week labels are reminders, not issued invoices.';
create index coach_training_blocks_coach_start_idx on public.coach_training_blocks (coach_id, start_date desc, id);
alter table public.coach_training_blocks enable row level security;
create policy coach_training_blocks_select on public.coach_training_blocks
  for select to authenticated
  using (coach_id = (select auth.uid()) and (select private.current_user_role()) in ('coach', 'admin'));
create policy coach_training_blocks_insert on public.coach_training_blocks
  for insert to authenticated
  with check (coach_id = (select auth.uid()) and (select private.current_user_role()) in ('coach', 'admin'));
create policy coach_training_blocks_update on public.coach_training_blocks
  for update to authenticated
  using (coach_id = (select auth.uid()) and (select private.current_user_role()) in ('coach', 'admin'))
  with check (coach_id = (select auth.uid()) and (select private.current_user_role()) in ('coach', 'admin'));
revoke all on public.coach_training_blocks from public, anon, authenticated;
grant select on public.coach_training_blocks to authenticated;
grant insert (id, coach_id, name, start_date) on public.coach_training_blocks to authenticated;
grant update (name, start_date) on public.coach_training_blocks to authenticated;

alter table public.coach_tracked_sessions
  add column block_id uuid references public.coach_training_blocks(id) on delete restrict,
  add column park_fee_cents integer not null default 0 check (park_fee_cents between 0 and 1000000),
  add column park_fee_basis text not null default 'per_rider' check (park_fee_basis in ('per_rider', 'session'));
comment on column public.coach_tracked_sessions.park_fee_cents is 'Park entry fee in AUD cents. Per-rider totals multiply this by the distinct saved rider count; no fees are charged by this feature.';
comment on column public.coach_tracked_sessions.block_id is 'Optional explicit planning block. Older sessions remain unassigned until the coach assigns them.';
create index coach_tracked_sessions_block_date_idx
  on public.coach_tracked_sessions (block_id, coach_id, session_date, start_time, id);
grant insert (block_id, park_fee_cents, park_fee_basis) on public.coach_tracked_sessions to authenticated;
grant update (block_id, park_fee_cents, park_fee_basis) on public.coach_tracked_sessions to authenticated;

create function private.validate_coach_training_block()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null or new.coach_id is distinct from auth.uid()
     or not exists (select 1 from public.profiles where id = auth.uid() and role in ('coach', 'admin')) then
    raise exception 'Only the block coach can save this training block.' using errcode = '42501';
  end if;
  -- The same lock in the session trigger serializes date-range validation with
  -- block edits, including writes made through the table API and old clients.
  perform pg_advisory_xact_lock(hashtextextended('coach-training-plan:' || new.coach_id::text, 0));
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.coach_id is distinct from old.coach_id then
      raise exception 'The block owner cannot be changed.' using errcode = '42501';
    end if;
    new.created_at := old.created_at;
  end if;
  new.name := btrim(regexp_replace(coalesce(new.name, ''), '[[:space:]]+', ' ', 'g'));
  if char_length(new.name) not between 1 and 80 then
    raise exception 'Enter a block name between 1 and 80 characters.' using errcode = '22023';
  end if;
  if new.start_date is null or not isfinite(new.start_date) or extract(isodow from new.start_date) <> 1 then
    raise exception 'Choose a Monday for the first week of the block.' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and new.start_date is distinct from old.start_date and exists (
    select 1 from public.coach_tracked_sessions as sessions
    where sessions.block_id = new.id
      and (sessions.session_date < new.start_date or sessions.session_date >= new.start_date + 70)
  ) then
    -- Include archived sessions so restoring one never moves it outside its block.
    raise exception 'These dates would move saved sessions outside the ten-week block. Update their block assignment first.' using errcode = '22023';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function private.validate_coach_training_block() from public, anon, authenticated;
create trigger validate_coach_training_block
  before insert or update on public.coach_training_blocks
  for each row execute function private.validate_coach_training_block();

create function private.validate_coach_tracked_session_block()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_start date;
begin
  if auth.uid() is null or new.coach_id is distinct from auth.uid()
     or not exists (select 1 from public.profiles where id = auth.uid() and role in ('coach', 'admin')) then
    raise exception 'Only the session coach can save this session.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('coach-training-plan:' || new.coach_id::text, 0));
  if new.park_fee_cents is null or new.park_fee_cents not between 0 and 1000000 then
    raise exception 'Enter a park fee between $0 and $10,000.' using errcode = '22023';
  end if;
  if new.park_fee_basis is null or new.park_fee_basis not in ('per_rider', 'session') then
    raise exception 'Choose a per-rider or session park fee.' using errcode = '22023';
  end if;
  if new.block_id is not null then
    select start_date into v_start from public.coach_training_blocks
      where id = new.block_id and coach_id = new.coach_id;
    if not found then
      raise exception 'Choose a training block from your coaching account.' using errcode = '42501';
    end if;
    if new.session_date < v_start or new.session_date >= v_start + 70 then
      raise exception 'Choose a session date within this ten-week block.' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.validate_coach_tracked_session_block() from public, anon, authenticated;
create trigger validate_coach_tracked_session_block
  before insert or update on public.coach_tracked_sessions
  for each row execute function private.validate_coach_tracked_session_block();

create function public.save_coach_training_block(
  p_id uuid,
  p_name text,
  p_start_date date,
  p_expected_updated_at timestamptz default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_row public.coach_training_blocks;
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '[[:space:]]+', ' ', 'g'));
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid() and role in ('coach', 'admin')) then
    raise exception 'Only coaches can save training blocks.' using errcode = '42501';
  end if;
  if p_id is null then
    raise exception 'The training block could not be identified. Reopen the form.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('coach-training-plan:' || auth.uid()::text, 0));
  select * into v_row from public.coach_training_blocks where id = p_id for update;
  if found then
    if v_row.name = v_name and v_row.start_date is not distinct from p_start_date then
      return to_jsonb(v_row);
    end if;
    if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
      raise exception 'This training block has changed. Refresh it before saving your changes.' using errcode = '40001';
    end if;
    update public.coach_training_blocks set name = v_name, start_date = p_start_date
      where id = p_id returning * into v_row;
  else
    if p_expected_updated_at is not null then
      raise exception 'This training block is no longer available. Refresh your blocks.' using errcode = '40001';
    end if;
    insert into public.coach_training_blocks (id, name, start_date)
      values (p_id, v_name, p_start_date) on conflict (id) do nothing returning * into v_row;
    if not found then
      raise exception 'This training block could not be saved. Reopen the form and try again.' using errcode = '42501';
    end if;
  end if;
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.save_coach_training_block(uuid,text,date,timestamptz) from public, anon, authenticated;
grant execute on function public.save_coach_training_block(uuid,text,date,timestamptz) to authenticated;

-- Separate API keeps cached v1 clients compatible. Their existing RPC never
-- writes block_id or fee fields, so editing an old-client session retains them.
create function public.save_coach_tracked_session_v2(
  p_id uuid,
  p_session_date date,
  p_start_time time without time zone,
  p_venue text,
  p_rider_ids uuid[],
  p_expected_updated_at timestamptz default null,
  p_block_id uuid default null,
  p_park_fee_cents integer default 0,
  p_park_fee_basis text default 'per_rider'
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
  -- Same per-record lock as v1: retries from either client version serialize.
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
       and v_row.park_fee_basis is not distinct from p_park_fee_basis then
      return to_jsonb(v_row);
    end if;
    if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
      raise exception 'This session has changed. Refresh the session before saving your changes.' using errcode = '40001';
    end if;
    update public.coach_tracked_sessions
      set session_date = p_session_date, start_time = p_start_time, venue = v_venue, rider_ids = v_riders,
          block_id = p_block_id, park_fee_cents = p_park_fee_cents, park_fee_basis = p_park_fee_basis
      where id = p_id returning * into v_row;
  else
    if p_expected_updated_at is not null then
      raise exception 'This session is no longer available. Refresh your sessions.' using errcode = '40001';
    end if;
    insert into public.coach_tracked_sessions (id, session_date, start_time, venue, rider_ids, block_id, park_fee_cents, park_fee_basis)
      values (p_id, p_session_date, p_start_time, v_venue, v_riders, p_block_id, p_park_fee_cents, p_park_fee_basis)
      on conflict (id) do nothing returning * into v_row;
    if not found then
      raise exception 'This session could not be saved. Reopen the form and try again.' using errcode = '42501';
    end if;
  end if;
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.save_coach_tracked_session_v2(uuid,date,time,text,uuid[],timestamptz,uuid,integer,text) from public, anon, authenticated;
grant execute on function public.save_coach_tracked_session_v2(uuid,date,time,text,uuid[],timestamptz,uuid,integer,text) to authenticated;
