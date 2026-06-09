create or replace function public.get_point_history(p_athlete_id uuid)
returns table(event_at timestamptz, category text, item text, points integer, reason text, session_id uuid, coach_id uuid, coach_name text, source text)
language sql
security definer
set search_path = public
as $$
  with allowed as (
    select exists (
      select 1
      from public.profiles me
      where me.id = (select auth.uid())
        and (
          p_athlete_id = (select auth.uid())
          or (
            me.role in ('coach', 'admin')
            and exists (
              select 1
              from public.coach_athletes ca
              where ca.coach_id = (select auth.uid())
                and ca.athlete_id = p_athlete_id
            )
          )
          or (
            me.role = 'parent'
            and exists (
              select 1
              from public.parent_athletes pa
              where pa.parent_id = (select auth.uid())
                and pa.athlete_id = p_athlete_id
            )
          )
        )
    ) as ok
  )
  select *
  from (
    select
      ts.started_at as event_at,
      'session'::text as category,
      'Training session total'::text as item,
      ts.total_points::integer as points,
      case
        when ts.daily_completed_seconds is not null then 'Daily completed in ' || (ts.daily_completed_seconds / 60)::text || ':' || lpad((ts.daily_completed_seconds % 60)::text, 2, '0')
        else null::text
      end as reason,
      ts.id as session_id,
      null::uuid as coach_id,
      null::text as coach_name,
      'session'::text as source
    from public.training_sessions ts
    cross join allowed
    where allowed.ok
      and ts.athlete_id = p_athlete_id
      and coalesce(ts.total_points, 0) <> 0

    union all

    select
      apa.created_at as event_at,
      coalesce(wta.category, split_part(apa.award_key, ':', 1))::text as category,
      coalesce(wta.trick_name,
        case
          when apa.award_key like 'group-first-finish:%' then 'First to finish Daily Tricks'
          when apa.award_key like 'daily:%' then 'Daily Tricks completion'
          else apa.award_key
        end
      )::text as item,
      apa.points::integer as points,
      null::text as reason,
      apa.session_id,
      null::uuid as coach_id,
      null::text as coach_name,
      'manual_award'::text as source
    from public.assignment_point_awards apa
    left join public.weekly_trick_assignments wta on wta.id = apa.assignment_id
    cross join allowed
    where allowed.ok
      and apa.athlete_id = p_athlete_id
      and apa.session_id is null

    union all

    select
      lpa.created_at as event_at,
      'coach_adjustment'::text as category,
      case when lpa.points < 0 then 'Coach deduction' else 'Coach bonus' end as item,
      lpa.points::integer as points,
      lpa.reason,
      null::uuid as session_id,
      lpa.coach_id,
      coach.display_name as coach_name,
      'coach_adjustment'::text as source
    from public.leaderboard_point_adjustments lpa
    left join public.profiles coach on coach.id = lpa.coach_id
    cross join allowed
    where allowed.ok
      and lpa.athlete_id = p_athlete_id
  ) rows
  order by event_at desc
  limit 120;
$$;

revoke execute on function public.get_point_history(uuid) from anon;
