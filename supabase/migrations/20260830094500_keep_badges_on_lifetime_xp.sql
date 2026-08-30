-- Badge levels are permanent lifetime-XP progress. The leaderboard level field
-- must never be derived from weekly or all-time score points.
do $migration$
declare
  function_ddl text;
  old_level_expression text := 'coalesce(public.jkcrew_score_level(ranked.all_time_points), 1)::integer as level,';
  new_level_expression text := $replacement$coalesce((
      select least(50, greatest(
        1,
        coalesce(profile.level, 1),
        public.level_for_xp(coalesce(profile.xp_total, 0))
      ))::integer
      from public.profiles profile
      where profile.id = ranked.athlete_id
    ), 1)::integer as level,$replacement$;
begin
  select pg_get_functiondef('public.get_weekly_leaderboard()'::regprocedure)
  into function_ddl;

  if position(old_level_expression in function_ddl) = 0 then
    raise exception 'Expected score-based leaderboard level expression was not found';
  end if;

  function_ddl := replace(function_ddl, old_level_expression, new_level_expression);
  execute function_ddl;
end;
$migration$;

comment on function public.get_weekly_leaderboard() is
  'Returns weekly and lifetime scores while the level column always follows permanent lifetime XP.';

notify pgrst, 'reload schema';
