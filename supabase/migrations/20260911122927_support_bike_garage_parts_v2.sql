-- Accept the expanded cosmetic configuration without rewriting saved bikes.
-- Version 1 keeps its exact original keys/options; version 2 is also strict.
-- Function privileges, RLS, garage slots, revisions and training data are unchanged.

create or replace function private.bike_garage_configuration_is_valid(p_configuration jsonb)
returns boolean
language plpgsql immutable security invoker
set search_path = pg_catalog
as $$
declare
  v_keys text[] := array['version','colors','barStyle','tyreStyle','seatStyle','pegs','decal'];
  v_colors text[] := array['frame','fork','bars','grips','rims','hubs','seat','pedals','cranks','sprocket'];
  v_metals constant text[] := array['frame','fork','bars','rims','hubs','cranks','sprocket','seatpost','stem','headset','pegs'];
  v_is_v2 boolean;
begin
  if p_configuration is null or jsonb_typeof(p_configuration) <> 'object'
     or octet_length(p_configuration::text) > 8192 then
    return false;
  end if;
  if coalesce(p_configuration->'version' not in ('1'::jsonb,'2'::jsonb), true) then
    return false;
  end if;
  v_is_v2 := p_configuration->'version' = '2'::jsonb;
  if v_is_v2 then
    v_keys := v_keys || array['finishes','framePaint','frameFadeColor','pedalMaterial','brakeStyle','spokeStyle','stemStyle','seatDesign'];
    v_colors := v_colors || array['seatpost','stem','headset','spokes','nipples','pegs'];
  end if;
  if not (p_configuration ?& v_keys) or p_configuration - v_keys <> '{}'::jsonb
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
  if not coalesce(
    jsonb_typeof(p_configuration->'barStyle') = 'string'
    and p_configuration->>'barStyle' in ('two-piece','four-piece')
    and jsonb_typeof(p_configuration->'tyreStyle') = 'string'
    and p_configuration->>'tyreStyle' in ('black','tan-wall','white-wall','white')
    and jsonb_typeof(p_configuration->'seatStyle') = 'string'
    and p_configuration->>'seatStyle' in ('slim','padded')
    and jsonb_typeof(p_configuration->'pegs') = 'string'
    and (p_configuration->>'pegs' in ('none','rear','both') or (v_is_v2 and p_configuration->>'pegs' = 'four'))
    and jsonb_typeof(p_configuration->'decal') = 'string'
    and p_configuration->>'decal' in ('jkcrew','lightning','none'), false
  ) then
    return false;
  end if;
  if not v_is_v2 then return true; end if;

  if jsonb_typeof(p_configuration->'finishes') <> 'object' then
    return false;
  end if;
  if not ((p_configuration->'finishes') ?& v_metals)
     or (p_configuration->'finishes') - v_metals <> '{}'::jsonb then
    return false;
  end if;
  if exists (
    select 1 from jsonb_each(p_configuration->'finishes') f
    where jsonb_typeof(f.value) <> 'string' or (f.value #>> '{}') not in ('gloss','matte','chrome','raw','jetfuel')
  ) then
    return false;
  end if;
  return coalesce(
    jsonb_typeof(p_configuration->'framePaint') = 'string'
    and p_configuration->>'framePaint' in ('solid','fade')
    and jsonb_typeof(p_configuration->'frameFadeColor') = 'string'
    and p_configuration->>'frameFadeColor' ~ '^#[0-9A-Fa-f]{6}$'
    and jsonb_typeof(p_configuration->'pedalMaterial') = 'string'
    and p_configuration->>'pedalMaterial' in ('plastic','metal')
    and jsonb_typeof(p_configuration->'brakeStyle') = 'string'
    and p_configuration->>'brakeStyle' in ('none','rear','dual')
    and jsonb_typeof(p_configuration->'spokeStyle') = 'string'
    and p_configuration->>'spokeStyle' in ('standard','rainbow')
    and jsonb_typeof(p_configuration->'stemStyle') = 'string'
    and p_configuration->>'stemStyle' in ('top-load','front-load')
    and jsonb_typeof(p_configuration->'seatDesign') = 'string'
    and (p_configuration->>'seatDesign' = 'solid' or p_configuration->>'seatDesign' ~ '^design-(0[1-9]|[1-4][0-9]|50)$'), false
  );
end;
$$;
