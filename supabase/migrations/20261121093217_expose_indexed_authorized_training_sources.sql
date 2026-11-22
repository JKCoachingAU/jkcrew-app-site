-- Resolve the statement-invariant authenticated actor's team scope once. This
-- retains the exact scalar same-team predicate; row/source guards stay in RLS.
set local lock_timeout='5s';
set local statement_timeout='60s';
create function private.jkcrew_rls_visible_profiles()
returns setof uuid language sql stable security definer set search_path='' as $scope$
 with viewer as materialized(
  select auth.uid()actor,private.jkcrew_actor_approved(auth.uid())approved
 ), subjects as materialized(
  select profile.id from public.profiles profile
 ), memberships as materialized(
  select *from private.jkcrew_actor_team_memberships(
   (select array_agg(subject.id)from subjects subject)
  )
 ), viewer_teams as materialized(
  select membership.team_id from memberships membership
  where membership.actor_id=(select actor from viewer)
 )
 select subject.id from subjects subject cross join viewer
 where viewer.approved and(subject.id=viewer.actor or exists(
  select 1 from memberships target join viewer_teams own using(team_id)
  where target.actor_id=subject.id
 ));
$scope$;
revoke all on function private.jkcrew_rls_visible_profiles()from public,anon,service_role;
grant execute on function private.jkcrew_rls_visible_profiles()to authenticated;

-- Owner-definer ID-only views retain legacy resource visibility, while the
-- planner can push each leakproof UUID source-ID equality to its primary key.
-- The approved actor scope and schema shape are uncorrelated statement work.
-- OFFSET 0 below prevents EXISTS from becoming a broad historical hash scan;
-- the inner leakproof UUID equality still reaches each source primary key.
create view private.jkcrew_rls_weekly_assignment_ids
with(security_barrier=true,security_invoker=false)as
 with allowed as materialized(
  select private.jkcrew_rls_visible_profiles()id
 ), source_shape as materialized(
  select not exists(
   select 1 from pg_catalog.pg_attribute attribute
   where attribute.attrelid='public.weekly_trick_assignments'::pg_catalog.regclass
    and attribute.attnum>0 and not attribute.attisdropped
    and attribute.attname=any(array['athlete_id','coach_id','owner_id','author_id','created_by','challenger_id','opponent_id'])
    and(attribute.attname<>all(array['athlete_id','coach_id'])or attribute.atttypid<>'uuid'::pg_catalog.regtype)
  )fast
 )
 select source.id from public.weekly_trick_assignments source
 where case when(select fast from source_shape)then
  (source.athlete_id is not null or source.coach_id is not null)
    and (source.athlete_id is null or source.athlete_id in(select id from allowed))
    and (source.coach_id is null or source.coach_id in(select id from allowed))
 else private.jkcrew_resource_visible('weekly_trick_assignments',source.id)end;
revoke all on private.jkcrew_rls_weekly_assignment_ids from public,anon,service_role;
grant select on private.jkcrew_rls_weekly_assignment_ids to authenticated;

create view private.jkcrew_rls_training_session_ids
with(security_barrier=true,security_invoker=false)as
 with allowed as materialized(
  select private.jkcrew_rls_visible_profiles()id
 ), source_shape as materialized(
  select not exists(
   select 1 from pg_catalog.pg_attribute attribute
   where attribute.attrelid='public.training_sessions'::pg_catalog.regclass
    and attribute.attnum>0 and not attribute.attisdropped
    and attribute.attname=any(array['athlete_id','coach_id','owner_id','author_id','created_by','challenger_id','opponent_id'])
    and(attribute.attname<>all(array['athlete_id'])or attribute.atttypid<>'uuid'::pg_catalog.regtype)
  )fast
 )
 select source.id from public.training_sessions source
 where case when(select fast from source_shape)then
  (source.athlete_id is not null)
    and (source.athlete_id is null or source.athlete_id in(select id from allowed))
 else private.jkcrew_resource_visible('training_sessions',source.id)end;
revoke all on private.jkcrew_rls_training_session_ids from public,anon,service_role;
grant select on private.jkcrew_rls_training_session_ids to authenticated;

create view private.jkcrew_rls_coach_group_session_ids
with(security_barrier=true,security_invoker=false)as
 with allowed as materialized(
  select private.jkcrew_rls_visible_profiles()id
 ), source_shape as materialized(
  select not exists(
   select 1 from pg_catalog.pg_attribute attribute
   where attribute.attrelid='public.coach_group_sessions'::pg_catalog.regclass
    and attribute.attnum>0 and not attribute.attisdropped
    and attribute.attname=any(array['athlete_id','coach_id','owner_id','author_id','created_by','challenger_id','opponent_id'])
    and(attribute.attname<>all(array['coach_id'])or attribute.atttypid<>'uuid'::pg_catalog.regtype)
  )fast
 )
 select source.id from public.coach_group_sessions source
 where case when(select fast from source_shape)then
  (source.coach_id is not null)
    and (source.coach_id is null or source.coach_id in(select id from allowed))
 else private.jkcrew_resource_visible('coach_group_sessions',source.id)end;
revoke all on private.jkcrew_rls_coach_group_session_ids from public,anon,service_role;
grant select on private.jkcrew_rls_coach_group_session_ids to authenticated;

alter policy team_privacy_guard on public.assignment_progress
 using(athlete_id in(select private.jkcrew_rls_visible_profiles()))
 with check(athlete_id in(select private.jkcrew_rls_visible_profiles()));
alter policy team_privacy_guard on public.percentage_attempts
 using(athlete_id in(select private.jkcrew_rls_visible_profiles()))
 with check(athlete_id in(select private.jkcrew_rls_visible_profiles()));
alter policy team_privacy_guard on public.assignment_point_awards
 using(athlete_id in(select private.jkcrew_rls_visible_profiles()))
 with check(athlete_id in(select private.jkcrew_rls_visible_profiles()));
alter policy team_privacy_guard on public.assignment_attempts
 using((athlete_id is not null or coach_id is not null)
  and(athlete_id is null or athlete_id in(select private.jkcrew_rls_visible_profiles()))
  and(coach_id is null or coach_id in(select private.jkcrew_rls_visible_profiles())))
 with check((athlete_id is not null or coach_id is not null)
  and(athlete_id is null or athlete_id in(select private.jkcrew_rls_visible_profiles()))
  and(coach_id is null or coach_id in(select private.jkcrew_rls_visible_profiles())));

alter policy team_related_records_guard on public.assignment_progress
 using((assignment_id is null or exists(
  select 1 from private.jkcrew_rls_weekly_assignment_ids source where source.id=assignment_progress.assignment_id offset 0)))
 with check((assignment_id is null or exists(
  select 1 from private.jkcrew_rls_weekly_assignment_ids source where source.id=assignment_progress.assignment_id offset 0)));
alter policy team_related_records_guard on public.percentage_attempts
 using((assignment_id is null or exists(
  select 1 from private.jkcrew_rls_weekly_assignment_ids source where source.id=percentage_attempts.assignment_id offset 0)))
 with check((assignment_id is null or exists(
  select 1 from private.jkcrew_rls_weekly_assignment_ids source where source.id=percentage_attempts.assignment_id offset 0)));
alter policy team_related_records_guard on public.assignment_point_awards
 using((assignment_id is null or exists(
  select 1 from private.jkcrew_rls_weekly_assignment_ids source where source.id=assignment_point_awards.assignment_id offset 0))
 and (session_id is null or exists(
  select 1 from private.jkcrew_rls_training_session_ids source where source.id=assignment_point_awards.session_id offset 0)))
 with check((assignment_id is null or exists(
  select 1 from private.jkcrew_rls_weekly_assignment_ids source where source.id=assignment_point_awards.assignment_id offset 0))
 and (session_id is null or exists(
  select 1 from private.jkcrew_rls_training_session_ids source where source.id=assignment_point_awards.session_id offset 0)));
alter policy team_related_records_guard on public.assignment_attempts
 using((session_id is null or exists(
  select 1 from private.jkcrew_rls_training_session_ids source where source.id=assignment_attempts.session_id offset 0))
 and (group_session_id is null or exists(
  select 1 from private.jkcrew_rls_coach_group_session_ids source where source.id=assignment_attempts.group_session_id offset 0))
 and (assignment_id is null or exists(
  select 1 from private.jkcrew_rls_weekly_assignment_ids source where source.id=assignment_attempts.assignment_id offset 0)))
 with check((session_id is null or exists(
  select 1 from private.jkcrew_rls_training_session_ids source where source.id=assignment_attempts.session_id offset 0))
 and (group_session_id is null or exists(
  select 1 from private.jkcrew_rls_coach_group_session_ids source where source.id=assignment_attempts.group_session_id offset 0))
 and (assignment_id is null or exists(
  select 1 from private.jkcrew_rls_weekly_assignment_ids source where source.id=assignment_attempts.assignment_id offset 0)));
