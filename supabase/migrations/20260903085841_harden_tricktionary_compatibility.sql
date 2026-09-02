-- Harden Tricktionary placement/visibility inputs and keep cached clients on the
-- same atomic metadata path. Historical assignments, landings, attempts, points,
-- and XP rows are intentionally never updated or deleted here.

create or replace function private.tricktionary_subcategory_is_valid(
  p_category text,
  p_subcategory text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    case
      when p_category = 'new' then p_subcategory is null
      when p_category in ('box', 'spine', 'hip') then
        p_subcategory is not null and p_subcategory in ('spins', 'flips', 'other')
      when p_category = 'air' then
        p_subcategory is not null and p_subcategory in ('spins', 'flips', 'alleyoop', 'other')
      else false
    end,
    false
  );
$$;

revoke all on function private.tricktionary_subcategory_is_valid(text, text)
  from public, anon, authenticated, service_role;

create or replace function private.default_tricktionary_subcategory(
  p_title text,
  p_category text
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_title text := lower(coalesce(p_title, ''));
  v_category text := lower(btrim(coalesce(p_category, '')));
begin
  if v_category = 'new' then
    return null;
  end if;

  if v_category = 'air' then
    if v_title ~ '(^|[^[:alnum:]_])(alley|ali)[[:space:]-]?oop([^[:alnum:]_]|$)' then
      return 'alleyoop';
    end if;
    if v_title ~ '(flair|flip)' then
      return 'flips';
    end if;
    if v_title ~ '(^|[^[:digit:]])(360|540|900)([^[:digit:]]|$)' then
      return 'spins';
    end if;
    return 'other';
  end if;

  if v_category in ('box', 'spine', 'hip') then
    -- Match the client rule: Truck and Truck Driver override "flip" wording,
    -- but only Box and Spine auto-classify them as Spins.
    if v_category in ('box', 'spine')
      and v_title ~ '(^|[^[:alnum:]_])truck([[:space:]-]*driver)?([^[:alnum:]_]|$)'
    then
      return 'spins';
    end if;
    if v_title ~ 'flip' then
      return 'flips';
    end if;
    if v_title ~ '(^|[^[:digit:]])(90|180|270|360|450|540|720|810|900)([^[:digit:]]|$)' then
      return 'spins';
    end if;
    return 'other';
  end if;

  return null;
end;
$$;

revoke all on function private.default_tricktionary_subcategory(text, text)
  from public, anon, authenticated, service_role;

create or replace function public.set_tricktionary_location(
  p_athlete_id uuid,
  p_trick_key text,
  p_category text,
  p_subcategory text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_key text := lower(regexp_replace(btrim(coalesce(p_trick_key, '')), '\s+', ' ', 'g'));
  v_category text := lower(btrim(coalesce(p_category, '')));
  v_subcategory text := case
    when p_subcategory is null then null
    else lower(btrim(p_subcategory))
  end;
  v_meta jsonb;
  v_aliases jsonb;
  v_categories jsonb;
  v_subcategories jsonb;
begin
  if not private.can_manage_tricktionary(v_user_id, p_athlete_id) then
    raise exception 'You can only organise your own tricks or tricks for a rider in your crew';
  end if;
  if char_length(v_key) < 1 or char_length(v_key) > 120 then
    raise exception 'Trick name must be between 1 and 120 characters';
  end if;
  if v_category not in ('new', 'box', 'spine', 'air', 'hip') then
    raise exception 'Choose a valid Tricktionary category';
  end if;
  if p_subcategory is not null and btrim(p_subcategory) = '' then
    raise exception 'Choose a valid Tricktionary subcategory';
  end if;
  if private.tricktionary_subcategory_is_valid(v_category, v_subcategory) is not true then
    raise exception 'Choose a valid Tricktionary subcategory';
  end if;

  select coalesce(profile.tricktionary_meta, '{}'::jsonb)
  into v_meta
  from public.profiles profile
  where profile.id = p_athlete_id
  for update;
  if not found then raise exception 'Rider not found'; end if;

  v_aliases := case when jsonb_typeof(v_meta -> 'aliases') = 'object' then v_meta -> 'aliases' else '{}'::jsonb end;
  v_key := private.resolve_tricktionary_alias(v_key, v_aliases);
  if char_length(v_key) < 1 or char_length(v_key) > 120 then
    raise exception 'Stored Tricktionary alias is invalid';
  end if;
  v_categories := case when jsonb_typeof(v_meta -> 'categories') = 'object' then v_meta -> 'categories' else '{}'::jsonb end;
  v_subcategories := case when jsonb_typeof(v_meta -> 'subcategories') = 'object' then v_meta -> 'subcategories' else '{}'::jsonb end;

  v_categories := jsonb_set(v_categories, array[v_key], to_jsonb(v_category), true);
  if v_subcategory is null then
    v_subcategories := v_subcategories - v_key;
  else
    v_subcategories := jsonb_set(v_subcategories, array[v_key], to_jsonb(v_subcategory), true);
  end if;
  v_meta := jsonb_set(v_meta, '{categories}', v_categories, true);
  v_meta := jsonb_set(v_meta, '{subcategories}', v_subcategories, true);
  v_meta := jsonb_set(v_meta, '{updatedAt}', to_jsonb(now()::text), true);

  update public.profiles profile
  set tricktionary_meta = v_meta,
      updated_at = now()
  where profile.id = p_athlete_id;

  return jsonb_build_object(
    'canonical_key', v_key,
    'category', v_category,
    'subcategory', v_subcategory
  );
end;
$$;

create or replace function public.set_tricktionary_hidden(
  p_athlete_id uuid,
  p_trick_key text,
  p_hidden boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_key text := lower(regexp_replace(btrim(coalesce(p_trick_key, '')), '\s+', ' ', 'g'));
  v_meta jsonb;
  v_aliases jsonb;
  v_hidden jsonb;
begin
  if not private.can_manage_tricktionary(v_user_id, p_athlete_id) then
    raise exception 'You can only remove your own tricks or tricks for a rider in your crew';
  end if;
  if char_length(v_key) < 1 or char_length(v_key) > 120 then
    raise exception 'Trick name must be between 1 and 120 characters';
  end if;
  if p_hidden is null then raise exception 'Choose whether the trick should be hidden'; end if;

  select coalesce(profile.tricktionary_meta, '{}'::jsonb)
  into v_meta
  from public.profiles profile
  where profile.id = p_athlete_id
  for update;
  if not found then raise exception 'Rider not found'; end if;

  v_aliases := case when jsonb_typeof(v_meta -> 'aliases') = 'object' then v_meta -> 'aliases' else '{}'::jsonb end;
  v_key := private.resolve_tricktionary_alias(v_key, v_aliases);
  if char_length(v_key) < 1 or char_length(v_key) > 120 then
    raise exception 'Stored Tricktionary alias is invalid';
  end if;
  v_hidden := case when jsonb_typeof(v_meta -> 'hidden') = 'object' then v_meta -> 'hidden' else '{}'::jsonb end;

  if p_hidden then
    v_hidden := jsonb_set(v_hidden, array[v_key], to_jsonb(now()::text), true);
  else
    v_hidden := v_hidden - v_key;
  end if;
  v_meta := jsonb_set(v_meta, '{hidden}', v_hidden, true);
  v_meta := jsonb_set(v_meta, '{updatedAt}', to_jsonb(now()::text), true);

  update public.profiles profile
  set tricktionary_meta = v_meta,
      updated_at = now()
  where profile.id = p_athlete_id;

  return jsonb_build_object('canonical_key', v_key, 'hidden', p_hidden);
end;
$$;

create or replace function public.merge_tricktionary_entries_v2(
  p_athlete_id uuid,
  p_source_keys text[],
  p_target_keys text[],
  p_display_title text,
  p_category text,
  p_subcategory text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_display_title text := regexp_replace(btrim(coalesce(p_display_title, '')), '\s+', ' ', 'g');
  v_display_key text;
  v_display_root text;
  v_display_is_selected boolean;
  v_category text := lower(btrim(coalesce(p_category, '')));
  v_subcategory text := case
    when p_subcategory is null then null
    else lower(btrim(p_subcategory))
  end;
  v_meta jsonb;
  v_manual jsonb;
  v_aliases jsonb;
  v_titles jsonb;
  v_categories jsonb;
  v_subcategories jsonb;
  v_hidden jsonb;
  v_source_keys text[] := array[]::text[];
  v_target_keys text[] := array[]::text[];
  v_all_keys text[] := array[]::text[];
  v_source_roots text[] := array[]::text[];
  v_target_roots text[] := array[]::text[];
  v_merge_roots text[] := array[]::text[];
  v_key text;
  v_normalized_key text;
  v_root text;
  v_pair record;
begin
  if not private.can_manage_tricktionary(v_user_id, p_athlete_id) then
    raise exception 'You can only merge your own tricks or tricks for a rider in your crew';
  end if;
  if char_length(v_display_title) < 1 or char_length(v_display_title) > 120 then
    raise exception 'Merged trick name must be between 1 and 120 characters';
  end if;
  if v_category not in ('new', 'box', 'spine', 'air', 'hip') then
    raise exception 'Choose a valid Tricktionary category';
  end if;
  if p_subcategory is not null and btrim(p_subcategory) = '' then
    raise exception 'Choose a valid Tricktionary subcategory';
  end if;
  if private.tricktionary_subcategory_is_valid(v_category, v_subcategory) is not true then
    raise exception 'Choose a valid Tricktionary subcategory';
  end if;
  if coalesce(cardinality(p_source_keys), 0) < 1 or coalesce(cardinality(p_target_keys), 0) < 1 then
    raise exception 'Choose two tricks to merge';
  end if;
  if coalesce(cardinality(p_source_keys), 0) + coalesce(cardinality(p_target_keys), 0) > 100 then
    raise exception 'Too many tricks were included in one merge';
  end if;

  foreach v_key in array coalesce(p_source_keys, array[]::text[]) loop
    v_normalized_key := lower(regexp_replace(btrim(coalesce(v_key, '')), '\s+', ' ', 'g'));
    if char_length(v_normalized_key) < 1 or char_length(v_normalized_key) > 120 then
      raise exception 'Every source trick name must be between 1 and 120 characters';
    end if;
    if not (v_normalized_key = any(v_source_keys)) then
      v_source_keys := array_append(v_source_keys, v_normalized_key);
    end if;
  end loop;

  foreach v_key in array coalesce(p_target_keys, array[]::text[]) loop
    v_normalized_key := lower(regexp_replace(btrim(coalesce(v_key, '')), '\s+', ' ', 'g'));
    if char_length(v_normalized_key) < 1 or char_length(v_normalized_key) > 120 then
      raise exception 'Every target trick name must be between 1 and 120 characters';
    end if;
    if not (v_normalized_key = any(v_target_keys)) then
      v_target_keys := array_append(v_target_keys, v_normalized_key);
    end if;
  end loop;

  if cardinality(v_source_keys) < 1 or cardinality(v_target_keys) < 1 then
    raise exception 'Choose two tricks to merge';
  end if;

  select
    coalesce(profile.tricktionary_meta, '{}'::jsonb),
    case
      when jsonb_typeof(profile.manual_tricktionary) = 'array' then profile.manual_tricktionary
      else '[]'::jsonb
    end
  into v_meta, v_manual
  from public.profiles profile
  where profile.id = p_athlete_id
  for update;
  if not found then raise exception 'Rider not found'; end if;

  v_display_key := lower(v_display_title);
  if char_length(v_display_key) < 1 or char_length(v_display_key) > 120 then
    raise exception 'Merged trick name must be between 1 and 120 characters';
  end if;
  v_aliases := case when jsonb_typeof(v_meta -> 'aliases') = 'object' then v_meta -> 'aliases' else '{}'::jsonb end;
  v_titles := case when jsonb_typeof(v_meta -> 'titles') = 'object' then v_meta -> 'titles' else '{}'::jsonb end;
  v_categories := case when jsonb_typeof(v_meta -> 'categories') = 'object' then v_meta -> 'categories' else '{}'::jsonb end;
  v_subcategories := case when jsonb_typeof(v_meta -> 'subcategories') = 'object' then v_meta -> 'subcategories' else '{}'::jsonb end;
  v_hidden := case when jsonb_typeof(v_meta -> 'hidden') = 'object' then v_meta -> 'hidden' else '{}'::jsonb end;
  v_all_keys := v_source_keys || v_target_keys;

  foreach v_key in array v_source_keys loop
    v_root := private.resolve_tricktionary_alias(v_key, v_aliases);
    if v_root = '' or char_length(v_root) > 120 then
      raise exception 'Stored Tricktionary alias is invalid';
    end if;
    if not (v_root = any(v_source_roots)) then
      v_source_roots := array_append(v_source_roots, v_root);
    end if;
    if not (v_root = any(v_merge_roots)) then
      v_merge_roots := array_append(v_merge_roots, v_root);
    end if;
  end loop;

  foreach v_key in array v_target_keys loop
    v_root := private.resolve_tricktionary_alias(v_key, v_aliases);
    if v_root = '' or char_length(v_root) > 120 then
      raise exception 'Stored Tricktionary alias is invalid';
    end if;
    if not (v_root = any(v_target_roots)) then
      v_target_roots := array_append(v_target_roots, v_root);
    end if;
    if not (v_root = any(v_merge_roots)) then
      v_merge_roots := array_append(v_merge_roots, v_root);
    end if;
  end loop;

  if v_source_roots && v_target_roots then
    raise exception 'Choose two different tricks to merge';
  end if;

  -- A custom display title is allowed, but it must not silently pull a third
  -- existing trick/alias group into a two-card merge.
  v_display_root := private.resolve_tricktionary_alias(v_display_key, v_aliases);
  v_display_is_selected := v_display_key = any(v_all_keys) or v_display_root = any(v_merge_roots);
  if not v_display_is_selected and (
    v_aliases ? v_display_key
    or v_titles ? v_display_key
    or v_titles ? v_display_root
    or v_categories ? v_display_key
    or v_categories ? v_display_root
    or v_subcategories ? v_display_key
    or v_subcategories ? v_display_root
    or v_hidden ? v_display_key
    or v_hidden ? v_display_root
    or exists (
      select 1
      from jsonb_each_text(v_aliases) as alias_pair(key, value)
      where private.resolve_tricktionary_alias(alias_pair.key, v_aliases) = v_display_root
    )
    or exists (
      select 1
      from jsonb_array_elements(v_manual) as manual_entry(value)
      where lower(regexp_replace(
        btrim(coalesce(manual_entry.value ->> 'title', manual_entry.value ->> 'name', '')),
        '\s+',
        ' ',
        'g'
      )) = v_display_key
    )
    or exists (
      select 1
      from public.weekly_trick_assignments assignment_row
      where assignment_row.athlete_id = p_athlete_id
        and lower(regexp_replace(btrim(coalesce(assignment_row.trick_name, '')), '\s+', ' ', 'g')) = v_display_key
    )
  ) then
    raise exception 'That Tricktionary name already belongs to another trick. Merge that card explicitly.';
  end if;

  -- Fold every selected alias group into the chosen name and remove stale
  -- placement/tombstone metadata from all folded members.
  for v_pair in select key, value from jsonb_each_text(v_aliases) loop
    v_root := private.resolve_tricktionary_alias(v_pair.key, v_aliases);
    if v_root = any(v_merge_roots) then
      if v_pair.key = v_display_key then
        v_aliases := v_aliases - v_pair.key;
      else
        v_aliases := jsonb_set(v_aliases, array[v_pair.key], to_jsonb(v_display_key), true);
      end if;
      v_titles := v_titles - v_pair.key;
      v_categories := v_categories - v_pair.key;
      v_subcategories := v_subcategories - v_pair.key;
      v_hidden := v_hidden - v_pair.key;
    end if;
  end loop;

  foreach v_key in array v_merge_roots loop
    if v_key <> v_display_key then
      v_aliases := jsonb_set(v_aliases, array[v_key], to_jsonb(v_display_key), true);
    end if;
    v_titles := v_titles - v_key;
    v_categories := v_categories - v_key;
    v_subcategories := v_subcategories - v_key;
    v_hidden := v_hidden - v_key;
  end loop;

  foreach v_key in array v_all_keys loop
    if v_key <> v_display_key then
      v_aliases := jsonb_set(v_aliases, array[v_key], to_jsonb(v_display_key), true);
    end if;
    v_titles := v_titles - v_key;
    v_categories := v_categories - v_key;
    v_subcategories := v_subcategories - v_key;
    v_hidden := v_hidden - v_key;
  end loop;

  v_aliases := v_aliases - v_display_key;
  v_titles := jsonb_set(v_titles, array[v_display_key], to_jsonb(v_display_title), true);
  v_categories := jsonb_set(v_categories, array[v_display_key], to_jsonb(v_category), true);
  if v_subcategory is null then
    v_subcategories := v_subcategories - v_display_key;
  else
    v_subcategories := jsonb_set(v_subcategories, array[v_display_key], to_jsonb(v_subcategory), true);
  end if;
  v_hidden := v_hidden - v_display_key;

  v_meta := jsonb_set(v_meta, '{aliases}', v_aliases, true);
  v_meta := jsonb_set(v_meta, '{titles}', v_titles, true);
  v_meta := jsonb_set(v_meta, '{categories}', v_categories, true);
  v_meta := jsonb_set(v_meta, '{subcategories}', v_subcategories, true);
  v_meta := jsonb_set(v_meta, '{hidden}', v_hidden, true);
  v_meta := jsonb_set(v_meta, '{updatedAt}', to_jsonb(now()::text), true);

  update public.profiles profile
  set tricktionary_meta = v_meta,
      updated_at = now()
  where profile.id = p_athlete_id;

  return jsonb_build_object(
    'canonical_key', v_display_key,
    'display_title', v_display_title,
    'category', v_category,
    'subcategory', v_subcategory,
    'member_count', greatest(cardinality(v_merge_roots), 2)
  );
end;
$$;

-- Cached clients only know category moves. Classify a safe default and delegate
-- to the same locked, authorized location RPC as the current client.
create or replace function public.set_tricktionary_category(
  p_athlete_id uuid,
  p_trick_key text,
  p_category text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_category text := lower(btrim(coalesce(p_category, 'new')));
  v_subcategory text;
begin
  if not private.can_manage_tricktionary(v_user_id, p_athlete_id) then
    raise exception 'You can only organise your own tricks or tricks for a rider in your crew';
  end if;

  v_subcategory := private.default_tricktionary_subcategory(p_trick_key, v_category);
  return public.set_tricktionary_location(
    p_athlete_id,
    p_trick_key,
    v_category,
    v_subcategory
  );
end;
$$;

-- Cached clients use the five-argument merge. Delegate so aliases, precise
-- placement, visibility, validation, and row locking cannot diverge.
create or replace function public.merge_tricktionary_entries(
  p_athlete_id uuid,
  p_source_keys text[],
  p_target_keys text[],
  p_display_title text,
  p_category text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_category text := lower(btrim(coalesce(p_category, 'new')));
  v_subcategory text;
begin
  if not private.can_manage_tricktionary(v_user_id, p_athlete_id) then
    raise exception 'You can only merge your own tricks or tricks for a rider in your crew';
  end if;

  v_subcategory := private.default_tricktionary_subcategory(p_display_title, v_category);
  return public.merge_tricktionary_entries_v2(
    p_athlete_id,
    p_source_keys,
    p_target_keys,
    p_display_title,
    v_category,
    v_subcategory
  );
end;
$$;

revoke all on function public.set_tricktionary_location(uuid, text, text, text) from public, anon;
revoke all on function public.set_tricktionary_hidden(uuid, text, boolean) from public, anon;
revoke all on function public.merge_tricktionary_entries_v2(uuid, text[], text[], text, text, text) from public, anon;
revoke all on function public.set_tricktionary_category(uuid, text, text) from public, anon;
revoke all on function public.merge_tricktionary_entries(uuid, text[], text[], text, text) from public, anon;

grant execute on function public.set_tricktionary_location(uuid, text, text, text) to authenticated;
grant execute on function public.set_tricktionary_hidden(uuid, text, boolean) to authenticated;
grant execute on function public.merge_tricktionary_entries_v2(uuid, text[], text[], text, text, text) to authenticated;
grant execute on function public.set_tricktionary_category(uuid, text, text) to authenticated;
grant execute on function public.merge_tricktionary_entries(uuid, text[], text[], text, text) to authenticated;

comment on function private.default_tricktionary_subcategory(text, text) is
  'Returns the server-side fallback subcategory used by cached Tricktionary clients, matching the current client classifier.';
comment on function public.set_tricktionary_location(uuid, text, text, text) is
  'Atomically saves a validated canonical Tricktionary category and subcategory without changing training history.';
comment on function public.set_tricktionary_hidden(uuid, text, boolean) is
  'Reversibly removes or restores one validated canonical Tricktionary card without changing training history, points, or XP.';
comment on function public.merge_tricktionary_entries_v2(uuid, text[], text[], text, text, text) is
  'Atomically merges two explicitly selected Tricktionary groups with validated placement and no third-group name collision.';
comment on function public.set_tricktionary_category(uuid, text, text) is
  'Compatibility wrapper that delegates cached-client category moves to set_tricktionary_location with a safe default subcategory.';
comment on function public.merge_tricktionary_entries(uuid, text[], text[], text, text) is
  'Compatibility wrapper that delegates cached-client merges to merge_tricktionary_entries_v2 with a safe default subcategory.';
