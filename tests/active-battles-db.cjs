// Real PostgreSQL regression coverage; the harness accepts only /tmp Unix sockets.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHarness, literal, json} = require('./helpers/local-postgres.cjs');
const root = path.resolve(__dirname, '..');
const migration = name => fs.readFileSync(path.join(root, 'supabase/migrations', name), 'utf8');
const feedMigration = migration('20260928003552_add_active_battles_spectator_feed.sql');
const h = createHarness('active_battles');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const coach = id(1), parent = id(2), observer = id(3), disabled = id(4), admin = id(5), unknown = id(6);
const riders = Array.from({length: 18}, (_, i) => id(100 + i));
const rows = sql => json(h.batch(`select coalesce(jsonb_agg(t), '[]') from (${sql}) t;`));
const scalar = sql => Object.values(rows(sql)[0])[0];
const auth = (user, anonymous = false) => `do $$begin
  perform set_config('request.jwt.claim.sub', ${literal(user || '')}, true);
  perform set_config('request.jwt.claims', ${literal(JSON.stringify({is_anonymous: anonymous}))}, true);
  perform set_config('request.path', '/rpc/get_active_rider_battles', true);
  perform set_config('request.method', 'POST', true);
end$$;`;
const gateway = (sql, user = observer, {role = 'authenticated', anonymous = false, gate = true} = {}) =>
  h.batch(`begin read only; ${auth(user, anonymous)} set local role ${role};
    ${gate ? 'select public.jkcrew_check_rider_feature_access();' : ''}
    ${sql}; commit;`).trim().split('\n').filter(Boolean).at(-1);
const feed = (args = '', user = observer, options) => JSON.parse(gateway(`select public.get_active_rider_battles(${args})`, user, options));
const tables = ['profiles', 'coach_athletes', 'weekly_rider_battles', 'weekly_rider_battle_participants',
  'assignment_point_awards', 'training_sessions', 'leaderboard_point_adjustments', 'push_notification_queue',
  'private.rider_battle_day_allocations', 'private.rider_feature_access'];
const snapshot = () => Object.fromEntries(tables.map(table => [table, scalar(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]') data from ${table} t`)]));
let sequence = 0, checks = 0;
const clear = () => {
  h.batch('truncate weekly_rider_battles, assignment_point_awards, training_sessions, leaderboard_point_adjustments, push_notification_queue cascade;');
  sequence = 0;
};
function battle(sizes = [2, 1], overrides = {}) {
  const number = ++sequence, battleId = id(1000 + number);
  const values = {
    status: "'accepted'", starts_at: "date_trunc('day', now() at time zone 'Australia/Brisbane') at time zone 'Australia/Brisbane' - interval '2 days'",
    ends_at: "date_trunc('day', now()) + interval '2 days'", archived_at: 'null', ...overrides
  };
  let offset = 0;
  h.batch(`insert into weekly_rider_battles(id, challenger_id, opponent_id, week_start, status, starts_at, ends_at, archived_at, battle_size, team_count, reward_points, duration_days)
    values(${literal(battleId)}, ${literal(riders[0])}, ${literal(riders[sizes[0]])}, current_date + ${number},
      ${values.status}, ${values.starts_at}, ${values.ends_at}, ${values.archived_at}, ${sizes[0]}, ${sizes.length}, 5, 3);
    ${sizes.flatMap((size, i) => Array.from({length: size}, () => `insert into weekly_rider_battle_participants(battle_id, athlete_id, team_number, response, baseline_points)
      values(${literal(battleId)}, ${literal(riders[offset++])}, ${i + 1}, 'accepted', 999);`)).join('\n')}`);
  return battleId;
}
async function test(name, fn) { clear(); await fn(); checks++; console.log('PASS ' + name); }

(async () => {
  const previous = fs.readFileSync(path.join(__dirname, 'battle-team-sizes-db.cjs'), 'utf8');
  await h.adapter.exec(previous.match(/await db\.exec\(`\n([\s\S]*?)\n  `\);/)[1]);
  h.batch(`create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;`);
  for (const name of ['20260907212548_three_sided_rider_battles.sql', '20260907212718_private_three_sided_battle_creation.sql',
    '20260911042341_expand_rider_battles_to_six_per_team.sql', '20260914101000_support_five_point_stakes_for_large_teams.sql',
    '20260915095056_battle_day_score_allocations.sql', '20260921115318_unequal_two_rider_battles.sql']) h.batch(migration(name));
  h.batch(`grant usage on schema auth, private to authenticated; grant usage on schema auth, private to anon;
    alter table profiles add column email text; alter table profiles add column private_notes text;
    insert into profiles(id,role,display_name) values
      (${literal(coach)},'coach','Coach'), (${literal(parent)},'parent','Parent'),
      (${literal(observer)},'athlete','Unrelated observer'), (${literal(disabled)},'athlete','Disabled rider'),
      (${literal(admin)},'admin','Admin');
    ${riders.map((rider, i) => `insert into profiles(id,role,display_name,avatar,email,private_notes)
      values(${literal(rider)},'athlete',${literal(`Full Rider Name ${i}`)},'{"image":"data:image/png;base64,PRIVATE_AVATAR"}', 'private@example.invalid','PRIVATE_PROFILE_NOTE');
      insert into coach_athletes values(${literal(coach)}, ${literal(rider)});`).join('\n')}
    create table private.rider_feature_access(athlete_id uuid primary key, features_disabled boolean);
    alter table private.rider_feature_access enable row level security;
    insert into private.rider_feature_access values(${literal(disabled)},true);
    alter table weekly_rider_battles enable row level security;
    alter table weekly_rider_battle_participants enable row level security;
    alter table profiles enable row level security;
    grant select on weekly_rider_battles, weekly_rider_battle_participants, profiles to authenticated;
  `);
  const access = migration('20260914101302_rider_feature_access_controls.sql');
  const accessFunction = name => access.slice(access.indexOf(`create function ${name}(`)).split('$$;')[0] + '$$;';
  h.batch(accessFunction('private.rider_features_disabled') + accessFunction('public.jkcrew_check_rider_feature_access'));
  h.batch('revoke all on function private.rider_features_disabled() from public, anon; grant execute on function private.rider_features_disabled() to authenticated;');
  battle();
  const security = () => rows(`select c.oid::regclass::text name,c.relrowsecurity,c.relacl::text acl,
      (select coalesce(jsonb_agg(to_jsonb(p) order by p.policyname), '[]') from pg_policies p where p.schemaname=n.nspname and p.tablename=c.relname) policies
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private') and c.relkind='r' order by name`);
  const beforeData = snapshot(), beforeSecurity = security();
  h.batch(feedMigration);
  assert.deepEqual(snapshot(), beforeData, 'Migration never mutates existing data');
  assert.deepEqual(security(), beforeSecurity, 'Migration never expands table grants or RLS');
  checks++; console.log('PASS migration preserves all table data, policies and grants');

  await test('unrelated riders and coaches see active summaries while underlying tables remain inaccessible', () => {
    const battleId = battle();
    for (const user of [observer, riders[0], coach, admin]) {
      const result = feed('', user);
      assert.deepEqual(result.battles.map(b => b.id), [battleId]);
      assert.equal(gateway('select count(*) from weekly_rider_battles', user), '0');
      assert.equal(gateway('select count(*) from weekly_rider_battle_participants', user), '0');
    }
    assert.equal(scalar(`select prosecdef from pg_proc where oid='public.get_active_rider_battles(integer,timestamptz,uuid)'::regprocedure`), false);
    assert.equal(scalar(`select prosecdef from pg_proc where oid='private.active_rider_battles(integer,timestamptz,uuid)'::regprocedure`), true);
    for (const schema of ['public.get_active_rider_battles', 'private.active_rider_battles']) {
      assert.equal(scalar(`select provolatile from pg_proc where oid='${schema}(integer,timestamptz,uuid)'::regprocedure`), 's');
      assert.deepEqual(scalar(`select proconfig from pg_proc where oid='${schema}(integer,timestamptz,uuid)'::regprocedure`), ['search_path=""']);
      assert.equal(scalar(`select has_function_privilege('anon','${schema}(integer,timestamptz,uuid)','execute')`), false);
      assert.equal(scalar(`select has_function_privilege('authenticated','${schema}(integer,timestamptz,uuid)','execute')`), true);
    }
  });
  await test('anonymous, parent, unknown and disabled accounts fail at both API and private helper', () => {
    battle();
    for (const user of ['', parent, unknown, disabled]) {
      assert.throws(() => feed('', user), /Sign in|contact your coach/);
      assert.throws(() => gateway('select private.active_rider_battles()', user, {gate: false}), /Sign in|contact your coach/);
    }
    for (const endpoint of ['public.get_active_rider_battles()', 'private.active_rider_battles()']) {
      assert.throws(() => gateway(`select ${endpoint}`, '', {role: 'anon', gate: false}), /permission denied/);
      assert.throws(() => gateway(`select ${endpoint}`, observer, {anonymous: true, gate: false}), /Sign in/);
    }
  });
  await test('only accepted, started, unexpired and unarchived battles are returned without settling expired rows', () => {
    const live = battle();
    for (const status of ['pending', 'declined', 'cancelled', 'completed']) battle([1, 1], {status: literal(status)});
    battle([1, 1], {starts_at: "now() + interval '1 hour'"});
    battle([1, 1], {starts_at: 'null'});
    battle([1, 1], {ends_at: 'null'});
    const expired = battle([1, 1], {ends_at: 'now()'});
    battle([1, 1], {archived_at: 'now()'});
    const before = snapshot();
    const result = feed();
    assert.deepEqual(result.battles.map(b => b.id), [live]);
    assert(Date.parse(result.server_now) < Date.parse(result.battles[0].ends_at));
    assert(Date.parse(result.server_now) >= Date.parse(result.battles[0].starts_at));
    assert.equal(scalar(`select status from weekly_rider_battles where id=${literal(expired)}`), 'accepted');
    assert.deepEqual(snapshot(), before, 'Read-only transaction cannot settle, notify or award');
  });
  await test('full roster names and unequal/three-sided format survive while private payload fields stay absent', () => {
    const sizes = [[2, 1], [1, 2], [2, 2], [2, 2, 2], [6, 6, 6]];
    const ids = sizes.map(size => battle(size));
    const result = feed();
    assert.deepEqual(Object.keys(result).sort(), ['battles', 'has_more', 'next_cursor', 'server_now']);
    for (const [index, battleId] of ids.entries()) {
      const item = result.battles.find(b => b.id === battleId);
      assert.equal(item.format, sizes[index].join('v'));
      assert.equal(item.battle_size, sizes[index][0]);
      assert.equal(item.team_count, sizes[index].length);
      assert.equal(item.reward_points, 5);
      assert.equal(item.duration_days, 3);
      assert.equal(item.participants.length, sizes[index].reduce((a, b) => a + b));
      assert.deepEqual(Object.keys(item).sort(), ['battle_size','duration_days','ends_at','format','id','participants','reward_points','starts_at','team_count','teams']);
      for (const member of item.participants) {
        assert.match(member.display_name, /^Full Rider Name \d+$/);
        assert.deepEqual(Object.keys(member).sort(), ['athlete_id','display_name','forfeited_at','team_number']);
      }
      for (const team of item.teams) assert.deepEqual(Object.keys(team).sort(), ['forfeited','score','team_number']);
    }
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|private@example|avatar|email|private_notes|score_allocation_date|reason|baseline_points/);
  });
  await test('team totals match canonical scoring with capped guest-day allocation, corrections and deduplicated sessions', () => {
    const battleId = battle();
    const yesterday = "(date_trunc('day', now() at time zone 'Australia/Brisbane') - interval '1 day' + interval '12 hours') at time zone 'Australia/Brisbane'";
    const earlier = "(date_trunc('day', now() at time zone 'Australia/Brisbane') - interval '2 days' + interval '12 hours') at time zone 'Australia/Brisbane'";
    h.batch(`insert into training_sessions(id,athlete_id,total_points,started_at) values
      (${literal(id(10000))},${literal(riders[0])},100,${yesterday}),
      (${literal(id(10001))},${literal(riders[1])},7,${yesterday});
      insert into assignment_point_awards(athlete_id,session_id,points,created_at) values
      (${literal(riders[0])},${literal(id(10000))},30,${yesterday}),
      (${literal(riders[2])},null,11,${yesterday}),
      (${literal(riders[0])},null,1000,now()-interval '10 days'),
      (${literal(riders[0])},null,1000,now()+interval '10 days');
      insert into leaderboard_point_adjustments(athlete_id,points,reason,created_at) values
      (${literal(riders[0])},-8,'Correction',${earlier}),
      (${literal(riders[0])},500,'All-time score correction: private note',${yesterday});
      insert into private.rider_battle_day_allocations(battle_id,athlete_id,score_date,team_number,created_by,reason)
      values(${literal(battleId)},${literal(riders[0])},(now() at time zone 'Australia/Brisbane')::date-1,2,${literal(coach)},'PRIVATE_ALLOCATION_NOTE');`);
    const canonical = rows(`select athlete_id,private.jkcrew_rider_battle_score_allocations(battle_id,athlete_id) allocation
      from weekly_rider_battle_participants where battle_id=${literal(battleId)} order by athlete_id`);
    assert.deepEqual(canonical.map(r => r.allocation), [{'1':0,'2':22},{'1':7},{'2':11}]);
    const before = snapshot(), result = feed().battles[0];
    assert.deepEqual(result.teams.map(t => t.score), [7,33]);
    assert.deepEqual(result.participants.map(p => p.team_number), [1,1,2], 'Guest points do not move roster membership');
    for (const team of result.teams) assert.equal(team.score, canonical.reduce((sum, rider) => sum + (rider.allocation[team.team_number] || 0), 0));
    assert.deepEqual(snapshot(), before);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|score_allocations|reason/);
    h.batch(`insert into assignment_point_awards(athlete_id,points,created_at) values(${literal(riders[2])},4,now()-interval '1 second');`);
    assert.deepEqual(feed().battles[0].teams.map(t => t.score), [7,37], 'Refresh sees a changed authoritative score');
  });
  await test('three-sided forfeited sources stop contributing to either roster or guest teams', () => {
    const battleId = battle([1,1,1]);
    const yesterday = "(date_trunc('day', now() at time zone 'Australia/Brisbane') - interval '1 day' + interval '12 hours') at time zone 'Australia/Brisbane'";
    h.batch(`insert into assignment_point_awards(athlete_id,points,created_at) values
      (${literal(riders[0])},12,${yesterday}),(${literal(riders[1])},5,${yesterday}),(${literal(riders[2])},9,${yesterday});
      insert into private.rider_battle_day_allocations(battle_id,athlete_id,score_date,team_number,created_by,reason)
      values(${literal(battleId)},${literal(riders[0])},(now() at time zone 'Australia/Brisbane')::date-1,2,${literal(coach)},'Guest session');`);
    assert.deepEqual(feed().battles[0].teams.map(t => t.score), [0,17,9]);
    h.batch(`update weekly_rider_battle_participants set forfeited_at=now() where battle_id=${literal(battleId)} and athlete_id=${literal(riders[0])};`);
    assert.deepEqual(feed().battles[0].teams, [{team_number:1,score:0,forfeited:true},{team_number:2,score:5,forfeited:false},{team_number:3,score:9,forfeited:false}]);
    assert(feed().battles[0].participants[0].forfeited_at);
  });
  await test('bounded cursor pages cover every battle exactly once including tied end times', () => {
    const expected = Array.from({length:55}, () => battle([1,1]));
    const before = snapshot();
    const first = feed('999999');
    assert.equal(first.battles.length, 24);
    assert.equal(first.has_more, true);
    assert.deepEqual(first.next_cursor, {id:first.battles.at(-1).id, ends_at:first.battles.at(-1).ends_at});
    const all = [...first.battles];
    let page = first;
    while (page.has_more) {
      const cursor = page.next_cursor;
      page = feed(`24, ${literal(cursor.ends_at)}, ${literal(cursor.id)}`);
      all.push(...page.battles);
    }
    assert.equal(page.battles.length, 7);
    assert.equal(page.next_cursor, null);
    assert.deepEqual(all.map(b => b.id), expected);
    assert.equal(feed('0').battles.length, 1);
    assert.equal(feed('-2').battles.length, 1);
    assert.equal(feed('null').battles.length, 24);
    assert.throws(() => feed(`24, now(), null`), /both active battle cursor/);
    assert.throws(() => feed(`24, null, ${literal(expected[0])}`), /both active battle cursor/);
    const last = all.at(-1);
    const empty = feed(`24, ${literal(last.ends_at)}, ${literal(last.id)}`);
    assert.deepEqual(empty.battles, []); assert.equal(empty.has_more,false); assert.equal(empty.next_cursor,null);
    assert.deepEqual(snapshot(), before, 'Pagination is read-only across every page');
  });
  await test('empty feed carries server time and a completed cursor', () => {
    const result = feed();
    assert.deepEqual(result.battles, []); assert.equal(result.has_more,false); assert.equal(result.next_cursor,null);
    assert(Number.isFinite(Date.parse(result.server_now)));
  });
  console.log(`${checks} Active Battles PostgreSQL regressions passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => h.close());
