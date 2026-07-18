alter table public.assignment_point_awards
  add column if not exists venue text not null default '';

create index if not exists assignment_point_awards_venue_created_athlete_idx
  on public.assignment_point_awards (lower(btrim(venue)), created_at desc, athlete_id)
  where btrim(venue) <> '';

create or replace function private.attach_assignment_award_venue()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  v_category text := split_part(new.award_key, ':', 1);
  v_request_venue text := nullif(btrim(current_setting('jkcrew.venue', true)), '');
begin
  if btrim(coalesce(new.venue, '')) <> '' then
    new.venue := btrim(new.venue);
    return new;
  end if;

  if v_category in ('daily', 'daily-complete', 'daily-under-20') then
    select nullif(btrim(assignment.venue), '')
      into new.venue
    from public.weekly_trick_assignments assignment
    where assignment.id = new.assignment_id;
  else
    new.venue := v_request_venue;
  end if;

  if btrim(coalesce(new.venue, '')) = '' and new.session_id is not null then
    select nullif(btrim(group_session.venue), '')
      into new.venue
    from public.coach_group_session_participants participant
    join public.coach_group_sessions group_session
      on group_session.id = participant.group_session_id
    where participant.training_session_id = new.session_id
      and participant.athlete_id = new.athlete_id
    order by participant.joined_at desc
    limit 1;
  end if;

  new.venue := coalesce(btrim(new.venue), '');
  return new;
end;
$function$;

revoke all on function private.attach_assignment_award_venue() from public, anon, authenticated;

drop trigger if exists assignment_awards_attach_venue on public.assignment_point_awards;
create trigger assignment_awards_attach_venue
  before insert or update of venue on public.assignment_point_awards
  for each row execute function private.attach_assignment_award_venue();

create or replace function public.record_assignment_action_at_venue(
  p_assignment_id uuid,
  p_action text default 'landed',
  p_venue text default ''
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $function$
begin
  perform set_config('jkcrew.venue', coalesce(btrim(p_venue), ''), true);
  return public.record_assignment_action(p_assignment_id, p_action);
end;
$function$;

revoke all on function public.record_assignment_action_at_venue(uuid, text, text) from public, anon;
grant execute on function public.record_assignment_action_at_venue(uuid, text, text) to authenticated;

create or replace function public.set_percentage_attempt_at_venue(
  p_assignment_id uuid,
  p_attempt_number integer,
  p_landed boolean default null,
  p_venue text default ''
)
returns table (
  assignment_id uuid,
  attempt_number integer,
  landed boolean,
  attempts integer,
  landed_count integer,
  missed_count integer,
  percentage integer,
  complete boolean,
  points_awarded integer,
  points_removed integer
)
language plpgsql
security invoker
set search_path = public
as $function$
begin
  perform set_config('jkcrew.venue', coalesce(btrim(p_venue), ''), true);
  return query
  select * from public.set_percentage_attempt(p_assignment_id, p_attempt_number, p_landed);
end;
$function$;

revoke all on function public.set_percentage_attempt_at_venue(uuid, integer, boolean, text) from public, anon;
grant execute on function public.set_percentage_attempt_at_venue(uuid, integer, boolean, text) to authenticated;

update public.assignment_point_awards award
set venue = btrim(assignment.venue)
from public.weekly_trick_assignments assignment
where assignment.id = award.assignment_id
  and split_part(award.award_key, ':', 1) in ('daily', 'daily-complete', 'daily-under-20')
  and btrim(coalesce(award.venue, '')) = ''
  and btrim(coalesce(assignment.venue, '')) <> '';

update public.assignment_point_awards award
set venue = btrim(group_session.venue)
from public.coach_group_session_participants participant
join public.coach_group_sessions group_session
  on group_session.id = participant.group_session_id
where participant.training_session_id = award.session_id
  and participant.athlete_id = award.athlete_id
  and btrim(coalesce(award.venue, '')) = ''
  and btrim(coalesce(group_session.venue, '')) <> '';

create table if not exists public.park_king_snapshots (
  venue_key text primary key,
  venue_name text not null,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  display_name text not null,
  avatar jsonb not null default '{}'::jsonb,
  points integer not null check (points > 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.park_king_events (
  id uuid primary key default gen_random_uuid(),
  venue_key text not null,
  venue_name text not null,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  display_name text not null,
  points integer not null check (points > 0),
  created_at timestamptz not null default now()
);

create index if not exists park_king_events_created_idx
  on public.park_king_events (created_at desc);

create index if not exists park_king_snapshots_athlete_idx
  on public.park_king_snapshots (athlete_id);

create index if not exists park_king_events_athlete_idx
  on public.park_king_events (athlete_id);

alter table public.park_king_snapshots enable row level security;
alter table public.park_king_events enable row level security;

drop policy if exists "Authenticated users view park kings" on public.park_king_snapshots;
create policy "Authenticated users view park kings"
  on public.park_king_snapshots for select to authenticated
  using ((select auth.uid()) is not null);

drop policy if exists "Authenticated users view park king events" on public.park_king_events;
create policy "Authenticated users view park king events"
  on public.park_king_events for select to authenticated
  using ((select auth.uid()) is not null);

revoke all on public.park_king_snapshots from anon, authenticated;
revoke all on public.park_king_events from anon, authenticated;
grant select on public.park_king_snapshots to authenticated;
grant select on public.park_king_events to authenticated;

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
set search_path = public, private
as $function$
  with requested as (
    select lower(btrim(coalesce(p_venue, ''))) as venue_key,
           btrim(coalesce(p_venue, '')) as venue_name
  ),
  scores as (
    select
      requested.venue_key,
      max(award.venue) as venue_name,
      profile.id as athlete_id,
      profile.display_name,
      profile.avatar,
      sum(
        case
          when split_part(award.award_key, ':', 1) in ('daily', 'daily-complete') then 1
          else greatest(award.points, 0)
        end
      )::integer as points,
      max(award.created_at) as latest_point_at
    from requested
    join public.assignment_point_awards award
      on lower(btrim(award.venue)) = requested.venue_key
    join public.profiles profile
      on profile.id = award.athlete_id
     and profile.role = 'athlete'
    cross join lateral public.jkcrew_week_bounds(coalesce(nullif(profile.country_code, ''), 'AU')) bounds
    where requested.venue_key <> ''
      and award.created_at >= bounds.week_start_ts
      and award.created_at < bounds.next_week_start_ts
      and split_part(award.award_key, ':', 1) in ('daily', 'daily-complete', 'dialled', 'one_bang', 'percentage', 'bonus')
    group by requested.venue_key, profile.id, profile.display_name, profile.avatar
  )
  select
    scores.venue_key,
    coalesce(nullif(scores.venue_name, ''), initcap(scores.venue_key)),
    scores.athlete_id,
    scores.display_name,
    scores.avatar,
    scores.points
  from scores
  where scores.points > 0
  order by scores.points desc, scores.latest_point_at asc, scores.display_name asc
  limit 1;
$function$;

revoke all on function private.jkcrew_current_park_king(text) from public, anon, authenticated;

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
set search_path = public, private
as $function$
begin
  if auth.uid() is null then
    raise exception 'Sign in to view King of the Park.';
  end if;

  return query select * from private.jkcrew_current_park_king(p_venue);
end;
$function$;

revoke all on function public.get_park_king(text) from public, anon;
grant execute on function public.get_park_king(text) to authenticated;

create or replace function private.refresh_park_king(
  p_venue text,
  p_event_key text
)
returns void
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  v_key text := lower(btrim(coalesce(p_venue, '')));
  v_previous public.park_king_snapshots%rowtype;
  v_current record;
  v_event_id uuid;
begin
  if v_key = '' then return; end if;

  select * into v_previous
  from public.park_king_snapshots snapshot
  where snapshot.venue_key = v_key;

  select * into v_current
  from private.jkcrew_current_park_king(p_venue);

  if v_current.athlete_id is null then
    delete from public.park_king_snapshots where venue_key = v_key;
    return;
  end if;

  insert into public.park_king_snapshots (
    venue_key, venue_name, athlete_id, display_name, avatar, points, updated_at
  ) values (
    v_current.venue_key, v_current.venue_name, v_current.athlete_id,
    v_current.display_name, v_current.avatar, v_current.points, now()
  )
  on conflict (venue_key) do update set
    venue_name = excluded.venue_name,
    athlete_id = excluded.athlete_id,
    display_name = excluded.display_name,
    avatar = excluded.avatar,
    points = excluded.points,
    updated_at = excluded.updated_at;

  if v_previous.athlete_id is not distinct from v_current.athlete_id then
    return;
  end if;

  insert into public.park_king_events (
    venue_key, venue_name, athlete_id, display_name, points
  ) values (
    v_current.venue_key, v_current.venue_name, v_current.athlete_id,
    v_current.display_name, v_current.points
  ) returning id into v_event_id;

  insert into public.push_notification_queue (
    recipient_id, notification_type, title, body, url, payload, dedupe_key
  )
  select
    profile.id,
    'park_king_changed',
    'New King of the Park',
    v_current.display_name || ' is now King of ' || v_current.venue_name || ' with ' || v_current.points || ' park points.',
    './?push=session',
    jsonb_build_object(
      'view', 'session',
      'venue', v_current.venue_name,
      'athlete_id', v_current.athlete_id,
      'points', v_current.points,
      'event_id', v_event_id
    ),
    'park-king:' || v_event_id || ':' || profile.id
  from public.profiles profile
  where profile.role = 'athlete'
    and exists (
      select 1 from public.push_subscriptions subscription
      where subscription.user_id = profile.id and subscription.enabled
    )
  on conflict (dedupe_key) do nothing;
exception when others then
  raise warning 'JKCREW park king refresh skipped: %', sqlerrm;
end;
$function$;

revoke all on function private.refresh_park_king(text, text) from public, anon, authenticated;

insert into public.park_king_snapshots (
  venue_key, venue_name, athlete_id, display_name, avatar, points, updated_at
)
select king.venue_key, king.venue_name, king.athlete_id, king.display_name, king.avatar, king.points, now()
from (
  select distinct btrim(award.venue) as venue
  from public.assignment_point_awards award
  where btrim(award.venue) <> ''
) venue
cross join lateral private.jkcrew_current_park_king(venue.venue) king
on conflict (venue_key) do update set
  venue_name = excluded.venue_name,
  athlete_id = excluded.athlete_id,
  display_name = excluded.display_name,
  avatar = excluded.avatar,
  points = excluded.points,
  updated_at = excluded.updated_at;

create or replace function private.handle_park_king_award_change()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  v_old_prefix text := '';
  v_new_prefix text := '';
  v_event_key text;
begin
  if tg_op = 'DELETE' then
    v_old_prefix := split_part(old.award_key, ':', 1);
    v_event_key := tg_table_name || ':' || tg_op || ':' || old.id::text || ':' || gen_random_uuid()::text;
  elsif tg_op = 'INSERT' then
    v_new_prefix := split_part(new.award_key, ':', 1);
    v_event_key := tg_table_name || ':' || tg_op || ':' || new.id::text || ':' || gen_random_uuid()::text;
  else
    v_old_prefix := split_part(old.award_key, ':', 1);
    v_new_prefix := split_part(new.award_key, ':', 1);
    v_event_key := tg_table_name || ':' || tg_op || ':' || new.id::text || ':' || gen_random_uuid()::text;
  end if;

  if tg_op <> 'INSERT'
     and v_old_prefix in ('daily', 'daily-complete', 'dialled', 'one_bang', 'percentage', 'bonus')
     and btrim(coalesce(old.venue, '')) <> ''
     and (tg_op = 'DELETE' or lower(btrim(old.venue)) is distinct from lower(btrim(new.venue))) then
    perform private.refresh_park_king(old.venue, v_event_key || ':old');
  end if;

  if tg_op <> 'DELETE'
     and v_new_prefix in ('daily', 'daily-complete', 'dialled', 'one_bang', 'percentage', 'bonus')
     and btrim(coalesce(new.venue, '')) <> ''
     and (tg_op = 'INSERT' or lower(btrim(new.venue)) is distinct from lower(btrim(old.venue)) or new.points is distinct from old.points) then
    perform private.refresh_park_king(new.venue, v_event_key || ':new');
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
exception when others then
  raise warning 'JKCREW park king trigger skipped: %', sqlerrm;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

revoke all on function private.handle_park_king_award_change() from public, anon, authenticated;

drop trigger if exists assignment_awards_refresh_park_king on public.assignment_point_awards;
create trigger assignment_awards_refresh_park_king
  after insert or update or delete on public.assignment_point_awards
  for each row execute function private.handle_park_king_award_change();

do $block$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'park_king_events'
    )
  then
    alter publication supabase_realtime add table public.park_king_events;
  end if;
end;
$block$;
