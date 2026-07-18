create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  enabled boolean not null default true,
  user_agent text not null default '',
  device_label text not null default '',
  last_success_at timestamptz,
  last_error text not null default '',
  failure_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_enabled_idx
  on public.push_subscriptions (user_id, enabled);

alter table public.push_subscriptions enable row level security;

drop policy if exists "Users view own push subscriptions" on public.push_subscriptions;
create policy "Users view own push subscriptions"
  on public.push_subscriptions for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users create own push subscriptions" on public.push_subscriptions;
create policy "Users create own push subscriptions"
  on public.push_subscriptions for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users update own push subscriptions" on public.push_subscriptions;
create policy "Users update own push subscriptions"
  on public.push_subscriptions for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users delete own push subscriptions" on public.push_subscriptions;
create policy "Users delete own push subscriptions"
  on public.push_subscriptions for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.push_subscriptions to authenticated;

create table if not exists public.push_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  leaderboard_overtaken boolean not null default true,
  crew_chat boolean not null default true,
  parent_weekly_summary boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.push_preferences enable row level security;

drop policy if exists "Users view own push preferences" on public.push_preferences;
create policy "Users view own push preferences"
  on public.push_preferences for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users create own push preferences" on public.push_preferences;
create policy "Users create own push preferences"
  on public.push_preferences for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users update own push preferences" on public.push_preferences;
create policy "Users update own push preferences"
  on public.push_preferences for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users delete own push preferences" on public.push_preferences;
create policy "Users delete own push preferences"
  on public.push_preferences for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.push_preferences to authenticated;

create table if not exists public.push_notification_queue (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  notification_type text not null,
  title text not null,
  body text not null,
  url text not null default './',
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text not null unique,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text not null default ''
);

create index if not exists push_notification_queue_pending_idx
  on public.push_notification_queue (available_at, created_at)
  where status = 'pending';
create index if not exists push_notification_queue_recipient_idx
  on public.push_notification_queue (recipient_id, created_at desc);

alter table public.push_notification_queue enable row level security;
revoke all on public.push_notification_queue from anon, authenticated;
grant all on public.push_notification_queue to service_role;

create table if not exists public.leaderboard_rank_snapshots (
  athlete_id uuid primary key references public.profiles(id) on delete cascade,
  week_start date not null,
  rank_number bigint not null,
  weekly_points bigint not null default 0,
  weekly_started boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.leaderboard_rank_snapshots enable row level security;
revoke all on public.leaderboard_rank_snapshots from anon, authenticated;
grant all on public.leaderboard_rank_snapshots to service_role;

create or replace function private.jkcrew_current_push_rankings()
returns table (
  athlete_id uuid,
  display_name text,
  week_start date,
  weekly_points bigint,
  weekly_started boolean,
  rank_number bigint
)
language sql
stable
security definer
set search_path = public, private
as $function$
  with score_rows as (
    select
      p.id as athlete_id,
      p.display_name,
      b.week_start_date as week_start,
      greatest(
        0,
        coalesce(current_awards.points, 0)
        + coalesce(current_legacy_sessions.points, 0)
        + coalesce(current_adjustments.points, 0)
      )::bigint as weekly_points,
      (
        coalesce(current_awards.events, 0)
        + coalesce(current_legacy_sessions.events, 0)
        + coalesce(current_adjustments.events, 0)
      ) > 0 as weekly_started
    from public.profiles p
    cross join lateral public.jkcrew_week_bounds(p.country_code) b
    left join lateral (
      select coalesce(sum(apa.points), 0)::bigint as points, count(*)::bigint as events
      from public.assignment_point_awards apa
      where apa.athlete_id = p.id
        and apa.created_at >= b.week_start_ts
        and apa.created_at < b.next_week_start_ts
    ) current_awards on true
    left join lateral (
      select coalesce(sum(ts.total_points), 0)::bigint as points, count(*)::bigint as events
      from public.training_sessions ts
      where ts.athlete_id = p.id
        and ts.started_at >= b.week_start_ts
        and ts.started_at < b.next_week_start_ts
        and coalesce(ts.total_points, 0) <> 0
        and not exists (
          select 1 from public.assignment_point_awards apa where apa.session_id = ts.id
        )
    ) current_legacy_sessions on true
    left join lateral (
      select coalesce(sum(lpa.points), 0)::bigint as points, count(*)::bigint as events
      from public.leaderboard_point_adjustments lpa
      where lpa.athlete_id = p.id
        and lpa.week_start = b.week_start_date
        and coalesce(lpa.reason, '') not ilike 'All-time score correction%'
    ) current_adjustments on true
    where p.role = 'athlete'
      and coalesce(p.ghost_mode, false) = false
  ), ranked as (
    select
      score_rows.*,
      rank() over (
        order by
          case when score_rows.weekly_started or score_rows.weekly_points > 0 then 0 else 1 end,
          score_rows.weekly_points desc,
          score_rows.display_name asc
      ) as rank_number
    from score_rows
  )
  select
    ranked.athlete_id,
    ranked.display_name,
    ranked.week_start,
    ranked.weekly_points,
    (ranked.weekly_started or ranked.weekly_points > 0) as weekly_started,
    ranked.rank_number
  from ranked;
$function$;

revoke all on function private.jkcrew_current_push_rankings() from public, anon, authenticated;

create or replace function private.refresh_jkcrew_leaderboard_push_snapshots(
  p_changed_athlete uuid,
  p_event_key text
)
returns void
language plpgsql
security definer
set search_path = public, private, vault
as $function$
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
    current_rank.athlete_id,
    'leaderboard_overtaken',
    'You were overtaken',
    case
      when passer.athlete_id is not null
        then passer.display_name || ' moved ahead of you. You are now #' || current_rank.rank_number || ' with ' || current_rank.weekly_points || ' points.'
      else 'The leaderboard changed. You are now #' || current_rank.rank_number || ' with ' || current_rank.weekly_points || ' points.'
    end,
    './?push=board',
    jsonb_build_object(
      'view', 'board',
      'rank', current_rank.rank_number,
      'weekly_points', current_rank.weekly_points,
      'overtaken_by', passer.athlete_id
    ),
    'leaderboard-overtaken:' || p_event_key || ':' || current_rank.athlete_id
  from private.jkcrew_current_push_rankings() current_rank
  join public.leaderboard_rank_snapshots previous_rank
    on previous_rank.athlete_id = current_rank.athlete_id
   and previous_rank.week_start = current_rank.week_start
  left join private.jkcrew_current_push_rankings() passer
    on passer.athlete_id = p_changed_athlete
  left join public.leaderboard_rank_snapshots previous_passer
    on previous_passer.athlete_id = p_changed_athlete
   and previous_passer.week_start = previous_rank.week_start
  left join public.push_preferences preference
    on preference.user_id = current_rank.athlete_id
  where current_rank.athlete_id <> p_changed_athlete
    and current_rank.weekly_started
    and current_rank.rank_number > previous_rank.rank_number
    and coalesce(preference.leaderboard_overtaken, true)
    and exists (
      select 1
      from public.push_subscriptions subscription
      where subscription.user_id = current_rank.athlete_id
        and subscription.enabled
    )
    and (
      passer.athlete_id is null
      or (
        passer.rank_number < current_rank.rank_number
        and previous_passer.rank_number >= previous_rank.rank_number
      )
    )
  on conflict (dedupe_key) do nothing;

  insert into public.leaderboard_rank_snapshots (
    athlete_id,
    week_start,
    rank_number,
    weekly_points,
    weekly_started,
    updated_at
  )
  select
    current_rank.athlete_id,
    current_rank.week_start,
    current_rank.rank_number,
    current_rank.weekly_points,
    current_rank.weekly_started,
    now()
  from private.jkcrew_current_push_rankings() current_rank
  on conflict (athlete_id) do update set
    week_start = excluded.week_start,
    rank_number = excluded.rank_number,
    weekly_points = excluded.weekly_points,
    weekly_started = excluded.weekly_started,
    updated_at = excluded.updated_at;
exception when others then
  raise warning 'JKCREW leaderboard push refresh skipped: %', sqlerrm;
end;
$function$;

revoke all on function private.refresh_jkcrew_leaderboard_push_snapshots(uuid, text) from public, anon, authenticated;

create or replace function private.handle_jkcrew_leaderboard_push_change()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  v_athlete_id uuid := coalesce(new.athlete_id, old.athlete_id);
  v_row_id text := coalesce(new.id::text, old.id::text, gen_random_uuid()::text);
begin
  if tg_op = 'DELETE' then
    v_athlete_id := old.athlete_id;
    v_row_id := coalesce(old.id::text, gen_random_uuid()::text);
  else
    v_athlete_id := new.athlete_id;
    v_row_id := coalesce(new.id::text, gen_random_uuid()::text);
  end if;

  perform private.refresh_jkcrew_leaderboard_push_snapshots(
    v_athlete_id,
    tg_table_name || ':' || tg_op || ':' || v_row_id || ':' || extract(epoch from clock_timestamp())::bigint
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

drop trigger if exists assignment_awards_leaderboard_push on public.assignment_point_awards;
create trigger assignment_awards_leaderboard_push
  after insert or update or delete on public.assignment_point_awards
  for each row execute function private.handle_jkcrew_leaderboard_push_change();

drop trigger if exists point_adjustments_leaderboard_push on public.leaderboard_point_adjustments;
create trigger point_adjustments_leaderboard_push
  after insert or update or delete on public.leaderboard_point_adjustments
  for each row execute function private.handle_jkcrew_leaderboard_push_change();

drop trigger if exists training_sessions_leaderboard_push on public.training_sessions;
create trigger training_sessions_leaderboard_push
  after insert or delete or update of total_points on public.training_sessions
  for each row execute function private.handle_jkcrew_leaderboard_push_change();

create or replace function private.queue_jkcrew_chat_push()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  v_author_name text;
begin
  if new.post_type <> 'chat' or btrim(coalesce(new.body, '')) = '' then
    return new;
  end if;

  select p.display_name into v_author_name
  from public.profiles p
  where p.id = new.author_id;

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
    recipient.id,
    'crew_chat',
    'Crew chat · ' || coalesce(v_author_name, 'JKCREW'),
    left(regexp_replace(btrim(new.body), '[[:space:]]+', ' ', 'g'), 180),
    './?push=board',
    jsonb_build_object('view', 'board', 'post_id', new.id, 'author_id', new.author_id),
    'crew-chat:' || new.id || ':' || recipient.id
  from public.profiles recipient
  left join public.push_preferences preference on preference.user_id = recipient.id
  where recipient.id <> new.author_id
    and recipient.role in ('athlete', 'coach', 'admin')
    and coalesce(preference.crew_chat, true)
    and exists (
      select 1
      from public.push_subscriptions subscription
      where subscription.user_id = recipient.id
        and subscription.enabled
    )
  on conflict (dedupe_key) do nothing;

  return new;
exception when others then
  raise warning 'JKCREW crew chat push skipped: %', sqlerrm;
  return new;
end;
$function$;

drop trigger if exists crew_posts_push_notification on public.crew_posts;
create trigger crew_posts_push_notification
  after insert on public.crew_posts
  for each row execute function private.queue_jkcrew_chat_push();

create or replace function private.jkcrew_points_for_window(
  p_athlete_id uuid,
  p_week_start_ts timestamptz,
  p_next_week_start_ts timestamptz,
  p_week_start_date date
)
returns bigint
language sql
stable
security definer
set search_path = public, private
as $function$
  select greatest(
    0,
    coalesce((
      select sum(apa.points)
      from public.assignment_point_awards apa
      where apa.athlete_id = p_athlete_id
        and apa.created_at >= p_week_start_ts
        and apa.created_at < p_next_week_start_ts
    ), 0)
    + coalesce((
      select sum(ts.total_points)
      from public.training_sessions ts
      where ts.athlete_id = p_athlete_id
        and ts.started_at >= p_week_start_ts
        and ts.started_at < p_next_week_start_ts
        and coalesce(ts.total_points, 0) <> 0
        and not exists (
          select 1 from public.assignment_point_awards apa where apa.session_id = ts.id
        )
    ), 0)
    + coalesce((
      select sum(lpa.points)
      from public.leaderboard_point_adjustments lpa
      where lpa.athlete_id = p_athlete_id
        and lpa.week_start = p_week_start_date
        and coalesce(lpa.reason, '') not ilike 'All-time score correction%'
    ), 0)
  )::bigint;
$function$;

revoke all on function private.jkcrew_points_for_window(uuid, timestamptz, timestamptz, date) from public, anon, authenticated;

create or replace function private.queue_due_parent_weekly_summaries()
returns integer
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  v_queued integer := 0;
begin
  with candidates as (
    select
      pa.parent_id,
      pa.athlete_id,
      pa.coach_id,
      athlete.display_name,
      target_bounds.week_start_date,
      target_bounds.week_start_ts,
      target_bounds.next_week_start_ts,
      private.jkcrew_points_for_window(
        pa.athlete_id,
        target_bounds.week_start_ts,
        target_bounds.next_week_start_ts,
        target_bounds.week_start_date
      ) as weekly_points
    from public.parent_athletes pa
    join public.profiles athlete on athlete.id = pa.athlete_id
    left join public.weekly_progress_notification_settings settings on settings.coach_id = pa.coach_id
    cross join lateral public.jkcrew_week_bounds(athlete.country_code, now()) current_bounds
    cross join lateral public.jkcrew_week_bounds(
      athlete.country_code,
      current_bounds.week_start_ts - interval '1 second'
    ) target_bounds
    left join public.push_preferences preference on preference.user_id = pa.parent_id
    where coalesce(settings.enabled, true)
      and coalesce(settings.parent_summaries_enabled, true)
      and coalesce(preference.parent_weekly_summary, true)
      and extract(dow from (now() at time zone coalesce(settings.timezone, 'Australia/Brisbane')))::integer = coalesce(settings.send_day, 0)
      and (now() at time zone coalesce(settings.timezone, 'Australia/Brisbane'))::time >= coalesce(settings.send_time, time '19:30')
      and exists (
        select 1
        from public.push_subscriptions subscription
        where subscription.user_id = pa.parent_id
          and subscription.enabled
      )
  ), completion as (
    select
      candidate.*,
      coalesce(progress.total_items, 0) as total_items,
      coalesce(progress.completed_items, 0) as completed_items,
      case
        when coalesce(progress.total_items, 0) = 0 then 0
        else round((progress.completed_items::numeric / progress.total_items::numeric) * 100)::integer
      end as completion_percent
    from candidates candidate
    left join lateral (
      select
        count(*)::integer as total_items,
        count(*) filter (
          where (
            assignment.category = 'percentage'
            and (
              select count(*)
              from public.percentage_attempts attempt
              where attempt.assignment_id = assignment.id
                and attempt.athlete_id = assignment.athlete_id
            ) >= 10
          ) or (
            assignment.category <> 'percentage'
            and exists (
              select 1
              from public.assignment_progress assignment_done
              where assignment_done.assignment_id = assignment.id
                and assignment_done.athlete_id = assignment.athlete_id
                and assignment_done.completed_at is not null
            )
          )
        )::integer as completed_items
      from public.weekly_trick_assignments assignment
      where assignment.athlete_id = candidate.athlete_id
        and assignment.week_start = candidate.week_start_date
        and assignment.category in ('dialled', 'one_bang', 'foam_pit', 'foam', 'bonus', 'percentage')
    ) progress on true
  ), recorded as (
    insert into public.weekly_progress_notifications (
      coach_id,
      athlete_id,
      recipient_type,
      recipient_id,
      week_start,
      week_end,
      title,
      summary,
      status,
      stats,
      sent_at
    )
    select
      completion.coach_id,
      completion.athlete_id,
      'parent',
      completion.parent_id,
      completion.week_start_date,
      completion.week_start_date + 6,
      completion.display_name || '''s weekly BMX update',
      completion.display_name || ' earned ' || completion.weekly_points || ' points and completed ' || completion.completion_percent || '% of their weekly BMX program this week.',
      'sent',
      jsonb_build_object(
        'weekly_points', completion.weekly_points,
        'completion_percent', completion.completion_percent,
        'completed_items', completion.completed_items,
        'total_items', completion.total_items
      ),
      now()
    from completion
    on conflict (athlete_id, recipient_type, recipient_id, week_start) do update set
      title = excluded.title,
      summary = excluded.summary,
      status = 'sent',
      stats = excluded.stats,
      sent_at = coalesce(public.weekly_progress_notifications.sent_at, excluded.sent_at)
    returning recipient_id, athlete_id, week_start, title, summary, stats
  )
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
    recorded.recipient_id,
    'parent_weekly_summary',
    recorded.title,
    recorded.summary,
    './?push=home',
    recorded.stats || jsonb_build_object('view', 'home', 'athlete_id', recorded.athlete_id),
    'parent-weekly:' || recorded.recipient_id || ':' || recorded.athlete_id || ':' || recorded.week_start
  from recorded
  on conflict (dedupe_key) do nothing;

  get diagnostics v_queued = row_count;
  return v_queued;
end;
$function$;

revoke all on function private.queue_due_parent_weekly_summaries() from public, anon, authenticated;

create or replace function public.get_jkcrew_push_worker_config(p_worker_secret text)
returns table (vapid_public_key text, vapid_private_key text, vapid_subject text)
language plpgsql
security definer
set search_path = public, vault
as $function$
declare
  v_expected_secret text;
begin
  select secret into v_expected_secret
  from vault.decrypted_secrets
  where name = 'jkcrew_push_worker_secret'
  limit 1;

  if v_expected_secret is null or p_worker_secret is distinct from v_expected_secret then
    raise exception 'Invalid push worker secret.';
  end if;

  return query
  select
    max(secret) filter (where name = 'jkcrew_vapid_public_key'),
    max(secret) filter (where name = 'jkcrew_vapid_private_key'),
    coalesce(max(secret) filter (where name = 'jkcrew_vapid_subject'), 'mailto:joshkhourybmx@gmail.com')
  from vault.decrypted_secrets;
end;
$function$;

revoke all on function public.get_jkcrew_push_worker_config(text) from public, anon, authenticated;
grant execute on function public.get_jkcrew_push_worker_config(text) to service_role;

create or replace function public.claim_jkcrew_push_notifications(
  p_worker_secret text,
  p_limit integer default 50
)
returns setof public.push_notification_queue
language plpgsql
security definer
set search_path = public, vault
as $function$
declare
  v_expected_secret text;
begin
  select secret into v_expected_secret
  from vault.decrypted_secrets
  where name = 'jkcrew_push_worker_secret'
  limit 1;

  if v_expected_secret is null or p_worker_secret is distinct from v_expected_secret then
    raise exception 'Invalid push worker secret.';
  end if;

  return query
  with selected as (
    select queue.id
    from public.push_notification_queue queue
    where queue.status = 'pending'
      and queue.available_at <= now()
    order by queue.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  )
  update public.push_notification_queue queue
  set status = 'processing',
      attempts = queue.attempts + 1,
      processed_at = now()
  from selected
  where queue.id = selected.id
  returning queue.*;
end;
$function$;

revoke all on function public.claim_jkcrew_push_notifications(text, integer) from public, anon, authenticated;
grant execute on function public.claim_jkcrew_push_notifications(text, integer) to service_role;

create or replace function public.finish_jkcrew_push_notification(
  p_worker_secret text,
  p_notification_id uuid,
  p_delivered integer,
  p_failed integer,
  p_error text default ''
)
returns void
language plpgsql
security definer
set search_path = public, vault
as $function$
declare
  v_expected_secret text;
begin
  select secret into v_expected_secret
  from vault.decrypted_secrets
  where name = 'jkcrew_push_worker_secret'
  limit 1;

  if v_expected_secret is null or p_worker_secret is distinct from v_expected_secret then
    raise exception 'Invalid push worker secret.';
  end if;

  update public.push_notification_queue queue
  set status = case
        when coalesce(p_delivered, 0) > 0 then 'sent'
        when coalesce(p_failed, 0) = 0 then 'skipped'
        when queue.attempts < 5 then 'pending'
        else 'failed'
      end,
      available_at = case
        when coalesce(p_delivered, 0) = 0 and coalesce(p_failed, 0) > 0 and queue.attempts < 5
          then now() + make_interval(mins => least(30, queue.attempts * 3))
        else queue.available_at
      end,
      processed_at = now(),
      last_error = left(coalesce(p_error, ''), 1000)
  where queue.id = p_notification_id;
end;
$function$;

revoke all on function public.finish_jkcrew_push_notification(text, uuid, integer, integer, text) from public, anon, authenticated;
grant execute on function public.finish_jkcrew_push_notification(text, uuid, integer, integer, text) to service_role;

create or replace function private.kick_jkcrew_push_worker()
returns void
language plpgsql
security definer
set search_path = public, vault, net
as $function$
declare
  v_worker_secret text;
begin
  select secret into v_worker_secret
  from vault.decrypted_secrets
  where name = 'jkcrew_push_worker_secret'
  limit 1;

  if v_worker_secret is null then
    return;
  end if;

  perform net.http_post(
    url := 'https://soanwttlorlgdfrzbvtp.supabase.co/functions/v1/send-jkcrew-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-worker-secret', v_worker_secret
    ),
    body := jsonb_build_object('source', 'database')
  );
exception when others then
  raise warning 'JKCREW push worker kick skipped: %', sqlerrm;
end;
$function$;

revoke all on function private.kick_jkcrew_push_worker() from public, anon, authenticated;

create or replace function private.kick_jkcrew_push_worker_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $function$
begin
  perform private.kick_jkcrew_push_worker();
  return null;
end;
$function$;

drop trigger if exists push_queue_kick_worker on public.push_notification_queue;
create trigger push_queue_kick_worker
  after insert on public.push_notification_queue
  for each statement execute function private.kick_jkcrew_push_worker_after_insert();

insert into public.leaderboard_rank_snapshots (
  athlete_id,
  week_start,
  rank_number,
  weekly_points,
  weekly_started,
  updated_at
)
select
  current_rank.athlete_id,
  current_rank.week_start,
  current_rank.rank_number,
  current_rank.weekly_points,
  current_rank.weekly_started,
  now()
from private.jkcrew_current_push_rankings() current_rank
on conflict (athlete_id) do update set
  week_start = excluded.week_start,
  rank_number = excluded.rank_number,
  weekly_points = excluded.weekly_points,
  weekly_started = excluded.weekly_started,
  updated_at = excluded.updated_at;

do $block$
declare
  v_job record;
begin
  for v_job in select jobid from cron.job where jobname in ('jkcrew-parent-weekly-push', 'jkcrew-push-worker') loop
    perform cron.unschedule(v_job.jobid);
  end loop;

  perform cron.schedule(
    'jkcrew-parent-weekly-push',
    '*/5 * * * *',
    'select private.queue_due_parent_weekly_summaries();'
  );
  perform cron.schedule(
    'jkcrew-push-worker',
    '*/2 * * * *',
    'select private.kick_jkcrew_push_worker();'
  );
end
$block$;
