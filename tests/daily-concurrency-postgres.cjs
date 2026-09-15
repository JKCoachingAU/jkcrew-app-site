// Genuine PostgreSQL connections; never accepts a remote host or database.
// Example: JKCREW_PG_BIN=/tmp/jkcrew-postgres-concurrency/pgsql/bin
// JKCREW_PG_SOCKET=/tmp/jkcrew-postgres-concurrency/socket node tests/daily-concurrency-postgres.cjs
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const bin = process.env.JKCREW_PG_BIN;
const socket = process.env.JKCREW_PG_SOCKET;
const port = process.env.JKCREW_PG_PORT || '55439';
assert(bin && path.isAbsolute(bin), 'Supply the temporary PostgreSQL binary directory');
assert(socket && /^\/(?:private\/)?tmp\//.test(socket), 'Only a /tmp Unix socket is allowed; no production host can be supplied');
const psql = path.join(bin, 'psql');
const database = `jkcrew_daily_concurrency_${process.pid}`;
const baseArgs = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', socket, '-p', port, '-U', os.userInfo().username];
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
function batch(sql, db = database) {
  const result = spawnSync(psql, [...baseArgs, '-d', db], { input: sql, encoding: 'utf8', maxBuffer: 4e6 });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || `psql exited ${result.status}`);
  return result.stdout.trim();
}
const connections = [];
class Connection {
  constructor(name) {
    this.name = `jkcrew_concurrency_${process.pid}_${name}`;
    this.proc = spawn(psql, [...baseArgs, '-d', database], { env: { ...process.env, PGAPPNAME: this.name } });
    this.buffer = ''; this.errors = ''; this.number = 0; this.pending = null;
    this.proc.stdout.setEncoding('utf8'); this.proc.stderr.setEncoding('utf8');
    this.proc.stdout.on('data', text => { this.buffer += text; this.drain(); });
    this.proc.stderr.on('data', text => { this.errors += text; });
    this.proc.on('error', error => this.fail(error));
    this.proc.on('exit', code => { this.closed = true; if (this.pending) this.fail(new Error(this.errors || `psql exited ${code}`)); });
    connections.push(this);
  }
  drain() {
    if (!this.pending) return;
    const end = this.buffer.indexOf(this.pending.marker);
    if (end < 0) return;
    const value = this.buffer.slice(0, end).trim();
    this.buffer = this.buffer.slice(end + this.pending.marker.length).replace(/^\r?\n/, '');
    const { resolve, timer } = this.pending; clearTimeout(timer); this.pending = null; resolve(value);
  }
  fail(error) { if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = null; } }
  query(sql) {
    assert(!this.pending, 'One query at a time on each independent connection');
    if (this.closed) return Promise.reject(new Error('Connection already closed'));
    const marker = `__jkcrew_query_${++this.number}__`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.proc.kill(); this.fail(new Error(`Timed out: ${this.name}`)); }, 12000);
      this.pending = { marker, resolve, reject, timer };
      this.proc.stdin.write(`${sql}\n\\echo ${marker}\n`);
    });
  }
  async close() { if (this.closed) return; this.proc.stdin.write('rollback;\n\\q\n'); await new Promise(resolve => this.proc.once('exit', resolve)); }
}
const json = text => JSON.parse(text.trim().split('\n').filter(Boolean).at(-1));
const rpc = (name, args) => `select public.${name}(${args.map(literal).join(',')});`;
const acting = actor => `set role authenticated; set request.jwt.claim.sub=${literal(id(actor))};`;
let control;
async function waitForLock(conn) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const value = await control.query(`select coalesce((select wait_event_type='Lock' from pg_stat_activity where application_name=${literal(conn.name)}),false);`);
    if (value === 't') return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error(`${conn.name} did not overlap as a blocked PostgreSQL transaction`);
}
async function main() {
  batch(`create database ${database};`, 'postgres');
  const behavior = fs.readFileSync(path.join(__dirname, 'daily-completion-db.cjs'), 'utf8');
  const schema = behavior.match(/await db\.exec\(`([\s\S]*?)`\);/)[1]
    .replace(/create role (anon|authenticated|service_role);/g, (_, name) => `do $$begin if not exists(select 1 from pg_roles where rolname='${name}') then create role ${name}; end if; end$$;`);
  batch(schema);
  batch(`grant usage on schema private to authenticated;
    create table percentage_attempts(id uuid primary key default gen_random_uuid(),assignment_id uuid,athlete_id uuid,attempt_number integer,landed boolean,created_at timestamptz default now(),unique(assignment_id,attempt_number));
    create table assignment_attempts(id uuid primary key default gen_random_uuid(),assignment_id uuid,athlete_id uuid,session_id uuid,attempted_at timestamptz default now());`);
  const source = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/daily-production-functions.json'), 'utf8')).functions;
  const ordered = ['jkcrew_country_timezone(text)', 'jkcrew_week_bounds(text,timestamp with time zone)', 'private.jkcrew_venue_key(text)', 'level_badge(integer)', 'sync_xp_award(uuid,text,text,integer,text,uuid,uuid,text,text,uuid,jsonb)', 'sync_assignment_progress_xp()', 'sync_daily_pb_xp()', 'sync_daily_completion_timing()', 'record_assignment_action(uuid,text)', 'record_assignment_action_at_venue(uuid,text,text)', 'finish_group_session_daily(uuid,uuid,integer)', 'get_weekly_leaderboard()'];
  batch(ordered.map(signature => source.find(row => row.signature === signature).definition + ';').join('\n'));
  batch(`create trigger assignment_progress_xp_sync after insert or update or delete on assignment_progress for each row execute function sync_assignment_progress_xp();
    create trigger assignment_progress_daily_completion_timing after insert or update of progress_date on assignment_progress for each row when(new.progress_date is not null) execute function sync_daily_completion_timing();
    create trigger profiles_daily_pb_xp_sync after update of daily_pb_seconds on profiles for each row execute function sync_daily_pb_xp();`);
  const history = fs.readFileSync(path.join(root, 'supabase/migrations/20260911030012_preserve_tricktionary_landed_history.sql'), 'utf8');
  for (const name of ['private.capture_tricktionary_progress', 'private.sync_tricktionary_progress_history']) {
    const start = history.indexOf(`create or replace function ${name}(`); batch(history.slice(start, history.indexOf('\n$$;', start) + 4));
  }
  batch('create trigger tricktionary_progress_history after insert or update of progress_date,completed_at,streak_count on assignment_progress for each row execute function private.sync_tricktionary_progress_history();');
  batch(fs.readFileSync(path.join(root, 'supabase/migrations/20260911085353_confirm_daily_tricks_and_today_progress.sql'), 'utf8'));
  batch(fs.readFileSync(path.join(root, 'supabase/migrations/20260911100447_make_daily_standings_read_only.sql'), 'utf8'));
  batch(fs.readFileSync(path.join(root, 'supabase/migrations/20260914104325_rider_scoring_pause.sql'), 'utf8'));
  batch(fs.readFileSync(path.join(root, 'supabase/migrations/20260915214800_allow_partial_daily_finish.sql'), 'utf8'));
  batch(`create or replace function get_earned_badges(uuid) returns jsonb language plpgsql as $$begin raise exception 'Unexpected badge synchronization';end$$;`);
  control = new Connection('control');
  const version = await control.query('select version();');
  batch(`insert into profiles(id,role,display_name) values('${id(1)}','coach','Concurrency Coach'),('${id(2)}','coach','Second Concurrency Coach');`);
  const setup = async (n, group = null, completed = 2) => {
    const first = n * 10, second = first + 1, session = n * 100;
    batch(`insert into profiles(id,role,display_name) values('${id(n)}','athlete','Concurrency Rider ${n}');
      insert into coach_athletes values('${id(1)}','${id(n)}'),('${id(2)}','${id(n)}');
      insert into weekly_trick_assignments(id,coach_id,athlete_id,week_start,trick_name,category,venue) select '${id(first)}','${id(1)}','${id(n)}',week_start_date,'First trick','daily','Test park' from jkcrew_week_bounds('AU');
      insert into weekly_trick_assignments(id,coach_id,athlete_id,week_start,trick_name,category,venue) select '${id(second)}','${id(1)}','${id(n)}',week_start_date,'Second trick','daily','Test park' from jkcrew_week_bounds('AU');
      insert into training_sessions(id,athlete_id,started_at) values('${id(session)}','${id(n)}',greatest(now()-interval '5 minutes',((now() at time zone 'Australia/Brisbane')::date)::timestamp at time zone 'Australia/Brisbane'));
      ${group ? `insert into coach_group_session_participants(group_session_id,athlete_id,training_session_id) values('${id(group)}','${id(n)}','${id(session)}');` : ''}
      ${completed ? acting(1) + rpc('record_daily_trick_action', [id(first), 'landed', 'Test park']) : ''}`);
    const candidate = json(batch(`${acting(1)}${completed === 2
      ? rpc('record_daily_trick_action', [id(second), 'landed', 'Test park'])
      : rpc('prepare_daily_finish', [id(n), id(session), 'Test park'])}`)).completion_candidate;
    assert(candidate?.candidate_id);
    return { rider: n, first, second, session, candidate };
  };
  const confirm = fixture => rpc('confirm_daily_finish', [fixture.candidate.candidate_id]);
  const state = async fixture => json(await control.query(`select jsonb_build_object('awards',(select count(*) from assignment_point_awards where athlete_id='${id(fixture.rider)}'),'points',(select coalesce(sum(points),0) from assignment_point_awards where athlete_id='${id(fixture.rider)}'),'xp_rows',(select count(*) from xp_ledger where athlete_id='${id(fixture.rider)}' and source_type='daily_complete'),'confirmed',(select count(*) from private.daily_finish_candidates where athlete_id='${id(fixture.rider)}' and status='confirmed'),'tick',(select progress_date from assignment_progress where assignment_id='${id(fixture.first)}'));`));
  const report = [];

  const same = await setup(10);
  const coach = new Connection('same_coach'), rider = new Connection('same_rider');
  const coachResult = json(await coach.query(`begin; ${acting(1)}${confirm(same)}`));
  const waitingSame = rider.query(`${acting(same.rider)}${confirm(same)}`);
  await waitForLock(rider); await coach.query('commit;');
  assert.deepEqual(json(await waitingSame), coachResult, 'Coach and rider return exactly the same saved result');
  assert.deepEqual({ ...(await state(same)), tick: null }, { awards: 2, points: 2, xp_rows: 1, confirmed: 1, tick: null });
  report.push('same candidate: real lock wait, one result, two points, one completion XP entry');

  const group = 7000;
  batch(`insert into coach_group_sessions(id,coach_id,venue,started_at) values('${id(group)}','${id(1)}','Test park',greatest(now()-interval '5 minutes',((now() at time zone 'Australia/Brisbane')::date)::timestamp at time zone 'Australia/Brisbane'));`);
  const left = await setup(11, group), right = await setup(12, group);
  const groupA = new Connection('group_a'), groupB = new Connection('group_b');
  const leftResult = json(await groupA.query(`begin; ${acting(1)}${confirm(left)}`));
  const waitingGroup = groupB.query(`${acting(right.rider)}${confirm(right)}`);
  await waitForLock(groupB); await groupA.query('commit;');
  const rightResult = json(await waitingGroup);
  assert.equal(leftResult.completion_points, 3); assert.equal(rightResult.completion_points, 2);
  assert.equal(await control.query(`select count(*) from assignment_point_awards where award_key='group-first-finish:${id(group)}';`), '1');
  assert.equal((await state(left)).confirmed, 1); assert.equal((await state(right)).confirmed, 1);
  report.push('competing group finishes: real group-row lock wait, only the first confirmed rider receives the bonus');

  const correctionFirst = await setup(13, group);
  const correcting = new Connection('correction_first'), staleConfirm = new Connection('stale_confirm');
  await correcting.query(`begin; ${acting(1)}${rpc('record_daily_trick_action', [id(correctionFirst.first), 'unlanded', 'Test park'])}`);
  const waitingRejected = staleConfirm.query(`${acting(correctionFirst.rider)}${confirm(correctionFirst)}`).then(value => ({ value }), error => ({ error }));
  await waitForLock(staleConfirm); await correcting.query('commit;');
  const rejected = await waitingRejected; assert.match(rejected.error?.message || '', /Daily list changed/);
  assert.deepEqual(await state(correctionFirst), { awards: 0, points: 0, xp_rows: 0, confirmed: 0, tick: null });
  report.push('correction first: stale confirm waits, then rejects; no finish or reward is written');

  const finishFirst = await setup(14, group);
  const finishing = new Connection('finish_first'), lateCorrection = new Connection('late_correction');
  const finishedResult = json(await finishing.query(`begin; ${acting(1)}${confirm(finishFirst)}`));
  const waitingCorrection = lateCorrection.query(`${acting(finishFirst.rider)}${rpc('record_daily_trick_action', [id(finishFirst.first), 'unlanded', 'Test park'])}`);
  await waitForLock(lateCorrection); await finishing.query('commit;'); await waitingCorrection;
  assert.equal(finishedResult.completion_points, 2);
  assert.deepEqual(await state(finishFirst), { awards: 2, points: 2, xp_rows: 1, confirmed: 1, tick: null });
  report.push('confirmation first: correction waits; saved result/rewards remain and the later untick is recorded');

  const samePartial = await setup(20, null, 1);
  const partialCoach = new Connection('partial_coach'), otherCoach = new Connection('partial_other_coach');
  const partialResult = json(await partialCoach.query(`begin; ${acting(1)}${confirm(samePartial)}`));
  const waitingPartial = otherCoach.query(`${acting(2)}${confirm(samePartial)}`);
  await waitForLock(otherCoach); await partialCoach.query('commit;');
  assert.deepEqual(json(await waitingPartial), partialResult, 'Two coaches receive the exact same saved partial result');
  assert.equal(partialResult.all_completed, false); assert.equal(partialResult.completed_count, 1);
  assert.equal(partialResult.completion_points, 0); assert.equal(partialResult.completion_xp, 0);
  assert.deepEqual({ ...(await state(samePartial)), tick: null }, { awards: 0, points: 0, xp_rows: 0, confirmed: 1, tick: null });
  assert.equal(await control.query(`select daily_completed_at is null and daily_completed_seconds is null and ended_at is null from training_sessions where id='${id(samePartial.session)}';`), 't');
  report.push('same partial candidate: independent linked coaches wait on the real row lock, one zero-reward result, overall training remains active');

  const landingFirst = await setup(21, null, 1);
  const landing = new Connection('partial_last_landing'), stalePartial = new Connection('partial_stale_confirm');
  const finalLanding = json(await landing.query(`begin; ${acting(landingFirst.rider)}${rpc('record_daily_trick_action', [id(landingFirst.second), 'landed', 'Test park'])}`));
  const waitingStalePartial = stalePartial.query(`${acting(2)}${confirm(landingFirst)}`).then(value => ({ value }), error => ({ error }));
  await waitForLock(stalePartial); await landing.query('commit;');
  assert.match((await waitingStalePartial).error?.message || '', /Daily list changed/);
  assert.deepEqual({ ...(await state(landingFirst)), tick: null }, { awards: 0, points: 0, xp_rows: 0, confirmed: 0, tick: null });
  landingFirst.candidate = finalLanding.completion_candidate;
  assert.equal(json(await landing.query(confirm(landingFirst))).completion_points, 2, 'The new full candidate remains usable after rejecting the stale partial');
  report.push('last landing first: pending partial confirmation waits then rejects without rewards; the fresh full candidate still confirms normally');

  const partialFirst = await setup(22, null, 1);
  const partialFinisher = new Connection('partial_finish_first'), lateLanding = new Connection('partial_late_landing');
  const savedPartial = json(await partialFinisher.query(`begin; ${acting(1)}${confirm(partialFirst)}`));
  const waitingLanding = lateLanding.query(`${acting(partialFirst.rider)}${rpc('record_daily_trick_action', [id(partialFirst.second), 'landed', 'Test park'])}`);
  await waitForLock(lateLanding); await partialFinisher.query('commit;'); await waitingLanding;
  assert.deepEqual(json(await partialFinisher.query(confirm(partialFirst))), savedPartial);
  assert.equal(savedPartial.all_completed, false);
  assert.deepEqual({ ...(await state(partialFirst)), tick: null }, { awards: 0, points: 0, xp_rows: 0, confirmed: 1, tick: null });
  assert.equal(await control.query(`select count(*) from assignment_progress where athlete_id='${id(partialFirst.rider)}' and progress_date is not null;`), '2');
  report.push('partial confirmation first: later last tick waits, saves its landing, and cannot rewrite or reward the immutable partial result');

  const partialCorrection = await setup(23, null, 1);
  const partialUnticking = new Connection('partial_untick_first'), correctedPartial = new Connection('partial_after_untick');
  await partialUnticking.query(`begin; ${acting(2)}${rpc('record_daily_trick_action', [id(partialCorrection.first), 'unlanded', 'Test park'])}`);
  const waitingCorrectedPartial = correctedPartial.query(`${acting(1)}${confirm(partialCorrection)}`).then(value => ({ value }), error => ({ error }));
  await waitForLock(correctedPartial); await partialUnticking.query('commit;');
  assert.match((await waitingCorrectedPartial).error?.message || '', /Daily list changed/);
  assert.deepEqual(await state(partialCorrection), { awards: 0, points: 0, xp_rows: 0, confirmed: 0, tick: null });
  report.push('partial correction first: another coach’s in-flight confirmation waits, then rejects the stale count with no rewards');

  const partialGroup = 8000;
  batch(`insert into coach_group_sessions(id,coach_id,venue,started_at) values('${id(partialGroup)}','${id(1)}','Test park',greatest(now()-interval '5 minutes',((now() at time zone 'Australia/Brisbane')::date)::timestamp at time zone 'Australia/Brisbane'));`);
  const groupPartial = await setup(24, partialGroup, 0), groupComplete = await setup(25, partialGroup);
  const partialGroupConn = new Connection('group_partial'), completeGroupConn = new Connection('group_full_after_partial');
  const groupPartialResult = json(await partialGroupConn.query(`begin; ${acting(1)}${confirm(groupPartial)}`));
  const waitingFullGroup = completeGroupConn.query(`${acting(groupComplete.rider)}${confirm(groupComplete)}`);
  await waitForLock(completeGroupConn); await partialGroupConn.query('commit;');
  assert.equal(groupPartialResult.completed_count, 0); assert.equal(groupPartialResult.completion_points, 0);
  assert.equal(json(await waitingFullGroup).completion_points, 3);
  assert.equal(await control.query(`select count(*) from assignment_point_awards where award_key='group-first-finish:${id(partialGroup)}';`), '1');
  assert.equal(await control.query(`select daily_finished_at is null and daily_finish_seconds is null from coach_group_session_participants where group_session_id='${id(partialGroup)}' and athlete_id='${id(groupPartial.rider)}';`), 't');
  report.push('group partial/full overlap: zero-progress partial releases the real group lock without consuming the first-full-finish bonus');

  console.log(JSON.stringify({ status: 'PASS', server: version, separate_backend_connections: connections.length, cases: report }, null, 2));
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  await Promise.all(connections.map(conn => conn.close().catch(() => {})));
  try { batch(`drop database if exists ${database} with (force);`, 'postgres'); } catch (error) { console.error('Local fixture cleanup:', error.message); process.exitCode = 1; }
});
