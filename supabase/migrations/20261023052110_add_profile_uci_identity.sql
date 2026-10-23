-- Public sporting identity only. Existing profile RLS continues to govern who
-- can read or update the link; this never affects JKC points or permissions.
alter table public.profiles
  add column uci_id text
  constraint profiles_uci_id_format check (
    uci_id is null or (char_length(uci_id) = 11 and uci_id ~ '^[0-9]{11}$')
  );

comment on column public.profiles.uci_id is
  'Optional public UCI ID used only to display official world rankings. Not a scoring or authorization field.';
