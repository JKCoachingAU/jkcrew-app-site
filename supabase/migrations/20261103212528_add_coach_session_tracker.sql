-- Coach-owned planning records. These do not start live sessions, record
-- attendance, alter rider scores or create notifications.
create table public.coach_tracked_sessions (
  id uuid primary key,
  coach_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  session_date date not null check (isfinite(session_date)),
  start_time time without time zone check (start_time < time '24:00'),
  venue text not null check (char_length(venue) between 1 and 80),
  rider_ids uuid[] not null check (cardinality(rider_ids) between 1 and 200),
  archived_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
comment on table public.coach_tracked_sessions is 'Private coach session plans/logs; local date/time at the venue, independent of live timers and attendance payments.';
comment on column public.coach_tracked_sessions.venue is 'Location name snapshot; coach_venues can be replaced without changing saved session history.';

create index coach_tracked_sessions_coach_date_idx
  on public.coach_tracked_sessions (coach_id, session_date, start_time, id);

alter table public.coach_tracked_sessions enable row level security;
create policy coach_tracked_sessions_select on public.coach_tracked_sessions
  for select to authenticated
  using (coach_id = (select auth.uid()) and (select private.current_user_role()) in ('coach', 'admin'));
create policy coach_tracked_sessions_insert on public.coach_tracked_sessions
  for insert to authenticated
  with check (coach_id = (select auth.uid()) and (select private.current_user_role()) in ('coach', 'admin'));
create policy coach_tracked_sessions_update on public.coach_tracked_sessions
  for update to authenticated
  using (coach_id = (select auth.uid()) and (select private.current_user_role()) in ('coach', 'admin'))
  with check (coach_id = (select auth.uid()) and (select private.current_user_role()) in ('coach', 'admin'));
revoke all on public.coach_tracked_sessions from public, anon, authenticated;
grant select on public.coach_tracked_sessions to authenticated;
grant insert (id, coach_id, session_date, start_time, venue, rider_ids) on public.coach_tracked_sessions to authenticated;
grant update (session_date, start_time, venue, rider_ids, archived_at) on public.coach_tracked_sessions to authenticated;

create function private.validate_coach_tracked_session()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_retained uuid[] := '{}'::uuid[];
begin
  if auth.uid() is null or new.coach_id is distinct from auth.uid()
     or not exists (select 1 from public.profiles where id = auth.uid() and role in ('coach', 'admin')) then
    raise exception 'Only the session coach can save this session.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.coach_id is distinct from old.coach_id then
      raise exception 'The session owner cannot be changed.' using errcode = '42501';
    end if;
    v_retained := old.rider_ids;
    new.created_at := old.created_at;
  end if;
  new.venue := btrim(regexp_replace(coalesce(new.venue, ''), '[[:space:]]+', ' ', 'g'));
  if char_length(new.venue) not between 1 and 80 then
    raise exception 'Enter a location between 1 and 80 characters.' using errcode = '22023';
  end if;
  if new.session_date is null or not isfinite(new.session_date) then
    raise exception 'Choose a session date.' using errcode = '22023';
  end if;
  if new.rider_ids is null or cardinality(new.rider_ids) not between 1 and 200
     or array_position(new.rider_ids, null) is not null then
    raise exception 'Choose between 1 and 200 riders.' using errcode = '22023';
  end if;
  new.rider_ids := array(select distinct rider_id from unnest(new.rider_ids) as riders(rider_id) order by rider_id);
  if exists (
    select 1 from unnest(new.rider_ids) as riders(rider_id)
    where not (rider_id = any(v_retained)) and not exists (
      select 1 from public.coach_athletes as links
      join public.profiles as rider on rider.id = links.athlete_id and rider.role = 'athlete'
      where links.coach_id = new.coach_id and links.athlete_id = rider_id
    )
  ) then
    raise exception 'Choose riders linked to your coaching account.' using errcode = '42501';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function private.validate_coach_tracked_session() from public, anon, authenticated;
create trigger validate_coach_tracked_session
  before insert or update on public.coach_tracked_sessions
  for each row execute function private.validate_coach_tracked_session();

create function public.save_coach_tracked_session(
  p_id uuid,
  p_session_date date,
  p_start_time time without time zone,
  p_venue text,
  p_rider_ids uuid[],
  p_expected_updated_at timestamptz default null
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
  -- A stable client UUID and transaction lock also protect two simultaneous
  -- first-save retries. Ownership remains enforced by RLS on every statement.
  perform pg_advisory_xact_lock(hashtextextended('coach-session-tracker:' || p_id::text, 0));
  select * into v_row from public.coach_tracked_sessions where id = p_id for update;
  if found then
    if v_row.archived_at is not null then
      raise exception 'This session was removed. Restore it before making changes.' using errcode = '55000';
    end if;
    if v_row.session_date is not distinct from p_session_date
       and v_row.start_time is not distinct from p_start_time
       and v_row.venue = v_venue and v_row.rider_ids = v_riders then
      return to_jsonb(v_row);
    end if;
    if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
      raise exception 'This session has changed. Refresh the session before saving your changes.' using errcode = '40001';
    end if;
    update public.coach_tracked_sessions
      set session_date = p_session_date, start_time = p_start_time, venue = v_venue, rider_ids = v_riders
      where id = p_id returning * into v_row;
  else
    if p_expected_updated_at is not null then
      raise exception 'This session is no longer available. Refresh your sessions.' using errcode = '40001';
    end if;
    insert into public.coach_tracked_sessions (id, session_date, start_time, venue, rider_ids)
      values (p_id, p_session_date, p_start_time, v_venue, v_riders)
      on conflict (id) do nothing returning * into v_row;
    if not found then
      raise exception 'This session could not be saved. Reopen the form and try again.' using errcode = '42501';
    end if;
  end if;
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.save_coach_tracked_session(uuid,date,time,text,uuid[],timestamptz) from public, anon, authenticated;
grant execute on function public.save_coach_tracked_session(uuid,date,time,text,uuid[],timestamptz) to authenticated;

create function public.archive_coach_tracked_session(
  p_id uuid,
  p_archived boolean,
  p_expected_updated_at timestamptz
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_row public.coach_tracked_sessions;
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid() and role in ('coach', 'admin')) then
    raise exception 'Only coaches can change sessions.' using errcode = '42501';
  end if;
  if p_archived is null then
    raise exception 'Choose whether to remove or restore the session.' using errcode = '22023';
  end if;
  select * into v_row from public.coach_tracked_sessions where id = p_id for update;
  if not found then
    raise exception 'This session is no longer available. Refresh your sessions.' using errcode = '42501';
  end if;
  if (v_row.archived_at is not null) = p_archived then
    return to_jsonb(v_row);
  end if;
  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'This session has changed. Refresh the session before saving your changes.' using errcode = '40001';
  end if;
  update public.coach_tracked_sessions
    set archived_at = case when p_archived then clock_timestamp() else null end
    where id = p_id returning * into v_row;
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.archive_coach_tracked_session(uuid,boolean,timestamptz) from public, anon, authenticated;
grant execute on function public.archive_coach_tracked_session(uuid,boolean,timestamptz) to authenticated;

create function public.add_coach_tracker_location(p_name text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '[[:space:]]+', ' ', 'g'));
  v_row public.coach_venues;
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid() and role in ('coach', 'admin')) then
    raise exception 'Only coaches can add session locations.' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 80 then
    raise exception 'Enter a location between 1 and 80 characters.' using errcode = '22023';
  end if;
  -- Keep the existing venue list and IDs; never replace the whole list to add
  -- one location. Concurrent tracker additions serialize per coach.
  perform pg_advisory_xact_lock(hashtextextended('coach-tracker-location:' || auth.uid()::text, 0));
  select * into v_row from public.coach_venues
    where coach_id = auth.uid()
      and lower(btrim(regexp_replace(name, '[[:space:]]+', ' ', 'g'))) = lower(v_name)
    order by sort_order, created_at, id limit 1;
  if not found then
    insert into public.coach_venues (coach_id, name, sort_order)
      values (auth.uid(), v_name, coalesce((select max(sort_order) + 1 from public.coach_venues where coach_id = auth.uid()), 0))
      on conflict (coach_id, name) do update set name = excluded.name
      returning * into v_row;
  end if;
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.add_coach_tracker_location(text) from public, anon, authenticated;
grant execute on function public.add_coach_tracker_location(text) to authenticated;
