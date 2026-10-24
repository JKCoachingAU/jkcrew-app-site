-- UCI calendar metadata is private at rest and exposed through role-checked RPCs.
-- The weekly collector publishes reviewed data, never credentials. pg_net reads
-- only two fixed project-owned feeds; no browser may ingest or queue alerts.
alter table public.dashboard_items add column uci_schedule_date_only boolean not null default false;
alter table public.dashboard_items add column uci_schedule_status text
 check(uci_schedule_status in('confirmed','provisional','cancelled','review_required'));
create function private.clear_uci_schedule_date_only_on_manual_edit()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if (new.due_at is distinct from old.due_at or new.end_at is distinct from old.end_at)
   and current_setting('jkcrew.uci_schedule_sync_event',true) is distinct from new.id::text
   and ((new.due_at at time zone 'UTC')::time is distinct from time '12:00'
     or (new.end_at is not null and (new.end_at at time zone 'UTC')::time is distinct from time '12:00')) then
   new.uci_schedule_date_only:=false;
 end if;
 return new;
end $$;
revoke all on function private.clear_uci_schedule_date_only_on_manual_edit() from public,anon,authenticated;
create trigger clear_uci_schedule_date_only_on_manual_edit before update of due_at,end_at on public.dashboard_items
 for each row execute function private.clear_uci_schedule_date_only_on_manual_edit();

create table private.uci_schedule_state (
  singleton boolean primary key default true check(singleton),
  snapshot jsonb not null default '{}'::jsonb,
  rankings jsonb not null default '{}'::jsonb,
  checked_at timestamptz,
  ingested_at timestamptz,
  last_polled_at timestamptz,
  refresh_status text not null default 'not_checked',
  refresh_error text not null default '',
  schedule_request_id bigint,
  rankings_request_id bigint,
  requested_at timestamptz,
  retry_at timestamptz,
  attempts integer not null default 0
);
insert into private.uci_schedule_state(singleton) values(true);
create table private.uci_schedule_events (
  source_id text primary key,
  payload jsonb not null,
  checked_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create table private.uci_schedule_calendar_links (
  source_id text primary key references private.uci_schedule_events(source_id),
  event_id uuid unique references public.dashboard_items(id) on delete set null,
  added_by uuid not null references public.profiles(id),
  managed_fields jsonb not null default '{}'::jsonb,
  sync_conflicts jsonb not null default '[]'::jsonb,
  added_at timestamptz not null default now(),
  synced_at timestamptz not null default now()
);
create table private.uci_schedule_subscribers (
  coach_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
create table private.uci_schedule_announcements (
  source_id text primary key,
  payload jsonb not null,
  first_seen_at timestamptz not null default now(),
  baseline boolean not null default false
);
create table private.uci_schedule_notice_receipts (
  announcement_id text not null references private.uci_schedule_announcements(source_id),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(announcement_id,recipient_id)
);
alter table private.uci_schedule_state enable row level security;
alter table private.uci_schedule_events enable row level security;
alter table private.uci_schedule_calendar_links enable row level security;
alter table private.uci_schedule_subscribers enable row level security;
alter table private.uci_schedule_announcements enable row level security;
alter table private.uci_schedule_notice_receipts enable row level security;
revoke all on private.uci_schedule_state,private.uci_schedule_events,private.uci_schedule_calendar_links,
  private.uci_schedule_subscribers,private.uci_schedule_announcements,private.uci_schedule_notice_receipts from public,anon,authenticated;

create function private.uci_schedule_require_access(p_coach_only boolean default false)
returns uuid language plpgsql stable security definer set search_path='' as $$
declare v_id uuid:=auth.uid(); v_role text;
begin
  select role::text into v_role from public.profiles where id=v_id;
  if v_id is null or v_role is null or v_role not in('coach','admin','athlete')
    or (p_coach_only and v_role not in('coach','admin')) then
    raise exception 'Only authorized riders and coaches can view the UCI schedule.' using errcode='42501';
  end if;
  if private.rider_recovery_active(v_id) or exists(select 1 from private.rider_feature_access where athlete_id=v_id and features_disabled) then
    raise exception 'This feature is not available for this account. Contact your coach.' using errcode='42501';
  end if;
  return v_id;
end $$;

-- Preserve the exact source date in metadata. Noon UTC keeps an undated-time
-- event on the advertised date in Germany and Australia; the calendar explicitly
-- labels its time TBC, rather than claiming it is an official start time.
create function private.uci_schedule_calendar_fields(p_event jsonb)
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object(
    'title',left(case when p_event->>'status'='cancelled' then '[CANCELLED] ' else '' end||(p_event->>'name'),120),
    'details',left(concat_ws(' · ',nullif(p_event->>'venue',''),nullif(p_event->>'country',''),
      nullif(p_event->>'classification',''),case when p_event->>'status'='cancelled' then 'Cancelled — see UCI schedule' else 'Dates only; times TBC — see UCI schedule' end),180),
    'due_at',case when nullif(p_event->>'startDate','') is not null then ((p_event->>'startDate')::date::timestamp at time zone 'UTC')+interval '12 hours' else null end,
    'end_at',case when nullif(p_event->>'endDate','') is not null then ((p_event->>'endDate')::date::timestamp at time zone 'UTC')+interval '12 hours' else null end
  );
$$;

create function private.uci_schedule_sync_calendar(p_source_id text)
returns void language plpgsql security definer set search_path='' as $$
declare v_link private.uci_schedule_calendar_links; v_event public.dashboard_items; v_payload jsonb; v_new jsonb; v_previous_sync text;
 v_current jsonb; v_next jsonb; v_managed jsonb; v_conflicts jsonb:='[]'; v_key text; v_dates_custom boolean;
begin
  select * into v_link from private.uci_schedule_calendar_links where source_id=p_source_id for update;
  if not found or v_link.event_id is null then return; end if;
  select * into v_event from public.dashboard_items where id=v_link.event_id and item_type='event' for update;
  if not found then return; end if;
  select payload into v_payload from private.uci_schedule_events where source_id=p_source_id;
  update public.dashboard_items set uci_schedule_status=v_payload->>'status'
    where id=v_event.id and uci_schedule_status is distinct from v_payload->>'status';
  -- Only official, verified dates update a calendar. Provisional edits stay on
  -- the schedule for review. Cancellation remains an explicit verified status.
  if v_payload->>'status' not in('confirmed','cancelled')
    or (v_payload->>'status'<>'cancelled' and v_payload->>'dateStatus' not in('confirmed','calendar_dates')) then return; end if;
  v_new:=private.uci_schedule_calendar_fields(v_payload);
  v_current:=jsonb_build_object('title',v_event.title,'details',v_event.details,'due_at',v_event.due_at,'end_at',v_event.end_at);
  if v_payload->>'dateStatus' not in('confirmed','calendar_dates') then
    v_new:=v_new||jsonb_build_object('due_at',v_event.due_at,'end_at',v_event.end_at);
  end if;
  v_next:=v_current; v_managed:=v_link.managed_fields;
  v_dates_custom:=(v_current->'due_at' is distinct from v_managed->'due_at') or (v_current->'end_at' is distinct from v_managed->'end_at');
  foreach v_key in array array['title','details','due_at','end_at'] loop
    if v_key in('due_at','end_at') and v_dates_custom then
      -- A coach-edited date range is one unit. Never combine a custom start with
      -- an earlier official finish and accidentally create an inverted event.
      if v_current->v_key is distinct from v_new->v_key then v_conflicts:=v_conflicts||jsonb_build_array(v_key); end if;
    elsif v_current->v_key is not distinct from v_managed->v_key then
      v_next:=jsonb_set(v_next,array[v_key],v_new->v_key);
      v_managed:=jsonb_set(v_managed,array[v_key],v_new->v_key);
    elsif v_current->v_key is distinct from v_new->v_key then
      v_conflicts:=v_conflicts||jsonb_build_array(v_key);
    else
      v_managed:=jsonb_set(v_managed,array[v_key],v_new->v_key);
    end if;
  end loop;
  if v_next is distinct from v_current then
    v_previous_sync:=current_setting('jkcrew.uci_schedule_sync_event',true);
    perform set_config('jkcrew.uci_schedule_sync_event',v_event.id::text,true);
    update public.dashboard_items set title=v_next->>'title',details=v_next->>'details',
      due_at=(v_next->>'due_at')::timestamptz,end_at=(v_next->>'end_at')::timestamptz,updated_at=clock_timestamp()
    where id=v_event.id;
    perform set_config('jkcrew.uci_schedule_sync_event',coalesce(v_previous_sync,''),true);
  end if;
  update private.uci_schedule_calendar_links set managed_fields=v_managed,sync_conflicts=v_conflicts,synced_at=now() where source_id=p_source_id;
end $$;

create function private.uci_schedule_matching_events(p_event jsonb)
returns table(id uuid) language sql stable security definer set search_path='' as $$
 select d.id from public.dashboard_items d where d.item_type='event'
   and regexp_replace(lower(d.title),'[^a-z0-9]','','g')=any(array[
     regexp_replace(lower(p_event->>'name'),'[^a-z0-9]','','g'),
     regexp_replace(lower(left(p_event->>'name',120)),'[^a-z0-9]','','g'),
     regexp_replace(lower(p_event->>'matchUciName'),'[^a-z0-9]','','g')])
   and (d.due_at at time zone 'UTC')::date=nullif(p_event->>'startDate','')::date
 order by d.created_at,d.id;
$$;

create function private.get_uci_2027_schedule()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_user uuid:=private.uci_schedule_require_access(false); v_state private.uci_schedule_state; v_events jsonb; v_can_manage boolean;
begin
  select * into v_state from private.uci_schedule_state where singleton;
  select role::text in('coach','admin') into v_can_manage from public.profiles where id=v_user;
  select coalesce(jsonb_agg(e.payload||jsonb_build_object(
    'existingEventId',l.event_id,'alreadyAdded',l.event_id is not null,
    'matchingEventId',case when l.event_id is null and matching.total=1 then matching.id else null end,
    'matchingEventCount',case when l.event_id is null then matching.total else 0 end,
    'syncStatus',case when l.source_id is not null and l.event_id is null then 'removed' when jsonb_array_length(coalesce(l.sync_conflicts,'[]'))>0 then 'coach_edits' else 'current' end,
    'syncConflicts',coalesce(l.sync_conflicts,'[]'::jsonb)) order by e.payload->>'startDate' nulls last,e.payload->>'name'),'[]'::jsonb)
  into v_events from private.uci_schedule_events e left join private.uci_schedule_calendar_links l on l.source_id=e.source_id
  left join lateral (select count(*) as total,(array_agg(m.id))[1] as id from private.uci_schedule_matching_events(e.payload) m) matching on true;
  return (v_state.snapshot-'events'-'rankings'-'reviewCandidates')||jsonb_build_object(
    'schemaVersion',1,'year',2027,'events',v_events,'checkedAt',v_state.checked_at,
    'announcements',coalesce((select jsonb_agg(payload order by payload->>'publishedAt' desc,source_id) from private.uci_schedule_announcements),'[]'::jsonb),
    'refreshStatus',case when v_state.refresh_status in('failed','pending','retrying') then v_state.refresh_status else coalesce(v_state.snapshot->>'refreshStatus',v_state.refresh_status) end,
    'refreshError',v_state.refresh_error,'lastSyncedAt',v_state.ingested_at,'lastPolledAt',v_state.last_polled_at,
    'weeklyRefresh','Monday 00:30 UTC','canManage',v_can_manage,
    'notificationsEnabled',coalesce((select enabled from private.uci_schedule_subscribers where coach_id=v_user),false));
end $$;
create function public.get_uci_2027_schedule() returns jsonb language sql security invoker set search_path='' as $$ select private.get_uci_2027_schedule(); $$;

create function private.subscribe_uci_schedule_updates(p_enabled boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=private.uci_schedule_require_access(true);
begin
 insert into private.uci_schedule_subscribers(coach_id,enabled) values(v_user,coalesce(p_enabled,true))
 on conflict(coach_id) do update set enabled=excluded.enabled,updated_at=now();
 return jsonb_build_object('enabled',coalesce(p_enabled,true));
end $$;
create function public.subscribe_uci_schedule_updates(p_enabled boolean default true) returns jsonb language sql security invoker set search_path='' as $$ select private.subscribe_uci_schedule_updates(p_enabled); $$;

create function private.add_uci_schedule_event(p_event_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=private.uci_schedule_require_access(true); v_payload jsonb; v_id uuid; v_match_count integer;
 v_fields jsonb; v_existing public.dashboard_items; v_already boolean:=false;
begin
  -- Same global lock order as ingestion: a refresh cannot race an add and lose
  -- new source dates. The source/link uniqueness also protects retrying clients.
  perform 1 from private.uci_schedule_state where singleton for update;
  select payload into v_payload from private.uci_schedule_events where source_id=p_event_id for update;
  if not found then raise exception 'This event is no longer in the schedule. Refresh and try again.'; end if;
  select event_id into v_id from private.uci_schedule_calendar_links where source_id=p_event_id;
  if v_id is not null then return jsonb_build_object('event_id',v_id,'already_added',true,'sync_status','current'); end if;
  if v_payload->>'status'='cancelled' then raise exception 'A cancelled event cannot be added to Upcoming Events.'; end if;
  if nullif(v_payload->>'startDate','') is null or v_payload->>'dateStatus' not in('confirmed','calendar_dates','provisional') then
    raise exception 'The organiser has not announced dates yet. Keep this event on the watchlist.';
  end if;
  v_fields:=private.uci_schedule_calendar_fields(v_payload);
  -- Match conservative, exact normalized names and dates; never merge private
  -- runs or attendance. An ambiguous existing catalogue requires coach review.
  select count(*),(array_agg(m.id))[1] into v_match_count,v_id from private.uci_schedule_matching_events(v_payload) m;
  if v_match_count>1 then raise exception 'Matching events already exist. Merge those duplicates in Events & Runs first.'; end if;
  if v_id is not null then
    v_already:=true;
    select * into v_existing from public.dashboard_items where id=v_id for update;
    -- A pre-existing event has coach-authored fields. Keep those custom values
    -- outside the managed baseline so the first refresh cannot overwrite them.
  else
    insert into public.dashboard_items(owner_id,created_by,item_type,title,details,due_at,end_at,uci_schedule_date_only,uci_schedule_status)
    values(v_user,v_user,'event',v_fields->>'title',v_fields->>'details',(v_fields->>'due_at')::timestamptz,(v_fields->>'end_at')::timestamptz,true,v_payload->>'status')
    returning id into v_id;
  end if;
  insert into private.uci_schedule_calendar_links(source_id,event_id,added_by,managed_fields)
  values(p_event_id,v_id,v_user,v_fields)
  on conflict(source_id) do update set event_id=excluded.event_id,added_by=excluded.added_by,managed_fields=excluded.managed_fields,sync_conflicts='[]',synced_at=now();
  perform private.uci_schedule_sync_calendar(p_event_id);
  return jsonb_build_object('event_id',v_id,'already_added',v_already,'sync_status',case when v_already then 'existing_event' else 'current' end);
end $$;
create function public.add_uci_schedule_event(p_event_id text) returns jsonb language sql security invoker set search_path='' as $$ select private.add_uci_schedule_event(p_event_id); $$;

create function private.apply_uci_schedule_snapshot(p_snapshot jsonb,p_rankings jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_state private.uci_schedule_state; v_checked timestamptz; v_rank_checked timestamptz; v_event jsonb; v_clean jsonb; v_id text;
 v_announcement jsonb; v_existing private.uci_schedule_announcements; v_recipient record; v_count integer:=0; v_notices integer:=0;
 v_rank_rows jsonb; v_body text; v_deadlines text; v_category jsonb; v_normalized jsonb;
begin
  -- Only the private cron consumer or service-role RPC can invoke ingestion.
  select * into v_state from private.uci_schedule_state where singleton for update;
  if jsonb_typeof(p_snapshot) is distinct from 'object' or octet_length(p_snapshot::text)>2000000
    or p_snapshot->>'schemaVersion' is distinct from '1' or p_snapshot->>'year' is distinct from '2027'
    or jsonb_typeof(p_snapshot->'events') is distinct from 'array' or jsonb_array_length(p_snapshot->'events')>500
    or jsonb_typeof(p_snapshot->'announcements') is distinct from 'array' or jsonb_array_length(p_snapshot->'announcements')>100
    or jsonb_typeof(p_snapshot->'sourceChecks') is distinct from 'array' then raise exception 'Invalid UCI schedule snapshot.'; end if;
  select jsonb_object_agg(key,value) into v_normalized from jsonb_each(p_snapshot)
  where key=any(array['schemaVersion','year','checkedAt','lastSuccessfulCalendarCheckAt','events','qualification','announcements','sourceChecks','refreshStatus']);
  v_checked:=(p_snapshot->>'checkedAt')::timestamptz;
  if v_checked is null or v_checked>now()+interval '10 minutes' or v_checked<now()-interval '10 days' then raise exception 'UCI schedule snapshot is not current.'; end if;
  if v_state.checked_at is not null and v_checked<v_state.checked_at then raise exception 'Older UCI schedule snapshot rejected.'; end if;
  if v_state.checked_at=v_checked and (v_state.snapshot-'events') is distinct from (v_normalized-'events') then
    raise exception 'A changed schedule must have a new verification timestamp.';
  end if;
  if jsonb_typeof(p_rankings) is distinct from 'object' or octet_length(p_rankings::text)>2000000 or p_rankings->>'schemaVersion' is distinct from '1'
    or jsonb_typeof(p_rankings->'categories') is distinct from 'object' then raise exception 'Invalid UCI rankings snapshot.'; end if;
  v_rank_checked:=(p_rankings->>'checkedAt')::timestamptz;
  if v_rank_checked is null or v_rank_checked>now()+interval '10 minutes' or v_rank_checked<now()-interval '3 days' then raise exception 'UCI rankings snapshot is not current.'; end if;
  if nullif(v_state.rankings->>'checkedAt','') is not null and v_rank_checked<(v_state.rankings->>'checkedAt')::timestamptz then raise exception 'Older UCI rankings snapshot rejected.'; end if;
  foreach v_id in array array['men','women'] loop
    v_category:=p_rankings->'categories'->v_id;
    if jsonb_typeof(v_category->'rows') is distinct from 'array' or jsonb_array_length(v_category->'rows') not between 1 and 2000
      or nullif(v_category->>'rankingDate','') is null or (v_category->>'rankingDate')::date<current_date-30 or (v_category->>'rankingDate')::date>current_date+1
      or coalesce(v_category->>'sourceUrl','')!~'^https://dataride\.uci\.org/' then raise exception 'Invalid or outdated ranking category.'; end if;
    if exists(select 1 from jsonb_array_elements(v_category->'rows') r where coalesce(r->>'uciId','')!~'^[0-9]{11}$'
      or coalesce(r->>'points','')!~'^[0-9]+([.][0-9]+)?$' or (r->>'points')::numeric>1000000) then raise exception 'Invalid UCI ranking entry.'; end if;
  end loop;
  v_rank_rows:=(p_rankings->'categories'->'men'->'rows')||(p_rankings->'categories'->'women'->'rows');
  if (select count(*) from jsonb_array_elements(p_snapshot->'events'))<>(select count(distinct e->>'id') from jsonb_array_elements(p_snapshot->'events') e) then raise exception 'Duplicate schedule source IDs.'; end if;
  for v_event in select value from jsonb_array_elements(p_snapshot->'events') loop
    v_id:=v_event->>'id';
    if coalesce(v_id,'')!~'^[a-zA-Z0-9][a-zA-Z0-9:_-]{2,119}$' or char_length(coalesce(v_event->>'name','')) not between 3 and 140
      or coalesce(v_event->>'status','') not in('confirmed','provisional','cancelled','review_required')
      or coalesce(v_event->>'dateStatus','') not in('confirmed','calendar_dates','provisional','pending','unconfirmed')
      or jsonb_typeof(v_event->'sources') is distinct from 'array' or jsonb_array_length(v_event->'sources')<1
      or jsonb_typeof(v_event->'categories') is distinct from 'array' then raise exception 'Invalid UCI event metadata.'; end if;
    if nullif(v_event->>'startDate','') is not null and ((v_event->>'startDate')!~'^2027-[0-9]{2}-[0-9]{2}$' or (v_event->>'startDate')::date>date '2027-12-31') then raise exception 'Invalid 2027 event date.'; end if;
    if nullif(v_event->>'endDate','') is not null and ((v_event->>'endDate')::date<(v_event->>'startDate')::date or (v_event->>'endDate')::date>date '2028-01-15') then raise exception 'Invalid event finish date.'; end if;
    if exists(select 1 from jsonb_array_elements(v_event->'sources') s where coalesce(s->>'url','')!~'^https://[^/[:space:]]+/') then raise exception 'Event sources require HTTPS URLs.'; end if;
    -- Keep the public contract small: arbitrary public-feed keys do not become
    -- calendar instructions, permission data, or notification fields.
    select jsonb_object_agg(key,value) into v_clean from jsonb_each(v_event)
    where key=any(array['id','name','startDate','endDate','venue','countryCode','country','classification','status','dateStatus',
      'classificationStatus','eligibilityStatus','eligibleNationalities','categories','eligibilityNote','registration','rankingPoints',
      'olympicQualification','sources','sourceUrl','lastCheckedAt','checkedAt','changes','priority','notes',
      'dateNote','reviewNote','lastVerifiedAt','listingMissingSince','aliases','matchUciName','discipline','uciId','sourceTitle']);
    if v_state.checked_at=v_checked and exists(select 1 from private.uci_schedule_events where source_id=v_id and payload is distinct from v_clean) then
      raise exception 'Changed event requires a new verification timestamp.';
    end if;
    insert into private.uci_schedule_events(source_id,payload,checked_at) values(v_id,v_clean,v_checked)
    on conflict(source_id) do update set payload=excluded.payload,checked_at=excluded.checked_at,updated_at=now()
    where private.uci_schedule_events.payload is distinct from excluded.payload or private.uci_schedule_events.checked_at<excluded.checked_at;
    perform private.uci_schedule_sync_calendar(v_id); v_count:=v_count+1;
  end loop;
  -- Disappearance from an upstream feed is not evidence of cancellation. Keep
  -- old events and their attendance, courses and private runs until verified.
  for v_announcement in select value from jsonb_array_elements(p_snapshot->'announcements') loop
    v_id:=v_announcement->>'id';
    if coalesce(v_id,'')!~'^[a-zA-Z0-9][a-zA-Z0-9:_-]{2,119}$'
      or char_length(coalesce(v_announcement->>'title','')) not between 3 and 160
      or char_length(coalesce(v_announcement->>'summary','')) not between 3 and 1200
      or coalesce(v_announcement->>'sourceUrl','')!~'^https://([a-zA-Z0-9-]+\.)*(uci\.org|olympics\.com|olympic\.org|la28\.org)/'
      or octet_length(coalesce(v_announcement->>'sourceUrl',''))>1000
      or nullif(v_announcement->>'verifiedAt','') is null or (v_announcement->>'verifiedAt')::timestamptz>v_checked+interval '10 minutes'
      or nullif(v_announcement->>'publishedAt','') is null or (v_announcement->>'publishedAt')::timestamptz>v_checked+interval '10 minutes'
      then raise exception 'Qualification announcements require verified official evidence.'; end if;
    select jsonb_object_agg(key,value) into v_clean from jsonb_each(v_announcement) where key=any(array['id','title','summary','impactGermany','impactAustralia','deadlines','sourceUrl','publishedAt','verifiedAt','significant','notify']);
    select * into v_existing from private.uci_schedule_announcements where source_id=v_id;
    if found then
      if (v_existing.payload-'verifiedAt') is distinct from (v_clean-'verifiedAt') then raise exception 'Changed announcements require a new revision ID.'; end if;
      continue;
    end if;
    insert into private.uci_schedule_announcements(source_id,payload,baseline) values(v_id,v_clean,v_state.checked_at is null or coalesce(v_clean->>'notify','false')<>'true');
    if v_state.checked_at is null or v_clean->>'notify' is distinct from 'true' or v_clean->>'significant' is distinct from 'true' then continue; end if;
    for v_recipient in
      select p.id,p.country_code,p.role::text as role from public.profiles p
      where (exists(select 1 from private.uci_schedule_subscribers s where s.coach_id=p.id and s.enabled and p.role::text in('coach','admin'))
        or (p.role::text='athlete' and exists(select 1 from public.coach_athletes ca join public.profiles coach on coach.id=ca.coach_id and coach.role::text in('coach','admin') where ca.athlete_id=p.id)
          and exists(select 1 from jsonb_array_elements(v_rank_rows) r where r->>'uciId'=p.uci_id and (r->>'points')::numeric>0)))
        and not private.rider_recovery_active(p.id)
        and not exists(select 1 from private.rider_feature_access a where a.athlete_id=p.id and a.features_disabled)
    loop
      insert into private.uci_schedule_notice_receipts(announcement_id,recipient_id) values(v_id,v_recipient.id) on conflict do nothing;
      if not found then continue; end if;
      v_deadlines:=case when jsonb_typeof(v_clean->'deadlines')='array' then
        (select string_agg(concat_ws(' ',nullif(d->>'date',''),nullif(d->>'label','')),'; ') from jsonb_array_elements(v_clean->'deadlines') d)
        else nullif(v_clean->>'deadlines','') end;
      -- Web Push has a small byte budget. Keep a readable brief with deadlines
      -- before country impacts; the schedule retains the complete announcement.
      -- Do not duplicate the full editorial text in the worker's JSON payload.
      v_body:=concat_ws(' ',left(v_clean->>'summary',180),left(v_deadlines,100),
        case when v_recipient.role in('coach','admin') then concat_ws(' ',left(v_clean->>'impactGermany',100),left(v_clean->>'impactAustralia',100))
        when v_recipient.country_code in('DE','GER') then left(v_clean->>'impactGermany',200)
        when v_recipient.country_code in('AU','AUS') then left(v_clean->>'impactAustralia',200)
        else concat_ws(' ',left(v_clean->>'impactGermany',100),left(v_clean->>'impactAustralia',100)) end);
      while octet_length(v_body)>1800 loop v_body:=left(v_body,char_length(v_body)-10); end loop;
      perform private.emit_jkcrew_notification(v_recipient.id,'uci_qualification_update',left(v_clean->>'title',80),v_body,'uciSchedule',
        jsonb_build_object('announcement_id',v_id,'source_url',v_clean->>'sourceUrl'),
        'uci-qualification:'||v_id||':'||v_recipient.id::text,'event');
      v_notices:=v_notices+1;
    end loop;
  end loop;
  update private.uci_schedule_state set snapshot=v_normalized,rankings=p_rankings,checked_at=v_checked,ingested_at=now(),
    last_polled_at=now(),refresh_status='current',refresh_error='',schedule_request_id=null,rankings_request_id=null,retry_at=null,attempts=0 where singleton;
  return jsonb_build_object('events',v_count,'notifications',v_notices,'checkedAt',v_checked);
end $$;
create function public.apply_uci_schedule_snapshot(p_snapshot jsonb,p_rankings jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select private.apply_uci_schedule_snapshot(p_snapshot,p_rankings); $$;

-- No secret, billable provider or external callback URL is needed. Responses are
-- validated before a single transaction updates catalogue + linked calendar.
create function private.request_uci_schedule_refresh(p_retry boolean default false)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_state private.uci_schedule_state; v_schedule bigint; v_rankings bigint;
begin
 select * into v_state from private.uci_schedule_state where singleton for update;
 if v_state.schedule_request_id is not null then return false; end if;
 if p_retry and (v_state.retry_at is null or v_state.retry_at>now() or v_state.attempts>=4) then return false; end if;
 select net.http_get(url:='https://raw.githubusercontent.com/JKCoachingAU/jkcrew-app-site/uci-schedule/schedule.json',timeout_milliseconds:=20000) into v_schedule;
 select net.http_get(url:='https://raw.githubusercontent.com/JKCoachingAU/jkcrew-app-site/uci-rankings/rankings.json',timeout_milliseconds:=20000) into v_rankings;
 update private.uci_schedule_state set schedule_request_id=v_schedule,rankings_request_id=v_rankings,requested_at=now(),retry_at=null,
   attempts=case when p_retry then attempts+1 else 1 end,refresh_status=case when p_retry then 'retrying' else 'pending' end,refresh_error='' where singleton;
 return true;
end $$;

create function private.consume_uci_schedule_refresh()
returns void language plpgsql security definer set search_path='' as $$
declare v_state private.uci_schedule_state; v_schedule net._http_response; v_rankings net._http_response; v_error text;
begin
 select * into v_state from private.uci_schedule_state where singleton for update;
 if v_state.schedule_request_id is null then
   if v_state.retry_at<=now() then perform private.request_uci_schedule_refresh(true); end if;
   return;
 end if;
 select * into v_schedule from net._http_response where id=v_state.schedule_request_id;
 select * into v_rankings from net._http_response where id=v_state.rankings_request_id;
 if (v_schedule.id is null or v_rankings.id is null) and v_state.requested_at>now()-interval '5 minutes' then return; end if;
 begin
   if v_schedule.id is null or v_rankings.id is null then raise exception 'UCI refresh timed out. The previous verified schedule remains available.'; end if;
   if v_schedule.status_code<>200 or v_rankings.status_code<>200 or coalesce(v_schedule.timed_out,false) or coalesce(v_rankings.timed_out,false)
     or nullif(v_schedule.error_msg,'') is not null or nullif(v_rankings.error_msg,'') is not null then raise exception 'The schedule or rankings source is unavailable. Retrying safely.'; end if;
   if octet_length(v_schedule.content)>2000000 or octet_length(v_rankings.content)>2000000 then raise exception 'The published source exceeded the allowed size.'; end if;
   perform private.apply_uci_schedule_snapshot(v_schedule.content::jsonb,v_rankings.content::jsonb);
 exception when others then
   v_error:=case when sqlstate in('22P02','22007','22008') then 'The published source has invalid data. The previous verified schedule is retained.' else left(sqlerrm,240) end;
   update private.uci_schedule_state set schedule_request_id=null,rankings_request_id=null,refresh_status=case when attempts<4 then 'retrying' else 'failed' end,
     refresh_error=v_error,retry_at=case when attempts<4 then now()+interval '15 minutes'*attempts else null end where singleton;
 end;
end $$;

-- Private security-definer implementations have no PUBLIC defaults. Only their
-- narrow public invoker wrappers are callable, and ingestion is service-only.
revoke all on function private.uci_schedule_require_access(boolean),private.uci_schedule_calendar_fields(jsonb),private.uci_schedule_matching_events(jsonb),
 private.uci_schedule_sync_calendar(text),private.get_uci_2027_schedule(),private.subscribe_uci_schedule_updates(boolean),
 private.add_uci_schedule_event(text),private.apply_uci_schedule_snapshot(jsonb,jsonb),private.request_uci_schedule_refresh(boolean),
 private.consume_uci_schedule_refresh() from public,anon,authenticated;
revoke all on function public.get_uci_2027_schedule(),public.subscribe_uci_schedule_updates(boolean),public.add_uci_schedule_event(text),
 public.apply_uci_schedule_snapshot(jsonb,jsonb) from public,anon,authenticated;
grant usage on schema private to authenticated,service_role;
grant execute on function private.get_uci_2027_schedule(),private.subscribe_uci_schedule_updates(boolean),private.add_uci_schedule_event(text),
 public.get_uci_2027_schedule(),public.subscribe_uci_schedule_updates(boolean),public.add_uci_schedule_event(text) to authenticated;
grant execute on function private.apply_uci_schedule_snapshot(jsonb,jsonb),public.apply_uci_schedule_snapshot(jsonb,jsonb) to service_role;

select cron.schedule('jkcrew-uci-schedule-weekly','30 0 * * 1','select private.request_uci_schedule_refresh();');
select cron.schedule('jkcrew-uci-schedule-consume','* * * * *','select private.consume_uci_schedule_refresh();');
notify pgrst,'reload schema';
