create or replace function private.jkcrew_venue_key(p_venue text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select lower(regexp_replace(btrim(coalesce(p_venue, '')), '[^[:alnum:]]+', '', 'g'));
$$;

revoke all on function private.jkcrew_venue_key(text) from public;

create index if not exists assignment_point_awards_park_session_idx
  on public.assignment_point_awards (
    private.jkcrew_venue_key(venue),
    session_id
  )
  include (athlete_id, award_key, points, created_at)
  where session_id is not null
    and btrim(coalesce(venue, '')) <> '';

create or replace function private.jkcrew_current_park_king(p_venue text)
returns table (
  venue_key text,
  venue_name text,
  athlete_id uuid,
  display_name text,
  avatar jsonb,
  points integer
)
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  with requested as (
    select private.jkcrew_venue_key(p_venue) as venue_key
  ),
  scored_sessions as (
    select
      private.jkcrew_venue_key(award.venue) as venue_key,
      max(btrim(award.venue)) as venue_name,
      award.session_id,
      session.athlete_id,
      profile.display_name,
      profile.avatar,
      (
        case
          when bool_or(split_part(award.award_key, ':', 1) in ('daily', 'daily-complete', 'daily-under-20')) then 1
          else 0
        end
        + coalesce(sum(
          case
            when split_part(award.award_key, ':', 1) in ('dialled', 'one_bang', 'percentage', 'bonus')
              then greatest(award.points, 0)
            else 0
          end
        ), 0)
      )::integer as points,
      session.ended_at as achieved_at
    from public.assignment_point_awards as award
    join public.training_sessions as session
      on session.id = award.session_id
     and session.ended_at is not null
    join public.profiles as profile
      on profile.id = session.athlete_id
     and profile.role = 'athlete'
    cross join requested
    where requested.venue_key <> ''
      and private.jkcrew_venue_key(award.venue) = requested.venue_key
      and split_part(award.award_key, ':', 1) in (
        'daily',
        'daily-complete',
        'daily-under-20',
        'dialled',
        'one_bang',
        'percentage',
        'bonus'
      )
    group by
      private.jkcrew_venue_key(award.venue),
      award.session_id,
      session.athlete_id,
      profile.display_name,
      profile.avatar,
      session.ended_at
  )
  select
    scored.venue_key,
    scored.venue_name,
    scored.athlete_id,
    scored.display_name,
    scored.avatar,
    scored.points
  from scored_sessions as scored
  where scored.points > 0
  order by
    scored.points desc,
    scored.achieved_at asc,
    scored.display_name asc,
    scored.athlete_id asc
  limit 1;
$$;

revoke all on function private.jkcrew_current_park_king(text) from public;

create or replace function public.get_park_king(p_venue text)
returns table (
  venue_key text,
  venue_name text,
  athlete_id uuid,
  display_name text,
  avatar jsonb,
  points integer
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  return query
  select
    current_king.venue_key,
    current_king.venue_name,
    current_king.athlete_id,
    current_king.display_name,
    current_king.avatar,
    current_king.points
  from private.jkcrew_current_park_king(p_venue) as current_king;
end;
$$;

revoke all on function public.get_park_king(text) from public;
grant execute on function public.get_park_king(text) to authenticated;

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

  v_title := 'New King of the Park';
  v_message := v_current.display_name || ' is now King of ' || v_current.venue_name
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
      'view', 'session'
    ),
    'park-king:' || v_event_id::text || ':' || profile.id::text
  from public.profiles as profile
  where profile.role = 'athlete'
    and profile.id <> v_current.athlete_id
  on conflict (dedupe_key) do nothing;
end;
$$;

revoke all on function private.refresh_park_king(text, text) from public;

create or replace function private.handle_park_king_award_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_old_venue text := case when tg_op in ('UPDATE', 'DELETE') then old.venue else null end;
  v_new_venue text := case when tg_op in ('INSERT', 'UPDATE') then new.venue else null end;
  v_old_session uuid := case when tg_op in ('UPDATE', 'DELETE') then old.session_id else null end;
  v_new_session uuid := case when tg_op in ('INSERT', 'UPDATE') then new.session_id else null end;
begin
  if v_old_session is not null
     and btrim(coalesce(v_old_venue, '')) <> ''
     and exists (
       select 1
       from public.training_sessions as session
       where session.id = v_old_session
         and session.ended_at is not null
     ) then
    perform private.refresh_park_king(v_old_venue, null);
  end if;

  if v_new_session is not null
     and btrim(coalesce(v_new_venue, '')) <> ''
     and (
       tg_op <> 'UPDATE'
       or private.jkcrew_venue_key(v_new_venue) <> private.jkcrew_venue_key(v_old_venue)
       or new.points is distinct from old.points
       or new.award_key is distinct from old.award_key
       or new.session_id is distinct from old.session_id
     )
     and exists (
       select 1
       from public.training_sessions as session
       where session.id = v_new_session
         and session.ended_at is not null
     ) then
    perform private.refresh_park_king(v_new_venue, null);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.handle_park_king_award_change() from public;

drop trigger if exists assignment_awards_refresh_park_king
  on public.assignment_point_awards;

create trigger assignment_awards_refresh_park_king
after insert or update or delete on public.assignment_point_awards
for each row execute function private.handle_park_king_award_change();

create or replace function private.handle_park_king_session_completion()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_venue text;
begin
  if old.ended_at is not distinct from new.ended_at then
    return new;
  end if;

  for v_venue in
    select distinct award.venue
    from public.assignment_point_awards as award
    where award.session_id = new.id
      and btrim(coalesce(award.venue, '')) <> ''
  loop
    perform private.refresh_park_king(v_venue, null);
  end loop;

  return new;
end;
$$;

revoke all on function private.handle_park_king_session_completion() from public;

drop trigger if exists training_sessions_refresh_park_king
  on public.training_sessions;

create trigger training_sessions_refresh_park_king
after update of ended_at on public.training_sessions
for each row execute function private.handle_park_king_session_completion();

delete from public.park_king_snapshots;

insert into public.park_king_snapshots (
  venue_key,
  venue_name,
  athlete_id,
  display_name,
  avatar,
  points,
  updated_at
)
select
  current_king.venue_key,
  current_king.venue_name,
  current_king.athlete_id,
  current_king.display_name,
  current_king.avatar,
  current_king.points,
  now()
from (
  select distinct award.venue
  from public.assignment_point_awards as award
  join public.training_sessions as session
    on session.id = award.session_id
   and session.ended_at is not null
  where btrim(coalesce(award.venue, '')) <> ''
) as venue
cross join lateral private.jkcrew_current_park_king(venue.venue) as current_king
on conflict (venue_key) do update
set venue_name = excluded.venue_name,
    athlete_id = excluded.athlete_id,
    display_name = excluded.display_name,
    avatar = excluded.avatar,
    points = excluded.points,
    updated_at = excluded.updated_at;
