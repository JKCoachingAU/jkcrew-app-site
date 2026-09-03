create or replace function private.jkcrew_daily_hype_message(p_local_date date)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $function$
  select (array[
    'It’s 9am. Go do something useful with your bike.',
    'Warm up first. You’re not made of spare parts.',
    'Go ride. Watching BMX clips doesn’t count.',
    'Try the trick you’ve been avoiding.',
    'One clean trick is enough progress for today.',
    'Morning. Ride if you can.',
    'The app says you have tricks to do.',
    'One decent attempt would be a start.',
    'Today’s suggestion: BMX.',
    'Do a lap. Go from there.',
    'Today’s goal: fewer excuses and cleaner riding.',
    'Give it a proper attempt before saying it doesn’t work.',
    'Ride for twenty minutes and see what happens.',
    'Pick one thing and improve it.',
    'The trick probably isn’t going to fix itself.',
    'Make the easy tricks look good today.',
    'Your session isn’t going to start itself.',
    'No big speech today. Just go ride.',
    'The bike is still where you left it.',
    'Stop scrolling. Go ride.',
    'A short session still counts.',
    'Don’t rush the difficult stuff.',
    'Try something. Preferably something on your sheet.',
    'Go ride before you find another reason not to.',
    'You can stop reading now.',
    'Do some BMX today. That’s the whole message.',
    'Check your sheet. There’s probably something you’re avoiding.',
    'Less phone. More bike.',
    'It’s 9am. Apparently I have to remind you to ride.',
    'That’s the reminder. Off you go.'
  ]::text[])[
    1 + (((p_local_date - date '2026-09-03') % 30 + 30) % 30)
  ];
$function$;

revoke all on function private.jkcrew_daily_hype_message(date) from public, anon, authenticated;

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
    private.jkcrew_daily_hype_message(
      (now() at time zone public.jkcrew_country_timezone(athlete.country_code))::date
    ),
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
