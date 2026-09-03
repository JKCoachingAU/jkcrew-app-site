insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'crew-chat-media',
  'crew-chat-media',
  false,
  52428800,
  array['video/mp4','video/quicktime','video/webm','video/x-m4v','video/m4v','video/3gpp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Crew members can view chat media"
on storage.objects for select to authenticated
using (bucket_id = 'crew-chat-media');

create policy "Riders and coaches can upload chat media"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'crew-chat-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('athlete', 'coach', 'admin')
  )
);

create policy "Owners and coaches can delete chat media"
on storage.objects for delete to authenticated
using (
  bucket_id = 'crew-chat-media'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('coach', 'admin')
    )
  )
);

create table if not exists public.crew_post_reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.crew_posts(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  reason text not null default 'Needs coach review' check (char_length(btrim(reason)) between 3 and 200),
  status text not null default 'open' check (status in ('open','reviewed','dismissed')),
  created_at timestamptz not null default now(),
  unique (post_id, reporter_id)
);

alter table public.crew_post_reports enable row level security;
grant select, insert, update on public.crew_post_reports to authenticated;

create policy "Crew members can report chat posts"
on public.crew_post_reports for insert to authenticated
with check (
  reporter_id = (select auth.uid())
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
  )
);

create policy "Reporters and coaches can view reports"
on public.crew_post_reports for select to authenticated
using (
  reporter_id = (select auth.uid())
  or exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role in ('coach','admin')
  )
);

create policy "Coaches can review reports"
on public.crew_post_reports for update to authenticated
using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('coach','admin')))
with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('coach','admin')));

create policy "Authors and coaches can update crew posts"
on public.crew_posts for update to authenticated
using (
  author_id = (select auth.uid())
  or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('coach','admin'))
)
with check (
  author_id = (select auth.uid())
  or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('coach','admin'))
);

create policy "Authors and coaches can remove crew posts"
on public.crew_posts for delete to authenticated
using (
  author_id = (select auth.uid())
  or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('coach','admin'))
);

create or replace function private.jkcrew_moderate_crew_post()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if new.post_type = 'chat' and new.body ~* '(fuck|shit|cunt|bitch|nigg|fagg)' then
    raise exception 'That message contains language that is not allowed in JKCREW chat.';
  end if;
  if char_length(btrim(coalesce(new.body, ''))) > 300 then
    raise exception 'JKCREW chat messages must be 300 characters or less.';
  end if;
  return new;
end;
$$;

revoke all on function private.jkcrew_moderate_crew_post() from public, anon, authenticated;

drop trigger if exists moderate_crew_post on public.crew_posts;
create trigger moderate_crew_post
before insert or update of body on public.crew_posts
for each row execute function private.jkcrew_moderate_crew_post();

alter table public.crew_posts replica identity full;
do $$
begin
  alter publication supabase_realtime add table public.crew_posts;
exception when duplicate_object then null;
end $$;
