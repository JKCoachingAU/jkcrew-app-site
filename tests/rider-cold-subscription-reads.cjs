// Actual app renderer, Realtime callback, weekly reader and shipped SDK.
// All fetches are intercepted in memory; no browser or live connection is used.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'app.js'),'utf8');
const extract=name=>{const i=source.search(new RegExp(`^(?:async )?function ${name}\\(`,'m'));assert(i>=0,name);const rest=source.slice(i);return rest.slice(0,rest.indexOf('\n}')+2);};
const gate=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const sdk=vm.createContext({console,URL,URLSearchParams,Request,Response,Headers,fetch,AbortController,DOMException,TextEncoder,TextDecoder,setTimeout,clearTimeout,setInterval,clearInterval,atob,btoa,crypto:require('node:crypto').webcrypto,WebSocket:class{constructor(){throw Error('No real socket in local test');}}});
vm.runInContext(fs.readFileSync(path.join(root,'vendor/supabase-2.116.0.min.js'),'utf8'),sdk);
function fixture({holdRollover=false}={}){const calls=[],rollovers=[],snapshots=[],channels=[],painted=[];let active=0,max=0,revision=1;
 const state={user:{id:'rider'},profile:{role:'athlete',country_code:'AU'},session:{access_token:'synthetic-local-token'},sessionSetupVersion:1,loadingOverlayToken:1,sessionRenderVersion:0,view:'session',inFlight:new Map(),cache:{},riderSessionRefresh:null};
 const client=sdk.supabase.createClient('https://cold-subscription.example.test','synthetic-key',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(address,init)=>{const url=new URL(address),name=url.pathname.split('/').pop();assert(url.origin==='https://cold-subscription.example.test'&&['ensure_current_week_assignments','get_current_training_snapshot'].includes(name));calls.push(name);if(name==='ensure_current_week_assignments'){const request=gate();rollovers.push(request);if(holdRollover)await request.promise;return new Response('0',{headers:{'content-type':'application/json'}});}const request={...gate(),revision};snapshots.push(request);active++;max=Math.max(max,active);try{await request.promise;return new Response(JSON.stringify({assignments:[{id:'a1',athlete_id:'rider',category:'daily',trick_name:'Revision '+request.revision}],progress:[],percentage_attempts:[],awards:[],assignment_attempts:[]}),{headers:{'content-type':'application/json'}});}finally{active--;}}}});
 client.realtime.setAuth=()=>{};client.channel=()=>{const channel={on(){return channel;},subscribe(callback){channel.status=callback;}};channels.push(channel);return channel;};
 const context={state,client,console,Date,Promise,Map,Set,Number,Error,AbortController,setTimeout,clearTimeout,document:{visibilityState:'visible'},navigator:{onLine:true},getAthleteCountryCode:async()=> 'AU',weekStartDateForCountry:()=> '2026-11-15',categoryInfo:{daily:{}},normalizeAssignmentProgress:(_,p)=>p,reconcileAwardedProgress:(_,p)=>p,loadActiveSession:async()=>{},riderFeaturesDisabled:()=>false,riderFeatureAccessUnknown:()=>false,riderRecoveryActive:()=>false,realtimeVisibleAthleteIds:async()=>['rider'],setupLiveRunDiscovery:()=>{},isCoachRole:role=>role==='coach'};
 vm.createContext(context);vm.runInContext(['cacheGet','cacheSet','cacheClear','withTimeout','getWeeklyAssignments','canRefreshRiderSession','requestRiderSessionRefresh','renderSession','setupRealtimeSync','realtimeFilter'].map(extract).join('\n'),context);
 return{context,state,calls,rollovers,snapshots,channels,painted,set revision(value){revision=value;},get max(){return max;},managedRenderer(){context.renderSession=async({forceAssignments})=>{const result=await context.getWeeklyAssignments('rider',{force:forceAssignments});painted.push(result.assignments[0]?.trick_name);return true;};}};
}
let checks=0;const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
(async()=>{
 {const f=fixture();const initial=f.context.renderSession();await flush();eq(f.snapshots.length,1,'Initial real renderer starts one SDK snapshot');await f.context.setupRealtimeSync();f.channels[0].status('SUBSCRIBED');await flush();
  const observed={snapshots:f.snapshots.length,rollovers:f.calls.filter(c=>c==='ensure_current_week_assignments').length,maxConcurrentSnapshots:f.max};
  f.state.view='home';f.snapshots.forEach(p=>p.resolve());await Promise.all([initial,f.state.riderSessionRefresh?.promise]);
  eq(observed,{snapshots:1,rollovers:1,maxConcurrentSnapshots:1},'First SUBSCRIBED does not overlap the current cold reader; navigation cancels its later catch-up');
 }


 {
  const f=fixture({holdRollover:true}),initial=f.context.renderSession();await flush();eq(f.snapshots.length,0,'Cold snapshot has not started while rollover is held');await f.context.setupRealtimeSync();f.channels[0].status('SUBSCRIBED');await flush();eq(f.rollovers.length,1,'Join during rollover shares the current preparatory operation');f.rollovers[0].resolve();await flush();eq(f.snapshots.length,1,'Join before SQL starts needs only one fresh snapshot');f.state.view='home';f.snapshots[0].resolve();await Promise.all([initial,f.state.riderSessionRefresh?.promise]);eq(f.calls.length,2,'Post-join cold read has no unnecessary forced catch-up');
 }
 {
  const f=fixture();f.managedRenderer();const beforeJoin=f.context.getWeeklyAssignments('rider');await flush();f.revision=2;await f.context.setupRealtimeSync();f.channels[0].status('SUBSCRIBED');await flush();const catchUp=f.state.riderSessionRefresh.promise;for(let n=0;n<4;n++)void f.context.requestRiderSessionRefresh({force:true});f.snapshots[0].resolve();await flush();if(f.snapshots.length>1)f.snapshots[1].resolve();await Promise.all([beforeJoin,catchUp]);
  eq(f.painted.at(-1),'Revision 2','A change committed before the first WS join still appears after catch-up');eq(f.max,1,'Pre-join catch-up never overlaps the first snapshot');eq(f.snapshots.length,2,'Concurrent force events merge into one first-join catch-up');
 }
 for(const reason of ['confirmed-write','manual-refresh','reconnect']){
  const f=fixture();f.managedRenderer();if(reason==='reconnect'){await f.context.setupRealtimeSync();f.channels[0].status('SUBSCRIBED');}else void f.context.requestRiderSessionRefresh();await flush();eq(f.snapshots.length,1,reason+': first read is active');const pending=f.state.riderSessionRefresh.promise;f.revision=2;
  if(reason==='confirmed-write'){for(let n=0;n<8;n++){f.context.cacheClear('schedule:rider:');f.state.sessionViewerDataVersion=(f.state.sessionViewerDataVersion||0)+1;void f.context.requestRiderSessionRefresh({force:true});}}
  else if(reason==='reconnect')f.channels[0].status('SUBSCRIBED');else void f.context.requestRiderSessionRefresh({force:true});
  await flush();eq(f.snapshots.length,1,reason+': explicit fresh request queues behind the active read');f.snapshots[0].resolve();await flush();eq(f.snapshots.length,2,reason+': one fresh trailing snapshot starts after the first settles');eq(f.max,1,reason+': no parallel snapshots');eq(f.snapshots[1].revision,2,reason+': trailing read captures the newer server revision');f.snapshots[1].resolve();await pending;eq(f.painted.at(-1),'Revision 2',reason+': newest server result is the final rendered list');eq(f.calls.length,4,reason+': event burst adds exactly one rollover/snapshot replacement');
 }
 {
  const f=fixture();f.managedRenderer();await f.context.setupRealtimeSync();f.channels[0].status('SUBSCRIBED');await flush();const pending=f.state.riderSessionRefresh.promise;for(let n=0;n<20;n++)f.context.cacheClear('schedule:rider:');f.snapshots[0].resolve();await pending;eq(f.snapshots.length,1,'Continuous invalidation alone cannot create an unbounded automatic restart loop');eq(Object.keys(f.state.cache).length,0,'Invalidated generation never refills the schedule cache');
 }
 console.log(`PASS: ${checks} actual-renderer/SDK cold subscription, confirmed-write/manual/reconnect trailing freshness and bounded-invalidation checks.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
