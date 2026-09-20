-- Audio/video call state is separate from the existing private draft lease.
-- No media recordings are stored; signaling rows expire and are peer-readable only.
alter table public.run_live_sessions
  add column call_status text not null default 'idle' check (call_status in ('idle','ringing','active','declined','cancelled','missed','ended')),
  add column call_mode text check (call_mode in ('audio','video')),
  add column call_request_id uuid,
  add column ring_expires_at timestamptz,
  add column call_started_at timestamptz,
  add column call_ended_at timestamptz,
  add column call_end_reason text,
  add column athlete_client_id uuid,
  add column coach_client_id uuid,
  add column athlete_seen_at timestamptz,
  add column coach_seen_at timestamptz,
  add column saved_version bigint,
  add column saved_run_updated_at timestamptz;
create unique index run_live_call_request_unique on public.run_live_sessions(created_by,call_request_id) where call_request_id is not null;
create index run_live_call_busy_athlete on public.run_live_sessions(athlete_id) where call_status in ('ringing','active');
create index run_live_call_busy_coach on public.run_live_sessions(coach_id) where call_status in ('ringing','active');
alter table public.run_plans add column course_source text check (course_source in ('event','upload'));

create function private.live_run_pair_allowed(p_athlete_id uuid,p_coach_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and auth.uid() in (p_athlete_id,p_coach_id)
    and exists(select 1 from public.coach_athletes c
      join public.profiles coach on coach.id=c.coach_id and coach.role::text in ('coach','admin')
      join public.profiles rider on rider.id=c.athlete_id and rider.role::text='athlete'
      where c.coach_id=p_coach_id and c.athlete_id=p_athlete_id)
    and not exists(select 1 from private.rider_feature_access a
      where a.athlete_id in (p_athlete_id,p_coach_id) and a.features_disabled);
$$;
revoke all on function private.live_run_pair_allowed(uuid,uuid) from public,anon;
grant execute on function private.live_run_pair_allowed(uuid,uuid) to authenticated;
drop policy "Live runs belong to rider and linked coach" on public.run_live_sessions;
create policy "Live runs belong to enabled rider and linked coach" on public.run_live_sessions
  for select to authenticated using (private.live_run_pair_allowed(athlete_id,coach_id));

create table public.run_live_signals (
  seq bigint generated always as identity primary key,
  id uuid not null,
  session_id uuid not null references public.run_live_sessions(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('offer','answer','ice')),
  payload jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp()+interval '10 minutes'),
  unique(session_id,sender_id,id)
);
create index run_live_signals_recipient on public.run_live_signals(session_id,recipient_id,seq);
create index run_live_signals_expiry on public.run_live_signals(expires_at);
alter table public.run_live_signals enable row level security;
revoke all on public.run_live_signals from public,anon,authenticated;
revoke all on sequence public.run_live_signals_seq_seq from public,anon,authenticated;
grant select on public.run_live_signals to authenticated;
create policy "Only the accepted call peer receives signaling" on public.run_live_signals
  for select to authenticated using (recipient_id=(select auth.uid()) and expires_at>now()
    and exists(select 1 from public.run_live_sessions s where s.id=session_id
      and s.call_status='active' and s.invitation_status='accepted' and s.status='active'));

-- Called under participant locks on start and under the session lock on reads.
-- Call expiry never saves, deletes or publishes the private draft.
create function private.expire_live_run_calls(p_actor_ids uuid[])
returns void language sql security definer set search_path='' as $$
  update public.run_live_sessions set
    call_status=case when call_status='ringing' then 'missed' else 'ended' end,
    call_end_reason=case when call_status='ringing' then 'unanswered' else 'connection_timeout' end,
    call_ended_at=clock_timestamp(),status='ended',editor_id=null,editor_client=null,lease_until=null,
    updated_at=clock_timestamp()
  where (athlete_id=any(p_actor_ids) or coach_id=any(p_actor_ids)) and (
    (call_status='ringing' and ring_expires_at<=clock_timestamp()) or
    (call_status='active' and (least(athlete_seen_at,coach_seen_at)<=clock_timestamp()-interval '90 seconds' or expires_at<=clock_timestamp())));
$$;
revoke all on function private.expire_live_run_calls(uuid[]) from public,anon,authenticated;

-- Validate the course snapshot before it can enter a call draft or saved run.
-- The event catalogue is shared with all athletes/coaches; private dashboard
-- items and completed/past events are not eligible workspace selections.
create function private.validate_live_run_draft(p_draft jsonb,p_require_event boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb:=p_draft; v_event_id uuid; course text;
begin
  if jsonb_typeof(d) is distinct from 'object' or octet_length(d::text)>12000000
    or jsonb_typeof(d->'points') is distinct from 'array' or jsonb_array_length(d->'points')>300
    or exists(select 1 from jsonb_object_keys(d) k where k not in
      ('title','venue','planType','notes','contestItemId','imageDataUrl','points','view','courseSource'))
    or length(coalesce(d->>'title',''))>140 or length(coalesce(d->>'venue',''))>250 or length(coalesce(d->>'notes',''))>10000
    or coalesce(d->>'planType','competition') not in ('training','competition') then raise exception 'Check the run photo, title and dots.'; end if;
  if coalesce(d->>'courseSource','upload') not in ('event','upload') then raise exception 'Choose an event course or your own course photo.'; end if;
  d:=jsonb_set(d,'{courseSource}',to_jsonb(coalesce(d->>'courseSource','upload')));
  if exists(select 1 from jsonb_array_elements(d->'points') point where jsonb_typeof(point)<>'object'
    or jsonb_typeof(point->'x') is distinct from 'number' or jsonb_typeof(point->'y') is distinct from 'number'
    or (point->>'x')::numeric not between 0 and 100 or (point->>'y')::numeric not between 0 and 100) then
    raise exception 'Keep route dots inside the course photo.';
  end if;
  if coalesce(d->>'imageDataUrl','')<>'' and (jsonb_typeof(d->'imageDataUrl')<>'string'
    or coalesce(d->>'imageDataUrl','') !~ '^data:image/(png|jpe?g|webp|gif);base64,'
    or length(d->>'imageDataUrl') not between 32 and 8000000) then raise exception 'Choose a valid course photo.'; end if;
  v_event_id:=nullif(d->>'contestItemId','')::uuid;
  if (p_require_event and v_event_id is null) or (v_event_id is not null and not exists(select 1 from public.dashboard_items e where e.id=v_event_id
    and e.item_type='event' and not e.completed and coalesce(e.end_at,e.due_at+interval '1 day','infinity'::timestamptz)>=now())) then
    raise exception 'Choose an available event before saving your run.';
  end if;
  if d->>'courseSource'='event' then
    select image_data_url into course from public.event_course_photos where event_course_photos.event_id=v_event_id;
    if course is null then raise exception 'This event has no course photo. Choose your own course photo.'; end if;
    if d->>'imageDataUrl' is distinct from course then raise exception 'The event course changed. Reload its photo, or choose your own course photo.'; end if;
  end if;
  return d;
end;
$$;
revoke all on function private.validate_live_run_draft(jsonb,boolean) from public,anon,authenticated;

create or replace function private.live_run_action(
  p_action text, p_session_id uuid default null, p_client_id uuid default null,
  p_version bigint default null, p_patch jsonb default '{}'::jsonb,
  p_athlete_id uuid default null, p_coach_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  s public.run_live_sessions;
  d jsonb;
  run_id uuid;
  saved public.run_plans;
  event_id uuid;
begin
  if actor is null then raise exception 'Sign in to build together.'; end if;
  if private.rider_features_disabled() then raise exception 'Contact your coach to access this feature.' using errcode='42501'; end if;
  if p_action = 'create' then
    if p_client_id is null or not coalesce(actor in (p_athlete_id,p_coach_id),false)
      or not exists (select 1 from public.coach_athletes c join public.profiles p on p.id = c.coach_id
        where c.athlete_id = p_athlete_id and c.coach_id = p_coach_id and p.role::text in ('coach','admin')) then
      raise exception 'Choose your linked rider and coach.';
    end if;
    if not private.live_run_pair_allowed(p_athlete_id,p_coach_id) then raise exception 'Choose your linked rider and coach.' using errcode='42501'; end if;
    d := '{}'::jsonb;
  else
    select * into s from public.run_live_sessions where id = p_session_id for update;
    if not found or not coalesce(actor in (s.athlete_id,s.coach_id),false)
      or not exists (select 1 from public.coach_athletes c join public.profiles p on p.id = c.coach_id
        where c.coach_id = s.coach_id and c.athlete_id = s.athlete_id and p.role::text in ('coach','admin')) then
      raise exception 'This live run is private or no longer available.';
    end if;
    if not private.live_run_pair_allowed(s.athlete_id,s.coach_id) then raise exception 'This live run is private or no longer available.' using errcode='42501'; end if;
    if s.call_status<>'idle' then
      perform private.expire_live_run_calls(array[actor]);
      select * into s from public.run_live_sessions where id=p_session_id;
    end if;
    select draft into d from private.run_live_drafts where session_id = s.id;
    if s.call_status<>'idle' and p_action in ('accept','decline') then raise exception 'Use the call invitation controls.'; end if;
    if s.call_status<>'idle' and p_action not in ('get','end') and (s.call_status<>'active' or s.invitation_status<>'accepted') then raise exception 'Accept an active call before editing this run.'; end if;
    if p_action in ('accept','decline') then
      if actor = s.created_by then raise exception 'The other person accepts this invitation.'; end if;
      if s.status <> 'active' or s.expires_at <= now() then raise exception 'This invitation has finished.'; end if;
      if p_action = 'accept' and s.invitation_status = 'accepted' then
        return jsonb_build_object('session',to_jsonb(s),'draft',d);
      end if;
      if s.invitation_status <> 'pending' then raise exception 'This invitation has already been answered.'; end if;
      update public.run_live_sessions set invitation_status=case when p_action='accept' then 'accepted' else 'declined' end,
        responded_at=clock_timestamp(), status=case when p_action='decline' then 'ended' else status end,
        editor_id=case when p_action='decline' then null else editor_id end,
        editor_client=case when p_action='decline' then null else editor_client end,
        lease_until=case when p_action='decline' then null else lease_until end
        where id=s.id returning * into s;
      return jsonb_build_object('session',to_jsonb(s)) || case when p_action='accept' then jsonb_build_object('draft',d) else '{}'::jsonb end;
    end if;
    if actor <> s.created_by and s.invitation_status <> 'accepted' then
      raise exception 'Accept the invitation to open this live run.';
    end if;
    if p_action = 'get' then return jsonb_build_object('session',to_jsonb(s),'draft',d); end if;
    if p_action = 'save' and s.status = 'saved' and actor = s.athlete_id then
      return jsonb_build_object('session',to_jsonb(s));
    end if;
    if s.status <> 'active' or s.expires_at <= now() then raise exception 'This live session has finished.'; end if;
    if p_client_id is null then raise exception 'Reopen the live run.'; end if;
  end if;
  if p_action in ('create','patch') then
    if p_action = 'patch' and (s.editor_id is distinct from actor or s.editor_client is distinct from p_client_id
      or s.lease_until <= now() or s.version is distinct from p_version) then
      raise exception 'Editing changed hands. Your edits have not been sent.';
    end if;
    if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'Invalid run draft.'; end if;
    if exists (select 1 from jsonb_object_keys(p_patch) k where k not in
      ('title','venue','planType','notes','contestItemId','imageDataUrl','points','view','courseSource')) then
      raise exception 'Invalid run field.';
    end if;
    d := d || p_patch;
    if octet_length(d::text) > 12000000 or jsonb_typeof(d->'points') is distinct from 'array'
      or jsonb_array_length(d->'points') > 300 or length(coalesce(d->>'title','')) > 140
      or length(coalesce(d->>'notes','')) > 10000
      or coalesce(d->>'planType','training') not in ('training','competition') then raise exception 'Check the run photo, title and dots.'; end if;
    if s.call_status='active' then d:=private.validate_live_run_draft(d); end if;
    if p_action = 'create' then
      insert into public.run_live_sessions(athlete_id,coach_id,created_by,athlete_name,title,editor_id,editor_client,lease_until)
      values(p_athlete_id,p_coach_id,actor,coalesce((select display_name from public.profiles where id=p_athlete_id),''),
        coalesce(nullif(d->>'title',''),'Shared run'),actor,p_client_id,now()+interval '45 seconds') returning * into s;
      insert into private.run_live_drafts values(s.id,d);
    else
      update private.run_live_drafts set draft=d where session_id=s.id;
      update public.run_live_sessions set version=version+1, title=coalesce(nullif(d->>'title',''),'Shared run'),
        updated_at=clock_timestamp(), lease_until=now()+interval '45 seconds' where id=s.id returning * into s;
    end if;
  elsif p_action = 'claim' then
    if s.editor_client is not null and s.lease_until > now() and
      (s.editor_id is distinct from actor or s.editor_client is distinct from p_client_id) then
      raise exception 'Ask the other editor to tap Pass editing first.';
    end if;
    update public.run_live_sessions set editor_id=actor,editor_client=p_client_id,lease_until=now()+interval '45 seconds'
      where id=s.id returning * into s;
  elsif p_action = 'heartbeat' then
    if s.editor_id is distinct from actor or s.editor_client is distinct from p_client_id or s.lease_until <= now() then
      raise exception 'Editing changed hands. Tap Edit run to continue.';
    end if;
    update public.run_live_sessions set lease_until=now()+interval '45 seconds' where id=s.id returning * into s;
  elsif p_action = 'release' then
    if s.editor_id is distinct from actor or s.editor_client is distinct from p_client_id then raise exception 'You are viewing this run.'; end if;
    update public.run_live_sessions set editor_id=null,editor_client=null,lease_until=null where id=s.id returning * into s;
  elsif p_action = 'save' and s.call_status='active' then
    if s.invitation_status<>'accepted' then raise exception 'Accept the call first.'; end if;
    -- Version equality applies even to a retried save; a newer draft cannot be
    -- silently saved by an older client. One saved row per call, no duplicate run.
    if s.version is distinct from p_version then raise exception 'The run changed. Wait for the latest edits before saving.'; end if;
    if s.saved_run_id is not null and s.saved_version=s.version then
      return jsonb_build_object('session',to_jsonb(s));
    end if;
    if s.editor_id is distinct from actor or s.editor_client is distinct from p_client_id or s.lease_until<=now() then
      raise exception 'Ask the other editor to pass editing before saving.';
    end if;
    d:=private.validate_live_run_draft(d,true);
    event_id:=nullif(d->>'contestItemId','')::uuid;
    if event_id is null or not exists(select 1 from public.dashboard_items e where e.id=event_id and e.item_type='event'
      and not e.completed and coalesce(e.end_at,e.due_at+interval '1 day','infinity'::timestamptz)>=now()) then
      raise exception 'Choose an available event before saving your run.';
    end if;
    if btrim(coalesce(d->>'title',''))='' or btrim(coalesce(d->>'imageDataUrl',''))='' or jsonb_array_length(d->'points')<2 then
      raise exception 'Add a title, course photo, start and finish before saving.';
    end if;
    if s.saved_run_id is null then
      insert into public.run_plans(athlete_id,coach_id,created_by,title,venue,plan_type,notes,image_data_url,points,contest_item_id,course_source)
      values(s.athlete_id,s.coach_id,actor,btrim(d->>'title'),coalesce(d->>'venue',''),'competition',coalesce(d->>'notes',''),
        d->>'imageDataUrl',jsonb_set(d->'points','{0,view}',coalesce(d->'view','{}'::jsonb)),event_id,coalesce(d->>'courseSource','upload')) returning * into saved;
    else
      select * into saved from public.run_plans where id=s.saved_run_id for update;
      if not found or saved.athlete_id<>s.athlete_id or saved.coach_id<>s.coach_id or saved.updated_at is distinct from s.saved_run_updated_at then
        raise exception 'The saved run changed outside this call. Your draft is safe; reopen the latest saved run before replacing it.';
      end if;
      update public.run_plans set title=btrim(d->>'title'),venue=coalesce(d->>'venue',''),plan_type='competition',notes=coalesce(d->>'notes',''),
        image_data_url=d->>'imageDataUrl',points=jsonb_set(d->'points','{0,view}',coalesce(d->'view','{}'::jsonb)),contest_item_id=event_id,
        course_source=coalesce(d->>'courseSource','upload'),updated_at=clock_timestamp() where id=s.saved_run_id returning * into saved;
    end if;
    update public.run_live_sessions set saved_run_id=saved.id,saved_version=version,saved_run_updated_at=saved.updated_at,
      updated_at=clock_timestamp(),lease_until=now()+interval '45 seconds' where id=s.id returning * into s;
  elsif p_action = 'save' then
    if actor <> s.athlete_id then raise exception 'The rider saves the finished run.'; end if;
    if s.editor_client is not null and s.lease_until > now() and
      (s.editor_id is distinct from actor or s.editor_client is distinct from p_client_id) then
      raise exception 'Ask your coach to pass editing before saving.';
    end if;
    if s.version is distinct from p_version then raise exception 'The run changed. Wait for the latest edits before saving.'; end if;
    if btrim(coalesce(d->>'title','')) = '' or btrim(coalesce(d->>'imageDataUrl','')) = '' or jsonb_array_length(d->'points') < 2 then
      raise exception 'Add a title, park photo, start and finish before saving.';
    end if;
    insert into public.run_plans(athlete_id,coach_id,created_by,title,venue,plan_type,notes,image_data_url,points,contest_item_id)
    values(s.athlete_id,s.coach_id,s.athlete_id,btrim(d->>'title'),coalesce(d->>'venue',''),coalesce(d->>'planType','training'),
      coalesce(d->>'notes',''),d->>'imageDataUrl',jsonb_set(d->'points','{0,view}',coalesce(d->'view','{}'::jsonb)),nullif(d->>'contestItemId','')::uuid)
    returning id into run_id;
    update public.run_live_sessions set status='saved',saved_run_id=run_id,editor_id=null,editor_client=null,lease_until=null,
      updated_at=clock_timestamp() where id=s.id returning * into s;
  elsif p_action = 'end' then
    update public.run_live_sessions set status='ended',editor_id=null,editor_client=null,lease_until=null,
      call_status=case when call_status='idle' then 'idle' else 'ended' end,
      call_ended_at=case when call_status='idle' then call_ended_at else clock_timestamp() end where id=s.id returning * into s;
  else raise exception 'Unknown live run action.';
  end if;
  return jsonb_build_object('session',to_jsonb(s)) || case when p_action in ('create','claim') then jsonb_build_object('draft',d) else '{}'::jsonb end;
end;
$$;

alter table public.run_live_sessions add column coach_name text not null default '', add column caller_name text not null default '';

create function private.live_run_call_action(
  p_action text,p_session_id uuid default null,p_client_id uuid default null,
  p_message_id uuid default null,p_payload jsonb default '{}'::jsonb,
  p_athlete_id uuid default null,p_coach_id uuid default null,p_after bigint default 0
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid();
  peer uuid;
  s public.run_live_sessions;
  d jsonb;
  sig public.run_live_signals;
  messages jsonb;
  mode text;
  kind text;
  data jsonb;
  bound_client uuid;
begin
  if actor is null then raise exception 'Sign in to call your coach or rider.' using errcode='42501'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid call request.' using errcode='22023'; end if;
  if p_action='start' then
    if not private.live_run_pair_allowed(p_athlete_id,p_coach_id) then raise exception 'Choose your linked rider and coach.' using errcode='42501'; end if;
    if p_client_id is null or p_message_id is null or p_session_id is not null then raise exception 'Reopen the call controls and try again.'; end if;
    mode:=p_payload->>'mode';
    if mode is null or mode not in ('audio','video') or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('mode','draft')) then raise exception 'Choose an audio or video call.'; end if;
    d:=jsonb_build_object('title','Shared run','venue','','planType','competition','notes','','contestItemId',null,
      'courseSource','upload','imageDataUrl','','points','[]'::jsonb,'view','{}'::jsonb);
    if p_payload ? 'draft' then
      if jsonb_typeof(p_payload->'draft') is distinct from 'object' then raise exception 'Invalid run draft.'; end if;
      d:=d||(p_payload->'draft');
    end if;
    d:=private.validate_live_run_draft(d);
    -- All starts for either participant use these rows in deterministic order.
    -- A concurrent crossed invitation therefore cannot create two calls.
    perform 1 from public.profiles where id in (p_athlete_id,p_coach_id) order by id for update;
    perform private.expire_live_run_calls(array[p_athlete_id,p_coach_id]);
    select * into s from public.run_live_sessions where created_by=actor and call_request_id=p_message_id;
    if found then
      if s.athlete_id<>p_athlete_id or s.coach_id<>p_coach_id or s.call_mode<>mode
        or p_client_id is distinct from (case when actor=s.athlete_id then s.athlete_client_id else s.coach_client_id end) then
        raise exception 'This call request was already used.';
      end if;
      select draft into d from private.run_live_drafts where session_id=s.id;
      return jsonb_build_object('session',to_jsonb(s),'draft',d);
    end if;
    if exists(select 1 from public.run_live_sessions where call_status in ('ringing','active')
      and (athlete_id in (p_athlete_id,p_coach_id) or coach_id in (p_athlete_id,p_coach_id))) then
      return jsonb_build_object('busy',true,'session',null);
    end if;
    insert into public.run_live_sessions(athlete_id,coach_id,created_by,athlete_name,coach_name,caller_name,title,
      editor_id,editor_client,lease_until,call_status,call_mode,call_request_id,ring_expires_at,
      athlete_client_id,coach_client_id,athlete_seen_at,coach_seen_at)
    values(p_athlete_id,p_coach_id,actor,
      coalesce((select display_name from public.profiles where id=p_athlete_id),''),
      coalesce((select display_name from public.profiles where id=p_coach_id),''),
      coalesce((select display_name from public.profiles where id=actor),''),coalesce(nullif(d->>'title',''),'Shared run'),
      actor,p_client_id,now()+interval '45 seconds','ringing',mode,p_message_id,now()+interval '60 seconds',
      case when actor=p_athlete_id then p_client_id end,case when actor=p_coach_id then p_client_id end,
      case when actor=p_athlete_id then clock_timestamp() end,case when actor=p_coach_id then clock_timestamp() end)
    returning * into s;
    insert into private.run_live_drafts(session_id,draft) values(s.id,d);
    return jsonb_build_object('session',to_jsonb(s),'draft',d);
  end if;
  select * into s from public.run_live_sessions where id=p_session_id for update;
  if not found or not private.live_run_pair_allowed(s.athlete_id,s.coach_id) then raise exception 'This call is private or no longer available.' using errcode='42501'; end if;
  if s.call_status='idle' then raise exception 'This draft has no audio or video call.'; end if;
  perform private.expire_live_run_calls(array[actor]);
  select * into s from public.run_live_sessions where id=p_session_id;
  peer:=case when actor=s.athlete_id then s.coach_id else s.athlete_id end;
  bound_client:=case when actor=s.athlete_id then s.athlete_client_id else s.coach_client_id end;
  if p_action='get' then
    if (s.call_status='active' or (s.call_status='ringing' and s.created_by=actor))
      and (p_client_id is null or bound_client is distinct from p_client_id) then
      raise exception 'This call is open on another tab or device.' using errcode='42501';
    end if;
    select draft into d from private.run_live_drafts where session_id=s.id
      and (s.invitation_status='accepted' or s.created_by=actor);
    return jsonb_build_object('session',to_jsonb(s)) || case when d is not null then jsonb_build_object('draft',d) else '{}'::jsonb end;
  end if;
  if p_client_id is null then raise exception 'Reopen the call controls.'; end if;
  if p_action in ('accept','decline') then
    if actor=s.created_by then raise exception 'The other person answers this call.'; end if;
    if s.call_status='active' and p_action='accept' and bound_client=p_client_id then
      select draft into d from private.run_live_drafts where session_id=s.id;
      return jsonb_build_object('session',to_jsonb(s),'draft',d);
    end if;
    if s.call_status='declined' and p_action='decline' then return jsonb_build_object('session',to_jsonb(s)); end if;
    if s.call_status<>'ringing' then return jsonb_build_object('session',to_jsonb(s),'unavailable',true); end if;
    update public.run_live_sessions set invitation_status=case when p_action='accept' then 'accepted' else 'declined' end,
      responded_at=clock_timestamp(),call_status=case when p_action='accept' then 'active' else 'declined' end,
      status=case when p_action='accept' then 'active' else 'ended' end,
      call_started_at=case when p_action='accept' then clock_timestamp() end,
      call_ended_at=case when p_action='decline' then clock_timestamp() end,
      call_end_reason=case when p_action='decline' then 'declined' end,
      athlete_client_id=case when actor=athlete_id then p_client_id else athlete_client_id end,
      coach_client_id=case when actor=coach_id then p_client_id else coach_client_id end,
      athlete_seen_at=case when p_action='accept' then clock_timestamp() else athlete_seen_at end,
      coach_seen_at=case when p_action='accept' then clock_timestamp() else coach_seen_at end,
      editor_id=case when p_action='accept' then editor_id end,
      editor_client=case when p_action='accept' then editor_client end,
      lease_until=case when p_action='accept' then now()+interval '45 seconds' end,updated_at=clock_timestamp()
      where id=s.id returning * into s;
    if p_action='accept' then select draft into d from private.run_live_drafts where session_id=s.id; end if;
    return jsonb_build_object('session',to_jsonb(s)) || case when d is not null then jsonb_build_object('draft',d) else '{}'::jsonb end;
  end if;
  if bound_client is distinct from p_client_id then raise exception 'This call is open on another tab or device.'; end if;
  if p_action='cancel' then
    if actor<>s.created_by then raise exception 'Only the caller cancels a ringing call.'; end if;
    if s.call_status<>'ringing' then return jsonb_build_object('session',to_jsonb(s)); end if;
    update public.run_live_sessions set call_status='cancelled',status='ended',call_end_reason='cancelled',call_ended_at=clock_timestamp(),
      editor_id=null,editor_client=null,lease_until=null,updated_at=clock_timestamp() where id=s.id returning * into s;
  elsif p_action='end' then
    if s.call_status in ('ringing','active') then
      update public.run_live_sessions set call_status='ended',status='ended',call_end_reason='hangup',call_ended_at=clock_timestamp(),
        editor_id=null,editor_client=null,lease_until=null,updated_at=clock_timestamp() where id=s.id returning * into s;
    end if;
  elsif p_action='heartbeat' then
    if s.call_status='active' then
      update public.run_live_sessions set athlete_seen_at=case when actor=athlete_id then clock_timestamp() else athlete_seen_at end,
        coach_seen_at=case when actor=coach_id then clock_timestamp() else coach_seen_at end where id=s.id returning * into s;
    end if;
  elsif p_action in ('signal','signals') then
    if s.call_status<>'active' or s.invitation_status<>'accepted' or s.status<>'active' then
      return jsonb_build_object('session',to_jsonb(s),'signals','[]'::jsonb,'unavailable',true);
    end if;
    if p_action='signals' then
      if p_after is null or p_after<0 then raise exception 'Invalid signaling cursor.'; end if;
      select coalesce(jsonb_agg(to_jsonb(q) order by q.seq),'[]'::jsonb) into messages from (
        select signal.seq,signal.id,signal.sender_id,signal.kind,signal.payload,signal.created_at from public.run_live_signals signal
        where signal.session_id=s.id and signal.recipient_id=actor and signal.seq>p_after and signal.expires_at>now() order by signal.seq limit 100
      ) q;
      return jsonb_build_object('session',to_jsonb(s),'signals',messages);
    end if;
    kind:=p_payload->>'kind';data:=p_payload->'data';
    if p_message_id is null or kind is null or kind not in ('offer','answer','ice') or jsonb_typeof(data) is distinct from 'object'
      or octet_length(data::text)>140000 or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('kind','data')) then
      raise exception 'Invalid call signal.' using errcode='22023';
    end if;
    if kind in ('offer','answer') then
      if data->>'type' is distinct from kind or jsonb_typeof(data->'sdp') is distinct from 'string'
        or length(data->>'sdp') not between 10 and 131072 or left(data->>'sdp',3)<>'v=0'
        or exists(select 1 from jsonb_object_keys(data) k where k not in ('type','sdp')) then
        raise exception 'Invalid call description.' using errcode='22023';
      end if;
    else
      if jsonb_typeof(data->'candidate') is distinct from 'string' or length(data->>'candidate')>4096
        or (coalesce(data->>'candidate','')<>'' and left(data->>'candidate',10)<>'candidate:')
        or (data ? 'sdpMid' and jsonb_typeof(data->'sdpMid') not in ('string','null'))
        or length(coalesce(data->>'sdpMid',''))>256
        or (data ? 'sdpMLineIndex' and jsonb_typeof(data->'sdpMLineIndex') not in ('number','null'))
        or (data->>'sdpMLineIndex' is not null and (data->>'sdpMLineIndex')::numeric not between 0 and 65535)
        or (data ? 'usernameFragment' and jsonb_typeof(data->'usernameFragment') not in ('string','null'))
        or length(coalesce(data->>'usernameFragment',''))>256
        or exists(select 1 from jsonb_object_keys(data) k where k not in ('candidate','sdpMid','sdpMLineIndex','usernameFragment')) then
        raise exception 'Invalid network candidate.' using errcode='22023';
      end if;
    end if;
    select * into sig from public.run_live_signals where session_id=s.id and sender_id=actor and id=p_message_id;
    if found then
      if sig.kind<>kind or sig.payload<>data then raise exception 'This signal identifier was already used.'; end if;
      return jsonb_build_object('session',to_jsonb(s),'signal',to_jsonb(sig));
    end if;
    if (select count(*) from public.run_live_signals where session_id=s.id and sender_id=actor and created_at>now()-interval '1 minute')>=200 then
      raise exception 'Too many call signals. Wait a moment and reconnect.' using errcode='54000';
    end if;
    insert into public.run_live_signals(id,session_id,sender_id,recipient_id,kind,payload)
      values(p_message_id,s.id,actor,peer,kind,data) returning * into sig;
    return jsonb_build_object('session',to_jsonb(s),'signal',to_jsonb(sig));
  else raise exception 'Unknown live call action.';
  end if;
  return jsonb_build_object('session',to_jsonb(s));
end;
$$;
revoke all on function private.live_run_call_action(text,uuid,uuid,uuid,jsonb,uuid,uuid,bigint) from public,anon;
grant execute on function private.live_run_call_action(text,uuid,uuid,uuid,jsonb,uuid,uuid,bigint) to authenticated;
create function public.live_run_call_action(
  p_action text,p_session_id uuid default null,p_client_id uuid default null,
  p_message_id uuid default null,p_payload jsonb default '{}'::jsonb,
  p_athlete_id uuid default null,p_coach_id uuid default null,p_after bigint default 0
) returns jsonb language sql security invoker set search_path='' as $$
  select private.live_run_call_action(p_action,p_session_id,p_client_id,p_message_id,p_payload,p_athlete_id,p_coach_id,p_after);
$$;
revoke all on function public.live_run_call_action(text,uuid,uuid,uuid,jsonb,uuid,uuid,bigint) from public,anon;
grant execute on function public.live_run_call_action(text,uuid,uuid,uuid,jsonb,uuid,uuid,bigint) to authenticated;

-- The existing invitation trigger remains one notification per invitation/answer.
create or replace function private.notify_live_run_invitation()
returns trigger language plpgsql security definer set search_path='' as $$
declare recipient uuid; sender_name text; is_call boolean:=new.call_status<>'idle';
begin
  if tg_op='INSERT' and new.invitation_status='pending' then
    recipient:=case when new.created_by=new.athlete_id then new.coach_id else new.athlete_id end;
    select display_name into sender_name from public.profiles where id=new.created_by;
    perform private.emit_jkcrew_notification(recipient,'live_run_invite',case when is_call then 'Incoming Live Run call' else 'Build together invitation' end,
      coalesce(sender_name,'Your coach or rider')||case when is_call then ' is calling to build a run together.' else ' wants to build a run with you. Tap to accept the session.' end,
      'contests',jsonb_build_object('live_run_id',new.id,'call_mode',new.call_mode),'live-run-invite:'||new.id::text,'coaching');
  elsif tg_op='UPDATE' and old.invitation_status='pending' and new.invitation_status in ('accepted','declined') then
    recipient:=case when new.created_by=new.athlete_id then new.coach_id else new.athlete_id end;
    select display_name into sender_name from public.profiles where id=recipient;
    perform private.emit_jkcrew_notification(new.created_by,'live_run_response',
      case when new.invitation_status='accepted' then 'Build together accepted' else 'Build together declined' end,
      coalesce(sender_name,'Your coach or rider')||case when new.invitation_status='accepted' then ' accepted your live run session.' else ' declined this session.' end,
      'contests',jsonb_build_object('live_run_id',new.id),'live-run-response:'||new.id::text,'coaching');
  end if;
  return new;
end;
$$;

-- SQL-only maintenance; not an exposed endpoint. Expired signaling cannot be
-- read through RLS or the polling RPC even before physical cleanup runs.
create function private.clean_live_run_signaling()
returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.expire_live_run_calls(array(select id from public.profiles where id in
    (select athlete_id from public.run_live_sessions where call_status in ('ringing','active'))
    or id in (select coach_id from public.run_live_sessions where call_status in ('ringing','active'))));
  delete from public.run_live_signals where expires_at<=now();
end;
$$;
revoke all on function private.clean_live_run_signaling() from public,anon,authenticated;
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists
    (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='run_live_signals') then
    alter publication supabase_realtime add table public.run_live_signals;
  end if;
  if exists(select 1 from pg_extension where extname='pg_cron') then
    perform cron.schedule('clean-live-run-signaling','* * * * *','select private.clean_live_run_signaling();');
  end if;
end; $$;
notify pgrst,'reload schema';
