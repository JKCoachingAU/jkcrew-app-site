alter table public.push_preferences
  add column if not exists daily_hype boolean not null default true,
  add column if not exists trick_completed boolean not null default true,
  add column if not exists list_requests boolean not null default true;

create or replace function private.queue_due_daily_hype()
returns integer
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $function$
declare
  v_queued integer := 0;
begin
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
    athlete.id,
    'daily_hype',
    'Morning, ' || coalesce(nullif(btrim(athlete.display_name), ''), 'rider') || '! 🔥',
    case extract(isodow from (now() at time zone public.jkcrew_country_timezone(athlete.country_code)))::integer
      when 1 then 'Coach JK says: New week, fresh chance. Try your best and smash the day!'
      when 2 then 'Coach JK says: Back yourself today. Small wins turn into big progress!'
      when 3 then 'Coach JK says: Halfway through the week — stay focused, ride strong and keep pushing!'
      when 4 then 'Coach JK says: Bring the energy today. Commit to your tricks and have fun!'
      when 5 then 'Coach JK says: Finish the week strong. Try your best and make today count!'
      when 6 then 'Coach JK says: Weekend riding time — be brave, stay safe and smash your session!'
      else 'Coach JK says: Reset, recharge and enjoy your riding. Give today your best!'
    end,
    './?push=home',
    jsonb_build_object('view', 'home', 'message_kind', 'daily_hype'),
    'daily-hype:' || athlete.id || ':' || ((now() at time zone public.jkcrew_country_timezone(athlete.country_code))::date)::text
  from public.profiles athlete
  left join public.push_preferences preference on preference.user_id = athlete.id
  where athlete.role = 'athlete'
    and coalesce(preference.daily_hype, true)
    and (now() at time zone public.jkcrew_country_timezone(athlete.country_code))::time >= time '09:00'
    and (now() at time zone public.jkcrew_country_timezone(athlete.country_code))::time < time '09:10'
    and exists (
      select 1
      from public.push_subscriptions subscription
      where subscription.user_id = athlete.id
        and subscription.enabled
    )
  on conflict (dedupe_key) do nothing;

  get diagnostics v_queued = row_count;
  return v_queued;
exception when others then
  raise warning 'JKCREW daily hype push skipped: %', sqlerrm;
  return 0;
end;
$function$;

revoke all on function private.queue_due_daily_hype() from public, anon, authenticated;

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
  v_completion_key text;
  v_category_label text;
begin
  select assignment.* into v_assignment
  from public.weekly_trick_assignments assignment
  where assignment.id = new.assignment_id;

  if v_assignment.id is null or (select auth.uid()) is distinct from new.athlete_id then
    return new;
  end if;

  if v_assignment.category = 'daily' then
    v_became_complete := new.progress_date is not null
      and (tg_op = 'INSERT' or old.progress_date is distinct from new.progress_date);
    v_completion_key := coalesce(new.progress_date::text, current_date::text);
  else
    v_became_complete := new.completed_at is not null
      and (tg_op = 'INSERT' or old.completed_at is null);
    v_completion_key := v_assignment.id::text;
  end if;

  if not v_became_complete then
    return new;
  end if;

  select profile.display_name into v_athlete_name
  from public.profiles profile
  where profile.id = new.athlete_id;

  v_category_label := case v_assignment.category
    when 'daily' then 'Daily Trick'
    when 'one_bang' then 'One Bang'
    when 'dialled' then 'Dialled'
    when 'percentage' then 'Percentage Trick'
    when 'lines' then 'Line'
    when 'bonus' then 'Bonus Trick'
    else initcap(replace(v_assignment.category, '_', ' '))
  end;

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
    'trick_completed',
    coalesce(v_athlete_name, 'A rider') || ' completed a trick 🔥',
    v_category_label || ': ' || v_assignment.trick_name,
    './?push=command',
    jsonb_build_object(
      'view', 'command',
      'athlete_id', new.athlete_id,
      'assignment_id', v_assignment.id,
      'category', v_assignment.category
    ),
    'trick-completed:' || link.coach_id || ':' || v_assignment.id || ':' || v_completion_key
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

drop trigger if exists assignment_progress_trick_completion_push on public.assignment_progress;
create trigger assignment_progress_trick_completion_push
  after insert or update of completed_at, progress_date on public.assignment_progress
  for each row execute function private.queue_jkcrew_trick_completion_push();

create or replace function private.queue_jkcrew_list_request_push()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $function$
declare
  v_athlete_name text;
begin
  select profile.display_name into v_athlete_name
  from public.profiles profile
  where profile.id = new.athlete_id;

  if tg_op = 'INSERT' then
    insert into public.push_notification_queue (
      recipient_id, notification_type, title, body, url, payload, dedupe_key
    )
    select
      new.coach_id,
      'list_request_sent',
      'New list request 📋',
      coalesce(v_athlete_name, 'A rider') || ' sent ' || coalesce(nullif(btrim(new.title), ''), 'a weekly sheet') || ' for approval.',
      './?push=command',
      jsonb_build_object('view', 'command', 'proposal_id', new.id, 'athlete_id', new.athlete_id),
      'list-request-sent:' || new.id || ':' || new.coach_id
    where coalesce((select preference.list_requests from public.push_preferences preference where preference.user_id = new.coach_id), true)
      and exists (
        select 1 from public.push_subscriptions subscription
        where subscription.user_id = new.coach_id and subscription.enabled
      )
    on conflict (dedupe_key) do nothing;
  elsif new.status = 'accepted' and old.status is distinct from new.status then
    insert into public.push_notification_queue (
      recipient_id, notification_type, title, body, url, payload, dedupe_key
    )
    select
      new.athlete_id,
      'list_request_approved',
      'Your lists were approved ✅',
      'Coach JK approved ' || coalesce(nullif(btrim(new.title), ''), 'your weekly sheet') || '. Open JKCREW and get riding!',
      './?push=home',
      jsonb_build_object('view', 'home', 'proposal_id', new.id),
      'list-request-approved:' || new.id || ':' || new.athlete_id
    where coalesce((select preference.list_requests from public.push_preferences preference where preference.user_id = new.athlete_id), true)
      and exists (
        select 1 from public.push_subscriptions subscription
        where subscription.user_id = new.athlete_id and subscription.enabled
      )
    on conflict (dedupe_key) do nothing;
  end if;

  return new;
exception when others then
  raise warning 'JKCREW list request push skipped: %', sqlerrm;
  return new;
end;
$function$;

revoke all on function private.queue_jkcrew_list_request_push() from public, anon, authenticated;

drop trigger if exists rider_sheet_proposal_push on public.rider_sheet_proposals;
create trigger rider_sheet_proposal_push
  after insert or update of status on public.rider_sheet_proposals
  for each row execute function private.queue_jkcrew_list_request_push();

do $block$
declare
  v_job record;
begin
  for v_job in select jobid from cron.job where jobname = 'jkcrew-daily-hype-push' loop
    perform cron.unschedule(v_job.jobid);
  end loop;

  perform cron.schedule(
    'jkcrew-daily-hype-push',
    '*/5 * * * *',
    'select private.queue_due_daily_hype();'
  );
end
$block$;
