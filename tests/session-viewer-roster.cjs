// Actual app cache/roster functions and bundled SDK, intercepted fetch only.
// No production URL, account, browser or database write is used.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'app.js'),'utf8');
const extract=name=>{const start=source.search(new RegExp(`^(?:async )?function ${name}\\(`,'m'));assert(start>=0,name);const rest=source.slice(start);return rest.slice(0,rest.indexOf('\n}')+2);};
const sdk=vm.createContext({console,URL,URLSearchParams,Request,Response,Headers,fetch,AbortController,DOMException,TextEncoder,TextDecoder,setTimeout,clearTimeout,setInterval,clearInterval,atob,btoa,crypto:require('node:crypto').webcrypto,WebSocket:class{constructor(){throw Error('Realtime unavailable in roster fixture');}}});
vm.runInContext(fs.readFileSync(path.join(root,'vendor/supabase-2.116.0.min.js'),'utf8'),sdk);
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const plain=value=>JSON.parse(JSON.stringify(value));let checks=0;const eq=(a,b,label)=>{assert.deepEqual(plain(a),plain(b),label);checks++;};const ok=(a,label)=>{assert(a,label);checks++;};
const payload=owner=>({links:[{athlete_id:owner+'-one',group_name:'monday'},{athlete_id:owner+'-two',group_name:'tuesday'},{athlete_id:owner+'-three',group_name:null}],athletes:[{id:owner+'-one',display_name:'Alex',avatar:{color:'blue'},country_code:'DE',email:'must-not-forward@example.test',medical_notes:'do not forward'},{id:owner+'-two',display_name:'Bailey',avatar:null,country_code:'AU'},{id:owner+'-three',display_name:'Casey',avatar:{},country_code:'CN'}],group_links:[{athlete_id:owner+'-one',group_name:'wednesday',membership_type:'weekly'},{athlete_id:owner+'-one',group_name:'tuesday',membership_type:'additional'},{athlete_id:owner+'-one',group_name:'wednesday',membership_type:'weekly'}]});
function fixture(options={}){
 const state={user:{id:'coach-a'},sessionSetupVersion:1,cache:{},inFlight:new Map(),coachRosterIds:new Set(['retained-rider'])},calls=[],waiters=[];
 const context={state,Map,Set,Promise,Date,Error,AbortController,setTimeout,clearTimeout};
 context.client=sdk.supabase.createClient('https://roster.example.test','synthetic-key',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(address,init)=>{
  const url=new URL(address);assert(url.origin==='https://roster.example.test'&&url.pathname==='/rest/v1/rpc/get_my_session_viewer_roster','No table, foreign URL or legacy fallback is allowed');
  const call={owner:state.user?.id,generation:state.sessionSetupVersion,body:JSON.parse(init.body),method:init.method,signal:init.signal,gate:deferred()};calls.push(call);waiters.forEach(waiter=>{if(calls.length>=waiter.n)waiter.resolve();});
  if(options.hold)await call.gate.promise;
  if(options.hang)return await new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
  const data=options.data===undefined?payload(call.owner):options.data;
  return new Response(JSON.stringify(options.status?{message:'Access unavailable'}:data),{status:options.status||200,headers:{'content-type':'application/json'}});
 }}});
 vm.createContext(context);vm.runInContext(['cacheGet','cacheSet','withTimeout','getSessionViewerRoster'].map(extract).join('\n'),context);
 const timeout=context.withTimeout;context.withTimeout=(promise,label,ms)=>{eq(ms,10000,'Roster has one bounded10-second read');return timeout(promise,label,options.shortTimeout?20:ms);};
 return{state,context,calls,wait(n){if(calls.length>=n)return Promise.resolve();const gate=deferred();waiters.push({n,resolve:gate.resolve});return gate.promise;}};
}
(async()=>{
 {
  const f=fixture(),rows=await f.context.getSessionViewerRoster();
  eq(f.calls.length,1,'Three former direct reads are replaced by one implicit-scope RPC');eq(f.calls[0].body,{},'Client sends no coach/team/foreign rider IDs');eq(f.calls[0].method,'POST','RPC uses the existing SDK transport');
  eq(rows.map(row=>row.display_name),['Alex','Bailey','Casey'],'Server display order is preserved');
  eq(rows[0].groupNames,['wednesday','tuesday'],'Membership order and duplicate-group removal remain unchanged');eq(rows[0].groupName,'wednesday','First membership remains the primary displayed group');eq(rows[1].groupNames,['tuesday'],'Missing memberships use the existing primary-group fallback');eq(rows[2].groupNames,['monday'],'Missing primary group retains Monday fallback');
  eq(Object.keys(rows[0]).sort(),['avatar','country_code','display_name','groupName','groupNames','id'].sort(),'Only the existing four profile fields and mapped groups are exposed');eq(rows[0].avatar,{color:'blue'},'Existing avatar data is retained');
  eq([...f.state.coachRosterIds],rows.map(row=>row.id),'Realtime IDs update only from verified returned riders');
  f.state.coachRosterIds=new Set();await f.context.getSessionViewerRoster();eq(f.calls.length,1,'Thirty-second cache avoids repeated RPCs');eq([...f.state.coachRosterIds],rows.map(row=>row.id),'Cache restores the same verified realtime set');
  f.state.cache['session-viewer-roster:coach-a'].time=Date.now()-30001;await f.context.getSessionViewerRoster();eq(f.calls.length,2,'Expired cache reloads through the same bounded RPC');
 }
 {
  const f=fixture({hold:true});const first=f.context.getSessionViewerRoster(),second=f.context.getSessionViewerRoster();await f.wait(1);eq(f.calls.length,1,'Concurrent calls coalesce into one RPC');f.calls[0].gate.resolve();const rows=await Promise.all([first,second]);eq(rows.map(r=>r.length),[3,3],'Both callers receive the complete verified roster');eq(f.state.inFlight.size,0,'Successful read releases its in-flight guard');
 }
 {
  const f=fixture({data:{links:[],athletes:[],group_links:[]}});eq(await f.context.getSessionViewerRoster(),[],'Verified empty roster stays empty');eq([...f.state.coachRosterIds],[],'Verified empty roster safely clears realtime IDs');await f.context.getSessionViewerRoster();eq(f.calls.length,1,'Verified empty result is cached');
 }
 for(const data of [null,{}, {links:[],athletes:[]},{links:[null],athletes:[],group_links:[]},{links:[],athletes:[{id:'foreign-rider'}],group_links:[]},{links:[],athletes:[],group_links:[{athlete_id:'foreign-rider',group_name:'monday'}]}]){
  const f=fixture({data});await assert.rejects(f.context.getSessionViewerRoster(),/could not be verified|did not match/);checks++;eq([...f.state.coachRosterIds],['retained-rider'],'Invalid payload never replaces realtime authorization');eq(Object.keys(f.state.cache).length,0,'Invalid payload enters no cache');eq(f.calls.length,1,'Invalid payload triggers no legacy table fallback');eq(f.state.inFlight.size,0,'Invalid payload releases its guard');
 }
 for(const status of [401,403,500,503]){
  const f=fixture({status});await assert.rejects(f.context.getSessionViewerRoster(),error=>/Access unavailable/.test(error.message));checks++;eq([...f.state.coachRosterIds],['retained-rider'],'Denied/failed read retains verified authorization');eq(Object.keys(f.state.cache).length,0,'Denied/failed read enters no cache');eq(f.calls.length,1,'Denied/failed POST has no fallback or retry');
 }
 for(const scope of ['actor','setup','a-b-a']){
  const f=fixture({hold:true});const reading=f.context.getSessionViewerRoster(),rejected=assert.rejects(reading,/account access changed/);await f.wait(1);
  if(scope==='actor')f.state.user={id:'coach-b'};else if(scope==='setup')f.state.sessionSetupVersion++;else{f.state.user={id:'coach-b'};f.state.sessionSetupVersion++;f.state.user={id:'coach-a'};f.state.sessionSetupVersion++;}
  f.state.coachRosterIds=new Set(['new-verified-rider']);f.calls[0].gate.resolve();await rejected;checks++;eq([...f.state.coachRosterIds],['new-verified-rider'],scope+': late roster cannot replace the new authorization set');eq(Object.keys(f.state.cache).length,0,scope+': late response cannot enter cache');
 }
 {
  const f=fixture({hold:true});const old=f.context.getSessionViewerRoster(),oldRejected=assert.rejects(old,/account access changed/);await f.wait(1);f.state.sessionSetupVersion++;const current=f.context.getSessionViewerRoster();await f.wait(2);eq(f.calls.length,2,'New Auth generation does not share an obsolete pending promise');f.calls[0].gate.resolve();await oldRejected;checks++;eq(f.state.inFlight.size,1,'Old finally cannot erase the new generation’s request');f.calls[1].gate.resolve();eq((await current).length,3,'New generation loads its complete own roster');eq(f.state.inFlight.size,0,'New generation cleans up its own request');
 }
 {
  const f=fixture();await f.context.getSessionViewerRoster();f.state.user={id:'coach-b'};f.state.sessionSetupVersion++;const rows=await f.context.getSessionViewerRoster();eq(rows.every(row=>row.id.startsWith('coach-b-')),true,'Uncleared cache cannot cross coach accounts');eq(f.calls.length,2,'Another coach uses its own implicit-scope RPC');
 }
 {
  const f=fixture({hang:true,shortTimeout:true});await assert.rejects(f.context.getSessionViewerRoster(),/timed out/);checks++;eq(f.calls[0].signal.aborted,true,'Deadline aborts the underlying roster request');eq(f.calls.length,1,'Timeout adds no retry or legacy fallback');eq(f.state.inFlight.size,0,'Timeout releases the in-flight guard');eq([...f.state.coachRosterIds],['retained-rider'],'Timeout does not fabricate an empty authorization set');
 }
 {
  const f=fixture();f.state.user=null;await assert.rejects(f.context.getSessionViewerRoster(),/Sign in/);checks++;eq(f.calls.length,0,'Signed-out client starts no roster request');
 }
 console.log(`PASS: ${checks} actual-SDK roster projection,groups,coalescing,scope,cache,denial and bounded-read checks.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
