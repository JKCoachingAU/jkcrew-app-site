-- Let a coach atomically manage their own attendance and the riders linked to
-- them, while keeping direct rider attendance changes restricted by RLS.
create table if not exists private.event_attendance_audit (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  changed_by uuid not null,
  previous_attendee_ids uuid[] not null default '{}',
  requested_attendee_ids uuid[] not null default '{}',
  changed_at timestamptz not null default now()
);

revoke all on private.event_attendance_audit from public, anon, authenticated;

create or replace function public.coach_replace_event_attendance(
  p_event_id uuid,
  p_attendee_ids uuid[] default '{}'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_role text;
  v_attendee_ids uuid[];
begin
  if v_user_id is null then
    raise exception 'You must be signed in';
  end if;

  select profile.role
  into v_role
  from public.profiles profile
  where profile.id = v_user_id;

  if v_role not in ('coach', 'admin') then
    raise exception 'Only coaches can manage event attendance';
  end if;

  perform 1
  from public.dashboard_items event
  where event.id = p_event_id
    and event.item_type = 'event'
    and event.completed = false
    and coalesce(event.end_at, event.due_at + interval '1 day', 'infinity'::timestamptz) >= now()
  for update;

  if not found then
    raise exception 'That upcoming event no longer exists';
  end if;

  select coalesce(array_agg(requested.id order by requested.id), '{}'::uuid[])
  into v_attendee_ids
  from (
    select distinct attendee_id as id
    from unnest(coalesce(p_attendee_ids, '{}'::uuid[])) attendee_id
    where attendee_id is not null
  ) requested;

  if exists (
    select 1
    from unnest(v_attendee_ids) requested_id
    where not exists (
      select 1
      from public.profiles profile
      where profile.id = requested_id
    )
  ) then
    raise exception 'One of the selected people no longer exists';
  end if;

  if v_role <> 'admin' and exists (
    select 1
    from unnest(v_attendee_ids) requested_id
    where requested_id <> v_user_id
      and not exists (
        select 1
        from public.coach_athletes link
        where link.coach_id = v_user_id
          and link.athlete_id = requested_id
      )
  ) then
    raise exception 'You can only manage riders in your crew';
  end if;

  insert into private.event_attendance_audit (
    event_id,
    changed_by,
    previous_attendee_ids,
    requested_attendee_ids
  ) values (
    p_event_id,
    v_user_id,
    coalesce((
      select array_agg(attendee.athlete_id order by attendee.athlete_id)
      from public.event_attendees attendee
      where attendee.event_id = p_event_id
    ), '{}'::uuid[]),
    v_attendee_ids
  );

  if v_role = 'admin' then
    delete from public.event_attendees attendee
    where attendee.event_id = p_event_id;
  else
    delete from public.event_attendees attendee
    where attendee.event_id = p_event_id
      and (
        attendee.athlete_id = v_user_id
        or exists (
          select 1
          from public.coach_athletes link
          where link.coach_id = v_user_id
            and link.athlete_id = attendee.athlete_id
        )
      );
  end if;

  insert into public.event_attendees (event_id, athlete_id)
  select p_event_id, requested_id
  from unnest(v_attendee_ids) requested_id
  on conflict (event_id, athlete_id) do nothing;

  return cardinality(v_attendee_ids);
end;
$function$;

revoke all on function public.coach_replace_event_attendance(uuid, uuid[]) from public, anon;
grant execute on function public.coach_replace_event_attendance(uuid, uuid[]) to authenticated;

notify pgrst, 'reload schema';
