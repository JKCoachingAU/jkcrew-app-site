-- Accept the optional component-model choices introduced by Bike Garage 2.14.104.
-- Existing V1/V2/V3 saves remain valid; no rows, RPCs, RLS policies, grants or
-- revision rules are changed.

create or replace function private.bike_garage_configuration_is_valid(p_configuration jsonb)
returns boolean
language plpgsql immutable security invoker
set search_path = pg_catalog
as $$
declare
  v_keys text[] := array['version','colors','barStyle','tyreStyle','seatStyle','pegs','decal'];
  v_component_keys constant text[] := array['frameModel','forkModel','barModel','tireTread','hubStyle','crankModel','sprocketStyle','gripStyle'];
  v_colors text[] := array['frame','fork','bars','grips','rims','hubs','seat','pedals','cranks','sprocket'];
  v_metals constant text[] := array['frame','fork','bars','rims','hubs','cranks','sprocket','seatpost','stem','headset','pegs'];
  v_allowed_keys text[];
  v_has_parts boolean;
  v_is_v3 boolean;
begin
  if p_configuration is null or jsonb_typeof(p_configuration) <> 'object'
     or octet_length(p_configuration::text) > 8192 then
    return false;
  end if;
  if coalesce(p_configuration->'version' not in ('1'::jsonb,'2'::jsonb,'3'::jsonb), true) then
    return false;
  end if;
  v_has_parts := p_configuration->'version' in ('2'::jsonb,'3'::jsonb);
  v_is_v3 := p_configuration->'version' = '3'::jsonb;
  if v_has_parts then
    v_keys := v_keys || array['finishes','framePaint','frameFadeColor','pedalMaterial','brakeStyle','spokeStyle','stemStyle','seatDesign'];
    v_colors := v_colors || array['seatpost','stem','headset','spokes','nipples','pegs'];
  end if;
  if v_is_v3 then
    v_keys := v_keys || array['driveSide','background'];
  end if;
  v_allowed_keys := v_keys || case when v_is_v3 then v_component_keys else array[]::text[] end;
  if not (p_configuration ?& v_keys) or p_configuration - v_allowed_keys <> '{}'::jsonb
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
    and (p_configuration->>'pegs' in ('none','rear','both') or (v_has_parts and p_configuration->>'pegs' = 'four'))
    and jsonb_typeof(p_configuration->'decal') = 'string'
    and p_configuration->>'decal' in ('jkcrew','lightning','none'), false
  ) then
    return false;
  end if;
  if not v_has_parts then return true; end if;

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
  if v_is_v3 and not coalesce(
    jsonb_typeof(p_configuration->'driveSide') = 'string'
    and p_configuration->>'driveSide' in ('rhd','lhd')
    and jsonb_typeof(p_configuration->'background') = 'string'
    and p_configuration->>'background' in ('studio','street','skatepark','warehouse','rooftop'), false
  ) then
    return false;
  end if;
  if v_is_v3 and not coalesce(
    (not (p_configuration ? 'frameModel') or (jsonb_typeof(p_configuration->'frameModel') = 'string' and p_configuration->>'frameModel' in ('compact','standard','long','tall')))
    and (not (p_configuration ? 'forkModel') or (jsonb_typeof(p_configuration->'forkModel') = 'string' and p_configuration->>'forkModel' in ('lightweight','standard','heavy-duty')))
    and (not (p_configuration ? 'barModel') or (jsonb_typeof(p_configuration->'barModel') = 'string' and p_configuration->>'barModel' in ('street-low','classic-mid','tall-ak')))
    and (not (p_configuration ? 'tireTread') or (jsonb_typeof(p_configuration->'tireTread') = 'string' and p_configuration->>'tireTread' in ('slick','all-round','knobby')))
    and (not (p_configuration ? 'hubStyle') or (jsonb_typeof(p_configuration->'hubStyle') = 'string' and p_configuration->>'hubStyle' in ('cassette','freecoaster')))
    and (not (p_configuration ? 'crankModel') or (jsonb_typeof(p_configuration->'crankModel') = 'string' and p_configuration->>'crankModel' in ('three-piece','two-piece')))
    and (not (p_configuration ? 'sprocketStyle') or (jsonb_typeof(p_configuration->'sprocketStyle') = 'string' and p_configuration->>'sprocketStyle' in ('cutout','guard')))
    and (not (p_configuration ? 'gripStyle') or (jsonb_typeof(p_configuration->'gripStyle') = 'string' and p_configuration->>'gripStyle' in ('flangeless','flanged'))), false
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
    and (p_configuration->>'brakeStyle' in ('none','rear','dual')
      or (v_is_v3 and p_configuration->>'brakeStyle' = 'front'))
    and jsonb_typeof(p_configuration->'spokeStyle') = 'string'
    and p_configuration->>'spokeStyle' in ('standard','rainbow')
    and jsonb_typeof(p_configuration->'stemStyle') = 'string'
    and p_configuration->>'stemStyle' in ('top-load','front-load')
    and jsonb_typeof(p_configuration->'seatDesign') = 'string'
    and (p_configuration->>'seatDesign' = 'solid' or p_configuration->>'seatDesign' ~ '^design-(0[1-9]|[1-4][0-9]|50)$'), false
  );
end;
$$;
