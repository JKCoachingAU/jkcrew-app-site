-- A stopped partial Daily remains an honest, immutable timed result. If the
-- rider later lands the entire same list today, that checklist can unlock the
-- optional Tier 2 without retroactively claiming any Tier 1 point, XP or PB.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create function private.daily_tier_two_qualifying_candidate(p_athlete_id uuid,p_local_date date)
returns private.daily_finish_candidates
language plpgsql stable security invoker set search_path='' as $$
declare c private.daily_finish_candidates%rowtype; v_list jsonb; v_venue text; v_tz text;
begin
  -- Preserve the original full-confirmation path, including historical results.
  select * into c from private.daily_finish_candidates
  where athlete_id=p_athlete_id and local_date=p_local_date and status='confirmed'
    and coalesce(completed_count,total_count)=total_count and total_count>0
  order by confirmed_at,id limit 1;
  if found then return c; end if;

  select public.jkcrew_country_timezone(country_code) into v_tz from public.profiles where id=p_athlete_id;
  if p_local_date is distinct from (now() at time zone v_tz)::date then return null; end if;
  for c in select * from private.daily_finish_candidates
    where athlete_id=p_athlete_id and local_date=p_local_date and status='confirmed'
      and completed_count<total_count and total_count>0
    order by confirmed_at,id
  loop
    v_venue:=case when c.venue='default' then '' else c.venue end;
    v_list:=private.daily_list_state(p_athlete_id,v_venue,p_local_date);
    if v_list->>'list_signature' is distinct from c.list_signature
      or (v_list->>'total_count')::integer is distinct from c.total_count
      or (v_list->>'completed_count')::integer is distinct from c.total_count then continue; end if;
    -- Look up the current assignment IDs, not the old candidate's assignment:
    -- identical lists may have been copied into the new training week. A stale
    -- tick, a different venue, a removed landing or another rider's evidence
    -- cannot qualify. The overall training session may already have ended.
    if exists(
      select 1 from private.daily_list_rows(p_athlete_id,v_venue) a
      left join public.assignment_progress p on p.assignment_id=a.id
      left join public.tricktionary_landing_history h
        on h.id='daily:'||a.id::text||':'||p_local_date::text
      where p.athlete_id is distinct from p_athlete_id
        or p.progress_date is distinct from p_local_date
        or h.id is null or h.assignment_id is distinct from a.id
        or h.athlete_id is distinct from p_athlete_id or h.category is distinct from 'daily'
        or h.landing_date is distinct from p_local_date
        or (h.landed_at at time zone v_tz)::date is distinct from p_local_date
        or coalesce(h.landed_count,0)<=0 or coalesce(h.evidence_type,'revoked')='revoked'
        or private.jkcrew_venue_key(h.venue) is distinct from private.jkcrew_venue_key(v_venue)
        or lower(regexp_replace(btrim(h.trick_name),'\s+',' ','g'))
          is distinct from lower(regexp_replace(btrim(a.trick_name),'\s+',' ','g'))
    ) then continue; end if;
    return c;
  end loop;
  return null;
end $$;
-- Internal invoker helper only: existing authorized definer RPCs provide the
-- table permissions. No new endpoint, role grant, policy or data mutation.
revoke all on function private.daily_tier_two_qualifying_candidate(uuid,date) from public,anon,authenticated;

create or replace function private.daily_tier_two_json(p_athlete_id uuid,p_local_date date)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare r private.daily_tier_two_rounds%rowtype; v_today date; v_tz text; v_date date; v_items jsonb; v_count integer; v_eligible boolean;
begin
  select public.jkcrew_country_timezone(country_code) into v_tz from public.profiles where id=p_athlete_id;
  v_today:=(now() at time zone v_tz)::date; v_date:=coalesce(p_local_date,v_today);
  select * into r from private.daily_tier_two_rounds where athlete_id=p_athlete_id and local_date=v_date;
  v_eligible:=(private.daily_tier_two_qualifying_candidate(p_athlete_id,v_date)).id is not null;
  if r.athlete_id is null then
    return jsonb_build_object('unlocked',false,'eligible',v_date=v_today and v_eligible,'athlete_id',p_athlete_id,'local_date',v_date,
      'reset_at',(v_date+1)::timestamp at time zone v_tz,'items','[]'::jsonb,'completed_count',0,'total_count',0,'points',0,'reward_points',4,
      'scoring_paused',private.rider_scoring_paused(p_athlete_id));
  end if;
  select jsonb_agg(item||jsonb_build_object('landed',coalesce((r.landed->>(item->>'id'))::boolean,false)) order by ordinal),
    count(*) filter(where coalesce((r.landed->>(item->>'id'))::boolean,false))::integer into v_items,v_count
    from jsonb_array_elements(r.items) with ordinality rows(item,ordinal);
  return jsonb_build_object('unlocked',true,'eligible',true,'athlete_id',p_athlete_id,'local_date',r.local_date,
    'reset_at',(r.local_date+1)::timestamp at time zone r.timezone,'source',r.source,'venue',r.venue,'items',v_items,
    'completed_count',v_count,'total_count',jsonb_array_length(r.items),'unlocked_at',r.unlocked_at,'revealed_at',r.revealed_at,
    'completed_at',r.completed_at,'points',r.points,'reward_points',4,'historical',v_date<>v_today,
    'scoring_paused',private.rider_scoring_paused(p_athlete_id));
end $$;
revoke all on function private.daily_tier_two_json(uuid,date) from public,anon,authenticated;

create or replace function private.unlock_daily_tier_two(p_athlete_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.daily_finish_candidates%rowtype; v_date date; v_tz text; v_items jsonb; v_source text:='daily_round_two'; v_list jsonb;
begin
  perform private.require_daily_tier_two_access(p_athlete_id,true);
  -- This is the same rider lock used by normal Daily actions and confirmation.
  select public.jkcrew_country_timezone(country_code) into v_tz from public.profiles where id=p_athlete_id for update;
  v_date:=(now() at time zone v_tz)::date;
  if exists(select 1 from private.daily_tier_two_rounds where athlete_id=p_athlete_id and local_date=v_date) then
    return private.daily_tier_two_json(p_athlete_id,v_date);
  end if;
  c:=private.daily_tier_two_qualifying_candidate(p_athlete_id,v_date);
  if c.id is null then return private.daily_tier_two_json(p_athlete_id,v_date); end if;
  select items into v_items from private.daily_tier_two_templates where athlete_id=p_athlete_id;
  if v_items is not null then v_source:='coach_template';
  else
    v_list:=private.daily_list_state(p_athlete_id,case when c.venue='default' then '' else c.venue end,v_date);
    -- Do not silently substitute a sheet edited after the qualifying finish.
    if v_list->>'list_signature' is distinct from c.list_signature then
      raise exception 'Your Daily list changed. Ask your coach to set your Round 2 challenge.' using errcode='22023';
    end if;
    select jsonb_agg(jsonb_build_object('trick_name',a.trick_name,'notes',coalesce(a.notes,'')) order by a.sort_order,a.id)
      into v_items from private.daily_list_rows(p_athlete_id,case when c.venue='default' then '' else c.venue end) a;
  end if;
  select jsonb_agg(item||jsonb_build_object('id',gen_random_uuid()) order by ordinal) into v_items
    from jsonb_array_elements(v_items) with ordinality rows(item,ordinal);
  insert into private.daily_tier_two_rounds(athlete_id,local_date,timezone,source_candidate_id,source_session_id,venue,source,items)
    values(p_athlete_id,v_date,v_tz,c.id,c.session_id,c.venue,v_source,v_items);
  return private.daily_tier_two_json(p_athlete_id,v_date);
end $$;
revoke all on function private.unlock_daily_tier_two(uuid) from public,anon;
grant execute on function private.unlock_daily_tier_two(uuid) to authenticated;
