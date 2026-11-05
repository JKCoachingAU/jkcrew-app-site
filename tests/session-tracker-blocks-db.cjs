// Real SQL in isolated PGlite. No production connections or private rider data.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PGlite } = require(process.env.JKCREW_PGLITE_PATH || '@electric-sql/pglite');
const migrationName = '20261105213136_add_coach_training_blocks_and_park_fees.sql';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function run() {
  const db = new PGlite();
  let checks = 0;
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const scalar = async (sql, args = []) => Object.values((await q(sql, args))[0])[0];
  const eq = (a,b,label) => { assert.deepEqual(a,b,label); checks++; };
  const ok = (a,label) => { assert(a,label); checks++; };
  const denied = async (fn,re,label) => { await assert.rejects(fn,re,label); checks++; };
  const actor = async (n,role='authenticated') => {
    await db.exec('reset role');
    await q("select set_config('request.jwt.claim.sub',$1,false)",[n?id(n):'']);
    await db.exec(`set role ${role}`);
  };
  const inspect = async fn => {
    const role = await scalar('select current_user');
    await db.exec('reset role');
    try { return await fn(); } finally { await db.exec(`set role ${role}`); }
  };
  const block = (n,fields={},version=null) => scalar('select public.save_coach_training_block($1,$2,$3,$4)',[
    n===null?null:id(n), fields.name===undefined?'Term 4':fields.name,
    fields.start===undefined?'2026-11-02':fields.start,version,
  ]);
  const session = (n,fields={},version=null) => scalar('select public.save_coach_tracked_session_v2($1,$2,$3,$4,$5,$6,$7,$8,$9)',[
    n===null?null:id(n),fields.date===undefined?'2026-11-02':fields.date,fields.time||null,
    fields.venue===undefined?'Pizzey Skate Park':fields.venue, fields.riders===undefined?[id(2),id(3)]:fields.riders,version,
    fields.block===undefined?id(100):fields.block===null?null:id(fields.block),
    fields.fee===undefined?1250:fields.fee,fields.basis===undefined?'per_rider':fields.basis,
  ]);
  const legacy = (n,fields={},version=null) => scalar('select public.save_coach_tracked_session($1,$2,$3,$4,$5,$6)',[
    id(n),fields.date||'2026-11-02',fields.time||null,fields.venue||'Pizzey Skate Park',fields.riders||[id(2),id(3)],version,
  ]);
  const archive = (n,archived,version) => scalar('select public.archive_coach_tracked_session($1,$2,$3)',[id(n),archived,version]);
  const migrate = name => db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',name),'utf8'));
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create schema private;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth,private to anon,authenticated;
      grant execute on function auth.uid() to anon,authenticated;
      create type public.user_role as enum ('coach','admin','athlete','parent');
      create table public.profiles(id uuid primary key,role public.user_role not null,display_name text,points integer default 0);
      create function private.current_user_role() returns public.user_role language sql stable security definer set search_path=public as $$select role from public.profiles where id=auth.uid()$$;
      grant execute on function private.current_user_role() to authenticated;
      alter table public.profiles enable row level security;
      create policy own_profile on public.profiles for select to authenticated using(id=(select auth.uid()));
      create policy coach_profiles on public.profiles for select to authenticated using((select private.current_user_role()) in ('coach','admin'));
      grant select on public.profiles to authenticated;
      create table public.coach_athletes(coach_id uuid references profiles,athlete_id uuid references profiles,primary key(coach_id,athlete_id));
      alter table public.coach_athletes enable row level security;
      create policy roster on public.coach_athletes for select to authenticated using(coach_id=(select auth.uid()) or athlete_id=(select auth.uid()));
      grant select on public.coach_athletes to authenticated;
      create table public.coach_venues(id uuid primary key default gen_random_uuid(),coach_id uuid not null default auth.uid() references profiles,name text not null,sort_order integer not null default 0,created_at timestamptz default now(),updated_at timestamptz default now(),unique(coach_id,name));
      alter table public.coach_venues enable row level security;
      create policy venues on public.coach_venues for all to authenticated using(coach_id=auth.uid()) with check(coach_id=auth.uid());
      grant select,insert,update on public.coach_venues to authenticated;
      create table public.coach_group_sessions(id uuid primary key,coach_id uuid,status text);
      create table public.assignment_point_awards(id uuid primary key,athlete_id uuid,points integer);
      create table public.push_notification_queue(id uuid primary key,recipient_id uuid);
    `);
    await q("insert into profiles values($1,'coach','Coach A',0),($2,'athlete','Rider A',10),($3,'athlete','Rider B',20),($4,'coach','Coach B',0),($5,'athlete','Other rider',30),($6,'parent','Parent',0),($7,'admin','Admin',0)",[1,2,3,4,5,6,7].map(id));
    await q('insert into coach_athletes values($1,$2),($1,$3),($4,$5),($6,$2)',[1,2,3,4,5,7].map(id));
    await q("insert into coach_group_sessions values($1,$2,'running')",[id(80),id(1)]);
    await q('insert into assignment_point_awards values($1,$2,5)',[id(81),id(2)]);
    await q('insert into push_notification_queue values($1,$2)',[id(82),id(2)]);
    const untouched = ['profiles','coach_group_sessions','assignment_point_awards','push_notification_queue'];
    const before = await Promise.all(untouched.map(table=>q(`select * from ${table} order by id`)));
    await migrate('20261103212528_add_coach_session_tracker.sql');
    await actor(1);
    const old = await legacy(90,{date:'2026-10-01'});
    await db.exec('reset role');
    const oldDefinition = await scalar("select pg_get_functiondef('public.save_coach_tracked_session(uuid,date,time,text,uuid[],timestamptz)'::regprocedure)");
    await migrate(migrationName);
    eq(await scalar("select pg_get_functiondef('public.save_coach_tracked_session(uuid,date,time,text,uuid[],timestamptz)'::regprocedure)"),oldDefinition,'Cached-client RPC is unchanged');
    eq(await scalar("select relrowsecurity from pg_class where oid='public.coach_training_blocks'::regclass"),true,'Blocks have RLS');
    eq(await scalar("select count(*)::int from pg_proc where proname in ('validate_coach_training_block','validate_coach_tracked_session_block','save_coach_training_block','save_coach_tracked_session_v2') and prosecdef"),0,'All new functions use invoker privileges');
    eq(await scalar("select count(*)::int from pg_proc where proname in ('validate_coach_training_block','validate_coach_tracked_session_block','save_coach_training_block','save_coach_tracked_session_v2') and not coalesce(proconfig @> array['search_path=\"\"'],false)"),0,'Every new function pins search_path');
    await actor(1);
    const migrated = await scalar('select to_jsonb(s) from coach_tracked_sessions s where id=$1',[id(90)]);
    eq(migrated,{...old,block_id:null,park_fee_cents:0,park_fee_basis:'per_rider'},'Existing sessions, dates, riders and versions survive migration');
    let term = await block(100,{name:'  Term   4  '});
    eq(term.name,'Term 4');eq(term.start_date,'2026-11-02');eq(term.coach_id,id(1));
    eq(await block(100),term,'A lost create response can be retried without duplicate blocks');
    await denied(()=>block(100,{name:'Changed'}),/has changed/i);
    const prior = term;
    term = await block(100,{name:'Summer block'},term.updated_at);
    ok(term.updated_at!==prior.updated_at,'A real update gets a fresh version');
    eq(await block(100,{name:'Summer block'},prior.updated_at),term,'Retrying successful update returns same block');
    await denied(()=>block(100,{name:'Wrong stale name'},prior.updated_at),/has changed/i);
    for (const fields of [{name:''},{name:null},{name:'x'.repeat(81)},{start:null},{start:'infinity'},{start:'-infinity'},{start:'2026-11-03'},{start:'2026-11-08'}]) {
      await denied(()=>block(101,fields),/block name|Monday/i);
    }
    await denied(()=>block(null),/identified/);
    await denied(()=>block(101,{start:'2026-02-30'}),/date\/time|out of range/i);
    await denied(()=>block(101,{},term.updated_at),/no longer available/i);
    eq(await scalar('select count(*)::int from coach_training_blocks'),1,'Invalid and retried blocks do not create rows');
    let first = await session(200,{riders:[id(3),id(2),id(2)]});
    eq(first.rider_ids,[id(2),id(3)],'Fee quantity uses normalized unique riders');
    eq(first.block_id,id(100));eq(first.park_fee_cents,1250);eq(first.park_fee_basis,'per_rider');
    eq(await session(200),first,'Lost-response session retry does not duplicate entries or fees');
    await denied(()=>session(200,{fee:1500}),/has changed/i);
    const originalFirst=first;
    first=await session(200,{fee:1500},first.updated_at);
    eq(first.park_fee_cents,1500);eq(await session(200,{fee:1500},originalFirst.updated_at),first,'Fee-only lost response retry is safe');
    await denied(()=>session(200,{fee:1600},originalFirst.updated_at),/has changed/i);
    const legacyChanged=await legacy(200,{time:'15:30'},first.updated_at);
    eq(legacyChanged.block_id,first.block_id,'Old clients retain block assignment');
    eq(legacyChanged.park_fee_cents,first.park_fee_cents,'Old clients retain saved fees');
    eq(legacyChanged.park_fee_basis,first.park_fee_basis,'Old clients retain fee basis');
    eq(await legacy(200,{time:'15:30'},first.updated_at),legacyChanged,'Cached-client retry remains idempotent');
    first=legacyChanged;
    const last=await session(201,{date:'2027-01-10',fee:0});
    eq(last.session_date,'2027-01-10','Final Sunday of Week10 is inside the block');
    await session(202,{date:'2026-11-07',fee:1000,basis:'session'});
    await session(203,{date:'2026-12-28',fee:1000000,riders:[id(2)]});
    for (const fields of [{date:'2026-11-01'},{date:'2027-01-11'},{fee:-1},{fee:1000001},{fee:null},{basis:null},{basis:'per_person'},{block:999},{riders:[id(5)]},{riders:[]},{riders:[null]}]) {
      await denied(()=>session(204,fields),/within|park fee|training block|linked|riders/i);
    }
    await denied(()=>session(204,{fee:12.5}),/integer|invalid input/i,'Fractional cents are not stored');
    await denied(()=>session(null),/identified/);
    eq(await scalar('select count(*)::int from coach_tracked_sessions where id=$1',[id(204)]),0,'Invalid writes do not create a fee row');
    const loose=await session(205,{block:null,date:'2028-01-01',fee:0});
    eq(loose.block_id,null,'Standalone extra sessions remain supported');
    await denied(()=>block(100,{name:'Summer block',start:'2026-11-09'},term.updated_at),/outside the ten-week block/i);
    await denied(()=>block(100,{name:'Summer block',start:'2026-10-26'},term.updated_at),/outside the ten-week block/i);
    let removed=await archive(200,true,first.updated_at);
    eq(removed.park_fee_cents,1500,'Archiving preserves fees');
    await denied(()=>session(200,{fee:1600},removed.updated_at),/removed/i);
    await denied(()=>block(100,{name:'Summer block',start:'2026-11-09'},term.updated_at),/outside the ten-week block/i,'Archived first-week session still protects history');
    first=await archive(200,false,removed.updated_at);
    eq(first.block_id,id(100));eq(first.park_fee_cents,1500);
    const totals=await q("select sum(case park_fee_basis when 'per_rider' then park_fee_cents::bigint * cardinality(rider_ids) else park_fee_cents end)::text total from coach_tracked_sessions where block_id=$1 and archived_at is null",[id(100)]);
    eq(totals[0].total,'1004000','Totals multiply per-rider fees only, with zero fees valid');
    await archive(203,true,(await scalar('select to_jsonb(s) from coach_tracked_sessions s where id=$1',[id(203)])).updated_at);
    eq(await scalar("select sum(case park_fee_basis when 'per_rider' then park_fee_cents::bigint * cardinality(rider_ids) else park_fee_cents end)::text from coach_tracked_sessions where block_id=$1 and archived_at is null",[id(100)]),'4000','Removed sessions are excluded from totals');
    await denied(()=>q('update coach_training_blocks set coach_id=$1 where id=$2',[id(4),id(100)]),/permission denied/i);
    await denied(()=>q('update coach_training_blocks set created_at=now() where id=$1',[id(100)]),/permission denied/i);
    await denied(()=>q('delete from coach_training_blocks where id=$1',[id(100)]),/permission denied/i);
    await denied(()=>q('insert into coach_training_blocks(id,coach_id,name,start_date) values($1,$2,$3,$4)',[id(102),id(4),'Spoof','2026-11-02']),/block coach|row-level security/i);
    await denied(()=>q("update coach_tracked_sessions set park_fee_cents=-1 where id=$1",[id(200)]),/park fee/i,'Direct table writes enforce fee constraints');
    await denied(()=>q("update coach_tracked_sessions set session_date='2027-01-11' where id=$1",[id(200)]),/within/i,'Direct table writes enforce block dates');
    await denied(()=>q("update coach_training_blocks set start_date='2026-11-09' where id=$1",[id(100)]),/outside/i,'Direct table writes cannot strand sessions');
    await denied(()=>legacy(200,{date:'2027-01-11'},first.updated_at),/within/i,'Old clients cannot move a block session out of range');
    await actor(4);
    const other=await block(110,{name:'Other coach block'});
    eq(other.coach_id,id(4));eq(await scalar('select count(*)::int from coach_training_blocks'),1,'Coaches see only their own blocks');
    await denied(()=>block(100),/could not be saved/i,'Known block ID cannot reveal another coach record');
    await denied(()=>session(210,{block:100,riders:[id(5)]}),/your coaching account/i);
    await session(211,{block:110,riders:[id(5)]});
    await actor(1);
    await denied(()=>session(212,{block:110}),/your coaching account/i);
    await denied(()=>q('update coach_tracked_sessions set block_id=$1 where id=$2',[id(110),id(200)]),/your coaching account/i,'Direct writes cannot cross coach ownership');
    await inspect(()=>q('delete from coach_athletes where coach_id=$1 and athlete_id=$2',[id(1),id(3)]));
    const retained=await session(200,{fee:1600,time:'15:30'},first.updated_at);
    eq(retained.rider_ids,[id(2),id(3)],'Historical riders survive fee edits after unlinking');
    await denied(()=>session(213),/linked/i,'Unlinked rider cannot be added to new sessions');
    for(const n of [2,5,6]) {
      await actor(n);
      eq(await scalar('select count(*)::int from coach_training_blocks'),0,'Rider/parent cannot read block schedule');
      await denied(()=>block(120),/Only coaches/i);
      await denied(()=>session(220,{block:null}),/Only coaches/i);
      await denied(()=>q('insert into coach_training_blocks(id,name,start_date) values($1,$2,$3)',[id(120),'No','2026-11-02']),/Only the block coach|row-level security/i);
    }
    await actor(7);const admin=await block(130);eq(admin.coach_id,id(7));await session(230,{block:130,riders:[id(2)]});
    await actor(null,'anon');
    await denied(()=>q('select * from coach_training_blocks'),/permission denied/i);
    await denied(()=>block(140),/permission denied/i);
    await denied(()=>session(240),/permission denied/i);
    await actor(null);await denied(()=>block(140),/Only coaches/i);
    const after=await inspect(()=>Promise.all(untouched.map(table=>q(`select * from ${table} order by id`))));
    eq(after,before,'Blocks and fees never alter profiles, points, live sessions or notifications');
    console.log(`PASS: ${checks} Session Tracker block/fee SQL checks: boundaries, legacy clients, retries, stale writes, fees, archive totals and RLS.`);
  } finally { await db.close(); }
}
if(require.main===module) run().then(()=>require('./session-tracker-db.cjs').run(migrationName)).catch(error=>{console.error(error.stack,error.where||'');process.exitCode=1;});
module.exports={run,migrationName};
