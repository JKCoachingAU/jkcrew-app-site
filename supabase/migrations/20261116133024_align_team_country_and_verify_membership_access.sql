-- Earlier single-coach bootstrap rows were created before the country profile
-- update. Fill only blank team labels from their verified head coach profile.
update public.coach_teams team
set country_code=profile.country_code,country_name=profile.country_name
from private.coach_team_memberships member join public.profiles profile on profile.id=member.coach_id
where member.team_id=team.id and member.role='head_coach' and member.status='active'
  and nullif(team.country_code,'') is null and nullif(profile.country_code,'') is not null;

-- Trigger callbacks are invoked by their existing triggers, never by callers
-- through PostgREST. Removing their RPC grants leaves trigger operation intact.
revoke all on function public.sync_assignment_progress_xp(),public.sync_daily_pb_xp(),public.sync_percentage_attempt_xp() from public,anon,authenticated;
alter function public.xp_required_for_level(integer) set search_path=pg_catalog,public,pg_temp;
alter function public.level_for_xp(integer) set search_path=pg_catalog,public,pg_temp;
alter function public.level_badge(integer) set search_path=pg_catalog,public,pg_temp;
alter function public.xp_progress_json(integer) set search_path=pg_catalog,public,pg_temp;

notify pgrst,'reload schema';
