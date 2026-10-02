set lock_timeout = '5s';
set statement_timeout = '60s';

-- Optional sheet-week qualification. A challenge can be displayed/claimed in
-- its existing start/end window while measuring a specific Sunday-reset sheet
-- in each rider's own timezone. Null keeps every existing rolling-window rule.
-- This migration selects no challenge and changes no saved points/progress.
alter table public.weekly_challenges add column if not exists qualification_week date;
alter table public.weekly_challenges add constraint weekly_challenges_qualification_week_sunday
  check (qualification_week is null or extract(dow from qualification_week)=0);
comment on column public.weekly_challenges.qualification_week is
  'Optional Sunday sheet date. Qualification uses only this weekly sheet and its rider-local week; null preserves the challenge timestamp window.';

create or replace function private.weekly_challenge_progress(p_challenge_id uuid, p_athlete_id uuid)
returns integer language plpgsql volatile security invoker set search_path='' as $$
declare v_challenge public.weekly_challenges; v_progress integer; v_country text; v_window_start timestamptz; v_window_end timestamptz;
begin
  select * into v_challenge from public.weekly_challenges where id=p_challenge_id;
  if v_challenge.id is null then return 0; end if;
  v_window_start:=v_challenge.starts_at;
  v_window_end:=v_challenge.ends_at;
  if v_challenge.qualification_week is not null then
    select country_code into v_country from public.profiles where id=p_athlete_id;
    v_window_start:=v_challenge.qualification_week::timestamp at time zone public.jkcrew_country_timezone(v_country);
    v_window_end:=(v_challenge.qualification_week+7)::timestamp at time zone public.jkcrew_country_timezone(v_country);
  end if;
  if v_challenge.completion_rule='percentage_perfect' then
    select coalesce(max(perfect_sheet.completed_count),0)::integer into v_progress
    from (
      select assignment.week_start,count(*)::integer completed_count
      from public.weekly_trick_assignments assignment
      where assignment.athlete_id=p_athlete_id and assignment.category='percentage'
        and (v_challenge.qualification_week is null or assignment.week_start=v_challenge.qualification_week)
        and exists (
          select 1 from public.percentage_attempts attempt
          where attempt.assignment_id=assignment.id and attempt.athlete_id=p_athlete_id
          group by attempt.assignment_id
          having count(*)=10 and bool_and(attempt.landed)
            and min(attempt.created_at)>=v_window_start
            and (max(attempt.created_at)<v_window_end or (v_challenge.qualification_week is null and max(attempt.created_at)=v_window_end))
        )
      group by assignment.week_start
    ) perfect_sheet;
  else
    select count(distinct assignment.id)::integer into v_progress
    from public.weekly_trick_assignments assignment
    where assignment.athlete_id=p_athlete_id and assignment.category=v_challenge.category
      and (v_challenge.qualification_week is null or assignment.week_start=v_challenge.qualification_week)
      and (
        exists(select 1 from public.assignment_progress progress
          where progress.assignment_id=assignment.id and progress.athlete_id=p_athlete_id
            and progress.completed_at>=v_window_start
            and (progress.completed_at<v_window_end or (v_challenge.qualification_week is null and progress.completed_at=v_window_end)))
        or exists(select 1 from public.assignment_point_awards award
          where award.assignment_id=assignment.id and award.athlete_id=p_athlete_id
            and award.created_at>=v_window_start
            and (award.created_at<v_window_end or (v_challenge.qualification_week is null and award.created_at=v_window_end)))
      );
  end if;
  return coalesce(v_progress,0);
end $$;
revoke all on function private.weekly_challenge_progress(uuid,uuid) from public,anon,authenticated;

reset lock_timeout;
reset statement_timeout;
