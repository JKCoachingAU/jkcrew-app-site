-- A left join to coach_athletes multiplies coach rows. Keep country
-- aggregates distinct while still counting distinct students.
create or replace function public.get_platform_coach_overview()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed boolean;
  v_coaches jsonb;
  v_countries jsonb;
begin
  select coalesce(p.is_platform_owner, false) into v_allowed
  from public.profiles p
  where p.id = auth.uid();
  if auth.uid() is null or not coalesce(v_allowed, false) then
    raise exception 'Platform-owner access required.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(rows) order by rows.display_name), '[]'::jsonb)
  into v_coaches
  from (
    select p.id as coach_id,
           p.display_name,
           p.email,
           nullif(p.country_code, '') as country_code,
           nullif(p.country_name, '') as country_name,
           case
             when u.deleted_at is not null then 'disabled'
             when u.banned_until is not null and u.banned_until > now() then 'suspended'
             when u.confirmed_at is null then 'pending'
             else 'active'
           end as account_status,
           count(distinct ca.athlete_id)::integer as student_count
    from public.profiles p
    left join auth.users u on u.id = p.id
    left join public.coach_athletes ca on ca.coach_id = p.id
    where p.role = 'coach'::public.user_role
    group by p.id, p.display_name, p.email, p.country_code, p.country_name,
             u.deleted_at, u.banned_until, u.confirmed_at
  ) rows;

  select coalesce(jsonb_agg(to_jsonb(rows) order by rows.country_name), '[]'::jsonb)
  into v_countries
  from (
    select coalesce(nullif(p.country_code, ''), 'UNSET') as country_code,
           coalesce(nullif(p.country_name, ''), 'Country not set') as country_name,
           count(distinct p.id)::integer as coach_count,
           count(distinct ca.athlete_id)::integer as student_count
    from public.profiles p
    left join public.coach_athletes ca on ca.coach_id = p.id
    where p.role = 'coach'::public.user_role
    group by coalesce(nullif(p.country_code, ''), 'UNSET'),
             coalesce(nullif(p.country_name, ''), 'Country not set')
  ) rows;

  return jsonb_build_object(
    'coaches', v_coaches,
    'country_totals', v_countries,
    'total_coaches', jsonb_array_length(v_coaches),
    'total_students', coalesce((select sum((item->>'student_count')::integer) from jsonb_array_elements(v_coaches) item), 0)
  );
end;
$$;
revoke all on function public.get_platform_coach_overview() from public, anon;
grant execute on function public.get_platform_coach_overview() to authenticated;
