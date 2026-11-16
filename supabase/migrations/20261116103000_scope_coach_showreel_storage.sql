-- A coach may manage showreels for linked riders only. The previous policies
-- allowed any coach role to upload/delete any athlete's showreel.

drop policy if exists "Riders and coaches can upload profile showreels" on storage.objects;
create policy "Riders and linked coaches can upload profile showreels"
on storage.objects
for insert to authenticated
with check (
  bucket_id = 'profile-showreels'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and exists (
    select 1 from public.profiles p
    where p.id = ((storage.foldername(name))[1])::uuid
      and p.role = 'athlete'::public.user_role
  )
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (
      select 1 from public.coach_athletes ca
      where ca.coach_id = (select auth.uid())
        and ca.athlete_id = ((storage.foldername(name))[1])::uuid
    )
  )
);

drop policy if exists "Riders and coaches can delete profile showreels" on storage.objects;
create policy "Riders and linked coaches can delete profile showreels"
on storage.objects
for delete to authenticated
using (
  bucket_id = 'profile-showreels'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (
      select 1 from public.coach_athletes ca
      where ca.coach_id = (select auth.uid())
        and ca.athlete_id = ((storage.foldername(name))[1])::uuid
    )
  )
);
