// Production Session Tracker UI with synthetic callbacks only. No live rider changes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const screenshotDir = process.env.JKCREW_SCREENSHOT_DIR;
if (screenshotDir) fs.mkdirSync(screenshotDir, { recursive: true });
let browser, checks = 0;
const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
const ok = (value, label) => { assert(value, label); checks++; };

async function setup() {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.route('**/*', route => route.request().url() === 'http://localhost:4173/'
    ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><html data-theme="dark"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="app"><div class="app-shell coach-shell" style="display:block"><main id="view" class="content" data-view="sessionTracker"></main></div></div></body></html>' })
    : route.abort());
  await page.goto('http://localhost:4173/');
  for (const file of ['styles.css', 'session-tracker.css']) await page.addStyleTag({ path: path.join(root, file) });
  await page.addScriptTag({ path: path.join(root, 'session-tracker.js') });
  await page.evaluate(() => {
    window.qa = { active: true, calls: [], hold: {}, failure: {}, releases: {}, backs: 0, failAfterSave: false };
    window.fixture = {
      roster: [
        { id: 'rider-a', display_name: 'Alex Example' },
        { id: 'rider-b', display_name: 'Morgan <img src=x onerror="window.injected=true"> & O\'Brien' },
        { id: 'rider-c', display_name: 'LongSurname'.repeat(12) },
      ],
      blocks: [],
      locations: [{ id: 'park-a', name: 'Pizzey Skate Park' }, { id: 'park-b', name: 'Beenleigh' }],
      sessions: [
        { id: 'saved-upcoming', source: 'tracker', session_date: '2026-11-05', start_time: '16:00', venue: 'Pizzey Skate Park', rider_ids: ['rider-a', 'rider-b'], updated_at: '2026-11-04T01:00:00Z', status: 'planned' },
        { id: 'saved-past', source: 'tracker', session_date: '2026-11-02', start_time: null, venue: 'Beenleigh', rider_ids: ['rider-c'], updated_at: '2026-11-02T01:00:00Z', status: 'planned' },
        { id: 'saved-today', source: 'tracker', session_date: '2026-11-04', start_time: '17:00', venue: 'Hotbox', rider_ids: ['rider-a'], updated_at: '2026-11-04T02:00:00Z' },
      ],
    };
    window.waitForTransport = async name => {
      if (qa.hold[name]) { qa.hold[name] = false; await new Promise(resolve => { qa.releases[name] = resolve; }); }
      if (qa.failure[name]) throw Object.assign(Error(qa.failure[name].message || qa.failure[name]), { code: qa.failure[name].code });
    };
    window.options = {
      userId: 'coach-a', role: 'coach', today: '2026-11-04', timeZone: 'Australia/Brisbane', isActive: () => qa.active,
      onBack: () => { qa.backs++; },
      load: async args => {
        qa.calls.push({ action: 'load', args: structuredClone(args) });
        const result = structuredClone(fixture);
        await waitForTransport('load');
        result.sessions = result.sessions.filter(row => (!args.from || row.session_date >= args.from) && (!args.to || row.session_date < args.to));
        result.sessions = result.sessions.filter(row => (!args.blockId || row.block_id === args.blockId) && !row.archived_at && (!args.venue || row.venue === args.venue) && (!args.riderId || row.rider_ids.includes(args.riderId)));
        const offset = args.offset || 0, limit = args.blockId ? 500 : 30;
        result.hasMore = offset + limit < result.sessions.length;
        result.sessions = result.sessions.slice(offset, offset + limit);
        return result;
      },
      save: async record => {
        qa.calls.push({ action: 'save', args: structuredClone(record) });
        await waitForTransport('save');
        const saved = { ...structuredClone(record), id: record.id || 'created-session', source: 'tracker', updated_at: '2026-11-04T03:00:00Z' };
        const old = fixture.sessions.findIndex(row => row.id === saved.id);
        if (old >= 0) fixture.sessions[old] = saved; else fixture.sessions.push(saved);
        if (qa.failAfterSave) { qa.failAfterSave = false; throw Error('Synthetic response lost after the server saved'); }
        return structuredClone(saved);
      },
      saveBlock: async record => {
        qa.calls.push({ action: 'saveBlock', args: structuredClone(record) });
        await waitForTransport('saveBlock');
        const saved={...structuredClone(record),updated_at:'2026-11-04T03:00:00Z'};
        const old=fixture.blocks.findIndex(row=>row.id===saved.id);
        if(old>=0)fixture.blocks[old]=saved;else fixture.blocks.push(saved);
        if(qa.failAfterBlockSave){qa.failAfterBlockSave=false;throw Error('Synthetic lost block response');}
        return structuredClone(saved);
      },
      archive: async (record, archived) => {
        qa.calls.push({ action: 'archive', args: { id: record.id, archived } });
        await waitForTransport('archive');
        const saved = { ...record, archived_at: archived ? '2026-11-04T04:00:00Z' : null, updated_at: '2026-11-04T04:00:00Z' };
        const old = fixture.sessions.findIndex(row => row.id === record.id);
        if (old >= 0) fixture.sessions[old] = saved;
        return structuredClone(saved);
      },
      addLocation: async name => {
        qa.calls.push({ action: 'addLocation', args: name });
        await waitForTransport('addLocation');
        const old = fixture.locations.find(row => row.name.toLowerCase() === name.trim().toLowerCase());
        if (old) return structuredClone(old);
        const row = { id: 'new-location', name: name.trim() }; fixture.locations.push(row); return structuredClone(row);
      },
    };
    window.attach = async (overrides = {}) => {
      window.sessionTrackerHandle?.destroy();
      window.sessionTrackerHandle = JKCSessionTracker.mount(document.querySelector('#view'), { ...options, ...overrides });
      await sessionTrackerHandle.ready;
    };
  });
  return { page, errors };
}

const action = (page, name) => page.locator(`[data-action="${name}"]`);
const field = (page, name) => page.locator(`[data-field="${name}"]`);
const calls = (page, name) => page.evaluate(name => qa.calls.filter(call => call.action === name), name);
const settle = page => page.waitForFunction(() => document.querySelector('.st-list')?.getAttribute('aria-busy') === 'false');
const saveFinished = page => page.waitForFunction(() => !document.querySelector('dialog')?.open);
async function edit(page, id) {
  const row = page.locator(`[data-session-id="${id}"]`);
  if (!(await row.evaluate(node => node.open))) await row.locator('summary').click();
  await row.locator('[data-action="edit-session"]').click();
}
async function chooseRiders(page, selected) {
  const summary = page.locator('.st-picker > summary');
  if (!(await summary.evaluate(node => node.parentElement.open))) await summary.click();
  await field(page, 'rider-search').fill('');
  for (const id of selected) await page.locator(`input[name="rider"][value="${id}"]`).check();
}
async function validDraft(page) {
  await action(page, 'new-session').click();
  await field(page, 'venue').selectOption('Pizzey Skate Park');
  await chooseRiders(page, ['rider-a', 'rider-b']);
}
async function release(page, name) {
  await page.evaluate(name => { const fn = qa.releases[name]; delete qa.releases[name]; fn(); }, name);
}
async function doubleClickImmediately(locator) {
  // Simulate two taps in one task: the second must not pass the operation lock.
  await locator.evaluate(button => { button.click(); button.click(); });
}
async function dimensions(page, label) {
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: page fits the viewport`);
  const overflow = await page.locator('#view *').evaluateAll(nodes => nodes.filter(node => {
    const style = getComputedStyle(node);
    return node.getClientRects().length && style.display !== 'inline' && node.clientWidth > 0 && node.scrollWidth > node.clientWidth + 1 && !['auto', 'scroll'].includes(style.overflowX) && !['SELECT', 'INPUT'].includes(node.tagName);
  }).map(node => ({ tag: node.tagName, class: node.className, width: node.clientWidth, scroll: node.scrollWidth, text: node.textContent.slice(0, 60) })));
  eq(overflow, [], `${label}: long names and controls stay inside their containers`);
}

async function run() {
  browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  try {
    const { page, errors } = await setup();
    await page.evaluate(() => attach());
    eq((await calls(page, 'load')).length, 1, 'Initial load is one bounded request');
    const initialLoad = (await calls(page, 'load'))[0].args;
    eq([initialLoad.from, initialLoad.to, initialLoad.offset, initialLoad.venue, initialLoad.riderId], ['2026-11-01', '2026-12-01', 0, '', ''], 'Month boundaries are explicit and exclusive at the end');
    eq(await page.locator('[data-session-id]').count(), 3, 'Past, today and future sessions are all available');
    await page.locator('[data-session-id="saved-upcoming"] summary').click();
    ok((await page.locator('[data-session-id="saved-upcoming"]').innerText()).includes('Morgan <img'), 'Names are rendered as text');
    eq(await page.locator('#view img').count(), 0, 'Stored rider names cannot create markup');
    eq(await page.evaluate(() => !!window.injected), false, 'Hostile rider names do not execute');
    eq(await page.evaluate(() => sessionTrackerHandle.hasUnsavedChanges()), false, 'The list has no unsaved draft');

    // Create, validate and retain a failed draft without selecting riders again.
    await action(page, 'new-session').click();
    eq(await field(page, 'session-date').inputValue(), '2026-11-04', 'New sessions default to the coach date');
    eq(await field(page, 'start-time').inputValue(), '', 'Time is optional');
    eq(await page.evaluate(() => sessionTrackerHandle.hasUnsavedChanges()), false, 'An untouched form is clean');
    await action(page, 'save-session').click();
    eq((await calls(page, 'save')).length, 0, 'A blank venue cannot be submitted');
    await field(page, 'venue').selectOption('Beenleigh');
    await action(page, 'save-session').click();
    eq((await calls(page, 'save')).length, 0, 'At least one rider is required');
    ok((await page.locator('.st-form-error').innerText()).includes('at least one rider'), 'Missing riders are explained');
    const summary = page.locator('.st-picker > summary');
    await summary.focus(); await page.keyboard.press('Enter');
    eq(await summary.evaluate(node => node.parentElement.open), true, 'Rider dropdown opens using the keyboard');
    await field(page, 'rider-search').fill('alex');
    eq(await page.locator('.st-rider-option:visible').count(), 1, 'Rider search narrows the list');
    await page.locator('input[name="rider"][value="rider-a"]').check();
    await field(page, 'rider-search').fill('unmatched rider');
    eq(await page.locator('[data-rider-empty]').isVisible(), true, 'Empty search has feedback');
    await field(page, 'rider-search').fill('');
    await page.locator('input[name="rider"][value="rider-b"]').check();
    await field(page, 'session-date').fill('2026-11-12');
    await field(page, 'start-time').fill('15:30');
    eq(await page.evaluate(() => sessionTrackerHandle.hasUnsavedChanges()), true, 'Changed form is protected as unsaved');
    await field(page, 'rider-search').press('Enter');
    eq((await calls(page, 'save')).length, 0, 'Enter in rider search does not submit a valid session form');
    await page.evaluate(() => { qa.failure.save = 'Synthetic unavailable network'; });
    await action(page, 'save-session').click();
    await page.waitForFunction(() => document.querySelector('.st-form-error').textContent.includes('couldn’t confirm'));
    eq(await field(page, 'session-date').inputValue(), '2026-11-12', 'Failure retains date');
    eq(await field(page, 'start-time').inputValue(), '15:30', 'Failure retains time');
    eq(await field(page, 'venue').inputValue(), 'Beenleigh', 'Failure retains location');
    eq(await page.locator('input[name="rider"]:checked').count(), 2, 'Failure retains the selected riders');
    eq(await action(page, 'save-session').isEnabled(), true, 'Failure releases the save lock');
    const firstId = (await calls(page, 'save'))[0].args.id;
    ok(firstId, 'The client creates an id before attempting a save');
    await page.evaluate(() => { delete qa.failure.save; qa.hold.save = true; });
    await doubleClickImmediately(action(page, 'save-session'));
    await page.waitForFunction(() => !!qa.releases.save);
    eq((await calls(page, 'save')).length, 2, 'Repeated taps make only one retry request');
    eq((await calls(page, 'save'))[1].args.id, firstId, 'Retry uses the same session id');
    eq(await action(page, 'save-session').isDisabled(), true, 'Save displays an in-flight state');
    await release(page, 'save'); await saveFinished(page); await settle(page);
    eq(await page.locator(`[data-session-id="${firstId}"]`).count(), 1, 'Saved session appears once');
    eq(await page.evaluate(() => sessionTrackerHandle.hasUnsavedChanges()), false, 'Successful save clears the draft');
    await page.evaluate(() => attach());
    eq(await page.locator(`[data-session-id="${firstId}"]`).count(), 1, 'Saved session survives reopening the tracker');
    await edit(page, firstId);
    eq(await field(page, 'start-time').inputValue(), '15:30', 'Edit reloads the saved time');
    eq(await page.locator('input[name="rider"]:checked').count(), 2, 'Edit reloads the saved riders');
    await field(page, 'venue').selectOption('Pizzey Skate Park');
    await field(page, 'start-time').fill('');
    await chooseRiders(page, ['rider-a']);
    await page.locator('input[name="rider"][value="rider-b"]').uncheck();
    await action(page, 'save-session').click(); await saveFinished(page); await settle(page);
    const edited = (await calls(page, 'save')).at(-1).args;
    eq(edited.id, firstId, 'Edit preserves the record id');
    eq(edited.rider_ids, ['rider-a'], 'Edit saves the changed rider list');
    eq(edited.start_time, '', 'An optional time can be cleared');
    eq(await page.evaluate(id => fixture.sessions.filter(row => row.id === id).length, firstId), 1, 'Edit does not append a second record');

    // Lost responses are safely retryable, including when the first write succeeded.
    await validDraft(page);
    await page.evaluate(() => { qa.failAfterSave = true; });
    await action(page, 'save-session').click();
    await page.waitForFunction(() => document.querySelector('.st-form-error').textContent.includes('couldn’t confirm'));
    const lostId = (await calls(page, 'save')).at(-1).args.id;
    eq(await page.evaluate(id => fixture.sessions.filter(row => row.id === id).length, lostId), 1, 'Synthetic server saved before the response was lost');
    await action(page, 'save-session').click(); await saveFinished(page); await settle(page);
    eq((await calls(page, 'save')).at(-1).args.id, lostId, 'Lost-response retry reuses its id');
    eq(await page.evaluate(id => fixture.sessions.filter(row => row.id === id).length, lostId), 1, 'Lost-response retry creates no duplicate');

    // Add a venue without losing the draft or accidentally submitting its parent form.
    await validDraft(page);
    await action(page, 'add-location').click();
    await action(page, 'save-location').click();
    eq((await calls(page, 'addLocation')).length, 0, 'Empty location is not sent');
    await field(page, 'new-location').fill('  New   Park  ');
    const savesBeforeUnaddedLocation = (await calls(page, 'save')).length;
    await action(page, 'save-session').click();
    eq((await calls(page, 'save')).length, savesBeforeUnaddedLocation, 'Pending new location cannot be silently replaced by the previously selected venue');
    eq(await field(page, 'new-location').inputValue(), '  New   Park  ', 'Save keeps the location name until it has been added');
    ok((await page.locator('.st-form-error').innerText()).length > 0, 'Pending location gets a clear save instruction');
    await page.evaluate(() => { qa.failure.addLocation = 'Synthetic unavailable connection'; });
    await field(page, 'new-location').press('Enter');
    await page.waitForFunction(() => document.querySelector('.st-location-error').textContent.includes('couldn’t be saved'));
    eq(await field(page, 'new-location').inputValue(), '  New   Park  ', 'Failed location save retains its input');
    eq(await page.locator('input[name="rider"]:checked').count(), 2, 'Location failure retains the session riders');
    const savesBeforeLocation = (await calls(page, 'save')).length;
    await page.evaluate(() => { delete qa.failure.addLocation; qa.hold.addLocation = true; });
    await field(page, 'new-location').press('Enter');
    await page.waitForFunction(() => !!qa.releases.addLocation);
    await action(page, 'save-location').evaluate(button => button.click());
    eq((await calls(page, 'addLocation')).length, 2, 'Location save also prevents duplicate requests');
    await release(page, 'addLocation');
    await page.waitForFunction(() => document.querySelector('[data-field="venue"]').value === 'New Park');
    eq((await calls(page, 'save')).length, savesBeforeLocation, 'Enter in add-location does not submit the session');
    eq((await calls(page, 'addLocation')).at(-1).args, 'New Park', 'Location whitespace is normalized');
    eq(await field(page, 'venue').inputValue(), 'New Park', 'New location is selected immediately');
    await action(page, 'save-session').click(); await saveFinished(page); await settle(page);
    eq((await calls(page, 'save')).at(-1).args.venue, 'New Park', 'Session uses its new saved venue');

    // A concurrent editor must not erase local edits or silently overwrite the server.
    await edit(page, firstId);
    await field(page, 'start-time').fill('18:45');
    await page.evaluate(() => { qa.failure.save = 'stale session changed elsewhere'; });
    await action(page, 'save-session').click();
    await page.waitForFunction(() => document.querySelector('.st-form-error').textContent.includes('changed elsewhere'));
    eq(await field(page, 'start-time').inputValue(), '18:45', 'Conflict retains the coach’s unsaved time');
    ok((await page.locator('.st-form-error').innerText()).includes('refresh'), 'Conflict explains how to reload the latest saved session');
    await page.evaluate(() => { delete qa.failure.save; });
    await action(page, 'cancel-session').first().click();

    // Removal is reversible; both failure paths retain a usable retry.
    await edit(page, firstId);
    await page.evaluate(() => { qa.failure.archive = 'Synthetic unavailable network'; });
    await action(page, 'archive-session').click();
    await page.waitForFunction(() => document.querySelector('.st-form-error').textContent.includes('couldn’t confirm'));
    eq(await page.locator('dialog').evaluate(node => node.open), true, 'Failed removal keeps the form available');
    await page.evaluate(() => { delete qa.failure.archive; });
    await action(page, 'archive-session').click(); await saveFinished(page); await settle(page);
    eq(await page.locator(`[data-session-id="${firstId}"]`).count(), 0, 'Removed session leaves the list');
    eq(await page.evaluate(id => fixture.sessions.some(row => row.id === id && row.archived_at), firstId), true, 'Remove archives instead of deleting data');
    await page.evaluate(() => { qa.failure.archive = 'Synthetic unavailable network'; });
    await action(page, 'undo-archive').click();
    await page.waitForFunction(() => document.querySelector('.st-feedback').textContent.includes('Couldn’t restore'));
    eq(await action(page, 'undo-archive').isEnabled(), true, 'Failed undo remains retryable');
    await page.evaluate(() => { delete qa.failure.archive; });
    await action(page, 'undo-archive').click(); await settle(page);
    await page.waitForFunction(id => !!document.querySelector(`[data-session-id="${id}"]`), firstId);
    eq(await page.locator(`[data-session-id="${firstId}"]`).count(), 1, 'Undo restores the same session');

    // Server-side filters and calendar range avoid loading the complete history.
    await page.locator('[data-filter="venue"]').selectOption('Beenleigh'); await settle(page);
    eq((await calls(page, 'load')).at(-1).args.venue, 'Beenleigh', 'Location filter is sent to the server');
    eq(await page.locator('[data-session-id]').count(), 1, 'Location filter shows only matching sessions');
    await page.locator('[data-filter="rider"]').selectOption('rider-a'); await settle(page);
    eq((await calls(page, 'load')).at(-1).args.riderId, 'rider-a', 'Rider filter is sent to the server');
    eq(await page.locator('[data-session-id]').count(), 0, 'Both filters apply together');
    await page.locator('[data-filter="venue"]').selectOption(''); await settle(page);
    await action(page, 'previous-month').click(); await settle(page);
    eq((await calls(page, 'load')).at(-1).args.from, '2026-10-01', 'Previous month changes the request range');
    eq(await page.locator('[data-session-id]').count(), 0, 'A new month clears previous month rows');
    await action(page, 'next-month').click(); await settle(page);
    await page.locator('[data-filter="rider"]').selectOption(''); await settle(page);
    const beforeFailure = await page.locator('[data-session-id]').count();
    await page.evaluate(() => { qa.failure.load = 'Synthetic offline'; });
    await action(page, 'refresh').first().click(); await settle(page);
    eq(await page.locator('[data-session-id]').count(), beforeFailure, 'Refresh failure retains the last saved list');
    eq(await page.locator('.st-error').isVisible(), true, 'Refresh failure is visible');
    await page.evaluate(() => { delete qa.failure.load; });
    await page.getByRole('button', { name: 'Try again', exact: true }).click(); await settle(page);
    eq(await page.locator('.st-error').count(), 0, 'Retry clears the load error');

    // Mobile/desktop layout includes unusually long stored names and all controls.
    for (const theme of ['dark', 'light']) for (const width of [320, 390, 1024]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.querySelectorAll('.st-session').forEach(node => { node.open = true; }); }, theme);
      await dimensions(page, `${theme} list at ${width}px`);
      if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `session-tracker-${theme}-${width}.png`), fullPage: true, animations: 'disabled' });
      await validDraft(page);
      await dimensions(page, `${theme} rider dropdown at ${width}px`);
      const targets = await page.locator('dialog button:visible, dialog .st-rider-option:visible, dialog summary:visible').evaluateAll(nodes => nodes.map(node => Math.round(node.getBoundingClientRect().height)));
      ok(targets.every(height => height >= 44), `${theme} editor at ${width}px keeps tap targets at least 44px high`);
      if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `session-tracker-editor-${theme}-${width}.png`), animations: 'disabled' });
      await action(page, 'cancel-session').first().click();
    }
    eq(errors, [], 'No unhandled browser errors');
    await page.close();

    await blocksAndFees();
    await parentCostsAndInvoices();
    await paginationAndIsolation();
    console.log(`PASS: ${checks} Session Tracker browser checks.`);
  } finally { await browser.close(); }
}

async function blocksAndFees() {
  const {page,errors}=await setup();
  await page.evaluate(()=>{
    fixture.blocks=[{id:'current-block',name:'Term 4 · Monday crew',start_date:'2026-11-02',updated_at:'2026-11-01T00:00:00Z'},
      {id:'future-block',name:'Next term',start_date:'2027-01-11',updated_at:'2026-11-01T00:00:00Z'}];
    fixture.sessions.forEach((row,index)=>Object.assign(row,{block_id:'current-block',park_fee_cents:[1500,1000,2000][index],park_fee_basis:'per_rider'}));
    fixture.sessions.push({id:'standalone',session_date:'2026-11-07',venue:'Beenleigh',rider_ids:['rider-a'],park_fee_cents:500,updated_at:'2026-11-01T00:00:00Z'});
  });
  await page.evaluate(()=>attach());
  eq((await calls(page,'load')).length,2,'Context load automatically selects the current block');
  eq(await page.locator('[data-filter="block"]').inputValue(),'current-block','Current block is preferred to a later block');
  eq(await page.locator('[data-week]').count(),10,'Every week from 1 to 10 is shown');
  eq(await page.locator('.st-week-group').count(),3,'Weeks are separated into three groups');
  eq(await page.locator('.st-group-header h2').allTextContents(),['Weeks 1–4','Weeks 5–8','Weeks 9–10'],'Week groups match the requested ranges');
  eq(await page.locator('.st-week:has(.st-invoice)').evaluateAll(nodes=>nodes.map(node=>Number(node.dataset.week))),[1,4,8],'Invoice reminders are on exactly weeks 1, 4 and 8');
  eq(await page.locator('[data-block-total]').innerText(),'$60.00','Block park fees multiply fee by unique rider count');
  eq(await page.locator('[data-session-id="standalone"]').count(),0,'Standalone sessions are not silently attached to a block');
  eq(await page.locator('[data-session-id="saved-upcoming"] > summary .st-inline-riders').isVisible(),true,'Rider names appear beside the location without expanding a row');
  eq(await page.locator('[data-session-id="saved-upcoming"] > summary .st-inline-riders').innerText(),`Alex Example, Morgan <img src=x onerror="window.injected=true"> & O'Brien`,'Compact rows keep names escaped and visible');
  eq((await calls(page,'load')).at(-1).args.to,'2027-01-11','Ten-week range crosses year boundaries correctly');
  const beforeFilter=(await calls(page,'load')).length;
  await page.locator('[data-filter="venue"]').selectOption('Pizzey Skate Park');
  eq((await calls(page,'load')).length,beforeFilter,'Block filters do not refetch or truncate the block');
  eq(await page.locator('[data-session-id]').count(),1,'Block location filter narrows the rows');
  eq(await page.locator('[data-block-total]').innerText(),'$60.00','Block total stays complete while filtering');
  ok((await page.locator('.st-group-header').first().innerText()).includes('Matching sessions'),'Filtered subtotals explicitly describe matching sessions');
  await page.locator('[data-filter="venue"]').selectOption('');

  await page.locator('[data-action="add-day"][data-date="2026-11-03"]').click();
  eq(await field(page,'session-date').inputValue(),'2026-11-03','Tuesday add action preselects the correct date');
  eq(await field(page,'block-id').inputValue(),'current-block','A new slot is attached to the selected block');
  eq(await field(page,'park-fee').inputValue(),'','Park entry fee is optional');
  await field(page,'venue').selectOption('Pizzey Skate Park');
  await chooseRiders(page,['rider-a','rider-b']);
  await field(page,'park-fee').fill('15.50');
  eq(await page.locator('[data-fee-total] strong').innerText(),'$31.00','Park fee total updates immediately for two riders');
  await chooseRiders(page,['rider-c']);
  eq(await page.locator('[data-fee-total] strong').innerText(),'$46.50','Adding a rider immediately recalculates park fees');
  await page.locator('input[name="rider"][value="rider-c"]').uncheck();
  await field(page,'session-date').fill('2027-01-11');
  await action(page,'save-session').click();
  eq((await calls(page,'save')).length,0,'A session outside the block cannot be saved');
  ok((await page.locator('.st-form-error').innerText()).includes('within this 10-week block'),'Out-of-block date has a recovery instruction');
  await field(page,'session-date').fill('2026-11-03');
  await page.evaluate(()=>{qa.failure.save='Offline';});
  await action(page,'save-session').click();
  await page.waitForFunction(()=>document.querySelector('.st-form-error').textContent.includes('couldn’t confirm'));
  eq(await field(page,'park-fee').inputValue(),'15.50','A failed save preserves the fee input');
  eq(await field(page,'block-id').inputValue(),'current-block','A failed save preserves the selected block');
  const feeId=(await calls(page,'save')).at(-1).args.id;
  await page.evaluate(()=>{delete qa.failure.save;});
  await action(page,'save-session').click();await saveFinished(page);await settle(page);
  eq((await calls(page,'save')).at(-1).args.park_fee_cents,1550,'Fee saves as integer cents');
  eq((await calls(page,'save')).at(-1).args.park_fee_basis,'per_rider','Fee saves as a per-rider amount');
  eq((await calls(page,'save')).at(-1).args.id,feeId,'Failed fee save retries the same session');
  eq(await page.locator('[data-block-total]').innerText(),'$91.00','Saved fee contributes once to the full block total');
  await edit(page,feeId);
  eq(await field(page,'park-fee').inputValue(),'15.50','Editing restores the exact saved fee');
  await field(page,'park-fee').fill('');
  eq(await page.locator('[data-fee-total] strong').innerText(),'$0.00','Clearing the fee shows zero without NaN');
  await action(page,'save-session').click();await saveFinished(page);await settle(page);
  eq(await page.locator('[data-block-total]').innerText(),'$60.00','A park fee can be cleared');

  await action(page,'new-block').click();
  await field(page,'block-name').fill('Summer training');
  await field(page,'block-start').fill('2026-11-10');
  await action(page,'save-block').click();
  eq((await calls(page,'saveBlock')).length,0,'Block start must be a Monday');
  ok((await page.locator('.st-form-error').innerText()).includes('Monday'),'Monday requirement is explained');
  await field(page,'block-start').fill('2026-11-09');
  eq(await page.evaluate(()=>sessionTrackerHandle.hasUnsavedChanges()),true,'Unsaved block details protect navigation and updates');
  await page.evaluate(()=>{qa.failAfterBlockSave=true;});
  await action(page,'save-block').click();
  await page.waitForFunction(()=>document.querySelector('.st-form-error').textContent.includes('block save'));
  eq(await field(page,'block-name').inputValue(),'Summer training','A lost block response preserves the name');
  const blockId=(await calls(page,'saveBlock')).at(-1).args.id;
  await page.evaluate(()=>{qa.hold.saveBlock=true;});
  await doubleClickImmediately(action(page,'save-block'));
  await page.waitForFunction(()=>!!qa.releases.saveBlock);
  eq((await calls(page,'saveBlock')).length,2,'Double block save taps are locked');
  await release(page,'saveBlock');await saveFinished(page);await settle(page);
  eq(await page.evaluate(id=>fixture.blocks.filter(row=>row.id===id).length,blockId),1,'Lost block response retry does not create another block');
  eq(await page.locator('[data-filter="block"]').inputValue(),blockId,'Newly saved block becomes selected');
  eq(await page.locator('[data-week]').count(),10,'An empty new block still shows ten weeks');
  eq(await page.locator('.st-day-slot').count(),30,'Monday, Tuesday and Wednesday slots are available without storing fake sessions');
  eq(await page.locator('[data-block-total]').innerText(),'$0.00','A confirmed empty block shows a true zero total');
  eq(await page.evaluate(()=>fixture.sessions.filter(row=>row.block_id===fixture.blocks.at(-1).id).length),0,'Empty placeholders do not create database records');
  await action(page,'edit-block').click();
  await field(page,'block-name').fill('Summer training updated');
  await page.evaluate(()=>{qa.failure.saveBlock='stale block changed elsewhere';});
  await action(page,'save-block').click();
  await page.waitForFunction(()=>document.querySelector('.st-form-error').textContent.includes('changed elsewhere'));
  eq(await field(page,'block-name').inputValue(),'Summer training updated','Block conflict retains the name draft');
  await page.evaluate(()=>{delete qa.failure.saveBlock;});
  await action(page,'cancel-session').first().click();

  await page.locator('[data-filter="block"]').selectOption('current-block');await settle(page);
  await page.evaluate(()=>{qa.failure.load='Offline';});
  await page.locator('[data-filter="block"]').selectOption('future-block');await settle(page);
  eq(await page.locator('[data-block-total]').innerText(),'—','A block which failed to load does not claim zero fees');
  eq(await page.locator('[data-session-id]').count(),0,'Failed block switch never shows another block’s sessions');
  eq(await page.locator('.st-week-total').allTextContents(),Array(10).fill('—'),'All week totals remain unknown after failed first load');
  await page.evaluate(()=>{delete qa.failure.load;});
  await page.getByRole('button',{name:'Try again',exact:true}).click();await settle(page);
  eq(await page.locator('[data-block-total]').innerText(),'$0.00','Successful retry confirms the empty total');
  await page.locator('[data-filter="block"]').selectOption('current-block');await settle(page);
  await page.evaluate(()=>{qa.failure.load='Offline';});
  await action(page,'refresh').first().click();await settle(page);
  eq(await page.locator('[data-block-total]').innerText(),'$60.00','Failed same-block refresh keeps the last confirmed total');
  ok((await page.locator('.st-error').innerText()).includes('last loaded'),'Stale totals after failed refresh are labelled');
  await page.evaluate(()=>{delete qa.failure.load;});
  await page.getByRole('button',{name:'Try again',exact:true}).click();await settle(page);

  // A confirmed move followed by an offline reload cannot show the former block’s data.
  await edit(page,feeId);
  await field(page,'block-id').selectOption('future-block');
  await field(page,'session-date').fill('2027-01-12');
  await page.evaluate(()=>{qa.failure.load='Offline after confirmed save';});
  await action(page,'save-session').click();await saveFinished(page);await settle(page);
  eq(await page.locator('[data-filter="block"]').inputValue(),'future-block','Moving a session follows its saved block');
  eq(await page.locator('[data-block-total]').innerText(),'—','A failed reload after moving does not show another block’s total');
  eq(await page.locator('[data-session-id]').count(),0,'Moving followed by offline reload clears the old dataset');
  await page.evaluate(()=>{delete qa.failure.load;});
  await page.getByRole('button',{name:'Try again',exact:true}).click();await settle(page);
  eq(await page.locator('[data-session-id]').count(),1,'Retry loads only the session now saved in the destination block');
  await edit(page,feeId);await field(page,'block-id').selectOption('current-block');await field(page,'session-date').fill('2026-11-03');
  await action(page,'save-session').click();await saveFinished(page);await settle(page);

  await action(page,'edit-block').click();await field(page,'block-name').fill('Term 4 renamed');
  await page.evaluate(()=>{qa.failure.load='Offline after confirmed block save';});
  await action(page,'save-block').click();await saveFinished(page);await settle(page);
  eq(await page.locator('[data-block-total]').innerText(),'—','Renaming then failed reload cannot report a false zero for a nonempty block');
  await page.locator('[data-filter="block"]').selectOption('future-block');await settle(page);
  await page.locator('[data-filter="block"]').selectOption('current-block');await settle(page);
  eq(await page.locator('[data-block-total]').innerText(),'—','Returning to a previously loaded block after failed switches does not reuse invalid readiness');
  await page.evaluate(()=>{delete qa.failure.load;});
  await page.getByRole('button',{name:'Try again',exact:true}).click();await settle(page);
  eq(await page.locator('[data-block-total]').innerText(),'$60.00','Reload restores the real total after a block rename');

  // Extra days, beyond-30 records, archive/undo, and compact layouts.
  await page.locator('[data-week="2"] .st-extra [data-action="add-day"]').click();
  await field(page,'session-date').fill('2026-11-13');
  await field(page,'venue').selectOption('Beenleigh');await chooseRiders(page,['rider-a']);
  await field(page,'park-fee').fill('0.10');
  await action(page,'save-session').click();await saveFinished(page);await settle(page);
  const extraId=(await calls(page,'save')).at(-1).args.id;
  eq(await page.locator(`[data-week="2"] [data-session-id="${extraId}"]`).count(),1,'A Friday extra session appears in the correct week');
  eq(await page.locator('[data-block-total]').innerText(),'$60.10','Decimal park fee totals remain exact');
  await edit(page,extraId);await action(page,'archive-session').click();await saveFinished(page);await settle(page);
  eq(await page.locator('[data-block-total]').innerText(),'$60.00','Archived sessions are excluded from the fees');
  await action(page,'undo-archive').click();await settle(page);
  await page.waitForFunction(()=>document.querySelector('[data-block-total]').textContent==='$60.10');
  eq(await page.locator('[data-block-total]').innerText(),'$60.10','Undo restores the saved fee exactly once');
  for(const theme of ['dark','light'])for(const width of [320,390,1024]){
    await page.setViewportSize({width,height:844});
    await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
    await dimensions(page,`${theme} blocks at ${width}px`);
    if(screenshotDir)await page.screenshot({path:path.join(screenshotDir,`session-blocks-${theme}-${width}.png`),fullPage:true,animations:'disabled'});
  }
  await page.locator('[data-filter="block"]').selectOption('');await settle(page);
  eq(await page.locator('[data-session-id="standalone"]').count(),1,'All sessions preserves earlier standalone records');
  await page.evaluate(()=>{
    fixture.sessions=Array.from({length:41},(_,index)=>({id:`many-${index}`,block_id:'current-block',session_date:index<20?'2026-11-02':'2026-12-28',venue:'Beenleigh',rider_ids:['rider-a'],park_fee_cents:100,park_fee_basis:'per_rider'}));
  });
  await page.locator('[data-filter="block"]').selectOption('current-block');await settle(page);
  eq(await page.locator('[data-session-id]').count(),41,'Full block loads more than thirty sessions');
  eq(await page.locator('[data-block-total]').innerText(),'$41.00','Block total includes every loaded session across months');
  eq(await action(page,'load-more').count(),0,'Block total is not hidden behind month pagination');
  eq(errors,[],'Block planning and fee flows have no browser errors');
  await page.close();
  const recovery=await setup();
  await recovery.page.evaluate(async()=>{
    fixture.blocks=[{id:'failed-initial-block',name:'Current block',start_date:'2026-11-02'}];
    const original=options.load;
    await attach({load:args=>args.blockId?Promise.reject(Error('Block unavailable')):original(args)});
  });
  eq(await recovery.page.locator('[data-filter="block"]').isEnabled(),true,'A failed initial block load still permits switching to All sessions');
  eq(await recovery.page.locator('[data-block-total]').innerText(),'—','Failed automatic block load never claims zero');
  await recovery.page.locator('[data-filter="block"]').selectOption('');await settle(recovery.page);
  eq(await recovery.page.locator('[data-session-id]').count(),3,'All sessions recovers even when the default block cannot load');
  eq(recovery.errors,[],'Initial block failure recovery has no unhandled errors');
  await recovery.page.close();
}

async function parentCostsAndInvoices(){
  const {page,errors}=await setup();
  await page.evaluate(()=>{
    fixture.blocks=[{id:'current-block',name:'Term 4',start_date:'2026-11-02',updated_at:'2026-11-01T00:00:00Z'},
      {id:'future-block',name:'Next term',start_date:'2027-01-11',updated_at:'2026-11-01T00:00:00Z'}];
    fixture.sessions.forEach(row=>{row.block_id='current-block';});
  });
  await page.evaluate(()=>attach());
  await edit(page,'saved-past');
  await page.locator('.st-parent-costs > summary').click();
  eq(await field(page,'session-kind').inputValue(),'regular','Existing sessions default to regular');
  eq(await field(page,'session-completed').isChecked(),false,'Past dates are never automatically marked complete');
  eq(await field(page,'park-fee-paid').isChecked(),false,'Existing sessions never assume the coach paid entry');
  eq(await field(page,'park-fee-paid').isDisabled(),true,'No entry fee cannot be marked paid');
  eq(await field(page,'invoice-status').inputValue(),'expected','Default invoice status is expected, not invoiced');
  eq(await field(page,'invoice-date').inputValue(),'','Existing unknown invoice dates remain TBC');
  eq(await page.locator('[data-extra-fee-fields]').isVisible(),false,'Regular sessions do not ask for an extra coaching fee');
  eq(await page.evaluate(()=>sessionTrackerHandle.hasUnsavedChanges()),false,'Opening parent details alone does not dirty an existing record');
  await field(page,'session-completed').check();
  eq(await page.evaluate(()=>sessionTrackerHandle.hasUnsavedChanges()),true,'Completion changes protect the draft');
  await field(page,'park-fee').fill('12.50');
  eq(await field(page,'park-fee-paid').isEnabled(),true,'A positive park fee enables the coach-paid flag');
  await field(page,'park-fee-paid').check();
  await field(page,'park-fee').fill('0');
  eq(await field(page,'park-fee-paid').isChecked(),false,'Removing the park fee clears the coach-paid flag');
  eq(await field(page,'park-fee-paid').isDisabled(),true,'Zero entry fee disables the payment flag');
  await field(page,'park-fee').fill('12.50');
  eq(await field(page,'park-fee-paid').isChecked(),false,'Restoring a fee does not assume it was paid');
  await field(page,'park-fee-paid').check();
  await field(page,'invoice-date').fill('2026-11-03');
  await field(page,'invoice-status').selectOption('invoiced');
  eq(await page.locator('[data-invoice-date-label]').innerText(),'Invoice date','Already invoiced uses the invoice-date label');
  await page.evaluate(()=>{qa.failure.save='Offline';});
  await action(page,'save-session').click();
  await page.waitForFunction(()=>document.querySelector('.st-form-error').textContent.includes('couldn’t confirm'));
  eq(await field(page,'session-completed').isChecked(),true,'Failed save retains completion');
  eq(await field(page,'park-fee-paid').isChecked(),true,'Failed save retains coach-paid choice');
  eq(await field(page,'invoice-status').inputValue(),'invoiced','Failed save retains invoice status');
  eq(await field(page,'invoice-date').inputValue(),'2026-11-03','Failed save retains invoice date');
  await page.evaluate(()=>{delete qa.failure.save;});
  await action(page,'save-session').click();await saveFinished(page);await settle(page);
  let saved=(await calls(page,'save')).at(-1).args;
  eq(saved.session_completed,true,'Explicit session completion is persisted');
  eq(saved.park_fee_paid_by_coach,true,'Explicit coach-paid park entry is persisted');
  eq(saved.invoice_status,'invoiced','Already invoiced state is persisted');
  eq(saved.invoice_date,'2026-11-03','Invoice date is persisted exactly');
  eq(saved.extra_fee_cents,null,'Regular sessions have no extra coaching charge');
  const status=await page.locator('[data-session-id="saved-past"] .st-session-details').innerText();
  ok(status.includes('Completed')&&status.includes('paid by coach')&&status.includes('Already invoiced'),'Expanded record exposes completion, coach payment and invoice status');

  await edit(page,'saved-past');await page.locator('.st-parent-costs > summary').click();
  await field(page,'invoice-status').selectOption('paid');
  eq(await page.locator('[data-invoice-date-label]').innerText(),'Invoice date (optional)','Paid records do not require an invoice date');
  await field(page,'invoice-date').fill('');
  eq(await page.evaluate(()=>sessionTrackerHandle.hasUnsavedChanges()),true,'Paid changes are protected as an unsaved draft');
  await page.evaluate(()=>{qa.failure.save='Offline';});
  await action(page,'save-session').click();
  await page.waitForFunction(()=>document.querySelector('.st-form-error').textContent.includes('couldn’t confirm'));
  eq(await field(page,'invoice-status').inputValue(),'paid','Failed save retains the explicit Paid choice');
  eq(await field(page,'invoice-date').inputValue(),'','Failed paid save retains the manually cleared date');
  await page.evaluate(()=>{delete qa.failure.save;});
  await action(page,'save-session').click();await saveFinished(page);await settle(page);
  eq((await calls(page,'save')).at(-1).args.invoice_status,'paid','Paid billing status is saved explicitly');
  eq((await calls(page,'save')).at(-1).args.invoice_date,null,'Paid does not invent an invoice date');
  ok((await page.locator('[data-session-id="saved-past"] .st-session-details').innerText()).includes('Paid recorded'),'Paid records are labelled Paid recorded rather than expected invoice');
  await edit(page,'saved-past');await page.locator('.st-parent-costs > summary').click();
  eq(await field(page,'invoice-status').inputValue(),'paid','Paid status survives reopening the editor');
  ok((await page.locator('.st-parent-costs').innerText()).includes('every rider selected'),'Shared billing status clearly applies to all selected riders');
  await action(page,'cancel-session').first().click();

  await page.locator('[data-week="2"] .st-extra [data-action="add-day"]').click();
  eq(await field(page,'session-kind').inputValue(),'additional','Extra-session shortcut selects Additional');
  eq(await page.locator('.st-parent-costs').evaluate(node=>node.open),true,'Extra-session costs are opened for quick entry');
  eq(await field(page,'session-completed').isChecked(),false,'An extra session starts uncompleted');
  eq(await field(page,'extra-fee').inputValue(),'','Unknown extra coaching prices start blank');
  eq(await page.locator('[data-extra-fee-total]').innerText(),'Extra coaching total: price TBC','Blank extra fee is shown as unknown, not zero');
  await field(page,'venue').selectOption('Beenleigh');await chooseRiders(page,['rider-a','rider-b']);
  await field(page,'invoice-status').selectOption('paid');
  const beforeUnknownPaid=(await calls(page,'save')).length;
  await action(page,'save-session').click();
  eq((await calls(page,'save')).length,beforeUnknownPaid,'An unknown additional coaching fee cannot be recorded as Paid');
  ok((await page.locator('.st-form-error').innerText()).includes('Confirm the extra coaching price'),'Unknown paid fee explains how to recover');
  eq(await field(page,'extra-fee').inputValue(),'','Unknown paid validation preserves the price input as TBC');
  await field(page,'invoice-status').selectOption('expected');
  eq(await field(page,'invoice-date').inputValue(),'','New additional sessions leave the invoice date for the coach to choose');
  await field(page,'session-date').fill('2026-11-02');
  eq(await field(page,'invoice-date').inputValue(),'','Invoice-week Monday does not automatically set an invoice date');
  await field(page,'session-date').fill('2026-11-03');
  eq(await field(page,'invoice-date').inputValue(),'','Changing the session date never automatically selects week 4');
  await field(page,'session-date').fill('2026-12-01');
  eq(await field(page,'invoice-date').inputValue(),'','Changing the session date never automatically selects week 8');
  await field(page,'session-date').fill('2026-12-28');
  eq(await field(page,'invoice-date').inputValue(),'','Week 9 leaves the next invoice date TBC');
  await field(page,'session-date').fill('2027-01-04');
  eq(await field(page,'invoice-date').inputValue(),'','Week 10 leaves the next invoice date TBC');
  await field(page,'session-date').fill('2026-11-09');
  await field(page,'invoice-date').fill('2026-11-30');
  await field(page,'session-date').fill('2026-12-02');
  eq(await field(page,'invoice-date').inputValue(),'2026-11-30','A manually chosen invoice date survives a session-date edit');
  await field(page,'block-id').selectOption('future-block');
  eq(await field(page,'invoice-date').inputValue(),'2026-11-30','A manual invoice date survives block changes');
  await field(page,'invoice-date').fill('');
  await field(page,'block-id').selectOption('current-block');
  await field(page,'session-date').fill('2026-11-10');
  eq(await field(page,'invoice-date').inputValue(),'','Manually clearing invoice date preserves TBC through further edits');
  await field(page,'venue').selectOption('Beenleigh');await chooseRiders(page,['rider-a','rider-b']);
  await field(page,'extra-fee').fill('35.50');
  eq(await page.locator('[data-extra-fee-total]').innerText(),'$35.50 × 2 riders = $71.00','Extra coaching fee total multiplies the per-rider price');
  await field(page,'park-fee').fill('15');
  await field(page,'park-fee-paid').check();
  await field(page,'session-completed').check();
  await page.evaluate(()=>{qa.failAfterSave=true;});
  await action(page,'save-session').click();
  await page.waitForFunction(()=>document.querySelector('.st-form-error').textContent.includes('couldn’t confirm'));
  eq(await field(page,'extra-fee').inputValue(),'35.50','Lost save response retains additional-session price');
  const extraId=(await calls(page,'save')).at(-1).args.id;
  await action(page,'save-session').click();await saveFinished(page);await settle(page);
  saved=(await calls(page,'save')).at(-1).args;
  eq(saved.id,extraId,'Additional-session retry uses the same stable id');
  eq(saved.extra_fee_cents,3550,'Additional price persists as integer cents');
  eq(saved.invoice_date,null,'Manually chosen TBC saves as null');
  eq(saved.invoice_status,'expected','Entering costs and completion never marks an invoice sent');
  eq(await page.evaluate(id=>fixture.sessions.filter(row=>row.id===id).length,extraId),1,'Extra-session lost-response retry creates no duplicate');
  await edit(page,extraId);
  eq(await field(page,'extra-fee').inputValue(),'35.50','Extra coaching fee survives reopening');
  eq(await field(page,'session-completed').isChecked(),true,'Explicit completion survives reopening');
  eq(await field(page,'park-fee-paid').isChecked(),true,'Explicit coach payment survives reopening');
  await field(page,'session-kind').selectOption('regular');
  eq(await field(page,'extra-fee').isDisabled(),true,'Hidden additional fee cannot block or leak into regular-session save');
  await action(page,'save-session').click();await saveFinished(page);await settle(page);
  eq((await calls(page,'save')).at(-1).args.extra_fee_cents,null,'Converting to a regular session removes the extra coaching fee');
  await edit(page,extraId);await page.locator('.st-parent-costs > summary').click();
  await field(page,'session-kind').selectOption('additional');
  await field(page,'extra-fee').fill('0');await field(page,'invoice-status').selectOption('paid');await action(page,'save-session').click();await saveFinished(page);await settle(page);
  eq((await calls(page,'save')).at(-1).args.extra_fee_cents,0,'An explicitly free additional session differs from price TBC');
  eq((await calls(page,'save')).at(-1).args.invoice_status,'paid','A known zero coaching fee may be recorded Paid');
  await edit(page,extraId);await field(page,'extra-fee').fill('');await field(page,'invoice-status').selectOption('expected');
  await action(page,'save-session').click();await saveFinished(page);await settle(page);
  eq((await calls(page,'save')).at(-1).args.extra_fee_cents,null,'Clearing additional fee returns it to price TBC');

  await page.locator('[data-filter="block"]').selectOption('');await settle(page);
  await validDraft(page);await page.locator('.st-parent-costs > summary').click();
  eq(await field(page,'invoice-date').inputValue(),'','Standalone sessions never invent an invoice date');
  await field(page,'block-id').selectOption('current-block');
  eq(await field(page,'invoice-date').inputValue(),'','Assigning a new regular session to a block does not choose its invoice date');
  await field(page,'session-kind').selectOption('additional');await field(page,'extra-fee').fill('45');
  await field(page,'park-fee').fill('15');await field(page,'park-fee-paid').check();
  for(const theme of ['dark','light'])for(const width of [320,390,1024]){
    await page.setViewportSize({width,height:844});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    await dimensions(page,`${theme} parent costs editor at ${width}px`);
    const targets=await page.locator('dialog .st-check-label:visible, dialog .st-parent-costs>summary:visible').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().height));
    ok(targets.every(height=>height>=44),`${theme} parent cost controls at ${width}px remain touch-sized`);
    if(screenshotDir)await page.screenshot({path:path.join(screenshotDir,`session-parent-costs-${theme}-${width}.png`),animations:'disabled'});
  }
  await action(page,'cancel-session').first().click();
  eq(errors,[],'Parent cost editing has no browser errors');await page.close();
}

async function paginationAndIsolation() {
  const { page, errors } = await setup();
  await page.evaluate(() => {
    fixture.sessions = Array.from({ length: 35 }, (_, index) => ({ id: `page-${index}`, source: 'tracker', session_date: '2026-11-08', start_time: null, venue: 'Pizzey Skate Park', rider_ids: ['rider-a'], updated_at: '2026-11-04T00:00:00Z' }));
    fixture.sessions.push({ id: 'next-month', source: 'tracker', session_date: '2026-12-01', venue: 'Beenleigh', rider_ids: ['rider-a'] });
  });
  await page.evaluate(() => attach());
  eq(await page.locator('[data-session-id]').count(), 30, 'The first page contains 30 records');
  eq(await page.locator('[data-session-id="next-month"]').count(), 0, 'Exclusive month end excludes the next month');
  await page.evaluate(() => { qa.failure.load = 'Synthetic page failure'; });
  await action(page, 'load-more').click(); await settle(page);
  eq(await page.locator('[data-session-id]').count(), 30, 'Failed pagination preserves the first page');
  await page.evaluate(() => { delete qa.failure.load; qa.hold.load = true; });
  await doubleClickImmediately(action(page, 'load-more'));
  await page.waitForFunction(() => !!qa.releases.load);
  eq((await calls(page, 'load')).length, 3, 'Two load-more taps produce one request');
  await release(page, 'load'); await settle(page);
  eq((await calls(page, 'load')).at(-1).args.offset, 30, 'Pagination retry uses the failed page offset');
  eq(await page.locator('[data-session-id]').count(), 35, 'Explicit load more adds the next five records');
  eq(await page.locator('[data-action="load-more"]').count(), 0, 'Load more ends when the server has no next page');
  eq(await page.locator('[data-session-id]').evaluateAll(nodes => new Set(nodes.map(node => node.dataset.sessionId)).size), 35, 'Pagination does not duplicate rows');
  await page.locator('[data-filter="rider"]').selectOption('rider-a'); await settle(page);
  eq((await calls(page, 'load')).at(-1).args.offset, 0, 'Changing filters resets pagination');
  eq(await page.locator('[data-session-id]').count(), 30, 'Changing filters starts a fresh list');

  // Role checks are enforced before loading private coaching data.
  for (const role of ['athlete', 'parent']) {
    const before = (await calls(page, 'load')).length;
    await page.evaluate(role => attach({ role }), role);
    eq((await calls(page, 'load')).length, before, `${role} does not request private sessions`);
    eq(await action(page, 'new-session').count(), 0, `${role} does not receive editing controls`);
    ok((await page.locator('#view').innerText()).includes('Coach access required'), `${role} is given a clear access message`);
  }
  await page.evaluate(() => { qa.active = false; });
  const inactiveBefore = (await calls(page, 'load')).length;
  await page.evaluate(() => attach());
  eq((await calls(page, 'load')).length, inactiveBefore, 'Inactive route does not load private data');
  await page.evaluate(() => { qa.active = true; qa.hold.load = true; void attach(); });
  await page.waitForFunction(() => !!qa.releases.load);
  await page.evaluate(() => { sessionTrackerHandle.destroy(); document.querySelector('#view').textContent = 'A different account screen'; });
  eq(await page.locator('#view').evaluate(node => node.classList.contains('session-tracker')), false, 'Destroy removes its scoped style class from the reused view');
  await release(page, 'load');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  eq(await page.locator('#view').innerText(), 'A different account screen', 'A load finishing after destroy cannot overwrite the next account screen');
  await page.evaluate(() => attach());
  await validDraft(page);
  await page.evaluate(() => { qa.hold.save = true; });
  await action(page, 'save-session').click();
  await page.waitForFunction(() => !!qa.releases.save);
  const loadsBeforeSave = (await calls(page, 'load')).length;
  await page.evaluate(() => { qa.active = false; sessionTrackerHandle.destroy(); document.querySelector('#view').textContent = 'Signed out'; });
  await release(page, 'save');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  eq(await page.locator('#view').innerText(), 'Signed out', 'Late save results cannot render after navigation or sign-out');
  eq((await calls(page, 'load')).length, loadsBeforeSave, 'Late save does not reload the previous account');
  eq(errors, [], 'Role, pagination and navigation checks have no unhandled browser errors');
  await page.close();

  const recovery = await setup();
  await recovery.page.evaluate(() => { qa.failure.load = 'Synthetic first-load failure'; });
  await recovery.page.evaluate(() => attach());
  eq(await action(recovery.page, 'new-session').isDisabled(), true, 'Failed initial load cannot open an empty roster editor');
  await recovery.page.evaluate(() => { delete qa.failure.load; });
  await recovery.page.getByRole('button', { name: 'Try again', exact: true }).click(); await settle(recovery.page);
  eq(await action(recovery.page, 'new-session').isEnabled(), true, 'Initial-load retry restores session creation');
  eq(await recovery.page.locator('[data-session-id]').count(), 3, 'Initial-load retry restores saved sessions');
  eq(recovery.errors, [], 'First-load recovery has no unhandled browser errors');
  await recovery.page.evaluate(() => { qa.failure.load = { message: 'Permission removed', code: '42501' }; });
  await action(recovery.page, 'refresh').first().click(); await settle(recovery.page);
  eq(await recovery.page.locator('[data-session-id]').count(), 0, 'Revoked access clears private session rows');
  eq(await action(recovery.page, 'new-session').isDisabled(), true, 'Revoked access cannot edit cached private riders');
  await recovery.page.close();
}
run().catch(error => { console.error(error); process.exitCode = 1; });
