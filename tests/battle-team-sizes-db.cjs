const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.JKCREW_PGLITE_PATH || '@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const migration = name => fs.readFileSync(path.join(root, 'supabase/migrations', name), 'utf8');
const db = new PGlite();
const sql = (query, params = []) => db.query(query, params);
const auth = id => sql("select set_config('request.jwt.claim.sub', $1, false)", [id || '']);
let coach, riders, parent, outsider, ghost;
let checks = 0;
async function rejects(fn, pattern) {
  await db.exec('savepoint expected_failure');
  try { await assert.rejects(fn, pattern); }
  finally { await db.exec('rollback to savepoint expected_failure'); }
}
async function test(name, fn) {
  await db.exec('begin');
  try { await fn(); checks++; console.log('PASS ' + name); }
  finally { await db.exec('rollback'); }
}
const teams = (size, count = 3) => [riders.slice(0, size), riders.slice(size, size * 2), count === 3 ? riders.slice(size * 2, size * 3) : []];
const createCurrent = (sides, stake = 5, days = 1) => sql('select public.request_rider_battle_v3($1, $2, $3, $4, $5) id', [...sides, days, stake]).then(result => result.rows[0].id);
async function create(size = 6, count = 3, stake = 5) { await auth(coach); return createCurrent(teams(size, count), stake); }
async function accept(id) {
  const participants = (await sql('select athlete_id from weekly_rider_battle_participants where battle_id = $1 order by team_number, athlete_id', [id])).rows;
  for (let index = 0; index < participants.length; index++) {
    await auth(participants[index].athlete_id);
    const response = (await sql("select respond_rider_battle($1, 'accepted') status", [id])).rows[0].status;
    assert.equal(response, index === participants.length - 1 ? 'accepted' : 'pending');
  }
  await auth(coach);
}
async function score(id, scores, expired = true) {
  await sql("update weekly_rider_battles set starts_at = now() - interval '2 days', ends_at = now() + case when $2 then interval '-1 day' else interval '1 day' end where id = $1", [id, expired]);
  const participants = (await sql('select athlete_id, team_number from weekly_rider_battle_participants where battle_id = $1', [id])).rows;
  for (const participant of participants) await sql("insert into assignment_point_awards(athlete_id, points, created_at) values($1, $2, now() - interval '36 hours')", [participant.athlete_id, scores[participant.team_number - 1]]);
}
async function assertPayout(id, size, count, stake, winningTeam) {
  const participants = (await sql('select athlete_id, team_number, is_winner, points_delta from weekly_rider_battle_participants where battle_id = $1 order by team_number, athlete_id', [id])).rows;
  assert.equal(participants.length, size * count);
  for (let team = 1; team <= count; team++) {
    const total = team === winningTeam ? stake * (count - 1) : stake;
    const members = participants.filter(row => row.team_number === team);
    assert.equal(members.length, size);
    members.forEach((member, index) => {
      const share = Math.floor(total / size) + (index < total % size ? 1 : 0);
      assert.equal(member.points_delta, (team === winningTeam ? share : -share) || 0);
      assert.equal(member.is_winner, team === winningTeam);
    });
  }
  assert.equal(participants.reduce((sum, row) => sum + row.points_delta, 0), 0);
  const ledger = (await sql('select athlete_id, points from leaderboard_point_adjustments')).rows;
  assert.equal(ledger.length, participants.filter(row => row.points_delta !== 0).length);
  for (const row of ledger) assert.equal(row.points, participants.find(participant => participant.athlete_id === row.athlete_id).points_delta);
  assert.equal(ledger.reduce((sum, row) => sum + row.points, 0), 0);
  return ledger.length;
}

(async () => {
  // Same isolated database foundation as three-sided-battles.cjs; no remote connection.
  await db.exec(`
    create schema auth; create schema private; create role anon; create role authenticated;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table profiles(id uuid primary key default gen_random_uuid(), role text, display_name text, ghost_mode boolean default false, avatar jsonb default '{}', level integer default 1);
    create table coach_athletes(coach_id uuid, athlete_id uuid, primary key(coach_id, athlete_id));
    create table weekly_rider_battles(id uuid primary key default gen_random_uuid(), challenger_id uuid references profiles, opponent_id uuid references profiles, week_start date, status text default 'pending', duration_days integer default 7, starts_at timestamptz, ends_at timestamptz, winner_id uuid, reward_points integer default 5, responded_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now(), created_by uuid, battle_size integer default 1, winning_team integer, forfeited_by uuid, forfeited_at timestamptz, archived_at timestamptz, archived_by uuid,
      constraint weekly_rider_battles_winning_team_check check(winning_team in (1, 2)), check(battle_size between 1 and 3), check(reward_points between 1 and 20));
    create unique index weekly_rider_battles_active_pair_idx on weekly_rider_battles(week_start, least(challenger_id::text, opponent_id::text), greatest(challenger_id::text, opponent_id::text)) where status in ('pending', 'accepted');
    create table weekly_rider_battle_participants(battle_id uuid references weekly_rider_battles on delete cascade, athlete_id uuid references profiles, team_number integer, response text default 'pending', responded_at timestamptz, baseline_points integer default 0, is_winner boolean, points_delta integer default 0, created_at timestamptz default now(), primary key(battle_id, athlete_id), constraint weekly_rider_battle_participants_team_number_check check(team_number in (1, 2)));
    create table push_notification_queue(recipient_id uuid, notification_type text, title text, body text, url text, payload jsonb, dedupe_key text unique);
    create table leaderboard_point_adjustments(id uuid default gen_random_uuid(), athlete_id uuid, coach_id uuid, points integer, reason text, week_start date, created_at timestamptz default now());
    create table assignment_point_awards(id uuid default gen_random_uuid(), athlete_id uuid, session_id uuid, points integer, created_at timestamptz default now());
    create table training_sessions(id uuid default gen_random_uuid(), athlete_id uuid, total_points integer, started_at timestamptz default now());
    create function current_rider_weekly_points(uuid) returns integer language sql as $$ select 0 $$;
  `);
  await db.exec(migration('20260907212548_three_sided_rider_battles.sql'));
  await db.exec(migration('20260907212718_private_three_sided_battle_creation.sql'));
  await db.exec('grant usage on schema private to authenticated');
  coach = (await sql("insert into profiles(role, display_name) values('coach', 'Test Coach') returning id")).rows[0].id;
  parent = (await sql("insert into profiles(role, display_name) values('parent', 'Test Parent') returning id")).rows[0].id;
  riders = (await sql("insert into profiles(role, display_name) select 'athlete', 'Rider ' || i from generate_series(1, 21) i returning id")).rows.map(row => row.id);
  outsider = (await sql("insert into profiles(role, display_name) values('athlete', 'Unlinked rider') returning id")).rows[0].id;
  ghost = (await sql("insert into profiles(role, display_name, ghost_mode) values('athlete', 'Private rider', true) returning id")).rows[0].id;
  for (const id of riders) await sql('insert into coach_athletes values($1, $2)', [coach, id]);

  await auth(coach);
  const oldId = await createCurrent(teams(2));
  const oldRows = async () => (await sql('select to_jsonb(battle) battle, (select jsonb_agg(participant order by participant.athlete_id) from weekly_rider_battle_participants participant where participant.battle_id = battle.id) participants from weekly_rider_battles battle where id = $1', [oldId])).rows[0];
  const before = await oldRows();
  const functions = async () => (await sql("select n.nspname, p.proname, pg_get_functiondef(p.oid) definition, p.proacl::text privileges from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public', 'private') and p.proname in ('request_rider_battle_v2', 'request_rider_battle_v3', 'settle_expired_rider_battles', 'forfeit_rider_battle', 'create_three_sided_rider_battle') order by n.nspname,p.proname")).rows;
  const originalFunctions = await functions();
  await db.exec(migration('20260911042341_expand_rider_battles_to_six_per_team.sql'));
  assert.deepEqual(await oldRows(), before);
  const changedFunctions = await functions();
  for (const original of originalFunctions) {
    const changed = changedFunctions.find(fn => fn.proname === original.proname);
    assert.equal(changed.privileges, original.privileges);
    if (original.proname !== 'create_three_sided_rider_battle') assert.equal(changed.definition, original.definition);
  }
  await sql('delete from weekly_rider_battles where id = $1', [oldId]);
  await db.exec('delete from push_notification_queue');
  console.log('PASS migration preserves existing battles, public APIs, settlement and function grants');

  await test('6v6v6 creates 18 unique riders and 18 coach invitations, awaiting all accepts', async () => {
    const id = await create();
    assert.equal((await sql('select count(distinct athlete_id)::int n from weekly_rider_battle_participants where battle_id = $1', [id])).rows[0].n, 18);
    const queue = (await sql('select recipient_id, title, body from push_notification_queue')).rows;
    assert.equal(queue.length, 18);
    assert.equal(new Set(queue.map(row => row.recipient_id)).size, 18);
    assert(queue.every(row => row.title === 'New 6v6v6 battle' && row.body.includes('10 winning points')));
    await accept(id);
    const battle = (await sql('select battle_size, team_count, status from weekly_rider_battles where id = $1', [id])).rows[0];
    assert.deepEqual(battle, { battle_size: 6, team_count: 3, status: 'accepted' });
    const feed = (await sql('select get_coach_rider_battles_v2() feed')).rows[0].feed;
    assert.equal(feed[0].participants.length, 18);
  });

  await test('oversize, unequal, duplicate, missing and unauthorized riders are rejected without side effects', async () => {
    await auth(null); await rejects(() => createCurrent(teams(6)), /signed in/);
    await auth(parent); await rejects(() => createCurrent(teams(6)), /own team|Only riders/);
    await auth(riders[20]); await rejects(() => createCurrent(teams(6)), /own team/);
    await auth(coach);
    for (const sides of [teams(7, 2), teams(7, 3), [riders.slice(0,6), riders.slice(6,11), riders.slice(12,18)], [riders.slice(0,6), riders.slice(6,12), riders.slice(12,17)], [[], [], []], [riders.slice(0,6), null, []]]) await rejects(() => createCurrent(sides), /equal teams/);
    await rejects(() => createCurrent([riders.slice(0,6), riders.slice(6,12), [riders[0], ...riders.slice(13,18)]]), /only appear once/);
    await rejects(() => createCurrent([riders.slice(0,6), riders.slice(6,12), [null, ...riders.slice(13,18)]]), /only appear once/);
    await rejects(() => createCurrent([riders.slice(0,6), riders.slice(6,12), [outsider, ...riders.slice(13,18)]]), /your crew/);
    await rejects(() => createCurrent([riders.slice(0,6), riders.slice(6,12), [ghost, ...riders.slice(13,18)]]), /unavailable/);
    for (const stake of [0, 21]) await rejects(() => createCurrent(teams(6), stake), /battle value/);
    for (const days of [0, 8]) await rejects(() => createCurrent(teams(6), 5, days), /battle length/);
    assert.equal((await sql('select count(*)::int n from weekly_rider_battles')).rows[0].n, 0);
    assert.equal((await sql('select count(*)::int n from push_notification_queue')).rows[0].n, 0);
  });

  for (let size = 1; size <= 6; size++) for (const count of [2, 3]) {
    await test(`${Array(count).fill(size).join('v')} winner takes every losing stake with exact remainders and idempotency`, async () => {
      for (const stake of [1, 5, 7, 20]) {
        await db.exec('savepoint payout_case');
        const id = await create(size, count, stake);
        await accept(id); await score(id, count === 3 ? [2, 4, 8] : [2, 8]);
        assert.equal((await sql('select settle_expired_rider_battles() n')).rows[0].n, 1);
        const ledgerCount = await assertPayout(id, size, count, stake, count);
        assert.equal((await sql('select settle_expired_rider_battles() n')).rows[0].n, 0);
        assert.equal((await sql('select count(*)::int n from leaderboard_point_adjustments')).rows[0].n, ledgerCount);
        await db.exec('rollback to savepoint payout_case');
      }
    });
  }

  await test('6v6v6 top tie awards nobody and transfers no points', async () => {
    const id = await create(); await accept(id); await score(id, [8, 8, 2]);
    await sql('select settle_expired_rider_battles()');
    assert.equal((await sql('select winning_team from weekly_rider_battles where id = $1', [id])).rows[0].winning_team, null);
    assert.equal((await sql('select count(*)::int n from leaderboard_point_adjustments')).rows[0].n, 0);
    assert((await sql('select is_winner, points_delta from weekly_rider_battle_participants where battle_id = $1', [id])).rows.every(row => row.is_winner === null && row.points_delta === 0));
  });
  await test('6v6v6 forfeit removes all six teammates; survivor receives both losing stakes', async () => {
    const id = await create(); await accept(id); await score(id, [4, 8, 20], false);
    await auth(riders[12]); assert.equal((await sql('select forfeit_rider_battle($1) status', [id])).rows[0].status, 'accepted');
    assert.equal((await sql('select count(*)::int n from weekly_rider_battle_participants where battle_id=$1 and forfeited_at is not null', [id])).rows[0].n, 6);
    assert.equal((await sql('select count(*)::int n from leaderboard_point_adjustments')).rows[0].n, 0);
    await auth(riders[0]); assert.equal((await sql('select forfeit_rider_battle($1) status', [id])).rows[0].status, 'completed');
    await assertPayout(id, 6, 3, 5, 2);
  });
  await test('legacy v2 creates 6v6 and two-sided forfeit pays the unchanged exact stake', async () => {
    await auth(coach);
    const id = (await sql('select request_rider_battle_v2($1,$2,1,5) id', teams(6,2).slice(0,2))).rows[0].id;
    await accept(id); await auth(riders[0]);
    assert.equal((await sql('select forfeit_rider_battle($1) status', [id])).rows[0].status, 'completed');
    await assertPayout(id, 6, 2, 5, 2);
  });
  await test('existing three-active-battles cap remains enforced for every rider', async () => {
    await create(); await create(); await create();
    await rejects(() => create(), /maximum of 3 active battles/);
  });
  await test('database CHECK constraints reject more than six riders and more than three teams', async () => {
    const id = await create();
    await rejects(() => sql('update weekly_rider_battles set battle_size=7 where id=$1', [id]), /battle_size_check/);
    await rejects(() => sql('update weekly_rider_battles set team_count=4 where id=$1', [id]), /team_count_check/);
  });
  await test('authenticated rider creates 6v6v6 through unchanged API, with only self accepted', async () => {
    await auth(riders[0]); await db.exec('set local role authenticated');
    const id = await createCurrent(teams(6)); await db.exec('reset role');
    assert.equal((await sql("select count(*)::int n from weekly_rider_battle_participants where battle_id=$1 and response='accepted'", [id])).rows[0].n, 1);
    assert.equal((await sql('select count(*)::int n from push_notification_queue')).rows[0].n, 17);
  });
  for (const functionName of ['public.request_rider_battle_v3(uuid[],uuid[],uuid[],integer,integer)', 'private.create_three_sided_rider_battle(uuid[],uuid[],uuid[],integer,integer)']) {
    assert.equal((await sql("select has_function_privilege('anon',$1,'execute') allowed", [functionName])).rows[0].allowed, false);
    assert.equal((await sql("select has_function_privilege('authenticated',$1,'execute') allowed", [functionName])).rows[0].allowed, true);
  }
  await db.close();
  console.log(`PASS ${checks} database scenarios, including 48 exact payout combinations; no live database used.`);
})().catch(error => { console.error(error); process.exit(1); });
