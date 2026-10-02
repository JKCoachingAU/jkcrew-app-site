// Actual app feature mount/preservation helpers, Other Things Landed, and automatic
// Daily completion. All backend responses are synthetic; no production traffic.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..'), app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const begin = app.indexOf('// Feature modules keep'), end = app.indexOf('async function renderSession({', begin);
assert(begin >= 0 && end > begin); const helpers = app.slice(begin, end);
const fixture = String.raw`
window.calls=[];window.cacheKeys=[];window.disabled=false;window.unknown=false;
const state={user:{id:'rider'},profile:{id:'rider',role:'athlete'},view:'session',selectedVenue:'Test park',activeTraining:{id:'session-rider'},timer:null};
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const isCoachRole=role=>['coach','admin'].includes(role),cacheClear=key=>cacheKeys.push(key),riderFeaturesDisabled=()=>disabled,riderFeatureAccessUnknown=()=>unknown;
const clearCoachCaches=()=>{},updateTimer=()=>{},refreshOpenTrainingProgress=()=>{},withTimeout=promise=>promise,setSyncStatus=()=>{},messageFrom=e=>e.message;
const formatTime=s=>String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
if(!crypto.randomUUID){let uuid=1;crypto.randomUUID=()=> '00000000-0000-0000-0000-'+String(uuid++).padStart(12,'0');}
const client={rpc:async(name,args)=>{
 calls.push({name,args});
 if(name==='get_other_things_landed')return {data:{items:[],total_count:0,pending_count:0,can_submit:state.profile.role==='athlete',can_review:state.profile.role==='coach',scoring_paused:false}};
 if(name==='confirm_daily_finish')return {data:{result_id:'full-result',athlete_id:'rider',session_id:'session-rider',local_date:'2026-10-02',seconds:65,completed_at:new Date().toISOString(),all_completed:true,completed_count:2,total_count:2,completion_points:2,completion_xp:35,weekly_score:42}};
 throw Error('Unexpected RPC: '+name);
}};
window.paint=()=>{document.querySelector('#view').innerHTML='<section class="assignment-group daily-venue-group"><details open><summary>Daily list</summary>Standard Daily content</details></section>'+dailyFeatureHosts('rider');mountDailyFeatures();};
window.renderSession=async()=>paint();window.renderSessionViewer=async()=>paint();window.refreshSessionViewerLight=async()=>paint();window.renderAthleteHome=async()=>paint();
window.mountCount=()=>dailyFeatureMounts.size;
window.finishFull=()=>showDailyFinishConfirmation(normalizedDailyCandidate({candidate_id:'candidate',athlete_id:'rider',rider_name:'Rider',session_id:'session-rider',seconds:65,all_completed:true,completed_count:2,total_count:2}),{athleteId:'rider',riderName:'Rider',userId:state.user.id,view:state.view,epoch:dailyFinishUi.epoch,viewer:state.view==='sessionViewer'});
`;
(async () => {
 const browser=await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH});let checks=0;
 const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;},ok=(v,m)=>{assert(v,m);checks++;};
 try {
  const page=await browser.newPage({viewport:{width:390,height:900}}),errors=[];page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.abort());
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;padding:14px;background:#081018;color:#fff;font-family:Arial"><main id="view"></main></body>');
  for(const f of ['daily-completion.css','other-things-landed.css'])await page.addStyleTag({content:fs.readFileSync(path.join(root,f),'utf8')});
  for(const f of ['other-things-landed.js','daily-completion.js'])await page.addScriptTag({content:fs.readFileSync(path.join(root,f),'utf8')});
  await page.addScriptTag({content:fixture});await page.addScriptTag({content:helpers});
  await page.evaluate(()=>paint());eq(await page.evaluate(()=>mountCount()),1,'Only Other Things Landed mounts with a Daily list');
  eq(await page.locator('[data-daily-tier-tab], [data-daily-tier-two-host], [data-tier-two-editor-host]').count(),0,'No retired Tier 2 controls or editor hosts');
  await page.locator('[data-other-landed-panel]>summary').click();await page.locator('[data-other-name]').fill('Footjam practice');await page.locator('[data-other-note]').fill('Keep my unsent note');
  await page.evaluate(()=>paint());eq(await page.locator('[data-other-name]').inputValue(),'Footjam practice','Session refresh keeps the actual Other Things Landed form node/draft');eq(await page.locator('[data-other-note]').inputValue(),'Keep my unsent note');ok(await page.locator('[data-other-landed-panel]').evaluate(el=>el.open));
  eq(await page.evaluate(()=>finishFull()),true,'Full Daily still saves automatically');await page.waitForSelector('.daily-result-dialog');eq(await page.evaluate(()=>calls.filter(c=>c.name==='confirm_daily_finish').map(c=>c.args.p_candidate_id)),['candidate'],'One Daily save uses the original idempotency key');
  ok((await page.locator('.daily-result-dialog').textContent()).includes('+2'),'Ordinary Daily result reports the server award');eq(await page.locator('[data-view-tier-two]').count(),0,'Saved result has no Tier 2 handoff');
  eq(await page.locator('[data-other-name]').inputValue(),'Footjam practice','Full Daily confirmation preserves unsent extra tricks');
  await page.locator('[data-keep-riding]').click();eq(await page.locator('.daily-finish-backdrop').count(),0);await page.evaluate(()=>paint());eq(await page.locator('.daily-finish-backdrop').count(),0,'Refresh does not replay completion');
  for(const width of [320,390,820]){await page.setViewportSize({width,height:900});ok(await page.locator('[data-other-landed-panel]').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Other Things Landed fits '+width);}
  await page.evaluate(()=>{state.user={id:'coach'};state.profile={role:'coach'};state.view='sessionViewer';paint();});await page.waitForTimeout(120);eq(await page.evaluate(()=>mountCount()),1);await page.locator('[data-other-landed-panel]>summary').click();await page.waitForFunction(()=>calls.some(c=>c.name==='get_other_things_landed'&&c.args.p_athlete_id==='rider'));eq(await page.locator('[data-other-form]').isHidden(),true,'Coach controls remain approval only');
  await page.evaluate(()=>{state.view='athlete';paint();});eq(await page.evaluate(()=>mountCount()),1,'Coach profile mounts only extra-trick review');eq(await page.locator('[data-tier-two-template]').count(),0);
  await page.evaluate(()=>{state.view='home';document.querySelector('#view').textContent='Dashboard';});await page.waitForFunction(()=>mountCount()===0);eq(await page.locator('#view').textContent(),'Dashboard','Navigation observer tears down detached modules');
  await page.evaluate(()=>{state.user={id:'rider'};state.profile={role:'athlete'};state.view='session';paint();});await page.waitForFunction(()=>mountCount()===1);
  await page.evaluate(()=>{disabled=true;mountDailyFeatures();});await page.waitForFunction(()=>mountCount()===0);eq(await page.locator('[data-other-landed-panel]').count(),0,'Disabling access tears down controls');
  await page.evaluate(()=>{disabled=false;unknown=true;paint();});eq(await page.evaluate(()=>mountCount()),0,'Unknown access cannot mount controls');
  eq(await page.evaluate(()=>calls.filter(c=>/tier_two/.test(c.name))),[],'No retired Tier 2 reads, unlocks, writes or rewards');eq(errors,[],'No browser exceptions');
  console.log(`PASS: ${checks} actual app/Daily/module checks: ordinary Daily result, no Tier 2 RPCs/controls, session and coach mounts, mobile layout, unsent draft preservation and account/navigation cleanup.`);
 } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
