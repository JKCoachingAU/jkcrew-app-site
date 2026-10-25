// Actual tracker migration on disposable PostgreSQL (PGlite). Synthetic users
// and data only; no production connections or writes. Queued calls are not a
// substitute for a separate-connection PostgreSQL concurrency stress test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.JKCREW_PGLITE_PATH || '@electric-sql/pglite');
const db = new PGlite();
const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261024232140_uci_rider_tracker.sql'), 'utf8');
const parentSql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261025012339_parent_uci_rider_tracker_read_only.sql'), 'utf8');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const q = async (s,a=[]) => (await db.query(s,a)).rows;
const value = async (s,a=[]) => { const rows=await q(s,a); return rows.length?Object.values(rows[0])[0]:undefined; };
let passed = 0;
async function actor(n=null, role='authenticated', anonymous=false) {
 await db.exec('reset role');
 await q("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[n?id(n):'',JSON.stringify({is_anonymous:anonymous})]);
 await db.exec(`set role ${role}`);
}
async function admin(s,a=[]) { await db.exec('reset role'); return value(s,a); }
async function test(name,fn) { await fn(); passed++; console.log('PASS '+name); }
const get = (r=null) => value('select public.get_uci_rider_tracker($1)',[r===null?null:id(r)]);
const parentGet = (r=null) => value('select public.get_parent_uci_rider_tracker($1)',[r===null?null:id(r)]);
const entry = (r=2,e=100,data={},v=0,category='men_elite') => value('select public.save_uci_event_entry($1,$2,$3,$4,$5)',[id(r),id(e),category,data,v]);
const result = (r=2,e=100,data={},v=0,category='men_elite') => value('select public.save_uci_rider_result($1,$2,$3,$4,$5)',[id(r),id(e),category,{event_date:'2026-06-15',...data},v]);
const conflict = err => err.code==='40001' && err.hint==='reload_latest';
(async()=>{ try {
 await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema private; create schema auth;
  grant usage on schema public,auth to anon,authenticated;
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
  create table profiles(id uuid primary key,role text,display_name text,uci_id text);
  create table coach_athletes(coach_id uuid,athlete_id uuid);
  create table parent_athletes(parent_id uuid,athlete_id uuid,primary key(parent_id,athlete_id));
  create table dashboard_items(id uuid primary key,owner_id uuid,created_by uuid,item_type text,title text,details text,due_at timestamptz,end_at timestamptz,
   completed boolean default false,uci_schedule_date_only boolean default false,uci_schedule_status text);
  create table private.rider_feature_access(athlete_id uuid primary key,features_disabled boolean default false);
  create table private.rider_recovery_states(athlete_id uuid primary key,enabled boolean default false);
  create function private.rider_recovery_active(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from private.rider_recovery_states where athlete_id=p_id and enabled)$$;
  create table private.uci_schedule_state(id integer primary key,rankings jsonb);
  create table scoring_records(rider_id uuid,points integer);
  create table event_attendees(event_id uuid,rider_id uuid);
  create table run_plans(id uuid,event_id uuid,rider_id uuid);
  insert into profiles values
   ('${id(1)}','coach','Coach',null),('${id(2)}','athlete','German rider','10000000001'),('${id(3)}','athlete','Australian rider','10000000002'),
   ('${id(4)}','athlete','Other coach rider',null),('${id(5)}','athlete','Recovering rider',null),('${id(6)}','athlete','Disabled rider',null),
   ('${id(7)}','coach','Other coach',null),('${id(8)}','parent','Parent',null),('${id(9)}','admin','Admin without link',null),('${id(10)}','athlete','Unknown UCI rider',null),
   ('${id(11)}','parent','Other parent',null),('${id(12)}','parent','Parent without children',null);
  insert into coach_athletes values('${id(1)}','${id(2)}'),('${id(1)}','${id(3)}'),('${id(1)}','${id(5)}'),('${id(1)}','${id(6)}'),('${id(1)}','${id(10)}'),('${id(7)}','${id(4)}');
  insert into parent_athletes values('${id(8)}','${id(2)}'),('${id(8)}','${id(3)}'),('${id(8)}','${id(5)}'),('${id(8)}','${id(6)}'),('${id(11)}','${id(4)}');
  insert into private.rider_recovery_states values('${id(5)}',true);
  insert into private.rider_feature_access values('${id(6)}',true);
  insert into private.uci_schedule_state values(1,jsonb_build_object('checkedAt',now(),'categories',jsonb_build_object(
   'men',jsonb_build_object('rows',jsonb_build_array(jsonb_build_object('uciId','10000000001','points',100))),
   'women',jsonb_build_object('rows',jsonb_build_array(jsonb_build_object('uciId','10000000002','points',50))))));
  insert into dashboard_items(id,owner_id,created_by,item_type,title,details,due_at,end_at,completed) values
   ('${id(100)}','${id(1)}','${id(1)}','event','Future Open','Public event metadata',now()+interval '10 days',now()+interval '11 days',false),
   ('${id(101)}','${id(1)}','${id(1)}','event','Past Open','Private past event metadata','2026-06-15','2026-06-16',true),
   ('${id(102)}','${id(1)}','${id(1)}','task','Private task','Not an event',now(),null,false),
   ('${id(103)}','${id(2)}','${id(2)}','event','Own Past Open','Own past event metadata','2026-06-15','2026-06-16',true),
   ('${id(104)}',null,'${id(1)}','event','Legacy Past Open','Null owner, still private past','2026-06-15','2026-06-16',true);
  insert into scoring_records values('${id(2)}',123);
  insert into event_attendees values('${id(100)}','${id(2)}');
  insert into run_plans values('${id(200)}','${id(100)}','${id(2)}');
 `);
 await db.exec(sql);
 await db.exec(parentSql);
 await test('authentication and account gates deny anonymous, parent, disabled and recovery actors',async()=>{
  for(const n of [null,8,5,6]) {await actor(n);await assert.rejects(get(),e=>e.code==='42501');await assert.rejects(entry(n||2),e=>e.code==='42501');}
  await actor(2,'anon');await assert.rejects(get(),/permission denied/);
  await actor(2,'authenticated',true);await assert.rejects(get(),e=>e.code==='42501');
 });
 await test('rider and assigned-coach reads are scoped, including admins and zero-linked coaches',async()=>{
  await actor(2);let d=await get();assert.equal(d.canManage,false);assert.deepEqual(d.riders.map(r=>r.id),[id(2)]);
  await assert.rejects(get(3),e=>e.code==='42501');await assert.rejects(entry(3),e=>e.code==='42501');
  await actor(1);d=await get();assert.equal(d.canManage,true);assert.equal(d.riders.length,5);assert(!d.riders.some(r=>r.id===id(4)));
  await assert.rejects(get(4),e=>e.code==='42501');await assert.rejects(entry(4),e=>e.code==='42501');
  await actor(9);assert.equal((await get()).riders.length,0);await assert.rejects(get(2),e=>e.code==='42501');
 });
 await test('only RPCs are callable; private storage, audit, helpers and scoring stay inaccessible',async()=>{
  await actor(2);
  for(const s of ['select * from private.uci_rider_records','select * from private.uci_rider_record_audit','select private.uci_tracker_actor()',"select private.uci_tracker_authorize('"+id(2)+"')",'select * from scoring_records']) await assert.rejects(q(s),/permission denied/);
  const functions=await admin("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('get_uci_rider_tracker','save_uci_event_entry','save_uci_rider_result') and not p.prosecdef");assert.equal(functions,3);
 });
 await test('event catalogue returns bounded metadata and hides unrelated historical/private items from riders',async()=>{
  await actor(2);const d=await get();assert.deepEqual(d.events.map(e=>e.id).sort(),[id(100),id(103)]);assert(d.events.every(e=>!('image_data_url'in e)&&!('owner_id'in e)));
  await assert.rejects(entry(2,101),e=>e.code==='42501');await assert.rejects(entry(2,104),e=>e.code==='42501');
  await assert.rejects(entry(2,102),/existing event/);await assert.rejects(entry(2,999),/existing event/);
  await actor(1);assert.equal((await get()).events.length,4);
 });
 let first;
 await test('queued duplicate new entry requests create one record and replay one immutable receipt',async()=>{
  await actor(2);const responses=await Promise.all([entry(),entry(),entry()]);first=responses[0];assert.equal(first.version,1);assert.equal(first.replayed,false);
  assert(responses.every(r=>r.id===first.id));assert.equal(responses.filter(r=>r.replayed).length,2);
  assert.equal(first.deadline_at,null);assert.equal(first.deadline_timezone,null);
  assert.equal(await admin('select count(*) from private.uci_rider_records'),1);assert.equal(await admin('select count(*) from private.uci_rider_record_audit'),1);
 });
 await test('optimistic versions preserve updates and reject stale conflicting first-save or edit requests',async()=>{
  await actor(2);await assert.rejects(entry(2,100,{note:'stale create'},0),conflict);
  const changed=await entry(2,100,{status:'submitted',licence_checked:true,note:'My entry'},1);assert.equal(changed.version,2);
  await actor(1);await assert.rejects(entry(2,100,{status:'confirmed'},1),conflict);
  const confirmed=await entry(2,100,{status:'confirmed',note:'Coach confirmation'},2);assert.equal(confirmed.version,3);
  await actor(2);const receipt=await entry(2,100,{status:'submitted',licence_checked:true,note:'My entry'},1);
  assert.equal(receipt.replayed,true);assert.equal(receipt.version,2);assert.equal(receipt.current_version,3);assert.equal((await get()).entries[0].note,'Coach confirmation');
 });
 await test('authorization is rechecked before retry receipts, and coaches can manage recovering riders',async()=>{
  await actor(1);await entry(5,100,{note:'Recovery planning only'});
  await admin('delete from coach_athletes where coach_id=$1 and athlete_id=$2',[id(1),id(2)]);
  await actor(1);await assert.rejects(entry(2,100,{status:'confirmed',note:'Coach confirmation'},2),e=>e.code==='42501');assert(!(await get()).entries.some(e=>e.rider_id===id(2)));
  await db.exec('reset role');await q('insert into coach_athletes values($1,$2)',[id(1),id(2)]);
 });
 await test('deadline conversion stores explicit UTC and preserves the organiser local wall time',async()=>{
  await actor(3);const data={deadline_local:'2027-06-01T19:30',deadline_timezone:'Australia/Brisbane',deadline_source_url:'https://organiser.example/entries'};
  const d=await entry(3,100,data,0,'women_elite');assert.equal(d.deadline_local,'2027-06-01T19:30');assert.equal(d.deadline_offset,'+10:00');assert.equal(new Date(d.deadline_at).toISOString(),'2027-06-01T09:30:00.000Z');
  const retry=await entry(3,100,data,0,'women_elite');assert.equal(retry.replayed,true);
  await assert.rejects(entry(3,100,{deadline_local:'2027-06-01T19:30',deadline_timezone:'Not/AZone'},1,'women_elite'),/IANA timezone/);
 });
 await test('DST gaps and ambiguous times fail safely; explicit organiser offsets resolve ambiguity',async()=>{
  await actor(10);
  await assert.rejects(entry(10,100,{deadline_local:'2027-03-28T02:30',deadline_timezone:'Europe/Berlin'}),/does not exist/);
  await assert.rejects(entry(10,100,{deadline_local:'2027-10-31T02:30',deadline_timezone:'Europe/Berlin'}),e=>e.hint==='deadline_offset_required');
  let d=await entry(10,100,{deadline_local:'2027-10-31T02:30',deadline_timezone:'Europe/Berlin',deadline_offset:'+02:00'});assert.equal(new Date(d.deadline_at).toISOString(),'2027-10-31T00:30:00.000Z');
  d=await entry(10,100,{deadline_local:'2027-10-31T02:30',deadline_timezone:'Europe/Berlin',deadline_offset:'+01:00'},1);assert.equal(new Date(d.deadline_at).toISOString(),'2027-10-31T01:30:00.000Z');
  await assert.rejects(entry(10,100,{deadline_local:'2027-10-31T02:30',deadline_timezone:'Europe/Berlin',deadline_offset:'+03:00'},2),/does not exist/);
  d=await entry(10,100,{},2);assert.equal(d.deadline_at,null);assert.equal(d.deadline_offset,null);
 });
 await test('entry payload validation rejects injected identity, invalid checklist and unsafe evidence fields',async()=>{
  await actor(10);
  for(const data of [{rider_id:id(3)},{licence_checked:'true'},{status:'awarded'},{note:'x'.repeat(2001)},{deadline_source_url:'javascript:alert(1)'},{deadline_source_url:'https://user:password@example.com/private'},{deadline_timezone:'Europe/Berlin'}]) await assert.rejects(entry(10,100,data,3));
  await assert.rejects(entry(10,100,{},null),conflict);await assert.rejects(entry(10,100,{},3,'open'),/Choose Men Elite/);
 });
 let pending;
 await test('pending results preserve unknown points without affecting scores or granting rider verification',async()=>{
  await actor(2);pending=await result();assert.equal(pending.points,null);assert.equal(pending.reviewed_by,null);assert.equal(pending.status,'pending');
  await assert.rejects(result(2,100,{status:'verified',points:250,evidence_url:'https://www.uci.org/results'},1),e=>e.code==='42501');
  assert.equal(await admin('select sum(points) from scoring_records'),123);assert.equal(await admin('select count(*) from event_attendees'),1);assert.equal(await admin('select count(*) from run_plans'),1);
 });
 await test('coach verification requires known points and official evidence and records reviewer provenance',async()=>{
  await actor(1);await assert.rejects(result(2,100,{status:'verified',points:250},1),/verification needs/);await assert.rejects(result(2,100,{status:'verified',evidence_url:'https://www.uci.org/results'},1),/verification needs/);
  const r=await result(2,100,{status:'verified',points:250,place:3,evidence_url:'https://www.uci.org/results',note:'Checked official PDF'},1);assert.equal(r.version,2);assert.equal(r.reviewed_by,id(1));assert(r.reviewed_at);
  await actor(2);await assert.rejects(result(2,100,{points:300},2),e=>e.code==='42501');
  const retry=await result();assert.equal(retry.replayed,true);assert.equal(retry.status,'pending');assert.equal(retry.current_version,2);assert.equal((await get()).results[0].status,'verified');
 });
 await test('review decisions are audited and can be explicitly returned to pending by the assigned coach',async()=>{
  await actor(1);const r=await result(2,100,{points:250,note:'Awaiting corrected results'},2);assert.equal(r.version,3);assert.equal(r.reviewed_by,null);assert.equal(r.reviewed_at,null);
  const changes=await admin('select count(*) from private.uci_rider_record_audit where record_id=$1',[r.id]);assert.equal(changes,3);
  await actor(2);const corrected=await result(2,100,{points:240,note:'Corrected result submitted'},3);assert.equal(corrected.version,4);
 });
 await test('result data rejects unsupported counting claims, fabricated numbers and future result dates',async()=>{
  await actor(2);
  for(const data of [{status:'counted'},{status:'expired'},{points:-1},{points:'200'},{place:1.5},{place:0},{evidence_url:'http://www.uci.org/results'},{event_date:'2099-01-01'},{note:'x'.repeat(2001)},{reviewed_by:id(1)}]) await assert.rejects(result(2,100,data,4));
  const r=await result(2,100,{points:0,place:4},4);assert.equal(r.points,0);assert.equal(r.place,4);
 });
 await test('exact verified UCI identity enforces category; unknown identities remain explicitly selectable',async()=>{
  await actor(2);await assert.rejects(entry(2,103,{},0,'women_elite'),/category does not match/);
  await actor(3);await assert.rejects(entry(3,100,{},0,'men_elite'),/category does not match/);
  await actor(1);const d=await entry(10,101,{},0,'women_elite');assert.equal(d.category,'women_elite');
  await admin("update private.uci_schedule_state set rankings=jsonb_set(rankings,'{checkedAt}',to_jsonb((now()-interval '20 days')::text))");
  await actor(2);const e=await entry(2,103,{},0,'women_elite');assert.equal(e.category,'women_elite');
 });
 await test('saved historical events remain readable; unrelated riders cannot see saved history',async()=>{
  await actor(1);await result(2,101,{points:10});
  await actor(2);assert((await get()).events.some(e=>e.id===id(101)));await entry(2,101,{note:'Historic entry'});
  await actor(3);assert(!(await get()).events.some(e=>e.id===id(101)));assert(!(await get()).results.some(r=>r.rider_id===id(2)));
 });
 await test('event deletion/merge preserves snapshots and editing; creating new orphan records is refused',async()=>{
  await admin('delete from dashboard_items where id=$1',[id(101)]);
  await actor(2);const d=await get();const old=d.events.find(e=>e.id===id(101));assert.equal(old.unavailable,true);assert.equal(old.title,'Past Open');
  let r=d.results.find(r=>r.event_id===id(101));r=await result(2,101,{points:10,note:'Preserved after event merge'},r.version);assert.equal(r.event_title,'Past Open');
  await actor(1);await assert.rejects(result(3,101,{points:20},0,'women_elite'),/existing event/);
 });
 await test('withdrawn entries retain history and can be reopened without creating duplicates',async()=>{
  await actor(2);let d=(await get()).entries.find(e=>e.event_id===id(100));
  const closed=await entry(2,100,{status:'withdrawn',note:'No longer attending'},d.version);assert.equal(closed.status,'withdrawn');
  const reopened=await entry(2,100,{status:'planning'},closed.version);assert.equal(reopened.id,closed.id);assert.equal(reopened.version,closed.version+1);
 });
 await test('all stored revisions retain immutable before/after records and never change JKC totals',async()=>{
  const bad=await admin('select count(*) from private.uci_rider_record_audit where request_payload is null or after_record is null or (expected_version>0 and before_record is null)');assert.equal(bad,0);
  assert.equal(await admin('select sum(points) from scoring_records'),123);
  assert.equal(await admin('select count(*) from dashboard_items'),4);assert.equal(await admin('select count(*) from event_attendees'),1);
  assert.equal(await admin('select count(*) from private.uci_rider_records where version<1'),0);
 });
 await test('parent reader requires a current parent profile and nonanonymous authenticated session',async()=>{
  for(const n of [null,1,2,7,9,99]) {await actor(n);await assert.rejects(parentGet(),e=>e.code==='42501');}
  await actor(8,'anon');await assert.rejects(parentGet(),/permission denied/);
  await assert.rejects(value('select private.get_parent_uci_rider_tracker(null)'),/permission denied/);
  await actor(8,'authenticated',true);await assert.rejects(parentGet(),e=>e.code==='42501');
  await actor(8);assert.equal((await parentGet()).readOnly,true);
  await admin("update profiles set role='athlete' where id=$1",[id(8)]);
  await actor(8);await assert.rejects(parentGet(),e=>e.code==='42501');
  await admin("update profiles set role='parent' where id=$1",[id(8)]);
 });
 await test('parent can read both linked children but not unrelated children, coach records or restricted riders',async()=>{
  await actor(7);await entry(4,100,{note:'Other family private entry'});
  await actor(1);await entry(6,100,{note:'Disabled rider private entry'});
  await actor(8);const d=await parentGet();assert.equal(d.canManage,false);assert.equal(d.readOnly,true);
  assert.deepEqual(d.riders.map(r=>r.id).sort(),[id(2),id(3)]);
  assert(d.entries.length>0&&d.results.length>0);
  assert(d.entries.concat(d.results).every(r=>[id(2),id(3)].includes(r.rider_id)));
  for(const n of [1,4,5,6,10,99])await assert.rejects(parentGet(n),e=>e.code==='42501');
  const child=await parentGet(3);assert.deepEqual(child.riders.map(r=>r.id),[id(3)]);
  assert(child.entries.every(r=>r.rider_id===id(3)));assert(child.results.every(r=>r.rider_id===id(3)));
  await actor(11);const other=await parentGet();assert.deepEqual(other.riders.map(r=>r.id),[id(4)]);
  assert.equal(other.entries[0].note,'Other family private entry');await assert.rejects(parentGet(2),e=>e.code==='42501');
 });
 await test('parent sees shared upcoming events and only child-specific saved history without media or owner data',async()=>{
  await admin("insert into dashboard_items(id,owner_id,created_by,item_type,title,details,due_at,end_at) values($1,$2,$2,'event','Next shared event','Event location',now()+interval '20 days',now()+interval '21 days')",[id(105),id(7)]);
  await actor(8);const d=await parentGet();assert.deepEqual(d.events.map(e=>e.id).sort(),[id(100),id(101),id(103),id(105)]);
  assert.equal(d.events.find(e=>e.id===id(101)).unavailable,true);assert.equal(d.events.find(e=>e.id===id(101)).title,'Past Open');
  assert(d.events.every(e=>!('image_data_url'in e)&&!('owner_id'in e)&&!('created_by'in e)));
  assert.equal(d.events.filter(e=>e.id===id(100)).length,1,'Shared event metadata is not duplicated across children');
  assert.deepEqual((await parentGet(3)).events.map(e=>e.id).sort(),[id(100),id(105)],'Selecting one child retains shared upcoming events but excludes sibling-specific historic events');
  await db.exec('begin read only');assert.equal((await parentGet()).readOnly,true);await db.exec('commit');
 });
 await test('parents without eligible linked children receive an empty read-only tracker',async()=>{
  await actor(12);assert.deepEqual(await parentGet(),{canManage:false,readOnly:true,riders:[],events:[],entries:[],results:[]});
  await assert.rejects(parentGet(2),e=>e.code==='42501');
 });
 await test('unlinking and child account restrictions revoke parent reads immediately',async()=>{
  await admin('delete from parent_athletes where parent_id=$1 and athlete_id=$2',[id(8),id(2)]);
  await actor(8);assert.deepEqual((await parentGet()).riders.map(r=>r.id),[id(3)]);await assert.rejects(parentGet(2),e=>e.code==='42501');
  await admin('insert into parent_athletes values($1,$2)',[id(8),id(2)]);
  await admin('insert into private.rider_recovery_states values($1,true)',[id(2)]);
  await actor(8);assert(!(await parentGet()).riders.some(r=>r.id===id(2)));await assert.rejects(parentGet(2),e=>e.code==='42501');
  await admin('delete from private.rider_recovery_states where athlete_id=$1',[id(2)]);
  await admin('insert into private.rider_feature_access values($1,true)',[id(3)]);
  await actor(8);assert.deepEqual((await parentGet()).riders.map(r=>r.id),[id(2)]);await assert.rejects(parentGet(3),e=>e.code==='42501');
  await admin('delete from private.rider_feature_access where athlete_id=$1',[id(3)]);
  await admin("update profiles set role='coach' where id=$1",[id(3)]);
  await actor(8);assert.deepEqual((await parentGet()).riders.map(r=>r.id),[id(2)]);await assert.rejects(parentGet(3),e=>e.code==='42501');
  await admin("update profiles set role='athlete' where id=$1",[id(3)]);
  await actor(8);assert.equal((await parentGet()).riders.length,2);
 });
 await test('parent own disabled or recovery account restrictions are also enforced',async()=>{
  await admin('insert into private.rider_feature_access values($1,true)',[id(8)]);
  await actor(8);await assert.rejects(parentGet(),e=>e.code==='42501');
  await admin('delete from private.rider_feature_access where athlete_id=$1',[id(8)]);
  await admin('insert into private.rider_recovery_states values($1,true)',[id(8)]);
  await actor(8);await assert.rejects(parentGet(),e=>e.code==='42501');
  await admin('delete from private.rider_recovery_states where athlete_id=$1',[id(8)]);
 });
 await test('parent read permission never grants writes, verification, audit access or original rider RPC access',async()=>{
  const beforeRecords=await admin('select count(*) from private.uci_rider_records');const beforeAudit=await admin('select count(*) from private.uci_rider_record_audit');
  await actor(8);await assert.rejects(get(2),e=>e.code==='42501');
  await assert.rejects(entry(2,100,{note:'Forged parent edit'}),e=>e.code==='42501');
  await assert.rejects(result(2,100,{points:999,status:'verified',evidence_url:'https://www.uci.org/results'}),e=>e.code==='42501');
  await assert.rejects(value('select private.save_uci_event_entry($1,$2,$3,$4,$5)',[id(2),id(100),'men_elite',{},0]),e=>e.code==='42501');
  for(const sql of ['select * from private.uci_rider_records','select * from private.uci_rider_record_audit',"update private.uci_rider_records set payload='{}'",'delete from private.uci_rider_records','select private.uci_parent_tracker_riders(null)'])await assert.rejects(q(sql),/permission denied/);
  assert.equal(await admin('select count(*) from private.uci_rider_records'),beforeRecords);assert.equal(await admin('select count(*) from private.uci_rider_record_audit'),beforeAudit);
 });
 await test('new public RPC is invoker-only, private reader has pinned search path, and tables stay protected',async()=>{
  const f=await admin("select jsonb_agg(jsonb_build_object('schema',n.nspname,'definer',p.prosecdef,'config',p.proconfig)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname='get_parent_uci_rider_tracker'");
  assert.equal(f.find(v=>v.schema==='public').definer,false);assert.equal(f.find(v=>v.schema==='private').definer,true);
  assert(f.every(v=>v.config.some(c=>c.startsWith('search_path='))));
  assert.equal(await admin("select has_function_privilege('anon','public.get_parent_uci_rider_tracker(uuid)','EXECUTE')"),false);
  assert.equal(await admin("select has_function_privilege('anon','private.get_parent_uci_rider_tracker(uuid)','EXECUTE')"),false);
  assert.equal(await admin("select has_table_privilege('authenticated','private.uci_rider_records','SELECT')"),false);
  assert.equal(await admin("select relrowsecurity from pg_class where oid='private.uci_rider_records'::regclass"),true);
  await actor(2);assert.equal((await get()).canManage,false);await actor(1);assert.equal((await get()).canManage,true);
  assert.equal(await admin('select sum(points) from scoring_records'),123);
 });
 console.log(`\n${passed} tracker database checks passed.`);
 } finally {await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
