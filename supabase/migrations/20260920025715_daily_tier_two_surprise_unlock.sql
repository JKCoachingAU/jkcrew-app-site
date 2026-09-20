-- A separate, optional second Daily round. Tier 1 functions, progress and XP
-- are unchanged. Only a confirmed full Daily result can unlock today's round.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table private.daily_tier_two_templates (
  athlete_id uuid primary key references public.profiles(id) on delete cascade,
  items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items) between 1 and 20),
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now()
);
create table private.daily_tier_two_rounds (
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  local_date date not null,
  timezone text not null,
  source_candidate_id uuid not null,
  source_session_id uuid,
  venue text not null,
  source text not null check(source in ('daily_round_two','coach_template')),
  items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items) between 1 and 100),
  landed jsonb not null default '{}' check(jsonb_typeof(landed)='object'),
  unlocked_at timestamptz not null default now(),
  revealed_at timestamptz,
  completed_at timestamptz,
  points integer not null default 0 check(points in (0,4)),
  primary key(athlete_id,local_date),
  check((completed_at is null and points=0) or (completed_at is not null and points=4))
);
alter table private.daily_tier_two_templates enable row level security;
alter table private.daily_tier_two_rounds enable row level security;
revoke all on private.daily_tier_two_templates,private.daily_tier_two_rounds from public,anon,authenticated;

create function private.require_daily_tier_two_access(p_athlete_id uuid,p_write boolean default false)
returns void language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_daily_access(p_athlete_id,not p_write);
  if private.rider_features_disabled() then
    raise exception 'You don''t have access to this feature, contact your coach' using errcode='42501';
  end if;
  if not exists(select 1 from public.profiles where id=p_athlete_id and role::text='athlete') then
    raise exception 'Choose a rider account' using errcode='42501';
  end if;
end $$;
revoke all on function private.require_daily_tier_two_access(uuid,boolean) from public,anon,authenticated;

create function private.daily_tier_two_json(p_athlete_id uuid,p_local_date date)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare r private.daily_tier_two_rounds%rowtype; v_today date; v_tz text; v_date date; v_items jsonb; v_count integer; v_eligible boolean;
begin
  select public.jkcrew_country_timezone(country_code) into v_tz from public.profiles where id=p_athlete_id;
  v_today:=(now() at time zone v_tz)::date; v_date:=coalesce(p_local_date,v_today);
  select * into r from private.daily_tier_two_rounds where athlete_id=p_athlete_id and local_date=v_date;
  v_eligible:=exists(select 1 from private.daily_finish_candidates c where c.athlete_id=p_athlete_id and c.local_date=v_date
    and c.status='confirmed' and coalesce(c.completed_count,c.total_count)=c.total_count and c.total_count>0);
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

create function private.get_daily_tier_two(p_athlete_id uuid,p_local_date date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_daily_tier_two_access(p_athlete_id);
  return private.daily_tier_two_json(p_athlete_id,p_local_date);
end $$;
revoke all on function private.get_daily_tier_two(uuid,date) from public,anon;
grant execute on function private.get_daily_tier_two(uuid,date) to authenticated;
create function public.get_daily_tier_two(p_athlete_id uuid,p_local_date date default null)
returns jsonb language sql stable security invoker set search_path='' as $$select private.get_daily_tier_two(p_athlete_id,p_local_date);$$;
revoke all on function public.get_daily_tier_two(uuid,date) from public,anon;
grant execute on function public.get_daily_tier_two(uuid,date) to authenticated;

create function private.unlock_daily_tier_two(p_athlete_id uuid)
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
  select * into c from private.daily_finish_candidates where athlete_id=p_athlete_id and local_date=v_date and status='confirmed'
    and coalesce(completed_count,total_count)=total_count and total_count>0 order by confirmed_at,id limit 1;
  if c.id is null then return private.daily_tier_two_json(p_athlete_id,v_date); end if;
  select items into v_items from private.daily_tier_two_templates where athlete_id=p_athlete_id;
  if v_items is not null then v_source:='coach_template';
  else
    v_list:=private.daily_list_state(p_athlete_id,c.venue,v_date);
    -- Do not silently substitute a sheet edited after the qualifying finish.
    if v_list->>'list_signature' is distinct from c.list_signature then
      raise exception 'Your Daily list changed. Ask your coach to set your Round 2 challenge.' using errcode='22023';
    end if;
    select jsonb_agg(jsonb_build_object('trick_name',a.trick_name,'notes',coalesce(a.notes,'')) order by a.sort_order,a.id)
      into v_items from private.daily_list_rows(p_athlete_id,c.venue) a;
  end if;
  select jsonb_agg(item||jsonb_build_object('id',gen_random_uuid()) order by ordinal) into v_items
    from jsonb_array_elements(v_items) with ordinality rows(item,ordinal);
  insert into private.daily_tier_two_rounds(athlete_id,local_date,timezone,source_candidate_id,source_session_id,venue,source,items)
    values(p_athlete_id,v_date,v_tz,c.id,c.session_id,c.venue,v_source,v_items);
  return private.daily_tier_two_json(p_athlete_id,v_date);
end $$;
revoke all on function private.unlock_daily_tier_two(uuid) from public,anon;
grant execute on function private.unlock_daily_tier_two(uuid) to authenticated;
create function public.unlock_daily_tier_two(p_athlete_id uuid)
returns jsonb language sql security invoker set search_path='' as $$select private.unlock_daily_tier_two(p_athlete_id);$$;
revoke all on function public.unlock_daily_tier_two(uuid) from public,anon;
grant execute on function public.unlock_daily_tier_two(uuid) to authenticated;

create function private.claim_daily_tier_two_reveal(p_athlete_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_date date; v_claimed boolean:=false;
begin
  perform private.require_daily_tier_two_access(p_athlete_id,true);
  if auth.uid()<>p_athlete_id then raise exception 'Only the rider can open their surprise' using errcode='42501'; end if;
  perform 1 from public.profiles where id=p_athlete_id for update;
  select (now() at time zone public.jkcrew_country_timezone(country_code))::date into v_date from public.profiles where id=p_athlete_id;
  update private.daily_tier_two_rounds set revealed_at=now() where athlete_id=p_athlete_id and local_date=v_date and revealed_at is null;
  v_claimed:=found;
  return private.daily_tier_two_json(p_athlete_id,v_date)||jsonb_build_object('reveal_claimed',v_claimed);
end $$;
revoke all on function private.claim_daily_tier_two_reveal(uuid) from public,anon;
grant execute on function private.claim_daily_tier_two_reveal(uuid) to authenticated;
create function public.claim_daily_tier_two_reveal(p_athlete_id uuid)
returns jsonb language sql security invoker set search_path='' as $$select private.claim_daily_tier_two_reveal(p_athlete_id);$$;
revoke all on function public.claim_daily_tier_two_reveal(uuid) from public,anon;
grant execute on function public.claim_daily_tier_two_reveal(uuid) to authenticated;

create function private.record_daily_tier_two_trick(p_athlete_id uuid,p_item_id uuid,p_landed boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.daily_tier_two_rounds%rowtype; v_date date; v_item jsonb; v_history_id text;
begin
  perform private.require_daily_tier_two_access(p_athlete_id,true);
  perform 1 from public.profiles where id=p_athlete_id for update;
  select (now() at time zone public.jkcrew_country_timezone(country_code))::date into v_date from public.profiles where id=p_athlete_id;
  select * into r from private.daily_tier_two_rounds where athlete_id=p_athlete_id and local_date=v_date for update;
  if r.athlete_id is null then raise exception 'Complete your Daily list to unlock Round 2' using errcode='42501'; end if;
  if r.completed_at is not null then return private.daily_tier_two_json(p_athlete_id,v_date); end if;
  if p_landed is null then raise exception 'Choose landed or not landed' using errcode='22023'; end if;
  if p_landed and private.rider_scoring_paused(p_athlete_id) then raise exception 'Scoring is paused for this rider. Contact your coach.' using errcode='42501'; end if;
  select item into v_item from jsonb_array_elements(r.items) item where item->>'id'=p_item_id::text;
  if v_item is null then raise exception 'This trick is not in today''s Round 2' using errcode='22023'; end if;
  update private.daily_tier_two_rounds set landed=jsonb_set(landed,array[p_item_id::text],to_jsonb(p_landed)) where athlete_id=p_athlete_id and local_date=v_date;
  v_history_id:='daily-tier-two:'||p_athlete_id::text||':'||v_date::text||':'||p_item_id::text;
  if p_landed then
    insert into public.tricktionary_landing_history(id,assignment_id,athlete_id,trick_name,category,notes,venue,landed_at,landing_date,landed_count,evidence_type)
      values(v_history_id,null,p_athlete_id,v_item->>'trick_name','daily_tier_two',coalesce(v_item->>'notes',''),r.venue,now(),v_date,1,'daily_tier_two')
      on conflict(id) do update set landed_count=1,evidence_type='daily_tier_two',landed_at=case when tricktionary_landing_history.landed_count=0 then excluded.landed_at else tricktionary_landing_history.landed_at end;
  else update public.tricktionary_landing_history set landed_count=0,evidence_type='revoked' where id=v_history_id;
  end if;
  return private.daily_tier_two_json(p_athlete_id,v_date);
end $$;
revoke all on function private.record_daily_tier_two_trick(uuid,uuid,boolean) from public,anon;
grant execute on function private.record_daily_tier_two_trick(uuid,uuid,boolean) to authenticated;
create function public.record_daily_tier_two_trick(p_athlete_id uuid,p_item_id uuid,p_landed boolean)
returns jsonb language sql security invoker set search_path='' as $$select private.record_daily_tier_two_trick(p_athlete_id,p_item_id,p_landed);$$;
revoke all on function public.record_daily_tier_two_trick(uuid,uuid,boolean) from public,anon;
grant execute on function public.record_daily_tier_two_trick(uuid,uuid,boolean) to authenticated;

-- Only this new reward prefix is protected. Ordinary scoring and coach
-- adjustments retain their existing rules; direct REST writes have no policy.
-- The guard also rejects a forged prefix through an unrelated definer RPC.
create function private.guard_daily_tier_two_award()
returns trigger language plpgsql security definer set search_path='' as $$
declare r private.daily_tier_two_rounds%rowtype; v_old_key text; v_new_key text;
begin
  if tg_op<>'INSERT' then v_old_key:=old.award_key; end if;
  if tg_op<>'DELETE' then v_new_key:=new.award_key; end if;
  if coalesce(v_old_key,'') not like 'daily-tier-two:%' and coalesce(v_new_key,'') not like 'daily-tier-two:%' then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if tg_op='DELETE' and not exists(select 1 from public.profiles where id=old.athlete_id) then return old; end if;
  if tg_op<>'INSERT' then raise exception 'Saved Tier 2 rewards are immutable; use a coach points adjustment for corrections' using errcode='42501'; end if;
  perform private.require_daily_tier_two_access(new.athlete_id,true);
  select * into r from private.daily_tier_two_rounds where athlete_id=new.athlete_id and 'daily-tier-two:'||local_date::text=new.award_key;
  if r.athlete_id is null or r.completed_at is null or r.points<>4 or new.points<>4
    or new.assignment_id is not null or new.session_id is not null or new.venue is distinct from r.venue
    or new.created_at is distinct from r.completed_at
    or exists(select 1 from jsonb_array_elements(r.items) item where not coalesce((r.landed->>(item->>'id'))::boolean,false)) then
    raise exception 'Tier 2 points require a completed, saved round' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function private.guard_daily_tier_two_award() from public,anon,authenticated;
create trigger zz_guard_daily_tier_two_award before insert or update or delete on public.assignment_point_awards
for each row execute function private.guard_daily_tier_two_award();

create function private.complete_daily_tier_two(p_athlete_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.daily_tier_two_rounds%rowtype; v_date date; v_award uuid;
begin
  perform private.require_daily_tier_two_access(p_athlete_id,true);
  perform 1 from public.profiles where id=p_athlete_id for update;
  select (now() at time zone public.jkcrew_country_timezone(country_code))::date into v_date from public.profiles where id=p_athlete_id;
  select * into r from private.daily_tier_two_rounds where athlete_id=p_athlete_id and local_date=v_date for update;
  if r.athlete_id is null then raise exception 'Complete your Daily list to unlock Round 2' using errcode='42501'; end if;
  if r.completed_at is not null then return private.daily_tier_two_json(p_athlete_id,v_date)||jsonb_build_object('points_awarded',0); end if;
  if private.rider_scoring_paused(p_athlete_id) then raise exception 'Scoring is paused for this rider. Contact your coach.' using errcode='42501'; end if;
  if exists(select 1 from jsonb_array_elements(r.items) item where not coalesce((r.landed->>(item->>'id'))::boolean,false)) then
    raise exception 'Land every Round 2 trick before completing the round' using errcode='22023';
  end if;
  -- No venue or session in the reward identity: exactly four points for the
  -- rider's whole local day. A private snapshot remains the idempotency record.
  -- NULL session/assignment keeps this earned reward after sheet replacement.
  -- Both writes commit together. The source-specific ledger guard requires this
  -- completed snapshot; an award failure rolls the snapshot back as well.
  update private.daily_tier_two_rounds set completed_at=now(),points=4 where athlete_id=p_athlete_id and local_date=v_date;
  perform set_config('jkcrew.venue',r.venue,true);
  insert into public.assignment_point_awards(athlete_id,assignment_id,session_id,award_key,points,venue)
    values(p_athlete_id,null,null,'daily-tier-two:'||v_date::text,4,r.venue)
    on conflict(athlete_id,award_key) do nothing returning id into v_award;
  if v_award is null then
    raise exception 'Round 2 reward already exists. Ask your coach to check the saved result.' using errcode='22023';
  end if;
  return private.daily_tier_two_json(p_athlete_id,v_date)||jsonb_build_object('points_awarded',4);
end $$;
revoke all on function private.complete_daily_tier_two(uuid) from public,anon;
grant execute on function private.complete_daily_tier_two(uuid) to authenticated;
create function public.complete_daily_tier_two(p_athlete_id uuid)
returns jsonb language sql security invoker set search_path='' as $$select private.complete_daily_tier_two(p_athlete_id);$$;
revoke all on function public.complete_daily_tier_two(uuid) from public,anon;
grant execute on function public.complete_daily_tier_two(uuid) to authenticated;

create function private.daily_tier_two_template(p_athlete_id uuid,p_items jsonb,p_save boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_items jsonb; v_item jsonb; v_name text; v_note text;
begin
  perform private.require_daily_tier_two_access(p_athlete_id,true);
  if auth.uid()=p_athlete_id or not exists(select 1 from public.profiles where id=auth.uid() and role::text in ('coach','admin')) then
    raise exception 'Only a linked coach can manage Round 2 challenges' using errcode='42501';
  end if;
  if p_save then
    perform 1 from public.profiles where id=p_athlete_id for update;
    if p_items is null then delete from private.daily_tier_two_templates where athlete_id=p_athlete_id;
    else
      if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Add a list of Round 2 tricks' using errcode='22023'; end if;
      if jsonb_array_length(p_items) not between 1 and 20 then raise exception 'Add between 1 and 20 Round 2 tricks' using errcode='22023'; end if;
      v_items:='[]';
      for v_item in select * from jsonb_array_elements(p_items) loop
        v_name:=btrim(coalesce(v_item->>'trick_name','')); v_note:=btrim(coalesce(v_item->>'notes',''));
        if length(v_name) not between 1 and 120 or length(v_note)>180 or v_name ~ '[[:cntrl:]]' or v_note ~ '[[:cntrl:]]' then
          raise exception 'Use a trick name up to 120 characters and notes up to 180 characters' using errcode='22023';
        end if;
        v_items:=v_items||jsonb_build_array(jsonb_build_object('trick_name',v_name,'notes',v_note));
      end loop;
      insert into private.daily_tier_two_templates(athlete_id,items,updated_by) values(p_athlete_id,v_items,auth.uid())
        on conflict(athlete_id) do update set items=excluded.items,updated_by=excluded.updated_by,updated_at=now();
    end if;
  end if;
  return jsonb_build_object('items',(select items from private.daily_tier_two_templates where athlete_id=p_athlete_id),'default_round',not exists(select 1 from private.daily_tier_two_templates where athlete_id=p_athlete_id));
end $$;
revoke all on function private.daily_tier_two_template(uuid,jsonb,boolean) from public,anon;
grant execute on function private.daily_tier_two_template(uuid,jsonb,boolean) to authenticated;
create function public.get_daily_tier_two_template(p_athlete_id uuid)
returns jsonb language sql security invoker set search_path='' as $$select private.daily_tier_two_template(p_athlete_id,null,false);$$;
create function public.set_daily_tier_two_template(p_athlete_id uuid,p_items jsonb default null)
returns jsonb language sql security invoker set search_path='' as $$select private.daily_tier_two_template(p_athlete_id,p_items,true);$$;
revoke all on function public.get_daily_tier_two_template(uuid),public.set_daily_tier_two_template(uuid,jsonb) from public,anon;
grant execute on function public.get_daily_tier_two_template(uuid),public.set_daily_tier_two_template(uuid,jsonb) to authenticated;
