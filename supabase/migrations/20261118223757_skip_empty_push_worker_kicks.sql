-- INSERT statement triggers also fire when SELECT/ON CONFLICT inserts no rows.
-- Scoring refreshes often have no new recipients. Do not launch an Edge worker
-- (and its database claim requests) for those empty batches. Real notifications
-- still kick once per inserted batch; the existing periodic worker is unchanged.
set local lock_timeout='5s';

create or replace function private.kick_jkcrew_push_worker_after_insert()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if exists(select 1 from jkcrew_inserted_push_rows) then
    perform private.kick_jkcrew_push_worker();
  end if;
  return null;
end;
$$;
revoke all on function private.kick_jkcrew_push_worker_after_insert()
  from public,anon,authenticated,service_role;

create or replace trigger push_queue_kick_worker
after insert on public.push_notification_queue
referencing new table as jkcrew_inserted_push_rows
for each statement execute function private.kick_jkcrew_push_worker_after_insert();

-- Recovery reminders can revive a skipped row using ON CONFLICT DO UPDATE.
-- INSERT transition rows exclude that update, so preserve its immediate wakeup.
-- Claim/finish updates and future retries must not start another worker.
create function private.kick_jkcrew_push_worker_after_requeue()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if exists(
    select 1 from jkcrew_requeued_push_rows n
    join jkcrew_previous_push_rows o using(id)
    where n.status='pending' and n.status is distinct from o.status
      and n.available_at<=clock_timestamp()
  ) then
    perform private.kick_jkcrew_push_worker();
  end if;
  return null;
end;
$$;
revoke all on function private.kick_jkcrew_push_worker_after_requeue()
  from public,anon,authenticated,service_role;

create trigger push_queue_kick_requeued_worker
after update on public.push_notification_queue
referencing old table as jkcrew_previous_push_rows new table as jkcrew_requeued_push_rows
for each statement execute function private.kick_jkcrew_push_worker_after_requeue();
