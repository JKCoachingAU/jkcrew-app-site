create table if not exists public.profile_showreels (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.profiles(id) on delete cascade,
  uploaded_by uuid references public.profiles(id) on delete set null default auth.uid(),
  video_url text not null,
  storage_path text not null,
  duration_seconds numeric,
  mime_type text,
  file_size_bytes bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_showreels_duration_check check (duration_seconds is null or duration_seconds <= 10.5),
  constraint profile_showreels_mime_check check (mime_type is null or mime_type like 'video/%')
);

create unique index if not exists profile_showreels_storage_path_idx
  on public.profile_showreels(storage_path);

create index if not exists profile_showreels_rider_created_idx
  on public.profile_showreels(rider_id, created_at desc);

create index if not exists profile_showreels_uploaded_by_idx
  on public.profile_showreels(uploaded_by);

alter table public.profile_showreels enable row level security;

create or replace function public.touch_profile_showreels_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profile_showreels_touch_updated_at on public.profile_showreels;
create trigger profile_showreels_touch_updated_at
before update on public.profile_showreels
for each row
execute function public.touch_profile_showreels_updated_at();

create or replace function public.enforce_profile_showreel_limit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (
    select count(*)
    from public.profile_showreels sr
    where sr.rider_id = new.rider_id
  ) >= 3 then
    raise exception 'You can only upload 3 showreel clips. Delete one to add a new clip.';
  end if;
  return new;
end;
$$;

drop trigger if exists profile_showreels_limit_before_insert on public.profile_showreels;
create trigger profile_showreels_limit_before_insert
before insert on public.profile_showreels
for each row
execute function public.enforce_profile_showreel_limit();

revoke execute on function public.touch_profile_showreels_updated_at() from public, anon, authenticated;
revoke execute on function public.enforce_profile_showreel_limit() from public, anon, authenticated;

drop policy if exists "Showreels are visible on rider profiles" on public.profile_showreels;
create policy "Showreels are visible on rider profiles"
on public.profile_showreels
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = profile_showreels.rider_id
      and p.role = 'athlete'
  )
);

drop policy if exists "Riders and coaches can add showreels" on public.profile_showreels;
create policy "Riders and coaches can add showreels"
on public.profile_showreels
for insert
to authenticated
with check (
  uploaded_by = auth.uid()
  and exists (
    select 1
    from public.profiles p
    where p.id = profile_showreels.rider_id
      and p.role = 'athlete'
  )
  and (
    rider_id = auth.uid()
    or exists (
      select 1
      from public.profiles me
      where me.id = auth.uid()
        and me.role in ('coach', 'admin')
    )
    or exists (
      select 1
      from public.coach_athletes ca
      where ca.coach_id = auth.uid()
        and ca.athlete_id = profile_showreels.rider_id
    )
  )
);

drop policy if exists "Riders and coaches can remove showreels" on public.profile_showreels;
create policy "Riders and coaches can remove showreels"
on public.profile_showreels
for delete
to authenticated
using (
  rider_id = auth.uid()
  or exists (
    select 1
    from public.profiles me
    where me.id = auth.uid()
      and me.role in ('coach', 'admin')
  )
  or exists (
    select 1
    from public.coach_athletes ca
    where ca.coach_id = auth.uid()
      and ca.athlete_id = profile_showreels.rider_id
  )
);

grant select, insert, delete on public.profile_showreels to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-showreels',
  'profile-showreels',
  true,
  125829120,
  array['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v']
)
on conflict (id) do update
set public = true,
    file_size_limit = 125829120,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Profile showreels can be read" on storage.objects;

drop policy if exists "Riders and coaches can upload profile showreels" on storage.objects;
create policy "Riders and coaches can upload profile showreels"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'profile-showreels'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and exists (
    select 1
    from public.profiles p
    where p.id = ((storage.foldername(name))[1])::uuid
      and p.role = 'athlete'
  )
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (
      select 1
      from public.profiles me
      where me.id = auth.uid()
        and me.role in ('coach', 'admin')
    )
    or exists (
      select 1
      from public.coach_athletes ca
      where ca.coach_id = auth.uid()
        and ca.athlete_id = ((storage.foldername(name))[1])::uuid
    )
  )
);

drop policy if exists "Riders and coaches can delete profile showreels" on storage.objects;
create policy "Riders and coaches can delete profile showreels"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'profile-showreels'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (
      select 1
      from public.profiles me
      where me.id = auth.uid()
        and me.role in ('coach', 'admin')
    )
    or exists (
      select 1
      from public.coach_athletes ca
      where ca.coach_id = auth.uid()
        and ca.athlete_id = ((storage.foldername(name))[1])::uuid
    )
  )
);

create or replace function public.get_public_athlete_profile(p_athlete_id uuid)
returns table(
  id uuid,
  display_name text,
  level integer,
  avatar jsonb,
  country_code text,
  country_name text,
  stance text,
  spin_direction text,
  favourite_trick text,
  age integer,
  sponsors text,
  achievements text,
  badges jsonb,
  showreel_videos jsonb,
  social_links jsonb,
  weekly_wins integer,
  weekly_points integer,
  current_rank integer,
  is_weekly_winner boolean,
  is_last_place boolean
)
language sql
security definer
set search_path = public
as $$
  with ranked as (
    select
      gl.*,
      rank() over (order by gl.weekly_points desc, gl.display_name asc) as rank_number,
      count(*) over () as total_riders
    from public.get_weekly_leaderboard() gl
  ),
  profile_row as (
    select
      p.id,
      p.display_name,
      r.level,
      p.avatar,
      p.country_code,
      p.country_name,
      p.stance,
      p.spin_direction,
      p.favourite_trick,
      p.age,
      p.sponsors,
      p.achievements,
      coalesce(r.earned_badges, public.get_earned_badges(p.id)) as badges,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', sr.id,
          'video_url', sr.video_url,
          'storage_path', sr.storage_path,
          'duration_seconds', sr.duration_seconds,
          'created_at', sr.created_at
        ) order by sr.created_at desc)
        from public.profile_showreels sr
        where sr.rider_id = p.id
      ), '[]'::jsonb) as showreel_videos,
      coalesce(p.social_links, '{}'::jsonb) as social_links,
      coalesce(r.weekly_points, 0)::integer as weekly_points,
      coalesce(r.rank_number, 0)::integer as current_rank,
      coalesce(r.total_riders, 0)::integer as total_riders
    from public.profiles p
    left join ranked r on r.athlete_id = p.id
    where p.id = p_athlete_id
      and p.role = 'athlete'
  )
  select
    pr.id,
    pr.display_name,
    pr.level,
    pr.avatar,
    pr.country_code,
    pr.country_name,
    pr.stance,
    pr.spin_direction,
    pr.favourite_trick,
    pr.age,
    pr.sponsors,
    pr.achievements,
    pr.badges,
    pr.showreel_videos,
    pr.social_links,
    0::integer as weekly_wins,
    pr.weekly_points,
    pr.current_rank,
    pr.current_rank = 1 and pr.weekly_points > 0 as is_weekly_winner,
    pr.current_rank = pr.total_riders and pr.total_riders > 1 as is_last_place
  from profile_row pr;
$$;

grant execute on function public.get_public_athlete_profile(uuid) to authenticated;

create index if not exists leaderboard_point_adjustments_athlete_week_idx
  on public.leaderboard_point_adjustments(athlete_id, week_start);

create or replace function public.normalize_leaderboard_adjustment_week_start()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  athlete_country text;
  bounds record;
begin
  select coalesce(nullif(country_code, ''), 'AU')
  into athlete_country
  from public.profiles
  where id = new.athlete_id;

  if athlete_country is null then
    athlete_country := 'AU';
  end if;

  select *
  into bounds
  from public.jkcrew_week_bounds(athlete_country, coalesce(new.created_at, now()));

  new.week_start := bounds.week_start_date;
  return new;
end;
$$;

drop trigger if exists leaderboard_point_adjustments_normalize_week on public.leaderboard_point_adjustments;
create trigger leaderboard_point_adjustments_normalize_week
before insert or update on public.leaderboard_point_adjustments
for each row
execute function public.normalize_leaderboard_adjustment_week_start();

revoke execute on function public.normalize_leaderboard_adjustment_week_start() from public, anon, authenticated;
