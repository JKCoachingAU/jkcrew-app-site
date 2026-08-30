-- Linked parents receive the same shared event course image their child sees.
-- This is SELECT-only and does not expose run_plans or permit photo changes.
drop policy if exists "Riders and coaches can view active event courses" on public.event_course_photos;
create policy "Crew and linked parents can view active event courses"
  on public.event_course_photos
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles profile
      where profile.id = (select auth.uid())
        and (
          profile.role in ('athlete', 'coach', 'admin')
          or (
            profile.role = 'parent'
            and exists (
              select 1
              from public.parent_athletes link
              where link.parent_id = (select auth.uid())
            )
          )
        )
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

