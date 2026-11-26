const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.JKCREW_PGLITE_PATH || '@electric-sql/pglite');

const db = new PGlite();
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261126090000_hide_disabled_riders_from_leaderboards.sql'), 'utf8');
const as = async actor => {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor ? id(actor) : '']);
};

(async () => {
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create schema private;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create table public.profiles (
        id uuid primary key, display_name text, role text, team_id uuid,
        level integer default 1, xp_total integer default 0, avatar jsonb default '{}',
        country_code text, country_name text, ghost_mode boolean default false
      );
      create table public.assignment_point_awards (
        athlete_id uuid, session_id uuid, points integer, created_at timestamptz
      );
      create table public.training_sessions (
        id uuid, athlete_id uuid, total_points integer, started_at timestamptz
      );
      create table public.leaderboard_point_adjustments (
        athlete_id uuid, points integer, week_start date, reason text
      );
      create table public.athlete_badges (
        athlete_id uuid, badge_key text, badge_type text, label text,
        icon text, description text, earned_at timestamptz
      );
      create table public.weekly_other_try_awards (
        athlete_id uuid, points numeric, created_at timestamptz
      );
      create table private.rider_feature_access (
        athlete_id uuid primary key, features_disabled boolean not null default false
      );
      create function private.require_coach_approval() returns void
        language plpgsql stable as $$ begin return; end $$;
      create function private.xp_progression_enabled() returns boolean
        language sql stable as $$ select false $$;
      create function private.jkcrew_user_team_ids(p_actor uuid)
        returns table(team_id uuid) language sql stable security definer set search_path = '' as $$
          select p.team_id from public.profiles p where p.id = p_actor and p.team_id is not null
        $$;
      create function private.jkcrew_actor_team_memberships(p_actors uuid[])
        returns table(actor_id uuid, team_id uuid) language sql stable security definer set search_path = '' as $$
          select p.id, p.team_id from public.profiles p where p.id = any(p_actors) and p.team_id is not null
        $$;
      create function private.jkcrew_same_team_profile(p_actor uuid)
        returns boolean language sql stable security definer set search_path = '' as $$
          select exists (
            select 1 from public.profiles viewer join public.profiles target using (team_id)
            where viewer.id = auth.uid() and target.id = p_actor
          )
        $$;
      create function public.jkcrew_week_bounds(p_country_code text)
        returns table(week_start_date date, week_start_ts timestamptz, next_week_start_ts timestamptz)
        language sql stable as $$
          select date_trunc('week', now())::date,
                 date_trunc('week', now()),
                 date_trunc('week', now()) + interval '1 week'
        $$;
      create function public.level_for_xp(integer) returns integer
        language sql immutable as $$ select 1 $$;
      create function public.get_earned_badges(uuid) returns jsonb
        language sql stable as $$ select '[]'::jsonb $$;
    `);

    await db.exec(migration);

    const teamA = id(101), teamB = id(102);
    for (const [n, name, role, team] of [
      [1, 'Coach A', 'coach', teamA],
      [2, 'Rider Active 20', 'athlete', teamA],
      [3, 'Rider Disabled 50', 'athlete', teamA],
      [4, 'Rider Active 10', 'athlete', teamA],
      [5, 'Coach B', 'coach', teamB],
      [6, 'Rider Other Team 1000', 'athlete', teamB],
    ]) {
      await db.query(
        'insert into public.profiles(id,display_name,role,team_id,country_code,country_name) values($1,$2,$3,$4,\'AU\',\'Australia\')',
        [id(n), name, role, team],
      );
    }
    for (const [athlete, points] of [[2, 20], [3, 50], [4, 10], [6, 1000]]) {
      await db.query('insert into public.assignment_point_awards values($1,null,$2,now())', [id(athlete), points]);
    }
    await db.query('insert into private.rider_feature_access values($1,true)', [id(3)]);

    await as(1);
    let board = (await db.query('select * from private.approved_f58214f32cd50c933615433a()')).rows;
    assert.deepEqual(board.map(row => row.athlete_id), [id(2), id(4)], 'Disabled riders are omitted before leaderboard ranking; foreign teams stay private');
    assert.deepEqual(board.map(row => Number(row.rank_number)), [1, 2], 'Ranks are recalculated without the disabled rider');
    assert.deepEqual(board.map(row => Number(row.all_time_rank_number)), [1, 2], 'All-time ranks are recalculated without the disabled rider');
    assert.deepEqual((await db.query('select * from private.jkcrew_team_weekly_points()')).rows.map(row => row.athlete_id), [id(2), id(4)], 'Home summary omits disabled riders too');
    assert.deepEqual((await db.query('select * from public.get_disabled_leaderboard_rider_ids()')).rows, [{ athlete_id: id(3) }], 'Fallback receives only disabled IDs from the viewer’s team');

    await as(5);
    board = (await db.query('select * from private.approved_f58214f32cd50c933615433a()')).rows;
    assert.deepEqual(board.map(row => row.athlete_id), [id(6)], 'Another team’s leaderboard remains isolated');
    assert.deepEqual((await db.query('select * from public.get_disabled_leaderboard_rider_ids()')).rows, [], 'Fallback does not leak disabled rider IDs across teams');

    await as(1);
    await db.query('update private.rider_feature_access set features_disabled = false where athlete_id = $1', [id(3)]);
    board = (await db.query('select * from private.approved_f58214f32cd50c933615433a()')).rows;
    assert.deepEqual(board.map(row => row.athlete_id), [id(3), id(2), id(4)], 'Restoring feature access puts the rider back in the board');
    assert.deepEqual(board.map(row => Number(row.rank_number)), [1, 2, 3], 'Ranks recalculate after feature access is restored');
    assert.equal((await db.query("select has_function_privilege('anon', 'public.get_disabled_leaderboard_rider_ids()', 'execute') ok")).rows[0].ok, false, 'Anonymous users cannot call the fallback RPC');

    console.log('PASS disabled leaderboard: JKC and home rows, rank recalculation, same-team fallback scope, cross-team isolation, re-enable, and anonymous RPC denial.');
  } finally {
    await db.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
