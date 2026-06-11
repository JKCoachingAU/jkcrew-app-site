create or replace function public.jkcrew_country_timezone(p_country_code text)
returns text
language sql
stable
as $$
  select case upper(coalesce(nullif(trim(p_country_code), ''), 'AU'))
    when 'AU' then 'Australia/Brisbane'
    when 'DE' then 'Europe/Berlin'
    when 'RU' then 'Europe/Moscow'
    when 'NZ' then 'Pacific/Auckland'
    when 'US' then 'America/Los_Angeles'
    when 'CA' then 'America/Toronto'
    when 'GB' then 'Europe/London'
    when 'UK' then 'Europe/London'
    when 'FR' then 'Europe/Paris'
    when 'ES' then 'Europe/Madrid'
    when 'IT' then 'Europe/Rome'
    when 'NL' then 'Europe/Amsterdam'
    when 'BE' then 'Europe/Brussels'
    when 'CH' then 'Europe/Zurich'
    when 'JP' then 'Asia/Tokyo'
    else 'Australia/Brisbane'
  end;
$$;

create or replace function public.jkcrew_week_bounds(p_country_code text, p_now timestamptz default now())
returns table(week_start_date date, week_start_ts timestamptz, next_week_start_ts timestamptz, local_today date)
language sql
stable
as $$
  with tz as (
    select public.jkcrew_country_timezone(p_country_code) as name
  ),
  local_clock as (
    select tz.name, p_now at time zone tz.name as local_now
    from tz
  ),
  reset_clock as (
    select
      name,
      local_now,
      date_trunc('day', local_now)::timestamp
        - (extract(dow from local_now)::int * interval '1 day')
        + interval '20 hours' as this_sunday_evening
    from local_clock
  ),
  bounds as (
    select
      name,
      local_now,
      case
        when local_now >= this_sunday_evening then this_sunday_evening
        else this_sunday_evening - interval '7 days'
      end as local_week_start
    from reset_clock
  )
  select
    local_week_start::date,
    local_week_start at time zone name,
    (local_week_start + interval '7 days') at time zone name,
    local_now::date
  from bounds;
$$;

create or replace function public.jkcrew_score_level(p_points numeric)
returns integer
language sql
immutable
as $$
  select least(50, greatest(1, floor(greatest(0, coalesce(p_points, 0)) / 5)::integer + 1));
$$;

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
  earned_badges jsonb
)
language sql
security definer
set search_path = public
as $$
  with rows as (
    select
      p.id as athlete_id,
      p.display_name,
      p.avatar,
      p.country_code,
      p.country_name,
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
  )
  select
    rows.athlete_id,
    rows.display_name,
    public.jkcrew_score_level(rows.weekly_points)::integer as level,
    rows.avatar,
    rows.country_code,
    rows.country_name,
    rows.weekly_points,
    greatest(rows.weekly_points, rows.all_time_raw_points)::bigint as all_time_points,
    rows.session_count,
    rows.earned_badges
  from rows
  order by rows.weekly_points desc, rows.display_name asc;
$$;

create or replace function public.get_earned_badges(p_athlete_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with athlete as (
    select p.id, p.country_code
    from public.profiles p
    where p.id = p_athlete_id
  ),
  bounds as (
    select b.*
    from athlete a
    cross join lateral public.jkcrew_week_bounds(a.country_code) b
  ),
  assignments as (
    select wta.id, wta.category
    from public.weekly_trick_assignments wta
    where wta.athlete_id = p_athlete_id
      and wta.category in ('dialled','one_bang','foam_pit','bonus','percentage')
      and wta.archived_at is null
  ),
  progress as (
    select ap.assignment_id
    from public.assignment_progress ap
    join assignments a on a.id = ap.assignment_id
    where coalesce(ap.completed, false) = true
  ),
  percentage_done as (
    select a.id
    from assignments a
    join public.assignment_percentage_attempts apa on apa.assignment_id = a.id
    where a.category = 'percentage'
    group by a.id
    having count(*) >= 10
  ),
  completion as (
    select
      count(*) filter (where category = 'dialled') as dialled_total,
      count(*) filter (where category = 'one_bang') as one_bang_total,
      count(*) filter (where category in ('dialled','one_bang','foam_pit','bonus','percentage')) as plan_total,
      count(*) filter (where category = 'dialled' and id in (select assignment_id from progress)) as dialled_done,
      count(*) filter (where category = 'one_bang' and id in (select assignment_id from progress)) as one_bang_done,
      count(*) filter (where category in ('dialled','one_bang','foam_pit','bonus') and id in (select assignment_id from progress))
        + count(*) filter (where category = 'percentage' and id in (select id from percentage_done)) as plan_done
    from assignments
  ),
  daily_stats as (
    select count(distinct case
      when apa.award_key like 'daily%:%:%' then split_part(apa.award_key, ':', 3)
      else split_part(apa.award_key, ':', 2)
    end) as daily_days
    from public.assignment_point_awards apa
    cross join bounds b
    where apa.athlete_id = p_athlete_id
      and apa.award_key like 'daily%'
      and apa.created_at >= b.week_start_ts
      and apa.created_at < b.next_week_start_ts
  ),
  badge_rows as (
    select 'goat' as key, '🐐' as icon, 'GOAT Badge' as label, 'Completed the whole non-daily weekly training plan' as description
    from completion
    where plan_total > 0 and plan_done >= plan_total
    union all
    select 'cool-person', '😎', 'Cool Person Emoji Badge', 'Completed daily tricks every recorded training day this week'
    from daily_stats
    where daily_days >= 1
    union all
    select 'firework', '🎆', 'Firework Badge', 'Completed all One Bangs'
    from completion
    where one_bang_total > 0 and one_bang_done >= one_bang_total
    union all
    select 'chain', '🔗', 'Chain Link Badge', 'Completed all Dialled tricks'
    from completion
    where dialled_total > 0 and dialled_done >= dialled_total
  )
  select coalesce(jsonb_agg(jsonb_build_object('key', key, 'icon', icon, 'label', label, 'description', description)), '[]'::jsonb)
  from badge_rows;
$$;

create or replace function public.recalculate_athlete_points(p_athlete_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with athlete as (
    select p.id, p.country_code
    from public.profiles p
    where p.id = p_athlete_id
  ),
  bounds as (
    select b.*
    from athlete a
    cross join lateral public.jkcrew_week_bounds(a.country_code) b
  ),
  weekly_awards as (
    select coalesce(sum(apa.points), 0)::integer as points
    from public.assignment_point_awards apa
    cross join bounds b
    where apa.athlete_id = p_athlete_id
      and apa.created_at >= b.week_start_ts
      and apa.created_at < b.next_week_start_ts
  ),
  weekly_adjustments as (
    select coalesce(sum(lpa.points), 0)::integer as points
    from public.leaderboard_point_adjustments lpa
    cross join bounds b
    where lpa.athlete_id = p_athlete_id
      and lpa.week_start = b.week_start_date
  ),
  all_awards as (
    select coalesce(sum(apa.points), 0)::integer as points
    from public.assignment_point_awards apa
    where apa.athlete_id = p_athlete_id
  ),
  all_adjustments as (
    select coalesce(sum(lpa.points), 0)::integer as points
    from public.leaderboard_point_adjustments lpa
    where lpa.athlete_id = p_athlete_id
  )
  select jsonb_build_object(
    'weekly_points', greatest(0, (select points from weekly_awards) + (select points from weekly_adjustments)),
    'all_time_points', greatest(0, (select points from all_awards) + (select points from all_adjustments))
  );
$$;

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
  with ranked as (
    select
      gl.*,
      rank() over (order by gl.weekly_points desc, gl.display_name asc) as rank_number,
      count(*) over () as total_riders
    from public.get_weekly_leaderboard() gl
  ),
  profile_row as (
    select
      p.id,
      p.display_name,
      r.level,
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
      coalesce(p.showreel_videos, '[]'::jsonb) as showreel_videos,
      coalesce(p.social_links, '{}'::jsonb) as social_links,
      coalesce(r.weekly_points, 0)::integer as weekly_points,
      coalesce(r.rank_number, 0)::integer as current_rank,
      coalesce(r.total_riders, 0)::integer as total_riders
    from public.profiles p
    left join ranked r on r.athlete_id = p.id
    where p.id = p_athlete_id
      and p.role = 'athlete'
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
    pr.current_rank = pr.total_riders and pr.total_riders > 1 as is_last_place
  from profile_row pr;
$$;

do $$
declare
  ddl text;
begin
  select pg_get_functiondef('public.record_assignment_action(uuid,text)'::regprocedure) into ddl;
  ddl := replace(ddl, 'v_today date := (now() at time zone ''Australia/Brisbane'')::date;', 'v_today date;');
  ddl := replace(
    ddl,
    '  if p_action not in (''landed'', ''unlanded'') then',
    '  select b.local_today into v_today
  from public.profiles p
  cross join lateral public.jkcrew_week_bounds(p.country_code) b
  where p.id = v_assignment.athlete_id;

  if v_today is null then
    v_today := (now() at time zone ''Australia/Brisbane'')::date;
  end if;

  if p_action not in (''landed'', ''unlanded'') then'
  );
  execute ddl;
end $$;

grant execute on function public.jkcrew_country_timezone(text) to authenticated;
grant execute on function public.jkcrew_week_bounds(text, timestamptz) to authenticated;
grant execute on function public.jkcrew_score_level(numeric) to authenticated;
grant execute on function public.get_weekly_leaderboard() to authenticated;
grant execute on function public.get_earned_badges(uuid) to authenticated;
grant execute on function public.recalculate_athlete_points(uuid) to authenticated;
grant execute on function public.get_public_athlete_profile(uuid) to authenticated;
