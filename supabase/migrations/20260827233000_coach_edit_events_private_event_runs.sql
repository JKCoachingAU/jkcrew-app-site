-- Coaches can correct shared event details without taking ownership away from
-- the rider who created the event. Every edit is recoverable from a private
-- audit row, and run plans remain limited to the rider and their linked coach.

create table if not exists private.event_edit_audit (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  changed_by uuid not null,
  event_before jsonb not null,
  event_after jsonb not null,
  changed_at timestamptz not null default now()
);

revoke all on private.event_edit_audit from public, anon, authenticated;

create or replace function private.coach_update_contest_event_internal(
  p_event_id uuid,
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
  v_event public.dashboard_items;
  v_updated public.dashboard_items;
begin
  if v_user_id is null then raise exception 'You must be signed in'; end if;
  if p_event_id is null then raise exception 'Choose an event to edit'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 3 and 120 then raise exception 'Event name must be 3 to 120 characters'; end if;
  if char_length(coalesce(p_details, '')) > 180 then raise exception 'Event details must be 180 characters or less'; end if;
  if p_due_at is null then raise exception 'Add the event start date'; end if;
  if p_end_at is not null and p_end_at < p_due_at then raise exception 'The event finish must be after it starts'; end if;

  select profile.role into v_role
  from public.profiles profile
  where profile.id = v_user_id;

  if v_role not in ('coach', 'admin') then raise exception 'Only coaches can edit events'; end if;

  select event.* into v_event
  from public.dashboard_items event
  where event.id = p_event_id
  for update;

  if v_event.id is null or v_event.item_type <> 'event' or v_event.completed then
    raise exception 'That upcoming event no longer exists';
  end if;

  if v_role <> 'admin'
    and v_event.owner_id <> v_user_id
    and not exists (
      select 1
      from public.coach_athletes link
      where link.coach_id = v_user_id
        and link.athlete_id = v_event.owner_id
    )
  then
    raise exception 'You can only edit events created by riders in your crew';
  end if;

  update public.dashboard_items event
  set title = btrim(p_title),
      details = btrim(coalesce(p_details, '')),
      due_at = p_due_at,
      end_at = p_end_at,
      updated_at = now()
  where event.id = p_event_id
  returning event.* into v_updated;

  insert into private.event_edit_audit (
    event_id,
    changed_by,
    event_before,
    event_after
  ) values (
    p_event_id,
    v_user_id,
    to_jsonb(v_event),
    to_jsonb(v_updated)
  );

  return p_event_id;
exception
  when unique_violation then
    raise exception 'An event with that name and start date already exists. Merge the duplicate events instead.';
end;
$function$;

create or replace function public.coach_update_contest_event(
  p_event_id uuid,
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
  select private.coach_update_contest_event_internal(
    p_event_id, p_title, p_details, p_due_at, p_end_at
  );
$function$;

grant usage on schema private to authenticated;
revoke all on function private.coach_update_contest_event_internal(uuid,text,text,timestamptz,timestamptz) from public, anon;
grant execute on function private.coach_update_contest_event_internal(uuid,text,text,timestamptz,timestamptz) to authenticated;
revoke all on function public.coach_update_contest_event(uuid,text,text,timestamptz,timestamptz) from public, anon;
grant execute on function public.coach_update_contest_event(uuid,text,text,timestamptz,timestamptz) to authenticated;

-- The prior coach policy protected rows by coach_id. Add the rider-link check
-- as well so a browser client cannot target an unrelated athlete.
drop policy if exists run_plans_coach_all on public.run_plans;
create policy run_plans_coach_all
  on public.run_plans
  for all
  to authenticated
  using (
    coach_id = (select auth.uid())
    and exists (
      select 1
      from public.coach_athletes link
      where link.coach_id = (select auth.uid())
        and link.athlete_id = run_plans.athlete_id
    )
  )
  with check (
    coach_id = (select auth.uid())
    and exists (
      select 1
      from public.coach_athletes link
      where link.coach_id = (select auth.uid())
        and link.athlete_id = run_plans.athlete_id
    )
  );

notify pgrst, 'reload schema';
