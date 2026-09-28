const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const extract = name => {
  const start = app.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'));
  assert(start >= 0, 'Actual ' + name + ' exists');
  const rest = app.slice(start);
  return rest.slice(0, rest.indexOf('\n}') + 2);
};
const names = [...new Set([
  'normalizeTrickKey', 'resolveTricktionaryAlias', 'safeTricktionaryCategory', 'manualTricktionary',
  'tricktionaryMeta', 'tricktionaryCategoryFromText', 'tricktionaryCategoryForEntry', 'tricktionarySubcategory',
  'splitLineTricks', 'assignmentPresentation', 'tricktionaryLineComponents', 'tricktionaryLandingDate',
  'landedTricktionaryEntries', 'attemptsByTrick', 'tricktionaryCardHtml', 'tricktionaryBoardHtml',
  'tricktionaryDragEntry', 'tricktionaryDropTargetFromPoint', 'captureTricktionaryViewState',
  'restoreTricktionaryViewState', 'moveTricktionaryEntry', 'bindTricktionaryBoard', 'weeklyAttemptsHtml', 'renderTricktionary', 'renderCoachTricktionary', 'renderParentTricktionary',
])];
const constants = app.slice(app.indexOf('const TRICKTIONARY_SECTIONS'), app.indexOf('function normalizeTrickKey'));
const screenshotDir = process.env.JKCREW_SCREENSHOT_DIR;
if (screenshotDir) fs.mkdirSync(screenshotDir, { recursive: true });
const errors = [], consoleErrors = [];
let browser;
async function setup(role = 'coach') {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.route('**/*', route => route.abort());
  await page.setContent('<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"><div class="app-shell coach-shell" style="display:block"><main id="view" class="content" data-view="tricktionary"></main></div></div></body></html>');
  for (const file of ['styles.css', 'tricktionary-tools.css']) await page.addStyleTag({ content: fs.readFileSync(path.join(root, file), 'utf8') });
  for (const file of ['tricktionary-auto.js', 'tricktionary-tools.js']) await page.addScriptTag({ content: fs.readFileSync(path.join(root, file), 'utf8') });
  await page.evaluate(role => {
    window.state = { user: { id: role === 'athlete' ? 'rider-a' : 'coach' }, profile: { id: role === 'athlete' ? 'rider-a' : 'coach', role },
      view: 'tricktionary', coachTricktionaryAthleteId: 'rider-a', selectedAthleteId: 'rider-a', sessionSetupVersion: 1,
      tricktionaryRenderVersion: 0, tricktionaryTools: null };
    document.querySelector('.app-shell').className = 'app-shell ' + (role === 'athlete' ? 'rider-shell' : 'coach-shell');
    window.qaCalls = []; window.qaNotices = []; window.qaReadHold = false; window.qaReadRelease = null;
    window.qaHoldMutation = false; window.qaMutationRelease = null; window.qaFailMutation = false;
    window.qaCatalogHold = false; window.qaCatalogRelease = null; window.qaCatalogError = false;
    window.qaRoster = [{ id: 'rider-a', display_name: 'Alex Long-Surname' }, { id: 'rider-b', display_name: 'Riley Second-Rider' }];
    window.qaCatalog = [
      { id: 'catalog-1', source_key: 'tailwhip box', title: 'Tailwhip Box', category: 'box', subcategory: 'other' },
      { id: 'catalog-2', source_key: 'barspin air', title: 'Barspin Air', category: 'air', subcategory: 'other' },
    ];
    const makeData = (id, name) => ({
      profile: { id, display_name: name, role: 'athlete', country_code: 'AU', weekly_points: 41, xp_total: 208, level: 3, daily_pb_seconds: 120,
        tricktionary_meta: { categories: {}, subcategories: {}, aliases: {}, titles: {}, hidden: {} },
        manual_tricktionary: [{ id: id + '-manual', title: 'Mystery Move', count: 4 }, { id: id + '-manual-box', title: '360 Box', count: 2 }] },
      assignments: [], progress: [], awards: [], percentageAttempts: [], landedAttempts: [],
      landingHistory: [{ id: id + '-landing', assignment_id: id + '-assignment', trick_name: 'Mystery Move', category: 'one_bang', landed_at: '2026-09-28T01:00:00Z', landed_count: 2, evidence_type: 'progress' }],
      attempts: [{ id: id + '-attempt', trick_name: 'Mystery Move', week_start: '2026-09-28', category: 'one_bang' }],
      pointsLedger: [{ id: id + '-points', points: 41 }], xpLedger: [{ id: id + '-xp', xp: 208 }],
    });
    window.qaData = Object.fromEntries(qaRoster.map(rider => [rider.id, makeData(rider.id, rider.display_name)]));
    window.qaEvidenceSnapshot = () => JSON.stringify(Object.fromEntries(Object.entries(qaData).map(([id, data]) => [id, {
      count: landedTricktionaryEntries(data).reduce((sum, entry) => sum + entry.count, 0), history: data.landingHistory, attempts: data.attempts,
      manual: data.profile.manual_tricktionary, points: data.pointsLedger, xp: data.xpLedger, weekly_points: data.profile.weekly_points, xp_total: data.profile.xp_total,
    }])));
    window.qaRpc = async (name, args = {}) => {
      if (name === 'get_tricktionary_catalog') {
        const catalog = structuredClone(qaCatalog);
        if (qaCatalogHold) { qaCatalogHold = false; await new Promise(resolve => { qaCatalogRelease = resolve; }); }
        return qaCatalogError ? { error: { message: 'Catalog unavailable' } } : { data: catalog };
      }
      const mutations = ['set_tricktionary_location', 'save_tricktionary_catalog_entry', 'delete_tricktionary_catalog_entry', 'apply_tricktionary_locations'];
      if (!mutations.includes(name)) throw Error('Unexpected RPC ' + name);
      if (qaHoldMutation) { qaHoldMutation = false; await new Promise(resolve => { qaMutationRelease = resolve; }); }
      if (qaFailMutation || Boolean(window.qaFailForAthlete) && window.qaFailForAthlete === args.p_athlete_id) { qaFailMutation = false; window.qaFailForAthlete = null; return { error: { message: 'Synthetic save failure. Please retry.' } }; }
      if (args.p_athlete_id && (!qaData[args.p_athlete_id] || (state.profile.role === 'athlete' && args.p_athlete_id !== state.user.id))) return { error: { message: 'Rider is not available' } };
      if (name === 'set_tricktionary_location') {
        const meta = qaData[args.p_athlete_id].profile.tricktionary_meta;
        meta.categories[args.p_trick_key] = args.p_category;
        if (args.p_subcategory) meta.subcategories[args.p_trick_key] = args.p_subcategory;
        else delete meta.subcategories[args.p_trick_key];
        return { data: null };
      }
      if (name === 'save_tricktionary_catalog_entry') {
        if (!isCoachRole(state.profile.role)) return { error: { message: 'Only coaches can teach the catalog' } };
        const item = { source_key: args.p_source_key, title: args.p_title, category: args.p_category, subcategory: args.p_subcategory };
        qaCatalog = [...qaCatalog.filter(row => row.source_key !== item.source_key), item]; return { data: item };
      }
      if (name === 'delete_tricktionary_catalog_entry') {
        if (!isCoachRole(state.profile.role)) return { error: { message: 'Only coaches can edit the catalog' } };
        qaCatalog = qaCatalog.filter(row => row.source_key !== args.p_source_key); return { data: true };
      }
      if (args.p_items.length > 200) throw Error('Oversized automation batch');
      const meta = qaData[args.p_athlete_id].profile.tricktionary_meta;
      const result = { applied: 0, unchanged: 0, skipped: [], items: [] };
      for (const item of args.p_items) {
        const oldCategory = meta.categories[item.key] ?? null, oldSubcategory = meta.subcategories[item.key] ?? null;
        if (oldCategory === item.category && oldSubcategory === item.subcategory) { result.unchanged++; continue; }
        if ((oldCategory && oldCategory !== 'new') || oldSubcategory) { result.skipped.push({ key: item.key, reason: 'explicit_location' }); continue; }
        if (oldCategory !== item.expected_category || oldSubcategory !== item.expected_subcategory) { result.skipped.push({ key: item.key, reason: 'location_changed' }); continue; }
        meta.categories[item.key] = item.category; meta.subcategories[item.key] = item.subcategory;
        result.applied++; result.items.push({ key: item.key, category: item.category, subcategory: item.subcategory });
      }
      return { data: result };
    };
    window.client = { rpc: async (name, args) => { qaCalls.push({ name, args: structuredClone(args) }); return qaRpc(name, args); }, from: name => { throw Error('Unexpected table access ' + name); } };
    window.getTricktionaryData = async athleteId => {
      const snapshot = structuredClone(qaData[athleteId]); if (!snapshot) throw Error('Rider is not available');
      if (qaReadHold) { qaReadHold = false; await new Promise(resolve => { qaReadRelease = resolve; }); }
      try { snapshot.catalog = await JKCrewTricktionaryTools.loadCatalog({client,userId:state.user.id,currentUser:()=>state.user?.id,athleteId,withTimeout}); } catch (_) { snapshot.catalog = []; snapshot.catalogUnavailable = true; }
      return snapshot;
    };
    window.getCoachRoster = async () => structuredClone(qaRoster);
    window.getParentRiderContext = async () => ({ selected: structuredClone(qaRoster[0]), riders: structuredClone(qaRoster) });
    window.parentChildSwitcherHtml = () => ''; window.parentPageHeadHtml = () => '<h1>Rider Tricktionary</h1>';
    window.parentWaitingHtml = () => 'No linked rider'; window.firstName = profile => profile.display_name.split(' ')[0];
    window.bindParentPageActions = () => {};
    window.escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
    window.isCoachRole = role => ['coach', 'admin'].includes(role);
    window.avatarHtml = rider => '<span class="avatar">' + escapeHtml(rider.display_name[0]) + '</span>';
    window.formatPbTime = () => '2:00'; window.weekStartDate = () => '2026-09-28';
    window.categoryInfo = { daily: { label: 'Daily' }, one_bang: { label: 'One Bangs' }, lines: { label: 'Lines' }, percentage: { label: 'Percentage' } };
    window.countryTimezones = { AU: 'Australia/Brisbane' };
    window.notify = (message, type) => qaNotices.push({ message, type }); window.messageFrom = error => error.message;
    window.withTimeout = async promise => promise; window.previousTrainingSheetsHtml = () => '';
    window.riderFeaturesDisabled = () => false; window.riderFeatureAccessUnknown = () => false;
    window.setButtonBusy = button => { const label = button.textContent; button.disabled = true; return () => { button.disabled = false; button.textContent = label; }; };
    for (const name of ['navigate', 'saveManualTrick', 'removeManualTrick', 'cacheClear', 'showUndoToast']) window[name] = () => {};
  }, role);
  await page.addScriptTag({ content: constants + names.map(extract).join('\n') });
  await page.evaluate(() => {
    window.qaRefreshes = 0;
    window.qaMount = async (athleteId = state.coachTricktionaryAthleteId) => {
      const data = await getTricktionaryData(athleteId);
      const entries = JKCrewTricktionaryAuto.organise(landedTricktionaryEntries(data), {profile:data.profile,catalog:data.catalog});
      const view = document.querySelector('#view');
      view.innerHTML = tricktionaryBoardHtml(entries, data.attempts, {editable:true,profile:data.profile});
      const board = view.querySelector('[data-tricktionary-board]');
      if (!board.querySelector('[data-auto-organise]')) board.insertAdjacentHTML('afterbegin', JKCrewTricktionaryTools.toolbarHtml());
      for (const entry of entries) {
        const card = [...board.querySelectorAll('[data-trick-key]')].find(card => card.dataset.trickKey === entry.key);
        if (!card.querySelector('[data-sort-trick]')) card.querySelector('.tricktionary-card-meta').insertAdjacentHTML('beforeend', JKCrewTricktionaryTools.cardButtonHtml(entry));
      }
      const userId = state.user.id;
      JKCrewTricktionaryTools.bind({board,athleteId,userId,currentUser:()=>state.user?.id,
        isCurrent:()=>state.view==='tricktionary' && (state.profile.role==='athlete' ? state.user.id : state.coachTricktionaryAthleteId)===athleteId,
        coach:isCoachRole(state.profile.role),data,entries,roster:qaRoster,client,withTimeout,
        move:(key,category,subcategory)=>moveTricktionaryEntry(athleteId,key,category,subcategory),
        refresh:async()=>{qaRefreshes++;await qaMount(athleteId);},notify,loadData:getTricktionaryData,aggregate:landedTricktionaryEntries});
    };
  });
  return page;
}
const evidence = page => page.evaluate(() => qaEvidenceSnapshot());
const mutationCalls = page => page.evaluate(() => qaCalls.filter(call => !call.name.startsWith('get_')));
async function layouts(page, name) {
  for (const theme of ['dark', 'light']) for (const width of [320, 390, 1024]) {
    await page.setViewportSize({width,height:844});
    await page.evaluate(theme => {document.documentElement.dataset.theme=theme;},theme);
    assert(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth+1), name+' fits '+theme+' '+width);
    const dialog=page.locator('dialog[open]');
    if(await dialog.count()) {
      assert(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),name+' dialog has no horizontal clipping');
      assert(await dialog.evaluate(el=>{const box=el.getBoundingClientRect();return box.left>=0&&box.right<=innerWidth+1&&box.top>=0&&box.bottom<=innerHeight+1;}),name+' dialog is reachable in viewport');
    }
    if(screenshotDir)await page.screenshot({path:path.join(screenshotDir,name+'-'+theme+'-'+width+'.png'),fullPage:true,animations:'disabled'});
  }
}
(async()=>{
  browser=await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH});
  try {
    const coach=await setup();
    await coach.evaluate(()=>qaMount());
    const before=await evidence(coach);
    assert.equal(await mutationCalls(coach).then(rows=>rows.length),0,'Rendering and classifying suggestions never write');
    assert.equal(await coach.locator('[data-trick-key="mystery move"]').getAttribute('data-trick-landed'),'6');
    await coach.locator('[data-sort-trick="mystery move"]').click();
    assert.equal(await mutationCalls(coach).then(rows=>rows.length),0,'Opening quick classification is read-only');
    await coach.check('[data-sort-form] [name=category][value=air]');
    await coach.selectOption('#trick-sort-subcategory','flips');
    assert(await coach.locator('[name=share]').isChecked(),'Coach can intentionally teach the crew catalog');
    await layouts(coach,'tricktionary-quick-sort');
    await coach.evaluate(()=>{qaFailMutation=true;});
    await coach.locator('[data-sort-form] button[type=submit]').click();
    await coach.waitForFunction(()=>document.querySelector('[data-auto-status]').textContent.includes('choices are kept'));
    assert(await coach.locator('[name=category][value=air]').isChecked());
    assert.equal(await coach.inputValue('#trick-sort-subcategory'),'flips');
    assert(await coach.locator('[name=share]').isChecked());
    assert.equal(await evidence(coach),before,'Failed placement preserves all source evidence and totals');
    const requestsBeforeRetry=await mutationCalls(coach).then(rows=>rows.length);
    await coach.evaluate(()=>{
      qaHoldMutation=true;
      const form=document.querySelector('[data-sort-form]');
      form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
      form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    });
    await coach.waitForFunction(()=>Boolean(qaMutationRelease));
    assert.equal(await mutationCalls(coach).then(rows=>rows.length),requestsBeforeRetry+1,'Double-save cannot duplicate location updates');
    await coach.evaluate(()=>{qaMutationRelease();qaMutationRelease=null;});
    await coach.waitForFunction(()=>!document.querySelector('dialog'));
    await coach.waitForFunction(()=>qaRefreshes===1);
    const saved=await mutationCalls(coach);
    assert.deepEqual(saved.at(-2),{name:'set_tricktionary_location',args:{p_athlete_id:'rider-a',p_trick_key:'mystery move',p_category:'air',p_subcategory:'flips'}});
    assert.deepEqual(saved.at(-1),{name:'save_tricktionary_catalog_entry',args:{p_source_key:'mystery move · air',p_title:'Mystery Move · Air',p_category:'air',p_subcategory:'flips'}});
    assert.equal(await evidence(coach),before,'Classification and teaching change organisation only');
    assert.equal(await coach.locator('[data-trick-key="mystery move"]').getAttribute('data-trick-landed'),'6');
    assert.equal(await coach.locator('[data-trick-key="mystery move"]').getAttribute('data-trick-category'),'air');
    await coach.close();

    const contradiction=await setup();
    await contradiction.evaluate(async()=>{
      await qaMount();document.querySelectorAll('details').forEach(details=>{details.open=true;});
    });
    const contradictionBefore=await evidence(contradiction);
    await contradiction.locator('[data-sort-trick=\"360 box\"]').click();
    await contradiction.check('[name=category][value=air]');
    await contradiction.selectOption('#trick-sort-subcategory','spins');
    await contradiction.locator('[data-sort-form] button[type=submit]').click();
    await contradiction.waitForFunction(()=>!document.querySelector('dialog'));
    assert.equal(await mutationCalls(contradiction).then(rows=>rows.filter(row=>row.name==='save_tricktionary_catalog_entry').length),0,'A personal placement contradicting its obstacle-qualified name cannot teach an incorrect shared rule');
    assert.match(await contradiction.evaluate(()=>qaNotices.at(-1).message),/no crew rule was created/);
    assert.equal(await evidence(contradiction),contradictionBefore);
    await contradiction.close();

    const bulk=await setup();
    await bulk.evaluate(async()=>{
      for(const data of Object.values(qaData))data.profile.tricktionary_meta.categories['360 box']='new';
      await qaMount();
    });
    const bulkBefore=await evidence(bulk);
    await bulk.locator('[data-auto-organise]').click();
    assert.equal(await bulk.locator('[data-apply-auto]').isVisible(),false);
    await bulk.locator('[data-preview-auto]').click();
    await bulk.waitForFunction(()=>document.querySelectorAll('[data-preview-key]').length===1);
    assert.equal(await mutationCalls(bulk).then(rows=>rows.length),0,'Preview never writes placements');
    assert((await bulk.locator('[data-auto-preview]').innerText()).includes('Alex Long-Surname'));
    assert(!(await bulk.locator('[data-auto-preview]').innerText()).includes('Riley Second-Rider'));
    await bulk.selectOption('#trick-auto-scope','crew');
    assert.equal(await bulk.locator('[data-preview-key]').count(),0,'Changing scope discards the prior preview');
    assert.equal(await bulk.locator('[data-apply-auto]').isVisible(),false);
    await bulk.locator('[data-preview-auto]').click();
    await bulk.waitForFunction(()=>document.querySelectorAll('[data-preview-key]').length===2);
    assert.equal(await mutationCalls(bulk).then(rows=>rows.length),0,'Whole crew preview is also read-only');
    assert(!(await bulk.locator('[data-auto-preview]').innerText()).includes('Mystery Move'),'Ambiguous bare names stay unsorted');
    await layouts(bulk,'tricktionary-bulk-preview');
    await bulk.locator('[data-preview-key="rider-b:0"]').uncheck();
    await bulk.evaluate(()=>{qaFailMutation=true;});
    await bulk.locator('[data-apply-auto]').click();
    await bulk.waitForFunction(()=>document.querySelector('[data-auto-status]').textContent.includes('retry the remaining'));
    assert(await bulk.locator('[data-preview-key="rider-a:0"]').isChecked(),'Failed apply keeps selected rows');
    assert.equal(await bulk.locator('[data-preview-key="rider-b:0"]').isChecked(),false,'Failed apply preserves excluded rows');
    assert.equal(await evidence(bulk),bulkBefore);
    await bulk.locator('[data-apply-auto]').click();
    await bulk.waitForFunction(()=>qaNotices.some(notice=>notice.message.includes('1 placements saved')));
    const bulkCalls=await mutationCalls(bulk);
    assert(bulkCalls.every(call=>call.name==='apply_tricktionary_locations'),'Bulk automation uses only the guarded location endpoint');
    assert(bulkCalls.every(call=>call.args.p_athlete_id==='rider-a'),'Unchecked rider is never written');
    assert.deepEqual(bulkCalls.at(-1).args.p_items,[{key:'360 box',category:'box',subcategory:'spins',expected_category:'new',expected_subcategory:null}]);
    assert.equal(await evidence(bulk),bulkBefore,'Bulk apply preserves counts, evidence, attempts, XP and points');
    assert.equal(await bulk.evaluate(()=>qaData['rider-b'].profile.tricktionary_meta.categories['360 box']),'new');
    await bulk.close();

    const partial=await setup();
    await partial.evaluate(async()=>{
      for(const data of Object.values(qaData))data.profile.tricktionary_meta.categories['360 box']='new';
      await qaMount();
    });
    const partialBefore=await evidence(partial);
    await partial.locator('[data-auto-organise]').click();
    await partial.selectOption('#trick-auto-scope','crew');
    await partial.locator('[data-preview-auto]').click();
    await partial.waitForFunction(()=>document.querySelectorAll('[data-preview-key]').length===2);
    await partial.evaluate(()=>{window.qaFailForAthlete='rider-b';});
    await partial.locator('[data-apply-auto]').click();
    await partial.waitForFunction(()=>document.querySelector('[data-auto-status]').textContent.includes('retry the remaining'));
    assert(await partial.locator('[data-preview-key=\"rider-a:0\"]').isDisabled(),'Completed rider is marked saved after a later rider fails');
    assert.equal(await partial.locator('[data-preview-key=\"rider-a:0\"]').isChecked(),false);
    assert(await partial.locator('[data-preview-key=\"rider-b:0\"]').isChecked());
    await partial.locator('[data-apply-auto]').click();
    await partial.waitForFunction(()=>qaNotices.some(notice=>notice.message.includes('placements saved')));
    assert.deepEqual((await mutationCalls(partial)).map(call=>call.args.p_athlete_id),['rider-a','rider-b','rider-b'],'Retry skips previously completed riders');
    assert.equal(await evidence(partial),partialBefore);
    await partial.close();

    const rider=await setup('athlete');
    await rider.evaluate(()=>qaMount('rider-a'));
    const riderBefore=await evidence(rider);
    await rider.locator('[data-sort-trick="mystery move"]').click();
    assert.equal(await rider.locator('[name=share]').count(),0,'Riders do not teach a coach catalog');
    await rider.check('[name=category][value=hip]');
    await rider.selectOption('#trick-sort-subcategory','other');
    await rider.locator('[data-sort-form] button[type=submit]').click();
    await rider.waitForFunction(()=>!document.querySelector('dialog'));
    assert.deepEqual(await mutationCalls(rider),[{name:'set_tricktionary_location',args:{p_athlete_id:'rider-a',p_trick_key:'mystery move',p_category:'hip',p_subcategory:'other'}}]);
    assert.equal(await evidence(rider),riderBefore);
    await rider.locator('[data-auto-organise]').click();
    assert.equal(await rider.locator('#trick-auto-scope option[value=crew]').count(),0,'Rider automation is scoped to that rider');
    await rider.close();

    // Suggestions arrive asynchronously and must never replace text or move the cursor.
    for(const accountChanged of [false,true]){
      const suggestions=await setup();
      await suggestions.evaluate(()=>{
        qaCatalogHold=true;
        document.querySelector('#view').innerHTML='<form><input name="trickName" value="My custom trick"></form>';
        window.qaDisposeSuggestions=JKCrewTricktionaryTools.installSuggestions({client,withTimeout,currentUser:()=>state.user?.id});
      });
      await suggestions.locator('[name=trickName]').focus();
      await suggestions.waitForFunction(()=>Boolean(qaCatalogRelease));
      await suggestions.locator('[name=trickName]').fill('Custom trick typed while loading');
      await suggestions.evaluate(accountChanged=>{
        const input=document.querySelector('[name=trickName]');input.setSelectionRange(7,7);
        if(accountChanged)state.user={id:'different-coach'};
        qaCatalogRelease();qaCatalogRelease=null;
      },accountChanged);
      if(!accountChanged)await suggestions.waitForFunction(()=>Boolean(document.querySelector('datalist option')));
      else await suggestions.evaluate(async()=>{await Promise.resolve();await Promise.resolve();});
      assert.equal(await suggestions.inputValue('[name=trickName]'),'Custom trick typed while loading');
      assert.equal(await suggestions.locator('[name=trickName]').evaluate(input=>input.selectionStart),7);
      assert.equal(await suggestions.locator('datalist').count(),accountChanged?0:1,'Catalog response belongs to the requesting account');
      assert.equal(await mutationCalls(suggestions).then(rows=>rows.length),0);
      if(!accountChanged)assert.deepEqual(await suggestions.locator('datalist option').evaluateAll(options=>options.map(option=>option.value)),['Tailwhip Box','Barspin Air']);
      await suggestions.close();
    }

    // A dialog opened for an earlier rider/account cannot issue a later write.
    for(const changed of ['account','rider','view']){
      const stale=await setup();await stale.evaluate(()=>qaMount());
      await stale.locator('[data-sort-trick="mystery move"]').click();
      await stale.check('[name=category][value=box]');
      await stale.evaluate(changed=>{
        if(changed==='account')state.user={id:'other-coach'};
        if(changed==='rider')state.coachTricktionaryAthleteId='rider-b';
        if(changed==='view')state.view='home';
      },changed);
      await stale.locator('[data-sort-form] button[type=submit]').click();
      assert.equal(await mutationCalls(stale).then(rows=>rows.length),0,changed+' invalidates the old dialog');
      await stale.close();
    }

    // Real rider and coach renderers mount the tools and retain the selected rider on save.
    const integrated=await setup();
    await integrated.evaluate(()=>renderCoachTricktionary());
    assert.equal(await integrated.locator('[data-auto-organise]').count(),1);
    assert.match(await integrated.locator('.new-zone h3').innerText(),/Needs sorting/i);
    await layouts(integrated,'tricktionary-coach-page');
    await integrated.selectOption('#coach-tricktionary-athlete','rider-b');
    await integrated.waitForFunction(()=>document.querySelector('.coach-tricktionary-summary').textContent.includes('Riley'));
    await integrated.locator('[data-sort-trick=\"mystery move\"]').click();
    await integrated.check('[name=category][value=spine]');
    await integrated.selectOption('#trick-sort-subcategory','spins');
    await integrated.uncheck('[name=share]');
    await integrated.locator('[data-sort-form] button[type=submit]').click();
    await integrated.waitForFunction(()=>!document.querySelector('dialog'));
    await integrated.waitForFunction(()=>document.querySelector('[data-trick-key=\"mystery move\"]').dataset.trickCategory==='spine');
    assert.equal((await mutationCalls(integrated)).at(-1).args.p_athlete_id,'rider-b');
    assert.equal(await integrated.evaluate(()=>qaData['rider-a'].profile.tricktionary_meta.categories['mystery move']),undefined,'Selected-rider save leaves the other rider alone');
    await integrated.close();

    const actualRider=await setup('athlete');
    await actualRider.evaluate(()=>renderTricktionary());
    assert.equal(await actualRider.locator('#manual-trick-form').count(),1);
    assert.equal(await actualRider.locator('[data-sort-trick=\"mystery move\"]').count(),1);
    await actualRider.locator('[data-sort-trick=\"mystery move\"]').click();
    assert.equal(await actualRider.locator('[name=share]').count(),0);
    await actualRider.close();

    // Existing read-only boards, including the parent view, cannot expose editing tools.
    const readonly=await setup('parent');
    await readonly.evaluate(()=>renderParentTricktionary());
    assert.equal(await readonly.locator('[data-auto-organise], [data-sort-trick]').count(),0);
    assert.equal(await mutationCalls(readonly).then(rows=>rows.length),0);
    await readonly.close();

    // Old personal reads cannot paint another account, session or destination.
    for(const role of ['athlete','coach','parent'])for(const changed of ['account','session','view']){
      const late=await setup(role);
      await late.evaluate(()=>{qaReadHold=true;window.qaPendingRender=renderTricktionary();});
      await late.waitForFunction(()=>Boolean(qaReadRelease));
      await late.evaluate(async changed=>{
        if(changed==='account'){state.user={id:'new-account'};state.profile={id:'new-account',role:'athlete'};}
        if(changed==='session')state.sessionSetupVersion++;
        if(changed==='view')state.view='home';
        document.querySelector('#view').innerHTML='Current destination';
        qaReadRelease();qaReadRelease=null;await qaPendingRender;
      },changed);
      assert.equal(await late.locator('#view').innerText(),'Current destination',role+' '+changed+' invalidates old render');
      if(changed==='account')assert.equal(await late.evaluate(()=>state.profile.id),'new-account','Old rider profile never replaces the new account');
      await late.close();
    }

    const riderRace=await setup();
    await riderRace.evaluate(()=>{qaReadHold=true;window.qaPendingRender=renderCoachTricktionary();});
    await riderRace.waitForFunction(()=>Boolean(qaReadRelease));
    await riderRace.evaluate(async()=>{
      state.coachTricktionaryAthleteId='rider-b';await renderCoachTricktionary();
      window.qaLatestBoard=document.querySelector('[data-tricktionary-board]');
      qaReadRelease();qaReadRelease=null;await qaPendingRender;
    });
    assert.equal(await riderRace.inputValue('#coach-tricktionary-athlete'),'rider-b');
    assert(await riderRace.evaluate(()=>qaLatestBoard===document.querySelector('[data-tricktionary-board]')),'An old rider response cannot replace the newer board');
    await riderRace.close();

    // A selector change invalidates the old dialog immediately, before the new board arrives.
    const modalRace=await setup();
    await modalRace.evaluate(()=>renderCoachTricktionary());
    await modalRace.locator('[data-sort-trick=\"mystery move\"]').click();
    await modalRace.check('[name=category][value=air]');
    await modalRace.evaluate(()=>{
      qaReadHold=true;
      const selector=document.querySelector('#coach-tricktionary-athlete');selector.value='rider-b';selector.dispatchEvent(new Event('change',{bubbles:true}));
    });
    await modalRace.waitForFunction(()=>Boolean(qaReadRelease));
    if(await modalRace.locator('[data-sort-form]').count())await modalRace.locator('[data-sort-form] button[type=submit]').click();
    assert.equal(await mutationCalls(modalRace).then(rows=>rows.length),0,'Old-rider dialog cannot save while a new rider is loading');
    await modalRace.evaluate(()=>{qaReadRelease();qaReadRelease=null;});
    await modalRace.close();

    const contexts=await setup();
    const mixed=await contexts.evaluate(()=>{
      const data={profile:{id:'rider-a',tricktionary_meta:{}},landingHistory:[
        {id:'box-proof',assignment_id:'a',trick_name:'Barspin',notes:'Box',category:'one_bang',landed_at:'2026-09-27T01:00:00Z',landed_count:1,evidence_type:'progress'},
        {id:'air-proof',assignment_id:'b',trick_name:'Barspin',notes:'Air',category:'one_bang',landed_at:'2026-09-28T01:00:00Z',landed_count:1,evidence_type:'progress'},
      ]};
      return landedTricktionaryEntries(data).map(entry=>({title:entry.title,count:entry.count,category:entry.tricktionaryCategory}));
    });
    assert.deepEqual(mixed,[{title:'Barspin',count:2,category:'new'}],'Different obstacle evidence for the same name stays ambiguous without changing its total');
    const mixedFoam=await contexts.evaluate(()=>{
      const data={profile:{id:'rider-a',tricktionary_meta:{}},landingHistory:[
        {id:'box',assignment_id:'a',trick_name:'Backflip',notes:'Box',category:'daily',landed_at:'2026-09-28T01:00:00Z',landing_date:'2026-09-28',landed_count:1,evidence_type:'progress'},
        {id:'foam-note',assignment_id:'b',trick_name:'Backflip',notes:'Foam pit practice',category:'daily',landed_at:'2026-09-28T02:00:00Z',landing_date:'2026-09-28',landed_count:1,evidence_type:'progress'},
      ]};
      const engine=window.JKCrewTricktionaryAuto;
      let legacy;
      try{window.JKCrewTricktionaryAuto=undefined;legacy=landedTricktionaryEntries(data);}finally{window.JKCrewTricktionaryAuto=engine;}
      const automated=landedTricktionaryEntries(data);
      return {legacy:legacy.map(entry=>({title:entry.title,count:entry.count})),automated:automated.map(entry=>({title:entry.title,count:entry.count}))};
    });
    assert.deepEqual(mixedFoam.legacy,[{title:'Backflip',count:2}],'New classification context cannot alter existing source evidence aggregation');
    assert.deepEqual(mixedFoam.automated,mixedFoam.legacy,'Enabling sorting cannot drop landings because another source note mentions foam');
    await contexts.close();

    assert.deepEqual(errors,[],'No browser exceptions');
    assert.deepEqual(consoleErrors,[],'No console errors');
    console.log('PASS: Tricktionary quick classification/retry, duplicate save protection, coach teaching and rider scope, selected/crew read-only previews, selective bulk retry, evidence/count/points/XP preservation, non-destructive delayed name suggestions, stale account/rider/view guards, actual coach/rider renderer integration, late personal-read guards, and dark/light 320/390/1024px layouts. No production calls.');
  }finally{await browser?.close();}
})().catch(error=>{console.error(error);process.exit(1);});
