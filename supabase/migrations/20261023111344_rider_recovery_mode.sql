-- Recovery is a private, reversible account mode. No rider is enrolled by this
-- migration, and no training history, score, account flag or medical plan changes.
set local lock_timeout = '5s';
set local statement_timeout = '30s';
create table private.rider_recovery_episodes (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default 'Recovery & return to riding' check (length(title) between 1 and 100),
  plan_text text not null default '' check (length(plan_text) <= 12000),
  clinician_name text not null default '' check (length(clinician_name) <= 160),
  clinician_approved boolean not null default false,
  clinician_approval_recorded_at timestamptz,
  clinician_approval_recorded_by uuid references public.profiles(id) on delete set null,
  review_date date,
  plan_version integer not null default 0 check (plan_version >= 0),
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid references public.profiles(id) on delete set null,
  closed_at timestamptz,
  closed_by uuid references public.profiles(id) on delete set null,
  clearance_note text not null default '' check (length(clearance_note) <= 2000),
  unique (id, athlete_id),
  check (clinician_approved = (clinician_approval_recorded_at is not null))
);
create index rider_recovery_episode_history on private.rider_recovery_episodes(athlete_id, created_at desc);
create unique index rider_recovery_one_open_episode on private.rider_recovery_episodes(athlete_id) where closed_at is null;
create table private.rider_recovery_states (
  athlete_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default false,
  episode_id uuid,
  version integer not null default 0 check (version >= 0),
  changed_at timestamptz not null default clock_timestamp(),
  changed_by uuid references public.profiles(id) on delete set null,
  foreign key (episode_id, athlete_id) references private.rider_recovery_episodes(id, athlete_id),
  check (not enabled or episode_id is not null)
);

create function private.valid_recovery_ratings(p_ratings jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare k text; v jsonb;
begin
  if jsonb_typeof(p_ratings) is distinct from 'object' then return false; end if;
  if (select count(*) from jsonb_object_keys(p_ratings)) <> 8 then return false; end if;
  foreach k in array array['headache','dizziness','nausea','sensitivity','brain_fog','fatigue','balance','neck_pain'] loop
    v:=p_ratings->k;
    if jsonb_typeof(v) is distinct from 'number' then return false; end if;
    if (v::text)::numeric not between 0 and 10 or (v::text)::numeric <> trunc((v::text)::numeric) then return false; end if;
  end loop;
  return true;
end $$;
revoke all on function private.valid_recovery_ratings(jsonb) from public,anon,authenticated;
create table private.rider_recovery_checkins (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null,
  athlete_id uuid not null,
  checkin_date date not null,
  ratings jsonb not null check (private.valid_recovery_ratings(ratings)),
  sleep text not null check (sleep in ('normal','poor','unusually_sleepy')),
  notes text not null default '' check (length(notes) <= 2000),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (episode_id, athlete_id) references private.rider_recovery_episodes(id, athlete_id) on delete cascade,
  unique (episode_id, checkin_date)
);
create index rider_recovery_checkin_history on private.rider_recovery_checkins(athlete_id, checkin_date desc);
-- A request receipt also preserves previous versions. Retrying an acknowledged
-- request cannot overwrite a later edit from another phone.
create table private.rider_recovery_checkin_requests (
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  checkin_id uuid not null references private.rider_recovery_checkins(id) on delete cascade,
  request_payload jsonb not null,
  saved_version integer not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (athlete_id, request_id)
);
create table private.rider_recovery_audit (
  id bigint generated always as identity primary key,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  episode_id uuid references private.rider_recovery_episodes(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null check (action in ('enabled','disabled','plan_updated')),
  details jsonb not null default '{}',
  created_at timestamptz not null default clock_timestamp()
);
create index rider_recovery_audit_history on private.rider_recovery_audit(athlete_id, created_at desc);
alter table private.rider_recovery_states enable row level security;
alter table private.rider_recovery_episodes enable row level security;
alter table private.rider_recovery_checkins enable row level security;
alter table private.rider_recovery_checkin_requests enable row level security;
alter table private.rider_recovery_audit enable row level security;
revoke all on private.rider_recovery_states,private.rider_recovery_episodes,
  private.rider_recovery_checkins,private.rider_recovery_checkin_requests,private.rider_recovery_audit from public,anon,authenticated;
revoke all on sequence private.rider_recovery_audit_id_seq from public,anon,authenticated;

create function private.rider_recovery_active(p_athlete_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.rider_recovery_states s where s.athlete_id=p_athlete_id and s.enabled);
$$;
revoke all on function private.rider_recovery_active(uuid) from public,anon,authenticated;
create function private.my_recovery_active()
returns boolean language sql stable security definer set search_path='' as $$
  select private.rider_recovery_active((select auth.uid()));
$$;
revoke all on function private.my_recovery_active() from public,anon;
grant execute on function private.my_recovery_active() to authenticated;
create function private.can_manage_recovery(p_athlete_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and not private.rider_features_disabled()
    and exists(select 1 from public.coach_athletes c
      join public.profiles coach on coach.id=c.coach_id and coach.role::text in ('coach','admin')
      join public.profiles rider on rider.id=c.athlete_id and rider.role::text='athlete'
      where c.coach_id=auth.uid() and c.athlete_id=p_athlete_id);
$$;
revoke all on function private.can_manage_recovery(uuid) from public,anon,authenticated;

create function private.get_rider_recovery(p_athlete_id uuid default null,p_before_date date default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid(); v_athlete uuid:=coalesce(p_athlete_id,auth.uid());
  v_manage boolean; v_state private.rider_recovery_states; v_episode jsonb;
  v_history jsonb; v_episodes jsonb; v_timezone text; v_cutoff date; v_more boolean;
begin
  if v_actor is null then raise exception 'Sign in to view recovery.' using errcode='42501'; end if;
  v_manage:=private.can_manage_recovery(v_athlete);
  if (v_actor<>v_athlete and not v_manage) or not exists(select 1 from public.profiles p where p.id=v_athlete and p.role::text='athlete') then
    raise exception 'You cannot view this rider''s recovery.' using errcode='42501'; end if;
  select * into v_state from private.rider_recovery_states s where s.athlete_id=v_athlete;
  select public.jkcrew_country_timezone(p.country_code) into v_timezone from public.profiles p where p.id=v_athlete;
  select to_jsonb(e) into v_episode from private.rider_recovery_episodes e where e.id=v_state.episode_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'created_at',e.created_at,'closed_at',e.closed_at) order by e.created_at desc),'[]')
    into v_episodes from private.rider_recovery_episodes e where e.athlete_id=v_athlete;
  -- Page by 30 distinct days, not individual rows: a toggle can produce two
  -- episodes on one day, and neither check-in should disappear at a page edge.
  select min(d.checkin_date) into v_cutoff from (
    select distinct c.checkin_date from private.rider_recovery_checkins c
    where c.athlete_id=v_athlete and (p_before_date is null or c.checkin_date<p_before_date)
    order by c.checkin_date desc limit 30
  ) d;
  select coalesce(jsonb_agg(to_jsonb(c) order by c.checkin_date desc,c.created_at desc),'[]') into v_history
    from private.rider_recovery_checkins c where c.athlete_id=v_athlete and c.checkin_date>=v_cutoff
    and (p_before_date is null or c.checkin_date<p_before_date);
  select exists(select 1 from private.rider_recovery_checkins c where c.athlete_id=v_athlete and c.checkin_date<v_cutoff) into v_more;
  return jsonb_build_object('athlete_id',v_athlete,'recovery_mode',coalesce(v_state.enabled,false),'mode_version',coalesce(v_state.version,0),
    'can_manage',v_manage,'episode',v_episode,'episodes',v_episodes,'timezone',v_timezone,
    'today_date',(clock_timestamp() at time zone v_timezone)::date,'checkins',v_history,'has_more',v_more,
    'next_before_date',case when v_more then v_cutoff end);
end $$;

create function private.set_rider_recovery_mode(p_athlete_id uuid,p_enabled boolean,p_expected_version integer,p_clearance_note text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_state private.rider_recovery_states; v_episode uuid; v_note text:=btrim(coalesce(p_clearance_note,''));
begin
  if not private.can_manage_recovery(p_athlete_id) then raise exception 'Only this rider''s linked coach can change recovery mode.' using errcode='42501'; end if;
  if p_enabled is null or p_expected_version is null or p_expected_version<0 or length(v_note)>2000 then
    raise exception 'Check the recovery mode and note.' using errcode='22023'; end if;
  -- One lock order for toggles, plans and check-ins also serializes the first save.
  perform 1 from public.profiles p where p.id=p_athlete_id for update;
  insert into private.rider_recovery_states(athlete_id) values(p_athlete_id) on conflict do nothing;
  select * into v_state from private.rider_recovery_states s where s.athlete_id=p_athlete_id for update;
  if v_state.version<>p_expected_version then raise exception 'Recovery mode changed on another device. Refresh before changing it.' using errcode='40001'; end if;
  if v_state.enabled=p_enabled then return private.get_rider_recovery(p_athlete_id); end if;
  if p_enabled then
    insert into private.rider_recovery_episodes(athlete_id,created_by) values(p_athlete_id,v_actor) returning id into v_episode;
  else
    v_episode:=v_state.episode_id;
    update private.rider_recovery_episodes set closed_at=clock_timestamp(),closed_by=v_actor,clearance_note=v_note where id=v_episode;
  end if;
  update private.rider_recovery_states set enabled=p_enabled,episode_id=v_episode,version=version+1,
    changed_at=clock_timestamp(),changed_by=v_actor where athlete_id=p_athlete_id;
  insert into private.rider_recovery_audit(athlete_id,episode_id,actor_id,action,details)
    values(p_athlete_id,v_episode,v_actor,case when p_enabled then 'enabled' else 'disabled' end,jsonb_build_object('note',v_note));
  if p_enabled then
    update public.push_notification_queue set status='skipped',processed_at=clock_timestamp(),last_error='Account notification preference'
      where recipient_id=p_athlete_id and status in ('pending','failed');
    -- Preserve live drafts, end the call separately from saving, and use a generic
    -- reason so private recovery information is not published to run subscribers.
    update public.run_live_sessions set call_status='ended',call_end_reason='account_unavailable',call_ended_at=clock_timestamp(),
      status='ended',editor_id=null,editor_client=null,lease_until=null,updated_at=clock_timestamp()
      where athlete_id=p_athlete_id and (status='active' or call_status in ('ringing','active'));
  end if;
  return private.get_rider_recovery(p_athlete_id);
end $$;

create function private.save_recovery_plan(p_episode_id uuid,p_expected_version integer,p_title text,p_plan_text text,
  p_clinician_name text,p_review_date date default null,p_clinician_approved boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_episode private.rider_recovery_episodes; v_title text:=btrim(coalesce(p_title,''));
begin
  select * into v_episode from private.rider_recovery_episodes e where e.id=p_episode_id;
  if not found or not private.can_manage_recovery(v_episode.athlete_id) then raise exception 'Only this rider''s linked coach can update the plan.' using errcode='42501'; end if;
  if length(v_title) not between 1 and 100 or length(coalesce(p_plan_text,''))>12000 or length(coalesce(p_clinician_name,''))>160
    or p_expected_version is null or p_clinician_approved is null then raise exception 'Check the plan title and details.' using errcode='22023'; end if;
  perform 1 from public.profiles p where p.id=v_episode.athlete_id for update;
  select * into v_episode from private.rider_recovery_episodes e where e.id=p_episode_id for update;
  if v_episode.closed_at is not null then raise exception 'This recovery episode has ended. Its plan is kept in history.' using errcode='22023'; end if;
  if v_episode.plan_version<>p_expected_version then raise exception 'The plan changed on another device. Your text has not been saved; refresh and review it.' using errcode='40001'; end if;
  insert into private.rider_recovery_audit(athlete_id,episode_id,actor_id,action,details)
    values(v_episode.athlete_id,v_episode.id,auth.uid(),'plan_updated',jsonb_build_object('previous_plan',to_jsonb(v_episode)));
  update private.rider_recovery_episodes set title=v_title,plan_text=coalesce(p_plan_text,''),clinician_name=btrim(coalesce(p_clinician_name,'')),
    review_date=p_review_date,clinician_approved=p_clinician_approved,
    clinician_approval_recorded_at=case when p_clinician_approved then clock_timestamp() end,
    clinician_approval_recorded_by=case when p_clinician_approved then auth.uid() end,plan_version=plan_version+1
    where id=p_episode_id;
  return private.get_rider_recovery(v_episode.athlete_id);
end $$;

create function private.save_recovery_checkin(p_episode_id uuid,p_checkin_date date,p_ratings jsonb,p_sleep text,
  p_notes text,p_expected_version integer,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid(); v_state private.rider_recovery_states; v_checkin private.rider_recovery_checkins;
  v_receipt private.rider_recovery_checkin_requests; v_payload jsonb; v_today date; v_created date;
begin
  if v_actor is null or not exists(select 1 from public.profiles p where p.id=v_actor and p.role::text='athlete') then
    raise exception 'Only the rider can save their symptom check-in.' using errcode='42501'; end if;
  if p_request_id is null or p_episode_id is null or p_checkin_date is null or p_expected_version is null or p_expected_version<0
    or not private.valid_recovery_ratings(p_ratings) or p_sleep is null or p_sleep not in ('normal','poor','unusually_sleepy')
    or length(coalesce(p_notes,''))>2000 then raise exception 'Rate all eight symptoms from 0 to 10, choose your sleep and check your note.' using errcode='22023'; end if;
  v_payload:=jsonb_build_object('episode_id',p_episode_id,'date',p_checkin_date,'ratings',p_ratings,'sleep',p_sleep,
    'notes',coalesce(p_notes,''),'expected_version',p_expected_version);
  perform 1 from public.profiles p where p.id=v_actor for update;
  select * into v_receipt from private.rider_recovery_checkin_requests r where r.athlete_id=v_actor and r.request_id=p_request_id;
  if found then
    if v_receipt.request_payload is distinct from v_payload then raise exception 'This save identifier was already used. Start a new save.' using errcode='22023'; end if;
    return private.get_rider_recovery(v_actor);
  end if;
  select * into v_state from private.rider_recovery_states s where s.athlete_id=v_actor for update;
  if not coalesce(v_state.enabled,false) or v_state.episode_id is distinct from p_episode_id then
    raise exception 'This recovery episode is no longer active. Your entry has not been saved.' using errcode='42501'; end if;
  select (clock_timestamp() at time zone public.jkcrew_country_timezone(p.country_code))::date,
    (e.created_at at time zone public.jkcrew_country_timezone(p.country_code))::date into v_today,v_created
    from public.profiles p join private.rider_recovery_episodes e on e.id=p_episode_id and e.athlete_id=p.id where p.id=v_actor;
  -- Allow a midnight/offline retry for an explicitly dated recent entry. Never
  -- relabel a missed day as today, accept future dates, or predate this episode.
  if p_checkin_date<v_created or p_checkin_date<v_today-7 or p_checkin_date>v_today then
    raise exception 'Choose a day in this recovery episode within the last seven days.' using errcode='22023'; end if;
  select * into v_checkin from private.rider_recovery_checkins c where c.episode_id=p_episode_id and c.checkin_date=p_checkin_date for update;
  if coalesce(v_checkin.version,0)<>p_expected_version then
    raise exception 'This check-in changed on another device. Your answers have not been overwritten; refresh and review them.' using errcode='40001'; end if;
  if v_checkin.id is null then
    insert into private.rider_recovery_checkins(episode_id,athlete_id,checkin_date,ratings,sleep,notes)
      values(p_episode_id,v_actor,p_checkin_date,p_ratings,p_sleep,coalesce(p_notes,'')) returning * into v_checkin;
  else
    update private.rider_recovery_checkins set ratings=p_ratings,sleep=p_sleep,notes=coalesce(p_notes,''),version=version+1,updated_at=clock_timestamp()
      where id=v_checkin.id returning * into v_checkin;
  end if;
  insert into private.rider_recovery_checkin_requests(athlete_id,request_id,checkin_id,request_payload,saved_version)
    values(v_actor,p_request_id,v_checkin.id,v_payload,v_checkin.version);
  return private.get_rider_recovery(v_actor);
end $$;

create function public.get_rider_recovery(p_athlete_id uuid default null,p_before_date date default null)
returns jsonb language sql stable security invoker set search_path='' as $$ select private.get_rider_recovery(p_athlete_id,p_before_date); $$;
create function public.set_rider_recovery_mode(p_athlete_id uuid,p_enabled boolean,p_expected_version integer,p_clearance_note text default '')
returns jsonb language sql security invoker set search_path='' as $$ select private.set_rider_recovery_mode(p_athlete_id,p_enabled,p_expected_version,p_clearance_note); $$;
create function public.save_recovery_plan(p_episode_id uuid,p_expected_version integer,p_title text,p_plan_text text,
  p_clinician_name text,p_review_date date default null,p_clinician_approved boolean default false)
returns jsonb language sql security invoker set search_path='' as $$ select private.save_recovery_plan(p_episode_id,p_expected_version,p_title,p_plan_text,p_clinician_name,p_review_date,p_clinician_approved); $$;
create function public.save_recovery_checkin(p_episode_id uuid,p_checkin_date date,p_ratings jsonb,p_sleep text,p_notes text,p_expected_version integer,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.save_recovery_checkin(p_episode_id,p_checkin_date,p_ratings,p_sleep,p_notes,p_expected_version,p_request_id); $$;
revoke all on function private.get_rider_recovery(uuid,date),public.get_rider_recovery(uuid,date),
  private.set_rider_recovery_mode(uuid,boolean,integer,text),public.set_rider_recovery_mode(uuid,boolean,integer,text),
  private.save_recovery_plan(uuid,integer,text,text,text,date,boolean),public.save_recovery_plan(uuid,integer,text,text,text,date,boolean),
  private.save_recovery_checkin(uuid,date,jsonb,text,text,integer,uuid),public.save_recovery_checkin(uuid,date,jsonb,text,text,integer,uuid) from public,anon;
grant execute on function private.get_rider_recovery(uuid,date),public.get_rider_recovery(uuid,date),
  private.set_rider_recovery_mode(uuid,boolean,integer,text),public.set_rider_recovery_mode(uuid,boolean,integer,text),
  private.save_recovery_plan(uuid,integer,text,text,text,date,boolean),public.save_recovery_plan(uuid,integer,text,text,text,date,boolean),
  private.save_recovery_checkin(uuid,date,jsonb,text,text,integer,uuid),public.save_recovery_checkin(uuid,date,jsonb,text,text,integer,uuid) to authenticated;

-- Return two additive fields. The original four retain their order and meaning.
-- Read-only production dependency inspection found no dependent objects.
drop function public.get_rider_feature_access();
drop function private.get_rider_feature_access();
create function private.get_rider_feature_access()
returns table(athlete_id uuid,features_disabled boolean,disabled_at timestamptz,disabled_by uuid,recovery_mode boolean,recovery_episode_id uuid)
language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_role text;
begin
  if v_actor is null then raise exception 'Sign in required' using errcode='42501'; end if;
  select p.role::text into v_role from public.profiles p where p.id=v_actor;
  return query select p.id,coalesce(a.features_disabled,false),a.disabled_at,a.disabled_by,coalesce(r.enabled,false),case when r.enabled then r.episode_id end
    from public.profiles p left join private.rider_feature_access a on a.athlete_id=p.id
    left join private.rider_recovery_states r on r.athlete_id=p.id
    where p.id=v_actor or (v_role in ('coach','admin') and p.role::text='athlete'
      and exists(select 1 from public.coach_athletes c where c.coach_id=v_actor and c.athlete_id=p.id));
end $$;
create function public.get_rider_feature_access()
returns table(athlete_id uuid,features_disabled boolean,disabled_at timestamptz,disabled_by uuid,recovery_mode boolean,recovery_episode_id uuid)
language sql stable security invoker set search_path='' as $$ select * from private.get_rider_feature_access(); $$;
revoke all on function private.get_rider_feature_access(),public.get_rider_feature_access() from public,anon;
grant execute on function private.get_rider_feature_access(),public.get_rider_feature_access() to authenticated;

create or replace function private.rider_scoring_paused(p_athlete_id uuid)
returns boolean language sql stable security invoker set search_path='' as $$
  select exists(select 1 from private.rider_scoring_pauses p where p.athlete_id=p_athlete_id and p.scoring_paused)
    or private.rider_recovery_active(p_athlete_id);
$$;
revoke all on function private.rider_scoring_paused(uuid) from public,anon,authenticated;

create or replace function public.jkcrew_check_rider_feature_access()
returns void language plpgsql security invoker set search_path='' as $$
declare v_path text:=ltrim(coalesce(current_setting('request.path',true),''),'/');
  v_method text:=upper(coalesce(current_setting('request.method',true),'')); v_recovery boolean;
begin
  if current_user='service_role' or auth.uid() is null then return; end if;
  v_recovery:=private.my_recovery_active();
  if not v_recovery and not private.rider_features_disabled() then return; end if;
  if v_path like 'rest/v1/%' then v_path:=substr(v_path,9); end if;
  if (v_path='profiles' and v_method in ('GET','HEAD')) or
    (v_path in ('rpc/get_rider_feature_access','rpc/record_my_app_open') and v_method in ('GET','HEAD','POST')) then return; end if;
  if v_recovery then
    if v_path in ('rpc/get_rider_recovery','rpc/save_recovery_checkin') and v_method in ('GET','HEAD','POST') then return; end if;
    raise exception 'Recovery mode is on. Your recovery check-in, history and plan are available.' using errcode='42501';
  end if;
  if v_path='rpc/get_weekly_leaderboard' and v_method in ('GET','HEAD','POST') then return; end if;
  raise exception 'You don''t have access to this feature, contact your coach' using errcode='42501';
end $$;
revoke all on function public.jkcrew_check_rider_feature_access() from public;
grant execute on function public.jkcrew_check_rider_feature_access() to anon,authenticated,service_role;
create policy rider_recovery_insert on storage.objects as restrictive for insert to authenticated with check (not (select private.my_recovery_active()));
create policy rider_recovery_update on storage.objects as restrictive for update to authenticated
  using (not (select private.my_recovery_active())) with check (not (select private.my_recovery_active()));
create policy rider_recovery_delete on storage.objects as restrictive for delete to authenticated using (not (select private.my_recovery_active()));

create or replace function private.live_run_pair_allowed(p_athlete_id uuid,p_coach_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and auth.uid() in (p_athlete_id,p_coach_id)
    and exists(select 1 from public.coach_athletes c
      join public.profiles coach on coach.id=c.coach_id and coach.role::text in ('coach','admin')
      join public.profiles rider on rider.id=c.athlete_id and rider.role::text='athlete'
      where c.coach_id=p_coach_id and c.athlete_id=p_athlete_id)
    and not exists(select 1 from private.rider_feature_access a where a.athlete_id in (p_athlete_id,p_coach_id) and a.features_disabled)
    and not private.rider_recovery_active(p_athlete_id);
$$;
revoke all on function private.live_run_pair_allowed(uuid,uuid) from public,anon;
grant execute on function private.live_run_pair_allowed(uuid,uuid) to authenticated;

-- Health content never enters the ordinary feed or push queue. Retain existing
-- notification history; suppression applies only while Recovery Mode is enabled.
create function private.suppress_recovery_training_notification()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if private.rider_recovery_active(new.recipient_id) then return null; end if;
  return new;
end $$;
revoke all on function private.suppress_recovery_training_notification() from public,anon,authenticated;
create trigger suppress_recovery_training_notification before insert on public.app_notifications
  for each row execute function private.suppress_recovery_training_notification();
create trigger suppress_recovery_training_notification before insert on public.push_notification_queue
  for each row execute function private.suppress_recovery_training_notification();

-- Worker claim excludes recovery recipients too, including retries of older jobs.
create or replace function public.claim_jkcrew_push_notifications(p_worker_secret text,p_limit integer default 50)
returns setof public.push_notification_queue language plpgsql security definer set search_path='' as $$
declare v_expected_secret text;
begin
  select decrypted_secret into v_expected_secret from vault.decrypted_secrets where name='jkcrew_push_worker_secret' limit 1;
  if v_expected_secret is null or p_worker_secret is distinct from v_expected_secret then raise exception 'Invalid push worker secret.'; end if;
  return query with selected as (
    select q.id from public.push_notification_queue q where q.status='pending' and q.available_at<=now()
      and not private.rider_recovery_active(q.recipient_id)
    order by q.created_at for update skip locked limit greatest(1,least(coalesce(p_limit,50),100))
  ) update public.push_notification_queue q set status='processing',attempts=q.attempts+1,processed_at=now()
    from selected where q.id=selected.id returning q.*;
end $$;
revoke all on function public.claim_jkcrew_push_notifications(text,integer) from public,anon,authenticated;
grant execute on function public.claim_jkcrew_push_notifications(text,integer) to service_role;
notify pgrst,'reload schema';
