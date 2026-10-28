-- Presentation only: one shared park record, with a title chosen for the
-- champion's account. Names are used only once to resolve the coach's six
-- explicitly named riders; subsequent renames cannot change their crown title.
create table private.park_crown_titles (
  athlete_id uuid primary key references public.profiles(id) on delete cascade,
  crown_title text not null check (crown_title in ('King', 'Queen'))
);
alter table private.park_crown_titles enable row level security;
revoke all on table private.park_crown_titles from public, anon, authenticated;

do $seed$
declare
  v_name text;
  v_ids uuid[];
begin
  foreach v_name in array array['kebe', 'mylee toohey', 'ali', 'kim lea müller', 'lara', 'romy king'] loop
    select array_agg(id) into v_ids
    from public.profiles
    where role = 'athlete'
      and lower(regexp_replace(btrim(display_name), '\s+', ' ', 'g')) = v_name;
    if coalesce(cardinality(v_ids), 0) <> 1 then
      raise exception 'Expected one rider for park crown title: %', v_name;
    end if;
    insert into private.park_crown_titles (athlete_id, crown_title)
    values (v_ids[1], 'Queen');
  end loop;
end;
$seed$;

create or replace function private.jkcrew_park_crown_title(p_athlete_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce((select crown_title from private.park_crown_titles where athlete_id = p_athlete_id), 'King');
$function$;
revoke all on function private.jkcrew_park_crown_title(uuid) from public, anon, authenticated;

alter table public.park_king_snapshots
  add column crown_title text not null default 'King' check (crown_title in ('King', 'Queen'));
alter table public.park_king_events
  add column crown_title text not null default 'King' check (crown_title in ('King', 'Queen'));

create or replace function private.set_park_crown_title()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  new.crown_title := private.jkcrew_park_crown_title(new.athlete_id);
  return new;
end;
$function$;
revoke all on function private.set_park_crown_title() from public, anon, authenticated;

create trigger park_snapshot_crown_title
before insert or update of athlete_id, crown_title on public.park_king_snapshots
for each row execute function private.set_park_crown_title();
create trigger park_event_crown_title
before insert or update of athlete_id, crown_title on public.park_king_events
for each row execute function private.set_park_crown_title();

-- Correct display metadata without recalculating points, minting crown events,
-- changing record timestamps, or sending another notification.
update public.park_king_snapshots
set crown_title = private.jkcrew_park_crown_title(athlete_id)
where crown_title is distinct from private.jkcrew_park_crown_title(athlete_id);
update public.park_king_events
set crown_title = private.jkcrew_park_crown_title(athlete_id)
where crown_title is distinct from private.jkcrew_park_crown_title(athlete_id);

-- The original columns and their order are preserved for existing app versions.
-- No dependent database objects reference this RPC. DROP without CASCADE fails
-- safely if a deployment has since added a dependency.
drop function public.get_park_king(text);
create function public.get_park_king(p_venue text)
returns table (
  venue_key text, venue_name text, athlete_id uuid, display_name text,
  avatar jsonb, points integer, crown_title text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  return query
  select champion.venue_key, champion.venue_name, champion.athlete_id,
    champion.display_name, champion.avatar, champion.points,
    private.jkcrew_park_crown_title(champion.athlete_id)
  from private.jkcrew_current_park_king(p_venue) champion;
end;
$function$;
revoke all on function public.get_park_king(text) from public, anon;
grant execute on function public.get_park_king(text) to authenticated;

-- Keep scoring, deduplication and recipients unchanged; only the title varies.
create or replace function private.refresh_park_king(
  p_venue text,
  p_event_key text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_key text := private.jkcrew_venue_key(p_venue);
  v_previous public.park_king_snapshots%rowtype;
  v_current record;
  v_event_id uuid;
  v_title text;
  v_message text;
  v_crown_title text;
begin
  if v_key = '' then
    return;
  end if;

  select snapshot.*
    into v_previous
  from public.park_king_snapshots as snapshot
  where snapshot.venue_key = v_key;

  select current_king.*
    into v_current
  from private.jkcrew_current_park_king(p_venue) as current_king;

  if not found then
    delete from public.park_king_snapshots as snapshot
    where snapshot.venue_key = v_key
       or private.jkcrew_venue_key(snapshot.venue_name) = v_key;
    return;
  end if;

  delete from public.park_king_snapshots as snapshot
  where snapshot.venue_key <> v_key
    and private.jkcrew_venue_key(snapshot.venue_name) = v_key;

  insert into public.park_king_snapshots (
    venue_key,
    venue_name,
    athlete_id,
    display_name,
    avatar,
    points,
    updated_at
  ) values (
    v_key,
    v_current.venue_name,
    v_current.athlete_id,
    v_current.display_name,
    v_current.avatar,
    v_current.points,
    now()
  )
  on conflict (venue_key) do update
  set venue_name = excluded.venue_name,
      athlete_id = excluded.athlete_id,
      display_name = excluded.display_name,
      avatar = excluded.avatar,
      points = excluded.points,
      updated_at = excluded.updated_at;

  if v_previous.athlete_id is not null
     and v_previous.athlete_id = v_current.athlete_id then
    return;
  end if;

  v_crown_title := private.jkcrew_park_crown_title(v_current.athlete_id);
  v_title := 'New ' || v_crown_title || ' of the Park';
  v_message := v_current.display_name || ' is now ' || v_crown_title || ' of ' || v_current.venue_name
    || ' with ' || v_current.points || ' park point'
    || case when v_current.points = 1 then '' else 's' end || '.';

  insert into public.park_king_events (
    venue_key,
    venue_name,
    athlete_id,
    display_name,
    points
  ) values (
    v_key,
    v_current.venue_name,
    v_current.athlete_id,
    v_current.display_name,
    v_current.points
  )
  returning id into v_event_id;

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
    profile.id,
    'park_king_changed',
    v_title,
    v_message,
    './?push=session',
    jsonb_build_object(
      'type', 'park_king_changed',
      'event_id', v_event_id,
      'venue', v_current.venue_name,
      'athlete_id', v_current.athlete_id,
      'points', v_current.points,
      'crown_title', v_crown_title,
      'view', 'session'
    ),
    'park-king:' || v_event_id::text || ':' || profile.id::text
  from public.profiles as profile
  where profile.role = 'athlete'
    and profile.id <> v_current.athlete_id
  on conflict (dedupe_key) do nothing;
end;
$$;

revoke all on function private.refresh_park_king(text, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
