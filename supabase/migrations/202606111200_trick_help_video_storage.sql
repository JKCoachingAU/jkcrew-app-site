alter table public.trick_help_requests
  add column if not exists video_storage_path text not null default '',
  add column if not exists coach_video_storage_path text not null default '',
  add column if not exists video_file_name text not null default '',
  add column if not exists coach_video_file_name text not null default '',
  add column if not exists video_mime_type text not null default '',
  add column if not exists coach_video_mime_type text not null default '',
  add column if not exists video_size_bytes bigint not null default 0,
  add column if not exists coach_video_size_bytes bigint not null default 0;

insert into storage.buckets (id, name, public, file_size_limit)
values ('trick-help-videos', 'trick-help-videos', false, 524288000)
on conflict (id) do update
set public = false,
    file_size_limit = 524288000;

drop policy if exists "Trick help video owners can upload" on storage.objects;
create policy "Trick help video owners can upload"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'trick-help-videos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Trick help video owners can update" on storage.objects;
create policy "Trick help video owners can update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'trick-help-videos'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'trick-help-videos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Linked users can read trick help videos" on storage.objects;
create policy "Linked users can read trick help videos"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'trick-help-videos'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (
      select 1
      from public.trick_help_requests thr
      where (thr.video_storage_path = storage.objects.name or thr.coach_video_storage_path = storage.objects.name)
        and (
          thr.athlete_id = auth.uid()
          or thr.coach_id = auth.uid()
          or exists (
            select 1
            from public.coach_athletes ca
            where ca.coach_id = auth.uid()
              and ca.athlete_id = thr.athlete_id
          )
          or exists (
            select 1
            from public.parent_athletes pa
            where pa.parent_id = auth.uid()
              and pa.athlete_id = thr.athlete_id
          )
        )
    )
  )
);
