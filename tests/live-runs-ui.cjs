const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.JKCREW_PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..'),app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const extract=name=>{const start=app.search(new RegExp('^(?:async )?function '+name+'\\(','m'));assert(start>=0,name);const rest=app.slice(start);return rest.slice(0,rest.indexOf('\n}')+2);};
const names=[...new Set([
 ...fs.readFileSync(path.join(__dirname,'run-framing.cjs'),'utf8').match(/const names = (\[[^;]+\]);/)[1].matchAll(/'([^']+)'/g)].map(m=>m[1]))];
names.push(...['bindRunRemovalActions','refreshRunRemovalView','archiveRunPlan','bindRunTimingControls','runSegmentEditorHtml','paintRunSegmentSelection','selectRunSegment','runTimeBudget','runTimeBudgetHtml','paintRunTimeBudget','currentRunFormState','refreshMountedRunBuilder','runBuilderRefreshView','runBuilderPanel','runBuilderStepsHtml','runBuilderRouteEditorHtml','runBuilderPlaybackEditorHtml','runTimingEditorHtml','updateRunFinalType','bindRunBuilderActions','runBuilderLoadingHtml','updateRunBuilderTrick','updateRunTiming','updateSelectedRunPoint','rememberRunEdit','restoreRunEdit','setRunBuilderStage','selectRunPoint','startRunPointDrag','stopRunPointDrag','focusRunBuilderTrick','deleteSelectedRunPoint','clearRunBuilder','withTimeout','setButtonBusy','setRunBuilderPhoto','runPhotoToDataUrl','fileToDataUrl'].filter(n=>!names.includes(n)));
const handlers=[...extract('bindRunBuilderActions').matchAll(/addEventListener\("[^"]+", (\w+)\)/g)].map(m=>m[1]).filter(n=>!names.includes(n));
const liveCode=app.slice(app.indexOf('// Live run collaboration:'),app.indexOf('function runBuilderLoadingHtml('));
(async()=>{
 let session=null,draft=null,saves=0,failPatch=false,signalSeq=0,busyStart=false,failStart=false,failAccept=false;const requests=[],signals=[],callRequests=new Map();
 const browser=await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
 const errors=[];
 async function pageFor(role){
  const page=await browser.newPage({viewport:role==='coach'?{width:1024,height:768}:{width:390,height:844},hasTouch:true,permissions:['camera','microphone']});
  page.setDefaultTimeout(15000); page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR',e.message)});
  await page.exposeFunction('server',async(kind,args)=>{
   requests.push({role,kind,args});
   if(kind==='read')return {data:structuredClone(session)};
   if(kind==='list')return {data:session?.status==='active'?[structuredClone(session)]:[]};
   const a=args.p_action;
   const wire=value=>JSON.parse(JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item));
   const ok=()=>({data:{session:wire(session),...(['create','start','get','claim','accept'].includes(a)?{draft:wire(draft)}:{})}});
   if(a==='start'){
    if(busyStart){busyStart=false;return {data:{busy:true,session:null}};}
    if(callRequests.has(args.p_message_id)){const previous=callRequests.get(args.p_message_id);session=previous.session;draft=previous.draft;return ok();}
    args.p_patch=args.p_payload.draft;

    session={id:callRequests.size?'shared-'+(callRequests.size+1):'shared',created_by:role==='coach'?'coach':'rider',invitation_status:'pending',expires_at:new Date(Date.now()+86400000).toISOString(),athlete_id:'rider',coach_id:'coach',athlete_name:'Test Rider',title:args.p_patch.title,version:1,status:'active',call_status:'ringing',call_mode:'video',coach_name:'Coach JK',caller_name:role==='coach'?'Coach JK':'Test Rider',ring_expires_at:new Date(Date.now()+60000).toISOString(),editor_id:role==='coach'?'coach':'rider',editor_client:args.p_client_id,lease_until:new Date(Date.now()+45000).toISOString()};draft=structuredClone(args.p_patch);callRequests.set(args.p_message_id,{session,draft});if(failStart){failStart=false;return{error:{message:'Simulated lost start acknowledgement'}};}return ok();
   }
   if(a==='accept'){
    if(session.call_status==='active')return session.coach_client_id===args.p_client_id?ok():{data:{session:wire(session),unavailable:true}};
    session.coach_client_id=args.p_client_id;session.invitation_status='accepted';session.call_status='active';session.lease_until=new Date(Date.now()+45000).toISOString();
    if(failAccept){failAccept=false;return{error:{message:'Simulated lost accept acknowledgement'}};}return ok();
   }
   if(kind==='live_run_action'&&session.call_status==='ringing'&&!['get','end'].includes(a))return{error:{message:'Accept an active call before editing this run.'}};
   if(a==='decline'){session.invitation_status='declined';session.status='ended';return ok();}
   if(a==='get')return ok();
   if(a==='signal'){if(!signals.some(s=>s.id===args.p_message_id))signals.push({id:args.p_message_id,seq:++signalSeq,role,kind:args.p_payload.kind,payload:args.p_payload.data});return ok();}
   if(a==='signals')return {data:{session:wire(session),signals:signals.filter(s=>s.role!==role&&s.seq>(args.p_after||0))}};
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
   if(a==='heartbeat'){if(kind==='live_run_action')session.lease_until=new Date(Date.now()+45000).toISOString();return ok();}
   if(a==='save'){assert.equal(args.p_version,session.version);if(!session.saved_run_id)saves++;session.saved_run_id='saved-run';session.saved_version=session.version;session.saved_run_updated_at=new Date().toISOString();return ok();}
   if(a==='end'||a==='cancel'){session.call_status=a==='cancel'?'cancelled':'ended';session.status='ended';return ok();}
   throw Error(a);
  });
  await page.route('https://jkcrew.test/**',route=>route.fulfill({contentType:'text/html',body:'<html></html>'}));await page.goto('https://jkcrew.test/');
  await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="app"><div class="app-shell '+(role==='coach'?'coach-shell':'rider-shell')+'" style="display:block"><main id="view"></main></div></div>');
  await page.addStyleTag({content:fs.readFileSync(path.join(root,'styles.css'),'utf8')});
  await page.addStyleTag({content:fs.readFileSync(path.join(root,'live-run-call.css'),'utf8')});
  await page.addScriptTag({content:fs.readFileSync(path.join(root,'live-run-call.js'),'utf8')});
  await page.addScriptTag({content:`
   const bindRiderSavedRuns=()=>{};
 const state={user:{id:${JSON.stringify(role==='coach'?'coach':'rider')}},profile:{role:${JSON.stringify(role)}},view:'contests',draggedRunPoint:null,runPointMapClickBlockUntil:0,runPointDragClickBlockUntil:0};
   let runUndoStack=[],runRedoStack=[];const RUN_PLAYBACK_MAX_SECONDS=3600;
   const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
   const isCoachRole=r=>r==='coach',messageFrom=e=>e.message||String(e),cacheClear=()=>{},getLinkedCoachIdForCurrentAthlete=async()=>'coach';
   const getSharedUpcomingEventData=async()=>({events:[{id:'event-one',title:'JKCREW Finals',course_photo_available:true},{id:'event-two',title:'Park contest',course_photo_available:true},{id:'event-three',title:'Local jam',course_photo_available:false}]});
   const getEventCoursePhoto=async id=>id==='event-one'?{image_data_url:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" fill="#23554e"/></svg>')}:null;
   window.mediaMounted=0;window.mediaDestroyed=0;window.mediaHandles=[];window.mediaStreams=[];window.nativePeers=[];
   const nativeMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async constraints=>{const stream=await nativeMedia(constraints);mediaStreams.push(stream);return stream;};
   const NativePC=RTCPeerConnection;window.RTCPeerConnection=class extends NativePC{constructor(config){super(config);nativePeers.push(this);}};
   const realCallMount=JKCrewLiveRunCall.mount;JKCrewLiveRunCall.mount=options=>{mediaMounted++;const handle=realCallMount(options),destroy=handle.destroy;let disposed=false;handle.destroy=()=>{if(!disposed){disposed=true;mediaDestroyed++;}destroy();};mediaHandles.push(handle);return handle;};
   window.inspectMedia=()=>mediaHandles.at(-1)?.inspect();
   window.soundCount=0;const playNotificationSound=()=>soundCount++;window.messages=[];const notify=m=>messages.push(m);const setSyncStatus=()=>{};
   const renderContests=async()=>{document.querySelector('#view').innerHTML=state.runBuilder?runBuilderPanel([],{live:true,showRunList:false}):'<h1>Events & runs</h1>';if(state.runBuilder)bindRunBuilderActions();};
   const navigate=async v=>{state.view=v;await renderContests();};const renderProfile=renderContests,renderStudentProfile=renderContests;
   const client={rpc:(name,args)=>server(name,args),functions:{invoke:async()=>({data:{iceServers:[]}})},removeChannel:async()=>{},channel:()=>({on(){return this},subscribe(callback){callback('SUBSCRIBED');return this}}),from:()=>{
    const q={select(){return this},eq(){return this},gt(){return this},order(){return this},limit(){return server('list',{})},single(){return server('read',{})}};return q;
   }};
   ${[...new Set(handlers)].filter(n=>!['saveLiveRun','bindLiveRunControls'].includes(n)).map(n=>`const ${n}=()=>{};`).join('\n')}
   ${liveCode}
   ${names.map(extract).join('\n')}
   window.seed=async()=>{state.runBuilder={title:'Qualifying',planType:'competition',contestItemId:'event-one',courseSource:'upload',imageDataUrl:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" fill="#23554e"/></svg>'),stage:'route',points:[{x:10,y:20},{x:40,y:40,label:'Manual'},{x:85,y:70}]};await renderContests();};
   window.inspect=()=>({draft:state.runBuilder,live:liveRun?{session:liveRun.session,error:liveRun.error,unsynced:liveRun.unsynced}:null,messages});
  `});
  return page;
 }
 const rider=await pageFor('athlete'),coach=await pageFor('coach');
 console.log('Starting two-device scenario');await rider.evaluate(()=>seed());
 // Busy responses keep the private draft; uncertain start retries retain one request ID.
 busyStart=true;await rider.click('[data-live-run-action="start"]');
 await rider.waitForFunction(()=>messages.some(m=>m.includes('already on another call')));assert.equal(await rider.evaluate(()=>inspect().live),null);assert.equal(await rider.evaluate(()=>inspect().draft.points.length),3);
 failStart=true;await rider.click('[data-live-run-action="start"]');await rider.waitForFunction(()=>messages.some(m=>m.includes('lost start acknowledgement')));
 const firstStartKey=await rider.evaluate(()=>state.runBuilder.liveStartKey);assert(firstStartKey);assert.equal(callRequests.size,1);
 await rider.click('[data-live-run-action="start"]');
 await rider.waitForFunction(()=>inspect().live?.session.id==='shared');
 assert.equal(callRequests.size,1,'Lost start acknowledgement retries the existing call');assert.equal(await rider.evaluate(()=>state.runBuilder.liveStartKey),undefined,'Acknowledged call no longer reuses its start key');
 // A real 16-second ringing interval crosses the editor heartbeat boundary.
 await rider.waitForTimeout(16050);assert.equal(await rider.evaluate(()=>Boolean(inspect().live.error)),false);
 assert.equal(requests.filter(r=>r.kind==='live_run_action'&&r.args?.p_action==='heartbeat').length,0,'No editing heartbeat is sent while ringing');
 await coach.evaluate(async()=>{await seed();state.runBuilder.title='Unfinished private draft';await renderContests();await refreshLiveRunInvites();});
 assert(await coach.locator('#live-run-invitation').isVisible());
 if(process.env.JKCREW_SCREENSHOT)await coach.screenshot({path:'/tmp/jkcrew-live-invitation.png'});
 assert.equal(await coach.evaluate(()=>soundCount),1);await coach.evaluate(()=>refreshLiveRunInvites());assert.equal(await coach.evaluate(()=>soundCount),1,'Polling does not repeat the sound');
 coach.once('dialog',dialog=>dialog.dismiss());await coach.click('#live-run-invitation [data-accept-session]');
 assert.equal(await coach.locator('#run-title').inputValue(),'Unfinished private draft');assert.equal(session.invitation_status,'pending','Cancelling the draft warning does not accept');
 failAccept=true;coach.once('dialog',dialog=>dialog.accept());await coach.click('#live-run-invitation [data-accept-session]');
 await coach.waitForFunction(()=>messages.some(m=>m.includes('lost accept acknowledgement')));assert.equal(await coach.evaluate(()=>inspect().live),null);
 coach.once('dialog',dialog=>dialog.accept());await coach.click('#live-run-invitation [data-accept-session]');
 const acceptance=requests.filter(r=>r.args?.p_action==='accept');assert.equal(acceptance.length,2);assert.equal(acceptance[0].args.p_client_id,acceptance[1].args.p_client_id,'Retry preserves the accepted device identity');
 await coach.waitForFunction(()=>inspect().live?.session.id==='shared');
 assert(await coach.locator('#run-title').isDisabled());
 await rider.waitForFunction(()=>inspect().live.session.call_status==='active');
 // Native fake-device WebRTC connects through only the fixture's signalling relay.
 await Promise.all([rider,coach].map(p=>p.waitForFunction(()=>inspectMedia()?.connectionState==='connected'&&inspectMedia().remoteTracks===2)));
 for(const p of [rider,coach]){assert.equal(await p.evaluate(()=>inspectMedia().localTracks),2);assert(await p.evaluate(()=>nativePeers.length>0&&nativePeers.every(peer=>peer instanceof NativePC)));}
 assert(signals.some(s=>s.kind==='offer')&&signals.some(s=>s.kind==='answer')&&signals.some(s=>s.kind==='ice'),'Real offer/answer/ICE relayed in both-direction media connection');
 // The participant can keep the live call compact while editing the route.
 for(const p of [rider,coach]){await p.locator('[data-call="size"]').click();assert(await p.locator('[data-remote]').isVisible(),'Minimise keeps the other participant visible');assert(await p.locator('[data-local]').isVisible(),'Minimise keeps self preview visible');}
 // One device moves a dot; the other receives the actual updated route.
 await rider.locator('[data-run-point-index="1"]').scrollIntoViewIfNeeded();
 const marker=await rider.locator('[data-run-point-index="1"]').boundingBox();
 await rider.mouse.move(marker.x+marker.width/2,marker.y+marker.height/2);await rider.mouse.down();await rider.mouse.move(marker.x+35,marker.y+20,{steps:4});await rider.mouse.up();
 try { await coach.waitForFunction(()=>inspect().draft.points[1].x>45); } catch(e) { console.log('Drag debug',marker,await rider.evaluate(()=>({points:inspect().draft.points,live:inspect().live})),await coach.evaluate(()=>({points:inspect().draft.points,live:inspect().live})));throw e; }
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
 await coach.locator('[data-run-builder-stage="tricks"]').last().evaluate(el=>el.scrollIntoView({block:'center'}));
 await coach.locator('[data-run-builder-stage="tricks"]').last().click();
 await coach.fill('[data-run-trick-index="1"]','Barspin');
 // Set travel time by tapping the rendered line while the rider watches live.
 const timingLine=coach.locator('[data-edit-run-segment="1"]');await timingLine.scrollIntoViewIfNeeded();
 const lineMiddle=await timingLine.evaluate(el=>{const p=el.getPointAtLength(el.getTotalLength()/2);return new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM()).toJSON();});
 await coach.touchscreen.tap(lineMiddle.x,lineMiddle.y);
 const lineTime=coach.locator('[data-run-segment-editor] input');
 await lineTime.fill('12');await lineTime.press('Tab');
 assert.equal(await coach.locator('.run-timing-row [data-run-time-index="1"][data-run-time-key="travelSeconds"]').inputValue(),'12');
 try { await rider.waitForFunction(()=>inspect().draft.points[1].label==='Barspin'&&inspect().draft.points[1].travelSeconds===12); } catch(e) { console.log('SYNC DEBUG',JSON.stringify({rider:await rider.evaluate(()=>inspect()),coach:await coach.evaluate(()=>inspect()),requests:requests.slice(-8)},null,2));throw e; }
 assert(await rider.locator('#run-title').isDisabled(),'Rider becomes a viewer during coach editing');
 await coach.locator('[data-run-final-type]').selectOption('trick');await coach.fill('[data-run-trick-index="2"]','Flair');await coach.fill('[data-run-time-index="2"][data-run-time-key="holdSeconds"]','3');
 await rider.waitForFunction(()=>inspect().draft.points[2].isTrick&&inspect().draft.points[2].label==='Flair'&&inspect().draft.points[2].holdSeconds===3);
 await coach.click('[data-run-mode="playback"]');await coach.click('[data-run-expand]');
 await coach.locator('.run-fullscreen-playback [data-run-scrub]').evaluate(el=>{el.value='1000';el.dispatchEvent(new Event('input',{bubbles:true}));});
 assert(await coach.locator('.run-fullscreen-playback [data-run-playback-label]').isVisible());assert.equal(await coach.locator('.run-fullscreen-playback [data-run-playback-label]').textContent(),'Flair');await coach.click('.run-fullscreen-close');await coach.click('[data-run-mode="route"]');
 assert.equal(await coach.locator('#run-notes').count(),0);assert.equal(await coach.getByText('COMPLETE 3 STEPS TO SAVE',{exact:true}).count(),0);
 // A failed write freezes editing and keeps the local draft. Retry sends it safely.
 failPatch=true;await coach.fill('#run-title','Safer finals');
 await coach.waitForFunction(()=>inspect().live.unsynced===true);
 assert.equal(await coach.locator('#run-title').inputValue(),'Safer finals');
 await coach.click('[data-live-run-action="retry"]');
 await coach.waitForFunction(()=>!inspect().live.error&&!inspect().live.unsynced);
 await rider.waitForFunction(()=>inspect().draft.title==='Safer finals');
 // A committed write with a lost response is recognised on reconnect.
 failPatch='after';await coach.fill('#run-title','Safer finals. Version two.');
 await coach.waitForFunction(()=>inspect().live.unsynced===true);
 await coach.click('[data-live-run-action="retry"]');
 await coach.waitForFunction(()=>!inspect().live.error&&!inspect().live.unsynced);
 await rider.waitForFunction(()=>inspect().draft.title.endsWith('Version two.'));
 if(process.env.JKCREW_SCREENSHOT){await coach.evaluate(()=>window.scrollTo(0,0));await coach.screenshot({path:process.env.JKCREW_SCREENSHOT,fullPage:true});}
 // Handover then the rider saves the latest coach edits exactly once.
 await coach.click('[data-live-run-action="release"]');
 await rider.waitForFunction(()=>!inspect().live.session.editor_id);
 await rider.click('[data-live-run-action="claim"]');
 await rider.waitForFunction(()=>inspect().live.session.editor_id==='rider');
 await rider.click('[data-run-mode="playback"]');
 await rider.click('#run-builder-form button[type="submit"]');
 await rider.waitForFunction(()=>inspect().live?.session.saved_run_id==='saved-run');
 assert.equal(await rider.evaluate(()=>mediaDestroyed),0,'Saving retains the active media overlay');
 assert.equal(await rider.evaluate(()=>inspect().live.session.call_status),'active');
 assert.equal(saves,1);assert.equal(draft.points[1].label,'Barspin');assert.equal(draft.points[1].travelSeconds,12);assert.equal(draft.title,'Safer finals. Version two.');
 await coach.waitForFunction(()=>inspect().live.session.saved_run_id==='saved-run');
 assert(await coach.locator('#run-title').isDisabled(),'Other participant remains viewer, not disconnected');
 assert(await coach.locator('.run-live-save-receipt').isVisible(),'Both participants see saved confirmation');
 await rider.click('#run-builder-form button[type="submit"]');assert.equal(saves,1,'Retry updates the same saved row');
 // Coach can also save; saving remains independent from ending the call.
 await rider.click('[data-live-run-action="release"]');await coach.waitForFunction(()=>!inspect().live.session.editor_id);
 await coach.click('[data-live-run-action="claim"]');await coach.waitForFunction(()=>inspect().live.session.editor_id==='coach');
 await coach.fill('#run-title','Coach saved final');await rider.waitForFunction(()=>inspect().draft.title==='Coach saved final');
 await coach.click('#run-builder-form button[type="submit"]');await coach.waitForFunction(()=>inspect().live.session.saved_version===inspect().live.session.version);
 assert.equal(saves,1);assert.equal(session.athlete_id,'rider');assert.equal(draft.contestItemId,'event-one');assert.equal(session.call_status,'active');
 assert.equal(await coach.evaluate(()=>mediaDestroyed),0);
 for(const p of [rider,coach]){assert.equal(await p.evaluate(()=>inspectMedia().connectionState),'connected','Actual media stays connected through handover, editing and both saves');assert.equal(await p.evaluate(()=>inspectMedia().remoteTracks),2);assert.equal(await p.evaluate(()=>mediaMounted),1,'Saving does not remount or reacquire media');}
 if(process.env.JKCREW_SCREENSHOT)await rider.screenshot({path:'/tmp/jkcrew-live-run-builder-connected-mobile.png'});
 // Choosing a missing course leaves the existing draft intact with a visible retry state.
 coach.once('dialog',d=>d.accept());await coach.locator('[data-live-event]').selectOption('event-two');
 await coach.waitForFunction(()=>document.querySelector('.live-run-workspace').textContent.includes('no course photo'));
 assert.equal(await coach.evaluate(()=>inspect().draft.contestItemId),'event-one');
 assert.equal(await coach.evaluate(()=>inspect().draft.points.length),3);
 const usePhoto=coach.locator('[data-live-run-action="course-upload"]');assert((await usePhoto.textContent()).includes('Park contest'));
 coach.once('dialog',d=>d.accept());await usePhoto.click();await coach.waitForFunction(()=>inspect().draft.contestItemId==='event-two'&&!liveRun.busy);
 const upload={name:'park.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" fill="#345c74"/></svg>')};
 await coach.locator('#run-photo').setInputFiles(upload);await rider.waitForFunction(()=>inspect().draft.contestItemId==='event-two'&&inspect().draft.imageDataUrl.startsWith('data:image/svg+xml'));
 assert.equal(draft.contestItemId,'event-two','Upload following failed fetch uses explicitly chosen event');
 await coach.locator('[data-live-event]').selectOption('event-three');await coach.waitForFunction(()=>inspect().draft.contestItemId==='event-three'&&inspect().draft.courseSource==='upload'&&!liveRun.busy);
 await coach.locator('#run-photo').setInputFiles(upload);await rider.waitForFunction(()=>inspect().draft.contestItemId==='event-three'&&inspect().draft.imageDataUrl.startsWith('data:image/svg+xml'));
 assert.equal(draft.contestItemId,'event-three','Event without existing course supports the rider/coach upload');
 await coach.click('[data-live-run-action="leave"]');await coach.waitForFunction(()=>inspect().live===null);
 assert.equal(session.call_status,'ended');assert.equal(await coach.evaluate(()=>mediaDestroyed),1);
 await rider.waitForFunction(()=>inspect().live.session.call_status==='ended');
 assert(await rider.locator('#run-title').isDisabled());
 for(const p of [rider,coach]){await p.waitForFunction(()=>inspectMedia().connectionState==='closed'&&inspectMedia().localTracks===0);assert(await p.evaluate(()=>mediaStreams.flatMap(stream=>stream.getTracks()).every(track=>track.readyState==='ended')),'Ending the builder call stops every native local track');}
 // The original caller can close the finished call and call again from the retained draft.
 await rider.click('[data-live-run-action="leave"]');await rider.waitForFunction(()=>inspect().live===null);
 await rider.click('[data-live-run-action="start"]');await rider.waitForFunction(()=>inspect().live?.session.id==='shared-2');
 assert.equal(session.call_status,'ringing');assert.equal(callRequests.size,2);assert.notEqual([...callRequests.keys()][1],firstStartKey);
 await rider.click('[data-live-run-action="leave"]');await rider.waitForFunction(()=>inspect().live===null);assert.equal(session.call_status,'cancelled');
 assert(await rider.evaluate(()=>mediaStreams.flatMap(stream=>stream.getTracks()).every(track=>track.readyState==='ended')),'Cancelling the new call releases media');
 assert.deepEqual(errors,[]);
 await browser.close();console.log('PASS: actual connected two-device WebRTC retained through live drawing, private-session discovery, fullscreen updates, edit handover, coach trick/timing edits, failed-write recovery, rider and coach saves, correct rider/event, failed course preservation/correct-event upload, busy/lost-ACK recovery, delayed acceptance, repeat call and separate call ending.');
})().catch(e=>{console.error(e);process.exit(1);});
