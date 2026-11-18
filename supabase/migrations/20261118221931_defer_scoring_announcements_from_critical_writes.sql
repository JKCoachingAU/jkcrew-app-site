-- Points, progress, receipts and live ranking/crown queries remain synchronous.
-- Only auxiliary chat/push snapshots are processed after commit. Unique event
-- rows avoid a shared-row UPSERT lock on a busy session; the worker coalesces
-- captured rows by team/venue and never deletes a newly enqueued event.
set local lock_timeout='5s';
create table private.scoring_announcement_jobs(
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.coach_teams(id) on delete cascade,
  athlete_id uuid not null,
  kind text not null check(kind in ('rank','chat','crown')),
  venue text not null default '',event_key text not null default '',
  created_at timestamptz not null default clock_timestamp(),
  available_at timestamptz not null default now(),attempts integer not null default 0,last_error text
);
create index scoring_announcement_jobs_due_idx on private.scoring_announcement_jobs(available_at,created_at,id);
alter table private.scoring_announcement_jobs enable row level security;
revoke all on private.scoring_announcement_jobs from public,anon,authenticated,service_role;

create function private.enqueue_scoring_announcement(p_kind text,p_athlete uuid,p_venue text default '',p_event_key text default '')
returns void language plpgsql security definer set search_path='' as $$
declare team uuid:=private.jkcrew_profile_team_id(p_athlete);
begin
  if team is null then return; end if;
  if p_kind='crown' and coalesce(private.jkcrew_venue_key(p_venue),'')='' then return; end if;
  insert into private.scoring_announcement_jobs(team_id,athlete_id,kind,venue,event_key)
  values(team,p_athlete,p_kind,left(coalesce(p_venue,''),200),left(coalesce(p_event_key,''),200));
end;
$$;
revoke all on function private.enqueue_scoring_announcement(text,uuid,text,text) from public,anon,authenticated,service_role;

create or replace function private.handle_jkcrew_leaderboard_push_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare athlete uuid;row_id text;
begin
  if tg_table_name='training_sessions' then
    if tg_op='INSERT' and coalesce(new.total_points,0)=0 then return new; end if;
    if tg_op='DELETE' and coalesce(old.total_points,0)=0 then return old; end if;
    if tg_op='UPDATE' and new.total_points is not distinct from old.total_points and new.athlete_id is not distinct from old.athlete_id and new.started_at is not distinct from old.started_at then return new; end if;
    if tg_op<>'DELETE' and exists(select 1 from public.assignment_point_awards a where a.session_id=new.id) then return new; end if;
  end if;
  if tg_op='DELETE' then athlete:=old.athlete_id;row_id:=coalesce(old.id::text,'');
  else athlete:=new.athlete_id;row_id:=coalesce(new.id::text,''); end if;
  perform private.enqueue_scoring_announcement('rank',athlete,'',tg_table_name||':'||tg_op||':'||row_id);
  return case when tg_op='DELETE' then old else new end;
end;
$$;

create or replace function private.jkcrew_deferred_rank_milestone()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='training_sessions' then
    if tg_op='INSERT' and coalesce(new.total_points,0)=0 then return null; end if;
    if tg_op='DELETE' and coalesce(old.total_points,0)=0 then return null; end if;
    if tg_op='UPDATE' and new.total_points is not distinct from old.total_points and new.athlete_id is not distinct from old.athlete_id and new.started_at is not distinct from old.started_at then return null; end if;
  end if;
  perform private.enqueue_scoring_announcement('chat',case when tg_op='DELETE' then old.athlete_id else new.athlete_id end,'',pg_catalog.txid_current()::text);
  return null;
end;
$$;

create or replace function private.handle_park_king_award_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare v text;
begin
  if tg_op in ('UPDATE','DELETE') then
    perform private.enqueue_scoring_announcement('crown',old.athlete_id,old.venue,'award-old');
    if old.session_id is not null then
      for v in select distinct a.venue from public.assignment_point_awards a where a.session_id=old.session_id and btrim(a.venue)<>'' loop
        perform private.enqueue_scoring_announcement('crown',old.athlete_id,v,'award-session-old');
      end loop;
    end if;
  end if;
  if tg_op in ('INSERT','UPDATE') then
    perform private.enqueue_scoring_announcement('crown',new.athlete_id,new.venue,'award-new');
    if new.session_id is not null then
      for v in select distinct a.venue from public.assignment_point_awards a where a.session_id=new.session_id and btrim(a.venue)<>'' loop
        perform private.enqueue_scoring_announcement('crown',new.athlete_id,v,'award-session-new');
      end loop;
    end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;

create or replace function private.handle_park_king_session_completion()
returns trigger language plpgsql security definer set search_path='' as $$
declare v text;
begin
  if old.ended_at is not distinct from new.ended_at then return new; end if;
  for v in select distinct a.venue from public.assignment_point_awards a where a.session_id=new.id and btrim(coalesce(a.venue,''))<>'' loop
    perform private.enqueue_scoring_announcement('crown',new.athlete_id,v,'session-complete');
  end loop;
  return new;
end;
$$;

create function private.queue_deleted_rider_announcements()
returns trigger language plpgsql security definer set search_path='' as $$
declare v text;
begin
  if old.role::text='athlete' then
    perform private.enqueue_scoring_announcement('rank',old.id,'','member-deleted');
    perform private.enqueue_scoring_announcement('chat',old.id,'','member-deleted');
    for v in select distinct a.venue from public.assignment_point_awards a where a.athlete_id=old.id and btrim(a.venue)<>'' loop
      perform private.enqueue_scoring_announcement('crown',old.id,v,'member-deleted');
    end loop;
    delete from private.crew_leaderboard_snapshots where athlete_id=old.id;
  end if;
  return old;
end;
$$;
create trigger queue_deleted_rider_announcements before delete on public.profiles for each row execute function private.queue_deleted_rider_announcements();

create function private.process_scoring_announcements()
returns integer language plpgsql security definer set search_path='' as $$
declare batch record;v text;current_ranks jsonb;changed uuid;processed integer:=0;event text;
begin
  if auth.uid() is not null then raise exception 'Server worker required' using errcode='42501'; end if;
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('jkcrew-scoring-announcement-worker',0)) then return 0; end if;
  for batch in
    with pending as materialized(select * from private.scoring_announcement_jobs where available_at<=clock_timestamp() order by created_at,id limit 200 for update skip locked)
    select team_id,array_agg(id) ids,array_agg(distinct athlete_id) athletes,bool_or(kind='rank') needs_rank,bool_or(kind='chat') needs_chat
    from pending group by team_id
  loop
    begin
      event:='coalesced:'||batch.ids[1]::text;
      changed:=case when cardinality(batch.athletes)=1 then batch.athletes[1] else null end;
      if batch.needs_rank then perform private.refresh_team_push_snapshots_now(batch.team_id,changed,event); end if;
      if batch.needs_chat then perform private.refresh_team_chat_snapshots_now(batch.team_id,changed,event); end if;
      for v in select min(venue) from private.scoring_announcement_jobs where id=any(batch.ids) and kind='crown' group by private.jkcrew_venue_key(venue) loop
        perform private.refresh_park_king_for_team_now(batch.team_id,v,event);
      end loop;
      delete from private.scoring_announcement_jobs where id=any(batch.ids);
      processed:=processed+cardinality(batch.ids);
    exception when others then
      update private.scoring_announcement_jobs set attempts=attempts+1,last_error=left(sqlerrm,300),available_at=clock_timestamp()+least(300,5*(attempts+1))*interval '1 second' where id=any(batch.ids);
    end;
  end loop;
  return processed;
end;
$$;
revoke all on function private.process_scoring_announcements(),private.queue_deleted_rider_announcements() from public,anon,authenticated,service_role;
revoke all on function private.handle_jkcrew_leaderboard_push_change(),private.jkcrew_deferred_rank_milestone(),private.handle_park_king_award_change(),private.handle_park_king_session_completion() from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.jkcrew_post_crew_milestone_strict(p_author uuid, p_body text, p_metadata jsonb, p_event_key text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if p_author is null or nullif(p_event_key, '') is null then return; end if;
  insert into private.crew_milestone_receipts(event_key) values(p_event_key)
  on conflict do nothing;
  if not found then return; end if;
  insert into public.crew_posts(author_id,body,post_type,metadata)
  values(p_author, left(p_body,300), 'announcement',
    p_metadata || jsonb_build_object('event_key',p_event_key));
end;
$function$;


CREATE OR REPLACE FUNCTION private.jkcrew_post_leaderboard_milestone_for_team(p_team uuid, p_changed_athlete uuid, p_event_key text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_current record;
  v_previous private.crew_leaderboard_snapshots%rowtype;
  v_new_week boolean;
  v_passed jsonb;
  v_first_points boolean;
  v_leader boolean;
  v_body text;
  v_type text;
  ranks jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into ranks from private.jkcrew_push_rankings_for_team(p_team) r;
  -- One statement can award several battle participants. AFTER ROW sees all
  -- its writes, so compare every improved rider before replacing the snapshot.
  for v_current in select * from jsonb_to_recordset(ranks) as r(athlete_id uuid,display_name text,week_start date,weekly_points bigint,weekly_started boolean,rank_number bigint) loop
  select * into v_previous from private.crew_leaderboard_snapshots
  where athlete_id=v_current.athlete_id;
  if not found or v_current.weekly_points<=0 then continue; end if;
  v_new_week := v_previous.week_start is distinct from v_current.week_start;
  if not v_new_week and v_current.weekly_points<=v_previous.weekly_points then continue; end if;

  -- Compare the complete old snapshot before ANY snapshot rows are overwritten.
  -- Tied points/alphabetical order, deleted/ghost riders and another rider losing
  -- points are not a scored overtake. Country-local weekly resets cannot qualify.
  select coalesce(jsonb_agg(jsonb_build_object('athlete_id',peer.athlete_id,
    'name',peer.display_name) order by old_peer.rank_number,peer.athlete_id),'[]'::jsonb)
  into v_passed
  from jsonb_to_recordset(ranks) as peer(athlete_id uuid,display_name text,week_start date,weekly_points bigint,weekly_started boolean,rank_number bigint)
  join private.crew_leaderboard_snapshots old_peer on old_peer.athlete_id=peer.athlete_id
  where peer.athlete_id<>v_current.athlete_id
    and peer.week_start=v_current.week_start and old_peer.week_start=peer.week_start
    and old_peer.rank_number<v_previous.rank_number
    and peer.rank_number>v_current.rank_number
    and v_previous.weekly_points<=old_peer.weekly_points
    and v_current.weekly_points>peer.weekly_points
    and peer.weekly_points>=old_peer.weekly_points;

  v_first_points := (v_new_week or v_previous.weekly_points=0) and not exists (
    select 1 from private.crew_leaderboard_snapshots s
    where private.jkcrew_profile_team_id(s.athlete_id)=p_team and s.week_start=v_current.week_start and s.weekly_points>0);
  v_leader := v_current.rank_number=1 and not exists (
    select 1 from jsonb_to_recordset(ranks) as peer(athlete_id uuid,display_name text,week_start date,weekly_points bigint,weekly_started boolean,rank_number bigint)
    where peer.athlete_id<>v_current.athlete_id and peer.weekly_points>=v_current.weekly_points);
  if not ((not v_new_week and jsonb_array_length(v_passed)>0 and v_current.rank_number<v_previous.rank_number)
    or (v_leader and v_first_points)) then continue; end if;

  v_type := case when v_leader then 'rank_one' else 'leaderboard_overtake' end;
  v_body := case when v_leader then left(coalesce(v_current.display_name,'A rider'),80)||
    ' just took the #1 spot with '||v_current.weekly_points||' points!'
    else left(coalesce(v_current.display_name,'A rider'),80)||' overtook '||
      case when jsonb_array_length(v_passed)=1 then left(coalesce(v_passed->0->>'name','a rider'),80)
           else jsonb_array_length(v_passed)||' riders' end||
      ' and moved to #'||v_current.rank_number||' with '||v_current.weekly_points||' points!' end;
  perform private.jkcrew_post_crew_milestone_strict(v_current.athlete_id,v_body,
    jsonb_build_object('event_type',v_type,'author_name',v_current.display_name,
      'author_role','athlete','tag',case when v_leader then '🏆 New crew leader' else '⚡ Leaderboard move' end,
      'week_start',v_current.week_start,'rank',v_current.rank_number,
      'previous_rank',v_previous.rank_number,'weekly_points',v_current.weekly_points,
      'overtaken',v_passed),'leaderboard:'||p_event_key||':'||v_current.athlete_id);
  end loop;
end;
$function$;


CREATE OR REPLACE FUNCTION private.refresh_team_chat_snapshots_now(p_team uuid, p_changed_athlete uuid, p_event_key text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('jkcrew-chat-team:'||p_team::text,0));
  perform private.jkcrew_post_leaderboard_milestone_for_team(p_team,p_changed_athlete,p_event_key);
  insert into private.crew_leaderboard_snapshots(athlete_id,week_start,rank_number,weekly_points,weekly_started,updated_at)
  select athlete_id,week_start,rank_number,weekly_points,weekly_started,now()
  from private.jkcrew_push_rankings_for_team(p_team)
  on conflict(athlete_id) do update set week_start=excluded.week_start,
    rank_number=excluded.rank_number,weekly_points=excluded.weekly_points,
    weekly_started=excluded.weekly_started,updated_at=excluded.updated_at;
  delete from private.crew_leaderboard_snapshots s where private.jkcrew_profile_team_id(s.athlete_id)=p_team and not exists (
    select 1 from private.jkcrew_push_rankings_for_team(p_team) c where c.athlete_id=s.athlete_id);
end;
$function$;


CREATE OR REPLACE FUNCTION private.refresh_park_king_for_team_now(p_team uuid, p_venue text, p_event_key text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_key text := private.jkcrew_venue_key(p_venue);
  v_team uuid;
  v_previous private.team_park_king_snapshots%rowtype;
  v_current record;
  v_event_id uuid;
  v_crown_title text;
begin
  if coalesce(v_key,'')='' then return; end if;
  v_team := p_team;
    if auth.uid() is not null and v_team is distinct from private.jkcrew_profile_team_id(auth.uid()) then return; end if;
    -- Concurrent score writes at the same team/park must not emit two crowns.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_team::text||':'||v_key,0));
    select snapshot.* into v_previous from private.team_park_king_snapshots snapshot
    where snapshot.team_id=v_team and snapshot.venue_key=v_key;
    select champion.* into v_current from private.jkcrew_current_park_king_for_team(v_team,p_venue) champion;
    if not found then
      delete from private.team_park_king_snapshots snapshot where snapshot.team_id=v_team and snapshot.venue_key=v_key;
      return;
    end if;
    insert into private.team_park_king_snapshots(team_id,venue_key,venue_name,athlete_id,display_name,avatar,points,updated_at)
    values(v_team,v_key,v_current.venue_name,v_current.athlete_id,v_current.display_name,v_current.avatar,v_current.points,now())
    on conflict(team_id,venue_key) do update set
      venue_name=excluded.venue_name,athlete_id=excluded.athlete_id,display_name=excluded.display_name,
      avatar=excluded.avatar,points=excluded.points,updated_at=excluded.updated_at;
    if v_previous.athlete_id is not null and v_previous.athlete_id=v_current.athlete_id then return; end if;
    v_crown_title := private.jkcrew_park_crown_title(v_current.athlete_id);
    insert into public.park_king_events(venue_key,venue_name,athlete_id,display_name,points,crown_title)
    values(v_key,v_current.venue_name,v_current.athlete_id,v_current.display_name,v_current.points,v_crown_title)
    returning id into v_event_id;
    insert into public.push_notification_queue(recipient_id,notification_type,title,body,url,payload,dedupe_key)
    select profile.id,'park_king_changed','New '||v_crown_title||' of the Park',
      v_current.display_name||' is now '||v_crown_title||' of '||v_current.venue_name||' with '||v_current.points||' park point'||case when v_current.points=1 then '' else 's' end||'.',
      './?push=session',
      jsonb_build_object('type','park_king_changed','event_id',v_event_id,'venue',v_current.venue_name,
        'athlete_id',v_current.athlete_id,'points',v_current.points,'crown_title',v_crown_title,'view','session'),
      'park-king:'||v_event_id::text||':'||profile.id::text
    from public.profiles profile
    where profile.role='athlete' and profile.id<>v_current.athlete_id
      and private.jkcrew_actor_approved(profile.id)
      and private.jkcrew_profile_team_id(profile.id)=v_team
    on conflict(dedupe_key) do nothing;
end;
$function$;

create function private.refresh_team_push_snapshots_now(p_team uuid,p_changed uuid,p_event text)
returns void language plpgsql security definer set search_path='' as $$
declare ranks jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('jkcrew-push-rank-team:'||p_team::text,0));
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into ranks from private.jkcrew_push_rankings_for_team(p_team) r;
  insert into public.push_notification_queue(recipient_id,notification_type,title,body,url,payload,dedupe_key)
  select r.athlete_id,'leaderboard_overtaken','You were overtaken',
    case when p_changed is not null then passer.display_name||' moved ahead of you. ' else 'The leaderboard changed. ' end||
      'You are now #'||r.rank_number||' with '||r.weekly_points||' points.',
    './?push=board',jsonb_build_object('view','board','tenant_rank_version',1,'rank',r.rank_number,
      'weekly_points',r.weekly_points,'overtaken_by',passer.athlete_id),
    'leaderboard-overtaken:'||p_event||':'||r.athlete_id
  from jsonb_to_recordset(ranks) as r(athlete_id uuid,display_name text,week_start date,weekly_points bigint,weekly_started boolean,rank_number bigint)
  join public.leaderboard_rank_snapshots old on old.athlete_id=r.athlete_id and old.week_start=r.week_start
  cross join lateral (
    select peer.* from jsonb_to_recordset(ranks) as peer(athlete_id uuid,display_name text,week_start date,weekly_points bigint,weekly_started boolean,rank_number bigint)
    join public.leaderboard_rank_snapshots prior on prior.athlete_id=peer.athlete_id and prior.week_start=peer.week_start
    where peer.athlete_id<>r.athlete_id and peer.week_start=r.week_start and peer.rank_number<r.rank_number
      and prior.rank_number>=old.rank_number and peer.weekly_points>prior.weekly_points
      and peer.weekly_points>r.weekly_points and r.weekly_points>=old.weekly_points
      and (p_changed is null or peer.athlete_id=p_changed)
    order by peer.rank_number,peer.athlete_id limit 1
  ) passer
  left join public.push_preferences preference on preference.user_id=r.athlete_id
  where r.weekly_started and r.rank_number>old.rank_number and coalesce(preference.leaderboard_overtaken,true)
    and exists(select 1 from public.push_subscriptions subscription where subscription.user_id=r.athlete_id and subscription.enabled)
  on conflict(dedupe_key) do nothing;
  insert into public.leaderboard_rank_snapshots(athlete_id,week_start,rank_number,weekly_points,weekly_started,updated_at)
  select r.athlete_id,r.week_start,r.rank_number,r.weekly_points,r.weekly_started,now()
  from jsonb_to_recordset(ranks) as r(athlete_id uuid,display_name text,week_start date,weekly_points bigint,weekly_started boolean,rank_number bigint)
  order by r.athlete_id on conflict(athlete_id) do update set week_start=excluded.week_start,rank_number=excluded.rank_number,
    weekly_points=excluded.weekly_points,weekly_started=excluded.weekly_started,updated_at=excluded.updated_at;
  delete from public.leaderboard_rank_snapshots s where private.jkcrew_profile_team_id(s.athlete_id)=p_team
    and not exists(select 1 from jsonb_to_recordset(ranks) as r(athlete_id uuid) where r.athlete_id=s.athlete_id);
end;
$$;
revoke all on function private.jkcrew_post_crew_milestone_strict(uuid,text,jsonb,text),
 private.jkcrew_post_leaderboard_milestone_for_team(uuid,uuid,text),
 private.refresh_team_chat_snapshots_now(uuid,uuid,text),
 private.refresh_park_king_for_team_now(uuid,text,text),
 private.refresh_team_push_snapshots_now(uuid,uuid,text) from public,anon,authenticated,service_role;
-- Run as the migration owner with no browser JWT, after scoring commits.
select cron.schedule('jkcrew-scoring-announcements','5 seconds','select private.process_scoring_announcements()');
notify pgrst,'reload schema';
