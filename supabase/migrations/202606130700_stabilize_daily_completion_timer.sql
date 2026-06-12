-- Keep Daily Tricks completion timing stable when the final tick comes from
-- a rider phone or the coach Session Viewer. Points are still awarded by
-- record_assignment_action; this trigger makes the session/PB timing durable.

create or replace function public.sync_daily_completion_timing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment public.weekly_trick_assignments%rowtype;
  v_today date;
  v_daily_venue text := 'default';
  v_all_daily_done boolean := false;
  v_session public.training_sessions%rowtype;
  v_group_session public.coach_group_sessions%rowtype;
  v_elapsed_seconds integer := 0;
  v_group_pause_seconds integer := 0;
  v_old_pb integer;
begin
  if tg_op = 'DELETE' or new.progress_date is null then
    return new;
  end if;

  select wta.* into v_assignment
  from public.weekly_trick_assignments wta
  where wta.id = new.assignment_id
    and wta.category = 'daily';

  if not found then
    return new;
  end if;

  v_today := new.progress_date;
  v_daily_venue := coalesce(nullif(trim(v_assignment.venue), ''), 'default');

  select not exists (
    select 1
    from public.weekly_trick_assignments wta
    left join public.assignment_progress ap on ap.assignment_id = wta.id
    where wta.athlete_id = v_assignment.athlete_id
      and wta.week_start = v_assignment.week_start
      and wta.category = 'daily'
      and coalesce(nullif(trim(wta.venue), ''), 'default') = v_daily_venue
      and ap.progress_date is distinct from v_today
  ) into v_all_daily_done;

  if not v_all_daily_done then
    return new;
  end if;

  select ts.* into v_session
  from public.training_sessions ts
  where ts.athlete_id = v_assignment.athlete_id
    and ts.ended_at is null
  order by ts.started_at desc
  limit 1;

  if not found then
    return new;
  end if;

  select cgs.* into v_group_session
  from public.coach_group_session_participants cgsp
  join public.coach_group_sessions cgs on cgs.id = cgsp.group_session_id
  where cgsp.training_session_id = v_session.id
  order by cgs.started_at desc
  limit 1;

  if found then
    v_group_pause_seconds := coalesce(v_group_session.total_paused_seconds, 0)
      + case
        when v_group_session.status = 'paused' and v_group_session.paused_at is not null
          then greatest(0, extract(epoch from (now() - v_group_session.paused_at))::integer)
        else 0
      end;
    v_elapsed_seconds := greatest(0, extract(epoch from (now() - v_group_session.started_at))::integer - v_group_pause_seconds);
  else
    v_elapsed_seconds := greatest(0, extract(epoch from (now() - v_session.started_at))::integer);
  end if;

  update public.training_sessions ts
  set daily_completed_seconds = case
        when ts.daily_completed_seconds is null then v_elapsed_seconds
        else least(ts.daily_completed_seconds, v_elapsed_seconds)
      end,
      daily_completed_at = coalesce(ts.daily_completed_at, now())
  where ts.id = v_session.id;

  if v_group_session.id is not null then
    update public.coach_group_session_participants cgsp
    set daily_finished_at = coalesce(cgsp.daily_finished_at, now()),
        daily_finish_seconds = case
          when cgsp.daily_finish_seconds is null then v_elapsed_seconds
          else least(cgsp.daily_finish_seconds, v_elapsed_seconds)
        end,
        last_activity_at = now()
    where cgsp.group_session_id = v_group_session.id
      and cgsp.athlete_id = v_assignment.athlete_id;
  end if;

  select p.daily_pb_seconds into v_old_pb
  from public.profiles p
  where p.id = v_assignment.athlete_id;

  if v_old_pb is null or v_elapsed_seconds < v_old_pb then
    update public.profiles p
    set daily_pb_seconds = v_elapsed_seconds,
        daily_pb_updated_at = now(),
        updated_at = now()
    where p.id = v_assignment.athlete_id;
  end if;

  return new;
end;
$$;

drop trigger if exists assignment_progress_daily_completion_timing on public.assignment_progress;
create trigger assignment_progress_daily_completion_timing
after insert or update of progress_date on public.assignment_progress
for each row
when (new.progress_date is not null)
execute function public.sync_daily_completion_timing();

revoke all on function public.sync_daily_completion_timing() from public;
