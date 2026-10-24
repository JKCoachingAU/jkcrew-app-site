-- Planning and coach-reviewed event results only. These records never change
-- JKC awards, official ranking totals, or Olympic qualification eligibility.
create table private.uci_rider_records (
 id uuid primary key default gen_random_uuid(),
 kind text not null check(kind in('entry','result')),
 rider_id uuid not null references public.profiles(id),
 -- Intentionally not a cascading FK: deleting/merging a calendar event must
 -- neither destroy a rider's history nor break the existing event workflow.
 event_id uuid not null,
 category text not null check(category in('men_elite','women_elite')),
 payload jsonb not null,
 event_snapshot jsonb not null,
 version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 updated_by uuid not null references public.profiles(id),
 reviewed_by uuid references public.profiles(id),
 reviewed_at timestamptz,
 unique(kind,rider_id,event_id,category)
);
create index uci_rider_records_rider_updated on private.uci_rider_records(rider_id,updated_at desc);
create index uci_rider_records_updated_by on private.uci_rider_records(updated_by);
create index uci_rider_records_reviewed_by on private.uci_rider_records(reviewed_by);
create table private.uci_rider_record_audit (
 id bigint generated always as identity primary key,
 record_id uuid not null references private.uci_rider_records(id),
 actor_id uuid not null,
 expected_version integer not null,
 request_payload jsonb not null,
 before_record jsonb,
 after_record jsonb not null,
 created_at timestamptz not null default now(),
 unique(record_id,actor_id,expected_version)
);
alter table private.uci_rider_records enable row level security;
alter table private.uci_rider_record_audit enable row level security;
revoke all on private.uci_rider_records,private.uci_rider_record_audit from public,anon,authenticated;
revoke all on sequence private.uci_rider_record_audit_id_seq from public,anon,authenticated;

create function private.uci_tracker_actor()
returns uuid language plpgsql stable security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_role text;
begin
 select role::text into v_role from public.profiles where id=v_user;
 if v_user is null or v_role is null or v_role not in('athlete','coach','admin')
   or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
   raise exception 'Sign in as a rider or their coach.' using errcode='42501';
 end if;
 if private.rider_recovery_active(v_user) or exists(select 1 from private.rider_feature_access where athlete_id=v_user and features_disabled) then
   raise exception 'This feature is not available for this account. Contact your coach.' using errcode='42501';
 end if;
 return v_user;
end $$;

create function private.uci_tracker_authorize(p_rider_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_user uuid:=private.uci_tracker_actor(); v_coach boolean;
begin
 select role::text in('coach','admin') into v_coach from public.profiles where id=v_user;
 if p_rider_id is null or not exists(select 1 from public.profiles where id=p_rider_id and role::text='athlete')
   or (not v_coach and p_rider_id<>v_user)
   or (v_coach and not exists(select 1 from public.coach_athletes where coach_id=v_user and athlete_id=p_rider_id)) then
   raise exception 'You can only access your own tracker or a rider assigned to you.' using errcode='42501';
 end if;
 return v_coach;
end $$;

create function private.uci_tracker_https(p_value text)
returns boolean language sql immutable set search_path='' as $$
 select p_value is null or (char_length(p_value)<=2000 and p_value ~ '^https://[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(:[0-9]{1,5})?([/?#][^[:space:]]*)?$');
$$;

create function private.uci_tracker_deadline(p_local text,p_zone text,p_offset text)
returns jsonb language plpgsql stable set search_path='' as $$
declare v_local timestamp; v_at timestamptz; v_seconds integer; v_offset text;
begin
 if nullif(p_local,'') is null then
   if nullif(p_zone,'') is not null or nullif(p_offset,'') is not null then raise exception 'Add a deadline date and time, or clear its timezone and offset.'; end if;
   return jsonb_build_object('deadline_local',null,'deadline_timezone',null,'deadline_offset',null,'deadline_at',null);
 end if;
 if p_local!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$'
   or p_zone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_zone and name!~'^(posix|right)/') then
   raise exception 'Choose a valid deadline time and IANA timezone (for example Europe/Berlin).';
 end if;
 v_local:=p_local::timestamp;
 if v_local<timestamp '2020-01-01' or v_local>timestamp '2040-12-31 23:59' then raise exception 'Choose a deadline between 2020 and 2040.'; end if;
 if nullif(p_offset,'') is not null then
   if p_offset!~'^[+-](0[0-9]|1[0-4]):[0-5][0-9]$' then raise exception 'Use a UTC offset such as +02:00 or -05:00.'; end if;
   v_at:=(p_local||p_offset)::timestamptz;
 else
   v_at:=v_local at time zone p_zone;
 end if;
 if (v_at at time zone p_zone) is distinct from v_local then
   raise exception 'That local time or UTC offset does not exist in this timezone because the clocks change. Check the organiser deadline.';
 end if;
 if nullif(p_offset,'') is null and exists(select 1 from generate_series(-180,180,15) mins where mins<>0
   and ((v_at+mins*interval '1 minute') at time zone p_zone)=v_local) then
   raise exception 'That time occurs twice when the clocks change. Add the organiser UTC offset, such as +02:00 or +01:00.' using hint='deadline_offset_required';
 end if;
 v_seconds:=extract(epoch from(v_local-(v_at at time zone 'UTC')))::integer;
 v_offset:=(case when v_seconds<0 then '-' else '+' end)||lpad((abs(v_seconds)/3600)::text,2,'0')||':'||lpad(((abs(v_seconds)%3600)/60)::text,2,'0');
 return jsonb_build_object('deadline_local',to_char(v_local,'YYYY-MM-DD"T"HH24:MI'),'deadline_timezone',p_zone,'deadline_offset',v_offset,'deadline_at',v_at);
end $$;

create function private.uci_tracker_normalize(p_kind text,p_data jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare v_json jsonb; v_status text; v_note text; v_url text; v_field text; v_date date; v_points numeric; v_place integer;
begin
 if jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>16000 then raise exception 'Check the tracker fields and try again.'; end if;
 v_note:=btrim(coalesce(p_data->>'note','')); if char_length(v_note)>2000 then raise exception 'Keep notes to 2,000 characters.'; end if;
 if p_kind='entry' then
   if exists(select 1 from jsonb_object_keys(p_data) key where key<>all(array['status','licence_checked','category_checked','federation_checked','deadline_local','deadline_timezone','deadline_offset','deadline_source_url','note'])) then raise exception 'Unsupported entry field.'; end if;
   v_status:=coalesce(p_data->>'status','planning');
   if v_status not in('planning','submitted','confirmed','withdrawn') then raise exception 'Choose Planning, Submitted, Confirmed or Withdrawn.'; end if;
   foreach v_field in array array['licence_checked','category_checked','federation_checked'] loop
     if p_data ? v_field and jsonb_typeof(p_data->v_field) is distinct from 'boolean' then raise exception 'Checklist fields must be true or false.'; end if;
   end loop;
   v_url:=nullif(btrim(p_data->>'deadline_source_url'),'');
   if not private.uci_tracker_https(v_url) then raise exception 'Use an HTTPS organiser or federation deadline source link.'; end if;
   v_json:=jsonb_build_object('status',v_status,'licence_checked',coalesce((p_data->>'licence_checked')::boolean,false),
     'category_checked',coalesce((p_data->>'category_checked')::boolean,false),'federation_checked',coalesce((p_data->>'federation_checked')::boolean,false),
     'deadline_source_url',v_url,'note',v_note);
   return v_json||private.uci_tracker_deadline(nullif(p_data->>'deadline_local',''),nullif(p_data->>'deadline_timezone',''),nullif(p_data->>'deadline_offset',''));
 elsif p_kind='result' then
   if exists(select 1 from jsonb_object_keys(p_data) key where key<>all(array['status','event_date','place','points','evidence_url','note'])) then raise exception 'Unsupported result field.'; end if;
   v_status:=coalesce(p_data->>'status','pending');
   if v_status not in('pending','verified') then raise exception 'Results can be Pending or Coach verified. Counting toward an official total is not inferred.'; end if;
   if coalesce(p_data->>'event_date','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Add the event result date.'; end if;
   v_date:=(p_data->>'event_date')::date;
   if v_date<date '2020-01-01' or v_date>current_date+1 then raise exception 'A result must be from an event that has happened.'; end if;
   if coalesce(jsonb_typeof(p_data->'points'),'null') not in('number','null') then raise exception 'Points must be a number, or blank if unknown.'; end if;
   v_points:=(p_data->>'points')::numeric;
   if v_points<0 or v_points>1000000 then raise exception 'Points must be between 0 and 1,000,000.'; end if;
   if coalesce(jsonb_typeof(p_data->'place'),'null') not in('number','null') or coalesce(p_data->>'place','1')!~'^[0-9]+$' then raise exception 'Place must be a whole number, or blank if unknown.'; end if;
   v_place:=(p_data->>'place')::integer;
   if v_place<1 or v_place>100000 then raise exception 'Place must be between 1 and 100,000.'; end if;
   v_url:=nullif(btrim(p_data->>'evidence_url'),'');
   if not private.uci_tracker_https(v_url) then raise exception 'Use an HTTPS official event results link.'; end if;
   if v_status='verified' and (v_points is null or v_url is null) then raise exception 'Coach verification needs known points and an official results evidence link.'; end if;
   return jsonb_build_object('status',v_status,'event_date',v_date,'place',v_place,'points',v_points,'evidence_url',v_url,'note',v_note);
 end if;
 raise exception 'Unsupported tracker record type.';
end $$;

create function private.uci_tracker_record_json(p_row private.uci_rider_records)
returns jsonb language sql stable set search_path='' as $$
 select p_row.payload||jsonb_build_object('id',p_row.id,'rider_id',p_row.rider_id,'event_id',p_row.event_id,'category',p_row.category,
   'event_title',p_row.event_snapshot->>'title','event_snapshot',p_row.event_snapshot,'version',p_row.version,
   'created_at',p_row.created_at,'updated_at',p_row.updated_at,'updated_by',p_row.updated_by,'reviewed_by',p_row.reviewed_by,'reviewed_at',p_row.reviewed_at);
$$;

create function private.save_uci_tracker_record(p_kind text,p_rider_id uuid,p_event_id uuid,p_category text,p_data jsonb,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=private.uci_tracker_actor(); v_coach boolean:=private.uci_tracker_authorize(p_rider_id);
 v_old private.uci_rider_records; v_saved private.uci_rider_records; v_event public.dashboard_items; v_payload jsonb;
 v_before jsonb; v_after jsonb; v_receipt private.uci_rider_record_audit; v_event_snapshot jsonb; v_category text; v_matches integer;
begin
 if p_category is null or p_category not in('men_elite','women_elite') then raise exception 'Choose Men Elite or Women Elite explicitly.'; end if;
 if p_event_id is null or p_expected_version is null or p_expected_version<0 then raise exception 'Reload the tracker before saving.' using errcode='40001',hint='reload_latest'; end if;
 v_payload:=private.uci_tracker_normalize(p_kind,p_data);
 if p_kind='result' and not v_coach and v_payload->>'status'<>'pending' then raise exception 'Only your assigned coach can verify a result.' using errcode='42501'; end if;
 -- Serialize create/update across the unique rider/event/category key. Locks
 -- protect first inserts too; identical retries use an immutable save receipt.
 perform pg_advisory_xact_lock(hashtextextended('uci-tracker:'||p_rider_id||':'||p_event_id||':'||p_category,0));
 select * into v_old from private.uci_rider_records where kind=p_kind and rider_id=p_rider_id and event_id=p_event_id and category=p_category for update;
 if v_old.id is not null then
   select * into v_receipt from private.uci_rider_record_audit where record_id=v_old.id and actor_id=v_user and expected_version=p_expected_version;
   if v_receipt.id is not null then
     if v_receipt.request_payload is distinct from v_payload then raise exception 'This record changed. Reload the latest version; your input has not been discarded.' using errcode='40001',hint='reload_latest'; end if;
     return v_receipt.after_record||jsonb_build_object('replayed',true,'current_version',v_old.version);
   end if;
   if not v_coach and p_kind='result' and v_old.payload->>'status'='verified' then raise exception 'Your coach has verified this result. Ask your coach to correct it.' using errcode='42501'; end if;
   if v_old.version<>p_expected_version then raise exception 'This record changed. Reload the latest version; your input has not been discarded.' using errcode='40001',hint='reload_latest'; end if;
 elsif p_expected_version<>0 then raise exception 'This record changed. Reload the tracker before saving.' using errcode='40001',hint='reload_latest'; end if;
 select * into v_event from public.dashboard_items where id=p_event_id and item_type='event';
 if v_event.id is null then
   if v_old.id is null then raise exception 'Choose an existing event from Upcoming Events and Contests.'; end if;
   v_event_snapshot:=v_old.event_snapshot;
 elsif not v_coach and not(coalesce(v_event.owner_id=v_user,false) or (not coalesce(v_event.completed,false) and coalesce(v_event.end_at,v_event.due_at+interval '1 day','infinity'::timestamptz)>=now())
   or v_old.id is not null or exists(select 1 from private.uci_rider_records where rider_id=p_rider_id and event_id=p_event_id)) then
   raise exception 'This past event is not available in your tracker. Ask your coach to add its result.' using errcode='42501';
 else
   v_event_snapshot:=jsonb_build_object('id',v_event.id,'title',left(v_event.title,140),'details',left(v_event.details,300),
     'due_at',v_event.due_at,'end_at',v_event.end_at,'completed',v_event.completed,'uci_schedule_date_only',v_event.uci_schedule_date_only,'uci_schedule_status',v_event.uci_schedule_status);
 end if;
 -- Only a unique, recently verified saved UCI identity can constrain category.
 -- Unknown identities are never guessed from names or nationality.
 select count(*),min(c.key||'_elite') into v_matches,v_category
 from private.uci_schedule_state s cross join lateral jsonb_each(coalesce(s.rankings->'categories','{}')) c
 cross join lateral jsonb_array_elements(coalesce(c.value->'rows','[]')) r
 join public.profiles p on p.id=p_rider_id and p.uci_id=r->>'uciId'
 where c.key in('men','women') and (s.rankings->>'checkedAt')::timestamptz>=now()-interval '10 days';
 if v_matches=1 and v_category<>p_category then raise exception 'This category does not match the rider’s linked UCI identity. Check their profile link or selected category.'; end if;
 v_before:=case when v_old.id is not null then private.uci_tracker_record_json(v_old) else null end;
 if v_old.id is null then
   insert into private.uci_rider_records(kind,rider_id,event_id,category,payload,event_snapshot,updated_by,reviewed_by,reviewed_at)
   values(p_kind,p_rider_id,p_event_id,p_category,v_payload,v_event_snapshot,v_user,
     case when p_kind='result' and v_payload->>'status'='verified' then v_user end,
     case when p_kind='result' and v_payload->>'status'='verified' then clock_timestamp() end) returning * into v_saved;
 else
   update private.uci_rider_records set payload=v_payload,event_snapshot=v_event_snapshot,version=version+1,updated_at=clock_timestamp(),updated_by=v_user,
     reviewed_by=case when p_kind='result' and v_payload->>'status'='verified' then v_user end,
     reviewed_at=case when p_kind='result' and v_payload->>'status'='verified' then clock_timestamp() end
   where id=v_old.id returning * into v_saved;
 end if;
 v_after:=private.uci_tracker_record_json(v_saved);
 insert into private.uci_rider_record_audit(record_id,actor_id,expected_version,request_payload,before_record,after_record)
 values(v_saved.id,v_user,p_expected_version,v_payload,v_before,v_after);
 return v_after||jsonb_build_object('replayed',false,'current_version',v_saved.version);
end $$;

create function private.get_uci_rider_tracker(p_rider_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_user uuid:=private.uci_tracker_actor(); v_coach boolean; v_ids uuid[]; v_events jsonb;
begin
 select role::text in('coach','admin') into v_coach from public.profiles where id=v_user;
 if p_rider_id is not null then perform private.uci_tracker_authorize(p_rider_id); end if;
 select coalesce(array_agg(p.id),'{}'::uuid[]) into v_ids from public.profiles p where p.role::text='athlete'
   and (p_rider_id is null or p.id=p_rider_id)
   and ((not v_coach and p.id=v_user) or (v_coach and exists(select 1 from public.coach_athletes ca where ca.coach_id=v_user and ca.athlete_id=p.id)));
 select coalesce(jsonb_agg(e.payload order by e.payload->>'due_at' desc nulls last,e.payload->>'title'),'[]') into v_events from (
   select d.id,jsonb_build_object('id',d.id,'title',left(d.title,140),'details',left(d.details,300),'due_at',d.due_at,'end_at',d.end_at,
     'completed',d.completed,'uci_schedule_date_only',d.uci_schedule_date_only,'uci_schedule_status',d.uci_schedule_status,'unavailable',false) payload
   from public.dashboard_items d where d.item_type='event' and (v_coach or d.owner_id=v_user
     or (not d.completed and coalesce(d.end_at,d.due_at+interval '1 day','infinity'::timestamptz)>=now())
     or exists(select 1 from private.uci_rider_records r where r.rider_id=any(v_ids) and r.event_id=d.id))
   union all
   select distinct on(r.event_id) r.event_id,r.event_snapshot||jsonb_build_object('unavailable',true)
   from private.uci_rider_records r where r.rider_id=any(v_ids) and not exists(select 1 from public.dashboard_items d where d.id=r.event_id and d.item_type='event')
 ) e;
 return jsonb_build_object('canManage',v_coach,'riders',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'display_name',p.display_name,'uci_id',p.uci_id) order by p.display_name) from public.profiles p where p.id=any(v_ids)),'[]'),
   'events',v_events,
   'entries',coalesce((select jsonb_agg(private.uci_tracker_record_json(r) order by r.updated_at desc,r.id) from private.uci_rider_records r where r.rider_id=any(v_ids) and r.kind='entry'),'[]'),
   'results',coalesce((select jsonb_agg(private.uci_tracker_record_json(r) order by r.payload->>'event_date' desc,r.id) from private.uci_rider_records r where r.rider_id=any(v_ids) and r.kind='result'),'[]'));
end $$;

create function private.save_uci_event_entry(p_rider_id uuid,p_event_id uuid,p_category text,p_data jsonb,p_expected_version integer default 0)
returns jsonb language sql security definer set search_path='' as $$ select private.save_uci_tracker_record('entry',p_rider_id,p_event_id,p_category,p_data,p_expected_version); $$;
create function private.save_uci_rider_result(p_rider_id uuid,p_event_id uuid,p_category text,p_data jsonb,p_expected_version integer default 0)
returns jsonb language sql security definer set search_path='' as $$ select private.save_uci_tracker_record('result',p_rider_id,p_event_id,p_category,p_data,p_expected_version); $$;
create function public.get_uci_rider_tracker(p_rider_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$ select private.get_uci_rider_tracker(p_rider_id); $$;
create function public.save_uci_event_entry(p_rider_id uuid,p_event_id uuid,p_category text,p_data jsonb,p_expected_version integer default 0)
returns jsonb language sql security invoker set search_path='' as $$ select private.save_uci_event_entry(p_rider_id,p_event_id,p_category,p_data,p_expected_version); $$;
create function public.save_uci_rider_result(p_rider_id uuid,p_event_id uuid,p_category text,p_data jsonb,p_expected_version integer default 0)
returns jsonb language sql security invoker set search_path='' as $$ select private.save_uci_rider_result(p_rider_id,p_event_id,p_category,p_data,p_expected_version); $$;

revoke all on function private.uci_tracker_actor(),private.uci_tracker_authorize(uuid),private.uci_tracker_https(text),private.uci_tracker_deadline(text,text,text),
 private.uci_tracker_normalize(text,jsonb),private.uci_tracker_record_json(private.uci_rider_records),private.save_uci_tracker_record(text,uuid,uuid,text,jsonb,integer),
 private.get_uci_rider_tracker(uuid),private.save_uci_event_entry(uuid,uuid,text,jsonb,integer),private.save_uci_rider_result(uuid,uuid,text,jsonb,integer),
 public.get_uci_rider_tracker(uuid),public.save_uci_event_entry(uuid,uuid,text,jsonb,integer),public.save_uci_rider_result(uuid,uuid,text,jsonb,integer) from public,anon,authenticated;
grant usage on schema private to authenticated;
grant execute on function private.get_uci_rider_tracker(uuid),private.save_uci_event_entry(uuid,uuid,text,jsonb,integer),private.save_uci_rider_result(uuid,uuid,text,jsonb,integer),
 public.get_uci_rider_tracker(uuid),public.save_uci_event_entry(uuid,uuid,text,jsonb,integer),public.save_uci_rider_result(uuid,uuid,text,jsonb,integer) to authenticated;
notify pgrst,'reload schema';
