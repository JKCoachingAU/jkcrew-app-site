-- Keep binary video payloads out of the profile row. Showreel media is stored in
-- Storage and referenced by public.profile_showreels.
update public.profiles profile
set showreel_videos = '[]'::jsonb
where pg_column_size(coalesce(profile.showreel_videos, '[]'::jsonb)) > 65536
  and exists (
    select 1
    from public.profile_showreels showreel
    where showreel.rider_id = profile.id
  );

alter table public.profiles
  drop constraint if exists profiles_showreel_metadata_size_check;

alter table public.profiles
  add constraint profiles_showreel_metadata_size_check
  check (pg_column_size(coalesce(showreel_videos, '[]'::jsonb)) <= 65536);

-- Evaluate auth and role helpers once per statement rather than once per row.
drop policy if exists "Coaches can view parent and athlete profiles" on public.profiles;
create policy "Coaches can view parent and athlete profiles"
on public.profiles
for select
to authenticated
using (
  (select private.current_user_role()) in ('coach'::public.user_role, 'admin'::public.user_role)
  and role in ('athlete'::public.user_role, 'parent'::public.user_role)
);

drop policy if exists "Parents can view linked child profiles" on public.profiles;
create policy "Parents can view linked child profiles"
on public.profiles
for select
to authenticated
using (
  exists (
    select 1
    from public.parent_athletes parent_link
    where parent_link.parent_id = (select auth.uid())
      and parent_link.athlete_id = profiles.id
  )
);

drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
on public.profiles
for select
to authenticated
using (id = (select auth.uid()));
