// Actual shipped Supabase SDK + actual app read helper. Fetch is intercepted;
// no production requests, accounts, browser or database mutations are used.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'app.js'),'utf8');
const extract=name=>{const start=source.search(new RegExp(`^(?:async )?function ${name}\\(`,'m'));assert(start>=0,name);const rest=source.slice(start);return rest.slice(0,rest.indexOf('\n}')+2);};
const sdk=vm.createContext({console,URL,URLSearchParams,Request,Response,Headers,fetch,AbortController,DOMException,TextEncoder,TextDecoder,setTimeout,clearTimeout,setInterval,clearInterval,atob,btoa,crypto:require('node:crypto').webcrypto,WebSocket:class{constructor(){throw Error('No realtime in paging fixture');}}});
vm.runInContext(fs.readFileSync(path.join(root,'vendor/supabase-2.116.0.min.js'),'utf8'),sdk);
let checks=0;const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};const ok=(a,label)=>{assert(a,label);checks++;};
const pageRows=(rider,count)=>Array.from({length:count},(_,n)=>({id:`${rider}-a-${String(n).padStart(5,'0')}`,athlete_id:rider,category:n%2?'daily':'percentage',sort_order:n,week_start:'2026-11-15',percentage_attempt_count:2,percentage_attempts:[{attempt_number:1,landed:true}],assignment_attempts:[{attempts:3}],awards:[{points:1}],progress:{streak_count:1}}));
function fixture(rows,options={}){
 let arrived,release;const arrivedPromise=new Promise(resolve=>{arrived=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 let now=100000,active=0,maxActive=0;const calls=[],budgets=[],cache={},inFlight=new Map();
 const state={user:{id:'coach'},sessionSetupVersion:1,sessionViewerDataVersion:1,view:'sessionViewer',loadingOverlayToken:1,cache,inFlight};
 const context={state,Map,Set,Promise,Number,Error,AbortController,setTimeout,clearTimeout,Date:class extends Date{static now(){return now;}},categoryInfo:{daily:{},percentage:{}},weekStartDateForCountry:code=>code==='DE'?'2026-11-16':'2026-11-15',reconcileAwardedProgress:(_a,p)=>p,cacheGet:key=>cache[key]||null,cacheSet:(key,value)=>{cache[key]=value;return value;}};
 context.client=sdk.supabase.createClient('https://paging.example.test','synthetic-key',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(address,init)=>{
  const url=new URL(address);assert(url.origin==='https://paging.example.test'&&url.pathname.startsWith('/rest/v1/rpc/get_coach_session_viewer_plan_'),'Only intercepted viewer RPCs allowed');
  const args=JSON.parse(init.body),offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||1000),name=url.pathname.split('/').pop();
  const call={name,args,offset,limit,order:url.searchParams.get('order'),signal:init.signal};calls.push(call);active++;maxActive=Math.max(maxActive,active);
  try{
   await Promise.resolve();
   if(options.gateAt===calls.length){arrived();await gate;}
   if(options.hangAt===calls.length)return await new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
   if(options.failAt===calls.length)return new Response(JSON.stringify({message:'Later page failed'}),{status:503,headers:{'content-type':'application/json'}});
   let selected=rows.filter(row=>args.p_athlete_ids.includes(row.athlete_id)).sort((a,b)=>a.athlete_id.localeCompare(b.athlete_id)||a.sort_order-b.sort_order||a.id.localeCompare(b.id));
   // Model the real API's hard1000 cap even when callers forget a range.
   let page=selected.slice(offset,offset+Math.min(limit,1000));
   if(options.foreignAt===calls.length&&page.length)page[0]={...page[0],athlete_id:'foreign-rider'};
   if(options.duplicateAt===calls.length&&page.length)page[0]=selected[0];
   if(options.scopeAt===calls.length){if(options.scope==='actor')state.user={id:'other-coach'};else if(options.scope==='setup')state.sessionSetupVersion++;else if(options.scope==='data')state.sessionViewerDataVersion++;else if(options.scope==='view')state.view='home';else state.loadingOverlayToken++;}
   now+=options.cost||0;
   return new Response(JSON.stringify(page),{status:200,headers:{'content-type':'application/json','content-range':page.length?`${offset}-${offset+page.length-1}/*`:'*/*'}});
  }finally{active--;}
 }}});
 vm.createContext(context);vm.runInContext(extract('withTimeout')+'\n'+extract('getSessionViewerPlanData'),context);
 const timeout=context.withTimeout;context.withTimeout=(promise,label,ms)=>{budgets.push(ms);return timeout(promise,label,options.shortTimeout?Math.min(ms,20):ms);};
 return {context,state,calls,budgets,cache,inFlight,arrived:arrivedPromise,release,get maxActive(){return maxActive;}};
}
const count=result=>[...result.assignmentsByAthlete.values()].reduce((sum,rows)=>sum+rows.length,0);
const roster=ids=>ids.map((id,index)=>({id,country_code:index%2?'DE':'AU'}));
(async()=>{
 const ids=Array.from({length:35},(_,n)=>`r${String(n).padStart(2,'0')}`),rows=ids.flatMap(id=>pageRows(id,50));
 {
  const f=fixture(rows),result=await f.context.getSessionViewerPlanData(roster(ids),{detailAthleteIds:ids});
  eq(count(result),1750,'All35 riders and1750 assignments survive the1000-row API cap');
  eq([...result.assignmentsByAthlete.keys()].length,35,'No rider disappears after the cap boundary');
  eq(f.calls.length,10,'Summary and detail each use five sequential batches of at most8 riders');
  ok(f.calls.every(call=>call.args.p_athlete_ids.length<=8&&call.limit===500),'Every SDK query bounds rider batch and page size');
  ok(f.calls.every(call=>call.order==='athlete_id.asc,sort_order.asc,id.asc'),'Every page has stable rider/sheet/ID ordering');
  ok(f.calls.every(call=>call.args.p_athlete_ids.every((id,i)=>call.args.p_week_starts[i]=== (Number(id.slice(1))%2?'2026-11-16':'2026-11-15'))),'Each batch preserves rider country/week alignment');
  eq(f.maxActive,2,'At most one summary page and one detail page are in flight');
  eq(result.assignmentsByAthlete.get('r00')[0].percentageAttempts[0].landed,true,'Detail attempts remain intact after paging');
  eq(result.assignmentsByAthlete.get('r00')[0].assignmentAttempts[0].attempts,3,'Nested assignment-attempt data remains intact');
  eq(result.assignmentsByAthlete.get('r00')[0].awards[0].points,1,'Nested point evidence remains intact');
  const before=f.calls.length;await f.context.getSessionViewerPlanData(roster(ids),{detailAthleteIds:ids});eq(f.calls.length,before,'Complete summary/detail caches are reused');
 }
 for(const total of [0,499,500,501,1000,1001,1500]){
  const f=fixture(pageRows('rider',total)),result=await f.context.getSessionViewerPlanData(roster(['rider']));
  eq(count(result),total,`Boundary${total}: no missing or duplicated assignments`);
  eq(f.calls.length,Math.floor(total/500)+1,`Boundary${total}: exact full pages receive an explicit terminal read`);
  eq(f.calls.map(call=>call.offset),Array.from({length:f.calls.length},(_,n)=>n*500),`Boundary${total}: SDK offsets progress by500`);
  eq(f.maxActive,1,`Boundary${total}: summary pages stay sequential`);
 }
 for(const kind of ['foreignAt','duplicateAt','failAt']){
  const f=fixture(pageRows('rider',1001),{[kind]:2});
  await assert.rejects(f.context.getSessionViewerPlanData(roster(['rider'])),kind==='foreignAt'?/requested team/:kind==='duplicateAt'?/changed while loading/:error=>/Later page failed/.test(error.message));checks++;
  eq(Object.keys(f.cache).length,0,kind+': no partial sheet enters cache');eq(f.inFlight.size,0,kind+': failed logical read releases single-flight state');eq(f.calls.length,2,kind+': no automatic retry or later page');
 }
 for(const scope of ['actor','setup','data']){
  const f=fixture(pageRows('rider',1001),{scopeAt:1,scope});
  await assert.rejects(f.context.getSessionViewerPlanData(roster(['rider'])),/access or session list changed/);checks++;
  eq(f.calls.length,1,scope+': stale scope starts no next page');eq(Object.keys(f.cache).length,0,scope+': stale scope writes no cache');eq(f.inFlight.size,0,scope+': stale request releases its guard');
 }
 {
  const f=fixture(pageRows('rider',1500),{cost:4000});
  await assert.rejects(f.context.getSessionViewerPlanData(roster(['rider'])),/timed out/);checks++;
  eq(f.budgets,[10000,6000,2000],'All pages consume one logical10s budget');eq(f.calls.length,3,'No page starts after the logical deadline');eq(Object.keys(f.cache).length,0,'Late final response never enters cache');
 }
 {
  const f=fixture(pageRows('rider',1001),{hangAt:2,shortTimeout:true});
  await assert.rejects(f.context.getSessionViewerPlanData(roster(['rider'])),/timed out/);checks++;
  eq(f.calls[1].signal.aborted,true,'Deadline aborts the underlying hung page');eq(f.calls.length,2,'Hung page adds no retry/fanout');eq(f.inFlight.size,0,'Hung read releases its guard');eq(Object.keys(f.cache).length,0,'Hung read caches no partial map');
 }
 {
  const f=fixture(pageRows('rider',501));const [a,b]=await Promise.all([f.context.getSessionViewerPlanData(roster(['rider'])),f.context.getSessionViewerPlanData(roster(['rider']))]);eq(count(a),501,'First coalesced caller receives the whole sheet');eq(count(b),501,'Second coalesced caller receives the whole sheet');eq(f.calls.length,2,'Concurrent identical reads share every page');
  const before=f.calls.length;await Promise.all([f.context.getSessionViewerPlanData(roster(['rider']),{force:true}),f.context.getSessionViewerPlanData(roster(['rider']),{force:true})]);eq(f.calls.length-before,2,'Concurrent forced reads bypass cache but share the force-key page chain');
 }
 for(const scope of ['view','navigation']) {
  const f=fixture(pageRows('rider',501),{gateAt:1});
  const first=f.context.getSessionViewerPlanData(roster(['rider']));await f.arrived;
  if(scope==='view')f.state.view='another-view';else f.state.loadingOverlayToken++;
  const second=f.context.getSessionViewerPlanData(roster(['rider']));f.release();
  const results=await Promise.all([first,second]);
  eq(results.map(count),[501,501],scope+': a valid shared read survives navigation and serves the new consumer');
  eq(f.calls.length,2,scope+': new consumer shares both existing pages without a stale-navigation rejection');
 }
 {
  const f=fixture(rows),detail=await f.context.getSessionViewerPlanData(roster(ids),{includeSummary:false,detailAthleteIds:['r00']});
  eq(count(detail),50,'Detail-only path returns the selected rider without a crew summary');eq(f.calls.map(c=>c.name),['get_coach_session_viewer_plan_data'],'Foreground detail starts no summary read');
  const completed=[],sizes=[];await f.context.getSessionViewerPlanData(roster(ids),{onSummaryBatch:batch=>{completed.push(batch.completedAthleteIds.length);sizes.push([...batch.assignmentsByAthlete.values()].reduce((n,a)=>n+a.length,0));}});
  eq(completed,[8,16,24,32,35],'Background callbacks expose only complete rider batches');eq(sizes,[400,800,1200,1600,1750],'Progressive callbacks retain every verified row without REST truncation');
  eq(f.calls.length,6,'One selected detail precedes the existing five summary batches');
 }
 {
  const f=fixture(pageRows('rider',1001)),completed=[];await f.context.getSessionViewerPlanData(roster(['rider']),{onSummaryBatch:batch=>completed.push([...batch.assignmentsByAthlete.values()][0].length)});
  eq(completed,[1001],'A rider spanning pages is never published with incomplete counters');
 }
 {
  const f=fixture(rows,{gateAt:1}),a=[],b=[];
  const first=f.context.getSessionViewerPlanData(roster(ids),{onSummaryBatch:batch=>a.push(batch.completedAthleteIds.length)});await f.arrived;
  const second=f.context.getSessionViewerPlanData(roster(ids),{onSummaryBatch:batch=>b.push(batch.completedAthleteIds.length)});f.release();await Promise.all([first,second]);
  eq(a,[8,16,24,32,35],'Original coalesced consumer receives every verified batch');eq(b,a,'Joining consumer subscribes to the same bounded summary chain');eq(f.calls.length,5,'Two progressive consumers create no extra summary requests');
 }
 console.log(`PASS: ${checks} actual-SDK viewer paging,1000-row cap,boundary,deadline,scope and complete-cache checks.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
