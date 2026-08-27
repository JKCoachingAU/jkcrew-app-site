-- Beenleigh and Beenleigh Skate Park are the same riding location. Keep the
-- historical rows intact (including linked progress/XP), but expose one
-- canonical location and return only each rider's newest saved Daily list.

create table if not exists private.retired_coach_venue_backups (
  venue_id uuid primary key,
  retired_at timestamptz not null default now(),
  reason text not null,
  venue jsonb not null
);

revoke all on private.retired_coach_venue_backups from public, anon, authenticated;

insert into private.retired_coach_venue_backups (venue_id, reason, venue)
select
  duplicate.id,
  'Merged duplicate location into Beenleigh',
  to_jsonb(duplicate)
from public.coach_venues duplicate
where lower(regexp_replace(btrim(duplicate.name), '[^[:alnum:]]+', '', 'g')) = 'beenleighskatepark'
on conflict (venue_id) do nothing;

delete from public.coach_venues duplicate
where lower(regexp_replace(btrim(duplicate.name), '[^[:alnum:]]+', '', 'g')) = 'beenleighskatepark'
  and exists (
    select 1
    from public.coach_venues canonical
    where canonical.coach_id = duplicate.coach_id
      and canonical.id <> duplicate.id
      and lower(regexp_replace(btrim(canonical.name), '[^[:alnum:]]+', '', 'g')) = 'beenleigh'
  );

update public.coach_venues venue
set name = 'Beenleigh',
    updated_at = now()
where lower(regexp_replace(btrim(venue.name), '[^[:alnum:]]+', '', 'g')) in ('beenleigh', 'beenleighskatepark')
  and venue.name <> 'Beenleigh';

drop index if exists public.weekly_trick_assignments_latest_daily_location_idx;

create or replace function private.jkcrew_venue_key(p_venue text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $function$
  with normalized as (
    select lower(regexp_replace(btrim(coalesce(p_venue, '')), '[^[:alnum:]]+', '', 'g')) as venue_key
  )
  select case normalized.venue_key
    when 'beenleighskatepark' then 'beenleigh'
    else normalized.venue_key
  end
  from normalized;
$function$;

create index weekly_trick_assignments_latest_daily_location_idx
  on public.weekly_trick_assignments (
    athlete_id,
    private.jkcrew_venue_key(venue),
    week_start desc,
    sort_order
  )
  include (updated_at)
  where category = 'daily';

create or replace function public.get_effective_weekly_assignments(
  p_athlete_id uuid,
  p_week_start date
)
returns table (
  id uuid,
  coach_id uuid,
  athlete_id uuid,
  week_start date,
  trick_name text,
  category text,
  target_reps integer,
  notes text,
  sort_order integer,
  created_at timestamptz,
  updated_at timestamptz,
  venue text,
  requested_week_start date,
  using_fallback boolean
)
language sql
stable
security definer
set search_path = public, private, pg_temp
as $function$
  with actor as (
    select profile.role::text as role
    from public.profiles profile
    where profile.id = auth.uid()
  ),
  allowed as (
    select p_athlete_id as athlete_id, p_week_start as requested_week_start
    from actor
    where p_athlete_id is not null
      and p_week_start is not null
      and (
        auth.uid() = p_athlete_id
        or actor.role = 'admin'
        or (
          actor.role = 'coach'
          and exists (
            select 1
            from public.coach_athletes link
            where link.coach_id = auth.uid()
              and link.athlete_id = p_athlete_id
          )
        )
        or exists (
          select 1
          from public.parent_athletes link
          where link.parent_id = auth.uid()
            and link.athlete_id = p_athlete_id
        )
      )
  ),
  daily_lists as (
    select
      assignment.athlete_id,
      allowed.requested_week_start,
      private.jkcrew_venue_key(assignment.venue) as venue_key,
      lower(regexp_replace(btrim(assignment.venue), '[^[:alnum:]]+', '', 'g')) as source_venue_key,
      assignment.week_start,
      max(assignment.updated_at) as saved_at,
      max(assignment.created_at) as created_at,
      max(assignment.sort_order) as last_sort_order
    from allowed
    join public.weekly_trick_assignments assignment
      on assignment.athlete_id = allowed.athlete_id
     and assignment.category = 'daily'
     and assignment.week_start <= allowed.requested_week_start
    group by
      assignment.athlete_id,
      allowed.requested_week_start,
      private.jkcrew_venue_key(assignment.venue),
      lower(regexp_replace(btrim(assignment.venue), '[^[:alnum:]]+', '', 'g')),
      assignment.week_start
  ),
  latest_daily_lists as (
    select distinct on (athlete_id, requested_week_start, venue_key)
      athlete_id,
      requested_week_start,
      venue_key,
      source_venue_key,
      week_start as source_week_start
    from daily_lists
    order by
      athlete_id,
      requested_week_start,
      venue_key,
      saved_at desc,
      created_at desc,
      week_start desc,
      last_sort_order desc,
      source_venue_key desc
  ),
  selected as (
    select
      assignment.*,
      allowed.requested_week_start,
      false as using_fallback
    from allowed
    join public.weekly_trick_assignments assignment
      on assignment.athlete_id = allowed.athlete_id
     and assignment.week_start = allowed.requested_week_start
     and assignment.category <> 'daily'

    union all

    select
      assignment.*,
      latest.requested_week_start,
      assignment.week_start <> latest.requested_week_start as using_fallback
    from latest_daily_lists latest
    join public.weekly_trick_assignments assignment
      on assignment.athlete_id = latest.athlete_id
     and assignment.category = 'daily'
     and assignment.week_start = latest.source_week_start
     and private.jkcrew_venue_key(assignment.venue) = latest.venue_key
     and lower(regexp_replace(btrim(assignment.venue), '[^[:alnum:]]+', '', 'g')) = latest.source_venue_key
  )
  select
    selected.id,
    selected.coach_id,
    selected.athlete_id,
    selected.week_start,
    selected.trick_name,
    selected.category,
    selected.target_reps,
    selected.notes,
    selected.sort_order,
    selected.created_at,
    selected.updated_at,
    selected.venue,
    selected.requested_week_start,
    selected.using_fallback
  from selected
  order by selected.sort_order, selected.id;
$function$;

revoke all on function public.get_effective_weekly_assignments(uuid, date) from public, anon;
grant execute on function public.get_effective_weekly_assignments(uuid, date) to authenticated;

comment on function public.get_effective_weekly_assignments(uuid, date) is
  'Returns current non-Daily assignments plus one newest saved Daily list for every canonical riding location, including the merged Beenleigh aliases.';

create or replace function public.get_coach_session_viewer_plan_data(
  p_athlete_ids uuid[],
  p_week_starts date[]
)
returns table (
  id uuid,
  coach_id uuid,
  athlete_id uuid,
  week_start date,
  trick_name text,
  category text,
  target_reps integer,
  notes text,
  sort_order integer,
  created_at timestamptz,
  updated_at timestamptz,
  venue text,
  requested_week_start date,
  using_fallback boolean,
  progress jsonb,
  percentage_attempts jsonb,
  assignment_attempts jsonb,
  awards jsonb
)
language sql
stable
security definer
set search_path = public, private, pg_temp
as $function$
  with viewer as (
    select profile.role::text as role
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.role::text in ('coach', 'admin')
  ),
  requested as (
    select distinct input.athlete_id, input.requested_week_start
    from unnest(p_athlete_ids, p_week_starts) as input(athlete_id, requested_week_start)
    where input.athlete_id is not null
      and input.requested_week_start is not null
  ),
  allowed as (
    select requested.athlete_id, requested.requested_week_start
    from requested
    cross join viewer
    where viewer.role = 'admin'
       or exists (
         select 1
         from public.coach_athletes link
         where link.coach_id = auth.uid()
           and link.athlete_id = requested.athlete_id
       )
  ),
  daily_lists as (
    select
      assignment.athlete_id,
      allowed.requested_week_start,
      private.jkcrew_venue_key(assignment.venue) as venue_key,
      lower(regexp_replace(btrim(assignment.venue), '[^[:alnum:]]+', '', 'g')) as source_venue_key,
      assignment.week_start,
      max(assignment.updated_at) as saved_at,
      max(assignment.created_at) as created_at,
      max(assignment.sort_order) as last_sort_order
    from allowed
    join public.weekly_trick_assignments assignment
      on assignment.athlete_id = allowed.athlete_id
     and assignment.category = 'daily'
     and assignment.week_start <= allowed.requested_week_start
    group by
      assignment.athlete_id,
      allowed.requested_week_start,
      private.jkcrew_venue_key(assignment.venue),
      lower(regexp_replace(btrim(assignment.venue), '[^[:alnum:]]+', '', 'g')),
      assignment.week_start
  ),
  latest_daily_lists as (
    select distinct on (athlete_id, requested_week_start, venue_key)
      athlete_id,
      requested_week_start,
      venue_key,
      source_venue_key,
      week_start as source_week_start
    from daily_lists
    order by
      athlete_id,
      requested_week_start,
      venue_key,
      saved_at desc,
      created_at desc,
      week_start desc,
      last_sort_order desc,
      source_venue_key desc
  ),
  selected as (
    select
      assignment.*,
      allowed.requested_week_start,
      false as using_fallback
    from allowed
    join public.weekly_trick_assignments assignment
      on assignment.athlete_id = allowed.athlete_id
     and assignment.week_start = allowed.requested_week_start
     and assignment.category <> 'daily'

    union all

    select
      assignment.*,
      latest.requested_week_start,
      assignment.week_start <> latest.requested_week_start as using_fallback
    from latest_daily_lists latest
    join public.weekly_trick_assignments assignment
      on assignment.athlete_id = latest.athlete_id
     and assignment.category = 'daily'
     and assignment.week_start = latest.source_week_start
     and private.jkcrew_venue_key(assignment.venue) = latest.venue_key
     and lower(regexp_replace(btrim(assignment.venue), '[^[:alnum:]]+', '', 'g')) = latest.source_venue_key
  )
  select
    selected.id,
    selected.coach_id,
    selected.athlete_id,
    selected.week_start,
    selected.trick_name,
    selected.category,
    selected.target_reps,
    selected.notes,
    selected.sort_order,
    selected.created_at,
    selected.updated_at,
    selected.venue,
    selected.requested_week_start,
    selected.using_fallback,
    to_jsonb(progress_row) as progress,
    coalesce((
      select jsonb_agg(to_jsonb(percentage_row) order by percentage_row.attempt_number)
      from public.percentage_attempts percentage_row
      where percentage_row.assignment_id = selected.id
    ), '[]'::jsonb) as percentage_attempts,
    coalesce((
      select jsonb_agg(to_jsonb(attempt_row) order by attempt_row.attempted_at desc)
      from public.assignment_attempts attempt_row
      where attempt_row.assignment_id = selected.id
        and attempt_row.week_start = selected.requested_week_start
    ), '[]'::jsonb) as assignment_attempts,
    coalesce((
      select jsonb_agg(to_jsonb(award_row) order by award_row.created_at desc)
      from public.assignment_point_awards award_row
      where award_row.assignment_id = selected.id
        and award_row.created_at >= now() - interval '8 days'
    ), '[]'::jsonb) as awards
  from selected
  left join public.assignment_progress progress_row
    on progress_row.assignment_id = selected.id
  order by selected.athlete_id, selected.sort_order, selected.id;
$function$;

revoke all on function public.get_coach_session_viewer_plan_data(uuid[], date[]) from public, anon;
grant execute on function public.get_coach_session_viewer_plan_data(uuid[], date[]) to authenticated;

comment on function public.get_coach_session_viewer_plan_data(uuid[], date[]) is
  'Returns coach-authorized current assignments and one newest Daily list for every canonical location, including the merged Beenleigh aliases.';
