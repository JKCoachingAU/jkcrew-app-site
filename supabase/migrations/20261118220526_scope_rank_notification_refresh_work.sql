-- Scoring writes must not recalculate and lock every club's rank snapshots.
-- Keep rank semantics and authoritative notification checks; do the changed
-- team's work once, under a team-specific transaction lock.
set local lock_timeout='5s';
create function private.jkcrew_push_rankings_for_team(p_team_id uuid)
returns table(athlete_id uuid,display_name text,week_start date,weekly_points bigint,weekly_started boolean,rank_number bigint)
language sql stable security definer set search_path='' as $$
with all_riders as materialized (
  select p.id,p.display_name,p.country_code,private.jkcrew_profile_team_id(p.id) team_id
  from public.profiles p where p.role='athlete' and not coalesce(p.ghost_mode,false)
), roster as materialized (
  select * from all_riders p where p.team_id is not null and (p_team_id is null or p.team_id=p_team_id)
), countries as materialized(select distinct p.country_code code from roster p),
bounds as materialized(select c.code,b.* from countries c cross join lateral public.jkcrew_week_bounds(c.code) b),
riders as materialized(select p.*,b.week_start_date,b.week_start_ts,b.next_week_start_ts from roster p join bounds b on b.code is not distinct from p.country_code),
awards as (
  select a.athlete_id,coalesce(sum(a.points),0)::bigint points,count(*)::bigint events
  from public.assignment_point_awards a join riders r on r.id=a.athlete_id
  where a.created_at>=r.week_start_ts and a.created_at<r.next_week_start_ts group by a.athlete_id
), awarded_sessions as materialized(select distinct a.session_id from public.assignment_point_awards a where a.session_id is not null),
legacy as (
  select s.athlete_id,coalesce(sum(s.total_points),0)::bigint points,count(*)::bigint events
  from public.training_sessions s join riders r on r.id=s.athlete_id left join awarded_sessions a on a.session_id=s.id
  where s.started_at>=r.week_start_ts and s.started_at<r.next_week_start_ts and coalesce(s.total_points,0)<>0 and a.session_id is null group by s.athlete_id
), adjustments as (
  select a.athlete_id,coalesce(sum(a.points),0)::bigint points,count(*)::bigint events
  from public.leaderboard_point_adjustments a join riders r on r.id=a.athlete_id
  where a.week_start=r.week_start_date and coalesce(a.reason,'') not ilike 'All-time score correction%' group by a.athlete_id
), scores as (
  select r.id athlete_id,r.display_name,r.team_id,r.week_start_date week_start,
    greatest(0,coalesce(a.points,0)+coalesce(l.points,0)+coalesce(j.points,0))::bigint weekly_points,
    (coalesce(a.events,0)+coalesce(l.events,0)+coalesce(j.events,0))>0 weekly_started
  from riders r left join awards a on a.athlete_id=r.id left join legacy l on l.athlete_id=r.id left join adjustments j on j.athlete_id=r.id
)
select s.athlete_id,s.display_name,s.week_start,s.weekly_points,s.weekly_started or s.weekly_points>0,
  rank() over(partition by s.team_id order by case when s.weekly_started or s.weekly_points>0 then 0 else 1 end,s.weekly_points desc,s.display_name asc)::bigint
from scores s;
$$;
revoke all on function private.jkcrew_push_rankings_for_team(uuid) from public,anon,authenticated;

create or replace function private.jkcrew_current_push_rankings()
returns table(athlete_id uuid,display_name text,week_start date,weekly_points bigint,weekly_started boolean,rank_number bigint)
language sql stable security definer set search_path='' as $$
  select * from private.jkcrew_push_rankings_for_team(null);
$$;

create or replace function private.refresh_jkcrew_leaderboard_push_snapshots(p_changed_athlete uuid,p_event_key text)
returns void language plpgsql security definer set search_path='' as $$
declare team uuid:=private.jkcrew_profile_team_id(p_changed_athlete); ranks jsonb;
begin
  -- An existing unlinked rider cannot affect a team. A cascaded account delete
  -- may have removed its membership already; retain the old global quiet
  -- snapshot refresh for that rare case, without emitting foreign alerts.
  if team is null and exists(select 1 from public.profiles where id=p_changed_athlete) then return; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('jkcrew-push-rank-team:'||coalesce(team::text,'deleted-member'),0));
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into ranks from private.jkcrew_push_rankings_for_team(team) r;
  insert into public.push_notification_queue(recipient_id,notification_type,title,body,url,payload,dedupe_key)
  select current_rank.athlete_id,'leaderboard_overtaken','You were overtaken',
    case when passer.athlete_id is not null then passer.display_name||' moved ahead of you. You are now #'||current_rank.rank_number||' with '||current_rank.weekly_points||' points.'
      else 'The leaderboard changed. You are now #'||current_rank.rank_number||' with '||current_rank.weekly_points||' points.' end,
    './?push=board',jsonb_build_object('view','board','tenant_rank_version',1,'rank',current_rank.rank_number,'weekly_points',current_rank.weekly_points,'overtaken_by',passer.athlete_id),
    'leaderboard-overtaken:'||p_event_key||':'||current_rank.athlete_id
  from jsonb_to_recordset(ranks) as current_rank(athlete_id uuid,display_name text,week_start date,weekly_points bigint,weekly_started boolean,rank_number bigint)
  join public.leaderboard_rank_snapshots previous_rank on previous_rank.athlete_id=current_rank.athlete_id and previous_rank.week_start=current_rank.week_start
  left join jsonb_to_recordset(ranks) as passer(athlete_id uuid,display_name text,week_start date,weekly_points bigint,weekly_started boolean,rank_number bigint) on passer.athlete_id=p_changed_athlete
  left join public.leaderboard_rank_snapshots previous_passer on previous_passer.athlete_id=p_changed_athlete and previous_passer.week_start=previous_rank.week_start
  left join public.push_preferences preference on preference.user_id=current_rank.athlete_id
  where current_rank.athlete_id<>p_changed_athlete and private.jkcrew_profiles_share_team(current_rank.athlete_id,p_changed_athlete)
    and current_rank.weekly_started and current_rank.rank_number>previous_rank.rank_number
    and coalesce(preference.leaderboard_overtaken,true)
    and exists(select 1 from public.push_subscriptions subscription where subscription.user_id=current_rank.athlete_id and subscription.enabled)
    and (passer.athlete_id is null or (passer.rank_number<current_rank.rank_number and (previous_passer.rank_number is null or previous_passer.rank_number>=previous_rank.rank_number)))
  on conflict(dedupe_key) do nothing;
  insert into public.leaderboard_rank_snapshots(athlete_id,week_start,rank_number,weekly_points,weekly_started,updated_at)
  select r.athlete_id,r.week_start,r.rank_number,r.weekly_points,r.weekly_started,now()
  from jsonb_to_recordset(ranks) as r(athlete_id uuid,display_name text,week_start date,weekly_points bigint,weekly_started boolean,rank_number bigint)
  order by r.athlete_id
  on conflict(athlete_id) do update set week_start=excluded.week_start,rank_number=excluded.rank_number,
    weekly_points=excluded.weekly_points,weekly_started=excluded.weekly_started,updated_at=excluded.updated_at;
exception when others then
  raise warning 'JKCREW leaderboard push refresh skipped: %',sqlerrm;
end;
$$;

create or replace function private.handle_jkcrew_leaderboard_push_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare athlete uuid; row_id text;
begin
  if tg_table_name='training_sessions' then
    if tg_op='INSERT' and coalesce(new.total_points,0)=0 then return new; end if;
    if tg_op='DELETE' and coalesce(old.total_points,0)=0 then return old; end if;
    if tg_op='UPDATE' and new.total_points is not distinct from old.total_points and new.athlete_id is not distinct from old.athlete_id and new.started_at is not distinct from old.started_at then return new; end if;
    -- Modern sessions derive points from their award receipts, whose trigger
    -- already refreshed the rank. Session totals are only a legacy fallback.
    if tg_op<>'DELETE' and exists(select 1 from public.assignment_point_awards a where a.session_id=new.id) then return new; end if;
  end if;
  if tg_op='DELETE' then athlete:=old.athlete_id;row_id:=coalesce(old.id::text,gen_random_uuid()::text);
  else athlete:=new.athlete_id;row_id:=coalesce(new.id::text,gen_random_uuid()::text); end if;
  perform private.refresh_jkcrew_leaderboard_push_snapshots(athlete,tg_table_name||':'||tg_op||':'||row_id||':'||gen_random_uuid()::text);
  return case when tg_op='DELETE' then old else new end;
end;
$$;
revoke all on function private.handle_jkcrew_leaderboard_push_change(),private.refresh_jkcrew_leaderboard_push_snapshots(uuid,text) from public,anon,authenticated;
