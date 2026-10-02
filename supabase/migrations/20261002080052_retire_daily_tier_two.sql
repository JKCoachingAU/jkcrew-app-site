-- Retire new Tier 2 activity, including requests from an older installed app.
-- Saved templates, rounds, landing evidence and all earned points remain intact.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function private.require_daily_tier_two_access(p_athlete_id uuid, p_write boolean default false)
returns void language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_daily_access(p_athlete_id, not p_write);
  if private.rider_features_disabled() then
    raise exception 'You don''t have access to this feature, contact your coach' using errcode='42501';
  end if;
  if not exists(select 1 from public.profiles where id=p_athlete_id and role::text='athlete') then
    raise exception 'Choose a rider account' using errcode='42501';
  end if;
  if p_write then
    raise exception 'Tier 2 Daily Tricks has been retired. Your earned points are safe. Refresh the app to continue with Daily Tricks.' using errcode='55000';
  end if;
end $$;
revoke all on function private.require_daily_tier_two_access(uuid,boolean) from public,anon,authenticated;

create or replace function private.get_daily_tier_two(p_athlete_id uuid, p_local_date date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_daily_tier_two_access(p_athlete_id);
  -- Old live views receive a hidden, ineligible state. An explicitly requested
  -- historical date remains available to its existing authorized readers.
  if p_local_date is null then
    return jsonb_build_object('athlete_id',p_athlete_id,'retired',true,'eligible',false,'unlocked',false);
  end if;
  return private.daily_tier_two_json(p_athlete_id,p_local_date)
    || jsonb_build_object('retired',true,'historical',true);
end $$;
revoke all on function private.get_daily_tier_two(uuid,date) from public,anon;
grant execute on function private.get_daily_tier_two(uuid,date) to authenticated;
