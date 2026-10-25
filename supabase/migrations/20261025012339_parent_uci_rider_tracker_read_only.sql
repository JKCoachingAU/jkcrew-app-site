-- Linked parents can read competition plans and results, but cannot create,
-- edit, review or verify them. Existing rider/coach RPC permissions stay intact.
create function private.uci_parent_tracker_riders(p_rider_id uuid default null)
returns uuid[] language plpgsql stable security definer set search_path='' as $$
declare
 v_user uuid := auth.uid();
 v_ids uuid[];
begin
 if v_user is null
   or coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
   or not exists(select 1 from public.profiles p where p.id=v_user and p.role::text='parent') then
   raise exception 'Sign in as a linked parent to view this tracker.' using errcode='42501';
 end if;
 if private.rider_recovery_active(v_user)
   or exists(select 1 from private.rider_feature_access a where a.athlete_id=v_user and a.features_disabled) then
   raise exception 'This feature is not available for this account. Contact your coach.' using errcode='42501';
 end if;

 -- Read current links and access state on every request. A parent link never
 -- bypasses the child's recovery-only mode or disabled training features.
 select coalesce(array_agg(p.id),'{}'::uuid[]) into v_ids
 from public.profiles p
 where p.role::text='athlete'
   and (p_rider_id is null or p.id=p_rider_id)
   and exists(select 1 from public.parent_athletes link where link.parent_id=v_user and link.athlete_id=p.id)
   and not private.rider_recovery_active(p.id)
   and not exists(select 1 from private.rider_feature_access a where a.athlete_id=p.id and a.features_disabled);

 if p_rider_id is not null and not (p_rider_id=any(v_ids)) then
   raise exception 'This rider''s tracker is not available to your account.' using errcode='42501';
 end if;
 return v_ids;
end $$;

create function private.get_parent_uci_rider_tracker(p_rider_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 v_ids uuid[] := private.uci_parent_tracker_riders(p_rider_id);
 v_events jsonb;
begin

 -- The shared upcoming event catalogue supports family planning. Historical
 -- events are limited to the selected children's records; no run plans/media.
 select coalesce(jsonb_agg(e.payload order by e.payload->>'due_at' desc nulls last,e.payload->>'title'),'[]') into v_events
 from (
   select d.id,jsonb_build_object('id',d.id,'title',left(d.title,140),'details',left(d.details,300),
     'due_at',d.due_at,'end_at',d.end_at,'completed',d.completed,
     'uci_schedule_date_only',d.uci_schedule_date_only,'uci_schedule_status',d.uci_schedule_status,'unavailable',false) payload
   from public.dashboard_items d
   where d.item_type='event' and cardinality(v_ids)>0
     and ((not d.completed and coalesce(d.end_at,d.due_at+interval '1 day','infinity'::timestamptz)>=now())
       or exists(select 1 from private.uci_rider_records r where r.rider_id=any(v_ids) and r.event_id=d.id))
   union all
   select archived.event_id,archived.event_snapshot||jsonb_build_object('unavailable',true)
   from (
     select distinct on(r.event_id) r.event_id,r.event_snapshot
     from private.uci_rider_records r
     where r.rider_id=any(v_ids)
       and not exists(select 1 from public.dashboard_items d where d.id=r.event_id and d.item_type='event')
     order by r.event_id,r.updated_at desc,r.id
   ) archived
 ) e;

 return jsonb_build_object(
   'canManage',false,'readOnly',true,
   'riders',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'display_name',p.display_name,'uci_id',p.uci_id) order by p.display_name,p.id)
     from public.profiles p where p.id=any(v_ids)),'[]'),
   'events',v_events,
   'entries',coalesce((select jsonb_agg(private.uci_tracker_record_json(r) order by r.updated_at desc,r.id)
     from private.uci_rider_records r where r.rider_id=any(v_ids) and r.kind='entry'),'[]'),
   'results',coalesce((select jsonb_agg(private.uci_tracker_record_json(r) order by r.payload->>'event_date' desc,r.id)
     from private.uci_rider_records r where r.rider_id=any(v_ids) and r.kind='result'),'[]'));
end $$;

create function public.get_parent_uci_rider_tracker(p_rider_id uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$
 select private.get_parent_uci_rider_tracker(p_rider_id);
$$;

-- A separate parent reader keeps the established rider/coach gate and every
-- mutating schedule RPC unchanged. Only published schedule metadata is exposed.
create function private.get_parent_uci_2027_schedule()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 v_ids uuid[] := private.uci_parent_tracker_riders();
 v_state record;
 v_events jsonb;
begin
 if cardinality(v_ids)=0 then
   raise exception 'Link an eligible rider to view the UCI schedule.' using errcode='42501';
 end if;
 select * into v_state from private.uci_schedule_state where singleton;
 select coalesce(jsonb_agg(e.payload||jsonb_build_object(
   'existingEventId',l.event_id,'alreadyAdded',l.event_id is not null)
   order by e.payload->>'startDate' nulls last,e.payload->>'name'),'[]'::jsonb)
 into v_events from private.uci_schedule_events e
 left join private.uci_schedule_calendar_links l on l.source_id=e.source_id;
 return (v_state.snapshot-'events'-'rankings'-'reviewCandidates')||jsonb_build_object(
   'schemaVersion',1,'year',2027,'events',v_events,'checkedAt',v_state.checked_at,
   'announcements',coalesce((select jsonb_agg(payload order by payload->>'publishedAt' desc,source_id)
     from private.uci_schedule_announcements),'[]'::jsonb),
   'refreshStatus',case when v_state.refresh_status in('failed','pending','retrying') then v_state.refresh_status
     else coalesce(v_state.snapshot->>'refreshStatus',v_state.refresh_status) end,
   'refreshError',v_state.refresh_error,'lastSyncedAt',v_state.ingested_at,'lastPolledAt',v_state.last_polled_at,
   'weeklyRefresh','Monday 00:30 UTC','canManage',false,'readOnly',true,'notificationsEnabled',false);
end $$;

create function public.get_parent_uci_2027_schedule()
returns jsonb language sql stable security invoker set search_path='' as $$
 select private.get_parent_uci_2027_schedule();
$$;

revoke all on function private.uci_parent_tracker_riders(uuid) from public,anon,authenticated;
revoke all on function private.get_parent_uci_rider_tracker(uuid),public.get_parent_uci_rider_tracker(uuid)
 from public,anon,authenticated;
revoke all on function private.get_parent_uci_2027_schedule(),public.get_parent_uci_2027_schedule()
 from public,anon,authenticated;
grant usage on schema private to authenticated;
grant execute on function private.get_parent_uci_rider_tracker(uuid),public.get_parent_uci_rider_tracker(uuid) to authenticated;
grant execute on function private.get_parent_uci_2027_schedule(),public.get_parent_uci_2027_schedule() to authenticated;

comment on function public.get_parent_uci_rider_tracker(uuid) is
 'Read-only competition tracker for currently linked, unrestricted athlete children. No parent write or review authority.';
comment on function public.get_parent_uci_2027_schedule() is
 'Read-only official schedule for parents with current eligible athlete links. No parent calendar or subscription write authority.';
