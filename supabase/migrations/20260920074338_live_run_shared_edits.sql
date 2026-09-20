begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- A route generation prevents a delayed coordinate edit from being applied to
-- a new course image, even when a caller intentionally keeps the same dot IDs.
alter table private.run_live_drafts add column route_version bigint not null default 1;

-- Receipts contain no course photos or draft snapshots. The session row lock
-- serializes edits and receipts, so a lost response can be retried exactly once.
create table private.run_live_edit_receipts (
  session_id uuid not null references public.run_live_sessions(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  client_id uuid not null,
  request_id uuid not null,
  request_hash bytea not null,
  applied_version bigint not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (session_id,actor_id,client_id,request_id)
);
alter table private.run_live_edit_receipts enable row level security;
revoke all on private.run_live_edit_receipts from public,anon,authenticated;

create function private.live_run_point_ids(p_points jsonb)
returns jsonb language plpgsql volatile set search_path='' as $$
declare result jsonb:='[]'::jsonb; point jsonb; point_id text; seen text[]:='{}';
begin
  if jsonb_typeof(p_points) is distinct from 'array' then raise exception 'Invalid route dots.' using errcode='22023'; end if;
  for point in select value from jsonb_array_elements(p_points) loop
    if jsonb_typeof(point) is distinct from 'object' then raise exception 'Invalid route dot.' using errcode='22023'; end if;
    point_id:=point->>'id';
    if point_id is null or point_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      point_id:=gen_random_uuid()::text;
    else point_id:=lower(point_id);
    end if;
    if point_id=any(seen) then point_id:=gen_random_uuid()::text; end if;
    seen:=array_append(seen,point_id);
    result:=result||jsonb_build_array(jsonb_set(point,'{id}',to_jsonb(point_id)));
  end loop;
  return result;
end;
$$;
revoke all on function private.live_run_point_ids(jsonb) from public,anon,authenticated;

create function private.live_run_edit(
  p_session_id uuid,p_client_id uuid,p_request_id uuid,p_version bigint,p_ops jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); s public.run_live_sessions; d jsonb; original jsonb; points jsonb;
  generation bigint; receipt private.run_live_edit_receipts; fingerprint bytea;
  operation jsonb; kind text; field text; point_id text; anchor text;
  before_point jsonb; new_point jsonb; current_point jsonb; merged_point jsonb;
  point_index integer; anchor_index integer; conflicts text[]:='{}'; changed boolean:=false;
  changes_course boolean:=false; touches_route boolean:=false;
begin
  if actor is null then raise exception 'Sign in to edit this run.' using errcode='42501'; end if;
  select * into s from public.run_live_sessions where id=p_session_id for update;
  if not found or not private.live_run_pair_allowed(s.athlete_id,s.coach_id) then
    raise exception 'This live run is private or no longer available.' using errcode='42501';
  end if;
  if p_client_id is null or p_client_id is distinct from
    (case when actor=s.athlete_id then s.athlete_client_id else s.coach_client_id end) then
    raise exception 'This call is open on another tab or device.' using errcode='42501';
  end if;
  if jsonb_typeof(p_ops) is distinct from 'array' or jsonb_array_length(p_ops)>700 or octet_length(p_ops::text)>26000000 then
    raise exception 'Invalid shared run edits.' using errcode='22023';
  end if;
  -- Bootstrap is available to the ringing caller only; the callee has no bound
  -- client until accepting. No operation receipts are created by read polling.
  if s.status<>'active' or s.expires_at<=clock_timestamp() or
    not ((s.call_status='active' and s.invitation_status='accepted'
      and least(s.athlete_seen_at,s.coach_seen_at)>clock_timestamp()-interval '90 seconds')
      or (jsonb_array_length(p_ops)=0 and s.call_status='ringing' and s.created_by=actor and s.ring_expires_at>clock_timestamp())) then
    raise exception 'Accept an active call before editing this run.' using errcode='42501';
  end if;
  select draft,route_version into d,generation from private.run_live_drafts where session_id=s.id;
  if d is null then raise exception 'This shared draft is unavailable.'; end if;
  original:=d;
  if jsonb_array_length(p_ops)=0 then
    points:=private.live_run_point_ids(d->'points');
    if points is distinct from d->'points' then
      d:=jsonb_set(d,'{points}',points);
      update private.run_live_drafts set draft=d where session_id=s.id;
      update public.run_live_sessions set version=version+1,updated_at=clock_timestamp() where id=s.id returning * into s;
    end if;
    return jsonb_build_object('session',to_jsonb(s),'draft',d,'applied',true);
  end if;
  if p_request_id is null or p_version is null or p_version<1 or p_version>s.version then
    raise exception 'Reload the shared run before sending these edits.' using errcode='22023';
  end if;
  fingerprint:=sha256(convert_to(jsonb_build_object('version',p_version,'ops',p_ops)::text,'UTF8'));
  select * into receipt from private.run_live_edit_receipts where session_id=s.id and actor_id=actor
    and client_id=p_client_id and request_id=p_request_id;
  if found then
    if receipt.request_hash is distinct from fingerprint then raise exception 'This edit request identifier was already used.' using errcode='22023'; end if;
    return jsonb_build_object('session',to_jsonb(s),'draft',d,'applied',true,'replayed',true,'applied_version',receipt.applied_version);
  end if;
  if private.live_run_point_ids(d->'points') is distinct from d->'points' then
    raise exception 'Reload the shared run to identify its route dots before editing.' using errcode='22023';
  end if;
  for operation in select value from jsonb_array_elements(p_ops) loop
    if jsonb_typeof(operation) is distinct from 'object' then raise exception 'Invalid shared run operation.' using errcode='22023'; end if;
    kind:=operation->>'op';
    if kind='set' then
      if not (operation ?& array['op','key','before','value']) or exists(select 1 from jsonb_object_keys(operation) k where k not in ('op','key','before','value'))
        or coalesce(operation->>'key','') not in ('title','venue','planType','notes','contestItemId','courseSource','imageDataUrl','view') then
        raise exception 'Invalid shared run field.' using errcode='22023';
      end if;
      field:=operation->>'key';
      if field in ('imageDataUrl','contestItemId','courseSource') and operation->'before' is distinct from operation->'value' then changes_course:=true; end if;
      if field='view' then touches_route:=true; end if;
    elsif kind='point' then
      if not (operation ?& array['op','id','before','value']) or exists(select 1 from jsonb_object_keys(operation) k where k not in ('op','id','before','value'))
        or jsonb_typeof(operation->'before') is distinct from 'object' or jsonb_typeof(operation->'value') is distinct from 'object'
        or operation->'id' is distinct from operation#>'{before,id}' or operation->'id' is distinct from operation#>'{value,id}' then
        raise exception 'Invalid route dot edit.' using errcode='22023';
      end if;
      touches_route:=true;
    elsif kind='insert' then
      if not (operation ?& array['op','after','value']) or exists(select 1 from jsonb_object_keys(operation) k where k not in ('op','after','value'))
        or jsonb_typeof(operation->'value') is distinct from 'object'
        or (operation->'after'<>'null'::jsonb and (jsonb_typeof(operation->'after') is distinct from 'string'
          or operation->>'after' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) then
        raise exception 'Invalid route dot insertion.' using errcode='22023';
      end if;
      touches_route:=true;
    elsif kind='delete' then
      if not (operation ?& array['op','id','before']) or exists(select 1 from jsonb_object_keys(operation) k where k not in ('op','id','before'))
        or jsonb_typeof(operation->'before') is distinct from 'object' or operation->'id' is distinct from operation#>'{before,id}' then
        raise exception 'Invalid route dot removal.' using errcode='22023';
      end if;
      touches_route:=true;
    else raise exception 'Unknown shared run operation.' using errcode='22023';
    end if;
    if kind in ('point','insert','delete') then
      point_id:=case when kind='insert' then operation#>>'{value,id}' else operation->>'id' end;
      if point_id is null or point_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'Every route dot needs a stable identifier.' using errcode='22023';
      end if;
    end if;
  end loop;
  if changes_course and p_version<>s.version then conflicts:=array_append(conflicts,'course'); end if;
  if touches_route and p_version<generation then conflicts:=array_append(conflicts,'course'); end if;
  if cardinality(conflicts)>0 then
    return jsonb_build_object('session',to_jsonb(s),'draft',original,'conflicts',to_jsonb(conflicts),'applied',false);
  end if;
  for operation in select value from jsonb_array_elements(p_ops) loop
    kind:=operation->>'op';
    if kind='set' then
      field:=operation->>'key';
      if coalesce(d->field,'null'::jsonb) is distinct from operation->'before'
        and coalesce(d->field,'null'::jsonb) is distinct from operation->'value' then
        conflicts:=array_append(conflicts,field);
      else d:=jsonb_set(d,array[field],operation->'value');
      end if;
      continue;
    end if;
    points:=d->'points';
    point_id:=case when kind='insert' then operation#>>'{value,id}' else operation->>'id' end;
    select value,(ordinality-1)::integer into current_point,point_index from jsonb_array_elements(points) with ordinality where value->>'id'=point_id;
    if kind='insert' then
      if current_point is not null then conflicts:=array_append(conflicts,'points.'||point_id);continue; end if;
      anchor:=operation->>'after';anchor_index:=-1;
      if anchor is not null then
        select (ordinality-1)::integer into anchor_index from jsonb_array_elements(points) with ordinality where value->>'id'=anchor;
        if anchor_index is null then conflicts:=array_append(conflicts,'points.'||anchor);continue; end if;
      end if;
      points:=jsonb_insert(points,array[(anchor_index+1)::text],operation->'value');
    elsif current_point is null then
      conflicts:=array_append(conflicts,'points.'||point_id);continue;
    elsif kind='delete' then
      if current_point is distinct from operation->'before' then conflicts:=array_append(conflicts,'points.'||point_id);continue; end if;
      points:=points-point_index;
    else
      before_point:=operation->'before';new_point:=operation->'value';merged_point:=current_point;
      for field in select key from jsonb_object_keys(before_point||new_point) key where key<>'id' loop
        -- SQL NULL means absent; JSON null is a present value. Do not conflate
        -- them when comparing or removing an optional dot property.
        if (before_point ? field) is not distinct from (new_point ? field) and before_point->field is not distinct from new_point->field then continue; end if;
        if (current_point ? field) is distinct from (before_point ? field) or current_point->field is distinct from before_point->field then
          -- Two people choosing the same value have already converged. This is
          -- also true of removing the same optional field, but not absent/null.
          if (current_point ? field) is distinct from (new_point ? field) or current_point->field is distinct from new_point->field then
            conflicts:=array_append(conflicts,'points.'||point_id||'.'||field);
          end if;
        elsif new_point ? field then merged_point:=jsonb_set(merged_point,array[field],new_point->field);
        else merged_point:=merged_point-field;
        end if;
      end loop;
      points:=jsonb_set(points,array[point_index::text],merged_point);
    end if;
    d:=jsonb_set(d,'{points}',points);
  end loop;
  if cardinality(conflicts)>0 then
    return jsonb_build_object('session',to_jsonb(s),'draft',original,'conflicts',to_jsonb(conflicts),'applied',false);
  end if;
  d:=private.validate_live_run_draft(d);
  changed:=d is distinct from original;
  if changed then
    update public.run_live_sessions set version=version+1,title=coalesce(nullif(d->>'title',''),'Shared run'),updated_at=clock_timestamp()
      where id=s.id returning * into s;
    update private.run_live_drafts set draft=d,route_version=case when changes_course then s.version else route_version end where session_id=s.id;
  end if;
  insert into private.run_live_edit_receipts(session_id,actor_id,client_id,request_id,request_hash,applied_version)
    values(s.id,actor,p_client_id,p_request_id,fingerprint,s.version);
  return jsonb_build_object('session',to_jsonb(s),'draft',d,'applied',true,'applied_version',s.version);
end;
$$;
revoke all on function private.live_run_edit(uuid,uuid,uuid,bigint,jsonb) from public,anon;
grant execute on function private.live_run_edit(uuid,uuid,uuid,bigint,jsonb) to authenticated;
create function public.live_run_edit(p_session_id uuid,p_client_id uuid,p_request_id uuid,p_version bigint,p_ops jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select private.live_run_edit(p_session_id,p_client_id,p_request_id,p_version,p_ops);
$$;
revoke all on function public.live_run_edit(uuid,uuid,uuid,bigint,jsonb) from public,anon;
grant execute on function public.live_run_edit(uuid,uuid,uuid,bigint,jsonb) to authenticated;

-- Preserve legacy non-call leases; active calls share checked operations and saves.
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
    -- Editing and saving must use the same accepted device as the media call.
    if (s.call_status='active' or (s.call_status='ringing' and s.created_by=actor)) and
      (p_client_id is null or p_client_id is distinct from
        (case when actor=s.athlete_id then s.athlete_client_id else s.coach_client_id end)) then
      raise exception 'This call is open on another tab or device.' using errcode='42501';
    end if;
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
      update private.run_live_drafts set draft=d,
        route_version=case when s.call_status='active' and exists(
          select 1 from unnest(array['imageDataUrl','contestItemId','courseSource']) key
          where coalesce(draft->key,'null'::jsonb) is distinct from coalesce(d->key,'null'::jsonb))
          then s.version+1 else route_version end where session_id=s.id;
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
    -- Either accepted, device-bound participant may save the latest shared revision.
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

notify pgrst, 'reload schema';
commit;
