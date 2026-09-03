drop policy if exists "Signed in users can add their own crew reactions" on public.crew_post_reactions;
create policy "Signed in users can add their own crew reactions"
on public.crew_post_reactions for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.crew_posts p
    where p.id = crew_post_reactions.post_id
      and p.post_type in ('leaderboard','chat','announcement')
  )
);
