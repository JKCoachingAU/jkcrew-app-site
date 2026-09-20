// Real Tier 2 editor + actual app save handlers; synthetic browser RPCs only.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..'), app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const extract = (start, end) => { const a = app.indexOf(start), b = app.indexOf(end, a); assert(a >= 0 && b > a, start); return app.slice(a, b); };
const handlers = [
  extract('async function saveDailyTierTwoDraft(', '\nfunction dailyTierTwoHost('),
  extract('async function saveWeeklyAssignments(', '\nasync function saveDailyVenueFromStudentProfile('),
  extract('async function saveDailyVenueFromStudentProfile(', '\nasync function saveCategoryListFromStudentProfile('),
  extract('async function saveSessionViewerAssignments(', '\nasync function toggleViewerGoal('),
].join('\n');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  let checks = 0;
  const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
  const ok = (value, label) => { assert(value, label); checks++; };
  async function fixture({ initial = null, deferGet = false, timeoutMs = 500 } = {}) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = [];
    page.on('pageerror', error => errors.push(error.message)); await page.route('**/*', route => route.abort());
    await page.setContent(`<main id="view"><form id="assignment-form"><textarea name="dailyVenueTricks:0">Barspin</textarea><button id="save-week" type="submit">Save full schedule</button><div id="editor" data-tier-two-editor-host="rider-a"></div></form><div data-venue-panel="0"><input name="dailyVenueName:0" value="Park"><textarea name="dailyVenueTricks:0">Barspin</textarea><button id="save-venue" type="button" data-save-daily-venue="0" data-original-venue="Park">Save Daily</button></div><form id="viewer-form" data-athlete-id="rider-a" data-viewer-assignment-editor="daily" data-venue="Park"><textarea name="assignmentLines">Barspin</textarea><button id="save-viewer" type="submit">Save Daily</button></form></main>`);
    await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'daily-tier-two.js'), 'utf8') });
    await page.evaluate(({ initial, deferGet, timeoutMs }) => {
      window.state = { user: { id: 'coach-a' }, profile: { role: 'coach' }, view: 'studentProfile', selectedAthleteId: 'rider-a', sessionViewerRosterCache: [{ id: 'rider-a', country_code: 'AU' }] };
      window.saved = initial; window.calls = []; window.messages = []; window.renders = 0;
      window.mode = { deferGet, deferSet: false, setError: false, getError: false, malformed: false, mismatch: false };
      window.templateResult = () => ({ items: saved, default_round: saved === null });
      window.client = { rpc: async (name, args) => {
        calls.push({ name, args: structuredClone(args) });
        if (name === 'get_daily_tier_two_template') {
          if (mode.deferGet) { mode.deferGet = false; const snapshot = structuredClone(templateResult()); return new Promise(resolve => { window.releaseGet = () => resolve({ data: snapshot, error: null }); }); }
          if (mode.getError) return { data: null, error: { message: 'Readback unavailable' } };
          if (mode.mismatch) return { data: { items: [{ trick_name: 'Wrong trick', notes: '' }], default_round: false }, error: null };
          return { data: templateResult(), error: null };
        }
        if (name === 'set_daily_tier_two_template') {
          if (mode.deferSet) await new Promise(resolve => { window.releaseSet = resolve; });
          if (mode.setError) return { data: null, error: { message: 'Template save failed' } };
          saved = args.p_items;
          return { data: mode.malformed ? {} : templateResult(), error: null };
        }
        return { data: null, error: null };
      } };
      window.isCoachRole = role => role === 'coach';
      window.weekStartDate = window.weekStartDateForCountry = () => '2026-09-14';
      window.categoryInfo = { daily: {}, one_bang: {} };
      window.categoryDisplayInfo = id => ({ label: id === 'daily' ? 'Daily Tricks' : 'One Bangs' });
      window.assignmentsFromScheduleForm = (_form, athleteId) => ({ dailyVenueRows: [{ name: 'Park' }], assignments: [{ athlete_id: athleteId, trick_name: 'Barspin', category: 'daily' }] });
      window.parseAssignmentLine = (line, index, category, venue) => line ? ({ trick_name: line, category, venue, sort_order: index }) : null;
      window.withTimeout = promise => promise; window.venueKey = value => value;
      window.messageFrom = error => error.message; window.clearCoachCaches = () => {};
      window.notify = (message, tone) => messages.push({ message, tone });
      window.renderStudentProfile = window.refreshSessionViewerLight = async () => { renders++; document.querySelectorAll('button').forEach(button => { button.disabled = false; }); };
      window.setButtonBusy = (button, label) => { const before = button.textContent; button.textContent = label; button.disabled = true; return () => { button.textContent = before; button.disabled = false; }; };
      window.editorOptions = { client, athleteId: 'rider-a', timeoutMs, isCurrent: () => state.user?.id === 'coach-a' && state.selectedAthleteId === 'rider-a' };
    }, { initial, deferGet, timeoutMs });
    await page.addScriptTag({ content: 'const dailyFeatureMounts = new Map();\n' + handlers + `
      window.editor = JKCrewDailyTierTwo.mountEditor(document.querySelector('#editor'), editorOptions);
      dailyFeatureMounts.set('coach-a:studentProfile:editor:rider-a',{host:document.querySelector('#editor'),handle:editor,userId:'coach-a',view:'studentProfile'});
      document.querySelector('#assignment-form').addEventListener('submit', event => { window.pendingMain = saveWeeklyAssignments(event); });
      document.querySelector('#save-venue').addEventListener('click', event => { window.pendingMain = saveDailyVenueFromStudentProfile(event); });
      document.querySelector('#viewer-form').addEventListener('submit', event => { window.pendingMain = saveSessionViewerAssignments(event); });
    ` });
    if (!deferGet) await page.evaluate(() => editor.ready);
    const draft = text => page.locator('[data-tier-two-template]').fill(text);
    const save = async selector => { await page.locator(selector).click(); await page.evaluate(() => pendingMain); };
    const setCalls = () => page.evaluate(() => calls.filter(call => call.name === 'set_daily_tier_two_template'));
    const close = async () => { eq(errors, [], 'No browser exceptions'); await page.close(); };
    return { page, draft, save, setCalls, close };
  }
  try {
    for (const button of ['#save-week', '#save-venue', '#save-viewer']) {
      const f = await fixture(); await f.draft('Manual | Keep it smooth\nBunny hop');
      ok((await f.page.locator('[data-tier-two-editor-status]').textContent()).includes('Unsaved changes'));
      eq(await f.page.evaluate(() => editor.isDirty()), true);
      await f.save(button);
      eq(await f.page.evaluate(() => saved), [{ trick_name: 'Manual', notes: 'Keep it smooth' }, { trick_name: 'Bunny hop', notes: '' }], button + ' persists the separate Tier 2 draft');
      eq((await f.setCalls()).length, 1); eq((await f.setCalls())[0].args.p_athlete_id, 'rider-a');
      eq(await f.page.evaluate(() => editor.isDirty()), false);
      ok((await f.page.evaluate(() => messages.at(-1).message)).includes('Tier 2'));
      eq(await f.page.evaluate(() => renders), 1);
      const names = await f.page.evaluate(() => calls.map(call => call.name));
      eq(names.slice(-3), ['set_daily_tier_two_template', 'get_daily_tier_two_template', button === '#save-week' ? 'save_weekly_assignments' : 'save_weekly_assignment_list'], 'Template is verified before list save reports success');
      await f.close();
    }
    {
      const f = await fixture({ initial: [{ trick_name: 'Manual', notes: '' }] });
      await f.save('#save-week'); eq((await f.setCalls()).length, 0, 'Unchanged template is not rewritten');
      await f.draft('  Manual  \n'); await f.save('#save-venue'); eq((await f.setCalls()).length, 0, 'Formatting-only edits do not rewrite template');
      await f.draft('Tailwhip'); await f.page.locator('[data-tier-two-template-action="save"]').click();
      await f.page.waitForFunction(() => saved?.[0]?.trick_name === 'Tailwhip' && !editor.isDirty());
      eq((await f.setCalls()).length, 1, 'Dedicated Save Tier 2 still persists');
      ok((await f.page.locator('[data-tier-two-editor-status]').textContent()).includes('Tier 2 saved.'));
      await f.close();
    }
    for (const failure of ['setError', 'getError', 'malformed', 'mismatch']) {
      const f = await fixture(); await f.draft('  Tailwhip | New challenge  ');
      await f.page.evaluate(failure => { mode[failure] = true; }, failure); await f.save('#save-week');
      eq(await f.page.locator('[data-tier-two-template]').inputValue(), '  Tailwhip | New challenge  ', failure + ' preserves exact draft');
      eq(await f.page.evaluate(() => editor.isDirty()), true);
      eq(await f.page.evaluate(() => calls.filter(call => call.name === 'save_weekly_assignments').length), 0, 'Failed template blocks full schedule success');
      eq(await f.page.evaluate(() => renders), 0); eq(await f.page.evaluate(() => messages.at(-1).tone), 'error');
      ok(await f.page.locator('#save-week').isEnabled());
      await f.page.evaluate(() => { mode.setError = false; mode.getError = false; mode.malformed = false; mode.mismatch = false; });
      await f.save('#save-week'); eq(await f.page.evaluate(() => editor.isDirty()), false, 'Retry verifies the preserved edit');
      await f.close();
    }
    {
      const f = await fixture({ initial: [{ trick_name: 'Manual', notes: '' }] }); await f.draft(''); await f.save('#save-venue');
      eq((await f.setCalls()).length, 0, 'Blank dirty text never silently clears a custom template'); eq(await f.page.evaluate(() => editor.isDirty()), true);
      ok((await f.page.locator('[data-tier-two-editor-status]').textContent()).includes('Use Daily list'));
      await f.page.locator('[data-tier-two-template-action="default"]').click(); await f.page.waitForFunction(() => saved === null && !editor.isDirty());
      eq((await f.setCalls())[0].args.p_items, null, 'Only explicit reset clears the custom template'); await f.close();
    }
    {
      const f = await fixture({ initial: [{ trick_name: 'Old saved trick', notes: '' }], deferGet: true });
      await f.draft('Freshly typed trick'); await f.page.evaluate(() => releaseGet()); await f.page.evaluate(() => editor.ready);
      eq(await f.page.locator('[data-tier-two-template]').inputValue(), 'Freshly typed trick', 'Stale initial read cannot replace typing');
      eq(await f.page.evaluate(() => editor.isDirty()), true); await f.save('#save-week'); eq(await f.page.evaluate(() => saved[0].trick_name), 'Freshly typed trick'); await f.close();
    }
    {
      const f = await fixture({ initial: [{ trick_name: 'Old saved trick', notes: '' }], deferGet: true });
      await f.draft('New verified trick'); await f.save('#save-week'); await f.page.evaluate(() => releaseGet()); await f.page.evaluate(() => editor.ready);
      eq(await f.page.locator('[data-tier-two-template]').inputValue(), 'New verified trick', 'Late GET cannot overwrite a completed save'); eq(await f.page.evaluate(() => editor.isDirty()), false); await f.close();
    }
    {
      const f = await fixture(); await f.draft('Concurrent save'); await f.page.evaluate(() => { mode.deferSet = true; });
      await f.page.locator('[data-tier-two-template-action="save"]').click(); await f.page.waitForFunction(() => !!window.releaseSet);
      await f.page.locator('#save-week').click(); eq((await f.setCalls()).length, 1, 'Main and dedicated save share the in-flight write');
      eq(await f.page.evaluate(() => calls.filter(call => call.name === 'save_weekly_assignments').length), 0);
      await f.page.evaluate(() => releaseSet()); await f.page.evaluate(() => pendingMain);
      eq((await f.setCalls()).length, 1); eq(await f.page.evaluate(() => renders), 1); await f.close();
    }
    {
      const f = await fixture(); await f.draft('Original rider only'); await f.page.evaluate(() => { mode.deferSet = true; });
      await f.page.locator('#save-venue').click(); await f.page.waitForFunction(() => !!window.releaseSet);
      await f.page.evaluate(() => { state.selectedAthleteId = 'rider-b'; releaseSet(); }); await f.page.evaluate(() => pendingMain);
      eq((await f.setCalls())[0].args.p_athlete_id, 'rider-a');
      eq(await f.page.evaluate(() => calls.filter(call => call.name === 'save_weekly_assignment_list').length), 0, 'Changing riders blocks subsequent list writes');
      eq(await f.page.evaluate(() => messages.length), 0, 'No stale success notification on the new rider'); eq(await f.page.evaluate(() => renders), 0); await f.close();
    }
    console.log('PASS: ' + checks + ' Tier 2 editor, main/list save, verified persistence, dirty validation, retry, stale reads and rider-context checks. No production traffic.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
