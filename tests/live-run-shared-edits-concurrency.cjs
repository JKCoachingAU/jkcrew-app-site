// Actual PostgreSQL backends, not parallel promises on one embedded connection.
// The shared helper permits only a disposable database on a /tmp Unix socket.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const compact = process.env.JKCREW_LIVE_COMPACT === '1';
const { initialize } = require('./live-run-shared-edits.cjs');
const { createHarness, literal, json } = require('./helpers/local-postgres.cjs');

const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const rider = id(1), coach = id(2), riderTab = id(10), coachTab = id(11), event = id(20);
const photo = 'data:image/png;base64,' + 'a'.repeat(80);
const acting = user => `reset role;set role authenticated;set request.jwt.claim.sub=${literal(user)};`;
const sqlJson = value => `${literal(JSON.stringify(value))}::jsonb`;
let request = 100;
const nextRequest = () => id(++request);
const call = (action, session, client, payload = {}) =>
  `select public.live_run_call_action(${literal(action)},${session ? literal(session) : 'null'},'${client}','${nextRequest()}',${sqlJson(payload)},'${rider}','${coach}',0);`;
const edit = (session, client, version, ops, requestId = nextRequest()) =>
  `select public.live_run_edit${compact?'_compact':''}('${session}','${client}','${requestId}',${version},${sqlJson(ops)});`;
const save = (session, client, version) =>
  `select public.live_run_action${compact?'_compact':''}('save','${session}','${client}',${version},'{}'::jsonb,'${rider}','${coach}');`;
const pointEdit = (point, change) => ({ op: 'point', id: point.id, before: point, value: { ...point, ...change } });
const set = (key, before, value) => ({ op: 'set', key, before, value });

async function run() {
  const h = createHarness('shared_edits'), report = [];
  let currentSession, connectionNumber = 0, overlaps = 0;
  const connect = () => h.connect(`race_${++connectionNumber}`);
  const snapshot = session => json(h.batch(`select jsonb_build_object('session',to_jsonb(s),'draft',d.draft)
    from public.run_live_sessions s join private.run_live_drafts d on d.session_id=s.id where s.id='${session}';`));
  const as = (actor, sql) => json(h.batch(acting(actor) + sql));
  async function fresh({ bootstrap = true } = {}) {
    if (currentSession) as(rider, call('end', currentSession, riderTab));
    const draft = {
      title: 'Qualifying', venue: 'Test park', notes: '', planType: 'competition',
      contestItemId: event, courseSource: 'event', imageDataUrl: photo,
      points: [
        { x: 10, y: 10, label: '', travelSeconds: 3 },
        { x: 35, y: 40, label: 'Manual', travelSeconds: 10, holdSeconds: 0.25 },
        { x: 65, y: 50, label: 'Barspin', travelSeconds: 7 },
        { x: 90, y: 90, label: '' }
      ], view: { scale: 1, x: 0, y: 0 }
    };
    const started = as(rider, call('start', null, riderTab, { mode: 'video', draft }));
    assert.equal(started.busy, undefined);
    currentSession = started.session.id;
    as(coach, call('accept', currentSession, coachTab));
    if (bootstrap) as(rider, edit(currentSession, riderTab, snapshot(currentSession).session.version, []));
    return snapshot(currentSession);
  }
  // Hold the first transaction after its mutation, then prove the second backend
  // is waiting on a real PostgreSQL lock before committing. No timing guesswork.
  async function overlap(firstActor, firstSql, secondActor, secondSql) {
    const a = connect(), b = connect();
    let committed = false;
    try {
      const first = json(await a.query(`begin;${acting(firstActor)}${firstSql}`));
      const pending = b.query(acting(secondActor) + secondSql)
        .then(text => ({ value: json(text) }), error => ({ error }));
      await h.waitLock(b);
      overlaps++;
      await a.query('commit;');
      committed = true;
      return { first, ...(await pending) };
    } finally {
      if (!committed) await a.query('rollback;').catch(() => {});
      await Promise.all([a.close(), b.close()]);
    }
  }
  const success = outcome => { assert.ifError(outcome.error); assert.equal(outcome.value.applied, true); return outcome.value; };
  const conflict = (outcome, expectedPath) => {
    assert.ifError(outcome.error);
    assert.equal(outcome.value.applied, false);
    assert(outcome.value.conflicts.includes(expectedPath), JSON.stringify(outcome.value.conflicts));
    return outcome.value;
  };
  try {
    await initialize(h.adapter);
    if (compact) await h.adapter.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260921062609_compact_live_run_course_payloads.sql'),'utf8'));
    h.batch(`insert into public.profiles values('${rider}','athlete','Shared run rider'),('${coach}','coach','Linked coach');
      insert into public.coach_athletes values('${coach}','${rider}');
      insert into public.dashboard_items(id,item_type,end_at) values('${event}','event',now()+interval '1 day');
      insert into public.event_course_photos values('${event}',${literal(photo)});`);

    let base = await fresh({ bootstrap: false }), sid = base.session.id, version = base.session.version;
    let out = await overlap(rider, edit(sid, riderTab, version, []), coach, edit(sid, coachTab, version, []));
    let result = success(out);
    assert.deepEqual(result.draft.points, out.first.draft.points);
    assert.equal(result.session.version, version + 1);
    assert.equal(new Set(result.draft.points.map(p => p.id)).size, 4);
    result.draft.points.forEach(p => assert.match(p.id, /^[0-9a-f-]{36}$/));
    assert.deepEqual(result.draft.points.map(({ id: _, ...point }) => point), base.draft.points);
    report.push('Simultaneous bootstrap assigns stable dot IDs once without moving or renaming dots.');

    base = await fresh(); sid = base.session.id; version = base.session.version;
    out = await overlap(rider, edit(sid, riderTab, version, [set('title', base.draft.title, 'Finals')]),
      coach, edit(sid, coachTab, version, [set('notes', '', 'Keep speed through the box') ]));
    result = success(out);
    assert.equal(result.draft.title, 'Finals'); assert.equal(result.draft.notes, 'Keep speed through the box');
    assert.equal(result.session.version, version + 2);
    assert.deepEqual(snapshot(sid).draft, result.draft);
    report.push('Concurrent rider title and coach notes both survive from the same starting version.');

    base = await fresh(); sid = base.session.id; version = base.session.version;
    let point = base.draft.points[1];
    out = await overlap(rider, edit(sid, riderTab, version, [pointEdit(point, { x: 43, y: 51 })]),
      coach, edit(sid, coachTab, version, [pointEdit(point, { label: 'Manual to barspin', travelSeconds: 12 })]));
    result = success(out);
    assert.deepEqual(result.draft.points[1], { ...point, x: 43, y: 51, label: 'Manual to barspin', travelSeconds: 12 });
    assert.equal(result.session.version, version + 2);
    report.push('Moving a dot and editing its trick/time merge by changed field, preserving fractional holds.');

    base = await fresh(); sid = base.session.id; version = base.session.version;
    out = await overlap(rider, edit(sid, riderTab, version, [set('title', 'Qualifying', 'Rider title')]),
      coach, edit(sid, coachTab, version, [set('notes', '', 'Must not be partially applied'), set('title', 'Qualifying', 'Coach title')]));
    result = conflict(out, 'title');
    assert.equal(result.session.version, version + 1);
    assert.equal(result.draft.title, 'Rider title'); assert.equal(result.draft.notes, '');
    assert.deepEqual(snapshot(sid).draft, out.first.draft);
    report.push('Overlapping root field changes reject the entire losing batch without a partial notes write.');

    base = await fresh(); sid = base.session.id; version = base.session.version; point = base.draft.points[1];
    out = await overlap(coach, edit(sid, coachTab, version, [pointEdit(point, { travelSeconds: 12 })]),
      rider, edit(sid, riderTab, version, [pointEdit(point, { travelSeconds: 7, label: 'Must not overwrite' })]));
    result = conflict(out, `points.${point.id}.travelSeconds`);
    assert.deepEqual(result.draft.points[1], { ...point, travelSeconds: 12 });
    assert.equal(result.session.version, version + 1);
    report.push('Concurrent changes to the same timing value conflict and preserve the winning time and trick name.');

    base = await fresh(); sid = base.session.id; version = base.session.version;
    const inserted = { id: id(900), x: 42, y: 45, label: 'Tailwhip', travelSeconds: 4.5 };
    const insertOp = [{ op: 'insert', after: base.draft.points[1].id, value: inserted }], retryId = nextRequest();
    out = await overlap(rider, edit(sid, riderTab, version, insertOp, retryId), rider, edit(sid, riderTab, version, insertOp, retryId));
    result = success(out);
    assert.equal(result.replayed, true); assert.equal(result.session.version, version + 1);
    assert.equal(result.draft.points.filter(p => p.id === inserted.id).length, 1);
    assert.equal(result.draft.points[2].id, inserted.id);
    assert.equal(h.batch(`select count(*) from private.run_live_edit_receipts where session_id='${sid}' and request_id='${retryId}';`), '1');
    report.push('Concurrent retries of one insertion create one dot, one receipt and one revision.');

    base = await fresh(); sid = base.session.id; version = base.session.version; point = base.draft.points[1];
    out = await overlap(rider, edit(sid, riderTab, version, [{ op: 'delete', id: point.id, before: point }]),
      coach, edit(sid, coachTab, version, [pointEdit(point, { label: 'Late edit' })]));
    result = conflict(out, `points.${point.id}`);
    assert.equal(result.draft.points.length, 3); assert(!result.draft.points.some(p => p.id === point.id));
    assert.equal(result.session.version, version + 1);
    report.push('Deletion winning over a delayed point edit cannot resurrect the removed dot.');

    base = await fresh(); sid = base.session.id; version = base.session.version; point = base.draft.points[1];
    out = await overlap(coach, edit(sid, coachTab, version, [pointEdit(point, { label: 'Confirmed coach edit' })]),
      rider, edit(sid, riderTab, version, [{ op: 'delete', id: point.id, before: point }]));
    result = conflict(out, `points.${point.id}`);
    assert.equal(result.draft.points.length, 4); assert.equal(result.draft.points[1].label, 'Confirmed coach edit');
    report.push('A stale deletion cannot erase a dot another participant has just changed.');

    base = await fresh(); sid = base.session.id; version = base.session.version; point = base.draft.points[1];
    const newPhoto = 'data:image/png;base64,' + 'b'.repeat(80);
    out = await overlap(coach, edit(sid, coachTab, version, [set('imageDataUrl', photo, newPhoto), set('courseSource', 'event', 'upload')]),
      rider, edit(sid, riderTab, version, [pointEdit(point, { x: 55 })]));
    result = conflict(out, 'course');
    assert.equal(result.draft.imageDataUrl, newPhoto); assert.deepEqual(result.draft.points, base.draft.points);
    report.push('An old coordinate edit cannot move a dot after another participant replaces the course photo.');

    base = await fresh(); sid = base.session.id; version = base.session.version;
    // Deliberately remove every lease: accepted call participants may both save.
    h.batch(`update public.run_live_sessions set editor_id=null,editor_client=null,lease_until=null where id='${sid}';`);
    out = await overlap(coach, save(sid, coachTab, version), rider, save(sid, riderTab, version));
    assert.ifError(out.error);
    assert.equal(out.value.session.saved_run_id, out.first.session.saved_run_id);
    let savedId = out.first.session.saved_run_id;
    assert(savedId); assert.equal(out.value.session.saved_version, version);
    assert.equal(out.value.session.status, 'active'); assert.equal(out.value.session.call_status, 'active');
    assert.equal(h.batch(`select count(*) from public.run_plans where id='${savedId}' and athlete_id='${rider}' and coach_id='${coach}';`), '1');
    assert.equal(h.batch('select count(*) from public.run_plans;'), '1');
    report.push('Simultaneous coach and rider saves need no lease and create exactly one run for the correct rider.');

    base = snapshot(sid); version = base.session.version;
    out = await overlap(rider, edit(sid, riderTab, version, [set('title', base.draft.title, 'Latest rider edit')]),
      coach, save(sid, coachTab, version));
    assert.match(out.error?.message || '', /run changed|latest edits/i);
    assert.equal(h.batch(`select title from public.run_plans where id='${savedId}';`), base.draft.title);
    result = snapshot(sid);
    assert.equal(result.draft.title, 'Latest rider edit'); assert.equal(result.session.saved_version, version);
    const savedLatest = as(coach, save(sid, coachTab, result.session.version));
    assert.equal(savedLatest.session.saved_run_id, savedId);
    assert.equal(h.batch(`select title from public.run_plans where id='${savedId}';`), 'Latest rider edit');
    report.push('Edit winning over a stale save leaves the earlier saved run intact; retry saves the current revision to the same row.');

    base = snapshot(sid); version = base.session.version;
    out = await overlap(coach, save(sid, coachTab, version), rider, edit(sid, riderTab, version, [set('notes', base.draft.notes, 'New edit after save')]));
    result = success(out);
    assert.equal(result.draft.notes, 'New edit after save'); assert.equal(result.session.version, version + 1);
    assert.equal(result.session.saved_version, version);
    assert.equal(h.batch(`select notes from public.run_plans where id='${savedId}';`), base.draft.notes);
    const finalSave = as(rider, save(sid, riderTab, result.session.version));
    assert.equal(finalSave.session.saved_run_id, savedId);
    assert.equal(h.batch(`select notes from public.run_plans where id='${savedId}';`), 'New edit after save');
    assert.equal(h.batch('select count(*) from public.run_plans;'), '1');
    report.push('Save winning first preserves the later edit as an unsaved revision; the rider can save it without ending the call.');

    assert.equal(overlaps, report.length);
    console.log(JSON.stringify({ status: 'PASS', postgres: h.batch('select version();'), independent_connections: h.count(), verified_lock_overlaps: overlaps, cases: report }, null, 2));
  } finally {
    await h.close();
  }
}

if (require.main === module) run().catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { run };
