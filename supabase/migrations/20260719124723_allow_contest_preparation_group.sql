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
        'contest_prep'::text
      ]
    )
  );
