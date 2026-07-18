create index if not exists park_king_snapshots_athlete_idx
  on public.park_king_snapshots (athlete_id);

create index if not exists park_king_events_athlete_idx
  on public.park_king_events (athlete_id);

drop policy if exists "Authenticated users view park kings" on public.park_king_snapshots;
create policy "Authenticated users view park kings"
  on public.park_king_snapshots for select to authenticated
  using ((select auth.uid()) is not null);

drop policy if exists "Authenticated users view park king events" on public.park_king_events;
create policy "Authenticated users view park king events"
  on public.park_king_events for select to authenticated
  using ((select auth.uid()) is not null);
