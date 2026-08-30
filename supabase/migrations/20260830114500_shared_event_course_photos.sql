-- One shared course image can be attached to an active event. It is deliberately
-- separate from private run_plans so riders never gain access to another rider's
-- route, tricks, notes, or private run-planner image.
create table if not exists public.event_course_photos (
  event_id uuid primary key references public.dashboard_items(id) on delete cascade,
  image_data_url text not null,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint event_course_photos_image_check check (
    image_data_url like 'data:image/%'
    and char_length(image_data_url) between 32 and 8000000
  )
);

alter table public.event_course_photos enable row level security;

revoke all on public.event_course_photos from anon, authenticated;
grant select, insert, update, delete on public.event_course_photos to authenticated;

drop policy if exists "Riders and coaches can view active event courses" on public.event_course_photos;
create policy "Riders and coaches can view active event courses"
  on public.event_course_photos
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles profile
      where profile.id = (select auth.uid())
        and profile.role in ('athlete', 'coach', 'admin')
    )
    and exists (
      select 1
      from public.dashboard_items event
      where event.id = event_course_photos.event_id
        and event.item_type = 'event'
        and event.completed = false
        and coalesce(event.end_at, event.due_at + interval '1 day', 'infinity'::timestamptz) >= now()
    )
  );

drop policy if exists "Coaches can add active event courses" on public.event_course_photos;
create policy "Coaches can add active event courses"
  on public.event_course_photos
  for insert
  to authenticated
  with check (
    updated_by = (select auth.uid())
    and exists (
      select 1 from public.profiles profile
      where profile.id = (select auth.uid()) and profile.role in ('coach', 'admin')
    )
    and exists (
      select 1 from public.dashboard_items event
      where event.id = event_course_photos.event_id
        and event.item_type = 'event'
        and event.completed = false
        and coalesce(event.end_at, event.due_at + interval '1 day', 'infinity'::timestamptz) >= now()
    )
  );

drop policy if exists "Coaches can update active event courses" on public.event_course_photos;
create policy "Coaches can update active event courses"
  on public.event_course_photos
  for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles profile
      where profile.id = (select auth.uid()) and profile.role in ('coach', 'admin')
    )
  )
  with check (
    updated_by = (select auth.uid())
    and exists (
      select 1 from public.profiles profile
      where profile.id = (select auth.uid()) and profile.role in ('coach', 'admin')
    )
    and exists (
      select 1 from public.dashboard_items event
      where event.id = event_course_photos.event_id
        and event.item_type = 'event'
        and event.completed = false
        and coalesce(event.end_at, event.due_at + interval '1 day', 'infinity'::timestamptz) >= now()
    )
  );

drop policy if exists "Coaches can delete event courses" on public.event_course_photos;
create policy "Coaches can delete event courses"
  on public.event_course_photos
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles profile
      where profile.id = (select auth.uid()) and profile.role in ('coach', 'admin')
    )
  );

-- Keep the source course photo recoverable and carry it to the retained event
-- when that retained event does not already have its own image.
alter table private.event_merge_audit
  add column if not exists source_course_photo jsonb,
  add column if not exists target_course_photo_before jsonb;

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
    source_attendees, source_run_plan_ids, source_course_photo, target_course_photo_before
  ) values (
    v_user_id,
    v_source.id,
    v_target.id,
    to_jsonb(v_source),
    to_jsonb(v_target),
    coalesce((select jsonb_agg(to_jsonb(attendee)) from public.event_attendees attendee where attendee.event_id = v_source.id), '[]'::jsonb),
    coalesce((select jsonb_agg(plan.id) from public.run_plans plan where plan.contest_item_id = v_source.id), '[]'::jsonb),
    (select to_jsonb(photo) from public.event_course_photos photo where photo.event_id = v_source.id),
    (select to_jsonb(photo) from public.event_course_photos photo where photo.event_id = v_target.id)
  );

  insert into public.event_attendees (event_id, athlete_id, created_at)
  select v_target.id, attendee.athlete_id, attendee.created_at
  from public.event_attendees attendee
  where attendee.event_id = v_source.id
  on conflict (event_id, athlete_id) do nothing;

  update public.run_plans plan
  set contest_item_id = v_target.id, updated_at = now()
  where plan.contest_item_id = v_source.id;

  insert into public.event_course_photos (event_id, image_data_url, updated_by, updated_at)
  select v_target.id, photo.image_data_url, photo.updated_by, photo.updated_at
  from public.event_course_photos photo
  where photo.event_id = v_source.id
  on conflict (event_id) do nothing;

  delete from public.dashboard_items event where event.id = v_source.id;

  update public.dashboard_items event
  set title = btrim(p_title), details = btrim(coalesce(p_details, '')),
      due_at = p_due_at, end_at = p_end_at, updated_at = now()
  where event.id = v_target.id;

  return v_target.id;
end;
$function$;

notify pgrst, 'reload schema';
