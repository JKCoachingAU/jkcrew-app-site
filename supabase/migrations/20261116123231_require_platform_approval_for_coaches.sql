-- Account approval is independent of a team invitation or a self-selected role.
-- No existing rider, point, session or media row is moved or removed.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table private.coach_account_access (
  coach_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','suspended')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table private.coach_account_access enable row level security;
revoke all on private.coach_account_access from public, anon, authenticated;
create table private.coach_account_access_audit (
  id bigint generated always as identity primary key,
  coach_id uuid not null references public.profiles(id),
  status text not null,
  reviewed_by uuid not null references public.profiles(id),
  reviewed_at timestamptz not null default now()
);
alter table private.coach_account_access_audit enable row level security;
revoke all on private.coach_account_access_audit from public, anon, authenticated;

insert into private.coach_account_access(coach_id,status)
select id,case when is_platform_owner then 'approved' else 'pending' end
from public.profiles where role::text in ('coach','admin');

create function private.coach_access_approved()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.profiles profile
    where profile.id=auth.uid() and (
      profile.role::text not in ('coach','admin') or profile.is_platform_owner
      or exists(select 1 from private.coach_account_access access
        where access.coach_id=profile.id and access.status='approved')
    )
  );
$$;
revoke all on function private.coach_access_approved() from public,anon;
grant execute on function private.coach_access_approved() to authenticated,service_role;

create function private.require_coach_approval()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  -- Server-side jobs retain their existing service-role behavior. A signed-in
  -- coach always uses their account status, including SECURITY DEFINER calls.
  if auth.uid() is not null and not private.coach_access_approved() then
    raise exception 'Your coach account is awaiting platform approval or has been suspended.' using errcode='42501';
  end if;
end;
$$;
revoke all on function private.require_coach_approval() from public,anon;
grant execute on function private.require_coach_approval() to authenticated,service_role;

create function private.initialize_coach_account_access()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.role::text in ('coach','admin') then
    insert into private.coach_account_access(coach_id,status)
    values(new.id,case when new.is_platform_owner then 'approved' else 'pending' end)
    on conflict(coach_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.initialize_coach_account_access() from public,anon,authenticated;
create trigger initialize_coach_account_access after insert or update of role
on public.profiles for each row execute function private.initialize_coach_account_access();

create function private.protect_profile_access_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare trusted_role text;
begin
  if auth.uid() is null then return new; end if;
  if new.id<>auth.uid() or new.is_platform_owner then
    raise exception 'Profile creation cannot grant platform-owner access.' using errcode='42501';
  end if;
  select coalesce(raw_app_meta_data->>'role','athlete') into trusted_role
    from auth.users where id=auth.uid();
  if new.role::text in ('coach','admin') and new.role::text is distinct from trusted_role then
    raise exception 'Coach privileges require server-issued account registration.' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function private.protect_profile_access_insert() from public,anon,authenticated;
create trigger protect_profile_access_insert before insert on public.profiles
for each row execute function private.protect_profile_access_insert();

-- Restrictive policies are ANDed with every existing owner/link policy.
do $guard$
declare item record;
begin
  for item in select tablename from pg_catalog.pg_tables where schemaname='public' loop
    execute format('alter table public.%I enable row level security',item.tablename);
    if item.tablename='profiles' then
      execute 'create policy coach_account_approval_guard on public.profiles as restrictive for all to authenticated using (id=(select auth.uid()) or (select private.coach_access_approved())) with check (id=(select auth.uid()) or (select private.coach_access_approved()))';
    else
      execute format('create policy coach_account_approval_guard on public.%I as restrictive for all to authenticated using ((select private.coach_access_approved())) with check ((select private.coach_access_approved()))',item.tablename);
    end if;
  end loop;
end $guard$;
create policy coach_account_approval_guard on storage.objects as restrictive
for all to authenticated using ((select private.coach_access_approved()))
with check ((select private.coach_access_approved()));

-- Preserve every existing RPC signature and implementation, and add a gate at
-- each public data entry point. Copies stay in the unexposed private schema.
-- Immutable math helpers and profile bootstrap remain unchanged.
do $rpc_guard$
declare fn record; impl text; definition text; inputs text; outputs text; body text; volatility text;
begin
  for fn in
    select p.*,pg_get_function_arguments(p.oid) arguments,
      pg_get_function_identity_arguments(p.oid) identity_arguments,
      pg_get_function_result(p.oid) result
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f' and p.provolatile<>'i'
      and p.prorettype not in ('pg_catalog.trigger'::regtype,'pg_catalog.event_trigger'::regtype)
      and has_function_privilege('authenticated',p.oid,'EXECUTE')
      and p.proname not in ('ensure_current_profile','jkcrew_check_rider_feature_access')
  loop
    impl := 'approved_'||substr(md5(fn.proname||'('||fn.identity_arguments||')'),1,24);
    definition := pg_get_functiondef(fn.oid);
    definition := regexp_replace(definition,
      'CREATE OR REPLACE FUNCTION public\.'||fn.proname||'\(',
      'CREATE OR REPLACE FUNCTION private.'||impl||'(');
    execute definition;
    if not exists(select 1 from unnest(coalesce(fn.proconfig,'{}'::text[])) setting where setting like 'search_path=%') then
      execute format('alter function private.%I(%s) set search_path=public,pg_temp',impl,fn.identity_arguments);
    end if;
    execute format('revoke all on function private.%I(%s) from public,anon',impl,fn.identity_arguments);
    execute format('grant execute on function private.%I(%s) to authenticated,service_role',impl,fn.identity_arguments);
    select coalesce(string_agg('$'||i,',' order by i),'') into inputs from generate_series(1,fn.pronargs) i;
    select string_agg(quote_ident(fn.proargnames[i]),',' order by i) into outputs
      from generate_subscripts(fn.proargmodes,1) i where fn.proargmodes[i] in ('o','b');
    body := 'begin perform private.require_coach_approval(); '||
      case when fn.proretset then format('return query select * from private.%I(%s);',impl,inputs)
        when outputs is not null then format('select * into %s from private.%I(%s); return;',outputs,impl,inputs)
        when fn.prorettype='pg_catalog.void'::regtype then format('perform private.%I(%s); return;',impl,inputs)
        else format('return private.%I(%s);',impl,inputs) end||' end;';
    volatility := case when fn.provolatile='s' then 'stable' else 'volatile' end;
    execute format('create or replace function public.%I(%s) returns %s language plpgsql %s security invoker set search_path='''' as %L',fn.proname,fn.arguments,fn.result,volatility,body);
    execute format('revoke all on function public.%I(%s) from public,anon',fn.proname,fn.identity_arguments);
    execute format('grant execute on function public.%I(%s) to authenticated,service_role',fn.proname,fn.identity_arguments);
  end loop;
end $rpc_guard$;

create function public.get_my_team_access()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me public.profiles; team public.coach_teams; approval text;
begin
  select * into me from public.profiles where id=auth.uid();
  if me.id is null or me.role::text not in ('coach','admin') then raise exception 'Coach sign-in required.' using errcode='42501'; end if;
  select coalesce(access.status,'pending') into approval from private.coach_account_access access where access.coach_id=me.id;
  if me.is_platform_owner then approval:='approved'; end if;
  select * into team from public.coach_teams where coach_id=me.id and status='active' order by created_at,id limit 1;
  return jsonb_build_object('approval_status',coalesce(approval,'pending'),'team',case when team.id is null then null else jsonb_build_object('id',team.id,'name',team.name,'country_code',team.country_code,'country_name',team.country_name,'role','head_coach') end,'coaches','[]'::jsonb,'can_invite',false);
end;
$$;
revoke all on function public.get_my_team_access() from public,anon;
grant execute on function public.get_my_team_access() to authenticated;

create function public.set_coach_access(p_coach_id uuid,p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and is_platform_owner) then raise exception 'Platform-owner access required.' using errcode='42501'; end if;
  if p_status not in ('pending','approved','suspended') then raise exception 'Invalid approval status.' using errcode='22023'; end if;
  if not exists(select 1 from public.profiles where id=p_coach_id and role::text in ('coach','admin') and not is_platform_owner) then raise exception 'Choose a non-owner coach account.' using errcode='42501'; end if;
  insert into private.coach_account_access(coach_id,status,reviewed_by,reviewed_at) values(p_coach_id,p_status,auth.uid(),now())
  on conflict(coach_id) do update set status=excluded.status,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at;
  insert into private.coach_account_access_audit(coach_id,status,reviewed_by) values(p_coach_id,p_status,auth.uid());
  return jsonb_build_object('coach_id',p_coach_id,'approval_status',p_status);
end;
$$;
revoke all on function public.set_coach_access(uuid,text) from public,anon;
grant execute on function public.set_coach_access(uuid,text) to authenticated;

-- Public object URLs must not bypass team storage policies.
update storage.buckets set public=false where id='profile-showreels';

-- Authorization roles come from server-controlled app metadata. User-editable
-- metadata can supply display details, never coach/admin privileges.
CREATE OR REPLACE FUNCTION public.ensure_current_profile()
 RETURNS profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_user auth.users;
  v_role text;
  v_name text;
  v_profile public.profiles;
begin
  if v_uid is null then
    raise exception 'Sign in required';
  end if;

  select * into v_user from auth.users where id = v_uid;
  if not found then
    raise exception 'User not found';
  end if;

  v_role := coalesce(v_user.raw_app_meta_data ->> 'role', case when v_user.raw_user_meta_data ->> 'role' in ('athlete','parent') then v_user.raw_user_meta_data ->> 'role' else 'athlete' end);
  if v_role not in ('athlete', 'coach', 'admin', 'parent') then
    v_role := 'athlete';
  end if;

  v_name := nullif(trim(coalesce(v_user.raw_user_meta_data ->> 'display_name', split_part(v_user.email, '@', 1), 'JKCREW User')), '');

  insert into public.profiles (id, display_name, email, role)
  values (v_uid, left(v_name, 60), coalesce(v_user.email, ''), v_role::public.user_role)
  on conflict (id) do update
    set email = coalesce(excluded.email, public.profiles.email),
        display_name = case when public.profiles.display_name = '' then excluded.display_name else public.profiles.display_name end,
        role = case
          when public.profiles.role = 'athlete'::public.user_role and excluded.role = 'parent'::public.user_role then excluded.role
          else public.profiles.role
        end,
        updated_at = now()
  returning * into v_profile;

  return v_profile;
end;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text;
begin
  v_role := coalesce(new.raw_app_meta_data ->> 'role', case when new.raw_user_meta_data ->> 'role' in ('athlete','parent') then new.raw_user_meta_data ->> 'role' else 'athlete' end);
  if v_role not in ('athlete', 'coach', 'admin', 'parent') then
    v_role := 'athlete';
  end if;

  insert into public.profiles (id, display_name, email, role)
  values (
    new.id,
    left(coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(coalesce(new.email, ''), '@', 1), 'JKCREW User'), 60),
    coalesce(new.email, ''),
    v_role::public.user_role
  )
  on conflict (id) do update
    set email = excluded.email,
        display_name = case when public.profiles.display_name = '' then excluded.display_name else public.profiles.display_name end,
        role = case
          when public.profiles.role = 'athlete'::public.user_role and excluded.role = 'parent'::public.user_role then excluded.role
          else public.profiles.role
        end,
        updated_at = now();

  return new;
end;
$function$;

create or replace function public.get_platform_coach_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare coaches jsonb; countries jsonb; total_students integer;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and is_platform_owner) then raise exception 'Platform-owner access required.' using errcode='42501'; end if;
  select coalesce(jsonb_agg(to_jsonb(row) order by row.display_name),'[]'::jsonb) into coaches
  from (
    select p.id coach_id,p.display_name,p.email,nullif(p.country_code,'') country_code,nullif(p.country_name,'') country_name,
      case when u.deleted_at is not null then 'disabled' when u.banned_until>now() then 'suspended' when u.confirmed_at is null then 'pending' else 'active' end account_status,
      case when p.is_platform_owner then 'approved' else coalesce(access.status,'pending') end approval_status,
      'head_coach'::text team_role,
      (select t.name from public.coach_teams t where t.coach_id=p.id and t.status='active' order by t.created_at,t.id limit 1) team_name,
      (select count(distinct link.athlete_id)::integer from public.coach_athletes link where link.coach_id=p.id) student_count
    from public.profiles p join auth.users u on u.id=p.id
    left join private.coach_account_access access on access.coach_id=p.id
    where p.role::text in ('coach','admin')
  ) row;
  select coalesce(jsonb_agg(to_jsonb(row) order by row.country_name),'[]'::jsonb) into countries
  from (
    select coalesce(nullif(p.country_code,''),'UNSET') country_code,
      coalesce(max(nullif(p.country_name,'')),'Country not set') country_name,
      count(distinct p.id)::integer coach_count,count(distinct link.athlete_id)::integer student_count
    from public.profiles p left join public.coach_athletes link on link.coach_id=p.id
    where p.role::text in ('coach','admin') group by coalesce(nullif(p.country_code,''),'UNSET')
  ) row;
  select count(distinct athlete_id)::integer into total_students from public.coach_athletes;
  return jsonb_build_object('coaches',coaches,'country_totals',countries,'total_coaches',jsonb_array_length(coaches),'total_students',total_students);
end;
$$;
revoke all on function public.get_platform_coach_overview() from public,anon;
grant execute on function public.get_platform_coach_overview() to authenticated,service_role;

notify pgrst,'reload schema';
