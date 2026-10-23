// Actual leaderboard UI against synthetic data. No production account or API writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const extract = name => {
  const start = app.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'));
  assert(start >= 0, 'Production function exists: ' + name);
  const rest = app.slice(start);
  return rest.slice(0, rest.indexOf('\n}') + 2);
};
const functions = ['boardLeaderboardViews', 'boardRankingsShellHtml', 'boardUciSourceUrl', 'boardUciDate', 'boardUciSearchText', 'updateBoardUciRows', 'renderBoardRankings', 'bindBoardRankings', 'renderBoard', 'leaderboardWithBenchmark'];
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH });
  const errors = [];
  let checks = 0;
  const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
  const ok = (actual, message) => { assert(actual, message); checks++; };
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.request().url() === 'http://jkcrew.test/'
      ? route.fulfill({ contentType: 'text/html', body: '<meta name="viewport" content="width=device-width,initial-scale=1"><div class="app-shell rider-shell" style="display:block"><main id="view" class="content" data-view="board"></main></div>' })
      : route.abort());
    await page.goto('http://jkcrew.test/');
    await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'styles.css'), 'utf8') });
    await page.evaluate(() => {
      window.state = { view: 'board', user: { id: 'rider-a' }, profile: { role: 'athlete' }, sessionSetupVersion: 1, boardLeaderboardView: 'weekly', boardUciLimit: 50 };
      window.qa = { reads: { jkc: 0, chat: 0, reports: 0 }, uci: [], fail: false, stale: false, delayNext: false, release: null, jkcDelay: false, releaseJkc: null };
      window.qaRows = [{ athlete_id: 'rider-a', display_name: 'Rider A', weekly_points: 20, all_time_points: 25 }, { athlete_id: 'rider-b', display_name: 'Rider B', weekly_points: 10, all_time_points: 300 }];
      window.qaSnapshot = { schemaVersion: 1, checkedAt: '2026-10-21T10:00:00Z', categories: {} };
      for (const [key, count] of [['men', 121], ['women', 61]]) qaSnapshot.categories[key] = {
        rankingDate: '2026-10-20', sourceUrl: 'https://dataride.uci.ch/iframe/RankingDetails/91',
        rows: Array.from({ length: count }, (_, i) => ({ rank: i + 11, name: key + ' Rider ' + i, nation: i % 2 ? 'GER' : 'AUS', points: 2000 - i, uciId: String(i), change: i % 2 ? -2 : 1 })),
      };
      qaSnapshot.categories.men.rows[0].name = 'Éli Park';
      qaSnapshot.categories.men.rows[1].name = '<img src=x onerror="window.injected=true">';
      window.JKCUciRankings = { load: async options => {
        qa.uci.push(options); const snapshot = { ...structuredClone(qaSnapshot), stale: qa.stale };
        if (qa.delayNext) { qa.delayNext = false; await new Promise(resolve => { qa.release = resolve; }); }
        if (qa.fail) throw Error('Synthetic failure');
        return snapshot;
      } };
      window.getLeaderboard = async () => { qa.reads.jkc++; if (qa.jkcDelay) { qa.jkcDelay = false; await new Promise(resolve => { qa.releaseJkc = resolve; }); } return structuredClone(qaRows); };
      window.getBoardChat = async () => { qa.reads.chat++; return []; };
      window.getOpenCrewReports = async () => { qa.reads.reports++; return []; };
      window.escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
      window.compactLeaderboardHtml = (rows, key) => rows.map(row => '<button data-public-athlete="' + row.athlete_id + '">' + row.display_name + ':' + row[key] + '</button>').join('');
      window.boardMentionableUsers = () => [];
      window.canPostBoardChat = () => ['coach', 'athlete'].includes(state.profile.role);
      window.isCoachRole = role => role === 'coach';
      window.scoreAdjustmentPanel = () => '';
      window.pointsHelpHtml = () => '';
      window.CHAT_LAST_SEEN_KEY = 'qa-seen';
      window.boardChatComposerHtml = () => '<form id="board-chat-form"><textarea id="board-message"></textarea><input type="file" id="qa-clip"></form>';
      for (const name of ['updateBoardChatNavBadge', 'openPublicAthleteProfile', 'submitScoreAdjustment', 'submitPointRecalculation', 'submitBoardChat', 'toggleBoardReaction', 'openMentionedAthleteProfile', 'startBoardReply', 'toggleBoardPin', 'reportBoardPost', 'deleteBoardPost', 'dismissBoardReport', 'bindBoardChatComposer']) window[name] = () => {};
    });
    await page.addScriptTag({ content: functions.map(extract).join('\n') });
    const choose = key => page.locator('[data-board-view="' + key + '"]').click();
    const waitUci = () => page.locator('[data-uci-search]').waitFor();
    for (const role of ['athlete', 'coach']) {
      await page.evaluate(role => { state.profile.role = role; state.boardLeaderboardView = 'weekly'; state.view = 'board'; return renderBoard(); }, role);
      eq(await page.getByRole('tab').allTextContents(), ['JKC Weekly', 'JKC All-Time', 'UCI Men', 'UCI Women'], role + ' sees all four boards');
      eq(await page.locator('[role="tab"][aria-selected="true"]').count(), 1, 'Exactly one tab is selected');
    }
    eq(await page.evaluate(() => qa.uci.length), 0, 'UCI is lazy and never requested when JKC board opens');
    await page.locator('#board-message').fill('Keep this unsent message');
    await page.locator('#qa-clip').setInputFiles({ name: 'riding.webm', mimeType: 'video/webm', buffer: Buffer.from('synthetic') });
    const initialReads = await page.evaluate(() => qa.reads);
    await choose('allTime');
    eq(await page.locator('.leaderboard button').allTextContents(), ['Rider B:300', 'Rider A:25'], 'All-time preserves JKC score values and sorts by lifetime total');
    await choose('uciMen'); await waitUci();
    eq(await page.locator('[data-uci-rows] [role="row"]').count(), 50, 'Large UCI list starts with only 50 rendered riders');
    eq(await page.locator('.uci-rank').first().textContent(), '11', 'Source rank is preserved rather than recalculated from row index');
    eq(await page.locator('.uci-ranking-date time').textContent(), '20 Oct 2026', 'Official ranking date is prominent and not the download date');
    eq(await page.locator('[data-uci-rows] img').count(), 0, 'Untrusted UCI names are escaped');
    eq(await page.evaluate(() => Boolean(window.injected)), false, 'Source names cannot execute HTML');
    await page.locator('[data-uci-more]').click();
    eq(await page.locator('[data-uci-rows] [role="row"]').count(), 100, 'Show more adds next 50');
    await page.locator('[data-uci-search]').fill('eli');
    eq(await page.locator('[data-uci-rows] [role="row"]').count(), 1, 'Accent-insensitive name search works');
    eq(await page.locator('[data-uci-more]').isVisible(), false, 'Pagination control hides when every matching row is shown');
    await page.locator('[data-uci-search]').fill('GER');
    eq(await page.locator('[data-uci-rows] [role="row"]').count(), 50, 'Country code search starts a fresh bounded page');
    await page.locator('[data-uci-search]').fill('no match');
    ok(await page.locator('[data-uci-empty]').isVisible(), 'No-match state is clear');
    await choose('uciWomen'); await waitUci();
    eq(await page.locator('[data-uci-search]').inputValue(), '', 'Changing category clears the previous category search');
    ok((await page.locator('.uci-rider strong').first().textContent()).startsWith('women'), 'Women tab displays the correct official category');
    eq(await page.locator('#board-message').inputValue(), 'Keep this unsent message', 'Switching leaderboard keeps typed chat');
    eq(await page.locator('#qa-clip').evaluate(input => input.files[0]?.name), 'riding.webm', 'Switching leaderboard keeps selected chat video');
    eq(await page.evaluate(() => qa.reads), initialReads, 'Switching tabs does not refetch JKC, chat or coach reports');
    for (const theme of ['dark', 'light']) for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      const overflowing = await page.locator('[data-board-rankings]').evaluate(panel => [...panel.querySelectorAll('*')].filter(node => {
        const style = getComputedStyle(node);
        return style.display !== 'inline' && node.clientWidth && node.scrollWidth > node.clientWidth + 2 && !['auto', 'scroll'].includes(style.overflowX);
      }).map(node => ({ class: node.className, text: node.textContent.slice(0, 30), width: node.clientWidth, scroll: node.scrollWidth })));
      eq(overflowing, [], theme + ' leaderboard content fits ' + width + 'px');
      for (const tab of await page.getByRole('tab').all()) ok((await tab.boundingBox()).height >= 44, 'Tab has a 44px tap target');
      if (process.env.JKCREW_SCREENSHOT_DIR && [390, 1440].includes(width)) {
        fs.mkdirSync(process.env.JKCREW_SCREENSHOT_DIR, { recursive: true });
        await page.locator('[data-board-rankings]').screenshot({ path: path.join(process.env.JKCREW_SCREENSHOT_DIR, 'uci-' + theme + '-' + width + '.png') });
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-board-view="uciWomen"]').focus();
    await page.keyboard.press('Home');
    eq(await page.locator('[role="tab"][aria-selected="true"]').textContent(), 'JKC Weekly', 'Keyboard Home activates first tab');
    await page.keyboard.press('ArrowLeft'); await waitUci();
    eq(await page.locator('[role="tab"][aria-selected="true"]').textContent(), 'UCI Women', 'Keyboard arrow navigation wraps tabs');

    await choose('weekly');
    await page.evaluate(() => { qa.delayNext = true; });
    await choose('uciMen');
    await page.waitForFunction(() => Boolean(qa.release));
    await choose('uciWomen'); await waitUci();
    await page.evaluate(() => { qa.release(); qa.release = null; });
    await page.waitForTimeout(25);
    ok((await page.locator('.panel-title').first().textContent()).includes('Women'), 'Late Men response cannot overwrite selected Women ranking');
    await choose('weekly');
    await page.evaluate(() => { qa.fail = true; });
    await choose('uciMen');
    await page.getByText('Rankings couldn’t load').waitFor();
    eq(await page.getByRole('tab').count(), 4, 'Network failure retains all navigation choices');
    await page.evaluate(() => { qa.fail = false; qa.stale = true; });
    await page.locator('[data-uci-retry]').click(); await waitUci();
    ok(await page.locator('.uci-refresh-status.is-stale').isVisible(), 'Cached fallback is clearly marked stale');
    eq(await page.evaluate(() => qa.uci.at(-1).force), true, 'Retry forces a new refresh');
    eq(await page.locator('#board-message').inputValue(), 'Keep this unsent message', 'Failure/retry preserves chat draft');
    await page.evaluate(() => { qa.stale = false; });
    await page.locator('[data-uci-retry]').click(); await waitUci();
    eq(await page.locator('.is-stale').count(), 0, 'Successful refresh removes stale warning');
    eq(await page.evaluate(() => boardUciSourceUrl('javascript:alert(1)')), 'https://dataride.uci.ch/', 'Source link rejects script URLs');
    eq(await page.evaluate(() => boardUciSourceUrl('https://uci.org.evil.test/')), 'https://dataride.uci.ch/', 'Source link rejects deceptive domains');

    await choose('weekly');
    await page.evaluate(() => { qa.delayNext = true; });
    await choose('uciMen'); await page.waitForFunction(() => Boolean(qa.release));
    await page.evaluate(() => { state.view = 'home'; document.querySelector('#view').innerHTML = '<h1>Home page</h1>'; qa.release(); });
    await page.waitForTimeout(25);
    eq(await page.locator('#view').textContent(), 'Home page', 'Leaving board makes pending UCI responses inert');
    await page.evaluate(() => { state.view = 'board'; qa.jkcDelay = true; window.qaRender = renderBoard(); });
    await page.waitForFunction(() => Boolean(qa.releaseJkc));
    await page.evaluate(async () => { state.user = { id: 'another-user' }; state.sessionSetupVersion++; document.querySelector('#view').innerHTML = '<h1>New account</h1>'; qa.releaseJkc(); await qaRender; });
    eq(await page.locator('#view').textContent(), 'New account', 'Pending full board cannot paint into a new account');
    eq(errors, [], 'No browser errors');
    console.log('PASS: ' + checks + ' UCI leaderboard checks (roles, four tabs, source dates/ranks, safe links, lazy loading, search, pagination, mobile/light layouts, draft preservation, errors and stale-response guards).');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
