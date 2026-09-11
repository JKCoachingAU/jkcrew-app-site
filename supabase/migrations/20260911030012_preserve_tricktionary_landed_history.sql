-- Landed history is separate from scoring. Keep evidence when a training sheet
-- is replaced, and retain each Daily date without duplicating progress updates.
create table if not exists public.tricktionary_landing_history (
  id text primary key,
  assignment_id uuid,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  trick_name text not null,
  category text not null,
  notes text not null default '',
  venue text not null default '',
  landed_at timestamptz not null,
  landing_date date,
  landed_count integer not null check (landed_count >= 0),
  evidence_type text not null
);
create index if not exists tricktionary_history_athlete_idx on public.tricktionary_landing_history(athlete_id, id);
alter table public.tricktionary_landing_history enable row level security;
revoke all on public.tricktionary_landing_history from public, anon, authenticated;
grant select on public.tricktionary_landing_history to authenticated;
grant all on public.tricktionary_landing_history to service_role;
drop policy if exists tricktionary_history_read on public.tricktionary_landing_history;
create policy tricktionary_history_read on public.tricktionary_landing_history for select to authenticated using (
  athlete_id = (select auth.uid())
  or exists (select 1 from public.coach_athletes c join public.profiles p on p.id=c.coach_id
    where c.coach_id=(select auth.uid()) and c.athlete_id=tricktionary_landing_history.athlete_id and p.role::text in ('coach','admin'))
  or exists (select 1 from public.parent_athletes p where p.parent_id=(select auth.uid()) and p.athlete_id=tricktionary_landing_history.athlete_id)
);

create or replace function public.get_tricktionary_landing_history(p_athlete_id uuid)
returns setof public.tricktionary_landing_history
language sql stable security invoker set search_path = '' as $$
  select h.* from public.tricktionary_landing_history h where h.athlete_id=p_athlete_id order by h.id;
$$;
revoke all on function public.get_tricktionary_landing_history(uuid) from public, anon;
grant execute on function public.get_tricktionary_landing_history(uuid) to authenticated, service_role;

create or replace function private.capture_tricktionary_progress(p_assignment jsonb, p_progress jsonb, p_source text default 'progress')
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_id text;
  v_category text := p_assignment->>'category';
  v_date date := nullif(p_progress->>'progress_date','')::date;
  v_completed timestamptz := nullif(p_progress->>'completed_at','')::timestamptz;
  v_athlete uuid := (p_assignment->>'athlete_id')::uuid;
begin
  if v_category='percentage' or btrim(coalesce(p_assignment->>'trick_name',''))='' then return; end if;
  if (v_category='daily' and v_date is null) or (v_category<>'daily' and v_completed is null) then return; end if;
  if not exists(select 1 from public.profiles where id=v_athlete) then return; end if;
  v_id := case when v_category='daily' then 'daily:' || (p_assignment->>'id') || ':' || v_date::text else 'assignment:' || (p_assignment->>'id') end;
  insert into public.tricktionary_landing_history(id,assignment_id,athlete_id,trick_name,category,notes,venue,landed_at,landing_date,landed_count,evidence_type)
  values(v_id,(p_assignment->>'id')::uuid,v_athlete,p_assignment->>'trick_name',v_category,
    coalesce(p_assignment->>'notes',''),coalesce(p_assignment->>'venue',''),
    coalesce(v_completed,nullif(p_progress->>'updated_at','')::timestamptz,nullif(p_assignment->>'updated_at','')::timestamptz,now()),
    case when v_category='daily' then v_date end,
    case when v_category='dialled' then greatest(1,coalesce(nullif(p_progress->>'streak_count','')::integer,1)) else 1 end,p_source)
  on conflict(id) do update set landed_count=greatest(tricktionary_landing_history.landed_count,excluded.landed_count),
    evidence_type=excluded.evidence_type,
    landed_at=case when tricktionary_landing_history.evidence_type='revoked' then excluded.landed_at
      else least(tricktionary_landing_history.landed_at,excluded.landed_at) end
    where tricktionary_landing_history.evidence_type <> 'revoked' or p_source='progress';
end;
$$;
revoke all on function private.capture_tricktionary_progress(jsonb,jsonb,text) from public, anon, authenticated;

create or replace function private.capture_tricktionary_percentage(p_assignment jsonb, p_attempt jsonb, p_source text default 'percentage')
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if coalesce((p_attempt->>'landed')::boolean,false) is not true or btrim(coalesce(p_assignment->>'trick_name',''))='' then return; end if;
  if not exists(select 1 from public.profiles where id=(p_assignment->>'athlete_id')::uuid) then return; end if;
  insert into public.tricktionary_landing_history(id,assignment_id,athlete_id,trick_name,category,notes,venue,landed_at,landed_count,evidence_type)
  values('percentage:'||(p_attempt->>'id'),(p_assignment->>'id')::uuid,(p_assignment->>'athlete_id')::uuid,
    p_assignment->>'trick_name','percentage',coalesce(p_assignment->>'notes',''),coalesce(p_assignment->>'venue',''),
    coalesce(nullif(p_attempt->>'created_at','')::timestamptz,now()),1,'percentage')
  on conflict(id) do update set landed_count=1,evidence_type='percentage'
    where tricktionary_landing_history.evidence_type='revoked' and p_source='percentage';
end;
$$;
revoke all on function private.capture_tricktionary_percentage(jsonb,jsonb,text) from public, anon, authenticated;

-- Only authorized writes to the existing progress tables can invoke these
-- private trigger functions; they are not exposed as user-callable RPCs.
create or replace function private.sync_tricktionary_progress_history()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_assignment jsonb;
begin
  select to_jsonb(a) into v_assignment from public.weekly_trick_assignments a where a.id=new.assignment_id;
  if v_assignment is null then return new; end if;
  if tg_op='UPDATE' then
    if v_assignment->>'category'='daily' and old.progress_date is not null and new.progress_date is null then
      update public.tricktionary_landing_history set landed_count=0,evidence_type='revoked' where id='daily:'||old.assignment_id::text||':'||old.progress_date::text;
    elsif v_assignment->>'category'<>'daily' and old.completed_at is not null and new.completed_at is null then
      update public.tricktionary_landing_history set landed_count=0,evidence_type='revoked' where id='assignment:'||old.assignment_id::text;
    end if;
  end if;
  perform private.capture_tricktionary_progress(v_assignment,to_jsonb(new));
  return new;
end;
$$;
revoke all on function private.sync_tricktionary_progress_history() from public, anon, authenticated;
drop trigger if exists tricktionary_progress_history on public.assignment_progress;
create trigger tricktionary_progress_history after insert or update of progress_date,completed_at,streak_count on public.assignment_progress
for each row execute function private.sync_tricktionary_progress_history();

create or replace function private.sync_tricktionary_percentage_history()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_assignment jsonb;
begin
  if tg_op='DELETE' then
    -- Cascaded sheet replacement preserves earned history. Clearing an attempt
    -- while its assignment exists is an explicit correction and removes it.
    if exists(select 1 from public.weekly_trick_assignments where id=old.assignment_id) then
      update public.tricktionary_landing_history set landed_count=0,evidence_type='revoked' where id='percentage:'||old.id::text;
    end if;
    return old;
  end if;
  select to_jsonb(a) into v_assignment from public.weekly_trick_assignments a where a.id=new.assignment_id;
  if v_assignment is null then return new; end if;
  if not new.landed then update public.tricktionary_landing_history set landed_count=0,evidence_type='revoked' where id='percentage:'||new.id::text;
  else perform private.capture_tricktionary_percentage(v_assignment,to_jsonb(new)); end if;
  return new;
end;
$$;
revoke all on function private.sync_tricktionary_percentage_history() from public, anon, authenticated;
drop trigger if exists tricktionary_percentage_history on public.percentage_attempts;
create trigger tricktionary_percentage_history after insert or update of landed or delete on public.percentage_attempts
for each row execute function private.sync_tricktionary_percentage_history();

create or replace function private.preserve_tricktionary_assignment_history()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_row record;
begin
  for v_row in select p.* from public.assignment_progress p where p.assignment_id=old.id loop
    perform private.capture_tricktionary_progress(to_jsonb(old),to_jsonb(v_row),'archived_progress');
  end loop;
  for v_row in select p.* from public.percentage_attempts p where p.assignment_id=old.id and p.landed loop
    perform private.capture_tricktionary_percentage(to_jsonb(old),to_jsonb(v_row),'archived_percentage');
  end loop;
  return old;
end;
$$;
revoke all on function private.preserve_tricktionary_assignment_history() from public, anon, authenticated;
drop trigger if exists preserve_tricktionary_assignment_history on public.weekly_trick_assignments;
create trigger preserve_tricktionary_assignment_history before delete on public.weekly_trick_assignments
for each row execute function private.preserve_tricktionary_assignment_history();

-- Evidence-backed repair; no new attempts, XP, points, notifications or profile
-- writes. Stable source IDs make repeating this backfill safe.
do $$
declare v_row record; v_progress jsonb; v_attempt jsonb;
begin
  for v_row in select to_jsonb(a) assignment,to_jsonb(p) progress from public.assignment_progress p
    join public.weekly_trick_assignments a on a.id=p.assignment_id loop
    perform private.capture_tricktionary_progress(v_row.assignment,v_row.progress,'backfill_progress');
  end loop;
  for v_row in select to_jsonb(a) assignment,to_jsonb(p) attempt from public.percentage_attempts p
    join public.weekly_trick_assignments a on a.id=p.assignment_id where p.landed loop
    perform private.capture_tricktionary_percentage(v_row.assignment,v_row.attempt,'backfill_percentage');
  end loop;
  for v_row in select assignment,assignment_progress,'[]'::jsonb as percentage_attempts from private.retired_daily_assignment_backups
    union all select assignment,assignment_progress,percentage_attempts from private.rider_sheet_replacement_backups loop
    for v_progress in select value from jsonb_array_elements(coalesce(v_row.assignment_progress,'[]'::jsonb)) loop
      perform private.capture_tricktionary_progress(v_row.assignment,v_progress,'archived_progress');
    end loop;
    for v_attempt in select value from jsonb_array_elements(coalesce(v_row.percentage_attempts,'[]'::jsonb)) loop
      perform private.capture_tricktionary_percentage(v_row.assignment,v_attempt,'archived_percentage');
    end loop;
  end loop;
end;
$$;

-- Surviving XP evidence restores confirmed results whose original assignment
-- and attempts were deleted before backups existed. Full-list and PB awards
-- are deliberately excluded: they do not name an individual landed trick.
insert into public.tricktionary_landing_history(id,assignment_id,athlete_id,trick_name,category,notes,venue,landed_at,landed_count,evidence_type)
select 'xp:'||x.id::text,nullif(x.source_id,'')::uuid,x.athlete_id,x.trick_name,x.source_type,'',coalesce(x.venue,''),x.created_at,
  case when x.source_type='percentage' then (x.metadata->>'landed')::integer else 1 end,'xp_'||x.source_type
from public.xp_ledger x
where x.assignment_id is null and x.source_type in ('one_bang','dialled','bonus','percentage')
  and btrim(coalesce(x.trick_name,''))<>'' and x.xp>0
  and x.source_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  and (x.source_type<>'percentage' or coalesce((x.metadata->>'landed')::integer,0)>0)
  and not exists(select 1 from public.tricktionary_landing_history h where h.assignment_id=x.source_id::uuid)
on conflict(id) do nothing;

comment on table public.tricktionary_landing_history is 'Private evidence of landed sheet tricks, retained across sheet replacement; independent of points and XP.';
comment on function public.get_tricktionary_landing_history(uuid) is 'Paged landed evidence for the rider, linked coach and linked parents; access enforced by RLS.';
notify pgrst, 'reload schema';
