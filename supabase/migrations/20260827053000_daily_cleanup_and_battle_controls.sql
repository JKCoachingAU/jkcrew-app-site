-- Retire duplicate Daily locations without touching the full Aus National Training Facility lists.
-- A private JSON archive keeps the removed assignments and their dependent progress recoverable.
create table if not exists private.retired_daily_assignment_backups (
  assignment_id uuid primary key,
  retired_at timestamptz not null default now(),
  reason text not null,
  assignment jsonb not null,
  assignment_attempts jsonb not null default '[]'::jsonb,
  assignment_progress jsonb not null default '[]'::jsonb,
  assignment_point_awards jsonb not null default '[]'::jsonb,
  xp_ledger jsonb not null default '[]'::jsonb
);

revoke all on private.retired_daily_assignment_backups from public, anon, authenticated;

insert into private.retired_daily_assignment_backups (
  assignment_id, reason, assignment, assignment_attempts, assignment_progress,
  assignment_point_awards, xp_ledger
)
select assignment.id,
  'Removed duplicate Daily location: ' || assignment.venue,
  to_jsonb(assignment),
  coalesce((select jsonb_agg(to_jsonb(row_data)) from public.assignment_attempts row_data where row_data.assignment_id = assignment.id), '[]'::jsonb),
  coalesce((select jsonb_agg(to_jsonb(row_data)) from public.assignment_progress row_data where row_data.assignment_id = assignment.id), '[]'::jsonb),
  coalesce((select jsonb_agg(to_jsonb(row_data)) from public.assignment_point_awards row_data where row_data.assignment_id = assignment.id), '[]'::jsonb),
  coalesce((select jsonb_agg(to_jsonb(row_data)) from public.xp_ledger row_data where row_data.assignment_id = assignment.id), '[]'::jsonb)
from public.weekly_trick_assignments assignment
where assignment.category = 'daily'
  and lower(trim(assignment.venue)) in ('hotbox', 'default daily list')
on conflict (assignment_id) do nothing;

delete from public.weekly_trick_assignments assignment
where assignment.category = 'daily'
  and lower(trim(assignment.venue)) in ('hotbox', 'default daily list');

alter table public.weekly_rider_battles
  add column if not exists forfeited_by uuid references public.profiles(id) on delete set null,
  add column if not exists forfeited_at timestamptz;

create or replace function public.forfeit_rider_battle(p_battle_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_battle public.weekly_rider_battles;
  v_losing_team integer;
  v_winning_team integer;
  v_winner_id uuid;
begin
  if v_user_id is null then raise exception 'You must be signed in'; end if;

  select battle.* into v_battle
  from public.weekly_rider_battles battle
  where battle.id = p_battle_id
  for update;

  if v_battle.id is null then raise exception 'Battle not found'; end if;
  if v_battle.status <> 'accepted' then raise exception 'Only a live battle can be forfeited'; end if;

  select participant.team_number into v_losing_team
  from public.weekly_rider_battle_participants participant
  where participant.battle_id = p_battle_id and participant.athlete_id = v_user_id;

  if v_losing_team is null then raise exception 'You are not part of this battle'; end if;
  v_winning_team := case when v_losing_team = 1 then 2 else 1 end;

  select participant.athlete_id into v_winner_id
  from public.weekly_rider_battle_participants participant
  where participant.battle_id = p_battle_id and participant.team_number = v_winning_team
  order by participant.athlete_id limit 1;

  with ranked as (
    select participant.battle_id, participant.athlete_id, participant.team_number,
      row_number() over (partition by participant.team_number order by participant.athlete_id) as team_rank
    from public.weekly_rider_battle_participants participant
    where participant.battle_id = p_battle_id
  )
  update public.weekly_rider_battle_participants participant
  set is_winner = participant.team_number = v_winning_team,
      points_delta = case
        when participant.team_number = v_winning_team then
          (v_battle.reward_points / v_battle.battle_size)
          + case when ranked.team_rank <= (v_battle.reward_points % v_battle.battle_size) then 1 else 0 end
        else -((v_battle.reward_points / v_battle.battle_size)
          + case when ranked.team_rank <= (v_battle.reward_points % v_battle.battle_size) then 1 else 0 end)
      end
  from ranked
  where participant.battle_id = ranked.battle_id and participant.athlete_id = ranked.athlete_id;

  insert into public.leaderboard_point_adjustments (athlete_id, coach_id, points, reason, week_start, created_at)
  select participant.athlete_id, coalesce(v_battle.created_by, v_battle.challenger_id), participant.points_delta,
    'Rider battle ' || v_battle.id::text || case when participant.points_delta > 0 then ' win by forfeit' else ' forfeit loss' end,
    v_battle.week_start, now()
  from public.weekly_rider_battle_participants participant
  where participant.battle_id = v_battle.id and participant.points_delta <> 0;

  update public.weekly_rider_battles
  set status = 'completed', winning_team = v_winning_team, winner_id = v_winner_id,
      forfeited_by = v_user_id, forfeited_at = now(), updated_at = now()
  where id = p_battle_id;

  insert into public.push_notification_queue (recipient_id, notification_type, title, body, url, payload, dedupe_key)
  select participant.athlete_id, 'rider_battle_result',
    case when participant.athlete_id = v_user_id then 'Battle forfeited'
         when participant.team_number = v_winning_team then 'Battle won by forfeit'
         else 'Battle ended by forfeit' end,
    case when participant.athlete_id = v_user_id then 'You forfeited this battle.'
         when participant.team_number = v_winning_team then 'The other team forfeited. Your share of the 5 leaderboard points was added.'
         else 'A teammate forfeited this battle.' end,
    './?push=challenges', jsonb_build_object('view', 'challenges', 'battle_id', v_battle.id),
    'rider-battle-forfeit:' || v_battle.id::text || ':' || participant.athlete_id::text
  from public.weekly_rider_battle_participants participant
  where participant.battle_id = v_battle.id
  on conflict (dedupe_key) do nothing;

  return 'completed';
end;
$function$;

create or replace function public.delete_rider_battle(p_battle_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_battle public.weekly_rider_battles;
begin
  if not exists (select 1 from public.profiles where id = v_user_id and role in ('coach', 'admin')) then
    raise exception 'Only coaches can delete battles';
  end if;

  select battle.* into v_battle
  from public.weekly_rider_battles battle
  where battle.id = p_battle_id
  for update;

  if v_battle.id is null then raise exception 'Battle not found'; end if;
  if not exists (
    select 1
    from public.weekly_rider_battle_participants participant
    join public.coach_athletes link on link.athlete_id = participant.athlete_id
    where participant.battle_id = p_battle_id and link.coach_id = v_user_id
  ) then raise exception 'You can only delete battles for riders in your crew'; end if;

  delete from public.leaderboard_point_adjustments adjustment
  where adjustment.reason like 'Rider battle ' || p_battle_id::text || ' %';
  delete from public.push_notification_queue notification
  where notification.payload->>'battle_id' = p_battle_id::text;
  delete from public.weekly_rider_battles where id = p_battle_id;
  return true;
end;
$function$;

revoke all on function public.forfeit_rider_battle(uuid) from public, anon;
revoke all on function public.delete_rider_battle(uuid) from public, anon;
grant execute on function public.forfeit_rider_battle(uuid), public.delete_rider_battle(uuid) to authenticated;

notify pgrst, 'reload schema';
