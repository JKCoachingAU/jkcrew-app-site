alter table public.profiles
  add column if not exists manual_tricktionary jsonb not null default '[]'::jsonb,
  add column if not exists daily_pb_seconds integer,
  add column if not exists daily_pb_updated_at timestamptz;

alter table public.training_sessions
  add column if not exists daily_completed_seconds integer,
  add column if not exists daily_completed_at timestamptz;

alter table public.coach_group_session_participants
  add column if not exists daily_finished_at timestamptz,
  add column if not exists daily_finish_seconds integer;

create table if not exists public.assignment_attempts (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.weekly_trick_assignments(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  coach_id uuid,
  trick_name text not null,
  category text not null,
  week_start date not null,
  venue text,
  session_id uuid references public.training_sessions(id) on delete set null,
  group_session_id uuid references public.coach_group_sessions(id) on delete set null,
  source text not null default 'rider' check (source in ('rider', 'coach', 'group_session')),
  attempted_at timestamptz not null default now()
);

create index if not exists assignment_attempts_athlete_week_idx
  on public.assignment_attempts (athlete_id, week_start, attempted_at desc);

create index if not exists assignment_attempts_assignment_idx
  on public.assignment_attempts (assignment_id, attempted_at desc);

alter table public.assignment_attempts enable row level security;

grant select, insert on public.assignment_attempts to authenticated;

drop policy if exists "Riders insert own assignment attempts" on public.assignment_attempts;
create policy "Riders insert own assignment attempts"
on public.assignment_attempts
for insert
to authenticated
with check (athlete_id = auth.uid());

drop policy if exists "Riders view own assignment attempts" on public.assignment_attempts;
create policy "Riders view own assignment attempts"
on public.assignment_attempts
for select
to authenticated
using (athlete_id = auth.uid());

drop policy if exists "Coaches view linked assignment attempts" on public.assignment_attempts;
create policy "Coaches view linked assignment attempts"
on public.assignment_attempts
for select
to authenticated
using (
  exists (
    select 1
    from public.coach_athletes ca
    where ca.coach_id = auth.uid()
      and ca.athlete_id = assignment_attempts.athlete_id
  )
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('coach', 'admin')
  )
);

drop policy if exists "Parents view linked assignment attempts" on public.assignment_attempts;
create policy "Parents view linked assignment attempts"
on public.assignment_attempts
for select
to authenticated
using (
  exists (
    select 1
    from public.parent_athletes pa
    where pa.parent_id = auth.uid()
      and pa.athlete_id = assignment_attempts.athlete_id
  )
);

create or replace function public.record_assignment_attempt(p_assignment_id uuid, p_group_session_id uuid default null)
returns table(message text, assignment_id uuid, athlete_id uuid, trick_name text, category text, attempt_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  assignment_row public.weekly_trick_assignments%rowtype;
  active_session_id uuid;
  source_label text := 'rider';
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into assignment_row
  from public.weekly_trick_assignments
  where id = p_assignment_id;

  if assignment_row.id is null then
    raise exception 'Assignment not found';
  end if;

  if not (
    auth.uid() = assignment_row.athlete_id
    or exists (
      select 1
      from public.coach_athletes ca
      where ca.coach_id = auth.uid()
        and ca.athlete_id = assignment_row.athlete_id
    )
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role in ('coach', 'admin')
    )
  ) then
    raise exception 'Not allowed to record this attempt';
  end if;

  if auth.uid() <> assignment_row.athlete_id then
    source_label := case when p_group_session_id is null then 'coach' else 'group_session' end;
  end if;

  select id into active_session_id
  from public.training_sessions
  where athlete_id = assignment_row.athlete_id
    and ended_at is null
  order by started_at desc
  limit 1;

  insert into public.assignment_attempts (
    assignment_id,
    athlete_id,
    coach_id,
    trick_name,
    category,
    week_start,
    venue,
    session_id,
    group_session_id,
    source
  )
  values (
    assignment_row.id,
    assignment_row.athlete_id,
    case when auth.uid() = assignment_row.athlete_id then null else auth.uid() end,
    assignment_row.trick_name,
    assignment_row.category,
    assignment_row.week_start,
    assignment_row.venue,
    active_session_id,
    p_group_session_id,
    source_label
  );

  return query
  select
    'Attempt saved'::text,
    assignment_row.id,
    assignment_row.athlete_id,
    assignment_row.trick_name,
    assignment_row.category,
    count(*)::integer
  from public.assignment_attempts aa
  where aa.assignment_id = assignment_row.id;
end;
$$;

revoke all on function public.record_assignment_attempt(uuid, uuid) from public;
grant execute on function public.record_assignment_attempt(uuid, uuid) to authenticated;

create or replace function public.finish_group_session_daily(p_group_session_id uuid, p_athlete_id uuid, p_seconds integer)
returns table(message text, athlete_id uuid, daily_finish_seconds integer, previous_pb_seconds integer, new_pb_seconds integer, is_new_pb boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  session_row public.coach_group_sessions%rowtype;
  old_pb integer;
  seconds_value integer := greatest(0, coalesce(p_seconds, 0));
  pb_changed boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into session_row
  from public.coach_group_sessions
  where id = p_group_session_id;

  if session_row.id is null then
    raise exception 'Group session not found';
  end if;

  if not (
    session_row.coach_id = auth.uid()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role in ('coach', 'admin')
    )
  ) then
    raise exception 'Only the coach can finish rider Daily timers';
  end if;

  select daily_pb_seconds into old_pb
  from public.profiles
  where id = p_athlete_id;

  update public.coach_group_session_participants
  set daily_finished_at = now(),
      daily_finish_seconds = seconds_value,
      last_activity_at = now()
  where group_session_id = p_group_session_id
    and athlete_id = p_athlete_id;

  if old_pb is null or seconds_value < old_pb then
    update public.profiles
    set daily_pb_seconds = seconds_value,
        daily_pb_updated_at = now(),
        updated_at = now()
    where id = p_athlete_id;
    pb_changed := true;
  end if;

  return query
  select
    case when pb_changed then 'New Daily PB' else 'Daily finish time saved' end,
    p_athlete_id,
    seconds_value,
    old_pb,
    coalesce((select daily_pb_seconds from public.profiles where id = p_athlete_id), seconds_value),
    pb_changed;
end;
$$;

revoke all on function public.finish_group_session_daily(uuid, uuid, integer) from public;
grant execute on function public.finish_group_session_daily(uuid, uuid, integer) to authenticated;

create or replace function public.recalculate_athlete_points(p_athlete_id uuid)
returns table(athlete_id uuid, weekly_points integer, all_time_points integer, point_events integer)
language sql
security definer
set search_path = public
as $$
  with allowed as (
    select exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role in ('coach', 'admin')
    ) as ok
  ),
  history as (
    select *
    from public.get_point_history(p_athlete_id)
    where (select ok from allowed)
  )
  select
    p_athlete_id,
    coalesce(sum(points) filter (where event_at >= (date_trunc('week', now() + interval '1 day') - interval '1 day')), 0)::integer as weekly_points,
    coalesce(sum(points), 0)::integer as all_time_points,
    count(*)::integer as point_events
  from history;
$$;

revoke all on function public.recalculate_athlete_points(uuid) from public;
grant execute on function public.recalculate_athlete_points(uuid) to authenticated;
