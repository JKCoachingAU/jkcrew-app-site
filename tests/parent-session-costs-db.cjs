// Isolated real-SQL checks using synthetic families. Never touches live data.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PGlite } = require(process.env.JKCREW_PGLITE_PATH || '@electric-sql/pglite');
const migrationName = '20261105215527_add_parent_session_costs.sql';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function run(options = {}) {
  const db = new PGlite(); let checks=0;
  const q = async(sql,args=[]) => (await db.query(sql,args)).rows;
  const scalar = async(sql,args=[]) => Object.values((await q(sql,args))[0])[0];
  const eq = (a,b,label) => {assert.deepEqual(a,b,label);checks++;};
  const ok = (value,label) => {assert(value,label);checks++;};
  const denied = async(fn,re,label) => {await assert.rejects(fn,re,label);checks++;};
  const migrate = name => db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',name),'utf8'));
  const actor = async(n,role='authenticated',anonymous=false) => {
    await db.exec('reset role');
    await q("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[n?id(n):'',JSON.stringify({is_anonymous:anonymous})]);
    await db.exec(`set role ${role}`);
  };
  const inspect = async fn => {
    const role = await scalar('select current_user'); await db.exec('reset role');
    try{return await fn();}finally{await db.exec(`set role ${role}`);}
  };
  const block = n => scalar('select public.save_coach_training_block($1,$2,$3)',[id(n),'Term 4','2026-11-02']);
  const save = (n,fields={},version=null) => scalar('select public.save_coach_tracked_session_v3($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',[
    n===null?null:id(n),fields.date||'2026-11-02',fields.time||null,fields.venue||'Pizzey',fields.riders===undefined?[id(2),id(3)]:fields.riders,version,
    fields.block===undefined?id(100):fields.block===null?null:id(fields.block),fields.park===undefined?1250:fields.park,
    fields.basis===undefined?'per_rider':fields.basis,fields.kind===undefined?'regular':fields.kind,
    fields.completed===undefined?false:fields.completed,fields.extra===undefined?null:fields.extra,
    fields.paid===undefined?false:fields.paid,fields.invoiceDate===undefined?null:fields.invoiceDate,
    fields.status===undefined?'expected':fields.status,
  ]);
  const v2 = (n,fields={},version=null) => scalar('select public.save_coach_tracked_session_v2($1,$2,$3,$4,$5,$6,$7,$8,$9)',[
    id(n),fields.date||'2026-11-02',fields.time||null,fields.venue||'Pizzey',fields.riders||[id(2),id(3)],version,
    fields.block===null?null:id(fields.block||100),fields.park===undefined?1250:fields.park,fields.basis||'per_rider',
  ]);
  const v1 = (n,fields={},version=null) => scalar('select public.save_coach_tracked_session($1,$2,$3,$4,$5,$6)',[
    id(n),fields.date||'2026-11-02',fields.time||null,fields.venue||'Pizzey',fields.riders||[id(2),id(3)],version,
  ]);
  const costs = (child=2,offset=0,limit=100) => scalar('select public.get_parent_session_costs($1,$2,$3)',[child===null?null:id(child),offset,limit]);
  const archive = (n,archived,version) => scalar('select public.archive_coach_tracked_session($1,$2,$3)',[id(n),archived,version]);
  try{
    await db.exec(`
      create role anon;create role authenticated;create role service_role;
      create schema auth;create schema private;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
      grant usage on schema auth,public,private to anon,authenticated;
      grant execute on function auth.uid(),auth.jwt() to anon,authenticated;
      create type public.user_role as enum('coach','admin','athlete','parent');
      create table public.profiles(id uuid primary key,role public.user_role not null,display_name text,points integer default 0);
      create function private.current_user_role() returns public.user_role language sql stable security definer set search_path=public as $$select role from public.profiles where id=auth.uid()$$;
      grant execute on function private.current_user_role() to authenticated;
      alter table public.profiles enable row level security;
      create policy own on public.profiles for select to authenticated using(id=(select auth.uid()));
      create policy coach_read on public.profiles for select to authenticated using((select private.current_user_role()) in ('coach','admin'));
      grant select on public.profiles to authenticated;
      create table public.coach_athletes(coach_id uuid references profiles,athlete_id uuid references profiles,primary key(coach_id,athlete_id));
      alter table public.coach_athletes enable row level security;
      create policy coaching on public.coach_athletes for select to authenticated using(coach_id=auth.uid() or athlete_id=auth.uid());
      grant select on public.coach_athletes to authenticated;
      create table public.parent_athletes(parent_id uuid references profiles,athlete_id uuid references profiles,coach_id uuid references profiles,primary key(parent_id,athlete_id,coach_id));
      alter table public.parent_athletes enable row level security;
      create policy parent_links on public.parent_athletes for select to authenticated using(parent_id=auth.uid() or coach_id=auth.uid());
      grant select on public.parent_athletes to authenticated;
      create table public.coach_venues(id uuid primary key default gen_random_uuid(),coach_id uuid not null default auth.uid() references profiles,name text not null,sort_order integer not null default 0,created_at timestamptz default now(),updated_at timestamptz default now(),unique(coach_id,name));
      alter table public.coach_venues enable row level security;
      create policy venues on public.coach_venues for all to authenticated using(coach_id=auth.uid()) with check(coach_id=auth.uid());
      grant select,insert,update on public.coach_venues to authenticated;
      create table public.coach_group_sessions(id uuid primary key,coach_id uuid,status text);
      create table public.assignment_point_awards(id uuid primary key,athlete_id uuid,points integer);
      create table public.push_notification_queue(id uuid primary key,recipient_id uuid);
    `);
    await q("insert into profiles values($1,'coach','Coach A',0),($2,'athlete','Child A',10),($3,'athlete','Child B',20),($4,'coach','Coach B',0),($5,'athlete','Child C',30),($6,'parent','Parent A',0),($7,'admin','Admin',0),($8,'parent','Second Parent A',0),($9,'parent','Parent B',0),($10,'parent','No links',0),($11,'athlete','No sessions',0)",[1,2,3,4,5,6,7,8,9,10,11].map(id));
    for(const row of [[1,2],[1,3],[1,11],[4,2],[4,5],[7,2]])await q('insert into coach_athletes values($1,$2)',row.map(id));
    for(const row of [[6,2,1],[8,2,1],[9,3,1],[6,11,1],[6,5,1]])await q('insert into parent_athletes values($1,$2,$3)',row.map(id));
    await q("insert into coach_group_sessions values($1,$2,'running')",[id(80),id(1)]);
    await q('insert into assignment_point_awards values($1,$2,5)',[id(81),id(2)]);
    await q('insert into push_notification_queue values($1,$2)',[id(82),id(2)]);
    const untouched=['profiles','coach_group_sessions','assignment_point_awards','push_notification_queue'];
    const baseline=await Promise.all(untouched.map(table=>q(`select * from ${table} order by id`)));
    await migrate('20261103212528_add_coach_session_tracker.sql');
    await migrate('20261105213136_add_coach_training_blocks_and_park_fees.sql');
    await actor(1);await block(100);
    const old=await v2(190);
    await db.exec('reset role');
    const oldFunctions=await q("select proname,pg_get_functiondef(oid) def from pg_proc where pronamespace='public'::regnamespace and proname in ('save_coach_tracked_session','save_coach_tracked_session_v2') order by proname");
    await migrate(migrationName);
    eq(await q("select proname,pg_get_functiondef(oid) def from pg_proc where pronamespace='public'::regnamespace and proname in ('save_coach_tracked_session','save_coach_tracked_session_v2') order by proname"),oldFunctions,'Both cached-client RPC definitions are unchanged');
    eq(await scalar("select prosecdef from pg_proc where oid='public.get_parent_session_costs(uuid,integer,integer)'::regprocedure"),false,'Public projection wrapper is invoker');
    eq(await scalar("select prosecdef from pg_proc where oid='private.parent_session_costs(uuid,integer,integer)'::regprocedure"),true,'Only minimal private projection is definer');
    eq(await scalar("select count(*)::int from pg_proc where proname in ('validate_coach_tracked_session_costs','save_coach_tracked_session_v3','get_parent_session_costs','parent_session_costs') and not coalesce(proconfig @> array['search_path=\"\"'],false)"),0,'All new functions pin search_path');
    await actor(1);
    const migrated=await scalar('select to_jsonb(s) from coach_tracked_sessions s where id=$1',[id(190)]);
    const defaults={session_kind:'regular',session_completed:false,extra_fee_cents:null,park_fee_paid_by_coach:false,invoice_date:null,invoice_status:'expected'};
    eq(migrated,{...old,...defaults},'Existing records and versions survive with safe financial defaults');
    const regular=await save(200,{date:'2026-11-03'});
    eq(regular.session_completed,false,'Past dates never imply completed attendance');
    eq(regular.extra_fee_cents,null,'Regular sessions have no extra-session fee');
    let additional=await save(201,{kind:'additional',completed:true,extra:3000,paid:true,invoiceDate:'2026-11-09'});
    eq(additional.extra_fee_cents,3000);eq(additional.park_fee_paid_by_coach,true);
    eq(await save(201,{kind:'additional',completed:true,extra:3000,paid:true,invoiceDate:'2026-11-09'}),additional,'Lost create response retry never duplicates costs');
    const prior=additional;
    additional=await save(201,{kind:'additional',completed:true,extra:3000,paid:true,invoiceDate:'2026-11-09',status:'invoiced'},prior.updated_at);
    eq(additional.invoice_status,'invoiced');
    eq(await save(201,{kind:'additional',completed:true,extra:3000,paid:true,invoiceDate:'2026-11-09',status:'invoiced'},prior.updated_at),additional,'Lost invoice-update response retry is safe');
    await denied(()=>save(201,{kind:'additional',extra:4000},prior.updated_at),/has changed/i);
    const preservedFields=['session_kind','session_completed','extra_fee_cents','park_fee_paid_by_coach','invoice_date','invoice_status'];
    const pick=row=>Object.fromEntries(preservedFields.map(k=>[k,row[k]]));
    const legacy2=await v2(201,{time:'16:00'},additional.updated_at);
    eq(pick(legacy2),pick(additional),'V2 editing preserves all new financial notes');
    const legacy1=await v1(201,{time:'17:00'},legacy2.updated_at);
    eq(pick(legacy1),pick(additional),'V1 editing preserves all new financial notes');
    eq(legacy1.park_fee_cents,1250,'V1 retains existing park fees');
    additional=legacy1;
    await denied(()=>v2(201,{park:0,time:'17:00'},additional.updated_at),/positive park fee/i,'Old clients cannot leave a paid zero-cost park fee');
    eq(await scalar('select to_jsonb(s) from coach_tracked_sessions s where id=$1',[id(201)]),additional,'Rejected legacy change retains all saved fees and invoice notes');
    const free=await save(202,{kind:'additional',extra:0,park:0});
    const tbc=await save(203,{kind:'additional',extra:null,park:0,date:'2026-11-04'});
    eq(free.extra_fee_cents,0,'Zero means explicitly free');eq(tbc.extra_fee_cents,null,'Null means fee still to be confirmed');
    await save(204,{basis:'session',park:1001,riders:[id(3),id(2),id(2)],completed:true});
    for(const fields of [{kind:null},{kind:'private'},{completed:null},{extra:-1,kind:'additional'},{extra:1000001,kind:'additional'},{extra:100},{paid:null},{park:0,paid:true},{invoiceDate:'infinity'},{invoiceDate:'-infinity'},{status:null},{status:'paid'}]) {
      await denied(()=>save(210,fields),/Choose|session fee|fees only|positive park fee|invoice/i);
    }
    await denied(()=>save(210,{extra:1.5,kind:'additional'}),/integer|invalid input/i);
    await denied(()=>save(210,{invoiceDate:'2026-02-30'}),/date\/time|out of range/i);
    await denied(()=>save(null),/identified/i);
    eq(await scalar('select count(*)::int from coach_tracked_sessions where id=$1',[id(210)]),0,'Rejected cost records leave no partial session');
    const max=await save(211,{kind:'additional',extra:1000000,park:0});eq(max.extra_fee_cents,1000000);
    await denied(()=>q("update coach_tracked_sessions set invoice_status='paid' where id=$1",[id(201)]),/Choose an expected or invoiced status/i);
    await denied(()=>q('update coach_tracked_sessions set extra_fee_cents=100 where id=$1',[id(200)]),/only apply/i);
    await denied(()=>q('update coach_tracked_sessions set park_fee_paid_by_coach=true where id=$1',[id(202)]),/positive park fee/i);
    const removed=await archive(202,true,free.updated_at);
    await denied(()=>save(202,{kind:'additional',extra:0,park:0},removed.updated_at),/removed/i);
    await actor(4);await block(110);
    await save(220,{block:110,riders:[id(2)],extra:9999,kind:'additional',venue:'Private other coach park'});
    await save(221,{block:110,riders:[id(5)],extra:9000,kind:'additional'});
    await actor(6);
    const parent=await costs();
    eq(await scalar('select private.parent_session_costs($1)',[id(2)]),parent,'Private-helper direct calls enforce the same linked-parent projection');
    eq(parent.hasMore,false);eq(parent.sessions.length,6,'Parent sees current own-coach child sessions only');
    ok(/^[a-f0-9]{32}$/.test(parent.snapshot),'Snapshot is an opaque hash, not private rows');
    eq(parent.sessions.map(s=>s.id).includes(id(202)),false,'Archived costs hidden');
    eq(parent.sessions.map(s=>s.id).includes(id(220)),false,'Same child with another coach is not exposed without matching coach link');
    eq(parent.sessions.find(s=>s.id===id(201)).extra_fee_cents,3000,'Additional cost is per-child, not coach-wide total');
    eq(parent.sessions.find(s=>s.id===id(203)).extra_fee_cents,null,'TBC survives parent projection');
    eq(parent.sessions.find(s=>s.id===id(200)).park_fee_cents,1250,'Per-rider park fee stays per rider');
    eq(parent.sessions.find(s=>s.id===id(204)).park_fee_cents,501,'First sorted child gets odd shared-cent remainder');
    eq(parent.sessions.find(s=>s.id===id(204)).park_fee_allocation,'shared');
    eq(parent.sessions.find(s=>s.id===id(200)).park_fee_allocation,'per_rider');
    const expectedKeys=['id','session_date','start_time','venue','block_id','block_name','block_start_date','session_kind','session_completed','park_fee_cents','park_fee_allocation','extra_fee_cents','park_fee_paid_by_coach','invoice_date','invoice_status'].sort();
    for(const row of parent.sessions)eq(Object.keys(row).sort(),expectedKeys,'Projection never includes other riders, counts, coach IDs or raw totals');
    eq(await scalar('select count(*)::int from coach_tracked_sessions'),0,'Parent cannot read raw session rows');
    eq(await scalar('select count(*)::int from coach_training_blocks'),0,'Parent cannot read raw coach blocks');
    await denied(()=>save(230,{riders:[id(2)],block:null}),/Only coaches/i);
    await denied(()=>archive(201,true,additional.updated_at),/Only coaches/i);
    eq(await q('update coach_tracked_sessions set invoice_status=$1 where id=$2 returning id',['expected',id(201)]),[],'Parent direct updates target no rows under RLS');
    await denied(()=>costs(3),/not available/i,'Cannot read sibling not linked to this parent');
    await denied(()=>costs(5),/not available/i,'Parent link with wrong coach and no coaching link is insufficient');
    await denied(()=>costs(null),/not available/i);
    const empty=await costs(11);eq(empty.sessions,[],'Valid linked child with no sessions returns empty result');eq(empty.hasMore,false);
    for(const offset of [-1,100001])await denied(()=>costs(2,offset),/valid page/i);
    const page1=await costs(2,0,2),page2=await costs(2,2,2);
    eq(page1.sessions.length,2);eq(page1.hasMore,true);eq(page2.sessions.length,2);eq(page2.hasMore,true);
    eq(page1.snapshot,page2.snapshot,'Unchanged pages have one snapshot');eq(page1.snapshot,parent.snapshot);
    eq(new Set([...page1.sessions,...page2.sessions].map(s=>s.id)).size,4,'Offset pages do not overlap');
    eq([...page1.sessions,...page2.sessions].map(s=>s.id),parent.sessions.slice(0,4).map(s=>s.id),'Pagination has stable date-desc/id order');
    eq((await costs(2,4,2)).hasMore,false,'Last page has no lookahead');
    eq((await costs(2,999,2)).sessions,[],'Past last page remains empty');
    eq((await costs(2,0,0)).sessions.length,1,'Requested page size is bounded away from zero');
    eq((await costs(2,0,999999)).sessions,parent.sessions,'Oversized limit is clamped');
    await actor(8);eq(await costs(),parent,'Two linked parents can each read the same child costs');
    await actor(9);const otherChild=await costs(3);
    await denied(()=>scalar('select private.parent_session_costs($1)',[id(2)]),/not available/i,'Private-helper direct calls cannot bypass child linkage');
    eq(otherChild.sessions.find(s=>s.id===id(204)).park_fee_cents,500,'Other child gets remaining whole-cent shared fee');
    eq(otherChild.sessions.find(s=>s.id===id(204)).park_fee_cents+parent.sessions.find(s=>s.id===id(204)).park_fee_cents,1001,'Shared fees never get charged in full to every child');
    await actor(6,'authenticated',true);
    await denied(()=>costs(),/Sign in as a linked parent/i,'Anonymous sessions cannot use the definer projection');
    for(const n of [1,2,4,7,10]){await actor(n);await denied(()=>costs(),/Sign in as a linked parent|not available/i,'Coach/rider/admin/unlinked parent cannot impersonate child read');}
    await actor(null,'anon');await denied(()=>costs(),/permission denied/i);await denied(()=>scalar('select private.parent_session_costs($1)',[id(2)]),/permission denied/i);
    await actor(null);await denied(()=>costs(),/Sign in as a linked parent/i);
    await actor(6);
    await inspect(()=>q('delete from parent_athletes where parent_id=$1 and athlete_id=$2',[id(6),id(2)]));
    await denied(()=>costs(2,2,2),/not available/i,'Removing parent link revokes later pages immediately');
    await inspect(()=>q('insert into parent_athletes values($1,$2,$3)',[id(6),id(2),id(1)]));
    await inspect(()=>q('delete from coach_athletes where coach_id=$1 and athlete_id=$2',[id(1),id(2)]));
    await denied(()=>costs(),/not available/i,'Removing coach link revokes the parent projection');
    await inspect(()=>q('insert into coach_athletes values($1,$2)',[id(1),id(2)]));
    await inspect(()=>q("update profiles set role='parent' where id=$1",[id(2)]));
    await denied(()=>costs(),/not available/i,'Target must still be an athlete');
    await inspect(()=>q("update profiles set role='athlete' where id=$1",[id(2)]));
    await inspect(()=>q("update profiles set role='athlete' where id=$1",[id(1)]));
    await denied(()=>costs(),/not available/i,'Source owner must still be a coach or admin');
    await inspect(()=>q("update profiles set role='coach' where id=$1",[id(1)]));
    const beforeEdit=(await costs(2,0,2)).snapshot;
    await actor(1);
    additional=await save(201,{date:'2026-11-05',time:'17:00',kind:'additional',completed:true,extra:3000,paid:true,invoiceDate:'2026-11-09',status:'invoiced'},additional.updated_at);
    await actor(6);
    const afterEdit=(await costs(2,2,2)).snapshot;
    ok(afterEdit!==beforeEdit,'Date changes between pages invalidate the snapshot');
    await actor(1);
    const blockVersion=await scalar('select updated_at::text from coach_training_blocks where id=$1',[id(100)]);
    await scalar('select public.save_coach_training_block($1,$2,$3,$4)',[id(100),'Renamed term','2026-11-02',blockVersion]);
    await actor(6);
    const afterRename=(await costs()).snapshot;
    ok(afterRename!==afterEdit,'Block display edits invalidate previously loaded parent pages');
    await actor(1);await archive(190,true,migrated.updated_at);
    await actor(6);const beforeBulk=(await costs()).snapshot;
    ok(beforeBulk!==afterRename,'Archiving a row invalidates offset-page snapshots');
    await actor(1);
    await q("insert into coach_tracked_sessions(id,session_date,venue,rider_ids) select ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'2026-12-01'::date,'Synthetic Park',array[$1::uuid] from generate_series(10000,10104) i",[id(2)]);
    await actor(6);
    const capped=await costs(2,0,999999);
    eq(capped.sessions.length,100,'Real 105+ row fixture proves the server limits every page to 100');
    eq(capped.hasMore,true,'Server returns lookahead instead of silently truncating');
    ok(capped.snapshot!==beforeBulk,'New rows invalidate the snapshot');
    const capRemainder=await costs(2,100,100);
    eq(capRemainder.sessions.length,10,'Final page returns all remaining authorized rows');
    eq(capRemainder.hasMore,false);eq(capRemainder.snapshot,capped.snapshot);
    const after=await inspect(()=>Promise.all(untouched.map(table=>q(`select * from ${table} order by id`))));
    eq(after,baseline,'Cost planning does not alter points, live sessions, notifications or accounts');
    console.log(`PASS: ${checks} parent session-cost SQL checks: private child projection, link revocation, shared cents, cached-client preservation and invoice notes.`);
    if(options.afterChecks)await options.afterChecks({db,q,scalar,actor,inspect,save,v1,v2,costs,migrate});
  }finally{await db.close();}
}
if(require.main===module)run()
  .then(()=>require('./session-tracker-blocks-db.cjs').run(migrationName))
  .then(()=>require('./session-tracker-db.cjs').run([require('./session-tracker-blocks-db.cjs').migrationName,migrationName]))
  .catch(error=>{console.error(error.stack,error.where||'');process.exitCode=1;});
module.exports={run,migrationName};
