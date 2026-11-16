-- Purchasing teams are independent security cohorts. Country is display data,
-- never an authorization key. Existing coach-owned program teams are kept.
set local lock_timeout='5s';
set local statement_timeout='60s';

create table private.coach_team_memberships (
  coach_id uuid primary key references public.profiles(id) on delete cascade,
  team_id uuid not null references public.coach_teams(id),
  role text not null check(role in ('head_coach','coach','assistant_coach')),
  status text not null default 'active' check(status in ('active','revoked')),
  joined_at timestamptz not null default now()
);
create index coach_team_memberships_team_idx on private.coach_team_memberships(team_id,status,coach_id);
alter table private.coach_team_memberships enable row level security;
revoke all on private.coach_team_memberships from public,anon,authenticated;
insert into private.coach_team_memberships(coach_id,team_id,role)
select p.id,team.id,'head_coach'
from public.profiles p cross join lateral (
  select t.id from public.coach_teams t where t.coach_id=p.id and t.status='active'
  order by (select count(*) from public.coach_athletes c where c.team_id=t.id) desc,t.created_at,t.id limit 1
) team where p.role::text in ('coach','admin');

create table private.coach_team_invites (
  code_hash bytea primary key,
  team_id uuid not null references public.coach_teams(id),
  role text not null check(role in ('coach','assistant_coach','athlete','parent')),
  created_by uuid not null references public.profiles(id),
  expires_at timestamptz not null,
  consumed_by uuid references public.profiles(id),
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table private.coach_team_invites enable row level security;
revoke all on private.coach_team_invites from public,anon,authenticated;

create function private.jkcrew_actor_approved(p_actor uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p where p.id=p_actor and (
    p.role::text not in ('coach','admin') or p.is_platform_owner or exists(
      select 1 from private.coach_account_access access where access.coach_id=p.id and access.status='approved'
    )
  ));
$$;
create function private.jkcrew_user_team_ids(p_actor uuid)
returns table(team_id uuid) language sql stable security definer set search_path='' as $$
  select m.team_id from private.coach_team_memberships m where m.coach_id=p_actor and m.status='active'
  union
  select m.team_id from public.coach_athletes c join private.coach_team_memberships m on m.coach_id=c.coach_id and m.status='active' where c.athlete_id=p_actor
  union
  select m.team_id from public.parent_athletes p join public.coach_athletes c on c.athlete_id=p.athlete_id
    join private.coach_team_memberships m on m.coach_id=c.coach_id and m.status='active' where p.parent_id=p_actor
  union
  select m.team_id from auth.users u join private.coach_team_memberships m
    on m.coach_id=case when u.raw_app_meta_data->>'registered_coach_id' ~* '^[0-9a-f-]{36}$' then (u.raw_app_meta_data->>'registered_coach_id')::uuid else null end
    and m.status='active' where u.id=p_actor and exists(select 1 from public.profiles registered where registered.id=u.id and registered.role::text in ('athlete','parent'));
$$;
create function private.jkcrew_profile_team_id(p_actor uuid)
returns uuid language sql stable security definer set search_path='' as $$
  select min(team_id::text)::uuid from private.jkcrew_user_team_ids(p_actor);
$$;
create function private.jkcrew_profiles_share_team(p_first uuid,p_second uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select p_first is not null and p_second is not null and (p_first=p_second or exists(
    select 1 from private.jkcrew_user_team_ids(p_first) a join private.jkcrew_user_team_ids(p_second) b using(team_id)
  ));
$$;
create function private.jkcrew_same_team_profile(p_actor uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select private.jkcrew_actor_approved(auth.uid()) and private.jkcrew_profiles_share_team(auth.uid(),p_actor);
$$;
create function private.jkcrew_is_team_coach(p_coach uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select private.jkcrew_actor_approved(auth.uid())
    and exists(select 1 from public.profiles where id=auth.uid() and role::text in ('coach','admin'))
    and exists(select 1 from private.coach_team_memberships actor join private.coach_team_memberships target on target.team_id=actor.team_id where actor.coach_id=auth.uid() and actor.status='active' and target.coach_id=p_coach and target.status='active');
$$;
create function private.jkcrew_team_event_visible(p_event uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select private.jkcrew_actor_approved(auth.uid()) and exists(
    select 1 from public.dashboard_items e where e.id=p_event and e.item_type='event'
    and private.jkcrew_profiles_share_team(auth.uid(),e.owner_id) and (e.created_by is null or private.jkcrew_profiles_share_team(auth.uid(),e.created_by))
  );
$$;
create function private.jkcrew_team_battle_visible(p_battle uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select private.jkcrew_actor_approved(auth.uid())
    and exists(select 1 from public.weekly_rider_battle_participants p where p.battle_id=p_battle and private.jkcrew_profiles_share_team(auth.uid(),p.athlete_id))
    and not exists(select 1 from public.weekly_rider_battle_participants p where p.battle_id=p_battle and not private.jkcrew_profiles_share_team(auth.uid(),p.athlete_id));
$$;
revoke all on function private.jkcrew_actor_approved(uuid),private.jkcrew_user_team_ids(uuid),private.jkcrew_profile_team_id(uuid),private.jkcrew_profiles_share_team(uuid,uuid),private.jkcrew_same_team_profile(uuid),private.jkcrew_is_team_coach(uuid),private.jkcrew_team_event_visible(uuid),private.jkcrew_team_battle_visible(uuid) from public,anon;
grant execute on function private.jkcrew_actor_approved(uuid),private.jkcrew_user_team_ids(uuid),private.jkcrew_profile_team_id(uuid),private.jkcrew_profiles_share_team(uuid,uuid),private.jkcrew_same_team_profile(uuid),private.jkcrew_is_team_coach(uuid),private.jkcrew_team_event_visible(uuid),private.jkcrew_team_battle_visible(uuid) to authenticated,service_role;

create function private.seed_coach_team_membership()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into private.coach_team_memberships(coach_id,team_id,role) values(new.coach_id,new.id,'head_coach') on conflict(coach_id) do nothing;
  return new;
end;
$$;
revoke all on function private.seed_coach_team_membership() from public,anon,authenticated;
create trigger seed_coach_team_membership after insert on public.coach_teams
for each row execute function private.seed_coach_team_membership();

-- Additional restrictive guards close old global role-based policies without
-- widening the rider/parent permissions in the existing policies.
do $cohort_policies$
declare item record; predicate text;
begin
  for item in select c.table_name,array_agg(c.column_name)::text[] cols from information_schema.columns c
    where c.table_schema='public' group by c.table_name loop
    predicate:=null;
    if item.table_name='profiles' then predicate:='id=(select auth.uid()) or private.jkcrew_same_team_profile(id)';
    elsif item.table_name='dashboard_items' then predicate:='private.jkcrew_same_team_profile(owner_id) and (created_by is null or private.jkcrew_same_team_profile(created_by))';
    elsif item.table_name='weekly_challenges' then predicate:='private.jkcrew_same_team_profile(created_by)';
    elsif item.table_name='weekly_rider_battles' then predicate:='private.jkcrew_team_battle_visible(id)';
    elsif item.table_name='weekly_rider_battle_participants' then predicate:='private.jkcrew_team_battle_visible(battle_id)';
    elsif item.table_name='event_attendees' then predicate:='private.jkcrew_team_event_visible(event_id) and private.jkcrew_same_team_profile(athlete_id)';
    elsif item.table_name='event_course_photos' then predicate:='private.jkcrew_team_event_visible(event_id)';
    elsif item.table_name='crew_posts' then predicate:='private.jkcrew_same_team_profile(author_id)';
    elsif item.table_name in ('crew_post_reactions','crew_post_reports') then predicate:='exists(select 1 from public.crew_posts p where p.id=post_id)';
    elsif item.table_name='profile_showreels' then predicate:='private.jkcrew_same_team_profile(rider_id)';
    elsif 'athlete_id'=any(item.cols) then
      predicate:='private.jkcrew_same_team_profile(athlete_id)';
      if 'coach_id'=any(item.cols) then predicate:='(athlete_id is not null or coach_id is not null) and (athlete_id is null or private.jkcrew_same_team_profile(athlete_id)) and (coach_id is null or private.jkcrew_same_team_profile(coach_id))'; end if;
    elsif 'coach_id'=any(item.cols) then predicate:='private.jkcrew_same_team_profile(coach_id)';
    elsif 'owner_id'=any(item.cols) then predicate:='private.jkcrew_same_team_profile(owner_id)';
    end if;
    if predicate is not null then
      execute format('create policy team_privacy_guard on public.%I as restrictive for all to authenticated using (%s) with check (%s)',item.table_name,predicate,predicate);
    end if;
    -- Approved collaborators use the same records. The original coach/user
    -- predicates remain; this adds an explicit, bounded collaborator grant.
    if 'coach_id'=any(item.cols) and item.table_name not in ('coach_teams','coach_athletes','weekly_progress_notification_settings','coach_dismissed_tasks','push_preferences','push_subscriptions') then
      predicate:='private.jkcrew_is_team_coach(coach_id)';
      if 'athlete_id'=any(item.cols) then predicate:=predicate||' and (athlete_id is null or private.jkcrew_same_team_profile(athlete_id))'; end if;
      execute format('create policy approved_team_coach_access on public.%I for all to authenticated using (%s) with check (%s)',item.table_name,predicate,predicate);
    end if;
  end loop;
end $cohort_policies$;

create policy approved_team_coaches_read_registered_profiles on public.profiles for select to authenticated
using (role::text in ('athlete','parent') and private.jkcrew_is_team_coach(auth.uid()) and private.jkcrew_same_team_profile(id));
create policy approved_team_coaches_read_accounts on public.profiles for select to authenticated
using (role::text in ('coach','admin') and private.jkcrew_is_team_coach(id));

-- A coach cannot claim another club's rider, even with a known UUID. New
-- students can only be linked after server-controlled registration to that
-- coach, or when they already belong to this same purchasing team.
create or replace function private.validate_coach_team_membership()
returns trigger language plpgsql security definer set search_path='' as $$
declare actor_team uuid; expected_team uuid; registered_coach uuid;
begin
  actor_team:=private.jkcrew_profile_team_id(new.coach_id);
  if actor_team is null or not private.jkcrew_actor_approved(new.coach_id) then raise exception 'Approved team coach required.' using errcode='42501'; end if;
  if auth.uid() is not null and pg_trigger_depth()<=1 and not private.jkcrew_is_team_coach(new.coach_id) then raise exception 'Your team cannot change this rider link.' using errcode='42501'; end if;
  if exists(select 1 from public.coach_athletes link where link.athlete_id=new.athlete_id and private.jkcrew_profile_team_id(link.coach_id) is distinct from actor_team) then
    raise exception 'This rider belongs to another private team.' using errcode='42501';
  end if;
  if not exists(select 1 from public.coach_athletes link where link.athlete_id=new.athlete_id and private.jkcrew_profile_team_id(link.coach_id)=actor_team) then
    select case when raw_app_meta_data->>'registered_coach_id' ~* '^[0-9a-f-]{36}$' then (raw_app_meta_data->>'registered_coach_id')::uuid else null end
      into registered_coach from auth.users where id=new.athlete_id;
    if private.jkcrew_profile_team_id(registered_coach) is distinct from actor_team then raise exception 'This student needs a verified registration or team invitation.' using errcode='42501'; end if;
  end if;
  if new.team_id is null then new.team_id:=actor_team; end if;
  select private.jkcrew_profile_team_id(coach_id) into expected_team from public.coach_teams where id=new.team_id and status='active';
  if expected_team is distinct from actor_team then raise exception 'Choose a team within your approved account.' using errcode='42501'; end if;
  return new;
end;
$$;
revoke all on function private.validate_coach_team_membership() from public,anon,authenticated;

create function private.validate_team_parent_link()
returns trigger language plpgsql security definer set search_path='' as $$
declare parent_team uuid; athlete_team uuid;
begin
  parent_team:=private.jkcrew_profile_team_id(new.parent_id);
  athlete_team:=private.jkcrew_profile_team_id(new.athlete_id);
  if athlete_team is null or parent_team is distinct from athlete_team
    or private.jkcrew_profile_team_id(new.coach_id) is distinct from athlete_team
    or not private.jkcrew_actor_approved(new.coach_id)
    or (auth.uid() is not null and not private.jkcrew_is_team_coach(new.coach_id)) then
    raise exception 'Parent and rider must have verified registrations within your private team.' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_team_parent_link() from public,anon,authenticated;
create trigger validate_team_parent_link before insert or update on public.parent_athletes
for each row execute function private.validate_team_parent_link();

create function private.sync_approved_team_roster(p_team uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  insert into public.coach_athletes(coach_id,athlete_id,team_id,group_name)
  select distinct on(member.coach_id,source.athlete_id) member.coach_id,source.athlete_id,source.team_id,source.group_name
  from private.coach_team_memberships member
  join private.coach_team_memberships origin on origin.team_id=member.team_id and origin.status='active'
  join public.coach_athletes source on source.coach_id=origin.coach_id
  where member.team_id=p_team and member.status='active' and private.jkcrew_actor_approved(member.coach_id)
  order by member.coach_id,source.athlete_id,source.created_at,source.coach_id
  on conflict(coach_id,athlete_id) do nothing;
  insert into public.coach_athlete_groups(coach_id,athlete_id,group_name,membership_type,expires_at,notes)
  select distinct on(member.coach_id,source.athlete_id,source.group_name) member.coach_id,source.athlete_id,source.group_name,source.membership_type,source.expires_at,source.notes
  from private.coach_team_memberships member
  join private.coach_team_memberships origin on origin.team_id=member.team_id and origin.status='active'
  join public.coach_athlete_groups source on source.coach_id=origin.coach_id
  where member.team_id=p_team and member.status='active' and private.jkcrew_actor_approved(member.coach_id)
  order by member.coach_id,source.athlete_id,source.group_name,source.created_at,source.coach_id
  on conflict(coach_id,athlete_id,group_name) do nothing;
end;
$$;
revoke all on function private.sync_approved_team_roster(uuid) from public,anon,authenticated;

create function private.sync_team_roster_change()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if pg_trigger_depth()>1 then return new; end if;
  perform private.sync_approved_team_roster(private.jkcrew_profile_team_id(new.coach_id));
  return new;
end;
$$;
revoke all on function private.sync_team_roster_change() from public,anon,authenticated;
create trigger sync_team_roster_change after insert or update on public.coach_athletes
for each row execute function private.sync_team_roster_change();
create trigger sync_team_groups_change after insert or update on public.coach_athlete_groups
for each row execute function private.sync_team_roster_change();
create trigger sync_team_access_change after insert or update on private.coach_account_access
for each row execute function private.sync_team_roster_change();

create or replace function public.get_my_team_access()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me public.profiles; member private.coach_team_memberships; team public.coach_teams; approval text; coaches jsonb:='[]'::jsonb;
begin
  select * into me from public.profiles where id=auth.uid();
  if me.id is null or me.role::text not in ('coach','admin') then raise exception 'Coach sign-in required.' using errcode='42501'; end if;
  select * into member from private.coach_team_memberships where coach_id=me.id and status='active';
  select * into team from public.coach_teams where id=member.team_id;
  select status into approval from private.coach_account_access where coach_id=me.id;
  if me.is_platform_owner then approval:='approved'; end if;
  if approval='approved' then
    select coalesce(jsonb_agg(jsonb_build_object('coach_id',p.id,'display_name',p.display_name,'role',m.role) order by m.joined_at,p.id),'[]'::jsonb) into coaches
    from private.coach_team_memberships m join public.profiles p on p.id=m.coach_id
    where m.team_id=member.team_id and m.status='active' and private.jkcrew_actor_approved(m.coach_id);
  end if;
  return jsonb_build_object('approval_status',coalesce(approval,'pending'),'team',case when team.id is null then null else jsonb_build_object('id',team.id,'name',team.name,'country_code',team.country_code,'country_name',team.country_name,'role',member.role) end,'coaches',coaches,'can_invite',approval='approved' and member.role='head_coach');
end;
$$;
revoke all on function public.get_my_team_access() from public,anon;
grant execute on function public.get_my_team_access() to authenticated;

create function public.create_team_coach_invite(p_role text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare member private.coach_team_memberships; code text; expiry timestamptz:=now()+interval '7 days';
begin
  perform private.require_coach_approval();
  select * into member from private.coach_team_memberships where coach_id=auth.uid() and status='active' and role='head_coach';
  if member.coach_id is null then raise exception 'Only an approved head coach can invite team coaches.' using errcode='42501'; end if;
  if p_role not in ('coach','assistant_coach') then raise exception 'Choose coach or assistant coach.' using errcode='22023'; end if;
  code:=upper(replace(gen_random_uuid()::text,'-',''));
  insert into private.coach_team_invites(code_hash,team_id,role,created_by,expires_at)
  values(sha256(convert_to(code,'UTF8')),member.team_id,p_role,auth.uid(),expiry);
  return jsonb_build_object('code',code,'expires_at',expiry,'role',p_role);
end;
$$;
revoke all on function public.create_team_coach_invite(text) from public,anon;
grant execute on function public.create_team_coach_invite(text) to authenticated;

create function private.accept_team_coach_invite(p_coach uuid,p_code text,p_requested_role text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare invitation private.coach_team_invites; current_team uuid; team public.coach_teams;
begin
  if not exists(select 1 from public.profiles where id=p_coach and role::text in ('coach','admin')) then raise exception 'Coach account required.' using errcode='42501'; end if;
  if p_requested_role not in ('coach','assistant_coach') or upper(btrim(p_code)) !~ '^[0-9A-F]{32}$' then raise exception 'That team invitation is invalid or expired.' using errcode='42501'; end if;
  select * into invitation from private.coach_team_invites where code_hash=sha256(convert_to(upper(btrim(p_code)),'UTF8')) for update;
  if invitation.team_id is null or invitation.consumed_at is not null or invitation.expires_at<=now() or invitation.role<>p_requested_role or not private.jkcrew_actor_approved(invitation.created_by)
    or not exists(select 1 from private.coach_team_memberships inviter where inviter.coach_id=invitation.created_by and inviter.team_id=invitation.team_id and inviter.status='active' and inviter.role='head_coach') then
    raise exception 'That team invitation is invalid or expired.' using errcode='42501';
  end if;
  select team_id into current_team from private.coach_team_memberships where coach_id=p_coach;
  if current_team is distinct from invitation.team_id and private.jkcrew_coach_has_team_data(p_coach) then
    raise exception 'An account with an existing rider team cannot merge into another team.' using errcode='42501';
  end if;
  if exists(select 1 from public.profiles where id=p_coach and is_platform_owner) then raise exception 'The platform owner keeps their own coaching team separate.' using errcode='42501'; end if;
  update private.coach_team_memberships set team_id=invitation.team_id,role=invitation.role,status='active',joined_at=now() where coach_id=p_coach;
  if not found then insert into private.coach_team_memberships(coach_id,team_id,role) values(p_coach,invitation.team_id,invitation.role); end if;
  update private.coach_team_invites set consumed_by=p_coach,consumed_at=now() where code_hash=invitation.code_hash;
  select * into team from public.coach_teams where id=invitation.team_id;
  perform private.sync_approved_team_roster(invitation.team_id);
  return jsonb_build_object('status','active','approval_status',coalesce((select status from private.coach_account_access where coach_id=p_coach),'pending'),'team',jsonb_build_object('id',team.id,'name',team.name,'country_code',team.country_code,'country_name',team.country_name,'role',invitation.role),'role',invitation.role);
end;
$$;
revoke all on function private.accept_team_coach_invite(uuid,text,text) from public,anon,authenticated;

create function public.join_team_coach(p_code text,p_requested_role text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.require_coach_approval();
  return private.accept_team_coach_invite(auth.uid(),p_code,p_requested_role);
end;
$$;
revoke all on function public.join_team_coach(text,text) from public,anon;
grant execute on function public.join_team_coach(text,text) to authenticated;

-- Only the authenticated account-creation Edge Function may finalize a newly
-- registered coach. Its input role is a request; an invite grants its fixed role.
create function public.initialize_registered_coach(p_coach_id uuid,p_team_role text,p_team_name text,p_invite_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare member private.coach_team_memberships;
begin
  if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'Server account registration required.' using errcode='42501'; end if;
  if p_team_role='head_coach' then
    if char_length(btrim(p_team_name)) not between 1 and 80 then raise exception 'Add a team name.' using errcode='22023'; end if;
    select * into member from private.coach_team_memberships where coach_id=p_coach_id and role='head_coach';
    if member.coach_id is null or exists(select 1 from public.coach_athletes where coach_id=p_coach_id) then raise exception 'New head-coach registration required.' using errcode='42501'; end if;
    update public.coach_teams t set name=btrim(p_team_name),country_code=p.country_code,country_name=p.country_name from public.profiles p where t.id=member.team_id and p.id=p_coach_id;
    return jsonb_build_object('approval_status','pending','role','head_coach');
  end if;
  return private.accept_team_coach_invite(p_coach_id,p_invite_code,p_team_role);
end;
$$;
revoke all on function public.initialize_registered_coach(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.initialize_registered_coach(uuid,text,text,text) to service_role;

-- Guard arbitrary resource IDs before calling the existing privileged
-- implementations. Owner approval never grants access to another cohort.
do $rpc_cohort_guards$
declare fn record; impl text; inputs text; outputs text; body text; guards text; arg text; i integer; expr text; volatility text;
begin
  for fn in select p.*,pg_get_function_arguments(p.oid) arguments,pg_get_function_identity_arguments(p.oid) identity_arguments,pg_get_function_result(p.oid) result
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f' and p.provolatile<>'i'
      and p.prorettype not in ('trigger'::regtype,'event_trigger'::regtype)
      and has_function_privilege('authenticated',p.oid,'EXECUTE')
      and p.proname not in ('ensure_current_profile','jkcrew_check_rider_feature_access','get_platform_coach_overview','set_coach_access','get_my_team_access')
  loop
    impl:='approved_'||substr(md5(fn.proname||'('||fn.identity_arguments||')'),1,24);
    if to_regprocedure('private.'||impl||'('||oidvectortypes(fn.proargtypes)||')') is null then continue; end if;
    guards:='';
    for i in 1..fn.pronargs loop
      arg:=fn.proargnames[i]; expr:=null;
      if fn.proargtypes[i-1]='uuid'::regtype then
        if arg in ('p_athlete_id','p_rider_id','p_opponent_id') then expr:=format('private.jkcrew_same_team_profile($%s)',i);
        elsif arg in ('p_event_id','p_source_event_id','p_target_event_id') then expr:=format('private.jkcrew_team_event_visible($%s)',i);
        elsif arg='p_battle_id' then expr:=format('private.jkcrew_team_battle_visible($%s)',i);
        elsif arg='p_coach_id' then expr:=format('private.jkcrew_is_team_coach($%s)',i);
        elsif arg='p_assignment_id' then expr:=format('exists(select 1 from public.weekly_trick_assignments a where a.id=$%s and private.jkcrew_same_team_profile(a.athlete_id))',i);
        elsif arg='p_request_id' and fn.proname not like 'live_run%' and fn.proname<>'save_recovery_checkin' then expr:=format('exists(select 1 from public.trick_requests r where r.id=$%s and private.jkcrew_same_team_profile(r.athlete_id))',i);
        elsif arg='p_proposal_id' then expr:=format('exists(select 1 from public.rider_sheet_proposals r where r.id=$%s and private.jkcrew_same_team_profile(r.athlete_id))',i);
        elsif arg='p_submission_id' then expr:=format('exists(select 1 from public.other_things_landed r where r.id=$%s and private.jkcrew_same_team_profile(r.athlete_id))',i);
        elsif arg='p_run_id' then expr:=format('exists(select 1 from public.run_plans r where r.id=$%s and private.jkcrew_same_team_profile(r.athlete_id))',i);
        elsif arg='p_group_session_id' then expr:=format('exists(select 1 from public.coach_group_sessions r where r.id=$%s and private.jkcrew_is_team_coach(r.coach_id))',i);
        elsif arg='p_session_id' and fn.proname like '%live_run%' then expr:=format('exists(select 1 from public.run_live_sessions r where r.id=$%s and private.jkcrew_same_team_profile(r.athlete_id))',i);
        elsif arg='p_session_id' then expr:=format('exists(select 1 from public.training_sessions r where r.id=$%s and private.jkcrew_same_team_profile(r.athlete_id))',i);
        elsif arg='p_broadcast_id' then expr:=format('exists(select 1 from public.coach_broadcasts r where r.id=$%s and private.jkcrew_same_team_profile(r.coach_id))',i);
        elsif arg='p_candidate_id' then expr:=format('private.jkcrew_private_resource_visible(''daily_finish_candidates'',$%s)',i);
        elsif arg='p_episode_id' then expr:=format('private.jkcrew_private_resource_visible(''rider_recovery_episodes'',$%s)',i);
        elsif arg='p_block_id' then expr:=format('private.jkcrew_save_resource_allowed(''coach_training_blocks'',$%s,false)',i);
        elsif arg='p_id' and fn.proname='save_coach_training_block' then expr:=format('private.jkcrew_save_resource_allowed(''coach_training_blocks'',$%s,true)',i);
        elsif arg='p_id' and fn.proname in ('save_coach_tracked_session','save_coach_tracked_session_v2','save_coach_tracked_session_v3','archive_coach_tracked_session') then expr:=format('private.jkcrew_save_resource_allowed(''coach_tracked_sessions'',$%s,%L)',i,fn.proname<>'archive_coach_tracked_session');
        end if;
        if expr is not null then guards:=guards||format('if $%s is not null and not (%s) then raise exception ''This record belongs to another private team.'' using errcode=''42501''; end if; ',i,expr); end if;
      elsif fn.proargtypes[i-1]='uuid[]'::regtype and arg='p_session_ids' then
        guards:=guards||format('if not private.jkcrew_session_ids_allowed($%s) then raise exception ''These sessions belong to another private team.'' using errcode=''42501''; end if; ',i);
      elsif fn.proargtypes[i-1]='uuid[]'::regtype and arg in ('p_team_one','p_team_two','p_team_three','p_athlete_ids','p_attendee_ids','p_rider_ids') then
        guards:=guards||format('if exists(select 1 from unnest($%s) subject where not private.jkcrew_same_team_profile(subject)) then raise exception ''Choose members of your private team.'' using errcode=''42501''; end if; ',i);
      end if;
    end loop;
    select coalesce(string_agg('$'||n,',' order by n),'') into inputs from generate_series(1,fn.pronargs) n;
    select string_agg(quote_ident(fn.proargnames[n]),',' order by n) into outputs from generate_subscripts(fn.proargmodes,1) n where fn.proargmodes[n] in ('o','b');
    body:='begin perform private.require_coach_approval(); '||guards||
      case when fn.proretset then format('return query select * from private.%I(%s);',impl,inputs)
        when outputs is not null then format('select * into %s from private.%I(%s); return;',outputs,impl,inputs)
        when fn.prorettype='void'::regtype then format('perform private.%I(%s); return;',impl,inputs)
        else format('return private.%I(%s);',impl,inputs) end||' end;';
    volatility:=case when fn.provolatile='s' then 'stable' else 'volatile' end;
    execute format('create or replace function public.%I(%s) returns %s language plpgsql %s security invoker set search_path='''' as %L',fn.proname,fn.arguments,fn.result,volatility,body);
  end loop;
end $rpc_cohort_guards$;

-- Narrow authoritative lookups do not grant clients private-table SELECT.
create function private.jkcrew_private_resource_visible(p_table text,p_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare subject uuid;
begin
  if p_table='daily_finish_candidates' then select athlete_id into subject from private.daily_finish_candidates where id=p_id;
  elsif p_table='rider_recovery_episodes' then select athlete_id into subject from private.rider_recovery_episodes where id=p_id;
  else return false; end if;
  return subject is not null and private.jkcrew_same_team_profile(subject);
end $$;
create function private.jkcrew_save_resource_allowed(p_table text,p_id uuid,p_allow_new boolean)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare subject uuid;
begin
  if p_table not in ('coach_training_blocks','coach_tracked_sessions') then return false; end if;
  execute format('select coach_id from public.%I where id=$1',p_table) into subject using p_id;
  if subject is null then return p_allow_new and private.jkcrew_is_team_coach(auth.uid()); end if;
  return private.jkcrew_is_team_coach(subject);
end $$;
create function private.jkcrew_session_ids_allowed(p_ids uuid[])
returns boolean language sql stable security definer set search_path='' as $$
  select not exists(select 1 from unnest(p_ids) chosen left join public.training_sessions s on s.id=chosen
    where s.id is null or not private.jkcrew_same_team_profile(s.athlete_id));
$$;
revoke all on function private.jkcrew_private_resource_visible(text,uuid),private.jkcrew_save_resource_allowed(text,uuid,boolean),private.jkcrew_session_ids_allowed(uuid[]) from public,anon;
grant execute on function private.jkcrew_private_resource_visible(text,uuid),private.jkcrew_save_resource_allowed(text,uuid,boolean),private.jkcrew_session_ids_allowed(uuid[]) to authenticated,service_role;


-- Global catalogue dates remain shared; event instances, attendance, runs and
-- challenge state are independent for each purchasing team.
alter table public.dashboard_items add column team_id uuid;
update public.dashboard_items set team_id=private.jkcrew_profile_team_id(owner_id);
alter table public.weekly_challenges add column team_id uuid;
update public.weekly_challenges set team_id=private.jkcrew_profile_team_id(created_by);
create function private.bind_record_team()
returns trigger language plpgsql security definer set search_path='' as $$
declare expected uuid;
begin
  if tg_table_name='dashboard_items' then expected:=private.jkcrew_profile_team_id(new.owner_id); else expected:=private.jkcrew_profile_team_id(new.created_by); end if;
  if tg_op='UPDATE' and old.team_id is not null and old.team_id is distinct from expected then raise exception 'Team ownership cannot be transferred.' using errcode='42501'; end if;
  if new.team_id is not null and new.team_id is distinct from expected then raise exception 'Choose your own private team.' using errcode='42501'; end if;
  new.team_id:=expected;
  return new;
end $$;
revoke all on function private.bind_record_team() from public,anon,authenticated;
create trigger bind_record_team before insert or update on public.dashboard_items for each row execute function private.bind_record_team();
create trigger bind_record_team before insert or update on public.weekly_challenges for each row execute function private.bind_record_team();
drop index public.dashboard_items_active_event_identity_idx;
create unique index dashboard_items_active_event_identity_idx on public.dashboard_items(team_id,lower(btrim(title)),coalesce((due_at at time zone 'UTC')::date,'9999-12-31'::date)) where item_type='event' and completed=false;
drop index public.one_active_weekly_challenge_idx;
create unique index one_active_weekly_challenge_idx on public.weekly_challenges(team_id) where status='active';

create or replace function private.activate_due_weekly_challenges()
returns integer language plpgsql security definer set search_path='' as $$
declare chosen record; activated integer:=0;
begin
  -- Service scheduling handles all teams. A signed-in rider/coach can only
  -- advance schedules in their own team, never archive another team's work.
  for chosen in select distinct on(team_id) id,team_id from public.weekly_challenges
    where status='scheduled' and starts_at<=now() and ends_at>now()
      and (auth.uid() is null or private.jkcrew_same_team_profile(created_by))
    order by team_id,starts_at desc,created_at desc,id
  loop
    perform 1 from public.weekly_challenges where id=chosen.id for update skip locked;
    if not found then continue; end if;
    update public.weekly_challenges set status='archived'
      where team_id=chosen.team_id and id<>chosen.id and (status='active' or(status='scheduled' and starts_at<=now()));
    update public.weekly_challenges set status='active' where id=chosen.id and status='scheduled';
    if found then activated:=activated+1; end if;
  end loop;
  update public.weekly_challenges set status='archived' where status='scheduled' and ends_at<=now()
    and (auth.uid() is null or private.jkcrew_same_team_profile(created_by));
  return activated;
end $$;

alter table private.uci_schedule_calendar_links add column team_id uuid;
update private.uci_schedule_calendar_links l set team_id=private.jkcrew_profile_team_id(coalesce(d.owner_id,l.added_by))
  from public.dashboard_items d where d.id=l.event_id;
update private.uci_schedule_calendar_links set team_id=private.jkcrew_profile_team_id(added_by) where team_id is null;
alter table private.uci_schedule_calendar_links alter column team_id set not null;
alter table private.uci_schedule_calendar_links drop constraint uci_schedule_calendar_links_pkey;
alter table private.uci_schedule_calendar_links add primary key(source_id,team_id);

create function private.jkcrew_storage_team_allowed(p_bucket text,p_name text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare subject text:=split_part(p_name,'/',1);
begin
  if p_bucket not in ('crew-chat-media','trick-help-videos','profile-showreels') then return false; end if;
  if subject !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  return private.jkcrew_same_team_profile(subject::uuid);
end $$;
revoke all on function private.jkcrew_storage_team_allowed(text,text) from public,anon;
grant execute on function private.jkcrew_storage_team_allowed(text,text) to authenticated,service_role;
create policy private_team_file_boundary on storage.objects as restrictive for all to authenticated
using(private.jkcrew_storage_team_allowed(bucket_id,name)) with check(private.jkcrew_storage_team_allowed(bucket_id,name));
create policy private_team_showreels_read on storage.objects for select to authenticated
using(bucket_id='profile-showreels' and private.jkcrew_storage_team_allowed(bucket_id,name));


-- Changes to a shared roster are propagated as changes, including removals.
-- Approval suspension keeps historical rows while the account gate blocks use.
create or replace function private.sync_team_roster_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare team uuid; source record;
begin
  if pg_trigger_depth()>1 then return coalesce(new,old); end if;
  if tg_table_name='coach_account_access' then
    if new.status='approved' then perform private.sync_approved_team_roster(private.jkcrew_profile_team_id(new.coach_id)); end if;
    return new;
  end if;
  team:=private.jkcrew_profile_team_id(coalesce(new.coach_id,old.coach_id));
  if tg_table_name='coach_athletes' then
    if tg_op='DELETE' then
      delete from public.coach_athlete_groups g using private.coach_team_memberships m
        where g.coach_id=m.coach_id and m.team_id=team and g.athlete_id=old.athlete_id;
      delete from public.coach_athletes c using private.coach_team_memberships m
        where c.coach_id=m.coach_id and m.team_id=team and c.athlete_id=old.athlete_id;
      return old;
    end if;
    update public.coach_athletes c set team_id=new.team_id,group_name=new.group_name
      from private.coach_team_memberships m where c.coach_id=m.coach_id and m.team_id=team
      and c.athlete_id=new.athlete_id and c.coach_id<>new.coach_id;
    perform private.sync_approved_team_roster(team);
  else
    if tg_op='DELETE' or (tg_op='UPDATE' and (old.group_name,old.athlete_id) is distinct from (new.group_name,new.athlete_id)) then
      delete from public.coach_athlete_groups g using private.coach_team_memberships m
        where g.coach_id=m.coach_id and m.team_id=team and g.athlete_id=old.athlete_id and g.group_name=old.group_name;
    end if;
    if tg_op<>'DELETE' then
      insert into public.coach_athlete_groups(coach_id,athlete_id,group_name,membership_type,expires_at,notes)
      select m.coach_id,new.athlete_id,new.group_name,new.membership_type,new.expires_at,new.notes
      from private.coach_team_memberships m where m.team_id=team and m.status='active' and private.jkcrew_actor_approved(m.coach_id)
      on conflict(coach_id,athlete_id,group_name) do update set membership_type=excluded.membership_type,expires_at=excluded.expires_at,notes=excluded.notes;
    end if;
  end if;
  return coalesce(new,old);
end $$;
drop trigger sync_team_roster_change on public.coach_athletes;
create trigger sync_team_roster_change after insert or update or delete on public.coach_athletes
for each row execute function private.sync_team_roster_change();
drop trigger sync_team_groups_change on public.coach_athlete_groups;
create trigger sync_team_groups_change after insert or update or delete on public.coach_athlete_groups
for each row execute function private.sync_team_roster_change();

-- Purchasing-team changes cannot carry existing authored team records into a
-- different club. Joining is only available to a fresh, empty coach account.
create function private.jkcrew_coach_has_team_data(p_coach uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare item record; present boolean;
begin
  if exists(select 1 from auth.users where raw_app_meta_data->>'registered_coach_id'=p_coach::text) then return true; end if;
  for item in select table_schema,table_name,column_name from information_schema.columns
    where table_schema in('public','private') and column_name in ('coach_id','owner_id','author_id','created_by')
      and udt_name='uuid' and table_name not in ('coach_teams','profiles','coach_team_memberships','coach_team_invites','coach_account_access','coach_account_access_audit')
  loop
    execute format('select exists(select 1 from %I.%I where %I=$1)',item.table_schema,item.table_name,item.column_name) into present using p_coach;
    if present then return true; end if;
  end loop;
  return false;
end $$;
revoke all on function private.jkcrew_coach_has_team_data(uuid) from public,anon,authenticated;

create function public.create_team_registration_invite(p_role text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare member private.coach_team_memberships; code text; expiry timestamptz:=now()+interval '7 days';
begin
  perform private.require_coach_approval();
  select * into member from private.coach_team_memberships where coach_id=auth.uid() and status='active';
  if member.coach_id is null or not private.jkcrew_is_team_coach(member.coach_id) then raise exception 'Approved team coach required.' using errcode='42501'; end if;
  if p_role not in ('athlete','parent') then raise exception 'Choose rider or parent.' using errcode='22023'; end if;
  code:=upper(replace(gen_random_uuid()::text,'-',''));
  insert into private.coach_team_invites(code_hash,team_id,role,created_by,expires_at)
  values(sha256(convert_to(code,'UTF8')),member.team_id,p_role,auth.uid(),expiry);
  return jsonb_build_object('code',code,'expires_at',expiry,'role',p_role);
end $$;
revoke all on function public.create_team_registration_invite(text) from public,anon;
grant execute on function public.create_team_registration_invite(text) to authenticated;

create function public.initialize_registered_team_member(p_user_id uuid,p_role text,p_invite_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare invitation private.coach_team_invites;
begin
  if auth.jwt()->>'role' is distinct from 'service_role' or p_role not in ('athlete','parent') then raise exception 'Server registration required.' using errcode='42501'; end if;
  if not exists(select 1 from public.profiles where id=p_user_id and role::text=p_role) then raise exception 'Account role does not match.' using errcode='42501'; end if;
  select * into invitation from private.coach_team_invites where code_hash=sha256(convert_to(upper(btrim(p_invite_code)),'UTF8')) for update;
  if invitation.team_id is null or invitation.role<>p_role or invitation.consumed_at is not null or invitation.expires_at<=now()
    or not private.jkcrew_actor_approved(invitation.created_by)
    or not exists(select 1 from private.coach_team_memberships inviter where inviter.coach_id=invitation.created_by and inviter.team_id=invitation.team_id and inviter.status='active') then raise exception 'That team invitation is invalid or expired.' using errcode='42501'; end if;
  if exists(select 1 from private.jkcrew_user_team_ids(p_user_id) t where t.team_id<>invitation.team_id) then raise exception 'This account already belongs to another private team.' using errcode='42501'; end if;
  update auth.users set raw_app_meta_data=coalesce(raw_app_meta_data,'{}')||jsonb_build_object('registered_coach_id',invitation.created_by) where id=p_user_id;
  update private.coach_team_invites set consumed_by=p_user_id,consumed_at=now() where code_hash=invitation.code_hash;
  return jsonb_build_object('status','registered','role',p_role,'team_id',invitation.team_id);
end $$;
revoke all on function public.initialize_registered_team_member(uuid,text,text) from public,anon,authenticated;
grant execute on function public.initialize_registered_team_member(uuid,text,text) to service_role;

create function public.can_coach_delete_account(p_target_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select private.jkcrew_is_team_coach(auth.uid()) and p_target_id<>auth.uid()
    and exists(select 1 from public.profiles p where p.id=p_target_id and p.role::text in ('athlete','parent') and not p.is_platform_owner)
    and private.jkcrew_same_team_profile(p_target_id)
    and exists(select 1 from private.jkcrew_user_team_ids(p_target_id))
    and not exists(select 1 from private.jkcrew_user_team_ids(p_target_id) t where t.team_id<>private.jkcrew_profile_team_id(auth.uid()));
$$;
revoke all on function public.can_coach_delete_account(uuid) from public,anon;
grant execute on function public.can_coach_delete_account(uuid) to authenticated;

create function public.prepare_coach_account_deletion(p_target_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.require_coach_approval();
  if not public.can_coach_delete_account(p_target_id) then raise exception 'This account belongs to another private team.' using errcode='42501'; end if;
  delete from auth.refresh_tokens where user_id::text=p_target_id::text;
  delete from auth.sessions where user_id=p_target_id;
  return jsonb_build_object('ready',true);
end $$;
revoke all on function public.prepare_coach_account_deletion(uuid) from public,anon;
grant execute on function public.prepare_coach_account_deletion(uuid) to authenticated;

create or replace function public.get_platform_coach_overview()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare coaches jsonb; countries jsonb; students integer;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and is_platform_owner) then raise exception 'Platform-owner access required.' using errcode='42501'; end if;
  select coalesce(jsonb_agg(to_jsonb(row) order by row.display_name),'[]'::jsonb) into coaches from (
    select p.id coach_id,p.display_name,p.email,nullif(p.country_code,'') country_code,nullif(p.country_name,'') country_name,
      case when u.deleted_at is not null then 'disabled' when u.banned_until>now() then 'suspended' when u.confirmed_at is null then 'pending' else 'active' end account_status,
      case when p.is_platform_owner then 'approved' else coalesce(a.status,'pending') end approval_status,
      m.role team_role,t.name team_name,
      (select count(distinct c.athlete_id)::integer from public.coach_athletes c
        join private.coach_team_memberships cm on cm.coach_id=c.coach_id and cm.status='active' where cm.team_id=m.team_id) student_count
    from public.profiles p join auth.users u on u.id=p.id
    left join private.coach_account_access a on a.coach_id=p.id
    left join private.coach_team_memberships m on m.coach_id=p.id and m.status='active'
    left join public.coach_teams t on t.id=m.team_id where p.role::text in ('coach','admin')
  ) row;
  select coalesce(jsonb_agg(to_jsonb(row) order by row.country_name),'[]'::jsonb) into countries from (
    select coalesce(nullif(p.country_code,''),'UNSET') country_code,
      coalesce(max(nullif(p.country_name,'')),'Country not set') country_name,
      count(distinct p.id)::integer coach_count,count(distinct c.athlete_id)::integer student_count
    from public.profiles p left join private.coach_team_memberships m on m.coach_id=p.id and m.status='active'
    left join private.coach_team_memberships colleague on colleague.team_id=m.team_id and colleague.status='active'
    left join public.coach_athletes c on c.coach_id=colleague.coach_id
    where p.role::text in ('coach','admin') group by coalesce(nullif(p.country_code,''),'UNSET')
  ) row;
  select count(distinct athlete_id)::integer into students from public.coach_athletes;
  return jsonb_build_object('coaches',coaches,'country_totals',countries,'total_coaches',jsonb_array_length(coaches),'total_students',students);
end $$;
revoke all on function public.get_platform_coach_overview() from public,anon;
grant execute on function public.get_platform_coach_overview() to authenticated,service_role;


-- Shared coaches retain the existing protected save workflows.
CREATE OR REPLACE FUNCTION private.validate_coach_tracked_session()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_retained uuid[] := '{}'::uuid[];
begin
  if auth.uid() is null or not private.jkcrew_is_team_coach(new.coach_id)
     or not exists (select 1 from public.profiles where id = auth.uid() and role in ('coach', 'admin')) then
    raise exception 'Only the session coach can save this session.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.coach_id is distinct from old.coach_id then
      raise exception 'The session owner cannot be changed.' using errcode = '42501';
    end if;
    v_retained := old.rider_ids;
    new.created_at := old.created_at;
  end if;
  new.venue := btrim(regexp_replace(coalesce(new.venue, ''), '[[:space:]]+', ' ', 'g'));
  if char_length(new.venue) not between 1 and 80 then
    raise exception 'Enter a location between 1 and 80 characters.' using errcode = '22023';
  end if;
  if new.session_date is null or not isfinite(new.session_date) then
    raise exception 'Choose a session date.' using errcode = '22023';
  end if;
  if new.rider_ids is null or cardinality(new.rider_ids) not between 1 and 200
     or array_position(new.rider_ids, null) is not null then
    raise exception 'Choose between 1 and 200 riders.' using errcode = '22023';
  end if;
  new.rider_ids := array(select distinct rider_id from unnest(new.rider_ids) as riders(rider_id) order by rider_id);
  if exists (
    select 1 from unnest(new.rider_ids) as riders(rider_id)
    where not (rider_id = any(v_retained)) and not exists (
      select 1 from public.coach_athletes as links
      join public.profiles as rider on rider.id = links.athlete_id and rider.role = 'athlete'
      where links.coach_id = new.coach_id and links.athlete_id = rider_id
    )
  ) then
    raise exception 'Choose riders linked to your coaching account.' using errcode = '42501';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION private.validate_coach_training_block()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null or not private.jkcrew_is_team_coach(new.coach_id)
     or not exists (select 1 from public.profiles where id = auth.uid() and role in ('coach', 'admin')) then
    raise exception 'Only the block coach can save this training block.' using errcode = '42501';
  end if;
  -- The same lock in the session trigger serializes date-range validation with
  -- block edits, including writes made through the table API and old clients.
  perform pg_advisory_xact_lock(hashtextextended('coach-training-plan:' || new.coach_id::text, 0));
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.coach_id is distinct from old.coach_id then
      raise exception 'The block owner cannot be changed.' using errcode = '42501';
    end if;
    new.created_at := old.created_at;
  end if;
  new.name := btrim(regexp_replace(coalesce(new.name, ''), '[[:space:]]+', ' ', 'g'));
  if char_length(new.name) not between 1 and 80 then
    raise exception 'Enter a block name between 1 and 80 characters.' using errcode = '22023';
  end if;
  if new.start_date is null or not isfinite(new.start_date) or extract(isodow from new.start_date) <> 1 then
    raise exception 'Choose a Monday for the first week of the block.' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and new.start_date is distinct from old.start_date and exists (
    select 1 from public.coach_tracked_sessions as sessions
    where sessions.block_id = new.id
      and (sessions.session_date < new.start_date or sessions.session_date >= new.start_date + 70)
  ) then
    -- Include archived sessions so restoring one never moves it outside its block.
    raise exception 'These dates would move saved sessions outside the ten-week block. Update their block assignment first.' using errcode = '22023';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION private.validate_coach_tracked_session_block()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_start date;
begin
  if auth.uid() is null or not private.jkcrew_is_team_coach(new.coach_id)
     or not exists (select 1 from public.profiles where id = auth.uid() and role in ('coach', 'admin')) then
    raise exception 'Only the session coach can save this session.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('coach-training-plan:' || new.coach_id::text, 0));
  if new.park_fee_cents is null or new.park_fee_cents not between 0 and 1000000 then
    raise exception 'Enter a park fee between $0 and $10,000.' using errcode = '22023';
  end if;
  if new.park_fee_basis is null or new.park_fee_basis not in ('per_rider', 'session') then
    raise exception 'Choose a per-rider or session park fee.' using errcode = '22023';
  end if;
  if new.block_id is not null then
    select start_date into v_start from public.coach_training_blocks
      where id = new.block_id and private.jkcrew_profiles_share_team(coach_id,new.coach_id);
    if not found then
      raise exception 'Choose a training block from your coaching account.' using errcode = '42501';
    end if;
    if new.session_date < v_start or new.session_date >= v_start + 70 then
      raise exception 'Choose a session date within this ten-week block.' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION private.approved_2d76b23b27dbd7176057e04a(p_athlete_id uuid, p_week_start date, p_category text, p_venue text DEFAULT ''::text, p_assignments jsonb DEFAULT '[]'::jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_coach uuid := auth.uid();
  v_category text := lower(btrim(coalesce(p_category, '')));
  v_venue text := left(btrim(coalesce(p_venue, '')), 80);
  v_count integer := 0;
  v_index integer := 0;
  v_item jsonb;
  v_trick_name text;
  v_notes text;
  v_target_reps integer;
  v_existing_id uuid;
  v_used_ids uuid[] := array[]::uuid[];
  v_link_names text[] := array[]::text[];
  v_base_order integer := 0;
begin
  if v_coach is null then
    raise exception 'You must be signed in to save a schedule.';
  end if;

  if v_category not in ('daily', 'dialled', 'one_bang', 'percentage', 'foam_pit', 'bonus', 'lines', 'trick_links', 'other') then
    raise exception 'Unsupported trick list category.';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = v_coach
      and p.role::text in ('coach', 'admin')
  ) then
    raise exception 'Only coaches can save rider schedules.';
  end if;

  if not exists (
    select 1
    from public.coach_athletes ca
    where ca.coach_id = v_coach
      and ca.athlete_id = p_athlete_id
  ) then
    raise exception 'This rider is not linked to your coach account.';
  end if;

  -- Serialize rollover and coach saves for the same rider/week. A second
  -- device rechecks the committed sheet instead of inserting another copy.
  perform pg_advisory_xact_lock(hashtextextended(
    'jkcrew-weekly-list:' || p_athlete_id::text || ':' || p_week_start::text, 0
  ));

  -- Carry the rest of an untouched sheet before changing this one list.
  -- Rollover never backfills individual categories over a populated sheet
  -- containing the coach's current-week edits.
  if exists (
    select 1 from public.profiles rider
    cross join lateral public.jkcrew_week_bounds(coalesce(rider.country_code, 'AU')) bounds
    where rider.id = p_athlete_id and bounds.week_start_date = p_week_start
  ) then
    perform public.ensure_current_week_assignments(p_athlete_id, p_week_start);
  end if;

  with target_rows as (
    select
      wta.id,
      row_number() over (order by wta.sort_order, wta.id) as row_number
    from public.weekly_trick_assignments wta
    where private.jkcrew_profiles_share_team(wta.coach_id,v_coach)
      and wta.athlete_id = p_athlete_id
      and wta.week_start = p_week_start
      and wta.category = v_category
      and (
        v_category <> 'daily'
        or btrim(coalesce(wta.venue, '')) = v_venue
      )
  )
  update public.weekly_trick_assignments wta
  set sort_order = -200000000 - target_rows.row_number,
      updated_at = now()
  from target_rows
  where wta.id = target_rows.id;

  select coalesce(max(wta.sort_order) + 1, 0) into v_base_order
  from public.weekly_trick_assignments wta
  where private.jkcrew_profiles_share_team(wta.coach_id,v_coach)
    and wta.athlete_id = p_athlete_id
    and wta.week_start = p_week_start
    and wta.sort_order >= 0;

  for v_item in
    select value
    from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb))
  loop
    v_existing_id := null;
    if v_category = 'trick_links' then
      v_trick_name := private.normalize_trick_link(v_item->>'trick_name');
      if lower(v_trick_name) = any(v_link_names) then continue; end if;
      v_link_names := array_append(v_link_names, lower(v_trick_name));
    else
      v_trick_name := left(btrim(coalesce(v_item->>'trick_name', '')), 120);
    end if;
    if v_trick_name = '' then
      continue;
    end if;

    v_notes := left(coalesce(v_item->>'notes', ''), 500);
    v_target_reps := case
      when v_category = 'dialled' then 3
      when v_category = 'percentage' then 10
      else 1
    end;

    select wta.id into v_existing_id
    from public.weekly_trick_assignments wta
    where private.jkcrew_profiles_share_team(wta.coach_id,v_coach)
      and wta.athlete_id = p_athlete_id
      and wta.week_start = p_week_start
      and wta.category = v_category
      and (
        v_category <> 'daily'
        or btrim(coalesce(wta.venue, '')) = v_venue
      )
      and lower(btrim(wta.trick_name)) = lower(v_trick_name)
      and not (wta.id = any(v_used_ids))
    order by wta.sort_order
    limit 1;

    if v_existing_id is null then
      insert into public.weekly_trick_assignments (
        coach_id,
        athlete_id,
        week_start,
        trick_name,
        category,
        target_reps,
        notes,
        sort_order,
        venue
      )
      values (
        v_coach,
        p_athlete_id,
        p_week_start,
        v_trick_name,
        v_category,
        v_target_reps,
        v_notes,
        v_base_order + v_index,
        case when v_category = 'daily' then v_venue else '' end
      )
      returning id into v_existing_id;
    else
      update public.weekly_trick_assignments wta
      set trick_name = v_trick_name,
          target_reps = v_target_reps,
          notes = v_notes,
          sort_order = v_base_order + v_index,
          venue = case when v_category = 'daily' then v_venue else '' end,
          updated_at = now()
      where wta.id = v_existing_id;
    end if;

    v_used_ids := array_append(v_used_ids, v_existing_id);
    v_index := v_index + 1;
  end loop;

  delete from public.weekly_trick_assignments wta
  where private.jkcrew_profiles_share_team(wta.coach_id,v_coach)
    and wta.athlete_id = p_athlete_id
    and wta.week_start = p_week_start
    and wta.category = v_category
    and (
      v_category <> 'daily'
      or btrim(coalesce(wta.venue, '')) = v_venue
    )
    and not (wta.id = any(v_used_ids));

  v_count := coalesce(array_length(v_used_ids, 1), 0);
  return v_count;
end;
$function$;
CREATE OR REPLACE FUNCTION private.get_uci_rider_tracker(p_rider_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid:=private.uci_tracker_actor(); v_coach boolean; v_ids uuid[]; v_events jsonb;
begin
 select role::text in('coach','admin') into v_coach from public.profiles where id=v_user;
 if p_rider_id is not null then perform private.uci_tracker_authorize(p_rider_id); end if;
 select coalesce(array_agg(p.id),'{}'::uuid[]) into v_ids from public.profiles p where p.role::text='athlete'
   and (p_rider_id is null or p.id=p_rider_id)
   and ((not v_coach and p.id=v_user) or (v_coach and exists(select 1 from public.coach_athletes ca where ca.coach_id=v_user and ca.athlete_id=p.id)));
 select coalesce(jsonb_agg(e.payload order by e.payload->>'due_at' desc nulls last,e.payload->>'title'),'[]') into v_events from (
   select d.id,jsonb_build_object('id',d.id,'title',left(d.title,140),'details',left(d.details,300),'due_at',d.due_at,'end_at',d.end_at,
     'completed',d.completed,'uci_schedule_date_only',d.uci_schedule_date_only,'uci_schedule_status',d.uci_schedule_status,'unavailable',false) payload
   from public.dashboard_items d where private.jkcrew_team_event_visible(d.id) and d.item_type='event' and (v_coach or d.owner_id=v_user
     or (not d.completed and coalesce(d.end_at,d.due_at+interval '1 day','infinity'::timestamptz)>=now())
     or exists(select 1 from private.uci_rider_records r where r.rider_id=any(v_ids) and r.event_id=d.id))
   union all
   select distinct on(r.event_id) r.event_id,r.event_snapshot||jsonb_build_object('unavailable',true)
   from private.uci_rider_records r where r.rider_id=any(v_ids) and not exists(select 1 from public.dashboard_items d where d.id=r.event_id and d.item_type='event')
 ) e;
 return jsonb_build_object('canManage',v_coach,'riders',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'display_name',p.display_name,'uci_id',p.uci_id) order by p.display_name) from public.profiles p where p.id=any(v_ids)),'[]'),
   'events',v_events,
   'entries',coalesce((select jsonb_agg(private.uci_tracker_record_json(r) order by r.updated_at desc,r.id) from private.uci_rider_records r where r.rider_id=any(v_ids) and r.kind='entry'),'[]'),
   'results',coalesce((select jsonb_agg(private.uci_tracker_record_json(r) order by r.payload->>'event_date' desc,r.id) from private.uci_rider_records r where r.rider_id=any(v_ids) and r.kind='result'),'[]'));
end $function$;
CREATE OR REPLACE FUNCTION private.get_parent_uci_rider_tracker(p_rider_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_ids uuid[] := private.uci_parent_tracker_riders(p_rider_id);
 v_events jsonb;
begin

 -- The shared upcoming event catalogue supports family planning. Historical
 -- events are limited to the selected children's records; no run plans/media.
 select coalesce(jsonb_agg(e.payload order by e.payload->>'due_at' desc nulls last,e.payload->>'title'),'[]') into v_events
 from (
   select d.id,jsonb_build_object('id',d.id,'title',left(d.title,140),'details',left(d.details,300),
     'due_at',d.due_at,'end_at',d.end_at,'completed',d.completed,
     'uci_schedule_date_only',d.uci_schedule_date_only,'uci_schedule_status',d.uci_schedule_status,'unavailable',false) payload
   from public.dashboard_items d
   where private.jkcrew_team_event_visible(d.id) and d.item_type='event' and cardinality(v_ids)>0
     and ((not d.completed and coalesce(d.end_at,d.due_at+interval '1 day','infinity'::timestamptz)>=now())
       or exists(select 1 from private.uci_rider_records r where r.rider_id=any(v_ids) and r.event_id=d.id))
   union all
   select archived.event_id,archived.event_snapshot||jsonb_build_object('unavailable',true)
   from (
     select distinct on(r.event_id) r.event_id,r.event_snapshot
     from private.uci_rider_records r
     where r.rider_id=any(v_ids)
       and not exists(select 1 from public.dashboard_items d where d.id=r.event_id and d.item_type='event')
     order by r.event_id,r.updated_at desc,r.id
   ) archived
 ) e;

 return jsonb_build_object(
   'canManage',false,'readOnly',true,
   'riders',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'display_name',p.display_name,'uci_id',p.uci_id) order by p.display_name,p.id)
     from public.profiles p where p.id=any(v_ids)),'[]'),
   'events',v_events,
   'entries',coalesce((select jsonb_agg(private.uci_tracker_record_json(r) order by r.updated_at desc,r.id)
     from private.uci_rider_records r where r.rider_id=any(v_ids) and r.kind='entry'),'[]'),
   'results',coalesce((select jsonb_agg(private.uci_tracker_record_json(r) order by r.payload->>'event_date' desc,r.id)
     from private.uci_rider_records r where r.rider_id=any(v_ids) and r.kind='result'),'[]'));
end $function$;


-- Every purchasing team gets its own official-calendar link.

CREATE OR REPLACE FUNCTION private.get_uci_2027_schedule()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid:=private.uci_schedule_require_access(false); v_state private.uci_schedule_state; v_events jsonb; v_can_manage boolean;
begin
  select * into v_state from private.uci_schedule_state where singleton;
  select role::text in('coach','admin') into v_can_manage from public.profiles where id=v_user;
  select coalesce(jsonb_agg(e.payload||jsonb_build_object(
    'existingEventId',l.event_id,'alreadyAdded',l.event_id is not null,
    'matchingEventId',case when l.event_id is null and matching.total=1 then matching.id else null end,
    'matchingEventCount',case when l.event_id is null then matching.total else 0 end,
    'syncStatus',case when l.source_id is not null and l.event_id is null then 'removed' when jsonb_array_length(coalesce(l.sync_conflicts,'[]'))>0 then 'coach_edits' else 'current' end,
    'syncConflicts',coalesce(l.sync_conflicts,'[]'::jsonb)) order by e.payload->>'startDate' nulls last,e.payload->>'name'),'[]'::jsonb)
  into v_events from private.uci_schedule_events e left join private.uci_schedule_calendar_links l on l.source_id=e.source_id and l.team_id=private.jkcrew_profile_team_id(auth.uid())
  left join lateral (select count(*) as total,(array_agg(m.id))[1] as id from private.uci_schedule_matching_events(e.payload) m) matching on true;
  return (v_state.snapshot-'events'-'rankings'-'reviewCandidates')||jsonb_build_object(
    'schemaVersion',1,'year',2027,'events',v_events,'checkedAt',v_state.checked_at,
    'announcements',coalesce((select jsonb_agg(payload order by payload->>'publishedAt' desc,source_id) from private.uci_schedule_announcements),'[]'::jsonb),
    'refreshStatus',case when v_state.refresh_status in('failed','pending','retrying') then v_state.refresh_status else coalesce(v_state.snapshot->>'refreshStatus',v_state.refresh_status) end,
    'refreshError',v_state.refresh_error,'lastSyncedAt',v_state.ingested_at,'lastPolledAt',v_state.last_polled_at,
    'weeklyRefresh','Monday 00:30 UTC','canManage',v_can_manage,
    'notificationsEnabled',coalesce((select enabled from private.uci_schedule_subscribers where coach_id=v_user),false));
end $function$;

CREATE OR REPLACE FUNCTION private.get_parent_uci_2027_schedule()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_ids uuid[] := private.uci_parent_tracker_riders();
 v_state record;
 v_events jsonb;
begin
 if cardinality(v_ids)=0 then
   raise exception 'Link an eligible rider to view the UCI schedule.' using errcode='42501';
 end if;
 select * into v_state from private.uci_schedule_state where singleton;
 select coalesce(jsonb_agg(e.payload||jsonb_build_object(
   'existingEventId',l.event_id,'alreadyAdded',l.event_id is not null)
   order by e.payload->>'startDate' nulls last,e.payload->>'name'),'[]'::jsonb)
 into v_events from private.uci_schedule_events e
 left join private.uci_schedule_calendar_links l on l.source_id=e.source_id and l.team_id in(select team_id from private.jkcrew_user_team_ids(auth.uid()));
 return (v_state.snapshot-'events'-'rankings'-'reviewCandidates')||jsonb_build_object(
   'schemaVersion',1,'year',2027,'events',v_events,'checkedAt',v_state.checked_at,
   'announcements',coalesce((select jsonb_agg(payload order by payload->>'publishedAt' desc,source_id)
     from private.uci_schedule_announcements),'[]'::jsonb),
   'refreshStatus',case when v_state.refresh_status in('failed','pending','retrying') then v_state.refresh_status
     else coalesce(v_state.snapshot->>'refreshStatus',v_state.refresh_status) end,
   'refreshError',v_state.refresh_error,'lastSyncedAt',v_state.ingested_at,'lastPolledAt',v_state.last_polled_at,
   'weeklyRefresh','Monday 00:30 UTC','canManage',false,'readOnly',true,'notificationsEnabled',false);
end $function$;

CREATE OR REPLACE FUNCTION private.uci_schedule_matching_events(p_event jsonb)
 RETURNS TABLE(id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select d.id from public.dashboard_items d where private.jkcrew_team_event_visible(d.id) and d.item_type='event'
   and regexp_replace(lower(d.title),'[^a-z0-9]','','g')=any(array[
     regexp_replace(lower(p_event->>'name'),'[^a-z0-9]','','g'),
     regexp_replace(lower(left(p_event->>'name',120)),'[^a-z0-9]','','g'),
     regexp_replace(lower(p_event->>'matchUciName'),'[^a-z0-9]','','g')])
   and (d.due_at at time zone 'UTC')::date=nullif(p_event->>'startDate','')::date
 order by d.created_at,d.id;
$function$;

CREATE OR REPLACE FUNCTION private.add_uci_schedule_event(p_event_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid:=private.uci_schedule_require_access(true); v_payload jsonb; v_id uuid; v_match_count integer;
 v_fields jsonb; v_existing public.dashboard_items; v_already boolean:=false;
begin
  -- Same global lock order as ingestion: a refresh cannot race an add and lose
  -- new source dates. The source/link uniqueness also protects retrying clients.
  perform 1 from private.uci_schedule_state where singleton for update;
  select payload into v_payload from private.uci_schedule_events where source_id=p_event_id for update;
  if not found then raise exception 'This event is no longer in the schedule. Refresh and try again.'; end if;
  select event_id into v_id from private.uci_schedule_calendar_links where source_id=p_event_id and team_id=private.jkcrew_profile_team_id(v_user);
  if v_id is not null then return jsonb_build_object('event_id',v_id,'already_added',true,'sync_status','current'); end if;
  if v_payload->>'status'='cancelled' then raise exception 'A cancelled event cannot be added to Upcoming Events.'; end if;
  if nullif(v_payload->>'startDate','') is null or v_payload->>'dateStatus' not in('confirmed','calendar_dates','provisional') then
    raise exception 'The organiser has not announced dates yet. Keep this event on the watchlist.';
  end if;
  v_fields:=private.uci_schedule_calendar_fields(v_payload);
  -- Match conservative, exact normalized names and dates; never merge private
  -- runs or attendance. An ambiguous existing catalogue requires coach review.
  select count(*),(array_agg(m.id))[1] into v_match_count,v_id from private.uci_schedule_matching_events(v_payload) m;
  if v_match_count>1 then raise exception 'Matching events already exist. Merge those duplicates in Events & Runs first.'; end if;
  if v_id is not null then
    v_already:=true;
    select * into v_existing from public.dashboard_items where id=v_id for update;
    -- A pre-existing event has coach-authored fields. Keep those custom values
    -- outside the managed baseline so the first refresh cannot overwrite them.
  else
    insert into public.dashboard_items(owner_id,created_by,item_type,title,details,due_at,end_at,uci_schedule_date_only,uci_schedule_status)
    values(v_user,v_user,'event',v_fields->>'title',v_fields->>'details',(v_fields->>'due_at')::timestamptz,(v_fields->>'end_at')::timestamptz,true,v_payload->>'status')
    returning id into v_id;
  end if;
  insert into private.uci_schedule_calendar_links(source_id,event_id,added_by,managed_fields,team_id)
  values(p_event_id,v_id,v_user,v_fields,private.jkcrew_profile_team_id(v_user))
  on conflict(source_id,team_id) do update set event_id=excluded.event_id,added_by=excluded.added_by,managed_fields=excluded.managed_fields,sync_conflicts='[]',synced_at=now();
  perform private.uci_schedule_sync_calendar(p_event_id);
  return jsonb_build_object('event_id',v_id,'already_added',v_already,'sync_status',case when v_already then 'existing_event' else 'current' end);
end $function$;

CREATE OR REPLACE FUNCTION private.uci_schedule_sync_calendar(p_source_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_link private.uci_schedule_calendar_links; v_event public.dashboard_items; v_payload jsonb; v_new jsonb; v_previous_sync text;
 v_current jsonb; v_next jsonb; v_managed jsonb; v_conflicts jsonb:='[]'; v_key text; v_dates_custom boolean;
begin
  for v_link in select * from private.uci_schedule_calendar_links where source_id=p_source_id
    and (auth.uid() is null or team_id=private.jkcrew_profile_team_id(auth.uid())) for update loop
  if v_link.event_id is null then continue; end if;
  select * into v_event from public.dashboard_items where id=v_link.event_id and item_type='event' for update;
  if not found then continue; end if;
  select payload into v_payload from private.uci_schedule_events where source_id=p_source_id;
  update public.dashboard_items set uci_schedule_status=v_payload->>'status'
    where id=v_event.id and uci_schedule_status is distinct from v_payload->>'status';
  -- Only official, verified dates update a calendar. Provisional edits stay on
  -- the schedule for review. Cancellation remains an explicit verified status.
  if v_payload->>'status' not in('confirmed','cancelled')
    or (v_payload->>'status'<>'cancelled' and v_payload->>'dateStatus' not in('confirmed','calendar_dates')) then continue; end if;
  v_new:=private.uci_schedule_calendar_fields(v_payload);
  v_current:=jsonb_build_object('title',v_event.title,'details',v_event.details,'due_at',v_event.due_at,'end_at',v_event.end_at);
  if v_payload->>'dateStatus' not in('confirmed','calendar_dates') then
    v_new:=v_new||jsonb_build_object('due_at',v_event.due_at,'end_at',v_event.end_at);
  end if;
  v_next:=v_current; v_managed:=v_link.managed_fields;
  v_dates_custom:=(v_current->'due_at' is distinct from v_managed->'due_at') or (v_current->'end_at' is distinct from v_managed->'end_at');
  foreach v_key in array array['title','details','due_at','end_at'] loop
    if v_key in('due_at','end_at') and v_dates_custom then
      -- A coach-edited date range is one unit. Never combine a custom start with
      -- an earlier official finish and accidentally create an inverted event.
      if v_current->v_key is distinct from v_new->v_key then v_conflicts:=v_conflicts||jsonb_build_array(v_key); end if;
    elsif v_current->v_key is not distinct from v_managed->v_key then
      v_next:=jsonb_set(v_next,array[v_key],v_new->v_key);
      v_managed:=jsonb_set(v_managed,array[v_key],v_new->v_key);
    elsif v_current->v_key is distinct from v_new->v_key then
      v_conflicts:=v_conflicts||jsonb_build_array(v_key);
    else
      v_managed:=jsonb_set(v_managed,array[v_key],v_new->v_key);
    end if;
  end loop;
  if v_next is distinct from v_current then
    v_previous_sync:=current_setting('jkcrew.uci_schedule_sync_event',true);
    perform set_config('jkcrew.uci_schedule_sync_event',v_event.id::text,true);
    update public.dashboard_items set title=v_next->>'title',details=v_next->>'details',
      due_at=(v_next->>'due_at')::timestamptz,end_at=(v_next->>'end_at')::timestamptz,updated_at=clock_timestamp()
    where id=v_event.id;
    perform set_config('jkcrew.uci_schedule_sync_event',coalesce(v_previous_sync,''),true);
  end if;
  update private.uci_schedule_calendar_links set managed_fields=v_managed,sync_conflicts=v_conflicts,synced_at=now() where source_id=p_source_id and team_id=v_link.team_id;
  end loop;
end $function$;




-- Foreign keys are authorization boundaries too: an own athlete_id cannot be
-- combined with somebody else's assignment, session, run, event or parent.
create function private.jkcrew_resource_visible(p_table text,p_id uuid,p_depth integer default 0)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare row_data jsonb; key text; subject uuid; checked boolean:=false; target text;
begin
  if p_id is null or p_depth>4 or not private.jkcrew_actor_approved(auth.uid()) then return false; end if;
  if p_table='profiles' then return private.jkcrew_same_team_profile(p_id); end if;
  if p_table not in ('weekly_trick_assignments','training_sessions','coach_group_sessions','attendance_sessions',
    'coach_broadcasts','coach_training_blocks','coach_teams','dashboard_items','crew_posts','run_plans','run_live_sessions',
    'weekly_assignment_plans','weekly_challenges','weekly_rider_battles') then return false; end if;
  execute format('select to_jsonb(r) from public.%I r where r.id=$1',p_table) into row_data using p_id;
  if row_data is null then return false; end if;
  foreach key in array array['athlete_id','coach_id','owner_id','author_id','created_by','challenger_id','opponent_id'] loop
    if (row_data->>key) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      subject:=(row_data->>key)::uuid; checked:=true;
      if not private.jkcrew_same_team_profile(subject) then return false; end if;
    end if;
  end loop;
  if p_table='weekly_rider_battles' then
    -- The private battle-creation transaction inserts participants after the
    -- same-team challenger/opponent row. Empty battles are never readable.
    return checked and (private.jkcrew_team_battle_visible(p_id) or not exists(
      select 1 from public.weekly_rider_battle_participants p where p.battle_id=p_id));
  end if;
  return checked;
end $$;
revoke all on function private.jkcrew_resource_visible(text,uuid,integer) from public,anon;
grant execute on function private.jkcrew_resource_visible(text,uuid,integer) to authenticated,service_role;

create function private.assert_team_foreign_keys()
returns trigger language plpgsql security definer set search_path='' as $$
declare item record; value uuid;
begin
  if auth.uid() is null then return new; end if;
  -- Only the private, bounded roster materializer may write another coach's
  -- duplicate links while the owner approves that foreign coach account.
  if pg_trigger_depth()>1 and tg_table_name in ('coach_athletes','coach_athlete_groups') then
    if private.jkcrew_profile_team_id(new.coach_id)=private.jkcrew_profile_team_id(new.athlete_id)
      and private.jkcrew_actor_approved(new.coach_id) then return new; end if;
  end if;
  if not private.jkcrew_actor_approved(auth.uid()) then raise exception 'Coach approval is required.' using errcode='42501'; end if;
  for item in select a.attname,n.nspname,c.relname from pg_constraint fk
    join pg_attribute a on a.attrelid=fk.conrelid and a.attnum=fk.conkey[1]
    join pg_class c on c.oid=fk.confrelid join pg_namespace n on n.oid=c.relnamespace
    where fk.conrelid=tg_relid and fk.contype='f' and cardinality(fk.conkey)=1 and n.nspname='public'
  loop
    value:=nullif(to_jsonb(new)->>item.attname,'')::uuid;
    if value is not null and not private.jkcrew_resource_visible(item.relname,value) then
      raise exception 'Related records must belong to your private team.' using errcode='42501';
    end if;
  end loop;
  return new;
end $$;
revoke all on function private.assert_team_foreign_keys() from public,anon,authenticated;
do $foreign_key_cohort_guards$
declare item record; predicate text;
begin
  for item in
    select c.relname,array_agg(format('(%I is null or private.jkcrew_resource_visible(%L,%I))',a.attname,target.relname,a.attname)) filter(where not(
      target.relname='profiles' and (a.attname in('athlete_id','coach_id','owner_id','author_id')
        or(a.attname='created_by' and c.relname in('dashboard_items','weekly_challenges')))
    )) predicates
    from pg_constraint fk join pg_class c on c.oid=fk.conrelid
    join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=fk.conrelid and a.attnum=fk.conkey[1]
    join pg_class target on target.oid=fk.confrelid join pg_namespace tn on tn.oid=target.relnamespace
    where fk.contype='f' and cardinality(fk.conkey)=1 and n.nspname='public' and tn.nspname='public'
      and c.relname not in ('app_notifications','push_notification_queue','leaderboard_rank_snapshots')
    group by c.relname
  loop
    predicate:=array_to_string(item.predicates,' and ');
    if predicate is not null then
      execute format('create policy team_related_records_guard on public.%I as restrictive for all to authenticated using (%s) with check (%s)',item.relname,predicate,predicate);
    end if;
    execute format('create trigger assert_team_foreign_keys before insert or update on public.%I for each row execute function private.assert_team_foreign_keys()',item.relname);
  end loop;
end $foreign_key_cohort_guards$;

create function private.jkcrew_team_rider_ids_allowed(p_riders uuid[])
returns boolean language sql stable security definer set search_path='' as $$
  select p_riders is not null and not exists(select 1 from unnest(p_riders) rider where rider is null or not private.jkcrew_same_team_profile(rider));
$$;
revoke all on function private.jkcrew_team_rider_ids_allowed(uuid[]) from public,anon;
grant execute on function private.jkcrew_team_rider_ids_allowed(uuid[]) to authenticated,service_role;
create policy private_team_session_roster on public.coach_tracked_sessions as restrictive for all to authenticated
using(private.jkcrew_team_rider_ids_allowed(rider_ids)) with check(private.jkcrew_team_rider_ids_allowed(rider_ids));
create function private.assert_team_session_roster()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is not null and not private.jkcrew_team_rider_ids_allowed(new.rider_ids) then raise exception 'Choose riders in your private team.' using errcode='42501'; end if;
  return new;
end $$;
revoke all on function private.assert_team_session_roster() from public,anon,authenticated;
create trigger assert_team_session_roster before insert or update on public.coach_tracked_sessions for each row execute function private.assert_team_session_roster();



-- Historical automated crew text may embed another team's rider names. Do
-- not show old global-rank posts after teams become private.
create function private.jkcrew_crew_post_allowed(p_metadata jsonb)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare key text; subject uuid; kind text:=p_metadata->>'event_type';
begin
  if kind in ('rank_one','leaderboard_overtake') and coalesce(p_metadata->>'tenant_rank_version','')<>'1' then return false; end if;
  foreach key in array array['athlete_id','author_id','overtaken_by'] loop
    if nullif(p_metadata->>key,'') is not null then
      begin subject:=(p_metadata->>key)::uuid; exception when invalid_text_representation then return false; end;
      if not private.jkcrew_same_team_profile(subject) then return false; end if;
    end if;
  end loop;
  if kind='battle_result' then
    begin subject:=(p_metadata->>'battle_id')::uuid; exception when invalid_text_representation then return false; end;
    if subject is null or not private.jkcrew_team_battle_visible(subject) then return false; end if;
  end if;
  return true;
end $$;
revoke all on function private.jkcrew_crew_post_allowed(jsonb) from public,anon;
grant execute on function private.jkcrew_crew_post_allowed(jsonb) to authenticated,service_role;
drop policy team_privacy_guard on public.crew_posts;
create policy team_privacy_guard on public.crew_posts as restrictive for all to authenticated
using(private.jkcrew_same_team_profile(author_id) and private.jkcrew_crew_post_allowed(metadata))
with check(private.jkcrew_same_team_profile(author_id) and private.jkcrew_crew_post_allowed(metadata));

-- Privileged list functions filter the cohort before aggregation, ranking,
-- pagination or serialization. Public approval wrappers remain in place.

CREATE OR REPLACE FUNCTION private.active_rider_battles(p_limit integer DEFAULT 24, p_after_ends_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_viewer uuid := auth.uid();
  v_role text;
  v_now timestamptz := now();
  v_limit integer := least(greatest(coalesce(p_limit, 24), 1), 24);
  v_result jsonb;
begin
  select profile.role::text into v_role from public.profiles profile where profile.id = v_viewer;
  if v_viewer is null or v_role is null or v_role not in ('athlete', 'coach', 'admin')
     or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then
    raise exception 'Sign in as a rider or coach to view active battles.' using errcode = '42501';
  end if;
  -- Enforce this inside the helper as well as the existing PostgREST pre-request gate.
  if private.rider_features_disabled() then
    raise exception 'You don''t have access to this feature, contact your coach' using errcode = '42501';
  end if;
  if (p_after_ends_at is null) <> (p_after_id is null) then
    raise exception 'Supply both active battle cursor fields.' using errcode = '22023';
  end if;

  with candidates as materialized (
    select battle.id, battle.starts_at, battle.ends_at, battle.duration_days,
      battle.reward_points, battle.battle_size, battle.team_count
    from public.weekly_rider_battles battle
    where private.jkcrew_team_battle_visible(battle.id) and battle.status = 'accepted' and battle.archived_at is null
      and battle.starts_at <= v_now and battle.ends_at > v_now
      and (p_after_ends_at is null or (battle.ends_at, battle.id) > (p_after_ends_at, p_after_id))
    order by battle.ends_at, battle.id
    limit v_limit + 1
  ), page as materialized (
    select * from candidates order by ends_at, id limit v_limit
  ), summaries as (
    select page.id, page.ends_at, jsonb_build_object(
      'id', page.id, 'starts_at', page.starts_at, 'ends_at', page.ends_at,
      'duration_days', page.duration_days, 'reward_points', page.reward_points,
      'battle_size', page.battle_size, 'team_count', page.team_count,
      'format', detail.format, 'participants', detail.participants, 'teams', detail.teams
    ) as data
    from page
    cross join lateral (
      with members as materialized (
        select participant.athlete_id, participant.team_number, participant.forfeited_at,
          profile.display_name
        from public.weekly_rider_battle_participants participant
        join public.profiles profile on profile.id = participant.athlete_id
        where participant.battle_id = page.id
      ), source_scores as materialized (
        -- The same source and forfeiture rules as battle settlement and the live cards.
        -- A session-day allocation can contribute to a different team from its roster.
        select private.jkcrew_rider_battle_score_allocations(page.id, athlete_id) as allocation
        from members where forfeited_at is null
      ), team_scores as (
        select member.team_number, count(*) as rider_count,
          bool_and(member.forfeited_at is not null) as forfeited,
          (select coalesce(sum((source.allocation->>member.team_number::text)::integer), 0)
           from source_scores source) as score
        from members member group by member.team_number
      )
      select
        (select coalesce(jsonb_agg(jsonb_build_object(
          'athlete_id', athlete_id, 'team_number', team_number,
          'display_name', display_name, 'forfeited_at', forfeited_at
        ) order by team_number, display_name, athlete_id), '[]'::jsonb) from members) as participants,
        (select coalesce(jsonb_agg(jsonb_build_object(
          'team_number', team_number, 'score', score, 'forfeited', forfeited
        ) order by team_number), '[]'::jsonb) from team_scores) as teams,
        (select string_agg(rider_count::text, 'v' order by team_number) from team_scores) as format
    ) detail
  )
  select jsonb_build_object(
    'server_now', v_now,
    'battles', coalesce((select jsonb_agg(data order by ends_at, id) from summaries), '[]'::jsonb),
    'has_more', (select count(*) > v_limit from candidates),
    'next_cursor', case when (select count(*) > v_limit from candidates) then
      (select jsonb_build_object('ends_at', ends_at, 'id', id) from page order by ends_at desc, id desc limit 1)
      else null end
  ) into v_result;
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION private.battle_match_options()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  viewer_id uuid := auth.uid();
  viewer_role text;
  window_end timestamptz := now();
  window_start timestamptz := now() - interval '7 days';
  result jsonb;
begin
  select p.role::text into viewer_role from public.profiles p where p.id = viewer_id;
  if viewer_id is null or viewer_role is null or viewer_role not in ('athlete','coach','admin') then
    raise exception 'Sign in as a rider or coach to prepare a battle.';
  end if;
  with visible as (
    select p.id, p.display_name, p.avatar
    from public.profiles p
    where private.jkcrew_same_team_profile(p.id) and p.role::text = 'athlete' and not coalesce(p.ghost_mode, false)
      and (viewer_role = 'athlete' or exists (
        select 1 from public.coach_athletes c where c.coach_id = viewer_id and c.athlete_id = p.id
      ))
  ), options as (
    select v.id as athlete_id, v.display_name, v.avatar,
      (select count(distinct participant.battle_id)::integer
       from public.weekly_rider_battle_participants participant
       join public.weekly_rider_battles battle on battle.id = participant.battle_id
       where participant.athlete_id = v.id and battle.status in ('pending','accepted')) as active_battle_count,
      greatest(0,
        coalesce((select sum(a.points) from public.assignment_point_awards a
          where a.athlete_id = v.id and a.created_at >= window_start and a.created_at <= window_end),0)
        + coalesce((select sum(s.total_points) from public.training_sessions s
          where s.athlete_id = v.id and s.started_at >= window_start and s.started_at <= window_end
            and not exists (select 1 from public.assignment_point_awards a where a.session_id = s.id)),0)
      )::bigint as recent_training_points
    from visible v
  )
  select jsonb_build_object('window_start',window_start,'window_end',window_end,
    'riders',coalesce(jsonb_agg(to_jsonb(options) order by display_name,athlete_id),'[]'::jsonb)) into result
  from options;
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION private.leaderboard_uci_links()
 RETURNS TABLE(athlete_id uuid, uci_id text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_viewer uuid := auth.uid();
  v_role text;
begin
  select profile.role::text into v_role
  from public.profiles profile where profile.id = v_viewer;
  if v_viewer is null or v_role is null
     or v_role not in ('athlete', 'parent', 'coach', 'admin')
     or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then
    raise exception 'Sign in to view rider world rankings.' using errcode = '42501';
  end if;
  -- Match the app's account gate, including calls outside PostgREST.
  if private.rider_features_disabled() then
    raise exception 'You don''t have access to this feature, contact your coach'
      using errcode = '42501';
  end if;

  return query
  select profile.id, profile.uci_id
  from public.profiles profile
  where private.jkcrew_same_team_profile(profile.id) and profile.role::text = 'athlete'
    and profile.uci_id is not null
    -- Same ghost visibility as public.get_weekly_leaderboard().
    and (not coalesce(profile.ghost_mode, false)
      or profile.id = v_viewer
      or v_role in ('coach', 'admin'))
  order by profile.id;
end;
$function$;

CREATE OR REPLACE FUNCTION private.approved_f58214f32cd50c933615433a()
 RETURNS TABLE(athlete_id uuid, display_name text, level integer, avatar jsonb, country_code text, country_name text, weekly_points bigint, all_time_points bigint, session_count bigint, earned_badges jsonb, ghost_mode boolean, rank_number bigint, all_time_rank_number bigint, weekly_started boolean, weekly_point_events bigint, all_time_point_events bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with viewer as (
    select
      auth.uid() as viewer_id,
      exists (
        select 1
        from public.profiles me
        where me.id = auth.uid()
          and me.role in ('coach', 'admin')
      ) as is_coach
  ),
  score_rows as (
    select
      p.id as athlete_id,
      p.display_name,
      p.avatar,
      p.country_code,
      p.country_name,
      coalesce(p.ghost_mode, false) as ghost_mode,
      greatest(
        0,
        coalesce(current_awards.points, 0)
        + coalesce(current_legacy_sessions.points, 0)
        + coalesce(current_adjustments.points, 0)
      )::bigint as weekly_points,
      greatest(
        0,
        coalesce(all_awards.points, 0)
        + coalesce(all_legacy_sessions.points, 0)
        + coalesce(all_adjustments.points, 0)
      )::bigint as all_time_points,
      coalesce(all_sessions.sessions, 0)::bigint as session_count,
      public.get_earned_badges(p.id) as earned_badges,
      (
        coalesce(current_awards.events, 0)
        + coalesce(current_legacy_sessions.events, 0)
        + coalesce(current_adjustments.events, 0)
      )::bigint as weekly_point_events,
      (
        coalesce(all_awards.events, 0)
        + coalesce(all_legacy_sessions.events, 0)
        + coalesce(all_adjustments.events, 0)
      )::bigint as all_time_point_events
    from public.profiles p
    cross join lateral public.jkcrew_week_bounds(p.country_code) b
    left join lateral (
      select
        coalesce(sum(apa.points), 0)::bigint as points,
        count(*)::bigint as events
      from public.assignment_point_awards apa
      where apa.athlete_id = p.id
        and apa.created_at >= b.week_start_ts
        and apa.created_at < b.next_week_start_ts
    ) current_awards on true
    left join lateral (
      select
        coalesce(sum(ts.total_points), 0)::bigint as points,
        count(*)::bigint as events
      from public.training_sessions ts
      where ts.athlete_id = p.id
        and ts.started_at >= b.week_start_ts
        and ts.started_at < b.next_week_start_ts
        and coalesce(ts.total_points, 0) <> 0
        and not exists (
          select 1
          from public.assignment_point_awards apa
          where apa.session_id = ts.id
        )
    ) current_legacy_sessions on true
    left join lateral (
      select
        coalesce(sum(lpa.points), 0)::bigint as points,
        count(*)::bigint as events
      from public.leaderboard_point_adjustments lpa
      where lpa.athlete_id = p.id
        and lpa.week_start = b.week_start_date
        and coalesce(lpa.reason, '') not ilike 'All-time score correction%'
    ) current_adjustments on true
    left join lateral (
      select
        coalesce(sum(apa.points), 0)::bigint as points,
        count(*)::bigint as events
      from public.assignment_point_awards apa
      where apa.athlete_id = p.id
    ) all_awards on true
    left join lateral (
      select
        coalesce(sum(ts.total_points), 0)::bigint as points,
        count(*)::bigint as events
      from public.training_sessions ts
      where ts.athlete_id = p.id
        and coalesce(ts.total_points, 0) <> 0
        and not exists (
          select 1
          from public.assignment_point_awards apa
          where apa.session_id = ts.id
        )
    ) all_legacy_sessions on true
    left join lateral (
      select
        coalesce(sum(lpa.points), 0)::bigint as points,
        count(*)::bigint as events
      from public.leaderboard_point_adjustments lpa
      where lpa.athlete_id = p.id
    ) all_adjustments on true
    left join lateral (
      select count(ts.id)::bigint as sessions
      from public.training_sessions ts
      where ts.athlete_id = p.id
    ) all_sessions on true
    where private.jkcrew_same_team_profile(p.id) and p.role = 'athlete'
  ),
  visible_rows as (
    select
      sr.*,
      (
        sr.weekly_point_events > 0
        or sr.weekly_points > 0
      ) as weekly_started
    from score_rows sr
    cross join viewer v
    where not sr.ghost_mode
      or sr.athlete_id = v.viewer_id
      or v.is_coach
  ),
  ranked as (
    select
      vr.*,
      rank() over (
        order by
          case when vr.weekly_started then 0 else 1 end,
          vr.weekly_points desc,
          vr.display_name asc
      ) as rank_number,
      rank() over (
        order by
          vr.all_time_points desc,
          vr.display_name asc
      ) as all_time_rank_number
    from visible_rows vr
  )
  select
    ranked.athlete_id,
    ranked.display_name,
    coalesce((
      select least(50, greatest(
        1,
        coalesce(profile.level, 1),
        public.level_for_xp(coalesce(profile.xp_total, 0))
      ))::integer
      from public.profiles profile
      where profile.id = ranked.athlete_id
    ), 1)::integer as level,
    ranked.avatar,
    ranked.country_code,
    ranked.country_name,
    ranked.weekly_points,
    ranked.all_time_points,
    ranked.session_count,
    ranked.earned_badges,
    ranked.ghost_mode,
    ranked.rank_number,
    ranked.all_time_rank_number,
    ranked.weekly_started,
    ranked.weekly_point_events,
    ranked.all_time_point_events
  from ranked
  order by
    case when ranked.weekly_started then 0 else 1 end,
    ranked.weekly_points desc,
    ranked.display_name asc;
$function$;

CREATE OR REPLACE FUNCTION private.approved_79673a77f22163f8ce3ab0b8(p_weeks integer DEFAULT 8)
 RETURNS TABLE(week_start date, athlete_id uuid, display_name text, avatar jsonb, country_code text, country_name text, weekly_points bigint, award_points bigint, adjustment_points bigint, rank_number bigint, weekly_started boolean, point_events bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with coach_access as (
    select exists (
      select 1
      from public.profiles me
      where me.id = auth.uid()
        and me.role in ('coach', 'admin')
    ) as allowed
  ),
  requested_weeks as (
    select least(greatest(coalesce(p_weeks, 8), 1), 16)::integer as count
  ),
  score_rows as (
    select
      (b.week_start_date - (week_offset.n * 7))::date as week_start,
      p.id as athlete_id,
      p.display_name,
      p.avatar,
      p.country_code,
      p.country_name,
      coalesce(awards.points, 0)::bigint as award_points,
      coalesce(legacy_sessions.points, 0)::bigint as legacy_session_points,
      coalesce(adjustments.points, 0)::bigint as adjustment_points,
      (
        coalesce(awards.events, 0)
        + coalesce(legacy_sessions.events, 0)
        + coalesce(adjustments.events, 0)
      )::bigint as point_events,
      greatest(
        0,
        coalesce(awards.points, 0)
        + coalesce(legacy_sessions.points, 0)
        + coalesce(adjustments.points, 0)
      )::bigint as weekly_points
    from coach_access access
    cross join requested_weeks rw
    join public.profiles p on access.allowed and private.jkcrew_same_team_profile(p.id) and p.role = 'athlete'
    cross join lateral public.jkcrew_week_bounds(p.country_code) b
    cross join lateral generate_series(0, rw.count - 1) as week_offset(n)
    left join lateral (
      select
        coalesce(sum(apa.points), 0)::bigint as points,
        count(*)::bigint as events
      from public.assignment_point_awards apa
      where apa.athlete_id = p.id
        and apa.created_at >= b.week_start_ts - (week_offset.n * interval '7 days')
        and apa.created_at < b.next_week_start_ts - (week_offset.n * interval '7 days')
    ) awards on true
    left join lateral (
      select
        coalesce(sum(ts.total_points), 0)::bigint as points,
        count(*)::bigint as events
      from public.training_sessions ts
      where ts.athlete_id = p.id
        and ts.started_at >= b.week_start_ts - (week_offset.n * interval '7 days')
        and ts.started_at < b.next_week_start_ts - (week_offset.n * interval '7 days')
        and coalesce(ts.total_points, 0) <> 0
        and not exists (
          select 1
          from public.assignment_point_awards apa
          where apa.session_id = ts.id
        )
    ) legacy_sessions on true
    left join lateral (
      select
        coalesce(sum(lpa.points), 0)::bigint as points,
        count(*)::bigint as events
      from public.leaderboard_point_adjustments lpa
      where lpa.athlete_id = p.id
        and lpa.week_start = (b.week_start_date - (week_offset.n * 7))::date
        and coalesce(lpa.reason, '') not ilike 'All-time score correction%'
    ) adjustments on true
  ),
  ranked as (
    select
      sr.*,
      (sr.point_events > 0 or sr.weekly_points > 0) as weekly_started,
      rank() over (
        partition by sr.week_start
        order by
          case when (sr.point_events > 0 or sr.weekly_points > 0) then 0 else 1 end,
          sr.weekly_points desc,
          sr.display_name asc
      ) as rank_number
    from score_rows sr
  )
  select
    ranked.week_start,
    ranked.athlete_id,
    ranked.display_name,
    ranked.avatar,
    ranked.country_code,
    ranked.country_name,
    ranked.weekly_points,
    (ranked.award_points + ranked.legacy_session_points)::bigint as award_points,
    ranked.adjustment_points,
    ranked.rank_number,
    ranked.weekly_started,
    ranked.point_events
  from ranked
  order by ranked.week_start desc, ranked.rank_number asc, ranked.display_name asc;
$function$;

CREATE OR REPLACE FUNCTION private.approved_5b0a25288066bb9f135b9f21(p_event_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(event_id uuid, athlete_id uuid, created_at timestamp with time zone, display_name text, avatar jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select
    attendee.event_id,
    attendee.athlete_id,
    attendee.created_at,
    profile.display_name,
    profile.avatar
  from public.event_attendees attendee
  join public.dashboard_items event on event.id = attendee.event_id
  join public.profiles profile on profile.id = attendee.athlete_id
  where (select auth.uid()) is not null
    and (p_event_ids is null or attendee.event_id = any(p_event_ids))
    and private.jkcrew_team_event_visible(event.id) and private.jkcrew_same_team_profile(attendee.athlete_id) and event.item_type = 'event'
    and event.completed = false
    and coalesce(event.end_at, event.due_at + interval '1 day', 'infinity'::timestamptz) >= now()
  order by attendee.created_at;
$function$;

CREATE OR REPLACE FUNCTION private.approved_241219b18d01dffc792f95b3(p_search text DEFAULT ''::text, p_limit integer DEFAULT 24, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, title text, details text, due_at timestamp with time zone, end_at timestamp with time zone, completed boolean, effective_finished_at timestamp with time zone, course_photo_available boolean)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.profiles profile
    where profile.id = (select auth.uid()) and profile.role in ('coach', 'admin')
  ) then
    raise exception 'Only coaches can view past events.' using errcode = '42501';
  end if;

  return query
  select event.id, event.title, event.details, event.due_at, event.end_at, event.completed,
    case when event.completed then
      least(coalesce(event.end_at, event.due_at + interval '1 day', event.updated_at), event.updated_at)
    else coalesce(event.end_at, event.due_at + interval '1 day') end as effective_finished_at,
    exists (select 1 from public.event_course_photos photo where photo.event_id = event.id) as course_photo_available
  from public.dashboard_items event
  where private.jkcrew_team_event_visible(event.id) and event.item_type = 'event'
    and (event.completed or coalesce(event.end_at, event.due_at + interval '1 day', 'infinity'::timestamptz) < now())
    and strpos(lower(concat_ws(' ', event.title, event.details)), lower(btrim(left(coalesce(p_search, ''), 120)))) > 0
  order by effective_finished_at desc nulls last, event.id desc
  limit least(50, greatest(1, coalesce(p_limit, 24)))
  offset greatest(0, coalesce(p_offset, 0));
end;
$function$;

CREATE OR REPLACE FUNCTION private.approved_3aca7be9367bed30b0e5b1c2()
 RETURNS TABLE(feed_type text, body text, author_id uuid, author_name text, avatar jsonb, points integer, created_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select cp.post_type,cp.body,cp.author_id,
    coalesce(nullif(cp.metadata->>'author_name',''),p.display_name),
    coalesce(cp.metadata->'avatar',p.avatar),null::integer,cp.created_at
  from public.crew_posts cp join public.profiles p on p.id=cp.author_id
  where private.jkcrew_same_team_profile(cp.author_id) and private.jkcrew_crew_post_allowed(cp.metadata) and (
    cp.metadata->>'event_type' is null
    or (cp.metadata->>'event_type' in ('rank_one','leaderboard_overtake','challenge_complete','battle_result')
      and not coalesce(p.ghost_mode,false))
  )
  order by cp.created_at desc limit 60;
$function$;

CREATE OR REPLACE FUNCTION private.approved_06feae770160c620d54360ca(p_title text, p_description text, p_category text, p_target_count integer, p_audience_group text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_user_id uuid := auth.uid(); v_id uuid; v_start timestamptz;
begin
  if not exists (select 1 from public.profiles where id = v_user_id and role in ('coach','admin')) then raise exception 'Only coaches can create weekly challenges'; end if;
  if p_category not in ('daily','one_bang','dialled','lines','percentage','foam_pit','bonus','trick_links') then raise exception 'Choose a valid sheet category'; end if;
  if p_target_count not between 1 and 50 then raise exception 'Choose a target from 1 to 50'; end if;
  v_start := date_trunc('day', timezone('Australia/Brisbane', now())) at time zone 'Australia/Brisbane';
  update public.weekly_challenges set status = 'archived' where status = 'active' and private.jkcrew_profiles_share_team(v_user_id,created_by);
  insert into public.weekly_challenges (title, description, category, target_count, audience_group, starts_at, ends_at, created_by)
  values (trim(p_title), trim(coalesce(p_description,'')), p_category, p_target_count, nullif(trim(coalesce(p_audience_group,'')),''), v_start, v_start + interval '7 days', v_user_id)
  returning id into v_id;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION private.create_three_sided_rider_battle(p_team_one uuid[], p_team_two uuid[], p_team_three uuid[] DEFAULT '{}'::uuid[], p_duration_days integer DEFAULT 7, p_reward_points integer DEFAULT 5)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_is_coach boolean;
  v_size integer := coalesce(cardinality(p_team_one), 0);
  v_second_size integer := coalesce(cardinality(p_team_two), 0);
  v_team_count integer := case when coalesce(cardinality(p_team_three),0) > 0 then 3 else 2 end;
  v_all uuid[];
  v_athlete uuid;
  v_battle_id uuid;
  v_week_start date := ((date_trunc('week', timezone('Australia/Brisbane', now()) + interval '1 day') - interval '1 day')::date);
begin
  if v_user_id is null then raise exception 'You must be signed in'; end if;
  select role in ('coach', 'admin') into v_is_coach from public.profiles where id = v_user_id;
  if not (
    (v_size between 1 and 6 and v_second_size = v_size
      and (v_team_count = 2 or cardinality(p_team_three) = v_size))
    or (v_team_count = 2 and ((v_size = 2 and v_second_size = 1)
      or (v_size = 1 and v_second_size = 2)))
  ) then
    raise exception 'Choose 2v1, 1v2, or two or three equal teams with 1 to 6 riders on each team';
  end if;
  if coalesce(p_duration_days,0) not between 1 and 7 then raise exception 'Choose a battle length from 1 to 7 days'; end if;
  if coalesce(p_reward_points, 0) not between 1 and greatest(20, v_size * 5) then
    raise exception 'Choose a battle value from 1 to % points for this team size', greatest(20, v_size * 5);
  end if;
  v_all := p_team_one || p_team_two || coalesce(p_team_three,'{}'::uuid[]);
  if (select count(distinct chosen.rider_id) from unnest(v_all) as chosen(rider_id)) <> cardinality(v_all) then raise exception 'Each rider can only appear once'; end if;
  if not coalesce(v_is_coach, false) and not (v_user_id = any(p_team_one)) then raise exception 'Your own team must include you'; end if;
  if not coalesce(v_is_coach, false) and not exists (select 1 from public.profiles where id = v_user_id and role = 'athlete') then raise exception 'Only riders or coaches can create battles'; end if;

  for v_athlete in select chosen from unnest(v_all) chosen order by chosen loop
    if not private.jkcrew_same_team_profile(v_athlete) then raise exception 'Choose riders within your private team.' using errcode='42501'; end if;
    if not exists (select 1 from public.profiles where id = v_athlete and role = 'athlete' and not coalesce(ghost_mode, false)) then raise exception 'One selected rider is unavailable'; end if;
    if coalesce(v_is_coach, false) and not exists (select 1 from public.coach_athletes where coach_id = v_user_id and athlete_id = v_athlete) then raise exception 'You can only create battles for riders in your crew'; end if;
    perform pg_advisory_xact_lock(hashtextextended(v_athlete::text, 0));
    if (select count(distinct participant.battle_id)
        from public.weekly_rider_battle_participants participant
        join public.weekly_rider_battles battle on battle.id = participant.battle_id
        where participant.athlete_id = v_athlete and battle.status in ('pending', 'accepted')) >= 3 then
      raise exception 'Every rider can have a maximum of 3 active battles';
    end if;
  end loop;

  insert into public.weekly_rider_battles (
    challenger_id, opponent_id, week_start, duration_days, reward_points, created_by, battle_size, team_count, status
  ) values (p_team_one[1], p_team_two[1], v_week_start, p_duration_days, p_reward_points, v_user_id, v_size, v_team_count, 'pending')
  returning id into v_battle_id;

  insert into public.weekly_rider_battle_participants (battle_id, athlete_id, team_number, response, responded_at)
  select v_battle_id, rider_id, 1,
    case when not coalesce(v_is_coach, false) and rider_id = v_user_id then 'accepted' else 'pending' end,
    case when not coalesce(v_is_coach, false) and rider_id = v_user_id then now() else null end
  from unnest(p_team_one) rider_id;
  insert into public.weekly_rider_battle_participants (battle_id, athlete_id, team_number, response)
  select v_battle_id, rider_id, 2, 'pending' from unnest(p_team_two) rider_id;

  insert into public.weekly_rider_battle_participants (battle_id, athlete_id, team_number, response)
  select v_battle_id, rider_id, 3, 'pending' from unnest(p_team_three) rider_id;

  insert into public.push_notification_queue (recipient_id, notification_type, title, body, url, payload, dedupe_key)
  select participant.athlete_id, 'rider_battle_request',
    'New ' || array_to_string(case when v_team_count = 3 then array[v_size,v_second_size,cardinality(p_team_three)] else array[v_size,v_second_size] end,'v') || ' battle',
    coalesce(creator.display_name, 'Coach JK') || ' invited you to a ' || p_duration_days || '-day battle for ' || (p_reward_points * (v_team_count - 1)) || ' winning points. Tap to accept or decline.',
    './?push=challenges', jsonb_build_object('view', 'challenges', 'battle_id', v_battle_id, 'reward_points', p_reward_points),
    'rider-battle:' || v_battle_id::text || ':' || participant.athlete_id::text
  from public.weekly_rider_battle_participants participant
  left join public.profiles creator on creator.id = v_user_id
  where participant.battle_id = v_battle_id and participant.response = 'pending'
  on conflict (dedupe_key) do nothing;
  return v_battle_id;
end;
$function$;

CREATE OR REPLACE FUNCTION private.coach_update_contest_event_internal(p_event_id uuid, p_title text, p_details text, p_due_at timestamp with time zone, p_end_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := (select auth.uid());
  v_role text;
  v_event public.dashboard_items;
  v_updated public.dashboard_items;
begin
  if v_user_id is null then raise exception 'You must be signed in'; end if;
  if p_event_id is null then raise exception 'Choose an event to edit'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 3 and 120 then raise exception 'Event name must be 3 to 120 characters'; end if;
  if char_length(coalesce(p_details, '')) > 180 then raise exception 'Event details must be 180 characters or less'; end if;
  if p_due_at is null then raise exception 'Add the event start date'; end if;
  if p_end_at is not null and p_end_at < p_due_at then raise exception 'The event finish must be after it starts'; end if;

  select profile.role into v_role
  from public.profiles profile
  where profile.id = v_user_id;

  if v_role not in ('coach', 'admin') then raise exception 'Only coaches can edit events'; end if;

  select event.* into v_event
  from public.dashboard_items event
  where event.id = p_event_id
  for update;

  if v_event.id is null or v_event.item_type <> 'event' or v_event.completed then
    raise exception 'That upcoming event no longer exists';
  end if;

  if not private.jkcrew_team_event_visible(v_event.id) then raise exception 'This event belongs to another private team.' using errcode='42501'; end if;



  update public.dashboard_items event
  set title = btrim(p_title),
      details = btrim(coalesce(p_details, '')),
      due_at = p_due_at,
      end_at = p_end_at,
      updated_at = now()
  where event.id = p_event_id
  returning event.* into v_updated;

  insert into private.event_edit_audit (
    event_id,
    changed_by,
    event_before,
    event_after
  ) values (
    p_event_id,
    v_user_id,
    to_jsonb(v_event),
    to_jsonb(v_updated)
  );

  return p_event_id;
exception
  when unique_violation then
    raise exception 'An event with that name and start date already exists. Merge the duplicate events instead.';
end;
$function$;

CREATE OR REPLACE FUNCTION private.merge_contest_events_internal(p_source_event_id uuid, p_target_event_id uuid, p_title text, p_details text, p_due_at timestamp with time zone, p_end_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := (select auth.uid());
  v_role text;
  v_source public.dashboard_items;
  v_target public.dashboard_items;
begin
  if v_user_id is null then raise exception 'You must be signed in'; end if;
  if p_source_event_id is null or p_target_event_id is null or p_source_event_id = p_target_event_id then
    raise exception 'Choose two different events to merge';
  end if;

  select profile.role into v_role from public.profiles profile where profile.id = v_user_id;
  if v_role not in ('coach', 'admin') then raise exception 'Only coaches can merge events'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 3 and 120 then raise exception 'Event name must be 3 to 120 characters'; end if;
  if char_length(coalesce(p_details, '')) > 180 then raise exception 'Event details must be 180 characters or less'; end if;
  if p_due_at is null then raise exception 'Add the event start date'; end if;
  if p_end_at is not null and p_end_at < p_due_at then raise exception 'The event finish must be after it starts'; end if;

  perform 1
  from public.dashboard_items event
  where event.id = any(array[p_source_event_id, p_target_event_id])
  order by event.id
  for update;

  select event.* into v_source from public.dashboard_items event where event.id = p_source_event_id;
  select event.* into v_target from public.dashboard_items event where event.id = p_target_event_id;
  if v_source.id is null or v_target.id is null then raise exception 'One of those events no longer exists'; end if;
  if v_source.item_type <> 'event' or v_target.item_type <> 'event' then raise exception 'Only events can be merged'; end if;
  if v_source.completed or v_target.completed then raise exception 'Completed events cannot be merged'; end if;

  if not private.jkcrew_team_event_visible(v_source.id) or not private.jkcrew_team_event_visible(v_target.id) then raise exception 'Both events must belong to your private team.' using errcode='42501'; end if;



  insert into private.event_merge_audit (
    merged_by, source_event_id, target_event_id, source_event, target_event_before,
    source_attendees, source_run_plan_ids, source_course_photo, target_course_photo_before
  ) values (
    v_user_id,
    v_source.id,
    v_target.id,
    to_jsonb(v_source),
    to_jsonb(v_target),
    coalesce((select jsonb_agg(to_jsonb(attendee)) from public.event_attendees attendee where attendee.event_id = v_source.id), '[]'::jsonb),
    coalesce((select jsonb_agg(plan.id) from public.run_plans plan where plan.contest_item_id = v_source.id), '[]'::jsonb),
    (select to_jsonb(photo) from public.event_course_photos photo where photo.event_id = v_source.id),
    (select to_jsonb(photo) from public.event_course_photos photo where photo.event_id = v_target.id)
  );

  insert into public.event_attendees (event_id, athlete_id, created_at)
  select v_target.id, attendee.athlete_id, attendee.created_at
  from public.event_attendees attendee
  where attendee.event_id = v_source.id
  on conflict (event_id, athlete_id) do nothing;

  update public.run_plans plan
  set contest_item_id = v_target.id, updated_at = now()
  where plan.contest_item_id = v_source.id;

  insert into public.event_course_photos (event_id, image_data_url, updated_by, updated_at)
  select v_target.id, photo.image_data_url, photo.updated_by, photo.updated_at
  from public.event_course_photos photo
  where photo.event_id = v_source.id
  on conflict (event_id) do nothing;

  delete from public.dashboard_items event where event.id = v_source.id;

  update public.dashboard_items event
  set title = btrim(p_title), details = btrim(coalesce(p_details, '')),
      due_at = p_due_at, end_at = p_end_at, updated_at = now()
  where event.id = v_target.id;

  return v_target.id;
end;
$function$;


-- Past and personal battle cards follow the same whole-battle cohort rule.
CREATE OR REPLACE FUNCTION private.approved_ab3d02dab02e0ed98ab66e59()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  perform public.settle_expired_rider_battles();
  select coalesce(jsonb_agg(row_data order by (row_data->>'created_at')::timestamptz desc), '[]'::jsonb) into v_result
  from (
    select jsonb_build_object(
      'id', battle.id, 'week_start', battle.week_start, 'status', battle.status,
      'duration_days', battle.duration_days, 'starts_at', battle.starts_at, 'ends_at', battle.ends_at,
      'reward_points', battle.reward_points, 'battle_size', battle.battle_size, 'team_count', battle.team_count,
      'winning_team', battle.winning_team, 'created_at', battle.created_at,
      'participants', (
        select jsonb_agg(jsonb_build_object(
          'athlete_id', participant.athlete_id, 'team_number', participant.team_number, 'forfeited_at', participant.forfeited_at,
          'response', participant.response, 'is_winner', participant.is_winner,
          'points_delta', participant.points_delta, 'display_name', profile.display_name,
          'avatar', profile.avatar, 'level', profile.level,
          'battle_points', private.jkcrew_rider_battle_points(battle.id, participant.athlete_id),
          'score_allocations', private.jkcrew_rider_battle_score_allocations(battle.id, participant.athlete_id),
          'score_allocation_date', (select a.score_date from private.rider_battle_day_allocations a where a.battle_id = battle.id and a.athlete_id = participant.athlete_id),
          'weekly_points', private.jkcrew_rider_battle_points(battle.id, participant.athlete_id)
        ) order by participant.team_number, profile.display_name)
        from public.weekly_rider_battle_participants participant
        join public.profiles profile on profile.id = participant.athlete_id
        where participant.battle_id = battle.id
      )
    ) row_data
    from public.weekly_rider_battles battle
    where private.jkcrew_team_battle_visible(battle.id) and exists (select 1 from public.weekly_rider_battle_participants mine where mine.battle_id = battle.id and mine.athlete_id = auth.uid())
  ) rows;
  return v_result;
end;
$function$;
CREATE OR REPLACE FUNCTION private.approved_247f46ef13a8592d9fb5c160(p_limit integer DEFAULT 100)
 RETURNS TABLE(id uuid, challenger_id uuid, challenger_name text, opponent_id uuid, opponent_name text, week_start date, status text, duration_days integer, starts_at timestamp with time zone, ends_at timestamp with time zone, winner_id uuid, reward_points integer, responded_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then raise exception 'You must be signed in'; end if;
  if not exists (
    select 1 from public.profiles
    where profiles.id = v_user_id
      and profiles.role in ('coach', 'admin')
  ) then
    raise exception 'Only coaches can view rider battles';
  end if;

  return query
  select
    battle.id,
    battle.challenger_id,
    challenger.display_name,
    battle.opponent_id,
    opponent.display_name,
    battle.week_start,
    battle.status,
    battle.duration_days,
    battle.starts_at,
    battle.ends_at,
    battle.winner_id,
    battle.reward_points,
    battle.responded_at,
    battle.created_at,
    battle.updated_at
  from public.weekly_rider_battles battle
  join public.profiles challenger on challenger.id = battle.challenger_id
  join public.profiles opponent on opponent.id = battle.opponent_id
  where private.jkcrew_team_battle_visible(battle.id) and exists (
    select 1
    from public.coach_athletes link
    where link.coach_id = v_user_id
      and link.athlete_id in (battle.challenger_id, battle.opponent_id)
  )
  order by
    case battle.status when 'accepted' then 0 when 'pending' then 1 when 'completed' then 2 else 3 end,
    coalesce(battle.ends_at, battle.created_at) desc
  limit least(greatest(coalesce(p_limit, 100), 1), 250);
end;
$function$;
CREATE OR REPLACE FUNCTION private.approved_62c8b56b3a620c7b49a107ab(p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
begin
  if not exists (
    select 1 from public.profiles
    where id = v_user_id and role in ('coach', 'admin')
  ) then raise exception 'Only coaches can view rider battles'; end if;

  perform public.settle_expired_rider_battles();

  select coalesce(
    jsonb_agg(row_data order by (row_data->>'created_at')::timestamptz desc),
    '[]'::jsonb
  ) into v_result
  from (
    select jsonb_build_object(
      'id', battle.id,
      'status', battle.status,
      'duration_days', battle.duration_days,
      'starts_at', battle.starts_at,
      'ends_at', battle.ends_at,
      'reward_points', battle.reward_points,
      'battle_size', battle.battle_size, 'team_count', battle.team_count,
      'winning_team', battle.winning_team,
      'created_at', battle.created_at,
      'archived_at', battle.archived_at,
      'archived_by', battle.archived_by,
      'participants', (
        select jsonb_agg(jsonb_build_object(
          'athlete_id', participant.athlete_id,
          'team_number', participant.team_number, 'forfeited_at', participant.forfeited_at,
          'response', participant.response,
          'is_winner', participant.is_winner,
          'points_delta', participant.points_delta,
          'display_name', profile.display_name,
          'avatar', profile.avatar,
          'battle_points', private.jkcrew_rider_battle_points(battle.id, participant.athlete_id),
          'score_allocations', private.jkcrew_rider_battle_score_allocations(battle.id, participant.athlete_id),
          'score_allocation_date', (select a.score_date from private.rider_battle_day_allocations a where a.battle_id = battle.id and a.athlete_id = participant.athlete_id),
          'weekly_points', private.jkcrew_rider_battle_points(battle.id, participant.athlete_id),
          'coach_can_respond', exists (
            select 1 from public.coach_athletes link
            where link.coach_id = v_user_id
              and link.athlete_id = participant.athlete_id
          )
        ) order by participant.team_number, profile.display_name)
        from public.weekly_rider_battle_participants participant
        join public.profiles profile on profile.id = participant.athlete_id
        where participant.battle_id = battle.id
      )
    ) row_data
    from public.weekly_rider_battles battle
    where private.jkcrew_team_battle_visible(battle.id) and exists (
      select 1
      from public.weekly_rider_battle_participants participant
      join public.coach_athletes link on link.athlete_id = participant.athlete_id
      where participant.battle_id = battle.id and link.coach_id = v_user_id
    )
    order by
      case when battle.status in ('pending', 'accepted') then 0 else 1 end,
      battle.created_at desc
    limit least(greatest(coalesce(p_limit, 100), 1), 250)
  ) rows;

  return v_result;
end;
$function$;


-- Existing unlinked rider/parent accounts can accept a family admission code
-- without recreating their login or exposing a public account directory.
create function public.join_team_registration(p_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare invitation private.coach_team_invites; actual_role text;
begin
  select role::text into actual_role from public.profiles where id=auth.uid();
  if actual_role is null or actual_role not in ('athlete','parent') then raise exception 'Rider or parent sign-in required.' using errcode='42501'; end if;
  select * into invitation from private.coach_team_invites where code_hash=sha256(convert_to(upper(btrim(p_code)),'UTF8')) for update;
  if invitation.team_id is null or invitation.role<>actual_role or invitation.consumed_at is not null or invitation.expires_at<=now()
    or not private.jkcrew_actor_approved(invitation.created_by)
    or not exists(select 1 from private.coach_team_memberships inviter where inviter.coach_id=invitation.created_by and inviter.team_id=invitation.team_id and inviter.status='active') then raise exception 'That team invitation is invalid or expired.' using errcode='42501'; end if;
  if exists(select 1 from private.jkcrew_user_team_ids(auth.uid()) t where t.team_id<>invitation.team_id) then raise exception 'This account already belongs to another private team.' using errcode='42501'; end if;
  update auth.users set raw_app_meta_data=coalesce(raw_app_meta_data,'{}')||jsonb_build_object('registered_coach_id',invitation.created_by) where id=auth.uid();
  update private.coach_team_invites set consumed_by=auth.uid(),consumed_at=now() where code_hash=invitation.code_hash;
  return jsonb_build_object('status','registered','role',actual_role,'team_id',invitation.team_id);
end $$;
revoke all on function public.join_team_registration(text) from public,anon;
grant execute on function public.join_team_registration(text) to authenticated;

CREATE OR REPLACE FUNCTION private.parent_active_rider_battles(p_athlete_id uuid, p_limit integer DEFAULT 24, p_after_ends_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_viewer uuid := auth.uid();
  v_role text;
  v_now timestamptz := now();
  v_limit integer := least(greatest(coalesce(p_limit, 24), 1), 24);
  v_result jsonb;
begin
  select profile.role::text into v_role from public.profiles profile where profile.id = v_viewer;
  if v_viewer is null or v_role is distinct from 'parent'
     or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then
    raise exception 'Sign in as a linked parent to view this rider''s battles.' using errcode = '42501';
  end if;
  -- Verify the current link and access state inside the definer helper on every
  -- request, including cursor pages. Parent access never exposes the raw tables.
  if private.rider_features_disabled() or private.rider_recovery_active(v_viewer) then
    raise exception 'This feature is not available for this account. Contact your coach.' using errcode = '42501';
  end if;
  if p_athlete_id is null or not exists (
    select 1 from public.parent_athletes link
    join public.profiles child on child.id = link.athlete_id and child.role::text = 'athlete'
    where link.parent_id = v_viewer and link.athlete_id = p_athlete_id
      and not private.rider_recovery_active(child.id)
      and not exists (select 1 from private.rider_feature_access access
        where access.athlete_id = child.id and access.features_disabled)
  ) then
    raise exception 'This rider''s battles are not available to your account.' using errcode = '42501';
  end if;
  if (p_after_ends_at is null) <> (p_after_id is null) then
    raise exception 'Supply both active battle cursor fields.' using errcode = '22023';
  end if;

  with candidates as materialized (
    select battle.id, battle.starts_at, battle.ends_at, battle.duration_days,
      battle.reward_points, battle.battle_size, battle.team_count
    from public.weekly_rider_battles battle
    where private.jkcrew_team_battle_visible(battle.id) and battle.status = 'accepted' and battle.archived_at is null
      and exists (select 1 from public.weekly_rider_battle_participants child
        where child.battle_id = battle.id and child.athlete_id = p_athlete_id
          and child.forfeited_at is null)
      and battle.starts_at <= v_now and battle.ends_at > v_now
      and (p_after_ends_at is null or (battle.ends_at, battle.id) > (p_after_ends_at, p_after_id))
    order by battle.ends_at, battle.id
    limit v_limit + 1
  ), page as materialized (
    select * from candidates order by ends_at, id limit v_limit
  ), summaries as (
    select page.id, page.ends_at, jsonb_build_object(
      'id', page.id, 'starts_at', page.starts_at, 'ends_at', page.ends_at,
      'duration_days', page.duration_days, 'reward_points', page.reward_points,
      'battle_size', page.battle_size, 'team_count', page.team_count,
      'format', detail.format, 'participants', detail.participants, 'teams', detail.teams
    ) as data
    from page
    cross join lateral (
      with members as materialized (
        select participant.athlete_id, participant.team_number, participant.forfeited_at,
          profile.display_name,
          coalesce(profile.ghost_mode, false) and not exists (
            select 1 from public.parent_athletes link
            where link.parent_id = v_viewer and link.athlete_id = participant.athlete_id
          ) as hidden
        from public.weekly_rider_battle_participants participant
        join public.profiles profile on profile.id = participant.athlete_id
        where participant.battle_id = page.id
      ), source_scores as materialized (
        -- The same source and forfeiture rules as battle settlement and the live cards.
        -- A session-day allocation can contribute to a different team from its roster.
        select private.jkcrew_rider_battle_score_allocations(page.id, athlete_id) as allocation
        from members where forfeited_at is null
      ), team_scores as (
        select member.team_number, count(*) as rider_count,
          bool_and(member.forfeited_at is not null) as forfeited,
          (select coalesce(sum((source.allocation->>member.team_number::text)::integer), 0)
           from source_scores source) as score
        from members member group by member.team_number
      )
      select
        (select coalesce(jsonb_agg(jsonb_build_object(
          'athlete_id', case when hidden then null else athlete_id end, 'team_number', team_number,
          'display_name', case when hidden then 'Private rider' else display_name end, 'forfeited_at', forfeited_at
        ) order by team_number, display_name, athlete_id), '[]'::jsonb) from members) as participants,
        (select coalesce(jsonb_agg(jsonb_build_object(
          'team_number', team_number, 'score', score, 'forfeited', forfeited
        ) order by team_number), '[]'::jsonb) from team_scores) as teams,
        (select string_agg(rider_count::text, 'v' order by team_number) from team_scores) as format
    ) detail
  )
  select jsonb_build_object(
    'athlete_id', p_athlete_id, 'server_now', v_now,
    'battles', coalesce((select jsonb_agg(data order by ends_at, id) from summaries), '[]'::jsonb),
    'has_more', (select count(*) > v_limit from candidates),
    'next_cursor', case when (select count(*) > v_limit from candidates) then
      (select jsonb_build_object('ends_at', ends_at, 'id', id) from page order by ends_at desc, id desc limit 1)
      else null end
  ) into v_result;
  return v_result;
end;
$function$;

-- Signed-in battle settlement is bounded to the caller's team; the cron job
-- (no user identity) continues settling each independent team's battles.
CREATE OR REPLACE FUNCTION private.settle_expired_rider_battles()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_battle record;
  v_prize_points integer;
  v_winning_team integer;
  v_winner_id uuid;
  v_settled integer := 0;
begin

  for v_battle in
    select battle.*
    from public.weekly_rider_battles battle
    where (auth.uid() is null or private.jkcrew_team_battle_visible(battle.id)) and battle.status = 'accepted' and battle.ends_at <= now()
    for update skip locked
  loop
    with eligible_teams as (
      select distinct team_number from public.weekly_rider_battle_participants
      where battle_id = v_battle.id and forfeited_at is null
    ), source_scores as materialized (
      select private.jkcrew_rider_battle_score_allocations(v_battle.id, athlete_id) as allocation
      from public.weekly_rider_battle_participants
      where battle_id = v_battle.id and forfeited_at is null
    ), scores as (
      select target.team_number, coalesce(sum((source.allocation
        ->> target.team_number::text)::integer), 0) as score
      from eligible_teams target cross join source_scores source
      group by target.team_number
    ), leaders as (select team_number from scores where score=(select max(score) from scores))
    select case when count(*)=1 then min(team_number) else null end into v_winning_team from leaders;
    v_prize_points := v_battle.reward_points * (v_battle.team_count - 1);
    select participant.athlete_id into v_winner_id
    from public.weekly_rider_battle_participants participant
    where participant.battle_id = v_battle.id and participant.team_number = v_winning_team
    order by participant.athlete_id limit 1;

    with ranked as (
      select participant.battle_id, participant.athlete_id, participant.team_number,
        row_number() over (partition by participant.team_number order by participant.athlete_id) as team_rank,
        count(*) over (partition by participant.team_number)::integer as team_size
      from public.weekly_rider_battle_participants participant
      where participant.battle_id = v_battle.id
    )
    update public.weekly_rider_battle_participants participant
    set is_winner = case when v_winning_team is null then null else participant.team_number = v_winning_team end,
        points_delta = case
          when v_winning_team is null then 0
          when participant.team_number = v_winning_team then
            (v_prize_points / ranked.team_size)
            + case when ranked.team_rank <= (v_prize_points % ranked.team_size) then 1 else 0 end
          else -((v_battle.reward_points / ranked.team_size)
            + case when ranked.team_rank <= (v_battle.reward_points % ranked.team_size) then 1 else 0 end)
        end
    from ranked
    where participant.battle_id = ranked.battle_id and participant.athlete_id = ranked.athlete_id;

    if v_winning_team is not null then
      insert into public.leaderboard_point_adjustments (athlete_id, coach_id, points, reason, week_start, created_at)
      select participant.athlete_id, coalesce(v_battle.created_by, v_battle.challenger_id), participant.points_delta,
        'Rider battle ' || v_battle.id::text || case when participant.points_delta > 0 then ' win' else ' loss' end,
        v_battle.week_start, now()
      from public.weekly_rider_battle_participants participant
      where participant.battle_id = v_battle.id and participant.points_delta <> 0;
    end if;

    update public.weekly_rider_battles
    set status = 'completed', winning_team = v_winning_team, winner_id = v_winner_id,
        responded_at = coalesce(responded_at, now()), updated_at = now()
    where id = v_battle.id;

    insert into public.push_notification_queue (recipient_id, notification_type, title, body, url, payload, dedupe_key)
    select participant.athlete_id, 'rider_battle_result',
      case when v_winning_team is null then 'Battle draw' when participant.team_number = v_winning_team then 'Battle won!' else 'Battle complete' end,
      case when v_winning_team is null then 'The battle finished level.'
           when participant.team_number = v_winning_team then 'Your team won. ' || abs(participant.points_delta) || ' leaderboard points were added.'
           else 'The other team won this battle. Time for the rematch.' end,
      './?push=challenges', jsonb_build_object('view', 'challenges', 'battle_id', v_battle.id),
      'rider-battle-result:' || v_battle.id::text || ':' || participant.athlete_id::text
    from public.weekly_rider_battle_participants participant
    where participant.battle_id = v_battle.id
    on conflict (dedupe_key) do nothing;

    v_settled := v_settled + 1;
  end loop;
  return v_settled;
end;
$function$;
CREATE OR REPLACE FUNCTION private.approved_38e25e2b5074e5a2bd6983da(p_athlete_id uuid)
 RETURNS TABLE(wins bigint, losses bigint, win_percent integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if not exists (select 1 from public.profiles where id = p_athlete_id and role = 'athlete') then raise exception 'Rider not found'; end if;
  return query
  with record as (
    select count(*) filter (where participant.is_winner)::bigint as wins,
      count(*) filter (where participant.is_winner = false)::bigint as losses
    from public.weekly_rider_battle_participants participant
    join public.weekly_rider_battles battle on battle.id = participant.battle_id
    where participant.athlete_id = p_athlete_id and private.jkcrew_team_battle_visible(battle.id) and battle.status = 'completed'
  )
  select record.wins, record.losses,
    case when record.wins + record.losses = 0 then 0 else round(100.0 * record.wins / (record.wins + record.losses))::integer end
  from record;
end;
$function$;
CREATE OR REPLACE FUNCTION private.approved_8e03a37799b7a5005e4116b1()
 RETURNS TABLE(wins bigint, losses bigint, win_percent integer)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with record as (
    select count(*) filter (where participant.is_winner)::bigint wins,
      count(*) filter (where participant.is_winner = false)::bigint losses
    from public.weekly_rider_battle_participants participant
    join public.weekly_rider_battles battle on battle.id = participant.battle_id
    where participant.athlete_id = auth.uid() and private.jkcrew_team_battle_visible(battle.id) and battle.status = 'completed'
  )
  select wins, losses, case when wins + losses = 0 then 0 else round(100.0 * wins / (wins + losses))::integer end from record;
$function$;

-- Notifications keep their original history, but visibility and delivery follow
-- the current approved team. These guards also apply to SECURITY DEFINER jobs.
create or replace function private.jkcrew_notification_uuid(p_value text)
returns uuid language plpgsql immutable security invoker set search_path='' as $$
begin
  return nullif(p_value,'')::uuid;
exception when invalid_text_representation then return null;
end;
$$;
revoke all on function private.jkcrew_notification_uuid(text) from public,anon,authenticated;

create or replace function private.jkcrew_notification_subject_allowed(p_recipient uuid,p_athlete uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select p_recipient is not null and p_athlete is not null
    and private.jkcrew_actor_approved(p_recipient)
    and exists(select 1 from public.profiles subject where subject.id=p_athlete and subject.role::text='athlete')
    and exists(select 1 from public.profiles recipient where recipient.id=p_recipient and (
      recipient.id=p_athlete
      or (recipient.role::text in ('coach','admin') and private.jkcrew_profiles_share_team(p_recipient,p_athlete))
      or (recipient.role::text='parent' and exists(select 1 from public.parent_athletes link
        where link.parent_id=p_recipient and link.athlete_id=p_athlete))
    ));
$$;
revoke all on function private.jkcrew_notification_subject_allowed(uuid,uuid) from public,anon,authenticated;

create or replace function private.jkcrew_notification_allowed(p_recipient uuid,p_type text,p_payload jsonb)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare
  v_payload jsonb:=coalesce(p_payload,'{}'::jsonb);
  source_id uuid;
  subject_id uuid;
  source_actor uuid;
  source_coach uuid;
  source_event uuid;
  claimed_actor uuid;
begin
  if p_recipient is null or not exists(select 1 from public.profiles where id=p_recipient)
    or not private.jkcrew_actor_approved(p_recipient) or jsonb_typeof(v_payload)<>'object' then return false; end if;
  -- These messages contain no other account's information. All private data
  -- notifications below must resolve a real source row before they are allowed.
  if p_type in ('daily_hype','notification_test','recovery_checkin_reminder') then return true; end if;
  if p_type='uci_qualification_update' then
    return exists(select 1 from private.uci_schedule_announcements announcement
      where announcement.source_id=v_payload->>'announcement_id'
        and announcement.payload->>'sourceUrl'=v_payload->>'source_url');
  end if;

  if p_type='park_king_changed' then
    source_id:=private.jkcrew_notification_uuid(v_payload->>'event_id');
    select event.athlete_id into source_actor from public.park_king_events event where event.id=source_id;
    claimed_actor:=private.jkcrew_notification_uuid(v_payload->>'athlete_id');
    return source_actor is not null and claimed_actor is not null and claimed_actor=source_actor
      and private.jkcrew_profiles_share_team(p_recipient,source_actor);
  elsif p_type='crew_chat' then
    source_id:=private.jkcrew_notification_uuid(v_payload->>'post_id');
    select post.author_id into source_actor from public.crew_posts post where post.id=source_id and post.post_type='chat';
    claimed_actor:=private.jkcrew_notification_uuid(v_payload->>'author_id');
    return source_actor is not null and claimed_actor is not null and claimed_actor=source_actor
      and private.jkcrew_profiles_share_team(p_recipient,source_actor);
  elsif p_type='leaderboard_overtaken' then
    -- Old rank snapshots were global; never reveal them under a new team scope.
    source_actor:=private.jkcrew_notification_uuid(v_payload->>'overtaken_by');
    return coalesce(v_payload->>'tenant_rank_version','')='1' and source_actor is not null
      and private.jkcrew_profiles_share_team(p_recipient,source_actor);
  elsif p_type in ('weekly_challenge_published','weekly_challenge_completed') then
    source_id:=private.jkcrew_notification_uuid(v_payload->>'challenge_id');
    select challenge.created_by into source_actor from public.weekly_challenges challenge where challenge.id=source_id;
    if source_actor is null or not private.jkcrew_profiles_share_team(p_recipient,source_actor) then return false; end if;
    if p_type='weekly_challenge_published' then return true; end if;
    subject_id:=private.jkcrew_notification_uuid(v_payload->>'athlete_id');
    if subject_id is null then subject_id:=p_recipient; end if;
    return private.jkcrew_notification_subject_allowed(p_recipient,subject_id)
      and exists(select 1 from public.weekly_challenge_completions completion
        where completion.challenge_id=source_id and completion.athlete_id=subject_id);
  elsif p_type in ('rider_battle_request','rider_battle_started','rider_battle_result','rider_battle_declined','rider_battle_deleted') then
    source_id:=private.jkcrew_notification_uuid(v_payload->>'battle_id');
    select coalesce(battle.created_by,battle.challenger_id) into source_actor from public.weekly_rider_battles battle where battle.id=source_id;
    return source_actor is not null and private.jkcrew_profiles_share_team(p_recipient,source_actor)
      and exists(select 1 from public.weekly_rider_battle_participants participant where participant.battle_id=source_id
        and private.jkcrew_notification_subject_allowed(p_recipient,participant.athlete_id))
      and not exists(select 1 from public.weekly_rider_battle_participants participant where participant.battle_id=source_id
        and not private.jkcrew_profiles_share_team(p_recipient,participant.athlete_id));
  elsif p_type in ('event_reminder','event_updated') then
    source_id:=private.jkcrew_notification_uuid(v_payload->>'event_id');
    select coalesce(item.created_by,item.owner_id) into source_actor from public.dashboard_items item where item.id=source_id and item.item_type='event';
    return source_actor is not null and private.jkcrew_profiles_share_team(p_recipient,source_actor);
  elsif p_type='event_run_planned' then
    source_id:=private.jkcrew_notification_uuid(v_payload->>'run_plan_id');
    select plan.athlete_id,plan.coach_id,plan.contest_item_id into subject_id,source_coach,source_event
      from public.run_plans plan where plan.id=source_id;
    if source_event is distinct from private.jkcrew_notification_uuid(v_payload->>'event_id')
      or subject_id is distinct from private.jkcrew_notification_uuid(v_payload->>'athlete_id') then return false; end if;
    select coalesce(item.created_by,item.owner_id) into source_actor from public.dashboard_items item where item.id=source_event;
    return private.jkcrew_notification_subject_allowed(p_recipient,subject_id)
      and source_coach is not null and private.jkcrew_profiles_share_team(p_recipient,source_coach)
      and source_actor is not null and private.jkcrew_profiles_share_team(p_recipient,source_actor);
  elsif p_type in ('video_review_requested','video_review_returned') then
    source_id:=private.jkcrew_notification_uuid(v_payload->>'request_id');
    select request.athlete_id,request.coach_id into subject_id,source_coach from public.trick_help_requests request where request.id=source_id;
    return private.jkcrew_notification_subject_allowed(p_recipient,subject_id)
      and source_coach is not null and private.jkcrew_profiles_share_team(p_recipient,source_coach);
  elsif p_type in ('list_request_sent','list_request_approved','list_request_declined') then
    source_id:=private.jkcrew_notification_uuid(v_payload->>'proposal_id');
    select proposal.athlete_id,proposal.coach_id into subject_id,source_coach from public.rider_sheet_proposals proposal where proposal.id=source_id;
    return private.jkcrew_notification_subject_allowed(p_recipient,subject_id)
      and source_coach is not null and private.jkcrew_profiles_share_team(p_recipient,source_coach);
  elsif p_type in ('live_run_invite','live_run_response') then
    source_id:=private.jkcrew_notification_uuid(v_payload->>'live_run_id');
    select live.athlete_id,live.coach_id into subject_id,source_coach from public.run_live_sessions live where live.id=source_id;
    return private.jkcrew_notification_subject_allowed(p_recipient,subject_id)
      and source_coach is not null and private.jkcrew_profiles_share_team(p_recipient,source_coach);
  elsif p_type='coach_message' then
    source_id:=private.jkcrew_notification_uuid(v_payload->>'broadcast_id');
    select broadcast.coach_id into source_actor from public.coach_broadcasts broadcast where broadcast.id=source_id;
    return source_actor is not null and private.jkcrew_profiles_share_team(p_recipient,source_actor)
      and exists(select 1 from public.coach_broadcast_recipients recipient where recipient.broadcast_id=source_id and recipient.recipient_id=p_recipient);
  elsif p_type='sheet_scheduled' then
    return exists(select 1 from public.weekly_assignment_plans plan
      where plan.athlete_id=p_recipient and plan.target_week_start::text=v_payload->>'week_start'
        and private.jkcrew_profiles_share_team(p_recipient,plan.coach_id));
  elsif p_type in ('daily_list_completed','trick_completed','parent_weekly_summary','parent_engagement_checkin') then
    subject_id:=private.jkcrew_notification_uuid(v_payload->>'athlete_id');
    if v_payload ? 'assignment_id' and v_payload->>'assignment_id' is not null then
      source_id:=private.jkcrew_notification_uuid(v_payload->>'assignment_id');
      select assignment.athlete_id into source_actor from public.weekly_trick_assignments assignment where assignment.id=source_id;
      if source_actor is not null and subject_id is distinct from source_actor then return false; end if;
    end if;
    return private.jkcrew_notification_subject_allowed(p_recipient,subject_id);
  end if;
  return false;
end;
$$;
revoke all on function private.jkcrew_notification_allowed(uuid,text,jsonb) from public,anon;
grant execute on function private.jkcrew_notification_allowed(uuid,text,jsonb) to authenticated,service_role;

create or replace function private.guard_notification_team_scope()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if private.jkcrew_notification_allowed(new.recipient_id,new.notification_type,new.payload) is not true then return null; end if;
  return new;
end;
$$;
revoke all on function private.guard_notification_team_scope() from public,anon,authenticated;
create trigger guard_notification_team_scope before insert on public.app_notifications
for each row execute function private.guard_notification_team_scope();
create trigger guard_notification_team_scope before insert on public.push_notification_queue
for each row execute function private.guard_notification_team_scope();

create policy notification_team_scope_guard on public.app_notifications as restrictive
for all to authenticated using (
  recipient_id=(select auth.uid()) and private.jkcrew_notification_allowed(recipient_id,notification_type,payload)
) with check (
  recipient_id=(select auth.uid()) and private.jkcrew_notification_allowed(recipient_id,notification_type,payload)
);
create policy notification_team_scope_guard on public.push_notification_queue as restrictive
for all to authenticated using (
  recipient_id=(select auth.uid()) and private.jkcrew_notification_allowed(recipient_id,notification_type,payload)
) with check (
  recipient_id=(select auth.uid()) and private.jkcrew_notification_allowed(recipient_id,notification_type,payload)
);

create or replace function public.validate_jkcrew_push_scope(p_notification_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.push_notification_queue notification
    where notification.id=p_notification_id and notification.status='processing'
      and private.jkcrew_notification_allowed(notification.recipient_id,notification.notification_type,notification.payload));
$$;
revoke all on function public.validate_jkcrew_push_scope(uuid) from public,anon,authenticated;
grant execute on function public.validate_jkcrew_push_scope(uuid) to service_role;

-- Retain the worker secret, XP/recovery semantics and SKIP LOCKED batching.
-- Old foreign pending/claimed rows are skipped, never delivered or deleted.
create or replace function public.claim_jkcrew_push_notifications(p_worker_secret text,p_limit integer default 50)
returns setof public.push_notification_queue language plpgsql security definer set search_path='' as $$
declare v_expected_secret text;
begin
  select decrypted_secret into v_expected_secret from vault.decrypted_secrets where name='jkcrew_push_worker_secret' limit 1;
  if v_expected_secret is null or p_worker_secret is distinct from v_expected_secret then raise exception 'Invalid push worker secret.'; end if;
  update public.push_notification_queue notification
    set status='skipped',processed_at=clock_timestamp(),last_error='Notification no longer belongs to an approved team recipient'
    where notification.status in ('pending','processing')
      and private.jkcrew_notification_allowed(notification.recipient_id,notification.notification_type,notification.payload) is not true;
  update public.push_notification_queue q set status='skipped',processed_at=clock_timestamp(),last_error='Reminder no longer due'
    where q.status='pending' and q.notification_type='recovery_checkin_reminder'
      and not private.recovery_reminder_due(q.recipient_id,q.payload->>'episode_id',q.payload->>'checkin_date');
  return query with selected as (
    select q.id from public.push_notification_queue q where q.status='pending' and q.available_at<=now()
      and private.jkcrew_notification_allowed(q.recipient_id,q.notification_type,q.payload)
      and (private.xp_progression_enabled() or not private.is_xp_progression_notification(q.notification_type,q.payload))
      and ((q.notification_type='recovery_checkin_reminder' and private.recovery_reminder_due(q.recipient_id,q.payload->>'episode_id',q.payload->>'checkin_date'))
        or (q.notification_type<>'recovery_checkin_reminder' and not private.rider_recovery_active(q.recipient_id)))
    order by q.created_at for update skip locked limit greatest(1,least(coalesce(p_limit,50),100))
  ) update public.push_notification_queue q set status='processing',attempts=q.attempts+1,processed_at=now()
    from selected where q.id=selected.id returning q.*;
end;
$$;
revoke all on function public.claim_jkcrew_push_notifications(text,integer) from public,anon,authenticated;
grant execute on function public.claim_jkcrew_push_notifications(text,integer) to service_role;

-- Rank calculations and snapshots are derived independently within each team.
CREATE OR REPLACE FUNCTION private.jkcrew_current_push_rankings()
 RETURNS TABLE(athlete_id uuid, display_name text, week_start date, weekly_points bigint, weekly_started boolean, rank_number bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
  with score_rows as (
    select
      p.id as athlete_id,
      p.display_name,
      b.week_start_date as week_start,
      greatest(
        0,
        coalesce(current_awards.points, 0)
        + coalesce(current_legacy_sessions.points, 0)
        + coalesce(current_adjustments.points, 0)
      )::bigint as weekly_points,
      (
        coalesce(current_awards.events, 0)
        + coalesce(current_legacy_sessions.events, 0)
        + coalesce(current_adjustments.events, 0)
      ) > 0 as weekly_started
    from public.profiles p
    cross join lateral public.jkcrew_week_bounds(p.country_code) b
    left join lateral (
      select coalesce(sum(apa.points), 0)::bigint as points, count(*)::bigint as events
      from public.assignment_point_awards apa
      where apa.athlete_id = p.id
        and apa.created_at >= b.week_start_ts
        and apa.created_at < b.next_week_start_ts
    ) current_awards on true
    left join lateral (
      select coalesce(sum(ts.total_points), 0)::bigint as points, count(*)::bigint as events
      from public.training_sessions ts
      where ts.athlete_id = p.id
        and ts.started_at >= b.week_start_ts
        and ts.started_at < b.next_week_start_ts
        and coalesce(ts.total_points, 0) <> 0
        and not exists (
          select 1 from public.assignment_point_awards apa where apa.session_id = ts.id
        )
    ) current_legacy_sessions on true
    left join lateral (
      select coalesce(sum(lpa.points), 0)::bigint as points, count(*)::bigint as events
      from public.leaderboard_point_adjustments lpa
      where lpa.athlete_id = p.id
        and lpa.week_start = b.week_start_date
        and coalesce(lpa.reason, '') not ilike 'All-time score correction%'
    ) current_adjustments on true
    where p.role = 'athlete'
      and private.jkcrew_profile_team_id(p.id) is not null
      and coalesce(p.ghost_mode, false) = false
  ), ranked as (
    select
      score_rows.*,
      rank() over (
        partition by private.jkcrew_profile_team_id(score_rows.athlete_id)
        order by
          case when score_rows.weekly_started or score_rows.weekly_points > 0 then 0 else 1 end,
          score_rows.weekly_points desc,
          score_rows.display_name asc
      ) as rank_number
    from score_rows
  )
  select
    ranked.athlete_id,
    ranked.display_name,
    ranked.week_start,
    ranked.weekly_points,
    (ranked.weekly_started or ranked.weekly_points > 0) as weekly_started,
    ranked.rank_number
  from ranked;
$function$;

revoke all on function private.jkcrew_current_push_rankings() from public,anon,authenticated;
CREATE OR REPLACE FUNCTION private.refresh_jkcrew_leaderboard_push_snapshots(p_changed_athlete uuid, p_event_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'vault'
AS $function$
begin
  insert into public.push_notification_queue (
    recipient_id,
    notification_type,
    title,
    body,
    url,
    payload,
    dedupe_key
  )
  select
    current_rank.athlete_id,
    'leaderboard_overtaken',
    'You were overtaken',
    case
      when passer.athlete_id is not null
        then passer.display_name || ' moved ahead of you. You are now #' || current_rank.rank_number || ' with ' || current_rank.weekly_points || ' points.'
      else 'The leaderboard changed. You are now #' || current_rank.rank_number || ' with ' || current_rank.weekly_points || ' points.'
    end,
    './?push=board',
    jsonb_build_object(
      'view', 'board',
      'tenant_rank_version', 1,
      'rank', current_rank.rank_number,
      'weekly_points', current_rank.weekly_points,
      'overtaken_by', passer.athlete_id
    ),
    'leaderboard-overtaken:' || p_event_key || ':' || current_rank.athlete_id
  from private.jkcrew_current_push_rankings() current_rank
  join public.leaderboard_rank_snapshots previous_rank
    on previous_rank.athlete_id = current_rank.athlete_id
   and previous_rank.week_start = current_rank.week_start
  left join private.jkcrew_current_push_rankings() passer
    on passer.athlete_id = p_changed_athlete
  left join public.leaderboard_rank_snapshots previous_passer
    on previous_passer.athlete_id = p_changed_athlete
   and previous_passer.week_start = previous_rank.week_start
  left join public.push_preferences preference
    on preference.user_id = current_rank.athlete_id
  where current_rank.athlete_id <> p_changed_athlete
    and private.jkcrew_profiles_share_team(current_rank.athlete_id,p_changed_athlete)
    and current_rank.weekly_started
    and current_rank.rank_number > previous_rank.rank_number
    and coalesce(preference.leaderboard_overtaken, true)
    and exists (
      select 1
      from public.push_subscriptions subscription
      where subscription.user_id = current_rank.athlete_id
        and subscription.enabled
    )
    and (
      passer.athlete_id is null
      or (
        passer.rank_number < current_rank.rank_number
        and (
          previous_passer.rank_number is null
          or previous_passer.rank_number >= previous_rank.rank_number
        )
      )
    )
  on conflict (dedupe_key) do nothing;

  insert into public.leaderboard_rank_snapshots (
    athlete_id,
    week_start,
    rank_number,
    weekly_points,
    weekly_started,
    updated_at
  )
  select
    current_rank.athlete_id,
    current_rank.week_start,
    current_rank.rank_number,
    current_rank.weekly_points,
    current_rank.weekly_started,
    now()
  from private.jkcrew_current_push_rankings() current_rank
  on conflict (athlete_id) do update set
    week_start = excluded.week_start,
    rank_number = excluded.rank_number,
    weekly_points = excluded.weekly_points,
    weekly_started = excluded.weekly_started,
    updated_at = excluded.updated_at;
exception when others then
  raise warning 'JKCREW leaderboard push refresh skipped: %', sqlerrm;
end;
$function$;

revoke all on function private.refresh_jkcrew_leaderboard_push_snapshots(uuid,text) from public,anon,authenticated;

insert into public.leaderboard_rank_snapshots(athlete_id,week_start,rank_number,weekly_points,weekly_started,updated_at)
select athlete_id,week_start,rank_number,weekly_points,weekly_started,now() from private.jkcrew_current_push_rankings()
on conflict(athlete_id) do update set week_start=excluded.week_start,rank_number=excluded.rank_number,
  weekly_points=excluded.weekly_points,weekly_started=excluded.weekly_started,updated_at=excluded.updated_at;
-- End tenant notification isolation.

-- Park crowns are calculated within each private team before choosing a winner.
-- The legacy global snapshots and all award/history rows are retained.
create table if not exists private.team_park_king_snapshots (
  team_id uuid not null,
  venue_key text not null,
  venue_name text not null,
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  display_name text not null,
  avatar jsonb not null default '{}'::jsonb,
  points integer not null,
  updated_at timestamptz not null default now(),
  primary key(team_id, venue_key)
);
alter table private.team_park_king_snapshots enable row level security;
revoke all on private.team_park_king_snapshots from public, anon, authenticated;

CREATE OR REPLACE FUNCTION private.jkcrew_current_park_king_for_team(p_team uuid, p_venue text)
 RETURNS TABLE(venue_key text, venue_name text, athlete_id uuid, display_name text, avatar jsonb, points integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  with requested as (
    select private.jkcrew_venue_key(p_venue) as venue_key
  ), eligible_sessions as (
    select distinct award.session_id
    from public.assignment_point_awards award
    cross join requested
    where award.session_id is not null
      and requested.venue_key <> ''
      and btrim(award.venue) <> ''
      and private.jkcrew_venue_key(award.venue) = requested.venue_key
  ), session_awards as (
    select
      session.id as session_id,
      session.athlete_id,
      award.created_at,
      award.points,
      split_part(award.award_key, ':', 1) as award_type,
      private.jkcrew_venue_key(award.venue) as venue_key,
      btrim(award.venue) as venue_name,
      (award.created_at at time zone public.jkcrew_country_timezone(profile.country_code))::date as riding_day
    from eligible_sessions eligible
    join public.training_sessions session on session.id = eligible.session_id
    join public.profiles profile on profile.id = session.athlete_id and profile.role = 'athlete'
      and private.jkcrew_profile_team_id(profile.id) = p_team
    join public.assignment_point_awards award
      on award.session_id = session.id
     and award.athlete_id = session.athlete_id
  ), session_day_venues as (
    -- Older Lines awards have no venue. Retain them only if the same session
    -- and day have exactly one known park; never guess across multiple parks.
    select session_id, riding_day,
      count(distinct venue_key) filter (where venue_key <> '') as venue_count,
      max(venue_key) filter (where venue_key <> '') as venue_key,
      max(venue_name) filter (where venue_key <> '') as venue_name
    from session_awards
    group by session_id, riding_day
  ), located_awards as (
    select award.*,
      case when award.venue_key <> '' then award.venue_key
        when locations.venue_count = 1 then locations.venue_key else '' end as resolved_venue_key,
      case when award.venue_key <> '' then award.venue_name
        when locations.venue_count = 1 then locations.venue_name else '' end as resolved_venue_name
    from session_awards award
    join session_day_venues locations using (session_id, riding_day)
  ), daily_completions as (
    -- Retain the existing same-rider/park/day recovery for detached daily
    -- awards, but compare to the award day, never an old session start day.
    -- A legacy under-20 row is completion evidence only: it adds no bonus.
    select award.athlete_id,
      (award.created_at at time zone public.jkcrew_country_timezone(profile.country_code))::date as riding_day,
      min(award.created_at) as completed_at
    from public.assignment_point_awards award
    join public.profiles profile on profile.id = award.athlete_id and profile.role = 'athlete'
      and private.jkcrew_profile_team_id(profile.id) = p_team
    cross join requested
    where requested.venue_key <> ''
      and private.jkcrew_venue_key(award.venue) = requested.venue_key
      and award.points > 0
      and split_part(award.award_key, ':', 1) in ('daily', 'daily-complete', 'daily-under-20')
    group by award.athlete_id,
      (award.created_at at time zone public.jkcrew_country_timezone(profile.country_code))::date
  ), session_day_scores as (
    select award.session_id, award.athlete_id, award.riding_day,
      award.resolved_venue_key as venue_key,
      max(award.resolved_venue_name) as venue_name,
      coalesce(sum(award.points) filter (where award.points > 0 and award.award_type in
        ('dialled', 'one_bang', 'percentage', 'lines', 'bonus', 'trick_links')), 0)::integer as trick_points,
      max(award.created_at) filter (where award.points > 0 and award.award_type in
        ('dialled', 'one_bang', 'percentage', 'lines', 'bonus', 'trick_links')) as tricks_achieved_at,
      min(award.created_at) filter (where award.points > 0 and award.award_type in
        ('daily', 'daily-complete', 'daily-under-20')) as daily_completed_at
    from located_awards award
    cross join requested
    where award.resolved_venue_key = requested.venue_key
      and requested.venue_key <> ''
    group by award.session_id, award.athlete_id, award.riding_day, award.resolved_venue_key
  ), scored_sessions as (
    select scored.venue_key, scored.venue_name, scored.athlete_id,
      (scored.trick_points + case when coalesce(scored.daily_completed_at, daily.completed_at) is not null
        then 1 else 0 end)::integer as points,
      -- Only contributing scores determine when the record was achieved.
      -- First-finish, under-20 bonus points and later unrelated awards cannot
      -- change who won a tied record. Daily completion is capped at one.
      greatest(scored.tricks_achieved_at, least(scored.daily_completed_at, daily.completed_at)) as achieved_at
    from session_day_scores scored
    left join daily_completions daily using (athlete_id, riding_day)
  )
  select scored.venue_key, scored.venue_name, scored.athlete_id,
    coalesce(nullif(btrim(profile.display_name), ''), 'Rider') as display_name,
    coalesce(profile.avatar, '{}'::jsonb) as avatar,
    scored.points
  from scored_sessions scored
  join public.profiles profile on profile.id = scored.athlete_id
  where scored.points > 0
  order by scored.points desc, scored.achieved_at asc,
    coalesce(nullif(btrim(profile.display_name), ''), 'Rider') asc, scored.athlete_id asc
  limit 1;
$function$;

revoke all on function private.jkcrew_current_park_king_for_team(uuid,text) from public, anon, authenticated;

create or replace function public.get_park_king(p_venue text)
returns table(venue_key text, venue_name text, athlete_id uuid, display_name text, avatar jsonb, points integer, crown_title text)
language plpgsql stable security definer set search_path = ''
as $$
declare v_team uuid;
begin
  perform private.require_coach_approval();
  if auth.uid() is null then raise exception 'Authentication required.' using errcode='42501'; end if;
  v_team := private.jkcrew_profile_team_id(auth.uid());
  if v_team is null then return; end if;
  return query select champion.venue_key, champion.venue_name, champion.athlete_id,
    champion.display_name, champion.avatar, champion.points,
    private.jkcrew_park_crown_title(champion.athlete_id)
  from private.jkcrew_current_park_king_for_team(v_team,p_venue) champion;
end;
$$;
revoke all on function public.get_park_king(text) from public, anon;
grant execute on function public.get_park_king(text) to authenticated;

create or replace function public.get_team_park_kings()
returns table(venue_key text, venue_name text, athlete_id uuid, display_name text, points integer, updated_at timestamptz, crown_title text)
language plpgsql stable security definer set search_path = ''
as $$
declare v_team uuid;
begin
  perform private.require_coach_approval();
  if auth.uid() is null then raise exception 'Authentication required.' using errcode='42501'; end if;
  v_team := private.jkcrew_profile_team_id(auth.uid());
  if v_team is null then return; end if;
  -- Resolve from team awards, rather than filtering the single global winner.
  -- Live computation also handles membership changes without returning an old
  -- cached champion from a team they have left.
  return query
  with venues as (
    select distinct private.jkcrew_venue_key(award.venue) as key, min(btrim(award.venue)) as name
    from public.assignment_point_awards award
    join public.training_sessions session on session.id=award.session_id and session.athlete_id=award.athlete_id
    where private.jkcrew_profile_team_id(session.athlete_id)=v_team
      and private.jkcrew_venue_key(award.venue)<>''
    group by private.jkcrew_venue_key(award.venue)
  )
  select champion.venue_key,champion.venue_name,champion.athlete_id,
    champion.display_name,champion.points,snapshot.updated_at,
    private.jkcrew_park_crown_title(champion.athlete_id)
  from venues
  cross join lateral private.jkcrew_current_park_king_for_team(v_team,venues.name) champion
  left join private.team_park_king_snapshots snapshot
    on snapshot.team_id=v_team and snapshot.venue_key=champion.venue_key
  order by champion.venue_name;
end;
$$;
revoke all on function public.get_team_park_kings() from public, anon;
grant execute on function public.get_team_park_kings() to authenticated;

create or replace function private.refresh_park_king(p_venue text, p_event_key text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_key text := private.jkcrew_venue_key(p_venue);
  v_team uuid;
  v_previous private.team_park_king_snapshots%rowtype;
  v_current record;
  v_event_id uuid;
  v_crown_title text;
begin
  if coalesce(v_key,'')='' then return; end if;
  for v_team in
    select distinct private.jkcrew_profile_team_id(session.athlete_id)
    from public.assignment_point_awards award
    join public.training_sessions session on session.id=award.session_id and session.athlete_id=award.athlete_id
    where private.jkcrew_venue_key(award.venue)=v_key
      and private.jkcrew_profile_team_id(session.athlete_id) is not null
    union
    select snapshot.team_id from private.team_park_king_snapshots snapshot where snapshot.venue_key=v_key
  loop
    if auth.uid() is not null and v_team is distinct from private.jkcrew_profile_team_id(auth.uid()) then continue; end if;
    -- Concurrent score writes at the same team/park must not emit two crowns.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_team::text||':'||v_key,0));
    select snapshot.* into v_previous from private.team_park_king_snapshots snapshot
    where snapshot.team_id=v_team and snapshot.venue_key=v_key;
    select champion.* into v_current from private.jkcrew_current_park_king_for_team(v_team,p_venue) champion;
    if not found then
      delete from private.team_park_king_snapshots snapshot where snapshot.team_id=v_team and snapshot.venue_key=v_key;
      continue;
    end if;
    insert into private.team_park_king_snapshots(team_id,venue_key,venue_name,athlete_id,display_name,avatar,points,updated_at)
    values(v_team,v_key,v_current.venue_name,v_current.athlete_id,v_current.display_name,v_current.avatar,v_current.points,now())
    on conflict(team_id,venue_key) do update set
      venue_name=excluded.venue_name,athlete_id=excluded.athlete_id,display_name=excluded.display_name,
      avatar=excluded.avatar,points=excluded.points,updated_at=excluded.updated_at;
    if v_previous.athlete_id is not null and v_previous.athlete_id=v_current.athlete_id then continue; end if;
    v_crown_title := private.jkcrew_park_crown_title(v_current.athlete_id);
    insert into public.park_king_events(venue_key,venue_name,athlete_id,display_name,points,crown_title)
    values(v_key,v_current.venue_name,v_current.athlete_id,v_current.display_name,v_current.points,v_crown_title)
    returning id into v_event_id;
    insert into public.push_notification_queue(recipient_id,notification_type,title,body,url,payload,dedupe_key)
    select profile.id,'park_king_changed','New '||v_crown_title||' of the Park',
      v_current.display_name||' is now '||v_crown_title||' of '||v_current.venue_name||' with '||v_current.points||' park point'||case when v_current.points=1 then '' else 's' end||'.',
      './?push=session',
      jsonb_build_object('type','park_king_changed','event_id',v_event_id,'venue',v_current.venue_name,
        'athlete_id',v_current.athlete_id,'points',v_current.points,'crown_title',v_crown_title,'view','session'),
      'park-king:'||v_event_id::text||':'||profile.id::text
    from public.profiles profile
    where profile.role='athlete' and profile.id<>v_current.athlete_id
      and private.jkcrew_actor_approved(profile.id)
      and private.jkcrew_profile_team_id(profile.id)=v_team
    on conflict(dedupe_key) do nothing;
  end loop;
end;
$$;
revoke all on function private.refresh_park_king(text,text) from public, anon, authenticated;

-- Quiet cache seed: historical records are preserved, no award/event/push insert.
insert into private.team_park_king_snapshots(team_id,venue_key,venue_name,athlete_id,display_name,avatar,points,updated_at)
select venues.team_id,champion.venue_key,champion.venue_name,champion.athlete_id,
  champion.display_name,champion.avatar,champion.points,now()
from (
  select private.jkcrew_profile_team_id(session.athlete_id) as team_id,
    private.jkcrew_venue_key(award.venue) as venue_key,min(btrim(award.venue)) as venue_name
  from public.assignment_point_awards award
  join public.training_sessions session on session.id=award.session_id and session.athlete_id=award.athlete_id
  where private.jkcrew_profile_team_id(session.athlete_id) is not null
    and private.jkcrew_venue_key(award.venue)<>''
  group by private.jkcrew_profile_team_id(session.athlete_id),private.jkcrew_venue_key(award.venue)
) venues
cross join lateral private.jkcrew_current_park_king_for_team(venues.team_id,venues.venue_name) champion
on conflict(team_id,venue_key) do update set venue_name=excluded.venue_name,athlete_id=excluded.athlete_id,
  display_name=excluded.display_name,avatar=excluded.avatar,points=excluded.points,updated_at=excluded.updated_at;
-- End team park crown isolation.

notify pgrst,'reload schema';

