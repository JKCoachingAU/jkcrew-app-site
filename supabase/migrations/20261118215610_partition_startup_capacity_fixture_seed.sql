-- Keep synthetic history construction below the existing API statement timeout.
create or replace function public.startup_capacity_probe_fixture(p_action text,p_run_id text,p_coach_id uuid default null,p_rider_ids uuid[] default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare week date; member uuid; own_team uuid; expected integer; ids jsonb;
begin
  if auth.jwt()->>'role' is distinct from 'service_role' or p_run_id !~ '^[0-9a-f]{32}$' then raise exception 'Service probe required' using errcode='42501'; end if;
  if p_action='claim' then
    insert into private.startup_capacity_probe_runs(run_id)values(p_run_id) on conflict do nothing;
    if not found then raise exception 'Probe already claimed'; end if;
    return jsonb_build_object('claimed',true);
  end if;
  if not exists(select 1 from private.startup_capacity_probe_runs r where r.run_id=p_run_id and r.expires_at>now()) then raise exception 'Probe expired'; end if;
  if p_action='list' then
    select coalesce(jsonb_agg(u.id),'[]') into ids from auth.users u
    where u.raw_app_meta_data->>'jkcrew_capacity_probe'=p_run_id and u.email like 'jkcrew-probe-'||p_run_id||'-%@example.com';
    return jsonb_build_object('ids',ids);
  end if;
  if p_action not in ('seed','history') or (p_action='seed' and cardinality(p_rider_ids)<>15) or (p_action='history' and cardinality(p_rider_ids)<>1) or (select count(distinct x) from unnest(p_rider_ids) x)<>cardinality(p_rider_ids) then raise exception 'Bounded synthetic rider batch required'; end if;
  if not exists(select 1 from auth.users u join public.profiles p on p.id=u.id where u.id=p_coach_id
    and u.raw_app_meta_data->>'jkcrew_capacity_probe'=p_run_id and u.email='jkcrew-probe-'||p_run_id||'-coach@example.com'
    and u.created_at>now()-interval '15 minutes' and p.role='coach' and not p.is_platform_owner) then raise exception 'Synthetic coach required'; end if;
  select count(*) into expected from auth.users u join public.profiles p on p.id=u.id where u.id=any(p_rider_ids)
    and u.raw_app_meta_data->>'jkcrew_capacity_probe'=p_run_id and u.email like 'jkcrew-probe-'||p_run_id||'-rider-%@example.com'
    and u.created_at>now()-interval '15 minutes' and p.role='athlete';
  if expected<>cardinality(p_rider_ids) then raise exception 'Synthetic riders required'; end if;
  if p_action='seed' then
  update private.coach_account_access set status='approved' where coach_id=p_coach_id;
  select m.team_id into own_team from private.coach_team_memberships m where m.coach_id=p_coach_id and m.status='active';
  if own_team is null then raise exception 'Synthetic team missing'; end if;
  insert into public.coach_athletes(coach_id,athlete_id,team_id) select p_coach_id,x,own_team from unnest(p_rider_ids) x;
  return jsonb_build_object('riders',15,'assignments',750,'sessions',150,'awards',600,'week_start',(select b.week_start_date from public.jkcrew_week_bounds('AU') b));
  end if;
  select b.week_start_date into week from public.jkcrew_week_bounds('AU') b;
  insert into public.weekly_trick_assignments(coach_id,athlete_id,week_start,category,trick_name,venue,target_reps,sort_order)
  select p_coach_id,x,week-(case when n<=10 then 0 else 7 end),'daily','Synthetic Daily '||n,'Capacity Probe Park',1,n
  from unnest(p_rider_ids) x cross join generate_series(1,50) n;
  insert into public.training_sessions(athlete_id,started_at,ended_at,total_points)
  select x,now()-n*interval '1 day',now()-n*interval '1 day'+interval '1 hour',0 from unnest(p_rider_ids) x cross join generate_series(1,10) n;
  insert into public.assignment_point_awards(athlete_id,award_key,points,created_at)
  select x,'capacity-fixture:'||p_run_id||':'||n,2,case when n<=10 then now() else now()-interval '14 days' end
  from unnest(p_rider_ids) x cross join generate_series(1,40) n;
  return jsonb_build_object('riders',15,'assignments',750,'sessions',150,'awards',600,'week_start',week);
end;
$$;
revoke all on function public.startup_capacity_probe_fixture(text,text,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.startup_capacity_probe_fixture(text,text,uuid,uuid[]) to service_role;
notify pgrst,'reload schema';
