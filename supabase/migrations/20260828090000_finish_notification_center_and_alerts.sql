-- JKCREW 2.14.18: persistent notification centre and missing lifecycle alerts.
-- Push delivery remains optional per device. In-app history is stored for every
-- recipient and can only be read or marked as read by that recipient.

create table if not exists public.app_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  notification_type text not null,
  title text not null,
  body text not null default '',
  view text not null default 'home',
  payload jsonb not null default '{}'::jsonb,
  source_key text not null unique,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  archived_at timestamptz
);

create index if not exists app_notifications_recipient_created_idx
  on public.app_notifications (recipient_id, created_at desc);
create index if not exists app_notifications_recipient_unread_idx
  on public.app_notifications (recipient_id, created_at desc)
  where read_at is null and archived_at is null;

alter table public.app_notifications enable row level security;
drop policy if exists app_notifications_read_own on public.app_notifications;
create policy app_notifications_read_own
  on public.app_notifications for select to authenticated
  using (recipient_id = (select auth.uid()));
drop policy if exists app_notifications_update_own on public.app_notifications;
create policy app_notifications_update_own
  on public.app_notifications for update to authenticated
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));

revoke all on public.app_notifications from public, anon, authenticated;
grant select on public.app_notifications to authenticated;
grant update (read_at, archived_at) on public.app_notifications to authenticated;

alter table public.push_preferences
  add column if not exists battle_updates boolean not null default true,
  add column if not exists challenge_updates boolean not null default true,
  add column if not exists event_updates boolean not null default true,
  add column if not exists sheet_updates boolean not null default true,
  add column if not exists coaching_updates boolean not null default true,
  add column if not exists achievement_updates boolean not null default true,
  add column if not exists quiet_hours_enabled boolean not null default false,
  add column if not exists quiet_hours_start time not null default time '20:00',
  add column if not exists quiet_hours_end time not null default time '08:00';

create or replace function private.emit_jkcrew_notification(
  p_recipient_id uuid,
  p_notification_type text,
  p_title text,
  p_body text,
  p_view text,
  p_payload jsonb,
  p_source_key text,
  p_preference text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_preference public.push_preferences;
  v_push_allowed boolean := true;
  v_available_at timestamptz := now();
  v_timezone text := 'Australia/Brisbane';
  v_local_now timestamp;
  v_quiet_end_local timestamp;
begin
  if p_recipient_id is null or nullif(btrim(coalesce(p_source_key, '')), '') is null then return; end if;

  insert into public.app_notifications (
    recipient_id, notification_type, title, body, view, payload, source_key
  ) values (
    p_recipient_id,
    coalesce(nullif(btrim(p_notification_type), ''), 'update'),
    coalesce(nullif(btrim(p_title), ''), 'JKCREW update'),
    coalesce(p_body, ''),
    coalesce(nullif(btrim(p_view), ''), 'home'),
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('view', coalesce(nullif(btrim(p_view), ''), 'home')),
    p_source_key
  ) on conflict (source_key) do nothing;

  select preference.* into v_preference
  from public.push_preferences preference
  where preference.user_id = p_recipient_id;

  v_push_allowed := case p_preference
    when 'battle' then coalesce(v_preference.battle_updates, true)
    when 'challenge' then coalesce(v_preference.challenge_updates, true)
    when 'event' then coalesce(v_preference.event_updates, true)
    when 'sheet' then coalesce(v_preference.sheet_updates, true)
    when 'coaching' then coalesce(v_preference.coaching_updates, true)
    when 'achievement' then coalesce(v_preference.achievement_updates, true)
    else true
  end;

  if not v_push_allowed or not exists (
    select 1 from public.push_subscriptions subscription
    where subscription.user_id = p_recipient_id and subscription.enabled
  ) then return; end if;

  if coalesce(v_preference.quiet_hours_enabled, false) then
    select coalesce(public.jkcrew_country_timezone(profile.country_code), 'Australia/Brisbane')
      into v_timezone
    from public.profiles profile where profile.id = p_recipient_id;
    v_local_now := timezone(v_timezone, now());
    if v_preference.quiet_hours_start < v_preference.quiet_hours_end
      and v_local_now::time >= v_preference.quiet_hours_start
      and v_local_now::time < v_preference.quiet_hours_end then
      v_quiet_end_local := v_local_now::date + v_preference.quiet_hours_end;
    elsif v_preference.quiet_hours_start > v_preference.quiet_hours_end
      and (v_local_now::time >= v_preference.quiet_hours_start or v_local_now::time < v_preference.quiet_hours_end) then
      v_quiet_end_local := case
        when v_local_now::time < v_preference.quiet_hours_end then v_local_now::date + v_preference.quiet_hours_end
        else (v_local_now::date + 1) + v_preference.quiet_hours_end
      end;
    end if;
    if v_quiet_end_local is not null then v_available_at := v_quiet_end_local at time zone v_timezone; end if;
  end if;

  insert into public.push_notification_queue (
    recipient_id, notification_type, title, body, url, payload, dedupe_key, available_at
  ) values (
    p_recipient_id, p_notification_type, p_title, coalesce(p_body, ''),
    './?push=' || coalesce(nullif(btrim(p_view), ''), 'home'),
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('view', coalesce(nullif(btrim(p_view), ''), 'home')),
    p_source_key, v_available_at
  ) on conflict (dedupe_key) do nothing;
end;
$function$;

revoke all on function private.emit_jkcrew_notification(uuid,text,text,text,text,jsonb,text,text)
  from public, anon, authenticated;

-- Preserve every existing push type in the new in-app history too.
create or replace function private.mirror_push_to_app_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.app_notifications (
    recipient_id, notification_type, title, body, view, payload, source_key, created_at
  ) values (
    new.recipient_id, new.notification_type, new.title, coalesce(new.body, ''),
    coalesce(nullif(new.payload->>'view', ''), 'home'), coalesce(new.payload, '{}'::jsonb),
    new.dedupe_key, new.created_at
  ) on conflict (source_key) do nothing;
  return new;
end;
$function$;

revoke all on function private.mirror_push_to_app_notification() from public, anon, authenticated;
drop trigger if exists push_notification_app_history on public.push_notification_queue;
create trigger push_notification_app_history
  after insert on public.push_notification_queue
  for each row execute function private.mirror_push_to_app_notification();

create or replace function public.send_my_test_notification()
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_key text;
  v_id uuid;
begin
  if v_user_id is null then raise exception 'You must be signed in'; end if;
  v_key := 'notification-test:' || v_user_id::text || ':' || floor(extract(epoch from now()) / 10)::bigint::text;
  perform private.emit_jkcrew_notification(
    v_user_id, 'notification_test', 'JKCREW notifications are ready 🔔',
    'This test arrived in your notification centre and on every enabled device.',
    case when exists (select 1 from public.profiles where id = v_user_id and role in ('coach','admin')) then 'command' else 'home' end,
    '{}'::jsonb, v_key, null
  );
  select notification.id into v_id from public.app_notifications notification where notification.source_key = v_key;
  return v_id;
end;
$function$;

revoke all on function public.send_my_test_notification() from public, anon;
grant execute on function public.send_my_test_notification() to authenticated;

-- A rider-created private event run becomes an actionable coach notification.
create or replace function private.notify_event_run_saved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare v_name text; v_event text;
begin
  if new.contest_item_id is null or new.created_by is distinct from new.athlete_id then return new; end if;
  select profile.display_name into v_name from public.profiles profile where profile.id = new.athlete_id;
  select item.title into v_event from public.dashboard_items item where item.id = new.contest_item_id;
  perform private.emit_jkcrew_notification(
    new.coach_id, 'event_run_planned', 'New event run to review 🗺️',
    coalesce(v_name, 'A rider') || ' saved a private run for ' || coalesce(v_event, 'an upcoming event') || '.',
    'contests', jsonb_build_object('run_plan_id', new.id, 'athlete_id', new.athlete_id, 'event_id', new.contest_item_id),
    'event-run:' || new.id::text || ':' || extract(epoch from new.updated_at)::bigint::text, 'event'
  );
  return new;
end;
$function$;
revoke all on function private.notify_event_run_saved() from public, anon, authenticated;
drop trigger if exists event_run_saved_notification on public.run_plans;
create trigger event_run_saved_notification
  after insert or update of points, image_data_url on public.run_plans
  for each row execute function private.notify_event_run_saved();

-- Notify riders when a new weekly challenge is published and celebrate completion.
create or replace function private.notify_weekly_challenge_published()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare v_recipient record;
begin
  if new.status <> 'active' then return new; end if;
  for v_recipient in
    select profile.id
    from public.profiles profile
    where profile.role = 'athlete'
      and (new.audience_group is null or exists (
        select 1 from public.coach_athlete_groups membership
        where membership.athlete_id = profile.id and membership.group_name = new.audience_group
      ))
  loop
    perform private.emit_jkcrew_notification(
      v_recipient.id, 'weekly_challenge_published', 'New weekly challenge ⚡',
      new.title || ' · complete it for ' || new.reward_points || ' leaderboard points.',
      'challenges', jsonb_build_object('challenge_id', new.id),
      'weekly-challenge:' || new.id::text || ':' || v_recipient.id::text, 'challenge'
    );
  end loop;
  return new;
end;
$function$;
revoke all on function private.notify_weekly_challenge_published() from public, anon, authenticated;
drop trigger if exists weekly_challenge_published_notification on public.weekly_challenges;
create trigger weekly_challenge_published_notification
  after insert on public.weekly_challenges
  for each row execute function private.notify_weekly_challenge_published();

create or replace function private.notify_weekly_challenge_complete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare v_challenge public.weekly_challenges; v_name text;
begin
  select challenge.* into v_challenge from public.weekly_challenges challenge where challenge.id = new.challenge_id;
  select profile.display_name into v_name from public.profiles profile where profile.id = new.athlete_id;
  perform private.emit_jkcrew_notification(
    new.athlete_id, 'weekly_challenge_completed', 'Weekly challenge complete! +5 🏆',
    'You completed ' || coalesce(v_challenge.title, 'this week''s challenge') || ' and earned 5 leaderboard points.',
    'challenges', jsonb_build_object('challenge_id', new.challenge_id, 'celebration', 'weekly_challenge'),
    'weekly-challenge-complete:' || new.challenge_id::text || ':' || new.athlete_id::text, 'achievement'
  );
  if v_challenge.created_by is not null then
    perform private.emit_jkcrew_notification(
      v_challenge.created_by, 'weekly_challenge_completed', 'Challenge completed 🏆',
      coalesce(v_name, 'A rider') || ' completed ' || coalesce(v_challenge.title, 'the weekly challenge') || '.',
      'battleViewer', jsonb_build_object('challenge_id', new.challenge_id, 'athlete_id', new.athlete_id),
      'weekly-challenge-coach:' || new.challenge_id::text || ':' || new.athlete_id::text, 'challenge'
    );
  end if;
  return new;
end;
$function$;
revoke all on function private.notify_weekly_challenge_complete() from public, anon, authenticated;
drop trigger if exists weekly_challenge_complete_notification on public.weekly_challenge_completions;
create trigger weekly_challenge_complete_notification
  after insert on public.weekly_challenge_completions
  for each row execute function private.notify_weekly_challenge_complete();

-- Battle acceptance and declines were previously only visible after reopening the page.
create or replace function private.notify_battle_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare v_participant record;
begin
  if old.status is not distinct from new.status or new.status not in ('accepted','declined') then return new; end if;
  for v_participant in
    select participant.athlete_id from public.weekly_rider_battle_participants participant where participant.battle_id = new.id
  loop
    perform private.emit_jkcrew_notification(
      v_participant.athlete_id,
      case when new.status = 'accepted' then 'rider_battle_started' else 'rider_battle_declined' end,
      case when new.status = 'accepted' then 'Battle is live! ⚡' else 'Battle declined' end,
      case when new.status = 'accepted' then 'Everyone accepted. Your ' || new.duration_days || '-day battle starts now.' else 'A rider declined this battle request.' end,
      'challenges', jsonb_build_object('battle_id', new.id),
      'battle-status:' || new.id::text || ':' || new.status || ':' || v_participant.athlete_id::text, 'battle'
    );
  end loop;
  return new;
end;
$function$;
revoke all on function private.notify_battle_status_change() from public, anon, authenticated;
drop trigger if exists rider_battle_status_notification on public.weekly_rider_battles;
create trigger rider_battle_status_notification
  after update of status on public.weekly_rider_battles
  for each row execute function private.notify_battle_status_change();

-- A declined list request now has a clear rider alert as well as the approved path.
create or replace function private.notify_list_request_declined()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.status is distinct from new.status and new.status = 'declined' then
    perform private.emit_jkcrew_notification(
      new.athlete_id, 'list_request_declined', 'List request needs changes',
      coalesce(nullif(btrim(new.coach_note), ''), 'Coach JK declined this list request. Open it to make changes.'),
      'home', jsonb_build_object('proposal_id', new.id),
      'list-request-declined:' || new.id::text || ':' || new.athlete_id::text, 'sheet'
    );
  end if;
  return new;
end;
$function$;
revoke all on function private.notify_list_request_declined() from public, anon, authenticated;
drop trigger if exists rider_sheet_declined_notification on public.rider_sheet_proposals;
create trigger rider_sheet_declined_notification
  after update of status on public.rider_sheet_proposals
  for each row execute function private.notify_list_request_declined();

-- One notification per scheduled sheet, even though a plan contains many rows.
create or replace function private.notify_sheet_scheduled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status in ('scheduled_next_week','published')
    and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform private.emit_jkcrew_notification(
      new.athlete_id, 'sheet_scheduled', 'Next week’s sheet is ready 📋',
      'Coach JK scheduled your training sheet for the week starting ' || to_char(new.target_week_start, 'DD Mon') || '.',
      'home', jsonb_build_object('week_start', new.target_week_start),
      'sheet-scheduled:' || new.athlete_id::text || ':' || new.target_week_start::text, 'sheet'
    );
  end if;
  return new;
end;
$function$;
revoke all on function private.notify_sheet_scheduled() from public, anon, authenticated;
drop trigger if exists weekly_sheet_scheduled_notification on public.weekly_assignment_plans;
create trigger weekly_sheet_scheduled_notification
  after insert or update of status on public.weekly_assignment_plans
  for each row execute function private.notify_sheet_scheduled();

-- Event edits and the 24-hour reminder follow the attendee list.
create or replace function private.notify_event_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare v_attendee record;
begin
  if new.item_type <> 'event' or (
    old.title is not distinct from new.title and old.details is not distinct from new.details
    and old.due_at is not distinct from new.due_at and old.end_at is not distinct from new.end_at
  ) then return new; end if;
  for v_attendee in select attendee.athlete_id from public.event_attendees attendee where attendee.event_id = new.id loop
    perform private.emit_jkcrew_notification(
      v_attendee.athlete_id, 'event_updated', 'Event details updated 📅',
      new.title || ' has updated dates or details. Tap to check the latest information.',
      'contests', jsonb_build_object('event_id', new.id),
      'event-updated:' || new.id::text || ':' || extract(epoch from new.updated_at)::bigint::text || ':' || v_attendee.athlete_id::text, 'event'
    );
  end loop;
  return new;
end;
$function$;
revoke all on function private.notify_event_changed() from public, anon, authenticated;
drop trigger if exists contest_event_changed_notification on public.dashboard_items;
create trigger contest_event_changed_notification
  after update of title, details, due_at, end_at on public.dashboard_items
  for each row execute function private.notify_event_changed();

create or replace function private.queue_due_event_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare v_row record; v_count integer := 0;
begin
  for v_row in
    select item.id, item.title, item.due_at, attendee.athlete_id
    from public.dashboard_items item
    join public.event_attendees attendee on attendee.event_id = item.id
    where item.item_type = 'event' and not item.completed
      and item.due_at > now() and item.due_at <= now() + interval '24 hours'
  loop
    perform private.emit_jkcrew_notification(
      v_row.athlete_id, 'event_reminder', 'Event tomorrow 📅',
      v_row.title || ' starts ' || to_char(timezone('Australia/Brisbane', v_row.due_at), 'DD Mon at HH12:MIam') || '.',
      'contests', jsonb_build_object('event_id', v_row.id),
      'event-reminder-24h:' || v_row.id::text || ':' || v_row.athlete_id::text, 'event'
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;
revoke all on function private.queue_due_event_reminders() from public, anon, authenticated;

do $block$
declare v_job record;
begin
  for v_job in select jobid from cron.job where jobname = 'jkcrew-event-reminders' loop
    perform cron.unschedule(v_job.jobid);
  end loop;
  perform cron.schedule('jkcrew-event-reminders', '15 * * * *', 'select private.queue_due_event_reminders();');
end
$block$;

do $block$
begin
  alter publication supabase_realtime add table public.app_notifications;
exception when duplicate_object then null;
end
$block$;

notify pgrst, 'reload schema';
