-- Replace the unused contest-preparation roster bucket with an injured-athlete
-- bucket. Keep the legacy value accepted while installed clients update.

alter table public.coach_athlete_groups
  drop constraint if exists coach_athlete_groups_group_name_check;

alter table public.coach_athlete_groups
  add constraint coach_athlete_groups_group_name_check
  check (
    group_name = any (
      array[
        'monday'::text,
        'tuesday'::text,
        'wednesday'::text,
        'online'::text,
        'private'::text,
        'elite'::text,
        'beginner'::text,
        'contest_prep'::text,
        'injured'::text
      ]
    )
  );

alter table public.coach_athletes
  drop constraint if exists coach_athletes_group_name_check;

alter table public.coach_athletes
  add constraint coach_athletes_group_name_check
  check (
    group_name = any (
      array[
        'monday'::text,
        'tuesday'::text,
        'wednesday'::text,
        'online'::text,
        'private'::text,
        'elite'::text,
        'beginner'::text,
        'contest_prep'::text,
        'injured'::text
      ]
    )
  );

insert into public.coach_athlete_groups (
  coach_id,
  athlete_id,
  group_name,
  membership_type,
  expires_at,
  notes,
  created_at,
  updated_at
)
select
  coach_id,
  athlete_id,
  'injured',
  membership_type,
  expires_at,
  notes,
  created_at,
  now()
from public.coach_athlete_groups
where group_name = 'contest_prep'
on conflict (coach_id, athlete_id, group_name) do nothing;

delete from public.coach_athlete_groups
where group_name = 'contest_prep';

update public.coach_athletes
set group_name = 'injured'
where group_name = 'contest_prep';
