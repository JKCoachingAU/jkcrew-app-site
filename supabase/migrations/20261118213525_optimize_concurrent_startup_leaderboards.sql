-- Startup bursts used to run seven score subqueries and several authorized
-- badge/XP helpers for each rider. Aggregate the authorized roster in one pass.
-- Public RPC approval/tenant guards and return types remain unchanged. No cache,
-- score mutation, new grants, or historical-data rewrite is introduced.
set local lock_timeout='5s';
set local statement_timeout='60s';

create or replace function private.approved_f58214f32cd50c933615433a()
returns table(athlete_id uuid,display_name text,level integer,avatar jsonb,country_code text,country_name text,
  weekly_points bigint,all_time_points bigint,session_count bigint,earned_badges jsonb,ghost_mode boolean,
  rank_number bigint,all_time_rank_number bigint,weekly_started boolean,weekly_point_events bigint,all_time_point_events bigint)
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_coach_approval();
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  return query
  with viewer as materialized (
    select auth.uid() id,
      exists(select 1 from public.profiles me where me.id=auth.uid() and me.role in ('coach','admin')) is_coach,
      private.xp_progression_enabled() progression_enabled
  ), viewer_teams as materialized (
    select t.team_id from private.jkcrew_user_team_ids((select id from viewer)) t
  ), roster as materialized (
    select p.* from public.profiles p cross join viewer v
    where p.role='athlete'
      and (p.id=v.id or exists(select 1 from private.jkcrew_user_team_ids(p.id) target join viewer_teams own using(team_id)))
      and (not coalesce(p.ghost_mode,false) or p.id=v.id or v.is_coach)
  ), countries as materialized (
    select distinct p.country_code code from roster p
  ), bounds as materialized (
    select c.code,b.* from countries c cross join lateral public.jkcrew_week_bounds(c.code) b
  ), riders as materialized (
    select p.*,b.week_start_date,b.week_start_ts,b.next_week_start_ts
    from roster p join bounds b on b.code is not distinct from p.country_code
  ), awards as (
    select a.athlete_id,
      coalesce(sum(a.points),0)::bigint all_points,count(*)::bigint all_events,
      coalesce(sum(a.points) filter(where a.created_at>=r.week_start_ts and a.created_at<r.next_week_start_ts),0)::bigint week_points,
      count(*) filter(where a.created_at>=r.week_start_ts and a.created_at<r.next_week_start_ts)::bigint week_events
    from public.assignment_point_awards a join riders r on r.id=a.athlete_id group by a.athlete_id
  ), awarded_sessions as materialized (
    select distinct a.session_id from public.assignment_point_awards a
    join public.training_sessions s on s.id=a.session_id join riders r on r.id=s.athlete_id
    where a.session_id is not null
  ), sessions as (
    select s.athlete_id,count(*)::bigint sessions,
      coalesce(sum(s.total_points) filter(where coalesce(s.total_points,0)<>0 and a.session_id is null),0)::bigint all_points,
      count(*) filter(where coalesce(s.total_points,0)<>0 and a.session_id is null)::bigint all_events,
      coalesce(sum(s.total_points) filter(where coalesce(s.total_points,0)<>0 and a.session_id is null
        and s.started_at>=r.week_start_ts and s.started_at<r.next_week_start_ts),0)::bigint week_points,
      count(*) filter(where coalesce(s.total_points,0)<>0 and a.session_id is null
        and s.started_at>=r.week_start_ts and s.started_at<r.next_week_start_ts)::bigint week_events
    from public.training_sessions s join riders r on r.id=s.athlete_id
    left join awarded_sessions a on a.session_id=s.id group by s.athlete_id
  ), adjustments as (
    select a.athlete_id,coalesce(sum(a.points),0)::bigint all_points,count(*)::bigint all_events,
      coalesce(sum(a.points) filter(where a.week_start=r.week_start_date and coalesce(a.reason,'') not ilike 'All-time score correction%'),0)::bigint week_points,
      count(*) filter(where a.week_start=r.week_start_date and coalesce(a.reason,'') not ilike 'All-time score correction%')::bigint week_events
    from public.leaderboard_point_adjustments a join riders r on r.id=a.athlete_id group by a.athlete_id
  ), stored_badges as (
    select b.athlete_id,jsonb_agg(jsonb_build_object('key',b.badge_key,'type',b.badge_type,'label',b.label,
      'icon',b.icon,'description',b.description,'earned_at',b.earned_at) order by b.earned_at,b.badge_key) badges
    from public.athlete_badges b join riders r on r.id=b.athlete_id
    where b.badge_type in ('achievement','manual') group by b.athlete_id
  ), scored as (
    select r.id athlete_id,r.display_name,
      least(50,greatest(1,coalesce(r.level,1),public.level_for_xp(coalesce(r.xp_total,0))))::integer level,
      r.avatar,r.country_code,r.country_name,
      greatest(0,coalesce(a.week_points,0)+coalesce(s.week_points,0)+coalesce(j.week_points,0))::bigint weekly_points,
      greatest(0,coalesce(a.all_points,0)+coalesce(s.all_points,0)+coalesce(j.all_points,0))::bigint all_time_points,
      coalesce(s.sessions,0)::bigint session_count,
      case when (select progression_enabled from viewer) then public.get_earned_badges(r.id) else coalesce(b.badges,'[]'::jsonb) end earned_badges,
      coalesce(r.ghost_mode,false) ghost_mode,
      (coalesce(a.week_events,0)+coalesce(s.week_events,0)+coalesce(j.week_events,0))::bigint weekly_point_events,
      (coalesce(a.all_events,0)+coalesce(s.all_events,0)+coalesce(j.all_events,0))::bigint all_time_point_events
    from riders r left join awards a on a.athlete_id=r.id left join sessions s on s.athlete_id=r.id
    left join adjustments j on j.athlete_id=r.id left join stored_badges b on b.athlete_id=r.id
  ), started as (
    select s.*,(s.weekly_point_events>0 or s.weekly_points>0) weekly_started from scored s
  ), ranked as (
    select s.*,
      rank() over(order by case when s.weekly_started then 0 else 1 end,s.weekly_points desc,s.display_name asc)::bigint rank_number,
      rank() over(order by s.all_time_points desc,s.display_name asc)::bigint all_time_rank_number
    from started s
  )
  select r.athlete_id,r.display_name,r.level,r.avatar,r.country_code,r.country_name,r.weekly_points,r.all_time_points,
    r.session_count,r.earned_badges,r.ghost_mode,r.rank_number,r.all_time_rank_number,r.weekly_started,r.weekly_point_events,r.all_time_point_events
  from ranked r order by case when r.weekly_started then 0 else 1 end,r.weekly_points desc,r.display_name asc;
end;
$$;

create or replace function private.approved_a99af139d8dd7b72d7f249bf()
returns table(athlete_id uuid,display_name text,level integer,avatar jsonb,country_code text,country_name text,
  weekly_points numeric,all_time_points numeric,session_count bigint,earned_badges jsonb,ghost_mode boolean,
  rank_number bigint,all_time_rank_number bigint,weekly_started boolean,weekly_point_events bigint,all_time_point_events bigint)
language sql security definer set search_path='' as $$
with base as materialized(select * from public.get_weekly_leaderboard()),
countries as materialized(select distinct b.country_code code from base b),
bounds as materialized(select c.code,w.* from countries c cross join lateral public.jkcrew_week_bounds(c.code) w),
half as (
  select a.athlete_id,
    coalesce(sum(a.points) filter(where a.created_at>=w.week_start_ts and a.created_at<w.next_week_start_ts),0)::numeric weekly_half,
    sum(a.points)::numeric all_half,
    count(*) filter(where a.created_at>=w.week_start_ts and a.created_at<w.next_week_start_ts)::bigint weekly_events,
    count(*)::bigint all_events
  from public.weekly_other_try_awards a join base b on b.athlete_id=a.athlete_id
  join bounds w on w.code is not distinct from b.country_code group by a.athlete_id
),scored as (
  select b.*,greatest(0,b.weekly_points::numeric+coalesce(h.weekly_half,0)) precise_weekly,
    greatest(0,b.all_time_points::numeric+coalesce(h.all_half,0)) precise_all_time,
    (b.weekly_point_events+coalesce(h.weekly_events,0))::bigint precise_weekly_events,
    (b.all_time_point_events+coalesce(h.all_events,0))::bigint precise_all_time_events
  from base b left join half h on h.athlete_id=b.athlete_id
),ranked as (
  select s.*,
    rank() over(order by case when s.weekly_started or s.precise_weekly_events>0 then 0 else 1 end,s.precise_weekly desc,s.display_name asc)::bigint precise_rank,
    rank() over(order by s.precise_all_time desc,s.display_name asc)::bigint precise_all_time_rank
  from scored s
)
select r.athlete_id,r.display_name,r.level,r.avatar,r.country_code,r.country_name,r.precise_weekly,r.precise_all_time,
  r.session_count,r.earned_badges,r.ghost_mode,r.precise_rank,r.precise_all_time_rank,
  r.weekly_started or r.precise_weekly_events>0,r.precise_weekly_events,r.precise_all_time_events
from ranked r order by case when r.weekly_started or r.precise_weekly_events>0 then 0 else 1 end,r.precise_weekly desc,r.display_name asc;
$$;

notify pgrst,'reload schema';
