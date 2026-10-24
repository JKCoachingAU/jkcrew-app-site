// Real schedule UI, synthetic official-source records and RPCs. No account or production writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
let browser;
(async () => {
  browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const errors = [];
  let checks = 0;
  const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
  const ok = (actual, message) => { assert(actual, message); checks++; };
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => route.request().url() === 'http://jkcrew.test/' ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><main style="padding:16px;max-width:1440px;margin:auto"><div id="test"></div></main>' }) : route.abort());
  await page.goto('http://jkcrew.test/');
  await page.addStyleTag({ path: path.join(root, 'styles.css') });
  await page.addStyleTag({ path: path.join(root, 'uci-schedule.css') });
  await page.addScriptTag({ path: path.join(root, 'uci-schedule.js') });
  await page.evaluate(() => {
    window.qa = { calls: [], failLoad: true, failSave: false, failAlerts: false, delayLoad: false, delaySave: false, current: true, persistence: [] };
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { qa.persistence.push({ key, value }); return original.call(this, key, value); };
    window.snapshot = {
      schemaVersion: 1, year: 2027, checkedAt: new Date().toISOString(), canManage: true, notificationsEnabled: false,
      refreshStatus: { status: 'ok', message: 'Official sources are checked weekly.' },
      qualification: { status: 'revision_pending', summary: 'Official revision is pending. Earlier criteria must not be treated as current confirmation.', sources: [{ title: 'UCI qualification update', url: 'https://www.uci.org/official-update' }] },
      announcements: [{ id: 'official-update', title: 'Synthetic qualification update', summary: 'A verified test update.', impact: 'German and Australian riders should check revised eligibility.', deadlines: ['Entries close 15 June 2027'], url: 'https://www.uci.org/official-update', verifiedAt: '2026-10-24T10:00:00Z' }],
      events: [
        { id: 'confirmed-au', name: 'Australian Park Event', startDate: '2027-01-30', endDate: '2027-01-31', venue: 'Brisbane', country: 'Australia', countryCode: 'AUS', status: 'confirmed', dateStatus: 'calendar_dates', classification: 'C1', classificationStatus: 'confirmed', categories: ['Men Elite', 'Women Elite'], eligibilityStatus: 'conditional', eligibilityNote: 'Licence and age requirements apply.', rankingPoints: { status: 'uci_listed', note: 'Listed for general UCI ranking points.' }, olympicQualification: { status: 'pending_rules', note: 'Olympic counting rules await verification.' }, registration: { status: 'pending', note: 'Entries are not open yet.', url: null }, sources: [{ title: 'Official UCI calendar', url: 'https://www.uci.org/calendar' }], lastCheckedAt: '2026-10-24T10:00:00Z', changes: [] },
        { id: 'provisional-de', name: 'Köln BMX Park', startDate: '2027-06-12', endDate: '2027-06-13', venue: 'Cologne', country: 'Germany', countryCode: 'GER', status: 'provisional', dateStatus: 'provisional', classification: 'C1', classificationStatus: 'unconfirmed', categories: [], eligibilityNote: 'Eligible categories will be announced.', rankingPoints: { status: 'unconfirmed', note: 'No verified points announcement.' }, registration: { status: 'published', note: 'Registration guide published.', url: 'https://official-event.test/register', email: 'entries@official-event.test', deadline: '2027-06-01' }, sources: [{ title: 'Organiser', url: 'https://official-event.test/2027' }], lastCheckedAt: '2026-10-24T10:00:00Z', changes: [{ field: 'Dates', previous: '5 June', current: '12 June' }] },
        { id: 'saved', name: 'Already Saved World Cup', startDate: '2027-07-15', venue: 'Test park', country: 'France', countryCode: 'FRA', status: 'confirmed', dateStatus: 'confirmed', categories: ['Women Elite'], rankingPoints: { status: 'uci_listed' }, existingEventId: 'calendar-saved', alreadyAdded: true, syncStatus: 'coach_edits', sources: [] },
        { id: 'cancelled', name: 'Cancelled Event', startDate: '2027-08-20', country: 'Germany', countryCode: 'GER', status: 'cancelled', changes: [] },
        { id: 'unsafe', name: '<img src=x onerror="window.injected=true">', country: 'Test <script>window.injected=true</script>', status: 'provisional', sources: [{ title: 'Unsafe script', url: 'javascript:alert(1)' }, { title: 'Unsafe credentials', url: 'https://user:pass@official.test/' }, { title: 'Unsafe plain HTTP', url: 'http://official.test/' }], registration: { note: '<svg onload="window.injected=true">', url: 'data:text/html,no' }, changes: [{ field: '<img src=x>', previous: '<script>x</script>', current: 'safe' }] },
      ],
    };
    window.client = { rpc: async (name, args) => {
      qa.calls.push({ name, args });
      if (name === 'get_uci_2027_schedule') { const result = structuredClone(snapshot); if (qa.delayLoad) { qa.delayLoad = false; await new Promise(r => qa.releaseLoad = r); } if (qa.failLoad) throw Error('Internal database issue should not show'); return { data: result }; }
      if (name === 'add_uci_schedule_event') { if (qa.delaySave) { qa.delaySave = false; await new Promise(r => qa.releaseSave = r); } if (qa.failSave) throw Error('Connection lost'); const event = snapshot.events.find(e => e.id === args.p_event_id); const already = !!event.alreadyAdded; event.alreadyAdded = true; event.existingEventId = event.matchingEventId || 'calendar-' + args.p_event_id; return { data: { event_id: event.existingEventId, already_added: already, sync_status: 'current' } }; }
      if (name === 'subscribe_uci_schedule_updates') { if (qa.failAlerts) return { error: { code: 'network' } }; snapshot.notificationsEnabled = args.p_enabled; return { data: { enabled: args.p_enabled } }; }
      throw Error('Unknown RPC');
    } };
    window.options = { client, canManage: true, isCurrent: () => qa.current, onOpenEvent: id => qa.opened = id, onEventAdded: item => qa.added = item, onBack: () => qa.back = true };
    window.mount = UCI2027Schedule.mount(document.querySelector('#test'), options);
  });
  await page.getByText('Schedule unavailable', { exact: true }).waitFor();
  eq(await page.locator('#test').getByText('Internal database issue should not show').count(), 0, 'Internal errors are not exposed');
  await page.evaluate(() => qa.failLoad = false);
  await page.locator('[data-schedule-reload]').click();
  await page.locator('[data-schedule-event]').first().waitFor();
  eq(await page.locator('[data-schedule-event]').count(), 5, 'Verified snapshot renders all states');
  eq(await page.locator('[data-schedule-event="confirmed-au"] h2').textContent(), 'Australian Park Event', 'Chronological first event renders');
  eq(await page.locator('[data-schedule-event="confirmed-au"] .uci-schedule-event-dates').textContent(), '30 Jan 2027 – 31 Jan 2027', 'Dates keep the calendar day and year');
  ok((await page.locator('.uci-schedule-distinction').textContent()).includes('Ranking points ≠ Olympic qualification points'), 'Ranking and Olympic points are explicitly distinguished');
  eq(await page.locator('[data-schedule-event="provisional-de"] .uci-schedule-pending').textContent(), '· unconfirmed', 'Provisional UCI classification is not falsely confirmed');
  eq(await page.locator('[data-schedule-event="cancelled"] [data-schedule-add]').isDisabled(), true, 'Cancelled event cannot be added');
  eq(await page.locator('[data-schedule-event="unsafe"] [data-schedule-add]').textContent(), 'Waiting for official dates', 'Undated watchlist events explain why calendar saving is unavailable');
  eq(await page.locator('[data-schedule-event="unsafe"] [data-schedule-add]').isDisabled(), true, 'Undated event cannot be saved with invented dates');
  eq(await page.locator('[data-schedule-event="saved"] [data-schedule-add]').count(), 0, 'Existing calendar event has no Add button');
  ok(await page.locator('[data-schedule-event="saved"] .uci-schedule-warning').isVisible(), 'Manual calendar edits are flagged');
  await page.locator('[data-schedule-open="saved"]').click();
  eq(await page.evaluate(() => qa.opened), 'calendar-saved', 'View event opens linked calendar ID');
  eq(await page.locator('#test img,#test svg,#test script').count(), 0, 'Untrusted source and event text cannot inject markup');
  await page.locator('[data-schedule-event="unsafe"] summary').click();
  eq(await page.locator('[data-schedule-event="unsafe"] a').count(), 0, 'Unsafe URL schemes and embedded credentials are not links');
  eq(await page.evaluate(() => !!window.injected), false, 'No source text executed');
  for (const link of await page.locator('#test a').all()) {
    eq(await link.getAttribute('target'), '_blank', 'Official sources open separately');
    eq(await link.getAttribute('rel'), 'noopener noreferrer', 'Official links isolate opener');
  }
  await page.locator('[data-schedule-search]').fill('koln');
  eq(await page.locator('[data-schedule-event]').count(), 1, 'Search matches accents');
  await page.locator('[data-schedule-event="provisional-de"] summary').click();
  ok((await page.locator('[data-schedule-event="provisional-de"]').textContent()).includes('1 June 2027'), 'Registration deadline is shown');
  await page.locator('[data-schedule-search]').fill('No matching event');
  ok(await page.getByText('No events match these filters').isVisible(), 'Empty filter state is clear');
  await page.locator('[data-schedule-clear]').click();
  await page.locator('[data-schedule-region]').selectOption('AUS');
  eq(await page.locator('[data-schedule-event]').count(), 1, 'Australia filter works');
  await page.locator('[data-schedule-region]').selectOption('GER');
  eq(await page.locator('[data-schedule-event]').count(), 2, 'Germany includes cancellation advisory');
  await page.locator('[data-schedule-region]').selectOption('international');
  eq(await page.locator('[data-schedule-event]').count(), 2, 'International filter excludes Australian/German host events');
  await page.locator('[data-schedule-region]').selectOption('all');
  await page.locator('[data-schedule-filter]').selectOption('confirmed');
  eq(await page.locator('[data-schedule-event]').count(), 2, 'Confirmed filter excludes provisional and cancellation');
  await page.locator('[data-schedule-filter]').selectOption('changed');
  eq(await page.locator('[data-schedule-event]').count(), 4, 'Change filter includes verified changes, cancellation and manual conflict');
  await page.locator('[data-schedule-filter]').selectOption('all');
  await page.evaluate(() => { qa.delaySave = true; qa.failSave = true; });
  await page.locator('[data-schedule-add="confirmed-au"]').evaluate(button => { button.click(); button.click(); });
  await page.waitForFunction(() => !!qa.releaseSave);
  eq(await page.evaluate(() => qa.calls.filter(c => c.name === 'add_uci_schedule_event').length), 1, 'Rapid taps send exactly one add request');
  eq(await page.locator('[data-schedule-add="confirmed-au"]').isDisabled(), true, 'Add button stays busy until confirmation');
  eq(await page.locator('[data-schedule-reload]').isDisabled(), true, 'Reload cannot race a pending save');
  eq(await page.locator('[data-schedule-event="confirmed-au"] .uci-schedule-added').count(), 0, 'No optimistic false calendar confirmation');
  await page.evaluate(() => qa.releaseSave());
  await page.getByRole('button', { name: 'Retry adding event' }).waitFor();
  ok((await page.locator('[data-schedule-event="confirmed-au"] [role="status"]').textContent()).includes('retrying won’t add a duplicate'), 'Uncertain saves explain safe retry');
  await page.evaluate(() => { qa.failSave = false; snapshot.events[0].alreadyAdded = true; });
  await page.locator('[data-schedule-add="confirmed-au"]').click();
  await page.locator('[data-schedule-open="confirmed-au"]').waitFor();
  eq(await page.evaluate(() => qa.calls.filter(c => c.name === 'add_uci_schedule_event').map(c => c.args.p_event_id)), ['confirmed-au', 'confirmed-au'], 'Retry uses the same stable source identity');
  ok((await page.locator('[data-schedule-event="confirmed-au"] [role="status"]').textContent()).includes('already in your calendar'), 'Retry reconciles already committed server save');
  eq(await page.evaluate(() => qa.added), { eventId: 'calendar-confirmed-au', scheduleEventId: 'confirmed-au' }, 'Parent receives confirmed calendar ID');
  await page.locator('[data-schedule-filter]').selectOption('added');
  eq(await page.locator('[data-schedule-event]').count(), 2, 'Added filter updates immediately after confirmed save');
  await page.locator('[data-schedule-filter]').selectOption('all');
  await page.evaluate(() => qa.failAlerts = true);
  await page.locator('[data-schedule-alerts]').click();
  await page.getByText('Your alert preference couldn’t be saved. Please try again.').waitFor();
  eq(await page.locator('[data-schedule-alerts]').getAttribute('aria-checked'), 'false', 'Failed alert update keeps existing state');
  await page.evaluate(() => qa.failAlerts = false);
  await page.locator('[data-schedule-alerts]').click();
  await page.waitForFunction(() => document.querySelector('[data-schedule-alerts]').getAttribute('aria-checked') === 'true');
  eq(await page.evaluate(() => qa.calls.filter(c => c.name === 'subscribe_uci_schedule_updates').at(-1).args.p_enabled), true, 'Coach explicitly enables official update alerts');
  await page.evaluate(() => { qa.failLoad = true; });
  await page.locator('[data-schedule-reload]').click();
  await page.locator('.uci-schedule-load-error').first().waitFor();
  eq(await page.locator('[data-schedule-event]').count(), 5, 'Refresh failure keeps the current schedule');
  await page.evaluate(() => { qa.failLoad = false; snapshot.checkedAt = '2025-01-01T00:00:00Z'; snapshot.refreshStatus = { status: 'partial' }; });
  await page.locator('[data-schedule-reload]').click();
  await page.getByText(/Update overdue/).waitFor();
  ok((await page.locator('.uci-schedule-monitor').textContent()).includes('could not be checked'), 'Incomplete checks are visible instead of silently presenting fresh facts');
  await page.locator('.uci-schedule-announcements summary').click();
  await page.locator('[data-schedule-event="provisional-de"] summary').click();
  for (const theme of ['dark', 'light']) for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    const overflow = await page.locator('#test').evaluate(panel => [...panel.querySelectorAll('*')].filter(node => {
      const style = getComputedStyle(node); return style.display !== 'inline' && node.clientWidth && node.scrollWidth > node.clientWidth + 2 && !['auto', 'scroll'].includes(style.overflowX);
    }).map(node => ({ tag: node.tagName, class: node.className, text: node.textContent.slice(0, 30), width: node.clientWidth, scroll: node.scrollWidth })));
    eq(overflow, [], theme + ' layout fits at ' + width + 'px');
    for (const button of await page.locator('#test button:visible,#test summary:visible,#test input:visible,#test select:visible').all()) ok((await button.boundingBox()).height >= 44, 'Interactive element has a 44px tap target');
    if (process.env.JKCREW_SCREENSHOT_DIR && [390, 1440].includes(width)) {
      fs.mkdirSync(process.env.JKCREW_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.JKCREW_SCREENSHOT_DIR, `uci-schedule-${theme}-${width}.png`), fullPage: true });
    }
  }
  eq(await page.locator('.uci-schedule-button').first().evaluate(el => getComputedStyle(el).transitionDuration), '0s', 'Reduced motion disables transitions');
  await page.evaluate(() => {
    const event = snapshot.events.find(e => e.id === 'provisional-de');
    event.matchingEventId = 'existing-legacy-event'; event.matchingEventCount = 1;
    event.reviewNote = 'The organiser listing needs another check; existing dates are retained.';
    return mount.reload();
  });
  eq(await page.locator('[data-schedule-add="provisional-de"]').textContent(), 'Already in Upcoming — Link updates', 'A legacy calendar match is clearly identified before linking');
  ok((await page.locator('[data-schedule-event="provisional-de"]').textContent()).includes('organiser listing needs another check'), 'Missing-listing review notes remain visible');
  await page.locator('[data-schedule-open="provisional-de"]').click();
  eq(await page.evaluate(() => qa.opened), 'existing-legacy-event', 'Existing legacy calendar entry can be inspected before linking');
  await page.locator('[data-schedule-filter]').selectOption('added');
  eq(await page.locator('[data-schedule-event]').count(), 3, 'Calendar filter includes legacy events already present');
  await page.locator('[data-schedule-filter]').selectOption('all');
  await page.locator('[data-schedule-add="provisional-de"]').click();
  await page.locator('[data-schedule-event="provisional-de"] .uci-schedule-added').waitFor();
  eq(await page.evaluate(() => qa.added), { eventId: 'existing-legacy-event', scheduleEventId: 'provisional-de' }, 'Linking preserves the existing calendar UUID');
  ok((await page.locator('[data-schedule-event="provisional-de"] [role="status"]').textContent()).includes('updates linked'), 'Successful linking confirms the existing event was reused');
  await page.evaluate(() => {
    const event = snapshot.events.find(e => e.id === 'provisional-de');
    delete event.alreadyAdded; delete event.existingEventId; delete event.matchingEventId;
    event.matchingEventCount = 2; return mount.reload();
  });
  eq(await page.locator('[data-schedule-add="provisional-de"]').textContent(), 'Matching events need review', 'Ambiguous duplicates prompt calendar review');
  eq(await page.locator('[data-schedule-add="provisional-de"]').isDisabled(), true, 'Ambiguous legacy matches cannot create another duplicate');
  eq(await page.locator('[data-schedule-open="provisional-de"]').count(), 0, 'Ambiguous matches never select an arbitrary calendar event');
  await page.evaluate(() => { delete snapshot.events.find(e => e.id === 'provisional-de').matchingEventCount; });
  await page.evaluate(() => { mount.destroy(); snapshot.canManage = true; mount = UCI2027Schedule.mount(document.querySelector('#test'), { ...options, canManage: false }); });
  await page.locator('[data-schedule-event]').first().waitFor();
  eq(await page.locator('[data-schedule-add],[data-schedule-alerts],[data-schedule-open]').count(), 0, 'Athlete deep link is read-only even if server metadata is broader');
  eq(await page.locator('[data-schedule-event]').count(), 5, 'Rider can read schedule and qualification announcement deep links');
  await page.evaluate(() => { mount.destroy(); snapshot.canManage = false; mount = UCI2027Schedule.mount(document.querySelector('#test'), options); });
  await page.locator('[data-schedule-event]').first().waitFor();
  eq(await page.locator('[data-schedule-add],[data-schedule-alerts]').count(), 0, 'Server denies management even with coach UI option');
  await page.evaluate(() => { snapshot.checkedAt = null; snapshot.refreshStatus = 'not_checked'; return mount.reload(); });
  eq(await page.locator('.uci-schedule-monitor strong').textContent(), 'Awaiting first verified refresh', 'An uninitialised server never claims a completed weekly check');
  eq(await page.locator('.uci-schedule-monitor time').textContent(), 'Not checked yet', 'No invented last-checked timestamp');
  await page.evaluate(() => { qa.delayLoad = true; mount.reload(); });
  await page.waitForFunction(() => !!qa.releaseLoad);
  await page.evaluate(() => { mount.destroy(); document.querySelector('#test').textContent = 'New account screen'; qa.releaseLoad(); });
  await page.waitForTimeout(50);
  eq(await page.locator('#test').textContent(), 'New account screen', 'Late response cannot overwrite a new account or page');
  eq(await page.evaluate(() => qa.persistence), [], 'Private calendar state is never written to persistent browser storage');
  eq(errors, [], 'No browser console exceptions');
  console.log(`PASS UCI schedule UI: ${checks} checks; filters, verified details, source safety, idempotent-save retry, role guards, stale-response isolation, notification preference, 320–1440px dark/light layouts.`);
  await browser.close();
})().catch(async error => { console.error(error); if (browser) await browser.close(); process.exitCode = 1; });
