// Actual transition-table trigger SQL with synthetic queue rows and a local
// counter in place of the network worker. No network, accounts, keys or pushes.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { PGlite } = require(process.env.JKCREW_PGLITE_PATH || '@electric-sql/pglite');
(async () => {
  const db = new PGlite(); let checks = 0;
  const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
  const value = async sql => (await db.query(sql)).rows[0].v;
  try {
    await db.exec(`
      create schema private;
      create role anon; create role authenticated; create role service_role;
      create table public.push_notification_queue(id integer primary key,status text not null default 'pending',available_at timestamptz not null default now());
      create table private.fixture_worker_kicks(id integer);
      create function private.kick_jkcrew_push_worker() returns void language sql as $$ insert into private.fixture_worker_kicks values(1) $$;
      create function private.kick_jkcrew_push_worker_after_insert() returns trigger language plpgsql as $$ begin perform private.kick_jkcrew_push_worker();return null;end $$;
      create trigger push_queue_kick_worker after insert on public.push_notification_queue for each statement execute function private.kick_jkcrew_push_worker_after_insert();
    `);
    await db.exec('insert into public.push_notification_queue select 1,\'pending\',now() where false');
    eq(await value('select count(*)::int v from private.fixture_worker_kicks'), 1, 'Baseline reproduces the empty-batch worker launch');
    const migration = path.join(__dirname, '../supabase/migrations/20261118223757_skip_empty_push_worker_kicks.sql');
    await db.exec(fs.readFileSync(migration, 'utf8'));
    const kicks = () => value('select count(*)::int v from private.fixture_worker_kicks');
    await db.exec("insert into public.push_notification_queue select 1,'pending',now() where false");
    eq(await kicks(), 1, 'An empty INSERT SELECT launches no worker');
    await db.exec('insert into public.push_notification_queue(id)values(1),(2),(3)');
    eq(await kicks(), 2, 'A nonempty multi-row batch launches exactly one worker');
    await db.exec('insert into public.push_notification_queue(id)values(1),(2),(3)on conflict(id)do nothing');
    eq(await kicks(), 2, 'A completely deduplicated batch launches no worker');
    await db.exec('insert into public.push_notification_queue(id)values(1),(4)on conflict(id)do nothing');
    eq(await kicks(), 3, 'A mixed new/deduplicated batch launches exactly one worker');
    await db.exec("update public.push_notification_queue set status='processing' where id in(1,2)");
    eq(await kicks(), 3, 'A claim update does not recursively launch another worker');
    await db.exec("update public.push_notification_queue set status='sent' where id in(1,2)");
    eq(await kicks(), 3, 'A delivery completion does not launch another worker');
    await db.exec("update public.push_notification_queue set status='pending',available_at=now()+interval '3 minutes' where id=1");
    eq(await kicks(), 3, 'A delayed retry does not launch an immediate worker');
    await db.exec("update public.push_notification_queue set status='skipped' where id=3");
    await db.exec("insert into public.push_notification_queue(id)values(3)on conflict(id)do update set status='pending',available_at=now() where public.push_notification_queue.status='skipped'");
    eq(await kicks(), 4, 'A revived due reminder still launches one immediate worker');
    await db.exec("insert into public.push_notification_queue(id)values(3)on conflict(id)do update set status='pending',available_at=now() where public.push_notification_queue.status='skipped'");
    eq(await kicks(), 4, 'An unchanged ON CONFLICT UPDATE WHERE false launches no worker');
    await db.exec("update public.push_notification_queue set status='pending' where id=3");
    eq(await kicks(), 4, 'A redundant pending-state update launches no worker');
    await db.exec("update public.push_notification_queue set status='skipped' where id in(2,4)");
    await db.exec("update public.push_notification_queue set status='pending',available_at=now() where id in(2,4)");
    eq(await kicks(), 5, 'A batch of revived due reminders launches one worker');
    await db.exec("begin;insert into public.push_notification_queue(id)values(5);rollback;");
    eq(await kicks(), 5, 'A rolled-back enqueue does not leave a worker request');
    eq(await value('select count(*)::int v from public.push_notification_queue where id=5'), 0, 'A rolled-back enqueue leaves no notification');
    await db.exec('update public.push_notification_queue set status=\'pending\' where false');
    eq(await kicks(), 5, 'An empty UPDATE launches no worker');
    for (const role of ['anon','authenticated','service_role']) for (const fn of ['kick_jkcrew_push_worker_after_insert','kick_jkcrew_push_worker_after_requeue']) {
      eq(await value(`select has_function_privilege('${role}','private.${fn}()','EXECUTE') v`), false, `${role} cannot invoke the internal trigger helper`);
    }
    eq(await value("select count(*)::int v from pg_trigger where tgrelid='public.push_notification_queue'::regclass and not tgisinternal"), 2, 'Only insert and requeue statement triggers are installed');
    console.log(`PASS: ${checks} empty-push-batch checks (production trigger SQL; synthetic local rows only).`);
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
