alter table public.profiles
  add column if not exists ghost_mode boolean not null default false;

create index if not exists profiles_role_ghost_mode_idx
  on public.profiles(role, ghost_mode);

drop function if exists public.get_weekly_leaderboard();

create or replace function public.get_weekly_leaderboard()
returns table(
  athlete_id uuid,
  display_name text,
  level integer,
  avatar jsonb,
  country_code text,
  country_name text,
  weekly_points bigint,
  all_time_points bigint,
  session_count bigint,
  earned_badges jsonb,
  ghost_mode boolean,
  rank_number bigint,
  all_time_rank_number bigint
)
language sql
security definer
set search_path = public
as $$
  with viewer as (
    select
      auth.uid() as viewer_id,
      exists (
        select 1
        from public.profiles me
        where me.id = auth.uid()
          and me.role in ('coach', 'admin')
      ) as is_coach
  ),
  score_rows as (
    select
      p.id as athlete_id,
      p.display_name,
      p.avatar,
      p.country_code,
      p.country_name,
      coalesce(p.ghost_mode, false) as ghost_mode,
      greatest(0, coalesce(wa.points, 0) + coalesce(wadj.points, 0))::bigint as weekly_points,
      greatest(0, coalesce(aa.points, 0) + coalesce(aadj.points, 0))::bigint as all_time_raw_points,
      coalesce(s.sessions, 0)::bigint as session_count,
      public.get_earned_badges(p.id) as earned_badges
    from public.profiles p
    cross join lateral public.jkcrew_week_bounds(p.country_code) b
    left join lateral (
      select coalesce(sum(apa.points), 0)::bigint as points
      from public.assignment_point_awards apa
      where apa.athlete_id = p.id
        and apa.created_at >= b.week_start_ts
        and apa.created_at < b.next_week_start_ts
    ) wa on true
    left join lateral (
      select coalesce(sum(lpa.points), 0)::bigint as points
      from public.leaderboard_point_adjustments lpa
      where lpa.athlete_id = p.id
        and lpa.week_start = b.week_start_date
        and coalesce(lpa.reason, '') not ilike 'All-time score correction%'
    ) wadj on true
    left join lateral (
      select coalesce(sum(apa.points), 0)::bigint as points
      from public.assignment_point_awards apa
      where apa.athlete_id = p.id
    ) aa on true
    left join lateral (
      select coalesce(sum(lpa.points), 0)::bigint as points
      from public.leaderboard_point_adjustments lpa
      where lpa.athlete_id = p.id
    ) aadj on true
    left join lateral (
      select count(ts.id)::bigint as sessions
      from public.training_sessions ts
      where ts.athlete_id = p.id
    ) s on true
    where p.role = 'athlete'
  ),
  visible_rows as (
    select
      sr.*,
      greatest(sr.weekly_points, sr.all_time_raw_points)::bigint as all_time_points
    from score_rows sr
    cross join viewer v
    where not sr.ghost_mode
      or sr.athlete_id = v.viewer_id
      or v.is_coach
  ),
  ranked as (
    select
      vr.*,
      rank() over (order by vr.weekly_points desc, vr.display_name asc) as rank_number,
      rank() over (order by vr.all_time_points desc, vr.display_name asc) as all_time_rank_number
    from visible_rows vr
  )
  select
    ranked.athlete_id,
    ranked.display_name,
    public.jkcrew_score_level(ranked.weekly_points)::integer as level,
    ranked.avatar,
    ranked.country_code,
    ranked.country_name,
    ranked.weekly_points,
    ranked.all_time_points,
    ranked.session_count,
    ranked.earned_badges,
    ranked.ghost_mode,
    ranked.rank_number,
    ranked.all_time_rank_number
  from ranked
  order by ranked.weekly_points desc, ranked.display_name asc;
$$;

grant execute on function public.get_weekly_leaderboard() to authenticated;

create or replace function public.get_public_athlete_profile(p_athlete_id uuid)
returns table(
  id uuid,
  display_name text,
  level integer,
  avatar jsonb,
  country_code text,
  country_name text,
  stance text,
  spin_direction text,
  favourite_trick text,
  age integer,
  sponsors text,
  achievements text,
  badges jsonb,
  showreel_videos jsonb,
  social_links jsonb,
  weekly_wins integer,
  weekly_points integer,
  current_rank integer,
  is_weekly_winner boolean,
  is_last_place boolean
)
language sql
security definer
set search_path = public
as $$
  with viewer as (
    select
      auth.uid() as viewer_id,
      exists (
        select 1
        from public.profiles me
        where me.id = auth.uid()
          and me.role in ('coach', 'admin')
      ) as is_coach
  ),
  ranked as (
    select
      gl.*,
      count(*) over () as total_riders
    from public.get_weekly_leaderboard() gl
  ),
  profile_row as (
    select
      p.id,
      p.display_name,
      coalesce(r.level, public.jkcrew_score_level(0)::integer) as level,
      p.avatar,
      p.country_code,
      p.country_name,
      p.stance,
      p.spin_direction,
      p.favourite_trick,
      p.age,
      p.sponsors,
      p.achievements,
      coalesce(r.earned_badges, public.get_earned_badges(p.id)) as badges,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', sr.id,
          'video_url', sr.video_url,
          'storage_path', sr.storage_path,
          'duration_seconds', sr.duration_seconds,
          'created_at', sr.created_at
        ) order by sr.created_at desc)
        from public.profile_showreels sr
        where sr.rider_id = p.id
      ), '[]'::jsonb) as showreel_videos,
      coalesce(p.social_links, '{}'::jsonb) as social_links,
      coalesce(r.weekly_points, 0)::integer as weekly_points,
      coalesce(r.rank_number, 0)::integer as current_rank,
      coalesce(r.total_riders, 0)::integer as total_riders
    from public.profiles p
    cross join viewer v
    left join ranked r on r.athlete_id = p.id
    where p.id = p_athlete_id
      and p.role = 'athlete'
      and (
        not coalesce(p.ghost_mode, false)
        or p.id = v.viewer_id
        or v.is_coach
      )
  )
  select
    pr.id,
    pr.display_name,
    pr.level,
    pr.avatar,
    pr.country_code,
    pr.country_name,
    pr.stance,
    pr.spin_direction,
    pr.favourite_trick,
    pr.age,
    pr.sponsors,
    pr.achievements,
    pr.badges,
    pr.showreel_videos,
    pr.social_links,
    0::integer as weekly_wins,
    pr.weekly_points,
    pr.current_rank,
    pr.current_rank = 1 and pr.weekly_points > 0 as is_weekly_winner,
    pr.current_rank = pr.total_riders and pr.total_riders > 1 and pr.weekly_points > 0 as is_last_place
  from profile_row pr;
$$;

grant execute on function public.get_public_athlete_profile(uuid) to authenticated;
