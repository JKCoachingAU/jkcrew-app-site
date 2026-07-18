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
        and (
          previous_passer.rank_number is null
          or previous_passer.rank_number >= previous_rank.rank_number
        )
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
  v_athlete_id uuid;
  v_row_id text;
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
    tg_table_name || ':' || tg_op || ':' || v_row_id || ':' || gen_random_uuid()::text
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

revoke all on function private.handle_jkcrew_leaderboard_push_change() from public, anon, authenticated;
