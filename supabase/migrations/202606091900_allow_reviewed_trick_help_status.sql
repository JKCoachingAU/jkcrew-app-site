alter table public.trick_help_requests
  drop constraint if exists trick_help_requests_status_check;

alter table public.trick_help_requests
  add constraint trick_help_requests_status_check
  check (status = any (array['open'::text, 'replied'::text, 'reviewed'::text]));
