-- Stabilise JKCREW scoring so earned daily points do not disappear after a
-- checkbox refresh/untick, and keep historical all-time correction rows out of
-- the live weekly leaderboard.

do $$
declare
  ddl text;
  old_block text;
  new_block text;
begin
  select pg_get_functiondef('public.record_assignment_action(uuid,text)'::regprocedure)
  into ddl;

  old_block := $old$
    if v_assignment.category = 'daily' then
      for v_deleted_award in
        delete from public.assignment_point_awards apa
        where apa.athlete_id = v_assignment.athlete_id
          and (
            apa.award_key in (v_daily_complete_key, v_daily_under_20_key, v_daily_legacy_key)
            or (
              v_group_session.id is not null
              and apa.award_key = 'group-first-finish:' || v_group_session.id::text
            )
          )
        returning apa.points, apa.session_id
      loop
        v_removed_points := v_removed_points + coalesce(v_deleted_award.points, 0);
        if v_deleted_award.session_id is not null then
          update public.training_sessions ts
          set total_points = greatest(0, coalesce(ts.total_points, 0) - coalesce(v_deleted_award.points, 0))
          where ts.id = v_deleted_award.session_id;
        end if;
      end loop;

      update public.assignment_progress ap
$old$;

  new_block := $new$
    if v_assignment.category = 'daily' then
      -- Daily checklist state resets/changes independently from earned score.
      -- Once the full list has awarded daily-complete or under-20 points for a
      -- local date, never remove those earned point awards from an untick.
      v_removed_points := 0;

      update public.assignment_progress ap
$new$;

  if position(old_block in ddl) = 0 then
    raise notice 'record_assignment_action daily unlanded award-delete block was not found; leaving function unchanged';
  else
    ddl := replace(ddl, old_block, new_block);
    execute ddl;
  end if;
end $$;

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

grant execute on function public.get_weekly_leaderboard() to authenticated;

do $$
declare
  ddl text;
begin
  select pg_get_functiondef('public.set_percentage_attempt(uuid,integer,boolean)'::regprocedure)
  into ddl;

  ddl := replace(
    ddl,
    $old$
      insert into public.assignment_point_awards (athlete_id, session_id, assignment_id, award_key, points)
      values (v_assignment.athlete_id, v_session_id, p_assignment_id, v_award_key, v_points);
$old$,
    $new$
      insert into public.assignment_point_awards (athlete_id, session_id, assignment_id, award_key, points)
      values (v_assignment.athlete_id, v_session_id, p_assignment_id, v_award_key, v_points)
      on conflict (athlete_id, award_key) do update
      set session_id = excluded.session_id,
          assignment_id = excluded.assignment_id,
          points = excluded.points,
          created_at = now();
$new$
  );

  execute ddl;
end $$;

create index if not exists assignment_point_awards_athlete_key_idx
  on public.assignment_point_awards(athlete_id, award_key);

create index if not exists assignment_progress_athlete_progress_date_idx
  on public.assignment_progress(athlete_id, progress_date)
  where progress_date is not null;
