create or replace function public.get_coach_rider_battles(p_limit integer default 100)
returns table(
  id uuid,
  challenger_id uuid,
  challenger_name text,
  opponent_id uuid,
  opponent_name text,
  week_start date,
  status text,
  duration_days integer,
  starts_at timestamptz,
  ends_at timestamptz,
  winner_id uuid,
  reward_points integer,
  responded_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then raise exception 'You must be signed in'; end if;
  if not exists (
    select 1 from public.profiles
    where profiles.id = v_user_id
      and profiles.role in ('coach', 'admin')
  ) then
    raise exception 'Only coaches can view rider battles';
  end if;

  return query
  select
    battle.id,
    battle.challenger_id,
    challenger.display_name,
    battle.opponent_id,
    opponent.display_name,
    battle.week_start,
    battle.status,
    battle.duration_days,
    battle.starts_at,
    battle.ends_at,
    battle.winner_id,
    battle.reward_points,
    battle.responded_at,
    battle.created_at,
    battle.updated_at
  from public.weekly_rider_battles battle
  join public.profiles challenger on challenger.id = battle.challenger_id
  join public.profiles opponent on opponent.id = battle.opponent_id
  where exists (
    select 1
    from public.coach_athletes link
    where link.coach_id = v_user_id
      and link.athlete_id in (battle.challenger_id, battle.opponent_id)
  )
  order by
    case battle.status when 'accepted' then 0 when 'pending' then 1 when 'completed' then 2 else 3 end,
    coalesce(battle.ends_at, battle.created_at) desc
  limit least(greatest(coalesce(p_limit, 100), 1), 250);
end;
$function$;

revoke all on function public.get_coach_rider_battles(integer) from public, anon;
grant execute on function public.get_coach_rider_battles(integer) to authenticated;
