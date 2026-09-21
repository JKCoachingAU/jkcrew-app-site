// Runs only against a disposable PostgreSQL database on a /tmp Unix socket.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHarness, literal, json} = require('./helpers/local-postgres.cjs');
const root = path.resolve(__dirname, '..');
const migration = name => fs.readFileSync(path.join(root, 'supabase/migrations', name), 'utf8');
const h = createHarness('unequal_battles');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const coach = id(1), otherCoach = id(2), parent = id(3), outsider = id(4), ghost = id(5);
const riders = Array.from({length: 24}, (_, i) => id(i + 100));
const arr = values => values.length ? `array[${values.map(literal).join(',')}]::uuid[]` : "'{}'::uuid[]";
const rows = sql => json(h.batch(`select coalesce(jsonb_agg(t), '[]') from (${sql}) t;`));
const scalar = sql => Object.values(rows(sql)[0])[0];
const auth = user => `do $$begin perform set_config('request.jwt.claim.sub', ${literal(user || '')}, true); perform set_config('request.path', '/rpc/request_rider_battle_v3', true); perform set_config('request.method', 'POST', true); end$$;`;
const gateway = (sql, user = coach, role = 'authenticated') => h.batch(`begin; ${auth(user)} set local role ${role}; select public.jkcrew_check_rider_feature_access(); ${sql}; commit;`).trim().split('\n').filter(Boolean).at(-1);
const request = (teams, stake = 5, days = 1) => `select public.request_rider_battle_v3(${arr(teams[0])}, ${arr(teams[1])}, ${arr(teams[2] || [])}, ${days}, ${stake})`;
const create = (sizes = [2, 1], stake = 5, user = coach) => {
  let offset = 0;
  const teams = sizes.map(size => { const team = riders.slice(offset, offset + size); offset += size; return team; });
  return gateway(request(teams, stake), user);
};
const participants = battle => rows(`select athlete_id, team_number, response, is_winner, points_delta from weekly_rider_battle_participants where battle_id=${literal(battle)} order by team_number, athlete_id`);
const clear = () => h.batch('truncate weekly_rider_battles, assignment_point_awards, leaderboard_point_adjustments, training_sessions, push_notification_queue cascade; delete from private.rider_feature_access;');
function accept(battle) {
  const members = participants(battle).filter(p => p.response === 'pending');
  members.forEach((p, i) => assert.equal(gateway(`select public.respond_rider_battle(${literal(battle)}, 'accepted')`, p.athlete_id), i === members.length - 1 ? 'accepted' : 'pending'));
}
function score(battle, teamTotals, expired = true) {
  h.batch(`update weekly_rider_battles set starts_at=now()-interval '2 days', ends_at=now()+interval '${expired ? '-1' : '1'} day' where id=${literal(battle)};`);
  for (let team = 1; team <= teamTotals.length; team++) {
    const rider = participants(battle).find(p => p.team_number === team).athlete_id;
    h.batch(`insert into assignment_point_awards(athlete_id, points, created_at) values(${literal(rider)}, ${teamTotals[team - 1]}, now()-interval '36 hours');`);
  }
}
function payout(battle, sizes, stake, winner) {
  const all = participants(battle);
  assert.equal(all.length, sizes.reduce((a, b) => a + b, 0));
  sizes.forEach((size, index) => {
    const team = index + 1, total = team === winner ? stake * (sizes.length - 1) : stake;
    const members = all.filter(p => p.team_number === team);
    assert.equal(members.length, size);
    members.forEach((p, rank) => {
      const share = Math.floor(total / size) + (rank < total % size ? 1 : 0);
      assert.equal(p.points_delta, winner === null ? 0 : ((team === winner ? share : -share) || 0));
      assert.equal(p.is_winner, winner === null ? null : team === winner);
    });
  });
  const ledger = rows(`select athlete_id, points from leaderboard_point_adjustments where reason like ${literal(`Rider battle ${battle}%`)}`);
  assert.equal(ledger.length, all.filter(p => p.points_delta !== 0).length);
  for (const entry of ledger) assert.equal(entry.points, all.find(p => p.athlete_id === entry.athlete_id).points_delta);
  assert.equal(ledger.reduce((total, entry) => total + entry.points, 0), 0, 'Every outcome remains zero-sum');
  return ledger;
}
let checks = 0;
async function test(name, fn) { clear(); await fn(); checks++; console.log('PASS ' + name); }

(async () => {
  // Use the existing battle regression foundation, then the real migration chain.
  const previous = fs.readFileSync(path.join(__dirname, 'battle-team-sizes-db.cjs'), 'utf8');
  const foundation = previous.match(/await db\.exec\(`\n([\s\S]*?)\n  `\);/)[1];
  await h.adapter.exec(foundation);
  for (const name of ['20260907212548_three_sided_rider_battles.sql', '20260907212718_private_three_sided_battle_creation.sql', '20260911042341_expand_rider_battles_to_six_per_team.sql', '20260914101000_support_five_point_stakes_for_large_teams.sql', '20260915095056_battle_day_score_allocations.sql']) h.batch(migration(name));
  h.batch(`grant usage on schema auth, private to authenticated; grant usage on schema auth to anon;
    insert into profiles(id,role,display_name,ghost_mode) values (${literal(coach)},'coach','Coach',false),(${literal(otherCoach)},'coach','Other coach',false),(${literal(parent)},'parent','Parent',false),(${literal(outsider)},'athlete','Outsider',false),(${literal(ghost)},'athlete','Ghost',true);
    ${riders.map((rider, i) => `insert into profiles(id,role,display_name) values(${literal(rider)},'athlete','Rider ${i}'); insert into coach_athletes values(${literal(coach)},${literal(rider)});`).join('\n')}
    create table private.rider_feature_access(athlete_id uuid primary key, features_disabled boolean);
  `);
  const access = migration('20260914101302_rider_feature_access_controls.sql');
  const accessFunction = name => access.slice(access.indexOf(`create function ${name}(`)).split('$$;')[0] + '$$;';
  h.batch(accessFunction('private.rider_features_disabled') + accessFunction('public.jkcrew_check_rider_feature_access'));
  h.batch('revoke all on function private.rider_features_disabled() from public, anon; grant execute on function private.rider_features_disabled() to authenticated;');
  const acl = () => rows("select n.nspname,p.proname,p.proacl::text privileges,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname in ('request_rider_battle_v3','create_three_sided_rider_battle','settle_expired_rider_battles','forfeit_rider_battle') order by n.nspname,p.proname");
  const existing = create([2, 2]);
  const snapshot = () => rows('select to_jsonb(b) battle, (select jsonb_agg(p order by p.athlete_id) from weekly_rider_battle_participants p where p.battle_id=b.id) participants from weekly_rider_battles b');
  const before = snapshot(), beforeAcl = acl();
  assert.throws(() => create([2, 1]), /equal teams/, 'Reproduce the original 2v1 rejection');
  h.batch(migration('20260921115318_unequal_two_rider_battles.sql'));
  assert.deepEqual(snapshot(), before, 'Existing battles and responses are untouched');
  assert.deepEqual(acl(), beforeAcl, 'All existing API grants, search paths and security modes remain intact');
  assert.equal(participants(existing).length, 4);
  console.log('PASS original rejection reproduced; migration preserves battles and ACLs'); checks++;

  for (const sizes of [[2, 1], [1, 2]]) {
    await test(`${sizes.join('v')} coach invitation identifies format and waits for all three riders`, () => {
      const battle = create(sizes);
      assert.equal(scalar(`select battle_size from weekly_rider_battles where id=${literal(battle)}`), sizes[0]);
      assert.equal(scalar('select count(*)::integer from push_notification_queue'), 3);
      assert.deepEqual(rows('select distinct title from push_notification_queue'), [{title: `New ${sizes.join('v')} battle`}]);
      accept(battle);
      assert.equal(scalar(`select status from weekly_rider_battles where id=${literal(battle)}`), 'accepted');
    });
    await test(`${sizes.join('v')} rider initiation accepts only their own invitation`, () => {
      const battle = create(sizes, 5, riders[0]);
      assert.equal(participants(battle).filter(p => p.response === 'accepted').length, 1);
      assert.equal(scalar('select count(*)::integer from push_notification_queue'), 2);
      accept(battle);
      const feed = JSON.parse(gateway('select public.get_my_rider_battles()', riders[0]));
      assert.equal(feed[0].participants.length, 3);
      assert.equal(JSON.parse(gateway('select public.get_my_rider_battles()', outsider)).length, 0);
      assert.equal(JSON.parse(gateway('select public.get_coach_rider_battles_v2()', otherCoach)).length, 0);
    });
    for (const stake of [1, 5, 20]) for (const winner of [1, 2, null]) {
      await test(`${sizes.join('v')} ${stake}-point stake, ${winner ? `team ${winner} wins` : 'draw'}, retry awards once`, () => {
        const battle = create(sizes, stake); accept(battle); score(battle, winner === null ? [4, 4] : winner === 1 ? [8, 4] : [4, 8]);
        assert.equal(gateway('select public.settle_expired_rider_battles()'), '1');
        const first = payout(battle, sizes, stake, winner);
        assert.equal(gateway('select public.settle_expired_rider_battles()'), '0');
        assert.deepEqual(payout(battle, sizes, stake, winner), first);
      });
    }
    for (const losingTeam of [1, 2]) await test(`${sizes.join('v')} team ${losingTeam} forfeits; retry cannot double-award`, () => {
      const battle = create(sizes); accept(battle);
      const rider = participants(battle).find(p => p.team_number === losingTeam).athlete_id;
      assert.equal(gateway(`select public.forfeit_rider_battle(${literal(battle)})`, rider), 'completed');
      const first = payout(battle, sizes, 5, losingTeam === 1 ? 2 : 1);
      assert.throws(() => gateway(`select public.forfeit_rider_battle(${literal(battle)})`, rider), /Only a live battle/);
      assert.deepEqual(payout(battle, sizes, 5, losingTeam === 1 ? 2 : 1), first);
    });
  }
  await test('invalid shapes, duplicates, ghost riders, roles, ownership and disabled rider gateway are rejected', () => {
    for (const sizes of [[3, 1], [1, 3], [2, 1, 1], [2, 2, 1], [0, 1], [7, 7]]) assert.throws(() => create(sizes), /equal teams/);
    assert.throws(() => gateway(request([[riders[0], riders[0]], [riders[1]]])), /only appear once/);
    assert.throws(() => gateway(request([[riders[0], riders[1]], [ghost]])), /unavailable/);
    assert.throws(() => gateway(request([[riders[0], riders[1]], [outsider]])), /your crew/);
    assert.throws(() => create([2, 1], 5, otherCoach), /your crew/);
    assert.throws(() => gateway(request([[parent], [riders[0], riders[1]]]), parent), /Only riders or coaches/);
    assert.throws(() => create([2, 1], 5, outsider), /must include you/);
    assert.throws(() => create([2, 1], 5, ''), /signed in/);
    assert.throws(() => gateway(request([[riders[0], riders[1]], [riders[2]]]), '', 'anon'), /permission denied|signed in/);
    h.batch(`insert into private.rider_feature_access values(${literal(riders[0])}, true)`);
    assert.throws(() => create([2, 1], 5, riders[0]), /contact your coach/);
    for (const stake of [0, 21]) assert.throws(() => create([2, 1], stake), /battle value/);
    assert.equal(scalar('select count(*)::integer from weekly_rider_battles'), 0);
  });
  await test('response/forfeit permissions and duplicate creation remain protected', () => {
    const battle = create();
    assert.throws(() => create(), /duplicate key/);
    assert.throws(() => gateway(`select public.respond_rider_battle(${literal(battle)}, 'accepted')`, outsider), /no longer available/);
    accept(battle);
    assert.throws(() => gateway(`select public.forfeit_rider_battle(${literal(battle)})`, outsider), /not part of/);
    assert.equal(scalar('select count(*)::integer from leaderboard_point_adjustments'), 0);
  });
  await test('three-active-battle cap remains in force', () => {
    for (let i = 0; i < 3; i++) gateway(request([[riders[0], riders[1]], [riders[2 + i]]]));
    assert.throws(() => gateway(request([[riders[0]], [riders[10], riders[11]]])), /maximum of 3 active battles/);
  });
  await test('both riders contribute to the paired team total', () => {
    const battle = create(); accept(battle); score(battle, [6, 10]);
    h.batch(`insert into assignment_point_awards(athlete_id, points, created_at) values(${literal(riders[1])}, 5, now()-interval '36 hours');`);
    assert.equal(gateway('select public.settle_expired_rider_battles()'), '1');
    assert.equal(scalar(`select winning_team from weekly_rider_battles where id=${literal(battle)}`), 1, '6 + 5 beats the solo rider’s 10');
    payout(battle, [2, 1], 5, 1);
  });
  for (const size of [1, 2, 3, 4, 5, 6]) for (const count of [2, 3]) await test(`existing ${Array(count).fill(size).join('v')} scoring and payouts unchanged`, () => {
    const sizes = Array(count).fill(size), stake = size >= 5 ? size * 5 : 5;
    const battle = create(sizes, stake); accept(battle); score(battle, Array.from({length: count}, (_, i) => i === 1 ? 10 : 3));
    assert.equal(gateway('select public.settle_expired_rider_battles()'), '1'); payout(battle, sizes, stake, 2);
  });
  await test('three-sided forfeits still end only after two teams withdraw', () => {
    const battle = create([2, 2, 2]); accept(battle);
    assert.equal(gateway(`select public.forfeit_rider_battle(${literal(battle)})`, riders[0]), 'accepted');
    assert.equal(scalar('select count(*)::integer from leaderboard_point_adjustments'), 0);
    assert.equal(gateway(`select public.forfeit_rider_battle(${literal(battle)})`, riders[2]), 'completed');
    payout(battle, [2, 2, 2], 5, 3);
  });
  await test('two PostgreSQL settlement backends cannot double-award the same battle', async () => {
    const battle = create(); accept(battle); score(battle, [8, 4]);
    const a = h.connect('settle_a'), b = h.connect('settle_b');
    await a.query(`begin; ${auth(coach)} select 1 from weekly_rider_battles where id=${literal(battle)} for update;`);
    assert.equal(await b.query(`begin; ${auth(coach)} set local role authenticated; select public.settle_expired_rider_battles(); commit;`), '0');
    assert.equal(await a.query('set local role authenticated; select public.settle_expired_rider_battles(); commit;'), '1');
    payout(battle, [2, 1], 5, 1);
  });
  await test('simultaneous forfeits serialize on the battle row and award once', async () => {
    const battle = create(); accept(battle);
    const a = h.connect('forfeit_a'), b = h.connect('forfeit_b');
    await a.query(`begin; ${auth(riders[0])} select 1 from weekly_rider_battles where id=${literal(battle)} for update;`);
    const pending = b.query(`begin; ${auth(riders[1])} set local role authenticated; select public.forfeit_rider_battle(${literal(battle)}); commit;`).then(value => ({value}), error => ({error}));
    await h.waitLock(b);
    assert.equal(await a.query(`set local role authenticated; select public.forfeit_rider_battle(${literal(battle)}); commit;`), 'completed');
    assert.match((await pending).error.message, /Only a live battle/);
    payout(battle, [2, 1], 5, 2);
  });
  console.log(`${checks} unequal-battle PostgreSQL regressions passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => h.close());
