-- A compact display-only projection: no score calculations, profile details,
-- account changes, or change to the existing leaderboard RPC contract.
create function private.leaderboard_uci_links()
returns table (athlete_id uuid, uci_id text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_viewer uuid := auth.uid();
  v_role text;
begin
  select profile.role::text into v_role
  from public.profiles profile where profile.id = v_viewer;
  if v_viewer is null or v_role is null
     or v_role not in ('athlete', 'parent', 'coach', 'admin')
     or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then
    raise exception 'Sign in to view rider world rankings.' using errcode = '42501';
  end if;
  -- Match the app's account gate, including calls outside PostgREST.
  if private.rider_features_disabled() then
    raise exception 'You don''t have access to this feature, contact your coach'
      using errcode = '42501';
  end if;

  return query
  select profile.id, profile.uci_id
  from public.profiles profile
  where profile.role::text = 'athlete'
    and profile.uci_id is not null
    -- Same ghost visibility as public.get_weekly_leaderboard().
    and (not coalesce(profile.ghost_mode, false)
      or profile.id = v_viewer
      or v_role in ('coach', 'admin'))
  order by profile.id;
end;
$$;
revoke all on function private.leaderboard_uci_links() from public, anon;
grant execute on function private.leaderboard_uci_links() to authenticated;

create function public.get_leaderboard_uci_links()
returns table (athlete_id uuid, uci_id text)
language sql stable security invoker set search_path = '' as $$
  select * from private.leaderboard_uci_links();
$$;
revoke all on function public.get_leaderboard_uci_links() from public, anon;
grant execute on function public.get_leaderboard_uci_links() to authenticated;

comment on function public.get_leaderboard_uci_links() is
  'Display-only UCI identities for riders visible on the signed-in viewer''s JKC leaderboard. Preserves ghost visibility and disabled-account restrictions; never changes scores.';

notify pgrst, 'reload schema';
