create table if not exists private.retired_coach_venue_backups (
  venue_id uuid primary key,
  retired_at timestamptz not null default now(),
  reason text not null,
  venue jsonb not null
);

revoke all on private.retired_coach_venue_backups from public, anon, authenticated;

insert into private.retired_coach_venue_backups (venue_id, reason, venue)
select venue.id, 'Removed duplicate Daily location menu item: ' || venue.name, to_jsonb(venue)
from public.coach_venues venue
where lower(trim(venue.name)) in ('hotbox', 'default daily list')
on conflict (venue_id) do nothing;

delete from public.coach_venues venue
where lower(trim(venue.name)) in ('hotbox', 'default daily list');
