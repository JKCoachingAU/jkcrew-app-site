// Production parent cost card with synthetic transport and linked-child context.
// No production data, credentials, invoices or notifications are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const screenshotDir = process.env.JKCREW_SCREENSHOT_DIR;
if (screenshotDir) fs.mkdirSync(screenshotDir, { recursive: true });
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const extract = name => {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert(start >= 0, `Production ${name} exists`);
  const rest = source.slice(start);
  return rest.slice(0, rest.indexOf('\n}') + 2);
};
let checks = 0;
const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
const ok = (actual, label) => { assert(actual, label); checks++; };

async function setup(browser) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url() === 'http://jkcrew.test/'
    ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><html data-theme="dark"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div class="app-shell parent-shell" style="display:block"><main id="view" class="content" data-view="home"><div id="costs"></div></main></div></body></html>' })
    : route.abort());
  await page.goto('http://jkcrew.test/');
  for (const file of ['styles.css', 'parent-session-costs.css']) await page.addStyleTag({ path: path.join(root, file) });
  await page.addScriptTag({ path: path.join(root, 'parent-session-costs.js') });
  await page.evaluate(() => {
    window.qa = { active: true, calls: [], failure: false, holdAt: null, release: null, pageSize: 2, responses: null };
    const base = { session_date: '2026-11-04', start_time: '16:00:00', venue: 'Pizzey Skate Park', block_name: 'Term 4', session_kind: 'regular', session_completed: false, park_fee_cents: 0, park_fee_allocation: 'per_rider', park_fee_paid_by_coach: false, extra_fee_cents: null, invoice_date: '2026-11-23', invoice_status: 'expected' };
    window.fixture = [
      { ...base, id: 'extra-done', session_kind: 'additional', session_completed: true, extra_fee_cents: 4000, park_fee_cents: 1200, park_fee_paid_by_coach: true },
      { ...base, id: 'extra-planned', session_date: '2026-11-10', session_kind: 'additional', extra_fee_cents: 5000, park_fee_cents: 1500 },
      { ...base, id: 'extra-tbc', session_kind: 'additional', session_completed: true, invoice_date: null },
      { ...base, id: 'shared-entry', park_fee_cents: 333, park_fee_allocation: 'shared', park_fee_paid_by_coach: true },
      { ...base, id: 'invoiced', session_kind: 'additional', session_completed: true, extra_fee_cents: 3000, park_fee_cents: 1000, park_fee_paid_by_coach: true, invoice_status: 'invoiced' },
      { ...base, id: 'regular-no-extra' },
      { ...base, id: 'regular-planned-entry', park_fee_cents: 2000, invoice_date: '2026-11-02' },
    ];
    window.originalFixture = structuredClone(fixture);
    window.attach = async () => {
      document.querySelector('#view').innerHTML = '<div id="costs"></div>';
      qa.active = true;
      window.handle = JKCParentSessionCosts.mount(document.querySelector('#costs'), {
        athlete: { id: 'child-a', display_name: 'Ali Example' }, isActive: () => qa.active,
        loadPage: async offset => {
          const index = qa.calls.length; qa.calls.push(offset);
          const result = qa.responses ? structuredClone(qa.responses[index % qa.responses.length])
            : { sessions: structuredClone(fixture.slice(offset, offset + qa.pageSize)), hasMore: offset + qa.pageSize < fixture.length, snapshot: 'fixture-v1' };
          if (qa.holdAt === index) await new Promise(resolve => { qa.release = resolve; });
          if (qa.failure) throw Error('Synthetic outage');
          return result;
        },
      });
      await handle.ready;
    };
  });
  return { page, errors };
}

async function dimensions(page, label) {
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: page fits viewport`);
  const overflow = await page.locator('#costs *').evaluateAll(nodes => nodes.filter(node => {
    const style = getComputedStyle(node);
    return node.getClientRects().length && style.display !== 'inline' && node.clientWidth > 0 && node.scrollWidth > node.clientWidth + 1 && !['auto', 'scroll'].includes(style.overflowX);
  }).map(node => ({ tag: node.tagName, class: node.className, width: node.clientWidth, scroll: node.scrollWidth })));
  eq(overflow, [], `${label}: amounts and names remain in containers`);
  ok(await page.locator('[data-cost-refresh]').evaluate(button => button.getBoundingClientRect().height >= 44), `${label}: refresh tap target`);
}

async function integration(page) {
  await page.evaluate(() => {
    window.integration = { calls: [], mounted: [], hold: false, release: null };
    window.state = { user: { id: 'parent-one' }, profile: { role: 'parent' }, view: 'home', parentAthleteId: 'child-a', sessionSetupVersion: 1, loadingOverlayToken: 1 };
    window.getParentRiderContext = async () => ({ selected: { id: 'child-a', display_name: 'Ali' }, athletes: [{ id: 'child-a', display_name: 'Ali' }] });
    window.getMyCoachMessages = async () => [];
    window.getWeeklyAssignments = async () => ({ assignments: [], awards: [], assignmentAttempts: [] });
    for (const name of ['getHelpRequests', 'getDashboardItems', 'getLeaderboard']) window[name] = async () => [];
    window.client = {
      from: () => { const query = { select: () => query, eq: () => query, order: () => query, limit: () => query, then: (resolve, reject) => Promise.resolve({ data: [] }).then(resolve, reject) }; return query; },
      rpc: async (name, args) => { integration.calls.push({ name, args }); if (integration.hold) await new Promise(resolve => integration.release = resolve); return { data: { sessions: [], hasMore: false } }; },
    };
    window.withTimeout = promise => promise;
    window.completionAssignments = () => [];
    window.isAssignmentComplete = () => false;
    window.weeklyCompletionPercent = () => 0;
    window.firstName = athlete => athlete.display_name;
    window.escapeHtml = value => String(value ?? '');
    for (const name of ['avatarHtml', 'parentChildSwitcherHtml', 'parentPageHeadHtml', 'parentEngagementAlertHtml', 'boardRankingsShellHtml', 'parentLatestCoachMessageHtml', 'parentNextItemHtml', 'parentLatestFeedbackHtml', 'parentRecentActivityHtml', 'pointsReceiptAttributes']) window[name] = () => '';
    for (const name of ['bindParentPageActions', 'bindBoardRankings', 'loadParentRoadToLa28Card']) window[name] = () => {};
    window.JKCParentSessionCosts = { mount: (host, config) => { integration.mounted.push({ host, config }); } };
  });
  await page.addScriptTag({ content: extract('renderParentHome') });
  await page.evaluate(() => renderParentHome());
  eq(await page.evaluate(() => integration.mounted.length), 1, 'Actual parent Home mounts costs once');
  eq(await page.locator('#parent-session-costs').count(), 1, 'Costs have a dedicated parent Home container');
  eq(await page.evaluate(() => integration.mounted[0].config.athlete.id), 'child-a', 'Selected linked child reaches card');
  await page.evaluate(() => integration.mounted[0].config.loadPage(100));
  eq(await page.evaluate(() => integration.calls), [{ name: 'get_parent_session_costs', args: { p_athlete_id: 'child-a', p_offset: 100, p_limit: 100 } }], 'Actual adapter uses only scoped read-only projection');
  await page.evaluate(() => { state.parentAthleteId = 'child-b'; });
  eq(await page.evaluate(() => integration.mounted[0].config.isActive()), false, 'Child switch deactivates previous card');
  eq(await page.evaluate(async () => { try { await integration.mounted[0].config.loadPage(0); return ''; } catch (error) { return error.message; } }), 'This rider is no longer selected.', 'Switched child blocks new request');
  eq(await page.evaluate(() => integration.calls.length), 1, 'Blocked request never reaches server');
  await page.evaluate(() => {
    state.parentAthleteId = 'child-a'; integration.hold = true;
    window.inFlight = integration.mounted[0].config.loadPage(0).then(() => 'accepted', error => error.message);
  });
  await page.waitForFunction(() => !!integration.release);
  await page.evaluate(() => { state.user.id = 'parent-two'; integration.release(); });
  eq(await page.evaluate(() => inFlight), 'This rider is no longer selected.', 'Late response after account switch is rejected');
  await page.evaluate(() => { state.user.id = 'parent-one'; state.sessionSetupVersion++; });
  eq(await page.evaluate(() => integration.mounted[0].config.isActive()), false, 'Session reinitialization invalidates old card');
  await page.evaluate(() => { state.sessionSetupVersion--; state.loadingOverlayToken++; });
  eq(await page.evaluate(() => integration.mounted[0].config.isActive()), false, 'Navigation token invalidates old card');
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  try {
    const { page, errors } = await setup(browser);
    await page.evaluate(() => attach());
    eq(await page.evaluate(() => qa.calls), [0, 2, 4, 6], 'All pages load before totals, using actual row offsets');
    eq(await page.locator('[data-cost-completed]').textContent(), '3', 'Completion is explicit, including invoiced history');
    eq(await page.locator('[data-cost-completed]').locator('..').locator('span').textContent(), '1 planned', 'Planned extra is separate from completed count');
    eq(await page.locator('[data-cost-paid]').textContent(), '$25.33', 'Coach-paid entry sums only explicitly paid child shares');
    eq(await page.locator('[data-cost-expected]').textContent(), '$140.33 + TBC', 'Expected includes planned costs, excludes invoiced, preserves unknown extra fee');
    eq(await page.locator('.psc-invoice:not(.psc-history)>summary>span>strong').allTextContents(), ['Invoice expected · 2 Nov 2026', 'Invoice expected · 23 Nov 2026', 'Invoice date to confirm'], 'Invoice groups sort by date and leave TBC last');
    eq(await page.locator('.psc-invoice:not(.psc-history)>summary>b').allTextContents(), ['$20.00', '$120.33', '$0.00 + TBC'], 'Each invoice estimate sums child shares once');
    eq(await page.locator('.psc-session').count(), 6, 'Zero-cost regular session is omitted');
    await page.locator('.psc-invoice').evaluateAll(nodes => nodes.forEach(node => node.open = true));
    ok((await page.locator('.psc-card').innerText()).includes('Park entry share'), 'Legacy flat fee is labelled as a child share');
    ok((await page.locator('.psc-card').innerText()).includes('Planned · coach payment not recorded'), 'Unpaid entry is not represented as coach-paid');
    ok((await page.locator('.psc-note').innerText()).includes('Regular lesson fees are not included'), 'Total scope is explicit');
    eq(await page.locator('.psc-history .psc-session').count(), 1, 'Already invoiced row remains visible separately');

    await page.evaluate(() => { qa.holdAt = qa.calls.length + 1; window.refreshing = handle.refresh(); });
    await page.waitForFunction(() => !!qa.release);
    eq(await page.locator('[data-cost-expected]').count(), 0, 'Partial page loading never shows partial totals');
    eq(await page.locator('[data-cost-refresh]').isDisabled(), true, 'Refresh locks while pages load');
    const requestCount = await page.evaluate(() => qa.calls.length);
    await page.evaluate(() => { handle.refresh(); handle.refresh(); document.querySelector('[data-cost-refresh]').click(); });
    eq(await page.evaluate(() => qa.calls.length), requestCount, 'Repeated taps do not duplicate in-flight loads');
    await page.evaluate(() => { qa.failure = true; qa.release(); });
    await page.evaluate(() => refreshing);
    eq(await page.locator('[data-cost-expected]').count(), 0, 'Failed later page never leaves false totals');
    eq(await page.locator('.psc-error').count(), 1, 'Failure is recoverable with a visible message');
    await page.evaluate(() => { qa.failure = false; qa.holdAt = null; return handle.refresh(); });
    eq(await page.locator('[data-cost-expected]').textContent(), '$140.33 + TBC', 'Retry reloads all pages accurately');

    for (const invalid of [
      [{ sessions: [null], hasMore: false, snapshot: 'v1' }],
      [{ sessions: [], hasMore: true, snapshot: 'v1' }],
      [{ sessions: [], hasMore: 'false', snapshot: 'v1' }],
      [{ sessions: [{ id: 'x', park_fee_cents: -1 }], hasMore: false, snapshot: 'v1' }],
      [{ sessions: [{ id: 'x', park_fee_cents: 2.5 }], hasMore: false, snapshot: 'v1' }],
      [{ sessions: [{ id: 'x', park_fee_cents: 0, extra_fee_cents: 1000001 }], hasMore: false, snapshot: 'v1' }],
      [{ sessions: [{ id: 'x', park_fee_cents: 0 }], hasMore: true, snapshot: 'v1' }, { sessions: [{ id: 'x', park_fee_cents: 0 }], hasMore: false, snapshot: 'v1' }],
      [{ sessions: [], hasMore: false }],
      [{ sessions: [], hasMore: false, snapshot: '' }],
      [{ sessions: [{ id: 'x', park_fee_cents: 0 }], hasMore: true, snapshot: 'v1' }, { sessions: [{ id: 'y', park_fee_cents: 0 }], hasMore: false, snapshot: 'v2' }],
    ]) {
      await page.evaluate(responses => { qa.calls = []; qa.responses = responses; return handle.refresh(); }, invalid);
      eq(await page.locator('.psc-error').count(), 1, 'Invalid/repeated response fails closed');
      eq(await page.locator('[data-cost-expected]').count(), 0, 'Invalid/repeated response has no total');
    }
    await page.evaluate(() => { qa.responses = null; qa.calls = []; fixture = []; return handle.refresh(); });
    eq(await page.locator('[data-cost-expected]').textContent(), '$0.00', 'Confirmed empty dataset may display zero');
    ok((await page.locator('.psc-empty').textContent()).includes('No extra sessions'), 'Confirmed empty state is clear');
    await page.evaluate(() => { fixture = [{ ...originalFixture[0], extra_fee_cents: 0, park_fee_cents: 0 }]; return handle.refresh(); });
    eq(await page.locator('[data-cost-expected]').textContent(), '$0.00', 'Explicit free extra fee is not TBC');
    eq(await page.locator('.psc-session dd').textContent(), '$0.00', 'Free session is retained as a completed extra');

    await page.evaluate(() => {
      fixture = structuredClone(originalFixture);
      fixture[0].venue = '<img src=x onerror="window.injected=true"> & A very long park name '.repeat(3);
      fixture[0].block_name = 'LongBlockName'.repeat(12);
      return handle.refresh();
    });
    await page.locator('.psc-invoice').evaluateAll(nodes => nodes.forEach(node => node.open = true));
    eq(await page.locator('#costs img').count(), 0, 'Untrusted location and block text is escaped');
    eq(await page.evaluate(() => window.injected), undefined, 'Venue text cannot execute script');
    for (const theme of ['dark', 'light']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      for (const width of [320, 390, 1024]) {
        await page.setViewportSize({ width, height: 900 });
        await dimensions(page, `${theme} ${width}`);
        if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `parent-costs-${theme}-${width}.png`), fullPage: true });
      }
    }
    const storage = await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }));
    eq(storage, { local: 0, session: 0 }, 'Private costs are not persisted in browser storage');
    const beforeIdle = await page.evaluate(() => qa.calls.length);
    await page.waitForTimeout(100);
    eq(await page.evaluate(() => qa.calls.length), beforeIdle, 'No immediate polling is scheduled');

    await page.evaluate(() => { qa.calls = []; qa.holdAt = 0; qa.release = null; window.stale = handle.refresh(); });
    await page.waitForFunction(() => !!qa.release);
    await page.evaluate(() => { qa.active = false; document.querySelector('#costs').innerHTML = '<p>New selected child</p>'; qa.release(); });
    await page.evaluate(() => stale);
    eq(await page.locator('#costs').textContent(), 'New selected child', 'Late response cannot overwrite another child');
    eq(await page.evaluate(() => qa.calls.length), 1, 'No subsequent pages are requested after child/logout invalidation');
    await page.evaluate(() => { qa.active = true; qa.calls = []; qa.holdAt = 0; qa.release = null; window.detached = handle.refresh(); });
    await page.waitForFunction(() => !!qa.release);
    await page.evaluate(() => { document.querySelector('#costs').remove(); qa.release(); });
    await page.evaluate(() => detached);
    eq(await page.evaluate(() => qa.calls.length), 1, 'Detached card stops paging');
    await integration(page);
    eq(errors, [], 'No browser console errors across parent cost journeys');
    console.log(`Parent session costs: ${checks} checks passed`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
