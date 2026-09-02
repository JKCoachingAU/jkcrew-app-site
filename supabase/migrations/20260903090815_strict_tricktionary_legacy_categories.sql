-- Keep cached clients on the current strict category validation path. The
-- preceding compatibility migration originally normalized missing legacy
-- categories to New Tricks; this follow-up rejects missing categories instead.

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
  v_category text := lower(btrim(coalesce(p_category, '')));
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
  v_category text := lower(btrim(coalesce(p_category, '')));
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

revoke all on function public.set_tricktionary_category(uuid, text, text) from public, anon;
revoke all on function public.merge_tricktionary_entries(uuid, text[], text[], text, text) from public, anon;

grant execute on function public.set_tricktionary_category(uuid, text, text) to authenticated;
grant execute on function public.merge_tricktionary_entries(uuid, text[], text[], text, text) to authenticated;

comment on function public.set_tricktionary_category(uuid, text, text) is
  'Strict compatibility wrapper that delegates cached-client category moves to the current validated placement RPC.';
comment on function public.merge_tricktionary_entries(uuid, text[], text[], text, text) is
  'Strict compatibility wrapper that delegates cached-client merges to the current validated merge RPC.';
