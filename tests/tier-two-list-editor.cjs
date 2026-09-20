// The actual list-editor markup, Edit current list action and mount lifecycle run
// with the real Tier 2 module. Only roster data and RPC responses are fixtures.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.JKCREW_PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..'),app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const extract=name=>{const start=app.search(new RegExp('^(?:async )?function '+name+'\\(','m'));assert(start>=0,name);const rest=app.slice(start);return rest.slice(0,rest.indexOf('\n}')+2);};
const names=['tierTwoEditorSection','planAccordionSection','scheduleEditorHtml','compactStudentProfilePanels','sessionViewerAssignmentEditor','assignmentLinesForEditor','saveSessionViewerAssignments','parseAssignmentLine','setButtonBusy'];
const start=app.indexOf('// Feature modules keep'),end=app.indexOf('async function renderSession({',start);assert(start>=0&&end>start);
const mountHelpers=app.slice(start,end);
const editAction=app.match(/document\.querySelector\("#edit-current-list"\)\?\.addEventListener\("click", \(\) => \{[\s\S]*?\n  \}\);/)?.[0];assert(editAction,'Actual Edit current list action');
const uiFixture=fs.readFileSync(path.join(__dirname,'daily-tier-two-ui.cjs'),'utf8').match(/const fixture=String.raw`([\s\S]*?)`;/)[1];
const fixture=String.raw`
const state={user:{id:'coach'},profile:{role:'coach'},view:'student',selectedAthleteId:'rider-a',coachPlanVenue:'Test park',sessionViewerRosterCache:[{id:'rider-a',country_code:'AU'},{id:'rider-b',country_code:'AU'}]};
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const categoryInfo={daily:{label:'Daily Tricks',description:'Your daily list'},onebang:{label:'One Bangs',description:'Land once'},dialled:{label:'Dialled',description:'Repeat'},lines:{label:'Lines',description:'Linked tricks'},percentage:{label:'Percentage',description:'Ten attempts'},bonus:{label:'Bonus',description:'Bonus trick'}};
const categoryDisplayInfo=id=>categoryInfo[id],venueLabel=value=>value||'Test park',venueIdentityKey=value=>String(value||'').toLowerCase(),defaultVenues=['Test park'];
const newestDailyListForVenue=(rows,venue)=>rows.filter(row=>row.category==='daily'&&venueIdentityKey(row.venue)===venueIdentityKey(venue));
const plannerCompletedStrip=()=>'',isContestPrepProfile=()=>false,isCoachRole=role=>['coach','admin'].includes(role),riderFeaturesDisabled=()=>false,riderFeatureAccessUnknown=()=>false;
const cacheClear=()=>{},clearCoachCaches=()=>{},weekStartDate=()=> '2026-09-14',weekStartDateForCountry=weekStartDate,withTimeout=promise=>promise,messageFrom=e=>e.message;
window.messages=[];const notify=message=>messages.push(message);window.outerSubmits=0;window.templates={};
window.rows=[{id:'daily-one',category:'daily',trick_name:'Bunny hop',notes:'Soft landing',venue:'Test park'}];
const fixtureRpc=client.rpc;
client.rpc=async(name,args)=>{
 if(name==='get_daily_tier_two_template'){calls.push({name,args});return{data:structuredClone(templates[args.p_athlete_id]||{items:[],default_round:true})};}
 if(name==='set_daily_tier_two_template'){calls.push({name,args});if(state.profile.role!=='coach')throw Error('Unexpected rider template write');templates[args.p_athlete_id]={items:args.p_items||[],default_round:!args.p_items};return{data:structuredClone(templates[args.p_athlete_id])};}
 if(name==='save_weekly_assignment_list'){calls.push({name,args});return{data:{saved:true}};}
 return fixtureRpc(name,args);
};
`;
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});let checks=0;
 const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;},ok=(value,message)=>{assert(value,message);checks++;};
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.abort());
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"><div class="app-shell coach-shell" style="display:block"><main id="view"></main></div></div>');
  for(const file of ['styles.css','daily-tier-two.css'])await page.addStyleTag({content:fs.readFileSync(path.join(root,file),'utf8')});
  await page.addScriptTag({content:fs.readFileSync(path.join(root,'daily-tier-two.js'),'utf8')});await page.addScriptTag({content:uiFixture});await page.addScriptTag({content:fixture});
  await page.addScriptTag({content:names.map(extract).join('\n')+'\n'+mountHelpers});
  await page.addScriptTag({content:`
  window.paintCurrent=()=>{
   state.view='student';const view=document.querySelector('#view');view.className='student-profile-page';
   view.innerHTML='<button id="edit-current-list" type="button">Edit current list</button><section class="panel"><div class="panel-head"><div class="panel-title">Student Plan Builder</div><div class="panel-meta">Current lists</div></div><form id="assignment-form">'+scheduleEditorHtml(rows,[],{profile:state.profile,tierTwoAthleteId:state.selectedAthleteId})+'<button type="submit">Save complete schedule</button></form></section>';
   compactStudentProfilePanels(view);${editAction}
   document.querySelector('#assignment-form').onsubmit=event=>{event.preventDefault();outerSubmits++;};mountDailyFeatures();
  };
  window.paintViewer=(athleteId='rider-b',listId='daily')=>{
   state.view='sessionViewer';state.selectedAthleteId=athleteId;
   document.querySelector('#view').innerHTML=sessionViewerAssignmentEditor({athlete:{id:athleteId},venue:'Test park'},listId,rows);
   document.querySelector('[data-viewer-assignment-editor]').addEventListener('submit',saveSessionViewerAssignments);mountDailyFeatures();
  };
  window.refreshSessionViewerLight=async()=>paintViewer(state.selectedAthleteId);
  window.renderSession=async()=>{};
  `});
  const tierDetails=page.locator('details.plan-accordion').filter({has:page.locator('[data-tier-two-editor-host]')});
  await page.evaluate(()=>paintCurrent());await page.waitForFunction(()=>document.querySelector('[data-tier-two-template]'));
  eq(await page.locator('[data-tier-two-editor-host]').count(),1,'Only one current-list editor host');
  eq(await page.locator('[data-profile-panel="student plan builder"]').evaluate(e=>e.open),false,'Plan Builder starts closed');
  await page.locator('#edit-current-list').click();ok(await tierDetails.locator(':scope > summary').isVisible(),'Actual Edit current list action exposes Tier 2 in the opened plan builder');
  await tierDetails.locator(':scope > summary').click();ok(await page.getByRole('heading',{name:'Tier 2',exact:true}).isVisible());
  await page.locator('[data-tier-two-template]').fill('Manual | Hold the balance\nFootjam');await page.getByRole('button',{name:'Save Tier 2',exact:true}).click();
  await page.waitForFunction(()=>templates['rider-a']?.items.length===2);eq(await page.evaluate(()=>templates['rider-a'].items[0]),{trick_name:'Manual',notes:'Hold the balance'});eq(await page.evaluate(()=>outerSubmits),0,'Tier 2 save does not submit the weekly schedule');
  ok(await page.evaluate(()=>![...new FormData(document.querySelector('#assignment-form')).keys()].some(key=>key.includes('tier'))),'Tier 2 data is excluded from the weekly-assignment payload');
  if(process.env.JKCREW_SCREENSHOT){await tierDetails.evaluate(element=>element.scrollIntoView({block:'start'}));await page.screenshot({path:process.env.JKCREW_SCREENSHOT});}
  await page.locator('[data-tier-two-template]').fill('Keep this unsaved custom round');await page.evaluate(()=>paintCurrent());eq(await page.locator('[data-tier-two-template]').inputValue(),'Keep this unsaved custom round','Current profile redraw retains the same unsaved editor');ok(await page.locator('[data-tier-two-template]').isVisible(),'Current-list redraw keeps both enclosing editors open');
  const noHost=await page.evaluate(()=>({scheduler:scheduleEditorHtml(rows,[],{profile:state.profile}),otherLists:['onebang','dialled','lines','percentage','bonus'].map(category=>sessionViewerAssignmentEditor({athlete:{id:'rider-a'},venue:'Test park'},category,[]))}));
  ok(!noHost.scheduler.includes('data-tier-two-editor-host'),'Next-week scheduler does not silently edit the current Tier 2 template');
  ok(noHost.otherLists.every(html=>!html.includes('data-tier-two-editor-host')),'No duplicate Tier 2 editor in unrelated weekly lists');
  await page.evaluate(()=>paintViewer());await page.waitForFunction(()=>document.querySelector('[data-tier-two-editor-host="rider-b"] [data-tier-two-template]'));
  await page.locator('.viewer-edit-panel > summary').click();await tierDetails.locator(':scope > summary').click();
  ok(await page.getByRole('heading',{name:'Tier 2',exact:true}).isVisible(),'Coach Edit Daily contains the template editor');eq(await page.locator('[data-tier-two-template]').inputValue(),'','Changing rider does not carry over the previous rider’s draft');
  eq(await page.locator('[data-tier-two-editor-host]').evaluate(e=>e.closest('form')),null,'Session Viewer editor is outside the existing Daily form');
  await page.locator('[data-tier-two-template]').fill('Barspin | Stay centred');await page.getByRole('button',{name:'Save Tier 2',exact:true}).click();await page.waitForFunction(()=>templates['rider-b']?.items.length===1);
  eq(await page.evaluate(()=>templates['rider-b'].items),[{trick_name:'Barspin',notes:'Stay centred'}]);eq(await page.evaluate(()=>templates['rider-a'].items.length),2,'Saving rider B does not change rider A');
  await page.locator('[data-tier-two-template]').fill('Unsaved while saving Daily');await page.locator('[data-viewer-assignment-editor] textarea').fill('Bunny hop\nManual');await page.locator('[data-viewer-assignment-editor] button[type=submit]').click();
  await page.waitForFunction(()=>calls.some(c=>c.name==='save_weekly_assignment_list'));eq(await page.locator('[data-tier-two-template]').inputValue(),'Unsaved while saving Daily','Real Daily save + viewer redraw preserves unsaved Tier 2 text');ok(await page.locator('[data-tier-two-template]').isVisible(),'Daily save keeps the open Tier 2 edit controls visible');
  eq(await page.evaluate(()=>calls.find(c=>c.name==='save_weekly_assignment_list').args.p_athlete_id),'rider-b');eq(await page.evaluate(()=>templates['rider-b'].items[0].trick_name),'Barspin','Daily save does not implicitly save an unfinished custom round');
  const templateReads=await page.evaluate(()=>calls.filter(c=>c.name==='get_daily_tier_two_template').length);
  await page.evaluate(()=>{state.user={id:'rider-a'};state.profile={role:'athlete'};state.view='session';document.querySelector('#view').innerHTML=dailyFeatureHosts('rider-a');mountDailyFeatures();});await page.waitForTimeout(150);
  eq(await page.locator('[data-tier-two-editor-host]').count(),0,'Rider has no coach template editor');eq(await page.evaluate(()=>calls.filter(c=>c.name==='get_daily_tier_two_template').length),templateReads,'Rider view never loads coach template content');eq(await page.getByRole('heading',{name:/Tier 2/}).count(),0,'Locked Tier 2 remains a surprise for the rider');
  eq(errors,[],'No browser errors in the real app/editor integration');console.log(`PASS: ${checks} Tier 2 actual Edit List entry, coach save/owner, draft-preservation, scheduler isolation and rider surprise checks.`);
 }finally{await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
