-- Coaches can atomically merge duplicate shared events. Attendance is unioned,
-- private run plans are relinked, and the removed event is archived privately.
create table if not exists private.event_merge_audit (
  id uuid primary key default gen_random_uuid(),
  merged_by uuid not null,
  source_event_id uuid not null,
  target_event_id uuid not null,
  source_event jsonb not null,
  target_event_before jsonb not null,
  source_attendees jsonb not null default '[]'::jsonb,
  source_run_plan_ids jsonb not null default '[]'::jsonb,
  merged_at timestamptz not null default now()
);

revoke all on private.event_merge_audit from public, anon, authenticated;

create or replace function private.merge_contest_events_internal(
  p_source_event_id uuid,
  p_target_event_id uuid,
  p_title text,
  p_details text,
  p_due_at timestamptz,
  p_end_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_role text;
  v_source public.dashboard_items;
  v_target public.dashboard_items;
begin
  if v_user_id is null then raise exception 'You must be signed in'; end if;
  if p_source_event_id is null or p_target_event_id is null or p_source_event_id = p_target_event_id then
    raise exception 'Choose two different events to merge';
  end if;

  select profile.role into v_role from public.profiles profile where profile.id = v_user_id;
  if v_role not in ('coach', 'admin') then raise exception 'Only coaches can merge events'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 3 and 120 then raise exception 'Event name must be 3 to 120 characters'; end if;
  if char_length(coalesce(p_details, '')) > 180 then raise exception 'Event details must be 180 characters or less'; end if;
  if p_due_at is null then raise exception 'Add the event start date'; end if;
  if p_end_at is not null and p_end_at < p_due_at then raise exception 'The event finish must be after it starts'; end if;

  perform 1
  from public.dashboard_items event
  where event.id = any(array[p_source_event_id, p_target_event_id])
  order by event.id
  for update;

  select event.* into v_source from public.dashboard_items event where event.id = p_source_event_id;
  select event.* into v_target from public.dashboard_items event where event.id = p_target_event_id;
  if v_source.id is null or v_target.id is null then raise exception 'One of those events no longer exists'; end if;
  if v_source.item_type <> 'event' or v_target.item_type <> 'event' then raise exception 'Only events can be merged'; end if;
  if v_source.completed or v_target.completed then raise exception 'Completed events cannot be merged'; end if;

  if v_role <> 'admin' and (
    not exists (select 1 from public.coach_athletes link where link.coach_id = v_user_id and link.athlete_id = v_source.owner_id)
    or not exists (select 1 from public.coach_athletes link where link.coach_id = v_user_id and link.athlete_id = v_target.owner_id)
  ) then raise exception 'You can only merge events belonging to riders in your crew'; end if;

  insert into private.event_merge_audit (
    merged_by, source_event_id, target_event_id, source_event, target_event_before,
    source_attendees, source_run_plan_ids
  ) values (
    v_user_id,
    v_source.id,
    v_target.id,
    to_jsonb(v_source),
    to_jsonb(v_target),
    coalesce((select jsonb_agg(to_jsonb(attendee)) from public.event_attendees attendee where attendee.event_id = v_source.id), '[]'::jsonb),
    coalesce((select jsonb_agg(plan.id) from public.run_plans plan where plan.contest_item_id = v_source.id), '[]'::jsonb)
  );

  insert into public.event_attendees (event_id, athlete_id, created_at)
  select v_target.id, attendee.athlete_id, attendee.created_at
  from public.event_attendees attendee
  where attendee.event_id = v_source.id
  on conflict (event_id, athlete_id) do nothing;

  update public.run_plans plan
  set contest_item_id = v_target.id, updated_at = now()
  where plan.contest_item_id = v_source.id;

  delete from public.dashboard_items event where event.id = v_source.id;

  update public.dashboard_items event
  set title = btrim(p_title), details = btrim(coalesce(p_details, '')),
      due_at = p_due_at, end_at = p_end_at, updated_at = now()
  where event.id = v_target.id;

  return v_target.id;
end;
$function$;

create or replace function public.merge_contest_events(
  p_source_event_id uuid,
  p_target_event_id uuid,
  p_title text,
  p_details text,
  p_due_at timestamptz,
  p_end_at timestamptz default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $function$
  select private.merge_contest_events_internal(
    p_source_event_id, p_target_event_id, p_title, p_details, p_due_at, p_end_at
  );
$function$;

grant usage on schema private to authenticated;
revoke all on function private.merge_contest_events_internal(uuid,uuid,text,text,timestamptz,timestamptz) from public, anon;
grant execute on function private.merge_contest_events_internal(uuid,uuid,text,text,timestamptz,timestamptz) to authenticated;
revoke all on function public.merge_contest_events(uuid,uuid,text,text,timestamptz,timestamptz) from public, anon;
grant execute on function public.merge_contest_events(uuid,uuid,text,text,timestamptz,timestamptz) to authenticated;

notify pgrst, 'reload schema';
