// Executes the actual Edge Function and real migration against local PGlite.
// WHOOP/Auth responses are synthetic fixtures; this is NOT a real-device test.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');const {webcrypto}=require('node:crypto');
const {PGlite}=require(process.env.JKCREW_PGLITE_PATH || '@electric-sql/pglite');
const db=new PGlite();
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const one=async(sql,args=[])=>Object.values((await q(sql,args))[0])[0];
const root=path.resolve(__dirname,'..');
const env={SUPABASE_URL:'https://supabase.test',SUPABASE_ANON_KEY:'test-public-key',SUPABASE_SERVICE_ROLE_KEY:'test-service-key'};
const calls=[];let handler,helpers,providerMode='normal',timerScale=1,checks=0;
let issued=0;
const now=Date.now(),stamp=offset=>new Date(now+offset).toISOString();
let data={
 sleep:[{id:'nap',nap:true,start:stamp(-3600000),end:stamp(-1800000),score_state:'SCORED',score:{stage_summary:{total_light_sleep_time_milli:1800000,total_slow_wave_sleep_time_milli:0,total_rem_sleep_time_milli:0}}},
 {id:'main',nap:false,start:stamp(-10*3600000),end:stamp(-2*3600000),score_state:'SCORED',score:{stage_summary:{total_in_bed_time_milli:9*3600000,total_awake_time_milli:2*3600000,total_light_sleep_time_milli:4*3600000,total_slow_wave_sleep_time_milli:2*3600000,total_rem_sleep_time_milli:3600000}}}],
 recovery:[{sleep_id:'main',created_at:stamp(-90*60000),score_state:'SCORED',score:{recovery_score:0,resting_heart_rate:50,hrv_rmssd_milli:64}}],
 cycle:[{start:stamp(-24*3600000),updated_at:stamp(-60000),score_state:'SCORED',score:{strain:0}}]
};
async function fakeFetch(url,options={}){
 calls.push({url,method:options.method||'GET',headers:options.headers,body:options.body});
 if(url==='https://supabase.test/auth/v1/user'){
  const user={ 'Bearer rider-token':id(1),'Bearer other-token':id(2),'Bearer coach-token':id(3),'Bearer parent-token':id(4)}[options.headers.Authorization];
  return Response.json(user?{id:user}:{error:'invalid'}, {status:user?200:401});
 }
 if(url.startsWith('https://supabase.test/rest/v1/profiles')){
  assert.equal(options.headers.Authorization,'Bearer test-service-key');
  const actor=new URL(url).searchParams.get('id').slice(3);return Response.json(await q('select id,role from profiles where id=$1',[actor]));
 }
 if(url==='https://supabase.test/rest/v1/rpc/jkcrew_health_whoop_backend'){
  assert.equal(options.headers.Authorization,'Bearer test-service-key');
  const b=JSON.parse(options.body);
  try{return Response.json(await one('select public.jkcrew_health_whoop_backend($1,$2,$3)',[b.p_action,b.p_actor,b.p_data]));}
  catch{return Response.json({message:'db denied'}, {status:403});}
 }
 if(!url.startsWith('https://api.prod.whoop.com/'))throw new Error('Unexpected request');
 if(providerMode==='timeout')return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));
 if(providerMode==='down')return Response.json({error:'provider unavailable'},{status:503});
 if(url.endsWith('/oauth/oauth2/token')){
  const body=new URLSearchParams(options.body);assert.equal(body.get('client_secret'),'test-client-secret');
  if(providerMode==='invalid-token')return Response.json({error:'invalid_grant'},{status:400});
  issued++;return Response.json({access_token:`access-fixture-${issued}`,refresh_token:`refresh-fixture-${issued}`,expires_in:3600,scope:'offline read:sleep read:recovery read:cycles'});
 }
 assert.match(options.headers.Authorization,/^Bearer access-fixture-/);
 if(url.endsWith('/user/access'))return new Response(null,{status:204});
 if(providerMode==='unauthorized')return Response.json({error:'expired'},{status:401});
 if(url.includes('/activity/sleep?'))return Response.json({records:data.sleep});
 if(url.includes('/recovery?'))return Response.json({records:data.recovery});
 if(url.includes('/cycle?'))return Response.json({records:data.cycle});
 throw new Error('Unexpected provider endpoint');
}
const context={Deno:{env:{get:k=>env[k]},serve:fn=>handler=fn},Response,Request,URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,crypto:webcrypto,
 btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary'),fetch:fakeFetch,
 setTimeout:(fn,n)=>setTimeout(fn,n*timerScale),clearTimeout,expose:v=>helpers=v};
const source=stripTypeScriptTypes(fs.readFileSync(path.join(root,'supabase/functions/health-whoop/index.ts'),'utf8'));
vm.runInNewContext(source+'\nexpose({makeSummary,seal,unseal,encryptionKey});',context);
const request=(action,token='rider-token',extra={})=>handler(new Request('https://supabase.test/functions/v1/health-whoop',{method:'POST',headers:{origin:'https://jkcoachingau.github.io',authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({action,...extra})}));
const stateFor=async()=>{const response=await request('connect');assert.equal(response.status,200);return new URL((await response.json()).authorization_url).searchParams.get('state');};
const callback=state=>handler(new Request(`https://supabase.test/functions/v1/health-whoop/callback?code=fixture-code&state=${state}&redirect=https://evil.test`));
const ticketFrom=response=>new URLSearchParams(new URL(response.headers.get('location')).hash.slice(1)).get('whoop_complete');
async function admin(sql,args=[]){await db.exec('reset role');const result=await q(sql,args);await db.exec('set role service_role');return result;}
const expireSync=()=>admin("update private.health_whoop_connections set sync_after=now()-interval '1 second' where athlete_id=$1",[id(1)]);
async function test(name,fn){await fn();checks++;console.log(`PASS ${name}`);}
(async()=>{
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create table profiles(id uuid primary key,role text);grant select on profiles to service_role;
 insert into profiles values('${id(1)}','athlete'),('${id(2)}','athlete'),('${id(3)}','coach'),('${id(4)}','parent');`);
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261029114127_private_whoop_health_connection.sql'),'utf8'));
 await db.exec('set role service_role');
 await test('auth/current rider role is required even when WHOOP is not configured',async()=>{
  assert.equal((await request('status','invalid')).status,401);
  assert.equal((await request('status','coach-token')).status,403);
  assert.equal((await request('status','parent-token')).status,403);
  const response=await request('status');assert.equal(response.headers.get('cache-control'),'no-store');
  const body=await response.json();assert.equal(body.availability,'not_configured');assert.equal(body.summary,null);
  assert.equal(calls.filter(c=>c.url.startsWith('https://api.prod.whoop.com/')).length,0);
 });
 await test('actor injection, malformed payload, foreign origin, and unsupported methods are rejected',async()=>{
  assert.equal((await request('status','rider-token',{athlete_id:id(2)})).status,400);
  const bad=new Request('https://supabase.test/functions/v1/health-whoop',{method:'POST',headers:{origin:'https://evil.test'},body:'{}'});assert.equal((await handler(bad)).status,403);
  assert.equal((await request('wrong')).status,400);
 });
 await test('OAuth starts only after real configuration; exact scopes/callback and one-use hashed state',async()=>{
  env.WHOOP_CLIENT_ID='test-client-id';env.WHOOP_CLIENT_SECRET='test-client-secret';env.WHOOP_TOKEN_ENCRYPTION_KEY=Buffer.alloc(32,42).toString('base64');
  const response=await request('connect'),body=await response.json(),url=new URL(body.authorization_url);
  assert.equal(url.origin+url.pathname,'https://api.prod.whoop.com/oauth/oauth2/auth');assert.equal(url.searchParams.get('scope'),'offline read:sleep read:recovery read:cycles');
  assert.equal(url.searchParams.get('redirect_uri'),'https://supabase.test/functions/v1/health-whoop/callback');
  const state=url.searchParams.get('state');assert.match(state,/^[a-f0-9]{64}$/);
  const stored=await q('select * from private.health_whoop_oauth_states');assert(!JSON.stringify(stored).includes(state));
  assert.equal((await request('connect')).status,409);
  const count=calls.length,result=await callback(state);
  const location=new URL(result.headers.get('location'));assert.equal(location.origin+location.pathname,'https://jkcoachingau.github.io/jkcrew-app-site/');assert.equal(location.search,'?health=complete');
  const ticket=ticketFrom(result);assert.match(ticket,/^[a-f0-9]{64}$/);assert.notEqual(ticket,state);
  assert.equal(result.headers.get('referrer-policy'),'no-referrer');assert.equal(result.headers.get('cache-control'),'no-store');
  assert(!calls.slice(count).some(c=>c.url.includes('/developer/v2')));
  assert.equal((await (await request('status')).json()).connection,'disconnected');
  assert.equal((await request('complete','other-token',{ticket})).status,400);
  assert.equal((await request('complete','rider-token',{ticket:'invalid'})).status,400);
  const completed=await request('complete','rider-token',{ticket});assert.equal(completed.status,200);assert.equal((await completed.json()).connection,'connected');
  assert.equal((await request('complete','rider-token',{ticket})).status,400);
  const exchanges=calls.filter(c=>c.url.endsWith('/oauth/oauth2/token')).length;
  assert.match((await callback(state)).headers.get('location'),/health=error$/);
  assert.equal(calls.filter(c=>c.url.endsWith('/oauth/oauth2/token')).length,exchanges);
 });
 await test('encrypted token data is owner-bound and never in browser status',async()=>{
  const rows=await q('select token_cipher from private.health_whoop_connections where athlete_id=$1',[id(1)]);const cipher=rows[0].token_cipher;
  assert(!cipher.includes('access-fixture'));assert(!cipher.includes('refresh-fixture'));
  const key=await helpers.encryptionKey();const tokens=await helpers.unseal(cipher,id(1),key);assert.equal(tokens.access_token,'access-fixture-1');
  await assert.rejects(()=>helpers.unseal(cipher,id(2),key));
  const output=JSON.stringify(await (await request('status')).json());assert(!output.includes('token'));assert(!output.includes('secret'));
  assert.equal((await (await request('status','other-token')).json()).connection,'disconnected');
 });
 await test('real WHOOP summary calculation skips naps and awake time and preserves zeros',async()=>{
  const result=await (await request('refresh')).json();assert.equal(result.connection,'connected');
  assert.equal(result.summary.sleep_minutes,420);assert.equal(result.summary.recovery_percent,0);assert.equal(result.summary.strain,0);
  assert.equal(result.summary.resting_heart_rate_bpm,50);assert.equal(result.summary.hrv_rmssd_ms,64);
  assert.equal(result.summary.metric_observed_at.sleep,data.sleep[1].end);assert.equal(result.summary.metric_observed_at.recovery,data.sleep[1].end);
  assert.equal(result.summary.metric_observed_at.strain,data.cycle[0].start);assert.equal(result.sync_due,false);
 });
 await test('15-minute DB cooldown stops provider calls from repeated refresh or home loads',async()=>{
  const before=calls.filter(c=>c.url.startsWith('https://api.prod.whoop.com/')).length;
  await request('refresh');await request('refresh');await request('status');
  assert.equal(calls.filter(c=>c.url.startsWith('https://api.prod.whoop.com/')).length,before);
 });
 await test('missing encryption credentials never fabricate disconnected state or erase existing summary',async()=>{
  const oldKey=env.WHOOP_TOKEN_ENCRYPTION_KEY;delete env.WHOOP_TOKEN_ENCRYPTION_KEY;
  const before=calls.filter(c=>c.url.startsWith('https://api.prod.whoop.com/')).length;
  for(const action of ['status','refresh','connect']){
   const result=await (await request(action)).json();assert.equal(result.availability,'not_configured');assert.equal(result.connection,'connected');assert.equal(result.summary.sleep_minutes,420);assert.equal(result.authorization_url,undefined);
  }
  assert.equal(calls.filter(c=>c.url.startsWith('https://api.prod.whoop.com/')).length,before);env.WHOOP_TOKEN_ENCRYPTION_KEY=oldKey;
 });
 await test('two concurrent refresh requests rotate tokens once and cannot overwrite each other',async()=>{
  await expireSync();await admin("update private.health_whoop_connections set token_expires_at=now()-interval '1 hour' where athlete_id=$1",[id(1)]);
  const before=issued;const results=await Promise.all([request('refresh'),request('refresh')]);assert.equal(issued,before+1);
  const bodies=await Promise.all(results.map(r=>r.json()));assert(bodies.some(b=>b.summary?.sleep_minutes===420));
  const cipher=(await q('select token_cipher from private.health_whoop_connections where athlete_id=$1',[id(1)]))[0].token_cipher;
  assert.equal((await helpers.unseal(cipher,id(1),await helpers.encryptionKey())).refresh_token,`refresh-fixture-${issued}`);
 });
 await test('new unscored records show null metrics rather than older scores or fabricated zeros',async()=>{
  const summary=helpers.makeSummary([{...data.sleep[1],id:'new',start:stamp(0),score_state:'PENDING_SCORE'},data.sleep[1]],
   [{...data.recovery[0],score_state:'PENDING_SCORE'},data.recovery[0]],[{...data.cycle[0],score_state:'PENDING_SCORE'}],stamp(0));
  for(const key of ['sleep_minutes','recovery_percent','resting_heart_rate_bpm','hrv_rmssd_ms','strain'])assert.equal(summary[key],null);
  assert.equal(summary.observed_at,null);assert.equal(summary.metric_observed_at.recovery,null);
  const missing=helpers.makeSummary([],[],[],stamp(0));assert.equal(missing.sleep_minutes,null);
 });
 await test('provider failure preserves last summary and adds a retry cooldown',async()=>{
  await expireSync();providerMode='down';const result=await (await request('refresh')).json();assert.equal(result.summary.sleep_minutes,420);assert.equal(result.sync_due,false);assert.match(result.message,/last summary/);
  const before=calls.filter(c=>c.url.startsWith('https://api.prod.whoop.com/')).length;await request('refresh');assert.equal(calls.filter(c=>c.url.startsWith('https://api.prod.whoop.com/')).length,before);providerMode='normal';
 });
 await test('bounded provider timeout releases lease and remains recoverable',async()=>{
  await expireSync();providerMode='timeout';timerScale=.01;const start=Date.now(),result=await (await request('refresh')).json();timerScale=1;
  assert(Date.now()-start<2000);assert.equal(result.syncing,false);assert.equal(result.connection,'connected');assert.equal(result.summary.sleep_minutes,420);providerMode='normal';
 });
 await test('rejected rotated token requires reconnect without retrying invalid credentials',async()=>{
  await expireSync();await admin("update private.health_whoop_connections set token_expires_at=now()-interval '1 hour' where athlete_id=$1",[id(1)]);
  providerMode='invalid-token';let result=await (await request('refresh')).json();assert.equal(result.connection,'reconnect_required');
  const count=calls.length;await request('refresh');assert(!calls.slice(count).some(c=>c.url.startsWith('https://api.prod.whoop.com/')));
  providerMode='normal';
 });
 await test('disconnect deletes summary/tokens/state and prevents callback resurrection',async()=>{
  await admin("update private.health_whoop_connections set last_connect_at=now()-interval '1 minute' where athlete_id=$1",[id(1)]);
  const state=await stateFor();const result=await (await request('disconnect')).json();assert.equal(result.connection,'disconnected');assert.equal(result.summary,null);
  assert.match((await callback(state)).headers.get('location'),/health=error$/);
  assert.equal((await q('select * from private.health_whoop_connections where athlete_id=$1',[id(1)])).length,0);
 });
 await test('rider can remove stored connection even if deployment encryption credentials are lost',async()=>{
  const state=await stateFor();const redirected=await callback(state);const ticket=ticketFrom(redirected);
  assert.equal((await request('complete','rider-token',{ticket})).status,200);
  const oldKey=env.WHOOP_TOKEN_ENCRYPTION_KEY;delete env.WHOOP_TOKEN_ENCRYPTION_KEY;
  const result=await (await request('disconnect')).json();assert.equal(result.connection,'disconnected');assert.equal(result.availability,'not_configured');assert.match(result.message,/remove JKCREW access in WHOOP/);
  assert.equal((await q('select * from private.health_whoop_connections where athlete_id=$1',[id(1)])).length,0);env.WHOOP_TOKEN_ENCRYPTION_KEY=oldKey;
 });
 await db.close();console.log(`${checks} WHOOP Edge Function regressions passed with synthetic provider data and local PostgreSQL. Live WHOOP consent/device sync remains unverified.`);
})().catch(async error=>{console.error(error);await db.close();process.exit(1);});
