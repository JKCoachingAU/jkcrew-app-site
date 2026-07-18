drop policy if exists "Coaches view own broadcasts" on public.coach_broadcasts;
drop policy if exists "Recipients view addressed broadcasts" on public.coach_broadcasts;

create policy "Coaches and recipients view broadcasts"
on public.coach_broadcasts
for select
to authenticated
using (
  (select auth.uid()) = coach_id
  or exists (
    select 1
    from public.coach_broadcast_recipients recipient
    where recipient.broadcast_id = coach_broadcasts.id
      and recipient.recipient_id = (select auth.uid())
  )
);
