-- A rider may finish the Daily section without claiming a complete list.
-- Partial finishes live only in the private result ledger: full-completion timing,
-- scores, XP, PBs, landed ticks and the rest of the active session are untouched.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- NULL is the historical full-list contract; no existing result is rewritten.
alter table private.daily_finish_candidates add column completed_count integer
  check (completed_count >= 0 and completed_count <= total_count);


create or replace function private.daily_candidate_json(p_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('candidate_id',c.id,'athlete_id',c.athlete_id,'rider_name',p.display_name,
    'session_id',c.session_id,'group_session_id',c.group_session_id,'venue',c.venue,'local_date',c.local_date,
    'seconds',c.seconds,'captured_at',c.captured_at,'completed_count',coalesce(c.completed_count,c.total_count),'total_count',c.total_count,
    'all_completed',coalesce(c.completed_count,c.total_count)=c.total_count)
  from private.daily_finish_candidates c join public.profiles p on p.id=c.athlete_id where c.id=p_id;
$$;

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
  if found then
    if p_venue is not null and private.jkcrew_venue_key(case when c.venue='default' then '' else c.venue end)<>private.jkcrew_venue_key(p_venue) then
      raise exception 'Start Daily Tricks for this venue before finishing its list';
    end if;
    return jsonb_build_object('completion_candidate',null,'result',c.result);
  end if;
  if s.daily_completed_at is not null then
    return jsonb_build_object('completion_candidate',null,'result',jsonb_build_object('result_id',s.id,'athlete_id',p_athlete_id,'rider_name',(select display_name from public.profiles where id=p_athlete_id),'session_id',s.id,'seconds',s.daily_completed_seconds,'completed_at',s.daily_completed_at,'local_date',(s.daily_completed_at at time zone v_tz)::date,'completion_points',null,'completion_xp',null,'legacy',true,'pb_comparable',false));
  end if;
  if g.id is not null and (g.status not in ('running','paused') or g.ended_at is not null) then raise exception 'This Daily timer is no longer active'; end if;
  v_list:=private.daily_list_state(p_athlete_id,v_venue,v_date);
  if (v_list->>'total_count')::integer=0 then raise exception 'There are no Daily tricks in this list'; end if;
  v_start:=coalesce(g.started_at,s.started_at);
  if (v_start at time zone v_tz)::date<>v_date then raise exception 'Start a fresh Daily timer for today'; end if;
  -- Only a complete list can claim a timed result, so its existing landing
  -- evidence validation remains strict. A partial saves honest checklist counts.
  if (v_list->>'completed_count')::integer=(v_list->>'total_count')::integer
    and exists(select 1 from private.daily_list_rows(p_athlete_id,v_venue) a
    left join public.tricktionary_landing_history h on h.id='daily:'||a.id::text||':'||v_date::text
    where h.id is null or h.landed_count<=0 or h.landed_at<v_start) then
    raise exception 'Some Daily tricks were ticked before this timer started. Untick those tricks and complete them again to record a valid Daily time';
  end if;
  v_tap:=case when p_tapped_at between v_now-interval '30 seconds' and v_now then p_tapped_at else v_now end;
  v_tap:=greatest(v_start,v_tap);
  v_seconds:=greatest(0,floor(extract(epoch from (v_tap-v_start)))::integer-coalesce(g.total_paused_seconds,0)-case when g.status='paused' and g.paused_at is not null then greatest(0,floor(extract(epoch from (v_tap-g.paused_at)))::integer) else 0 end);
  update private.daily_finish_candidates set status='invalidated' where session_id=s.id and status='pending';
  insert into private.daily_finish_candidates(athlete_id,session_id,group_session_id,assignment_id,week_start,venue,local_date,seconds,captured_at,list_signature,progress_signature,total_count,completed_count,timed_bonus_eligible)
  values(p_athlete_id,s.id,g.id,(v_list->>'assignment_id')::uuid,(v_list->>'week_start')::date,v_list->>'venue',v_date,v_seconds,v_tap,v_list->>'list_signature',v_list->>'progress_signature',(v_list->>'total_count')::integer,(v_list->>'completed_count')::integer,
    (v_list->>'completed_count')::integer=(v_list->>'total_count')::integer and (g.id is null or g.status='running')) returning * into c;
  return jsonb_build_object('completion_candidate',private.daily_candidate_json(c.id),'result',null);
end $$;

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
  if v_list->>'list_signature'<>c.list_signature or v_list->>'progress_signature'<>c.progress_signature or (v_list->>'total_count')::integer<>c.total_count
    or (v_list->>'completed_count')::integer<>coalesce(c.completed_count,c.total_count) then raise exception 'The Daily list changed. Review it and choose Finish again'; end if;
  if s.daily_completed_at is not null or exists(select 1 from private.daily_finish_candidates where session_id=s.id and status='confirmed') then raise exception 'This Daily time has already been saved. Refresh the result'; end if;
  -- This result closes the Daily section only. Do not write the legacy full-list
  -- timer columns: those columns drive PBs, badges, summaries and scoring guards.
  if coalesce(c.completed_count,c.total_count)<c.total_count then
    select weekly_points,rank_number into v_weekly,v_rank from private.daily_readonly_standings() where athlete_id=c.athlete_id;
    v_result:=jsonb_build_object('result_id',c.id,'candidate_id',c.id,'athlete_id',c.athlete_id,
      'rider_name',(select display_name from public.profiles where id=c.athlete_id),
      'session_id',c.session_id,'group_session_id',c.group_session_id,'venue',c.venue,'local_date',c.local_date,
      'seconds',c.seconds,'completed_at',c.captured_at,'confirmed_at',now(),
      'completion_points',0,'completion_xp',0,'point_awards','[]'::jsonb,
      'previous_pb_seconds',null,'pb_seconds',null,'is_new_pb',false,'is_first_pb',false,'pb_comparable',false,
      'weekly_score',v_weekly,'rank_number',v_rank,'completed_count',c.completed_count,'total_count',c.total_count,'all_completed',false);
    update private.daily_finish_candidates set status='confirmed',confirmed_at=now(),result=v_result where id=c.id;
    -- Publish an ordinary activity change so linked coach screens refresh their
    -- private result snapshot; completion timing and scoring fields stay unchanged.
    if c.group_session_id is not null then
      update public.coach_group_session_participants set last_activity_at=clock_timestamp()
      where group_session_id=c.group_session_id and athlete_id=c.athlete_id and training_session_id=c.session_id;
    end if;
    return v_result;
  end if;
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
  select min(seconds) into v_previous from private.daily_finish_candidates where athlete_id=c.athlete_id and list_signature=c.list_signature and status='confirmed'
    and coalesce(completed_count,total_count)=total_count;
  -- Existing profile PB is deliberately preserved unless genuinely faster.
  -- It has no historic list signature, so it is not a comparable-results claim.
  if v_global_pb is null or c.seconds<v_global_pb then update public.profiles set daily_pb_seconds=c.seconds,daily_pb_updated_at=now(),updated_at=now() where id=c.athlete_id; end if;
  v_xp:=public.sync_xp_award(c.athlete_id,'daily_complete',c.week_start::text||':'||c.venue||':'||c.local_date::text,35,'Completed full Daily Tricks list',c.assignment_id,c.session_id,'Daily Tricks list',c.venue,null,jsonb_build_object('date',c.local_date,'venue',c.venue,'week_start',c.week_start,'confirmed_result_id',c.id));
  v_xp_delta:=coalesce((v_xp->>'xp_awarded')::integer,0);
  select weekly_points,rank_number into v_weekly,v_rank from private.daily_readonly_standings() where athlete_id=c.athlete_id;
  v_result:=jsonb_build_object('result_id',c.id,'candidate_id',c.id,'athlete_id',c.athlete_id,'rider_name',(select display_name from public.profiles where id=c.athlete_id),'session_id',c.session_id,'group_session_id',c.group_session_id,'venue',c.venue,'local_date',c.local_date,'seconds',c.seconds,'completed_at',c.captured_at,'confirmed_at',now(),'completion_points',v_points,'completion_xp',v_xp_delta,'point_awards',v_awards,'previous_pb_seconds',v_previous,'pb_seconds',least(coalesce(v_previous,c.seconds),c.seconds),'is_new_pb',v_previous is null or c.seconds<v_previous,'is_first_pb',v_previous is null,'pb_comparable',true,'weekly_score',v_weekly,'rank_number',v_rank,'completed_count',c.total_count,'total_count',c.total_count,'all_completed',true);
  update private.daily_finish_candidates set status='confirmed',confirmed_at=now(),result=v_result where id=c.id;
  perform private.notify_confirmed_daily_finish(c.id);
  return v_result;
end $$;

create or replace function public.start_daily_tricks(p_venue text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.training_sessions%rowtype; v_date date; v_tz text; v_old_venue text; v_saved private.daily_finish_candidates%rowtype; v_finished boolean; v_venue text:=coalesce(nullif(btrim(p_venue),''),'default');
begin
  perform private.require_daily_access(auth.uid());
  perform 1 from public.profiles where id=auth.uid() for update;
  select public.jkcrew_country_timezone(country_code) into v_tz from public.profiles where id=auth.uid();
  v_date:=(now() at time zone v_tz)::date;
  select t.* into s from public.training_sessions t where t.athlete_id=auth.uid() and t.ended_at is null order by t.started_at desc limit 1 for update;
  select * into v_saved from private.daily_finish_candidates where session_id=s.id and status='confirmed';
  v_finished:=s.daily_completed_at is not null or v_saved.id is not null;
  v_old_venue:=coalesce(s.daily_venue,v_saved.venue);
  if v_old_venue is null and s.id is not null then
    select coalesce(gs.venue,a.venue) into v_old_venue from (select 1) seed
    left join lateral (select g.venue from public.coach_group_session_participants p join public.coach_group_sessions g on g.id=p.group_session_id where p.training_session_id=s.id order by g.started_at desc limit 1) gs on true
    left join lateral (select coalesce(nullif(btrim(w.venue),''),'default') as venue from public.assignment_point_awards aw join public.weekly_trick_assignments w on w.id=aw.assignment_id where aw.session_id=s.id and w.category='daily' order by aw.created_at limit 1) a on true;
  end if;
  if s.id is null or (s.started_at at time zone v_tz)::date<>v_date
    or (v_finished and (v_old_venue is null or private.jkcrew_venue_key(v_old_venue)<>private.jkcrew_venue_key(v_venue))) then
    insert into public.training_sessions(athlete_id,daily_venue) values(auth.uid(),v_venue) returning * into s;
  elsif not v_finished and s.daily_venue is not null and private.jkcrew_venue_key(case when s.daily_venue='default' then '' else s.daily_venue end)<>private.jkcrew_venue_key(p_venue) then
    raise exception 'A Daily timer is already running for another venue. Return to that venue and finish its list first';
  elsif s.daily_venue is null then
    update public.training_sessions set daily_venue=coalesce(v_old_venue,v_venue) where id=s.id returning * into s;
  end if;
  return to_jsonb(s);
end $$;

create or replace function private.notify_confirmed_daily_finish(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare c private.daily_finish_candidates%rowtype; v_name text;
begin
  select * into c from private.daily_finish_candidates where id=p_id and status='confirmed';
  if c.id is null or coalesce(c.completed_count,c.total_count)<c.total_count
    or auth.uid() is distinct from c.athlete_id then return; end if;
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
    and coalesce(c.completed_count,c.total_count)=c.total_count
    and ((tg_table_name='profiles') or (to_jsonb(new)->>'id'=c.session_id::text) or (to_jsonb(new)->>'training_session_id'=c.session_id::text))) into v_allowed;
  if not v_allowed then raise exception 'Confirm Daily Tricks before saving its time or PB' using errcode='42501'; end if;
  return new;
end $$;

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
    select c.result||jsonb_build_object('completed_count',coalesce(c.completed_count,c.total_count),
      'total_count',c.total_count,'all_completed',coalesce(c.completed_count,c.total_count)=c.total_count) as result,c.captured_at as at from private.daily_finish_candidates c
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
  select weekly_points,rank_number into v_weekly,v_rank from private.daily_readonly_standings() where athlete_id=p_athlete_id;
  select coalesce(jsonb_agg(jsonb_build_object('type','daily_pb','seconds',c.seconds,'previous_pb_seconds',c.result->'previous_pb_seconds','venue',c.venue,'is_first_pb',c.result->'is_first_pb') order by c.captured_at),'[]') into v_improvements
  from private.daily_finish_candidates c where c.athlete_id=p_athlete_id and c.local_date=v_date and c.status='confirmed' and coalesce(c.completed_count,c.total_count)=c.total_count and (c.result->>'is_new_pb')::boolean;
  select jsonb_build_object('category',a.category,'trick_name',a.trick_name,'notes',a.notes) into v_goal
  from public.weekly_trick_assignments a left join public.assignment_progress p on p.assignment_id=a.id
  where a.athlete_id=p_athlete_id and a.week_start<=v_date and a.week_start=(select max(b.week_start) from public.weekly_trick_assignments b where b.athlete_id=p_athlete_id and b.category=a.category and b.week_start<=v_date)
    and ((a.category='daily' and p.progress_date is distinct from v_date) or (a.category<>'daily' and p.completed_at is null))
  order by case a.category when 'daily' then 0 when 'one_bang' then 1 when 'dialled' then 2 when 'lines' then 3 else 4 end,a.sort_order,a.id limit 1;
  return jsonb_build_object('athlete_id',p_athlete_id,'rider_name',v_name,'local_date',v_date,'timezone',v_tz,'daily_results',v_daily,'completed_categories',v_categories,'today_points',v_points,'today_xp',case when v_xp_partial then null else v_xp end,'attributable_today_xp',v_xp,'xp_attribution',case when v_xp_partial then 'partial' else 'complete' end,'xp_attribution_note',case when v_xp_partial then 'Some earlier XP entries changed today, so a complete daily XP total is not available.' else null end,'weekly_score',v_weekly,'rank_number',v_rank,'improvements',v_improvements,'next_goal',v_goal,'no_data',jsonb_array_length(v_daily)=0 and jsonb_array_length(v_categories)=0 and v_points=0 and v_xp=0 and not v_xp_partial);
end $$;

-- Restore both complete and partial saved timers without inventing completion
-- columns or creating pending candidates. Validate every existing requested session
-- before returning any results, using the same own/coach/parent privacy rules as Today.
create function public.get_daily_finish_results(p_session_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_session record; v_results jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  if coalesce(cardinality(p_session_ids),0)>100 then raise exception 'Request at most 100 Daily results at a time' using errcode='22023'; end if;
  for v_session in select distinct s.athlete_id from public.training_sessions s where s.id=any(p_session_ids)
  loop
    perform private.require_daily_access(v_session.athlete_id,true);
  end loop;
  select coalesce(jsonb_agg(c.result||jsonb_build_object(
    'completed_count',coalesce(c.completed_count,c.total_count),'total_count',c.total_count,
    'all_completed',coalesce(c.completed_count,c.total_count)=c.total_count)
    order by c.captured_at,c.id),'[]'::jsonb) into v_results
  from private.daily_finish_candidates c join public.training_sessions s
    on s.id=c.session_id and s.athlete_id=c.athlete_id
  where c.session_id=any(p_session_ids) and c.status='confirmed';
  return v_results;
end $$;
revoke all on function public.get_daily_finish_results(uuid[]) from public,anon;
grant execute on function public.get_daily_finish_results(uuid[]) to authenticated;

-- CREATE OR REPLACE preserves each existing function's grants and owner.
notify pgrst, 'reload schema';
