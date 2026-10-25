// Real shell and public ranking cache with synthetic riders. No backend writes.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const extract = name => {
  const start = source.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'));
  assert(start >= 0, 'Production helper exists: ' + name);
  const rest = source.slice(start), end = rest.indexOf('\n}');
  assert(end >= 0, 'Production helper ends: ' + name);
  return rest.slice(0, end + 2);
};
const array = name => {
  const start = source.indexOf('const ' + name + ' = [');
  assert(start >= 0, name); return source.slice(start, source.indexOf('\n];', start) + 3);
};
// Names are kept explicit so navigation coverage cannot silently omit a new helper.
const helpers = [
  'athletePrimaryView', 'parentPrimaryView', 'coachPrimaryView', 'notificationPrimaryView',
  'navNotificationBadge', 'riderHasUciPoints', 'primaryNavButtonHtml', 'updateRiderUciNavigation', 'loadRiderUciNavigation', 'renderShell', 'saveUciProfileLink',
];
let browser, checks = 0;
const eq = (value, expected, label) => { assert.deepEqual(value, expected, label); checks++; };
const ok = (value, label) => { assert(value, label); checks++; };
async function pageFor({ stored = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage(); page.setDefaultTimeout(5000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', r => {
    const url = new URL(r.request().url());
    if (url.origin !== 'http://jkcrew.test') return r.abort();
    if (url.pathname === '/') return r.fulfill({ contentType: 'text/html', body: '<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/recovery-mode.css"></head><body><div id="app"></div></body></html>' });
    const file = path.join(root, decodeURIComponent(url.pathname));
    return file.startsWith(root + path.sep) && fs.existsSync(file) ? r.fulfill({ path: file }) : r.abort();
  });
  await page.goto('http://jkcrew.test/');
  await page.evaluate(stored => {
    if (stored) localStorage.setItem('jkcrew-uci-rankings-v1', JSON.stringify(stored));
    window.app = document.querySelector('#app');
    window.qa = { recovery: false, calls: [], pending: [], hold: false, fail: false, serial: 0 };
    window.state = { profile: { id: 'rider', role: 'athlete', display_name: 'Ordinary rider', uci_id: '10000000001', groupName: 'online' }, user: { id: 'rider', email: 'rider@example.invalid' }, view: 'home', sessionSetupVersion: 1, notificationUnread: [] };
    window.fixture = {
      schemaVersion: 1, eventBreakdowns: {}, checkedAt: new Date().toISOString(),
      categories: {
        men: { rankingDate: new Date().toISOString().slice(0, 10), sourceUrl: 'https://dataride.uci.org/iframe/RankingDetails/156', rows: [
          { rank: 1, name: 'POINTS Rider', nation: 'AUS', points: 123, uciId: '10000000001' },
          { rank: 2, name: 'ZERO Rider', nation: 'GER', points: 0, uciId: '10000000002' },
        ] },
        women: { rankingDate: new Date().toISOString().slice(0, 10), sourceUrl: 'https://dataride.uci.org/iframe/RankingDetails/157', rows: [
          { rank: 1, name: 'POINTS Woman', nation: 'GER', points: 350, uciId: '10000000003' },
        ] },
      },
    };
    window.fetch = async (url, options) => {
      qa.calls.push({ url: String(url), credentials: options?.credentials });
      const result = structuredClone(fixture), fail = qa.fail;
      if (qa.hold) await new Promise(resolve => qa.pending.push(resolve));
      if (fail) throw Error('Synthetic offline feed');
      return { ok: true, json: async () => result };
    };
    window.escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    window.isCoachRole = role => ['coach', 'admin'].includes(role);
    window.riderRecoveryActive = () => qa.recovery;
    window.riderFeaturesDisabled = window.riderFeatureAccessUnknown = () => false;
    window.avatarHtml = () => '<span class="avatar">RT</span>';
    window.withTimeout = promise => promise;
    window.cacheClear = window.invalidateLeaderboardUciLinks = () => {};
    window.messageFrom = error => error.message;
    window.client = { from: table => {
      const query = { update: values => { query.values = values; return query; }, eq: (key, id) => { query.id = id; return query; }, select: () => query,
        single: async () => ({ data: { id: query.id, uci_id: query.values.uci_id } }) };
      return query;
    } };
    window.setSyncStatus = window.refreshNotificationCentre = window.refreshBoardChatUnread = window.showNotificationDrawer = window.signOutCurrentDevice = () => {};
    window.navigate = view => {
      state.view = view;
      document.querySelectorAll('.nav-btn[data-view]').forEach(button => button.classList.toggle('active', athletePrimaryView(button.dataset.view) === athletePrimaryView(view)));
    };
    window.qaIdentity = uciId => {
      state.profile = { ...state.profile, id: state.user.id, role: 'athlete', uci_id: uciId };
      renderShell();
    };
    window.qaRefresh = async mutate => {
      if (mutate) mutate(fixture);
      fixture.checkedAt = new Date(Date.now() + ++qa.serial * 1000).toISOString();
      return JKCUciRankings.load({ force: true });
    };
  }, stored);
  await page.addScriptTag({ path: path.join(root, 'uci-rankings.js') });
  await page.addScriptTag({ content: ['athleteNav', 'coachNav', 'parentNav', 'coachNavGroups'].map(array).join('\n') + '\n' + helpers.map(extract).join('\n') });
  const rankingListener = source.match(/^window\.addEventListener\("jkcrew:uci-rankings-updated", updateRiderUciNavigation\);/m);
  assert(rankingListener, 'Production ranking update listener exists');
  await page.addScriptTag({ content: rankingListener[0] });
  return { page, context, errors };
}
const count = page => page.locator('.bottom-nav [data-view="uciTracker"]').count();
(async () => {
  browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const { page, context, errors } = await pageFor();
  // Initial feed is held: Home/Session remain usable and no unverified tab flashes.
  await page.evaluate(() => { qa.hold = true; renderShell(); document.querySelector('#view').innerHTML = '<input id="private-draft" value="Keep my unsaved run">'; window.savedView = document.querySelector('#view'); });
  eq(await count(page), 0, 'No LA28 tab before point evidence is loaded');
  await page.evaluate(() => { navigate('session'); window.sharedLoad = JKCUciRankings.load(); });
  eq(await page.evaluate(() => qa.calls.length), 1, 'Shell and Home-equivalent concurrent reads share one public download');
  await page.evaluate(async () => { qa.hold = false; qa.pending.splice(0).forEach(resolve => resolve()); await sharedLoad; });
  eq(await count(page), 1, 'Positive official points reveal the rider tab asynchronously');
  eq(await page.evaluate(() => state.view), 'session', 'Late rankings never navigate away from the current screen');
  ok(await page.evaluate(() => document.querySelector('#view') === savedView), 'Async tab update preserves the exact page DOM');
  eq(await page.locator('#private-draft').inputValue(), 'Keep my unsaved run', 'Async tab update preserves unsaved input');
  eq(await page.locator('.bottom-nav [data-view="uciTracker"]').getAttribute('aria-label'), 'Road to LA28', 'Short tab retains a full accessible name');
  eq(await page.evaluate(() => state.profile.groupName), 'online', 'Non-elite riders qualify when they have official points');
  await page.evaluate(() => qaIdentity('10000000003')); eq(await count(page), 1, 'Women with official points also qualify');
  await page.evaluate(() => { state.profile.groupName = 'elite'; qaIdentity('10000000002'); }); eq(await count(page), 0, 'Elite membership cannot override zero official points');
  for (const id of ['', '10000000999', 'not-an-id']) {
    await page.evaluate(id => qaIdentity(id), id); eq(await count(page), 0, 'Missing/unmatched/invalid link does not show tab: ' + id);
  }
  await page.evaluate(() => qaIdentity('10000000001'));
  await page.evaluate(() => qaRefresh(data => { data.categories.men.rows[0].points = 0; }));
  eq(await count(page), 0, 'A newer official zero-point snapshot removes the tab');
  await page.evaluate(() => qaRefresh(data => { data.categories.men.rows[0].points = 200; }));
  eq(await count(page), 1, 'Later earned UCI points reveal the tab again');
  await page.evaluate(() => qaRefresh(data => { data.categories.women.rows.push({ ...data.categories.men.rows[0], rank: 2 }); }));
  eq(await count(page), 0, 'Ambiguous duplicated UCI identity cannot qualify a rider');
  await page.evaluate(() => qaRefresh(data => { data.categories.women.rows.pop(); }));
  eq(await count(page), 1, 'Unique identity restores eligibility');
  await page.evaluate(() => { qa.fail = true; return JKCUciRankings.load({ force: true }); });
  eq(await count(page), 1, 'Offline refresh preserves last verified positive-point navigation');
  ok(await page.evaluate(() => JKCUciRankings.peek().stale), 'Offline snapshot remains explicitly stale');
  await page.evaluate(() => { qa.fail = false; });
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('jkcrew-uci-rankings-v1')));
  const restored = await pageFor({ stored }); await restored.page.evaluate(() => { qa.fail = true; renderShell(); });
  eq(await count(restored.page), 1, 'Validated cached points show the tab immediately after restart');
  eq(await restored.page.evaluate(() => qa.calls.length), 0, 'Warm restart does not redownload public rankings');
  await restored.context.close();
  // Saving or removing the actual profile link updates only the nav, not the form.
  await page.evaluate(() => {
    document.querySelector('#view').innerHTML = '<form data-uci-profile-form><input name="uciId" value=""><p data-uci-link-feedback></p><button>Save</button></form>';
    window.linkForm = document.querySelector('[data-uci-profile-form]');
    return saveUciProfileLink({ preventDefault() {}, currentTarget: linkForm }, state.user.id);
  });
  eq(await count(page), 0, 'Saving UCI unlink immediately removes the nav tab');
  ok(await page.evaluate(() => linkForm.isConnected), 'Saving UCI unlink preserves the existing profile form');
  await page.evaluate(() => { linkForm.elements.uciId.value = '10000000003'; return saveUciProfileLink({ preventDefault() {}, currentTarget: linkForm }, state.user.id); });
  eq(await count(page), 1, 'Saving a points-bearing women link immediately adds the tab');
  ok(await page.evaluate(() => linkForm.isConnected), 'Saving linked identity does not rebuild the profile screen');
  await page.evaluate(() => { linkForm.elements.uciId.value = '10000000002'; return saveUciProfileLink({ preventDefault() {}, currentTarget: linkForm }, state.user.id); });
  eq(await count(page), 0, 'Saving a valid zero-point link keeps LA28 hidden');
  await page.evaluate(() => qaIdentity('10000000001'));
  const noLink = await pageFor();
  await noLink.page.evaluate(() => qaIdentity(''));
  eq(await noLink.page.evaluate(() => qa.calls.length), 0, 'Unlinked rider launches without any UCI feed download');
  eq(await count(noLink.page), 0, 'Unlinked rider cold launch has no LA28 tab');
  await noLink.context.close();
  const unavailable = await pageFor();
  await unavailable.page.evaluate(async () => { qa.fail = true; renderShell(); try { await JKCUciRankings.load(); } catch {} });
  eq(await count(unavailable.page), 0, 'Unavailable remote and seed do not guess eligibility');
  eq(await unavailable.page.locator('.bottom-nav .nav-btn').count(), 6, 'Unavailable feed leaves normal navigation usable');
  eq(unavailable.errors, [], 'Public feed outage has no uncaught browser errors');
  await unavailable.context.close();
  // An account switch while public data refreshes must use the current linked identity.
  await page.evaluate(() => { qa.hold = true; window.heldLoad = JKCUciRankings.load({ force: true }); state.user = { id: 'new-user', email: 'new@example.invalid' }; state.sessionSetupVersion++; qaIdentity('10000000002'); });
  eq(await count(page), 0, 'Account switch immediately removes the previous rider tab');
  await page.evaluate(async () => { qa.hold = false; qa.pending.splice(0).forEach(resolve => resolve()); await heldLoad; });
  eq(await count(page), 0, 'Delayed old request cannot grant tab to a zero-point account');
  // Both six- and seven-destination layouts must remain readable on phones/tablets.
  for (const theme of ['dark', 'light']) for (const width of [320, 375, 390, 430, 768]) for (const eligible of [false, true]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(({ theme, eligible }) => {
      document.documentElement.dataset.theme = theme;
      state.notificationUnread = [...Array(10)].flatMap(() => [{ view: 'home' }, { view: 'session' }, { view: 'challenges' }, { view: 'contests' }, { view: 'uciSchedule' }, { view: 'board' }]);
      qa.recovery = false; qaIdentity(eligible ? '10000000001' : '10000000002'); navigate(eligible ? 'uciTracker' : 'contests');
    }, { theme, eligible });
    await page.evaluate(() => document.fonts.ready);
    const layout = await page.evaluate(() => {
      const nav = document.querySelector('.bottom-nav'), buttons = [...nav.querySelectorAll('.nav-btn')];
      return { count: buttons.length, rows: [...new Set(buttons.map(b => b.getBoundingClientRect().y))].length,
        targets: buttons.every(b => b.getBoundingClientRect().width >= 44 && b.getBoundingClientRect().height >= 44),
        overflow: document.documentElement.scrollWidth > innerWidth || nav.scrollWidth > nav.clientWidth,
        active: buttons.filter(b => b.classList.contains('active')).map(b => b.dataset.view) };
    });
    eq(layout.count, eligible ? 7 : 6, `${theme}/${width}/${eligible}: correct tab count`);
    eq(layout.rows, 1, `${theme}/${width}/${eligible}: one row`);
    ok(layout.targets && !layout.overflow, `${theme}/${width}/${eligible}: touch targets fit without overflow`);
    eq(layout.active, [eligible ? 'uciTracker' : 'contests'], `${theme}/${width}/${eligible}: independent active destination`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => qaIdentity('10000000001')); ok(await page.locator('.sidebar [data-view="uciTracker"]').isVisible(), 'Eligible desktop rider has sidebar tab');
  await page.evaluate(() => qaIdentity('10000000002')); eq(await page.locator('.sidebar [data-view="uciTracker"]').count(), 0, 'Unranked desktop rider has no sidebar tab');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const role of ['parent', 'coach']) {
    await page.evaluate(role => { state.profile.role = role; renderShell(); }, role);
    eq(await count(page), 0, role + ' primary navigation has no rider-only tab');
    eq(await page.locator('.bottom-nav .nav-btn').count(), 6, role + ' keeps existing six destinations');
    await page.evaluate(() => qaRefresh()); eq(await count(page), 0, role + ' is unchanged after ranking update event');
  }
  await page.evaluate(() => { state.profile.role = 'athlete'; state.profile.uci_id = '10000000001'; qa.recovery = true; renderShell(); });
  eq(await count(page), 0, 'Recovery mode does not show LA28 even with points');
  ok(await page.locator('.bottom-nav').isHidden(), 'Recovery navigation stays hidden');
  await page.evaluate(() => qaRefresh()); eq(await count(page), 0, 'Ranking update cannot reintroduce recovery controls');
  eq(errors, [], 'No browser exceptions throughout identity and ranking transitions');
  await context.close();
  console.log(`PASS: ${checks} points-gated Road to LA28 navigation checks.`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); });
