// Real rider Session renderer, saved Daily-result restoration, refresh button,
// feature-mount lifecycle and Tier 2 module. Only database responses are mocked.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..'), app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const existing = fs.readFileSync(path.join(__dirname, 'daily-completion-ui.cjs'), 'utf8');
const fixtureMatch = existing.match(/const fixture = String.raw`([\s\S]*?)`;/);
assert(fixtureMatch, 'Shared Daily completion fixture');
const fixture = fixtureMatch[1].replace('const mountDailyFeatures=()=>{};', '').replace(',bindRiderSessionRefreshButton=()=>{}', '');
const names = JSON.parse(existing.match(/const names = (\[[^\n]*\]);/)[1].replaceAll("'", '"'))
  .filter(name => !['dailyFeatureHosts', 'dailyTierTwoHost', 'otherLandedHost'].includes(name));
names.push('canRefreshRiderSession', 'requestRiderSessionRefresh', 'bindRiderSessionRefreshButton');
const extract = name => {
  const start = app.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'));
  assert(start >= 0, name); const rest = app.slice(start);
  return rest.slice(0, rest.indexOf('\n}') + 2).replace(/^async function refreshSessionViewerLight\(/, 'async function testRefreshSessionViewerLight(');
};
const helpersStart = app.indexOf('// Feature modules keep'), helpersEnd = app.indexOf('async function renderSession({', helpersStart);
assert(helpersStart >= 0 && helpersEnd > helpersStart);
const helpers = app.slice(helpersStart, helpersEnd);
const backend = String.raw`
window.tierRound = null; window.tierCalls = []; window.failUnlock = false;
const dailyRpc = client.rpc;
client.rpc = async (name, args = {}) => {
  if (!['get_daily_tier_two','unlock_daily_tier_two','claim_daily_tier_two_reveal','record_daily_tier_two_trick'].includes(name)) return dailyRpc(name,args);
  tierCalls.push({name,args:structuredClone(args)});
  if (args.p_athlete_id !== state.user.id || state.profile.role !== 'athlete') throw Error('Unexpected Tier 2 owner');
  const eligible = results[args.p_athlete_id]?.all_completed === true;
  const locked = {unlocked:false,eligible,athlete_id:args.p_athlete_id,local_date:new Date().toISOString().slice(0,10)};
  if (name === 'get_daily_tier_two') return {data:structuredClone(tierRound || locked)};
  if (name === 'unlock_daily_tier_two') {
    if (!eligible) return {error:{message:'Finish your full Daily list first.'}};
    if (failUnlock) { failUnlock=false; return {error:{message:'Connection interrupted while opening Tier 2.'}}; }
    tierRound ||= {...locked,unlocked:true,source:'coach_template',revealed_at:null,completed_at:null,completed_count:0,total_count:2,reset_at:new Date(clockNow+86400000).toISOString(),items:[{id:'tier-manual',trick_name:'Manual',notes:'Hold the balance',landed:false},{id:'tier-hop',trick_name:'Bunny hop',notes:'Soft landing',landed:false}]};
  }
  if (name === 'claim_daily_tier_two_reveal') {
    if (!tierRound) throw Error('Locked round cannot reveal');
    const claimed=!tierRound.revealed_at; tierRound.revealed_at ||= new Date().toISOString();
    return {data:{...structuredClone(tierRound),reveal_claimed:claimed}};
  }
  if (name === 'record_daily_tier_two_trick') {
    const item=tierRound.items.find(row=>row.id===args.p_item_id); if(!item)throw Error('Wrong item');
    item.landed=args.p_landed; tierRound.completed_count=tierRound.items.filter(row=>row.landed).length;
  }
  return {data:structuredClone(tierRound)};
};
// Emulates a different coach connection committing the canonical team finish.
// The rider is not allowed to infer eligibility from local checklist completion.
window.remoteCoachFinish = async () => {
  const prior=state.view; state.view='sessionViewer';
  const candidate=makeCandidate('r1',new Date().toISOString()); state.view=prior;
  candidate.local_date=new Date().toISOString().slice(0,10);
  return (await client.rpc('confirm_daily_finish',{p_candidate_id:candidate.candidate_id})).data;
};
window.resetTeam = async completedCount => {
  clearDailyFeatureMounts(); tierRound=null; tierCalls=[];
  await partialRiderMode(completedCount);
  persistedGroup={id:'group',status:'active',started_at:sessions.r1.started_at,coach_group_session_participants:[{athlete_id:'r1',training_session_id:sessions.r1.id,daily_finish_seconds:null}]};
};
window.refreshFeatures = async () => {
  await Promise.all([...dailyFeatureMounts.values()].map(mounted=>mounted.handle.refresh?.()));
};
`;
(async () => {
  const browser = await chromium.launch({ headless:true, executablePath:process.env.JKCREW_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  let checks=0; const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
  const ok=(value,message)=>{assert(value,message);checks++;};
  try {
    const page = await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'}), errors=[];
    page.setDefaultTimeout(8000); page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>route.abort());
    await page.setContent('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><html data-theme="dark"><body><div id="app"><div class="app-shell rider-shell" style="display:block"><main id="view" class="content" data-view="session"></main></div></div></body></html>');
    for(const file of ['styles.css','daily-completion.css','progress-sharing.css','daily-tier-two.css']) await page.addStyleTag({content:fs.readFileSync(path.join(root,file),'utf8')});
    for(const file of ['daily-completion.js','progress-sharing.js','daily-tier-two.js']) await page.addScriptTag({content:fs.readFileSync(path.join(root,file),'utf8')});
    await page.addScriptTag({content:fixture+'\n'+names.map(extract).join('\n')+'\n'+helpers+'\n'+backend});
    const tier=page.locator('[data-daily-tier-two-host="r1"]');
    const refresh=async()=>{const prior=await page.evaluate(()=>tierCalls.length);await page.locator('#rider-session-refresh').click();await page.waitForFunction(n=>tierCalls.length>n,prior);await page.evaluate(()=>refreshFeatures());};
    await page.evaluate(async()=>{await resetTeam(2);await refreshFeatures();});
    eq(await tier.count(),1,'Actual rider Session renders exactly one Tier 2 host');
    eq(await tier.isVisible(),false,'All checked but unconfirmed team Daily list does not reveal Tier 2');
    eq(await page.evaluate(()=>tierCalls.filter(call=>call.name==='unlock_daily_tier_two').length),0,'No unlock request before authoritative confirmation');
    eq(await page.locator('.daily-finish-backdrop').count(),0,'Loading/realtime-style refresh never opens a finish confirmation');
    await page.evaluate(()=>remoteCoachFinish());
    eq(await page.evaluate(()=>results.r1.group_session_id),'group','Fixture committed a team-session finish from the coach connection');
    eq(await tier.isVisible(),false,'Server change alone does not pretend a local unlock occurred');
    await refresh(); await page.waitForSelector('[data-tier-two-action="reveal"]');
    eq(await page.evaluate(()=>state.activeTraining.daily_result.all_completed),true,'Real loadActiveSession restores the confirmed full result');
    eq(await page.evaluate(()=>state.activeTraining.daily_result.group_session_id),'group');
    eq(await page.locator('#finish-daily-tricks').textContent(),'View Daily result','The original confirmed Daily result remains available');
    eq(await page.locator('.daily-finish-backdrop').count(),0,'Rider refresh does not repeat the coach’s confirmation popup');
    eq(await tier.locator('h3').textContent(),'Tier 2 Unlocked');
    eq(await tier.locator('[data-tier-two-item]').count(),0,'Custom tricks remain concealed until Open Tier 2 is tapped');
    eq(await page.evaluate(()=>tierCalls.filter(call=>call.name==='claim_daily_tier_two_reveal').length),0,'Rendering does not consume the durable reveal');
    ok(await tier.evaluate(element=>element.previousElementSibling?.classList.contains('daily-session-hub')),'Tier 2 is immediately after Daily Tricks in the active branch');
    ok(await tier.evaluate(element=>!(element.compareDocumentPosition(document.querySelector('[data-other-landed-host]'))&Node.DOCUMENT_POSITION_PRECEDING)),'Tier 2 appears before other landed submissions and untimed lists');
    for(const width of [320,390,1024]) {
      await page.setViewportSize({width,height:844});
      ok(await tier.evaluate(element=>element.scrollWidth<=element.clientWidth+1),'Tier 2 card fits '+width+'px without clipped controls');
      ok(await page.locator('[data-tier-two-action="reveal"]').evaluate(element=>element.getBoundingClientRect().height>=44),'Open Tier 2 has a touch-sized target at '+width+'px');
    }
    await page.setViewportSize({width:390,height:844}); await tier.scrollIntoViewIfNeeded();
    if(process.env.JKCREW_SCREENSHOT) await page.screenshot({path:process.env.JKCREW_SCREENSHOT,animations:'disabled'});
    await page.locator('[data-tier-two-action="reveal"]').click(); await page.waitForSelector('[data-tier-two-item="tier-manual"]');
    eq(await tier.locator('.daily-tier-two__trick strong').allTextContents(),['Manual','Bunny hop'],'Real module reveals the saved coach template');
    await tier.locator('.daily-tier-two__trick').first().click();await page.waitForFunction(()=>tierRound.completed_count===1);
    const revealedAt=await page.evaluate(()=>tierRound.revealed_at);
    await refresh(); eq(await tier.locator('[data-tier-two-item="tier-manual"]').isChecked(),true,'Actual Session redraw preserves persisted Tier 2 progress');
    eq(await tier.locator('[data-tier-two-action="reveal"]').count(),0,'Refresh does not replay the reveal');
    await page.evaluate(async()=>{clearDailyFeatureMounts();document.querySelector('#view').replaceChildren();state.activeTraining=null;await renderSession();await refreshFeatures();});
    eq(await tier.locator('[data-tier-two-item="tier-manual"]').isChecked(),true,'Fresh mount restores saved Tier 2 progress');
    eq(await page.evaluate(()=>tierRound.revealed_at),revealedAt,'Fresh mount does not change the saved reveal timestamp');
    eq(await page.evaluate(()=>tierCalls.filter(call=>call.name==='claim_daily_tier_two_reveal').length),1,'Reveal was claimed once, by the rider’s explicit tap');
    eq(await page.evaluate(()=>rpcCalls.filter(call=>call.name==='confirm_daily_finish').length),1,'Rider refresh/reveal does not reconfirm or reaward Daily points');
    await page.evaluate(async()=>{clearDailyFeatureMounts();sessions.r1=null;state.activeTraining=null;await renderSession();await refreshFeatures();});
    ok(await tier.isVisible(),'Saved Tier 2 remains available after the team training session ends');
    ok(await tier.evaluate(element=>element.previousElementSibling?.classList.contains('daily-session-hub')),'Inactive Session branch keeps Tier 2 beside Daily Tricks');
    eq(await page.locator('#create-session').count(),1,'No active timer is required to see the already unlocked round');
    // Without an active training row, only authoritative server eligibility is
    // known. An unlock failure must remain visible rather than hiding the card.
    await page.evaluate(async()=>{clearDailyFeatureMounts();tierRound=null;failUnlock=true;await renderSession();});
    await page.waitForSelector('[data-tier-two-action="refresh"]');
    eq(await page.evaluate(()=>state.activeTraining),null,'No client eligibleHint is available for the ended-session case');
    ok((await tier.locator('[role="alert"]').textContent()).includes('Connection interrupted'),'Known eligible rider sees the actual unlock error');
    await page.locator('[data-tier-two-action="refresh"]').click();await page.waitForSelector('[data-tier-two-action="reveal"]');
    ok(await tier.isVisible(),'Retry recovers the eligible round without restarting training');
    for(const completed of [0,1]) {
      await page.evaluate(async count=>{await resetTeam(count);await remoteCoachFinish();await requestRiderSessionRefresh({force:true});await refreshFeatures();},completed);
      eq(await page.evaluate(()=>state.activeTraining.daily_result.all_completed),false,completed+'/2 confirmed finish remains partial');
      eq(await tier.isVisible(),false,completed+'/2 partial finish does not reveal Tier 2');
      eq(await page.evaluate(()=>tierCalls.filter(call=>call.name==='unlock_daily_tier_two').length),0,'Partial finish makes no unlock request');
    }
    eq(await page.locator('[data-tier-two-editor-host]').count(),0,'Rider Session never renders the coach’s template editor');
    eq(errors,[],'No errors in the actual Session/confirmation/module integration');
    await page.evaluate(()=>{clearDailyFeatureMounts();clearInterval(state.timer);});
    console.log('PASS: '+checks+' real team-session Tier 2 refresh, placement, confirmation gating, persisted reveal, mobile and recovery checks.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
