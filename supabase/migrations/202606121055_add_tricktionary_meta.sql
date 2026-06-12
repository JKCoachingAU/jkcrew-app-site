alter table public.profiles
  add column if not exists tricktionary_meta jsonb not null default '{}'::jsonb;
