-- Read-only preparation for reviewed battle requests. No invitations, settlement,
-- acceptances or awards are created by opening this API.
create or replace function private.battle_match_options()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  viewer_id uuid := auth.uid();
  viewer_role text;
  window_end timestamptz := now();
  window_start timestamptz := now() - interval '7 days';
  result jsonb;
begin
  select p.role::text into viewer_role from public.profiles p where p.id = viewer_id;
  if viewer_id is null or viewer_role is null or viewer_role not in ('athlete','coach','admin') then
    raise exception 'Sign in as a rider or coach to prepare a battle.';
  end if;
  with visible as (
    select p.id, p.display_name, p.avatar
    from public.profiles p
    where p.role::text = 'athlete' and not coalesce(p.ghost_mode, false)
      and (viewer_role = 'athlete' or exists (
        select 1 from public.coach_athletes c where c.coach_id = viewer_id and c.athlete_id = p.id
      ))
  ), options as (
    select v.id as athlete_id, v.display_name, v.avatar,
      (select count(distinct participant.battle_id)::integer
       from public.weekly_rider_battle_participants participant
       join public.weekly_rider_battles battle on battle.id = participant.battle_id
       where participant.athlete_id = v.id and battle.status in ('pending','accepted')) as active_battle_count,
      greatest(0,
        coalesce((select sum(a.points) from public.assignment_point_awards a
          where a.athlete_id = v.id and a.created_at >= window_start and a.created_at <= window_end),0)
        + coalesce((select sum(s.total_points) from public.training_sessions s
          where s.athlete_id = v.id and s.started_at >= window_start and s.started_at <= window_end
            and not exists (select 1 from public.assignment_point_awards a where a.session_id = s.id)),0)
      )::bigint as recent_training_points
    from visible v
  )
  select jsonb_build_object('window_start',window_start,'window_end',window_end,
    'riders',coalesce(jsonb_agg(to_jsonb(options) order by display_name,athlete_id),'[]'::jsonb)) into result
  from options;
  return result;
end;
$$;
revoke all on function private.battle_match_options() from public, anon;
grant execute on function private.battle_match_options() to authenticated;

create or replace function public.get_battle_match_options()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.battle_match_options();
$$;
revoke all on function public.get_battle_match_options() from public, anon;
grant execute on function public.get_battle_match_options() to authenticated;
notify pgrst, 'reload schema';
