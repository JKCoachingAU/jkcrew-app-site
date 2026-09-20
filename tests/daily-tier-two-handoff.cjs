// Real Daily confirmation + Tier 2 module + app handoff/mount helpers.
// The RPC fixture stores one result per candidate and one revealed round/day.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.JKCREW_PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'app.js'),'utf8');
const begin=source.indexOf('// Feature modules keep'),end=source.indexOf('async function renderSession({',begin);
assert(begin>=0&&end>begin);const helpers=source.slice(begin,end);
assert(helpers.includes('showDailyTierTwoAfterFinish'),'Actual app handoff helper exists');
const fixture=String.raw`
window.calls=[];window.notices=[];window.popupShows=[];window.results={};window.failConfirmOnce=false;window.failTier=false;window.holdConfirm=false;window.releaseConfirm=null;window.disabled=false;window.unknown=false;window.holdTierRead=false;window.releaseTierRead=null;
const state={user:{id:'r1'},profile:{id:'r1',role:'athlete',display_name:'Rider One'},view:'session',selectedVenue:'Test park',activeTraining:{id:'s-r1',started_at:new Date(Date.now()-90000).toISOString()},timer:null,sessionViewerOpenAthleteId:'r2',sessionViewerActiveList:'daily',sessionOpenDailyVenues:new Set(['Test park']),sessionOpenAssignmentSections:new Set(),sessionViewerVenue:'Test park',sessionViewerRosterCache:[{id:'r1',display_name:'Rider One'},{id:'r2',display_name:'Rider Two'}],sessionViewerActiveSessionCache:{id:'group',status:'active',coach_group_session_participants:[{athlete_id:'r1',training_session_id:'s-r1'},{athlete_id:'r2',training_session_id:'s-r2'}]}};
const date=new Date().toISOString().slice(0,10);
window.rounds=Object.fromEntries(['r1','r2'].map(id=>[id,{athlete_id:id,local_date:date,reset_at:new Date(Date.now()+60000).toISOString(),eligible:false,unlocked:false,items:[],points:0,reward_points:4}]));
window.full=true;
const candidate=id=>({candidate_id:'candidate-'+id,athlete_id:id,rider_name:id==='r1'?'Rider One':'Rider Two',session_id:'s-'+id,seconds:90,all_completed:full,completed_count:full?2:1,total_count:2});
const clone=v=>JSON.parse(JSON.stringify(v));
const client={async rpc(name,args){calls.push({name,args:clone(args)});const id=args.p_athlete_id||String(args.p_candidate_id||'').replace('candidate-','')||'r1';
 if(name==='confirm_daily_finish'){
  if(holdConfirm)await new Promise(resolve=>releaseConfirm=resolve);
  if(!results[id]){const c=candidate(id);results[id]={...c,result_id:'result-'+id,candidate_id:args.p_candidate_id,local_date:date,completed_at:new Date().toISOString(),completion_points:c.all_completed?2:0,completion_xp:c.all_completed?35:0,weekly_score:42,rank_number:3,pb_comparable:c.all_completed,is_first_pb:c.all_completed,is_new_pb:false,pb_seconds:90,previous_pb_seconds:null};rounds[id].eligible=c.all_completed;}
  if(failConfirmOnce){failConfirmOnce=false;return{error:{message:'Response interrupted'}};}
  return {data:clone(results[id])};
 }
 if(name==='prepare_daily_finish')return {data:results[id]?{result:clone(results[id])}:{completion_candidate:candidate(id)}};
 if(name.includes('daily_tier_two')){
  if(failTier)return {error:{message:'Tier 2 temporarily unavailable'}};
  const round=rounds[id];let extra={};
  if(name==='get_daily_tier_two'&&holdTierRead){holdTierRead=false;const before=clone(round);await new Promise(resolve=>releaseTierRead=resolve);return {data:before};}
  if(name==='unlock_daily_tier_two'&&round.eligible&&!round.unlocked)Object.assign(round,{unlocked:true,source:'daily_round_two',items:[{id:id+'-t1',trick_name:'Bunny hop',notes:'Controlled landing',landed:false},{id:id+'-t2',trick_name:'Manual',notes:'Stay balanced',landed:false}],total_count:2,completed_count:0,revealed_at:null});
  if(name==='claim_daily_tier_two_reveal'){if(!round.unlocked)return {error:{message:'Not unlocked'}};extra.reveal_claimed=!round.revealed_at;round.revealed_at=round.revealed_at||new Date().toISOString();}
  if(name==='record_daily_tier_two_trick'){round.items.find(item=>item.id===args.p_item_id).landed=args.p_landed;round.completed_count=round.items.filter(item=>item.landed).length;}
  if(name==='complete_daily_tier_two'){extra.points_awarded=round.completed_at?0:4;round.completed_at=round.completed_at||new Date().toISOString();round.points=4;}
  return {data:{...clone(round),...extra}};
 }
 throw Error('Unexpected RPC '+name);
}};
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const formatTime=s=>String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
const isCoachRole=role=>['coach','admin'].includes(role),riderFeaturesDisabled=()=>disabled,riderFeatureAccessUnknown=()=>unknown;
const cacheClear=()=>{},clearCoachCaches=()=>{},updateTimer=()=>{},refreshOpenTrainingProgress=()=>{},withTimeout=promise=>promise,setSyncStatus=()=>{},messageFrom=e=>e.message||String(e),notify=message=>notices.push(message);
const setButtonBusy=(button,text)=>{const previous=button.textContent;button.disabled=true;button.textContent=text;return()=>{button.disabled=false;button.textContent=previous;};};
const TRAINING_SHARE_CARDS_ENABLED=false;
const nativeShowModal=HTMLDialogElement.prototype.showModal;
HTMLDialogElement.prototype.showModal=function(){popupShows.push({className:this.className,text:this.textContent});return nativeShowModal.call(this);};
function mountRecords(){return [...dailyFeatureMounts.values()];}
function tierHandle(id='r1'){return mountRecords().find(m=>m.host.dataset.dailyTierTwoHost===id)?.handle;}
function bindFinish(){document.querySelectorAll('[data-finish-daily-athlete]').forEach(button=>button.onclick=()=>requestDailyFinish(button,state.profile.role==='coach'));}
function paint(){
 const view=document.querySelector('#view');
 if(state.profile.role==='coach')view.innerHTML=['r1','r2'].map(id=>'<article class="viewer-rider-accordion open" data-rider="'+id+'"><button data-viewer-athlete="'+id+'">'+id+'</button><button data-finish-daily-athlete="'+id+'">View Daily result</button><div id="viewer-plan-'+id+'" data-viewer-plan="'+id+'"><div class="viewer-list-tone-daily" data-completed-daily><details id="daily-'+id+'" open><summary>Daily '+id+'</summary>Tier 1 list</details></div>'+dailyTierTwoHost(id)+'</div></article>').join('');
 else view.innerHTML='<button id="finish-daily-tricks" data-finish-daily-athlete="r1">View Daily result</button><section class="daily-session-hub"><details id="daily-r1" open><summary>Daily list</summary>Tier 1 list</details></section>'+dailyTierTwoHost('r1')+'<button id="other-category">One Bangs</button>';
 bindFinish();mountDailyFeatures();
}
async function renderSession(){paint();}
async function renderSessionViewer(){paint();}
async function refreshSessionViewerLight(){paint();}
async function renderAthleteHome(){paint();}
function coachMode(){dismissDailyFinishForNavigation();clearDailyFeatureMounts();state.user={id:'coach'};state.profile={id:'coach',role:'coach',display_name:'Coach'};state.view='sessionViewer';state.activeTraining=null;paint();}
function showConfirm(id='r1'){const button=document.querySelector('[data-finish-daily-athlete="'+id+'"]');const context=dailyFinishContext(button,state.profile.role==='coach');showDailyFinishConfirmation(normalizedDailyCandidate(candidate(id)),context);return context;}
`;
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});let checks=0;
 const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;},ok=(value,message)=>{assert(value,message);checks++;};
 const pages=[];
 async function fresh({coach=false,reducedMotion=false}={}){
  const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:reducedMotion?'reduce':'no-preference'});pages.push(page);page.setDefaultTimeout(7000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>route.abort());
  await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><html data-theme="dark"><body style="background:#081018;color:white"><main id="view"></main></body></html>');
  for(const name of ['styles.css','daily-completion.css','daily-tier-two.css'])await page.addStyleTag({content:fs.readFileSync(path.join(root,name),'utf8')});
  for(const name of ['daily-completion.js','daily-tier-two.js'])await page.addScriptTag({content:fs.readFileSync(path.join(root,name),'utf8')});
  await page.addScriptTag({content:fixture+'\n'+helpers});await page.evaluate(coach=>coach?coachMode():paint(),coach);await page.waitForFunction(()=>mountRecords().length>0);await page.evaluate(()=>Promise.all(mountRecords().map(m=>m.handle.ready)));return {page,errors};
 }
 try{
  {
   const {page,errors}=await fresh();await page.evaluate(()=>{holdConfirm=true;showConfirm();});await page.click('[data-confirm-daily]');
   eq(await page.locator('dialog.daily-tier-two-unlock').count(),0,'No Tier 2 popup before confirmed save');
   eq(await page.evaluate(()=>calls.filter(c=>c.name==='claim_daily_tier_two_reveal').length),0,'Pending save does not consume reveal');
   await page.evaluate(()=>{holdConfirm=false;releaseConfirm();});await page.waitForSelector('dialog.daily-tier-two-unlock[open]');
   eq(await page.locator('.daily-result-dialog').count(),0,'Confirmed full Daily goes directly to Tier 2, not old result celebration');
   eq(await page.locator('.daily-finish-backdrop').count(),0,'Confirmation closes before Tier 2 handoff');
   eq(await page.evaluate(()=>state.activeTraining.daily_result.all_completed),true,'Saved Daily remains authoritative');
   await page.waitForTimeout(300);await page.screenshot({path:'/tmp/jkcrew-tier2-unlock-mobile.png'});
   await page.waitForSelector('dialog.daily-tier-two-unlock',{state:'detached'});await page.waitForSelector('[data-tier-two-item]');
   await page.waitForFunction(()=>!document.querySelector('#daily-r1').open);
   eq(await page.evaluate(()=>document.activeElement?.tagName),'H3','Timed popup handoff focuses the unlocked list');
   await page.waitForTimeout(900);await page.screenshot({path:'/tmp/jkcrew-tier2-list-mobile.png'});
   eq(await page.locator('[data-tier-two-item]').count(),2,'Unlocked list is immediately usable');eq(await page.evaluate(()=>popupShows.length),1,'One automatic unlock popup');
   await page.evaluate(()=>paint());await page.evaluate(()=>tierHandle().refresh());eq(await page.evaluate(()=>popupShows.length),1,'Refresh does not replay unlock');
   await page.click('#finish-daily-tricks');await page.waitForSelector('.daily-result-dialog');
   eq(await page.locator('.daily-pb-banner,.daily-result-mark.new-pb').count(),0,'Reopened old receipt never replays PB celebration');
   await page.click('[data-view-tier-two]');await page.waitForSelector('[data-tier-two-item]');
   eq(await page.evaluate(()=>popupShows.length),1,'Viewing Tier 2 from saved receipt does not celebrate again');
   eq(await page.evaluate(()=>calls.filter(c=>c.name==='confirm_daily_finish').length),1,'Reopening saved result never confirms twice');
   eq(await page.evaluate(()=>calls.filter(c=>c.name==='claim_daily_tier_two_reveal').length),1,'Rider reveal is claimed once');
   eq(errors,[],'Full handoff has no browser errors');await page.close();
  }
  {
   const {page,errors}=await fresh();await page.evaluate(()=>{failConfirmOnce=true;showConfirm();});await page.click('[data-confirm-daily]');await page.waitForFunction(()=>document.querySelector('[data-confirm-daily]')?.textContent==='Retry finish');
   eq(await page.locator('dialog.daily-tier-two-unlock').count(),0,'Lost save response cannot display unverified celebration');
   await page.evaluate(()=>tierHandle().refresh());eq(await page.evaluate(()=>calls.filter(c=>c.name==='claim_daily_tier_two_reveal').length),0,'Confirmation blocks background auto reveal even after server saved result');
   await page.click('[data-confirm-daily]');await page.waitForSelector('dialog.daily-tier-two-unlock[open]');
   eq(await page.evaluate(()=>calls.filter(c=>c.name==='confirm_daily_finish').map(c=>c.args.p_candidate_id)),['candidate-r1','candidate-r1'],'Retry uses the original candidate');
   eq(await page.evaluate(()=>Object.keys(results).length),1,'Response retry preserves one saved finish');
   await page.click('[data-tier-two-enter]');eq(errors,[]);await page.close();
  }
  {
   const {page,errors}=await fresh();await page.evaluate(()=>{full=false;showConfirm();});await page.click('[data-confirm-daily]');await page.waitForSelector('.daily-result-dialog');
   eq(await page.locator('.daily-result-stats strong').first().textContent(),'+0','Partial Daily keeps zero-point receipt');
   eq(await page.locator('dialog.daily-tier-two-unlock').count(),0,'Partial finish has no Tier 2 popup');
   eq(await page.evaluate(()=>calls.some(c=>c.name==='unlock_daily_tier_two'||c.name==='claim_daily_tier_two_reveal')),false,'Partial finish never unlocks or claims');
   eq(await page.locator('[data-view-tier-two]').count(),0,'Partial receipt does not offer unavailable Tier 2');eq(errors,[]);await page.close();
  }
  {
   const {page,errors}=await fresh({coach:true});await page.evaluate(()=>showConfirm('r1'));await page.click('[data-confirm-daily]');await page.waitForSelector('dialog.daily-tier-two-unlock[open]');
   eq(await page.evaluate(()=>state.sessionViewerOpenAthleteId),'r1','Coach handoff selects the completed rider');
   eq(await page.locator('#daily-r2').evaluate(el=>el.open),true,'Other rider’s Daily list is not collapsed');
   eq(await page.evaluate(()=>calls.some(c=>c.name==='claim_daily_tier_two_reveal')),false,'Coach never consumes rider reveal');
   await page.click('[data-tier-two-enter]');await page.waitForSelector('[data-daily-tier-two-host="r1"] [data-tier-two-item]');
   await page.waitForFunction(()=>!document.querySelector('#daily-r1').open);eq(await page.locator('#daily-r1').evaluate(el=>el.open),false,'Coach handoff collapses only the completed rider Daily');
   eq(await page.locator('#daily-r2').evaluate(el=>el.open),true,'Other rider remains open after animation');
   await page.evaluate(async()=>{const context=dailyFinishContext(document.querySelector('[data-finish-daily-athlete="r1"]'),true);await showDailyTierTwoAfterFinish(results.r1,context,{celebrate:true});});
   eq(await page.evaluate(()=>popupShows.length),1,'Same coach/rider/day handoff does not repeat popup');eq(errors,[]);await page.close();
  }
  {
   const {page,errors}=await fresh({coach:true});await page.evaluate(()=>{showConfirm('r1');showConfirm('r2');});
   eq(await page.evaluate(()=>dailyFinishUi.queued.map(item=>item.context.athleteId)),['r2'],'Second rider waits in the Daily confirmation queue');
   await page.click('[data-confirm-daily]');await page.waitForSelector('dialog.daily-tier-two-unlock[open]');
   eq(await page.locator('.daily-finish-backdrop').count(),0,'Queued confirmation does not cover the first rider unlock');
   eq(await page.evaluate(()=>dailyFinishUi.queued.length),1,'Unlock preserves the next rider candidate');
   await page.click('[data-tier-two-enter]');await page.waitForSelector('[data-confirm-daily]');
   eq(await page.evaluate(()=>dailyFinishUi.current.context.athleteId),'r2','Closing first unlock resumes the next rider confirmation');
   await page.click('[data-confirm-daily]');await page.waitForSelector('dialog.daily-tier-two-unlock[open]');
   await page.click('[data-tier-two-enter]');
   eq(await page.evaluate(()=>Object.keys(results).sort()),['r1','r2'],'Both queued rider results are saved exactly once');
   eq(await page.evaluate(()=>calls.filter(c=>c.name==='confirm_daily_finish').map(c=>c.args.p_candidate_id)),['candidate-r1','candidate-r2'],'Queue keeps each candidate matched to its own rider');
   eq(await page.evaluate(()=>({queued:dailyFinishUi.queued.length,current:!!dailyFinishUi.current})),{queued:0,current:false},'Queue drains after both handoffs');
   eq(await page.evaluate(()=>popupShows.length),2,'Each coach rider has its own one-time unlock');
   eq(errors,[]);await page.close();
  }
  {
   const {page,errors}=await fresh({coach:true});await page.evaluate(()=>showConfirm('r1'));await page.click('[data-confirm-daily]');await page.waitForSelector('dialog.daily-tier-two-unlock[open]');await page.click('[data-tier-two-enter]');
   await page.click('[data-finish-daily-athlete="r1"]');await page.waitForSelector('.daily-result-dialog');await page.evaluate(()=>showConfirm('r2'));
   await page.click('[data-view-tier-two]');await page.waitForSelector('[data-confirm-daily]');
   eq(await page.evaluate(()=>dailyFinishUi.current.context.athleteId),'r2','A previously viewed Tier 2 also resumes queued confirmation');
   eq(await page.evaluate(()=>popupShows.length),1,'Neutral saved-result handoff does not replay the unlock');
   await page.click('[data-cancel-daily]');eq(await page.evaluate(()=>dailyFinishUi.queued.length),0,'Cancelling queued rider leaves no hidden confirmation');
   eq(errors,[]);await page.close();
  }
  {
   const {page,errors}=await fresh({coach:true});await page.evaluate(()=>showConfirm('r1'));await page.click('[data-confirm-daily]');await page.waitForSelector('dialog.daily-tier-two-unlock[open]');await page.click('[data-tier-two-enter]');
   await page.click('[data-finish-daily-athlete="r1"]');await page.waitForSelector('.daily-result-dialog');await page.evaluate(()=>{showConfirm('r2');failTier=true;});
   await page.click('[data-view-tier-two]');await page.waitForSelector('.daily-finish-backdrop');
   eq(await page.locator('.daily-finish-backdrop').count(),1,'Failed saved-receipt handoff keeps a visible way to resume queued riders');
   await page.evaluate(()=>failTier=false);
   if(await page.locator('[data-view-tier-two]').count())await page.click('[data-view-tier-two]');
   await page.waitForSelector('[data-confirm-daily]');
   eq(await page.evaluate(()=>dailyFinishUi.current.context.athleteId),'r2','Queued rider remains reachable after Tier 2 load failure');
   eq(await page.evaluate(()=>calls.filter(c=>c.name==='confirm_daily_finish').length),1,'Tier 2 retry never repeats saved Daily confirmation');
   eq(errors,[]);await page.close();
  }
  {
   const {page,errors}=await fresh({reducedMotion:true});await page.evaluate(()=>showConfirm());await page.click('[data-confirm-daily]');await page.waitForSelector('dialog.daily-tier-two-unlock[open]');
   await page.keyboard.press('Escape');await page.waitForSelector('[data-tier-two-item]');
   eq(await page.locator('.daily-tier-two--reveal').count(),0,'Reduced motion handoff omits list reveal animation');
   eq(await page.locator('#daily-r1').evaluate(el=>el.open),false,'Reduced motion collapses completed Daily immediately');
   eq(await page.evaluate(()=>document.activeElement?.tagName),'H3','Escape reaches the unlocked list with focus');eq(errors,[]);await page.close();
  }
  {
   const {page,errors}=await fresh();await page.evaluate(()=>{failTier=true;showConfirm();});await page.click('[data-confirm-daily]');await page.waitForSelector('.daily-result-dialog');
   eq(await page.evaluate(()=>results.r1.all_completed),true,'Tier 2 failure never rolls back saved Daily');eq(await page.locator('dialog.daily-tier-two-unlock').count(),0);
   await page.evaluate(()=>failTier=false);await page.click('[data-view-tier-two]');await page.waitForSelector('[data-tier-two-item]');
   eq(await page.evaluate(()=>calls.filter(c=>c.name==='confirm_daily_finish').length),1,'Retrying Tier 2 does not resubmit Daily');eq(errors,[]);await page.close();
  }
  {
   const {page,errors}=await fresh();await page.evaluate(()=>{holdConfirm=true;showConfirm();});await page.click('[data-confirm-daily]');
   await page.evaluate(()=>{dismissDailyFinishForNavigation();clearDailyFeatureMounts();state.view='home';document.querySelector('#view').textContent='New page';holdConfirm=false;releaseConfirm();});
   await page.waitForFunction(()=>!!results.r1);await page.waitForTimeout(100);
   eq(await page.locator('dialog.daily-tier-two-unlock,.daily-result-dialog').count(),0,'Late finish cannot open Tier 2 on another page');eq(await page.locator('#view').textContent(),'New page');eq(errors,[]);await page.close();
  }
  {
   const {page,errors}=await fresh();await page.evaluate(()=>{holdConfirm=true;showConfirm();});await page.click('[data-confirm-daily]');
   await page.evaluate(()=>{dismissDailyFinishForNavigation();clearDailyFeatureMounts();state.view='home';state.view='session';paint();showConfirm();holdConfirm=false;releaseConfirm();});
   await page.waitForFunction(()=>!!results.r1);await page.waitForTimeout(150);
   eq(await page.locator('[data-confirm-daily]').count(),1,'Late prior-view save cannot close a new confirmation');
   eq(await page.evaluate(()=>dailyFinishUi.current?.context.epoch),1,'New current confirmation survives old response');
   eq(errors,[]);await page.close();
  }
  {
   const {page,errors}=await fresh();await page.evaluate(()=>{holdTierRead=true;void tierHandle().refresh();showConfirm();});await page.waitForFunction(()=>!!releaseTierRead);await page.click('[data-confirm-daily]');
   await page.waitForFunction(()=>!!results.r1);await page.evaluate(()=>releaseTierRead());
   await page.waitForSelector('dialog.daily-tier-two-unlock[open]');
   eq(await page.locator('.daily-result-dialog').count(),0,'Pre-save stale Tier 2 read cannot replace confirmed direct handoff');
   eq(await page.evaluate(()=>calls.filter(c=>c.name==='confirm_daily_finish').length),1,'Fresh post-save Tier 2 read does not repeat Daily save');
   eq(errors,[]);await page.close();
  }
  console.log(JSON.stringify({status:'PASS',checks,coverage:['rider full Daily direct handoff','same-candidate lost-response retry','modal blocks background reveal','neutral saved receipt','coach target and reveal separation','queued rider continuation','reduced motion and Escape','partial/error/navigation safety'],production_requests:0},null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
