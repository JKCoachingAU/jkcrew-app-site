-- Add a Box Transfers lane and allow riders/coaches to rename a canonical
-- Tricktionary card without rewriting any training, landing, points, or XP row.

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
      when p_category = 'box' then
        p_subcategory is not null and p_subcategory in ('spins', 'flips', 'transfers', 'other')
      when p_category in ('spine', 'hip') then
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
    if v_category = 'box'
      and v_title ~ '(^|[^[:alnum:]_])(alley|ali)[[:space:]-]?oop([^[:alnum:]_]|$)'
    then
      return 'transfers';
    end if;
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

create or replace function public.rename_tricktionary_entry(
  p_athlete_id uuid,
  p_trick_key text,
  p_member_keys text[],
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
  v_input_key text := lower(btrim(regexp_replace(coalesce(p_trick_key, ''), '[[:space:]]+', ' ', 'g')));
  v_display_title text := btrim(regexp_replace(coalesce(p_display_title, ''), '[[:space:]]+', ' ', 'g'));
  v_display_key text;
  v_category_input text := lower(btrim(coalesce(p_category, '')));
  v_subcategory_input text := case
    when p_subcategory is null then null
    else lower(btrim(p_subcategory))
  end;
  v_meta jsonb;
  v_manual jsonb;
  v_aliases jsonb;
  v_alias_snapshot jsonb;
  v_titles jsonb;
  v_categories jsonb;
  v_subcategories jsonb;
  v_hidden jsonb;
  v_root text;
  v_display_root text;
  v_member text;
  v_member_normalized text;
  v_existing_category text;
  v_existing_subcategory text;
  v_pair record;
  v_manual_entry record;
  v_legacy_title text;
  v_legacy_member text;
  v_name_occupied boolean := false;
begin
  if not private.can_manage_tricktionary(v_user_id, p_athlete_id) then
    raise exception 'You can only rename your own tricks or tricks for a rider in your crew';
  end if;
  if char_length(v_input_key) < 1 or char_length(v_input_key) > 120 then
    raise exception 'Choose a valid trick to rename';
  end if;
  if char_length(v_display_title) < 1 or char_length(v_display_title) > 120 then
    raise exception 'Trick name must be between 1 and 120 characters';
  end if;
  if coalesce(cardinality(p_member_keys), 0) < 1 or cardinality(p_member_keys) > 100 then
    raise exception 'Choose a valid Tricktionary card to rename';
  end if;
  if v_category_input not in ('new', 'box', 'spine', 'air', 'hip') then
    raise exception 'Choose a valid Tricktionary category';
  end if;
  if p_subcategory is not null and btrim(p_subcategory) = '' then
    raise exception 'Choose a valid Tricktionary subcategory';
  end if;
  if private.tricktionary_subcategory_is_valid(v_category_input, v_subcategory_input) is not true then
    raise exception 'Choose a valid Tricktionary subcategory';
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

  v_aliases := case when jsonb_typeof(v_meta -> 'aliases') = 'object' then v_meta -> 'aliases' else '{}'::jsonb end;
  v_titles := case when jsonb_typeof(v_meta -> 'titles') = 'object' then v_meta -> 'titles' else '{}'::jsonb end;
  v_categories := case when jsonb_typeof(v_meta -> 'categories') = 'object' then v_meta -> 'categories' else '{}'::jsonb end;
  v_subcategories := case when jsonb_typeof(v_meta -> 'subcategories') = 'object' then v_meta -> 'subcategories' else '{}'::jsonb end;
  v_hidden := case when jsonb_typeof(v_meta -> 'hidden') = 'object' then v_meta -> 'hidden' else '{}'::jsonb end;

  -- Older releases also left merge aliases in manual_tricktionary. Add those
  -- aliases to this locked metadata copy before validating the card members.
  for v_manual_entry in
    select entry.value
    from jsonb_array_elements(v_manual) as entry(value)
  loop
    if coalesce(v_manual_entry.value ->> 'source', '') = 'merged'
      and jsonb_typeof(v_manual_entry.value -> 'mergedFrom') = 'array'
      and jsonb_array_length(v_manual_entry.value -> 'mergedFrom') >= 2
    then
      v_legacy_title := lower(btrim(regexp_replace(
        coalesce(v_manual_entry.value ->> 'title', v_manual_entry.value ->> 'name', ''),
        '[[:space:]]+',
        ' ',
        'g'
      )));
      if char_length(v_legacy_title) between 1 and 120 then
        for v_pair in
          select member.value
          from jsonb_array_elements_text(v_manual_entry.value -> 'mergedFrom') as member(value)
        loop
          v_legacy_member := lower(btrim(regexp_replace(coalesce(v_pair.value, ''), '[[:space:]]+', ' ', 'g')));
          if char_length(v_legacy_member) between 1 and 120
            and v_legacy_member <> v_legacy_title
            and not (v_aliases ? v_legacy_member)
          then
            v_aliases := jsonb_set(v_aliases, array[v_legacy_member], to_jsonb(v_legacy_title), true);
          end if;
        end loop;
      end if;
    end if;
  end loop;

  v_root := private.resolve_tricktionary_alias(v_input_key, v_aliases);
  if char_length(v_root) < 1 or char_length(v_root) > 120 then
    raise exception 'Stored Tricktionary alias is invalid';
  end if;

  foreach v_member in array p_member_keys loop
    v_member_normalized := lower(btrim(regexp_replace(coalesce(v_member, ''), '[[:space:]]+', ' ', 'g')));
    if char_length(v_member_normalized) < 1 or char_length(v_member_normalized) > 120 then
      raise exception 'Every Tricktionary member name must be between 1 and 120 characters';
    end if;
    if private.resolve_tricktionary_alias(v_member_normalized, v_aliases) <> v_root then
      raise exception 'This Tricktionary card changed while you were editing it. Refresh and try again.';
    end if;
  end loop;

  v_display_key := lower(v_display_title);
  v_display_root := private.resolve_tricktionary_alias(v_display_key, v_aliases);
  v_name_occupied :=
    v_aliases ? v_display_key
    or exists (select 1 from jsonb_each_text(v_aliases) alias_pair where lower(alias_pair.value) = v_display_key)
    or v_titles ? v_display_key
    or v_categories ? v_display_key
    or v_subcategories ? v_display_key
    or v_hidden ? v_display_key
    or exists (
      select 1 from jsonb_each_text(v_titles) title_pair
      where lower(btrim(regexp_replace(title_pair.value, '[[:space:]]+', ' ', 'g'))) = v_display_key
    )
    or exists (
      select 1
      from public.weekly_trick_assignments assignment_row
      where assignment_row.athlete_id = p_athlete_id
        and lower(btrim(regexp_replace(coalesce(assignment_row.trick_name, ''), '[[:space:]]+', ' ', 'g'))) = v_display_key
    )
    or exists (
      select 1
      from jsonb_array_elements(v_manual) manual_entry(value)
      where lower(btrim(regexp_replace(
        coalesce(manual_entry.value ->> 'title', manual_entry.value ->> 'name', ''),
        '[[:space:]]+',
        ' ',
        'g'
      ))) = v_display_key
    )
    or exists (
      select 1
      from jsonb_array_elements(v_manual) manual_entry(value)
      cross join lateral jsonb_array_elements_text(
        case when jsonb_typeof(manual_entry.value -> 'mergedFrom') = 'array'
          then manual_entry.value -> 'mergedFrom' else '[]'::jsonb end
      ) merged_member(value)
      where lower(btrim(regexp_replace(coalesce(merged_member.value, ''), '[[:space:]]+', ' ', 'g'))) = v_display_key
    );

  if v_name_occupied and v_display_root <> v_root then
    raise exception 'That name already belongs to another trick. Merge the two cards instead.';
  end if;

  v_existing_category := lower(coalesce(v_categories ->> v_root, ''));
  if v_existing_category not in ('new', 'box', 'spine', 'air', 'hip') then
    v_existing_category := v_category_input;
  end if;
  v_existing_subcategory := case
    when v_existing_category = 'new' then null
    else lower(coalesce(v_subcategories ->> v_root, ''))
  end;
  if private.tricktionary_subcategory_is_valid(v_existing_category, v_existing_subcategory) is not true then
    v_existing_subcategory := case
      when v_existing_category = v_category_input then v_subcategory_input
      else private.default_tricktionary_subcategory(v_display_title, v_existing_category)
    end;
  end if;

  -- Flatten only this card's existing aliases to its stable canonical key.
  -- Keeping the root stable is what preserves every historical reference.
  v_alias_snapshot := v_aliases;
  for v_pair in select key, value from jsonb_each_text(v_alias_snapshot) loop
    if private.resolve_tricktionary_alias(v_pair.key, v_alias_snapshot) = v_root then
      if v_pair.key = v_root then
        v_aliases := v_aliases - v_pair.key;
      else
        v_aliases := jsonb_set(v_aliases, array[v_pair.key], to_jsonb(v_root), true);
        v_titles := v_titles - v_pair.key;
        v_categories := v_categories - v_pair.key;
        v_subcategories := v_subcategories - v_pair.key;
        v_hidden := v_hidden - v_pair.key;
      end if;
    end if;
  end loop;

  foreach v_member in array p_member_keys loop
    v_member_normalized := lower(btrim(regexp_replace(coalesce(v_member, ''), '[[:space:]]+', ' ', 'g')));
    if v_member_normalized <> v_root then
      v_aliases := jsonb_set(v_aliases, array[v_member_normalized], to_jsonb(v_root), true);
      v_titles := v_titles - v_member_normalized;
      v_categories := v_categories - v_member_normalized;
      v_subcategories := v_subcategories - v_member_normalized;
      v_hidden := v_hidden - v_member_normalized;
    end if;
  end loop;

  if v_display_key = v_root then
    v_aliases := v_aliases - v_display_key;
  else
    v_aliases := jsonb_set(v_aliases, array[v_display_key], to_jsonb(v_root), true);
  end if;
  v_titles := jsonb_set(v_titles, array[v_root], to_jsonb(v_display_title), true);
  v_categories := jsonb_set(v_categories, array[v_root], to_jsonb(v_existing_category), true);
  if v_existing_subcategory is null then
    v_subcategories := v_subcategories - v_root;
  else
    v_subcategories := jsonb_set(v_subcategories, array[v_root], to_jsonb(v_existing_subcategory), true);
  end if;

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
    'canonical_key', v_root,
    'display_title', v_display_title,
    'category', v_existing_category,
    'subcategory', v_existing_subcategory
  );
end;
$$;

revoke all on function public.rename_tricktionary_entry(uuid, text, text[], text, text, text)
  from public, anon, authenticated;
grant execute on function public.rename_tricktionary_entry(uuid, text, text[], text, text, text)
  to authenticated;

comment on function public.rename_tricktionary_entry(uuid, text, text[], text, text, text) is
  'Renames one authorized canonical Tricktionary card while preserving aliases, placement, visibility, historical landings, points, and XP.';

-- Reclassify any Box Alleyoop cards explicitly saved by older releases. Cards
-- without saved metadata use the new classifier automatically on next render.
do $$
declare
  v_profile record;
  v_pair record;
  v_meta jsonb;
  v_aliases jsonb;
  v_titles jsonb;
  v_categories jsonb;
  v_subcategories jsonb;
  v_root text;
  v_title text;
  v_changed boolean;
begin
  for v_profile in
    select profile.id, coalesce(profile.tricktionary_meta, '{}'::jsonb) as tricktionary_meta
    from public.profiles profile
    where jsonb_typeof(profile.tricktionary_meta) = 'object'
  loop
    v_meta := v_profile.tricktionary_meta;
    v_aliases := case when jsonb_typeof(v_meta -> 'aliases') = 'object' then v_meta -> 'aliases' else '{}'::jsonb end;
    v_titles := case when jsonb_typeof(v_meta -> 'titles') = 'object' then v_meta -> 'titles' else '{}'::jsonb end;
    v_categories := case when jsonb_typeof(v_meta -> 'categories') = 'object' then v_meta -> 'categories' else '{}'::jsonb end;
    v_subcategories := case when jsonb_typeof(v_meta -> 'subcategories') = 'object' then v_meta -> 'subcategories' else '{}'::jsonb end;
    v_changed := false;

    for v_pair in select key, value from jsonb_each_text(v_categories) loop
      if lower(v_pair.value) = 'box' then
        v_root := private.resolve_tricktionary_alias(v_pair.key, v_aliases);
        v_title := coalesce(v_titles ->> v_root, v_titles ->> v_pair.key, v_pair.key);
        if lower(v_pair.key || ' ' || v_title) ~ '(^|[^[:alnum:]_])(alley|ali)[[:space:]-]?oop([^[:alnum:]_]|$)' then
          v_subcategories := jsonb_set(v_subcategories, array[v_root], to_jsonb('transfers'::text), true);
          v_changed := true;
        end if;
      end if;
    end loop;

    if v_changed then
      v_meta := jsonb_set(v_meta, '{subcategories}', v_subcategories, true);
      v_meta := jsonb_set(v_meta, '{updatedAt}', to_jsonb(now()::text), true);
      update public.profiles profile
      set tricktionary_meta = v_meta,
          updated_at = now()
      where profile.id = v_profile.id;
    end if;
  end loop;
end;
$$;
