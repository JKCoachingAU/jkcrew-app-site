-- Daily private check-in reminders are opt-in per recovery episode. This
-- migration does not enrol a rider or change an existing health record.
create table private.rider_recovery_reminders (
  episode_id uuid primary key,
  athlete_id uuid not null,
  enabled boolean not null default false,
  local_time time not null default time '18:00',
  timezone text not null,
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references public.profiles(id),
  foreign key (episode_id,athlete_id) references private.rider_recovery_episodes(id,athlete_id) on delete cascade,
  check (length(timezone) between 1 and 100)
);
create index rider_recovery_reminders_enabled_idx on private.rider_recovery_reminders(athlete_id) where enabled;
alter table private.rider_recovery_reminders enable row level security;
revoke all on private.rider_recovery_reminders from public,anon,authenticated;

create function private.recovery_checkin_timezone(p_athlete_id uuid,p_episode_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select coalesce((select r.timezone from private.rider_recovery_reminders r where r.episode_id=p_episode_id and r.athlete_id=p_athlete_id),
    (select public.jkcrew_country_timezone(p.country_code) from public.profiles p where p.id=p_athlete_id),'Australia/Brisbane');
$$;
revoke all on function private.recovery_checkin_timezone(uuid,uuid) from public,anon,authenticated;

create function private.recovery_reminder_metadata(p_athlete_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_state private.rider_recovery_states; v_reminder private.rider_recovery_reminders; v_tz text; v_today date; v_device boolean; v_status text;
begin
  select * into v_state from private.rider_recovery_states where athlete_id=p_athlete_id;
  select * into v_reminder from private.rider_recovery_reminders where episode_id=v_state.episode_id and athlete_id=p_athlete_id;
  v_tz:=private.recovery_checkin_timezone(p_athlete_id,v_state.episode_id);
  v_today:=(clock_timestamp() at time zone v_tz)::date;
  select exists(select 1 from public.push_subscriptions where user_id=p_athlete_id and enabled) into v_device;
  if not coalesce(v_state.enabled and v_reminder.enabled,false) then v_status:='off';
  elsif exists(select 1 from private.rider_recovery_checkins where episode_id=v_state.episode_id and checkin_date=v_today) then v_status:='completed';
  elsif not v_device then v_status:='no_device';
  else
    select status into v_status from public.push_notification_queue
      where dedupe_key='recovery-checkin:'||v_state.episode_id::text||':'||v_today::text;
    v_status:=coalesce(v_status,'scheduled');
  end if;
  return jsonb_build_object('configured',v_reminder.episode_id is not null,'enabled',coalesce(v_reminder.enabled,false),
    'local_time',coalesce(v_reminder.local_time,time '18:00'),'timezone',v_tz,'version',coalesce(v_reminder.version,0),
    'has_enabled_device',v_device,'today_status',v_status);
end $$;
revoke all on function private.recovery_reminder_metadata(uuid) from public,anon,authenticated;

create function private.get_recovery_reminder_settings(p_athlete_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_athlete uuid:=coalesce(p_athlete_id,auth.uid());
begin
  if auth.uid() is null or (auth.uid()<>v_athlete and not private.can_manage_recovery(v_athlete))
    or not exists(select 1 from public.profiles where id=v_athlete and role::text='athlete') then
    raise exception 'You cannot view this rider''s reminder settings.' using errcode='42501';
  end if;
  return private.recovery_reminder_metadata(v_athlete);
end $$;
create function public.get_recovery_reminder_settings(p_athlete_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$ select private.get_recovery_reminder_settings(p_athlete_id); $$;
revoke all on function private.get_recovery_reminder_settings(uuid),public.get_recovery_reminder_settings(uuid) from public,anon;
grant execute on function private.get_recovery_reminder_settings(uuid),public.get_recovery_reminder_settings(uuid) to authenticated;

create function private.set_recovery_reminder(p_episode_id uuid,p_enabled boolean,p_local_time time,p_timezone text,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_episode private.rider_recovery_episodes; v_state private.rider_recovery_states; v_reminder private.rider_recovery_reminders;
begin
  select * into v_episode from private.rider_recovery_episodes where id=p_episode_id;
  if auth.uid() is null or v_episode.id is null or (auth.uid()<>v_episode.athlete_id and not private.can_manage_recovery(v_episode.athlete_id)) then
    raise exception 'Only this rider or their linked coach can change this reminder.' using errcode='42501';
  end if;
  if p_enabled is null or p_local_time is null or p_expected_version is null or p_expected_version<0
    or p_timezone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then
    raise exception 'Choose a valid reminder time and time zone.' using errcode='22023';
  end if;
  select * into v_state from private.rider_recovery_states where athlete_id=v_episode.athlete_id for update;
  if not coalesce(v_state.enabled,false) or v_state.episode_id<>p_episode_id or v_episode.closed_at is not null then
    raise exception 'This recovery period is no longer active. Refresh to continue.' using errcode='42501';
  end if;
  select * into v_reminder from private.rider_recovery_reminders where episode_id=p_episode_id for update;
  if coalesce(v_reminder.version,0)<>p_expected_version then
    raise exception 'Reminder settings changed on another device. Refresh and try again.' using errcode='40001';
  end if;
  insert into private.rider_recovery_reminders(episode_id,athlete_id,enabled,local_time,timezone,updated_by)
    values(p_episode_id,v_episode.athlete_id,p_enabled,p_local_time,p_timezone,auth.uid())
    on conflict(episode_id) do update set enabled=excluded.enabled,local_time=excluded.local_time,timezone=excluded.timezone,
      version=private.rider_recovery_reminders.version+1,updated_at=clock_timestamp(),updated_by=auth.uid();
  -- A changed preference never leaves an obsolete reminder waiting to send.
  update public.push_notification_queue set status='skipped',processed_at=clock_timestamp(),last_error='Reminder settings changed'
    where recipient_id=v_episode.athlete_id and notification_type='recovery_checkin_reminder' and status='pending';
  return private.get_rider_recovery(v_episode.athlete_id);
end $$;
create function public.set_recovery_reminder(p_episode_id uuid,p_enabled boolean,p_local_time time,p_timezone text,p_expected_version integer)
returns jsonb language sql security invoker set search_path='' as $$ select private.set_recovery_reminder(p_episode_id,p_enabled,p_local_time,p_timezone,p_expected_version); $$;
revoke all on function private.set_recovery_reminder(uuid,boolean,time,text,integer),public.set_recovery_reminder(uuid,boolean,time,text,integer) from public,anon;
grant execute on function private.set_recovery_reminder(uuid,boolean,time,text,integer),public.set_recovery_reminder(uuid,boolean,time,text,integer) to authenticated;

-- This helper never returns symptom data. It is used both before enqueueing and
-- immediately before the worker sends, so a saved check-in cancels a queued nudge.
create function private.recovery_reminder_due(p_athlete_id uuid,p_episode_id text,p_date text,p_now timestamptz default clock_timestamp())
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_reminder private.rider_recovery_reminders; v_local timestamp; v_quiet_local timestamp; v_pref public.push_preferences;
begin
  select r.* into v_reminder from private.rider_recovery_reminders r
    join private.rider_recovery_states s on s.athlete_id=r.athlete_id and s.episode_id=r.episode_id and s.enabled
    join private.rider_recovery_episodes e on e.id=r.episode_id and e.closed_at is null
    where r.athlete_id=p_athlete_id and r.episode_id::text=p_episode_id and r.enabled;
  if not found then return false; end if;
  v_local:=p_now at time zone v_reminder.timezone;
  if p_date is distinct from v_local::date::text or v_local::time<v_reminder.local_time
    or p_now>=least(((v_local::date+v_reminder.local_time) at time zone v_reminder.timezone)+interval '2 hours',
      ((v_local::date+1)::timestamp at time zone v_reminder.timezone)) then return false; end if;
  if exists(select 1 from private.rider_recovery_checkins where episode_id=v_reminder.episode_id and checkin_date=v_local::date)
    or not exists(select 1 from public.push_subscriptions where user_id=p_athlete_id and enabled) then return false; end if;
  select * into v_pref from public.push_preferences where user_id=p_athlete_id;
  -- Existing device quiet hours use the profile's country time zone. A coach
  -- choosing another reminder/check-in zone must not reinterpret that setting.
  select p_now at time zone coalesce(public.jkcrew_country_timezone(p.country_code),'Australia/Brisbane')
    into v_quiet_local from public.profiles p where p.id=p_athlete_id;
  if coalesce(v_pref.quiet_hours_enabled,false) and (
    (v_pref.quiet_hours_start<v_pref.quiet_hours_end and v_quiet_local::time>=v_pref.quiet_hours_start and v_quiet_local::time<v_pref.quiet_hours_end)
    or (v_pref.quiet_hours_start>v_pref.quiet_hours_end and (v_quiet_local::time>=v_pref.quiet_hours_start or v_quiet_local::time<v_pref.quiet_hours_end))
    or v_pref.quiet_hours_start=v_pref.quiet_hours_end) then return false; end if;
  return true;
end $$;
revoke all on function private.recovery_reminder_due(uuid,text,text,timestamptz) from public,anon,authenticated;

create or replace function private.suppress_recovery_training_notification()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.notification_type='recovery_checkin_reminder' then
    if private.recovery_reminder_due(new.recipient_id,new.payload->>'episode_id',new.payload->>'checkin_date') then return new; end if;
    return null;
  end if;
  if private.rider_recovery_active(new.recipient_id) then return null; end if;
  return new;
end $$;

create function private.queue_due_recovery_reminders()
returns integer language plpgsql security definer set search_path='' as $$
declare v_record record; v_count integer:=0; v_added integer; v_now timestamptz:=clock_timestamp(); v_day date; v_expiry timestamptz;
begin
  for v_record in select r.* from private.rider_recovery_reminders r
    join private.rider_recovery_states s on s.athlete_id=r.athlete_id and s.episode_id=r.episode_id and s.enabled
    where r.enabled loop
    v_day:=(v_now at time zone v_record.timezone)::date;
    if not private.recovery_reminder_due(v_record.athlete_id,v_record.episode_id::text,v_day::text,v_now) then continue; end if;
    v_expiry:=least(((v_day+v_record.local_time) at time zone v_record.timezone)+interval '2 hours',
      ((v_day+1)::timestamp at time zone v_record.timezone));
    insert into public.push_notification_queue(recipient_id,notification_type,title,body,url,payload,dedupe_key,available_at)
      values(v_record.athlete_id,'recovery_checkin_reminder','Your daily check-in','Take a moment to complete today''s check-in in JKCREW.',
        './?push=home&checkin=today',jsonb_build_object('view','home','recovery_page','today','episode_id',v_record.episode_id,
          'checkin_date',v_day,'expires_at',v_expiry),'recovery-checkin:'||v_record.episode_id::text||':'||v_day::text,v_now)
      on conflict(dedupe_key) do update set status='pending',available_at=excluded.available_at,payload=excluded.payload,
        processed_at=null,last_error=''
      where public.push_notification_queue.status='skipped' and public.push_notification_queue.attempts=0;
    get diagnostics v_added=row_count; v_count:=v_count+v_added;
  end loop;
  return v_count;
end $$;
revoke all on function private.queue_due_recovery_reminders() from public,anon,authenticated;

create function private.skip_completed_recovery_reminders()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  update public.push_notification_queue set status='skipped',processed_at=clock_timestamp(),last_error='Daily check-in already saved'
    where recipient_id=new.athlete_id and notification_type='recovery_checkin_reminder' and status='pending'
      and payload->>'episode_id'=new.episode_id::text and payload->>'checkin_date'=new.checkin_date::text;
  return new;
end $$;
revoke all on function private.skip_completed_recovery_reminders() from public,anon,authenticated;
create trigger skip_completed_recovery_reminders after insert or update on private.rider_recovery_checkins
  for each row execute function private.skip_completed_recovery_reminders();

create or replace function public.claim_jkcrew_push_notifications(p_worker_secret text,p_limit integer default 50)
returns setof public.push_notification_queue language plpgsql security definer set search_path='' as $$
declare v_expected_secret text;
begin
  select decrypted_secret into v_expected_secret from vault.decrypted_secrets where name='jkcrew_push_worker_secret' limit 1;
  if v_expected_secret is null or p_worker_secret is distinct from v_expected_secret then raise exception 'Invalid push worker secret.'; end if;
  update public.push_notification_queue q set status='skipped',processed_at=clock_timestamp(),last_error='Reminder no longer due'
    where q.status='pending' and q.notification_type='recovery_checkin_reminder'
      and not private.recovery_reminder_due(q.recipient_id,q.payload->>'episode_id',q.payload->>'checkin_date');
  return query with selected as (
    select q.id from public.push_notification_queue q where q.status='pending' and q.available_at<=now()
      and ((q.notification_type='recovery_checkin_reminder' and private.recovery_reminder_due(q.recipient_id,q.payload->>'episode_id',q.payload->>'checkin_date'))
        or (q.notification_type<>'recovery_checkin_reminder' and not private.rider_recovery_active(q.recipient_id)))
    order by q.created_at for update skip locked limit greatest(1,least(coalesce(p_limit,50),100))
  ) update public.push_notification_queue q set status='processing',attempts=q.attempts+1,processed_at=now()
    from selected where q.id=selected.id returning q.*;
end $$;
revoke all on function public.claim_jkcrew_push_notifications(text,integer) from public,anon,authenticated;
grant execute on function public.claim_jkcrew_push_notifications(text,integer) to service_role;

create function private.validate_jkcrew_recovery_push(p_worker_secret text,p_notification_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_expected_secret text; v_item public.push_notification_queue; v_expiry timestamptz;
begin
  select decrypted_secret into v_expected_secret from vault.decrypted_secrets where name='jkcrew_push_worker_secret' limit 1;
  if v_expected_secret is null or p_worker_secret is distinct from v_expected_secret then raise exception 'Invalid push worker secret.'; end if;
  select * into v_item from public.push_notification_queue where id=p_notification_id;
  if v_item.id is null or v_item.notification_type<>'recovery_checkin_reminder' or v_item.status not in ('pending','processing')
    or not private.recovery_reminder_due(v_item.recipient_id,v_item.payload->>'episode_id',v_item.payload->>'checkin_date') then
    return jsonb_build_object('eligible',false,'expires_at',null);
  end if;
  select least((((clock_timestamp() at time zone r.timezone)::date+r.local_time) at time zone r.timezone)+interval '2 hours',
    (((clock_timestamp() at time zone r.timezone)::date+1)::timestamp at time zone r.timezone)) into v_expiry
    from private.rider_recovery_reminders r where r.episode_id::text=v_item.payload->>'episode_id' and r.athlete_id=v_item.recipient_id;
  return jsonb_build_object('eligible',true,'expires_at',v_expiry);
end $$;
create function public.validate_jkcrew_recovery_push(p_worker_secret text,p_notification_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.validate_jkcrew_recovery_push(p_worker_secret,p_notification_id); $$;
revoke all on function private.validate_jkcrew_recovery_push(text,uuid),public.validate_jkcrew_recovery_push(text,uuid) from public,anon,authenticated;
grant execute on function private.validate_jkcrew_recovery_push(text,uuid),public.validate_jkcrew_recovery_push(text,uuid) to service_role;

-- Existing RLS still limits subscriptions to the signed-in device owner. No
-- normal training, chat, leaderboard, or medical access is added here.
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
    if v_path in ('rpc/get_rider_recovery','rpc/save_recovery_checkin','rpc/get_recovery_reminder_settings','rpc/set_recovery_reminder')
      and v_method in ('GET','HEAD','POST') then return; end if;
    if v_path='push_subscriptions' and v_method in ('GET','HEAD','POST','DELETE') then return; end if;
    raise exception 'Recovery mode is on. Your recovery check-in, history and plan are available.' using errcode='42501';
  end if;
  if v_path='rpc/get_weekly_leaderboard' and v_method in ('GET','HEAD','POST') then return; end if;
  raise exception 'You don''t have access to this feature, contact your coach' using errcode='42501';
end $$;

select cron.schedule('jkcrew-recovery-checkin-reminders','*/5 * * * *','select private.queue_due_recovery_reminders();');

-- Use one local calendar for reminders and new check-ins. Stored dates stay unchanged.
create or replace function private.get_rider_recovery(p_athlete_id uuid default null,p_before_date date default null)
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
  v_timezone:=private.recovery_checkin_timezone(v_athlete,v_state.episode_id);
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
    'reminder',private.recovery_reminder_metadata(v_athlete),'can_manage',v_manage,'episode',v_episode,'episodes',v_episodes,'timezone',v_timezone,
    'today_date',(clock_timestamp() at time zone v_timezone)::date,'checkins',v_history,'has_more',v_more,
    'next_before_date',case when v_more then v_cutoff end);
end $$;

create or replace function private.save_recovery_checkin(p_episode_id uuid,p_checkin_date date,p_ratings jsonb,p_sleep text,
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
  select (clock_timestamp() at time zone private.recovery_checkin_timezone(p.id,p_episode_id))::date,
    (e.created_at at time zone private.recovery_checkin_timezone(p.id,p_episode_id))::date into v_today,v_created
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

notify pgrst, 'reload schema';
