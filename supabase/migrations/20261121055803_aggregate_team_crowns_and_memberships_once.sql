-- A startup crown list must scan historical scores once, not once per park.
-- Keep live award-based crowns, canonical tenant membership and scoring rules.
create function private.jkcrew_current_park_kings_for_team(p_team uuid,p_venue text default null)
returns table(venue_key text,venue_name text,athlete_id uuid,display_name text,avatar jsonb,points integer)
language sql stable security definer set search_path='' as $crown$

  with requested as materialized (
    select private.jkcrew_venue_key(p_venue) as venue_key, p_venue is null as all_venues
  ), session_actors as materialized (
    select distinct session.athlete_id from public.training_sessions session
  ), actor_teams as materialized (
    -- Keep the existing canonical MIN-team semantics, once per distinct actor.
    select actor.athlete_id, private.jkcrew_profile_team_id(actor.athlete_id) as team_id
    from session_actors actor
  ), roster as materialized (
    select profile.id,profile.display_name,profile.avatar,profile.country_code
    from actor_teams actor join public.profiles profile on profile.id=actor.athlete_id
    where actor.team_id=p_team and profile.role='athlete'
  ), countries as materialized (
    select distinct profile.country_code from roster profile
  ), zones as materialized (
    -- Country/approval lookup runs per country, rather than per historical award.
    select country.country_code,public.jkcrew_country_timezone(country.country_code) as zone
    from countries country
  ), riders as materialized (
    select profile.*,zones.zone from roster profile join zones
      on zones.country_code is not distinct from profile.country_code
  ), eligible_sessions as materialized (
    select distinct award.session_id
    from public.assignment_point_awards award
    join public.training_sessions session on session.id=award.session_id and session.athlete_id=award.athlete_id
    join riders profile on profile.id=session.athlete_id
    cross join requested
    where award.session_id is not null and btrim(award.venue)<>''
      and private.jkcrew_venue_key(award.venue)<>''
      and (requested.all_venues or (requested.venue_key<>'' and private.jkcrew_venue_key(award.venue)=requested.venue_key))
  ), session_awards as materialized (
    select session.id as session_id,session.athlete_id,award.created_at,award.points,
      split_part(award.award_key,':',1) as award_type,
      private.jkcrew_venue_key(award.venue) as venue_key,btrim(award.venue) as venue_name,
      (award.created_at at time zone profile.zone)::date as riding_day
    from eligible_sessions eligible
    join public.training_sessions session on session.id=eligible.session_id
    join riders profile on profile.id=session.athlete_id
    join public.assignment_point_awards award on award.session_id=session.id and award.athlete_id=session.athlete_id
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
    select award.athlete_id,private.jkcrew_venue_key(award.venue) as venue_key,
      (award.created_at at time zone profile.zone)::date as riding_day,
      min(award.created_at) as completed_at
    from public.assignment_point_awards award
    join riders profile on profile.id=award.athlete_id
    cross join requested
    where private.jkcrew_venue_key(award.venue)<>''
      and (requested.all_venues or (requested.venue_key<>'' and private.jkcrew_venue_key(award.venue)=requested.venue_key))
      and award.points > 0
      and split_part(award.award_key, ':', 1) in ('daily', 'daily-complete', 'daily-under-20')
    group by award.athlete_id,private.jkcrew_venue_key(award.venue),
      (award.created_at at time zone profile.zone)::date
  ), session_day_scores as (
    select award.session_id, award.athlete_id, award.riding_day,
      award.resolved_venue_key as venue_key,
      max(award.resolved_venue_name) as venue_name,
      coalesce(sum(award.points) filter (where award.points > 0 and award.award_type in
        ('dialled', 'one_bang', 'percentage', 'lines', 'bonus', 'trick_links')), 0)::integer as trick_points,
      max(award.created_at) filter (where award.points > 0 and award.award_type in
        ('dialled', 'one_bang', 'percentage', 'lines', 'bonus', 'trick_links')) as tricks_achieved_at,
      min(award.created_at) filter (where award.points > 0 and award.award_type in
        ('daily', 'daily-complete', 'daily-under-20')) as daily_completed_at
    from located_awards award
    cross join requested
    where award.resolved_venue_key<>''
      and (requested.all_venues or (requested.venue_key<>'' and award.resolved_venue_key=requested.venue_key))
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
    left join daily_completions daily using (athlete_id, riding_day, venue_key)
  ), ranked as (

    select scored.*,coalesce(nullif(btrim(profile.display_name),''),'Rider') as display_name,
      coalesce(profile.avatar,'{}'::jsonb) as avatar,
      row_number() over(partition by scored.venue_key order by scored.points desc,scored.achieved_at asc,
        coalesce(nullif(btrim(profile.display_name),''),'Rider') asc,scored.athlete_id asc) as crown_order
    from scored_sessions scored join riders profile on profile.id=scored.athlete_id
    where scored.points>0
  )
  select champion.venue_key,champion.venue_name,champion.athlete_id,champion.display_name,champion.avatar,champion.points
  from ranked champion where champion.crown_order=1 order by champion.venue_key;

$crown$;
revoke all on function private.jkcrew_current_park_kings_for_team(uuid,text) from public,anon,authenticated,service_role;

create or replace function private.jkcrew_current_park_king_for_team(p_team uuid,p_venue text)
returns table(venue_key text,venue_name text,athlete_id uuid,display_name text,avatar jsonb,points integer)
language sql stable security definer set search_path='' as $crown$
  -- NULL remains an empty single-park request; only the new internal all-park
  -- helper uses NULL to request all venues.
  select * from private.jkcrew_current_park_kings_for_team(p_team,coalesce(p_venue,''));
$crown$;

CREATE OR REPLACE FUNCTION public.get_team_park_kings()
 RETURNS TABLE(venue_key text, venue_name text, athlete_id uuid, display_name text, points integer, updated_at timestamp with time zone, crown_title text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_team uuid;
begin
  perform private.require_coach_approval();
  if auth.uid() is null then raise exception 'Authentication required.' using errcode='42501'; end if;
  v_team := private.jkcrew_profile_team_id(auth.uid());
  if v_team is null then return; end if;
  -- Resolve from team awards, rather than filtering the single global winner.
  -- Live computation also handles membership changes without returning an old
  -- cached champion from a team they have left.
  return query
  select champion.venue_key,champion.venue_name,champion.athlete_id,
    champion.display_name,champion.points,snapshot.updated_at,
    private.jkcrew_park_crown_title(champion.athlete_id)
  from private.jkcrew_current_park_kings_for_team(v_team,null) champion
  left join private.team_park_king_snapshots snapshot
    on snapshot.team_id=v_team and snapshot.venue_key=champion.venue_key
  order by champion.venue_name;
end;
$function$;

notify pgrst,'reload schema';
