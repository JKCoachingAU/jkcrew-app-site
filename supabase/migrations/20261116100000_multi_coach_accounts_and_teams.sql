-- Secure multi-coach accounts and team ownership.
-- Existing coach_athletes rows remain the source of truth for the current
-- app; coach_teams adds an explicit team boundary without moving any rider
-- progress, runs, tricks or media.

alter table public.profiles
  add column if not exists is_platform_owner boolean not null default false;

-- Preserve the existing JKCREW owner/coach account while keeping its team
-- separate from all future coaches. The email is an existing account value,
-- not a generated key.
update public.profiles
set is_platform_owner = true,
    updated_at = now()
where lower(email) = 'joshkhourybmx@gmail.com'
  and role = 'coach'::public.user_role;

create table if not exists public.coach_teams (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  country_code text not null default '' check (country_code = '' or country_code ~ '^[A-Z]{2}$'),
  country_name text not null default '' check (char_length(country_name) <= 80),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists coach_teams_coach_name_idx
  on public.coach_teams (coach_id, lower(name));
create index if not exists coach_teams_coach_status_idx
  on public.coach_teams (coach_id, status, created_at, id);

comment on table public.coach_teams is 'Coach-owned teams. Team membership is represented by coach_athletes.team_id.';
comment on column public.coach_teams.country_code is 'ISO 3166-1 alpha-2 code selected by the coach.';

alter table public.coach_athletes
  add column if not exists team_id uuid references public.coach_teams(id) on delete restrict;

create index if not exists coach_athletes_team_idx
  on public.coach_athletes (coach_id, team_id, athlete_id);

-- Every existing coach gets one default team; existing student links are
-- assigned to that team. No student/progress rows are copied or deleted.
insert into public.coach_teams (coach_id, name, country_code, country_name)
select p.id,
       left(coalesce(nullif(btrim(p.display_name), ''), 'JKCREW Team'), 80),
       coalesce(p.country_code, ''),
       left(coalesce(p.country_name, ''), 80)
from public.profiles p
where p.role in ('coach'::public.user_role, 'admin'::public.user_role)
  and not exists (select 1 from public.coach_teams t where t.coach_id = p.id);

update public.coach_athletes ca
set team_id = t.id
from public.coach_teams t
where ca.team_id is null
  and t.coach_id = ca.coach_id
  and t.status = 'active'
  and t.id = (
    select t2.id from public.coach_teams t2
    where t2.coach_id = ca.coach_id and t2.status = 'active'
    order by t2.created_at, t2.id
    limit 1
  );

create or replace function private.protect_profile_access_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- The service-role signup function has no auth.uid(). Signed-in clients
  -- may update their profile details, but never role or owner privileges.
  if auth.uid() is not null then
    if new.role is distinct from old.role then
      raise exception 'Account type cannot be changed from the app.' using errcode = '42501';
    end if;
    if new.is_platform_owner is distinct from old.is_platform_owner then
      raise exception 'Platform-owner access cannot be changed from the app.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.protect_profile_access_fields() from public, anon, authenticated;
drop trigger if exists protect_profile_access_fields on public.profiles;
create trigger protect_profile_access_fields
before update on public.profiles
for each row execute function private.protect_profile_access_fields();

create or replace function private.ensure_coach_default_team()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.role in ('coach'::public.user_role, 'admin'::public.user_role)
     and (tg_op = 'INSERT' or old.role not in ('coach'::public.user_role, 'admin'::public.user_role)) then
    insert into public.coach_teams (coach_id, name, country_code, country_name)
    values (
      new.id,
      left(coalesce(nullif(btrim(new.display_name), ''), 'My Team'), 80),
      coalesce(new.country_code, ''),
      left(coalesce(new.country_name, ''), 80)
    )
    on conflict (coach_id, lower(name)) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.ensure_coach_default_team() from public, anon, authenticated;
drop trigger if exists ensure_coach_default_team on public.profiles;
create trigger ensure_coach_default_team
after insert or update of role on public.profiles
for each row execute function private.ensure_coach_default_team();

create or replace function private.validate_coach_team_membership()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_team uuid;
begin
  if auth.uid() is not null and new.coach_id is distinct from auth.uid() then
    raise exception 'A coach can only edit their own team links.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = new.coach_id and p.role in ('coach'::public.user_role, 'admin'::public.user_role)
  ) then
    raise exception 'Only a coach can own student links.' using errcode = '42501';
  end if;
  if new.team_id is null then
    select t.id into v_team
    from public.coach_teams t
    where t.coach_id = new.coach_id and t.status = 'active'
    order by t.created_at, t.id
    limit 1;
    if v_team is null then
      insert into public.coach_teams (coach_id, name)
      values (new.coach_id, 'My Team')
      on conflict (coach_id, lower(name)) do update set updated_at = now()
      returning id into v_team;
    end if;
    new.team_id := v_team;
  end if;
  if not exists (
    select 1 from public.coach_teams t
    where t.id = new.team_id and t.coach_id = new.coach_id and t.status = 'active'
  ) then
    raise exception 'Choose an active team owned by this coach.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_coach_team_membership() from public, anon, authenticated;
drop trigger if exists validate_coach_team_membership on public.coach_athletes;
create trigger validate_coach_team_membership
before insert or update on public.coach_athletes
for each row execute function private.validate_coach_team_membership();

alter table public.coach_teams enable row level security;
revoke all on public.coach_teams from public, anon, authenticated;
grant select, insert, update, delete on public.coach_teams to authenticated;

drop policy if exists coach_teams_select on public.coach_teams;
create policy coach_teams_select on public.coach_teams
for select to authenticated
using (
  coach_id = (select auth.uid())
  and (select private.current_user_role()) in ('coach'::public.user_role, 'admin'::public.user_role)
);
drop policy if exists coach_teams_insert on public.coach_teams;
create policy coach_teams_insert on public.coach_teams
for insert to authenticated
with check (
  coach_id = (select auth.uid())
  and (select private.current_user_role()) in ('coach'::public.user_role, 'admin'::public.user_role)
);
drop policy if exists coach_teams_update on public.coach_teams;
create policy coach_teams_update on public.coach_teams
for update to authenticated
using (
  coach_id = (select auth.uid())
  and (select private.current_user_role()) in ('coach'::public.user_role, 'admin'::public.user_role)
)
with check (
  coach_id = (select auth.uid())
  and (select private.current_user_role()) in ('coach'::public.user_role, 'admin'::public.user_role)
);
drop policy if exists coach_teams_delete on public.coach_teams;
create policy coach_teams_delete on public.coach_teams
for delete to authenticated
using (
  coach_id = (select auth.uid())
  and (select private.current_user_role()) in ('coach'::public.user_role, 'admin'::public.user_role)
  and status = 'archived'
);

-- Replace the old global coach profile read with a linked-team policy. This
-- keeps coach searches and exports from crossing account boundaries.
drop policy if exists "Coaches can view parent and athlete profiles" on public.profiles;
drop policy if exists "Coaches can view linked team profiles" on public.profiles;
create policy "Coaches can view linked team profiles"
on public.profiles
for select to authenticated
using (
  (
    role = 'athlete'::public.user_role
    and exists (
      select 1 from public.coach_athletes ca
      where ca.coach_id = (select auth.uid()) and ca.athlete_id = profiles.id
    )
  )
  or (
    role = 'parent'::public.user_role
    and exists (
      select 1
      from public.parent_athletes pa
      join public.coach_athletes ca on ca.athlete_id = pa.athlete_id
      where pa.parent_id = profiles.id and ca.coach_id = (select auth.uid())
    )
  )
);

create or replace function public.get_platform_coach_overview()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed boolean;
  v_coaches jsonb;
  v_countries jsonb;
begin
  select coalesce(p.is_platform_owner, false) into v_allowed
  from public.profiles p
  where p.id = auth.uid();
  if auth.uid() is null or not coalesce(v_allowed, false) then
    raise exception 'Platform-owner access required.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(rows) order by rows.display_name), '[]'::jsonb)
  into v_coaches
  from (
    select p.id as coach_id,
           p.display_name,
           p.email,
           nullif(p.country_code, '') as country_code,
           nullif(p.country_name, '') as country_name,
           case
             when u.deleted_at is not null then 'disabled'
             when u.banned_until is not null and u.banned_until > now() then 'suspended'
             when u.confirmed_at is null then 'pending'
             else 'active'
           end as account_status,
           count(distinct ca.athlete_id)::integer as student_count
    from public.profiles p
    left join auth.users u on u.id = p.id
    left join public.coach_athletes ca on ca.coach_id = p.id
    where p.role = 'coach'::public.user_role
    group by p.id, p.display_name, p.email, p.country_code, p.country_name,
             u.deleted_at, u.banned_until, u.confirmed_at
  ) rows;

  select coalesce(jsonb_agg(to_jsonb(rows) order by rows.country_name), '[]'::jsonb)
  into v_countries
  from (
    select coalesce(nullif(p.country_code, ''), 'UNSET') as country_code,
           coalesce(nullif(p.country_name, ''), 'Country not set') as country_name,
           count(*)::integer as coach_count,
           count(distinct ca.athlete_id)::integer as student_count
    from public.profiles p
    left join public.coach_athletes ca on ca.coach_id = p.id
    where p.role = 'coach'::public.user_role
    group by coalesce(nullif(p.country_code, ''), 'UNSET'),
             coalesce(nullif(p.country_name, ''), 'Country not set')
  ) rows;

  return jsonb_build_object(
    'coaches', v_coaches,
    'country_totals', v_countries,
    'total_coaches', jsonb_array_length(v_coaches),
    'total_students', coalesce((select sum((item->>'student_count')::integer) from jsonb_array_elements(v_coaches) item), 0)
  );
end;
$$;
revoke all on function public.get_platform_coach_overview() from public, anon;
grant execute on function public.get_platform_coach_overview() to authenticated;

