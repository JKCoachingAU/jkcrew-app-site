create or replace function public.get_jkcrew_push_worker_config(p_worker_secret text)
returns table (vapid_public_key text, vapid_private_key text, vapid_subject text)
language plpgsql
security definer
set search_path = public, vault
as $function$
declare
  v_expected_secret text;
begin
  select decrypted_secret into v_expected_secret
  from vault.decrypted_secrets
  where name = 'jkcrew_push_worker_secret'
  limit 1;

  if v_expected_secret is null or p_worker_secret is distinct from v_expected_secret then
    raise exception 'Invalid push worker secret.';
  end if;

  return query
  select
    max(decrypted_secret) filter (where name = 'jkcrew_vapid_public_key'),
    max(decrypted_secret) filter (where name = 'jkcrew_vapid_private_key'),
    coalesce(max(decrypted_secret) filter (where name = 'jkcrew_vapid_subject'), 'mailto:joshkhourybmx@gmail.com')
  from vault.decrypted_secrets;
end;
$function$;

revoke all on function public.get_jkcrew_push_worker_config(text) from public, anon, authenticated;
grant execute on function public.get_jkcrew_push_worker_config(text) to service_role;

create or replace function public.claim_jkcrew_push_notifications(
  p_worker_secret text,
  p_limit integer default 50
)
returns setof public.push_notification_queue
language plpgsql
security definer
set search_path = public, vault
as $function$
declare
  v_expected_secret text;
begin
  select decrypted_secret into v_expected_secret
  from vault.decrypted_secrets
  where name = 'jkcrew_push_worker_secret'
  limit 1;

  if v_expected_secret is null or p_worker_secret is distinct from v_expected_secret then
    raise exception 'Invalid push worker secret.';
  end if;

  return query
  with selected as (
    select queue.id
    from public.push_notification_queue queue
    where queue.status = 'pending'
      and queue.available_at <= now()
    order by queue.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  )
  update public.push_notification_queue queue
  set status = 'processing',
      attempts = queue.attempts + 1,
      processed_at = now()
  from selected
  where queue.id = selected.id
  returning queue.*;
end;
$function$;

revoke all on function public.claim_jkcrew_push_notifications(text, integer) from public, anon, authenticated;
grant execute on function public.claim_jkcrew_push_notifications(text, integer) to service_role;

create or replace function public.finish_jkcrew_push_notification(
  p_worker_secret text,
  p_notification_id uuid,
  p_delivered integer,
  p_failed integer,
  p_error text default ''
)
returns void
language plpgsql
security definer
set search_path = public, vault
as $function$
declare
  v_expected_secret text;
begin
  select decrypted_secret into v_expected_secret
  from vault.decrypted_secrets
  where name = 'jkcrew_push_worker_secret'
  limit 1;

  if v_expected_secret is null or p_worker_secret is distinct from v_expected_secret then
    raise exception 'Invalid push worker secret.';
  end if;

  update public.push_notification_queue queue
  set status = case
        when coalesce(p_delivered, 0) > 0 then 'sent'
        when coalesce(p_failed, 0) = 0 then 'skipped'
        when queue.attempts < 5 then 'pending'
        else 'failed'
      end,
      available_at = case
        when coalesce(p_delivered, 0) = 0 and coalesce(p_failed, 0) > 0 and queue.attempts < 5
          then now() + make_interval(mins => least(30, queue.attempts * 3))
        else queue.available_at
      end,
      processed_at = now(),
      last_error = left(coalesce(p_error, ''), 1000)
  where queue.id = p_notification_id;
end;
$function$;

revoke all on function public.finish_jkcrew_push_notification(text, uuid, integer, integer, text) from public, anon, authenticated;
grant execute on function public.finish_jkcrew_push_notification(text, uuid, integer, integer, text) to service_role;

create or replace function private.kick_jkcrew_push_worker()
returns void
language plpgsql
security definer
set search_path = public, vault, net
as $function$
declare
  v_worker_secret text;
begin
  select decrypted_secret into v_worker_secret
  from vault.decrypted_secrets
  where name = 'jkcrew_push_worker_secret'
  limit 1;

  if v_worker_secret is null then
    return;
  end if;

  perform net.http_post(
    url := 'https://soanwttlorlgdfrzbvtp.supabase.co/functions/v1/send-jkcrew-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-worker-secret', v_worker_secret
    ),
    body := jsonb_build_object('source', 'database')
  );
exception when others then
  raise warning 'JKCREW push worker kick skipped: %', sqlerrm;
end;
$function$;

revoke all on function private.kick_jkcrew_push_worker() from public, anon, authenticated;
