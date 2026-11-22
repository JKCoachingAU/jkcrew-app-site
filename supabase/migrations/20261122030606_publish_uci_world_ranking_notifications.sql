-- Observe the verified public world-ranking feed independently of the events
-- calendar. Its publication schedule and the app's ranking data are unchanged.
create table private.uci_ranking_notice_state (
  singleton boolean primary key default true check (singleton),
  men_ranking_date date,
  women_ranking_date date,
  source_checked_at timestamptz,
  request_id bigint,
  requested_at timestamptz,
  last_poll_error text
);
insert into private.uci_ranking_notice_state (singleton) values (true);

create table private.uci_ranking_notice_receipts (
  publication_week date not null,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  team_id uuid not null references public.coach_teams(id) on delete cascade,
  primary key (recipient_id, publication_week)
);
alter table private.uci_ranking_notice_state enable row level security;
alter table private.uci_ranking_notice_receipts enable row level security;
revoke all on private.uci_ranking_notice_state, private.uci_ranking_notice_receipts
  from public, anon, authenticated, service_role;

create function private.jkcrew_uci_rankings_notification_allowed(p_recipient uuid, p_payload jsonb)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1
    from private.uci_ranking_notice_receipts receipt
    join private.coach_team_memberships membership
      on membership.coach_id = receipt.recipient_id and membership.team_id = receipt.team_id
    join public.coach_teams team on team.id = membership.team_id
    join public.profiles coach on coach.id = receipt.recipient_id
    where receipt.recipient_id = p_recipient
      and receipt.publication_week::text = p_payload->>'publication_week'
      and coach.role::text in ('coach', 'admin')
      and membership.status = 'active' and team.status = 'active'
      and private.jkcrew_actor_approved(coach.id)
  );
$$;

-- Returns the number of eligible coach records created, even when a coach
-- only receives the in-app notice because device push is disabled.
create function private.apply_uci_ranking_notice_snapshot(p_snapshot jsonb)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  v_state private.uci_ranking_notice_state;
  v_checked_at timestamptz;
  v_category_key text;
  v_category jsonb;
  v_date date;
  v_men date;
  v_women date;
  v_source text;
  v_week date;
  v_previous_week date;
  v_recipient uuid;
  v_notices integer := 0;
begin
  if p_snapshot->'schemaVersion' is distinct from '1'::jsonb
    or jsonb_typeof(p_snapshot->'categories') is distinct from 'object'
    or coalesce(p_snapshot->>'checkedAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' then
    raise exception 'Invalid published UCI ranking snapshot.' using errcode = '22023';
  end if;
  v_checked_at := (p_snapshot->>'checkedAt')::timestamptz;
  if v_checked_at > now() + interval '10 minutes' or v_checked_at < now() - interval '3 days' then
    raise exception 'Published UCI ranking source check is stale.' using errcode = '22023';
  end if;

  foreach v_category_key in array array['men', 'women'] loop
    v_category := p_snapshot->'categories'->v_category_key;
    v_source := coalesce(v_category->>'sourceUrl', '');
    if jsonb_typeof(v_category->'rows') is distinct from 'array'
      or coalesce(v_category->>'rankingDate','') !~ '^\d{4}-\d{2}-\d{2}$'
      or v_source !~ ('^https://dataride\.uci\.(org|ch)/iframe/RankingDetails/' ||
        case v_category_key when 'men' then '239' else '241' end || '\?')
      or v_source !~ ('[?&]categoryId=' || case v_category_key when 'men' then '22' else '23' end || '(&|$)')
      or v_source !~ ('[?&]groupId=' || case v_category_key when 'men' then '156' else '157' end || '(&|$)')
      or v_source !~ '[?&]disciplineId=13(&|$)' or v_source !~ '[?&]raceTypeId=137(&|$)'
      or v_source !~ '[?&]rankingTypeId=1(&|$)' or v_source !~ '[?&]momentId=[1-9][0-9]*(&|$)' then
      raise exception 'Missing verified UCI world-ranking category.' using errcode = '22023';
    end if;
    v_date := (v_category->>'rankingDate')::date;
    if v_date > (v_checked_at at time zone 'UTC')::date
      or jsonb_array_length(v_category->'rows') not between 1 and 10000
      or v_category->'rows'->0->'rank' is distinct from '1'::jsonb then
      raise exception 'Invalid UCI world-ranking date or rows.' using errcode = '22023';
    end if;
    if v_category_key = 'men' then v_men := v_date; else v_women := v_date; end if;
  end loop;

  select * into strict v_state from private.uci_ranking_notice_state where singleton for update;
  if v_state.source_checked_at is not null and
    (v_checked_at < v_state.source_checked_at or v_men < v_state.men_ranking_date or v_women < v_state.women_ranking_date) then
    raise exception 'Older UCI ranking snapshot rejected.' using errcode = '22023';
  end if;
  v_week := date_trunc('week', greatest(v_men, v_women)::timestamp)::date;
  v_previous_week := date_trunc('week', greatest(v_state.men_ranking_date, v_state.women_ranking_date)::timestamp)::date;
  update private.uci_ranking_notice_state
  set source_checked_at = v_checked_at, men_ranking_date = v_men, women_ranking_date = v_women
  where singleton;

  -- Seed the first observation silently. One official ranking week produces
  -- one notice, even when its two categories arrive on different dates.
  if v_previous_week is null or v_week <= v_previous_week then return 0; end if;
  for v_recipient in
    insert into private.uci_ranking_notice_receipts (publication_week, recipient_id, team_id)
    select v_week, coach.id, membership.team_id
    from private.coach_team_memberships membership
    join public.coach_teams team on team.id = membership.team_id and team.status = 'active'
    join public.profiles coach on coach.id = membership.coach_id and coach.role::text in ('coach', 'admin')
    where membership.status = 'active' and private.jkcrew_actor_approved(coach.id)
    on conflict (publication_week, recipient_id) do nothing
    returning recipient_id
  loop
    perform private.emit_jkcrew_notification(
      v_recipient, 'uci_rankings_published', 'UCI world rankings updated',
      'The latest BMX Freestyle Park world rankings are available. Open Coach HQ to see your riders.',
      'command', jsonb_build_object('publication_week', v_week),
      'uci-world-rankings:' || v_week::text || ':' || v_recipient::text, 'event'
    );
    v_notices := v_notices + 1;
  end loop;
  return v_notices;
end;
$$;

create function private.request_uci_ranking_notice_refresh()
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_state private.uci_ranking_notice_state;
  v_request bigint;
begin
  select * into strict v_state from private.uci_ranking_notice_state where singleton for update;
  if v_state.request_id is not null and v_state.requested_at > now() - interval '5 minutes' then return; end if;
  select net.http_get(
    url := 'https://raw.githubusercontent.com/JKCoachingAU/jkcrew-app-site/uci-rankings/rankings.json',
    timeout_milliseconds := 20000
  ) into v_request;
  update private.uci_ranking_notice_state set request_id = v_request, requested_at = now(), last_poll_error = null
  where singleton;
end;
$$;

create function private.consume_uci_ranking_notice_refresh()
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_state private.uci_ranking_notice_state;
  v_response net._http_response;
  v_error text;
begin
  select * into strict v_state from private.uci_ranking_notice_state where singleton for update;
  if v_state.request_id is null then return; end if;
  select * into v_response from net._http_response where id = v_state.request_id;
  if v_response.id is null and v_state.requested_at > now() - interval '5 minutes' then return; end if;

  if v_response.id is null or v_response.status_code is distinct from 200
    or coalesce(v_response.timed_out, false) or nullif(v_response.error_msg, '') is not null
    or v_response.content is null or octet_length(v_response.content) > 900000 then
    v_error := 'Published UCI rankings unavailable.';
  else
    begin
      perform private.apply_uci_ranking_notice_snapshot(v_response.content::jsonb);
    exception when sqlstate '22023' or sqlstate '22P02' or sqlstate '22007' or sqlstate '22008' then
      v_error := 'Published UCI rankings could not be verified.';
    end;
  end if;
  update private.uci_ranking_notice_state set request_id = null, last_poll_error = v_error where singleton;
end;
$$;

-- Install only after the subsequent shared scope guard is in place, so a
-- release cannot be recorded before its coach notification can be queued.
create function private.install_uci_rankings_notification_jobs()
returns void language plpgsql security invoker set search_path = '' as $$
begin
  -- GitHub checks at 17:23 UTC. Check the published branch at 09:00 Brisbane and
  -- collect the async result in that window. A late publication is picked up
  -- by the next day's check with no change to GitHub's refresh frequency.
  perform cron.schedule('jkcrew-uci-rankings-notice-request', '0 23 * * *',
    'select private.request_uci_ranking_notice_refresh();');
  perform cron.schedule('jkcrew-uci-rankings-notice-consume', '*/5 23 * * *',
    'select private.consume_uci_ranking_notice_refresh();');
end;
$$;

revoke all on function private.jkcrew_uci_rankings_notification_allowed(uuid, jsonb),
  private.apply_uci_ranking_notice_snapshot(jsonb), private.request_uci_ranking_notice_refresh(),
  private.consume_uci_ranking_notice_refresh(), private.install_uci_rankings_notification_jobs()
  from public, anon, authenticated, service_role;
