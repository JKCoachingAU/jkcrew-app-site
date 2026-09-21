const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), vm = require('node:vm'), http = require('node:http');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..'), source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const extract = name => { const start = source.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm')); assert(start >= 0, name); const rest = source.slice(start); return rest.slice(0, rest.indexOf('\n}') + 2); };
const release = source.match(/^const RELEASE_VERSION = "([^"]+)"/m)[1];
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
 const priorRelease=release.replace(/\d+$/,value=>String(Number(value)-1));
 const prior=new Map(), unrelated=new Map(), namedStores=new Map([[`jkcrew-shell-v${release}`,stores],[`jkcrew-shell-v${priorRelease}`,prior],['jkcrew-riley-shell-v99.0.0',unrelated]]);
 const cacheFor=name=>{const data=namedStores.get(name);assert(data,'Only existing release caches are read');return {match:async x=>data.get(key(x)),put:async(x,r)=>data.set(key(x),r)}};
 const worker=vm.createContext({self:{location:{origin:'https://jkcrew.test',href:origin+'sw.js'},addEventListener:(n,fn)=>handlers[n]=fn},caches:{keys:async()=>[...namedStores.keys()],open:async name=>cacheFor(name)},URL,Set,Promise,fetch:r=>{networkCalls.push(r);return network.promise}});
 vm.runInContext(fs.readFileSync(path.join(root,'sw.js'),'utf8'),worker);
 const dispatch=(url,mode='cors')=>{let result;const waits=[];handlers.fetch({request:{url,method:'GET',mode},respondWith:p=>result=p,waitUntil:p=>waits.push(p)});return {result,waits}};
 stores.set(origin+'index.html','cached-shell');stores.set(origin+('app.js?v='+release),'cached-js');stores.set(origin+'vendor/supabase-2.116.0.min.js','cached-sdk');
 const html=dispatch(origin+'?push=contests','navigate');assert.equal(await html.result,'cached-shell','Navigation must finish while network remains unresolved');
 const count=networkCalls.length;assert.equal(await dispatch(origin+('app.js?v='+release)).result,'cached-js');assert.equal(await dispatch(origin+'vendor/supabase-2.116.0.min.js').result,'cached-sdk');assert.equal(networkCalls.length,count);
 assert.equal(dispatch('https://soanwttlorlgdfrzbvtp.supabase.co/rest/v1/run_plans').result,undefined);
 assert.equal(dispatch(origin+'private-data.json').result,undefined);
 assert.equal(dispatch(origin+'riley-test/','navigate').result,undefined,'Nested app navigation must not receive the root app shell');
 network.reject(new Error('offline'));await Promise.all(html.waits);
 for (const htmlVersion of [release, '99.99.99']) {
  network=deferred(); const old=stores.get(origin+'index.html'); const nav=dispatch(origin,'navigate');
  const response={ok:true,clone(){return this},text:async()=>'<script defer src="app.js?v='+htmlVersion+'"></script>'};network.resolve(response);await Promise.all(nav.waits);
  assert.equal(stores.get(origin+'index.html'),htmlVersion===release?response:old,'An older worker must never cache a newer release document');
 }

 network=deferred();const missing=dispatch(origin+('styles.css?v='+release));network.resolve({ok:false,status:404});assert.equal((await missing.result).status,404);assert(!stores.has(origin+('styles.css?v='+release)));
 network=deferred();const photoUrl=origin+'images/bike-garage/studio-white-v1.webp',photo={ok:true,clone(){return this}};
 const firstPhoto=dispatch(photoUrl);network.resolve(photo);assert.equal(await firstPhoto.result,photo);const photoRequests=networkCalls.length;
 assert.equal(await dispatch(photoUrl).result,photo);assert.equal(networkCalls.length,photoRequests,'Bike photos are reused offline after the first request');
 assert.equal(dispatch(origin+'images/private-rider-photo.webp').result,undefined,'Only the public generated bike assets can be cached');
 assert.equal(dispatch(origin+'riley-test/images/bike-garage/studio-white-v1.webp').result,undefined,'Each app worker handles only its own bike photos');
 for(const name of ['studio-four-top-v5.webp','studio-four-front-v5.webp','studio-top-plastic-v5.webp','studio-front-metal-v5.webp','studio-hardware-v2.webp','studio-metal-v2.webp','studio-chrome-v3.webp','studio-chrome-options-v3.webp','studio-jetfuel-v3.webp','studio-jetfuel-options-v3.webp','studio-chrome-top-stem-v3.webp','studio-chrome-front-stem-v3.webp','studio-lhd-v4.webp','studio-lhd-chrome-v4.webp','studio-lhd-jetfuel-v4.webp',...['street','skatepark','warehouse','rooftop'].flatMap(scene=>['scene-'+scene+'-v4.webp','scene-'+scene+'-v4-thumb.webp'])]) { network=deferred();const response=dispatch(origin+'images/bike-garage/'+name);network.resolve(photo);assert.equal(await response.result,photo,'Optional artwork uses the public cache'); }
 assert(!fs.readFileSync(path.join(root,'sw.js'),'utf8').match(/const APP_SHELL = \[([\s\S]*?)\];/)[1].includes('images/bike-garage/'),'Optional bike photos must not delay app-shell installation');
 for(const name of [('bike-three-model.js?v='+release),'vendor/three.module.min.js','vendor/three.core.min.js','vendor/OrbitControls.js','vendor/RoomEnvironment.js']) { network=deferred();const response=dispatch(origin+name);network.resolve(photo);assert.equal(await response.result,photo,'3D assets load and cache only on demand'); }
 // A deferred page may still need its last release's Garage while offline.
 const retained={ok:true,source:'previous-public-release',clone(){return this}};
 prior.set(origin+'bike-three.js?v='+priorRelease,retained);
 assert.equal(await dispatch(origin+'bike-three.js?v='+priorRelease).result,retained,'Old Garage code uses only its exact retained version URL');
 network=deferred();const notExact=dispatch(origin+'bike-three.js?v='+priorRelease+'&different=1');network.reject(Error('offline'));
 await assert.rejects(notExact.result,/offline/,'A changed query cannot match a different cached URL');
 const retainedPhoto=origin+'images/bike-garage/scene-street-v4.webp';stores.delete(retainedPhoto);prior.set(retainedPhoto,retained);
 const beforePhoto=networkCalls.length;assert.equal(await dispatch(retainedPhoto).result,retained);
 assert.equal(networkCalls.length,beforePhoto,'Version-named public photos reuse the previous release without downloading again');
 assert.equal(stores.get(retainedPhoto),retained,'Immutable public photos are copied into the current offline cache');
 const retainedVendor=origin+'vendor/three.module.min.js';stores.delete(retainedVendor);prior.set(retainedVendor,retained);
 network=deferred();const offlineVendor=dispatch(retainedVendor);network.reject(Error('offline'));
 assert.equal(await offlineVendor.result,retained,'Deferred Garage can load its retained 3D engine while offline');
 assert(!stores.has(retainedVendor),'Offline fallback must not pin an old engine into the new release cache');
 network=deferred();const onlineVendor=dispatch(retainedVendor);const upgraded={ok:true,source:'new-engine',clone(){return this}};network.resolve(upgraded);
 assert.equal(await onlineVendor.result,upgraded,'Online engine upgrades take priority over a retained previous module');
 assert.equal(stores.get(retainedVendor),upgraded);
 const notRetained=origin+'vendor/RoomEnvironment.js';stores.delete(notRetained);prior.delete(notRetained);unrelated.set(notRetained,retained);
 network=deferred();const unrelatedAsset=dispatch(notRetained);network.reject(Error('offline'));
 await assert.rejects(unrelatedAsset.result,/offline/,'Never reuse another app scope cache even with the same public URL');
 assert.equal(dispatch(origin+'rest/v1/profiles?v='+priorRelease).result,undefined,'Old-version fallback never intercepts account data');
 const garageShell=fs.readFileSync(path.join(root,'sw.js'),'utf8').match(/const APP_SHELL = \[([\s\S]*?)\];/)[1];
 assert(!garageShell.includes('bike-'),'Optional Garage scripts and styles must not load during worker install');
 assert(!garageShell.includes('three.module')&&!garageShell.includes('three.core')&&!garageShell.includes('bike-three-model'),'3D model and engine must not block shell installation');
 const entryHTML=fs.readFileSync(path.join(root,'index.html'),'utf8');
 assert(!entryHTML.includes('three.module')&&!entryHTML.includes('bike-three-model'),'3D engine/model must not load on the sign-in page');
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
    ${['runRemovalButtonHtml','runSummaryCardHtml','runPlansHtml','coachEventRunViewerHtml','openProgressRun','setButtonBusy','withTimeout'].map(extract).join('\n')}
    document.querySelector('#view').innerHTML=coachEventRunViewerHtml([{id:'first',title:'First'},{id:'second',title:'Second'}],'Rider');
    document.addEventListener('click',e=>{const b=e.target.closest('[data-open-progress-run]');if(b)void openProgressRun(b)});
  `});
  assert.equal(await quick.evaluate(()=>photoLoads),0);assert.equal(await quick.locator('[data-loaded-photo]').count(),0);
  await quick.locator('[data-open-progress-run="second"]').click();await quick.locator('[data-loaded-photo]').waitFor();assert.equal(await quick.evaluate(()=>photoLoads),1);assert(await quick.getByRole('button',{name:'Edit this run',exact:true}).isVisible());
  await quick.evaluate(()=>document.querySelector('#view').innerHTML=runPlansHtml([{id:'archived',title:'Old finals',archived_at:'Yesterday'}]));
  await quick.locator('.run-removed-history > summary').click();
  await quick.locator('[data-open-progress-run="archived"]').click();await quick.locator('[data-loaded-photo]').waitFor();assert.equal(await quick.evaluate(()=>photoLoads),2);
  assert.deepEqual(errors,[]);await quick.close();
 } finally {await browser.close();await new Promise(r=>server.close(r));}
}
(async()=>{await dataChecks();await workerChecks();await browserChecks();console.log('PASS: small metadata-only run/roster queries, photo reuse and retry, auth initialization deduplication, immediate cached shell/SDK with a stalled network, uncached private responses, usable sign-in with unavailable external fonts/CDN, restored branded loader and usable navigation after loading.');})().catch(e=>{console.error(e);process.exit(1)});
