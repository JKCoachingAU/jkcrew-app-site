-- Queue THE PERFECTIONIST after the current weekly challenge without
-- interrupting the challenge riders are completing now.

alter table public.weekly_challenges
  add column if not exists completion_rule text not null default 'standard';

alter table public.weekly_challenges
  drop constraint if exists weekly_challenges_completion_rule_check;
alter table public.weekly_challenges
  add constraint weekly_challenges_completion_rule_check
  check (completion_rule in ('standard', 'percentage_perfect'));

alter table public.weekly_challenges
  drop constraint if exists weekly_challenges_reward_points_check;
alter table public.weekly_challenges
  add constraint weekly_challenges_reward_points_check
  check (reward_points between 1 and 50);

alter table public.weekly_challenges
  drop constraint if exists weekly_challenges_status_check;
alter table public.weekly_challenges
  add constraint weekly_challenges_status_check
  check (status in ('active', 'scheduled', 'archived'));

create index if not exists weekly_challenges_status_starts_at_idx
  on public.weekly_challenges (status, starts_at);

create or replace function private.activate_due_weekly_challenges()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_challenge_id uuid;
begin
  -- If more than one schedule has become overdue, activate the newest valid
  -- one and archive older missed slots rather than cycling through them.
  select challenge.id
  into v_challenge_id
  from public.weekly_challenges challenge
  where challenge.status = 'scheduled'
    and challenge.starts_at <= now()
    and challenge.ends_at > now()
  order by challenge.starts_at desc, challenge.created_at desc
  limit 1
  for update skip locked;

  if v_challenge_id is null then
    update public.weekly_challenges
    set status = 'archived'
    where status = 'scheduled'
      and ends_at <= now();
    return 0;
  end if;

  update public.weekly_challenges
  set status = 'archived'
  where status = 'active'
    and id <> v_challenge_id;

  update public.weekly_challenges
  set status = 'archived'
  where status = 'scheduled'
    and id <> v_challenge_id
    and starts_at <= now();

  update public.weekly_challenges
  set status = 'active'
  where id = v_challenge_id
    and status = 'scheduled';

  return case when found then 1 else 0 end;
end;
$function$;

revoke all on function private.activate_due_weekly_challenges() from public, anon, authenticated;

create or replace function public.get_my_weekly_challenge()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_challenge public.weekly_challenges;
  v_progress integer := 0;
  v_new_award boolean := false;
begin
  perform private.activate_due_weekly_challenges();

  if not exists (
    select 1
    from public.profiles profile
    where profile.id = v_user_id
      and profile.role = 'athlete'
  ) then
    return null;
  end if;

  select challenge.*
  into v_challenge
  from public.weekly_challenges challenge
  where challenge.status = 'active'
    and now() between challenge.starts_at and challenge.ends_at
    and (
      challenge.audience_group is null
      or exists (
        select 1
        from public.coach_athlete_groups membership
        where membership.athlete_id = v_user_id
          and membership.group_name = challenge.audience_group
      )
    )
  order by challenge.starts_at desc
  limit 1;

  if v_challenge.id is null then
    return null;
  end if;

  if v_challenge.completion_rule = 'percentage_perfect' then
    -- A qualifying Percentage trick must have exactly 10 attempts, all landed,
    -- and all 10 attempts must have been recorded inside this challenge window.
    -- Taking the best single week prevents riders combining tricks from two
    -- different weekly sheets when the challenge window crosses a sheet reset.
    select coalesce(max(perfect_sheet.completed_count), 0)::integer
    into v_progress
    from (
      select assignment.week_start, count(*)::integer as completed_count
      from public.weekly_trick_assignments assignment
      where assignment.athlete_id = v_user_id
        and assignment.category = 'percentage'
        and exists (
          select 1
          from public.percentage_attempts attempt
          where attempt.assignment_id = assignment.id
            and attempt.athlete_id = v_user_id
          group by attempt.assignment_id
          having count(*) = 10
            and bool_and(attempt.landed)
            and min(attempt.created_at) >= v_challenge.starts_at
            and max(attempt.created_at) <= v_challenge.ends_at
        )
      group by assignment.week_start
    ) perfect_sheet;
  else
    select count(distinct assignment.id)::integer
    into v_progress
    from public.weekly_trick_assignments assignment
    where assignment.athlete_id = v_user_id
      and assignment.category = v_challenge.category
      and (
        exists (
          select 1
          from public.assignment_progress progress
          where progress.assignment_id = assignment.id
            and progress.athlete_id = v_user_id
            and progress.completed_at between v_challenge.starts_at and v_challenge.ends_at
        )
        or exists (
          select 1
          from public.assignment_point_awards award
          where award.assignment_id = assignment.id
            and award.athlete_id = v_user_id
            and award.created_at between v_challenge.starts_at and v_challenge.ends_at
        )
      );
  end if;

  v_progress := coalesce(v_progress, 0);

  if v_progress >= v_challenge.target_count then
    insert into public.weekly_challenge_completions (challenge_id, athlete_id)
    values (v_challenge.id, v_user_id)
    on conflict do nothing;

    if found then
      insert into public.leaderboard_point_adjustments (
        athlete_id, coach_id, points, reason, week_start
      ) values (
        v_user_id,
        v_challenge.created_by,
        v_challenge.reward_points,
        'Weekly challenge ' || v_challenge.id::text || ' completed',
        current_date
      );
      v_new_award := true;
    end if;
  end if;

  return jsonb_build_object(
    'id', v_challenge.id,
    'title', v_challenge.title,
    'description', v_challenge.description,
    'category', v_challenge.category,
    'completion_rule', v_challenge.completion_rule,
    'target_count', v_challenge.target_count,
    'reward_points', v_challenge.reward_points,
    'starts_at', v_challenge.starts_at,
    'ends_at', v_challenge.ends_at,
    'progress', least(v_progress, v_challenge.target_count),
    'completed', v_progress >= v_challenge.target_count,
    'new_award', v_new_award
  );
end;
$function$;

revoke all on function public.get_my_weekly_challenge() from public, anon;
grant execute on function public.get_my_weekly_challenge() to authenticated;

create or replace function private.notify_weekly_challenge_published()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_recipient record;
begin
  if new.status <> 'active' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'active' then
    return new;
  end if;

  for v_recipient in
    select profile.id
    from public.profiles profile
    where profile.role = 'athlete'
      and (
        new.audience_group is null
        or exists (
          select 1
          from public.coach_athlete_groups membership
          where membership.athlete_id = profile.id
            and membership.group_name = new.audience_group
        )
      )
  loop
    perform private.emit_jkcrew_notification(
      v_recipient.id,
      'weekly_challenge_published',
      'New weekly challenge ⚡',
      new.title || ' · complete it for ' || new.reward_points || ' leaderboard points.',
      'challenges',
      jsonb_build_object('challenge_id', new.id),
      'weekly-challenge:' || new.id::text || ':' || v_recipient.id::text,
      'challenge'
    );
  end loop;

  return new;
end;
$function$;

revoke all on function private.notify_weekly_challenge_published() from public, anon, authenticated;
drop trigger if exists weekly_challenge_published_notification on public.weekly_challenges;
create trigger weekly_challenge_published_notification
  after insert or update of status on public.weekly_challenges
  for each row execute function private.notify_weekly_challenge_published();

create or replace function private.notify_weekly_challenge_complete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_challenge public.weekly_challenges;
  v_name text;
begin
  select challenge.*
  into v_challenge
  from public.weekly_challenges challenge
  where challenge.id = new.challenge_id;

  select profile.display_name
  into v_name
  from public.profiles profile
  where profile.id = new.athlete_id;

  perform private.emit_jkcrew_notification(
    new.athlete_id,
    'weekly_challenge_completed',
    'Weekly challenge complete! +' || coalesce(v_challenge.reward_points, 5)::text || ' 🏆',
    'You completed ' || coalesce(v_challenge.title, 'this week''s challenge')
      || ' and earned ' || coalesce(v_challenge.reward_points, 5)::text || ' leaderboard points.',
    'challenges',
    jsonb_build_object('challenge_id', new.challenge_id, 'celebration', 'weekly_challenge'),
    'weekly-challenge-complete:' || new.challenge_id::text || ':' || new.athlete_id::text,
    'achievement'
  );

  if v_challenge.created_by is not null then
    perform private.emit_jkcrew_notification(
      v_challenge.created_by,
      'weekly_challenge_completed',
      'Challenge completed 🏆',
      coalesce(v_name, 'A rider') || ' completed '
        || coalesce(v_challenge.title, 'the weekly challenge') || '.',
      'battleViewer',
      jsonb_build_object('challenge_id', new.challenge_id, 'athlete_id', new.athlete_id),
      'weekly-challenge-coach:' || new.challenge_id::text || ':' || new.athlete_id::text,
      'challenge'
    );
  end if;

  return new;
end;
$function$;

revoke all on function private.notify_weekly_challenge_complete() from public, anon, authenticated;

-- The current active challenge remains untouched. Its end time becomes the
-- next challenge's exact start time, so there is no gap or overlap.
insert into public.weekly_challenges (
  title,
  description,
  category,
  completion_rule,
  target_count,
  reward_points,
  audience_group,
  starts_at,
  ends_at,
  status,
  created_by
)
select
  'THE PERFECTIONIST',
  'Get 100% on all 3 Percentage tricks to earn 10 extra leaderboard points.',
  'percentage',
  'percentage_perfect',
  3,
  10,
  current_challenge.audience_group,
  current_challenge.ends_at,
  current_challenge.ends_at + interval '7 days',
  'scheduled',
  current_challenge.created_by
from public.weekly_challenges current_challenge
where current_challenge.status = 'active'
  and not exists (
    select 1
    from public.weekly_challenges queued
    where queued.title = 'THE PERFECTIONIST'
      and queued.status in ('scheduled', 'active')
  )
order by current_challenge.starts_at desc
limit 1;

select cron.unschedule('jkcrew-activate-weekly-challenges')
where exists (
  select 1 from cron.job where jobname = 'jkcrew-activate-weekly-challenges'
);

select cron.schedule(
  'jkcrew-activate-weekly-challenges',
  '*/5 * * * *',
  'select private.activate_due_weekly_challenges();'
);

notify pgrst, 'reload schema';
