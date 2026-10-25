// Isolated PostgreSQL (PGlite) checks. Never connects to a production database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.JKCREW_PGLITE_PATH || '@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const migration = name => fs.readFileSync(path.join(root, 'supabase/migrations', name), 'utf8');
const parentMigration = migration('20261025025254_parent_active_battles_read_only.sql');
const db = new PGlite();
const q = async (sql, values = []) => (await db.query(sql, values)).rows;
const scalar = async (sql, values = []) => Object.values((await q(sql, values))[0])[0];
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const parent = id(1), otherParent = id(2), coach = id(3), admin = id(4), unknown = id(5);
const riders = Array.from({ length: 18 }, (_, i) => id(100 + i));
let sequence = 1000, checks = 0;
const auth = async (who, anonymous = false) => {
  await scalar("select set_config('request.jwt.claim.sub',$1,false)", [who || '']);
  await scalar("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ is_anonymous: anonymous })]);
};
const feed = (child = riders[0], limit = 24, ends = null, cursor = null, helper = false) =>
  scalar(`select ${helper ? 'private.parent_active_rider_battles' : 'public.get_parent_active_rider_battles'}($1,$2,$3,$4)`, [child, limit, ends, cursor]);
const award = (rider, amount, time = "now()-interval '12 hours'") => q(`insert into assignment_point_awards(athlete_id,points,created_at) values($1,$2,${time})`, [rider, amount]);
const adjust = (rider, amount, reason) => q("insert into leaderboard_point_adjustments(athlete_id,coach_id,points,reason,created_at) values($1,$2,$3,$4,now()-interval '12 hours')", [rider, coach, amount, reason]);
async function battle(sizes = [2, 1], { status = 'accepted', offset = 0, starts = "now()-interval '2 days'", ends = "now()+interval '1 day'", archived = 'null' } = {}) {
  const number = sequence++, battleId = id(number);
  await q(`insert into weekly_rider_battles(id,challenger_id,opponent_id,created_by,week_start,status,starts_at,ends_at,archived_at,battle_size,team_count,reward_points,duration_days)
    values($1,$2,$3,$4,current_date+$5::integer,$6,${starts},${ends},${archived},$7,$8,5,3)`,
  [battleId, riders[offset], riders[offset + sizes[0]], coach, number, status, sizes[0], sizes.length]);
  let i = offset;
  for (let team = 1; team <= sizes.length; team++) for (let n = 0; n < sizes[team - 1]; n++) {
    await q("insert into weekly_rider_battle_participants(battle_id,athlete_id,team_number,response,baseline_points) values($1,$2,$3,'accepted',999)", [battleId, riders[i++], team]);
  }
  return battleId;
}
const tables = ['profiles', 'coach_athletes', 'parent_athletes', 'weekly_rider_battles', 'weekly_rider_battle_participants',
  'assignment_point_awards', 'training_sessions', 'leaderboard_point_adjustments', 'push_notification_queue',
  'private.rider_battle_day_allocations', 'private.rider_feature_access', 'private.rider_recovery_states'];
async function snapshot() {
  const result = {};
  for (const table of tables) result[table] = await q(`select to_jsonb(t) value from ${table} t order by to_jsonb(t)::text`);
  return result;
}
const security = () => q(`select c.oid::regclass::text name,c.relrowsecurity,c.relacl::text acl,
  (select coalesce(jsonb_agg(to_jsonb(p) order by p.policyname),'[]') from pg_policies p where p.schemaname=n.nspname and p.tablename=c.relname) policies
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','private') and c.relkind='r' order by name`);
async function rejects(fn, pattern) {
  await db.exec('savepoint expected_failure');
  try { await assert.rejects(fn, pattern); }
  finally { await db.exec('rollback to savepoint expected_failure'); }
}
async function test(name, fn) {
  await db.exec('begin');
  try { await auth(parent); await fn(); checks++; console.log('PASS ' + name); }
  finally { await db.exec('rollback; reset role'); }
}
(async () => {
  const foundation = fs.readFileSync(path.join(__dirname, 'battle-team-sizes-db.cjs'), 'utf8');
  await db.exec(foundation.match(/await db\.exec\(`\n([\s\S]*?)\n  `\);/)[1]);
  for (const name of ['20260907212548_three_sided_rider_battles.sql', '20260907212718_private_three_sided_battle_creation.sql',
    '20260911042341_expand_rider_battles_to_six_per_team.sql', '20260914101000_support_five_point_stakes_for_large_teams.sql',
    '20260915095056_battle_day_score_allocations.sql', '20260921115318_unequal_two_rider_battles.sql',
    '20261025014336_exclude_battle_rewards_from_live_scores.sql']) await db.exec(migration(name));
  await db.exec(`create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create table parent_athletes(parent_id uuid,athlete_id uuid,primary key(parent_id,athlete_id));
    create table private.rider_feature_access(athlete_id uuid primary key,features_disabled boolean);
    create table private.rider_recovery_states(athlete_id uuid primary key,enabled boolean);
    create function private.rider_recovery_active(p_athlete_id uuid) returns boolean language sql stable security definer set search_path='' as $$
      select exists(select 1 from private.rider_recovery_states where athlete_id=p_athlete_id and enabled) $$;
    create function private.rider_features_disabled() returns boolean language sql stable security definer set search_path='' as $$
      select exists(select 1 from private.rider_feature_access where athlete_id=auth.uid() and features_disabled) $$;
    grant usage on schema public,auth,private to authenticated;
    grant usage on schema public,auth,private to anon;
    alter table profiles add column email text;
    alter table profiles add column private_notes text;
    alter table profiles enable row level security;
    alter table parent_athletes enable row level security;
    alter table weekly_rider_battles enable row level security;
    alter table weekly_rider_battle_participants enable row level security;
    alter table private.rider_feature_access enable row level security;
    alter table private.rider_recovery_states enable row level security;
    grant select on profiles,parent_athletes,weekly_rider_battles,weekly_rider_battle_participants to authenticated;
  `);
  await db.exec(migration('20260928003552_add_active_battles_spectator_feed.sql'));
  for (const [who, role] of [[parent, 'parent'], [otherParent, 'parent'], [coach, 'coach'], [admin, 'admin']]) {
    await q('insert into profiles(id,role,display_name) values($1,$2,$2)', [who, role]);
  }
  for (const [i, rider] of riders.entries()) {
    await q("insert into profiles(id,role,display_name,avatar,email,private_notes) values($1,'athlete',$2,'{\"image\":\"PRIVATE_AVATAR\"}','private@example.invalid','PRIVATE_NOTE')", [rider, 'Rider ' + String(i).padStart(2, '0')]);
    await q('insert into coach_athletes values($1,$2)', [coach, rider]);
  }
  await q('insert into parent_athletes values($1,$2),($1,$3),($4,$5)', [parent, riders[0], riders[5], otherParent, riders[2]]);
  const beforeData = await snapshot(), beforeSecurity = await security();
  await db.exec(parentMigration);
  assert.deepEqual(await snapshot(), beforeData);
  assert.deepEqual(await security(), beforeSecurity, 'No table policy or grant expansion');
  checks++; console.log('PASS migration preserves every record, raw-table policy and grant');

  await test('linked parent sees selected child only, while raw tables and global feed stay inaccessible', async () => {
    const expected = await battle();
    const sibling = await battle([1, 1], { offset: 5 });
    await battle([1, 1], { offset: 9 });
    await db.exec('set local role authenticated');
    assert.deepEqual((await feed()).battles.map(b => b.id), [expected]);
    assert.deepEqual((await feed(riders[5])).battles.map(b => b.id), [sibling]);
    for (const table of ['weekly_rider_battles', 'weekly_rider_battle_participants', 'parent_athletes', 'profiles']) {
      assert.equal(await scalar(`select count(*)::integer from ${table}`), 0);
    }
    await rejects(() => scalar('select public.get_active_rider_battles()'), /Sign in as a rider or coach/);
    await rejects(() => scalar('select public.forfeit_rider_battle($1)', [expected]), /participat|rider|battle/i);
  });
  await test('RPC and helper reject strangers, forged child IDs, anonymous sessions and non-parent roles', async () => {
    await battle();
    for (const who of ['', unknown, coach, admin, riders[0]]) for (const helper of [false, true]) {
      await auth(who); await rejects(() => feed(riders[0], 24, null, null, helper), /Sign in as a linked parent/);
    }
    for (const helper of [false, true]) {
      await auth(parent, true); await rejects(() => feed(riders[0], 24, null, null, helper), /Sign in as a linked parent/);
      await auth(parent);
      for (const child of [null, unknown, riders[2]]) await rejects(() => feed(child, 24, null, null, helper), /not available to your account/);
      await auth(otherParent); await rejects(() => feed(riders[0], 24, null, null, helper), /not available to your account/);
      await db.exec('set local role anon');
      await rejects(() => feed(riders[2], 24, null, null, helper), /permission denied/);
      await db.exec('reset role');
    }
  });
  await test('current links, roles, disabled flags and recovery mode are rechecked on every page', async () => {
    await battle(); await battle();
    const first = await feed(riders[0], 1);
    assert(first.has_more);
    await q('delete from parent_athletes where parent_id=$1 and athlete_id=$2', [parent, riders[0]]);
    await rejects(() => feed(riders[0], 1, first.next_cursor.ends_at, first.next_cursor.id), /not available/);
    await q('insert into parent_athletes values($1,$2)', [parent, riders[0]]);
    for (const who of [parent, riders[0]]) for (const [table, column] of [['private.rider_feature_access', 'features_disabled'], ['private.rider_recovery_states', 'enabled']]) {
      await q(`insert into ${table}(athlete_id,${column}) values($1,true)`, [who]);
      await rejects(() => feed(), /not available/);
      await q(`delete from ${table} where athlete_id=$1`, [who]);
      assert.equal((await feed()).battles.length, 2);
    }
    await q("update profiles set role='coach' where id=$1", [riders[0]]);
    await rejects(() => feed(), /not available/);
  });
  await test('only accepted started nonexpired unarchived battles with active child participation appear', async () => {
    const expected = await battle();
    for (const status of ['pending', 'declined', 'cancelled', 'completed']) await battle([1, 1], { status });
    for (const options of [{ starts: "now()+interval '1 hour'" }, { starts: 'null' }, { ends: 'null' }, { ends: 'now()' }, { archived: 'now()' }]) await battle([1, 1], options);
    const forfeited = await battle([1, 1, 1]);
    await q('update weekly_rider_battle_participants set forfeited_at=now() where battle_id=$1 and athlete_id=$2', [forfeited, riders[0]]);
    const before = await snapshot();
    assert.deepEqual((await feed()).battles.map(b => b.id), [expected]);
    assert.deepEqual(await snapshot(), before, 'Feed cannot settle or pay expired battles');
  });
  await test('all team formats carry only summary fields and selected child identity', async () => {
    const sizes = [[1, 1], [2, 1], [1, 2], [2, 2], [2, 2, 2], [6, 6, 6]];
    const ids = [];
    for (const size of sizes) ids.push(await battle(size));
    const result = await feed();
    assert.deepEqual(Object.keys(result).sort(), ['athlete_id', 'battles', 'has_more', 'next_cursor', 'server_now']);
    assert.equal(result.athlete_id, riders[0]);
    assert(Number.isFinite(Date.parse(result.server_now)));
    for (let i = 0; i < sizes.length; i++) {
      const item = result.battles.find(b => b.id === ids[i]);
      assert.equal(item.format, sizes[i].join('v'));
      assert.equal(item.participants.length, sizes[i].reduce((a, b) => a + b));
      assert.deepEqual(Object.keys(item).sort(), ['battle_size', 'duration_days', 'ends_at', 'format', 'id', 'participants', 'reward_points', 'starts_at', 'team_count', 'teams']);
      item.participants.forEach(p => assert.deepEqual(Object.keys(p).sort(), ['athlete_id', 'display_name', 'forfeited_at', 'team_number']));
    }
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|private@example|avatar|email|private_notes|baseline_points|reason|points_delta/);
  });
  await test('ghost opponents are redacted without hiding the child battle or changing scores', async () => {
    await battle([2, 1]);
    await award(riders[0], 2); await award(riders[1], 3); await award(riders[2], 4);
    await q('update profiles set ghost_mode=true where id=any($1)', [[riders[0], riders[1], riders[2]]]);
    const item = (await feed()).battles[0];
    assert.equal(item.participants[0].athlete_id, riders[0]);
    assert.equal(item.participants[0].display_name, 'Rider 00');
    assert.deepEqual(item.participants.slice(1).map(p => [p.athlete_id, p.display_name]), [[null, 'Private rider'], [null, 'Private rider']]);
    assert.deepEqual(item.teams.map(t => t.score), [5, 4]);
    assert.equal(item.format, '2v1');
    assert(!JSON.stringify(item).includes(riders[1]) && !JSON.stringify(item).includes(riders[2]));
    await q('insert into parent_athletes values($1,$2)', [parent, riders[1]]);
    assert.equal((await feed()).battles[0].participants[1].athlete_id, riders[1], 'Current own-child links retain identity');
  });
  await test('scores match rider spectator calculations and exclude all earlier battle payouts', async () => {
    const battleId = await battle([2, 2]);
    await award(riders[0], 6); await award(riders[1], 8); await award(riders[2], 9);
    await adjust(riders[0], 100, 'Rider battle ' + id(999) + ' win');
    await adjust(riders[1], -100, 'RIDER BATTLE ' + id(999) + ' loss');
    await adjust(riders[2], 5, 'Weekly challenge reward');
    await adjust(riders[3], 1, 'Other things landed approval');
    const before = await snapshot();
    const parentResult = (await feed()).battles[0];
    assert.deepEqual(parentResult.teams.map(t => t.score), [14, 15]);
    await auth(riders[17]);
    const riderResult = (await scalar('select public.get_active_rider_battles()')).battles.find(b => b.id === battleId);
    assert.deepEqual(parentResult, riderResult);
    await auth(parent); assert.deepEqual(await snapshot(), before);
    await award(riders[0], 3, "now()-interval '1 second'");
    assert.deepEqual((await feed()).battles[0].teams.map(t => t.score), [17, 15]);
  });
  await test('session-day team allocations, duplicate session totals and forfeitures use canonical totals', async () => {
    const battleId = await battle([1, 1, 1]);
    const day = await scalar("select (timezone('Australia/Brisbane',now())::date-1)::text");
    const dayStart = await scalar("select $1::date::timestamp at time zone 'Australia/Brisbane'", [day]);
    await q("update weekly_rider_battles set starts_at=$2::timestamptz-interval '1 day' where id=$1", [battleId, dayStart]);
    await q("insert into training_sessions(id,athlete_id,total_points,started_at) values($1,$2,999,$3::timestamptz+interval '12 hours')", [id(800), riders[1], dayStart]);
    await q("insert into assignment_point_awards(athlete_id,session_id,points,created_at) values($1,$2,12,$3::timestamptz+interval '12 hours')", [riders[1], id(800), dayStart]);
    await award(riders[0], 5); await award(riders[2], 9);
    await q("insert into private.rider_battle_day_allocations(battle_id,athlete_id,score_date,team_number,created_by,reason) values($1,$2,$3,1,$4,'PRIVATE_ALLOCATION_NOTE')", [battleId, riders[1], day, coach]);
    assert.deepEqual((await feed()).battles[0].teams.map(t => t.score), [17, 0, 9]);
    await q('update weekly_rider_battle_participants set forfeited_at=now() where battle_id=$1 and athlete_id=$2', [battleId, riders[1]]);
    assert.deepEqual((await feed()).battles[0].teams, [
      { team_number: 1, score: 5, forfeited: false }, { team_number: 2, score: 0, forfeited: true }, { team_number: 3, score: 9, forfeited: false }
    ]);
  });
  await test('bounded pagination is deterministic and cannot cross the selected-child scope', async () => {
    const expected = [];
    for (let n = 0; n < 55; n++) expected.push(await battle([1, 1]));
    await battle([1, 1], { offset: 5 });
    const before = await snapshot();
    let page = await feed(riders[0], 999999);
    assert.equal(page.battles.length, 24);
    const all = [...page.battles];
    while (page.has_more) {
      assert.deepEqual(page.next_cursor, { id: page.battles.at(-1).id, ends_at: page.battles.at(-1).ends_at });
      page = await feed(riders[0], 24, page.next_cursor.ends_at, page.next_cursor.id);
      all.push(...page.battles);
    }
    assert.equal(page.battles.length, 7); assert.equal(page.next_cursor, null);
    assert.deepEqual(all.map(b => b.id), expected);
    assert.equal((await feed(riders[0], 0)).battles.length, 1);
    assert.equal((await feed(riders[0], null)).battles.length, 24);
    await rejects(() => feed(riders[0], 24, '2026-01-01', null), /both active battle cursor/);
    await rejects(() => feed(riders[0], 24, null, expected[0]), /both active battle cursor/);
    assert.deepEqual(await snapshot(), before);
  });
  await test('empty state and function privileges remain read-only and least-privilege', async () => {
    assert.deepEqual((await feed()).battles, []);
    for (const [name, definer] of [['public.get_parent_active_rider_battles', false], ['private.parent_active_rider_battles', true]]) {
      const signature = name + '(uuid,integer,timestamptz,uuid)';
      const fn = (await q('select prosecdef,provolatile,proconfig from pg_proc where oid=$1::regprocedure', [signature]))[0];
      assert.equal(fn.prosecdef, definer); assert.equal(fn.provolatile, 's'); assert.deepEqual(fn.proconfig, ['search_path=""']);
      assert.equal(await scalar("select has_function_privilege('anon',$1,'execute')", [signature]), false);
      assert.equal(await scalar("select has_function_privilege('authenticated',$1,'execute')", [signature]), true);
    }
  });
  await auth(parent);
  await db.exec('begin read only; set local role authenticated');
  assert.deepEqual((await feed()).battles, []);
  await db.exec('rollback'); checks++; console.log('PASS authenticated RPC works inside a read-only transaction');
  console.log(`${checks} parent active battle database regressions passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.close());
