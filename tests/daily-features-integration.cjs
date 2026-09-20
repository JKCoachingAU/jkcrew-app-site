// Real app mount/preservation helpers + both real modules + real Daily confirm
// flow in a browser. Backend contracts are covered independently by DB suites.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.JKCREW_PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..'),app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const begin=app.indexOf('// Feature modules keep'),end=app.indexOf('async function renderSession({',begin);
assert(begin>=0&&end>begin);const helpers=app.slice(begin,end)+app.slice(app.indexOf('function planAccordionSection('),app.indexOf('async function saveCoachVenueNames('));
const uiFixture=fs.readFileSync(path.join(__dirname,'daily-tier-two-ui.cjs'),'utf8').match(/const fixture=String.raw`([\s\S]*?)`;/)[1];
const fixture=String.raw`
window.cacheKeys=[];window.savedDaily=[];window.disabled=false;window.unknown=false;
const state={user:{id:'rider'},profile:{id:'rider',role:'athlete'},view:'session',selectedVenue:'Test park',activeTraining:{id:'session-rider'},timer:null};
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const isCoachRole=role=>['coach','admin'].includes(role),cacheClear=key=>cacheKeys.push(key),riderFeaturesDisabled=()=>disabled,riderFeatureAccessUnknown=()=>unknown;
const clearCoachCaches=()=>{},updateTimer=()=>{},refreshOpenTrainingProgress=()=>{},withTimeout=promise=>promise,setSyncStatus=()=>{},messageFrom=e=>e.message;
if(!crypto.randomUUID){let uuid=1;crypto.randomUUID=()=> '00000000-0000-0000-0000-'+String(uuid++).padStart(12,'0');}
const originalRpc=client.rpc;
client.rpc=async(name,args)=>{
 if(name==='get_other_things_landed'){calls.push({name,args});return {data:{items:[],total_count:0,pending_count:0,can_submit:state.profile.role==='athlete',can_review:state.profile.role==='coach',scoring_paused:false}};}
 if(name==='confirm_daily_finish'){calls.push({name,args});round.eligible=true;return {data:{result_id:'full-result',athlete_id:'rider',session_id:'session-rider',local_date:'2026-09-20',seconds:65,completed_at:new Date().toISOString(),all_completed:true,completed_count:2,total_count:2,completion_points:2,completion_xp:35}};}
 return originalRpc(name,args);
};
window.paint=(editor=false)=>{document.querySelector('#view').innerHTML='<section class="daily-session-hub"><details open><summary>Daily list</summary>Tier 1 content</details></section>'+dailyFeatureHosts('rider')+(editor?tierTwoEditorSection('rider'):'');mountDailyFeatures();};
window.renderSession=async()=>paint();window.renderSessionViewer=async()=>paint();window.refreshSessionViewerLight=async()=>paint();window.renderAthleteHome=async()=>paint();
window.mountCount=()=>dailyFeatureMounts.size;
window.confirmFull=async()=>{const element=document.createElement('div');element.innerHTML='<button data-confirm-daily>Confirm</button><button data-cancel-daily>Cancel</button><div class="daily-finish-error" hidden></div>';document.body.append(element);const current={element,candidate:{id:'candidate'},saving:false,context:{athleteId:'rider',userId:state.user.id,view:state.view,epoch:dailyFinishUi.epoch,viewer:state.view==='sessionViewer'}};dailyFinishUi.current=current;await confirmDailyFinish(current);element.remove();};
showSavedDailyResult=(result)=>savedDaily.push(result);
`;
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH});let checks=0;
 const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;},ok=(v,m)=>{assert(v,m);checks++;};
 try{
  const page=await browser.newPage({viewport:{width:390,height:900}}),errors=[];page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.abort());
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;padding:14px;background:#081018;color:#fff;font-family:Arial"><main id="view"></main></body>');
  for(const f of ['daily-tier-two.css','other-things-landed.css'])await page.addStyleTag({content:fs.readFileSync(path.join(root,f),'utf8')});
  for(const f of ['daily-tier-two.js','other-things-landed.js','daily-completion.js'])await page.addScriptTag({content:fs.readFileSync(path.join(root,f),'utf8')});
  await page.addScriptTag({content:uiFixture});await page.addScriptTag({content:fixture});await page.addScriptTag({content:helpers});
  await page.evaluate(()=>paint());await page.waitForFunction(()=>calls.some(c=>c.name==='get_daily_tier_two'));eq(await page.evaluate(()=>mountCount()),2,'Rider session mounts the two separate feature modules');
  eq(await page.locator('[data-daily-tier-two-host]').isHidden(),true);await page.locator('[data-other-landed-panel]>summary').click();await page.locator('[data-other-name]').fill('Footjam practice');await page.locator('[data-other-note]').fill('Keep my unsent note');
  await page.evaluate(()=>paint());eq(await page.locator('[data-other-name]').inputValue(),'Footjam practice','Session refresh keeps actual Other Things Landed form node/draft');eq(await page.locator('[data-other-note]').inputValue(),'Keep my unsent note');ok(await page.locator('[data-other-landed-panel]').evaluate(el=>el.open));
  // Execute the real Daily confirmation function and its real refresh callback.
  await page.evaluate(()=>confirmFull());await page.waitForFunction(()=>!!document.querySelector('[data-tier-two-action="reveal"]'));eq(await page.evaluate(()=>savedDaily[0].all_completed),true);ok(await page.evaluate(()=>calls.some(c=>c.name==='unlock_daily_tier_two')),'Confirmed full Daily re-renders session and triggers authoritative unlock');
  eq(await page.locator('[data-other-name]').inputValue(),'Footjam practice','Full Daily confirmation preserves unsent extras');
  await page.getByRole('button',{name:'Open Tier 2'}).click();await page.waitForFunction(()=>!!round.revealed_at);await page.locator('.daily-tier-two__trick').first().click();await page.waitForFunction(()=>round.completed_count===1);await page.evaluate(()=>paint());await page.waitForFunction(()=>document.querySelector('[data-tier-two-item]')?.checked);eq(await page.locator('[data-tier-two-item]').first().isChecked(),true,'Tier 2 progress survives session redraw');
  eq(await page.locator('[data-other-name]').inputValue(),'Footjam practice');ok(await page.evaluate(()=>cacheKeys.includes('tricktionary:')),'Tier 2 landed changes invalidate existing history caches');
  // Switching to a linked coach uses separate controls and preserves no rider draft.
  await page.evaluate(()=>{state.user={id:'coach'};state.profile={role:'coach'};state.view='sessionViewer';paint();});await page.waitForTimeout(120);eq(await page.evaluate(()=>mountCount()),2);eq(await page.getByRole('button',{name:'Open Tier 2'}).count(),0);await page.locator('[data-other-landed-panel]>summary').click();await page.waitForFunction(()=>calls.some(c=>c.name==='get_other_things_landed'&&c.args.p_athlete_id==='rider'));eq(await page.locator('[data-other-form]').isHidden(),true,'Coach view is approval only');
  await page.evaluate(()=>{state.view='athlete';paint(true);});await page.waitForFunction(()=>document.querySelector('[data-tier-two-template]'));eq(await page.evaluate(()=>mountCount()),3,'Coach rider profile mounts the custom challenge editor');
  const editorParent=page.locator('[data-tier-two-editor-host]').locator('xpath=ancestor::details[1]');if(await editorParent.evaluate(el=>el.tagName==='DETAILS'))eq(await editorParent.evaluate(el=>el.open),false,'Coach template options start collapsed');
  await page.evaluate(()=>{state.view='home';document.querySelector('#view').textContent='Dashboard';});await page.waitForFunction(()=>mountCount()===0);eq(await page.locator('#view').textContent(),'Dashboard','Navigation observer tears down detached modules');
  await page.evaluate(()=>{state.user={id:'rider'};state.profile={role:'athlete'};state.view='session';paint();});await page.waitForFunction(()=>mountCount()===2);
  await page.evaluate(()=>{disabled=true;mountDailyFeatures();});await page.waitForFunction(()=>mountCount()===0);eq(await page.locator('[data-other-landed-panel]').count(),0,'Disabling access tears down controls even before dashboard replaces the DOM');eq(await page.locator('[data-daily-tier-two-host]').textContent(),'');
  await page.evaluate(()=>{disabled=false;unknown=true;paint();});eq(await page.evaluate(()=>mountCount()),0,'Unknown account access cannot mount feature controls');
  eq(errors,[],'Actual app helpers and modules run without browser errors');
  console.log(`PASS: ${checks} actual app/Daily/module integration checks: session, coach, profile, unsent draft preservation, progress redraw, confirmed Daily unlock and account/navigation cleanup.`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
