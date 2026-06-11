-- JKCREW gamified XP, 50-level progression, and level badges.
-- This sits beside the existing points leaderboard. Points stay as the
-- competitive scoreboard; XP is the long-term progression system.

alter table public.profiles
  add column if not exists xp_total integer not null default 0;

create table if not exists public.xp_ledger (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  source_type text not null,
  source_id text not null,
  xp integer not null,
  reason text not null default '',
  assignment_id uuid references public.weekly_trick_assignments(id) on delete set null,
  session_id uuid references public.training_sessions(id) on delete set null,
  trick_name text not null default '',
  venue text not null default '',
  coach_id uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  level_before integer not null default 1,
  level_after integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint xp_ledger_source_unique unique (athlete_id, source_type, source_id),
  constraint xp_ledger_source_type_check check (char_length(trim(source_type)) > 0),
  constraint xp_ledger_source_id_check check (char_length(trim(source_id)) > 0)
);

create index if not exists xp_ledger_athlete_created_idx
  on public.xp_ledger (athlete_id, created_at desc);

create index if not exists xp_ledger_assignment_idx
  on public.xp_ledger (assignment_id)
  where assignment_id is not null;

alter table public.xp_ledger enable row level security;

drop policy if exists "xp ledger readable by allowed users" on public.xp_ledger;
create policy "xp ledger readable by allowed users"
  on public.xp_ledger
  for select
  to authenticated
  using (
    athlete_id = auth.uid()
    or exists (
      select 1
      from public.profiles me
      where me.id = auth.uid()
        and me.role in ('coach', 'admin')
        and (
          exists (
            select 1
            from public.coach_athletes ca
            where ca.coach_id = auth.uid()
              and ca.athlete_id = xp_ledger.athlete_id
          )
          or me.role = 'admin'
        )
    )
    or exists (
      select 1
      from public.parent_athletes pa
      where pa.parent_id = auth.uid()
        and pa.athlete_id = xp_ledger.athlete_id
    )
  );

grant select on public.xp_ledger to authenticated;
revoke insert, update, delete on public.xp_ledger from anon, authenticated;

create or replace function public.xp_required_for_level(p_level integer)
returns integer
language sql
immutable
as $$
  select case
    when coalesce(p_level, 1) <= 1 then 0
    else coalesce((
      select sum(
        case
          when lvl between 2 and 20 then 100 + ((lvl - 2) * 50)
          when lvl between 21 and 35 then 1150 + ((lvl - 21) * 125)
          else 3100 + ((lvl - 36) * 250)
        end
      )
      from generate_series(2, least(greatest(coalesce(p_level, 1), 1), 50)) as lvl
    ), 0)::integer
  end;
$$;

create or replace function public.level_for_xp(p_xp integer)
returns integer
language sql
immutable
as $$
  select coalesce(max(level_number), 1)::integer
  from generate_series(1, 50) as level_number
  where public.xp_required_for_level(level_number) <= greatest(0, coalesce(p_xp, 0));
$$;

create or replace function public.level_badge(p_level integer)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_level integer := least(50, greatest(1, coalesce(p_level, 1)));
  v_icons text[] := array[
    '⌁','◉','⚙','▣','◒','🏁','✦','▰','◈','⌃',
    '⌁','▬','🔗','♜','⚙','▰','◐','★','⚡','🚲',
    '◇','◉','⚙','▣','∞','🚲','▰','★','♛','🔥',
    '◉','⚡','⌁','»','✊','🚲','★','⚙','1','🚲',
    '🚲','🔗','🚲','♛','◉','🔥','★','⚡','👑','🏆'
  ];
  v_tone text := case
    when v_level >= 41 then 'red'
    when v_level >= 36 then 'purple'
    when v_level >= 31 then 'aqua'
    when v_level >= 21 then 'gold'
    when v_level >= 11 then 'silver'
    else 'bronze'
  end;
begin
  return jsonb_build_object(
    'key', 'level-' || v_level::text,
    'type', 'level',
    'level', v_level,
    'label', 'Level ' || v_level::text || ' Badge',
    'icon', v_icons[v_level],
    'tone', v_tone,
    'description', case
      when v_level = 50 then 'Elite JKCREW progression badge'
      when v_level >= 41 then 'Pro-level progression badge'
      when v_level >= 31 then 'Advanced progression badge'
      when v_level >= 21 then 'Strong progression badge'
      when v_level >= 11 then 'Building progression badge'
      else 'Foundation progression badge'
    end
  );
end;
$$;

create or replace function public.xp_progress_json(p_xp integer)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_total integer := greatest(0, coalesce(p_xp, 0));
  v_level integer := public.level_for_xp(v_total);
  v_current_xp integer := public.xp_required_for_level(v_level);
  v_next_level integer := least(50, v_level + 1);
  v_next_xp integer := public.xp_required_for_level(v_next_level);
  v_span integer := greatest(1, v_next_xp - v_current_xp);
  v_into integer := greatest(0, v_total - v_current_xp);
begin
  return jsonb_build_object(
    'xp_total', v_total,
    'level', v_level,
    'level_cap', 50,
    'current_level_xp', v_current_xp,
    'next_level', v_next_level,
    'next_level_xp', v_next_xp,
    'xp_into_level', v_into,
    'xp_needed', case when v_level >= 50 then 0 else greatest(0, v_next_xp - v_total) end,
    'progress_percent', case when v_level >= 50 then 100 else least(100, round((v_into::numeric / v_span::numeric) * 100)::integer) end,
    'current_badge', public.level_badge(v_level)
  );
end;
$$;

create or replace function public.get_level_badges(p_athlete_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with profile_xp as (
    select coalesce(p.xp_total, 0) as xp_total, public.level_for_xp(coalesce(p.xp_total, 0)) as current_level
    from public.profiles p
    where p.id = p_athlete_id
      and p.role = 'athlete'
  )
  select coalesce(jsonb_agg(
    public.level_badge(level_number)
    || jsonb_build_object(
      'unlocked', level_number <= px.current_level,
      'current', level_number = px.current_level,
      'xp_required', public.xp_required_for_level(level_number)
    )
    order by level_number
  ), '[]'::jsonb)
  from profile_xp px
  cross join generate_series(1, 50) as level_number;
$$;

create or replace function public.sync_profile_xp(p_athlete_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
  v_level integer;
begin
  select greatest(0, coalesce(sum(xl.xp), 0))::integer
  into v_total
  from public.xp_ledger xl
  where xl.athlete_id = p_athlete_id;

  v_level := public.level_for_xp(v_total);

  update public.profiles p
  set xp_total = v_total,
      level = v_level,
      updated_at = now()
  where p.id = p_athlete_id
    and (p.xp_total is distinct from v_total or p.level is distinct from v_level);

  return public.xp_progress_json(v_total);
end;
$$;

create or replace function public.sync_xp_award(
  p_athlete_id uuid,
  p_source_type text,
  p_source_id text,
  p_xp integer,
  p_reason text,
  p_assignment_id uuid default null,
  p_session_id uuid default null,
  p_trick_name text default '',
  p_venue text default '',
  p_coach_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before_total integer := 0;
  v_before_level integer := 1;
  v_after_total integer := 0;
  v_after_level integer := 1;
  v_old_xp integer := 0;
  v_delta integer := 0;
  v_progress jsonb := '{}'::jsonb;
begin
  if p_athlete_id is null or trim(coalesce(p_source_type, '')) = '' or trim(coalesce(p_source_id, '')) = '' then
    raise exception 'XP award is missing a rider or source';
  end if;

  select coalesce(p.xp_total, 0), coalesce(p.level, 1)
  into v_before_total, v_before_level
  from public.profiles p
  where p.id = p_athlete_id;

  select coalesce(xl.xp, 0)
  into v_old_xp
  from public.xp_ledger xl
  where xl.athlete_id = p_athlete_id
    and xl.source_type = p_source_type
    and xl.source_id = p_source_id;

  v_old_xp := coalesce(v_old_xp, 0);

  if coalesce(p_xp, 0) = 0 then
    delete from public.xp_ledger xl
    where xl.athlete_id = p_athlete_id
      and xl.source_type = p_source_type
      and xl.source_id = p_source_id;
    v_delta := -v_old_xp;
  else
    insert into public.xp_ledger (
      athlete_id, source_type, source_id, xp, reason, assignment_id, session_id,
      trick_name, venue, coach_id, metadata, level_before, level_after
    )
    values (
      p_athlete_id, trim(p_source_type), trim(p_source_id), p_xp, coalesce(p_reason, ''),
      p_assignment_id, p_session_id, coalesce(p_trick_name, ''), coalesce(p_venue, ''),
      p_coach_id, coalesce(p_metadata, '{}'::jsonb), v_before_level, v_before_level
    )
    on conflict (athlete_id, source_type, source_id) do update
    set xp = excluded.xp,
        reason = excluded.reason,
        assignment_id = excluded.assignment_id,
        session_id = excluded.session_id,
        trick_name = excluded.trick_name,
        venue = excluded.venue,
        coach_id = excluded.coach_id,
        metadata = excluded.metadata,
        updated_at = now();
    v_delta := p_xp - v_old_xp;
  end if;

  v_progress := public.sync_profile_xp(p_athlete_id);
  v_after_total := coalesce((v_progress->>'xp_total')::integer, 0);
  v_after_level := coalesce((v_progress->>'level')::integer, 1);

  update public.xp_ledger xl
  set level_before = v_before_level,
      level_after = v_after_level
  where xl.athlete_id = p_athlete_id
    and xl.source_type = p_source_type
    and xl.source_id = p_source_id;

  return v_progress || jsonb_build_object(
    'athlete_id', p_athlete_id,
    'xp_delta', v_delta,
    'xp_awarded', greatest(v_delta, 0),
    'xp_removed', greatest(-v_delta, 0),
    'level_before', v_before_level,
    'level_after', v_after_level,
    'leveled_up', v_after_level > v_before_level,
    'level_badge', public.level_badge(v_after_level)
  );
end;
$$;

create or replace function public.adjust_athlete_xp(p_athlete_id uuid, p_xp integer, p_reason text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Sign in required';
  end if;

  if not exists (
    select 1
    from public.profiles me
    where me.id = v_uid
      and me.role in ('coach', 'admin')
      and (
        me.role = 'admin'
        or exists (
          select 1
          from public.coach_athletes ca
          where ca.coach_id = v_uid
            and ca.athlete_id = p_athlete_id
        )
      )
  ) then
    raise exception 'Only a coach/admin can adjust XP';
  end if;

  return public.sync_xp_award(
    p_athlete_id,
    'coach_adjustment',
    gen_random_uuid()::text,
    coalesce(p_xp, 0),
    coalesce(nullif(trim(p_reason), ''), case when coalesce(p_xp, 0) < 0 then 'Coach XP deduction' else 'Coach XP bonus' end),
    null,
    null,
    'Coach XP adjustment',
    '',
    v_uid,
    jsonb_build_object('manual', true)
  );
end;
$$;

create or replace function public.get_xp_history(p_athlete_id uuid)
returns table(
  event_at timestamptz,
  source_type text,
  item text,
  xp integer,
  reason text,
  level_before integer,
  level_after integer,
  session_id uuid,
  coach_id uuid,
  coach_name text,
  metadata jsonb
)
language sql
security definer
set search_path = public
as $$
  with allowed as (
    select exists (
      select 1
      from public.profiles me
      where me.id = auth.uid()
        and (
          p_athlete_id = auth.uid()
          or (
            me.role in ('coach', 'admin')
            and (
              me.role = 'admin'
              or exists (
                select 1
                from public.coach_athletes ca
                where ca.coach_id = auth.uid()
                  and ca.athlete_id = p_athlete_id
              )
            )
          )
          or (
            me.role = 'parent'
            and exists (
              select 1
              from public.parent_athletes pa
              where pa.parent_id = auth.uid()
                and pa.athlete_id = p_athlete_id
            )
          )
        )
    ) as ok
  )
  select
    xl.created_at as event_at,
    xl.source_type,
    coalesce(nullif(xl.trick_name, ''), xl.reason, xl.source_type) as item,
    xl.xp,
    xl.reason,
    xl.level_before,
    xl.level_after,
    xl.session_id,
    xl.coach_id,
    coach.display_name as coach_name,
    xl.metadata
  from public.xp_ledger xl
  left join public.profiles coach on coach.id = xl.coach_id
  cross join allowed
  where allowed.ok
    and xl.athlete_id = p_athlete_id
  order by xl.created_at desc
  limit 150;
$$;

create or replace function public.get_xp_summary(p_athlete_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_can_view boolean := false;
  v_progress jsonb := '{}'::jsonb;
begin
  select p.* into v_profile
  from public.profiles p
  where p.id = p_athlete_id
    and p.role = 'athlete';

  if v_profile.id is null then
    raise exception 'Athlete not found';
  end if;

  v_can_view := auth.uid() is not null and (
    p_athlete_id = auth.uid()
    or exists (
      select 1
      from public.profiles me
      where me.id = auth.uid()
        and (
          me.role in ('coach', 'admin')
          or me.role = 'athlete'
          or (
            me.role = 'parent'
            and exists (
              select 1
              from public.parent_athletes pa
              where pa.parent_id = auth.uid()
                and pa.athlete_id = p_athlete_id
            )
          )
        )
    )
  );

  if not v_can_view then
    raise exception 'You cannot view this rider''s XP';
  end if;

  v_progress := public.sync_profile_xp(p_athlete_id);

  return v_progress || jsonb_build_object(
    'badges', public.get_level_badges(p_athlete_id),
    'current_badge', public.level_badge(coalesce((v_progress->>'level')::integer, 1))
  );
end;
$$;

create or replace function public.sync_assignment_progress_xp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment public.weekly_trick_assignments%rowtype;
  v_row public.assignment_progress%rowtype;
  v_old_date date;
  v_new_date date;
  v_date date;
  v_venue text;
  v_source_id text;
  v_done boolean;
  v_xp integer;
  v_reason text;
begin
  v_row := coalesce(new, old);

  select wta.* into v_assignment
  from public.weekly_trick_assignments wta
  where wta.id = v_row.assignment_id;

  if v_assignment.id is null then
    return coalesce(new, old);
  end if;

  if v_assignment.category = 'daily' then
    v_venue := coalesce(nullif(trim(v_assignment.venue), ''), 'default');
    v_old_date := case when tg_op in ('UPDATE','DELETE') then old.progress_date else null end;
    v_new_date := case when tg_op in ('INSERT','UPDATE') then new.progress_date else null end;

    for v_date in
      select distinct d
      from (values (v_old_date), (v_new_date)) as dates(d)
      where d is not null
    loop
      v_source_id := v_assignment.week_start::text || ':' || v_venue || ':' || v_date::text;
      select not exists (
        select 1
        from public.weekly_trick_assignments a
        left join public.assignment_progress ap on ap.assignment_id = a.id
        where a.athlete_id = v_assignment.athlete_id
          and a.week_start = v_assignment.week_start
          and a.category = 'daily'
          and coalesce(nullif(trim(a.venue), ''), 'default') = v_venue
          and ap.progress_date is distinct from v_date
      ) into v_done;

      perform public.sync_xp_award(
        v_assignment.athlete_id,
        'daily_complete',
        v_source_id,
        case when v_done then 35 else 0 end,
        'Completed full Daily Tricks list',
        v_assignment.id,
        null,
        'Daily Tricks list',
        v_venue,
        null,
        jsonb_build_object('date', v_date, 'venue', v_venue, 'week_start', v_assignment.week_start)
      );
    end loop;

    return coalesce(new, old);
  end if;

  if v_assignment.category in ('one_bang', 'dialled', 'bonus') then
    v_xp := case
      when v_assignment.category = 'bonus' then 250
      else 35
    end;
    v_reason := case
      when v_assignment.category = 'bonus' then 'Completed Bonus Trick'
      when v_assignment.category = 'dialled' then 'Landed Dialled trick'
      else 'Landed One Bang'
    end;

    perform public.sync_xp_award(
      v_assignment.athlete_id,
      v_assignment.category,
      v_assignment.id::text,
      case when tg_op <> 'DELETE' and new.completed_at is not null then v_xp else 0 end,
      v_reason,
      v_assignment.id,
      null,
      v_assignment.trick_name,
      v_assignment.venue,
      null,
      jsonb_build_object('week_start', v_assignment.week_start)
    );
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists assignment_progress_xp_sync on public.assignment_progress;
create trigger assignment_progress_xp_sync
after insert or update of progress_date, completed_at or delete on public.assignment_progress
for each row execute function public.sync_assignment_progress_xp();

create or replace function public.sync_percentage_xp_for_assignment(p_assignment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment public.weekly_trick_assignments%rowtype;
  v_count integer := 0;
  v_landed integer := 0;
  v_percent integer := 0;
  v_xp integer := 0;
begin
  select wta.* into v_assignment
  from public.weekly_trick_assignments wta
  where wta.id = p_assignment_id
    and wta.category = 'percentage';

  if v_assignment.id is null then
    return '{}'::jsonb;
  end if;

  select count(*), count(*) filter (where pa.landed)
  into v_count, v_landed
  from public.percentage_attempts pa
  where pa.assignment_id = p_assignment_id;

  v_percent := case when v_count = 0 then 0 else round((v_landed::numeric / v_count::numeric) * 100)::integer end;
  v_xp := case
    when v_count < 10 then 0
    when v_percent = 100 then 75
    when v_percent >= 90 then 50
    when v_percent >= 80 then 30
    when v_percent >= 70 then 15
    else 0
  end;

  return public.sync_xp_award(
    v_assignment.athlete_id,
    'percentage',
    v_assignment.id::text,
    v_xp,
    'Percentage Trick result: ' || v_percent::text || '%',
    v_assignment.id,
    null,
    v_assignment.trick_name,
    v_assignment.venue,
    null,
    jsonb_build_object('attempts', v_count, 'landed', v_landed, 'missed', v_count - v_landed, 'percentage', v_percent)
  );
end;
$$;

create or replace function public.sync_percentage_attempt_xp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_percentage_xp_for_assignment(coalesce(new.assignment_id, old.assignment_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists percentage_attempt_xp_sync on public.percentage_attempts;
create trigger percentage_attempt_xp_sync
after insert or update or delete on public.percentage_attempts
for each row execute function public.sync_percentage_attempt_xp();

create or replace function public.sync_daily_pb_xp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'athlete'
     and new.daily_pb_seconds is not null
     and (old.daily_pb_seconds is null or new.daily_pb_seconds < old.daily_pb_seconds) then
    perform public.sync_xp_award(
      new.id,
      'daily_pb',
      'daily_pb:' || new.id::text || ':' || new.daily_pb_seconds::text,
      15,
      'Beat Daily Tricks PB',
      null,
      null,
      'Daily Tricks PB',
      '',
      null,
      jsonb_build_object('previous_pb_seconds', old.daily_pb_seconds, 'new_pb_seconds', new.daily_pb_seconds)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_daily_pb_xp_sync on public.profiles;
create trigger profiles_daily_pb_xp_sync
after update of daily_pb_seconds on public.profiles
for each row
when (old.daily_pb_seconds is distinct from new.daily_pb_seconds)
execute function public.sync_daily_pb_xp();

create or replace function public.get_earned_badges(p_athlete_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with week_data as (
    select ((date_trunc('week', timezone('Australia/Brisbane', now()) + interval '1 day') - interval '1 day')::date) as week_start
  ), assignment_stats as (
    select
      count(*) filter (where a.category = 'daily') as daily_total,
      count(*) filter (where a.category = 'one_bang') as one_bang_total,
      count(*) filter (where a.category = 'dialled') as dialled_total,
      count(*) filter (where a.category = 'percentage') as percentage_total,
      count(*) filter (where a.category = 'one_bang' and p.completed_at is not null) as one_bang_done,
      count(*) filter (where a.category = 'dialled' and p.completed_at is not null) as dialled_done,
      count(*) filter (where a.category = 'percentage' and pa.attempt_count >= 10) as percentage_done
    from week_data wd
    left join public.weekly_trick_assignments a
      on a.athlete_id = p_athlete_id and a.week_start = wd.week_start
    left join public.assignment_progress p on p.assignment_id = a.id
    left join (
      select assignment_id, count(*) as attempt_count
      from public.percentage_attempts
      where athlete_id = p_athlete_id
      group by assignment_id
    ) pa on pa.assignment_id = a.id
  ), daily_stats as (
    select count(distinct split_part(source_id, ':', 3))::integer as daily_days
    from public.xp_ledger
    where athlete_id = p_athlete_id
      and source_type = 'daily_complete'
      and created_at >= ((date_trunc('week', timezone('Australia/Brisbane', now()) + interval '1 day') - interval '1 day') at time zone 'Australia/Brisbane')
  ), flags as (
    select
      coalesce(ds.daily_days, 0) >= 7 as daily_all_week,
      coalesce(ast.one_bang_total, 0) > 0 and ast.one_bang_done = ast.one_bang_total as one_bangs_complete,
      coalesce(ast.dialled_total, 0) > 0 and ast.dialled_done = ast.dialled_total as dialled_complete,
      (
        (coalesce(ast.daily_total, 0) = 0 or coalesce(ds.daily_days, 0) >= 7)
        and (coalesce(ast.one_bang_total, 0) = 0 or ast.one_bang_done = ast.one_bang_total)
        and (coalesce(ast.dialled_total, 0) = 0 or ast.dialled_done = ast.dialled_total)
        and (coalesce(ast.percentage_total, 0) = 0 or ast.percentage_done = ast.percentage_total)
        and (coalesce(ast.daily_total, 0) + coalesce(ast.one_bang_total, 0) + coalesce(ast.dialled_total, 0) + coalesce(ast.percentage_total, 0)) > 0
      ) as full_plan_complete
    from assignment_stats ast cross join daily_stats ds
  ), earned as (
    select * from (values
      ('goat', 'GOAT Badge', '🐐', 'Completed the whole weekly training plan', (select full_plan_complete from flags)),
      ('cool', 'Cool Person Badge', '😎', 'Completed Daily Tricks every day this week', (select daily_all_week from flags)),
      ('firework', 'Firework Badge', '🎆', 'Completed all One Bangs', (select one_bangs_complete from flags)),
      ('chain', 'Chain Link Badge', '🔗', 'Completed all Dialled tricks', (select dialled_complete from flags))
    ) as badge(key, label, icon, description, earned)
    where earned
  )
  select coalesce(jsonb_agg(jsonb_build_object('key', key, 'label', label, 'icon', icon, 'description', description) order by key), '[]'::jsonb)
  from earned;
$$;

create or replace function public.backfill_xp_from_current_progress()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  progress_row record;
  daily_row record;
  percentage_row record;
  v_count integer := 0;
begin
  for progress_row in
    select a.*, p.progress_date, p.completed_at
    from public.weekly_trick_assignments a
    join public.assignment_progress p on p.assignment_id = a.id
    where a.category in ('one_bang','dialled','bonus')
      and p.completed_at is not null
  loop
    perform public.sync_xp_award(
      progress_row.athlete_id,
      progress_row.category,
      progress_row.id::text,
      case when progress_row.category = 'bonus' then 250 else 35 end,
      case
        when progress_row.category = 'bonus' then 'Completed Bonus Trick'
        when progress_row.category = 'dialled' then 'Landed Dialled trick'
        else 'Landed One Bang'
      end,
      progress_row.id,
      null,
      progress_row.trick_name,
      progress_row.venue,
      null,
      jsonb_build_object('backfilled', true, 'week_start', progress_row.week_start)
    );
    v_count := v_count + 1;
  end loop;

  for daily_row in
    select
      a.athlete_id,
      a.week_start,
      coalesce(nullif(trim(a.venue), ''), 'default') as venue,
      p.progress_date,
      (array_agg(a.id order by a.sort_order, a.created_at))[1] as assignment_id,
      count(*) as total,
      count(*) filter (where p.progress_date is not null) as done
    from public.weekly_trick_assignments a
    join public.assignment_progress p on p.assignment_id = a.id
    where a.category = 'daily'
      and p.progress_date is not null
    group by a.athlete_id, a.week_start, coalesce(nullif(trim(a.venue), ''), 'default'), p.progress_date
    having count(*) = count(*) filter (where p.progress_date is not null)
  loop
    perform public.sync_xp_award(
      daily_row.athlete_id,
      'daily_complete',
      daily_row.week_start::text || ':' || daily_row.venue || ':' || daily_row.progress_date::text,
      35,
      'Completed full Daily Tricks list',
      daily_row.assignment_id,
      null,
      'Daily Tricks list',
      daily_row.venue,
      null,
      jsonb_build_object('backfilled', true, 'date', daily_row.progress_date, 'week_start', daily_row.week_start)
    );
    v_count := v_count + 1;
  end loop;

  for percentage_row in
    select distinct assignment_id
    from public.percentage_attempts
  loop
    perform public.sync_percentage_xp_for_assignment(percentage_row.assignment_id);
    v_count := v_count + 1;
  end loop;

  perform public.sync_profile_xp(p.id)
  from public.profiles p
  where p.role = 'athlete';

  return jsonb_build_object('backfilled_sources', v_count);
end;
$$;

select public.backfill_xp_from_current_progress();

drop function if exists public.backfill_xp_from_current_progress();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'xp_ledger'
     ) then
    execute 'alter publication supabase_realtime add table public.xp_ledger';
  end if;
end $$;

revoke all on function public.sync_xp_award(uuid, text, text, integer, text, uuid, uuid, text, text, uuid, jsonb) from public;
revoke all on function public.sync_profile_xp(uuid) from public;
revoke all on function public.sync_assignment_progress_xp() from public;
revoke all on function public.sync_percentage_attempt_xp() from public;
revoke all on function public.sync_percentage_xp_for_assignment(uuid) from public;
revoke all on function public.sync_daily_pb_xp() from public;
revoke execute on function public.get_xp_history(uuid) from anon;
revoke execute on function public.get_xp_summary(uuid) from anon;
revoke execute on function public.adjust_athlete_xp(uuid, integer, text) from anon;

grant execute on function public.get_xp_history(uuid) to authenticated;
grant execute on function public.get_xp_summary(uuid) to authenticated;
grant execute on function public.adjust_athlete_xp(uuid, integer, text) to authenticated;
