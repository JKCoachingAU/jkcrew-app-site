const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const screenshotDir=process.env.JKCREW_SCREENSHOT_DIR;
if(screenshotDir)fs.mkdirSync(screenshotDir,{recursive:true});
const capture=async(page,name)=>{if(screenshotDir)await page.screenshot({path:path.join(screenshotDir,name+'.png'),animations:'disabled'});};
const root = path.resolve(__dirname, '..'), app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const names = ['sessionStatBarHtml','latestDailyTime','dailySessionHubHtml','assignmentList','dailyVenueGroups','assignmentGroups','loadActiveSession','renderSession','updateTimer','startSession','recordAssignmentAction','sessionViewerRiderCardHtml','sessionViewerAssignmentsForList','sessionViewerListContent','finishViewerDailyTimer','recordViewerAssignmentAction'];
const actual = names.map(name => {
  const start = app.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'));
  assert(start >= 0, name);
  const rest = app.slice(start); return rest.slice(0, rest.indexOf('\n}') + 2);
}).join('\n');
const fixture = String.raw`
const nativeSetInterval=window.setInterval.bind(window),nativeClearInterval=window.clearInterval.bind(window);window.liveIntervals=new Set();window.setInterval=(handler,...args)=>{const id=nativeSetInterval(handler,...args);liveIntervals.add(id);return id;};window.clearInterval=id=>{liveIntervals.delete(id);nativeClearInterval(id);};
const NativeDate=Date; window.clockNow=NativeDate.now(); window.Date=class extends NativeDate { constructor(...args){super(...(args.length?args:[clockNow]));} static now(){return clockNow;} };
const state={user:{id:'r1'},profile:{id:'r1',role:'athlete',display_name:'Test Rider One',country_code:'AU'},view:'session',selectedVenue:'Test Park',sessionRenderVersion:0,attempts:[],timer:null,sessionOpenDailyVenues:new Set(['Test Park']),sessionOpenAssignmentSections:new Set(),pendingAssignmentProgress:new Map(),sessionViewerVenue:'Test Park',sessionViewerOpenAthleteId:'r1',sessionViewerActiveList:'daily'};
const riders=[{id:'r1',display_name:'Test Rider One',role:'athlete'},{id:'r2',display_name:'Test Rider Two',role:'athlete'}];
const categories=['daily','daily','one_bang','dialled','lines','percentage','foam_pit','bonus'];
window.assignments=riders.flatMap(rider=>categories.map((category,index)=>({id:rider.id+'-a'+index,athlete_id:rider.id,category,venue:'Test Park',trick_name:category+' trick '+index,completed:false})));
window.sessions={};window.results={};window.savedSessions=[];window.savedResults=[];window.candidates={};window.rpcCalls=[];window.notices=[];window.syncStatuses=[];window.shares=[];window.progressRefreshes=[];window.actionReleases=[];window.confirmReleases=[];window.prepareReleases=[];window.holdAction=false;window.holdConfirm=false;window.holdPrepare=false;window.failConfirm=false;window.failAction=false;window.refreshCount=0;window.sequence=0;
function makeSession(id){return {id:'session-'+id,athlete_id:id,daily_venue:'Test Park',started_at:new Date(clockNow-70000).toISOString(),daily_completed_seconds:null,ended_at:null};}
function daily(id){return assignments.filter(row=>row.athlete_id===id&&row.category==='daily'&&dailyRpcVenue(row.venue)===dailyRpcVenue(sessions[id]?.daily_venue??state.selectedVenue));}
function makeCandidate(id,at){const session=sessions[id];const candidate={candidate_id:'candidate-'+(++sequence),athlete_id:id,rider_name:riders.find(r=>r.id===id).display_name,session_id:session.id,group_session_id:state.view==='sessionViewer'?'group':null,venue:session.daily_venue,local_date:'2026-09-11',seconds:Math.floor((new Date(at).getTime()-new Date(session.started_at).getTime())/1000),captured_at:at,completed_count:2,total_count:2};candidates[candidate.candidate_id]=candidate;return candidate;}
const client={from(table){const query={select(){return query;},eq(){return query;},is(){return query;},order(){return query;},limit(){return query;},gte(){return query;},then(resolve,reject){return Promise.resolve({data:table==='training_sessions'?(sessions[state.user.id]?[sessions[state.user.id]]:[]):[]}).then(resolve,reject);}};return query;},async rpc(name,args={}){
  rpcCalls.push({name,args,arrival:clockNow});
  if(name==='start_daily_tricks'){const prior=sessions[state.user.id];if(prior?.daily_completed_seconds!=null){savedSessions.push({...prior});if(results[state.user.id])savedResults.push({...results[state.user.id]});delete results[state.user.id];}sessions[state.user.id]={...makeSession(state.user.id),daily_venue:args.p_venue};return {data:{}};}
  if(name==='record_daily_trick_action'){
    if(failAction){failAction=false;return {error:{message:'Start Daily Tricks before ticking this trick'}};}
    if(holdAction)await new Promise(resolve=>actionReleases.push(resolve));
    const row=assignments.find(a=>a.id===args.p_assignment_id),before=row.completed;
    row.completed=args.p_action==='landed';
    const final=row.completed&&!before&&daily(row.athlete_id).every(a=>a.completed);
    return {data:{assignment_id:row.id,athlete_id:row.athlete_id,category:'daily',message:'Daily Trick saved',completion_candidate:final?makeCandidate(row.athlete_id,args.p_tapped_at):null}};
  }
  if(name==='prepare_daily_finish'){
    if(holdPrepare)await new Promise(resolve=>prepareReleases.push(resolve));
    if(results[args.p_athlete_id])return {data:{result:results[args.p_athlete_id]}};
    if(!sessions[args.p_athlete_id]||!daily(args.p_athlete_id).every(a=>a.completed))return {error:{message:'Complete Daily Tricks first'}};
    return {data:{completion_candidate:makeCandidate(args.p_athlete_id,args.p_tapped_at)}};
  }
  if(name==='confirm_daily_finish'){
    if(holdConfirm)await new Promise(resolve=>confirmReleases.push(resolve));
    if(failConfirm){failConfirm=false;return {error:{message:'Connection interrupted'}};}
    const c=candidates[args.p_candidate_id]; if(!c)return {error:{message:'Candidate unavailable'}};
    if(!results[c.athlete_id]){
      const result={...c,result_id:'result-'+c.athlete_id,completed_at:new Date(clockNow).toISOString(),completion_points:c.group_session_id?3:2,completion_xp:35,point_awards:[{label:'Daily list',points:1},{label:'Under 20 minutes',points:1}],previous_pb_seconds:90,pb_seconds:Math.min(90,c.seconds),is_new_pb:c.seconds<90,is_first_pb:false,pb_comparable:true,weekly_score:c.athlete_id==='r1'?47:23,rank_number:c.athlete_id==='r1'?4:8};
      results[c.athlete_id]=result;Object.assign(sessions[c.athlete_id],{daily_completed_seconds:result.seconds,daily_completed_at:result.completed_at});
      const participant=state.sessionViewerActiveSessionCache?.coach_group_session_participants.find(p=>p.athlete_id===c.athlete_id);if(participant)participant.daily_finish_seconds=result.seconds;
    }
    return {data:results[c.athlete_id]};
  }
  if(name==='record_assignment_action_at_venue'){const row=assignments.find(a=>a.id===args.p_assignment_id);if(row)row.completed=true;return {data:{category:row?.category,message:'Training saved',points_awarded:0}};}
  throw new Error('Unexpected RPC '+name);
}};
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const formatTime=value=>{const s=Math.max(0,Math.floor(Number(value)||0));return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');},formatPbTime=value=>Number.isFinite(Number(value))&&Number(value)>0?formatTime(value):'-';
const notify=message=>notices.push(message),messageFrom=error=>error.message||String(error),setSyncStatus=status=>syncStatuses.push(status),cacheClear=()=>{},clearCoachCaches=()=>{},withTimeout=promise=>promise,saveProgressRpc=(name,args)=>client.rpc(name,args);
const setButtonBusy=(button,label)=>{const text=button.textContent;button.disabled=true;button.textContent=label;return()=>{button.disabled=false;button.textContent=text;};};
const dailyVenues=rows=>[...new Set(rows.filter(a=>a.category==='daily').map(a=>a.venue))],assignmentsForVenue=(rows,venue)=>rows.filter(a=>a.venue===venue),venueLabel=v=>v,venueIdentityKey=v=>v;
const isAssignmentComplete=row=>Boolean(row.completed),orderedAssignments=rows=>rows,assignmentPresentation=row=>({title:row.trick_name,notes:''}),assignmentStatus=row=>row.completed?'Done':'To do',selectedVenueFor=()=>state.selectedVenue;
const categoryDisplayInfo=category=>({label:({daily:'Daily Tricks',one_bang:'One Bangs',dialled:'Dialled',lines:'Lines',percentage:'Percentage',foam_pit:'Foam Pit',bonus:'Bonus'})[category],description:'Assigned training'}),categoryRewardLabels={};
const percentageAssignmentList=rows=>rows.map(row=>'<button type="button" data-percentage-action="true" data-assignment-id="'+row.id+'">Percentage attempt</button>').join('');
const isContestPrepProfile=()=>true,weeklyCompletionPercent=()=>25,getWeeklyAssignments=async id=>({assignments:assignments.filter(a=>a.athlete_id===id),awards:[]}),getLeaderboard=async()=>[{athlete_id:'r1',weekly_points:47},{athlete_id:'r2',weekly_points:23}],localDate=()=>new Date().toISOString().slice(0,10),countryTimezones={AU:'Australia/Brisbane'},dateForTimezone=(_,date=new Date())=>date.toISOString().slice(0,10);
const clearHelpVideoPreview=()=>{},extraTricksSection=()=>'',sheetRulesButtonHtml=()=>'',bindVenueSelector=()=>{},bindDailyVenueAccordions=()=>{},bindSessionAssignmentAccordions=()=>{},bindExtraTrickActions=()=>{},bindDailyReorder=()=>{},bindSessionQuickJumps=()=>{},bindSheetRulesButton=()=>{};
const bindTrainingProgressActions=()=>{},refreshOpenTrainingProgress=id=>progressRefreshes.push(id),showTrainingSharePreview=payload=>shares.push(payload);
const setPendingAssignmentProgress=(id,complete)=>state.pendingAssignmentProgress.set(id,{complete}),clearPendingAssignmentProgress=id=>state.pendingAssignmentProgress.delete(id),invalidateSessionViewerData=()=>{},refreshOwnXpAfterAction=async()=>{},showUpdatedWeeklyScore=async()=>{},showProgressPopup=()=>{throw new Error('Legacy automatic popup must not run');};
const recordPercentageAttempt=()=>notices.push('Percentage stays untimed'),isCoachRole=role=>['coach','admin'].includes(role),sessionViewerAssignmentEditor=()=>'',avatarHtml=athlete=>'<span class="avatar">'+athlete.display_name.slice(-3)+'</span>';
function sessionViewerPlanList(entry,group){return sessionViewerListContent(entry,group,'daily');}
function renderAthleteHome(){return renderSession();}
async function renderSessionViewer(){refreshCount++;const view=document.querySelector('#view');view.dataset.view='sessionViewer';view.className='content';view.innerHTML='<div class="viewer-rider-grid viewer-accordion-list">'+riders.map(athlete=>{const participant=state.sessionViewerActiveSessionCache?.coach_group_session_participants.find(p=>p.athlete_id===athlete.id);return sessionViewerRiderCardHtml({athlete,daily:daily(athlete.id),venue:'Test Park',participant,assignments:assignments.filter(a=>a.athlete_id===athlete.id)},state.sessionViewerActiveSessionCache);}).join('')+'</div>';view.querySelectorAll('[data-viewer-athlete]').forEach(button=>button.onclick=()=>{state.sessionViewerOpenAthleteId=button.dataset.viewerAthlete;renderSessionViewer();});view.querySelectorAll('[data-viewer-assignment-action]').forEach(button=>button.onclick=recordViewerAssignmentAction);view.querySelectorAll('[data-finish-daily-athlete]').forEach(button=>button.onclick=finishViewerDailyTimer);}
const refreshSessionViewerLight=()=>renderSessionViewer();
function coachMode(){dismissDailyFinishForNavigation();state.user={id:'coach'};state.profile={role:'coach',display_name:'Test Coach'};state.view='sessionViewer';state.sessionViewerRosterCache=riders;state.sessionViewerOpenAthleteId='r1';state.sessionViewerActiveSessionCache={id:'group',status:'active',started_at:new Date(clockNow-70000).toISOString(),coach_group_session_participants:riders.map(r=>({athlete_id:r.id,training_session_id:'session-'+r.id,daily_finish_seconds:null}))};results={};candidates={};riders.forEach(r=>{sessions[r.id]=makeSession(r.id);daily(r.id).forEach((a,i)=>a.completed=i===0);});document.querySelector('.app-shell').className='app-shell coach-shell';return renderSessionViewer();}
`;
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
    page.setDefaultTimeout(8000);page.on('pageerror',error=>{errors.push(error.message);console.error('Fixture page error:',error.message);});await page.route('**/*',route=>route.abort());
    await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><html data-theme="dark"><body><div id="app"><div class="app-shell rider-shell" style="display:block"><main id="view"></main></div></div></body></html>');
    for(const file of ['styles.css','daily-completion.css','progress-sharing.css'])await page.addStyleTag({content:fs.readFileSync(path.join(root,file),'utf8')});
    await page.addScriptTag({content:fs.readFileSync(path.join(root,'daily-completion.js'),'utf8')});
    await page.addScriptTag({content:fs.readFileSync(path.join(root,'progress-sharing.js'),'utf8')});
    await page.addScriptTag({content:fixture+'\n'+actual+'\nrenderSession();'});
    await page.waitForSelector('#create-session');
    assert.equal(await page.locator('.daily-finish-backdrop').count(),0);assert.equal(await page.evaluate(()=>rpcCalls.length),0,'Rendering does not request a finish');
    assert.equal(await page.locator('#create-session').textContent(),'Start Daily Tricks');
    await page.evaluate(()=>failAction=true);await page.locator('[data-assignment-id="r1-a1"]').click();
    await page.waitForFunction(()=>notices.some(message=>message.includes('Start Daily Tricks')));
    assert.equal(await page.locator('.daily-finish-backdrop').count(),0,'Rejected pre-timer tick never celebrates');assert.equal(await page.locator('[data-assignment-id="r1-a1"]').getAttribute('data-assignment-action'),'landed','Rejected tick remains incomplete');
    await page.click('#create-session');await page.waitForSelector('#finish-daily-tricks');
    assert(await page.locator('#finish-daily-tricks').isDisabled(),'Cannot manually finish an incomplete checklist');
    await page.evaluate(async()=>{await renderSession();await renderSession();});assert.equal(await page.evaluate(()=>liveIntervals.size),1,'Repeated rendering keeps only one running Daily timer');
    assert.equal(await page.locator('#end-session').count(),0,'No session-end action on Daily timer');
    await page.locator('[data-assignment-id="r1-a0"]').click();await page.waitForFunction(()=>daily('r1')[0].completed);assert.equal(await page.locator('.daily-finish-backdrop').count(),0,'A nonfinal tick does not prompt');
    await page.evaluate(()=>holdAction=true);
    await page.locator('[data-assignment-id="r1-a1"]').click();
    const tap=await page.evaluate(()=>rpcCalls.filter(row=>row.name==='record_daily_trick_action').at(-1).args.p_tapped_at);
    await page.evaluate(()=>{clockNow+=12000;updateTimer();});
    assert.equal(await page.locator('.daily-finish-backdrop').count(),0,'No popup from optimistic tick');
    await page.evaluate(()=>{holdAction=false;actionReleases.splice(0).forEach(release=>release());});
    await page.waitForSelector('[data-confirm-daily]');
    assert.equal(await page.locator('.daily-finish-time strong').textContent(),'01:10','Final tap time excludes network delay');
    await capture(page,'daily-confirmation-phone');
    assert.equal(await page.evaluate(()=>dailyFinishUi.current.candidate.captured_at),tap);
    assert.equal(await page.evaluate(()=>dailyFinishUi.current.context.tappedAt),tap);
    await page.evaluate(()=>renderSession());assert.equal(await page.locator('.daily-finish-backdrop').count(),1,'A list refresh does not duplicate confirmation');
    await page.locator('[data-cancel-daily]').click();
    assert.equal(await page.locator('.daily-finish-backdrop').count(),0);
    assert.equal(await page.locator('[data-assignment-id="r1-a1"]').getAttribute('data-assignment-action'),'unlanded','Go back keeps landed trick');
    const before=await page.locator('#trick-timer').textContent();await page.evaluate(()=>{clockNow+=5000;updateTimer();});assert.notEqual(await page.locator('#trick-timer').textContent(),before,'Go back keeps timer running');
    await page.evaluate(()=>renderSession());assert.equal(await page.locator('.daily-finish-backdrop').count(),0,'Reload does not reopen final popup');
    await page.locator('[data-assignment-id="r1-a1"]').click();await page.waitForFunction(()=>!daily('r1')[1].completed);
    assert(await page.locator('#finish-daily-tricks').isDisabled());assert.equal(await page.locator('.daily-finish-backdrop').count(),0);
    await page.locator('[data-assignment-id="r1-a1"]').click();await page.waitForSelector('[data-confirm-daily]');
    const corrected=await page.evaluate(()=>dailyFinishUi.current.candidate.id);assert.equal(await page.locator('.daily-finish-time strong').textContent(),'01:27');
    await page.locator('[data-cancel-daily]').click();await page.evaluate(()=>{clockNow+=3000;holdPrepare=true;});
    await page.locator('#finish-daily-tricks').click();await page.evaluate(()=>{clockNow+=9000;});
    await page.evaluate(()=>{holdPrepare=false;prepareReleases.splice(0).forEach(release=>release());});await page.waitForSelector('[data-confirm-daily]');
    const reopened=await page.evaluate(()=>dailyFinishUi.current.candidate.id);assert.notEqual(reopened,corrected);assert.equal(await page.locator('.daily-finish-time strong').textContent(),'01:30','Manual reopen uses new Finish tap, excluding wait');
    await page.evaluate(()=>{holdConfirm=true;failConfirm=true;});await page.locator('[data-confirm-daily]').dblclick();
    assert.equal(await page.evaluate(()=>rpcCalls.filter(row=>row.name==='confirm_daily_finish').length),1,'Double tap submits once');
    assert.equal(await page.locator('.daily-result-dialog').count(),0,'No result celebration while saving');
    await page.evaluate(()=>{holdConfirm=false;confirmReleases.splice(0).forEach(release=>release());});await page.waitForFunction(()=>document.querySelector('[data-confirm-daily]')?.textContent==='Retry finish');
    assert.equal(await page.locator('.daily-result-dialog').count(),0,'Failed save never celebrates');assert((await page.locator('.daily-finish-error').textContent()).includes('same finish'));
    await page.locator('[data-confirm-daily]').click();await page.waitForSelector('.daily-result-dialog');
    const confirms=await page.evaluate(()=>rpcCalls.filter(row=>row.name==='confirm_daily_finish').map(row=>row.args.p_candidate_id));assert.deepEqual(confirms,[reopened,reopened],'Retry preserves idempotency key');
    await capture(page,'daily-result-phone');
    const resultText=await page.locator('.daily-result-dialog').textContent();
    for(const text of ['Test Rider One','01:30','+2','Daily completion points','47','Weekly score','Personal best · same list','#4','You matched your personal best.'])assert(resultText.includes(text),text);
    assert.equal(await page.evaluate(()=>sessions.r1.ended_at),null,'Finish does not end training');
    for(const width of [320,390,1024]){await page.setViewportSize({width,height:844});assert(await page.locator('.daily-finish-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Result content fits '+width);assert(await page.locator('.daily-finish-backdrop').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Result backdrop fits '+width);}
    await page.locator('[data-share-daily]').click();assert.equal(await page.evaluate(()=>shares.length),1);assert.equal(await page.evaluate(()=>shares[0].dailyResult.result_id),'result-r1','Share receives saved result only');
    await page.locator('[data-keep-riding]').click();assert.equal(await page.locator('.daily-finish-backdrop').count(),0);assert.equal(await page.locator('#finish-daily-tricks').textContent(),'View Daily result');
    assert.equal(await page.evaluate(()=>state.timer),null,'Only the rider Daily timer stops after confirmed save');assert.equal(await page.evaluate(()=>liveIntervals.size),0,'Confirmed save removes all Daily clock intervals');
    for(const category of ['one_bang','dialled','lines','foam_pit','bonus'])assert.equal(await page.locator('[data-assignment-category="'+category+'"]').count(),1,'Untimed '+category+' stays available');
    await page.locator('[data-assignment-section="one-bang"] summary').click();await page.locator('[data-assignment-id="r1-a2"]').click();
    await page.waitForFunction(()=>rpcCalls.some(row=>row.name==='record_assignment_action_at_venue'));assert.equal(await page.locator('.daily-finish-backdrop').count(),0,'Untimed completion never opens Daily result');
    await page.locator('#finish-daily-tricks').click();await page.waitForSelector('.daily-result-dialog');
    assert.equal(await page.evaluate(()=>rpcCalls.filter(row=>row.name==='confirm_daily_finish').length),2,'Viewing saved result awards nothing again');
    await page.locator('[data-keep-riding]').click();
    // Older saved times have no comparable-list provenance and cannot imply a PB.
    await page.evaluate(()=>{results.r1={result_id:'legacy-r1',athlete_id:'r1',rider_name:'Test Rider One',session_id:'session-r1',seconds:90,completed_at:new Date().toISOString(),legacy:true,pb_comparable:false,completion_points:null};});
    await page.locator('#finish-daily-tricks').click();await page.waitForSelector('.daily-result-dialog');
    const legacyText=await page.locator('.daily-result-dialog').textContent();
    assert(!legacyText.includes('same list'),'Legacy result must not claim comparable-list PB provenance');
    assert.equal(await page.locator('.daily-pb-banner').count(),0,'Legacy saved time never gets a PB celebration');
    assert.deepEqual(await page.locator('.daily-result-stats strong').allTextContents(),['—','—'],'Missing legacy completion/weekly totals remain unavailable');
    await page.locator('[data-keep-riding]').click();
    // A persisted zero-second result is a valid saved result, identified by its timestamp.
    await page.evaluate(()=>{results.r1={result_id:'zero-r1',athlete_id:'r1',rider_name:'Test Rider One',session_id:'session-r1',seconds:0,completed_at:new Date().toISOString(),completion_points:0,weekly_score:47,pb_seconds:0,previous_pb_seconds:90,is_new_pb:true,pb_comparable:true};Object.assign(sessions.r1,{daily_completed_seconds:0,daily_completed_at:results.r1.completed_at});return renderSession();});
    assert.equal(await page.locator('#finish-daily-tricks').textContent(),'View Daily result','Zero-second saved result is still finished');
    assert.equal(await page.locator('#trick-timer').textContent(),'00:00');assert.equal(await page.evaluate(()=>liveIntervals.size),0,'Zero-second saved result does not restart clock');
    assert.equal(await page.locator('.session-pb-chip').last().locator('strong').textContent(),'00:00','Saved zero time is not treated as missing');
    await page.locator('#finish-daily-tricks').click();await page.waitForSelector('.daily-result-dialog');
    assert.equal(await page.locator('.daily-finish-time strong').textContent(),'00:00');assert.equal(await page.locator('.daily-result-stats strong').first().textContent(),'+0','Zero completion points stay zero');
    await page.locator('[data-keep-riding]').click();
    // A different venue gets a fresh Daily timer while the previous result stays saved.
    await page.evaluate(()=>{state.selectedVenue='Second Park';assignments.push(...[0,1].map(index=>({id:'r1-b'+index,athlete_id:'r1',category:'daily',venue:'Second Park',trick_name:'Second Park trick '+index,completed:false})));return renderSession();});
    assert.equal(await page.locator('#create-session').textContent(),'Start Daily Tricks','A new venue offers its own Daily timer');
    assert.equal(await page.locator('.session-pb-chip').last().locator('strong').textContent(),'Not finished today','New venue does not reuse another park’s time');
    await page.locator('#create-session').click();await page.waitForSelector('#finish-daily-tricks');
    assert.equal(await page.evaluate(()=>rpcCalls.filter(row=>row.name==='start_daily_tricks').at(-1).args.p_venue),'Second Park');
    assert.equal(await page.evaluate(()=>savedResults.at(-1).result_id),'zero-r1','Starting another venue preserves the previous result');
    assert.equal(await page.evaluate(()=>sessions.r1.daily_completed_seconds),null,'New venue has an unfinished clock');
    // Display labels for the default list are normalized before all Daily RPCs.
    await page.evaluate(()=>{sessions.r1=null;results.r1=null;state.selectedVenue='Default Daily List';assignments=assignments.filter(a=>a.athlete_id!=='r1'||a.category!=='daily');assignments.push(...[0,1].map(index=>({id:'r1-default'+index,athlete_id:'r1',category:'daily',venue:'Default Daily List',trick_name:'Default trick '+index,completed:false})));state.sessionOpenDailyVenues.add('Default Daily List');return renderSession();});
    await page.locator('#create-session').click();await page.waitForSelector('#finish-daily-tricks');assert.equal(await page.evaluate(()=>rpcCalls.filter(row=>row.name==='start_daily_tricks').at(-1).args.p_venue),'');
    await page.locator('[data-assignment-id="r1-default0"]').click();await page.waitForFunction(()=>daily('r1')[0].completed);
    await page.locator('[data-assignment-id="r1-default1"]').click();await page.waitForSelector('[data-confirm-daily]');
    assert.equal(await page.evaluate(()=>rpcCalls.filter(row=>row.name==='record_daily_trick_action').at(-1).args.p_venue),'');
    await page.locator('[data-cancel-daily]').click();await page.locator('#finish-daily-tricks').click();await page.waitForSelector('[data-confirm-daily]');assert.equal(await page.evaluate(()=>rpcCalls.filter(row=>row.name==='prepare_daily_finish').at(-1).args.p_venue),'');
    await page.locator('[data-cancel-daily]').click();
    await page.evaluate(()=>{assignments=assignments.filter(a=>!a.id.startsWith('r1-default'));assignments.push(...[0,1].map(index=>({id:'r1-a'+index,athlete_id:'r1',category:'daily',venue:'Test Park',trick_name:'Daily trick '+index,completed:index===0})));return coachMode();});
    assert.equal(await page.locator('.daily-finish-backdrop').count(),0,'Coach render never opens a finish');
    assert(await page.locator('[data-finish-daily-athlete="r1"]').isDisabled());assert(await page.locator('[data-finish-daily-athlete="r2"]').isDisabled());
    await page.evaluate(()=>holdAction=true);
    await page.locator('[data-assignment-id="r1-a1"]').click();
    await page.locator('[data-viewer-athlete="r2"]').click();await page.locator('[data-assignment-id="r2-a1"]').click();
    await page.evaluate(()=>{holdAction=false;actionReleases.splice(0).forEach(release=>release());});await page.waitForSelector('[data-confirm-daily]');
    assert.equal(await page.locator('.daily-finish-backdrop').count(),1,'Concurrent riders show one confirmation at a time');
    assert.equal(await page.evaluate(()=>dailyFinishUi.queued.length),1);assert((await page.locator('.daily-finish-dialog .eyebrow').textContent()).includes('Test Rider One'));
    await page.locator('[data-confirm-daily]').click();await page.waitForSelector('.daily-result-dialog');assert((await page.locator('.daily-result-dialog').textContent()).includes('Test Rider One'));
    assert.equal(await page.evaluate(()=>state.sessionViewerActiveSessionCache.coach_group_session_participants[0].daily_finish_seconds),70);assert.equal(await page.evaluate(()=>state.sessionViewerActiveSessionCache.coach_group_session_participants[1].daily_finish_seconds),null,'Other rider remains unfinished');
    await page.locator('[data-keep-riding]').click();await page.waitForSelector('[data-confirm-daily]');assert((await page.locator('.daily-finish-dialog .eyebrow').textContent()).includes('Test Rider Two'));
    await page.locator('[data-cancel-daily]').click();assert.equal(await page.evaluate(()=>sessions.r2.daily_completed_seconds),null);assert.equal(await page.evaluate(()=>state.sessionViewerActiveSessionCache.status),'active','Group clock stays active');
    await page.evaluate(()=>{clockNow+=2000;});await page.locator('[data-finish-daily-athlete="r2"]').click();await page.waitForSelector('[data-confirm-daily]');
    await page.locator('[data-confirm-daily]').click();await page.waitForSelector('.daily-result-dialog');
    const coachResult=await page.locator('.daily-result-dialog').textContent();for(const text of ['Test Rider Two','+3','23','#8','NEW PERSONAL BEST'])assert(coachResult.includes(text),text);
    await page.locator('[data-keep-riding]').click();await page.evaluate(()=>renderSessionViewer());assert.equal(await page.locator('.daily-finish-backdrop').count(),0,'Coach refresh never pops saved results');
    await capture(page,'daily-coach-context-tablet');
    await page.evaluate(()=>{results.r2=null;daily('r2').forEach(a=>a.completed=true);holdPrepare=true;});
    await page.locator('[data-finish-daily-athlete="r2"]').click();await page.evaluate(()=>{state.view='coachHome';dismissDailyFinishForNavigation();state.view='sessionViewer';holdPrepare=false;prepareReleases.splice(0).forEach(release=>release());});
    await page.waitForFunction(()=>dailyFinishUi.requests.size===0);assert.equal(await page.locator('.daily-finish-backdrop').count(),0,'Leaving and returning to same page suppresses stale response');
    assert.deepEqual(errors,[]);
    console.log('PASS actual rider/coach Daily controls, final-tap timing, corrections/reopen, same-candidate retries, no premature celebration, isolated rider queues, Keep riding, saved share hook, navigation/realtime safety and mobile/tablet layout. No live requests.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
