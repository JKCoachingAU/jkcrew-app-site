// Actual lean-summary loader and bundled SDK; all fetches are intercepted.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'app.js'),'utf8');
const extract=name=>{const start=source.search(new RegExp(`^(?:async )?function ${name}\\(`,'m'));assert(start>=0,name);const rest=source.slice(start);return rest.slice(0,rest.indexOf('\n}')+2);};
const sdk=vm.createContext({console,URL,URLSearchParams,Request,Response,Headers,fetch,AbortController,DOMException,TextEncoder,TextDecoder,setTimeout,clearTimeout,setInterval,clearInterval,atob,btoa,crypto:require('node:crypto').webcrypto,WebSocket:class{constructor(){throw Error('No realtime in score fixture');}}});vm.runInContext(fs.readFileSync(path.join(root,'vendor/supabase-2.116.0.min.js'),'utf8'),sdk);
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};const plain=value=>JSON.parse(JSON.stringify(value));let checks=0;const eq=(a,b,label)=>{assert.deepEqual(plain(a),plain(b),label);checks++;};
const scores=[{athlete_id:'top-tie-first',weekly_points:12.5},{athlete_id:'top-tie-second',weekly_points:12.5},{athlete_id:'zero',weekly_points:0}];
function fixture(options={}){
 const state={user:{id:'rider'},sessionSetupVersion:1,cache:{},inFlight:new Map()},calls=[],waiters=[],retryOptions=[];
 const context={state,Date,Map,Set,Promise,Number,String,Error,AbortController,setTimeout,clearTimeout,Math,wait:async()=>{throw Error('Summary may not add retry delay');}};
 context.client=sdk.supabase.createClient('https://points.example.test','synthetic-key',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(address,init)=>{
  const url=new URL(address);assert(url.origin==='https://points.example.test'&&url.pathname==='/rest/v1/rpc/get_team_weekly_points','Only lean points RPC is allowed');assert.equal(url.search,'','No broad projection or profile query');
  const call={body:JSON.parse(init.body),signal:init.signal,gate:deferred(),data:scores};calls.push(call);waiters.forEach(w=>{if(calls.length>=w.n)w.resolve();});
  if(options.hold)await call.gate.promise;
  if(options.hang)return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
  return new Response(JSON.stringify(options.status?{message:'Score service unavailable'}:options.invalid?{}:call.data),{status:options.status||200,headers:{'content-type':'application/json'}});
 }}});
 vm.createContext(context);vm.runInContext(['cacheGet','cacheSet','withTimeout','isTransientRequestError','retryNetworkRequest','getAthleteHomeVerifiedLeaderboard'].map(extract).join('\n'),context);
 const timeout=context.withTimeout;context.withTimeout=(p,label,ms)=>timeout(p,label,options.shortTimeout?20:ms);
 const retry=context.retryNetworkRequest;context.retryNetworkRequest=(factory,label,opts)=>{retryOptions.push(opts);return retry(factory,label,opts);};
 return{context,state,calls,retryOptions,wait(n){if(calls.length>=n)return Promise.resolve();const d=deferred();waiters.push({n,resolve:d.resolve});return d.promise;}};
}
(async()=>{
 {
  const f=fixture(),rows=await f.context.getAthleteHomeVerifiedLeaderboard();
  eq(rows,scores,'Lean RPC preserves fractional points, zero scores and server tie order');eq(f.calls.length,1,'One lean read serves the initial summary');eq(f.calls[0].body,{},'Team scope stays implicit in the authenticated server RPC');eq(f.retryOptions,[{attempts:1,timeoutMs:8000}],'Existing one-attempt8s summary policy is unchanged');
  await f.context.getAthleteHomeVerifiedLeaderboard();eq(f.calls.length,1,'Successful7s cache is reused');await f.context.getAthleteHomeVerifiedLeaderboard({force:true});eq(f.calls.length,2,'Force refresh reloads verified scores');
  f.state.sessionSetupVersion++;await f.context.getAthleteHomeVerifiedLeaderboard();eq(f.calls.length,3,'New Auth epoch cannot reuse cached prior-epoch scores');
  f.state.user={id:'other-rider'};await f.context.getAthleteHomeVerifiedLeaderboard();eq(f.calls.length,4,'Another rider cannot reuse the first rider cache');
 }
 {
  const f=fixture({hold:true}),first=f.context.getAthleteHomeVerifiedLeaderboard(),second=f.context.getAthleteHomeVerifiedLeaderboard();await f.wait(1);eq(f.calls.length,1,'Home and Session coalesce one pending score read');f.calls[0].gate.resolve();eq((await Promise.all([first,second])).map(rows=>rows.length),[3,3],'Both consumers receive complete verified rows');eq(f.state.inFlight.size,0,'Completed read releases its guard');
 }
 {
  const f=fixture({hold:true}),older=f.context.getAthleteHomeVerifiedLeaderboard();await f.wait(1);const newer=f.context.getAthleteHomeVerifiedLeaderboard({force:true});await f.wait(2);f.calls[1].data=[{athlete_id:'rider',weekly_points:99.5}];f.calls[1].gate.resolve();await newer;f.calls[0].gate.resolve();await older;eq(f.context.cacheGet('leaderboard:summary:rider:verified')[0].weekly_points,99.5,'Older normal read cannot replace an explicitly refreshed score cache');
 }
 for(const change of ['actor','epoch']){
  const f=fixture({hold:true}),reading=f.context.getAthleteHomeVerifiedLeaderboard(),rejected=assert.rejects(reading,/account access changed/);await f.wait(1);if(change==='actor')f.state.user={id:'other'};else f.state.sessionSetupVersion++;f.calls[0].gate.resolve();await rejected;checks++;eq(Object.keys(f.state.cache).length,0,change+': stale scores enter no cache');eq(f.state.inFlight.size,0,change+': obsolete read releases its own guard');
 }
 for(const status of [403,500,503]){
  const f=fixture({status});await assert.rejects(f.context.getAthleteHomeVerifiedLeaderboard(),error=>/Score service unavailable/.test(error.message));checks++;eq(f.calls.length,1,'Failed score read has no retry or legacy fallback');eq(Object.keys(f.state.cache).length,0,'Failed scores are never cached as fabricated zero standings');
 }
 {
  const f=fixture({invalid:true});await assert.rejects(f.context.getAthleteHomeVerifiedLeaderboard(),/could not be verified/);checks++;eq(Object.keys(f.state.cache).length,0,'Malformed summary cannot enter cache');
 }
 {
  const f=fixture({hang:true,shortTimeout:true});await assert.rejects(f.context.getAthleteHomeVerifiedLeaderboard(),/timed out/);checks++;eq(f.calls[0].signal.aborted,true,'A stalled summary aborts its underlying request');eq(f.calls.length,1,'A stalled summary adds no retry');eq(f.state.inFlight.size,0,'A stalled summary releases its guard');
 }
 eq(extract('getLeaderboard').includes('client.rpc("get_weekly_leaderboard_with_half_points")'),true,'Generic full Board and rich HQ reader retain the existing RPC');
 console.log(`PASS: ${checks} actual-SDK lean-points projection,ordering,fractions,cache,coalescing and failure checks.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
