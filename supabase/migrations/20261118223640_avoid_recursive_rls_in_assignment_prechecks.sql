-- A primary-key authorization check should not expand every legacy policy on
-- assignments, profiles and parent links twice before a scoring RPC can start.
-- Match their effective read gate explicitly inside one private definer helper.
create function private.jkcrew_assignment_action_visible(p_assignment uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();athlete uuid;coach uuid;
begin
  if actor is null or not private.jkcrew_actor_approved(actor) then return false; end if;
  select a.athlete_id,a.coach_id into athlete,coach from public.weekly_trick_assignments a where a.id=p_assignment;
  if not found or athlete is null or not private.jkcrew_profiles_share_team(actor,athlete)
    or (coach is not null and not private.jkcrew_profiles_share_team(actor,coach)) then return false; end if;
  return athlete=actor or private.jkcrew_is_team_coach(coach) or exists(
    select 1 from public.parent_athletes p where p.parent_id=actor and p.athlete_id=athlete
      and (p.coach_id is null or private.jkcrew_profiles_share_team(actor,p.coach_id))
  );
end;
$$;
revoke all on function private.jkcrew_assignment_action_visible(uuid) from public,anon,service_role;
grant execute on function private.jkcrew_assignment_action_visible(uuid) to authenticated;

-- Preserve signatures, approval exceptions, private-record errors, and the
-- independent own-rider / linked-coach authorization inside the scoring body.
create or replace function public.record_assignment_action_at_venue(p_assignment_id uuid,p_action text default 'landed',p_venue text default '')
returns jsonb language plpgsql set search_path='' as $$
begin
  perform private.require_coach_approval();
  if p_assignment_id is not null and not private.jkcrew_assignment_action_visible(p_assignment_id) then
    raise exception 'This record belongs to another private team.' using errcode='42501';
  end if;
  return private.approved_1f66e273bce3fd6228b21a0d(p_assignment_id,p_action,p_venue);
end;
$$;
create or replace function public.record_assignment_action(p_assignment_id uuid,p_action text default 'landed')
returns jsonb language plpgsql set search_path='' as $$
begin
  perform private.require_coach_approval();
  if p_assignment_id is not null and not private.jkcrew_assignment_action_visible(p_assignment_id) then
    raise exception 'This record belongs to another private team.' using errcode='42501';
  end if;
  return private.approved_b223f0cd2e29fcfebf9311d3(p_assignment_id,p_action);
end;
$$;
notify pgrst,'reload schema';
