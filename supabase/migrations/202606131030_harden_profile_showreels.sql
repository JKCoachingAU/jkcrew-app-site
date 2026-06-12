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

drop policy if exists "Profile showreels can be read" on storage.objects;

revoke execute on function public.touch_profile_showreels_updated_at() from public, anon, authenticated;
revoke execute on function public.enforce_profile_showreel_limit() from public, anon, authenticated;
revoke execute on function public.normalize_leaderboard_adjustment_week_start() from public, anon, authenticated;

create index if not exists profile_showreels_uploaded_by_idx
  on public.profile_showreels(uploaded_by);

drop index if exists public.assignment_point_awards_athlete_created_idx;
