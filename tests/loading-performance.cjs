const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), vm = require('node:vm'), http = require('node:http');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..'), source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const extract = name => { const start = source.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm')); assert(start >= 0, name); const rest = source.slice(start); return rest.slice(0, rest.indexOf('\n}') + 2); };
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
async function dataChecks() {
  const calls = [], state = { user: {id:'coach'}, profile:{id:'coach',role:'coach'}, inFlight:new Map() };
  const rows = {run_plans:[{id:'run',athlete_id:'rider',coach_id:'coach',title:'Finals',image_data_url:'x'.repeat(3*1024*1024),points:[{x:1,y:2}]}],coach_athletes:[{athlete_id:'rider'}],profiles:[{id:'rider',display_name:'Rider',avatar:'x'.repeat(70000),manual_tricktionary:{large:true}}],event_course_photos:[{event_id:'event',image_data_url:'photo',updated_at:'today'}]};
  let photoGate = deferred();
  const client = {from(table){const call={table,columns:'*',filters:[]};calls.push(call);const q={select(c){call.columns=c;return q},eq(k,v){call.filters.push([k,v]);return q},in(k,v){call.filters.push([k,v]);return q},order(){return q},limit(){return q},maybeSingle(){return photoGate.promise},then(resolve,reject){const data=rows[table].map(r=>Object.fromEntries(Object.entries(r).filter(([k])=>call.columns.split(',').includes(k))));return Promise.resolve({data}).then(resolve,reject)}};return q}};
  const ctx=vm.createContext({state,client,Date,Promise,Map});
  vm.runInContext(source.match(/^const RUN_SUMMARY_SELECT = .*$/m)[0]+'\nlet recentEventCoursePhoto=null;\n'+['getRiderRunSummaries','getEventCoachRoster','getCoachContestRunPlans','getEventCoursePhoto'].map(extract).join('\n'),ctx);
  const roster = await ctx.getEventCoachRoster();
  const runs=await ctx.getCoachContestRunPlans(['event'],roster);await ctx.getRiderRunSummaries('rider');
  assert(calls.every(c=>!c.columns.includes('image_data_url')&&!c.columns.includes('avatar')&&c.columns!=='*'));
  assert(calls.every(c=>!['training_sessions','coach_athlete_groups'].includes(c.table)));
  assert(JSON.stringify(runs).length<300);
  assert(calls.find(c=>c.table==='run_plans').filters.some(([k,v])=>k==='coach_id'&&v==='coach'));
  assert(calls.at(-1).filters.some(([k,v])=>k==='athlete_id'&&v==='rider'));
  const one=ctx.getEventCoursePhoto('event'),two=ctx.getEventCoursePhoto('event');
  assert.equal(calls.filter(c=>c.table==='event_course_photos').length,1);
  photoGate.resolve({data:rows.event_course_photos[0]});await Promise.all([one,two]);await ctx.getEventCoursePhoto('event');
  assert.equal(calls.filter(c=>c.table==='event_course_photos').length,1,'Recent course is reused without another photo request');
  state.user={id:'another-rider'};await ctx.getEventCoursePhoto('event');
  assert.equal(calls.filter(c=>c.table==='event_course_photos').length,2,'Another account must query its own authorized photo');
  photoGate=deferred();const failed=ctx.getEventCoursePhoto('other-event');photoGate.reject(new Error('offline'));await assert.rejects(failed,/offline/);assert.equal(state.inFlight.size,0);
  photoGate=deferred();const retry=ctx.getEventCoursePhoto('other-event');photoGate.resolve({data:rows.event_course_photos[0]});await retry;
  let callsToSession=0, sessionGate=deferred(), hasView=true;
  const authState={profile:{id:'rider'}};
  const auth=vm.createContext({state:authState,document:{querySelector:()=>hasView?{}:null},Promise,handleSession:()=>{callsToSession++;return sessionGate.promise}});
  vm.runInContext(extract('handleSessionOnce'),auth);
  const session={user:{id:'rider'}};const first=auth.handleSessionOnce(session),second=auth.handleSessionOnce(session);assert.equal(callsToSession,1);
  sessionGate.resolve();await Promise.all([first,second]);authState.sessionReadyUserId='rider';await auth.handleSessionOnce(session);assert.equal(callsToSession,1,'Late INITIAL_SESSION must not restart the dashboard');
  hasView=false;await auth.handleSessionOnce(session);assert.equal(callsToSession,2,'Recovery without app shell must still initialize');
}
async function workerChecks() {
 const handlers={}, stores=new Map(), networkCalls=[];let network=deferred();
 const origin='https://jkcrew.test/';
 const key=x=>new URL(typeof x==='string'?x:x.url,origin).href;
 const cache={match:async x=>stores.get(key(x)),put:async(x,r)=>stores.set(key(x),r)};
 const worker=vm.createContext({self:{location:{origin:'https://jkcrew.test',href:origin+'sw.js'},addEventListener:(n,fn)=>handlers[n]=fn},caches:{open:async()=>cache},URL,Set,Promise,fetch:r=>{networkCalls.push(r);return network.promise}});
 vm.runInContext(fs.readFileSync(path.join(root,'sw.js'),'utf8'),worker);
 const dispatch=(url,mode='cors')=>{let result;const waits=[];handlers.fetch({request:{url,method:'GET',mode},respondWith:p=>result=p,waitUntil:p=>waits.push(p)});return {result,waits}};
 stores.set(origin+'index.html','cached-shell');stores.set(origin+'app.js?v=2.14.82','cached-js');stores.set(origin+'vendor/supabase-2.116.0.min.js','cached-sdk');
 const html=dispatch(origin+'?push=contests','navigate');assert.equal(await html.result,'cached-shell','Navigation must finish while network remains unresolved');
 const count=networkCalls.length;assert.equal(await dispatch(origin+'app.js?v=2.14.82').result,'cached-js');assert.equal(await dispatch(origin+'vendor/supabase-2.116.0.min.js').result,'cached-sdk');assert.equal(networkCalls.length,count);
 assert.equal(dispatch('https://soanwttlorlgdfrzbvtp.supabase.co/rest/v1/run_plans').result,undefined);
 assert.equal(dispatch(origin+'private-data.json').result,undefined);
 assert.equal(dispatch(origin+'riley-test/','navigate').result,undefined,'Nested app navigation must not receive the root app shell');
 network.reject(new Error('offline'));await Promise.all(html.waits);
 network=deferred();const missing=dispatch(origin+'styles.css?v=2.14.82');network.resolve({ok:false,status:404});assert.equal((await missing.result).status,404);assert(!stores.has(origin+'styles.css?v=2.14.82'));
}
async function browserChecks() {
 const server=http.createServer((req,res)=>{let file=decodeURIComponent(new URL(req.url,'http://test').pathname);if(file==='/')file='/index.html';const filename=path.join(root,file);if(!filename.startsWith(root)||!fs.existsSync(filename)){res.writeHead(404);return res.end()};const type=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream';res.setHeader('content-type',type);res.end(fs.readFileSync(filename))});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH});
 try {
  const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  // Fonts never arrive, the former SDK CDN is unavailable: the real sign-in form still works.
  const fontGate=deferred();await page.route('https://fonts.googleapis.com/**',async route=>{await fontGate.promise;await route.abort()});
  await page.route('https://fonts.gstatic.com/**',r=>r.abort());await page.route('https://cdn.jsdelivr.net/**',r=>r.abort());
  await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'domcontentloaded'});
  await page.locator('#auth-form').waitFor({timeout:4000});assert(await page.locator('#email').isEnabled());await page.locator('#email').fill('rider@example.test');assert.equal(await page.inputValue('#email'),'rider@example.test');
  assert(await page.evaluate(()=>Boolean(window.supabase?.createClient)),'Bundled SDK initializes without the CDN');
  fontGate.resolve();await page.getByRole('button',{name:'Forgot password?',exact:true}).click();await page.locator('#forgot-password-form').waitFor({timeout:3000});
  await page.close();
  const quick=await browser.newPage({viewport:{width:390,height:844}});quick.on('pageerror',e=>errors.push(e.message));
  await quick.setContent('<base href="http://127.0.0.1:'+server.address().port+'/"><div id="app"><main id="view"></main><button id="tab">Session tab</button></div>');
  await quick.addStyleTag({content:fs.readFileSync(path.join(root,'styles.css'),'utf8')});
  await quick.addScriptTag({content:`
    const app=document.querySelector('#app');const state={view:'command',profile:{role:'coach'},user:{id:'coach'},loadingOverlayToken:0};
    const escapeHtml=s=>s;const isCoachRole=r=>r==='coach';const openRunBuilder=()=>{state.view='contests';document.querySelector('#view').innerHTML='<input id="draft" value="My draft">';};const navigate=v=>{state.view=v};
    ${['loadingScreenCopy','cancelScreenLoading','beginScreenLoading','finishScreenLoading','setLoading'].map(extract).join('\n')}
    setLoading();document.querySelector('#tab').onclick=()=>{state.view='session';document.querySelector('#view').textContent='Session ready'};
  `});
  await quick.locator('#screen-loading-overlay').waitFor();
  assert(await quick.locator('.screen-loading-brand').isVisible());
  await quick.screenshot({path:'/tmp/jkcrew-restored-loading.png'});
  assert.equal(await quick.locator('.quick-page-loading').count(),0,'Restore the branded loader requested by the user');
  await quick.evaluate(()=>finishScreenLoading(state.loadingOverlayToken));
  assert.equal(await quick.evaluate(()=>app.inert),false);
  // Event lists render lightweight cards; opening one loads just that full run,
  // including archived plans, without dropping rider/coach editing controls.
  await quick.addScriptTag({content:`
    const dateLabel=s=>s||'Today';const canEditRun=()=>true;const runReviewPanelHtml=()=>'';
    const runMapHtml=()=>'<div data-loaded-photo>Park photo</div>';const runPlaybackControlsHtml=()=>'';
    let photoLoads=0;const client={from:()=>{let id;const q={select(){return q},eq(k,v){id=v;return q},is(){return q},single(){photoLoads++;return Promise.resolve({data:{id,title:'Finals',image_data_url:'photo',points:[{x:1,y:2}],archived_at:id==='archived'?'Yesterday':null}})}};return q;}};
    const messageFrom=e=>e.message;const notify=m=>{throw Error(m)};
    const openCoachEventRunModal=(runs,name,item)=>{document.querySelector('#view').innerHTML=coachEventRunViewerHtml(runs,name,item)};
    ${['runSummaryCardHtml','runPlansHtml','coachEventRunViewerHtml','openProgressRun','setButtonBusy','withTimeout'].map(extract).join('\n')}
    document.querySelector('#view').innerHTML=coachEventRunViewerHtml([{id:'first',title:'First'},{id:'second',title:'Second'}],'Rider');
    document.addEventListener('click',e=>{const b=e.target.closest('[data-open-progress-run]');if(b)void openProgressRun(b)});
  `});
  assert.equal(await quick.evaluate(()=>photoLoads),0);assert.equal(await quick.locator('[data-loaded-photo]').count(),0);
  await quick.locator('[data-open-progress-run="second"]').click();await quick.locator('[data-loaded-photo]').waitFor();assert.equal(await quick.evaluate(()=>photoLoads),1);assert(await quick.getByRole('button',{name:'Edit this run',exact:true}).isVisible());
  await quick.evaluate(()=>document.querySelector('#view').innerHTML=runPlansHtml([{id:'archived',title:'Old finals',archived_at:'Yesterday'}]));
  await quick.locator('[data-open-progress-run="archived"]').click();await quick.locator('[data-loaded-photo]').waitFor();assert.equal(await quick.evaluate(()=>photoLoads),2);
  assert.deepEqual(errors,[]);await quick.close();
 } finally {await browser.close();await new Promise(r=>server.close(r));}
}
(async()=>{await dataChecks();await workerChecks();await browserChecks();console.log('PASS: small metadata-only run/roster queries, photo reuse and retry, auth initialization deduplication, immediate cached shell/SDK with a stalled network, uncached private responses, usable sign-in with unavailable external fonts/CDN, restored branded loader and usable navigation after loading.');})().catch(e=>{console.error(e);process.exit(1)});
