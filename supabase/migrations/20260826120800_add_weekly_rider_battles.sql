create table if not exists public.weekly_rider_battles (
  id uuid primary key default gen_random_uuid(),
  challenger_id uuid not null references public.profiles(id) on delete cascade,
  opponent_id uuid not null references public.profiles(id) on delete cascade,
  week_start date not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled', 'completed')),
  duration_days integer not null default 7 check (duration_days between 1 and 7),
  starts_at timestamptz,
  ends_at timestamptz,
  winner_id uuid references public.profiles(id) on delete set null,
  reward_points integer not null default 5 check (reward_points = 5),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint weekly_rider_battles_different_riders check (challenger_id <> opponent_id)
);

create index if not exists weekly_rider_battles_challenger_week_idx
  on public.weekly_rider_battles (challenger_id, week_start desc);
create index if not exists weekly_rider_battles_opponent_week_idx
  on public.weekly_rider_battles (opponent_id, week_start desc);
create unique index if not exists weekly_rider_battles_active_pair_idx
  on public.weekly_rider_battles (
    week_start,
    least(challenger_id::text, opponent_id::text),
    greatest(challenger_id::text, opponent_id::text)
  )
  where status in ('pending', 'accepted');

alter table public.weekly_rider_battles enable row level security;

drop policy if exists "battle participants can read their battles" on public.weekly_rider_battles;
create policy "battle participants can read their battles"
  on public.weekly_rider_battles
  for select
  to authenticated
  using (
    (select auth.uid()) = challenger_id
    or (select auth.uid()) = opponent_id
  );

grant select on public.weekly_rider_battles to authenticated;
revoke insert, update, delete on public.weekly_rider_battles from anon, authenticated;

create or replace function public.request_weekly_rider_battle(p_opponent_id uuid, p_duration_days integer default 7)
returns public.weekly_rider_battles
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_week_start date := ((date_trunc('week', timezone('Australia/Brisbane', now()) + interval '1 day') - interval '1 day')::date);
  v_battle public.weekly_rider_battles;
begin
  if v_user_id is null then raise exception 'You must be signed in'; end if;
  if v_user_id <> 'e230a5a6-68ad-4362-b410-b52f45f58e57'::uuid then
    raise exception 'Rider battles are currently available to the Riley Chen test account only';
  end if;
  if p_opponent_id is null or p_opponent_id = v_user_id then raise exception 'Choose another rider'; end if;
  if p_duration_days not between 1 and 7 then raise exception 'Choose a challenge length from 1 to 7 days'; end if;
  if not exists (select 1 from public.profiles where id = v_user_id and role = 'athlete') then
    raise exception 'Only riders can request battles';
  end if;
  if not exists (select 1 from public.profiles where id = p_opponent_id and role = 'athlete' and not coalesce(ghost_mode, false)) then
    raise exception 'That rider is not available for battles';
  end if;
  -- Serialize requests touching either rider so simultaneous requests cannot
  -- slip past the three-active-battle cap.
  perform pg_advisory_xact_lock(hashtextextended(least(v_user_id::text, p_opponent_id::text), 0));
  perform pg_advisory_xact_lock(hashtextextended(greatest(v_user_id::text, p_opponent_id::text), 0));
  if (
    select count(*) from public.weekly_rider_battles
    where status in ('pending', 'accepted')
      and (challenger_id = v_user_id or opponent_id = v_user_id)
  ) >= 3 then
    raise exception 'You can only battle 3 riders at a time';
  end if;
  if (
    select count(*) from public.weekly_rider_battles
    where status in ('pending', 'accepted')
      and (challenger_id = p_opponent_id or opponent_id = p_opponent_id)
  ) >= 3 then
    raise exception 'That rider already has 3 active battles';
  end if;

  insert into public.weekly_rider_battles (challenger_id, opponent_id, week_start, duration_days)
  values (v_user_id, p_opponent_id, v_week_start, p_duration_days)
  returning * into v_battle;

  insert into public.push_notification_queue (
    recipient_id, notification_type, title, body, url, payload, dedupe_key
  )
  select
    p_opponent_id,
    'rider_battle_request',
    'New rider battle',
    coalesce(challenger.display_name, 'A rider') || ' challenged you to a ' || p_duration_days || '-day points battle.',
    './?push=challenges',
    jsonb_build_object('view', 'challenges', 'battle_id', v_battle.id, 'challenger_id', v_user_id),
    'rider-battle:' || v_battle.id::text
  from public.profiles challenger
  where challenger.id = v_user_id
    and exists (
      select 1 from public.push_subscriptions subscription
      where subscription.user_id = p_opponent_id
        and subscription.enabled
    )
  on conflict (dedupe_key) do nothing;

  return v_battle;
exception
  when unique_violation then
    raise exception 'You already have an active battle with this rider this week';
end;
$function$;

create or replace function public.get_public_rider_battle_record(p_athlete_id uuid)
returns table(wins bigint, losses bigint, win_percent integer)
language plpgsql
security definer
set search_path = public
as $function$
begin
  if (select auth.uid()) is null then raise exception 'You must be signed in'; end if;
  if not exists (select 1 from public.profiles where id = p_athlete_id and role = 'athlete') then
    raise exception 'Rider not found';
  end if;
  return query
  with record as (
    select
      count(*) filter (where battle.winner_id = p_athlete_id)::bigint as wins,
      count(*) filter (where battle.winner_id is not null and battle.winner_id <> p_athlete_id)::bigint as losses
    from public.weekly_rider_battles battle
    where battle.status = 'completed'
      and (battle.challenger_id = p_athlete_id or battle.opponent_id = p_athlete_id)
  )
  select record.wins, record.losses,
    case when record.wins + record.losses = 0 then 0 else round((record.wins::numeric / (record.wins + record.losses)) * 100)::integer end
  from record;
end;
$function$;

create or replace function public.respond_weekly_rider_battle(p_battle_id uuid, p_response text)
returns public.weekly_rider_battles
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_battle public.weekly_rider_battles;
begin
  if v_user_id is null then raise exception 'You must be signed in'; end if;
  if p_response not in ('accepted', 'declined') then raise exception 'Choose accept or decline'; end if;

  update public.weekly_rider_battles
  set status = p_response,
      starts_at = case when p_response = 'accepted' then now() else starts_at end,
      ends_at = case when p_response = 'accepted' then now() + make_interval(days => duration_days) else ends_at end,
      responded_at = now(),
      updated_at = now()
  where id = p_battle_id
    and opponent_id = v_user_id
    and status = 'pending'
  returning * into v_battle;

  if v_battle.id is null then raise exception 'That battle request is no longer available'; end if;
  return v_battle;
end;
$function$;

revoke all on function public.request_weekly_rider_battle(uuid, integer) from public, anon;
revoke all on function public.respond_weekly_rider_battle(uuid, text) from public, anon;
revoke all on function public.get_public_rider_battle_record(uuid) from public, anon;
grant execute on function public.request_weekly_rider_battle(uuid, integer) to authenticated;
grant execute on function public.respond_weekly_rider_battle(uuid, text) to authenticated;
grant execute on function public.get_public_rider_battle_record(uuid) to authenticated;
