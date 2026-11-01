// Production planner handler and parsers; only transport and page refresh are fixtures.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const app = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
const extract = name => {
  const start = app.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert(start >= 0, `Production ${name} exists`);
  const remaining = app.slice(start);
  return remaining.slice(0, remaining.indexOf('\n}') + 2);
};
const categoryStart = app.indexOf('const categoryInfo = {');
const code = app.slice(categoryStart, app.indexOf('\n};', categoryStart) + 3) + '\n' + [
  'parseTrickLinkInput', 'parseAssignmentLine', 'dailyVenueRowsFromForm',
  'assignmentsFromScheduleForm', 'setButtonBusy', 'savePlannedWeeklyAssignments',
].map(extract).join('\n');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH });
  let checks = 0;
  const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
  const typedLinks = 'Barspin - Tailwhip\nX-UP | No-footer';
  async function fixture() {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.abort());
    await page.setContent('<main><form id="planner-form"><input name="dailyVenueName:0" value="Test park"><textarea name="dailyVenueTricks:0">Manual</textarea><textarea name="trick_links"></textarea><button id="draft" type="submit" data-plan-save-status="draft_next_week">Save draft</button><button id="schedule" type="submit" data-plan-save-status="scheduled_next_week">Schedule for next week</button></form></main>');
    await page.evaluate(() => {
      window.state = { user: { id: 'coach-a' }, view: 'planner', plannerAthleteId: 'rider-a' };
      window.weekStartDate = window.nextWeekStartDate = () => '2026-11-02';
      window.venueLabel = value => String(value || '');
      window.venueIdentityKey = value => String(value || '').trim().toLowerCase();
      window.messageFrom = error => error.message;
      window.withTimeout = promise => promise;
      window.calls = []; window.messages = []; window.caches = []; window.renders = 0;
      window.mode = { failure: '', hold: false };
      window.client = { rpc: async (name, args) => {
        calls.push({ name, args: structuredClone(args) });
        if (mode.hold) await new Promise(resolve => { window.release = resolve; });
        if (mode.failure === 'reject') throw Error('Connection interrupted');
        return mode.failure === 'response' ? { error: { message: 'Enter exactly two tricks in each link.' } } : { data: 3, error: null };
      } };
      window.notify = (message, tone) => messages.push({ message, tone });
      window.cacheClear = key => caches.push(key);
      window.renderPlanner = async () => { renders++; };
    });
    await page.addScriptTag({ content: code + '\ndocument.querySelector("#planner-form").addEventListener("submit", event => { window.pending = savePlannedWeeklyAssignments(event); });' });
    await page.locator('[name="trick_links"]').fill(typedLinks);
    return {
      page,
      save: async button => { await page.locator(button).click(); await page.evaluate(() => pending); },
      close: async () => { eq(errors, [], 'No unhandled browser errors'); await page.close(); },
    };
  }
  try {
    for (const button of ['#draft', '#schedule']) for (const failure of ['response', 'reject']) {
      const f = await fixture();
      await f.page.evaluate(failure => { mode.failure = failure; }, failure);
      await f.save(button);
      eq(await f.page.locator('[name="trick_links"]').inputValue(), typedLinks, 'Failure preserves all typed pairs and separators');
      eq(await f.page.locator('[name="dailyVenueTricks:0"]').inputValue(), 'Manual', 'Failure preserves the rest of the sheet');
      eq(await f.page.evaluate(() => renders), 0, 'Failed saves never replace the editor');
      eq(await f.page.evaluate(() => messages.at(-1).tone), 'error');
      eq(await f.page.locator('button:disabled, [aria-busy="true"]').count(), 0, 'Both actions recover from failure');
      eq(await f.page.locator('#planner-form').getAttribute('data-planner-saving'), null);
      await f.page.evaluate(() => { mode.failure = ''; });
      await f.save(button);
      eq(await f.page.evaluate(() => calls.at(-1).name), button === '#draft' ? 'save_weekly_assignment_draft' : 'save_weekly_assignment_plan');
      eq(await f.page.evaluate(() => calls.at(-1).args.p_assignments.filter(item => item.category === 'trick_links').map(item => item.trick_name)), ['Barspin → Tailwhip', 'X-UP → No-footer'], 'Retry sends canonical full pairs');
      eq(await f.page.evaluate(() => renders), 1, 'Only successful save refreshes');
      eq(await f.page.evaluate(() => caches), ['planner-template:rider-a:']);
      await f.close();
    }
    const duplicate = await fixture();
    await duplicate.page.evaluate(() => { mode.hold = true; });
    await duplicate.page.locator('#schedule').click();
    await duplicate.page.waitForFunction(() => Boolean(window.release));
    await duplicate.page.evaluate(() => {
      window.firstPending = pending;
      document.querySelector('form').dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: document.querySelector('#draft') }));
    });
    eq(await duplicate.page.evaluate(() => calls.length), 1, 'Switching between save actions cannot duplicate a pending request');
    eq(await duplicate.page.locator('button:disabled').count(), 2, 'Both actions are disabled during the request');
    await duplicate.page.evaluate(() => { mode.hold = false; release(); });
    await duplicate.page.evaluate(() => firstPending);
    eq(await duplicate.page.locator('button:disabled, [aria-busy="true"]').count(), 0);
    await duplicate.close();

    for (const changed of ['account', 'rider', 'view']) {
      const f = await fixture();
      await f.page.evaluate(() => { mode.hold = true; });
      await f.page.locator('#schedule').click();
      await f.page.waitForFunction(() => Boolean(window.release));
      await f.page.evaluate(changed => {
        if (changed === 'account') state.user = { id: 'coach-b' };
        if (changed === 'rider') state.plannerAthleteId = 'rider-b';
        if (changed === 'view') state.view = 'home';
        release();
      }, changed);
      await f.page.evaluate(() => pending);
      eq(await f.page.evaluate(() => calls[0].args.p_athlete_id), 'rider-a', 'Pending write keeps original rider');
      eq(await f.page.evaluate(() => ({ renders, messages, caches })), { renders: 0, messages: [], caches: [] }, `${changed} change ignores stale completion`);
      await f.close();
    }
    const parsing = await fixture();
    await parsing.page.evaluate(() => { window.assignmentsFromScheduleForm = () => { throw Error('Invalid pair'); }; });
    await parsing.save('#schedule');
    eq(await parsing.page.evaluate(() => calls.length), 0, 'Parser failure does not issue a write');
    eq(await parsing.page.locator('[name="trick_links"]').inputValue(), typedLinks);
    eq(await parsing.page.locator('button:disabled, [aria-busy="true"]').count(), 0, 'Parser failure also restores controls');
    await parsing.close();
    console.log(`PASS: ${checks} planner save recovery checks: draft/schedule validation and rejected requests, input-preserving retries, canonical pairs, duplicate submission protection, stale account/rider/view isolation, and parser recovery. No production calls.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
