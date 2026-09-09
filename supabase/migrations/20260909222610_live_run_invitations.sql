-- Existing live drafts stay open; new sessions require the other participant to accept.
alter table public.run_live_sessions add column invitation_status text not null default 'accepted'
  check (invitation_status in ('pending','accepted','declined'));
alter table public.run_live_sessions alter column invitation_status set default 'pending';
alter table public.run_live_sessions add column responded_at timestamptz;

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
begin
  if actor is null then raise exception 'Sign in to build together.'; end if;
  if p_action = 'create' then
    if p_client_id is null or not coalesce(actor in (p_athlete_id,p_coach_id),false)
      or not exists (select 1 from public.coach_athletes c join public.profiles p on p.id = c.coach_id
        where c.athlete_id = p_athlete_id and c.coach_id = p_coach_id and p.role::text in ('coach','admin')) then
      raise exception 'Choose your linked rider and coach.';
    end if;
    d := '{}'::jsonb;
  else
    select * into s from public.run_live_sessions where id = p_session_id for update;
    if not found or not coalesce(actor in (s.athlete_id,s.coach_id),false)
      or not exists (select 1 from public.coach_athletes c join public.profiles p on p.id = c.coach_id
        where c.coach_id = s.coach_id and c.athlete_id = s.athlete_id and p.role::text in ('coach','admin')) then
      raise exception 'This live run is private or no longer available.';
    end if;
    select draft into d from private.run_live_drafts where session_id = s.id;
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
      ('title','venue','planType','notes','contestItemId','imageDataUrl','points','view')) then
      raise exception 'Invalid run field.';
    end if;
    d := d || p_patch;
    if octet_length(d::text) > 12000000 or jsonb_typeof(d->'points') is distinct from 'array'
      or jsonb_array_length(d->'points') > 300 or length(coalesce(d->>'title','')) > 140
      or length(coalesce(d->>'notes','')) > 10000
      or coalesce(d->>'planType','training') not in ('training','competition') then raise exception 'Check the run photo, title and dots.'; end if;
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
    update public.run_live_sessions set status='ended',editor_id=null,editor_client=null,lease_until=null where id=s.id returning * into s;
  else raise exception 'Unknown live run action.';
  end if;
  return jsonb_build_object('session',to_jsonb(s)) || case when p_action in ('create','claim') then jsonb_build_object('draft',d) else '{}'::jsonb end;
end;
$$;

create or replace function private.notify_live_run_invitation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare recipient uuid; sender_name text;
begin
  if tg_op = 'INSERT' and new.invitation_status = 'pending' then
    recipient := case when new.created_by = new.athlete_id then new.coach_id else new.athlete_id end;
    select display_name into sender_name from public.profiles where id=new.created_by;
    perform private.emit_jkcrew_notification(recipient,'live_run_invite','Build together invitation',
      coalesce(sender_name,'Your coach or rider') || ' wants to build a run with you. Tap to accept the session.',
      'contests',jsonb_build_object('live_run_id',new.id),'live-run-invite:'||new.id::text,'coaching');
  elsif tg_op = 'UPDATE' and old.invitation_status = 'pending' and new.invitation_status in ('accepted','declined') then
    recipient := case when new.created_by = new.athlete_id then new.coach_id else new.athlete_id end;
    select display_name into sender_name from public.profiles where id=recipient;
    perform private.emit_jkcrew_notification(new.created_by,'live_run_response',
      case when new.invitation_status='accepted' then 'Build together accepted' else 'Build together declined' end,
      coalesce(sender_name,'Your coach or rider') || case when new.invitation_status='accepted' then ' accepted your live run session.' else ' declined this session.' end,
      'contests',jsonb_build_object('live_run_id',new.id),'live-run-response:'||new.id::text,'coaching');
  end if;
  return new;
end;
$$;
revoke all on function private.notify_live_run_invitation() from public, anon, authenticated;
create trigger notify_live_run_invitation after insert or update of invitation_status on public.run_live_sessions
  for each row execute function private.notify_live_run_invitation();
