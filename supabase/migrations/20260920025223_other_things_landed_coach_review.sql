-- Rider-reported landings earn nothing until a linked coach reviews them.
-- Existing Working On data, scoring functions and XP rules are unchanged.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.other_things_landed (
  id uuid primary key,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  trick_name text not null check (char_length(trick_name) between 1 and 120 and trick_name=btrim(trick_name) and trick_name !~ '[[:cntrl:]]'),
  note text not null default '' check (char_length(note)<=180 and note !~ '[[:cntrl:]]'),
  venue text not null default '' check (char_length(venue)<=120 and venue=btrim(venue) and venue !~ '[[:cntrl:]]'),
  status text not null default 'pending' check(status in ('pending','approved','declined')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewer_id uuid references public.profiles(id) on delete set null,
  reviewer_name text,
  points integer generated always as (case when status='approved' then 1 else 0 end) stored,
  check ((status='pending' and reviewed_at is null and reviewer_id is null and reviewer_name is null)
      or (status<>'pending' and reviewed_at is not null and reviewer_name is not null))
);
create index other_landed_rider_status_date on public.other_things_landed(athlete_id,status,submitted_at desc,id);
create index other_landed_reviewer on public.other_things_landed(reviewer_id) where reviewer_id is not null;
alter table public.other_things_landed enable row level security;
revoke all on public.other_things_landed from public,anon,authenticated;
grant select on public.other_things_landed to authenticated;
grant all on public.other_things_landed to service_role;

create function private.can_access_other_landed(p_athlete_id uuid,p_review boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and not private.rider_features_disabled() and exists(
    select 1 from public.profiles rider where rider.id=p_athlete_id and rider.role::text='athlete'
      and ((not p_review and rider.id=auth.uid()) or exists(
        select 1 from public.coach_athletes link join public.profiles coach on coach.id=link.coach_id
        where link.athlete_id=rider.id and link.coach_id=auth.uid() and coach.role::text in ('coach','admin')))
  );
$$;
revoke all on function private.can_access_other_landed(uuid,boolean) from public,anon;
grant execute on function private.can_access_other_landed(uuid,boolean) to authenticated;
create policy other_landed_read on public.other_things_landed for select to authenticated
using (private.can_access_other_landed(athlete_id));

create function private.get_other_things_landed(p_athlete_id uuid,p_limit integer,p_offset integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_items jsonb; v_review boolean; v_paused boolean;
begin
  if not private.can_access_other_landed(p_athlete_id) then raise exception 'You do not have access to these landings' using errcode='42501'; end if;
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset<0 then raise exception 'Choose a valid page of landings' using errcode='22023'; end if;
  v_review:=private.can_access_other_landed(p_athlete_id,true);
  v_paused:=private.rider_scoring_paused(p_athlete_id);
  select coalesce(jsonb_agg(to_jsonb(page) order by (page.status='pending') desc,page.submitted_at desc,page.id),'[]') into v_items
  from (select * from public.other_things_landed where athlete_id=p_athlete_id
    order by (status='pending') desc,submitted_at desc,id limit p_limit offset p_offset) page;
  return jsonb_build_object('items',v_items,'total_count',(select count(*) from public.other_things_landed where athlete_id=p_athlete_id),
    'pending_count',(select count(*) from public.other_things_landed where athlete_id=p_athlete_id and status='pending'),
    'can_review',v_review,'can_submit',p_athlete_id=auth.uid() and not v_paused,'scoring_paused',v_paused);
end $$;
revoke all on function private.get_other_things_landed(uuid,integer,integer) from public,anon;
grant execute on function private.get_other_things_landed(uuid,integer,integer) to authenticated;
create function public.get_other_things_landed(p_athlete_id uuid,p_limit integer default 50,p_offset integer default 0)
returns jsonb language sql stable security invoker set search_path='' as $$select private.get_other_things_landed(p_athlete_id,p_limit,p_offset);$$;
revoke all on function public.get_other_things_landed(uuid,integer,integer) from public,anon;
grant execute on function public.get_other_things_landed(uuid,integer,integer) to authenticated;

create function private.submit_other_things_landed(p_entries jsonb,p_venue text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_entry jsonb; v_id uuid; v_name text; v_note text;
  v_venue text:=btrim(coalesce(p_venue,'')); v_row public.other_things_landed%rowtype; v_items jsonb:='[]';
begin
  if not private.can_access_other_landed(v_actor) then raise exception 'Only riders can submit their own landings' using errcode='42501'; end if;
  perform 1 from public.profiles where id=v_actor for update;
  if jsonb_typeof(p_entries) is distinct from 'array' then raise exception 'Add between 1 and 10 tricks' using errcode='22023'; end if;
  if jsonb_array_length(p_entries) not between 1 and 10 then raise exception 'Add between 1 and 10 tricks' using errcode='22023'; end if;
  if char_length(v_venue)>120 or v_venue ~ '[[:cntrl:]]' then raise exception 'Venue must be 120 characters or fewer' using errcode='22023'; end if;
  if (select count(distinct item->>'id') from jsonb_array_elements(p_entries) item)<>jsonb_array_length(p_entries) then raise exception 'Each trick needs its own submission ID' using errcode='22023'; end if;
  for v_entry in select * from jsonb_array_elements(p_entries) loop
    if jsonb_typeof(v_entry)<>'object' or jsonb_typeof(v_entry->'id') is distinct from 'string'
      or jsonb_typeof(v_entry->'trick_name') is distinct from 'string'
      or (v_entry ? 'note' and jsonb_typeof(v_entry->'note') is distinct from 'string')
      or exists(select 1 from jsonb_object_keys(v_entry) key where key not in ('id','trick_name','note')) then
      raise exception 'Each entry needs a trick name and an optional short note' using errcode='22023';
    end if;
    begin v_id:=(v_entry->>'id')::uuid; exception when invalid_text_representation then raise exception 'Invalid submission ID' using errcode='22023'; end;
    v_name:=btrim(v_entry->>'trick_name'); v_note:=btrim(coalesce(v_entry->>'note',''));
    if char_length(v_name) not between 1 and 120 or v_name ~ '[[:cntrl:]]' then raise exception 'Trick names must be 1–120 characters' using errcode='22023'; end if;
    if char_length(v_note)>180 or v_note ~ '[[:cntrl:]]' then raise exception 'Notes must be 180 characters or fewer' using errcode='22023'; end if;
    select * into v_row from public.other_things_landed where id=v_id;
    if found then
      if v_row.athlete_id<>v_actor then raise exception 'That submission ID is unavailable' using errcode='42501'; end if;
      if (v_row.trick_name,v_row.note,v_row.venue) is distinct from (v_name,v_note,v_venue) then raise exception 'This submission was already saved with different details. Refresh to see it' using errcode='22023'; end if;
    else
      if private.rider_scoring_paused(v_actor) then raise exception 'Trick scoring is paused for this rider. Contact your coach.' using errcode='42501'; end if;
      insert into public.other_things_landed(id,athlete_id,trick_name,note,venue)
      values(v_id,v_actor,v_name,v_note,v_venue) returning * into v_row;
    end if;
    v_items:=v_items||jsonb_build_array(to_jsonb(v_row));
  end loop;
  return jsonb_build_object('items',v_items);
end $$;
revoke all on function private.submit_other_things_landed(jsonb,text) from public,anon;
grant execute on function private.submit_other_things_landed(jsonb,text) to authenticated;
create function public.submit_other_things_landed(p_entries jsonb,p_venue text default '')
returns jsonb language sql security invoker set search_path='' as $$select private.submit_other_things_landed(p_entries,p_venue);$$;
revoke all on function public.submit_other_things_landed(jsonb,text) from public,anon;
grant execute on function public.submit_other_things_landed(jsonb,text) to authenticated;

-- Existing clients can reach the general point ledger. Protect only this new
-- source prefix, so no direct API write can forge, move, change or remove its point.
create function private.guard_other_landed_award()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_submission public.other_things_landed%rowtype;
begin
  if tg_op<>'INSERT' and old.award_key like 'other-landed:%' then
    -- Permit the existing profile-deletion cascade; never block account removal.
    if tg_op='DELETE' and not exists(select 1 from public.profiles where id=old.athlete_id) then return old; end if;
    raise exception 'Reviewed Other Things Landed points cannot be changed directly' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; end if;
  if new.award_key not like 'other-landed:%' then return new; end if;
  select * into v_submission from public.other_things_landed where 'other-landed:'||id::text=new.award_key and status='approved';
  if tg_op<>'INSERT' or v_submission.id is null or new.id<>v_submission.id or new.athlete_id<>v_submission.athlete_id
    or new.points<>1 or new.assignment_id is not null or new.session_id is not null
    or new.venue is distinct from v_submission.venue or new.created_at is distinct from v_submission.reviewed_at then
    raise exception 'Approve the submitted trick to award its point' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function private.guard_other_landed_award() from public,anon,authenticated;
create trigger zz_guard_other_landed_award before insert or update or delete on public.assignment_point_awards
for each row execute function private.guard_other_landed_award();

create function private.review_other_thing_landed(p_submission_id uuid,p_decision text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.other_things_landed%rowtype; v_actor uuid:=auth.uid(); v_name text; v_time timestamptz; v_zone text;
begin
  select * into v_row from public.other_things_landed where id=p_submission_id;
  if v_row.id is null or not private.can_access_other_landed(v_row.athlete_id,true) then raise exception 'Only a linked coach can review this landing' using errcode='42501'; end if;
  if p_decision is null or p_decision not in ('approved','declined') then raise exception 'Choose Approve or Decline' using errcode='22023'; end if;
  -- Same rider lock as scoring-pause changes. Recheck the live relationship while
  -- holding its row, then serialize both coaches on the submitted item.
  perform 1 from public.profiles where id=v_row.athlete_id for update;
  perform 1 from public.coach_athletes where athlete_id=v_row.athlete_id and coach_id=v_actor for share;
  if not found or not private.can_access_other_landed(v_row.athlete_id,true) then raise exception 'Only a linked coach can review this landing' using errcode='42501'; end if;
  select * into v_row from public.other_things_landed where id=p_submission_id for update;
  if v_row.status<>'pending' then return jsonb_build_object('item',to_jsonb(v_row),'already_reviewed',true); end if;
  if p_decision='approved' and private.rider_scoring_paused(v_row.athlete_id) then raise exception 'Trick scoring is paused for this rider. Contact your coach.' using errcode='42501'; end if;
  select coalesce(nullif(btrim(display_name),''),'Coach') into v_name from public.profiles where id=v_actor;
  v_time:=clock_timestamp();
  update public.other_things_landed set status=p_decision,reviewer_id=v_actor,reviewer_name=v_name,reviewed_at=v_time
    where id=v_row.id returning * into v_row;
  if p_decision='approved' then
    -- Clear inherited venue hints; this review uses the rider's recorded venue.
    perform set_config('jkcrew.venue',v_row.venue,true);
    insert into public.assignment_point_awards(id,athlete_id,award_key,points,venue,created_at)
    values(v_row.id,v_row.athlete_id,'other-landed:'||v_row.id::text,1,v_row.venue,v_time);
    select public.jkcrew_country_timezone(country_code) into v_zone from public.profiles where id=v_row.athlete_id;
    insert into public.tricktionary_landing_history(id,athlete_id,trick_name,category,notes,venue,landed_at,landing_date,landed_count,evidence_type)
    values('other-landed:'||v_row.id::text,v_row.athlete_id,v_row.trick_name,'other','',v_row.venue,v_row.submitted_at,
      (v_row.submitted_at at time zone v_zone)::date,1,'coach_approved_other');
  end if;
  return jsonb_build_object('item',to_jsonb(v_row),'already_reviewed',false);
end $$;
revoke all on function private.review_other_thing_landed(uuid,text) from public,anon;
grant execute on function private.review_other_thing_landed(uuid,text) to authenticated;
create function public.review_other_thing_landed(p_submission_id uuid,p_decision text)
returns jsonb language sql security invoker set search_path='' as $$select private.review_other_thing_landed(p_submission_id,p_decision);$$;
revoke all on function public.review_other_thing_landed(uuid,text) from public,anon;
grant execute on function public.review_other_thing_landed(uuid,text) to authenticated;
-- Display labels only. Keep the current receipt's permissions, bounds, grouping,
-- legacy-session exclusion, adjustments and total calculation unchanged.
create or replace function private.points_receipt(p_athlete_id uuid, p_scope text default 'weekly')
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
 if p_scope not in ('weekly','all_time') then raise exception 'Invalid points period'; end if;
 if auth.uid() is null or not exists(
 select 1 from public.profiles me where me.id=auth.uid() and
 (me.id=p_athlete_id or (me.role in ('coach','admin') and exists(select 1 from public.coach_athletes c where c.coach_id=me.id and c.athlete_id=p_athlete_id))
 or (me.role='parent' and exists(select 1 from public.parent_athletes p where p.parent_id=me.id and p.athlete_id=p_athlete_id)))
 ) then raise exception 'Point receipts are private to the rider, their parent and their coach'; end if;
 with bounds as (
 select b.* from public.profiles p cross join lateral public.jkcrew_week_bounds(p.country_code) b where p.id=p_athlete_id
 ), events as (
 select a.points,case when a.award_key like 'other-landed:%' then 'Coach approved'
   when a.award_key like 'daily-tier-two:%' then 'Entire extra list completed' else coalesce(w.trick_name,'Training award') end as detail,
 case when a.award_key like 'other-landed:%' then 'Other Things Landed' when a.award_key like 'daily-tier-two:%' then 'Daily Tier 2'
   when w.category='bonus' then 'Bonus trick' when w.category='lines' then 'Line completed' else coalesce(w.category,'Training') end as label
 from public.assignment_point_awards a left join public.weekly_trick_assignments w on w.id=a.assignment_id cross join bounds b
 where a.athlete_id=p_athlete_id and (p_scope='all_time' or (a.created_at>=b.week_start_ts and a.created_at<b.next_week_start_ts))
 union all
 select a.points,case when a.reason ilike 'Weekly challenge %' then coalesce((select c.title from public.weekly_challenges c where a.reason like '%'||c.id::text||'%'),'Weekly challenge completed') when a.reason ilike '%battle%' then 'Battle point transfer' else coalesce(a.reason,'Coach adjustment') end,
 case when a.reason ilike 'Weekly challenge %' then 'Weekly challenge' when a.reason ilike '%battle%' then 'Battle result' when a.points<0 then 'Coach deduction' else 'Coach bonus' end
 from public.leaderboard_point_adjustments a cross join bounds b
 where a.athlete_id=p_athlete_id and (p_scope='all_time' or (a.week_start=b.week_start_date and coalesce(a.reason,'') not ilike 'All-time score correction%'))
 union all
 select s.total_points,'Training session','Training'
 from public.training_sessions s cross join bounds b where s.athlete_id=p_athlete_id and coalesce(s.total_points,0)<>0
 and not exists(select 1 from public.assignment_point_awards a where a.session_id=s.id)
 and (p_scope='all_time' or (s.started_at>=b.week_start_ts and s.started_at<b.next_week_start_ts))
 ), grouped as (select label,detail,sum(points)::bigint points,count(*) events from events group by label,detail)
 select jsonb_build_object('scope',p_scope,'raw_total',coalesce((select sum(points) from events),0),'total',greatest(0,coalesce((select sum(points) from events),0)),
 'rows',coalesce((select jsonb_agg(to_jsonb(g) order by label,detail) from grouped g),'[]'::jsonb)) into v_result;
 return v_result;
end $$;
notify pgrst,'reload schema';
