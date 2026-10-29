-- Optional WHOOP connection. No rider is enrolled and no data is imported by
-- applying this migration. Only the authenticated Edge Function can use these
-- service-role operations; coach/parent links confer no health-data access.
begin;
create schema if not exists private;
create table private.health_whoop_connections (
  athlete_id uuid primary key references public.profiles(id) on delete cascade,
  generation uuid not null default gen_random_uuid(),
  connection_status text not null default 'disconnected'
    check (connection_status in ('disconnected','connected','reconnect_required')),
  token_cipher text check (octet_length(token_cipher) <= 16384),
  token_expires_at timestamptz,
  summary jsonb check (summary is null or (jsonb_typeof(summary) = 'object' and octet_length(summary::text) <= 8192)),
  synced_at timestamptz,
  sync_after timestamptz,
  last_connect_at timestamptz,
  lease_id uuid,
  lease_until timestamptz,
  updated_at timestamptz not null default now()
);
create table private.health_whoop_oauth_states (
  state_hash text primary key check (state_hash ~ '^[a-f0-9]{64}$'),
  athlete_id uuid not null references private.health_whoop_connections(athlete_id) on delete cascade,
  generation uuid not null,
  expires_at timestamptz not null
);
create index health_whoop_oauth_states_athlete on private.health_whoop_oauth_states(athlete_id);
create index health_whoop_oauth_states_expiry on private.health_whoop_oauth_states(expires_at);
create table private.health_whoop_pending (
  ticket_hash text primary key check (ticket_hash ~ '^[a-f0-9]{64}$'),
  athlete_id uuid not null unique references private.health_whoop_connections(athlete_id) on delete cascade,
  generation uuid not null,
  token_cipher text not null check (octet_length(token_cipher) <= 16384),
  token_expires_at timestamptz not null,
  expires_at timestamptz not null
);
alter table private.health_whoop_connections enable row level security;
alter table private.health_whoop_oauth_states enable row level security;
alter table private.health_whoop_pending enable row level security;
revoke all on private.health_whoop_connections, private.health_whoop_oauth_states, private.health_whoop_pending from public, anon, authenticated;
grant usage on schema private to service_role;
grant select, insert, update, delete on private.health_whoop_connections, private.health_whoop_oauth_states, private.health_whoop_pending to service_role;

create function private.health_whoop_status(p_actor uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce((select jsonb_build_object(
    'connection', c.connection_status, 'summary', c.summary,
    'synced_at', c.synced_at, 'retry_after', c.sync_after,
    'syncing', coalesce(c.lease_until > now(), false),
    'sync_due', c.connection_status = 'connected' and coalesce(c.sync_after <= now(), true)
      and coalesce(c.lease_until <= now(), true)
  ) from private.health_whoop_connections c where c.athlete_id = p_actor),
  jsonb_build_object('connection','disconnected','summary',null,'synced_at',null,
    'retry_after',null,'syncing',false,'sync_due',false));
$$;
revoke all on function private.health_whoop_status(uuid) from public, anon, authenticated;
grant execute on function private.health_whoop_status(uuid) to service_role;

create function public.jkcrew_health_whoop_backend(p_action text, p_actor uuid default null, p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare c private.health_whoop_connections; s private.health_whoop_oauth_states; p private.health_whoop_pending;
  v_actor uuid := p_actor; v_lease uuid; v_result jsonb;
begin
  -- This RPC is never an authenticated-user API. The Edge Function validates
  -- Auth /user and derives p_actor itself, never from the request payload.
  if current_user <> 'service_role' then raise exception 'Health service access required' using errcode='42501'; end if;
  if p_action = 'consume_state' then
    if p_actor is not null then raise exception 'Invalid callback actor'; end if;
    delete from private.health_whoop_oauth_states
      where state_hash = p_data->>'state_hash' returning * into s;
    if not found or s.expires_at <= now() then return null; end if;
    v_actor := s.athlete_id;
  end if;
  if v_actor is null or not exists(select 1 from public.profiles where id=v_actor and role::text='athlete') then
    raise exception 'Rider account required' using errcode='42501';
  end if;
  if p_action = 'status' then return private.health_whoop_status(v_actor); end if;

  if p_action = 'begin' then
    if coalesce(p_data->>'state_hash','') !~ '^[a-f0-9]{64}$' then raise exception 'Invalid state'; end if;
    insert into private.health_whoop_connections(athlete_id) values(v_actor) on conflict do nothing;
    select * into c from private.health_whoop_connections where athlete_id=v_actor for update;
    if c.lease_until > now() or c.last_connect_at > now()-interval '30 seconds' then return jsonb_build_object('busy',true); end if;
    if c.connection_status='connected' then return jsonb_build_object('already_connected',true); end if;
    update private.health_whoop_connections set generation=gen_random_uuid(),last_connect_at=now(),updated_at=now()
      where athlete_id=v_actor returning * into c;
    delete from private.health_whoop_oauth_states where athlete_id=v_actor or expires_at <= now();
    delete from private.health_whoop_pending where athlete_id=v_actor or expires_at <= now();
    insert into private.health_whoop_oauth_states(state_hash,athlete_id,generation,expires_at)
      values(p_data->>'state_hash',v_actor,c.generation,now()+interval '5 minutes');
    return jsonb_build_object('started',true);
  end if;

  select * into c from private.health_whoop_connections where athlete_id=v_actor for update;
  if not found then return jsonb_build_object('claimed',false,'status',private.health_whoop_status(v_actor)); end if;
  if p_action = 'complete' then
    -- A provider redirect alone is not sufficient: the signed-in rider who
    -- initiated OAuth must present the callback's independent one-use ticket.
    if c.lease_until > now() then return jsonb_build_object('saved',false); end if;
    delete from private.health_whoop_pending where ticket_hash=p_data->>'ticket_hash' and athlete_id=v_actor returning * into p;
    if not found or p.expires_at <= now() or p.generation <> c.generation then return jsonb_build_object('saved',false); end if;
    update private.health_whoop_connections set token_cipher=p.token_cipher,token_expires_at=p.token_expires_at,
      connection_status='connected',summary=null,synced_at=null,sync_after=now(),updated_at=now() where athlete_id=v_actor;
    return jsonb_build_object('saved',true,'status',private.health_whoop_status(v_actor));
  end if;
  if p_action = 'consume_state' then
    if c.generation <> s.generation or c.lease_until > now() then return null; end if;
    v_lease := gen_random_uuid();
    update private.health_whoop_connections set lease_id=v_lease,lease_until=now()+interval '90 seconds' where athlete_id=v_actor;
    return jsonb_build_object('athlete_id',v_actor,'generation',c.generation,'lease_id',v_lease);
  end if;

  if p_action in ('claim_sync','claim_disconnect') then
    if c.lease_until > now() or (p_action='claim_sync' and
      (c.connection_status <> 'connected' or c.token_cipher is null or c.sync_after > now())) then
      return jsonb_build_object('claimed',false,'status',private.health_whoop_status(v_actor));
    end if;
    v_lease := gen_random_uuid();
    update private.health_whoop_connections set lease_id=v_lease,lease_until=now()+interval '90 seconds',
      sync_after=case when p_action='claim_sync' then now()+interval '15 minutes' else sync_after end
      where athlete_id=v_actor;
    return jsonb_build_object('claimed',true,'generation',c.generation,'lease_id',v_lease,
      'token_cipher',c.token_cipher,'token_expires_at',c.token_expires_at);
  end if;

  if c.generation is distinct from (p_data->>'generation')::uuid or c.lease_id is distinct from (p_data->>'lease_id')::uuid
      or c.lease_until is null or c.lease_until <= now() then return jsonb_build_object('saved',false); end if;
  if p_action = 'stage_tokens' then
    if coalesce(p_data->>'ticket_hash','') !~ '^[a-f0-9]{64}$' or coalesce(p_data->>'token_cipher','')='' then raise exception 'Invalid pending connection'; end if;
    delete from private.health_whoop_pending where athlete_id=v_actor;
    insert into private.health_whoop_pending(ticket_hash,athlete_id,generation,token_cipher,token_expires_at,expires_at)
      values(p_data->>'ticket_hash',v_actor,c.generation,p_data->>'token_cipher',(p_data->>'token_expires_at')::timestamptz,now()+interval '5 minutes');
    update private.health_whoop_connections set lease_id=null,lease_until=null,updated_at=now() where athlete_id=v_actor;
  elsif p_action = 'save_tokens' then
    if coalesce(p_data->>'token_cipher','')='' then raise exception 'Encrypted token required'; end if;
    update private.health_whoop_connections set token_cipher=p_data->>'token_cipher',
      token_expires_at=(p_data->>'token_expires_at')::timestamptz,
      connection_status='connected',updated_at=now()
      where athlete_id=v_actor;
  elsif p_action='save_summary' then
    update private.health_whoop_connections set summary=p_data->'summary',synced_at=now(),
      sync_after=now()+interval '15 minutes',lease_id=null,lease_until=null,updated_at=now() where athlete_id=v_actor;
  elsif p_action='sync_failed' then
    update private.health_whoop_connections set sync_after=now()+interval '60 seconds',lease_id=null,lease_until=null where athlete_id=v_actor;
  elsif p_action='reconnect' then
    update private.health_whoop_connections set connection_status='reconnect_required',token_cipher=null,token_expires_at=null,
      lease_id=null,lease_until=null,updated_at=now() where athlete_id=v_actor;
  elsif p_action='disconnect' then
    -- Cascades pending OAuth states; a stale callback/sync cannot recreate a row.
    delete from private.health_whoop_connections where athlete_id=v_actor;
  else raise exception 'Unknown health operation';
  end if;
  return jsonb_build_object('saved',true,'status',private.health_whoop_status(v_actor));
end;
$$;
revoke all on function public.jkcrew_health_whoop_backend(text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.jkcrew_health_whoop_backend(text,uuid,jsonb) to service_role;
comment on table private.health_whoop_connections is 'Optional owner-only wearable summary. OAuth token payloads are AES-GCM encrypted in the Edge Function; no coach or parent access.';
commit;
