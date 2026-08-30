-- Parent engagement alerts use an explicit app-open timestamp rather than
-- profile edits. Alerts are private to linked parents, deduplicated weekly and
-- respect the existing sheet notification preference and quiet hours.

alter table public.profiles
  add column if not exists last_app_opened_at timestamptz;

create index if not exists profiles_athlete_last_app_opened_idx
  on public.profiles (last_app_opened_at)
  where role = 'athlete';

create or replace function public.record_my_app_open()
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_recorded_at timestamptz := now();
begin
  if v_user_id is null then
    raise exception 'You must be signed in';
  end if;

  update public.profiles profile
  set last_app_opened_at = v_recorded_at
  where profile.id = v_user_id;

  return v_recorded_at;
end;
$function$;

revoke all on function public.record_my_app_open() from public, anon;
grant execute on function public.record_my_app_open() to authenticated;

create or replace function private.queue_parent_engagement_alerts()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row record;
  v_bounds record;
  v_timezone text;
  v_local_now timestamp;
  v_last_activity timestamptz;
  v_total integer;
  v_completed integer;
  v_remaining integer;
  v_percent integer;
  v_inactive boolean;
  v_low_progress boolean;
  v_title text;
  v_body text;
  v_count integer := 0;
begin
  for v_row in
    select
      link.parent_id,
      link.athlete_id,
      athlete.display_name,
      athlete.country_code,
      athlete.created_at,
      athlete.last_app_opened_at
    from public.parent_athletes link
    join public.profiles athlete
      on athlete.id = link.athlete_id
     and athlete.role = 'athlete'
    join public.profiles parent
      on parent.id = link.parent_id
     and parent.role = 'parent'
    left join public.push_preferences preference
      on preference.user_id = link.parent_id
    where coalesce(preference.sheet_updates, true)
  loop
    v_timezone := coalesce(public.jkcrew_country_timezone(v_row.country_code), 'Australia/Brisbane');
    v_local_now := timezone(v_timezone, now());
    if extract(hour from v_local_now)::integer <> 18 then
      continue;
    end if;

    select * into v_bounds
    from public.jkcrew_week_bounds(v_row.country_code, now())
    limit 1;

    select greatest(
      coalesce(v_row.last_app_opened_at, v_row.created_at),
      coalesce((select max(attempt.attempted_at) from public.assignment_attempts attempt where attempt.athlete_id = v_row.athlete_id), '-infinity'::timestamptz),
      coalesce((select max(progress.updated_at) from public.assignment_progress progress where progress.athlete_id = v_row.athlete_id), '-infinity'::timestamptz),
      coalesce((select max(session.started_at) from public.training_sessions session where session.athlete_id = v_row.athlete_id), '-infinity'::timestamptz),
      coalesce((select max(award.created_at) from public.assignment_point_awards award where award.athlete_id = v_row.athlete_id), '-infinity'::timestamptz)
    ) into v_last_activity;

    select
      count(*)::integer,
      count(*) filter (
        where (
          assignment.category = 'percentage'
          and (select count(*) from public.percentage_attempts attempt where attempt.assignment_id = assignment.id and attempt.athlete_id = assignment.athlete_id) >= 10
        ) or (
          assignment.category <> 'percentage'
          and exists (
            select 1 from public.assignment_progress progress
            where progress.assignment_id = assignment.id
              and progress.athlete_id = assignment.athlete_id
              and progress.completed_at is not null
          )
        )
      )::integer
    into v_total, v_completed
    from public.weekly_trick_assignments assignment
    where assignment.athlete_id = v_row.athlete_id
      and assignment.week_start = v_bounds.week_start_date
      and assignment.category in ('one_bang', 'dialled', 'lines', 'percentage', 'bonus');

    v_remaining := greatest(0, coalesce(v_total, 0) - coalesce(v_completed, 0));
    v_percent := case when coalesce(v_total, 0) = 0 then 0 else round((v_completed::numeric / v_total::numeric) * 100)::integer end;
    v_inactive := v_last_activity <= now() - interval '4 days';
    v_low_progress := extract(dow from v_local_now)::integer in (4, 5, 6)
      and coalesce(v_total, 0) > 0
      and v_percent < 35
      and v_remaining > 0;

    if not v_inactive and not v_low_progress then
      continue;
    end if;

    v_title := case
      when v_inactive then split_part(v_row.display_name, ' ', 1) || ' may need a gentle check-in'
      else split_part(v_row.display_name, ' ', 1) || '''s weekly sheet needs attention'
    end;
    v_body := case
      when v_inactive and v_low_progress then
        'No JKCREW activity has been recorded for 4 days and ' || v_remaining || ' weekly item' || case when v_remaining = 1 then ' remains.' else 's remain.' end
      when v_inactive then
        'No JKCREW activity has been recorded for 4 days. A little encouragement may help.'
      else
        v_remaining || ' weekly item' || case when v_remaining = 1 then ' remains.' else 's remain.' end || ' A gentle check-in may help.'
    end;

    perform private.emit_jkcrew_notification(
      v_row.parent_id,
      'parent_engagement_checkin',
      v_title,
      v_body,
      'home',
      jsonb_build_object(
        'athlete_id', v_row.athlete_id,
        'week_start', v_bounds.week_start_date,
        'remaining_items', v_remaining,
        'completion_percent', v_percent,
        'last_activity_at', v_last_activity
      ),
      'parent-engagement:' || v_row.parent_id::text || ':' || v_row.athlete_id::text || ':' || v_bounds.week_start_date::text,
      'sheet'
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

revoke all on function private.queue_parent_engagement_alerts() from public, anon, authenticated;

do $block$
declare
  v_job record;
begin
  for v_job in select jobid from cron.job where jobname = 'jkcrew-parent-engagement-alerts' loop
    perform cron.unschedule(v_job.jobid);
  end loop;
  perform cron.schedule(
    'jkcrew-parent-engagement-alerts',
    '5 * * * *',
    'select private.queue_parent_engagement_alerts();'
  );
end
$block$;

notify pgrst, 'reload schema';
