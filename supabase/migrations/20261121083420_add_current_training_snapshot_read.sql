-- Combine the existing current-sheet reads into one transport request. Every
-- table SELECT continues to run as the caller under its unchanged RLS policies.
create function public.get_current_training_snapshot(
 p_athlete_id uuid,p_week_start date,p_awards_since timestamptz,
 p_include_assignment_attempts boolean default true
)returns jsonb language plpgsql stable security invoker set search_path='' as $snapshot$
declare assignments jsonb;assignment_ids uuid[];progress jsonb:='[]';
 percentage_attempts jsonb:='[]';awards jsonb;assignment_attempts jsonb:='[]';
begin
 if auth.uid()is null then raise exception 'Sign in required'using errcode='42501';end if;
 perform private.require_coach_approval();
 if p_athlete_id is null or p_week_start is null or p_awards_since is null then
  raise exception 'Athlete, week and award cutoff are required'using errcode='22023';
 end if;
 -- The existing wrapper retains its approval, target-team and own/link/parent
 -- gates, including its original Daily fallback and country-week behavior.
 select coalesce(jsonb_agg(to_jsonb(assignment)order by assignment.sort_order,assignment.id),'[]'::jsonb),
  coalesce(array_agg(assignment.id),'{}'::uuid[])
 into assignments,assignment_ids
 from public.get_effective_weekly_assignments(p_athlete_id,p_week_start)assignment;
 if cardinality(assignment_ids)>0 then
  select coalesce(jsonb_agg(jsonb_build_object(
   'assignment_id',entry.assignment_id,'athlete_id',entry.athlete_id,'progress_date',entry.progress_date,
   'streak_count',entry.streak_count,'completed_at',entry.completed_at,'updated_at',entry.updated_at)),'[]'::jsonb)
  into progress from public.assignment_progress entry
  where entry.athlete_id=p_athlete_id and entry.assignment_id=any(assignment_ids);
  select coalesce(jsonb_agg(jsonb_build_object(
   'id',entry.id,'assignment_id',entry.assignment_id,'athlete_id',entry.athlete_id,
   'attempt_number',entry.attempt_number,'landed',entry.landed,'created_at',entry.created_at)
   order by entry.attempt_number),'[]'::jsonb)
  into percentage_attempts from public.percentage_attempts entry
  where entry.athlete_id=p_athlete_id and entry.assignment_id=any(assignment_ids);
 end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',entry.id,'athlete_id',entry.athlete_id,'session_id',entry.session_id,'assignment_id',entry.assignment_id,
  'award_key',entry.award_key,'points',entry.points,'created_at',entry.created_at,'venue',entry.venue)),'[]'::jsonb)
 into awards from public.assignment_point_awards entry
 where entry.athlete_id=p_athlete_id and entry.created_at>=p_awards_since;
 if p_include_assignment_attempts then
  select coalesce(jsonb_agg(to_jsonb(entry)order by entry.attempted_at desc),'[]'::jsonb)
  into assignment_attempts from public.assignment_attempts entry
  where entry.athlete_id=p_athlete_id and entry.week_start=p_week_start;
 end if;
 return jsonb_build_object('assignments',assignments,'progress',progress,
  'percentage_attempts',percentage_attempts,'awards',awards,'assignment_attempts',assignment_attempts);
end;
$snapshot$;
revoke all on function public.get_current_training_snapshot(uuid,date,timestamptz,boolean)from public,anon,service_role;
grant execute on function public.get_current_training_snapshot(uuid,date,timestamptz,boolean)to authenticated;
notify pgrst,'reload schema';
