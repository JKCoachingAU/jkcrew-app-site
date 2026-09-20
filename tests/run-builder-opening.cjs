const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const {chromium}=require(process.env.JKCREW_PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..'),app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const names=['bindRunRemovalActions','refreshRunRemovalView','archiveRunPlan','runTimeBudget','runPlaybackDefaultSeconds','runTiming','bindRunTimingControls','runSegmentEditorHtml','paintRunSegmentSelection','selectRunSegment','openRunBuilder','loadRunBuilderCourse','skipRunBuilderCourse','closeRunBuilder','runBuilderLoadingHtml','renderContests','refreshMountedRunBuilder','runBuilderPanel','runBuilderPhotoSetupHtml','runBuilderStage','runBuilderStepsHtml','runBuilderRouteEditorHtml','bindRunBuilderActions','currentRunFormState','setRunBuilderPhoto','runBuilderRefreshView','runView','withTimeout','setButtonBusy'];
names.push('liveRunBarHtml');
const extract=name=>{const start=app.search(new RegExp('^(?:async )?function '+name+'\\(','m'));assert(start>=0,name);const rest=app.slice(start);return rest.slice(0,rest.indexOf('\n}')+2);};
const handlers=[...extract('bindRunBuilderActions').matchAll(/addEventListener\("[^"]+", (\w+)\)/g)].map(m=>m[1]).filter(n=>!names.includes(n));
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH});
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>route.abort());
 await page.setContent('<html data-theme="dark"><meta name="viewport" content="width=device-width, initial-scale=1"><body><main id="view" style="padding:16px"></main></body></html>');
 await page.addStyleTag({content:fs.readFileSync(path.join(root,'styles.css'),'utf8')});
 await page.addScriptTag({content:`
 let liveRun=null; const liveRunWorkspaceHtml=()=>"", bindLiveRunControls=()=>{}, leaveLiveRun=async()=>true;
 const liveRunFingerprint=JSON.stringify,liveRunCanEdit=()=>true,notify=()=>{};
 const runPhotoToDataUrl=async()=>ownPhoto;
 const bindRiderSavedRuns=()=>{};
 const state={user:{id:'rider'},profile:{role:'athlete'},view:'contests'};let runUndoStack=[],runRedoStack=[];
 const escapeHtml=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
 const isCoachRole=role=>role==='coach';const dateLabel=s=>s;const stopRunPlayback=()=>{},closeContestEventModal=()=>{},bindRunPlaybackControls=()=>{};
 const runMapHtml=src=>'<div class="run-map-preview"><img alt="Park photo" src="'+src+'"></div>';
 window.networkCalls=[]; window.courseRequests=[];const handleLiveRunAction=async action=>networkCalls.push('live:'+action);
 const getSharedUpcomingEventData=async()=>{networkCalls.push('events');return new Promise(resolve=>window.resolveEvents=resolve);};
 const getEventCoachRoster=async()=>{networkCalls.push('roster');return [];};
 const getCoachContestRunPlans=async()=>{networkCalls.push('coach-runs');return [];};
 const getRiderRunSummaries=async()=>{networkCalls.push('rider-runs');return [];};
 const getEventCoursePhoto=id=>{networkCalls.push('photo:'+id);return new Promise((resolve,reject)=>courseRequests.push({resolve,reject}));};
 const navigate=async view=>{state.view=view;if(state.runBuilder)await renderContests();else document.querySelector('#view').textContent='Events';};
 ${[...new Set(handlers)].map(n=>`const ${n}=()=>{};`).join('\n')}
 ${names.map(extract).join('\n')}
 window.photo='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="teal"/></svg>');
 window.ownPhoto='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="purple"/></svg>');
 window.mountLaunch=(role='athlete',id='park')=>{state.profile.role=role;state.runBuilder=null;state.view=role==='coach'?'command':'contests';document.querySelector('#view').innerHTML='<button id="launch" data-event-id="'+id+'" data-event-title="Competition" '+(role==='coach'?'data-create-rider-event-run="selected-rider" data-run-athlete-name="Test Rider"':'')+'>Build a run</button>';document.querySelector('#launch').onclick=openRunBuilder;};
 mountLaunch();
 `});
 // Neither rider nor coach waits for roster, attendance or the saved photo library.
 for(const role of ['athlete','coach']){
  await page.evaluate(role=>{networkCalls.length=0;mountLaunch(role);},role);
  await page.click('#launch');
  assert(await page.getByRole('heading',{name:'Opening your run builder'}).isVisible());
  assert.deepEqual(await page.evaluate(()=>networkCalls),['photo:park']);
  assert(await page.getByRole('button',{name:'Close',exact:true}).isEnabled());
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(role==='coach')assert.equal(await page.evaluate(()=>state.runBuilder.athleteId),'selected-rider');
  if(process.env.JKCREW_SCREENSHOT&&role==='coach')await page.screenshot({path:process.env.JKCREW_SCREENSHOT,fullPage:true});
  await page.evaluate(()=>courseRequests.at(-1).resolve({image_data_url:photo}));
  await page.locator('#run-photo').waitFor({state:'attached'});
  assert.equal(await page.locator('.run-builder-loading').count(),0);
  assert.equal(await page.locator('.run-photo-setup').count(),0,'Loaded event course bypasses photo setup');
  assert(await page.locator('#run-map').isVisible());
 }
 // Event Build together entry sends its invitation after loading the shared park once.
 for(const role of ['athlete','coach']){
  await page.evaluate(role=>{networkCalls.length=0;mountLaunch(role);document.querySelector('#launch').dataset.buildTogether='true';},role);
  await page.click('#launch');assert(!(await page.evaluate(()=>networkCalls)).includes('live:start'));
  await page.evaluate(()=>courseRequests.at(-1).resolve({image_data_url:photo}));
  await page.waitForFunction(()=>networkCalls.includes('live:start'));
  assert.deepEqual(await page.evaluate(()=>networkCalls),['photo:park','live:start']);
 }
 const upload={name:'own-park.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>')};
 async function assertPhotoSetup(){
  assert(await page.locator('.run-photo-setup').isVisible());
  assert.equal(await page.locator('#choose-run-photo').count(),1,'Photo setup has one upload action');
  assert(await page.locator('#choose-run-photo').isEnabled());
  assert.equal(await page.locator('#run-builder-form #run-photo').count(),1,'Upload stays in the form for state and permission handling');
  assert(await page.locator('#run-title').isVisible());
  assert.equal(await page.locator('#run-map,.run-builder-sidebar,.run-map-status,.run-colour-key,.run-mode-tabs,.run-builder-steps,#run-builder-form button[type="submit"]').count(),0,'Route controls wait until a course photo exists');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Photo setup fits the viewport');
 }
 // No event means one actionable setup card and no network requests, on phones and tablets.
 for(const [label,viewport] of [['mobile',{width:390,height:844}],['tablet',{width:1024,height:768}]]){
  await page.setViewportSize(viewport);
  await page.evaluate(()=>{networkCalls.length=0;mountLaunch('athlete','');});await page.click('#launch');
  await assertPhotoSetup();assert.deepEqual(await page.evaluate(()=>networkCalls),[]);
  await page.screenshot({path:path.join(process.env.JKCREW_SCREENSHOT_DIR||'/tmp','jkcrew-run-setup-'+label+'.png'),fullPage:true});
  await page.locator('#run-title').fill('My private park run');
  const photoChooser=page.waitForEvent('filechooser');await page.locator('#choose-run-photo').click();await (await photoChooser).setFiles(upload);
  await page.locator('#run-map').waitFor();
  assert.equal(await page.locator('.run-photo-setup').count(),0);
  assert.equal(await page.locator('#run-title').inputValue(),'My private park run');
  assert(await page.evaluate(()=>state.runBuilder.imageDataUrl===ownPhoto));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Loaded editor fits the viewport');
  assert.deepEqual(await page.evaluate(()=>networkCalls),[]);
 }
 await page.setViewportSize({width:390,height:844});
 // An event without a saved photo falls back to setup; upload retains the event and rider.
 await page.evaluate(()=>{networkCalls.length=0;mountLaunch('coach');});await page.click('#launch');
 await page.evaluate(()=>courseRequests.at(-1).resolve(null));await page.locator('.run-photo-setup').waitFor();
 await assertPhotoSetup();assert.deepEqual(await page.evaluate(()=>networkCalls),['photo:park']);
 await page.locator('#run-title').fill('Coach finals route');
 const metadata=await page.evaluate(()=>({contestItemId:state.runBuilder.contestItemId,athleteId:state.runBuilder.athleteId,athleteName:state.runBuilder.athleteName,notes:state.runBuilder.notes,planType:state.runBuilder.planType}));
 await page.locator('#run-photo').setInputFiles(upload);await page.locator('#run-map').waitFor();
 assert.deepEqual(await page.evaluate(()=>({contestItemId:state.runBuilder.contestItemId,athleteId:state.runBuilder.athleteId,athleteName:state.runBuilder.athleteName,notes:state.runBuilder.notes,planType:state.runBuilder.planType})),metadata);
 assert.equal(await page.locator('#run-title').inputValue(),'Coach finals route');
 assert.equal(await page.evaluate(()=>state.runBuilder.coursePhotoLoaded),false);
 assert.equal(await page.evaluate(()=>state.runBuilder.courseSource),'upload');
 // Failure is actionable; retry succeeds without a whole-screen reload.
 await page.evaluate(()=>mountLaunch());await page.click('#launch');
 await page.evaluate(()=>courseRequests.at(-1).reject(new Error('offline')));
 await page.getByRole('button',{name:'Try again'}).click();
 await page.evaluate(()=>courseRequests.at(-1).resolve({image_data_url:photo}));
 await page.locator('#run-title').waitFor();
 // A stalled request becomes retryable after the bounded wait.
 await page.clock.install();await page.evaluate(()=>mountLaunch());await page.click('#launch');
 await page.clock.fastForward(15001);assert(await page.getByRole('button',{name:'Try again'}).isVisible());
 // Skipping a slow course request must not overwrite a rider's own photo later.
 await page.evaluate(()=>mountLaunch());await page.click('#launch');
 const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Choose my own photo'}).click();
 await assertPhotoSetup();await (await chooser).setFiles(upload);await page.locator('#run-map').waitFor();
 await page.evaluate(()=>courseRequests.at(-1).resolve({image_data_url:photo}));
 await page.waitForTimeout(30);assert(await page.evaluate(()=>state.runBuilder.imageDataUrl===ownPhoto));
 // Closing and changing tabs must not reopen the builder when a late photo arrives.
 await page.evaluate(()=>mountLaunch());await page.click('#launch');await page.getByRole('button',{name:'Close',exact:true}).click();
 await page.evaluate(()=>courseRequests.at(-1).resolve({image_data_url:photo}));await page.waitForTimeout(30);
 assert.equal(await page.locator('#run-builder-live').count(),0);assert.equal(await page.evaluate(()=>state.runBuilder),null);
 await page.evaluate(()=>mountLaunch());await page.click('#launch');await page.evaluate(()=>{state.view='session';document.querySelector('#view').textContent='Session';courseRequests.at(-1).resolve({image_data_url:photo});});await page.waitForTimeout(30);
 assert.equal(await page.locator('#view').innerText(),'Session');
 // A previous events request cannot start loading saved runs or replace the new editor.
 await page.evaluate(()=>{mountLaunch();state.view='contests';window.oldRender=renderContests();networkCalls.length=0;});
 await page.click('#launch');await page.evaluate(()=>resolveEvents({events:[],attendance:[]}));await page.evaluate(()=>oldRender);
 assert(await page.getByRole('heading',{name:'Opening your run builder'}).isVisible());
 assert(!(await page.evaluate(()=>networkCalls)).some(n=>n==='rider-runs'||n==='coach-runs'));
 assert.deepEqual(errors,[]);await browser.close();
 console.log('PASS: immediate rider/coach loading, single photo-first setup on mobile/tablet, real upload with draft metadata preserved, event-photo bypass and empty-photo fallback, retry, and protection from late requests after upload/close/navigation/new launch.');
})().catch(e=>{console.error(e);process.exit(1)});
