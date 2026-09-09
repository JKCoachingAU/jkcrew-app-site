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
 select a.points,coalesce(w.trick_name,'Training award') as detail,
 case when w.category='bonus' then 'Bonus trick' when w.category='lines' then 'Line completed' else coalesce(w.category,'Training') end as label
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
revoke all on function private.points_receipt(uuid,text) from public,anon;
grant execute on function private.points_receipt(uuid,text) to authenticated;
create or replace function public.get_points_receipt(p_athlete_id uuid,p_scope text default 'weekly') returns jsonb language sql security invoker set search_path='' as $$ select private.points_receipt(p_athlete_id,p_scope); $$;
revoke all on function public.get_points_receipt(uuid,text) from public,anon;
grant execute on function public.get_points_receipt(uuid,text) to authenticated;
