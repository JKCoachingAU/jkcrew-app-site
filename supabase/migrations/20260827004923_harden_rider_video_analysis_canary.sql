-- Keep the existing trick-help system intact while making the Riley video
-- analysis canary match the hosted project's real Free-plan upload ceiling.
update storage.buckets
set public = false,
    file_size_limit = 52428800,
    allowed_mime_types = array[
      'video/mp4',
      'video/quicktime',
      'video/webm',
      'video/x-m4v',
      'video/m4v',
      'video/3gpp',
      'video/3gpp2'
    ]::text[]
where id = 'trick-help-videos';

drop policy if exists "Athletes create trick help requests" on public.trick_help_requests;
create policy "Athletes create trick help requests"
on public.trick_help_requests
for insert
to authenticated
with check (
  athlete_id = (select auth.uid())
  and coach_id is not null
  and exists (
    select 1
    from public.coach_athletes ca
    where ca.athlete_id = trick_help_requests.athlete_id
      and ca.coach_id = trick_help_requests.coach_id
  )
);

drop policy if exists "Trick help video owners can delete" on storage.objects;
create policy "Trick help video owners can delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'trick-help-videos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
