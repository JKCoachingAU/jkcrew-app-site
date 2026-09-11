-- The legacy leaderboard synchronizes badges as a side effect. Daily results
-- and Today need only the same weekly score/rank, without that write path.
-- Preserve its country boundaries, legacy-session exclusion, event counting,
-- ghost visibility and RANK ordering exactly; do not alter the global reader.
create or replace function private.daily_readonly_standings()
returns table(athlete_id uuid,weekly_points bigint,rank_number bigint)
language sql stable security definer set search_path='' as $$
  with viewer as (
    select auth.uid() as viewer_id,
      exists(select 1 from public.profiles me where me.id=auth.uid() and me.role in ('coach','admin')) as is_coach
  ), score_rows as (
    select p.id as athlete_id,p.display_name,coalesce(p.ghost_mode,false) as ghost_mode,
      greatest(0,coalesce(current_awards.points,0)+coalesce(current_legacy_sessions.points,0)+coalesce(current_adjustments.points,0))::bigint as weekly_points,
      (coalesce(current_awards.events,0)+coalesce(current_legacy_sessions.events,0)+coalesce(current_adjustments.events,0))::bigint as weekly_point_events
    from public.profiles p
    cross join lateral public.jkcrew_week_bounds(p.country_code) b
    left join lateral (
      select coalesce(sum(a.points),0)::bigint as points,count(*)::bigint as events
      from public.assignment_point_awards a where a.athlete_id=p.id and a.created_at>=b.week_start_ts and a.created_at<b.next_week_start_ts
    ) current_awards on true
    left join lateral (
      select coalesce(sum(s.total_points),0)::bigint as points,count(*)::bigint as events
      from public.training_sessions s where s.athlete_id=p.id and s.started_at>=b.week_start_ts and s.started_at<b.next_week_start_ts
        and coalesce(s.total_points,0)<>0
        and not exists(select 1 from public.assignment_point_awards a where a.session_id=s.id)
    ) current_legacy_sessions on true
    left join lateral (
      select coalesce(sum(a.points),0)::bigint as points,count(*)::bigint as events
      from public.leaderboard_point_adjustments a where a.athlete_id=p.id and a.week_start=b.week_start_date
        and coalesce(a.reason,'') not ilike 'All-time score correction%'
    ) current_adjustments on true
    where p.role='athlete'
  ), visible_rows as (
    select s.*,(s.weekly_point_events>0 or s.weekly_points>0) as weekly_started
    from score_rows s cross join viewer v where not s.ghost_mode or s.athlete_id=v.viewer_id or v.is_coach
  ), ranked as (
    select v.*,rank() over(order by case when v.weekly_started then 0 else 1 end,v.weekly_points desc,v.display_name asc) as rank_number
    from visible_rows v
  )
  select r.athlete_id,r.weekly_points,r.rank_number from ranked r
  order by case when r.weekly_started then 0 else 1 end,r.weekly_points desc,r.display_name asc;
$$;
revoke all on function private.daily_readonly_standings() from public,anon,authenticated;

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
  select weekly_points,rank_number into v_weekly,v_rank from private.daily_readonly_standings() where athlete_id=c.athlete_id;
  v_result:=jsonb_build_object('result_id',c.id,'candidate_id',c.id,'athlete_id',c.athlete_id,'rider_name',(select display_name from public.profiles where id=c.athlete_id),'session_id',c.session_id,'group_session_id',c.group_session_id,'venue',c.venue,'local_date',c.local_date,'seconds',c.seconds,'completed_at',c.captured_at,'confirmed_at',now(),'completion_points',v_points,'completion_xp',v_xp_delta,'point_awards',v_awards,'previous_pb_seconds',v_previous,'pb_seconds',least(coalesce(v_previous,c.seconds),c.seconds),'is_new_pb',v_previous is null or c.seconds<v_previous,'is_first_pb',v_previous is null,'pb_comparable',true,'weekly_score',v_weekly,'rank_number',v_rank,'completed_count',c.total_count,'total_count',c.total_count);
  update private.daily_finish_candidates set status='confirmed',confirmed_at=now(),result=v_result where id=c.id;
  perform private.notify_confirmed_daily_finish(c.id);
  return v_result;
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
  select weekly_points,rank_number into v_weekly,v_rank from private.daily_readonly_standings() where athlete_id=p_athlete_id;
  select coalesce(jsonb_agg(jsonb_build_object('type','daily_pb','seconds',c.seconds,'previous_pb_seconds',c.result->'previous_pb_seconds','venue',c.venue,'is_first_pb',c.result->'is_first_pb') order by c.captured_at),'[]') into v_improvements
  from private.daily_finish_candidates c where c.athlete_id=p_athlete_id and c.local_date=v_date and c.status='confirmed' and (c.result->>'is_new_pb')::boolean;
  select jsonb_build_object('category',a.category,'trick_name',a.trick_name,'notes',a.notes) into v_goal
  from public.weekly_trick_assignments a left join public.assignment_progress p on p.assignment_id=a.id
  where a.athlete_id=p_athlete_id and a.week_start<=v_date and a.week_start=(select max(b.week_start) from public.weekly_trick_assignments b where b.athlete_id=p_athlete_id and b.category=a.category and b.week_start<=v_date)
    and ((a.category='daily' and p.progress_date is distinct from v_date) or (a.category<>'daily' and p.completed_at is null))
  order by case a.category when 'daily' then 0 when 'one_bang' then 1 when 'dialled' then 2 when 'lines' then 3 else 4 end,a.sort_order,a.id limit 1;
  return jsonb_build_object('athlete_id',p_athlete_id,'rider_name',v_name,'local_date',v_date,'timezone',v_tz,'daily_results',v_daily,'completed_categories',v_categories,'today_points',v_points,'today_xp',case when v_xp_partial then null else v_xp end,'attributable_today_xp',v_xp,'xp_attribution',case when v_xp_partial then 'partial' else 'complete' end,'xp_attribution_note',case when v_xp_partial then 'Some earlier XP entries changed today, so a complete daily XP total is not available.' else null end,'weekly_score',v_weekly,'rank_number',v_rank,'improvements',v_improvements,'next_goal',v_goal,'no_data',jsonb_array_length(v_daily)=0 and jsonb_array_length(v_categories)=0 and v_points=0 and v_xp=0 and not v_xp_partial);
end $$;
