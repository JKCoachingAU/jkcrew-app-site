create index if not exists weekly_challenge_completions_athlete_idx
  on public.weekly_challenge_completions (athlete_id, awarded_at desc);
create index if not exists weekly_challenges_created_by_idx
  on public.weekly_challenges (created_by, created_at desc);

drop policy if exists "authenticated users can read active weekly challenges" on public.weekly_challenges;
create policy "authenticated users can read active weekly challenges"
  on public.weekly_challenges for select to authenticated
  using (status = 'active' or created_by = (select auth.uid()));

drop policy if exists "riders and coaches can read challenge completions" on public.weekly_challenge_completions;
create policy "riders and coaches can read challenge completions"
  on public.weekly_challenge_completions for select to authenticated
  using (
    athlete_id = (select auth.uid()) or exists (
      select 1 from public.coach_athletes link
      where link.coach_id = (select auth.uid())
        and link.athlete_id = weekly_challenge_completions.athlete_id
    )
  );

-- Settlement is invoked internally by the read RPCs; it does not need its own Data API endpoint.
revoke execute on function public.settle_expired_rider_battles() from authenticated;

notify pgrst, 'reload schema';
