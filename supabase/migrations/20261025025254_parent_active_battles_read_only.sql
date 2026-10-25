-- Parent Home gets the same authoritative live team scores as the existing
-- spectator cards, scoped to one currently linked child. This adds no raw-table
-- access and performs no settlement, reward, notification or account changes.
create function private.parent_active_rider_battles(
  p_athlete_id uuid,
  p_limit integer default 24,
  p_after_ends_at timestamptz default null,
  p_after_id uuid default null
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_viewer uuid := auth.uid();
  v_role text;
  v_now timestamptz := now();
  v_limit integer := least(greatest(coalesce(p_limit, 24), 1), 24);
  v_result jsonb;
begin
  select profile.role::text into v_role from public.profiles profile where profile.id = v_viewer;
  if v_viewer is null or v_role is distinct from 'parent'
     or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then
    raise exception 'Sign in as a linked parent to view this rider''s battles.' using errcode = '42501';
  end if;
  -- Verify the current link and access state inside the definer helper on every
  -- request, including cursor pages. Parent access never exposes the raw tables.
  if private.rider_features_disabled() or private.rider_recovery_active(v_viewer) then
    raise exception 'This feature is not available for this account. Contact your coach.' using errcode = '42501';
  end if;
  if p_athlete_id is null or not exists (
    select 1 from public.parent_athletes link
    join public.profiles child on child.id = link.athlete_id and child.role::text = 'athlete'
    where link.parent_id = v_viewer and link.athlete_id = p_athlete_id
      and not private.rider_recovery_active(child.id)
      and not exists (select 1 from private.rider_feature_access access
        where access.athlete_id = child.id and access.features_disabled)
  ) then
    raise exception 'This rider''s battles are not available to your account.' using errcode = '42501';
  end if;
  if (p_after_ends_at is null) <> (p_after_id is null) then
    raise exception 'Supply both active battle cursor fields.' using errcode = '22023';
  end if;

  with candidates as materialized (
    select battle.id, battle.starts_at, battle.ends_at, battle.duration_days,
      battle.reward_points, battle.battle_size, battle.team_count
    from public.weekly_rider_battles battle
    where battle.status = 'accepted' and battle.archived_at is null
      and exists (select 1 from public.weekly_rider_battle_participants child
        where child.battle_id = battle.id and child.athlete_id = p_athlete_id
          and child.forfeited_at is null)
      and battle.starts_at <= v_now and battle.ends_at > v_now
      and (p_after_ends_at is null or (battle.ends_at, battle.id) > (p_after_ends_at, p_after_id))
    order by battle.ends_at, battle.id
    limit v_limit + 1
  ), page as materialized (
    select * from candidates order by ends_at, id limit v_limit
  ), summaries as (
    select page.id, page.ends_at, jsonb_build_object(
      'id', page.id, 'starts_at', page.starts_at, 'ends_at', page.ends_at,
      'duration_days', page.duration_days, 'reward_points', page.reward_points,
      'battle_size', page.battle_size, 'team_count', page.team_count,
      'format', detail.format, 'participants', detail.participants, 'teams', detail.teams
    ) as data
    from page
    cross join lateral (
      with members as materialized (
        select participant.athlete_id, participant.team_number, participant.forfeited_at,
          profile.display_name,
          coalesce(profile.ghost_mode, false) and not exists (
            select 1 from public.parent_athletes link
            where link.parent_id = v_viewer and link.athlete_id = participant.athlete_id
          ) as hidden
        from public.weekly_rider_battle_participants participant
        join public.profiles profile on profile.id = participant.athlete_id
        where participant.battle_id = page.id
      ), source_scores as materialized (
        -- The same source and forfeiture rules as battle settlement and the live cards.
        -- A session-day allocation can contribute to a different team from its roster.
        select private.jkcrew_rider_battle_score_allocations(page.id, athlete_id) as allocation
        from members where forfeited_at is null
      ), team_scores as (
        select member.team_number, count(*) as rider_count,
          bool_and(member.forfeited_at is not null) as forfeited,
          (select coalesce(sum((source.allocation->>member.team_number::text)::integer), 0)
           from source_scores source) as score
        from members member group by member.team_number
      )
      select
        (select coalesce(jsonb_agg(jsonb_build_object(
          'athlete_id', case when hidden then null else athlete_id end, 'team_number', team_number,
          'display_name', case when hidden then 'Private rider' else display_name end, 'forfeited_at', forfeited_at
        ) order by team_number, display_name, athlete_id), '[]'::jsonb) from members) as participants,
        (select coalesce(jsonb_agg(jsonb_build_object(
          'team_number', team_number, 'score', score, 'forfeited', forfeited
        ) order by team_number), '[]'::jsonb) from team_scores) as teams,
        (select string_agg(rider_count::text, 'v' order by team_number) from team_scores) as format
    ) detail
  )
  select jsonb_build_object(
    'athlete_id', p_athlete_id, 'server_now', v_now,
    'battles', coalesce((select jsonb_agg(data order by ends_at, id) from summaries), '[]'::jsonb),
    'has_more', (select count(*) > v_limit from candidates),
    'next_cursor', case when (select count(*) > v_limit from candidates) then
      (select jsonb_build_object('ends_at', ends_at, 'id', id) from page order by ends_at desc, id desc limit 1)
      else null end
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function private.parent_active_rider_battles(uuid, integer, timestamptz, uuid) from public, anon;
grant execute on function private.parent_active_rider_battles(uuid, integer, timestamptz, uuid) to authenticated;

create function public.get_parent_active_rider_battles(
  p_athlete_id uuid,
  p_limit integer default 24,
  p_after_ends_at timestamptz default null,
  p_after_id uuid default null
)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.parent_active_rider_battles(p_athlete_id, p_limit, p_after_ends_at, p_after_id);
$$;
revoke all on function public.get_parent_active_rider_battles(uuid, integer, timestamptz, uuid) from public, anon;
grant execute on function public.get_parent_active_rider_battles(uuid, integer, timestamptz, uuid) to authenticated;

comment on function public.get_parent_active_rider_battles(uuid, integer, timestamptz, uuid) is
  'Read-only active battle summaries for a parent''s currently linked child. No pending invitations, private training data or battle management authority.';

notify pgrst, 'reload schema';
