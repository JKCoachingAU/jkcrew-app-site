// Actual migration on disposable PostgreSQL (PGlite); all identities, events,
// notifications and HTTP responses are synthetic. Never contacts production.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.JKCREW_PGLITE_PATH || '@electric-sql/pglite');
const db = new PGlite();
const root = path.resolve(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261024123158_uci_2027_schedule.sql'), 'utf8');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const q = async (text, args = []) => (await db.query(text, args)).rows;
const value = async (text, args = []) => Object.values((await q(text, args))[0])[0];
let passed = 0, tick = 0;
const base = Date.now() - 3600000;
const stamp = () => new Date(base + (++tick * 1000)).toISOString();
const today = new Date().toISOString().slice(0, 10);
async function actor(n = null, role = 'authenticated') {
  await db.exec('reset role');
  await q("select set_config('request.jwt.claim.sub',$1,false)", [n ? id(n) : '']);
  await db.exec(`set role ${role}`);
}
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
const event = (key = 'uci-bfr-2027-100', overrides = {}) => ({
  id: key, name: 'Test World Cup', startDate: '2027-06-10', endDate: '2027-06-12',
  venue: 'Brisbane', countryCode: 'AUS', country: 'Australia', classification: 'CDM',
  status: 'confirmed', dateStatus: 'calendar_dates', classificationStatus: 'confirmed', categories: ['Men Elite', 'Women Elite'],
  eligibleNationalities: ['GER', 'AUS'], eligibilityNote: 'Federation registration required', registration: { status: 'pending', url: null },
  rankingPoints: { status: 'uci_listed', note: 'World ranking points' }, olympicQualification: { status: 'pending_rules' },
  sources: [{ url: 'https://www.uci.org/competition-details/100', title: 'UCI calendar' }], ...overrides
});
const announcement = (key, overrides = {}) => ({ id: key, title: 'Official qualification update', summary: 'The official qualification system was published.',
  impactGermany: 'Germany: check federation selection dates.', impactAustralia: 'Australia: check federation entry requirements.', deadlines: 'Entries close 1 June.',
  sourceUrl: 'https://www.uci.org/pressrelease/qualification', publishedAt: new Date(base - 10000).toISOString(), verifiedAt: stamp(), significant: true, notify: true, ...overrides });
const rankings = () => ({ schemaVersion: 1, checkedAt: stamp(), categories: {
  men: { rankingDate: today, sourceUrl: 'https://dataride.uci.org/iframe/RankingDetails/men', rows: [
    { uciId: '10000000001', points: 100 }, { uciId: '10000000002', points: 0 }, { uciId: '10000000004', points: 40 },
    { uciId: '10000000005', points: 80 }, { uciId: '10000000006', points: 60 }] },
  women: { rankingDate: today, sourceUrl: 'https://dataride.uci.org/iframe/RankingDetails/women', rows: [{ uciId: '10000000007', points: 70 }] }
} });
const snapshot = (events = [event()], announcements = []) => ({ schemaVersion: 1, year: 2027, checkedAt: stamp(),
  lastSuccessfulCalendarCheckAt: stamp(), refreshStatus: 'current', events, announcements,
  qualification: { status: 'pending_rules', summary: 'General UCI points are not automatically Olympic qualification points.' },
  sourceChecks: [{ url: 'https://www.uci.org/api/calendar/upcoming?discipline=BFR&year=2027', status: 'ok' }],
  reviewCandidates: [{ id: 'private-review-marker', url: 'https://www.uci.org/news' }] });
const apply = (s, r = rankings()) => value('select public.apply_uci_schedule_snapshot($1,$2)', [s, r]);
const get = () => value('select public.get_uci_2027_schedule()');
const add = key => value('select public.add_uci_schedule_event($1)', [key]);
(async () => {
 try {
  await db.exec(`
   create role anon; create role authenticated; create role service_role bypassrls;
   create schema auth; create schema private; create schema cron; create schema net;
   grant usage on schema auth,public to anon,authenticated,service_role;
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   create table profiles(id uuid primary key,role text,country_code text,uci_id text);
   create table coach_athletes(coach_id uuid,athlete_id uuid);
   create table dashboard_items(id uuid primary key default gen_random_uuid(),owner_id uuid,created_by uuid,item_type text,title text,details text,
     due_at timestamptz,end_at timestamptz,completed boolean default false,created_at timestamptz default now(),updated_at timestamptz default now());
   create table event_attendees(event_id uuid,athlete_id uuid);
   create table run_plans(id uuid primary key,event_id uuid,athlete_id uuid,notes text);
   create table event_course_photos(event_id uuid,image_data_url text);
   create table private.rider_feature_access(athlete_id uuid primary key,features_disabled boolean default false);
   create table private.rider_recovery_states(athlete_id uuid primary key,enabled boolean default false);
   create function private.rider_recovery_active(p_athlete_id uuid) returns boolean language sql stable security definer set search_path='' as $$
     select exists(select 1 from private.rider_recovery_states where athlete_id=p_athlete_id and enabled); $$;
   create table app_notifications(id uuid default gen_random_uuid(),recipient_id uuid,notification_type text,title text,body text,view text,payload jsonb,source_key text unique);
   create table push_notification_queue(id uuid default gen_random_uuid(),recipient_id uuid,notification_type text,title text,body text,url text,payload jsonb,dedupe_key text unique,available_at timestamptz);
   create table push_preferences(user_id uuid,battle_updates boolean,challenge_updates boolean,event_updates boolean,sheet_updates boolean,coaching_updates boolean,
     achievement_updates boolean,quiet_hours_enabled boolean default false,quiet_hours_start time,quiet_hours_end time);
   create table push_subscriptions(user_id uuid,enabled boolean);
   create function public.jkcrew_country_timezone(text) returns text language sql as $$select 'Australia/Brisbane'::text$$;
   create table cron.job(jobname text primary key,schedule text,command text);
   create function cron.schedule(text,text,text) returns bigint language plpgsql as $$begin
     insert into cron.job values($1,$2,$3) on conflict(jobname) do update set schedule=$2,command=$3;return 1;end$$;
   create table net.requests(id bigint generated always as identity primary key,url text);
   create table net._http_response(id bigint,status_code integer,content_type text,headers jsonb,content text,timed_out boolean,error_msg text,created timestamptz);
   create function net.http_get(url text,params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds integer default 5000) returns bigint language plpgsql as $$
     declare n bigint;begin insert into net.requests(url) values(url) returning id into n;return n;end$$;
   grant select on profiles,coach_athletes to authenticated;
   grant select,insert,update on dashboard_items to authenticated;
   alter table dashboard_items enable row level security;
   create policy coach_edit on dashboard_items to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
   insert into profiles values
     ('${id(1)}','coach','AU',null),('${id(2)}','athlete','DE','10000000001'),('${id(3)}','athlete','AU','10000000002'),
     ('${id(4)}','athlete','AU','10000000003'),('${id(5)}','athlete','DE','10000000004'),('${id(6)}','athlete','AU','10000000005'),
     ('${id(7)}','athlete','DE','10000000006'),('${id(8)}','parent','AU',null),('${id(9)}','coach','DE',null),
     ('${id(10)}','admin','AU',null),('${id(11)}','athlete','AU','10000000007');
   insert into coach_athletes select '${id(1)}',id from profiles where role='athlete' and id<>'${id(7)}';
   insert into coach_athletes values('${id(9)}','${id(7)}');
   insert into private.rider_recovery_states values('${id(5)}',true);
   insert into private.rider_feature_access values('${id(6)}',true);
   insert into push_subscriptions select id,true from profiles;
   insert into push_preferences(user_id,event_updates) values('${id(11)}',false);
  `);
  const notifications = fs.readFileSync(path.join(root, 'supabase/migrations/20260828090000_finish_notification_center_and_alerts.sql'), 'utf8');
  await db.exec(notifications.slice(notifications.indexOf('create or replace function private.emit_jkcrew_notification('), notifications.indexOf('-- Preserve every existing push type')));
  await db.exec(sql);
  let s = snapshot([event(), event('uci-bfr-2027-101', { name: 'German Open', startDate: '2027-07-01', endDate: '2027-07-02' })], [announcement('baseline', { notify: false })]);
  let r = rankings();
  await test('service ingestion installs a silent verified baseline and scheduled fixed-feed refresh', async () => {
   await actor(null, 'service_role'); const result=await apply(s,r); assert.equal(result.events,2); assert.equal(result.notifications,0); assert.equal(new Date(result.checkedAt).toISOString(),s.checkedAt);
   await db.exec('reset role'); assert.equal(await value('select count(*) from app_notifications'), 0);
   const jobs = await q('select * from cron.job order by jobname'); assert.equal(jobs.length, 2); assert(jobs.some(x => x.schedule === '30 0 * * 1'));
  });
  await test('active athletes read metadata; parents, anonymous, disabled and recovery accounts are blocked', async () => {
   await actor(2); const data = await get(); assert.equal(data.events.length, 2); assert.equal(data.canManage, false); assert.equal(data.reviewCandidates, undefined);
   for (const n of [null, 8, 5, 6]) { await actor(n); await assert.rejects(get(), /authorized|not available/); }
   await actor(null, 'anon'); await assert.rejects(get(), /permission denied/);
   await actor(2); await assert.rejects(add('uci-bfr-2027-100'), /authorized/);
   await assert.rejects(value('select public.subscribe_uci_schedule_updates(true)'), /authorized/);
  });
  await test('authenticated callers cannot ingest snapshots, queue jobs or read private tables', async () => {
   await actor(1); await assert.rejects(apply(s, r), /permission denied/);
   for (const text of ['select private.request_uci_schedule_refresh()', 'select private.consume_uci_schedule_refresh()', 'select * from private.uci_schedule_state', 'select * from private.uci_schedule_notice_receipts']) await assert.rejects(q(text), /permission denied/);
   assert.equal((await get()).canManage, true);
  });
  let calendar;
  await test('repeated and queued add requests create exactly one shared calendar event', async () => {
   await actor(1); const results = await Promise.all([add('uci-bfr-2027-100'), add('uci-bfr-2027-100'), add('uci-bfr-2027-100')]);
   calendar = results[0].event_id; assert(results.every(x => x.event_id === calendar)); assert.equal(results.filter(x => !x.already_added).length, 1);
   await db.exec('reset role'); const row = (await q('select * from dashboard_items'))[0]; assert.equal(row.uci_schedule_date_only, true);
   assert.equal(new Date(row.due_at).toISOString(), '2027-06-10T12:00:00.000Z'); assert.match(row.details, /times TBC/);
   await actor(9); assert.equal((await add('uci-bfr-2027-100')).event_id, calendar);
  });
  await test('an existing exact event is linked without duplicating attendance or private runs', async () => {
   await db.exec('reset role'); await q("insert into dashboard_items(id,owner_id,created_by,item_type,title,details,due_at,end_at) values($1,$2,$2,'event','German Open','Coach custom venue','2027-07-01T15:00Z','2027-07-02T17:00Z')", [id(100), id(1)]);
   await q('insert into event_attendees values($1,$2)', [id(100), id(2)]); await q('insert into run_plans values($1,$2,$3,$4)', [id(900), id(100), id(2), 'Private run']);
   await actor(1); const before=(await get()).events.find(x=>x.id==='uci-bfr-2027-101');assert.equal(before.matchingEventId,id(100));assert.equal(before.matchingEventCount,1);assert.equal(before.alreadyAdded,false);
   const result = await add('uci-bfr-2027-101'); assert.equal(result.event_id, id(100)); assert.equal(result.already_added, true);
   await db.exec('reset role'); assert.equal(await value('select count(*) from dashboard_items'), 2); assert.equal(await value('select count(*) from run_plans'), 1);
   assert.equal(await value('select details from dashboard_items where id=$1', [id(100)]), 'Coach custom venue');
  });
  await test('verified date updates keep source-only flags, courses, attendance and private runs', async () => {
   await db.exec('reset role'); await q('insert into event_course_photos values($1,$2)', [calendar, 'synthetic-course-photo']); await q('insert into event_attendees values($1,$2)', [calendar, id(2)]);
   s = snapshot([event(undefined, { startDate: '2027-06-15', endDate: '2027-06-17' }), s.events[1]], s.announcements);
   await actor(null, 'service_role'); await apply(s);
   await db.exec('reset role'); const row = (await q('select * from dashboard_items where id=$1', [calendar]))[0];
   assert.equal(new Date(row.due_at).toISOString().slice(0, 10), '2027-06-15'); assert.equal(row.uci_schedule_date_only, true);
   assert.equal(await value('select count(*) from event_attendees'), 2); assert.equal(await value('select image_data_url from event_course_photos'), 'synthetic-course-photo');
  });
  await test('manual coach times and names survive refresh and raise visible sync conflicts', async () => {
   await actor(1); await q("update dashboard_items set title='Our travel plan',due_at='2027-06-15T08:00Z' where id=$1", [calendar]);
   s = snapshot([event(undefined, { name: 'Updated World Cup', startDate: '2027-06-18', endDate: '2027-06-20' }), s.events[1]], s.announcements);
   await actor(null, 'service_role'); await apply(s);
   await actor(1); const data = await get(), card = data.events.find(x => x.id === 'uci-bfr-2027-100'); assert.equal(card.syncStatus, 'coach_edits');
   assert(card.syncConflicts.includes('title')); assert(card.syncConflicts.includes('due_at'));
   const row = (await q('select * from dashboard_items where id=$1', [calendar]))[0]; assert.equal(row.title, 'Our travel plan'); assert.equal(row.uci_schedule_date_only, false);
   assert.equal(new Date(row.due_at).toISOString(), '2027-06-15T08:00:00.000Z');
  });
  await test('provisional updates do not rewrite calendar dates; disappeared events are retained', async () => {
   s = snapshot([event('uci-bfr-2027-101', { name: 'German Open', status: 'provisional', dateStatus: 'provisional', startDate: '2027-09-01', endDate: '2027-09-02' })], s.announcements);
   await actor(null, 'service_role'); await apply(s); await actor(1); assert.equal((await get()).events.length, 2);
   assert.equal(new Date(await value('select due_at from dashboard_items where id=$1', [id(100)])).toISOString(), '2027-07-01T15:00:00.000Z');
  });
  await test('cancelled events are visibly flagged without deleting data and cannot be newly added', async () => {
   s = snapshot([...s.events, event('uci-bfr-2027-102', { name: 'Cancelled event', status: 'cancelled' })], s.announcements);
   await actor(null, 'service_role'); await apply(s); await actor(1); await assert.rejects(add('uci-bfr-2027-102'), /cancelled/);
   assert.equal((await get()).events.find(x => x.id === 'uci-bfr-2027-102').status, 'cancelled');
  });
  await test('new official announcements notify only subscribed coaches and linked positive-point riders', async () => {
   await actor(1); assert.deepEqual(await value('select public.subscribe_uci_schedule_updates(true)'), {enabled: true});
   s = snapshot(s.events, [...s.announcements, announcement('qualification-v1')]);
   await actor(null, 'service_role'); const result = await apply(s); assert.equal(result.notifications, 4);
   await db.exec('reset role'); assert.deepEqual((await q('select recipient_id from app_notifications order by recipient_id')).map(x => x.recipient_id), [id(1), id(2), id(7), id(11)]);
   assert.deepEqual((await q('select recipient_id from push_notification_queue order by recipient_id')).map(x => x.recipient_id), [id(1), id(2), id(7)]);
   assert.match(await value('select body from app_notifications where recipient_id=$1', [id(2)]), /Germany:/);
   const coachBody=await value('select body from app_notifications where recipient_id=$1',[id(1)]);assert.match(coachBody,/Germany:/);assert.match(coachBody,/Australia:/);
   assert.equal(await value('select view from app_notifications where recipient_id=$1',[id(2)]),'uciSchedule');
   assert.equal(await value('select url from push_notification_queue where recipient_id=$1',[id(2)]),'./?push=uciSchedule');
   assert.equal((await value('select payload from app_notifications where recipient_id=$1', [id(2)])).source_url, 'https://www.uci.org/pressrelease/qualification');
  });
  await test('retries, queued ingests and identical verified announcements never duplicate notifications', async () => {
   await actor(null, 'service_role'); r = rankings(); await Promise.all([apply(s, r), apply(s, r)]);
   const next = {...s, checkedAt: stamp()}; await apply(next); s = next;
   await db.exec('reset role'); assert.equal(await value('select count(*) from app_notifications'), 4); assert.equal(await value('select count(*) from push_notification_queue'), 3);
  });
  await test('candidate changes never notify and coach Notify me preference never suppresses rider alerts', async () => {
   await actor(1); await value('select public.subscribe_uci_schedule_updates(false)');
   s = snapshot(s.events, [...s.announcements, announcement('qualification-v2')]);
   await actor(null, 'service_role'); assert.equal((await apply(s)).notifications, 3);
   await db.exec('reset role'); assert.equal(await value('select count(*) from app_notifications'), 7);
   assert.deepEqual((await q("select recipient_id from app_notifications where payload->>'announcement_id'='qualification-v2' order by recipient_id")).map(x=>x.recipient_id),[id(2),id(7),id(11)]);
  });
  await test('long Unicode announcements remain within the Web Push byte budget with deadlines and source links', async () => {
   const longNotice=announcement('qualification-unicode',{title:'世'.repeat(160),summary:'世'.repeat(1200),impactGermany:'Germany: '+ '界'.repeat(1000),impactAustralia:'Australia: '+ '界'.repeat(1000),deadlines:[{date:'2027-06-01',label:'Entry deadline'}],sourceUrl:'https://www.uci.org/pressrelease/'+ 'a'.repeat(950)});
   s=snapshot(s.events,[...s.announcements,longNotice]);await actor(null,'service_role');await apply(s);await db.exec('reset role');
   const item=(await q("select * from push_notification_queue where payload->>'announcement_id'='qualification-unicode' limit 1"))[0];
   const workerPayload={title:item.title,body:item.body,url:item.url||'./',type:item.notification_type,notificationId:item.id,...item.payload};
   assert.ok(Buffer.byteLength(JSON.stringify(workerPayload),'utf8')<3800);
   assert.match(item.body,/2027-06-01 Entry deadline/);assert.match(item.body,/Germany:/);assert.equal(item.payload.source_url,longNotice.sourceUrl);
   assert.equal(item.payload.summary,undefined);assert.equal(item.payload.deadlines,undefined);
  });
  await test('stale, future, null and malformed feeds cannot alter saved schedule or calendar', async () => {
   await actor(null, 'service_role');
   for (const bad of [null, {}, {...s, checkedAt: new Date(base - 1000).toISOString()}, {...s, checkedAt: '2099-01-01'}, {...s, events: [{id:'bad'}]}]) await assert.rejects(apply(bad), /Invalid|Older|not current|new verification/);
   const staleRanks = rankings(); staleRanks.checkedAt = '2020-01-01'; await assert.rejects(apply({...s,checkedAt:stamp()}, staleRanks), /not current/);
   const zeroUnknown = rankings(); delete zeroUnknown.categories.men.rows[0].uciId; await assert.rejects(apply({...s,checkedAt:stamp()}, zeroUnknown), /Invalid UCI ranking entry/);
   await actor(1); assert.equal(new Date((await get()).checkedAt).toISOString(), s.checkedAt);
  });
  await test('malicious announcement domains, revision mutation and duplicate event IDs roll back atomically', async () => {
   await actor(null, 'service_role');
   await assert.rejects(apply(snapshot(s.events,[announcement('evil',{sourceUrl:'https://uci.org.attacker.test/news'})])), /official evidence/);
   await assert.rejects(apply(snapshot(s.events,[announcement('qualification-v1',{summary:'Altered without revision'})])), /new revision/);
   await assert.rejects(apply(snapshot([event(),event()])), /Duplicate/);
   await db.exec('reset role'); assert.equal(await value("select count(*) from private.uci_schedule_announcements where source_id='evil'"), 0);
  });
  await test('network worker uses only fixed feed URLs and no anonymous/service secrets', async () => {
   await db.exec('reset role'); assert.equal(await value('select private.request_uci_schedule_refresh()'), true); assert.equal(await value('select private.request_uci_schedule_refresh()'), false);
   const rows = await q('select url from net.requests order by id'); assert.deepEqual(rows.map(x=>x.url), [
    'https://raw.githubusercontent.com/JKCoachingAU/jkcrew-app-site/uci-schedule/schedule.json',
    'https://raw.githubusercontent.com/JKCoachingAU/jkcrew-app-site/uci-rankings/rankings.json']);
  });
  await test('one failed upstream preserves healthy verification time and schedules bounded retries', async () => {
   await db.exec('reset role'); const before = await value('select checked_at from private.uci_schedule_state');
   await db.exec("insert into net._http_response(id,status_code,content) select id,case when url like '%/schedule.json' then 503 else 200 end,'{}' from net.requests;");
   await value('select private.consume_uci_schedule_refresh()');
   const state = (await q('select * from private.uci_schedule_state'))[0]; assert.equal(state.refresh_status, 'retrying'); assert(state.retry_at); assert.deepEqual(state.checked_at,before);
   await db.exec("update private.uci_schedule_state set attempts=4,retry_at=now()-interval '1 minute';");
   assert.equal(await value('select private.request_uci_schedule_refresh(true)'), false);
   assert.equal(await value('select count(*) from net.requests'), 2);
  });
  await test('verified full responses are consumed atomically and clear retries', async () => {
   await db.exec('reset role'); await value('select private.request_uci_schedule_refresh()');
   const state = (await q('select * from private.uci_schedule_state'))[0]; s = {...s,checkedAt:stamp()}; r=rankings();
   await q('insert into net._http_response(id,status_code,content) values($1,200,$2),($3,200,$4)',[state.schedule_request_id,JSON.stringify(s),state.rankings_request_id,JSON.stringify(r)]);
   await value('select private.consume_uci_schedule_refresh()');
   const after=(await q('select * from private.uci_schedule_state'))[0]; assert.equal(after.refresh_status,'current'); assert.equal(after.attempts,0); assert.equal(after.retry_at,null);
   await actor(1); assert.equal((await get()).events.length,3);
  });
  await test('manual date-only edits retain the date-only flag and a custom range is never partly overwritten', async () => {
   await actor(1); await q("update dashboard_items set due_at='2027-08-10T12:00Z',end_at='2027-08-12T12:00Z',uci_schedule_date_only=true where id=$1",[calendar]);
   assert.equal(await value('select uci_schedule_date_only from dashboard_items where id=$1',[calendar]),true);
   s=snapshot([event(undefined,{startDate:'2027-06-01',endDate:'2027-06-03'})],s.announcements);
   await actor(null,'service_role');await apply(s);
   await db.exec('reset role');const row=(await q('select due_at,end_at from dashboard_items where id=$1',[calendar]))[0];
   assert.equal(new Date(row.due_at).toISOString(),'2027-08-10T12:00:00.000Z');assert.equal(new Date(row.end_at).toISOString(),'2027-08-12T12:00:00.000Z');
  });
  await test('cancellation status reaches a custom-titled calendar event without losing the custom title', async () => {
   s=snapshot([event(undefined,{status:'cancelled',dateStatus:'provisional'})],s.announcements);
   await actor(null,'service_role');await apply(s);
   await db.exec('reset role');const row=(await q('select title,uci_schedule_status from dashboard_items where id=$1',[calendar]))[0];
   assert.equal(row.title,'Our travel plan');assert.equal(row.uci_schedule_status,'cancelled');assert.equal(await value('select count(*) from event_course_photos'),1);
  });
  await test('manually removed calendar events stay removed across refreshes', async () => {
   await db.exec('reset role'); await q('delete from dashboard_items where id=$1',[id(100)]);
   s={...s,checkedAt:stamp()};await actor(null,'service_role');await apply(s);await actor(1);
   const card=(await get()).events.find(x=>x.id==='uci-bfr-2027-101');assert.equal(card.existingEventId,null);assert.equal(card.syncStatus,'removed');
  });
  await test('repository source-agent snapshot and current rankings satisfy the real ingestion contract', async () => {
   const realSnapshot=JSON.parse(fs.readFileSync(path.join(root,'data/uci-schedule.json'),'utf8'));
   const realRankings=JSON.parse(fs.readFileSync(path.join(root,'data/uci-rankings.json'),'utf8'));
   // Reset only this disposable fixture's import cursor so the exact published
   // timestamps and ranking dates can be checked without a synthetic newer cursor.
   await db.exec("reset role; update private.uci_schedule_state set checked_at=null,rankings='{}',snapshot='{}';");
   await actor(null,'service_role');const result=await apply(realSnapshot,realRankings);assert.equal(result.events,realSnapshot.events.length);assert.equal(result.notifications,0);
   await actor(1);const rendered=await get();for(const source of realSnapshot.events){const saved=rendered.events.find(x=>x.id===source.id);for(const key of ['dateNote','reviewNote','lastVerifiedAt','listingMissingSince','aliases'])if(key in source)assert.deepEqual(saved[key],source[key]);}
  });
  console.log(`${passed} UCI schedule database checks passed.`);
 } finally { await db.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
