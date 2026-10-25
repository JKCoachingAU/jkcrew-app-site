// Actual countdown helpers, isolated clocks and browser fixtures; no accounts or backend calls.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const extract = name => {
  const start = app.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'));
  assert(start >= 0, 'Production function exists: ' + name);
  const rest = app.slice(start), end = rest.indexOf('\n}');
  assert(end >= 0, 'Production function ends: ' + name);
  return rest.slice(0, end + 2);
};
// LA28's official opening schedule lists July 14, 2028 at 17:00 in Los Angeles:
// https://hospitality.la28.org/en/event-discipline/opening-ceremony
// July venue-local time is daylight time (UTC-07:00), irrespective of the viewer's timezone.
const opening = Date.parse('2028-07-15T00:00:00Z');
const minute = 60000, hour = 60 * minute, day = 24 * hour;
const helpers = ['la28CountdownParts', 'la28CountdownHtml', 'mountLa28Countdown'].map(extract).join('\n');
let browser, checks = 0;
const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
const ok = (actual, label) => { assert(actual, label); checks++; };

(async () => {
  browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const cases = [
    [opening - 2 * day - 3 * hour - 4 * minute, { days: 2, hours: 3, minutes: 4, started: false }],
    [opening - day, { days: 1, hours: 0, minutes: 0, started: false }],
    [opening - day + minute, { days: 0, hours: 23, minutes: 59, started: false }],
    [opening - hour, { days: 0, hours: 1, minutes: 0, started: false }],
    [opening - hour + minute, { days: 0, hours: 0, minutes: 59, started: false }],
    [opening - minute, { days: 0, hours: 0, minutes: 1, started: false }],
    [opening, { days: 0, hours: 0, minutes: 0, started: true }],
    [opening + 400 * day, { days: 0, hours: 0, minutes: 0, started: true }],
  ];
  for (const timezoneId of ['UTC', 'Australia/Brisbane', 'America/Los_Angeles']) {
    const context = await browser.newContext({ timezoneId });
    const page = await context.newPage();
    await page.addScriptTag({ content: helpers });
    for (const [now, expected] of cases) eq(await page.evaluate(now => la28CountdownParts(now), now), expected, timezoneId + ': exact minute, hour, day and expiry boundaries');
    eq(await page.evaluate(now => la28CountdownParts(now).started, opening - 1), false, timezoneId + ': opening never starts a millisecond early');
    eq(await page.evaluate(now => new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(now)), opening), '14/07/2028, 17:00', timezoneId + ': fixed target is the verified Los Angeles opening time');
    await context.close();
  }

  // Run the real Home entry point: a late callback must not clean up another screen's controller.
  const guardPage = await browser.newPage();
  await guardPage.setContent('<main id="view">Current dashboard stays here</main>');
  await guardPage.evaluate(() => {
    window.qaGuard = { destroys: 0, recovery: false, recoveryRenders: 0 };
    window.state = { view: 'command', profile: { role: 'coach' }, user: { id: 'current-user' } };
    window.riderRecoveryActive = () => qaGuard.recovery;
    window.renderRiderRecoveryHome = () => { qaGuard.recoveryRenders++; document.querySelector('#view').textContent = 'Recovery dashboard'; };
    window.riderFeaturesDisabled = () => { throw Error('An inactive Home render must not check rider access.'); };
    window.riderFeatureAccessUnknown = () => { throw Error('An inactive Home render must not check rider access.'); };
  });
  await guardPage.addScriptTag({ content: extract('renderAthleteHome') });
  for (const [view, role] of [['command', 'coach'], ['uciTracker', 'athlete'], ['home', 'parent']]) {
    const result = await guardPage.evaluate(async ({ view, role }) => {
      state.view = view; state.profile.role = role; qaGuard.destroys = 0;
      const activeCountdown = { destroy() { qaGuard.destroys++; } };
      state.la28CountdownMount = activeCountdown;
      await renderAthleteHome();
      return { destroys: qaGuard.destroys, retained: state.la28CountdownMount === activeCountdown, text: document.querySelector('#view').textContent };
    }, { view, role });
    eq(result, { destroys: 0, retained: true, text: 'Current dashboard stays here' }, view + '/' + role + ': late athlete Home render leaves the active screen and countdown intact');
  }
  eq(await guardPage.evaluate(async () => {
    state.view = 'home'; state.profile.role = 'athlete'; qaGuard.recovery = true;
    await renderAthleteHome();
    return { destroys: qaGuard.destroys, controller: state.la28CountdownMount, recoveryRenders: qaGuard.recoveryRenders, text: document.querySelector('#view').textContent };
  }), { destroys: 1, controller: null, recoveryRenders: 1, text: 'Recovery dashboard' }, 'Valid athlete Home still clears its countdown and reaches recovery mode');
  await guardPage.close();

  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url() === 'http://jkcrew.test/'
    ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><html data-theme="dark"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div class="app-shell rider-shell" style="display:block"><main id="view" style="padding:16px;max-width:1100px;margin:auto"><section class="home-uci-card"><div data-la28-countdown></div></section></main></div></body></html>' })
    : route.abort());
  await page.goto('http://jkcrew.test/');
  await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'styles.css'), 'utf8') });
  await page.evaluate(now => {
    window.qa = { now, nextId: 0, timers: new Map(), visible: 'visible', listeners: new Set(), pageListeners: new Set(), externalCalls: [], current: true };
    Date.now = () => qa.now;
    window.setTimeout = (callback, delay = 0) => {
      const id = ++qa.nextId;
      qa.timers.set(id, { callback, due: qa.now + Number(delay), delay: Number(delay) });
      return id;
    };
    window.clearTimeout = id => qa.timers.delete(id);
    window.setInterval = () => { throw Error('Countdown must schedule one minute timeout, not an interval.'); };
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => qa.visible });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => qa.visible === 'hidden' });
    const add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document);
    document.addEventListener = (type, listener, options) => { if (type === 'visibilitychange') qa.listeners.add(listener); return add(type, listener, options); };
    document.removeEventListener = (type, listener, options) => { if (type === 'visibilitychange') qa.listeners.delete(listener); return remove(type, listener, options); };
    const addWindow = window.addEventListener.bind(window), removeWindow = window.removeEventListener.bind(window);
    window.addEventListener = (type, listener, options) => { if (type === 'pageshow') qa.pageListeners.add(listener); return addWindow(type, listener, options); };
    window.removeEventListener = (type, listener, options) => { if (type === 'pageshow') qa.pageListeners.delete(listener); return removeWindow(type, listener, options); };
    window.fetch = () => { qa.externalCalls.push('fetch'); throw Error('Countdown must be local.'); };
    window.JKCUciRankings = { load() { qa.externalCalls.push('rankings'); throw Error('Countdown must reuse ranking eligibility.'); } };
    window.client = new Proxy({}, { get(_target, key) { qa.externalCalls.push('client.' + String(key)); throw Error('Countdown must not query the database.'); } });
    window.escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
    window.qaVisible = visible => { qa.visible = visible; document.dispatchEvent(new Event('visibilitychange')); };
    window.qaAdvance = now => {
      qa.now = now;
      let turns = 0;
      for (;;) {
        const next = [...qa.timers].filter(([, timer]) => timer.due <= now).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) return;
        if (++turns > 20) throw Error('Countdown created an unbounded timer loop.');
        qa.timers.delete(next[0]); next[1].callback();
      }
    };
    window.qaMount = () => {
      window.qaController?.destroy();
      qa.current = true;
      document.querySelector('.home-uci-card').innerHTML = '<div data-la28-countdown></div>';
      window.qaHost = document.querySelector('[data-la28-countdown]');
      window.qaController = mountLa28Countdown(qaHost, () => qa.current);
    };
    window.qaValues = () => ['days', 'hours', 'minutes'].map(key => Number(qaHost.querySelector('[data-la28-value="' + key + '"]').textContent.replaceAll(',', '')));
  }, opening - 2 * day - 3 * hour - 4 * minute - 30000);
  await page.addScriptTag({ content: helpers });
  await page.evaluate(() => qaMount());
  eq(await page.evaluate(() => qaValues()), [2, 3, 4], 'Mount paints the current remaining time immediately');
  eq(await page.locator('[role="timer"]').getAttribute('aria-live'), 'off', 'Minute updates do not repeatedly announce to screen readers');
  eq(await page.locator('[data-la28-value]').count(), 3, 'Countdown presents days, hours and minutes only');
  ok(/14.*Jul.*2028|Jul.*14.*2028/i.test(await page.locator('[data-la28-countdown]').innerText()), 'Opening date is visible');
  eq(await page.evaluate(() => [qa.timers.size, qa.listeners.size]), [1, 1], 'One mount owns one timer and one visibility listener');
  await page.evaluate(() => qaAdvance([...qa.timers.values()][0].due));
  eq(await page.evaluate(() => qaValues()), [2, 3, 3], 'One elapsed minute updates the actual countdown');
  eq(await page.evaluate(() => qa.timers.size), 1, 'A tick replaces its timeout without accumulating timers');

  await page.evaluate(now => { qa.now = now; qaMount(); }, opening - hour - 12500);
  const delay = await page.evaluate(() => [...qa.timers.values()][0].delay);
  ok(delay >= 12500 && delay <= 12600, 'Next repaint aligns with the next minute boundary');
  await page.evaluate(now => qaAdvance(now), opening - hour + 100);
  eq((await page.evaluate(() => qaValues()))[1], 0, 'The hour rolls over at the aligned minute boundary');
  await page.evaluate(() => qaVisible('hidden'));
  eq(await page.evaluate(() => qa.timers.size), 0, 'Hidden pages stop scheduled countdown work');
  await page.evaluate(now => { qa.now = now; }, opening - 37 * minute);
  await page.evaluate(() => qaVisible('visible'));
  eq(await page.evaluate(() => qaValues()), [0, 0, 37], 'Visibility resume immediately catches up from the wall clock after sleep');
  eq(await page.evaluate(() => qa.timers.size), 1, 'Visibility resume starts exactly one timer');
  await page.evaluate(() => { qaVisible('visible'); qaVisible('visible'); });
  eq(await page.evaluate(() => qa.timers.size), 1, 'Repeated visible events do not accumulate timers');
  await page.evaluate(now => { qa.now = now; window.dispatchEvent(new Event('pageshow')); }, opening - 32 * minute);
  eq(await page.evaluate(() => qaValues()), [0, 0, 32], 'Restoring a cached page immediately catches up from the wall clock');
  eq(await page.evaluate(() => [qa.timers.size, qa.pageListeners.size]), [1, 1], 'Page restore retains one timer and one pageshow listener');
  await page.evaluate(now => qaAdvance(now), opening - 5 * minute);
  eq(await page.evaluate(() => qaValues()), [0, 0, 5], 'A delayed callback recomputes time instead of decrementing stale values');

  for (const scenario of ['guard', 'detached', 'replaced']) {
    await page.evaluate(now => { qa.now = now; qaMount(); }, opening - 10 * minute);
    const before = await page.evaluate(() => qaHost.innerHTML);
    await page.evaluate(scenario => {
      if (scenario === 'guard') qa.current = false;
      else if (scenario === 'detached') qaHost.remove();
      else qaHost.innerHTML = '<p>New content stays here</p>';
      qaAdvance(qa.now + 2 * 60000);
    }, scenario);
    eq(await page.evaluate(() => qaHost.innerHTML), scenario === 'replaced' ? '<p>New content stays here</p>' : before, scenario + ': invalid mounts cannot repaint');
    eq(await page.evaluate(() => [qa.timers.size, qa.listeners.size]), [0, 0], scenario + ': invalid mounts release both timer and listener');
    eq(await page.evaluate(() => qa.pageListeners.size), 0, scenario + ': invalid mounts also release their pageshow listener');
  }
  await page.evaluate(now => { qa.now = now; qaMount(); qaVisible('hidden'); qa.current = false; qaVisible('visible'); }, opening - 10 * minute);
  eq(await page.evaluate(() => [qa.timers.size, qa.listeners.size]), [0, 0], 'A mount invalidated while hidden never restarts');
  await page.evaluate(() => { qaMount(); qaController.destroy(); qaController.destroy(); });
  eq(await page.evaluate(() => [qa.timers.size, qa.listeners.size]), [0, 0], 'Explicit destroy is idempotent');
  eq(await page.evaluate(() => qa.pageListeners.size), 0, 'Explicit destroy removes its pageshow listener');
  await page.evaluate(() => { mountLa28Countdown(null)?.destroy(); mountLa28Countdown(document.createElement('div'))?.destroy(); });
  eq(await page.evaluate(() => [qa.timers.size, qa.listeners.size]), [0, 0], 'Missing and detached initial hosts create no persistent work');

  await page.evaluate(now => { qa.now = now; qaMount(); }, opening - minute);
  eq(await page.evaluate(() => qaValues()), [0, 0, 1], 'The last minute remains a countdown');
  await page.evaluate(() => qaAdvance([...qa.timers.values()][0].due));
  eq(await page.evaluate(() => qaValues()), [0, 0, 0], 'Opening clamps the display at zero');
  ok(/begun|started|underway|complete/i.test(await page.locator('[data-la28-caption]').innerText()), 'Expired countdown explains that the opening has begun');
  eq(await page.evaluate(() => qa.timers.size), 0, 'Opening stops future countdown ticks');
  eq(await page.evaluate(() => [qa.listeners.size, qa.pageListeners.size]), [0, 0], 'Opening releases both browser resume listeners');
  await page.evaluate(now => { qa.now = now; qaVisible('hidden'); qaVisible('visible'); }, opening + 400 * day);
  eq(await page.evaluate(() => qaValues()), [0, 0, 0], 'Returning long after opening cannot display negative time');
  eq(await page.evaluate(() => qa.timers.size), 0, 'Expired countdown cannot restart on visibility resume');

  await page.evaluate(now => { qa.now = now; qaMount(); }, opening - 650 * day - 23 * hour - 59 * minute);
  for (const theme of ['dark', 'light']) for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    const overflow = await page.locator('[data-la28-countdown]').evaluate(host => [...host.querySelectorAll('*'), host].filter(node => {
      const style = getComputedStyle(node);
      return style.display !== 'inline' && node.clientWidth && node.scrollWidth > node.clientWidth + 2 && !['auto', 'scroll'].includes(style.overflowX);
    }).map(node => ({ tag: node.tagName, class: node.className, width: node.clientWidth, content: node.scrollWidth })));
    eq(overflow, [], theme + ': three-digit days fit ' + width + 'px');
    if (process.env.JKCREW_SCREENSHOT_DIR && [390, 1440].includes(width)) {
      fs.mkdirSync(process.env.JKCREW_SCREENSHOT_DIR, { recursive: true });
      await page.locator('.home-uci-card').screenshot({ path: path.join(process.env.JKCREW_SCREENSHOT_DIR, 'la28-countdown-' + theme + '-' + width + '.png') });
    }
  }
  eq(await page.evaluate(() => qa.externalCalls), [], 'Mounts, ticks, clock jumps and visibility changes make no ranking, network or database calls');
  await page.evaluate(() => qaController.destroy());
  eq(await page.evaluate(() => [qa.timers.size, qa.listeners.size]), [0, 0], 'Final teardown releases all countdown resources');
  eq(await page.evaluate(() => qa.pageListeners.size), 0, 'Final teardown releases the pageshow listener');
  eq(errors, [], 'No uncaught browser exceptions');
  console.log('PASS: ' + checks + ' LA28 countdown checks (official venue time, three timezones, minute/day boundaries, expiry, background resume, clock jumps, teardown, no extra queries and responsive themes).');
  await browser.close();
})().catch(async error => { console.error(error); if (browser) await browser.close(); process.exitCode = 1; });
