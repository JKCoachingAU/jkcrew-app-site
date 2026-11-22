// Real native pointer/click events against actual Session gesture and Coach
// render functions. All data and save handlers are local synthetic fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..'), app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const extract = name => {
  const start = app.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert(start >= 0, name); const rest = app.slice(start); return rest.slice(0, rest.indexOf('\n}') + 2);
};
const workspaceHelpers=[...app.slice(app.indexOf('function sessionViewerWorkspaceCurrent('),app.indexOf('function sessionViewerSnapshotHtml(')).matchAll(/^(?:async )?function (\w+)\(/gm)].map(match=>match[1]);
const actual = [...workspaceHelpers,'waitForSessionGesture','bindRiderSessionRefreshEvents','refreshSessionViewerLight','renderSessionViewer'].map(extract).join('\n');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH });
  let checks = 0; const eq = (a,b,label) => { assert.deepEqual(a,b,label); checks++; };
  try {
    const page = await browser.newPage({ viewport:{width:390,height:844} }); const errors = [];
    page.on('pageerror',error=>{errors.push(error.message);console.error('PAGE ERROR: '+error.message);});page.setDefaultTimeout(8000); await page.route('**/*',route=>route.abort());
    await page.setContent('<!doctype html><main id="view" data-view="sessionViewer"><div class="viewer-rider-grid"><button class="tick">Land trick</button></div></main>');
    await page.addStyleTag({content:'button{width:120px;height:60px;margin:24px}#view{min-height:500px}'});
    await page.evaluate(actual => {
      window.state = {user:{id:'coach'},profile:{role:'coach'},view:'sessionViewer',loadingOverlayToken:1,sessionSetupVersion:1,sessionViewerRenderVersion:0,sessionViewerDataVersion:0,sessionViewerGroup:'monday',sessionViewerVenue:'Park',sessionViewerSearch:'',sessionViewerOpenAthleteId:'rider',sessionViewerActiveList:'daily',sessionViewerRosterCache:[{id:'rider',display_name:'Rider',groupNames:['monday']}],sessionViewerActiveSessionCache:{id:'group',status:'active',group_name:'monday',venue:'Park',coach_group_session_participants:[{athlete_id:'rider'}]}};
      window.qa={writes:0,paint:0,planReads:0,planGate:null,resolve:null,pointerId:null};
      document.addEventListener('pointerdown',e=>{qa.pointerId=e.pointerId;},true);
      window.requestRiderSessionRefresh=async()=>false;
      window.canRefreshRiderSession=()=>false;
      window.getSessionViewerRoster=()=>{if(qa.mode==='full'){qa.planReads++;return qa.planGate.then(()=>state.sessionViewerRosterCache);}return Promise.resolve(state.sessionViewerRosterCache);};
      window.getActiveCoachGroupSession=async()=>state.sessionViewerActiveSessionCache;
      window.client={rpc:async()=>({data:[]})};
      window.getCoachVenues=async()=>[];window.withTimeout=p=>p;
      window.isCoachRole=role=>role==='coach';window.navigate=async()=>{};
      window.contestPrepGroupId='contest';
      window.getSessionViewerPlanData=()=>{if(qa.mode==='light'){qa.planReads++;return qa.planGate;}return Promise.resolve(qa.result());};window.weekStartDateForCountry=()=> '2026-11-15';
      window.normalizeAssignmentProgress=(_a,p)=>p;window.dailyVenues=()=>['Park'];window.assignmentsForVenue=a=>a;
      window.venueIdentityKey=v=>String(v).toLowerCase();window.venueLabel=v=>v;
      window.sessionViewerVenueOptions=()=>'<option>Park</option>';
      window.sessionViewerGroupOptions=()=>'<option>Monday</option>';
      window.sessionViewerRiderCardHtml=()=>'<article data-viewer-rider-id="rider"><div class="viewer-card-head"><button class="tick">Land trick</button></div><div data-viewer-card-counts></div><div class="viewer-card-footer"></div><div class="viewer-progress"></div></article>';window.activeSessionViewerList=()=>state.sessionViewerActiveList;window.sessionViewerPlanList=()=>'<div data-viewer-plan="rider" id="viewer-plan-rider"></div>';
      window.sessionViewerClockFaceHtml=()=> '00:00';window.sessionViewerSnapshotHtml=()=>'';
      window.coachGroupLabel=v=>v;window.groupLabelList=()=>'';window.escapeHtml=v=>String(v??'');
      window.groupSessionElapsedSeconds=()=>0;window.parkKingCardHtml=()=>'';window.sessionGroupBattlesHtml=()=>'';
      window.showCoachBattleBuilder=()=>{};window.bindCoachBattleControls=()=>{};
      window.updateGroupSessionTimerDom=()=>{};window.refreshParkKingCard=()=>{};
      window.paintSessionViewerSnapshot=()=>{qa.paint++;};
      window.bindSessionViewerActions=window.bindSessionViewerFastActions=()=>{
        document.querySelectorAll('.tick').forEach(button=>{if(button.qaBound)return;button.qaBound=true;button.addEventListener('click',()=>{qa.writes++;});});
      };
      window.setInterval=()=>0;
      (0,eval)(actual);window.loadSessionViewerSummary=()=>{};window.loadSessionViewerOptionals=()=>{};bindRiderSessionRefreshEvents();bindSessionViewerActions();
      window.qa.result=()=>({assignmentsByAthlete:new Map([['rider',[]]]),runsByAthlete:new Map(),runProgressByPlan:new Map()});window.qaHold=()=>{qa.planGate=new Promise(resolve=>{qa.resolve=()=>resolve(qa.result());});};
    },actual);
    async function startHeld(kind='light') {
      await page.evaluate(kind=>{
        state.view='sessionViewer';qa.writes=0;qa.planReads=0;qa.mode=kind;state.sessionViewerDetailQueue=null;state.sessionViewerGroup='monday';state.sessionViewerVenue='Park';state.sessionViewerSearch='';state.sessionViewerOpenAthleteId='rider';state.sessionViewerActiveList='daily';const athlete=state.sessionViewerRosterCache[0];const workspace=state.sessionViewerWorkspace={userId:state.user.id,setupVersion:state.sessionSetupVersion,navigationToken:state.loadingOverlayToken,group:'monday',venue:'Park',search:'',roster:[athlete],groupRoster:[athlete],filteredRoster:[athlete],activeGroupSession:state.sessionViewerActiveSessionCache,dataVersion:state.sessionViewerDataVersion,entries:new Map(),cards:new Map(),drafts:new Map(),optional:{},summaryStatus:'ready',detailSerial:0};workspace.weekSignature=sessionViewerWeekSignature(workspace);workspace.entries.set('rider',sessionViewerEntry(athlete,[],workspace,{ready:true,detailed:true}));
        document.querySelector('#view').innerHTML='<div class="viewer-rider-grid">'+sessionViewerRiderCardHtml()+'</div>';
        bindSessionViewerActions();qaHold();
        qa.refresh=kind==='full'?renderSessionViewer():refreshSessionViewerLight({force:true});
      },kind);
      await page.waitForFunction(()=>qa.planReads===1);await page.evaluate(()=>{qa.original=document.querySelector('.tick');});
      const bounds=await page.locator('.tick').boundingBox();await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.down();
      await page.evaluate(()=>qa.resolve());await page.waitForFunction(()=>state.trainingViewGesture.waiters.size>0);
      eq(await page.evaluate(()=>qa.original.isConnected),true,kind+': original control stays attached until release');
      eq(await page.evaluate(()=>qa.writes),0,kind+': pointerdown does not score');
    }
    for(const kind of ['light','full']) {
      await startHeld(kind);
      await page.evaluate(()=>document.addEventListener('pointerup',()=>{qa.upBarrier=Boolean(waitForSessionGesture());},{once:true,capture:true}));
      await page.mouse.up();await page.evaluate(()=>qa.refresh);
      eq(await page.evaluate(()=>qa.upBarrier),true,kind+': a second render after pointerup still waits until native click');
      eq(await page.evaluate(()=>qa.writes),1,kind+': original native click runs exactly once before repaint');
      eq(await page.evaluate(()=>qa.original.isConnected),false,kind+': queued data then repaints');
    }
    for(const release of ['pointercancel','lostpointercapture','blur','hidden']) {
      await startHeld();
      await page.evaluate(release=>{
        if(release==='blur')window.dispatchEvent(new Event('blur'));
        else if(release==='hidden'){Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));}
        else document.dispatchEvent(new PointerEvent(release,{pointerId:qa.pointerId}));
      },release);
      await page.evaluate(()=>qa.refresh);eq(await page.evaluate(()=>qa.original.isConnected),false,release+': cancelled gesture releases pending render');
      eq(await page.evaluate(()=>qa.writes),0,release+': cancellation creates no save');
      await page.mouse.move(0,0);await page.mouse.up();await page.evaluate(()=>Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'}));
    }
    for(const stale of ['actor','setup','navigation','navigation-token','data']) {
      await startHeld();await page.evaluate(stale=>{
        if(stale==='actor')state.user={id:'other-coach'};
        else if(stale==='setup')state.sessionSetupVersion++;
        else if(stale==='navigation-token')state.loadingOverlayToken++;
        else if(stale==='navigation')state.view='home';
        else if(stale==='latest-render')state.sessionViewerRenderVersion++;
        else state.sessionViewerDataVersion++;
      },stale);
      await page.mouse.move(0,0);await page.mouse.up();await page.evaluate(()=>qa.refresh);
      eq(await page.evaluate(()=>qa.original.isConnected),true,stale+': obsolete data cannot repaint after waiting');
      await page.evaluate(()=>{state.user={id:'coach'};state.view='sessionViewer';});
    }
    for(const stale of ['actor','setup','navigation','navigation-token']) {
      await startHeld();
      const remaining=await page.evaluate(stale=>{
        if(stale==='actor')state.user={id:'other-coach'};
        else if(stale==='setup')state.sessionSetupVersion++;
        else if(stale==='navigation-token')state.loadingOverlayToken++;
        else state.view='home';
        const waiting=waitForSessionGesture();
        return {waiting:Boolean(waiting),pointers:state.trainingViewGesture.pointers.size,waiters:state.trainingViewGesture.waiters.size};
      },stale);
      eq(remaining,{waiting:false,pointers:0,waiters:0},stale+': pruning stale pointers releases older waiters without pointerup');
      await page.evaluate(()=>qa.refresh);
      eq(await page.evaluate(()=>qa.original.isConnected),true,stale+': cancelled old render remains unable to repaint');
      await page.mouse.move(0,0);await page.mouse.up();await page.evaluate(()=>{state.user={id:'coach'};state.view='sessionViewer';});
    }
    await startHeld();await page.evaluate(()=>state.trainingViewGesture.cancel());await page.evaluate(()=>qa.refresh);
    eq(await page.evaluate(()=>state.trainingViewGesture.waiters.size),0,'Explicit navigation/auth cancellation releases waiting renders');
    await page.mouse.move(0,0);await page.mouse.up();
    eq(errors,[],'No browser script errors');
    console.log(`PASS: ${checks} native Coach full/light tap, cancellation, no-pointerdown-save and stale-render checks.`);
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
