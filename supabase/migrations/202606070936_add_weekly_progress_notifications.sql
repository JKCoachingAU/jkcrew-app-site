create table if not exists public.weekly_progress_notification_settings (
  coach_id uuid primary key default auth.uid(),
  enabled boolean not null default true,
  parent_summaries_enabled boolean not null default true,
  online_rider_summaries_enabled boolean not null default true,
  inactive_rider_summaries_enabled boolean not null default false,
  send_day integer not null default 0 check (send_day between 0 and 6),
  send_time time not null default '19:30',
  timezone text not null default 'Australia/Brisbane',
  updated_at timestamptz not null default now()
);

create table if not exists public.weekly_progress_notifications (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null,
  athlete_id uuid not null,
  recipient_type text not null check (recipient_type in ('parent', 'rider', 'coach_preview')),
  recipient_id uuid not null,
  week_start date not null,
  week_end date not null,
  title text not null,
  summary text not null,
  status text not null default 'draft' check (status in ('draft', 'preview', 'sent', 'skipped')),
  stats jsonb not null default '{}'::jsonb,
  coach_notes text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (athlete_id, recipient_type, recipient_id, week_start)
);

alter table public.weekly_progress_notification_settings enable row level security;
alter table public.weekly_progress_notifications enable row level security;

grant select, insert, update on public.weekly_progress_notification_settings to authenticated;
grant select, insert, update on public.weekly_progress_notifications to authenticated;

drop policy if exists "Coaches manage weekly notification settings" on public.weekly_progress_notification_settings;
create policy "Coaches manage weekly notification settings"
on public.weekly_progress_notification_settings
for all
to authenticated
using (
  coach_id = auth.uid()
  and exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.role in ('coach', 'admin')
  )
)
with check (
  coach_id = auth.uid()
  and exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.role in ('coach', 'admin')
  )
);

drop policy if exists "Coaches manage weekly progress notifications" on public.weekly_progress_notifications;
create policy "Coaches manage weekly progress notifications"
on public.weekly_progress_notifications
for all
to authenticated
using (
  coach_id = auth.uid()
  and exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.role in ('coach', 'admin')
  )
)
with check (
  coach_id = auth.uid()
  and exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.role in ('coach', 'admin')
  )
);

drop policy if exists "Parents view linked weekly progress notifications" on public.weekly_progress_notifications;
create policy "Parents view linked weekly progress notifications"
on public.weekly_progress_notifications
for select
to authenticated
using (
  recipient_type = 'parent'
  and recipient_id = auth.uid()
  and exists (
    select 1 from public.parent_athletes
    where parent_athletes.parent_id = auth.uid()
      and parent_athletes.athlete_id = weekly_progress_notifications.athlete_id
      and parent_athletes.coach_id = weekly_progress_notifications.coach_id
  )
);

drop policy if exists "Riders view own weekly progress notifications" on public.weekly_progress_notifications;
create policy "Riders view own weekly progress notifications"
on public.weekly_progress_notifications
for select
to authenticated
using (
  recipient_type = 'rider'
  and recipient_id = auth.uid()
  and athlete_id = auth.uid()
);
