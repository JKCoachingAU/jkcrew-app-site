-- Read-only rollout verification: no names, emails, tokens or health details.
-- Run immediately before/after the migration; normal live training can still
-- legitimately change point rows, so compare timestamps if their hashes differ.
select 'profiles_progression' as data_set,count(*) as rows,sum(coalesce(xp_total,0))::bigint as total,md5(coalesce(string_agg(jsonb_build_array(id,xp_total,level,badges)::text,'' order by id),'')) as checksum from public.profiles
union all select 'xp_ledger',count(*),sum(xp)::bigint,md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from public.xp_ledger t
union all select 'athlete_badges',count(*),null,md5(coalesce(string_agg(to_jsonb(t)::text,'' order by athlete_id,badge_key),'')) from public.athlete_badges t
union all select 'assignment_point_awards',count(*),sum(points)::bigint,md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from public.assignment_point_awards t
union all select 'leaderboard_point_adjustments',count(*),sum(points)::bigint,md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from public.leaderboard_point_adjustments t
union all select 'training_sessions',count(*),sum(total_points)::bigint,md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from public.training_sessions t
union all select 'trick_attempts',count(*),sum(points)::bigint,md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from public.trick_attempts t
union all select 'weekly_challenge_completions',count(*),null,md5(coalesce(string_agg(to_jsonb(t)::text,'' order by challenge_id,athlete_id),'')) from public.weekly_challenge_completions t
union all select 'weekly_rider_battles',count(*),null,md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from public.weekly_rider_battles t
union all select 'weekly_rider_battle_participants',count(*),null,md5(coalesce(string_agg(to_jsonb(t)::text,'' order by battle_id,athlete_id),'')) from public.weekly_rider_battle_participants t
union all select 'uci_rider_records',count(*),null,md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from private.uci_rider_records t
order by 1;
