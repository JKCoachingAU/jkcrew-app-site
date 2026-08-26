-- Release rider battles to every athlete, add team battles, and add coach-managed weekly challenges.
-- This migration is additive: existing rider assignments, scores, XP, badges and battle history are preserved.

alter table public.weekly_rider_battles
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists battle_size integer not null default 1 check (battle_size between 1 and 3),
  add column if not exists winning_team integer check (winning_team in (1, 2));

update public.weekly_rider_battles
set created_by = challenger_id
where created_by is null;

create table if not exists public.weekly_rider_battle_participants (
  battle_id uuid not null references public.weekly_rider_battles(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  team_number integer not null check (team_number in (1, 2)),
  response text not null default 'pending' check (response in ('pending', 'accepted', 'declined')),
  responded_at timestamptz,
  baseline_points integer not null default 0,
  is_winner boolean,
  points_delta integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (battle_id, athlete_id)
);

create index if not exists rider_battle_participant_athlete_idx
  on public.weekly_rider_battle_participants (athlete_id, battle_id);

insert into public.weekly_rider_battle_participants (battle_id, athlete_id, team_number, response, responded_at)
select battle.id, battle.challenger_id, 1, 'accepted', battle.created_at
from public.weekly_rider_battles battle
on conflict (battle_id, athlete_id) do nothing;

insert into public.weekly_rider_battle_participants (battle_id, athlete_id, team_number, response, responded_at)
select battle.id, battle.opponent_id, 2,
  case when battle.status in ('accepted', 'completed') then 'accepted'
       when battle.status = 'declined' then 'declined'
       else 'pending' end,
  battle.responded_at
from public.weekly_rider_battles battle
on conflict (battle_id, athlete_id) do nothing;

alter table public.weekly_rider_battle_participants enable row level security;

create or replace function public.can_view_rider_battle(p_battle_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select auth.uid() is not null and (
    exists (
      select 1 from public.weekly_rider_battle_participants participant
      where participant.battle_id = p_battle_id and participant.athlete_id = auth.uid()
    )
    or exists (
      select 1
      from public.profiles me
      where me.id = auth.uid() and me.role in ('coach', 'admin')
        and exists (
          select 1
          from public.weekly_rider_battle_participants participant
          join public.coach_athletes link on link.athlete_id = participant.athlete_id
          where participant.battle_id = p_battle_id and link.coach_id = auth.uid()
        )
    )
  );
$function$;

drop policy if exists "battle participants can read their battles" on public.weekly_rider_battles;
create policy "battle participants and coaches can read battles"
  on public.weekly_rider_battles for select to authenticated
  using (public.can_view_rider_battle(id));

drop policy if exists "battle participants can read team members" on public.weekly_rider_battle_participants;
create policy "battle participants can read team members"
  on public.weekly_rider_battle_participants for select to authenticated
  using (public.can_view_rider_battle(battle_id));

grant select on public.weekly_rider_battles, public.weekly_rider_battle_participants to authenticated;
revoke insert, update, delete on public.weekly_rider_battles, public.weekly_rider_battle_participants from anon, authenticated;
revoke all on function public.can_view_rider_battle(uuid) from public, anon;
grant execute on function public.can_view_rider_battle(uuid) to authenticated;

create or replace function public.current_rider_weekly_points(p_athlete_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $function$
  select coalesce((select weekly_points::integer from public.get_weekly_leaderboard() where athlete_id = p_athlete_id), 0);
$function$;

create or replace function public.settle_expired_rider_battles()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_battle record;
  v_team_1_score integer;
  v_team_2_score integer;
  v_winning_team integer;
  v_winner_id uuid;
  v_settled integer := 0;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;

  for v_battle in
    select battle.*
    from public.weekly_rider_battles battle
    where battle.status = 'accepted' and battle.ends_at <= now()
    for update skip locked
  loop
    select coalesce(sum(greatest(0, public.current_rider_weekly_points(participant.athlete_id) - participant.baseline_points)), 0)
      into v_team_1_score
    from public.weekly_rider_battle_participants participant
    where participant.battle_id = v_battle.id and participant.team_number = 1;

    select coalesce(sum(greatest(0, public.current_rider_weekly_points(participant.athlete_id) - participant.baseline_points)), 0)
      into v_team_2_score
    from public.weekly_rider_battle_participants participant
    where participant.battle_id = v_battle.id and participant.team_number = 2;

    v_winning_team := case when v_team_1_score > v_team_2_score then 1 when v_team_2_score > v_team_1_score then 2 else null end;
    select participant.athlete_id into v_winner_id
    from public.weekly_rider_battle_participants participant
    where participant.battle_id = v_battle.id and participant.team_number = v_winning_team
    order by participant.athlete_id limit 1;

    with ranked as (
      select participant.battle_id, participant.athlete_id, participant.team_number,
        row_number() over (partition by participant.team_number order by participant.athlete_id) as team_rank
      from public.weekly_rider_battle_participants participant
      where participant.battle_id = v_battle.id
    )
    update public.weekly_rider_battle_participants participant
    set is_winner = case when v_winning_team is null then null else participant.team_number = v_winning_team end,
        points_delta = case
          when v_winning_team is null then 0
          when participant.team_number = v_winning_team then
            (v_battle.reward_points / v_battle.battle_size)
            + case when ranked.team_rank <= (v_battle.reward_points % v_battle.battle_size) then 1 else 0 end
          else -((v_battle.reward_points / v_battle.battle_size)
            + case when ranked.team_rank <= (v_battle.reward_points % v_battle.battle_size) then 1 else 0 end)
        end
    from ranked
    where participant.battle_id = ranked.battle_id and participant.athlete_id = ranked.athlete_id;

    if v_winning_team is not null then
      insert into public.leaderboard_point_adjustments (athlete_id, coach_id, points, reason, week_start, created_at)
      select participant.athlete_id, coalesce(v_battle.created_by, v_battle.challenger_id), participant.points_delta,
        'Rider battle ' || v_battle.id::text || case when participant.points_delta > 0 then ' win' else ' loss' end,
        v_battle.week_start, now()
      from public.weekly_rider_battle_participants participant
      where participant.battle_id = v_battle.id and participant.points_delta <> 0;
    end if;

    update public.weekly_rider_battles
    set status = 'completed', winning_team = v_winning_team, winner_id = v_winner_id,
        responded_at = coalesce(responded_at, now()), updated_at = now()
    where id = v_battle.id;

    insert into public.push_notification_queue (recipient_id, notification_type, title, body, url, payload, dedupe_key)
    select participant.athlete_id, 'rider_battle_result',
      case when v_winning_team is null then 'Battle draw' when participant.team_number = v_winning_team then 'Battle won!' else 'Battle complete' end,
      case when v_winning_team is null then 'The battle finished level.'
           when participant.team_number = v_winning_team then 'Your team won. ' || abs(participant.points_delta) || ' leaderboard points were added.'
           else 'The other team won this battle. Time for the rematch.' end,
      './?push=challenges', jsonb_build_object('view', 'challenges', 'battle_id', v_battle.id),
      'rider-battle-result:' || v_battle.id::text || ':' || participant.athlete_id::text
    from public.weekly_rider_battle_participants participant
    where participant.battle_id = v_battle.id
    on conflict (dedupe_key) do nothing;

    v_settled := v_settled + 1;
  end loop;
  return v_settled;
end;
$function$;

create or replace function public.request_rider_battle(p_team_one uuid[], p_team_two uuid[], p_duration_days integer default 7)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_is_coach boolean;
  v_size integer := coalesce(cardinality(p_team_one), 0);
  v_all uuid[];
  v_athlete uuid;
  v_battle_id uuid;
  v_week_start date := ((date_trunc('week', timezone('Australia/Brisbane', now()) + interval '1 day') - interval '1 day')::date);
begin
  if v_user_id is null then raise exception 'You must be signed in'; end if;
  select role in ('coach', 'admin') into v_is_coach from public.profiles where id = v_user_id;
  if v_size not between 1 and 3 or cardinality(p_team_two) <> v_size then raise exception 'Choose equal 1, 2 or 3 rider teams'; end if;
  if p_duration_days not between 1 and 7 then raise exception 'Choose a battle length from 1 to 7 days'; end if;
  v_all := p_team_one || p_team_two;
  if (select count(distinct chosen.rider_id) from unnest(v_all) as chosen(rider_id)) <> cardinality(v_all) then raise exception 'Each rider can only appear once'; end if;
  if not coalesce(v_is_coach, false) and not (v_user_id = any(p_team_one)) then raise exception 'Your own team must include you'; end if;
  if not coalesce(v_is_coach, false) and not exists (select 1 from public.profiles where id = v_user_id and role = 'athlete') then raise exception 'Only riders or coaches can create battles'; end if;

  foreach v_athlete in array v_all loop
    if not exists (select 1 from public.profiles where id = v_athlete and role = 'athlete' and not coalesce(ghost_mode, false)) then raise exception 'One selected rider is unavailable'; end if;
    if coalesce(v_is_coach, false) and not exists (select 1 from public.coach_athletes where coach_id = v_user_id and athlete_id = v_athlete) then raise exception 'You can only create battles for riders in your crew'; end if;
    perform pg_advisory_xact_lock(hashtextextended(v_athlete::text, 0));
    if (select count(distinct participant.battle_id)
        from public.weekly_rider_battle_participants participant
        join public.weekly_rider_battles battle on battle.id = participant.battle_id
        where participant.athlete_id = v_athlete and battle.status in ('pending', 'accepted')) >= 3 then
      raise exception 'Every rider can have a maximum of 3 active battles';
    end if;
  end loop;

  insert into public.weekly_rider_battles (
    challenger_id, opponent_id, week_start, duration_days, created_by, battle_size, status
  ) values (p_team_one[1], p_team_two[1], v_week_start, p_duration_days, v_user_id, v_size, 'pending')
  returning id into v_battle_id;

  insert into public.weekly_rider_battle_participants (battle_id, athlete_id, team_number, response, responded_at)
  select v_battle_id, rider_id, 1,
    case when not coalesce(v_is_coach, false) and rider_id = v_user_id then 'accepted' else 'pending' end,
    case when not coalesce(v_is_coach, false) and rider_id = v_user_id then now() else null end
  from unnest(p_team_one) rider_id;
  insert into public.weekly_rider_battle_participants (battle_id, athlete_id, team_number, response)
  select v_battle_id, rider_id, 2, 'pending' from unnest(p_team_two) rider_id;

  insert into public.push_notification_queue (recipient_id, notification_type, title, body, url, payload, dedupe_key)
  select participant.athlete_id, 'rider_battle_request',
    case when v_size = 1 then 'New 1v1 battle' else 'New ' || v_size || 'v' || v_size || ' team battle' end,
    coalesce(creator.display_name, 'Coach JK') || ' invited you to a ' || p_duration_days || '-day battle. Tap to accept or decline.',
    './?push=challenges', jsonb_build_object('view', 'challenges', 'battle_id', v_battle_id),
    'rider-battle:' || v_battle_id::text || ':' || participant.athlete_id::text
  from public.weekly_rider_battle_participants participant
  left join public.profiles creator on creator.id = v_user_id
  where participant.battle_id = v_battle_id and participant.response = 'pending'
  on conflict (dedupe_key) do nothing;
  return v_battle_id;
end;
$function$;

create or replace function public.respond_rider_battle(p_battle_id uuid, p_response text)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_battle public.weekly_rider_battles;
begin
  if v_user_id is null then raise exception 'You must be signed in'; end if;
  if p_response not in ('accepted', 'declined') then raise exception 'Choose accept or decline'; end if;
  update public.weekly_rider_battle_participants
  set response = p_response, responded_at = now()
  where battle_id = p_battle_id and athlete_id = v_user_id and response = 'pending';
  if not found then raise exception 'That battle request is no longer available'; end if;
  select * into v_battle from public.weekly_rider_battles where id = p_battle_id for update;
  if p_response = 'declined' then
    update public.weekly_rider_battles set status = 'declined', responded_at = now(), updated_at = now() where id = p_battle_id;
    return 'declined';
  end if;
  if not exists (select 1 from public.weekly_rider_battle_participants where battle_id = p_battle_id and response = 'pending') then
    update public.weekly_rider_battle_participants participant
    set baseline_points = public.current_rider_weekly_points(participant.athlete_id)
    where participant.battle_id = p_battle_id;
    update public.weekly_rider_battles
    set status = 'accepted', starts_at = now(), ends_at = now() + make_interval(days => duration_days), responded_at = now(), updated_at = now()
    where id = p_battle_id;
    return 'accepted';
  end if;
  return 'pending';
end;
$function$;

create or replace function public.get_my_rider_battles()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform public.settle_expired_rider_battles();
  select coalesce(jsonb_agg(row_data order by (row_data->>'created_at')::timestamptz desc), '[]'::jsonb) into v_result
  from (
    select jsonb_build_object(
      'id', battle.id, 'week_start', battle.week_start, 'status', battle.status,
      'duration_days', battle.duration_days, 'starts_at', battle.starts_at, 'ends_at', battle.ends_at,
      'reward_points', battle.reward_points, 'battle_size', battle.battle_size,
      'winning_team', battle.winning_team, 'created_at', battle.created_at,
      'participants', (
        select jsonb_agg(jsonb_build_object(
          'athlete_id', participant.athlete_id, 'team_number', participant.team_number,
          'response', participant.response, 'is_winner', participant.is_winner,
          'points_delta', participant.points_delta, 'display_name', profile.display_name,
          'avatar', profile.avatar, 'level', profile.level,
          'weekly_points', public.current_rider_weekly_points(participant.athlete_id)
        ) order by participant.team_number, profile.display_name)
        from public.weekly_rider_battle_participants participant
        join public.profiles profile on profile.id = participant.athlete_id
        where participant.battle_id = battle.id
      )
    ) row_data
    from public.weekly_rider_battles battle
    where exists (select 1 from public.weekly_rider_battle_participants mine where mine.battle_id = battle.id and mine.athlete_id = auth.uid())
  ) rows;
  return v_result;
end;
$function$;

create or replace function public.get_coach_rider_battles_v2(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare v_user_id uuid := auth.uid(); v_result jsonb;
begin
  if not exists (select 1 from public.profiles where id = v_user_id and role in ('coach', 'admin')) then raise exception 'Only coaches can view rider battles'; end if;
  perform public.settle_expired_rider_battles();
  select coalesce(jsonb_agg(row_data order by (row_data->>'created_at')::timestamptz desc), '[]'::jsonb) into v_result
  from (
    select jsonb_build_object(
      'id', battle.id, 'status', battle.status, 'duration_days', battle.duration_days,
      'starts_at', battle.starts_at, 'ends_at', battle.ends_at, 'reward_points', battle.reward_points,
      'battle_size', battle.battle_size, 'winning_team', battle.winning_team, 'created_at', battle.created_at,
      'participants', (
        select jsonb_agg(jsonb_build_object(
          'athlete_id', participant.athlete_id, 'team_number', participant.team_number,
          'response', participant.response, 'is_winner', participant.is_winner,
          'points_delta', participant.points_delta, 'display_name', profile.display_name,
          'avatar', profile.avatar, 'weekly_points', public.current_rider_weekly_points(participant.athlete_id)
        ) order by participant.team_number, profile.display_name)
        from public.weekly_rider_battle_participants participant join public.profiles profile on profile.id = participant.athlete_id
        where participant.battle_id = battle.id
      )
    ) row_data
    from public.weekly_rider_battles battle
    where exists (
      select 1 from public.weekly_rider_battle_participants participant
      join public.coach_athletes link on link.athlete_id = participant.athlete_id
      where participant.battle_id = battle.id and link.coach_id = v_user_id
    )
    limit least(greatest(coalesce(p_limit, 100), 1), 250)
  ) rows;
  return v_result;
end;
$function$;

create or replace function public.get_my_rider_battle_record()
returns table(wins bigint, losses bigint, win_percent integer)
language sql
security definer
set search_path = public
as $function$
  with record as (
    select count(*) filter (where participant.is_winner)::bigint wins,
      count(*) filter (where participant.is_winner = false)::bigint losses
    from public.weekly_rider_battle_participants participant
    join public.weekly_rider_battles battle on battle.id = participant.battle_id
    where participant.athlete_id = auth.uid() and battle.status = 'completed'
  )
  select wins, losses, case when wins + losses = 0 then 0 else round(100.0 * wins / (wins + losses))::integer end from record;
$function$;

-- Keep legacy 1v1 clients working, but remove the Riley-only release guard.
create or replace function public.request_weekly_rider_battle(p_opponent_id uuid, p_duration_days integer default 7)
returns public.weekly_rider_battles
language plpgsql security definer set search_path = public
as $function$
declare v_id uuid; v_battle public.weekly_rider_battles;
begin
  v_id := public.request_rider_battle(array[auth.uid()], array[p_opponent_id], p_duration_days);
  select * into v_battle from public.weekly_rider_battles where id = v_id;
  return v_battle;
end;
$function$;

create or replace function public.respond_weekly_rider_battle(p_battle_id uuid, p_response text)
returns public.weekly_rider_battles
language plpgsql security definer set search_path = public
as $function$
declare v_battle public.weekly_rider_battles;
begin
  perform public.respond_rider_battle(p_battle_id, p_response);
  select * into v_battle from public.weekly_rider_battles where id = p_battle_id;
  return v_battle;
end;
$function$;

create table if not exists public.weekly_challenges (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 3 and 80),
  description text not null default '',
  category text not null check (category in ('daily','one_bangs','dialled','lines','percentage','foam','bonus')),
  target_count integer not null check (target_count between 1 and 50),
  reward_points integer not null default 5 check (reward_points = 5),
  audience_group text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'active' check (status in ('active','archived')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create unique index if not exists one_active_weekly_challenge_idx on public.weekly_challenges ((status)) where status = 'active';

create table if not exists public.weekly_challenge_completions (
  challenge_id uuid not null references public.weekly_challenges(id) on delete cascade,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  awarded_at timestamptz not null default now(),
  primary key (challenge_id, athlete_id)
);

alter table public.weekly_challenges enable row level security;
alter table public.weekly_challenge_completions enable row level security;

create policy "authenticated users can read active weekly challenges" on public.weekly_challenges
  for select to authenticated using (status = 'active' or created_by = auth.uid());
create policy "riders and coaches can read challenge completions" on public.weekly_challenge_completions
  for select to authenticated using (
    athlete_id = auth.uid() or exists (
      select 1 from public.coach_athletes link where link.coach_id = auth.uid() and link.athlete_id = weekly_challenge_completions.athlete_id
    )
  );
grant select on public.weekly_challenges, public.weekly_challenge_completions to authenticated;
revoke insert, update, delete on public.weekly_challenges, public.weekly_challenge_completions from anon, authenticated;

create or replace function public.create_weekly_challenge(
  p_title text, p_description text, p_category text, p_target_count integer, p_audience_group text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $function$
declare v_user_id uuid := auth.uid(); v_id uuid; v_start timestamptz;
begin
  if not exists (select 1 from public.profiles where id = v_user_id and role in ('coach','admin')) then raise exception 'Only coaches can create weekly challenges'; end if;
  if p_category not in ('daily','one_bangs','dialled','lines','percentage','foam','bonus') then raise exception 'Choose a valid sheet category'; end if;
  if p_target_count not between 1 and 50 then raise exception 'Choose a target from 1 to 50'; end if;
  v_start := date_trunc('day', timezone('Australia/Brisbane', now())) at time zone 'Australia/Brisbane';
  update public.weekly_challenges set status = 'archived' where status = 'active';
  insert into public.weekly_challenges (title, description, category, target_count, audience_group, starts_at, ends_at, created_by)
  values (trim(p_title), trim(coalesce(p_description,'')), p_category, p_target_count, nullif(trim(coalesce(p_audience_group,'')),''), v_start, v_start + interval '7 days', v_user_id)
  returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.get_my_weekly_challenge()
returns jsonb
language plpgsql security definer set search_path = public
as $function$
declare v_user_id uuid := auth.uid(); v_challenge public.weekly_challenges; v_progress integer; v_new_award boolean := false;
begin
  if not exists (select 1 from public.profiles where id = v_user_id and role = 'athlete') then return null; end if;
  select challenge.* into v_challenge from public.weekly_challenges challenge
  where challenge.status = 'active' and now() between challenge.starts_at and challenge.ends_at
    and (challenge.audience_group is null or exists (
      select 1 from public.coach_athlete_groups membership where membership.athlete_id = v_user_id and membership.group_name = challenge.audience_group
    )) limit 1;
  if v_challenge.id is null then return null; end if;
  select count(distinct assignment.id)::integer into v_progress
  from public.weekly_trick_assignments assignment
  where assignment.athlete_id = v_user_id and assignment.category = v_challenge.category
    and (exists (
      select 1 from public.assignment_progress progress
      where progress.assignment_id = assignment.id and progress.athlete_id = v_user_id and progress.completed_at between v_challenge.starts_at and v_challenge.ends_at
    ) or exists (
      select 1 from public.assignment_point_awards award
      where award.assignment_id = assignment.id and award.athlete_id = v_user_id and award.created_at between v_challenge.starts_at and v_challenge.ends_at
    ));
  if v_progress >= v_challenge.target_count then
    insert into public.weekly_challenge_completions (challenge_id, athlete_id) values (v_challenge.id, v_user_id)
    on conflict do nothing;
    if found then
      insert into public.leaderboard_point_adjustments (athlete_id, coach_id, points, reason, week_start)
      values (v_user_id, v_challenge.created_by, 5, 'Weekly challenge ' || v_challenge.id::text || ' completed', current_date);
      v_new_award := true;
    end if;
  end if;
  return jsonb_build_object('id',v_challenge.id,'title',v_challenge.title,'description',v_challenge.description,
    'category',v_challenge.category,'target_count',v_challenge.target_count,'reward_points',v_challenge.reward_points,
    'starts_at',v_challenge.starts_at,'ends_at',v_challenge.ends_at,'progress',least(v_progress,v_challenge.target_count),
    'completed',v_progress >= v_challenge.target_count,'new_award',v_new_award);
end;
$function$;

revoke all on function public.current_rider_weekly_points(uuid) from public, anon, authenticated;
revoke all on function public.settle_expired_rider_battles() from public, anon;
revoke all on function public.request_rider_battle(uuid[], uuid[], integer) from public, anon;
revoke all on function public.respond_rider_battle(uuid, text) from public, anon;
revoke all on function public.get_my_rider_battles() from public, anon;
revoke all on function public.get_coach_rider_battles_v2(integer) from public, anon;
revoke all on function public.get_my_rider_battle_record() from public, anon;
revoke all on function public.create_weekly_challenge(text,text,text,integer,text) from public, anon;
revoke all on function public.get_my_weekly_challenge() from public, anon;
grant execute on function public.settle_expired_rider_battles(), public.request_rider_battle(uuid[],uuid[],integer),
  public.respond_rider_battle(uuid,text), public.get_my_rider_battles(), public.get_coach_rider_battles_v2(integer),
  public.get_my_rider_battle_record(), public.create_weekly_challenge(text,text,text,integer,text),
  public.get_my_weekly_challenge() to authenticated;

notify pgrst, 'reload schema';
