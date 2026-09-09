-- Private, read-only milestones derived from saved results, including corrections.
create or replace function public.get_my_progress_milestones()
returns jsonb language sql stable security invoker set search_path = '' as $$
  with sets as (
    select a.id, a.trick_name, a.venue, a.week_start,
      lower(regexp_replace(btrim(a.trick_name), '\s+', ' ', 'g')) as trick_key,
      lower(regexp_replace(btrim(coalesce(a.venue, '')), '\s+', ' ', 'g')) as venue_key,
      count(*) filter (where p.landed)::integer as landed,
      min(p.created_at) as started_at, max(p.created_at) as completed_at
    from public.weekly_trick_assignments a
    join public.percentage_attempts p on p.assignment_id = a.id and p.athlete_id = a.athlete_id
    where a.athlete_id = (select auth.uid()) and a.category = 'percentage'
    group by a.id, a.trick_name, a.venue, a.week_start
    having count(p.landed) = 10 and count(distinct p.attempt_number) = 10
  ), compared as (
    select s.*, (select max(h.landed) from sets h
      where h.trick_key = s.trick_key and h.venue_key = s.venue_key
        and h.completed_at < s.started_at) as previous_best,
      row_number() over (partition by s.trick_key, s.venue_key order by s.completed_at desc, s.id) as latest
    from sets s
  ), improvements as (
    select id, trick_name, venue, landed, previous_best, started_at, completed_at
    from compared where latest = 1 and landed > previous_best
      and completed_at >= now() - interval '28 days'
    order by completed_at desc limit 3
  ), runs as (
    select id, title, run_status, updated_at from public.run_plans
    where athlete_id = (select auth.uid()) and archived_at is null
      and run_status in ('ready_for_review', 'reviewed')
    order by updated_at desc limit 3
  )
  select jsonb_build_object('consistency', coalesce((select jsonb_agg(to_jsonb(i)) from improvements i), '[]'::jsonb),
    'runs', coalesce((select jsonb_agg(to_jsonb(r)) from runs r), '[]'::jsonb));
$$;
revoke all on function public.get_my_progress_milestones() from public, anon;
grant execute on function public.get_my_progress_milestones() to authenticated;

alter table public.run_plans drop constraint run_plans_run_status_check;
alter table public.run_plans add constraint run_plans_run_status_check
  check (run_status in ('planned', 'practiced', 'completed', 'needs_work', 'archived', 'ready_for_review', 'reviewed'));

-- Keep review decisions tied to the exact version that was watched.
create or replace function private.guard_run_review()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  content_changed boolean := false;
  is_linked_coach boolean;
begin
  if tg_op = 'UPDATE' then
    content_changed := row(new.points, new.image_data_url, new.title, new.notes, new.venue, new.plan_type, new.contest_item_id, new.athlete_id, new.coach_id)
      is distinct from row(old.points, old.image_data_url, old.title, old.notes, old.venue, old.plan_type, old.contest_item_id, old.athlete_id, old.coach_id);
    if content_changed and old.run_status in ('ready_for_review', 'reviewed') then
      new.run_status := 'planned';
    end if;
    if new.run_status is not distinct from old.run_status then return new; end if;
  end if;
  if new.run_status not in ('ready_for_review', 'reviewed') then return new; end if;
  is_linked_coach := auth.uid() = new.coach_id and exists (
    select 1 from public.coach_athletes c join public.profiles p on p.id = c.coach_id
    where c.coach_id = auth.uid() and c.athlete_id = new.athlete_id and p.role::text in ('coach', 'admin'));
  if new.archived_at is not null then raise exception 'Archived runs cannot be submitted for review.'; end if;
  if not exists (select 1 from public.coach_athletes c where c.coach_id = new.coach_id and c.athlete_id = new.athlete_id) then
    raise exception 'Link a coach before requesting a run review.';
  end if;
  if new.run_status = 'reviewed' then
    if not coalesce(is_linked_coach, false) then raise exception 'Only the linked coach can mark a run reviewed.'; end if;
    if tg_op = 'INSERT' then raise exception 'Save and submit the run before reviewing it.'; end if;
    if old.run_status <> 'ready_for_review' or content_changed then raise exception 'Watch the submitted version before marking it reviewed.'; end if;
  else
    if not coalesce(auth.uid() = new.athlete_id or is_linked_coach, false) then raise exception 'This run is private.'; end if;
    if new.plan_type <> 'competition' or btrim(new.image_data_url) = '' or jsonb_typeof(new.points) <> 'array' then
      raise exception 'Save a competition run with a park photo and named tricks first.';
    end if;
    if jsonb_array_length(new.points) < 3 then raise exception 'Add a start, at least one trick, and a finish first.'; end if;
    if exists (select 1 from jsonb_array_elements(new.points) with ordinality as p(point, n)
      where n > 1 and n < jsonb_array_length(new.points) and btrim(coalesce(point->>'label', '')) = '') then
      raise exception 'Name every trick before requesting a review.';
    end if;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function private.guard_run_review() from public, anon, authenticated;
create trigger guard_run_review before insert or update on public.run_plans
  for each row execute function private.guard_run_review();

create or replace function public.set_run_review_status(p_run_id uuid, p_status text, p_expected_updated_at timestamptz)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.run_plans;
begin
  if auth.uid() is null then raise exception 'Sign in to update a run.'; end if;
  if p_status not in ('planned', 'ready_for_review', 'reviewed') or p_status is null then raise exception 'Invalid review status.'; end if;
  update public.run_plans set run_status = p_status, updated_at = clock_timestamp()
    where id = p_run_id and updated_at = p_expected_updated_at and archived_at is null
    returning * into r;
  if not found then raise exception 'This run changed or is unavailable. Reopen it before trying again.'; end if;
  return jsonb_build_object('id', r.id, 'athlete_id', r.athlete_id, 'coach_id', r.coach_id,
    'created_by', r.created_by, 'plan_type', r.plan_type, 'title', r.title, 'run_status', r.run_status, 'updated_at', r.updated_at);
end;
$$;
revoke all on function public.set_run_review_status(uuid, text, timestamptz) from public, anon;
grant execute on function public.set_run_review_status(uuid, text, timestamptz) to authenticated;
