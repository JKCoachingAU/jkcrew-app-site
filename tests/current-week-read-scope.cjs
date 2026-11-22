// Actual app reader + shipped SDK with intercepted RPCs. Historical records
// stay in the fixture; no production account, request or write is used.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'app.js'),'utf8');
const extract=name=>{const start=source.search(new RegExp(`^(?:async )?function ${name}\\(`,'m'));assert(start>=0,name);const rest=source.slice(start);return rest.slice(0,rest.indexOf('\n}')+2);};
const sdk=vm.createContext({console,URL,URLSearchParams,Request,Response,Headers,fetch,AbortController,DOMException,TextEncoder,TextDecoder,setTimeout,clearTimeout,setInterval,clearInterval,atob,btoa,crypto:require('node:crypto').webcrypto,WebSocket:class{constructor(){throw Error('No realtime in snapshot fixture');}}});vm.runInContext(fs.readFileSync(path.join(root,'vendor/supabase-2.116.0.min.js'),'utf8'),sdk);
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};const plain=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));let checks=0;const eq=(a,b,label)=>{assert.deepEqual(plain(a),plain(b),label);checks++;};const now=Date.parse('2026-11-21T02:00:00Z');class FixedDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
function fixture(count=240,options={}){
 const rows=Array.from({length:count},(_,n)=>({id:'current-'+n,athlete_id:'rider',category:n%2?'one_bang':'percentage',trick_name:'Current '+n,week_start:'2026-11-15',venue:n%3?'Village':'Oasis'}));
 const historical=Array.from({length:3000},(_,n)=>({assignment_id:'old-'+n,athlete_id:'rider',completed_at:'2026-01-01',attempt_number:1,landed:true}));
 const current=rows.map((a,n)=>({assignment_id:a.id,athlete_id:'rider',completed_at:'2026-11-20',attempt_number:n%10+1,landed:true}));
 const tables={assignment_progress:[...historical,...current],percentage_attempts:[...historical,...current],assignment_point_awards:[{id:'daily-receipt',athlete_id:'rider',award_key:'daily-complete:Park:2026-11-20',points:1,assignment_id:null},{id:'weekly-receipt',athlete_id:'rider',assignment_id:rows[0]?.id,points:2}],assignment_attempts:count?[{id:'current-attempt',athlete_id:'rider',week_start:'2026-11-15',assignment_id:rows[0].id}]:[]};
 let clock=now;class TestDate extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const calls=[],budgets=[],arrivals=[],countryGate=deferred(),state={user:{id:options.realCountry?'coach':'rider'},profile:{country_code:options.country||'AU'},sessionSetupVersion:1,view:'student',cache:{},inFlight:new Map()};
 const context={state,Date:TestDate,Set,Map,Promise,Number,String,Error,AbortController,setTimeout,clearTimeout,getAthleteCountryCode:()=>options.holdCountry?countryGate.promise:Promise.resolve(options.country||'AU'),weekStartDateForCountry:code=>code==='DE'?'2026-11-16':'2026-11-15',categoryInfo:{one_bang:{},percentage:{}},normalizeAssignmentProgress:(_,p)=>p||null,reconcileAwardedProgress:(_,p,awards)=>({...p,verifiedAwardCount:awards.length})};
 context.client=sdk.supabase.createClient('https://snapshot.example.test','synthetic-key',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(address,init)=>{
  const url=new URL(address),name=url.pathname.split('/').pop();assert(url.origin==='https://snapshot.example.test'&&((url.pathname.startsWith('/rest/v1/rpc/')&&['ensure_current_week_assignments','get_current_training_snapshot'].includes(name))||(options.realCountry&&name==='profiles')),'No table/history or legacy read fallback is allowed');
  const call={name,args:JSON.parse(init.body||'{}'),signal:init.signal,gate:deferred()};calls.push(call);arrivals.forEach(waiter=>{if(calls.filter(c=>c.name===waiter.name).length>=waiter.n)waiter.resolve();});
  if(name==='profiles'){if(options.hangCountry)return await new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));return new Response(JSON.stringify({country_code:options.country||'AU'}),{headers:{'content-type':'application/json'}});}
  if(name==='ensure_current_week_assignments'){
   if(options.hangRollover)return await new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
   if(options.holdRollover)await call.gate.promise;
   return new Response(JSON.stringify(options.rolloverDenied?{message:'Not allowed'}:0),{status:options.rolloverDenied?403:200,headers:{'content-type':'application/json'}});
  }
  const ids=new Set(rows.map(row=>row.id));
  call.data={assignments:rows,progress:tables.assignment_progress.filter(row=>ids.has(row.assignment_id)),percentage_attempts:tables.percentage_attempts.filter(row=>ids.has(row.assignment_id)).sort((a,b)=>a.attempt_number-b.attempt_number),awards:tables.assignment_point_awards,assignment_attempts:call.args.p_include_assignment_attempts?tables.assignment_attempts:[]};
  if(options.bad==='shape')call.data={assignments:rows};
  if(options.bad==='rider'&&count)call.data.assignments=[{...rows[0],athlete_id:'foreign-rider'},...rows.slice(1)];
  if(options.bad==='history')call.data.progress=[historical[0]];
  if(options.bad==='award')call.data.awards=[{athlete_id:'foreign-rider',points:1}];
  if(options.holdSnapshot)await call.gate.promise;
  if(options.hang)return await new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
  return new Response(JSON.stringify(options.status?{message:'Snapshot unavailable'}:call.data),{status:options.status||200,headers:{'content-type':'application/json'}});
 }}});
 vm.createContext(context);vm.runInContext(['cacheGet','cacheSet','cacheClear','withTimeout',...(options.realCountry?['getAthleteCountryCode']:[]),'getWeeklyAssignments'].map(extract).join('\n'),context);
 const timeout=context.withTimeout;context.withTimeout=(p,label,ms)=>{budgets.push({label,ms});eq(ms>0&&ms<=10000,true,'Every stage stays within the original10s budget');return timeout(p,label,options.shortTimeout?20:ms);};
 return{context,state,calls,rows,tables,countryGate,budgets,advance(ms){clock+=ms;},wait(name,n=1){if(calls.filter(c=>c.name===name).length>=n)return Promise.resolve();const d=deferred();arrivals.push({name,n,resolve:d.resolve});return d.promise;}};
}
(async()=>{
 {
  const f=fixture(),result=await f.context.getWeeklyAssignments('rider');
  eq(f.calls.map(c=>c.name),['ensure_current_week_assignments','get_current_training_snapshot'],'Existing rollover remains separate before one snapshot, replacing five reads');
  eq(f.calls[0].args,{p_athlete_id:'rider',p_week_start:'2026-11-15'},'Rollover arguments are unchanged');eq(Boolean(f.calls[0].signal),true,'Separate idempotent rollover shares the logical read cancellation');eq(f.calls[0].signal,f.calls[1].signal,'Rollover and snapshot use one shared AbortController');
  eq(f.calls[1].args,{p_athlete_id:'rider',p_week_start:'2026-11-15',p_awards_since:'2026-11-13T02:00:00.000Z',p_include_assignment_attempts:true},'Snapshot preserves rider/week,exact8day cutoff and default full attempts');
  eq(result.assignments.length,240,'Every current multi-venue assignment is retained');eq(result.percentageAttempts.length,240,'Three thousand old percentage records stay outside the snapshot');eq(result.assignments.filter(a=>a.progress?.completed_at).length,240,'Every current completion maps back to its assignment');
  eq(result.percentageAttempts.map(a=>a.attempt_number),result.percentageAttempts.map(a=>a.attempt_number).sort((a,b)=>a-b),'Server attempt-number ordering is preserved');eq(result.awards[0].award_key,'daily-complete:Park:2026-11-20','Detached Daily point receipts are retained');eq(result.assignments[0].progress.verifiedAwardCount,1,'Current assignment awards still pass through existing reconciliation');eq(result.assignmentAttempts.length,1,'Full weekly attempt history remains available');eq(result.assignments.every(a=>a.athlete_country_code==='AU'),true,'Country context remains attached to every assignment');eq(f.tables.assignment_progress.length,3240,'Read adoption never changes historical records');
  await f.context.getWeeklyAssignments('rider');eq(f.calls.length,2,'Existing non-Session cache avoids another rollover/read');f.state.view='session';await f.context.getWeeklyAssignments('rider');eq(f.calls.length,4,'Session still refreshes its current sheet instead of using a stale short cache');
 }
 {
  const f=fixture(1500),result=await f.context.getWeeklyAssignments('rider');eq(result.assignments.length,1500,'JSON snapshot retains more than1000 effective assignment rows');eq(f.calls.length,2,'Large sheet still needs one snapshot read');
 }
 {
  const f=fixture(0),result=await f.context.getWeeklyAssignments('rider',{includeAssignmentAttempts:false});eq(result.assignments,[],'An authoritatively empty sheet remains empty');eq(result.assignmentAttempts,[],'Summary explicitly omits full attempt rows');eq(result.awards.length,2,'Empty current sheet retains detached recent receipts');eq(f.calls[1].args.p_include_assignment_attempts,false,'Attempt omission reaches the protected snapshot');
 }
 {
  const f=fixture(2,{country:'DE'}),result=await f.context.getWeeklyAssignments('rider');eq(f.calls[1].args.p_week_start,'2026-11-16','Rider country selects the existing local week');eq(result.assignments[0].athlete_country_code,'DE','Reconciliation retains requested rider-country context');
 }
 {
  const f=fixture(2,{holdSnapshot:true}),first=f.context.getWeeklyAssignments('rider'),second=f.context.getWeeklyAssignments('rider');await f.wait('get_current_training_snapshot');eq(f.calls.length,2,'Concurrent Home/Session consumers share rollover and snapshot');f.calls[1].gate.resolve();eq((await Promise.all([first,second])).map(r=>r.assignments.length),[2,2],'Both coalesced consumers get the complete current sheet');
 }
 {
  const f=fixture(2,{holdSnapshot:true}),older=f.context.getWeeklyAssignments('rider');await f.wait('get_current_training_snapshot');f.context.cacheClear('schedule:rider:');const newer=f.context.getWeeklyAssignments('rider',{force:true});await f.wait('get_current_training_snapshot',2);f.calls[3].data.assignments=[{...f.rows[0],trick_name:'New verified list'}];f.calls[3].data.progress=[];f.calls[3].data.percentage_attempts=[];f.calls[3].gate.resolve();await newer;f.calls[1].gate.resolve();await older;eq(f.context.cacheGet('schedule:rider:2026-11-15:full').assignments[0].trick_name,'New verified list','Older invalidated read cannot overwrite newer explicitly refreshed sheet');
 }
 for(const stage of ['country','rollover','snapshot']){
  const f=fixture(2,{holdCountry:stage==='country',holdRollover:stage==='rollover',holdSnapshot:stage==='snapshot'}),reading=f.context.getWeeklyAssignments('rider'),rejected=assert.rejects(reading,/account access changed/);
  if(stage!=='country')await f.wait(stage==='rollover'?'ensure_current_week_assignments':'get_current_training_snapshot');
  f.state.user={id:'other-rider'};f.state.sessionSetupVersion++;
  if(stage==='country')f.countryGate.resolve('AU');else f.calls.at(-1).gate.resolve();await rejected;checks++;
  eq(Object.keys(f.state.cache).length,0,stage+': stale actor enters no cache');eq(f.calls.length,stage==='country'?0:stage==='rollover'?1:2,stage+': stale context launches no subsequent read/write');eq(f.state.inFlight.size,0,stage+': obsolete request releases its guard');
 }
 for(const bad of ['shape','rider','history','award']){
  const f=fixture(2,{bad});await assert.rejects(f.context.getWeeklyAssignments('rider'),/could not be verified|did not match/);checks++;eq(Object.keys(f.state.cache).length,0,bad+': invalid snapshot enters no cache');eq(f.calls.length,2,bad+': invalid snapshot never falls back to historical table reads');
 }
 for(const status of [403,500,503]){
  const f=fixture(2,{status});await assert.rejects(f.context.getWeeklyAssignments('rider'),error=>/Snapshot unavailable/.test(error.message));checks++;eq(f.calls.length,2,'Failed snapshot adds no retries or legacy table fallback');eq(f.state.inFlight.size,0,'Failed snapshot releases the read guard');
 }
 {
  const f=fixture(2,{rolloverDenied:true});eq((await f.context.getWeeklyAssignments('rider')).assignments.length,2,'Existing not-allowed rollover handling still permits an authorized read');eq(f.calls.length,2,'A denied rollover is not retried');
 }
 {
  const f=fixture(2,{hang:true,shortTimeout:true});await assert.rejects(f.context.getWeeklyAssignments('rider'),/timed out/);checks++;eq(f.calls[1].signal.aborted,true,'Stalled snapshot request is actually aborted');eq(f.state.inFlight.size,0,'Timeout releases its in-flight entry for explicit retry');eq(Object.keys(f.state.cache).length,0,'Timeout never caches a fabricated empty list');eq(f.calls.length,2,'Timeout adds no write/read retry');
 }

 {
  const f=fixture(2,{holdSnapshot:true}),first=f.context.getWeeklyAssignments('rider'),shared=f.context.getWeeklyAssignments('rider');await f.wait('get_current_training_snapshot');eq(f.calls.length,2,'A soft cold caller shares one current-generation rollover and snapshot');f.calls[1].gate.resolve();await Promise.all([first,shared]);eq(f.calls.length,2,'Soft cold coalescing adds no trailing duplicate');
 }
 for(const changed of ['invalidation','data-version']){
  const f=fixture(2,{holdSnapshot:true}),first=f.context.getWeeklyAssignments('rider');await f.wait('get_current_training_snapshot');if(changed==='invalidation')f.context.cacheClear('schedule:rider:');else f.state.sessionViewerDataVersion=1;const second=f.context.getWeeklyAssignments('rider');await f.wait('get_current_training_snapshot',2);eq(f.calls.length,4,changed+': a soft caller cannot reuse an invalidated generation');f.calls[3].gate.resolve();await second;f.calls[1].gate.resolve();await first;eq(f.calls.length,4,changed+': known change adds no automatic HTTP retries');
 }
 {
  const f=fixture(2,{holdSnapshot:true}),reading=f.context.getWeeklyAssignments('rider');await f.wait('get_current_training_snapshot');for(let n=0;n<10;n++)f.context.cacheClear('schedule:rider:');f.calls[1].gate.resolve();await reading;eq(f.calls.length,2,'Repeated invalidations never create an automatic retry loop');eq(Object.keys(f.state.cache).length,0,'An invalidated generation does not refill the sheet cache');eq(f.state.inFlight.size,0,'Invalidated reader releases its guard for explicit/event refresh');
 }
 for(const stage of ['country','rollover']){
  const f=fixture(2,{realCountry:stage==='country',hangCountry:stage==='country',hangRollover:stage==='rollover',shortTimeout:true});await assert.rejects(f.context.getWeeklyAssignments('rider'),/timed out/);checks++;eq(f.calls.at(-1).signal.aborted,true,stage+': logical deadline aborts the actual SDK transport');eq(f.calls.some(c=>c.name==='get_current_training_snapshot'),false,stage+': no snapshot starts after a hung earlier stage');eq(f.state.inFlight.size,0,stage+': timeout releases all coalescing guards');eq(Object.keys(f.state.cache).length,0,stage+': timeout caches no fabricated sheet');
 }
 {
  const f=fixture(2,{holdCountry:true}),reading=f.context.getWeeklyAssignments('rider');f.advance(6500);f.countryGate.resolve('AU');await reading;eq(f.budgets.map(b=>b.ms),[10000,3500,3500],'Country, rollover and snapshot consume one original absolute10s budget');
 }
 {
  const f=fixture(2,{holdRollover:true}),reading=f.context.getWeeklyAssignments('rider');await f.wait('ensure_current_week_assignments');f.advance(10001);f.calls[0].gate.resolve();await assert.rejects(reading,/timed out/);checks++;eq(f.calls.length,1,'Snapshot cannot start after rollover consumed the logical deadline');eq(f.calls[0].signal.aborted,true,'Expired rollover cancels its shared transport');
 }
 {
  const f=fixture(2,{holdCountry:true}),reading=f.context.getWeeklyAssignments('rider');f.advance(10001);f.countryGate.resolve('AU');await assert.rejects(reading,/timed out/);checks++;eq(f.calls.length,0,'Country lookup time consumes the original logical deadline');
 }
 for(const changed of ['week','country']){
  const f=fixture(2,{holdSnapshot:true}),reading=f.context.getWeeklyAssignments('rider');await f.wait('get_current_training_snapshot');if(changed==='week')f.context.weekStartDateForCountry=()=> '2026-11-22';else f.state.profile={country_code:'DE'};f.calls[1].gate.resolve();await assert.rejects(reading,/week or country changed/);checks++;eq(Object.keys(f.state.cache).length,0,changed+': stale response cannot populate the previous sheet cache');eq(f.state.inFlight.size,0,changed+': stale scope releases its guard');
 }

 for(const emptyCountry of [null,'']){
  const f=fixture(2,{country:'DE',holdSnapshot:true}),reading=f.context.getWeeklyAssignments('rider');await f.wait('get_current_training_snapshot');f.state.profile.country_code=emptyCountry;f.calls[1].gate.resolve();await assert.rejects(reading,/week or country changed/);checks++;eq(Object.keys(f.state.cache).length,0,'DE to missing country fallback cannot cache the old country sheet');
 }

 {
  const f=fixture(2,{holdSnapshot:true}),slowCountry=deferred();let countries=0;f.context.getAthleteCountryCode=()=>++countries===1?slowCountry.promise:Promise.resolve('AU');const follower=f.context.getWeeklyAssignments('rider'),rejected=assert.rejects(follower,/timed out/);f.advance(4000);const owner=f.context.getWeeklyAssignments('rider');await f.wait('get_current_training_snapshot');f.advance(5000);slowCountry.resolve('AU');await new Promise(resolve=>setImmediate(resolve));eq(f.calls.length,2,'Slow-country follower shares the later owner transport');eq(f.calls[1].signal.aborted,false,'Follower wait never cancels the owner transport');f.advance(1500);f.calls[1].gate.resolve();eq((await owner).assignments.length,2,'Later owner may finish inside its own absolute budget');await rejected;checks++;
 }
 console.log(`PASS: ${checks} actual-SDK current-training snapshot,history,reconciliation,cache,scope and abort checks.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
