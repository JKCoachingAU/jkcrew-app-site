-- Preserve public authorization wrappers, scoring rules and response fields.
-- Repeated completed weekly taps now avoid progress/history/attempt writes.
set local lock_timeout='5s';

CREATE OR REPLACE FUNCTION private.approved_b223f0cd2e29fcfebf9311d3(p_assignment_id uuid, p_action text DEFAULT 'landed'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_assignment public.weekly_trick_assignments%rowtype;
  v_actor_role public.user_role;
  v_can_manage boolean := false;
  v_actor_is_athlete boolean := false;
  v_session public.training_sessions%rowtype;
  v_group_session public.coach_group_sessions%rowtype;
  v_progress public.assignment_progress%rowtype;
  v_today date;
  v_points integer := 0;
  v_removed_points integer := 0;
  v_deleted_award record;
  v_message text := '';
  v_award_key text;
  v_daily_venue text := '';
  v_daily_complete_key text := '';
  v_daily_under_20_key text := '';
  v_daily_legacy_key text := '';
  v_all_daily_done boolean := false;
  v_has_live_session boolean := false;
  v_elapsed_seconds integer := 0;
  v_group_pause_seconds integer := 0;
begin
  if v_uid is null then
    raise exception 'Sign in required';
  end if;

  select wta.* into v_assignment
  from public.weekly_trick_assignments wta
  where wta.id = p_assignment_id
    and wta.category in ('daily','dialled','one_bang','foam_pit','bonus','trick_links');
  if not found then
    raise exception 'Assigned trick not found';
  end if;

  if v_assignment.category = 'daily' then
    return public.record_daily_trick_action(p_assignment_id, p_action, '', null);
  end if;

  select p.role into v_actor_role
  from public.profiles p
  where p.id = v_uid;

  v_actor_is_athlete := v_assignment.athlete_id = v_uid;
  v_can_manage := v_actor_is_athlete
    or (
      v_actor_role in ('coach', 'admin')
      and exists (
        select 1
        from public.coach_athletes ca
        where ca.coach_id = v_uid
          and ca.athlete_id = v_assignment.athlete_id
      )
    );

  if not v_can_manage then
    raise exception 'You cannot update this rider''s tricks';
  end if;

  -- Serialize only this assignment's toggles, including ordinary weekly lists.
  -- A retry must read completion/receipt state after any preceding toggle commits.
  select wta.* into v_assignment
  from public.weekly_trick_assignments wta
  where wta.id = v_assignment.id
    and wta.athlete_id = v_assignment.athlete_id
    and wta.coach_id is not distinct from v_assignment.coach_id
    and wta.category = v_assignment.category
  for update;
  if not found then
    raise exception 'Assigned trick changed. Refresh the list and try again.';
  end if;

  select b.local_today into v_today
  from public.profiles p
  cross join lateral public.jkcrew_week_bounds(p.country_code) b
  where p.id = v_assignment.athlete_id;

  if v_today is null then
    v_today := (now() at time zone 'Australia/Brisbane')::date;
  end if;

  if p_action not in ('landed', 'unlanded') then
    raise exception 'Unknown action';
  end if;

  v_daily_venue := coalesce(nullif(trim(v_assignment.venue), ''), 'default');
  v_daily_complete_key := 'daily-complete:' || v_daily_venue || ':' || v_today::text;
  v_daily_under_20_key := 'daily-under-20:' || v_daily_venue || ':' || v_today::text;
  v_daily_legacy_key := 'daily:' || v_daily_venue || ':' || v_today::text;

  select ts.* into v_session
  from public.training_sessions ts
  where ts.athlete_id = v_assignment.athlete_id
    and ts.ended_at is null
  order by ts.started_at desc
  limit 1;
  v_has_live_session := found;

  if v_has_live_session then
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
      v_has_live_session := v_group_session.status = 'running';
    else
      v_elapsed_seconds := greatest(0, extract(epoch from (now() - v_session.started_at))::integer);
    end if;
  end if;

  -- A completed weekly checkbox is a retry, not another landed attempt. Keep
  -- missing-receipt repair on the normal path; approval/team gates and the
  -- canonical rider/coach authorization above run before this read-only result.
  if p_action = 'landed' then
    select ap.* into v_progress
    from public.assignment_progress ap where ap.assignment_id = v_assignment.id;
    if v_progress.completed_at is not null
      and (v_assignment.category = 'foam_pit' or exists (
        select 1 from public.assignment_point_awards apa
        where apa.athlete_id = v_assignment.athlete_id
          and apa.award_key = v_assignment.category || ':' || v_assignment.id::text
          and apa.assignment_id = v_assignment.id
          and apa.points = case when v_assignment.category = 'bonus' then 5 else 2 end
      )) then
      return jsonb_build_object(
        'assignment_id', v_assignment.id,
        'category', v_assignment.category,
        'venue', v_assignment.venue,
        'progress_date', v_progress.progress_date,
        'streak_count', v_progress.streak_count,
        'completed_at', v_progress.completed_at,
        'points_awarded', 0,
        'points_removed', 0,
        'message', case v_assignment.category
          when 'trick_links' then 'Trick Link complete'
          when 'dialled' then 'Dialled trick complete'
          when 'bonus' then 'Bonus Trick complete'
          when 'foam_pit' then 'Foam Pit practice ticked'
          else 'One Bang complete' end,
        'live_session', v_has_live_session,
        'elapsed_seconds', v_elapsed_seconds
      );
    end if;
  end if;

  insert into public.assignment_progress (assignment_id, athlete_id)
  values (v_assignment.id, v_assignment.athlete_id)
  on conflict (assignment_id) do nothing;

  if p_action = 'unlanded' then
    if v_assignment.category = 'daily' then
      -- Daily checklist state resets/changes independently from earned score.
      -- Once the full list has awarded daily-complete or under-20 points for a
      -- local date, never remove those earned point awards from an untick.
      v_removed_points := 0;

      update public.assignment_progress ap
      set progress_date = null,
          updated_at = now()
      where ap.assignment_id = v_assignment.id
      returning ap.* into v_progress;

      v_message := 'Daily trick unticked';
    else
      v_award_key := v_assignment.category || ':' || v_assignment.id::text;

      for v_deleted_award in
        delete from public.assignment_point_awards apa
        where apa.athlete_id = v_assignment.athlete_id
          and apa.award_key = v_award_key
        returning apa.points, apa.session_id
      loop
        v_removed_points := v_removed_points + coalesce(v_deleted_award.points, 0);
        if v_assignment.category = 'trick_links' and v_deleted_award.session_id is not null then
          -- Undo the receipt in the session where this pair earned its points,
          -- even when the rider has since opened a different session.
          delete from public.trick_attempts ta
          where ta.id = (
            select latest.id from public.trick_attempts latest
            where latest.session_id = v_deleted_award.session_id
              and latest.athlete_id = v_assignment.athlete_id
              and latest.category = 'trick_links'
              and latest.trick_name = v_assignment.trick_name
            order by latest.created_at desc limit 1
          );
        end if;
        if v_deleted_award.session_id is not null then
          update public.training_sessions ts
          set total_points = greatest(0, coalesce(ts.total_points, 0) - coalesce(v_deleted_award.points, 0))
          where ts.id = v_deleted_award.session_id;
        end if;
      end loop;

      update public.assignment_progress ap
      set completed_at = null,
          streak_count = case when v_assignment.category = 'dialled' then 0 else ap.streak_count end,
          updated_at = now()
      where ap.assignment_id = v_assignment.id
      returning ap.* into v_progress;

      v_message := case
        when v_assignment.category = 'dialled' then 'Dialled trick unticked'
        when v_assignment.category = 'foam_pit' then 'Foam Pit trick unticked'
        when v_assignment.category = 'bonus' then 'Bonus Trick unticked'
        when v_assignment.category = 'trick_links' then 'Trick Link unticked'
        else 'One Bang unticked'
      end;
    end if;

    if v_session.id is not null and v_assignment.category <> 'trick_links' then
      delete from public.trick_attempts ta
      where ta.id in (
        select ta2.id
        from public.trick_attempts ta2
        where ta2.session_id = v_session.id
          and ta2.athlete_id = v_assignment.athlete_id
          and ta2.category = v_assignment.category
          and ta2.trick_name = v_assignment.trick_name
        order by ta2.created_at desc
        limit 1
      );
    end if;

    if v_group_session.id is not null then
      update public.coach_group_session_participants cgsp
      set last_activity_at = now()
      where cgsp.group_session_id = v_group_session.id
        and cgsp.athlete_id = v_assignment.athlete_id;
    end if;

    select ap.* into v_progress
    from public.assignment_progress ap
    where ap.assignment_id = v_assignment.id;

    return jsonb_build_object(
      'assignment_id', v_assignment.id,
      'category', v_assignment.category,
      'venue', v_assignment.venue,
      'progress_date', v_progress.progress_date,
      'streak_count', v_progress.streak_count,
      'completed_at', v_progress.completed_at,
      'points_awarded', 0,
      'points_removed', coalesce(v_removed_points, 0),
      'message', v_message,
      'live_session', v_has_live_session,
      'elapsed_seconds', v_elapsed_seconds
    );
  end if;

  if v_assignment.category = 'daily' then
    update public.assignment_progress ap
    set progress_date = v_today,
        updated_at = now()
    where ap.assignment_id = v_assignment.id
    returning ap.* into v_progress;

    select not exists (
      select 1
      from public.weekly_trick_assignments a
      left join public.assignment_progress ap on ap.assignment_id = a.id
      where a.athlete_id = v_assignment.athlete_id
        and a.week_start = v_assignment.week_start
        and a.category = 'daily'
        and coalesce(nullif(trim(a.venue), ''), 'default') = v_daily_venue
        and ap.progress_date is distinct from v_today
    ) into v_all_daily_done;

    if v_all_daily_done then
      if not exists (
        select 1
        from public.assignment_point_awards apa
        where apa.athlete_id = v_assignment.athlete_id
          and apa.award_key in (v_daily_complete_key, v_daily_legacy_key)
      ) then
        insert into public.assignment_point_awards (athlete_id, session_id, assignment_id, award_key, points)
        values (
          v_assignment.athlete_id,
          case when v_session.id is not null then v_session.id else null end,
          v_assignment.id,
          v_daily_complete_key,
          1
        )
        on conflict (athlete_id, award_key) do nothing;
        if found then
          v_points := v_points + 1;
        end if;
      end if;

      if v_has_live_session and v_elapsed_seconds <= 1200 then
        insert into public.assignment_point_awards (athlete_id, session_id, assignment_id, award_key, points)
        values (v_assignment.athlete_id, v_session.id, v_assignment.id, v_daily_under_20_key, 1)
        on conflict (athlete_id, award_key) do nothing;
        if found then
          v_points := v_points + 1;
        end if;
      end if;

      if v_group_session.id is not null and v_group_session.status = 'running' then
        v_award_key := 'group-first-finish:' || v_group_session.id::text;
        if not exists (
          select 1
          from public.assignment_point_awards apa
          where apa.award_key = v_award_key
        ) then
          insert into public.assignment_point_awards (athlete_id, session_id, assignment_id, award_key, points)
          values (v_assignment.athlete_id, v_session.id, v_assignment.id, v_award_key, 1)
          on conflict (athlete_id, award_key) do nothing;
          if found then
            v_points := v_points + 1;
          end if;
        end if;
      end if;
    end if;

    v_message := case
      when v_points >= 3 then 'Daily Tricks complete, under 20 minutes, and first in the group'
      when v_points = 2 and v_has_live_session and v_elapsed_seconds <= 1200 then 'Daily Tricks complete inside 20 minutes'
      when v_points = 2 then 'Daily Tricks complete plus first finish bonus'
      when v_points = 1 and v_all_daily_done then 'Daily Tricks list complete'
      when v_has_live_session then 'Daily trick ticked'
      else 'Daily progress saved outside a live session'
    end;

  elsif v_assignment.category in ('one_bang', 'trick_links') then
    update public.assignment_progress ap
    set completed_at = coalesce(ap.completed_at, now()),
        updated_at = now()
    where ap.assignment_id = v_assignment.id
    returning ap.* into v_progress;

    v_award_key := v_assignment.category || ':' || v_assignment.id::text;
    insert into public.assignment_point_awards (athlete_id, session_id, assignment_id, award_key, points)
    values (v_assignment.athlete_id, case when v_session.id is not null then v_session.id else null end, v_assignment.id, v_award_key, 2)
    on conflict (athlete_id, award_key) do nothing;
    if found then
      v_points := 2;
    end if;
    v_message := case when v_assignment.category = 'trick_links' then 'Trick Link complete' else 'One Bang complete' end;

  elsif v_assignment.category = 'dialled' then
    update public.assignment_progress ap
    set completed_at = coalesce(ap.completed_at, now()),
        streak_count = 1,
        updated_at = now()
    where ap.assignment_id = v_assignment.id
    returning ap.* into v_progress;

    v_award_key := 'dialled:' || v_assignment.id::text;
    insert into public.assignment_point_awards (athlete_id, session_id, assignment_id, award_key, points)
    values (v_assignment.athlete_id, case when v_session.id is not null then v_session.id else null end, v_assignment.id, v_award_key, 2)
    on conflict (athlete_id, award_key) do nothing;
    if found then
      v_points := 2;
    end if;
    v_message := 'Dialled trick complete';

  elsif v_assignment.category = 'bonus' then
    update public.assignment_progress ap
    set completed_at = coalesce(ap.completed_at, now()),
        updated_at = now()
    where ap.assignment_id = v_assignment.id
    returning ap.* into v_progress;

    v_award_key := 'bonus:' || v_assignment.id::text;
    insert into public.assignment_point_awards (athlete_id, session_id, assignment_id, award_key, points)
    values (v_assignment.athlete_id, case when v_session.id is not null then v_session.id else null end, v_assignment.id, v_award_key, 5)
    on conflict (athlete_id, award_key) do nothing;
    if found then
      v_points := 5;
    end if;
    v_message := 'Bonus Trick complete';

  elsif v_assignment.category = 'foam_pit' then
    update public.assignment_progress ap
    set completed_at = coalesce(ap.completed_at, now()),
        updated_at = now()
    where ap.assignment_id = v_assignment.id
    returning ap.* into v_progress;

    v_points := 0;
    v_message := 'Foam Pit practice ticked';
  end if;

  if v_session.id is not null and (v_assignment.category <> 'trick_links' or v_points > 0) then
    insert into public.trick_attempts (session_id, athlete_id, trick_name, category, status, duration_seconds, points)
    values (v_session.id, v_assignment.athlete_id, v_assignment.trick_name, v_assignment.category, 'landed', v_elapsed_seconds, v_points);

    if v_points > 0 then
      update public.training_sessions ts
      set total_points = coalesce(ts.total_points, 0) + v_points
      where ts.id = v_session.id;
    end if;
  end if;

  if v_group_session.id is not null then
    update public.coach_group_session_participants cgsp
    set last_activity_at = now()
    where cgsp.group_session_id = v_group_session.id
      and cgsp.athlete_id = v_assignment.athlete_id;
  end if;

  select ap.* into v_progress
  from public.assignment_progress ap
  where ap.assignment_id = v_assignment.id;

  return jsonb_build_object(
    'assignment_id', v_assignment.id,
    'category', v_assignment.category,
    'venue', v_assignment.venue,
    'progress_date', v_progress.progress_date,
    'streak_count', v_progress.streak_count,
    'completed_at', v_progress.completed_at,
    'points_awarded', v_points,
    'points_removed', 0,
    'message', v_message,
    'live_session', v_has_live_session,
    'elapsed_seconds', v_elapsed_seconds
  );
end;
$function$;

CREATE OR REPLACE FUNCTION private.sync_tricktionary_progress_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_assignment jsonb;
begin
  -- UPDATE OF also fires when a column is assigned its existing value. Such a
  -- heartbeat cannot add, revoke or relocate landing evidence.
  if tg_op='UPDATE'
    and new.assignment_id is not distinct from old.assignment_id
    and new.athlete_id is not distinct from old.athlete_id
    and new.progress_date is not distinct from old.progress_date
    and new.completed_at is not distinct from old.completed_at
    and new.streak_count is not distinct from old.streak_count then
    return new;
  end if;
  select to_jsonb(a) into v_assignment from public.weekly_trick_assignments a where a.id=new.assignment_id;
  if v_assignment is null then return new; end if;
  if tg_op='UPDATE' then
    if v_assignment->>'category'='daily' and old.progress_date is not null and new.progress_date is null then
      update public.tricktionary_landing_history set landed_count=0,evidence_type='revoked' where id='daily:'||old.assignment_id::text||':'||old.progress_date::text;
    elsif v_assignment->>'category'<>'daily' and old.completed_at is not null and new.completed_at is null then
      update public.tricktionary_landing_history set landed_count=0,evidence_type='revoked' where id='assignment:'||old.assignment_id::text;
    end if;
  end if;
  perform private.capture_tricktionary_progress(v_assignment,to_jsonb(new));
  return new;
end;
$function$;

-- CREATE OR REPLACE preserves the existing private implementation grants; the
-- unchanged public wrappers remain responsible for approval and team access.
revoke all on function private.sync_tricktionary_progress_history() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
