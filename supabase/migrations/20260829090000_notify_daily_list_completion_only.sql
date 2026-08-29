-- Daily Tricks are a timed list. Notify the coach once when the full list for
-- that rider, location and day is complete, rather than once per Daily tick.

create or replace function private.queue_jkcrew_trick_completion_push()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $function$
declare
  v_assignment public.weekly_trick_assignments%rowtype;
  v_athlete_name text;
  v_became_complete boolean := false;
  v_daily_list_complete boolean := false;
  v_completion_key text;
  v_category_label text;
  v_notification_title text;
  v_notification_body text;
  v_venue text;
begin
  select assignment.* into v_assignment
  from public.weekly_trick_assignments assignment
  where assignment.id = new.assignment_id;

  if v_assignment.id is null or (select auth.uid()) is distinct from new.athlete_id then
    return new;
  end if;

  select profile.display_name into v_athlete_name
  from public.profiles profile
  where profile.id = new.athlete_id;

  if v_assignment.category = 'daily' then
    v_became_complete := new.progress_date is not null
      and (tg_op = 'INSERT' or old.progress_date is distinct from new.progress_date);

    if not v_became_complete then
      return new;
    end if;

    v_venue := coalesce(nullif(btrim(v_assignment.venue), ''), 'default');

    select not exists (
      select 1
      from public.weekly_trick_assignments assignment
      left join public.assignment_progress progress
        on progress.assignment_id = assignment.id
      where assignment.athlete_id = v_assignment.athlete_id
        and assignment.week_start = v_assignment.week_start
        and assignment.category = 'daily'
        and coalesce(nullif(btrim(assignment.venue), ''), 'default') = v_venue
        and progress.progress_date is distinct from new.progress_date
    ) into v_daily_list_complete;

    if not v_daily_list_complete then
      return new;
    end if;

    v_completion_key := v_assignment.week_start::text || ':' || v_venue || ':' || new.progress_date::text;
    v_category_label := 'Daily Tricks';
    v_notification_title := coalesce(v_athlete_name, 'A rider') || ' completed their Daily list ✅';
    v_notification_body := case
      when v_venue = 'default' then 'Full Daily Tricks list complete.'
      else v_venue || ': full Daily Tricks list complete.'
    end;
  else
    v_became_complete := new.completed_at is not null
      and (tg_op = 'INSERT' or old.completed_at is null);

    if not v_became_complete then
      return new;
    end if;

    v_completion_key := v_assignment.id::text;
    v_category_label := case v_assignment.category
      when 'one_bang' then 'One Bang'
      when 'dialled' then 'Dialled'
      when 'percentage' then 'Percentage Trick'
      when 'lines' then 'Line'
      when 'bonus' then 'Bonus Trick'
      else initcap(replace(v_assignment.category, '_', ' '))
    end;
    v_notification_title := coalesce(v_athlete_name, 'A rider') || ' completed a trick 🔥';
    v_notification_body := v_category_label || ': ' || v_assignment.trick_name;
  end if;

  insert into public.push_notification_queue (
    recipient_id,
    notification_type,
    title,
    body,
    url,
    payload,
    dedupe_key
  )
  select
    link.coach_id,
    case when v_assignment.category = 'daily' then 'daily_list_completed' else 'trick_completed' end,
    v_notification_title,
    v_notification_body,
    './?push=command',
    jsonb_build_object(
      'view', 'command',
      'athlete_id', new.athlete_id,
      'assignment_id', v_assignment.id,
      'category', v_assignment.category,
      'daily_list_complete', v_assignment.category = 'daily',
      'venue', nullif(v_venue, 'default'),
      'progress_date', new.progress_date
    ),
    case
      when v_assignment.category = 'daily'
        then 'daily-list-completed:' || link.coach_id || ':' || new.athlete_id || ':' || v_completion_key
      else 'trick-completed:' || link.coach_id || ':' || v_assignment.id || ':' || v_completion_key
    end
  from public.coach_athletes link
  left join public.push_preferences preference on preference.user_id = link.coach_id
  where link.athlete_id = new.athlete_id
    and coalesce(preference.trick_completed, true)
    and exists (
      select 1
      from public.push_subscriptions subscription
      where subscription.user_id = link.coach_id
        and subscription.enabled
    )
  on conflict (dedupe_key) do nothing;

  return new;
exception when others then
  raise warning 'JKCREW trick completion push skipped: %', sqlerrm;
  return new;
end;
$function$;

revoke all on function private.queue_jkcrew_trick_completion_push() from public, anon, authenticated;

comment on function private.queue_jkcrew_trick_completion_push() is
  'Queues one coach notification when a Daily list is fully complete; other categories continue to notify per completed trick.';
