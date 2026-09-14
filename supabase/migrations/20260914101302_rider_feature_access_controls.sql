-- Reversible feature access. Authentication and the rider dashboard stay available.
-- No existing rider is disabled by this migration.
create table private.rider_feature_access (
  athlete_id uuid primary key references public.profiles(id) on delete cascade,
  features_disabled boolean not null default false,
  disabled_at timestamptz,
  disabled_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (features_disabled = (disabled_at is not null))
);
create table private.rider_feature_access_audit (
  id bigint generated always as identity primary key,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  changed_by uuid references public.profiles(id) on delete set null,
  features_disabled boolean not null,
  changed_at timestamptz not null default now()
);
create index rider_feature_access_audit_athlete_idx on private.rider_feature_access_audit(athlete_id, changed_at desc);
alter table private.rider_feature_access enable row level security;
alter table private.rider_feature_access_audit enable row level security;
revoke all on private.rider_feature_access, private.rider_feature_access_audit from public, anon, authenticated;
revoke all on sequence private.rider_feature_access_audit_id_seq from public, anon, authenticated;

create function private.rider_features_disabled()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from private.rider_feature_access access
    where access.athlete_id = (select auth.uid()) and access.features_disabled
  );
$$;
revoke all on function private.rider_features_disabled() from public, anon;
grant execute on function private.rider_features_disabled() to authenticated;

create function private.get_rider_feature_access()
returns table(athlete_id uuid, features_disabled boolean, disabled_at timestamptz, disabled_by uuid)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
begin
  if v_actor is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  select profile.role::text into v_role from public.profiles profile where profile.id = v_actor;
  return query
  select profile.id, coalesce(access.features_disabled, false), access.disabled_at, access.disabled_by
  from public.profiles profile
  left join private.rider_feature_access access on access.athlete_id = profile.id
  where profile.id = v_actor
     or (v_role in ('coach', 'admin') and profile.role::text = 'athlete' and exists (
       select 1 from public.coach_athletes link where link.coach_id = v_actor and link.athlete_id = profile.id
     ));
end;
$$;
create function public.get_rider_feature_access()
returns table(athlete_id uuid, features_disabled boolean, disabled_at timestamptz, disabled_by uuid)
language sql stable security invoker set search_path = ''
as $$ select * from private.get_rider_feature_access(); $$;
revoke all on function private.get_rider_feature_access(), public.get_rider_feature_access() from public, anon;
grant execute on function private.get_rider_feature_access(), public.get_rider_feature_access() to authenticated;

create function private.set_rider_feature_access(p_athlete_id uuid, p_disabled boolean)
returns table(athlete_id uuid, features_disabled boolean, disabled_at timestamptz, disabled_by uuid)
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_previous boolean;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles actor where actor.id = v_actor and actor.role::text in ('coach', 'admin')
  ) or private.rider_features_disabled() then
    raise exception 'Only a coach can change rider access' using errcode = '42501';
  end if;
  if p_disabled is null then raise exception 'Choose enabled or disabled' using errcode = '22023'; end if;
  -- Serialize concurrent changes and require a linked rider, never a coach or parent.
  perform 1 from public.profiles rider where rider.id = p_athlete_id and rider.role::text = 'athlete'
    and exists (select 1 from public.coach_athletes link where link.coach_id = v_actor and link.athlete_id = rider.id)
  for update;
  if not found then raise exception 'This rider is not linked to your coach account' using errcode = '42501'; end if;
  select access.features_disabled into v_previous from private.rider_feature_access access where access.athlete_id = p_athlete_id;
  if coalesce(v_previous, false) is distinct from p_disabled then
    insert into private.rider_feature_access(athlete_id, features_disabled, disabled_at, disabled_by)
    values(p_athlete_id, p_disabled, case when p_disabled then now() end, case when p_disabled then v_actor end)
    on conflict on constraint rider_feature_access_pkey do update
    set features_disabled = excluded.features_disabled, disabled_at = excluded.disabled_at,
        disabled_by = excluded.disabled_by, updated_at = now();
    insert into private.rider_feature_access_audit(athlete_id, changed_by, features_disabled)
    values(p_athlete_id, v_actor, p_disabled);
  end if;
  return query select p_athlete_id, coalesce(access.features_disabled, false), access.disabled_at, access.disabled_by
  from (values(1)) singleton(n) left join private.rider_feature_access access on access.athlete_id = p_athlete_id;
end;
$$;
create function public.set_rider_feature_access(p_athlete_id uuid, p_disabled boolean)
returns table(athlete_id uuid, features_disabled boolean, disabled_at timestamptz, disabled_by uuid)
language sql security invoker set search_path = ''
as $$ select * from private.set_rider_feature_access(p_athlete_id, p_disabled); $$;
revoke all on function private.set_rider_feature_access(uuid, boolean), public.set_rider_feature_access(uuid, boolean) from public, anon;
grant execute on function private.set_rider_feature_access(uuid, boolean), public.set_rider_feature_access(uuid, boolean) to authenticated;

-- Apply the restriction only to riders explicitly disabled by their linked coach.
-- Everyone else returns immediately after one primary-key lookup in the private
-- access table. The table is empty on installation, so no account loses access.
-- This gateway check is necessary because existing SECURITY DEFINER feature RPCs
-- bypass table RLS. It also covers direct REST writes and GraphQL requests without
-- replacing those functions or changing any existing public-table RLS policies.
create function public.jkcrew_check_rider_feature_access()
returns void language plpgsql security invoker set search_path = ''
as $$
declare
  v_path text := ltrim(coalesce(current_setting('request.path', true), ''), '/');
  v_method text := upper(coalesce(current_setting('request.method', true), ''));
begin
  if current_user = 'service_role' then return; end if;
  if auth.uid() is null then return; end if;
  if not private.rider_features_disabled() then return; end if;
  -- PostgREST normally supplies /profiles or /rpc/name; tolerate the API prefix.
  if v_path like 'rest/v1/%' then v_path := substr(v_path, 9); end if;
  if (v_path = 'profiles' and v_method in ('GET', 'HEAD'))
     or (v_path in ('rpc/get_rider_feature_access', 'rpc/get_weekly_leaderboard', 'rpc/record_my_app_open')
       and v_method in ('GET', 'HEAD', 'POST')) then return; end if;
  raise exception 'You don''t have access to this feature, contact your coach'
    using errcode = '42501';
end;
$$;
revoke all on function public.jkcrew_check_rider_feature_access() from public;
grant execute on function public.jkcrew_check_rider_feature_access() to anon, authenticated, service_role;

-- Storage does not run the Data API hook. Add only write restrictions here;
-- preserve every existing read policy and every ownership policy. These three
-- restrictive policies cannot grant new access and do nothing to enabled users.
-- Existing public-table policies, Realtime read access, avatars and media reads
-- are unchanged. The browser disconnects feature subscriptions when restricted.
create policy rider_feature_access_insert on storage.objects
as restrictive for insert to authenticated
with check (not (select private.rider_features_disabled()));
create policy rider_feature_access_update on storage.objects
as restrictive for update to authenticated
using (not (select private.rider_features_disabled()))
with check (not (select private.rider_features_disabled()));
create policy rider_feature_access_delete on storage.objects
as restrictive for delete to authenticated
using (not (select private.rider_features_disabled()));

-- Read-only production inspection on 14 Sep 2026 found no db_pre_request setting
-- in pg_db_role_setting or the authenticator role. Require that still to be true
-- rather than silently replace an unrelated hook if deployment config changes.
do $$
declare v_existing text;
begin
  select split_part(setting, '=', 2) into v_existing
  from pg_db_role_setting settings join pg_roles role on role.oid = settings.setrole,
    lateral unnest(settings.setconfig) setting
  where role.rolname = 'authenticator' and setting like 'pgrst.db_pre_request=%'
    and split_part(setting, '=', 2) not in ('', 'public.jkcrew_check_rider_feature_access')
  limit 1;
  if v_existing is not null then raise exception 'Existing Data API request hook requires review: %', v_existing; end if;
end;
$$;
alter role authenticator set pgrst.db_pre_request = 'public.jkcrew_check_rider_feature_access';
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
