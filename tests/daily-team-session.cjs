// Real rider Session renderer, saved Daily-result restoration, refresh button,
// feature-mount lifecycle after Tier 2 retirement. Only database responses are mocked.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..'), app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const existing = fs.readFileSync(path.join(__dirname, 'daily-completion-ui.cjs'), 'utf8');
const fixtureMatch = existing.match(/const fixture = String.raw`([\s\S]*?)`;/);
assert(fixtureMatch, 'Shared Daily completion fixture');
const fixture = fixtureMatch[1].replace('const mountDailyFeatures=()=>{};', '').replace(',bindRiderSessionRefreshButton=()=>{}', '');
const names = JSON.parse(existing.match(/const names = (\[[^\n]*\]);/)[1].replaceAll("'", '"'))
  .filter(name => !['dailyFeatureHosts', 'dailyTierTwoHost', 'otherLandedHost', 'dailyTiersHtml'].includes(name));
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
// Emulates a different coach connection committing the canonical team finish.
// The rider is not allowed to infer eligibility from local checklist completion.
window.remoteCoachFinish = async () => {
  const prior=state.view; state.view='sessionViewer';
  const candidate=makeCandidate('r1',new Date().toISOString()); state.view=prior;
  candidate.local_date=new Date().toISOString().slice(0,10);
  return (await client.rpc('confirm_daily_finish',{p_candidate_id:candidate.candidate_id})).data;
};
window.resetTeam = async completedCount => {
  clearDailyFeatureMounts();
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
    for(const file of ['styles.css','daily-completion.css','progress-sharing.css']) await page.addStyleTag({content:fs.readFileSync(path.join(root,file),'utf8')});
    for(const file of ['daily-completion.js','progress-sharing.js']) await page.addScriptTag({content:fs.readFileSync(path.join(root,file),'utf8')});
    await page.addScriptTag({content:fixture+'\n'+names.map(extract).join('\n')+'\n'+helpers+'\n'+backend});
    const refresh=async()=>{await page.locator('#rider-session-refresh').click();await page.waitForFunction(()=>!document.querySelector('#rider-session-refresh').disabled);};
    await page.evaluate(async()=>{await resetTeam(2);await refreshFeatures();});
    eq(await page.locator('[data-daily-tier-two-host], [data-daily-tier-tab], [data-tier-two-editor-host]').count(),0,'Actual rider Session has no Tier 2 hosts, tabs or editor');
    eq(await page.locator('.daily-finish-backdrop').count(),0,'Loading a completed checklist never submits a finish');
    await page.evaluate(()=>remoteCoachFinish());
    eq(await page.evaluate(()=>results.r1.group_session_id),'group','A separate coach connection saves the team Daily finish');
    await refresh();
    eq(await page.evaluate(()=>state.activeTraining.daily_result.all_completed),true,'Real loadActiveSession restores the confirmed full result');
    eq(await page.evaluate(()=>state.activeTraining.daily_result.group_session_id),'group');
    eq(await page.locator('#finish-daily-tricks').textContent(),'View Daily result','The coach-confirmed Daily result remains available');
    eq(await page.locator('.daily-finish-backdrop').count(),0,'Rider refresh does not replay the coach completion popup');
    await page.locator('#finish-daily-tricks').click();await page.waitForSelector('.daily-result-dialog');
    ok((await page.locator('.daily-result-dialog').textContent()).includes('+3'),'Rider sees the saved server award for the team session');
    eq(await page.locator('[data-view-tier-two]').count(),0,'Saved receipt has no Tier 2 continuation');
    await page.locator('[data-keep-riding]').click();await refresh();
    eq(await page.evaluate(()=>rpcCalls.filter(call=>call.name==='confirm_daily_finish').length),1,'Refreshing and reading never re-awards the confirmed Daily');
    for(const width of [320,390,1024]){
      await page.setViewportSize({width,height:844});
      ok(await page.locator('.daily-venue-group').evaluate(element=>element.scrollWidth<=element.clientWidth+1),'Standard Daily list fits '+width+'px');
    }
    for(const completed of [0,1]){
      await page.evaluate(async count=>{await resetTeam(count);await remoteCoachFinish();await requestRiderSessionRefresh({force:true});},completed);
      eq(await page.evaluate(()=>state.activeTraining.daily_result.all_completed),false,completed+'/2 finish remains partial');
      eq(await page.evaluate(()=>state.activeTraining.daily_result.completion_points),0,'Partial completion never earns a full Daily award');
      eq(await page.locator('.daily-finish-backdrop').count(),0,'Partial refresh does not replay a finish modal');
      eq(await page.locator('[data-assignment-action="landed"][data-assignment-category="daily"]').count(),2-completed,'Unticked Daily tricks remain unticked');
    }
    eq(await page.evaluate(()=>rpcCalls.filter(call=>call.name.includes('daily_tier_two'))),[],'Team restore and finish make no retired Tier 2 calls');
    eq(await page.locator('[data-tier-two-editor-host]').count(),0,'Rider cannot see the retired editor');
    eq(errors,[],'No errors in the actual team Session integration');
    await page.evaluate(()=>{clearDailyFeatureMounts();clearInterval(state.timer);});
    console.log('PASS: '+checks+' real team-session finish restoration, server awards, repeat safety, partial finish and retired Tier 2 checks.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
