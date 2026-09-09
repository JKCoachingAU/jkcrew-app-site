const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.JKCREW_PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..'),app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const extract=name=>{const start=app.search(new RegExp('^(?:async )?function '+name+'\\(','m'));assert(start>=0,name);const rest=app.slice(start);return rest.slice(0,rest.indexOf('\n}')+2);};
const names=[...new Set([
 ...fs.readFileSync(path.join(__dirname,'run-framing.cjs'),'utf8').match(/const names = (\[[^;]+\]);/)[1].matchAll(/'([^']+)'/g)].map(m=>m[1]))];
names.push(...['currentRunFormState','refreshMountedRunBuilder','runBuilderRefreshView','runBuilderPanel','runBuilderStepsHtml','runBuilderRouteEditorHtml','runBuilderPlaybackEditorHtml','runTimingEditorHtml','bindRunBuilderActions','runBuilderLoadingHtml','updateRunBuilderTrick','updateRunTiming','updateSelectedRunPoint','rememberRunEdit','restoreRunEdit','setRunBuilderStage','selectRunPoint','startRunPointDrag','stopRunPointDrag','focusRunBuilderTrick','deleteSelectedRunPoint','clearRunBuilder','withTimeout','setButtonBusy'].filter(n=>!names.includes(n)));
const handlers=[...extract('bindRunBuilderActions').matchAll(/addEventListener\("[^"]+", (\w+)\)/g)].map(m=>m[1]).filter(n=>!names.includes(n));
const liveCode=app.slice(app.indexOf('// Live run collaboration:'),app.indexOf('function runBuilderLoadingHtml('));
(async()=>{
 let session=null,draft=null,saves=0,failPatch=false;const requests=[];
 const browser=await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH});
 const errors=[];
 async function pageFor(role){
  const page=await browser.newPage({viewport:role==='coach'?{width:1024,height:768}:{width:390,height:844},hasTouch:true});
  page.setDefaultTimeout(15000); page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR',e.message)});
  await page.exposeFunction('server',async(kind,args)=>{
   requests.push({role,kind,args});
   if(kind==='read')return {data:structuredClone(session)};
   if(kind==='list')return {data:session?.status==='active'?[structuredClone(session)]:[]};
   const a=args.p_action;
   const wire=value=>JSON.parse(JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item));
   const ok=()=>({data:{session:wire(session),...(['create','get','claim'].includes(a)?{draft:wire(draft)}:{})}});
   if(a==='create'){
    session={id:'shared',athlete_id:'rider',coach_id:'coach',athlete_name:'Test Rider',title:args.p_patch.title,version:1,status:'active',editor_id:role==='coach'?'coach':'rider',editor_client:args.p_client_id,lease_until:new Date(Date.now()+45000).toISOString()};draft=structuredClone(args.p_patch);return ok();
   }
   if(a==='get')return ok();
   if(a==='claim'){
    if(session.editor_client&&session.editor_client!==args.p_client_id&&Date.parse(session.lease_until)>Date.now())return {error:{message:'Pass editing first'}};
    session.editor_id=role==='coach'?'coach':'rider';session.editor_client=args.p_client_id;session.lease_until=new Date(Date.now()+45000).toISOString();return ok();
   }
   if(a==='patch'){
    if(failPatch===true){failPatch=false;return {error:{message:'Simulated connection drop'}};}
    if(args.p_version!==session.version||session.editor_client!==args.p_client_id)return {error:{message:'Editing changed hands'}};
    draft={...draft,...structuredClone(args.p_patch)};session.version++;session.title=draft.title;if(failPatch==='after'){failPatch=false;return {error:{message:'Simulated lost acknowledgement'}};}return ok();
   }
   if(a==='release'){session.editor_id=null;session.editor_client=null;session.lease_until=null;return ok();}
   if(a==='heartbeat'){session.lease_until=new Date(Date.now()+45000).toISOString();return ok();}
   if(a==='save'){assert.equal(role,'athlete');assert.equal(args.p_version,session.version);if(session.status!=='saved')saves++;session.status='saved';session.editor_id=null;session.editor_client=null;return ok();}
   throw Error(a);
  });
  await page.route('https://jkcrew.test/**',route=>route.fulfill({contentType:'text/html',body:'<html></html>'}));await page.goto('https://jkcrew.test/');
  await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><main id="view"></main>');
  await page.addStyleTag({content:fs.readFileSync(path.join(root,'styles.css'),'utf8')});
  await page.addScriptTag({content:`
   const state={user:{id:${JSON.stringify(role==='coach'?'coach':'rider')}},profile:{role:${JSON.stringify(role)}},view:'contests',draggedRunPoint:null,runPointMapClickBlockUntil:0,runPointDragClickBlockUntil:0};
   let runUndoStack=[],runRedoStack=[];const RUN_PLAYBACK_MAX_SECONDS=3600;
   const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
   const isCoachRole=r=>r==='coach',messageFrom=e=>e.message||String(e),cacheClear=()=>{},getLinkedCoachIdForCurrentAthlete=async()=>'coach';
   window.messages=[];const notify=m=>messages.push(m);const setSyncStatus=()=>{};
   const renderContests=async()=>{document.querySelector('#view').innerHTML=state.runBuilder?runBuilderPanel([],{live:true,showRunList:false}):'<h1>Events & runs</h1>';if(state.runBuilder)bindRunBuilderActions();};
   const navigate=async v=>{state.view=v;await renderContests();};const renderProfile=renderContests,renderStudentProfile=renderContests;
   const client={rpc:(name,args)=>server('rpc',args),removeChannel:async()=>{},channel:()=>({on(){return this},subscribe(callback){callback('SUBSCRIBED');return this}}),from:()=>{
    const q={select(){return this},eq(){return this},gt(){return this},order(){return this},limit(){return server('list',{})},single(){return server('read',{})}};return q;
   }};
   ${[...new Set(handlers)].filter(n=>!['saveLiveRun','bindLiveRunControls'].includes(n)).map(n=>`const ${n}=()=>{};`).join('\n')}
   ${liveCode}
   ${names.map(extract).join('\n')}
   window.seed=async()=>{state.runBuilder={title:'Qualifying',planType:'competition',imageDataUrl:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" fill="#23554e"/></svg>'),stage:'route',points:[{x:10,y:20},{x:40,y:40,label:'Manual'},{x:85,y:70}]};await renderContests();};
   window.inspect=()=>({draft:state.runBuilder,live:liveRun?{session:liveRun.session,error:liveRun.error,unsynced:liveRun.unsynced}:null,messages});
  `});
  return page;
 }
 const rider=await pageFor('athlete'),coach=await pageFor('coach');
 console.log('Starting two-device scenario');await rider.evaluate(()=>seed());
 await rider.click('[data-live-run-action="start"]');
 await rider.waitForFunction(()=>inspect().live?.session.id==='shared');
 await coach.evaluate(async()=>{state.runBuilder=null;await refreshLiveRunInvites();});
 assert(await coach.getByRole('button',{name:'Open live run'}).isVisible());
 await coach.click('[data-join-live-run]');
 await coach.waitForFunction(()=>inspect().live?.session.id==='shared');
 assert(await coach.locator('#run-title').isDisabled());
 // One device moves a dot; the other receives the actual updated route.
 const marker=await rider.locator('[data-run-point-index="1"]').boundingBox();
 await rider.mouse.move(marker.x+marker.width/2,marker.y+marker.height/2);await rider.mouse.down();await rider.mouse.move(marker.x+35,marker.y+20,{steps:4});await rider.mouse.up();
 await coach.waitForFunction(()=>inspect().draft.points[1].x>45);
 assert(!requests.filter(r=>r.args?.p_action==='patch').some(r=>'imageDataUrl' in r.args.p_patch),'Normal edits do not resend park photo');
 await coach.click('[data-run-expand]');
 await rider.fill('#run-title','Finals with coach');
 await coach.waitForFunction(()=>inspect().draft.title==='Finals with coach');
 assert(await coach.locator('.run-fullscreen-playback').isVisible(),'Live updates keep fullscreen open');
 await coach.click('.run-fullscreen-close');
 await rider.click('[data-live-run-action="release"]');
 await coach.waitForFunction(()=>!inspect().live.session.editor_id);
 await coach.click('[data-live-run-action="claim"]');
 await coach.waitForFunction(()=>inspect().live.session.editor_id==='coach'&&!inspect().live.error);
 await coach.locator('[data-run-builder-stage="tricks"]').last().click();
 await coach.fill('[data-run-trick-index="1"]','Barspin');
 await coach.click('[data-run-time-index="1"][data-run-time-key="travelSeconds"]');
 await coach.fill('[data-run-time-index="1"][data-run-time-key="travelSeconds"]','12');
 await coach.locator('[data-run-time-index="1"][data-run-time-key="travelSeconds"]').press('Tab');
 try { await rider.waitForFunction(()=>inspect().draft.points[1].label==='Barspin'&&inspect().draft.points[1].travelSeconds===12); } catch(e) { console.log('SYNC DEBUG',JSON.stringify({rider:await rider.evaluate(()=>inspect()),coach:await coach.evaluate(()=>inspect()),requests:requests.slice(-8)},null,2));throw e; }
 assert(await rider.locator('#run-title').isDisabled(),'Rider becomes a viewer during coach editing');
 // A failed write freezes editing and keeps the local draft. Retry sends it safely.
 failPatch=true;await coach.fill('#run-notes','Keep speed into the second jump');
 await coach.waitForFunction(()=>inspect().live.unsynced===true);
 assert.equal(await coach.locator('#run-notes').inputValue(),'Keep speed into the second jump');
 await coach.click('[data-live-run-action="retry"]');
 await coach.waitForFunction(()=>!inspect().live.error&&!inspect().live.unsynced);
 await rider.waitForFunction(()=>inspect().draft.notes==='Keep speed into the second jump');
 // A committed write with a lost response is recognised on reconnect.
 failPatch='after';await coach.fill('#run-notes','Keep speed into the second jump. Stay relaxed.');
 await coach.waitForFunction(()=>inspect().live.unsynced===true);
 await coach.click('[data-live-run-action="retry"]');
 await coach.waitForFunction(()=>!inspect().live.error&&!inspect().live.unsynced);
 await rider.waitForFunction(()=>inspect().draft.notes.endsWith('Stay relaxed.'));
 if(process.env.JKCREW_SCREENSHOT){await coach.evaluate(()=>window.scrollTo(0,0));await coach.screenshot({path:process.env.JKCREW_SCREENSHOT,fullPage:true});}
 // Handover then the rider saves the latest coach edits exactly once.
 await coach.click('[data-live-run-action="release"]');
 await rider.waitForFunction(()=>!inspect().live.session.editor_id);
 await rider.click('[data-live-run-action="claim"]');
 await rider.waitForFunction(()=>inspect().live.session.editor_id==='rider');
 await rider.click('[data-run-mode="playback"]');
 await rider.click('#run-builder-form button[type="submit"]');
 await rider.waitForFunction(()=>inspect().live===null);
 assert.equal(saves,1);assert.equal(draft.points[1].label,'Barspin');assert.equal(draft.points[1].travelSeconds,12);assert.equal(draft.notes,'Keep speed into the second jump. Stay relaxed.');
 await coach.waitForFunction(()=>inspect().live.session.status==='saved');
 assert(await coach.locator('#run-title').isDisabled());
 assert.deepEqual(errors,[]);
 await browser.close();console.log('PASS: two-device live drawing, private-session discovery, fullscreen updates, edit handover, coach trick/timing edits, failed-write recovery, rider final save and saved-state lock.');
})().catch(e=>{console.error(e);process.exit(1);});
