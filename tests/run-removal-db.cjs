const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.JKCREW_PGLITE_PATH || '@electric-sql/pglite');
const migration = name => fs.readFileSync(path.join(__dirname, '../supabase/migrations', name), 'utf8');
function section(source, start, end) {
  const from = source.indexOf(start), to = end ? source.indexOf(end, from) : source.length;
  assert(from >= 0 && to > from, `SQL fixture section exists: ${start}`);
  return source.slice(from, to);
}
const id = number => `00000000-0000-0000-0000-${String(number).padStart(12, '0')}`;
const rider = id(1), coach = id(2), outsider = id(3), parent = id(4), otherCoach = id(5);
const runs = [id(10), id(11)], eventId = id(20);
const archivedAt = '2026-09-11T03:00:00.123456Z';
const db = new PGlite();
const sql = (query, values = []) => db.query(query, values);
async function as(actor) {
  await db.exec('reset role');
  await sql("select set_config('request.jwt.claim.sub', $1, false)", [actor || '']);
  await db.exec('set role authenticated');
}
const read = async run => (await sql('select to_jsonb(run) row, updated_at::text version, archived_at::text archived from run_plans run where id=$1', [run])).rows[0];
const notifications = async () => {
  await db.exec('reset role');
  return (await sql('select count(*)::int n from test_notifications')).rows[0].n;
};
// The REST update uses both the exact server version and archive state as CAS guards.
const remove = (run, version) => sql('update run_plans set archived_at=$3::timestamptz where id=$1 and updated_at=$2::timestamptz and archived_at is null returning to_jsonb(run_plans) row, updated_at::text version, archived_at::text archived', [run, version, archivedAt]);
const restore = (run, version, archived) => sql('update run_plans set archived_at=null where id=$1 and updated_at=$2::timestamptz and archived_at=$3::timestamptz returning to_jsonb(run_plans) row, updated_at::text version, archived_at::text archived', [run, version, archived]);
const content = row => {
  const { updated_at, archived_at, ...unchanged } = row;
  return unchanged;
};
let passed = 0;
async function test(name, fn) {
  await db.exec('reset role; begin');
  try { await fn(); passed++; console.log('PASS ' + name); }
  finally { await db.exec('reset role; rollback'); }
}

(async () => {
  await db.exec(`
    create schema auth; create schema private; create role authenticated; create role anon;
    grant usage on schema auth,private,public to authenticated;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table profiles(id uuid primary key, role text, display_name text);
    create table coach_athletes(coach_id uuid, athlete_id uuid, primary key(coach_id,athlete_id));
    create table parent_athletes(parent_id uuid, athlete_id uuid);
    create table dashboard_items(id uuid primary key, title text);
    create table run_plans(id uuid primary key, athlete_id uuid not null, coach_id uuid not null, created_by uuid not null,
      title text, venue text, plan_type text, notes text, points jsonb, image_data_url text, contest_item_id uuid,
      run_status text default 'planned', archived_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
    grant select on profiles,coach_athletes to authenticated;
    grant select,insert,update on run_plans to authenticated;
    alter table coach_athletes enable row level security;
    create policy linked_coach_or_rider on coach_athletes for select to authenticated using(coach_id=auth.uid() or athlete_id=auth.uid());
    alter table run_plans enable row level security;
    create policy run_plans_athlete_own_select on run_plans for select to authenticated using(athlete_id=auth.uid());
    create policy run_plans_athlete_own_insert on run_plans for insert to authenticated with check(athlete_id=auth.uid() and created_by=auth.uid());
    create policy run_plans_athlete_own_update on run_plans for update to authenticated using(athlete_id=auth.uid() and created_by=auth.uid()) with check(athlete_id=auth.uid() and created_by=auth.uid());
    create table test_notifications(recipient_id uuid, notification_type text, payload jsonb);
    create function private.emit_jkcrew_notification(uuid,text,text,text,text,jsonb,text,text) returns void language sql as $$
      insert into public.test_notifications(recipient_id,notification_type,payload) values($1,$2,$6);
    $$;
  `);
  await db.exec(section(migration('20260827233000_coach_edit_events_private_event_runs.sql'), 'drop policy if exists run_plans_coach_all'));
  await db.exec(migration('20260909210724_saved_run_shared_editing.sql'));
  for (const [user, role, name] of [[rider, 'athlete', 'Rider'], [coach, 'coach', 'Coach'], [outsider, 'athlete', 'Other rider'], [parent, 'parent', 'Linked parent'], [otherCoach, 'coach', 'Other linked coach']]) {
    await sql('insert into profiles values($1,$2,$3)', [user, role, name]);
  }
  await sql('insert into coach_athletes values($1,$3),($2,$3)', [coach, otherCoach, rider]);
  await sql('insert into parent_athletes values($1,$2)', [parent, rider]);
  await sql("insert into dashboard_items values($1,'Test event')", [eventId]);
  for (let index = 0; index < runs.length; index++) {
    await sql("insert into run_plans(id,athlete_id,coach_id,created_by,title,venue,plan_type,notes,points,image_data_url,contest_item_id,run_status) values($1,$2,$3,$4,$5,'Test park','competition','Keep timing, crop and labels',$6,'fixture-photo',$7,$8)", [
      runs[index], rider, coach, index === 0 ? rider : coach, index === 0 ? 'Qualifying' : 'Finals',
      JSON.stringify([{ x: 12.5, y: 80, label: '', travelSeconds: 7 }, { x: 75, y: 20, label: 'Barspin', trickSeconds: 1.2, travelSeconds: 10 }, { x: 52, y: 74, label: 'Tailwhip', trickSeconds: 1, view: { scale: 1.4, x: 0.2, y: 0.1 } }]),
      eventId, index === 0 ? 'ready_for_review' : 'reviewed',
    ]);
  }
  // Use the actual review/notification definitions, with only delivery replaced by a local sink.
  await db.exec(section(migration('20260909092007_private_progress_milestones.sql'), 'create or replace function private.guard_run_review()', 'create or replace function public.set_run_review_status'));
  await db.exec(section(migration('20260828090000_finish_notification_center_and_alerts.sql'), 'create or replace function private.notify_event_run_saved()', '-- Notify riders when a new weekly challenge'));

  for (const actor of [rider, coach]) for (const run of runs) {
    await test(`${actor === coach ? 'stored coach' : 'own rider'} removes and restores ${run === runs[0] ? 'rider-created' : 'coach-created'} run without changing its content`, async () => {
      await as(actor);
      const before = await read(run);
      const removed = (await remove(run, before.version)).rows[0];
      assert(removed);
      assert(removed.archived);
      assert.notEqual(removed.version, before.version);
      assert.notEqual(removed.version, removed.archived, 'Use the server trigger version, not the client archive timestamp');
      assert.equal((await read(run)).version, removed.version);
      assert.deepEqual(content(removed.row), content(before.row));
      const restored = (await restore(run, removed.version, removed.archived)).rows[0];
      assert(restored);
      assert.equal(restored.archived, null);
      assert.notEqual(restored.version, removed.version);
      assert.equal((await read(run)).version, restored.version);
      assert.deepEqual(content(restored.row), content(before.row));
      assert.equal((await sql('select count(*)::int n from run_plans')).rows[0].n, 2);
      assert.equal(await notifications(), 0, 'Archive and restore emit no saved-run notification');
    });
  }

  await test('outside rider, linked parent and other linked coach cannot read, remove or restore either run', async () => {
    const versions = await Promise.all(runs.map(read));
    for (const actor of [outsider, parent, otherCoach]) {
      await as(actor);
      assert.equal((await sql('select * from run_plans')).rows.length, 0);
      for (let index = 0; index < runs.length; index++) assert.equal((await remove(runs[index], versions[index].version)).rows.length, 0);
    }
    await as(rider);
    const archived = [];
    for (let index = 0; index < runs.length; index++) archived.push((await remove(runs[index], versions[index].version)).rows[0]);
    for (const actor of [outsider, parent, otherCoach]) {
      await as(actor);
      assert.equal((await sql('select * from run_plans')).rows.length, 0);
      for (let index = 0; index < runs.length; index++) assert.equal((await restore(runs[index], archived[index].version, archived[index].archived)).rows.length, 0);
    }
    await as(rider);
    assert((await sql('select archived_at from run_plans')).rows.every(row => row.archived_at !== null));
  });

  await test('stored coach loses access after unlink; rider still controls the same coach-created run', async () => {
    const before = await read(runs[1]);
    await sql('delete from coach_athletes where coach_id=$1 and athlete_id=$2', [coach, rider]);
    await as(coach);
    assert.equal((await sql('select * from run_plans')).rows.length, 0);
    assert.equal((await remove(runs[1], before.version)).rows.length, 0);
    await as(rider);
    const archived = (await remove(runs[1], before.version)).rows[0];
    assert(archived);
    await as(coach);
    assert.equal((await restore(runs[1], archived.version, archived.archived)).rows.length, 0);
    await as(rider);
    const restored = (await restore(runs[1], archived.version, archived.archived)).rows[0];
    assert.deepEqual(content(restored.row), content(before.row));
  });

  await test('a newer edit blocks stale Remove, and the newer content remains intact', async () => {
    await as(rider);
    const stale = await read(runs[0]);
    await as(coach);
    await sql('select save_shared_run_edits($1,$2,$3)', [runs[0], stale.version, JSON.stringify({ ...stale.row, title: 'Coach changed qualifying', notes: 'New coach timing' })]);
    const latest = await read(runs[0]);
    await as(rider);
    assert.equal((await remove(runs[0], stale.version)).rows.length, 0);
    assert.deepEqual((await read(runs[0])).row, latest.row);
    assert.equal(latest.archived, null);
  });

  await test('archive state and server version both guard Undo against stale changes', async () => {
    await as(rider);
    const before = await read(runs[0]);
    const archived = (await remove(runs[0], before.version)).rows[0];
    assert.equal((await restore(runs[0], archived.version, '2026-09-10T00:00:00Z')).rows.length, 0);
    assert.equal((await restore(runs[0], before.version, archived.archived)).rows.length, 0);
    assert.equal((await remove(runs[0], archived.version)).rows.length, 0, 'Already archived runs cannot be removed twice');
    await as(coach);
    await sql("update run_plans set notes='Coach revised archived run' where id=$1", [runs[0]]);
    const latest = await read(runs[0]);
    await as(rider);
    assert.equal((await restore(runs[0], archived.version, archived.archived)).rows.length, 0);
    assert.deepEqual((await read(runs[0])).row, latest.row);
    const freshRestore = (await restore(runs[0], latest.version, latest.archived)).rows[0];
    assert.equal(freshRestore.row.notes, 'Coach revised archived run');
    assert.equal((await restore(runs[0], freshRestore.version, archived.archived)).rows.length, 0, 'Stale Undo cannot act on an active run');
  });

  await test('review status and identity stay unchanged, and a forged timestamp cannot replace server version', async () => {
    await as(rider);
    const before = await read(runs[1]);
    const changed = (await sql("update run_plans set archived_at=$2::timestamptz,updated_at='2000-01-01T00:00:00Z' where id=$1 returning to_jsonb(run_plans) row,updated_at::text version,archived_at::text archived", [runs[1], archivedAt])).rows[0];
    assert.deepEqual(content(changed.row), content(before.row));
    assert.equal(changed.row.run_status, 'reviewed');
    assert.notEqual(changed.version, '2000-01-01 00:00:00+00');
    for (const field of ['id', 'athlete_id', 'coach_id', 'created_by']) {
      await db.exec('savepoint denied_identity');
      try { await assert.rejects(() => sql(`update run_plans set ${field}=$1 where id=$2`, [outsider, runs[1]]), /original rider and coach/); }
      finally { await db.exec('rollback to savepoint denied_identity'); }
    }
  });

  await test('notification positive control: changing a rider event route notifies, removing/restoring it does not', async () => {
    await as(rider);
    await sql('update run_plans set points=points where id=$1', [runs[0]]);
    assert.equal(await notifications(), 1, 'The actual UPDATE OF points notification trigger is installed');
    await as(rider);
    const before = await read(runs[0]);
    const archived = (await remove(runs[0], before.version)).rows[0];
    await restore(runs[0], archived.version, archived.archived);
    assert.equal(await notifications(), 1);
  });

  await db.close();
  console.log(`PASS ${passed} local database scenarios: reversible removal, exact versions, RLS and no archive notifications. No live writes.`);
})().catch(error => { console.error(error); process.exit(1); });
