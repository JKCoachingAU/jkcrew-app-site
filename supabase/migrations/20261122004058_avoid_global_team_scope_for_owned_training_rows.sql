-- An approved actor's own profile is already visible in the existing scope.
-- actor_approved also requires that profile to exist; pending/suspended coaches
-- receive no new bypass. CASE avoids building the global team scope only for
-- that exact self identity. Uncorrelated SELECTs make the identity and approval
-- checks statement InitPlans, not per-row work. All foreign/null identities,
-- related-source guards, source views, other RLS policies and grants remain.
set local lock_timeout='5s';
set local statement_timeout='60s';
alter policy team_privacy_guard on public.assignment_progress
 using(case when athlete_id=(select auth.uid()) then(select private.jkcrew_actor_approved(auth.uid())) else athlete_id in(select private.jkcrew_rls_visible_profiles()) end)
 with check(case when athlete_id=(select auth.uid()) then(select private.jkcrew_actor_approved(auth.uid())) else athlete_id in(select private.jkcrew_rls_visible_profiles()) end);
alter policy team_privacy_guard on public.percentage_attempts
 using(case when athlete_id=(select auth.uid()) then(select private.jkcrew_actor_approved(auth.uid())) else athlete_id in(select private.jkcrew_rls_visible_profiles()) end)
 with check(case when athlete_id=(select auth.uid()) then(select private.jkcrew_actor_approved(auth.uid())) else athlete_id in(select private.jkcrew_rls_visible_profiles()) end);
alter policy team_privacy_guard on public.assignment_point_awards
 using(case when athlete_id=(select auth.uid()) then(select private.jkcrew_actor_approved(auth.uid())) else athlete_id in(select private.jkcrew_rls_visible_profiles()) end)
 with check(case when athlete_id=(select auth.uid()) then(select private.jkcrew_actor_approved(auth.uid())) else athlete_id in(select private.jkcrew_rls_visible_profiles()) end);
alter policy team_privacy_guard on public.assignment_attempts
 using((athlete_id is not null or coach_id is not null)
  and(athlete_id is null or case when athlete_id=(select auth.uid()) then(select private.jkcrew_actor_approved(auth.uid())) else athlete_id in(select private.jkcrew_rls_visible_profiles()) end)
  and(coach_id is null or case when coach_id=(select auth.uid()) then(select private.jkcrew_actor_approved(auth.uid())) else coach_id in(select private.jkcrew_rls_visible_profiles()) end))
 with check((athlete_id is not null or coach_id is not null)
  and(athlete_id is null or case when athlete_id=(select auth.uid()) then(select private.jkcrew_actor_approved(auth.uid())) else athlete_id in(select private.jkcrew_rls_visible_profiles()) end)
  and(coach_id is null or case when coach_id=(select auth.uid()) then(select private.jkcrew_actor_approved(auth.uid())) else coach_id in(select private.jkcrew_rls_visible_profiles()) end));
