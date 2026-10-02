// Actual standard Daily save handlers after Tier 2 retirement. RPCs are synthetic.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.JKCREW_PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..'),app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const extract=(start,end)=>{const a=app.indexOf(start),b=app.indexOf(end,a);assert(a>=0&&b>a,start);return app.slice(a,b);};
const handlers=[extract('async function saveWeeklyAssignments(','\nasync function saveDailyVenueFromStudentProfile('),extract('async function saveDailyVenueFromStudentProfile(','\nasync function saveCategoryListFromStudentProfile('),extract('async function saveSessionViewerAssignments(','\nasync function toggleViewerGoal(')].join('\n');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH});let checks=0;
 const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;},ok=(a,m)=>{assert(a,m);checks++;};
 async function fixture(){
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.abort());
  await page.setContent('<main id="view"><form id="assignment-form"><textarea name="dailyVenueTricks:0">Barspin</textarea><button id="save-week" type="submit">Save full schedule</button></form><div data-venue-panel="0"><input name="dailyVenueName:0" value="Park"><textarea name="dailyVenueTricks:0">Barspin</textarea><button id="save-venue" type="button" data-save-daily-venue="0" data-original-venue="Park">Save Daily</button></div><form id="viewer-form" data-athlete-id="rider-a" data-viewer-assignment-editor="daily" data-venue="Park"><textarea name="assignmentLines">Barspin</textarea><button id="save-viewer" type="submit">Save Daily</button></form></main>');
  await page.evaluate(()=>{
   window.state={user:{id:'coach-a'},profile:{role:'coach'},view:'studentProfile',selectedAthleteId:'rider-a',sessionViewerRosterCache:[{id:'rider-a',country_code:'AU'}]};
   window.calls=[];window.messages=[];window.renders=0;window.mode={fail:false,hold:false};
   window.client={rpc:async(name,args)=>{calls.push({name,args:structuredClone(args)});if(/tier_two/.test(name))throw Error('Retired Tier 2 request');if(mode.hold)await new Promise(resolve=>window.release=resolve);return mode.fail?{error:{message:'Connection interrupted'}}:{data:null,error:null};}};
   window.weekStartDate=window.weekStartDateForCountry=()=> '2026-09-28';
   window.categoryInfo={daily:{},one_bang:{}};window.categoryDisplayInfo=id=>({label:id==='daily'?'Daily Tricks':'One Bangs'});
   window.assignmentsFromScheduleForm=(form,athleteId)=>({dailyVenueRows:[{name:'Park'}],assignments:String(form.get('dailyVenueTricks:0')).split('\n').map(trick_name=>({athlete_id:athleteId,trick_name,category:'daily'}))});
   window.parseAssignmentLine=(line,index,category,venue)=>line?({trick_name:line,category,venue,sort_order:index}):null;
   window.withTimeout=promise=>promise;window.venueKey=value=>value;window.messageFrom=e=>e.message;window.clearCoachCaches=()=>{};window.notify=(message,tone)=>messages.push({message,tone});
   window.renderStudentProfile=window.refreshSessionViewerLight=async()=>{renders++;document.querySelectorAll('button').forEach(button=>button.disabled=false);};
   window.setButtonBusy=(button,label)=>{const before=button.textContent;button.textContent=label;button.disabled=true;return()=>{button.textContent=before;button.disabled=false;};};
  });
  await page.addScriptTag({content:handlers+`\ndocument.querySelector('#assignment-form').addEventListener('submit',event=>{window.pending=saveWeeklyAssignments(event);});document.querySelector('#save-venue').addEventListener('click',event=>{window.pending=saveDailyVenueFromStudentProfile(event);});document.querySelector('#viewer-form').addEventListener('submit',event=>{window.pending=saveSessionViewerAssignments(event);});`});
  return{page,close:async()=>{eq(errors,[],'No browser errors');await page.close();},save:async selector=>{await page.locator(selector).click();await page.evaluate(()=>pending);}};
 }
 try{
  for(const [button,input,rpc] of [['#save-week','#assignment-form textarea','save_weekly_assignments'],['#save-venue','[data-venue-panel] textarea','save_weekly_assignment_list'],['#save-viewer','#viewer-form textarea','save_weekly_assignment_list']]){
   const f=await fixture();await f.page.locator(input).fill('Manual\nBunny hop');await f.save(button);
   eq(await f.page.evaluate(()=>calls.map(c=>c.name)),[rpc],'Each save writes only the normal schedule');eq(await f.page.evaluate(()=>calls[0].args.p_athlete_id),'rider-a');eq(await f.page.evaluate(()=>calls[0].args.p_assignments.map(a=>a.trick_name)),['Manual','Bunny hop'],'The actual typed Daily tricks are saved');eq(await f.page.evaluate(()=>renders),1);ok(!(await f.page.evaluate(()=>messages.at(-1).message)).includes('Tier 2'));await f.close();
   const retry=await fixture();await retry.page.locator(input).fill('Tailwhip\nManual');await retry.page.evaluate(()=>mode.fail=true);await retry.save(button);
   eq(await retry.page.locator(input).inputValue(),'Tailwhip\nManual','Failed save preserves exact input');eq(await retry.page.evaluate(()=>renders),0);eq(await retry.page.evaluate(()=>messages.at(-1).tone),'error');ok(await retry.page.locator(button).isEnabled());await retry.page.evaluate(()=>mode.fail=false);await retry.save(button);eq(await retry.page.evaluate(()=>renders),1,'Retry saves preserved input');await retry.close();
   const stale=await fixture();await stale.page.evaluate(()=>mode.hold=true);await stale.page.locator(button).click();await stale.page.waitForFunction(()=>!!window.release);ok(await stale.page.locator(button).isDisabled(),'Save feedback prevents another tap while pending');await stale.page.evaluate(()=>{state.user={id:'other-coach'};state.selectedAthleteId='rider-b';release();});await stale.page.evaluate(()=>pending);eq(await stale.page.evaluate(()=>calls[0].args.p_athlete_id),'rider-a','Pending write remains scoped to original rider');eq(await stale.page.evaluate(()=>messages.length),0,'No stale success appears on another account');eq(await stale.page.evaluate(()=>renders),0);await stale.close();
  }
  console.log('PASS: '+checks+' standard Daily schedule/list save checks, no Tier 2 dependency, preserved input/retry and pending-account isolation.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
