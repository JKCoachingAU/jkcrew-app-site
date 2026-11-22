-- A session roster authorizes the coach and team once, before reading only the
-- same own-link profile/group projections as the existing three REST reads.
create function public.get_my_session_viewer_roster()
returns jsonb language plpgsql stable security definer set search_path='' as $roster$
declare actor uuid:=auth.uid();
begin
 if actor is null then raise exception 'Sign in required'using errcode='42501';end if;
 perform private.require_coach_approval();
 if not private.jkcrew_is_team_coach(actor)then
  raise exception 'An approved active coaching account is required'using errcode='42501';
 end if;
 return(
  with own_links as materialized(
   select link.athlete_id,link.group_name,link.team_id
   from public.coach_athletes link where link.coach_id=actor
  ), linked_teams as materialized(
   select distinct team.id,team.coach_id
   from public.coach_teams team join own_links link on link.team_id=team.id
  ), subjects as materialized(
   select actor id union select link.athlete_id from own_links link
   union select team.coach_id from linked_teams team
  ), memberships as materialized(
   select *from private.jkcrew_actor_team_memberships((select array_agg(subject.id)from subjects subject))
  ), actor_teams as materialized(
   select membership.team_id from memberships membership where membership.actor_id=actor
  ), eligible_links as materialized(
   select link.athlete_id,link.group_name
   from own_links link
   where(link.athlete_id=actor or exists(
    select 1 from memberships target join actor_teams own using(team_id)
    where target.actor_id=link.athlete_id
   ))and(link.team_id is null or exists(
    -- Match the existing ca.team_id -> coach_teams resource guard as well as
    -- athlete visibility; a stale foreign team reference must not bypass it.
    select 1 from linked_teams team where team.id=link.team_id
     and(team.coach_id=actor or exists(
      select 1 from memberships target join actor_teams own using(team_id)
      where target.actor_id=team.coach_id
     ))
   ))
  )
  select jsonb_build_object(
   'links',coalesce((select jsonb_agg(jsonb_build_object(
    'athlete_id',link.athlete_id,'group_name',link.group_name))from eligible_links link),'[]'::jsonb),
   'athletes',coalesce((select jsonb_agg(jsonb_build_object(
    'id',profile.id,'display_name',profile.display_name,'avatar',profile.avatar,'country_code',profile.country_code)
    order by profile.display_name)
    from public.profiles profile join eligible_links link on link.athlete_id=profile.id
    where profile.id=actor or profile.role::text in('athlete','parent')
     or(profile.role::text in('coach','admin')and exists(
      -- The legacy profile policy exposes coaching accounts only through
      -- direct active coach memberships, never merely a stale student link.
      select 1 from private.coach_team_memberships own
      join private.coach_team_memberships target on target.team_id=own.team_id
      where own.coach_id=actor and target.coach_id=profile.id
       and own.status='active'and target.status='active'
     ))),'[]'::jsonb),
   'group_links',coalesce((select jsonb_agg(jsonb_build_object(
    'athlete_id',membership.athlete_id,'group_name',membership.group_name,'membership_type',membership.membership_type))
    from public.coach_athlete_groups membership where membership.coach_id=actor
     and exists(select 1 from eligible_links link where link.athlete_id=membership.athlete_id)),'[]'::jsonb)
  )
 );
end;
$roster$;
revoke all on function public.get_my_session_viewer_roster()from public,anon,service_role;
grant execute on function public.get_my_session_viewer_roster()to authenticated;
notify pgrst,'reload schema';
