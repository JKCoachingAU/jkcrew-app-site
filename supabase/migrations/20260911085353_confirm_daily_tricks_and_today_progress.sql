-- Review only: explicit Daily confirmation; no saved rider rows are rewritten.

alter table public.training_sessions add column if not exists daily_venue text;

create table private.daily_finish_candidates (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid not null,
  group_session_id uuid,
  assignment_id uuid not null,
  week_start date not null,
  venue text not null,
  local_date date not null,
  seconds integer not null check (seconds >= 0),
  captured_at timestamptz not null,
  list_signature text not null,
  progress_signature text not null,
  total_count integer not null check (total_count > 0),
  timed_bonus_eligible boolean not null,
  status text not null default 'pending' check (status in ('pending','invalidated','confirmed')),
  result jsonb,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);
create unique index daily_finish_one_pending on private.daily_finish_candidates(session_id) where status='pending';
create unique index daily_finish_one_confirmed on private.daily_finish_candidates(session_id) where status='confirmed';
create index daily_finish_rider_day on private.daily_finish_candidates(athlete_id,local_date) where status='confirmed';
create index daily_finish_rider_pb on private.daily_finish_candidates(athlete_id,list_signature,seconds) where status='confirmed';
alter table private.daily_finish_candidates enable row level security;
revoke all on private.daily_finish_candidates from public,anon,authenticated;

create or replace function private.require_daily_access(p_athlete_id uuid,p_read_only boolean default false)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles me where me.id=auth.uid() and (
      (me.id=p_athlete_id and me.role::text='athlete')
      or (me.role::text in ('coach','admin') and exists(select 1 from public.coach_athletes c where c.coach_id=me.id and c.athlete_id=p_athlete_id))
      or (p_read_only and me.role::text='parent' and exists(select 1 from public.parent_athletes p where p.parent_id=me.id and p.athlete_id=p_athlete_id))
    )
  ) then raise exception 'This training progress is private to the rider and their linked coach' using errcode='42501'; end if;
end $$;
revoke all on function private.require_daily_access(uuid,boolean) from public,anon,authenticated;

-- Match the displayed newest Daily list for a canonical venue. Older assigned
-- weeks and replaced venue aliases must not create invisible incomplete rows.
create or replace function private.daily_list_rows(p_athlete_id uuid,p_venue text)
returns setof public.weekly_trick_assignments language sql stable security definer set search_path='' as $$
  with candidates as (
    select a.* from public.weekly_trick_assignments a
    where a.athlete_id=p_athlete_id and a.category='daily'
      and a.week_start <= (select b.local_today from public.profiles p cross join lateral public.jkcrew_week_bounds(p.country_code) b where p.id=p_athlete_id)
      and private.jkcrew_venue_key(a.venue)=private.jkcrew_venue_key(p_venue)
  ), latest_week as (select max(week_start) as week_start from candidates), chosen as (
    select lower(regexp_replace(btrim(c.venue),'[^[:alnum:]]+','','g')) as raw_key
    from candidates c cross join latest_week w where c.week_start=w.week_start
    group by raw_key order by max(c.updated_at) desc,max(c.created_at) desc,max(c.sort_order) desc,raw_key desc limit 1
  )
  select c.* from candidates c cross join latest_week w cross join chosen v
  where c.week_start=w.week_start and lower(regexp_replace(btrim(c.venue),'[^[:alnum:]]+','','g'))=v.raw_key
  order by c.sort_order,c.id;
$$;
revoke all on function private.daily_list_rows(uuid,text) from public,anon,authenticated;

create or replace function private.daily_list_state(p_athlete_id uuid,p_venue text,p_date date)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'total_count',count(*),'completed_count',count(*) filter(where p.progress_date=p_date),
    'assignment_id',min(a.id::text),'week_start',min(a.week_start),'venue',min(coalesce(nullif(btrim(a.venue),''),'default')),
    'list_signature',md5(private.jkcrew_venue_key(p_venue)||':'||coalesce(jsonb_agg(jsonb_build_array(lower(regexp_replace(btrim(a.trick_name),'\s+',' ','g')),a.target_reps) order by lower(regexp_replace(btrim(a.trick_name),'\s+',' ','g')),a.target_reps)::text,'')),
    'progress_signature',md5(coalesce(jsonb_agg(jsonb_build_array(a.id,a.updated_at,p.progress_date,p.updated_at) order by a.id)::text,''))
  ) from private.daily_list_rows(p_athlete_id,p_venue) a left join public.assignment_progress p on p.assignment_id=a.id;
$$;
revoke all on function private.daily_list_state(uuid,text,date) from public,anon,authenticated;

create or replace function private.daily_candidate_json(p_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('candidate_id',c.id,'athlete_id',c.athlete_id,'rider_name',p.display_name,
    'session_id',c.session_id,'group_session_id',c.group_session_id,'venue',c.venue,'local_date',c.local_date,
    'seconds',c.seconds,'captured_at',c.captured_at,'completed_count',c.total_count,'total_count',c.total_count)
  from private.daily_finish_candidates c join public.profiles p on p.id=c.athlete_id where c.id=p_id;
$$;
revoke all on function private.daily_candidate_json(uuid) from public,anon,authenticated;

create or replace function private.invalidate_daily_finish()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_athlete uuid; v_category text;
begin
  if tg_table_name='assignment_progress' then
    select a.athlete_id,a.category into v_athlete,v_category from public.weekly_trick_assignments a where a.id=coalesce(new.assignment_id,old.assignment_id);
    if tg_op='UPDATE' and new.progress_date is not distinct from old.progress_date then return new; end if;
  else
    v_athlete:=coalesce(new.athlete_id,old.athlete_id); v_category:=coalesce(new.category,old.category);
    if tg_op='UPDATE' and (new.trick_name,new.target_reps,new.venue,new.week_start,new.athlete_id,new.category) is not distinct from (old.trick_name,old.target_reps,old.venue,old.week_start,old.athlete_id,old.category) then return new; end if;
    if tg_op='UPDATE' and old.category='daily' then
      update private.daily_finish_candidates set status='invalidated' where athlete_id=old.athlete_id and status='pending';
    end if;
  end if;
  if v_category='daily' then
    update private.daily_finish_candidates set status='invalidated' where athlete_id=v_athlete and status='pending';
  end if;
  return coalesce(new,old);
end $$;
revoke all on function private.invalidate_daily_finish() from public,anon,authenticated;
drop trigger if exists assignment_progress_daily_completion_timing on public.assignment_progress;
create trigger daily_candidate_progress_changed after insert or update or delete on public.assignment_progress for each row execute function private.invalidate_daily_finish();
create trigger daily_candidate_list_changed after insert or update or delete on public.weekly_trick_assignments for each row execute function private.invalidate_daily_finish();
-- Also neutralize a retained trigger function should an older migration recreate it.
create or replace function public.sync_daily_completion_timing() returns trigger language plpgsql security definer set search_path='' as $$ begin return new; end $$;
revoke all on function public.sync_daily_completion_timing() from public,anon,authenticated;

create or replace function public.start_daily_tricks(p_venue text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.training_sessions%rowtype; v_date date; v_tz text; v_old_venue text; v_venue text:=coalesce(nullif(btrim(p_venue),''),'default');
begin
  perform private.require_daily_access(auth.uid());
  perform 1 from public.profiles where id=auth.uid() for update;
  select public.jkcrew_country_timezone(country_code) into v_tz from public.profiles where id=auth.uid();
  v_date:=(now() at time zone v_tz)::date;
  select t.* into s from public.training_sessions t where t.athlete_id=auth.uid() and t.ended_at is null order by t.started_at desc limit 1 for update;
  v_old_venue:=s.daily_venue;
  if v_old_venue is null and s.id is not null then
    select coalesce(gs.venue,a.venue) into v_old_venue from (select 1) seed
    left join lateral (select g.venue from public.coach_group_session_participants p join public.coach_group_sessions g on g.id=p.group_session_id where p.training_session_id=s.id order by g.started_at desc limit 1) gs on true
    left join lateral (select coalesce(nullif(btrim(w.venue),''),'default') as venue from public.assignment_point_awards aw join public.weekly_trick_assignments w on w.id=aw.assignment_id where aw.session_id=s.id and w.category='daily' order by aw.created_at limit 1) a on true;
  end if;
  if s.id is null or (s.started_at at time zone v_tz)::date<>v_date
    or (s.daily_completed_at is not null and (v_old_venue is null or private.jkcrew_venue_key(v_old_venue)<>private.jkcrew_venue_key(v_venue))) then
    insert into public.training_sessions(athlete_id,daily_venue) values(auth.uid(),v_venue) returning * into s;
  elsif s.daily_completed_at is null and s.daily_venue is not null and private.jkcrew_venue_key(case when s.daily_venue='default' then '' else s.daily_venue end)<>private.jkcrew_venue_key(p_venue) then
    raise exception 'A Daily timer is already running for another venue. Return to that venue and finish its list first';
  elsif s.daily_venue is null then
    update public.training_sessions set daily_venue=coalesce(v_old_venue,v_venue) where id=s.id returning * into s;
  end if;
  return to_jsonb(s);
end $$;
revoke all on function public.start_daily_tricks(text) from public,anon;
grant execute on function public.start_daily_tricks(text) to authenticated;

create or replace function public.prepare_daily_finish(p_athlete_id uuid,p_session_id uuid default null,p_venue text default null,p_tapped_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  s public.training_sessions%rowtype; g public.coach_group_sessions%rowtype;
  c private.daily_finish_candidates%rowtype; v_list jsonb; v_date date; v_tz text;
  v_venue text:=p_venue; v_now timestamptz:=clock_timestamp(); v_tap timestamptz; v_seconds integer; v_start timestamptz;
begin
  perform private.require_daily_access(p_athlete_id);
  perform 1 from public.profiles where id=p_athlete_id for update;
  select public.jkcrew_country_timezone(country_code) into v_tz from public.profiles where id=p_athlete_id;
  v_date:=(v_now at time zone v_tz)::date;
  select t.* into s from public.training_sessions t where t.athlete_id=p_athlete_id and t.ended_at is null
    and (p_session_id is null or t.id=p_session_id) order by t.started_at desc limit 1 for update;
  if s.id is null then raise exception 'Start Daily Tricks before finishing the list'; end if;
  select gs.* into g from public.coach_group_session_participants gp join public.coach_group_sessions gs on gs.id=gp.group_session_id where gp.training_session_id=s.id order by gs.started_at desc limit 1;
  if v_venue is null then v_venue:=case when s.daily_venue is not null then case when s.daily_venue='default' then '' else s.daily_venue end else coalesce(g.venue,'') end; end if;
  if s.daily_venue is not null and private.jkcrew_venue_key(case when s.daily_venue='default' then '' else s.daily_venue end)<>private.jkcrew_venue_key(v_venue) then
    raise exception 'Start Daily Tricks for this venue before finishing its list';
  end if;
  select * into c from private.daily_finish_candidates where session_id=s.id and status='confirmed';
  if found then return jsonb_build_object('completion_candidate',null,'result',c.result); end if;
  if s.daily_completed_at is not null then
    return jsonb_build_object('completion_candidate',null,'result',jsonb_build_object('result_id',s.id,'athlete_id',p_athlete_id,'rider_name',(select display_name from public.profiles where id=p_athlete_id),'session_id',s.id,'seconds',s.daily_completed_seconds,'completed_at',s.daily_completed_at,'local_date',(s.daily_completed_at at time zone v_tz)::date,'completion_points',null,'completion_xp',null,'legacy',true,'pb_comparable',false));
  end if;
  if g.id is not null and (g.status not in ('running','paused') or g.ended_at is not null) then raise exception 'This Daily timer is no longer active'; end if;
  v_list:=private.daily_list_state(p_athlete_id,v_venue,v_date);
  if (v_list->>'total_count')::integer=0 or (v_list->>'completed_count')::integer<>(v_list->>'total_count')::integer then raise exception 'Tick every Daily trick before confirming the finish'; end if;
  v_start:=coalesce(g.started_at,s.started_at);
  if (v_start at time zone v_tz)::date<>v_date then raise exception 'Start a fresh Daily timer for today'; end if;
  if exists(select 1 from private.daily_list_rows(p_athlete_id,v_venue) a
    left join public.tricktionary_landing_history h on h.id='daily:'||a.id::text||':'||v_date::text
    where h.id is null or h.landed_count<=0 or h.landed_at<v_start) then
    raise exception 'Some Daily tricks were ticked before this timer started. Untick those tricks and complete them again to record a valid Daily time';
  end if;
  v_tap:=case when p_tapped_at between v_now-interval '30 seconds' and v_now then p_tapped_at else v_now end;
  v_tap:=greatest(v_start,v_tap);
  v_seconds:=greatest(0,floor(extract(epoch from (v_tap-v_start)))::integer-coalesce(g.total_paused_seconds,0)-case when g.status='paused' and g.paused_at is not null then greatest(0,floor(extract(epoch from (v_tap-g.paused_at)))::integer) else 0 end);
  update private.daily_finish_candidates set status='invalidated' where session_id=s.id and status='pending';
  insert into private.daily_finish_candidates(athlete_id,session_id,group_session_id,assignment_id,week_start,venue,local_date,seconds,captured_at,list_signature,progress_signature,total_count,timed_bonus_eligible)
  values(p_athlete_id,s.id,g.id,(v_list->>'assignment_id')::uuid,(v_list->>'week_start')::date,v_list->>'venue',v_date,v_seconds,v_tap,v_list->>'list_signature',v_list->>'progress_signature',(v_list->>'total_count')::integer,g.id is null or g.status='running') returning * into c;
  return jsonb_build_object('completion_candidate',private.daily_candidate_json(c.id),'result',null);
end $$;
revoke all on function public.prepare_daily_finish(uuid,uuid,text,timestamptz) from public,anon;
grant execute on function public.prepare_daily_finish(uuid,uuid,text,timestamptz) to authenticated;

create or replace function public.record_daily_trick_action(p_assignment_id uuid,p_action text default 'landed',p_venue text default '',p_tapped_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.weekly_trick_assignments%rowtype; p public.assignment_progress%rowtype; s public.training_sessions%rowtype;
  v_today date; v_was_done boolean; v_list jsonb; v_candidate jsonb; v_reply jsonb; g public.coach_group_sessions%rowtype;
begin
  select * into a from public.weekly_trick_assignments where id=p_assignment_id and category='daily';
  if a.id is null then raise exception 'Daily trick not found'; end if;
  perform private.require_daily_access(a.athlete_id);
  perform 1 from public.profiles where id=a.athlete_id for update;
  if btrim(coalesce(p_venue,''))<>'' and private.jkcrew_venue_key(p_venue)<>private.jkcrew_venue_key(a.venue) then raise exception 'This trick belongs to a different Daily venue'; end if;
  if p_action not in ('landed','unlanded') or p_action is null then raise exception 'Unknown Daily action'; end if;
  select b.local_today into v_today from public.profiles pr cross join lateral public.jkcrew_week_bounds(pr.country_code) b where pr.id=a.athlete_id;
  if p_action='landed' then
    select * into s from public.training_sessions t where t.athlete_id=a.athlete_id and t.ended_at is null order by t.started_at desc limit 1;
    select gs.* into g from public.coach_group_session_participants gp join public.coach_group_sessions gs on gs.id=gp.group_session_id where gp.training_session_id=s.id order by gs.started_at desc limit 1;
    if s.daily_venue is not null and private.jkcrew_venue_key(case when s.daily_venue='default' then '' else s.daily_venue end)<>private.jkcrew_venue_key(a.venue) then
      raise exception 'Start Daily Tricks for this venue before ticking its list';
    end if;
    if s.id is null or (coalesce(g.started_at,s.started_at) at time zone (select public.jkcrew_country_timezone(country_code) from public.profiles where id=a.athlete_id))::date<>v_today
      or (g.id is not null and (g.status not in ('running','paused') or g.ended_at is not null)) then
      raise exception 'Start Daily Tricks or ask your coach to start today’s group timer before ticking Daily tricks';
    end if;
  end if;
  if not exists(select 1 from private.daily_list_rows(a.athlete_id,a.venue) r where r.id=a.id) then raise exception 'This Daily list has been replaced. Refresh your tricks'; end if;
  select progress_date=v_today into v_was_done from public.assignment_progress where assignment_id=a.id;
  v_was_done:=coalesce(v_was_done,false);
  if (p_action='landed' and not v_was_done) or (p_action='unlanded' and v_was_done) then
    insert into public.assignment_progress(assignment_id,athlete_id,progress_date,updated_at)
    values(a.id,a.athlete_id,case when p_action='landed' then v_today end,clock_timestamp())
    on conflict(assignment_id) do update set progress_date=excluded.progress_date,updated_at=excluded.updated_at;
    select * into s from public.training_sessions t where t.athlete_id=a.athlete_id and t.ended_at is null order by t.started_at desc limit 1;
    if s.id is not null then
      if p_action='landed' then
        insert into public.trick_attempts(session_id,athlete_id,trick_name,category,status,duration_seconds,points)
        values(s.id,a.athlete_id,a.trick_name,'daily','landed',greatest(0,floor(extract(epoch from (now()-s.started_at)))::integer),0);
      else
        delete from public.trick_attempts where id in (select t.id from public.trick_attempts t where t.session_id=s.id and t.athlete_id=a.athlete_id and t.category='daily' and t.trick_name=a.trick_name order by t.created_at desc limit 1);
      end if;
      update public.coach_group_session_participants set last_activity_at=now() where training_session_id=s.id and athlete_id=a.athlete_id;
    end if;
    v_list:=private.daily_list_state(a.athlete_id,a.venue,v_today);
    if p_action='landed' and s.id is not null and s.daily_completed_at is null and (v_list->>'total_count')::integer=(v_list->>'completed_count')::integer then
      -- Ticks outside a valid today's timer still persist, without a fake finish.
      if (s.started_at at time zone (select public.jkcrew_country_timezone(country_code) from public.profiles where id=a.athlete_id))::date=v_today then
        v_reply:=public.prepare_daily_finish(a.athlete_id,s.id,a.venue,p_tapped_at);
        v_candidate:=v_reply->'completion_candidate';
      end if;
    end if;
  end if;
  select * into p from public.assignment_progress where assignment_id=a.id;
  return jsonb_build_object('assignment_id',a.id,'category','daily','venue',a.venue,'progress_date',p.progress_date,'streak_count',p.streak_count,'completed_at',p.completed_at,'points_awarded',0,'points_removed',0,'message',case when p_action='unlanded' then 'Daily trick unticked' else 'Daily trick ticked' end,'live_session',s.id is not null,'elapsed_seconds',coalesce((v_candidate->>'seconds')::integer,0),'completion_candidate',v_candidate);
end $$;
revoke all on function public.record_daily_trick_action(uuid,text,text,timestamptz) from public,anon;
grant execute on function public.record_daily_trick_action(uuid,text,text,timestamptz) to authenticated;

create or replace function public.confirm_daily_finish(p_candidate_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.daily_finish_candidates%rowtype; s public.training_sessions%rowtype; g public.coach_group_sessions%rowtype;
  v_list jsonb; v_result jsonb; v_awards jsonb:='[]'; v_points integer:=0; v_key text; v_label text; v_previous integer; v_global_pb integer; v_xp jsonb; v_xp_delta integer:=0; v_weekly bigint; v_rank bigint; v_today date;
begin
  select * into c from private.daily_finish_candidates where id=p_candidate_id;
  if c.id is null then raise exception 'Daily finish request not found'; end if;
  perform private.require_daily_access(c.athlete_id);
  -- Every finalization locks its group before its rider: first confirmed finish
  -- wins the existing group bonus, once. Unconfirmed candidates earn nothing.
  if c.group_session_id is not null then select * into g from public.coach_group_sessions where id=c.group_session_id for update; end if;
  select daily_pb_seconds into v_global_pb from public.profiles where id=c.athlete_id for update;
  select * into c from private.daily_finish_candidates where id=p_candidate_id for update;
  if c.status='confirmed' then return c.result; end if;
  if c.status<>'pending' then raise exception 'The Daily list changed. Review it and choose Finish again'; end if;
  select * into s from public.training_sessions where id=c.session_id and athlete_id=c.athlete_id for update;
  if s.id is null or s.ended_at is not null or (g.id is not null and (g.status not in ('running','paused') or g.ended_at is not null)) then raise exception 'This Daily timer is no longer active'; end if;
  select b.local_today into v_today from public.profiles p cross join lateral public.jkcrew_week_bounds(p.country_code) b where p.id=c.athlete_id;
  if c.local_date<>v_today then raise exception 'This Daily finish belongs to a previous day. Start today’s Daily Tricks'; end if;
  v_list:=private.daily_list_state(c.athlete_id,case when c.venue='default' then '' else c.venue end,c.local_date);
  if v_list->>'list_signature'<>c.list_signature or v_list->>'progress_signature'<>c.progress_signature or (v_list->>'completed_count')::integer<>c.total_count then raise exception 'The Daily list changed. Review it and choose Finish again'; end if;
  if s.daily_completed_at is not null or exists(select 1 from private.daily_finish_candidates where session_id=s.id and status='confirmed') then raise exception 'This Daily time has already been saved. Refresh the result'; end if;
  for v_key,v_label in select 'daily-complete:'||c.venue||':'||c.local_date::text,'Daily Tricks complete'
      union all select 'daily-under-20:'||c.venue||':'||c.local_date::text,'Daily Tricks under 20 minutes' where c.timed_bonus_eligible and c.seconds<=1200
      union all select 'group-first-finish:'||c.group_session_id::text,'First confirmed group finish' where c.group_session_id is not null and c.timed_bonus_eligible
  loop
    if v_key like 'daily-complete:%' and exists(select 1 from public.assignment_point_awards where athlete_id=c.athlete_id and award_key='daily:'||c.venue||':'||c.local_date::text) then continue; end if;
    if v_key like 'group-first-finish:%' and exists(select 1 from public.assignment_point_awards where award_key=v_key) then continue; end if;
    insert into public.assignment_point_awards(athlete_id,session_id,assignment_id,award_key,points,venue)
    values(c.athlete_id,c.session_id,c.assignment_id,v_key,1,case when c.venue='default' then '' else c.venue end) on conflict(athlete_id,award_key) do nothing;
    if found then v_points:=v_points+1; v_awards:=v_awards||jsonb_build_array(jsonb_build_object('label',v_label,'points',1)); end if;
  end loop;
  perform set_config('jkcrew.confirm_daily_candidate',c.id::text,true);
  update public.training_sessions set daily_venue=c.venue,daily_completed_seconds=c.seconds,daily_completed_at=c.captured_at,total_points=coalesce(total_points,0)+v_points where id=c.session_id;
  if c.group_session_id is not null then update public.coach_group_session_participants set daily_finished_at=c.captured_at,daily_finish_seconds=c.seconds,last_activity_at=now() where group_session_id=c.group_session_id and athlete_id=c.athlete_id; end if;
  select min(seconds) into v_previous from private.daily_finish_candidates where athlete_id=c.athlete_id and list_signature=c.list_signature and status='confirmed';
  -- Existing profile PB is deliberately preserved unless genuinely faster.
  -- It has no historic list signature, so it is not a comparable-results claim.
  if v_global_pb is null or c.seconds<v_global_pb then update public.profiles set daily_pb_seconds=c.seconds,daily_pb_updated_at=now(),updated_at=now() where id=c.athlete_id; end if;
  v_xp:=public.sync_xp_award(c.athlete_id,'daily_complete',c.week_start::text||':'||c.venue||':'||c.local_date::text,35,'Completed full Daily Tricks list',c.assignment_id,c.session_id,'Daily Tricks list',c.venue,null,jsonb_build_object('date',c.local_date,'venue',c.venue,'week_start',c.week_start,'confirmed_result_id',c.id));
  v_xp_delta:=coalesce((v_xp->>'xp_awarded')::integer,0);
  select weekly_points,rank_number into v_weekly,v_rank from public.get_weekly_leaderboard() where athlete_id=c.athlete_id;
  v_result:=jsonb_build_object('result_id',c.id,'candidate_id',c.id,'athlete_id',c.athlete_id,'rider_name',(select display_name from public.profiles where id=c.athlete_id),'session_id',c.session_id,'group_session_id',c.group_session_id,'venue',c.venue,'local_date',c.local_date,'seconds',c.seconds,'completed_at',c.captured_at,'confirmed_at',now(),'completion_points',v_points,'completion_xp',v_xp_delta,'point_awards',v_awards,'previous_pb_seconds',v_previous,'pb_seconds',least(coalesce(v_previous,c.seconds),c.seconds),'is_new_pb',v_previous is null or c.seconds<v_previous,'is_first_pb',v_previous is null,'pb_comparable',true,'weekly_score',v_weekly,'rank_number',v_rank,'completed_count',c.total_count,'total_count',c.total_count);
  update private.daily_finish_candidates set status='confirmed',confirmed_at=now(),result=v_result where id=c.id;
  perform private.notify_confirmed_daily_finish(c.id);
  return v_result;
end $$;
revoke all on function public.confirm_daily_finish(uuid) from public,anon;
grant execute on function public.confirm_daily_finish(uuid) to authenticated;

-- Old explicit Finish endpoints cannot bypass the new confirmation contract.
create or replace function public.finish_group_session_daily(p_group_session_id uuid,p_athlete_id uuid,p_seconds integer)
returns table(message text,athlete_id uuid,daily_finish_seconds integer,previous_pb_seconds integer,new_pb_seconds integer,is_new_pb boolean)
language plpgsql security definer set search_path='' as $$ begin
  perform private.require_daily_access(p_athlete_id);
  raise exception 'Please update JKCREW and confirm Daily Tricks before saving the finish';
end $$;
revoke all on function public.finish_group_session_daily(uuid,uuid,integer) from public,anon;
grant execute on function public.finish_group_session_daily(uuid,uuid,integer) to authenticated;

-- Older app versions wrote timing columns directly after ticking the list.
-- Guard those writes too, including inserts; ordinary profile/session edits and
-- maintenance/imports with no end-user identity retain their existing behavior.
create or replace function private.guard_confirmed_daily_timing()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_athlete uuid; v_allowed boolean:=false; v_token uuid;
begin
  if auth.uid() is null then return new; end if;
  if tg_table_name='profiles' then
    if (new.daily_pb_seconds,new.daily_pb_updated_at) is not distinct from (old.daily_pb_seconds,old.daily_pb_updated_at) then return new; end if;
    v_athlete:=new.id;
    if exists(select 1 from public.profiles p join public.coach_athletes c on c.coach_id=p.id where p.id=auth.uid() and p.role::text in ('coach','admin') and c.athlete_id=v_athlete) then return new; end if;
  elsif tg_table_name='training_sessions' then
    if tg_op='INSERT' and new.daily_completed_at is null and new.daily_completed_seconds is null then return new; end if;
    if tg_op='UPDATE' and (new.daily_completed_at,new.daily_completed_seconds) is not distinct from (old.daily_completed_at,old.daily_completed_seconds) then return new; end if;
    v_athlete:=new.athlete_id;
  else
    if tg_op='INSERT' and new.daily_finished_at is null and new.daily_finish_seconds is null then return new; end if;
    if tg_op='UPDATE' and (new.daily_finished_at,new.daily_finish_seconds) is not distinct from (old.daily_finished_at,old.daily_finish_seconds) then return new; end if;
    v_athlete:=new.athlete_id;
  end if;
  begin v_token:=nullif(current_setting('jkcrew.confirm_daily_candidate',true),'')::uuid; exception when invalid_text_representation then v_token:=null; end;
  select exists(select 1 from private.daily_finish_candidates c where c.id=v_token and c.athlete_id=v_athlete and c.status='pending'
    and ((tg_table_name='profiles') or (to_jsonb(new)->>'id'=c.session_id::text) or (to_jsonb(new)->>'training_session_id'=c.session_id::text))) into v_allowed;
  if not v_allowed then raise exception 'Confirm Daily Tricks before saving its time or PB' using errcode='42501'; end if;
  return new;
end $$;
revoke all on function private.guard_confirmed_daily_timing() from public,anon,authenticated;
create trigger guard_daily_profile_pb before update of daily_pb_seconds,daily_pb_updated_at on public.profiles for each row execute function private.guard_confirmed_daily_timing();
create trigger guard_daily_training_time before insert or update of daily_completed_seconds,daily_completed_at on public.training_sessions for each row execute function private.guard_confirmed_daily_timing();
create trigger guard_daily_group_time before insert or update of daily_finished_at,daily_finish_seconds on public.coach_group_session_participants for each row execute function private.guard_confirmed_daily_timing();

-- Preserve the existing rider-to-coach completion notification, now only for a
-- saved confirmation. Queue failures never undo a successfully saved result.
create or replace function private.notify_confirmed_daily_finish(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare c private.daily_finish_candidates%rowtype; v_name text;
begin
  select * into c from private.daily_finish_candidates where id=p_id and status='confirmed';
  if c.id is null or auth.uid() is distinct from c.athlete_id then return; end if;
  select display_name into v_name from public.profiles where id=c.athlete_id;
  insert into public.push_notification_queue(recipient_id,notification_type,title,body,url,payload,dedupe_key)
  select link.coach_id,'daily_list_completed',coalesce(v_name,'A rider')||' completed their Daily list ✅',
    case when c.venue='default' then 'Full Daily Tricks list complete.' else c.venue||': full Daily Tricks list complete.' end,
    './?push=command',jsonb_build_object('view','command','athlete_id',c.athlete_id,'assignment_id',c.assignment_id,'category','daily','daily_list_complete',true,'venue',nullif(c.venue,'default'),'progress_date',c.local_date,'result_id',c.id),
    'daily-list-completed:'||link.coach_id||':'||c.athlete_id||':'||c.week_start::text||':'||c.venue||':'||c.local_date::text
  from public.coach_athletes link left join public.push_preferences pref on pref.user_id=link.coach_id
  where link.athlete_id=c.athlete_id and coalesce(pref.trick_completed,true)
    and exists(select 1 from public.push_subscriptions sub where sub.user_id=link.coach_id and sub.enabled)
  on conflict(dedupe_key) do nothing;
exception when others then raise warning 'Confirmed Daily notification skipped: %',sqlerrm;
end $$;
revoke all on function private.notify_confirmed_daily_finish(uuid) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.record_assignment_action(p_assignment_id uuid, p_action text DEFAULT 'landed'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_assignment public.weekly_trick_assignments%rowtype;
  v_actor_role public.user_role;
  v_can_manage boolean := false;
  v_actor_is_athlete boolean := false;
  v_session public.training_sessions%rowtype;
  v_group_session public.coach_group_sessions%rowtype;
  v_progress public.assignment_progress%rowtype;
  v_today date;
  v_points integer := 0;
  v_removed_points integer := 0;
  v_deleted_award record;
  v_message text := '';
  v_award_key text;
  v_daily_venue text := '';
  v_daily_complete_key text := '';
  v_daily_under_20_key text := '';
  v_daily_legacy_key text := '';
  v_all_daily_done boolean := false;
  v_has_live_session boolean := false;
  v_elapsed_seconds integer := 0;
  v_group_pause_seconds integer := 0;
begin
  if v_uid is null then
    raise exception 'Sign in required';
  end if;

  select wta.* into v_assignment
  from public.weekly_trick_assignments wta
  where wta.id = p_assignment_id
    and wta.category in ('daily','dialled','one_bang','foam_pit','bonus');
  if not found then
    raise exception 'Assigned trick not found';
  end if;

  if v_assignment.category = 'daily' then
    return public.record_daily_trick_action(p_assignment_id, p_action, '', null);
  end if;

  select p.role into v_actor_role
  from public.profiles p
  where p.id = v_uid;

  v_actor_is_athlete := v_assignment.athlete_id = v_uid;
  v_can_manage := v_actor_is_athlete
    or (
      v_actor_role in ('coach', 'admin')
      and exists (
        select 1
        from public.coach_athletes ca
        where ca.coach_id = v_uid
          and ca.athlete_id = v_assignment.athlete_id
      )
    );

  if not v_can_manage then
    raise exception 'You cannot update this rider''s tricks';
  end if;

  select b.local_today into v_today
  from public.profiles p
  cross join lateral public.jkcrew_week_bounds(p.country_code) b
  where p.id = v_assignment.athlete_id;

  if v_today is null then
    v_today := (now() at time zone 'Australia/Brisbane')::date;
  end if;

  if p_action not in ('landed', 'unlanded') then
    raise exception 'Unknown action';
  end if;

  v_daily_venue := coalesce(nullif(trim(v_assignment.venue), ''), 'default');
  v_daily_complete_key := 'daily-complete:' || v_daily_venue || ':' || v_today::text;
  v_daily_under_20_key := 'daily-under-20:' || v_daily_venue || ':' || v_today::text;
  v_daily_legacy_key := 'daily:' || v_daily_venue || ':' || v_today::text;

  select ts.* into v_session
  from public.training_sessions ts
  where ts.athlete_id = v_assignment.athlete_id
    and ts.ended_at is null
  order by ts.started_at desc
  limit 1;
  v_has_live_session := found;

  if v_has_live_session then
    select cgs.* into v_group_session
    from public.coach_group_session_participants cgsp
    join public.coach_group_sessions cgs on cgs.id = cgsp.group_session_id
    where cgsp.training_session_id = v_session.id
    order by cgs.started_at desc
    limit 1;

    if found then
      v_group_pause_seconds := coalesce(v_group_session.total_paused_seconds, 0)
        + case
          when v_group_session.status = 'paused' and v_group_session.paused_at is not null
            then greatest(0, extract(epoch from (now() - v_group_session.paused_at))::integer)
          else 0
        end;
      v_elapsed_seconds := greatest(0, extract(epoch from (now() - v_group_session.started_at))::integer - v_group_pause_seconds);
      v_has_live_session := v_group_session.status = 'running';
    else
      v_elapsed_seconds := greatest(0, extract(epoch from (now() - v_session.started_at))::integer);
    end if;
  end if;

  insert into public.assignment_progress (assignment_id, athlete_id)
  values (v_assignment.id, v_assignment.athlete_id)
  on conflict (assignment_id) do nothing;

  if p_action = 'unlanded' then
    if v_assignment.category = 'daily' then
      -- Daily checklist state resets/changes independently from earned score.
      -- Once the full list has awarded daily-complete or under-20 points for a
      -- local date, never remove those earned point awards from an untick.
      v_removed_points := 0;

      update public.assignment_progress ap
      set progress_date = null,
          updated_at = now()
      where ap.assignment_id = v_assignment.id
      returning ap.* into v_progress;

      v_message := 'Daily trick unticked';
    else
      v_award_key := v_assignment.category || ':' || v_assignment.id::text;

      for v_deleted_award in
        delete from public.assignment_point_awards apa
        where apa.athlete_id = v_assignment.athlete_id
          and apa.award_key = v_award_key
        returning apa.points, apa.session_id
      loop
        v_removed_points := v_removed_points + coalesce(v_deleted_award.points, 0);
        if v_deleted_award.session_id is not null then
          update public.training_sessions ts
          set total_points = greatest(0, coalesce(ts.total_points, 0) - coalesce(v_deleted_award.points, 0))
          where ts.id = v_deleted_award.session_id;
        end if;
      end loop;

      update public.assignment_progress ap
      set completed_at = null,
          streak_count = case when v_assignment.category = 'dialled' then 0 else ap.streak_count end,
          updated_at = now()
      where ap.assignment_id = v_assignment.id
      returning ap.* into v_progress;

      v_message := case
        when v_assignment.category = 'dialled' then 'Dialled trick unticked'
        when v_assignment.category = 'foam_pit' then 'Foam Pit trick unticked'
        when v_assignment.category = 'bonus' then 'Bonus Trick unticked'
        else 'One Bang unticked'
      end;
    end if;

    if v_session.id is not null then
      delete from public.trick_attempts ta
      where ta.id in (
        select ta2.id
        from public.trick_attempts ta2
        where ta2.session_id = v_session.id
          and ta2.athlete_id = v_assignment.athlete_id
          and ta2.category = v_assignment.category
          and ta2.trick_name = v_assignment.trick_name
        order by ta2.created_at desc
        limit 1
      );
    end if;

    if v_group_session.id is not null then
      update public.coach_group_session_participants cgsp
      set last_activity_at = now()
      where cgsp.group_session_id = v_group_session.id
        and cgsp.athlete_id = v_assignment.athlete_id;
    end if;

    select ap.* into v_progress
    from public.assignment_progress ap
    where ap.assignment_id = v_assignment.id;

    return jsonb_build_object(
      'assignment_id', v_assignment.id,
      'category', v_assignment.category,
      'venue', v_assignment.venue,
      'progress_date', v_progress.progress_date,
      'streak_count', v_progress.streak_count,
      'completed_at', v_progress.completed_at,
      'points_awarded', 0,
      'points_removed', coalesce(v_removed_points, 0),
      'message', v_message,
      'live_session', v_has_live_session,
      'elapsed_seconds', v_elapsed_seconds
    );
  end if;

  if v_assignment.category = 'daily' then
    update public.assignment_progress ap
    set progress_date = v_today,
        updated_at = now()
    where ap.assignment_id = v_assignment.id
    returning ap.* into v_progress;

    select not exists (
      select 1
      from public.weekly_trick_assignments a
      left join public.assignment_progress ap on ap.assignment_id = a.id
      where a.athlete_id = v_assignment.athlete_id
        and a.week_start = v_assignment.week_start
        and a.category = 'daily'
        and coalesce(nullif(trim(a.venue), ''), 'default') = v_daily_venue
        and ap.progress_date is distinct from v_today
    ) into v_all_daily_done;

    if v_all_daily_done then
      if not exists (
        select 1
        from public.assignment_point_awards apa
        where apa.athlete_id = v_assignment.athlete_id
          and apa.award_key in (v_daily_complete_key, v_daily_legacy_key)
      ) then
        insert into public.assignment_point_awards (athlete_id, session_id, assignment_id, award_key, points)
        values (
          v_assignment.athlete_id,
          case when v_session.id is not null then v_session.id else null end,
          v_assignment.id,
          v_daily_complete_key,
          1
        )
        on conflict (athlete_id, award_key) do nothing;
        if found then
          v_points := v_points + 1;
        end if;
      end if;

      if v_has_live_session and v_elapsed_seconds <= 1200 then
        insert into public.assignment_point_awards (athlete_id, session_id, assignment_id, award_key, points)
        values (v_assignment.athlete_id, v_session.id, v_assignment.id, v_daily_under_20_key, 1)
        on conflict (athlete_id, award_key) do nothing;
        if found then
          v_points := v_points + 1;
        end if;
      end if;

      if v_group_session.id is not null and v_group_session.status = 'running' then
        v_award_key := 'group-first-finish:' || v_group_session.id::text;
        if not exists (
          select 1
          from public.assignment_point_awards apa
          where apa.award_key = v_award_key
        ) then
          insert into public.assignment_point_awards (athlete_id, session_id, assignment_id, award_key, points)
          values (v_assignment.athlete_id, v_session.id, v_assignment.id, v_award_key, 1)
          on conflict (athlete_id, award_key) do nothing;
          if found then
            v_points := v_points + 1;
          end if;
        end if;
      end if;
    end if;

    v_message := case
      when v_points >= 3 then 'Daily Tricks complete, under 20 minutes, and first in the group'
      when v_points = 2 and v_has_live_session and v_elapsed_seconds <= 1200 then 'Daily Tricks complete inside 20 minutes'
      when v_points = 2 then 'Daily Tricks complete plus first finish bonus'
      when v_points = 1 and v_all_daily_done then 'Daily Tricks list complete'
      when v_has_live_session then 'Daily trick ticked'
      else 'Daily progress saved outside a live session'
    end;

  elsif v_assignment.category = 'one_bang' then
    update public.assignment_progress ap
    set completed_at = coalesce(ap.completed_at, now()),
        updated_at = now()
    where ap.assignment_id = v_assignment.id
    returning ap.* into v_progress;

    v_award_key := 'one_bang:' || v_assignment.id::text;
    insert into public.assignment_point_awards (athlete_id, session_id, assignment_id, award_key, points)
    values (v_assignment.athlete_id, case when v_session.id is not null then v_session.id else null end, v_assignment.id, v_award_key, 2)
    on conflict (athlete_id, award_key) do nothing;
    if found then
      v_points := 2;
    end if;
    v_message := 'One Bang complete';

  elsif v_assignment.category = 'dialled' then
    update public.assignment_progress ap
    set completed_at = coalesce(ap.completed_at, now()),
        streak_count = 1,
        updated_at = now()
    where ap.assignment_id = v_assignment.id
    returning ap.* into v_progress;

    v_award_key := 'dialled:' || v_assignment.id::text;
    insert into public.assignment_point_awards (athlete_id, session_id, assignment_id, award_key, points)
    values (v_assignment.athlete_id, case when v_session.id is not null then v_session.id else null end, v_assignment.id, v_award_key, 2)
    on conflict (athlete_id, award_key) do nothing;
    if found then
      v_points := 2;
    end if;
    v_message := 'Dialled trick complete';

  elsif v_assignment.category = 'bonus' then
    update public.assignment_progress ap
    set completed_at = coalesce(ap.completed_at, now()),
        updated_at = now()
    where ap.assignment_id = v_assignment.id
    returning ap.* into v_progress;

    v_award_key := 'bonus:' || v_assignment.id::text;
    insert into public.assignment_point_awards (athlete_id, session_id, assignment_id, award_key, points)
    values (v_assignment.athlete_id, case when v_session.id is not null then v_session.id else null end, v_assignment.id, v_award_key, 5)
    on conflict (athlete_id, award_key) do nothing;
    if found then
      v_points := 5;
    end if;
    v_message := 'Bonus Trick complete';

  elsif v_assignment.category = 'foam_pit' then
    update public.assignment_progress ap
    set completed_at = coalesce(ap.completed_at, now()),
        updated_at = now()
    where ap.assignment_id = v_assignment.id
    returning ap.* into v_progress;

    v_points := 0;
    v_message := 'Foam Pit practice ticked';
  end if;

  if v_session.id is not null then
    insert into public.trick_attempts (session_id, athlete_id, trick_name, category, status, duration_seconds, points)
    values (v_session.id, v_assignment.athlete_id, v_assignment.trick_name, v_assignment.category, 'landed', v_elapsed_seconds, v_points);

    if v_points > 0 then
      update public.training_sessions ts
      set total_points = coalesce(ts.total_points, 0) + v_points
      where ts.id = v_session.id;
    end if;
  end if;

  if v_group_session.id is not null then
    update public.coach_group_session_participants cgsp
    set last_activity_at = now()
    where cgsp.group_session_id = v_group_session.id
      and cgsp.athlete_id = v_assignment.athlete_id;
  end if;

  select ap.* into v_progress
  from public.assignment_progress ap
  where ap.assignment_id = v_assignment.id;

  return jsonb_build_object(
    'assignment_id', v_assignment.id,
    'category', v_assignment.category,
    'venue', v_assignment.venue,
    'progress_date', v_progress.progress_date,
    'streak_count', v_progress.streak_count,
    'completed_at', v_progress.completed_at,
    'points_awarded', v_points,
    'points_removed', 0,
    'message', v_message,
    'live_session', v_has_live_session,
    'elapsed_seconds', v_elapsed_seconds
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sync_assignment_progress_xp()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_assignment public.weekly_trick_assignments%rowtype;
  v_row public.assignment_progress%rowtype;
  v_old_date date;
  v_new_date date;
  v_date date;
  v_venue text;
  v_source_id text;
  v_done boolean;
  v_xp integer;
  v_reason text;
begin
  v_row := coalesce(new, old);

  select wta.* into v_assignment
  from public.weekly_trick_assignments wta
  where wta.id = v_row.assignment_id;

  if v_assignment.id is null then
    return coalesce(new, old);
  end if;

  -- Daily completion XP is now issued by confirm_daily_finish only.
  if v_assignment.category = 'daily' then return coalesce(new, old); end if;

  if v_assignment.category in ('one_bang', 'dialled', 'bonus') then
    v_xp := case when v_assignment.category = 'bonus' then 250 else 35 end;
    v_reason := case when v_assignment.category = 'bonus' then 'Completed Bonus Trick' when v_assignment.category = 'dialled' then 'Landed Dialled trick' else 'Landed One Bang' end;

    perform public.sync_xp_award(
      v_assignment.athlete_id,
      v_assignment.category,
      v_assignment.id::text,
      case when tg_op <> 'DELETE' and new.completed_at is not null then v_xp else 0 end,
      v_reason,
      v_assignment.id,
      null,
      v_assignment.trick_name,
      v_assignment.venue,
      null,
      jsonb_build_object('week_start', v_assignment.week_start)
    );
  end if;

  return coalesce(new, old);
end;
$function$
;
CREATE OR REPLACE FUNCTION private.queue_jkcrew_trick_completion_push()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog'
AS $function$
declare
  v_assignment public.weekly_trick_assignments%rowtype;
  v_athlete_name text;
  v_became_complete boolean := false;
  v_daily_list_complete boolean := false;
  v_completion_key text;
  v_category_label text;
  v_notification_title text;
  v_notification_body text;
  v_venue text;
begin
  select assignment.* into v_assignment
  from public.weekly_trick_assignments assignment
  where assignment.id = new.assignment_id;

  if v_assignment.id is null or (select auth.uid()) is distinct from new.athlete_id then
    return new;
  end if;

  select profile.display_name into v_athlete_name
  from public.profiles profile
  where profile.id = new.athlete_id;

  -- Unconfirmed ticks must not announce a completed Daily result.
  if v_assignment.category = 'daily' then return new; end if;

  if v_assignment.category = 'daily' then
    v_became_complete := new.progress_date is not null
      and (tg_op = 'INSERT' or old.progress_date is distinct from new.progress_date);

    if not v_became_complete then
      return new;
    end if;

    v_venue := coalesce(nullif(btrim(v_assignment.venue), ''), 'default');

    select not exists (
      select 1
      from public.weekly_trick_assignments assignment
      left join public.assignment_progress progress
        on progress.assignment_id = assignment.id
      where assignment.athlete_id = v_assignment.athlete_id
        and assignment.week_start = v_assignment.week_start
        and assignment.category = 'daily'
        and coalesce(nullif(btrim(assignment.venue), ''), 'default') = v_venue
        and progress.progress_date is distinct from new.progress_date
    ) into v_daily_list_complete;

    if not v_daily_list_complete then
      return new;
    end if;

    v_completion_key := v_assignment.week_start::text || ':' || v_venue || ':' || new.progress_date::text;
    v_category_label := 'Daily Tricks';
    v_notification_title := coalesce(v_athlete_name, 'A rider') || ' completed their Daily list ✅';
    v_notification_body := case
      when v_venue = 'default' then 'Full Daily Tricks list complete.'
      else v_venue || ': full Daily Tricks list complete.'
    end;
  else
    v_became_complete := new.completed_at is not null
      and (tg_op = 'INSERT' or old.completed_at is null);

    if not v_became_complete then
      return new;
    end if;

    v_completion_key := v_assignment.id::text;
    v_category_label := case v_assignment.category
      when 'one_bang' then 'One Bang'
      when 'dialled' then 'Dialled'
      when 'percentage' then 'Percentage Trick'
      when 'lines' then 'Line'
      when 'bonus' then 'Bonus Trick'
      else initcap(replace(v_assignment.category, '_', ' '))
    end;
    v_notification_title := coalesce(v_athlete_name, 'A rider') || ' completed a trick 🔥';
    v_notification_body := v_category_label || ': ' || v_assignment.trick_name;
  end if;

  insert into public.push_notification_queue (
    recipient_id,
    notification_type,
    title,
    body,
    url,
    payload,
    dedupe_key
  )
  select
    link.coach_id,
    case when v_assignment.category = 'daily' then 'daily_list_completed' else 'trick_completed' end,
    v_notification_title,
    v_notification_body,
    './?push=command',
    jsonb_build_object(
      'view', 'command',
      'athlete_id', new.athlete_id,
      'assignment_id', v_assignment.id,
      'category', v_assignment.category,
      'daily_list_complete', v_assignment.category = 'daily',
      'venue', nullif(v_venue, 'default'),
      'progress_date', new.progress_date
    ),
    case
      when v_assignment.category = 'daily'
        then 'daily-list-completed:' || link.coach_id || ':' || new.athlete_id || ':' || v_completion_key
      else 'trick-completed:' || link.coach_id || ':' || v_assignment.id || ':' || v_completion_key
    end
  from public.coach_athletes link
  left join public.push_preferences preference on preference.user_id = link.coach_id
  where link.athlete_id = new.athlete_id
    and coalesce(preference.trick_completed, true)
    and exists (
      select 1
      from public.push_subscriptions subscription
      where subscription.user_id = link.coach_id
        and subscription.enabled
    )
  on conflict (dedupe_key) do nothing;

  return new;
exception when others then
  raise warning 'JKCREW trick completion push skipped: %', sqlerrm;
  return new;
end;
$function$
;
-- Reads ledger timestamps across every visit on the rider's local day. It does
-- not finish training, infer a duration, or treat a session total as a day award.
create or replace function public.get_today_training_progress(p_athlete_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_tz text; v_date date; v_from timestamptz; v_to timestamptz; v_name text;
  v_daily jsonb; v_categories jsonb; v_points bigint; v_xp bigint; v_weekly bigint; v_rank bigint; v_improvements jsonb; v_goal jsonb; v_xp_partial boolean;
begin
  perform private.require_daily_access(p_athlete_id,true);
  select display_name,public.jkcrew_country_timezone(country_code) into v_name,v_tz from public.profiles where id=p_athlete_id;
  v_date:=(now() at time zone v_tz)::date;
  v_from:=v_date::timestamp at time zone v_tz;
  v_to:=(v_date+1)::timestamp at time zone v_tz;
  select coalesce(jsonb_agg(d.result order by d.at),'[]') into v_daily from (
    select c.result,c.captured_at as at from private.daily_finish_candidates c
    where c.athlete_id=p_athlete_id and c.local_date=v_date and c.status='confirmed'
    union all
    select jsonb_build_object('result_id',s.id,'athlete_id',p_athlete_id,'rider_name',v_name,'session_id',s.id,'seconds',s.daily_completed_seconds,'completed_at',s.daily_completed_at,'local_date',v_date,'venue','',
      'completion_points',(select sum(a.points) from public.assignment_point_awards a where a.session_id=s.id and a.athlete_id=p_athlete_id and (a.award_key like 'daily:%' or a.award_key like 'daily-complete:%' or a.award_key like 'daily-under-20:%' or a.award_key like 'group-first-finish:%')),
      'completion_xp',null,'legacy',true,'pb_comparable',false),s.daily_completed_at
    from public.training_sessions s where s.athlete_id=p_athlete_id and s.daily_completed_at>=v_from and s.daily_completed_at<v_to and s.daily_completed_seconds is not null
      and not exists(select 1 from private.daily_finish_candidates c where c.session_id=s.id and c.status='confirmed')
  ) d;
  -- The durable history already folds current progress, replaced sheets and
  -- percentage attempts into stable source IDs. Never count an attempted trick
  -- or a revoked landing as completed. Group multiple landings of one trick.
  with evidence as (
    select distinct on (coalesce(h.assignment_id::text,h.id),h.category)
      coalesce(h.assignment_id::text,h.id) id,h.category,h.trick_name,h.notes,h.venue,h.landed_at
    from public.tricktionary_landing_history h
    where h.athlete_id=p_athlete_id and h.landed_count>0 and h.evidence_type<>'revoked' and h.landed_at>=v_from and h.landed_at<v_to
    order by coalesce(h.assignment_id::text,h.id),h.category,h.landed_at
  ), grouped as (
    select category,jsonb_agg(jsonb_build_object('id',id,'trick_name',trick_name,'notes',notes,'venue',venue,'completed_at',landed_at) order by landed_at,id) items
    from evidence group by category
  ) select coalesce(jsonb_agg(to_jsonb(g) order by category),'[]') into v_categories from grouped g;
  select coalesce(sum(e.points),0) into v_points from (
    select a.points from public.assignment_point_awards a where a.athlete_id=p_athlete_id and a.created_at>=v_from and a.created_at<v_to
    union all
    select a.points from public.leaderboard_point_adjustments a cross join lateral public.jkcrew_week_bounds((select country_code from public.profiles where id=p_athlete_id)) b
    where a.athlete_id=p_athlete_id and a.created_at>=v_from and a.created_at<v_to and a.week_start=b.week_start_date and coalesce(a.reason,'') not ilike 'All-time score correction%'
  ) e;
  select coalesce(sum(x.xp),0) into v_xp from public.xp_ledger x where x.athlete_id=p_athlete_id and x.created_at>=v_from and x.created_at<v_to;
  select exists(select 1 from public.xp_ledger x where x.athlete_id=p_athlete_id and x.created_at<v_from and x.updated_at>=v_from and x.updated_at<v_to) into v_xp_partial;
  select weekly_points,rank_number into v_weekly,v_rank from public.get_weekly_leaderboard() where athlete_id=p_athlete_id;
  select coalesce(jsonb_agg(jsonb_build_object('type','daily_pb','seconds',c.seconds,'previous_pb_seconds',c.result->'previous_pb_seconds','venue',c.venue,'is_first_pb',c.result->'is_first_pb') order by c.captured_at),'[]') into v_improvements
  from private.daily_finish_candidates c where c.athlete_id=p_athlete_id and c.local_date=v_date and c.status='confirmed' and (c.result->>'is_new_pb')::boolean;
  select jsonb_build_object('category',a.category,'trick_name',a.trick_name,'notes',a.notes) into v_goal
  from public.weekly_trick_assignments a left join public.assignment_progress p on p.assignment_id=a.id
  where a.athlete_id=p_athlete_id and a.week_start<=v_date and a.week_start=(select max(b.week_start) from public.weekly_trick_assignments b where b.athlete_id=p_athlete_id and b.category=a.category and b.week_start<=v_date)
    and ((a.category='daily' and p.progress_date is distinct from v_date) or (a.category<>'daily' and p.completed_at is null))
  order by case a.category when 'daily' then 0 when 'one_bang' then 1 when 'dialled' then 2 when 'lines' then 3 else 4 end,a.sort_order,a.id limit 1;
  return jsonb_build_object('athlete_id',p_athlete_id,'rider_name',v_name,'local_date',v_date,'timezone',v_tz,'daily_results',v_daily,'completed_categories',v_categories,'today_points',v_points,'today_xp',case when v_xp_partial then null else v_xp end,'attributable_today_xp',v_xp,'xp_attribution',case when v_xp_partial then 'partial' else 'complete' end,'xp_attribution_note',case when v_xp_partial then 'Some earlier XP entries changed today, so a complete daily XP total is not available.' else null end,'weekly_score',v_weekly,'rank_number',v_rank,'improvements',v_improvements,'next_goal',v_goal,'no_data',jsonb_array_length(v_daily)=0 and jsonb_array_length(v_categories)=0 and v_points=0 and v_xp=0 and not v_xp_partial);
end $$;
revoke all on function public.get_today_training_progress(uuid) from public,anon;
grant execute on function public.get_today_training_progress(uuid) to authenticated;
