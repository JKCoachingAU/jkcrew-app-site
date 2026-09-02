-- Keep every Tricktionary metadata/manual edit atomic with merges. These helpers
-- lock the rider profile before changing one JSON field, so simultaneous rider
-- and coach edits cannot overwrite aliases or landed history presentation.

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
  v_path text[] := array[]::text[];
  v_cycle_start integer;
begin
  loop
    exit when v_current = ''
      or coalesce(jsonb_typeof(p_aliases), '') <> 'object'
      or not (p_aliases ? v_current)
      or cardinality(v_path) >= 50;

    v_cycle_start := array_position(v_path, v_current);
    if v_cycle_start is not null then
      select min(cycle_key)
      into v_current
      from unnest(v_path) with ordinality as cycle(cycle_key, position)
      where position >= v_cycle_start;
      exit;
    end if;

    v_path := array_append(v_path, v_current);
    v_next := lower(regexp_replace(btrim(coalesce(p_aliases ->> v_current, '')), '\s+', ' ', 'g'));
    exit when v_next = '' or v_next = v_current;
    v_current := v_next;
  end loop;
  return v_current;
end;
$$;

revoke all on function private.resolve_tricktionary_alias(text, jsonb) from public, anon, authenticated;

create or replace function private.can_manage_tricktionary(
  p_user_id uuid,
  p_athlete_id uuid
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_user_id is not null
    and p_athlete_id is not null
    and (
      p_user_id = p_athlete_id
      or exists (
        select 1
        from public.profiles profile
        where profile.id = p_user_id
          and profile.role::text = 'admin'
      )
      or exists (
        select 1
        from public.coach_athletes link
        where link.coach_id = p_user_id
          and link.athlete_id = p_athlete_id
      )
    );
$$;

revoke all on function private.can_manage_tricktionary(uuid, uuid) from public, anon, authenticated;

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
  v_key text := lower(regexp_replace(btrim(coalesce(p_trick_key, '')), '\s+', ' ', 'g'));
  v_category text := lower(btrim(coalesce(p_category, 'new')));
  v_meta jsonb;
  v_aliases jsonb;
  v_categories jsonb;
begin
  if not private.can_manage_tricktionary(v_user_id, p_athlete_id) then
    raise exception 'You can only organise your own tricks or tricks for a rider in your crew';
  end if;
  if v_key = '' then raise exception 'Choose a trick to organise'; end if;
  if v_category not in ('new', 'box', 'spine', 'air', 'hip') then
    raise exception 'Choose a valid Tricktionary category';
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
  v_categories := jsonb_set(v_categories, array[v_key], to_jsonb(v_category), true);
  v_meta := jsonb_set(v_meta, '{categories}', v_categories, true);
  v_meta := jsonb_set(v_meta, '{updatedAt}', to_jsonb(now()::text), true);

  update public.profiles profile
  set tricktionary_meta = v_meta,
      updated_at = now()
  where profile.id = p_athlete_id;

  return jsonb_build_object('canonical_key', v_key, 'category', v_category);
end;
$$;

create or replace function public.add_manual_tricktionary_entry(
  p_athlete_id uuid,
  p_entry_id uuid,
  p_title text,
  p_count integer,
  p_category text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_title text := regexp_replace(btrim(coalesce(p_title, '')), '\s+', ' ', 'g');
  v_key text;
  v_category text := lower(btrim(coalesce(p_category, 'new')));
  v_manual jsonb;
  v_meta jsonb;
  v_aliases jsonb;
  v_categories jsonb;
  v_source text;
  v_entry jsonb;
begin
  if not private.can_manage_tricktionary(v_user_id, p_athlete_id) then
    raise exception 'You can only add tricks for yourself or a rider in your crew';
  end if;
  if p_entry_id is null then raise exception 'Unable to identify the new trick'; end if;
  if char_length(v_title) < 1 or char_length(v_title) > 120 then
    raise exception 'Trick name must be between 1 and 120 characters';
  end if;
  if p_count is null or p_count < 1 or p_count > 999 then
    raise exception 'Landed count must be between 1 and 999';
  end if;
  if v_category not in ('new', 'box', 'spine', 'air', 'hip') then
    raise exception 'Choose a valid Tricktionary category';
  end if;

  select
    case when jsonb_typeof(profile.manual_tricktionary) = 'array' then profile.manual_tricktionary else '[]'::jsonb end,
    coalesce(profile.tricktionary_meta, '{}'::jsonb)
  into v_manual, v_meta
  from public.profiles profile
  where profile.id = p_athlete_id
  for update;
  if not found then raise exception 'Rider not found'; end if;

  v_key := lower(v_title);
  if exists (
    select 1
    from jsonb_array_elements(v_manual) entry
    where lower(regexp_replace(btrim(coalesce(entry ->> 'title', entry ->> 'name', '')), '\s+', ' ', 'g')) = v_key
      and not (
        coalesce(entry ->> 'source', '') = 'merged'
        and jsonb_typeof(entry -> 'mergedFrom') = 'array'
        and jsonb_array_length(entry -> 'mergedFrom') >= 2
      )
  ) then
    raise exception 'That trick is already in this rider''s manual Tricktionary';
  end if;

  v_source := case when v_user_id = p_athlete_id then 'manual' else 'coach' end;
  v_entry := jsonb_build_object(
    'id', p_entry_id::text,
    'title', v_title,
    'count', p_count,
    'addedAt', now()::text,
    'addedBy', v_user_id::text,
    'source', v_source,
    'tricktionaryCategory', v_category
  );
  v_manual := jsonb_build_array(v_entry) || v_manual;

  v_aliases := case when jsonb_typeof(v_meta -> 'aliases') = 'object' then v_meta -> 'aliases' else '{}'::jsonb end;
  v_key := private.resolve_tricktionary_alias(v_key, v_aliases);
  v_categories := case when jsonb_typeof(v_meta -> 'categories') = 'object' then v_meta -> 'categories' else '{}'::jsonb end;
  v_categories := jsonb_set(v_categories, array[v_key], to_jsonb(v_category), true);
  v_meta := jsonb_set(v_meta, '{categories}', v_categories, true);
  v_meta := jsonb_set(v_meta, '{updatedAt}', to_jsonb(now()::text), true);

  update public.profiles profile
  set manual_tricktionary = v_manual,
      tricktionary_meta = v_meta,
      updated_at = now()
  where profile.id = p_athlete_id;

  return v_entry;
end;
$$;

create or replace function public.remove_manual_tricktionary_entry(
  p_athlete_id uuid,
  p_entry_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_entry_id text := btrim(coalesce(p_entry_id, ''));
  v_manual jsonb;
  v_next_manual jsonb;
begin
  if not private.can_manage_tricktionary(v_user_id, p_athlete_id) then
    raise exception 'You can only remove tricks for yourself or a rider in your crew';
  end if;
  if v_entry_id = '' then raise exception 'Choose a manual trick to remove'; end if;

  select case when jsonb_typeof(profile.manual_tricktionary) = 'array' then profile.manual_tricktionary else '[]'::jsonb end
  into v_manual
  from public.profiles profile
  where profile.id = p_athlete_id
  for update;
  if not found then raise exception 'Rider not found'; end if;

  select coalesce(jsonb_agg(entry.value order by entry.position), '[]'::jsonb)
  into v_next_manual
  from jsonb_array_elements(v_manual) with ordinality as entry(value, position)
  where coalesce(entry.value ->> 'id', btrim(coalesce(entry.value ->> 'title', entry.value ->> 'name', ''))) <> v_entry_id;

  update public.profiles profile
  set manual_tricktionary = v_next_manual,
      updated_at = now()
  where profile.id = p_athlete_id;

  return jsonb_array_length(v_next_manual) < jsonb_array_length(v_manual);
end;
$$;

revoke all on function public.set_tricktionary_category(uuid, text, text) from public, anon;
revoke all on function public.add_manual_tricktionary_entry(uuid, uuid, text, integer, text) from public, anon;
revoke all on function public.remove_manual_tricktionary_entry(uuid, text) from public, anon;

grant execute on function public.set_tricktionary_category(uuid, text, text) to authenticated;
grant execute on function public.add_manual_tricktionary_entry(uuid, uuid, text, integer, text) to authenticated;
grant execute on function public.remove_manual_tricktionary_entry(uuid, text) to authenticated;

comment on function public.set_tricktionary_category(uuid, text, text) is
  'Atomically changes one canonical Tricktionary category without replacing aliases.';
comment on function public.add_manual_tricktionary_entry(uuid, uuid, text, integer, text) is
  'Atomically adds one manual landed trick and preserves concurrent Tricktionary metadata changes.';
comment on function public.remove_manual_tricktionary_entry(uuid, text) is
  'Atomically removes one manual Tricktionary entry without altering historical training records.';
