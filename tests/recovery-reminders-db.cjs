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
  await db.exec(`
    alter table public.push_notification_queue add column url text default './',add column payload jsonb default '{}',add column dedupe_key text unique;
    alter table public.app_notifications add column payload jsonb default '{}';
    create table public.push_subscriptions(id uuid primary key default gen_random_uuid(),user_id uuid not null,enabled boolean default true);
    alter table public.push_subscriptions enable row level security;
    grant select,insert,update,delete on public.push_subscriptions to authenticated;
    create policy own_device on public.push_subscriptions for all to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);
    create table public.push_preferences(user_id uuid primary key,quiet_hours_enabled boolean default false,quiet_hours_start time default '20:00',quiet_hours_end time default '08:00');
    create schema cron;
    create table cron.calls(name text,schedule text,command text);
    create function cron.schedule(text,text,text) returns bigint language plpgsql as $$ begin insert into cron.calls values($1,$2,$3); return 1; end $$;
  `);
  await db.exec(migration('20261029014818_recovery_checkin_reminders.sql'));
  let episode, state, date, queueId;
  const reminders = n => scalar('select public.get_recovery_reminder_settings($1)', [n ? id(n) : null]);
  const configure = (enabled,time='18:00',tz='Australia/Brisbane',version=0, ep=episode) => scalar('select public.set_recovery_reminder($1,$2,$3,$4,$5)', [ep,enabled,time,tz,version]);
  const due = (date,now,ep=episode) => scalar('select private.recovery_reminder_due($1,$2,$3,$4)', [id(2),ep,date,now]);
  const queue = () => scalar('select private.queue_due_recovery_reminders()');
  const validate = (secret='local-fixture-secret') => scalar('select public.validate_jkcrew_recovery_push($1,$2)', [secret,queueId]);
  const system = () => db.exec('reset role');
  await test('migration schedules only a local five-minute job and opts no account in',async()=>{
    assert.equal(await scalar('select count(*)::int from private.rider_recovery_reminders'),0);
    assert.deepEqual((await q('select * from cron.calls'))[0],{name:'jkcrew-recovery-checkin-reminders',schedule:'*/5 * * * *',command:'select private.queue_due_recovery_reminders();'});
    assert.equal(await queue(),0);
    await actor(1); state=await mode(2,true,0); episode=state.episode.id;
    assert.equal(state.reminder.configured,false); assert.equal(state.reminder.enabled,false); assert.equal(state.reminder.today_status,'off');
  });
  await test('private reminder storage is RLS protected and worker helpers have no client execute grants',async()=>{
    assert.equal(await scalar("select relrowsecurity from pg_class where oid='private.rider_recovery_reminders'::regclass"),true);
    for(const signature of ['private.recovery_reminder_due(uuid,text,text,timestamptz)','private.queue_due_recovery_reminders()','private.recovery_reminder_metadata(uuid)','public.validate_jkcrew_recovery_push(text,uuid)','public.claim_jkcrew_push_notifications(text,integer)']) {
      for(const role of ['anon','authenticated']) assert.equal(await scalar("select has_function_privilege($1,$2,'EXECUTE')",[role,signature]),false);
    }
    const unsafe=await q("select n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('get_recovery_reminder_settings','set_recovery_reminder','validate_jkcrew_recovery_push') and n.nspname='public' and p.prosecdef");
    assert.deepEqual(unsafe,[]);
  });
  await test('parents, unrelated riders/coaches, anonymous users cannot read or change reminder settings',async()=>{
    for(const n of [3,4,5]) { await actor(n); await assert.rejects(()=>reminders(2),/cannot view/); await assert.rejects(()=>configure(true),/linked coach/); }
    await actor(null,'anon'); await assert.rejects(()=>reminders(2),/permission denied/);
    await actor(2); await assert.rejects(()=>q('select * from private.rider_recovery_reminders'),/permission denied/);
    await assert.rejects(()=>queue(),/permission denied/);
    await assert.rejects(()=>validate(),/permission denied/);
  });
  await test('coach can opt in and rider can change their own settings without replacing history',async()=>{
    await actor(1); state=await configure(true); date=state.today_date;
    assert.deepEqual(state.reminder,{configured:true,enabled:true,local_time:'18:00:00',timezone:'Australia/Brisbane',version:1,has_enabled_device:false,today_status:'no_device'});
    assert.equal(state.timezone,'Australia/Brisbane');
    await actor(2); assert.equal((await reminders()).timezone,'Australia/Brisbane');
    await assert.rejects(()=>configure(true,'18:00','Invalid/Zone',1),/valid reminder/);
    await assert.rejects(()=>configure(true,'18:00','Australia/Brisbane',0),/another device/);
    state=await configure(true,'18:00','Australia/Brisbane',1); assert.equal(state.reminder.version,2);
    await q('insert into public.push_subscriptions(user_id) values($1)',[id(2)]);
    await assert.rejects(()=>q('insert into public.push_subscriptions(user_id) values($1)',[id(3)]),/row-level security/);
    assert.equal((await reminders()).has_enabled_device,true);
  });
  await test('recovery gateway permits only required reminder and device routes',async()=>{
    for(const endpoint of ['/rpc/get_recovery_reminder_settings','/rpc/set_recovery_reminder','/push_subscriptions']) await gateway(endpoint);
    await gateway('/push_subscriptions','GET'); await gateway('/push_subscriptions','DELETE');
    for(const endpoint of ['/training_sessions','/push_preferences','/rpc/send_my_test_notification','/rpc/queue_due_recovery_reminders','/rpc/validate_jkcrew_recovery_push']) await assert.rejects(()=>gateway(endpoint),/Recovery mode is on/);
    await assert.rejects(()=>gateway('/push_subscriptions','PATCH'),/Recovery mode is on/);
  });
  await test('6pm Brisbane due window is two hours and never catches up late at night',async()=>{
    await system();
    assert.equal(await due('2026-10-29','2026-10-29T07:59:59Z'),false);
    assert.equal(await due('2026-10-29','2026-10-29T08:00:00Z'),true);
    assert.equal(await due('2026-10-29','2026-10-29T09:59:59Z'),true);
    assert.equal(await due('2026-10-29','2026-10-29T10:00:00Z'),false);
    assert.equal(await due('2026-10-28','2026-10-29T08:00:00Z'),false);
  });
  await test('existing German quiet hours keep their country zone when the reminder uses Brisbane',async()=>{
    await q("insert into public.push_preferences(user_id,quiet_hours_enabled,quiet_hours_start,quiet_hours_end) values($1,true,'08:00','10:00')",[id(2)]);
    // Brisbane 18:00 is Berlin 09:00 on this date, inside existing quiet hours.
    assert.equal(await due('2026-10-29','2026-10-29T08:00:00Z'),false);
    await q("update public.push_preferences set quiet_hours_start='10:00',quiet_hours_end='12:00' where user_id=$1",[id(2)]);
    assert.equal(await due('2026-10-29','2026-10-29T08:00:00Z'),true);
    await q('delete from public.push_preferences where user_id=$1',[id(2)]);
  });
  await test('IANA zones follow daylight saving without fixed offsets',async()=>{
    await actor(2); await configure(true,'18:00','Europe/Berlin',2); await system();
    assert.equal(await due('2026-10-24','2026-10-24T16:00:00Z'),true);
    assert.equal(await due('2026-10-25','2026-10-25T16:00:00Z'),false);
    assert.equal(await due('2026-10-25','2026-10-25T17:00:00Z'),true);
  });
  await test('normal and overnight quiet hours prevent a reminder; equal quiet hours suppress all day',async()=>{
    await q("insert into public.push_preferences(user_id,quiet_hours_enabled,quiet_hours_start,quiet_hours_end) values($1,true,'17:00','19:00')",[id(2)]);
    assert.equal(await due('2026-10-25','2026-10-25T17:00:00Z'),false);
    await q("update public.push_preferences set quiet_hours_start='17:00',quiet_hours_end='08:00' where user_id=$1",[id(2)]);
    assert.equal(await due('2026-10-25','2026-10-25T17:00:00Z'),false);
    await q("update public.push_preferences set quiet_hours_start='12:00',quiet_hours_end='12:00' where user_id=$1",[id(2)]);
    assert.equal(await due('2026-10-25','2026-10-25T17:00:00Z'),false);
    await q('update public.push_preferences set quiet_hours_enabled=false where user_id=$1',[id(2)]);
  });
  // Queue tests use the real local clock, with a due time at the start of the current minute.
  // No network worker or actual push endpoint exists in this disposable database.
  const now=await scalar('select clock_timestamp()');
  const dueTime=await scalar("select date_trunc('minute',clock_timestamp() at time zone 'UTC')::time::text");
  await actor(2); state=await configure(true,dueTime,'UTC',3); date=state.today_date;
  await test('scheduler enqueues one generic reminder and repeats do not duplicate it',async()=>{
    await system(); assert.equal(await queue(),1); assert.equal(await queue(),0);
    const row=(await q("select id,title,body,url,payload,dedupe_key,status from public.push_notification_queue where notification_type='recovery_checkin_reminder'"))[0]; queueId=row.id;
    assert.equal(row.title,'Your daily check-in'); assert.equal(row.body,"Take a moment to complete today's check-in in JKCREW.");
    assert.equal(row.url,'./?push=home&checkin=today'); assert.equal(row.payload.view,'home'); assert.equal(row.payload.recovery_page,'today');
    assert.deepEqual(Object.keys(row.payload).sort(),['checkin_date','episode_id','expires_at','recovery_page','view']);
    assert.equal(row.dedupe_key,`recovery-checkin:${episode}:${date}`);
    assert.equal((await validate()).eligible,true);
    assert(new Date((await validate()).expires_at)-new Date(now)<=2*60*60*1000);
  });
  await test('turning reminder off cancels pending work; re-enabling before delivery reuses its one row',async()=>{
    await actor(2); await configure(false,dueTime,'UTC',4); await system();
    assert.equal((await validate()).eligible,false); assert.equal(await queue(),0);
    assert.equal(await scalar('select status from push_notification_queue where id=$1',[queueId]),'skipped');
    await actor(2); await configure(true,dueTime,'UTC',5); await system(); assert.equal(await queue(),1);
    assert.equal(await scalar("select count(*)::int from push_notification_queue where notification_type='recovery_checkin_reminder'"),1);
  });
  await test('recovery keeps training notifications blocked and rejects forged or stale reminders',async()=>{
    await q("insert into public.push_notification_queue(recipient_id,notification_type,title,payload) values($1,'battle_result','Blocked','{}')",[id(2)]);
    assert.equal(await scalar("select count(*)::int from push_notification_queue where notification_type='battle_result'"),0);
    await q("insert into public.app_notifications(recipient_id,notification_type,title,payload) values($1,'daily_hype','Blocked','{}')",[id(2)]);
    assert.equal(await scalar("select count(*)::int from app_notifications where notification_type='daily_hype'"),0);
    await q("insert into public.push_notification_queue(recipient_id,notification_type,title,payload) values($1,'recovery_checkin_reminder','Invalid',$2)",[id(2),{episode_id:'wrong',checkin_date:date}]);
    assert.equal(await scalar("select count(*)::int from push_notification_queue where title='Invalid'"),0);
    await q("update push_notification_queue set payload=jsonb_set(payload,'{checkin_date}','\"2000-01-01\"') where id=$1",[queueId]);
    assert.equal((await validate()).eligible,false);
    assert.deepEqual(await q("select id from public.claim_jkcrew_push_notifications('local-fixture-secret',50)"),[]);
    assert.equal(await scalar('select status from push_notification_queue where id=$1',[queueId]),'skipped');
    assert.equal(await queue(),1);
  });
  await test('worker claim and immediate send validation require correct secret and current eligibility',async()=>{
    await actor(null,'service_role'); await assert.rejects(()=>validate('wrong'),/Invalid push worker secret/);
    assert.equal((await validate()).eligible,true);
    const claimed=await q("select id from public.claim_jkcrew_push_notifications('local-fixture-secret',50)"); assert.deepEqual(claimed,[{id:queueId}]);
    await system(); await q('update push_subscriptions set enabled=false where user_id=$1',[id(2)]);
    assert.equal((await validate()).eligible,false);
    await q('update push_subscriptions set enabled=true where user_id=$1',[id(2)]);
  });
  await test('saving a check-in cancels queued reminders and in-flight send validation',async()=>{
    await system(); await q("update push_notification_queue set status='pending' where id=$1",[queueId]);
    await actor(2); state=await save(episode,date,0,700); assert.equal(state.reminder.today_status,'completed');
    await system(); assert.equal((await validate()).eligible,false); assert.equal(await queue(),0);
    assert.equal(await scalar('select status from push_notification_queue where id=$1',[queueId]),'skipped');
    assert.equal(await scalar('select checkin_date::text from private.rider_recovery_checkins where episode_id=$1',[episode]),date);
  });
  await test('ending or replacing an episode cannot reuse an old reminder configuration',async()=>{
    await actor(1); await mode(2,false,1,'Local fixture clearance'); await system();
    assert.equal((await validate()).eligible,false); assert.equal(await queue(),0);
    await actor(2); await assert.rejects(()=>configure(true,dueTime,'UTC',6),/no longer active/);
    await actor(1); state=await mode(2,true,2); assert.notEqual(state.episode.id,episode); assert.equal(state.reminder.configured,false); assert.equal(state.reminder.enabled,false);
    await system(); assert.equal(await queue(),0);
  });
  console.log(`PASS ${checks} recovery reminder database checks`);
  await db.close();
})().catch(async error=>{console.error(error);await db.close();process.exitCode=1;});
