-- Keep the live leaderboard stable through Sunday.
--
-- The previous scoring window rolled to a new week at Sunday 00:00 in each
-- rider's timezone, which made riders look like their scores had reset on
-- Sunday morning. Scores should remain visible until the week is over, then
-- reset at the next local Monday 00:00.
--
-- The launch week already stored score adjustments under the 2026-06-07 week
-- key, so preserve that active week until 2026-06-15 00:00 local time. After
-- that cutover, score windows use clean Monday-to-Monday boundaries.

create or replace function public.jkcrew_week_bounds(p_country_code text, p_now timestamptz default now())
returns table(week_start_date date, week_start_ts timestamptz, next_week_start_ts timestamptz, local_today date)
language sql
stable
set search_path = public
as $$
  with tz as (
    select public.jkcrew_country_timezone(p_country_code) as name
  ),
  local_clock as (
    select
      tz.name,
      (p_now at time zone tz.name) as local_now
    from tz
  ),
  bounds as (
    select
      name,
      local_now,
      case
        when local_now < timestamp '2026-06-15 00:00:00'
          then timestamp '2026-06-07 00:00:00'
        else date_trunc('week', local_now)::timestamp
      end as week_start_local,
      case
        when local_now < timestamp '2026-06-15 00:00:00'
          then timestamp '2026-06-15 00:00:00'
        else date_trunc('week', local_now)::timestamp + interval '7 days'
      end as next_week_start_local
    from local_clock
  )
  select
    week_start_local::date,
    week_start_local at time zone name,
    next_week_start_local at time zone name,
    local_now::date
  from bounds;
$$;

grant execute on function public.jkcrew_week_bounds(text, timestamptz) to authenticated;
