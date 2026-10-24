// Coach dashboard UCI summary using production renderers and isolated public-feed fixtures.
// No accounts, live databases, or production writes are used.
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
const panelHtml = extract('renderCoachCommand').match(/<section class="panel command-uci-panel[\s\S]*?<\/section>/)?.[0];
assert(panelHtml, 'Use the actual Coach Command ranking panel markup');
let browser, checks = 0;
const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
const ok = (actual, label) => { assert(actual, label); checks++; };
(async () => {
  browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const request = new URL(route.request().url());
    if (request.href === 'http://jkcrew.test/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html data-theme="dark"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="app" class="coach-shell" style="display:block"><main id="view" data-view="command" style="padding:16px;max-width:1200px;margin:auto"></main></div></body></html>' });
    if (request.origin === 'http://jkcrew.test' && /^(?:\/fonts\/|\/icons\/jkc-logo\.png$)/.test(request.pathname)) {
      const filename = path.join(root, request.pathname);
      if (fs.existsSync(filename)) return route.fulfill({ body: fs.readFileSync(filename), contentType: request.pathname.endsWith('.png') ? 'image/png' : 'font/woff2' });
    }
    return route.abort();
  });
  await page.goto('http://jkcrew.test/');
  await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'styles.css'), 'utf8') });
  await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'uci-rankings.js'), 'utf8') });
  await page.evaluate(panelHtml => {
    window.state = { user: { id: 'coach-one' }, profile: { role: 'coach' }, view: 'command', sessionSetupVersion: 1, boardLeaderboardView: 'weekly', boardUciSearch: '' };
    window.escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
    window.isCoachRole = role => ['coach', 'admin'].includes(role);
    window.avatarHtml = profile => '<span class="avatar">' + escapeHtml(profile.display_name?.slice(0, 2) || 'JK') + '</span>';
    window.qa = { calls: [], navigations: [], fail: false, stale: false, hold: false, pending: [], generation: 0, databaseCalls: [] };
    window.navigate = view => { qa.navigations.push(view); state.view = view; };
    window.client = new Proxy({}, { get(_object, key) { return () => { qa.databaseCalls.push(key); throw Error('The dashboard summary must reuse its existing roster'); }; } });
    const row = (uciId, name, rank, points, nation = 'GER') => ({ uciId, name, rank, points, nation, change: 0 });
    window.qaSnapshot = {
      schemaVersion: 1, checkedAt: '2026-10-24T12:00:00Z', categories: {
        men: { rankingDate: '2026-10-20', sourceUrl: 'https://dataride.uci.org/iframe/RankingDetails/156', rows: [
          ...Array.from({ length: 7 }, (_, index) => row('1000000000' + (index + 1), 'RIDER Male ' + (index + 1), 13 + index * 8, 2610 - index * 100)),
          row('10000000800', 'DUPLICATE Profile', 80, 400),
          row('10000000700', 'AMBIGUOUS Feed', 90, 300),
          row('10000000900', 'ZERO Points', 100, 0),
          row('10000000999', 'OUTSIDE Crew', 110, 12),
        ] },
        women: { rankingDate: '2026-10-21', sourceUrl: 'https://dataride.uci.org/iframe/RankingDetails/157', rows: [
          ...Array.from({ length: 3 }, (_, index) => row('1000000010' + (index + 1), 'RIDER Woman ' + (index + 1), 8 + index * 5, 1985 - index * 250, 'AUS')),
          row('10000000700', 'AMBIGUOUS Feed', 40, 200),
        ] },
      },
    };
    window.qaRoster = [
      ...Array.from({ length: 7 }, (_, index) => ({ id: 'man-' + (index + 1), display_name: 'Crew nickname ' + (index + 1), uci_id: '1000000000' + (index + 1), role: 'athlete' })),
      ...Array.from({ length: 3 }, (_, index) => ({ id: 'woman-' + (index + 1), display_name: 'Our rider ' + (index + 1), uci_id: '1000000010' + (index + 1), role: 'athlete' })),
      { id: 'zero', display_name: 'Zero Rider', uci_id: '10000000900' },
      { id: 'not-found', display_name: 'RIDER Male 1', uci_id: '19999999999' },
      { id: 'unlinked', display_name: 'RIDER Male 1', uci_id: null },
      { id: 'duplicate-a', display_name: 'Duplicate A', uci_id: '10000000800' },
      { id: 'duplicate-b', display_name: 'Duplicate B', uci_id: '10000000800' },
      { id: 'feed-duplicate', display_name: 'Ambiguous Feed', uci_id: '10000000700' },
    ];
    window.qaRoster.push({ ...qaRoster[0] }); // Same rider twice is one identity, not two riders.
    window.qaRoster.reverse(); // Roster order must never replace official rank order.
    window.qaOriginalRoster = structuredClone(qaRoster);
    const findRider = JKCUciRankings.findRider;
    window.JKCUciRankings = { findRider, load: async options => {
      qa.calls.push(options || {});
      const snapshot = { ...structuredClone(qaSnapshot), stale: qa.stale };
      if (qa.hold) await new Promise(resolve => qa.pending.push(resolve));
      if (qa.fail) throw Error('Synthetic private diagnostic should not be displayed');
      return snapshot;
    } };
    window.qaRender = () => {
      state.view = 'command'; qa.generation++;
      const generation = qa.generation, userId = state.user.id, setupVersion = state.sessionSetupVersion;
      document.querySelector('#view').innerHTML = panelHtml;
      const panel = document.querySelector('[data-command-uci]');
      return loadCommandUciLeaderboard(panel, qaRoster, () => state.view === 'command' && state.user.id === userId && state.sessionSetupVersion === setupVersion && qa.generation === generation && panel.isConnected);
    };
  }, panelHtml);
  await page.addScriptTag({ content: ['boardUciSourceUrl','boardUciDate','boardUciSearchText','boardUciMembers','commandUciRosterMembers','commandUciLeaderboardHtml','loadCommandUciLeaderboard'].map(extract).join('\n') });
  await page.evaluate(() => qaRender());
  const riders = () => page.locator('[data-command-uci-rider]');
  eq(await riders().count(), 10, 'Every positively ranked crew member appears, without a top-five cutoff');
  eq(await riders().evaluateAll(nodes => nodes.map(node => node.dataset.commandUciRider)), ['man-1','man-2','man-3','man-4','man-5','man-6','man-7','woman-1','woman-2','woman-3'], 'Men and women retain their own official rank order; duplicate identities, zero points and unmatched riders are excluded');
  let content = await page.locator('[data-command-uci-content]').innerText();
  ok(/men/i.test(content) && /women/i.test(content), 'Both UCI ranking categories have visible labels');
  ok(content.includes('#13') && content.includes('#8'), 'Official world ranks remain visible rather than filtered positions');
  ok(/2[,.]?610/.test(content) && /1[,.]?985/.test(content), 'Official points are visible for men and women');
  ok(content.includes('20 Oct 2026') && content.includes('21 Oct 2026'), 'Each category shows its actual ranking date');
  await page.locator('[data-command-uci-rider="man-7"]').click();
  eq(await page.evaluate(() => [qa.navigations.at(-1), state.boardLeaderboardView, state.boardUciSearch]), ['board','uciMen','RIDER Male 7'], 'A rider below the first five opens the official Men leaderboard at their exact UCI name');
  await page.evaluate(() => qaRender());
  await page.locator('[data-command-uci-rider="woman-2"]').click();
  eq(await page.evaluate(() => [qa.navigations.at(-1), state.boardLeaderboardView, state.boardUciSearch]), ['board','uciWomen','RIDER Woman 2'], 'Women open their own leaderboard and official name');
  const beforeStaleClick = await page.evaluate(() => qa.navigations.length);
  await page.locator('[data-command-uci-rider="woman-2"]').evaluate(button => button.click());
  eq(await page.evaluate(() => qa.navigations.length), beforeStaleClick, 'A row left over after navigation cannot trigger another navigation');
  await page.evaluate(() => { qa.stale = true; return qaRender(); });
  content = await page.locator('[data-command-uci-content]').innerText();
  eq(await riders().count(), 10, 'Last available verified ranks remain visible when refresh is unavailable');
  ok(/last available|could not|couldn.t|cached|confirm|older/i.test(content), 'Stale ranking data is clearly identified');
  ok(await page.locator('[data-command-uci-retry]').isVisible(), 'Stale ranks have an explicit refresh action');
  await page.evaluate(() => { qa.stale = false; });
  await page.locator('[data-command-uci-retry]').click();
  await page.waitForFunction(() => qa.calls.at(-1)?.force === true);
  await page.evaluate(() => { qa.fail = true; return qaRender(); });
  ok(await page.locator('[data-command-uci-retry]').isVisible(), 'An unavailable feed offers retry');
  ok(!(await page.locator('[data-command-uci-content]').innerText()).includes('Synthetic private diagnostic'), 'Feed diagnostics are not shown to coaches');
  const beforeRetry = await page.evaluate(() => qa.calls.length);
  await page.evaluate(() => { qa.fail = false; qa.hold = true; const button = document.querySelector('[data-command-uci-retry]'); button.click(); button.click(); });
  await page.waitForFunction(() => qa.pending.length > 0);
  eq(await page.evaluate(() => qa.calls.length), beforeRetry + 1, 'Rapid retry taps create only one pending feed request');
  await page.evaluate(() => { qa.hold = false; qa.pending.splice(0).forEach(resolve => resolve()); });
  await page.waitForFunction(() => document.querySelectorAll('[data-command-uci-rider]').length === 10);
  await page.evaluate(() => { qa.fail = true; document.querySelector('[data-command-uci-retry]').click(); });
  await page.waitForFunction(() => !document.querySelector('[data-command-uci]').uciPending);
  eq(await riders().count(), 10, 'A failed refresh retains the last verified leaderboard rows');
  ok(/last available|couldn.t refresh/i.test(await page.locator('[data-command-uci-status]').innerText()), 'Refresh failure explains that displayed ranks are retained');
  await page.evaluate(() => { qa.fail = false; });
  for (const theme of ['dark','light']) for (const width of [320,390,768,1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    const overflow = await page.locator('[data-command-uci]').evaluate(panel => [...panel.querySelectorAll('*'),panel].filter(node => {
      const style = getComputedStyle(node); return style.display !== 'inline' && node.clientWidth && node.scrollWidth > node.clientWidth + 2 && !['auto','scroll'].includes(style.overflowX);
    }).map(node => ({ tag: node.tagName, class: node.className, width: node.clientWidth, content: node.scrollWidth })));
    eq(overflow, [], theme + ' coach ranking summary fits ' + width + 'px');
    for (const button of await page.locator('[data-command-uci] button:visible,[data-command-uci] a:visible').all()) ok((await button.boundingBox()).height >= 44, 'Ranking links, official sources and refresh retain 44px tap targets');
    if (theme === 'light') {
      const contrast = await page.locator('[data-command-uci]').evaluate(panel => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        const rgba = value => { context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1); return Array.from(context.getImageData(0, 0, 1, 1).data); };
        const luminance = rgb => rgb.slice(0, 3).map(value => { const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
        return ['h2','.eyebrow','.command-uci-intro','.command-uci-name strong','.command-uci-rank','.command-uci-points','.uci-source-link','[data-command-uci-status]'].flatMap(selector => Array.from(panel.querySelectorAll(selector)).map(node => {
          let parent = node, background = [255,255,255]; const layers = [];
          while (parent) {
            const style = getComputedStyle(parent), level = [rgba(style.backgroundColor)];
            // The panel uses a pale opaque gradient over the dark coach shell.
            // Include its representative midpoint instead of testing against the
            // hidden shell behind that gradient.
            const stops = style.backgroundImage.match(/rgba?\([^)]+\)|color\([^)]+\)/g);
            if (stops?.length) {
              const colors = stops.map(rgba);
              level.push(colors[0].map((_, index) => colors.reduce((sum, color) => sum + color[index], 0) / colors.length));
            }
            layers.unshift(...level); parent = parent.parentElement;
          }
          for (const layer of layers) background = background.map((value, index) => layer[index] * layer[3] / 255 + value * (1 - layer[3] / 255));
          const foreground = rgba(getComputedStyle(node).color), a = luminance(foreground), b = luminance(background);
          return { selector, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), color: getComputedStyle(node).color };
        }));
      });
      for (const item of contrast) ok(item.ratio >= 4.5, item.selector + ' light-theme text has readable contrast at ' + width + 'px: ' + item.ratio.toFixed(2) + ' (' + item.color + ')');
    }
    if (process.env.JKCREW_SCREENSHOT_DIR && [390,1440].includes(width)) {
      fs.mkdirSync(process.env.JKCREW_SCREENSHOT_DIR, { recursive: true });
      await page.locator('[data-command-uci]').screenshot({ path: path.join(process.env.JKCREW_SCREENSHOT_DIR, 'jkcrew-uci-command-' + theme + '-' + width + '.png') });
    }
  }
  await page.evaluate(() => { qaRoster = qaOriginalRoster.filter(row => !row.uci_id || ['19999999999','10000000900','10000000800','10000000700'].includes(row.uci_id)); return qaRender(); });
  eq(await riders().count(), 0, 'No eligible crew identities produces no invented ranking');
  ok(/no |not |link/i.test(await page.locator('[data-command-uci-content]').innerText()), 'Empty rankings explain why the list is empty');
  const beforeUnlinked = await page.evaluate(() => qa.calls.length);
  await page.evaluate(() => { qaRoster = [{ id: 'new-rider', display_name: 'New rider', uci_id: null }]; return qaRender(); });
  eq(await page.evaluate(() => qa.calls.length), beforeUnlinked, 'No linked UCI IDs avoids an unnecessary ranking download');
  for (const transition of ['navigate','account','render','setup','detached']) {
    await page.evaluate(() => { qaRoster = structuredClone(qaOriginalRoster); qa.hold = true; window.qaInFlight = qaRender(); });
    await page.waitForFunction(() => qa.pending.length > 0);
    await page.evaluate(transition => {
      if (transition === 'navigate') state.view = 'profile';
      if (transition === 'account') state.user.id = 'different-coach';
      if (transition === 'render') qa.generation++;
      if (transition === 'setup') state.sessionSetupVersion++;
      if (transition === 'detached') document.querySelector('#view').innerHTML = '<div id="new-view">New screen stays here</div>';
      else document.querySelector('[data-command-uci-content]').innerHTML = '<div id="new-view">New screen stays here</div>';
      qa.hold = false; qa.pending.splice(0).forEach(resolve => resolve()); return qaInFlight;
    }, transition);
    eq(await page.locator('#new-view').innerText(), 'New screen stays here', transition + ' makes a late feed response inert');
  }
  await page.evaluate(() => {
    qaSnapshot.categories.men.rows[0].name = '<img src=x onerror="window.injected=true">';
    qaRoster.find(row => row.id === 'man-1').display_name = '<svg onload="window.injected=true">';
    return qaRender();
  });
  eq(await page.locator('[data-command-uci] img[src="x"],[data-command-uci] svg,[data-command-uci] script').count(), 0, 'Rider and official-source names cannot inject HTML');
  eq(await page.evaluate(() => Boolean(window.injected)), false, 'No untrusted name executes');
  eq(await page.evaluate(() => qa.databaseCalls), [], 'The summary reuses the loaded coach roster without extra database reads');
  const command = extract('renderCoachCommand');
  ok(command.includes('data-command-uci'), 'Actual Coach Command includes the ranking panel');
  ok(command.indexOf('coachSharedEventsSummaryHtml') < command.indexOf('data-command-uci') && command.indexOf('data-command-uci') < command.indexOf('commandParkKingsAccordionHtml'), 'Rankings are placed directly after Upcoming Events and before Park Kings');
  ok(command.includes('loadCommandUciLeaderboard'), 'Actual Coach Command loads the ranking summary');
  ok(command.includes('state.sessionSetupVersion === setupVersion'), 'Actual dashboard validity guard includes the authenticated session generation');
  ok(extract('getCoachRoster').includes('uci_id'), 'Coach roster summary carries the exact UCI identity');
  eq(errors, [], 'No uncaught browser exceptions');
  console.log('PASS: ' + checks + ' coach UCI ranking checks (all crew identities, men/women, official points/dates, deep links, duplicate/zero exclusions, no extra DB reads, safe retries, stale response guards, 320–1440px themes).');
  await browser.close();
})().catch(async error => { console.error(error); if (browser) await browser.close(); process.exitCode = 1; });
