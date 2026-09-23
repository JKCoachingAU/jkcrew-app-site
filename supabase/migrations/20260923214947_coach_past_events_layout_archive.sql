-- Shared event/course rows already survive their finish date and completed flag.
-- Keep those originals as the archive: no image copies, private run reads, or cron.
-- Extend only shared SELECT access; existing task and write permissions remain.
drop policy if exists "Active events are visible to authenticated crew" on public.dashboard_items;
create policy "Shared event catalogue visibility"
  on public.dashboard_items for select to authenticated
  using (
    item_type = 'event'
    and (
      (completed = false and coalesce(end_at, due_at + interval '1 day', 'infinity'::timestamptz) >= now())
      or exists (
        select 1 from public.profiles profile
        where profile.id = (select auth.uid()) and profile.role in ('coach', 'admin')
      )
    )
  );

drop policy if exists "Crew and linked parents can view active event courses" on public.event_course_photos;
create policy "Shared event courses visibility"
  on public.event_course_photos for select to authenticated
  using (
    exists (
      select 1 from public.profiles profile
      where profile.id = (select auth.uid())
        and (
          profile.role in ('athlete', 'coach', 'admin')
          or (profile.role = 'parent' and exists (
            select 1 from public.parent_athletes link
            where link.parent_id = (select auth.uid())
          ))
        )
    )
    and exists (
      select 1 from public.dashboard_items event
      where event.id = event_course_photos.event_id and event.item_type = 'event'
        and (
          (event.completed = false and coalesce(event.end_at, event.due_at + interval '1 day', 'infinity'::timestamptz) >= now())
          or exists (
            select 1 from public.profiles profile
            where profile.id = (select auth.uid()) and profile.role in ('coach', 'admin')
          )
        )
    )
  );

-- Metadata only. Download an image through the existing single-course lookup
-- only after the coach opens that layout. A text search is literal, not a LIKE
-- wildcard, and every page has a bounded size and deterministic ordering.
create or replace function public.get_past_contest_events(
  p_search text default '',
  p_limit integer default 24,
  p_offset integer default 0
)
returns table (
  id uuid,
  title text,
  details text,
  due_at timestamptz,
  end_at timestamptz,
  completed boolean,
  effective_finished_at timestamptz,
  course_photo_available boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.profiles profile
    where profile.id = (select auth.uid()) and profile.role in ('coach', 'admin')
  ) then
    raise exception 'Only coaches can view past events.' using errcode = '42501';
  end if;

  return query
  select event.id, event.title, event.details, event.due_at, event.end_at, event.completed,
    case when event.completed then
      least(coalesce(event.end_at, event.due_at + interval '1 day', event.updated_at), event.updated_at)
    else coalesce(event.end_at, event.due_at + interval '1 day') end as effective_finished_at,
    exists (select 1 from public.event_course_photos photo where photo.event_id = event.id) as course_photo_available
  from public.dashboard_items event
  where event.item_type = 'event'
    and (event.completed or coalesce(event.end_at, event.due_at + interval '1 day', 'infinity'::timestamptz) < now())
    and strpos(lower(concat_ws(' ', event.title, event.details)), lower(btrim(left(coalesce(p_search, ''), 120)))) > 0
  order by effective_finished_at desc nulls last, event.id desc
  limit least(50, greatest(1, coalesce(p_limit, 24)))
  offset greatest(0, coalesce(p_offset, 0));
end;
$function$;

revoke all on function public.get_past_contest_events(text,integer,integer) from public, anon;
grant execute on function public.get_past_contest_events(text,integer,integer) to authenticated;

notify pgrst, 'reload schema';
