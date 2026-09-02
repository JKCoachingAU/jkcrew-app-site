-- Tricktionary merges are organisational aliases only. Historical assignments,
-- progress, attempts, points, and XP remain untouched while their visible totals
-- are combined under one canonical trick name.

create or replace function private.resolve_tricktionary_alias(
  p_key text,
  p_aliases jsonb
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_current text := lower(regexp_replace(btrim(coalesce(p_key, '')), '\s+', ' ', 'g'));
  v_next text;
  v_seen text[] := array[]::text[];
begin
  while v_current <> ''
    and coalesce(jsonb_typeof(p_aliases), '') = 'object'
    and p_aliases ? v_current
    and not (v_current = any(v_seen))
    and cardinality(v_seen) < 50
  loop
    v_seen := array_append(v_seen, v_current);
    v_next := lower(regexp_replace(btrim(coalesce(p_aliases ->> v_current, '')), '\s+', ' ', 'g'));
    exit when v_next = '' or v_next = v_current;
    v_current := v_next;
  end loop;
  return v_current;
end;
$$;

revoke all on function private.resolve_tricktionary_alias(text, jsonb) from public, anon, authenticated;

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
  v_display_title text := regexp_replace(btrim(coalesce(p_display_title, '')), '\s+', ' ', 'g');
  v_display_key text;
  v_category text := lower(btrim(coalesce(p_category, 'new')));
  v_meta jsonb;
  v_aliases jsonb;
  v_titles jsonb;
  v_categories jsonb;
  v_all_keys text[] := array[]::text[];
  v_merge_roots text[] := array[]::text[];
  v_key text;
  v_normalized_key text;
  v_root text;
  v_pair record;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  if p_athlete_id is null then raise exception 'Choose a rider'; end if;
  if char_length(v_display_title) < 1 or char_length(v_display_title) > 120 then
    raise exception 'Merged trick name must be between 1 and 120 characters';
  end if;
  if v_category not in ('new', 'box', 'spine', 'air', 'hip') then
    raise exception 'Choose a valid Tricktionary category';
  end if;
  if coalesce(cardinality(p_source_keys), 0) < 1 or coalesce(cardinality(p_target_keys), 0) < 1 then
    raise exception 'Choose two tricks to merge';
  end if;
  if coalesce(cardinality(p_source_keys), 0) + coalesce(cardinality(p_target_keys), 0) > 100 then
    raise exception 'Too many tricks were included in one merge';
  end if;

  if v_user_id <> p_athlete_id
    and not exists (
      select 1
      from public.profiles profile
      where profile.id = v_user_id
        and profile.role::text = 'admin'
    )
    and not exists (
      select 1
      from public.coach_athletes link
      where link.coach_id = v_user_id
        and link.athlete_id = p_athlete_id
    )
  then
    raise exception 'You can only merge your own tricks or tricks for a rider in your crew';
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

  -- Fold every existing member of either alias group into the chosen name.
  for v_pair in select key, value from jsonb_each_text(v_aliases) loop
    v_root := private.resolve_tricktionary_alias(v_pair.key, v_aliases);
    if v_root = any(v_merge_roots) then
      if v_pair.key = v_display_key then
        v_aliases := v_aliases - v_pair.key;
      else
        v_aliases := jsonb_set(v_aliases, array[v_pair.key], to_jsonb(v_display_key), true);
      end if;
    end if;
  end loop;

  foreach v_key in array v_merge_roots loop
    if v_key <> '' and v_key <> v_display_key then
      v_aliases := jsonb_set(v_aliases, array[v_key], to_jsonb(v_display_key), true);
      v_titles := v_titles - v_key;
      v_categories := v_categories - v_key;
    end if;
  end loop;

  foreach v_key in array v_all_keys loop
    v_normalized_key := lower(regexp_replace(btrim(coalesce(v_key, '')), '\s+', ' ', 'g'));
    if v_normalized_key <> '' and v_normalized_key <> v_display_key then
      v_aliases := jsonb_set(v_aliases, array[v_normalized_key], to_jsonb(v_display_key), true);
    end if;
  end loop;

  v_aliases := v_aliases - v_display_key;
  v_titles := jsonb_set(v_titles, array[v_display_key], to_jsonb(v_display_title), true);
  v_categories := jsonb_set(v_categories, array[v_display_key], to_jsonb(v_category), true);
  v_meta := jsonb_set(v_meta, '{aliases}', v_aliases, true);
  v_meta := jsonb_set(v_meta, '{titles}', v_titles, true);
  v_meta := jsonb_set(v_meta, '{categories}', v_categories, true);
  v_meta := jsonb_set(v_meta, '{updatedAt}', to_jsonb(now()::text), true);

  update public.profiles profile
  set tricktionary_meta = v_meta,
      updated_at = now()
  where profile.id = p_athlete_id;

  return jsonb_build_object(
    'canonical_key', v_display_key,
    'display_title', v_display_title,
    'category', v_category,
    'member_count', greatest(cardinality(v_merge_roots), 2)
  );
end;
$$;

revoke all on function public.merge_tricktionary_entries(uuid, text[], text[], text, text) from public, anon;
grant execute on function public.merge_tricktionary_entries(uuid, text[], text[], text, text) to authenticated;

comment on function public.merge_tricktionary_entries(uuid, text[], text[], text, text) is
  'Atomically aliases multiple Tricktionary names to one display name without modifying historical training, landing, points, or XP records.';
