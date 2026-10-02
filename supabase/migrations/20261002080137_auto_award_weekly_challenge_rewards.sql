set lock_timeout = '5s';
set statement_timeout = '60s';

-- Award the existing challenge reward in the same transaction as qualifying
-- training. Previously only opening the rider Challenges screen awarded it.
-- No historical scores, completions or training records are changed here.
create or replace function private.weekly_challenge_progress(p_challenge_id uuid, p_athlete_id uuid)
returns integer language plpgsql volatile security invoker set search_path='' as $$
declare v_challenge public.weekly_challenges; v_progress integer;
begin
  select * into v_challenge from public.weekly_challenges where id=p_challenge_id;
  if v_challenge.id is null then return 0; end if;
  if v_challenge.completion_rule='percentage_perfect' then
    select coalesce(max(perfect_sheet.completed_count),0)::integer into v_progress
    from (
      select assignment.week_start,count(*)::integer completed_count
      from public.weekly_trick_assignments assignment
      where assignment.athlete_id=p_athlete_id and assignment.category='percentage'
        and exists (
          select 1 from public.percentage_attempts attempt
          where attempt.assignment_id=assignment.id and attempt.athlete_id=p_athlete_id
          group by attempt.assignment_id
          having count(*)=10 and bool_and(attempt.landed)
            and min(attempt.created_at)>=v_challenge.starts_at
            and max(attempt.created_at)<=v_challenge.ends_at
        )
      group by assignment.week_start
    ) perfect_sheet;
  else
    select count(distinct assignment.id)::integer into v_progress
    from public.weekly_trick_assignments assignment
    where assignment.athlete_id=p_athlete_id and assignment.category=v_challenge.category
      and (
        exists(select 1 from public.assignment_progress progress
          where progress.assignment_id=assignment.id and progress.athlete_id=p_athlete_id
            and progress.completed_at between v_challenge.starts_at and v_challenge.ends_at)
        or exists(select 1 from public.assignment_point_awards award
          where award.assignment_id=assignment.id and award.athlete_id=p_athlete_id
            and award.created_at between v_challenge.starts_at and v_challenge.ends_at)
      );
  end if;
  return coalesce(v_progress,0);
end $$;
revoke all on function private.weekly_challenge_progress(uuid,uuid) from public,anon,authenticated;

create or replace function private.award_weekly_challenge(p_challenge_id uuid,p_athlete_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_challenge public.weekly_challenges; v_actor uuid:=auth.uid(); v_existing integer; v_rows integer;
begin
  -- This internal helper is reachable only from trusted triggers / the current
  -- rider RPC. Still validate the actor before considering any other rider.
  if v_actor is null or not exists(
    select 1 from public.profiles actor where actor.id=v_actor and
      ((actor.id=p_athlete_id and actor.role::text='athlete') or
       (actor.role::text in ('coach','admin') and exists(
         select 1 from public.coach_athletes link where link.coach_id=v_actor and link.athlete_id=p_athlete_id)))
  ) then return false; end if;
  if not exists(select 1 from public.profiles where id=p_athlete_id and role::text='athlete')
    or private.rider_scoring_paused(p_athlete_id)
    or exists(select 1 from private.rider_feature_access access where access.athlete_id=p_athlete_id and access.features_disabled)
  then return false; end if;

  -- Serialize rider/coach/device finishes BEFORE re-reading progress. The second
  -- transaction sees committed progress from the first, avoiding a missed last
  -- two simultaneous tricks as well as duplicate awards.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('weekly-challenge:'||p_challenge_id::text||':'||p_athlete_id::text,0));
  select * into v_challenge from public.weekly_challenges challenge
  where challenge.id=p_challenge_id and challenge.status='active'
    and now() between challenge.starts_at and challenge.ends_at
    and exists(select 1 from public.coach_athletes link where link.coach_id=challenge.created_by and link.athlete_id=p_athlete_id)
    and (challenge.audience_group is null or exists(
      select 1 from public.coach_athlete_groups membership where membership.athlete_id=p_athlete_id
        and membership.coach_id=challenge.created_by and membership.group_name=challenge.audience_group));
  if v_challenge.id is null or exists(select 1 from public.weekly_challenge_completions where challenge_id=p_challenge_id and athlete_id=p_athlete_id)
    or private.weekly_challenge_progress(p_challenge_id,p_athlete_id)<v_challenge.target_count then return false; end if;

  -- Respect any already-recorded historical/manual award with the same natural
  -- key. Never add a second reward, or overwrite inconsistent historical data.
  select sum(points)::integer,count(*)::integer into v_existing,v_rows
  from public.leaderboard_point_adjustments
  where athlete_id=p_athlete_id and reason='Weekly challenge '||p_challenge_id::text||' completed';
  if v_rows>0 and (v_rows<>1 or v_existing<>v_challenge.reward_points) then return false; end if;
  insert into public.weekly_challenge_completions(challenge_id,athlete_id)
  values(p_challenge_id,p_athlete_id) on conflict do nothing;
  if not found then return false; end if;
  if v_rows=0 then
    insert into public.leaderboard_point_adjustments(athlete_id,coach_id,points,reason,week_start)
    select p_athlete_id,v_challenge.created_by,v_challenge.reward_points,
      'Weekly challenge '||p_challenge_id::text||' completed',bounds.week_start_date
    from public.profiles rider cross join lateral public.jkcrew_week_bounds(rider.country_code) bounds
    where rider.id=p_athlete_id;
  end if;
  return v_rows=0;
end $$;
revoke all on function private.award_weekly_challenge(uuid,uuid) from public,anon,authenticated;

create or replace function private.award_weekly_challenge_after_training()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_challenge uuid;
begin
  if new.athlete_id is null or new.assignment_id is null then return new; end if;
  if tg_op='UPDATE' and to_jsonb(new)=to_jsonb(old) then return new; end if;
  if exists(select 1 from public.weekly_challenges where status='scheduled' and starts_at<=now() and ends_at>now()) then
    perform private.activate_due_weekly_challenges();
  end if;
  for v_challenge in select challenge.id from public.weekly_challenges challenge
    join public.weekly_trick_assignments assignment on assignment.id=new.assignment_id
      and assignment.athlete_id=new.athlete_id and assignment.category=challenge.category
    where challenge.status='active' and now() between challenge.starts_at and challenge.ends_at
  loop
    perform private.award_weekly_challenge(v_challenge,new.athlete_id);
  end loop;
  return new;
end $$;
revoke all on function private.award_weekly_challenge_after_training() from public,anon,authenticated;

drop trigger if exists weekly_challenge_progress_reward on public.assignment_progress;
create trigger weekly_challenge_progress_reward after insert or update on public.assignment_progress
for each row execute function private.award_weekly_challenge_after_training();
drop trigger if exists weekly_challenge_percentage_reward on public.percentage_attempts;
create trigger weekly_challenge_percentage_reward after insert or update on public.percentage_attempts
for each row execute function private.award_weekly_challenge_after_training();
drop trigger if exists weekly_challenge_assignment_reward on public.assignment_point_awards;
create trigger weekly_challenge_assignment_reward after insert or update on public.assignment_point_awards
for each row execute function private.award_weekly_challenge_after_training();

create or replace function private.my_weekly_challenge()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user_id uuid:=auth.uid(); v_challenge public.weekly_challenges; v_progress integer:=0; v_new_award boolean:=false; v_completed boolean;
begin
  if v_user_id is null or not exists(select 1 from public.profiles where id=v_user_id and role::text='athlete') then return null; end if;
  perform private.activate_due_weekly_challenges();
  select * into v_challenge from public.weekly_challenges challenge
  where challenge.status='active' and now() between challenge.starts_at and challenge.ends_at
    and exists(select 1 from public.coach_athletes link where link.coach_id=challenge.created_by and link.athlete_id=v_user_id)
    and (challenge.audience_group is null or exists(select 1 from public.coach_athlete_groups membership
      where membership.athlete_id=v_user_id and membership.coach_id=challenge.created_by and membership.group_name=challenge.audience_group))
  order by challenge.starts_at desc limit 1;
  if v_challenge.id is null then return null; end if;
  -- Retain the old screen's safe retry path, now sharing the exact same award
  -- transaction and idempotency key as training writes.
  v_new_award:=private.award_weekly_challenge(v_challenge.id,v_user_id);
  v_progress:=private.weekly_challenge_progress(v_challenge.id,v_user_id);
  select exists(select 1 from public.weekly_challenge_completions where challenge_id=v_challenge.id and athlete_id=v_user_id) into v_completed;
  return jsonb_build_object('id',v_challenge.id,'title',v_challenge.title,'description',v_challenge.description,
    'category',v_challenge.category,'completion_rule',v_challenge.completion_rule,'target_count',v_challenge.target_count,
    'reward_points',v_challenge.reward_points,'starts_at',v_challenge.starts_at,'ends_at',v_challenge.ends_at,
    'progress',least(v_progress,v_challenge.target_count),'completed',v_completed,'new_award',v_new_award);
end $$;
revoke all on function private.my_weekly_challenge() from public,anon;
grant execute on function private.my_weekly_challenge() to authenticated,service_role;
create or replace function public.get_my_weekly_challenge()
returns jsonb language sql security invoker set search_path='' as $$select private.my_weekly_challenge();$$;
revoke all on function public.get_my_weekly_challenge() from public,anon;
grant execute on function public.get_my_weekly_challenge() to authenticated,service_role;

reset lock_timeout;
reset statement_timeout;
