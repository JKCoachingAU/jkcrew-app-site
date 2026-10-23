// Executes the actual migrations in a disposable PostgreSQL engine. No remote
// connection, real account, health record or notification is used by this test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.JKCREW_PGLITE_PATH || '@electric-sql/pglite');
const db = new PGlite();
const root = path.resolve(__dirname, '..');
const migration = name => fs.readFileSync(path.join(root, 'supabase/migrations', name), 'utf8');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const scalar = async (sql, args = []) => Object.values((await q(sql, args))[0])[0];
async function actor(n, role = 'authenticated') {
  await db.exec('reset role');
  await q("select set_config('request.jwt.claim.sub',$1,false)", [n ? id(n) : '']);
  await db.exec(`set role ${role}`);
}
const get = n => scalar('select public.get_rider_recovery($1)', [n ? id(n) : null]);
const mode = (n, enabled, version, note = '') => scalar('select public.set_rider_recovery_mode($1,$2,$3,$4)', [id(n), enabled, version, note]);
const plan = (episode, version, text = '', approved = false) => scalar('select public.save_recovery_plan($1,$2,$3,$4,$5,null,$6)', [episode, version, 'Recovery & return to riding', text, '', approved]);
const ratings = { headache: 0, dizziness: 1, nausea: 2, sensitivity: 3, brain_fog: 4, fatigue: 5, balance: 6, neck_pain: 7 };
const save = (episode, date, version, request, symptoms = ratings, sleep = 'normal', notes = '') => scalar(
  'select public.save_recovery_checkin($1,$2,$3,$4,$5,$6,$7)', [episode, date, symptoms, sleep, notes, version, id(request)]);
async function gateway(endpoint, method = 'POST') {
  await q("select set_config('request.path',$1,false),set_config('request.method',$2,false)", [endpoint, method]);
  return q('select public.jkcrew_check_rider_feature_access()');
}
let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log(`PASS ${name}`); }
(async () => {
  // Reuse the established scoring schema fixture and both real access/scoring
  // migrations, so recovery is exercised through the existing canonical guards.
  const scoringTest = fs.readFileSync(path.join(__dirname, 'rider-scoring-pause-db.cjs'), 'utf8');
  await db.exec(scoringTest.match(/await db\.exec\(`\n([\s\S]*?)\n  `\);/)[1]);
  await db.exec(`
    create schema storage; create schema vault; create role authenticator;
    grant usage on schema storage to authenticated;
    create table storage.objects(id integer primary key,owner_id uuid);
    alter table storage.objects enable row level security;
    grant select,insert,update,delete on storage.objects to authenticated;
    create policy fixture_storage on storage.objects for all to authenticated using(true) with check(true);
    create table vault.decrypted_secrets(name text,decrypted_secret text);
    insert into vault.decrypted_secrets values('jkcrew_push_worker_secret','local-fixture-secret');
    create table public.app_notifications(id uuid primary key default gen_random_uuid(),recipient_id uuid,notification_type text,title text,body text,created_at timestamptz default now());
    create table public.push_notification_queue(id uuid primary key default gen_random_uuid(),recipient_id uuid,notification_type text,title text,body text,
      status text default 'pending',attempts integer default 0,available_at timestamptz default now(),created_at timestamptz default now(),processed_at timestamptz,last_error text);
    create table public.run_live_sessions(id uuid primary key default gen_random_uuid(),athlete_id uuid,coach_id uuid,status text default 'active',
      call_status text default 'active',call_end_reason text,call_ended_at timestamptz,editor_id uuid,editor_client uuid,lease_until timestamptz,updated_at timestamptz default now(),draft jsonb);
    grant select,insert,update,delete on public.trick_attempts,public.training_sessions to authenticated;
  `);
  const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/daily-production-functions.json'), 'utf8')).functions;
  await db.exec(fixtures.find(f => f.signature === 'jkcrew_country_timezone(text)').definition);
  for (const [n, role] of [[1, 'coach'], [2, 'athlete'], [3, 'athlete'], [4, 'coach'], [5, 'parent'], [6, 'admin']]) {
    await q('insert into profiles(id,role,display_name,country_code) values($1,$2,$3,$4)', [id(n), role, `Fixture ${n}`, n === 2 ? 'DE' : 'AU']);
  }
  await q('insert into coach_athletes values($1,$2),($1,$3),($4,$3)', [id(1), id(2), id(3), id(6)]);
  await q('insert into training_sessions(id,athlete_id,total_points) values($1,$2,12)', [id(10), id(2)]);
  await q('insert into push_notification_queue(recipient_id,notification_type,title) values($1,$2,$3)', [id(2), 'daily_reminder', 'Existing queue item']);
  await q('insert into app_notifications(recipient_id,notification_type,title) values($1,$2,$3)', [id(2), 'daily_reminder', 'Historical notification']);
  await q('insert into run_live_sessions(athlete_id,coach_id,draft) values($1,$2,$3)', [id(2), id(1), { title: 'Preserved run', points: [1, 2] }]);
  await db.exec(migration('20260914101302_rider_feature_access_controls.sql'));
  await db.exec(migration('20260914104325_rider_scoring_pause.sql'));
  await db.exec(migration('20261023111344_rider_recovery_mode.sql'));
  let state, episode, date;
  await test('migration does not enroll any account or modify historical scores', async () => {
    assert.equal(await scalar('select count(*)::int from private.rider_recovery_states'), 0);
    assert.equal(await scalar('select total_points from training_sessions where id=$1', [id(10)]), 12);
    await actor(2);
    assert.equal((await get()).recovery_mode, false);
    const access = (await q('select * from public.get_rider_feature_access()'))[0];
    assert.equal(access.features_disabled, false); assert.equal(access.recovery_mode, false); assert.equal(access.recovery_episode_id, null);
  });
  await test('athletes, parents and unlinked coaches cannot enroll or inspect another rider', async () => {
    for (const n of [2, 3, 4, 5]) {
      await actor(n); await assert.rejects(() => mode(2, true, 0), /linked coach/);
      if (n !== 2) await assert.rejects(() => get(2), /cannot view/);
    }
    await actor(2);
    for (const table of ['rider_recovery_states','rider_recovery_episodes','rider_recovery_checkins','rider_recovery_checkin_requests','rider_recovery_audit']) {
      await assert.rejects(() => q(`select * from private.${table}`), /permission denied/);
    }
    await actor(1); state = await mode(2, true, 0); episode = state.episode.id; date = state.today_date;
    assert.equal(state.can_manage, true); assert.equal(state.mode_version, 1); assert.equal(state.recovery_mode, true);
    assert.equal(state.episode.plan_text, ''); assert.equal(state.episode.clinician_approved, false);
    assert.equal(state.timezone, 'Europe/Berlin');
  });
  await test('enabling skips queued prompts and ends the call while retaining the draft/history', async () => {
    await db.exec('reset role');
    assert.equal(await scalar('select status from push_notification_queue where recipient_id=$1', [id(2)]), 'skipped');
    assert.equal(await scalar('select count(*)::int from app_notifications where recipient_id=$1', [id(2)]), 1);
    assert.deepEqual((await q('select status,call_status,call_end_reason,draft from run_live_sessions'))[0], {
      status: 'ended', call_status: 'ended', call_end_reason: 'account_unavailable', draft: { title: 'Preserved run', points: [1, 2] }
    });
    await actor(1); assert.equal(await scalar('select private.live_run_pair_allowed($1,$2)', [id(2), id(1)]), false);
    await actor(2); const access = (await q('select * from public.get_rider_feature_access()'))[0];
    assert.equal(access.features_disabled, false); assert.equal(access.recovery_episode_id, episode);
  });
  await test('server gateway allows only recovery and boot routes, leaving other riders unchanged', async () => {
    for (const endpoint of ['/rpc/get_rider_recovery','/rpc/save_recovery_checkin','/rest/v1/rpc/get_rider_feature_access','/rpc/record_my_app_open']) await gateway(endpoint);
    await gateway('/profiles', 'GET');
    for (const [endpoint, method] of [['/rpc/get_weekly_leaderboard','POST'],['/rpc/live_run_call_action','POST'],['/profiles','PATCH'],['/training_sessions','POST'],['/training_sessions','GET'],['/graphql','POST'],['/rpc/save_recovery_plan','POST'],['/rpc/get_rider_recovery/extra','POST']]) {
      await assert.rejects(() => gateway(endpoint, method), /Recovery mode is on/);
    }
    await assert.rejects(() => q('insert into storage.objects values(1,$1)', [id(2)]), /row-level security/);
    await actor(3); await gateway('/training_sessions');
    await q('insert into storage.objects values(1,$1)', [id(3)]);
  });
  await test('existing scoring triggers block both rider and coach scoring during recovery', async () => {
    for (const n of [2, 1]) {
      await actor(n);
      await assert.rejects(() => q("insert into trick_attempts(athlete_id,status,points) values($1,'landed',2)", [id(2)]), /Trick scoring is paused/);
      await assert.rejects(() => q('update training_sessions set total_points=total_points+1 where athlete_id=$1', [id(2)]), /Trick scoring is paused/);
    }
    await actor(3); await q("insert into trick_attempts(athlete_id,status,points) values($1,'landed',2)", [id(3)]);
  });
  await test('only linked coaches edit the exact plan; approval never derives from symptom totals', async () => {
    await actor(2); await assert.rejects(() => plan(episode, 0, 'Not authorized'), /linked coach/);
    await actor(4); await assert.rejects(() => plan(episode, 0), /linked coach/);
    await actor(1); state = await plan(episode, 0, '', true);
    assert.equal(state.episode.plan_text, ''); assert.equal(state.episode.plan_version, 1);
    assert.equal(state.episode.clinician_approved, true); assert.equal(state.episode.clinician_approval_recorded_by, id(1));
    await assert.rejects(() => plan(episode, 0, 'Stale text'), error => error.code === '40001');
    assert.equal((await get(2)).episode.plan_text, '');
  });
  await test('symptoms require all eight explicit integer ratings and a valid sleep answer', async () => {
    await actor(2);
    for (const invalid of [null, [], {}, { ...ratings, headache: -1 }, { ...ratings, headache: 11 }, { ...ratings, headache: 0.5 }, { ...ratings, headache: '0' }, { ...ratings, headache: null }, { ...ratings, extra: 1 }]) {
      await assert.rejects(() => save(episode, date, 0, 101, invalid), /Rate all eight/);
    }
    for (const sleep of [null, '', 'fine']) await assert.rejects(() => save(episode, date, 0, 101, ratings, sleep), /Rate all eight/);
    await assert.rejects(() => save(episode, '2099-01-01', 0, 101), /last seven days/);
    await assert.rejects(() => save(episode, '2000-01-01', 0, 101), /last seven days/);
    await actor(1); await assert.rejects(() => save(episode, date, 0, 101), /Only the rider/);
    await actor(3); await assert.rejects(() => save(episode, date, 0, 101), /no longer active/);
  });
  await test('dated check-in persists for rider and coach, and duplicate requests award nothing', async () => {
    await actor(2); state = await save(episode, date, 0, 101, ratings, 'poor', 'A private fixture note');
    assert.equal(state.checkins.length, 1); assert.equal(state.checkins[0].version, 1);
    assert.deepEqual(state.checkins[0].ratings, ratings); assert.equal(state.checkins[0].sleep, 'poor');
    const retried = await save(episode, date, 0, 101, ratings, 'poor', 'A private fixture note');
    assert.deepEqual(retried.checkins, state.checkins);
    await actor(1); assert.deepEqual((await get(2)).checkins, state.checkins);
    await actor(4); await assert.rejects(() => get(2), /cannot view/);
    await db.exec('reset role'); assert.equal(await scalar('select total_points from training_sessions where id=$1', [id(10)]), 12);
  });
  await test('stale device cannot overwrite a saved check-in; old retry cannot undo a newer edit', async () => {
    await actor(2);
    await assert.rejects(() => save(episode, date, 0, 102), error => error.code === '40001');
    state = await save(episode, date, 1, 103, { ...ratings, fatigue: 1 }, 'normal', 'Updated note');
    assert.equal(state.checkins[0].version, 2); assert.equal(state.checkins[0].ratings.fatigue, 1);
    const oldRetry = await save(episode, date, 0, 101, ratings, 'poor', 'A private fixture note');
    assert.equal(oldRetry.checkins[0].version, 2); assert.equal(oldRetry.checkins[0].notes, 'Updated note');
    await assert.rejects(() => save(episode, date, 0, 101), /identifier was already used/);
  });
  await test('normal notifications are suppressed only for active recovery recipients, including worker retries', async () => {
    await db.exec('reset role');
    for (const table of ['app_notifications','push_notification_queue']) {
      for (const n of [2,3]) await q(`insert into ${table}(recipient_id,notification_type,title) values($1,'battle_result','Fixture prompt')`, [id(n)]);
      assert.equal(await scalar(`select count(*)::int from ${table} where recipient_id=$1`, [id(2)]), 1);
      assert.equal(await scalar(`select count(*)::int from ${table} where recipient_id=$1`, [id(3)]), 1);
    }
    await q("update push_notification_queue set status='pending' where recipient_id=$1", [id(2)]);
    await actor(null,'service_role'); const claimed = await q("select * from public.claim_jkcrew_push_notifications('local-fixture-secret',50)");
    assert.deepEqual(claimed.map(r => r.recipient_id), [id(3)]);
  });
  await test('disabling preserves check-ins, plan and independent scoring/account flags', async () => {
    await actor(1);
    await q('select public.set_rider_scoring_pause($1,true)', [id(2)]);
    await assert.rejects(() => mode(2, false, 0), error => error.code === '40001');
    state = await mode(2, false, 1, 'Coach confirmed the return with the treating clinician.');
    assert.equal(state.recovery_mode, false); assert.equal(state.mode_version, 2); assert(state.episode.closed_at);
    assert.equal(state.checkins.length, 1);
    await assert.rejects(() => plan(episode, 1), /episode has ended/);
    await actor(2); await gateway('/training_sessions');
    await assert.rejects(() => save(episode, date, 2, 104), /no longer active/);
    await assert.rejects(() => q("insert into trick_attempts(athlete_id,status,points) values($1,'landed',2)", [id(2)]), /Trick scoring is paused/);
    await actor(1); await q('select public.set_rider_scoring_pause($1,false)', [id(2)]);
    await actor(2); await q("insert into trick_attempts(athlete_id,status,points) values($1,'landed',2)", [id(2)]);
  });
  await test('new episode starts separately; history retains both check-ins on a single day', async () => {
    await actor(1); state = await mode(2, true, 2); assert.notEqual(state.episode.id, episode);
    const second = state.episode.id; assert.equal(state.episode.clinician_approved, false); assert.equal(state.episode.plan_text, '');
    await actor(2); state = await save(second, date, 0, 105);
    assert.equal(state.checkins.length, 2); assert.equal(state.episodes.length, 2);
    assert(state.checkins.some(c => c.episode_id === episode)); assert(state.checkins.some(c => c.episode_id === second));
    await actor(1); await q('select public.set_rider_feature_access($1,true)', [id(2)]);
    await actor(2); await gateway('/rpc/get_rider_recovery'); await gateway('/rpc/save_recovery_checkin');
    await actor(1); await mode(2, false, 3);
    await actor(2); await assert.rejects(() => gateway('/training_sessions'), /don't have access/);
    assert.equal((await q('select * from public.get_rider_feature_access()'))[0].features_disabled, true);
  });
  await test('anonymous callers have no recovery access and private tables all enforce RLS', async () => {
    await actor(null,'anon'); await assert.rejects(() => get(2), /permission denied/);
    await db.exec('reset role');
    const tables = await q("select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and relkind='r' and relname like 'rider_recovery_%'");
    assert.equal(tables.length, 5); assert(tables.every(t => t.relrowsecurity));
    assert.equal(await scalar('select count(*)::int from private.rider_recovery_audit where action=$1', ['enabled']), 2);
    assert.equal(await scalar('select count(*)::int from private.rider_recovery_checkin_requests'), 3);
  });
  console.log(`${checks} recovery database cases passed: actual migrations, authorization, version conflicts, retries, retained history, scoring, storage, gateway and notification suppression.`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.close());
