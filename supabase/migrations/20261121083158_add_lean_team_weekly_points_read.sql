-- The Home/Session score projection preserves the full fractional board's
-- authorized roster, weekly sources, two-stage clamp and display ordering.
-- Full Board/HQ APIs and their compatibility fields remain unchanged.
set local lock_timeout='5s';
set local statement_timeout='60s';

create function private.jkcrew_team_weekly_points()
returns table(athlete_id uuid,weekly_points numeric)
language plpgsql stable security definer set search_path='' as $points$
begin
 perform private.require_coach_approval();
 if auth.uid()is null then raise exception 'Sign in required'using errcode='42501';end if;
 return query
 with viewer as materialized(
  select auth.uid()id,exists(select 1 from public.profiles me
   where me.id=auth.uid()and me.role in('coach','admin'))is_coach
 ), candidates as materialized(
  select p.id,p.display_name,p.country_code,coalesce(p.ghost_mode,false)ghost_mode
  from public.profiles p cross join viewer v where p.role='athlete'
   and(not coalesce(p.ghost_mode,false)or p.id=v.id or v.is_coach)
 ), actor_teams as materialized(
  select membership.actor_id,membership.team_id from private.jkcrew_actor_team_memberships(
   (select array_agg(actor.id)from(
    select candidate.id from candidates candidate union select v.id from viewer v
   )actor)
  )membership
 ), viewer_teams as materialized(
  select membership.team_id from actor_teams membership
  where membership.actor_id=(select id from viewer)
 ), roster as materialized(
  select p.*from candidates p cross join viewer v where p.id=v.id or exists(
   select 1 from actor_teams target join viewer_teams own using(team_id)
   where target.actor_id=p.id
  )
 ), countries as materialized(
  select distinct p.country_code code from roster p
 ), bounds as materialized(
  select c.code,b.*from countries c cross join lateral public.jkcrew_week_bounds(c.code)b
 ), riders as materialized(
  select p.*,b.week_start_date,b.week_start_ts,b.next_week_start_ts
  from roster p join bounds b on b.code is not distinct from p.country_code
 ), awards as(
  -- The weekly projection of the existing base-board awards CTE. Historical
  -- rows cannot affect its sum or event count, so filter them before grouping.
  select a.athlete_id,coalesce(sum(a.points),0)::bigint week_points,count(*)::bigint week_events
  from public.assignment_point_awards a join riders r on r.id=a.athlete_id
  where a.created_at>=r.week_start_ts and a.created_at<r.next_week_start_ts
  group by a.athlete_id
 ), awarded_sessions as materialized(
  -- An award at ANY date suppresses legacy session totals, just as on the
  -- full board. Do not limit these receipt IDs to this week's award window.
  select distinct a.session_id from public.assignment_point_awards a
  join public.training_sessions s on s.id=a.session_id join riders r on r.id=s.athlete_id
  where a.session_id is not null
 ), sessions as(
  select s.athlete_id,coalesce(sum(s.total_points),0)::bigint week_points,count(*)::bigint week_events
  from public.training_sessions s join riders r on r.id=s.athlete_id
  left join awarded_sessions a on a.session_id=s.id
  where coalesce(s.total_points,0)<>0 and a.session_id is null
   and s.started_at>=r.week_start_ts and s.started_at<r.next_week_start_ts
  group by s.athlete_id
 ), adjustments as(
  select a.athlete_id,coalesce(sum(a.points),0)::bigint week_points,count(*)::bigint week_events
  from public.leaderboard_point_adjustments a join riders r on r.id=a.athlete_id
  where a.week_start=r.week_start_date and coalesce(a.reason,'')not ilike'All-time score correction%'
  group by a.athlete_id
 ), scored as(
  select r.id athlete_id,r.display_name,r.country_code,
   greatest(0,coalesce(a.week_points,0)+coalesce(s.week_points,0)+coalesce(j.week_points,0))::bigint weekly_points,
   (coalesce(a.week_events,0)+coalesce(s.week_events,0)+coalesce(j.week_events,0))::bigint weekly_point_events
  from riders r left join awards a on a.athlete_id=r.id left join sessions s on s.athlete_id=r.id
  left join adjustments j on j.athlete_id=r.id
 ), started as(
  select s.*,(s.weekly_point_events>0 or s.weekly_points>0)weekly_started from scored s
 ), half as(
  -- Exact weekly projection of approved_a99af139d8dd7b72d7f249bf: fractional
  -- points are added AFTER the base score has already been clamped at zero.
  select a.athlete_id,coalesce(sum(a.points),0)::numeric weekly_half,count(*)::bigint weekly_events
  from public.weekly_other_try_awards a join riders r on r.id=a.athlete_id
  where a.created_at>=r.week_start_ts and a.created_at<r.next_week_start_ts
  group by a.athlete_id
 ), precise as(
  select b.*,greatest(0,b.weekly_points::numeric+coalesce(h.weekly_half,0))precise_weekly,
   (b.weekly_point_events+coalesce(h.weekly_events,0))::bigint precise_weekly_events
  from started b left join half h on h.athlete_id=b.athlete_id
 )
 select r.athlete_id,r.precise_weekly from precise r
 order by case when r.weekly_started or r.precise_weekly_events>0 then 0 else 1 end,
  r.precise_weekly desc,r.display_name asc;
end;
$points$;
revoke all on function private.jkcrew_team_weekly_points()from public,anon;
grant execute on function private.jkcrew_team_weekly_points()to authenticated,service_role;

create function public.get_team_weekly_points()
returns table(athlete_id uuid,weekly_points numeric)
language sql stable security invoker set search_path='' as $points$
 select *from private.jkcrew_team_weekly_points();
$points$;
revoke all on function public.get_team_weekly_points()from public,anon;
grant execute on function public.get_team_weekly_points()to authenticated,service_role;
notify pgrst,'reload schema';
