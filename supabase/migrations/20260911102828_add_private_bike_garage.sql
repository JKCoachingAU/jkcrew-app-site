-- Private cosmetic builds only. This does not award points, XP or achievements.
-- Removed slots retain their revision but no name/configuration, preventing an
-- older device from overwriting a different build created later in the same slot.

create schema if not exists private;

create or replace function private.bike_garage_configuration_is_valid(p_configuration jsonb)
returns boolean
language plpgsql immutable security invoker
set search_path = pg_catalog
as $$
declare
  v_keys constant text[] := array['version','colors','barStyle','tyreStyle','seatStyle','pegs','decal'];
  v_colors constant text[] := array['frame','fork','bars','grips','rims','hubs','seat','pedals','cranks','sprocket'];
begin
  if p_configuration is null or jsonb_typeof(p_configuration) <> 'object'
     or octet_length(p_configuration::text) > 8192 then
    return false;
  end if;
  if not (p_configuration ?& v_keys) or p_configuration - v_keys <> '{}'::jsonb
     or p_configuration->'version' <> '1'::jsonb
     or jsonb_typeof(p_configuration->'colors') <> 'object' then
    return false;
  end if;
  if not ((p_configuration->'colors') ?& v_colors)
     or (p_configuration->'colors') - v_colors <> '{}'::jsonb then
    return false;
  end if;
  if exists (
    select 1 from jsonb_each(p_configuration->'colors') c
    where jsonb_typeof(c.value) <> 'string' or (c.value #>> '{}') !~ '^#[0-9A-Fa-f]{6}$'
  ) then
    return false;
  end if;
  return coalesce(
    jsonb_typeof(p_configuration->'barStyle') = 'string'
    and p_configuration->>'barStyle' in ('two-piece','four-piece')
    and jsonb_typeof(p_configuration->'tyreStyle') = 'string'
    and p_configuration->>'tyreStyle' in ('black','tan-wall','white-wall')
    and jsonb_typeof(p_configuration->'seatStyle') = 'string'
    and p_configuration->>'seatStyle' in ('slim','padded')
    and jsonb_typeof(p_configuration->'pegs') = 'string'
    and p_configuration->>'pegs' in ('none','rear','both')
    and jsonb_typeof(p_configuration->'decal') = 'string'
    and p_configuration->>'decal' in ('jkcrew','lightning','none'), false
  );
end;
$$;

revoke all on function private.bike_garage_configuration_is_valid(jsonb) from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.bike_garage_configuration_is_valid(jsonb) to authenticated;

create table public.bike_garage_builds (
  owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  slot integer not null check (slot between 1 and 3),
  name text,
  configuration jsonb,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (owner_id, slot),
  constraint bike_garage_build_or_cleared_slot check (
    (name is null and configuration is null)
    or (
      name is not null and configuration is not null
      and name = btrim(name) and char_length(name) between 1 and 40
      and private.bike_garage_configuration_is_valid(configuration)
    )
  )
);

comment on table public.bike_garage_builds is
  'Three private cosmetic build slots per owner. A removed slot has NULL name/configuration and retains only revision metadata.';

create or replace function private.protect_bike_garage_revision()
returns trigger
language plpgsql security invoker
set search_path = pg_catalog
as $$
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
    new.created_at := clock_timestamp();
  else
    if new.owner_id is distinct from old.owner_id or new.slot is distinct from old.slot then
      raise exception using errcode = '42501', message = 'A bike build cannot change owner or slot.';
    end if;
    new.revision := old.revision + 1;
    new.created_at := old.created_at;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

revoke all on function private.protect_bike_garage_revision() from public, anon, authenticated;
create trigger bike_garage_revision
before insert or update on public.bike_garage_builds
for each row execute function private.protect_bike_garage_revision();

alter table public.bike_garage_builds enable row level security;
create policy bike_garage_owner_select on public.bike_garage_builds
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy bike_garage_owner_insert on public.bike_garage_builds
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy bike_garage_owner_update on public.bike_garage_builds
  for update to authenticated using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

-- Invoker RPCs need table privileges; RLS scopes them to the owner. System
-- columns and physical deletion are deliberately unavailable to client roles.
revoke all on table public.bike_garage_builds from public, anon, authenticated;
grant select on table public.bike_garage_builds to authenticated;
grant insert (slot, name, configuration) on public.bike_garage_builds to authenticated;
grant update (name, configuration) on public.bike_garage_builds to authenticated;

create or replace function public.get_bike_garage()
returns jsonb
language plpgsql stable security invoker
set search_path = pg_catalog
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Sign in to open your Bike Garage.';
  end if;
  return jsonb_build_object('builds', coalesce((
    select jsonb_agg(jsonb_build_object(
      'slot', b.slot, 'name', b.name, 'configuration', b.configuration,
      'revision', b.revision, 'updated_at', b.updated_at
    ) order by b.slot)
    from public.bike_garage_builds b
    where b.owner_id = auth.uid() and b.name is not null
  ), '[]'::jsonb));
end;
$$;

create or replace function public.save_bike_build(
  p_slot integer, p_name text, p_configuration jsonb, p_expected_revision integer
)
returns jsonb
language plpgsql security invoker
set search_path = pg_catalog
as $$
declare
  v_name text := btrim(p_name);
  v_build public.bike_garage_builds%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Sign in to save your bike build.';
  end if;
  if p_slot is null or p_slot not between 1 and 3
     or v_name is null or char_length(v_name) not between 1 and 40
     or p_expected_revision is null or p_expected_revision < 0
     or not private.bike_garage_configuration_is_valid(p_configuration) then
    raise exception using errcode = '22023', message = 'Choose a garage slot from 1 to 3, a name from 1 to 40 characters, and a valid bike configuration.';
  end if;
  if p_expected_revision = 0 then
    insert into public.bike_garage_builds as b (slot, name, configuration)
    values (p_slot, v_name, p_configuration)
    on conflict (owner_id, slot) do update
      set name = excluded.name, configuration = excluded.configuration
      where b.name is null and b.configuration is null
    returning b.* into v_build;
  else
    update public.bike_garage_builds b
    set name = v_name, configuration = p_configuration
    where b.owner_id = auth.uid() and b.slot = p_slot
      and b.revision = p_expected_revision and b.name is not null
    returning b.* into v_build;
  end if;
  if v_build.slot is null then
    raise exception using errcode = '40001', message = 'This garage slot changed on another device. Reload your garage before saving.';
  end if;
  return jsonb_build_object(
    'slot', v_build.slot, 'name', v_build.name, 'configuration', v_build.configuration,
    'revision', v_build.revision, 'updated_at', v_build.updated_at
  );
end;
$$;

create or replace function public.delete_bike_build(p_slot integer, p_expected_revision integer)
returns jsonb
language plpgsql security invoker
set search_path = pg_catalog
as $$
declare
  v_slot integer;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Sign in to remove your bike build.';
  end if;
  if p_slot is null or p_slot not between 1 and 3
     or p_expected_revision is null or p_expected_revision < 1 then
    raise exception using errcode = '22023', message = 'Choose a saved garage slot and its current revision.';
  end if;
  update public.bike_garage_builds b set name = null, configuration = null
  where b.owner_id = auth.uid() and b.slot = p_slot
    and b.revision = p_expected_revision and b.name is not null
  returning b.slot into v_slot;
  if v_slot is null then
    raise exception using errcode = '40001', message = 'This garage slot changed on another device. Reload your garage before removing it.';
  end if;
  return jsonb_build_object('deleted', true);
end;
$$;

revoke all on function public.get_bike_garage() from public, anon, authenticated;
revoke all on function public.save_bike_build(integer,text,jsonb,integer) from public, anon, authenticated;
revoke all on function public.delete_bike_build(integer,integer) from public, anon, authenticated;
grant execute on function public.get_bike_garage() to authenticated;
grant execute on function public.save_bike_build(integer,text,jsonb,integer) to authenticated;
grant execute on function public.delete_bike_build(integer,integer) to authenticated;
