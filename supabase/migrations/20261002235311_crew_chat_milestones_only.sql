-- Crew chat only announces leaderboard movement, weekly challenge completion
-- and final battle results. Training, historical posts, scores and push settings
-- are preserved. A private receipt prevents retry duplicates without trusting
-- user-editable post metadata as an idempotency key.
set lock_timeout = '5s';
set statement_timeout = '60s';
-- Hold writes until baseline and deferred triggers are installed atomically.
lock table public.assignment_point_awards, public.leaderboard_point_adjustments,
  public.training_sessions, public.profiles in share row exclusive mode;

drop trigger if exists crew_new_trick_event on public.trick_attempts;
drop trigger if exists crew_park_king_event on public.park_king_events;
drop trigger if exists crew_ranking_event on public.leaderboard_rank_snapshots;

create table if not exists private.crew_milestone_receipts (
  event_key text primary key,
  created_at timestamptz not null default now()
);
alter table private.crew_milestone_receipts enable row level security;
revoke all on private.crew_milestone_receipts from public, anon, authenticated;

create table private.crew_leaderboard_snapshots (
  athlete_id uuid primary key, week_start date not null, rank_number bigint not null,
  weekly_points bigint not null, weekly_started boolean not null,
  updated_at timestamptz not null default now()
);
alter table private.crew_leaderboard_snapshots enable row level security;
revoke all on private.crew_leaderboard_snapshots from public,anon,authenticated;
-- Capture the current state without announcing/backfilling any historical score.
insert into private.crew_leaderboard_snapshots(athlete_id,week_start,rank_number,weekly_points,weekly_started)
select athlete_id,week_start,rank_number,weekly_points,weekly_started
from private.jkcrew_current_push_rankings();

-- New riders need a baseline before their first landing; revealing an existing
-- hidden profile only seeds its current score and never announces its history.
create or replace function private.jkcrew_seed_chat_rank_snapshot()
returns trigger language plpgsql security definer set search_path = ''
as $function$
begin
  if new.role<>'athlete' or coalesce(new.ghost_mode,false) then return new; end if;
  if tg_op='UPDATE' and old.role='athlete' and not coalesce(old.ghost_mode,false) then return new; end if;
  insert into private.crew_leaderboard_snapshots(athlete_id,week_start,rank_number,weekly_points,weekly_started)
  select athlete_id,week_start,rank_number,weekly_points,weekly_started
  from private.jkcrew_current_push_rankings() where athlete_id=new.id
  on conflict(athlete_id) do update set week_start=excluded.week_start,
    rank_number=excluded.rank_number,weekly_points=excluded.weekly_points,
    weekly_started=excluded.weekly_started,updated_at=now();
  return new;
exception when others then
  raise warning 'JKCREW new rider rank baseline skipped: %',sqlerrm;
  return new;
end;
$function$;
revoke all on function private.jkcrew_seed_chat_rank_snapshot() from public,anon,authenticated;
create trigger crew_profile_rank_baseline after insert or update of role,ghost_mode on public.profiles
  for each row execute function private.jkcrew_seed_chat_rank_snapshot();

create or replace function private.jkcrew_post_crew_milestone(
  p_author uuid, p_body text, p_metadata jsonb, p_event_key text
) returns void
language plpgsql security invoker set search_path = ''
as $function$
begin
  if p_author is null or nullif(p_event_key, '') is null then return; end if;
  insert into private.crew_milestone_receipts(event_key) values(p_event_key)
  on conflict do nothing;
  if not found then return; end if;
  insert into public.crew_posts(author_id,body,post_type,metadata)
  values(p_author, left(p_body,300), 'announcement',
    p_metadata || jsonb_build_object('event_key',p_event_key));
exception when others then
  -- The receipt and post roll back together; a chat outage never loses a landing,
  -- a challenge reward or a battle payout.
  raise warning 'JKCREW milestone announcement skipped: %', sqlerrm;
end;
$function$;
revoke all on function private.jkcrew_post_crew_milestone(uuid,text,jsonb,text) from public,anon,authenticated;

create or replace function private.jkcrew_post_leaderboard_milestone(
  p_changed_athlete uuid, p_event_key text
) returns void
language plpgsql security invoker set search_path = ''
as $function$
declare
  v_current record;
  v_previous private.crew_leaderboard_snapshots%rowtype;
  v_new_week boolean;
  v_passed jsonb;
  v_first_points boolean;
  v_leader boolean;
  v_body text;
  v_type text;
begin
  -- One statement can award several battle participants. AFTER ROW sees all
  -- its writes, so compare every improved rider before replacing the snapshot.
  for v_current in select * from private.jkcrew_current_push_rankings() loop
  select * into v_previous from private.crew_leaderboard_snapshots
  where athlete_id=v_current.athlete_id;
  if not found or v_current.weekly_points<=0 then continue; end if;
  v_new_week := v_previous.week_start is distinct from v_current.week_start;
  if not v_new_week and v_current.weekly_points<=v_previous.weekly_points then continue; end if;

  -- Compare the complete old snapshot before ANY snapshot rows are overwritten.
  -- Tied points/alphabetical order, deleted/ghost riders and another rider losing
  -- points are not a scored overtake. Country-local weekly resets cannot qualify.
  select coalesce(jsonb_agg(jsonb_build_object('athlete_id',peer.athlete_id,
    'name',peer.display_name) order by old_peer.rank_number,peer.athlete_id),'[]'::jsonb)
  into v_passed
  from private.jkcrew_current_push_rankings() peer
  join private.crew_leaderboard_snapshots old_peer on old_peer.athlete_id=peer.athlete_id
  where peer.athlete_id<>v_current.athlete_id
    and peer.week_start=v_current.week_start and old_peer.week_start=peer.week_start
    and old_peer.rank_number<v_previous.rank_number
    and peer.rank_number>v_current.rank_number
    and v_previous.weekly_points<=old_peer.weekly_points
    and v_current.weekly_points>peer.weekly_points
    and peer.weekly_points>=old_peer.weekly_points;

  v_first_points := (v_new_week or v_previous.weekly_points=0) and not exists (
    select 1 from private.crew_leaderboard_snapshots s
    where s.week_start=v_current.week_start and s.weekly_points>0);
  v_leader := v_current.rank_number=1 and not exists (
    select 1 from private.jkcrew_current_push_rankings() peer
    where peer.athlete_id<>v_current.athlete_id and peer.weekly_points>=v_current.weekly_points);
  if not ((not v_new_week and jsonb_array_length(v_passed)>0 and v_current.rank_number<v_previous.rank_number)
    or (v_leader and v_first_points)) then continue; end if;

  v_type := case when v_leader then 'rank_one' else 'leaderboard_overtake' end;
  v_body := case when v_leader then left(coalesce(v_current.display_name,'A rider'),80)||
    ' just took the #1 spot with '||v_current.weekly_points||' points!'
    else left(coalesce(v_current.display_name,'A rider'),80)||' overtook '||
      case when jsonb_array_length(v_passed)=1 then left(coalesce(v_passed->0->>'name','a rider'),80)
           else jsonb_array_length(v_passed)||' riders' end||
      ' and moved to #'||v_current.rank_number||' with '||v_current.weekly_points||' points!' end;
  perform private.jkcrew_post_crew_milestone(v_current.athlete_id,v_body,
    jsonb_build_object('event_type',v_type,'author_name',v_current.display_name,
      'author_role','athlete','tag',case when v_leader then '🏆 New crew leader' else '⚡ Leaderboard move' end,
      'week_start',v_current.week_start,'rank',v_current.rank_number,
      'previous_rank',v_previous.rank_number,'weekly_points',v_current.weekly_points,
      'overtaken',v_passed),'leaderboard:'||p_event_key||':'||v_current.athlete_id);
  end loop;
exception when others then
  raise warning 'JKCREW leaderboard announcement skipped: %',sqlerrm;
end;
$function$;
revoke all on function private.jkcrew_post_leaderboard_milestone(uuid,text) from public,anon,authenticated;

-- Chat has its own snapshot. Push delivery keeps its existing functions intact.
create or replace function private.refresh_crew_milestone_snapshots(p_changed_athlete uuid,p_event_key text)
returns void language plpgsql security invoker set search_path = ''
as $function$
begin
  perform pg_catalog.pg_advisory_xact_lock(710318,1);
  perform private.jkcrew_post_leaderboard_milestone(p_changed_athlete,p_event_key);
  insert into private.crew_leaderboard_snapshots(athlete_id,week_start,rank_number,weekly_points,weekly_started,updated_at)
  select athlete_id,week_start,rank_number,weekly_points,weekly_started,now()
  from private.jkcrew_current_push_rankings()
  on conflict(athlete_id) do update set week_start=excluded.week_start,
    rank_number=excluded.rank_number,weekly_points=excluded.weekly_points,
    weekly_started=excluded.weekly_started,updated_at=excluded.updated_at;
  delete from private.crew_leaderboard_snapshots s where not exists (
    select 1 from private.jkcrew_current_push_rankings() c where c.athlete_id=s.athlete_id);
exception when others then
  raise warning 'JKCREW chat rank snapshot skipped: %',sqlerrm;
end;
$function$;
revoke all on function private.refresh_crew_milestone_snapshots(uuid,text) from public,anon,authenticated;

create or replace function private.jkcrew_deferred_rank_milestone()
returns trigger language plpgsql security definer set search_path = ''
as $function$
begin
  if tg_table_name='training_sessions' and tg_op='UPDATE' then
    if new.total_points is not distinct from old.total_points
       and new.athlete_id is not distinct from old.athlete_id
       and new.started_at is not distinct from old.started_at then return null; end if;
  end if;
  perform private.refresh_crew_milestone_snapshots(
    case when tg_op='DELETE' then old.athlete_id else new.athlete_id end,
    pg_catalog.txid_current()::text);
  return null;
exception when others then
  raise warning 'JKCREW deferred chat rank announcement skipped: %',sqlerrm;
  return null;
end;
$function$;
revoke all on function private.jkcrew_deferred_rank_milestone() from public,anon,authenticated;
-- Defer chat comparison until all challenge/score writes and locks are finished.
-- Taking a global lock in the existing immediate score trigger would invert its
-- ordering with the challenge reward lock and could abort simultaneous saves.
create constraint trigger crew_rank_awards_milestone after insert or update or delete on public.assignment_point_awards
  deferrable initially deferred for each row execute function private.jkcrew_deferred_rank_milestone();
create constraint trigger crew_rank_adjustments_milestone after insert or update or delete on public.leaderboard_point_adjustments
  deferrable initially deferred for each row execute function private.jkcrew_deferred_rank_milestone();
create constraint trigger crew_rank_sessions_milestone after insert or update or delete on public.training_sessions
  deferrable initially deferred for each row execute function private.jkcrew_deferred_rank_milestone();

create or replace function private.jkcrew_post_challenge_event()
returns trigger language plpgsql security definer set search_path = ''
as $function$
declare v_name text; v_title text;
begin
  select p.display_name into v_name from public.profiles p
  where p.id=new.athlete_id and p.role='athlete' and not coalesce(p.ghost_mode,false);
  if not found then return new; end if;
  select title into v_title from public.weekly_challenges where id=new.challenge_id;
  perform private.jkcrew_post_crew_milestone(new.athlete_id,
    left(coalesce(v_name,'A rider'),80)||' completed '||left(coalesce(v_title,'the weekly challenge'),160)||'!',
    jsonb_build_object('event_type','challenge_complete','author_name',v_name,
      'author_role','athlete','challenge_id',new.challenge_id,'tag','🏆 Challenge complete'),
    'challenge:'||new.challenge_id||':'||new.athlete_id);
  return new;
exception when others then
  raise warning 'JKCREW challenge announcement skipped: %',sqlerrm;
  return new;
end;
$function$;
revoke all on function private.jkcrew_post_challenge_event() from public,anon,authenticated;

create or replace function private.jkcrew_post_battle_result_event()
returns trigger language plpgsql security definer set search_path = ''
as $function$
declare v_author uuid; v_winners text; v_body text; v_participants jsonb; v_bonus integer;
begin
  if old.status<>'accepted' or new.status<>'completed' then return new; end if;
  -- A public result must not expose a hidden rider, even through their team.
  if exists (select 1 from public.weekly_rider_battle_participants bp
    left join public.profiles p on p.id=bp.athlete_id
    where bp.battle_id=new.id and (p.id is null or coalesce(p.ghost_mode,false))) then return new; end if;

  select jsonb_agg(jsonb_build_object('athlete_id',bp.athlete_id,'name',p.display_name,
      'team_number',bp.team_number,'is_winner',bp.is_winner,'points_delta',bp.points_delta)
      order by bp.team_number,bp.athlete_id),
    (array_agg(bp.athlete_id order by bp.team_number,bp.athlete_id))[1]
  into v_participants,v_author
  from public.weekly_rider_battle_participants bp join public.profiles p on p.id=bp.athlete_id
  where bp.battle_id=new.id;
  if v_author is null then return new; end if;
  if new.winning_team is null then
    select string_agg(left(p.display_name,40),' + ' order by bp.team_number,bp.athlete_id)
    into v_winners from public.weekly_rider_battle_participants bp join public.profiles p on p.id=bp.athlete_id
    where bp.battle_id=new.id;
    v_body := left(coalesce(v_winners,'The riders'),200)||' finished their battle in a draw. No points changed hands.';
  else
    select string_agg(left(p.display_name,60),' + ' order by bp.athlete_id),sum(bp.points_delta)
    into v_winners,v_bonus
    from public.weekly_rider_battle_participants bp join public.profiles p on p.id=bp.athlete_id
    where bp.battle_id=new.id and bp.team_number=new.winning_team and bp.is_winner;
    if v_winners is null then return new; end if;
    v_body := left(v_winners,200)||' won the battle! +'||coalesce(v_bonus,0)||
      ' points awarded to the winning team.';
  end if;
  perform private.jkcrew_post_crew_milestone(v_author,v_body,
    jsonb_build_object('event_type','battle_result','author_name','JKCREW',
      'author_role','athlete','tag',case when new.winning_team is null then '⚔ Battle draw' else '🏆 Battle result' end,
      'battle_id',new.id,'winning_team',new.winning_team,'participants',v_participants),
    'battle:'||new.id);
  return new;
exception when others then
  raise warning 'JKCREW battle announcement skipped: %',sqlerrm;
  return new;
end;
$function$;
revoke all on function private.jkcrew_post_battle_result_event() from public,anon,authenticated;
drop trigger if exists crew_battle_result_event on public.weekly_rider_battles;
create trigger crew_battle_result_event after update of status on public.weekly_rider_battles
for each row when(old.status='accepted' and new.status='completed')
execute function private.jkcrew_post_battle_result_event();

-- Keep historical posts available to authorized administration; old automatic
-- per-trick/park announcements simply no longer appear in the chat/feed.
create or replace function public.get_crew_feed()
returns table(feed_type text,body text,author_id uuid,author_name text,avatar jsonb,points integer,created_at timestamptz)
language sql security definer set search_path = ''
as $function$
  select cp.post_type,cp.body,cp.author_id,
    coalesce(nullif(cp.metadata->>'author_name',''),p.display_name),
    coalesce(cp.metadata->'avatar',p.avatar),null::integer,cp.created_at
  from public.crew_posts cp join public.profiles p on p.id=cp.author_id
  where auth.uid() is not null and (
    cp.metadata->>'event_type' is null
    or (cp.metadata->>'event_type' in ('rank_one','leaderboard_overtake','challenge_complete','battle_result')
      and not coalesce(p.ghost_mode,false))
  )
  order by cp.created_at desc limit 60;
$function$;
revoke all on function public.get_crew_feed() from public,anon;
grant execute on function public.get_crew_feed() to authenticated;
reset lock_timeout;
reset statement_timeout;
