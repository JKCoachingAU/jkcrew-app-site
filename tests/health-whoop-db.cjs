// Real migration in disposable Postgres. No remote database or health data.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require(process.env.JKCREW_PGLITE_PATH || '@electric-sql/pglite');
const db=new PGlite();
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const one=async(sql,args=[])=>Object.values((await q(sql,args))[0])[0];
const rpc=(action,actor,data={})=>one('select public.jkcrew_health_whoop_backend($1,$2,$3)',[action,actor,data]);
const role=async value=>{await db.exec('reset role');if(value)await db.exec(`set role ${value}`);};
let checks=0;
async function test(name,fn){await fn();console.log(`PASS ${name}`);checks++;}
(async()=>{
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create table public.profiles(id uuid primary key,role text); grant select on public.profiles to service_role;
 insert into public.profiles values('${id(1)}','athlete'),('${id(2)}','athlete'),('${id(3)}','coach'),('${id(4)}','parent');`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261029114127_private_whoop_health_connection.sql'),'utf8'));
 await test('migration does not enroll riders or import any health records',async()=>{
  assert.equal(await one('select count(*)::int from private.health_whoop_connections'),0);
  assert.equal(await one('select count(*)::int from private.health_whoop_oauth_states'),0);
 });
 await test('anonymous/authenticated users cannot read private tables or execute service RPCs',async()=>{
  for(const r of ['anon','authenticated']){
   await role(r);
   await assert.rejects(()=>rpc('status',id(1)),/permission denied/);
   await assert.rejects(()=>q('select * from private.health_whoop_connections'),/permission denied/);
   await assert.rejects(()=>q('select * from private.health_whoop_oauth_states'),/permission denied/);
   await assert.rejects(()=>q('select * from private.health_whoop_pending'),/permission denied/);
   await assert.rejects(()=>one('select private.health_whoop_status($1)',[id(1)]),/permission denied/);
  }
 });
 await role('service_role');
 await test('service API denies non-riders and unknown actors',async()=>{
  for(const actor of [null,id(3),id(4),id(999)]) await assert.rejects(()=>rpc('status',actor),/Rider account/);
 });
 let claim;
 await test('one-use state binds callback to rider and never to caller supplied actor',async()=>{
  assert.equal((await rpc('status',id(1))).connection,'disconnected');
  assert.deepEqual(await rpc('begin',id(1),{state_hash:'a'.repeat(64)}),{started:true});
  await assert.rejects(()=>rpc('consume_state',id(2),{state_hash:'a'.repeat(64)}),/Invalid callback actor/);
  claim=await rpc('consume_state',null,{state_hash:'a'.repeat(64)});
  assert.equal(claim.athlete_id,id(1));
  assert.equal(await rpc('consume_state',null,{state_hash:'a'.repeat(64)}),null);
  assert.equal(await rpc('consume_state',null,{state_hash:'b'.repeat(64)}),null);
 });
 await test('callback stages encrypted payload only under live generation; authenticated same-rider completion is required',async()=>{
  const bad=await rpc('stage_tokens',id(1),{...claim,generation:id(998),ticket_hash:'f'.repeat(64),token_cipher:'cipher',token_expires_at:new Date(Date.now()+3600000).toISOString()});
  assert.equal(bad.saved,false);
  const staged=await rpc('stage_tokens',id(1),{...claim,ticket_hash:'f'.repeat(64),token_cipher:'v1.encrypted-fixture',token_expires_at:new Date(Date.now()+3600000).toISOString()});
  assert.equal(staged.status.connection,'disconnected');
  assert.notEqual((await rpc('complete',id(2),{ticket_hash:'f'.repeat(64)})).saved,true);
  const good=await rpc('complete',id(1),{ticket_hash:'f'.repeat(64)});
  assert.equal(good.status.connection,'connected');assert.equal(good.status.sync_due,true);
  assert.equal((await rpc('complete',id(1),{ticket_hash:'f'.repeat(64)})).saved,false);
  assert(!JSON.stringify(good.status).includes('encrypted-fixture'));
  assert.equal((await rpc('status',id(2))).connection,'disconnected');
 });
 await test('only one sync claims rotating credentials; other invocations receive no token',async()=>{
  claim=await rpc('claim_sync',id(1)); assert.equal(claim.claimed,true);
  assert.equal(claim.token_cipher,'v1.encrypted-fixture');
  const busy=await rpc('claim_sync',id(1)); assert.equal(busy.claimed,false); assert.equal(busy.status.syncing,true);assert.equal(busy.token_cipher,undefined);
  assert.equal((await rpc('claim_disconnect',id(1))).claimed,false);
  const rotate=await rpc('save_tokens',id(1),{...claim,token_cipher:'v1.rotated',token_expires_at:new Date(Date.now()+7200000).toISOString()});assert.equal(rotate.saved,true);
  const summary={source:'WHOOP',sleep_minutes:420,recovery_percent:0};
  const saved=await rpc('save_summary',id(1),{...claim,summary});assert.equal(saved.saved,true);assert.deepEqual(saved.status.summary,summary);assert.equal(saved.status.sync_due,false);
  const cooldown=await rpc('claim_sync',id(1));assert.equal(cooldown.claimed,false);assert.equal(cooldown.token_cipher,undefined);
 });
 await test('stale leases and missing generations cannot write over a finished sync',async()=>{
  assert.equal((await rpc('save_summary',id(1),{...claim,summary:{sleep_minutes:1}})).saved,false);
  const disconnect=await rpc('claim_disconnect',id(1));
  assert.equal((await rpc('disconnect',id(1),{lease_id:disconnect.lease_id})).saved,false);
  assert.equal((await rpc('disconnect',id(1),disconnect)).saved,true);
  assert.equal((await rpc('status',id(1))).connection,'disconnected');
  assert.equal((await rpc('stage_tokens',id(1),{...claim,token_cipher:'cannot-resurrect'})).saved,undefined);
 });
 await test('expired, role-revoked and superseded OAuth states never connect',async()=>{
  await rpc('begin',id(2),{state_hash:'b'.repeat(64)});
  await role();await q("update private.health_whoop_oauth_states set expires_at=now()-interval '1 minute' where athlete_id=$1",[id(2)]);await role('service_role');
  assert.equal(await rpc('consume_state',null,{state_hash:'b'.repeat(64)}),null);
  await role();await q("update private.health_whoop_connections set last_connect_at=now()-interval '1 minute' where athlete_id=$1",[id(2)]);await role('service_role');
  await rpc('begin',id(2),{state_hash:'c'.repeat(64)});
  await role();await q("update private.health_whoop_connections set generation=gen_random_uuid() where athlete_id=$1",[id(2)]);await role('service_role');
  assert.equal(await rpc('consume_state',null,{state_hash:'c'.repeat(64)}),null);
  await role();await q("update private.health_whoop_connections set last_connect_at=now()-interval '1 minute' where athlete_id=$1",[id(2)]);await role('service_role');
  await rpc('begin',id(2),{state_hash:'d'.repeat(64)});
  await role();await q("update public.profiles set role='parent' where id=$1",[id(2)]);await role('service_role');
  await assert.rejects(()=>rpc('consume_state',null,{state_hash:'d'.repeat(64)}),/Rider account/);
 });
 await test('disconnect removes pending states and encrypted data, blocking callback replay',async()=>{
  await rpc('begin',id(1),{state_hash:'e'.repeat(64)});
  const lease=await rpc('claim_disconnect',id(1));await rpc('disconnect',id(1),lease);
  assert.equal(await rpc('consume_state',null,{state_hash:'e'.repeat(64)}),null);
  await role();assert.equal(await one('select count(*)::int from private.health_whoop_connections where athlete_id=$1',[id(1)]),0);
 });
 await test('expired completion tickets cannot activate staged provider tokens',async()=>{
  await role('service_role');await rpc('begin',id(1),{state_hash:'f'.repeat(64)});
  const callback=await rpc('consume_state',null,{state_hash:'f'.repeat(64)});
  await rpc('stage_tokens',id(1),{...callback,ticket_hash:'a'.repeat(64),token_cipher:'v1.pending',token_expires_at:new Date(Date.now()+3600000).toISOString()});
  await role();await q("update private.health_whoop_pending set expires_at=now()-interval '1 minute'");await role('service_role');
  assert.equal((await rpc('complete',id(1),{ticket_hash:'a'.repeat(64)})).saved,false);
  assert.equal((await rpc('status',id(1))).connection,'disconnected');await role();
 });
 await test('RLS is enabled and no blanket health policies or public function grants exist',async()=>{
  assert.equal(await one("select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in('health_whoop_connections','health_whoop_oauth_states','health_whoop_pending') and c.relrowsecurity"),3);
  assert.equal(await one("select count(*)::int from pg_policies where schemaname='private' and tablename like 'health_whoop_%'"),0);
 });
 await db.close();console.log(`${checks} WHOOP database regression checks passed (disposable local PostgreSQL).`);
})().catch(async error=>{console.error(error);await db.close();process.exit(1);});
