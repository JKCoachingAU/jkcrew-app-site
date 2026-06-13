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
  reset_clock as (
    select
      name,
      local_now,
      date_trunc('day', local_now)::timestamp
        - (extract(dow from local_now)::integer * interval '1 day') as this_sunday_midnight
    from local_clock
  ),
  chosen as (
    select
      name,
      local_now,
      case
        when local_now >= this_sunday_midnight then this_sunday_midnight
        else this_sunday_midnight - interval '7 days'
      end as week_start_local
    from reset_clock
  )
  select
    week_start_local::date,
    week_start_local at time zone name,
    (week_start_local + interval '7 days') at time zone name,
    local_now::date
  from chosen;
$$;

grant execute on function public.jkcrew_week_bounds(text, timestamptz) to authenticated;

with normalized as (
  select
    lpa.id,
    b.week_start_date
  from public.leaderboard_point_adjustments lpa
  join public.profiles p on p.id = lpa.athlete_id
  cross join lateral public.jkcrew_week_bounds(p.country_code, lpa.created_at) b
)
update public.leaderboard_point_adjustments lpa
set week_start = normalized.week_start_date
from normalized
where normalized.id = lpa.id
  and lpa.week_start is distinct from normalized.week_start_date;
