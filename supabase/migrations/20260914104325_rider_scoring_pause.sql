-- A coach can pause future trick scoring for one rider without disabling login,
-- dashboard, plans or the garage. Empty on installation: nobody is paused here.
-- Existing scores, history, rosters and public RLS policies are not rewritten.
-- Production migration runner executes this file in one transaction.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table private.rider_scoring_pauses (
  athlete_id uuid primary key references public.profiles(id) on delete cascade,
  scoring_paused boolean not null default false,
  paused_at timestamptz,
  paused_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (scoring_paused = (paused_at is not null))
);
create table private.rider_scoring_pause_audit (
  id bigint generated always as identity primary key,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  changed_by uuid references public.profiles(id) on delete set null,
  scoring_paused boolean not null,
  changed_at timestamptz not null default now()
);
create index rider_scoring_pause_audit_athlete_idx on private.rider_scoring_pause_audit(athlete_id, changed_at desc);
alter table private.rider_scoring_pauses enable row level security;
alter table private.rider_scoring_pause_audit enable row level security;
revoke all on private.rider_scoring_pauses, private.rider_scoring_pause_audit from public, anon, authenticated;
revoke all on sequence private.rider_scoring_pause_audit_id_seq from public, anon, authenticated;

create function private.rider_scoring_paused(p_athlete_id uuid)
returns boolean language sql stable security invoker set search_path = ''
as $$
  select exists(select 1 from private.rider_scoring_pauses pause
    where pause.athlete_id = p_athlete_id and pause.scoring_paused);
$$;
revoke all on function private.rider_scoring_paused(uuid) from public, anon, authenticated;

create function private.get_rider_scoring_pause(p_athlete_id uuid)
returns table(athlete_id uuid, scoring_paused boolean, paused_at timestamptz, paused_by uuid)
language plpgsql stable security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or not (v_actor = p_athlete_id or exists(
    select 1 from public.profiles actor join public.coach_athletes link on link.coach_id = actor.id
    where actor.id = v_actor and actor.role::text in ('coach','admin') and link.athlete_id = p_athlete_id
  )) then raise exception 'Only this rider or their coach can view scoring access' using errcode='42501'; end if;
  return query select profile.id, coalesce(pause.scoring_paused,false), pause.paused_at, pause.paused_by
  from public.profiles profile left join private.rider_scoring_pauses pause on pause.athlete_id=profile.id
  where profile.id=p_athlete_id;
end;
$$;
create function public.get_rider_scoring_pause(p_athlete_id uuid)
returns table(athlete_id uuid, scoring_paused boolean, paused_at timestamptz, paused_by uuid)
language sql stable security invoker set search_path = ''
as $$ select * from private.get_rider_scoring_pause(p_athlete_id); $$;
revoke all on function private.get_rider_scoring_pause(uuid), public.get_rider_scoring_pause(uuid) from public, anon;
grant execute on function private.get_rider_scoring_pause(uuid), public.get_rider_scoring_pause(uuid) to authenticated;

create function private.set_rider_scoring_pause(p_athlete_id uuid,p_paused boolean)
returns table(athlete_id uuid, scoring_paused boolean, paused_at timestamptz, paused_by uuid)
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_previous boolean;
begin
  if v_actor is null or not exists(select 1 from public.profiles actor where actor.id=v_actor and actor.role::text in ('coach','admin')) then
    raise exception 'Only a coach can pause or resume rider scoring' using errcode='42501';
  end if;
  if p_paused is null then raise exception 'Choose paused or active scoring' using errcode='22023'; end if;
  perform 1 from public.profiles rider where rider.id=p_athlete_id and rider.role::text='athlete'
    and exists(select 1 from public.coach_athletes link where link.coach_id=v_actor and link.athlete_id=rider.id)
  for update;
  if not found then raise exception 'This rider is not linked to your coach account' using errcode='42501'; end if;
  select pause.scoring_paused into v_previous from private.rider_scoring_pauses pause where pause.athlete_id=p_athlete_id;
  if coalesce(v_previous,false) is distinct from p_paused then
    insert into private.rider_scoring_pauses(athlete_id,scoring_paused,paused_at,paused_by)
    values(p_athlete_id,p_paused,case when p_paused then now() end,case when p_paused then v_actor end)
    on conflict on constraint rider_scoring_pauses_pkey do update set
      scoring_paused=excluded.scoring_paused,paused_at=excluded.paused_at,paused_by=excluded.paused_by,updated_at=now();
    insert into private.rider_scoring_pause_audit(athlete_id,changed_by,scoring_paused) values(p_athlete_id,v_actor,p_paused);
  end if;
  return query select p_athlete_id,coalesce(pause.scoring_paused,false),pause.paused_at,pause.paused_by
  from (values(1)) singleton(n) left join private.rider_scoring_pauses pause on pause.athlete_id=p_athlete_id;
end;
$$;
create function public.set_rider_scoring_pause(p_athlete_id uuid,p_paused boolean)
returns table(athlete_id uuid, scoring_paused boolean, paused_at timestamptz, paused_by uuid)
language sql security invoker set search_path = ''
as $$ select * from private.set_rider_scoring_pause(p_athlete_id,p_paused); $$;
revoke all on function private.set_rider_scoring_pause(uuid,boolean), public.set_rider_scoring_pause(uuid,boolean) from public, anon;
grant execute on function private.set_rider_scoring_pause(uuid,boolean), public.set_rider_scoring_pause(uuid,boolean) to authenticated;

-- These BEFORE triggers guard canonical scoring records even when the actor is a
-- coach or the write comes through a SECURITY DEFINER RPC. Failure rolls back
-- the complete request, including any preceding award/XP/notification writes.
-- Only the named scoring tables receive a trigger; no policy or gateway changes.
create function private.guard_paused_rider_scoring()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op='UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_assignment uuid;
  v_session uuid;
  v_owner uuid;
  v_paused boolean := false;
  v_existing jsonb;
  v_new_score boolean;
  v_relocated boolean;
  v_block boolean := false;
begin
  -- Resolve both the supplied rider and canonical referenced owners. This prevents
  -- bypassing a pause by supplying another athlete_id on the paused rider's list.
  for v_owner in select distinct id from (values
    (nullif(v_new->>'athlete_id','')::uuid),(nullif(v_old->>'athlete_id','')::uuid)) ids(id) where id is not null
  loop
    v_paused := v_paused or private.rider_scoring_paused(v_owner);
  end loop;
  for v_assignment in select distinct id from (values
    (nullif(v_new->>'assignment_id','')::uuid),(nullif(v_old->>'assignment_id','')::uuid)) ids(id) where id is not null
  loop
    select assignment.athlete_id into v_owner from public.weekly_trick_assignments assignment where assignment.id=v_assignment;
    v_paused := v_paused or private.rider_scoring_paused(v_owner);
  end loop;
  for v_session in select distinct id from (values
    (nullif(v_new->>'session_id','')::uuid),(nullif(v_old->>'session_id','')::uuid),
    (nullif(v_new->>'training_session_id','')::uuid),(nullif(v_old->>'training_session_id','')::uuid)) ids(id) where id is not null
  loop
    select session.athlete_id into v_owner from public.training_sessions session where session.id=v_session;
    v_paused := v_paused or private.rider_scoring_paused(v_owner);
  end loop;
  if not v_paused then return new; end if;

  -- BEFORE INSERT also runs before ON CONFLICT. Consult the existing natural-key
  -- row so harmless retries and reduced-XP / landed-to-missed undo remain valid.
  if tg_op='INSERT' then
    case tg_table_name
      when 'assignment_progress' then
        select to_jsonb(progress) into v_existing from public.assignment_progress progress where progress.assignment_id=(v_new->>'assignment_id')::uuid;
      when 'percentage_attempts' then
        select to_jsonb(attempt) into v_existing from public.percentage_attempts attempt
          where attempt.assignment_id=(v_new->>'assignment_id')::uuid and attempt.attempt_number=(v_new->>'attempt_number')::integer;
      when 'assignment_point_awards' then
        select to_jsonb(award) into v_existing from public.assignment_point_awards award
          where award.athlete_id=(v_new->>'athlete_id')::uuid and award.award_key=v_new->>'award_key';
      when 'xp_ledger' then
        select to_jsonb(award) into v_existing from public.xp_ledger award where award.athlete_id=(v_new->>'athlete_id')::uuid
          and award.source_type=v_new->>'source_type' and award.source_id=v_new->>'source_id';
      else null;
    end case;
    v_old := coalesce(v_existing,'{}'::jsonb);
  end if;
  v_new_score := v_old='{}'::jsonb;
  -- A conflict INSERT may omit columns that DO UPDATE does not change. Enforce
  -- relocation on the resulting UPDATE row, not the proposed INSERT defaults.
  v_relocated := tg_op='UPDATE' and not v_new_score and (
    v_new->>'athlete_id' is distinct from v_old->>'athlete_id'
    or v_new->>'assignment_id' is distinct from v_old->>'assignment_id'
    or v_new->>'session_id' is distinct from v_old->>'session_id'
    or v_new->>'training_session_id' is distinct from v_old->>'training_session_id');

  case tg_table_name
    when 'assignment_progress' then
      v_block := ((v_new->>'progress_date') is not null and (v_new_score or v_relocated or v_new->>'progress_date' is distinct from v_old->>'progress_date'))
        or ((v_new->>'completed_at') is not null and (v_new_score or v_relocated or v_new->>'completed_at' is distinct from v_old->>'completed_at'))
        or coalesce((v_new->>'streak_count')::integer,0)>case when v_new_score or v_relocated then 0 else coalesce((v_old->>'streak_count')::integer,0) end;
    when 'percentage_attempts' then
      -- Even a missed attempt counts towards a completed ten-attempt set.
      v_block := v_new_score or v_relocated
        or (coalesce((v_new->>'landed')::boolean,false) and not coalesce((v_old->>'landed')::boolean,false))
        or v_new->>'attempt_number' is distinct from v_old->>'attempt_number';
    when 'assignment_attempts' then
      v_block := v_new_score or v_relocated or v_new->>'attempted_at' is distinct from v_old->>'attempted_at';
    when 'trick_attempts' then
      v_block := (v_new->>'status'='landed' and (v_new_score or v_relocated or v_old->>'status' is distinct from 'landed'))
        or greatest(coalesce((v_new->>'points')::integer,0),0)>case when v_new_score or v_relocated then 0 else greatest(coalesce((v_old->>'points')::integer,0),0) end
        or (not v_new_score and (v_new->>'status'='landed' or coalesce((v_new->>'points')::integer,0)>0)
          and (v_new->>'created_at' is distinct from v_old->>'created_at'
            or v_new->>'trick_name' is distinct from v_old->>'trick_name'
            or v_new->>'category' is distinct from v_old->>'category'));
    when 'assignment_point_awards' then
      v_block := greatest(coalesce((v_new->>'points')::integer,0),0)>case when v_new_score or v_relocated then 0 else greatest(coalesce((v_old->>'points')::integer,0),0) end
        or (coalesce((v_new->>'points')::integer,0)>0 and not v_new_score
          and (v_new->>'award_key' is distinct from v_old->>'award_key'
            or (tg_op='UPDATE' and v_new->>'created_at' is distinct from v_old->>'created_at')));
    when 'training_sessions' then
      v_block := greatest(coalesce((v_new->>'total_points')::integer,0),0)>case when v_new_score or v_relocated then 0 else greatest(coalesce((v_old->>'total_points')::integer,0),0) end
        or (coalesce((v_new->>'total_points')::integer,0)>0 and not v_new_score and v_new->>'started_at' is distinct from v_old->>'started_at')
        or (v_new->>'daily_completed_at' is not null and (v_new_score or v_relocated or v_new->>'daily_completed_at' is distinct from v_old->>'daily_completed_at'))
        or (v_new->>'daily_completed_seconds' is not null and (v_new_score or v_relocated or v_new->>'daily_completed_seconds' is distinct from v_old->>'daily_completed_seconds'));
    when 'coach_group_session_participants' then
      v_block := (v_new->>'daily_finished_at' is not null and (v_new_score or v_relocated or v_new->>'daily_finished_at' is distinct from v_old->>'daily_finished_at'))
        or (v_new->>'daily_finish_seconds' is not null and (v_new_score or v_relocated or v_new->>'daily_finish_seconds' is distinct from v_old->>'daily_finish_seconds'));
    when 'xp_ledger' then
      -- The legacy sync_xp_award RPC accepts a caller-supplied source_type.
      -- Do not let unknown labels or a forged coach_adjustment bypass the pause.
      -- Genuine linked-coach historical adjustments remain explicitly available.
      v_block := not (v_new->>'source_type'='coach_adjustment' and exists(
        select 1 from public.profiles actor join public.coach_athletes link on link.coach_id=actor.id
        where actor.id=auth.uid() and actor.role::text in ('coach','admin')
          and link.athlete_id=(v_new->>'athlete_id')::uuid))
        and (greatest(coalesce((v_new->>'xp')::integer,0),0)>case when v_new_score or v_relocated or v_new->>'source_id' is distinct from v_old->>'source_id' or v_new->>'source_type' is distinct from v_old->>'source_type'
          then 0 else greatest(coalesce((v_old->>'xp')::integer,0),0) end
          or (coalesce((v_new->>'xp')::integer,0)>0 and not v_new_score and tg_op='UPDATE'
            and v_new->>'created_at' is distinct from v_old->>'created_at'));
    else raise exception 'Unexpected scoring guard table: %',tg_table_name;
  end case;
  if v_block then raise exception 'Trick scoring is paused for this rider. Contact your coach.' using errcode='42501'; end if;
  return new;
end;
$$;
revoke all on function private.guard_paused_rider_scoring() from public, anon, authenticated;

create trigger guard_rider_scoring_pause before insert or update on public.assignment_progress
for each row execute function private.guard_paused_rider_scoring();
create trigger guard_rider_scoring_pause before insert or update on public.percentage_attempts
for each row execute function private.guard_paused_rider_scoring();
create trigger guard_rider_scoring_pause before insert or update on public.assignment_attempts
for each row execute function private.guard_paused_rider_scoring();
create trigger guard_rider_scoring_pause before insert or update on public.trick_attempts
for each row execute function private.guard_paused_rider_scoring();
create trigger guard_rider_scoring_pause before insert or update on public.assignment_point_awards
for each row execute function private.guard_paused_rider_scoring();
create trigger guard_rider_scoring_pause before insert or update on public.training_sessions
for each row execute function private.guard_paused_rider_scoring();
create trigger guard_rider_scoring_pause before insert or update on public.coach_group_session_participants
for each row execute function private.guard_paused_rider_scoring();
create trigger guard_rider_scoring_pause before insert or update on public.xp_ledger
for each row execute function private.guard_paused_rider_scoring();
notify pgrst, 'reload schema';
