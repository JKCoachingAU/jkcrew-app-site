-- Coach-approved exact-name defaults. No rider overrides are inferred or copied
-- into this catalog; personal placements remain authoritative.
create table private.tricktionary_catalog (
  coach_id uuid not null references public.profiles(id) on delete cascade,
  source_key text not null check (char_length(source_key) between 1 and 120),
  display_title text not null check (char_length(display_title) between 1 and 120),
  category text not null,
  subcategory text,
  updated_at timestamptz not null default now(),
  primary key (coach_id, source_key),
  check (private.tricktionary_subcategory_is_valid(category, subcategory))
);
alter table private.tricktionary_catalog enable row level security;
revoke all on table private.tricktionary_catalog from public, anon, authenticated;

create function private.tricktionary_automation_role()
returns text language plpgsql stable set search_path = '' as $$
declare v_role text;
begin
  select role::text into v_role from public.profiles where id = auth.uid();
  if auth.uid() is null or v_role is null or v_role not in ('athlete','coach','admin','parent')
     or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then
    raise exception 'Sign in to use the Tricktionary.' using errcode = '42501';
  end if;
  if private.rider_features_disabled() then
    raise exception 'You don''t have access to this feature, contact your coach' using errcode = '42501';
  end if;
  return v_role;
end;
$$;
revoke all on function private.tricktionary_automation_role() from public, anon, authenticated;

create function private.read_tricktionary_catalog(p_athlete_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_role text := private.tricktionary_automation_role();
  v_athlete uuid := coalesce(p_athlete_id, v_user);
  v_result jsonb;
begin
  if v_role in ('coach','admin') then
    if p_athlete_id is not null and v_role <> 'admin' and not exists (
      select 1 from public.coach_athletes where coach_id = v_user and athlete_id = p_athlete_id
    ) then raise exception 'Choose a rider in your crew.' using errcode = '42501'; end if;
  elsif not (
    (v_role = 'athlete' and v_athlete = v_user)
    or (v_role = 'parent' and exists (
      select 1 from public.parent_athletes where parent_id = v_user and athlete_id = v_athlete
    ))
  ) then raise exception 'You cannot view this rider''s catalog.' using errcode = '42501'; end if;

  with visible as (
    select catalog.* from private.tricktionary_catalog catalog
    where (v_role in ('coach','admin') and catalog.coach_id = v_user)
      or (v_role in ('athlete','parent') and exists (
        select 1 from public.coach_athletes link join public.profiles coach on coach.id = link.coach_id
        where link.athlete_id = v_athlete and link.coach_id = catalog.coach_id and coach.role::text in ('coach','admin')
      ))
  ), agreed as (
    -- Conflicting coaches do not silently reclassify a rider's trick.
    select source_key from visible group by source_key
    having count(distinct jsonb_build_array(category, subcategory)) = 1
  ), entries as (
    select distinct on (source_key) source_key, display_title as title, category, subcategory
    from visible join agreed using (source_key)
    order by source_key, updated_at desc, coach_id
    limit 2000
  )
  select coalesce(jsonb_agg(to_jsonb(entries) order by source_key), '[]'::jsonb) into v_result from entries;
  return v_result;
end;
$$;

create function private.save_tricktionary_catalog_entry(p_source_key text, p_title text, p_category text, p_subcategory text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_role text := private.tricktionary_automation_role();
  v_key text := lower(btrim(regexp_replace(coalesce(p_source_key, ''), '[[:space:]]+', ' ', 'g')));
  v_title text := btrim(regexp_replace(coalesce(p_title, ''), '[[:space:]]+', ' ', 'g'));
  v_category text := lower(btrim(coalesce(p_category, '')));
  v_subcategory text := case when p_subcategory is null then null else lower(btrim(p_subcategory)) end;
begin
  if v_role not in ('coach','admin') then
    raise exception 'Only coaches can approve shared Tricktionary entries.' using errcode = '42501';
  end if;
  if char_length(v_key) not between 1 and 120 or char_length(v_title) not between 1 and 120 then
    raise exception 'Trick names must be between 1 and 120 characters.' using errcode = '22023';
  end if;
  if private.tricktionary_subcategory_is_valid(v_category, v_subcategory) is not true then
    raise exception 'Choose a valid Tricktionary location.' using errcode = '22023';
  end if;
  -- Serialize the size check and writes to this coach's catalog, including retries.
  perform 1 from public.profiles where id = v_user for update;
  if not exists (select 1 from private.tricktionary_catalog where coach_id = v_user and source_key = v_key)
     and (select count(*) from private.tricktionary_catalog where coach_id = v_user) >= 2000 then
    raise exception 'The shared catalog is full. Remove an unused entry first.' using errcode = '22023';
  end if;
  insert into private.tricktionary_catalog(coach_id, source_key, display_title, category, subcategory)
  values(v_user, v_key, v_title, v_category, v_subcategory)
  on conflict (coach_id, source_key) do update
    set display_title = excluded.display_title, category = excluded.category,
      subcategory = excluded.subcategory, updated_at = now()
    where (tricktionary_catalog.display_title, tricktionary_catalog.category, tricktionary_catalog.subcategory)
      is distinct from (excluded.display_title, excluded.category, excluded.subcategory);
  return jsonb_build_object('source_key', v_key, 'title', v_title, 'category', v_category, 'subcategory', v_subcategory);
end;
$$;

create function private.delete_tricktionary_catalog_entry(p_source_key text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_role text := private.tricktionary_automation_role();
  v_key text := lower(btrim(regexp_replace(coalesce(p_source_key, ''), '[[:space:]]+', ' ', 'g')));
begin
  if v_role not in ('coach','admin') then
    raise exception 'Only coaches can remove shared Tricktionary entries.' using errcode = '42501';
  end if;
  if char_length(v_key) not between 1 and 120 then
    raise exception 'Choose a valid trick name.' using errcode = '22023';
  end if;
  delete from private.tricktionary_catalog where coach_id = v_user and source_key = v_key;
  return found;
end;
$$;

create function private.apply_tricktionary_locations(p_athlete_id uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_role text := private.tricktionary_automation_role();
  v_meta jsonb; v_aliases jsonb; v_categories jsonb; v_subcategories jsonb;
  v_item jsonb; v_key text; v_category text; v_subcategory text;
  v_expected_category text; v_expected_subcategory text;
  v_current_category text; v_current_subcategory text;
  v_seen text[] := array[]::text[];
  v_applied integer := 0; v_unchanged integer := 0;
  v_skipped jsonb := '[]'::jsonb; v_items jsonb := '[]'::jsonb;
begin
  if v_role not in ('athlete','coach','admin') or not private.can_manage_tricktionary(auth.uid(), p_athlete_id) then
    raise exception 'You can only organise your own tricks or tricks for a rider in your crew.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Provide a list of Tricktionary locations.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'Apply at most 200 Tricktionary locations at a time.' using errcode = '22023';
  end if;
  select coalesce(tricktionary_meta, '{}'::jsonb) into v_meta
  from public.profiles where id = p_athlete_id for update;
  if not found then raise exception 'Rider not found.' using errcode = '22023'; end if;
  v_aliases := case when jsonb_typeof(v_meta->'aliases') = 'object' then v_meta->'aliases' else '{}'::jsonb end;
  v_categories := case when jsonb_typeof(v_meta->'categories') = 'object' then v_meta->'categories' else '{}'::jsonb end;
  v_subcategories := case when jsonb_typeof(v_meta->'subcategories') = 'object' then v_meta->'subcategories' else '{}'::jsonb end;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or not (v_item ?& array['key','category','subcategory','expected_category','expected_subcategory'])
       or jsonb_typeof(v_item->'key') is distinct from 'string'
       or jsonb_typeof(v_item->'category') is distinct from 'string'
       or jsonb_typeof(v_item->'subcategory') not in ('string','null')
       or jsonb_typeof(v_item->'expected_category') not in ('string','null')
       or jsonb_typeof(v_item->'expected_subcategory') not in ('string','null') then
      raise exception 'Every location needs a key, location and original location.' using errcode = '22023';
    end if;
    v_key := lower(btrim(regexp_replace(v_item->>'key', '[[:space:]]+', ' ', 'g')));
    v_category := lower(btrim(v_item->>'category'));
    v_subcategory := case when v_item->>'subcategory' is null then null else lower(btrim(v_item->>'subcategory')) end;
    v_expected_category := v_item->>'expected_category';
    v_expected_subcategory := v_item->>'expected_subcategory';
    if char_length(v_key) not between 1 and 120
       or private.tricktionary_subcategory_is_valid(v_category, v_subcategory) is not true then
      raise exception 'Choose a valid trick name and location.' using errcode = '22023';
    end if;
    v_key := private.resolve_tricktionary_alias(v_key, v_aliases);
    if char_length(v_key) not between 1 and 120 then
      raise exception 'Stored Tricktionary alias is invalid.' using errcode = '22023';
    end if;
    if v_key = any(v_seen) then
      raise exception 'Each Tricktionary card may appear only once.' using errcode = '22023';
    end if;
    v_seen := array_append(v_seen, v_key);
    v_current_category := v_categories->>v_key;
    v_current_subcategory := v_subcategories->>v_key;
    if v_current_category is not distinct from v_category and v_current_subcategory is not distinct from v_subcategory then
      v_unchanged := v_unchanged + 1;
    elsif (v_current_category is not null and v_current_category <> 'new') or v_current_subcategory is not null then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('key',v_key,'reason','explicit_location'));
      continue;
    elsif v_current_category is distinct from v_expected_category or v_current_subcategory is distinct from v_expected_subcategory then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('key',v_key,'reason','location_changed'));
      continue;
    else
      v_categories := jsonb_set(v_categories, array[v_key], to_jsonb(v_category), true);
      if v_subcategory is null then v_subcategories := v_subcategories - v_key;
      else v_subcategories := jsonb_set(v_subcategories, array[v_key], to_jsonb(v_subcategory), true); end if;
      v_applied := v_applied + 1;
    end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object('key',v_key,'category',v_category,'subcategory',v_subcategory));
  end loop;
  if v_applied > 0 then
    v_meta := jsonb_set(v_meta, '{categories}', v_categories, true);
    v_meta := jsonb_set(v_meta, '{subcategories}', v_subcategories, true);
    v_meta := jsonb_set(v_meta, '{updatedAt}', to_jsonb(now()::text), true);
    update public.profiles set tricktionary_meta = v_meta, updated_at = now() where id = p_athlete_id;
  end if;
  return jsonb_build_object('applied',v_applied,'unchanged',v_unchanged,'skipped',v_skipped,'items',v_items);
end;
$$;

-- The caller's category is a suggestion: an existing canonical placement wins.
-- Retrying an already-saved manual entry cannot add landings or reset metadata.
create or replace function public.add_manual_tricktionary_entry(
  p_athlete_id uuid, p_entry_id uuid, p_title text, p_count integer, p_category text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); v_role text := private.tricktionary_automation_role();
  v_title text := btrim(regexp_replace(coalesce(p_title,''), '[[:space:]]+', ' ', 'g'));
  v_category text := lower(btrim(coalesce(p_category,'new')));
  v_key text; v_root text; v_manual jsonb; v_meta jsonb; v_aliases jsonb;
  v_categories jsonb; v_subcategories jsonb; v_entry jsonb;
begin
  if v_role not in ('athlete','coach','admin') or not private.can_manage_tricktionary(v_user,p_athlete_id) then
    raise exception 'You can only add tricks for yourself or a rider in your crew' using errcode = '42501';
  end if;
  if p_entry_id is null then raise exception 'Unable to identify the new trick'; end if;
  if char_length(v_title) not between 1 and 120 then raise exception 'Trick name must be between 1 and 120 characters'; end if;
  if p_count is null or p_count not between 1 and 999 then raise exception 'Landed count must be between 1 and 999'; end if;
  if v_category not in ('new','box','spine','air','hip') then raise exception 'Choose a valid Tricktionary category'; end if;
  select case when jsonb_typeof(manual_tricktionary)='array' then manual_tricktionary else '[]'::jsonb end,
    coalesce(tricktionary_meta,'{}'::jsonb) into v_manual,v_meta
  from public.profiles where id=p_athlete_id for update;
  if not found then raise exception 'Rider not found'; end if;
  select value into v_entry from jsonb_array_elements(v_manual) where value->>'id'=p_entry_id::text limit 1;
  if found then
    if lower(btrim(regexp_replace(coalesce(v_entry->>'title',v_entry->>'name',''), '[[:space:]]+', ' ', 'g'))) = lower(v_title)
       and v_entry->>'count' = p_count::text then return v_entry; end if;
    raise exception 'That manual entry was already saved with different details';
  end if;
  v_key := lower(v_title);
  if exists (
    select 1 from jsonb_array_elements(v_manual) entry
    where lower(btrim(regexp_replace(coalesce(entry->>'title',entry->>'name',''), '[[:space:]]+', ' ', 'g'))) = v_key
      and not (coalesce(entry->>'source','')='merged' and jsonb_typeof(entry->'mergedFrom')='array' and jsonb_array_length(entry->'mergedFrom')>=2)
  ) then raise exception 'That trick is already in this rider''s manual Tricktionary'; end if;
  v_aliases := case when jsonb_typeof(v_meta->'aliases')='object' then v_meta->'aliases' else '{}'::jsonb end;
  v_root := private.resolve_tricktionary_alias(v_key,v_aliases);
  if char_length(v_root) not between 1 and 120 then raise exception 'Stored Tricktionary alias is invalid'; end if;
  v_categories := case when jsonb_typeof(v_meta->'categories')='object' then v_meta->'categories' else '{}'::jsonb end;
  v_subcategories := case when jsonb_typeof(v_meta->'subcategories')='object' then v_meta->'subcategories' else '{}'::jsonb end;
  if v_categories->>v_root in ('new','box','spine','air','hip') then v_category := v_categories->>v_root; end if;
  v_entry := jsonb_build_object('id',p_entry_id::text,'title',v_title,'count',p_count,'addedAt',now()::text,
    'addedBy',v_user::text,'source',case when v_user=p_athlete_id then 'manual' else 'coach' end,'tricktionaryCategory',v_category);
  -- Even a legacy subcategory-only override is kept; never replace a stored choice.
  if not (v_categories ? v_root) and not (v_subcategories ? v_root) then
    v_categories := jsonb_set(v_categories,array[v_root],to_jsonb(v_category),true);
    v_meta := jsonb_set(v_meta,'{categories}',v_categories,true);
    v_meta := jsonb_set(v_meta,'{updatedAt}',to_jsonb(now()::text),true);
  end if;
  update public.profiles set manual_tricktionary=jsonb_build_array(v_entry)||v_manual,
    tricktionary_meta=v_meta, updated_at=now() where id=p_athlete_id;
  return v_entry;
end;
$$;

create function public.get_tricktionary_catalog(p_athlete_id uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.read_tricktionary_catalog(p_athlete_id);
$$;
create function public.save_tricktionary_catalog_entry(p_source_key text,p_title text,p_category text,p_subcategory text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.save_tricktionary_catalog_entry(p_source_key,p_title,p_category,p_subcategory);
$$;
create function public.delete_tricktionary_catalog_entry(p_source_key text)
returns boolean language sql security invoker set search_path = '' as $$
  select private.delete_tricktionary_catalog_entry(p_source_key);
$$;
create function public.apply_tricktionary_locations(p_athlete_id uuid,p_items jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.apply_tricktionary_locations(p_athlete_id,p_items);
$$;

revoke all on function private.read_tricktionary_catalog(uuid), private.save_tricktionary_catalog_entry(text,text,text,text),
  private.delete_tricktionary_catalog_entry(text), private.apply_tricktionary_locations(uuid,jsonb),
  public.get_tricktionary_catalog(uuid), public.save_tricktionary_catalog_entry(text,text,text,text),
  public.delete_tricktionary_catalog_entry(text), public.apply_tricktionary_locations(uuid,jsonb)
  from public, anon;
grant execute on function private.read_tricktionary_catalog(uuid), private.save_tricktionary_catalog_entry(text,text,text,text),
  private.delete_tricktionary_catalog_entry(text), private.apply_tricktionary_locations(uuid,jsonb),
  public.get_tricktionary_catalog(uuid), public.save_tricktionary_catalog_entry(text,text,text,text),
  public.delete_tricktionary_catalog_entry(text), public.apply_tricktionary_locations(uuid,jsonb)
  to authenticated;

notify pgrst, 'reload schema';
