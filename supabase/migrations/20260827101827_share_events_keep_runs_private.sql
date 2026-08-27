-- Events are a shared JKCREW catalogue. Riders join an event instead of
-- creating private duplicates. Run plans remain protected by their existing
-- owner / linked-coach RLS policies and are never exposed through this table.

create table if not exists public.event_attendees (
  event_id uuid not null references public.dashboard_items(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, athlete_id)
);

create index if not exists event_attendees_athlete_created_idx
  on public.event_attendees (athlete_id, created_at desc);

-- Prevent two active catalogue entries with the same title and UTC start day.
create unique index if not exists dashboard_items_active_event_identity_idx
  on public.dashboard_items (
    lower(btrim(title)),
    coalesce((due_at at time zone 'UTC')::date, date '9999-12-31')
  )
  where item_type = 'event' and completed = false;

alter table public.event_attendees enable row level security;

revoke all on public.event_attendees from anon, authenticated;
grant select, insert, delete on public.event_attendees to authenticated;

-- Return only the public-facing identity needed by the attendee list. This
-- avoids granting riders broad SELECT access to one another's profile rows.
create or replace function public.get_active_event_attendees(p_event_ids uuid[] default null)
returns table (
  event_id uuid,
  athlete_id uuid,
  created_at timestamptz,
  display_name text,
  avatar jsonb
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    attendee.event_id,
    attendee.athlete_id,
    attendee.created_at,
    profile.display_name,
    profile.avatar
  from public.event_attendees attendee
  join public.dashboard_items event on event.id = attendee.event_id
  join public.profiles profile on profile.id = attendee.athlete_id
  where (select auth.uid()) is not null
    and (p_event_ids is null or attendee.event_id = any(p_event_ids))
    and event.item_type = 'event'
    and event.completed = false
    and coalesce(event.end_at, event.due_at + interval '1 day', 'infinity'::timestamptz) >= now()
  order by attendee.created_at;
$$;

revoke all on function public.get_active_event_attendees(uuid[]) from public, anon;
grant execute on function public.get_active_event_attendees(uuid[]) to authenticated;

drop policy if exists "Active events are visible to authenticated crew" on public.dashboard_items;
create policy "Active events are visible to authenticated crew"
  on public.dashboard_items
  for select
  to authenticated
  using (
    item_type = 'event'
    and completed = false
    and coalesce(end_at, due_at + interval '1 day', 'infinity'::timestamptz) >= now()
  );

drop policy if exists "Crew can view active event attendance" on public.event_attendees;
create policy "Crew can view active event attendance"
  on public.event_attendees
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.dashboard_items event
      where event.id = event_attendees.event_id
        and event.item_type = 'event'
        and event.completed = false
        and coalesce(event.end_at, event.due_at + interval '1 day', 'infinity'::timestamptz) >= now()
    )
  );

drop policy if exists "Riders can join active events" on public.event_attendees;
create policy "Riders can join active events"
  on public.event_attendees
  for insert
  to authenticated
  with check (
    athlete_id = (select auth.uid())
    and exists (
      select 1
      from public.dashboard_items event
      where event.id = event_attendees.event_id
        and event.item_type = 'event'
        and event.completed = false
        and coalesce(event.end_at, event.due_at + interval '1 day', 'infinity'::timestamptz) >= now()
    )
  );

drop policy if exists "Riders can leave events" on public.event_attendees;
create policy "Riders can leave events"
  on public.event_attendees
  for delete
  to authenticated
  using (athlete_id = (select auth.uid()));

-- Every existing event creator is treated as attending their event.
insert into public.event_attendees (event_id, athlete_id)
select event.id, event.owner_id
from public.dashboard_items event
join public.profiles profile on profile.id = event.owner_id
where event.item_type = 'event'
on conflict (event_id, athlete_id) do nothing;

-- Run plans are private between the rider and their linked coach. Parents and
-- other riders do not receive the route, trick notes or uploaded park photo.
drop policy if exists "Parents can view child run plans" on public.run_plans;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'dashboard_items'
  ) then
    alter publication supabase_realtime add table public.dashboard_items;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'event_attendees'
  ) then
    alter publication supabase_realtime add table public.event_attendees;
  end if;
end;
$$;
