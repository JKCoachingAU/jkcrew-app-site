-- A park record belongs to one rider, training session, venue and riding day.
-- Sessions left open across venues or days must not transfer earlier points.
-- This changes only the crown calculation/cache; all earned awards stay intact.
set local lock_timeout = '5s';
set local statement_timeout = '30s';
-- Keep old-rule in-flight score triggers from overwriting the repaired cache.
-- Supabase applies the migration in one transaction; reads remain available.
lock table public.assignment_point_awards, public.training_sessions in share mode;

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
as $function$
  with requested as (
    select private.jkcrew_venue_key(p_venue) as venue_key
  ), eligible_sessions as (
    select distinct award.session_id
    from public.assignment_point_awards award
    cross join requested
    where award.session_id is not null
      and requested.venue_key <> ''
      and btrim(award.venue) <> ''
      and private.jkcrew_venue_key(award.venue) = requested.venue_key
  ), session_awards as (
    select
      session.id as session_id,
      session.athlete_id,
      award.created_at,
      award.points,
      split_part(award.award_key, ':', 1) as award_type,
      private.jkcrew_venue_key(award.venue) as venue_key,
      btrim(award.venue) as venue_name,
      (award.created_at at time zone public.jkcrew_country_timezone(profile.country_code))::date as riding_day
    from eligible_sessions eligible
    join public.training_sessions session on session.id = eligible.session_id
    join public.profiles profile on profile.id = session.athlete_id and profile.role = 'athlete'
    join public.assignment_point_awards award
      on award.session_id = session.id
     and award.athlete_id = session.athlete_id
  ), session_day_venues as (
    -- Older Lines awards have no venue. Retain them only if the same session
    -- and day have exactly one known park; never guess across multiple parks.
    select session_id, riding_day,
      count(distinct venue_key) filter (where venue_key <> '') as venue_count,
      max(venue_key) filter (where venue_key <> '') as venue_key,
      max(venue_name) filter (where venue_key <> '') as venue_name
    from session_awards
    group by session_id, riding_day
  ), located_awards as (
    select award.*,
      case when award.venue_key <> '' then award.venue_key
        when locations.venue_count = 1 then locations.venue_key else '' end as resolved_venue_key,
      case when award.venue_key <> '' then award.venue_name
        when locations.venue_count = 1 then locations.venue_name else '' end as resolved_venue_name
    from session_awards award
    join session_day_venues locations using (session_id, riding_day)
  ), daily_completions as (
    -- Retain the existing same-rider/park/day recovery for detached daily
    -- awards, but compare to the award day, never an old session start day.
    -- A legacy under-20 row is completion evidence only: it adds no bonus.
    select award.athlete_id,
      (award.created_at at time zone public.jkcrew_country_timezone(profile.country_code))::date as riding_day,
      min(award.created_at) as completed_at
    from public.assignment_point_awards award
    join public.profiles profile on profile.id = award.athlete_id and profile.role = 'athlete'
    cross join requested
    where requested.venue_key <> ''
      and private.jkcrew_venue_key(award.venue) = requested.venue_key
      and award.points > 0
      and split_part(award.award_key, ':', 1) in ('daily', 'daily-complete', 'daily-under-20')
    group by award.athlete_id,
      (award.created_at at time zone public.jkcrew_country_timezone(profile.country_code))::date
  ), session_day_scores as (
    select award.session_id, award.athlete_id, award.riding_day,
      award.resolved_venue_key as venue_key,
      max(award.resolved_venue_name) as venue_name,
      coalesce(sum(award.points) filter (where award.points > 0 and award.award_type in
        ('dialled', 'one_bang', 'percentage', 'lines', 'bonus')), 0)::integer as trick_points,
      max(award.created_at) filter (where award.points > 0 and award.award_type in
        ('dialled', 'one_bang', 'percentage', 'lines', 'bonus')) as tricks_achieved_at,
      min(award.created_at) filter (where award.points > 0 and award.award_type in
        ('daily', 'daily-complete', 'daily-under-20')) as daily_completed_at
    from located_awards award
    cross join requested
    where award.resolved_venue_key = requested.venue_key
      and requested.venue_key <> ''
    group by award.session_id, award.athlete_id, award.riding_day, award.resolved_venue_key
  ), scored_sessions as (
    select scored.venue_key, scored.venue_name, scored.athlete_id,
      (scored.trick_points + case when coalesce(scored.daily_completed_at, daily.completed_at) is not null
        then 1 else 0 end)::integer as points,
      -- Only contributing scores determine when the record was achieved.
      -- First-finish, under-20 bonus points and later unrelated awards cannot
      -- change who won a tied record. Daily completion is capped at one.
      greatest(scored.tricks_achieved_at, least(scored.daily_completed_at, daily.completed_at)) as achieved_at
    from session_day_scores scored
    left join daily_completions daily using (athlete_id, riding_day)
  )
  select scored.venue_key, scored.venue_name, scored.athlete_id,
    coalesce(nullif(btrim(profile.display_name), ''), 'Rider') as display_name,
    coalesce(profile.avatar, '{}'::jsonb) as avatar,
    scored.points
  from scored_sessions scored
  join public.profiles profile on profile.id = scored.athlete_id
  where scored.points > 0
  order by scored.points desc, scored.achieved_at asc,
    coalesce(nullif(btrim(profile.display_name), ''), 'Rider') asc, scored.athlete_id asc
  limit 1;
$function$;

revoke all on function private.jkcrew_current_park_king(text) from public, anon, authenticated;

-- Rebuild the derived cache quietly. Recalculation is a correction, not a new
-- rider achievement: do not call refresh_park_king, enqueue pushes or append
-- crown events. The existing crown-title trigger supplies King/Queen.
with known_venues as (
  select venue as venue_name from public.assignment_point_awards where btrim(venue) <> ''
  union
  select venue_name from public.park_king_snapshots
), venues as (
  select distinct on (private.jkcrew_venue_key(venue_name)) venue_name
  from known_venues
  where private.jkcrew_venue_key(venue_name) <> ''
  order by private.jkcrew_venue_key(venue_name), venue_name
)
insert into public.park_king_snapshots (
  venue_key, venue_name, athlete_id, display_name, avatar, points, updated_at
)
select king.venue_key, king.venue_name, king.athlete_id, king.display_name, king.avatar, king.points, now()
from venues
cross join lateral private.jkcrew_current_park_king(venues.venue_name) king
on conflict (venue_key) do update set
  venue_name = excluded.venue_name,
  athlete_id = excluded.athlete_id,
  display_name = excluded.display_name,
  avatar = excluded.avatar,
  points = excluded.points,
  updated_at = excluded.updated_at;

-- Remove only obsolete derived cache rows (empty records or alias duplicates).
delete from public.park_king_snapshots snapshot
where snapshot.venue_key <> private.jkcrew_venue_key(snapshot.venue_name)
   or not exists (select 1 from private.jkcrew_current_park_king(snapshot.venue_name));
