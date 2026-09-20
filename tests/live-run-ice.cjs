const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {stripTypeScriptTypes}=require('node:module');const {webcrypto,createHmac}=require('node:crypto');
const source=stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'../supabase/functions/live-run-ice/index.ts'),'utf8'));
const rider='10000000-0000-4000-8000-000000000001',coach='20000000-0000-4000-8000-000000000002',sessionId='30000000-0000-4000-8000-000000000003',clientId='40000000-0000-4000-8000-000000000004';
let handler;const env={SUPABASE_URL:'https://supabase.test',SUPABASE_ANON_KEY:'test-public'};let mode='active',calls=[];
vm.runInNewContext(source,{Deno:{env:{get:k=>env[k]},serve:fn=>handler=fn},Response,Request,TextEncoder,crypto:webcrypto,btoa:s=>Buffer.from(s,'binary').toString('base64'),fetch:async(url,options)=>{calls.push({url,options});if(url.endsWith('/user'))return Response.json({id:mode==='foreign'?'unrelated':rider},{status:mode==='signed-out'?401:200});return Response.json({session:{athlete_id:rider,coach_id:coach,call_status:mode==='ringing'?'ringing':'active'}},{status:mode==='unauthorized'?403:200});}});
async function request(extra={}){return handler(new Request('https://edge.test/live-run-ice',{method:'POST',headers:{origin:'https://jkcoachingau.github.io',authorization:'Bearer test-token','content-type':'application/json',...extra.headers},body:JSON.stringify({sessionId,clientId,...extra.body})}));}
(async()=>{
 assert.equal((await request({headers:{authorization:''}})).status,401);
 assert.equal((await request({headers:{origin:'https://unrelated.test'}})).status,403);
 mode='signed-out';assert.equal((await request()).status,401);
 mode='unauthorized';assert.equal((await request()).status,403);
 mode='foreign';assert.equal((await request()).status,403);
 mode='ringing';assert.equal((await request()).status,403);
 mode='active';assert.equal((await request({body:{sessionId:'invalid'}})).status,400);
 const direct=await request();assert.equal(direct.headers.get('cache-control'),'no-store');let result=await direct.json();assert.equal(result.relayConfigured,false);assert.equal(result.iceServers.length,1);
 env.TURN_SHARED_SECRET='synthetic-test-only-secret';env.TURN_URLS='turn:relay.example:3478?transport=udp,turns:relay.example:5349?transport=tcp';
 const relayed=await request();result=await relayed.json();assert.equal(result.relayConfigured,true);assert.equal(result.iceServers.length,2);
 const relay=result.iceServers[1];assert.equal(relay.username,`${result.expiresAt}:${rider}`);assert.equal(relay.credential,createHmac('sha1',env.TURN_SHARED_SECRET).update(relay.username).digest('base64'));assert(!JSON.stringify(result).includes(env.TURN_SHARED_SECRET));
 assert(result.expiresAt> Date.now()/1000+3500 && result.expiresAt < Date.now()/1000+3601);
 const rpc=calls.filter(c=>c.url.endsWith('live_run_call_action')).at(-1);assert.equal(rpc.options.headers.Authorization,'Bearer test-token');assert.equal(JSON.parse(rpc.options.body).p_client_id,clientId);
 console.log('PASS: authenticated call-only ICE settings, pending/foreign/disabled denials, short-lived HMAC TURN credentials, no secret leakage, direct fallback and no-store responses.');
})().catch(e=>{console.error(e);process.exit(1)});
