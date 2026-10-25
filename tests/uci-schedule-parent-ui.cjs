// Actual schedule UI with synthetic parent-scoped reads. No accounts or production writes.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
let browser, checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (actual, message) => { assert(actual, message); checks++; };

(async () => {
  browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url() === 'http://jkcrew.test/' ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><main style="padding:16px;max-width:1440px;margin:auto"><div id="test"></div></main>' }) : route.abort());
  await page.goto('http://jkcrew.test/');
  for (const file of ['styles.css', 'uci-schedule.css']) await page.addStyleTag({ path: path.join(root, file) });
  await page.addScriptTag({ path: path.join(root, 'uci-schedule.js') });
  await page.evaluate(() => {
    window.qa = { calls: [], current: true, failLoad: true, revoked: false, delayLoad: false, persistence: [] };
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { qa.persistence.push({ key, value }); return setItem.call(this, key, value); };
    window.snapshot = {
      schemaVersion: 1, year: 2027, checkedAt: new Date().toISOString(), readOnly: true, canManage: false,
      notificationsEnabled: false, refreshStatus: { status: 'ok', message: 'Official sources are checked weekly.' },
      qualification: { status: 'revision_pending', summary: 'Qualification rules await an official revision.', sources: [{ title: 'Official UCI announcement', url: 'https://www.uci.org/official-update' }] },
      announcements: [{ id: 'announcement', title: 'Verified qualification update', summary: 'A synthetic verified announcement.', impactGermany: 'Check national federation eligibility.', impactAustralia: 'Check national federation nomination.', url: 'https://www.uci.org/official-update', verifiedAt: '2026-10-24T10:00:00Z' }],
      events: [
        { id: 'australia', name: 'Australian Park Event', startDate: '2027-01-30', endDate: '2027-01-31', venue: 'Brisbane', country: 'Australia', countryCode: 'AUS', status: 'confirmed', dateStatus: 'calendar_dates', classification: 'C1', classificationStatus: 'confirmed', categories: ['Men Elite', 'Women Elite'], eligibilityStatus: 'conditional', eligibilityNote: 'Licence and age requirements apply.', rankingPoints: { status: 'uci_listed', note: 'General UCI ranking points.' }, olympicQualification: { status: 'pending_rules', note: 'Olympic counting rules await verification.' }, registration: { status: 'published', note: 'Official entry information.', url: 'https://organiser.example/register', deadline: '2027-01-20' }, sources: [{ title: 'Official UCI calendar', url: 'https://www.uci.org/calendar' }], lastCheckedAt: '2026-10-24T10:00:00Z', changes: [] },
        { id: 'germany', name: 'Köln BMX Park', startDate: '2027-06-12', endDate: '2027-06-13', venue: 'Cologne', country: 'Germany', countryCode: 'GER', status: 'provisional', dateStatus: 'provisional', classification: 'C1', classificationStatus: 'unconfirmed', categories: [], eligibilityNote: 'Eligible categories will be announced.', rankingPoints: { status: 'unconfirmed' }, sources: [{ title: 'Organiser', url: 'https://organiser.example/2027' }], changes: [{ field: 'Dates', previous: '5 June', current: '12 June' }] },
        { id: 'cancelled', name: 'Cancelled Cup', startDate: '2027-07-01', country: 'Germany', countryCode: 'GER', status: 'cancelled', categories: [], sources: [] },
        { id: 'unsafe', name: '<img src=x onerror="window.injected=true">', country: 'International', countryCode: 'FRA', status: 'provisional', categories: [], sources: [{ title: 'Script', url: 'javascript:alert(1)' }, { title: 'Credentials', url: 'https://user:pass@official.example/' }, { title: 'Local server', url: 'https://127.0.0.1/private' }], registration: { note: '<script>window.injected=true</script>', url: 'data:text/html,no' } },
      ],
    };
    window.client = { rpc: async (name, args) => {
      qa.calls.push({ name, args });
      if (name !== 'get_parent_uci_2027_schedule') return { error: { code: '42501', message: 'Unexpected non-parent endpoint' } };
      if (qa.delayLoad) { qa.delayLoad = false; await new Promise(resolve => { qa.releaseLoad = resolve; }); }
      if (qa.revoked) return { error: { code: '42501', message: 'Private linked-parent access detail' } };
      if (qa.failLoad) throw Error('Internal server detail');
      return { data: structuredClone(snapshot) };
    } };
    window.options = { client, parentView: true, canManage: false, isCurrent: () => qa.current, onBack: () => { qa.back = true; }, onEventAdded: () => { qa.added = true; } };
    window.mount = UCI2027Schedule.mount(document.querySelector('#test'), options);
    window.remount = (extra = {}) => { mount.destroy(); qa.current = true; mount = UCI2027Schedule.mount(document.querySelector('#test'), { ...options, ...extra }); };
  });
  await page.getByText('Schedule unavailable', { exact: true }).waitFor();
  eq(await page.evaluate(() => qa.calls[0].name), 'get_parent_uci_2027_schedule', 'Parent opens only the authorized parent schedule endpoint');
  eq(await page.getByText('Internal server detail', { exact: true }).count(), 0, 'Backend details are not exposed');
  ok(await page.getByRole('button', { name: 'Try again', exact: true }).isVisible(), 'Initial failure offers a retry');
  await page.evaluate(() => { qa.failLoad = false; return mount.reload(); });
  eq(await page.locator('[data-schedule-event]').count(), 4, 'Parent can read verified upcoming opportunities and advisories');
  eq(await page.locator('[data-schedule-add],[data-schedule-alerts],[data-schedule-open]').count(), 0, 'Parent has no management or notification preference controls');
  eq(await page.locator('[data-schedule-filter] option[value="added"]').count(), 0, 'Coach calendar-management filter is absent');
  eq(await page.locator('.uci-schedule-heading .eyebrow').textContent(), 'Competition planning', 'Parent heading is competition planning');
  eq(await page.locator('[data-schedule-event="australia"] .uci-schedule-event-dates').textContent(), '30 Jan 2027 – 31 Jan 2027', 'Upcoming source dates render as calendar days');
  ok((await page.locator('[data-schedule-event="australia"]').textContent()).includes('Brisbane · Australia'), 'Verified event location remains visible');
  ok((await page.locator('[data-schedule-event="australia"]').textContent()).includes('Men Elite · Women Elite'), 'Eligible categories remain visible to parents');
  ok((await page.locator('.uci-schedule-distinction').textContent()).includes('Ranking points ≠ Olympic qualification points'), 'Parent view preserves qualification distinction');
  await page.locator('[data-schedule-event="australia"] summary').click();
  eq(await page.locator('[data-schedule-event="australia"] a').allTextContents(), ['Registration details ↗', 'Official UCI calendar ↗'], 'Registration and official sources are available read-only');
  ok((await page.locator('[data-schedule-event="australia"] .uci-schedule-deadline').textContent()).includes('20 Jan 2027'), 'Published organiser registration deadline is shown');
  eq(await page.locator('[data-schedule-event="australia"] .uci-schedule-sources a').getAttribute('href'), 'https://www.uci.org/calendar', 'Official source points to the verified URL');
  eq(await page.locator('[data-schedule-event="germany"] .uci-schedule-pending').textContent(), '· unconfirmed', 'Unverified classification is not misrepresented');
  ok((await page.locator('[data-schedule-event="cancelled"]').textContent()).includes('Cancelled'), 'Cancellation remains visible for existing travel plans');
  await page.locator('.uci-schedule-announcements summary').click();
  ok((await page.locator('.uci-schedule-announcements').textContent()).includes('German riders:'), 'Official German eligibility update is readable');
  ok((await page.locator('.uci-schedule-announcements').textContent()).includes('Australian riders:'), 'Official Australian eligibility update is readable');
  await page.locator('[data-schedule-event="unsafe"] summary').click();
  eq(await page.locator('[data-schedule-event="unsafe"] a').count(), 0, 'Unsafe source and registration URLs never become links');
  eq(await page.locator('#test img,#test script').count(), 0, 'Untrusted source text cannot create markup');
  eq(await page.evaluate(() => !!window.injected), false, 'Untrusted content does not execute');
  for (const link of await page.locator('#test a').all()) {
    eq(await link.getAttribute('rel'), 'noopener noreferrer', 'Official source isolates the opener');
    eq(await link.getAttribute('target'), '_blank', 'Official source opens separately');
  }

  // Forged local controls and a broader caller option must not cross the read-only boundary.
  const callsBeforeForged = await page.evaluate(() => qa.calls.length);
  await page.evaluate(() => {
    const host = document.querySelector('#test');
    for (const [attribute, value] of [['data-schedule-add', 'australia'], ['data-schedule-add', 'unknown'], ['data-schedule-alerts', '']]) {
      const button = document.createElement('button'); button.setAttribute(attribute, value); host.append(button); button.click(); button.click(); button.remove();
    }
  });
  eq(await page.evaluate(() => qa.calls.length), callsBeforeForged, 'Forged add and subscription controls emit no RPC requests');
  eq(await page.evaluate(() => !!qa.added), false, 'No false calendar save callback is emitted');
  await page.evaluate(() => remount({ canManage: true }));
  await page.locator('[data-schedule-event]').first().waitFor();
  eq(await page.locator('[data-schedule-add],[data-schedule-alerts]').count(), 0, 'Parent mode overrides a broader local canManage option');
  const callsBeforeBroader = await page.evaluate(() => qa.calls.length);
  await page.evaluate(() => {
    const host = document.querySelector('#test');
    for (const attribute of ['data-schedule-add', 'data-schedule-alerts']) { const b = document.createElement('button'); b.setAttribute(attribute, 'australia'); host.append(b); b.click(); b.remove(); }
  });
  eq(await page.evaluate(() => qa.calls.length), callsBeforeBroader, 'Broader local role still cannot invoke parent writes');

  // Every parent response must explicitly confirm both read-only mode and lack of management.
  for (const flags of [{ canManage: true, readOnly: true }, { canManage: false, readOnly: false }, { canManage: false }, { readOnly: true }, { canManage: 'false', readOnly: true }, { canManage: false, readOnly: 'true' }]) {
    await page.evaluate(flags => { delete snapshot.readOnly; delete snapshot.canManage; Object.assign(snapshot, flags); return mount.reload(); }, flags);
    eq(await page.locator('[data-schedule-event],.uci-schedule-qualification').count(), 0, `Malformed parent authorization clears prior data: ${JSON.stringify(flags)}`);
    ok(await page.getByText('Schedule unavailable', { exact: true }).isVisible(), 'Malformed role response fails closed with retry');
    eq(await page.locator('[data-schedule-add],[data-schedule-alerts]').count(), 0, 'Malformed role response never reveals write controls');
  }
  await page.evaluate(() => { snapshot.readOnly = true; snapshot.canManage = false; return mount.reload(); });
  eq(await page.locator('[data-schedule-event]').count(), 4, 'Valid access can recover after rejected metadata');
  await page.evaluate(() => { qa.revoked = true; return mount.reload(); });
  eq(await page.locator('[data-schedule-event],.uci-schedule-qualification,.uci-schedule-announcements').count(), 0, 'Revoked parent access clears every previously loaded section');
  eq(await page.getByText('Private linked-parent access detail', { exact: true }).count(), 0, 'Revocation hides private backend details');
  ok(await page.getByText('Your access could not be confirmed. Refresh the app and sign in again if needed.', { exact: true }).isVisible(), 'Revocation has friendly access guidance');
  await page.evaluate(() => { qa.revoked = false; return mount.reload(); });
  await page.evaluate(() => { qa.failLoad = true; return mount.reload(); });
  eq(await page.locator('[data-schedule-event],.uci-schedule-qualification').count(), 0, 'Unverified parent refresh failure does not retain old authorized data');
  await page.evaluate(() => { qa.failLoad = false; return mount.reload(); });
  eq(await page.locator('[data-schedule-event]').count(), 4, 'Connection retry restores only newly authorized data');

  const callsBeforeFilter = await page.evaluate(() => qa.calls.length);
  await page.locator('[data-schedule-search]').fill('koln');
  eq(await page.locator('[data-schedule-event]').count(), 1, 'Parent event search handles accents');
  await page.locator('[data-schedule-search]').fill('No event matches');
  ok(await page.getByText('No events match these filters', { exact: true }).isVisible(), 'Parent empty search is recoverable');
  await page.locator('[data-schedule-clear]').click();
  await page.locator('[data-schedule-region]').selectOption('AUS');
  eq(await page.locator('[data-schedule-event]').count(), 1, 'Parents can filter Australian opportunities');
  await page.locator('[data-schedule-region]').selectOption('GER');
  eq(await page.locator('[data-schedule-event]').count(), 2, 'Parents can filter German opportunities and cancellation notices');
  await page.locator('[data-schedule-region]').selectOption('all');
  await page.locator('[data-schedule-filter]').selectOption('confirmed');
  eq(await page.locator('[data-schedule-event]').count(), 1, 'Confirmed filter does not imply provisional dates are verified');
  await page.locator('[data-schedule-filter]').selectOption('all');
  eq(await page.evaluate(() => qa.calls.length), callsBeforeFilter, 'Local filters do not download the schedule again');
  await page.evaluate(() => { window.savedEvents = snapshot.events; snapshot.events = []; return mount.reload(); });
  ok(await page.getByText('The 2027 calendar is taking shape', { exact: true }).isVisible(), 'Verified empty schedule is explained');
  await page.evaluate(() => { snapshot.events = savedEvents; return mount.reload(); });

  // Use production styles for mobile/desktop and both themes.
  for (const theme of ['dark', 'light']) for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    eq(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${theme} parent schedule fits ${width}px without horizontal scroll`);
    const heights = await page.locator('#test button:visible,#test summary:visible,#test input:visible,#test select:visible').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
    ok(heights.every(height => height >= 44), `${theme} ${width}px controls preserve mobile tap targets`);
  }
  eq(await page.locator('.uci-schedule-button').first().evaluate(node => getComputedStyle(node).transitionDuration), '0s', 'Reduced motion is respected');
  const beforeBusy = await page.evaluate(() => qa.calls.length);
  await page.evaluate(() => { qa.delayLoad = true; mount.reload(); mount.reload(); mount.reload(); });
  await page.waitForFunction(() => typeof qa.releaseLoad === 'function');
  eq(await page.evaluate(() => qa.calls.length), beforeBusy + 1, 'Repeated reloads share a single pending parent request');
  eq(await page.locator('[data-schedule-reload]').isDisabled(), true, 'Pending reload provides disabled loading feedback');
  await page.evaluate(() => { mount.destroy(); document.querySelector('#test').textContent = 'Next account screen'; qa.releaseLoad(); });
  await page.waitForTimeout(30);
  eq(await page.locator('#test').textContent(), 'Next account screen', 'Late parent read cannot overwrite a new account screen');
  eq(await page.evaluate(() => qa.calls.every(call => call.name === 'get_parent_uci_2027_schedule')), true, 'Every request is a parent read; no save, rider/coach read, or subscription RPC is sent');
  eq(await page.evaluate(() => qa.persistence), [], 'Parent schedule is not persisted in browser storage');
  eq(errors, [], 'No browser exceptions');
  console.log(`PASS parent UCI schedule UI: ${checks} checks (read-only flags, forged controls, parent-only RPC, revocation, sources, filters, retry, mobile layouts).`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); });
