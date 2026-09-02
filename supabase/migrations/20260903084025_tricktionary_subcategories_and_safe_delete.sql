-- Persist precise Tricktionary placement and reversible removals without
-- changing any historical assignment, landing, attempt, point, or XP row.

create or replace function private.tricktionary_subcategory_is_valid(
  p_category text,
  p_subcategory text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_category = 'new' then p_subcategory is null
    when p_category in ('box', 'spine', 'hip') then p_subcategory in ('spins', 'flips', 'other')
    when p_category = 'air' then p_subcategory in ('spins', 'flips', 'alleyoop', 'other')
    else false
  end;
$$;

revoke all on function private.tricktionary_subcategory_is_valid(text, text) from public, anon, authenticated;

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
  v_category text := lower(btrim(coalesce(p_category, 'new')));
  v_subcategory text := nullif(lower(btrim(coalesce(p_subcategory, ''))), '');
  v_meta jsonb;
  v_aliases jsonb;
  v_categories jsonb;
  v_subcategories jsonb;
begin
  if not private.can_manage_tricktionary(v_user_id, p_athlete_id) then
    raise exception 'You can only organise your own tricks or tricks for a rider in your crew';
  end if;
  if v_key = '' then raise exception 'Choose a trick to organise'; end if;
  if v_category not in ('new', 'box', 'spine', 'air', 'hip') then
    raise exception 'Choose a valid Tricktionary category';
  end if;
  if not private.tricktionary_subcategory_is_valid(v_category, v_subcategory) then
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
  if v_key = '' then raise exception 'Choose a trick to remove'; end if;
  if p_hidden is null then raise exception 'Choose whether the trick should be hidden'; end if;

  select coalesce(profile.tricktionary_meta, '{}'::jsonb)
  into v_meta
  from public.profiles profile
  where profile.id = p_athlete_id
  for update;
  if not found then raise exception 'Rider not found'; end if;

  v_aliases := case when jsonb_typeof(v_meta -> 'aliases') = 'object' then v_meta -> 'aliases' else '{}'::jsonb end;
  v_key := private.resolve_tricktionary_alias(v_key, v_aliases);
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
  v_category text := lower(btrim(coalesce(p_category, 'new')));
  v_subcategory text := nullif(lower(btrim(coalesce(p_subcategory, ''))), '');
  v_meta jsonb;
  v_aliases jsonb;
  v_titles jsonb;
  v_categories jsonb;
  v_subcategories jsonb;
  v_hidden jsonb;
  v_all_keys text[] := array[]::text[];
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
  if not private.tricktionary_subcategory_is_valid(v_category, v_subcategory) then
    raise exception 'Choose a valid Tricktionary subcategory';
  end if;
  if coalesce(cardinality(p_source_keys), 0) < 1 or coalesce(cardinality(p_target_keys), 0) < 1 then
    raise exception 'Choose two tricks to merge';
  end if;
  if coalesce(cardinality(p_source_keys), 0) + coalesce(cardinality(p_target_keys), 0) > 100 then
    raise exception 'Too many tricks were included in one merge';
  end if;

  select coalesce(profile.tricktionary_meta, '{}'::jsonb)
  into v_meta
  from public.profiles profile
  where profile.id = p_athlete_id
  for update;
  if not found then raise exception 'Rider not found'; end if;

  v_display_key := lower(v_display_title);
  v_aliases := case when jsonb_typeof(v_meta -> 'aliases') = 'object' then v_meta -> 'aliases' else '{}'::jsonb end;
  v_titles := case when jsonb_typeof(v_meta -> 'titles') = 'object' then v_meta -> 'titles' else '{}'::jsonb end;
  v_categories := case when jsonb_typeof(v_meta -> 'categories') = 'object' then v_meta -> 'categories' else '{}'::jsonb end;
  v_subcategories := case when jsonb_typeof(v_meta -> 'subcategories') = 'object' then v_meta -> 'subcategories' else '{}'::jsonb end;
  v_hidden := case when jsonb_typeof(v_meta -> 'hidden') = 'object' then v_meta -> 'hidden' else '{}'::jsonb end;
  v_all_keys := coalesce(p_source_keys, array[]::text[]) || coalesce(p_target_keys, array[]::text[]) || array[v_display_key];

  foreach v_key in array v_all_keys loop
    v_normalized_key := lower(regexp_replace(btrim(coalesce(v_key, '')), '\s+', ' ', 'g'));
    continue when v_normalized_key = '';
    v_root := private.resolve_tricktionary_alias(v_normalized_key, v_aliases);
    if v_root <> '' and not (v_root = any(v_merge_roots)) then
      v_merge_roots := array_append(v_merge_roots, v_root);
    end if;
    if not (v_normalized_key = any(v_merge_roots)) then
      v_merge_roots := array_append(v_merge_roots, v_normalized_key);
    end if;
  end loop;

  -- Fold every existing member of either alias group into the selected name,
  -- and remove stale placement/tombstone metadata from the folded members.
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
    if v_key <> '' and v_key <> v_display_key then
      v_aliases := jsonb_set(v_aliases, array[v_key], to_jsonb(v_display_key), true);
    end if;
    v_titles := v_titles - v_key;
    v_categories := v_categories - v_key;
    v_subcategories := v_subcategories - v_key;
    v_hidden := v_hidden - v_key;
  end loop;

  foreach v_key in array v_all_keys loop
    v_normalized_key := lower(regexp_replace(btrim(coalesce(v_key, '')), '\s+', ' ', 'g'));
    if v_normalized_key <> '' and v_normalized_key <> v_display_key then
      v_aliases := jsonb_set(v_aliases, array[v_normalized_key], to_jsonb(v_display_key), true);
    end if;
    v_titles := v_titles - v_normalized_key;
    v_categories := v_categories - v_normalized_key;
    v_subcategories := v_subcategories - v_normalized_key;
    v_hidden := v_hidden - v_normalized_key;
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

revoke all on function public.set_tricktionary_location(uuid, text, text, text) from public, anon;
revoke all on function public.set_tricktionary_hidden(uuid, text, boolean) from public, anon;
revoke all on function public.merge_tricktionary_entries_v2(uuid, text[], text[], text, text, text) from public, anon;

grant execute on function public.set_tricktionary_location(uuid, text, text, text) to authenticated;
grant execute on function public.set_tricktionary_hidden(uuid, text, boolean) to authenticated;
grant execute on function public.merge_tricktionary_entries_v2(uuid, text[], text[], text, text, text) to authenticated;

comment on function public.set_tricktionary_location(uuid, text, text, text) is
  'Atomically saves one canonical Tricktionary category and subcategory without changing training history.';
comment on function public.set_tricktionary_hidden(uuid, text, boolean) is
  'Reversibly removes or restores one canonical Tricktionary card without deleting landings, points, XP, or training history.';
comment on function public.merge_tricktionary_entries_v2(uuid, text[], text[], text, text, text) is
  'Atomically merges visible Tricktionary aliases and placement without changing historical landed totals, points, or XP.';
