alter table public.coach_broadcast_recipients
  add column if not exists dismissed_at timestamptz;

create or replace function public.get_my_coach_messages(p_limit integer default 3)
returns table(
  id uuid,
  sender_name text,
  target_label text,
  message text,
  sent_at timestamptz,
  expires_at timestamptz
)
language sql
stable
set search_path = public
as $function$
  select
    broadcast.id,
    broadcast.sender_name,
    broadcast.target_label,
    broadcast.message,
    broadcast.sent_at,
    broadcast.expires_at
  from public.coach_broadcast_recipients recipient
  join public.coach_broadcasts broadcast on broadcast.id = recipient.broadcast_id
  where recipient.recipient_id = (select auth.uid())
    and recipient.dismissed_at is null
    and broadcast.expires_at > now()
  order by broadcast.sent_at desc
  limit least(greatest(coalesce(p_limit, 3), 1), 10);
$function$;

create or replace function public.dismiss_my_coach_message(p_broadcast_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'You must be signed in';
  end if;

  update public.coach_broadcast_recipients
  set dismissed_at = coalesce(dismissed_at, now())
  where broadcast_id = p_broadcast_id
    and recipient_id = v_user_id;

  if not found then
    raise exception 'That coach message is not available';
  end if;

  return true;
end;
$function$;

revoke all on function public.dismiss_my_coach_message(uuid) from public, anon;
grant execute on function public.dismiss_my_coach_message(uuid) to authenticated;
