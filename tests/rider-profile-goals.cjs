// Actual Profile/Goals renderers and actions with an account-bound in-memory backend.
// All network access is local; no real accounts or production data are touched.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..'), source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
function extract(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert(start >= 0, `Actual ${name} exists`);
  const rest = source.slice(start), end = rest.indexOf('\n}');
  assert(end >= 0, `Actual ${name} ends`);
  return rest.slice(0, end + 2);
}
const escapeCode = source.match(/^const escapeHtml = [\s\S]*?;$/m)?.[0];
assert(escapeCode, 'Actual HTML escaping exists');
const actualCode = escapeCode + '\n' + ['riderAccordionSection', 'goalsSection', 'normalizedGoals', 'setButtonBusy', 'saveGoals', 'bindGoalActions', 'renderProfile'].map(extract).join('\n');
const profileSelect = source.match(/^const PROFILE_SELECT = .*;$/m)?.[0];
assert(profileSelect, 'Actual profile projection exists');
const fixture = `
${profileSelect}
window.state = { user: { id: 'fixture-athlete', email: 'fixture@example.test' }, profile: null, view: 'profile', sessionSetupVersion: 1 };
window.qaProfiles = new Map(); window.qaCalls = []; window.qaNotices = []; window.qaNavigations = [];
window.qaFail = false; window.qaHold = false; window.qaPending = [];
window.qaProfile = (id = 'fixture-athlete', role = 'athlete') => ({id, role, display_name: 'Fixture Rider', level: 1, app_theme: 'dark', goals: [{id:'existing', title:'Land a clean barspin', completed:false}], achievements:'', social_links:{}, country_code:'AU'});
window.qaSelectRole = async role => {
  state.user = { id: 'fixture-' + role, email: 'fixture@example.test' }; state.profile = qaProfile(state.user.id, role); state.view = 'profile';
  qaProfiles.set(state.user.id, structuredClone(state.profile)); return renderProfile();
};
window.client = { from(table) {
  const call = { table, filters: [] }; let update;
  const q = {
    update(value) { update = structuredClone(value); call.update = update; return q; },
    eq(key, value) { call.filters.push([key,value]); return q; },
    select(value) { call.select = value; return q; },
    async single() {
      qaCalls.push(structuredClone(call));
      if (qaHold) await new Promise(resolve => qaPending.push(resolve));
      if (qaFail) return {data:null,error:new Error('Synthetic save failure')};
      const id = call.filters.find(([key]) => key === 'id')?.[1];
      if (table !== 'profiles' || !id || !qaProfiles.has(id) || !update) throw new Error('Unexpected profile mutation');
      const next = {...qaProfiles.get(id), ...update}; qaProfiles.set(id,next); return {data:structuredClone(next),error:null};
    },
    then(resolve,reject) { return Promise.resolve({data:[],error:null}).then(resolve,reject); },
  }; return q;
} };
window.notify = (message,tone) => {qaNotices.push({message,tone}); document.querySelector('#toast').textContent = message;};
window.messageFrom = error => error.message;
window.renderAthleteHome = async () => {qaNavigations.push('home');};
window.navigate = async view => {qaNavigations.push(view);state.view=view;};
window.isCoachRole = role => ['coach','admin'].includes(role);
window.riderFeaturesDisabled = () => false; window.riderFeatureAccessUnknown = () => false;
window.getPushNotificationState = async () => ({supported:false,enabled:false,preferences:{}});
window.supportsPushNotifications = () => false;
window.getXpSummary = async () => ({}); window.getXpHistory = async () => [];
window.normalizeXpSummary = () => ({}); window.xpProgressHtml = () => '';
window.levelBadgesAccordionHtml = () => ''; window.xpHistoryHtml = () => '';
window.getCoachRoster = async () => []; window.coachDailyPbSettingsHtml = () => '';
window.avatarHtml = () => '<div class="avatar profile-avatar">FR</div>';
window.pushNotificationSettingsHtml = () => '<p>Push notifications unavailable in isolated fixture.</p>';
window.normalizedTheme = value => value || 'dark'; window.countryOptionsHtml = () => '<option value="AU">Australia</option>';
for (const name of ['updateOwnAvatar','saveOwnAvatar','applyTheme','togglePushNotifications','updateNotificationSoundPreference','sendTestNotification','savePushPreferences','updateProfile','updatePassword','saveCoachDailyPb','clearCoachDailyPb','signOutCurrentDevice']) window[name] = () => {};
${actualCode}
`;

(async () => {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url,'http://localhost');
    if (url.pathname === '/') {
      response.writeHead(200,{'content-type':'text/html'});
      return response.end('<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><style>body{margin:0}#app{display:block!important}#view{width:100%;max-width:1100px;margin:auto;padding:16px;box-sizing:border-box}</style></head><body><div id="app" class="rider-shell"><main id="view" data-view="profile"></main></div><div id="toast" aria-live="polite"></div></body></html>');
    }
    const file = path.resolve(root,'.' + url.pathname);
    if (!file.startsWith(root+path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {response.writeHead(404);return response.end();}
    response.writeHead(200,{'content-type':path.extname(file)==='.css'?'text/css':'application/octet-stream'});response.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  let checks=0;
  const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
  const ok=(value,message)=>{assert(value,message);checks++;};
  async function fresh(width=390) {
    const context=await browser.newContext({viewport:{width,height:844},serviceWorkers:'block'}), errors=[];
    await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    const page=await context.newPage();page.setDefaultTimeout(5000);page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin);await page.addScriptTag({content:fixture});await page.evaluate(()=>qaSelectRole('athlete'));
    return {page,context,errors};
  }
  async function waitSaved(page, message) {await page.waitForFunction(text=>document.querySelector('#toast').textContent===text,message);}
  async function clearNotice(page) {await page.evaluate(()=>{document.querySelector('#toast').textContent='';});}
  try {
    for (const width of [390,320]) {
      const {page,context,errors}=await fresh(width);
      eq(await page.locator('.goals-panel').count(),1,'Athlete Profile has one Goals section');
      eq(await page.locator('.goals-panel').evaluate(el=>Boolean(el.compareDocumentPosition(document.querySelector('.profile-grid')) & Node.DOCUMENT_POSITION_FOLLOWING)),true,'Goals precede account settings');
      await page.locator('.goals-panel summary').click();
      await page.locator('#profile-name').fill('Unsaved profile name');await page.locator('#profile-phone').fill('0412345678');
      await page.locator('#goal-form input').fill('Land a tailwhip');await page.locator('#goal-form button').click();await waitSaved(page,'Goal added.');
      const addedId=await page.evaluate(()=>state.profile.goals.find(goal=>goal.title==='Land a tailwhip').id);
      ok(Boolean(addedId),'Added goal has persisted identity');
      eq(await page.evaluate(()=>qaProfiles.get(state.user.id).goals.length),2,'Add persists through mock backend');
      eq(await page.locator('#goal-form input').inputValue(),'','Successful add clears new-goal input');
      eq(await page.locator('.goals-panel').evaluate(el=>el.open),true,'Goals accordion remains open after save');
      eq(await page.locator('#profile-name').inputValue(),'Unsaved profile name','Goal save preserves unsaved profile name');
      eq(await page.locator('#profile-phone').inputValue(),'0412345678','Goal save preserves unsaved profile phone');
      await page.locator('#goal-form input').fill('Another unfinished goal');await clearNotice(page);
      await page.locator('[data-goal-title="existing"]').fill('Land a clean 360');await page.locator('[data-goal-save="existing"]').click();await waitSaved(page,'Goal saved.');
      eq(await page.evaluate(()=>qaProfiles.get(state.user.id).goals.find(goal=>goal.id==='existing').title),'Land a clean 360','Title edit persists');
      eq(await page.locator('#goal-form input').inputValue(),'Another unfinished goal','Editing existing goal preserves new-goal draft');
      await clearNotice(page);await page.locator('[data-goal-toggle="existing"]').click();await waitSaved(page,'Goal updated.');
      eq(await page.evaluate(()=>qaProfiles.get(state.user.id).goals.find(goal=>goal.id==='existing').completed),true,'Completion persists');
      eq(await page.locator('[data-goal-id="existing"]').evaluate(el=>el.classList.contains('complete')),true,'Completed appearance refreshes');
      await clearNotice(page);await page.locator('[data-goal-toggle="existing"]').click();await waitSaved(page,'Goal updated.');
      eq(await page.evaluate(()=>qaProfiles.get(state.user.id).goals.find(goal=>goal.id==='existing').completed),false,'Goal can become active again');
      await clearNotice(page);await page.locator(`[data-goal-delete="${addedId}"]`).click();await waitSaved(page,'Goal deleted.');
      eq(await page.evaluate(()=>qaProfiles.get(state.user.id).goals.map(goal=>goal.id)),['existing'],'Delete persists');
      eq(await page.evaluate(()=>qaCalls.every(call=>call.table==='profiles'&&call.filters.some(([key,value])=>key==='id'&&value==='fixture-athlete'))),true,'All writes target only signed-in rider');
      eq(await page.evaluate(()=>[state.view,qaNavigations]),['profile',[]],'CRUD stays on Profile without Home navigation');
      const metrics=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,panel:document.querySelector('.goals-panel').getBoundingClientRect().right}));
      ok(metrics.document<=metrics.width+1 && metrics.panel<=metrics.width+1,`Profile goals fit ${width}px without horizontal overflow`);
      await page.locator('.goals-panel').screenshot({path:`/tmp/jkcrew-profile-goals-${width}.png`});
      for(const role of ['coach','parent']) {await page.evaluate(role=>qaSelectRole(role),role);eq(await page.locator('.goals-panel').count(),0,`No rider goal editor on ${role} Profile`);}
      eq(errors,[],'CRUD/layout has no browser errors');await context.close();
    }
    {
      const {page,context,errors}=await fresh();await page.locator('.goals-panel summary').click();
      await page.locator('#profile-name').fill('Keep profile draft');await page.locator('#goal-form input').fill('Retry this goal');
      await page.evaluate(()=>{qaFail=true;});await page.locator('#goal-form button').click();await waitSaved(page,'Synthetic save failure');
      eq(await page.locator('#goal-form input').inputValue(),'Retry this goal','Failed add preserves entered goal');
      eq(await page.locator('#profile-name').inputValue(),'Keep profile draft','Failed add preserves profile draft');
      eq(await page.evaluate(()=>qaProfiles.get(state.user.id).goals.length),1,'Failure adds no goal');
      eq(await page.locator('#goal-form button').isEnabled(),true,'Failed add remains retryable');
      await page.evaluate(()=>{qaFail=false;});await page.locator('#goal-form button').click();await waitSaved(page,'Goal added.');
      eq(await page.evaluate(()=>qaProfiles.get(state.user.id).goals.length),2,'Retry persists one goal');
      await page.locator('[data-goal-title="existing"]').fill('');await page.locator('[data-goal-save="existing"]').click();await waitSaved(page,'Write the goal first.');
      eq(await page.evaluate(()=>qaCalls.length),2,'Blank edit performs no mutation');
      eq(errors,[],'Failure/retry has no browser errors');await context.close();
    }
    for (const invalidation of ['account','navigation','replaced-panel']) {
      const {page,context,errors}=await fresh();await page.locator('.goals-panel summary').click();
      await page.evaluate(()=>{qaHold=true;});await page.locator('[data-goal-toggle="existing"]').click();await page.waitForFunction(()=>qaPending.length===1);
      await page.evaluate(mode=>{
        if(mode==='account'){state.user={id:'another-rider'};state.profile=qaProfile('another-rider');}
        if(mode==='navigation')state.view='session';
        document.querySelector('#view').innerHTML='<div id="new-context">New context</div>';
        qaPending.splice(0).forEach(resolve=>resolve());
      },invalidation);
      await page.waitForFunction(()=>qaProfiles.get('fixture-athlete').goals[0].completed===true);
      eq(await page.locator('#new-context').textContent(),'New context',`Late save cannot repaint after ${invalidation}`);
      if(invalidation==='account')eq(await page.evaluate(()=>[state.profile.id,state.profile.goals[0].completed]),['another-rider',false],'Late old-account result cannot overwrite new account');
      eq(await page.evaluate(()=>qaNavigations),[],'Late save cannot navigate Home');
      eq(errors,[],`Late save after ${invalidation} has no browser errors`);await context.close();
    }
    console.log(`PASS: ${checks} isolated Profile goals checks: athlete-only placement, account-bound CRUD, errors/retry, draft preservation, mobile layout, and stale save guards. No production traffic.`);
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
