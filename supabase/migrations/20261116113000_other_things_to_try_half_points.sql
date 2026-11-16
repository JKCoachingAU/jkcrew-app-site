-- Weekly Other Things to Try assignments earn precise half points.

alter table public.weekly_trick_assignments
  drop constraint if exists weekly_trick_assignments_category_check;
alter table public.weekly_trick_assignments
  add constraint weekly_trick_assignments_category_check check (
    category in ('daily', 'one_bang', 'dialled', 'percentage', 'foam_pit', 'bonus', 'lines', 'trick_links', 'other')
  );

alter table public.weekly_assignment_plans
  drop constraint if exists weekly_assignment_plans_category_check;
alter table public.weekly_assignment_plans
  add constraint weekly_assignment_plans_category_check check (
    category in ('daily', 'dialled', 'one_bang', 'percentage', 'foam_pit', 'bonus', 'lines', 'trick_links', 'other')
  );

create table if not exists public.weekly_other_try_awards (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  assignment_id uuid not null references public.weekly_trick_assignments(id) on delete cascade,
  week_start date not null,
  points numeric(4,1) not null default 0.5 check (points = 0.5),
  created_at timestamptz not null default now(),
  unique (athlete_id, assignment_id)
);
create index if not exists weekly_other_try_awards_athlete_week_idx
  on public.weekly_other_try_awards (athlete_id, week_start, created_at desc);
alter table public.weekly_other_try_awards enable row level security;
revoke all on public.weekly_other_try_awards from public, anon, authenticated;
grant select on public.weekly_other_try_awards to authenticated;
drop policy if exists weekly_other_try_awards_select on public.weekly_other_try_awards;
create policy weekly_other_try_awards_select on public.weekly_other_try_awards
for select to authenticated
using (
  athlete_id = auth.uid()
  or exists (select 1 from public.coach_athletes link where link.coach_id = auth.uid() and link.athlete_id = weekly_other_try_awards.athlete_id)
  or exists (select 1 from public.parent_athletes link where link.parent_id = auth.uid() and link.athlete_id = weekly_other_try_awards.athlete_id)
);

create or replace function public.record_other_try_action(p_assignment_id uuid, p_action text default 'landed')
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_uid uuid := auth.uid();
  v_assignment public.weekly_trick_assignments%rowtype;
  v_progress public.assignment_progress%rowtype;
  v_award public.weekly_other_try_awards%rowtype;
  v_actor_role text;
  v_points_awarded numeric := 0;
  v_points_removed numeric := 0;
begin
  if v_uid is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if p_action not in ('landed', 'unlanded') then raise exception 'Unknown action' using errcode = '22023'; end if;
  select assignment.* into v_assignment from public.weekly_trick_assignments assignment
  where assignment.id = p_assignment_id and assignment.category = 'other';
  if not found then raise exception 'Other thing to try not found' using errcode = 'P0002'; end if;
  select role::text into v_actor_role from public.profiles where id = v_uid;
  if v_assignment.athlete_id <> v_uid and not (
    v_actor_role in ('coach', 'admin') and exists (
      select 1 from public.coach_athletes link where link.coach_id = v_uid and link.athlete_id = v_assignment.athlete_id
    )
  ) then raise exception 'You cannot update this rider''s other things to try' using errcode = '42501'; end if;
  if v_assignment.athlete_id = v_uid and private.rider_scoring_paused(v_uid) then
    raise exception 'Trick scoring is paused for this rider. Contact your coach.' using errcode = '42501';
  end if;
  insert into public.assignment_progress (assignment_id, athlete_id) values (v_assignment.id, v_assignment.athlete_id) on conflict (assignment_id) do nothing;
  if p_action = 'landed' then
    update public.assignment_progress set completed_at = coalesce(completed_at, now()), updated_at = now()
    where assignment_id = v_assignment.id returning * into v_progress;
    insert into public.weekly_other_try_awards (athlete_id, assignment_id, week_start)
    values (v_assignment.athlete_id, v_assignment.id, v_assignment.week_start)
    on conflict (athlete_id, assignment_id) do nothing returning * into v_award;
    if found then v_points_awarded := 0.5; end if;
  else
    delete from public.weekly_other_try_awards where athlete_id = v_assignment.athlete_id and assignment_id = v_assignment.id returning * into v_award;
    if found then v_points_removed := 0.5; end if;
    update public.assignment_progress set completed_at = null, updated_at = now()
    where assignment_id = v_assignment.id returning * into v_progress;
  end if;
  return jsonb_build_object(
    'assignment_id', v_assignment.id, 'category', 'other', 'completed_at', v_progress.completed_at,
    'points_awarded', 0, 'half_points_awarded', v_points_awarded, 'points_removed', 0,
    'half_points_removed', v_points_removed,
    'message', case when p_action = 'landed' then 'Other thing landed' else 'Other thing unticked' end
  );
end;
$$;
revoke all on function public.record_other_try_action(uuid, text) from public, anon;
grant execute on function public.record_other_try_action(uuid, text) to authenticated;

create or replace function public.get_weekly_leaderboard_with_half_points()
returns table(
  athlete_id uuid, display_name text, level integer, avatar jsonb, country_code text, country_name text,
  weekly_points numeric, all_time_points numeric, session_count bigint, earned_badges jsonb, ghost_mode boolean,
  rank_number bigint, all_time_rank_number bigint, weekly_started boolean, weekly_point_events bigint, all_time_point_events bigint
)
language sql security definer set search_path = public, private
as $$
with base as (select * from public.get_weekly_leaderboard()),
half as (
  select award.athlete_id,
    sum(case when award.created_at >= bounds.week_start_ts and award.created_at < bounds.next_week_start_ts then award.points else 0 end)::numeric as weekly_half,
    sum(award.points)::numeric as all_half,
    count(*) filter (where award.created_at >= bounds.week_start_ts and award.created_at < bounds.next_week_start_ts)::bigint as weekly_events,
    count(*)::bigint as all_events
  from public.weekly_other_try_awards award
  join public.profiles rider on rider.id = award.athlete_id
  cross join lateral public.jkcrew_week_bounds(rider.country_code) bounds
  group by award.athlete_id
), scored as (
  select base.*, greatest(0, base.weekly_points::numeric + coalesce(half.weekly_half, 0)) as precise_weekly,
    greatest(0, base.all_time_points::numeric + coalesce(half.all_half, 0)) as precise_all_time,
    (base.weekly_point_events + coalesce(half.weekly_events, 0))::bigint as precise_weekly_events,
    (base.all_time_point_events + coalesce(half.all_events, 0))::bigint as precise_all_time_events
  from base left join half on half.athlete_id = base.athlete_id
), ranked as (
  select scored.*, rank() over (order by case when (scored.weekly_started or scored.precise_weekly_events > 0) then 0 else 1 end, scored.precise_weekly desc, scored.display_name asc)::bigint as precise_rank,
    rank() over (order by scored.precise_all_time desc, scored.display_name asc)::bigint as precise_all_time_rank
  from scored
)
select athlete_id, display_name, level, avatar, country_code, country_name, precise_weekly, precise_all_time,
  session_count, earned_badges, ghost_mode, precise_rank, precise_all_time_rank,
  (weekly_started or precise_weekly_events > 0), precise_weekly_events, precise_all_time_events
from ranked
order by case when (weekly_started or precise_weekly_events > 0) then 0 else 1 end, precise_weekly desc, display_name asc;
$$;
revoke all on function public.get_weekly_leaderboard_with_half_points() from public, anon;
grant execute on function public.get_weekly_leaderboard_with_half_points() to authenticated;

notify pgrst, 'reload schema';
