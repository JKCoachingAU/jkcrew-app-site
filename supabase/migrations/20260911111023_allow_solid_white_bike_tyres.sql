-- Add solid white tyres without changing saved builds, existing tyre styles,
-- function privileges, garage ownership, or any other configuration validation.

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
    and p_configuration->>'tyreStyle' in ('black','tan-wall','white-wall','white')
    and jsonb_typeof(p_configuration->'seatStyle') = 'string'
    and p_configuration->>'seatStyle' in ('slim','padded')
    and jsonb_typeof(p_configuration->'pegs') = 'string'
    and p_configuration->>'pegs' in ('none','rear','both')
    and jsonb_typeof(p_configuration->'decal') = 'string'
    and p_configuration->>'decal' in ('jkcrew','lightning','none'), false
  );
end;
$$;
