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
const functions = ['boardLeaderboardViews', 'boardRankingsShellHtml', 'boardUciSourceUrl', 'boardUciDate', 'boardUciSearchText', 'boardUciMembers', 'leaderUciRankHtml', 'leaderRow', 'compactLeaderboardHtml', 'loadJkcBoardUciRanks', 'updateBoardUciRows', 'renderBoardRankings', 'bindBoardRankings', 'renderBoard', 'leaderboardWithBenchmark'];
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH });
  const errors = [];
  let checks = 0;
  const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
  const ok = (actual, message) => { assert(actual, message); checks++; };
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.href === 'http://jkcrew.test/') return route.fulfill({ contentType: 'text/html', body: '<meta name="viewport" content="width=device-width,initial-scale=1"><div class="app-shell rider-shell" style="display:block"><main id="view" class="content" data-view="board"></main></div>' });
      if (url.origin === 'http://jkcrew.test' && url.pathname === '/icons/jkc-logo.png') return route.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join(root, 'icons/jkc-logo.png')) });
      return route.abort();
    });
    await page.goto('http://jkcrew.test/');
    await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'styles.css'), 'utf8') });
    await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'uci-rankings.js'), 'utf8') });
    await page.evaluate(() => {
      window.state = { view: 'board', user: { id: 'rider-a' }, profile: { role: 'athlete' }, sessionSetupVersion: 1, boardLeaderboardView: 'weekly', boardUciLimit: 50 };
      window.qa = { reads: { jkc: 0, chat: 0, reports: 0 }, uci: [], linkCalls: [], links: [], linkFail: false, linkDelay: false, releaseLinks: null, fail: false, stale: false, delayNext: false, release: null, jkcDelay: false, releaseJkc: null };
      window.qaRows = [{ athlete_id: 'rider-a', display_name: 'Rider A', weekly_points: 20, all_time_points: 25 }, { athlete_id: 'rider-b', display_name: 'Rider B', weekly_points: 10, all_time_points: 300 }];
      window.qaSnapshot = { schemaVersion: 1, checkedAt: '2026-10-21T10:00:00Z', categories: {} };
      for (const [key, count] of [['men', 121], ['women', 61]]) qaSnapshot.categories[key] = {
        rankingDate: '2026-10-20', sourceUrl: 'https://dataride.uci.ch/iframe/RankingDetails/91',
        rows: Array.from({ length: count }, (_, i) => ({ rank: i + 11, name: key + ' Rider ' + i, nation: i % 2 ? 'GER' : 'AUS', points: 2000 - i, uciId: String((key === 'men' ? 10000000000 : 20000000000) + i), change: i % 2 ? -2 : 1 })),
      };
      qaSnapshot.categories.men.rows[0].name = 'Éli Park';
      qaSnapshot.categories.men.rows[1].name = '<img src=x onerror="window.injected=true">';
      window.JKCUciRankings = { findRider: JKCUciRankings.findRider, load: async options => {
        qa.uci.push(options); const snapshot = { ...structuredClone(qaSnapshot), stale: qa.stale };
        if (qa.delayNext) { qa.delayNext = false; await new Promise(resolve => { qa.release = resolve; }); }
        if (qa.fail) throw Error('Synthetic failure');
        return snapshot;
      } };
      window.getLeaderboardUciLinks = async options => {
        qa.linkCalls.push(options);
        if (qa.linkDelay) { qa.linkDelay = false; await new Promise(resolve => { qa.releaseLinks = resolve; }); }
        if (qa.linkFail) throw Error('Synthetic link failure');
        return structuredClone(qa.links);
      };
      window.getLeaderboard = async () => { qa.reads.jkc++; if (qa.jkcDelay) { qa.jkcDelay = false; await new Promise(resolve => { qa.releaseJkc = resolve; }); } return structuredClone(qaRows); };
      window.getBoardChat = async () => { qa.reads.chat++; return []; };
      window.getOpenCrewReports = async () => { qa.reads.reports++; return []; };
      window.escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
      window.medalForRank = () => '';
      window.earnedBadges = badges => badges || [];
      window.riderXpSummary = () => ({ current_badge: 'qa-level' });
      window.countryBadge = row => '<span class="country-flag" title="' + (row.country_code === 'DE' ? 'Germany' : 'Australia') + '">' + (row.country_code === 'DE' ? '🇩🇪' : '🇦🇺') + '</span>';
      window.avatarHtml = row => '<div class="avatar">' + escapeHtml(row.display_name.slice(0, 2)) + '</div>';
      window.formatPbTime = value => String(value);
      window.leaderboardRankForRow = (_row, index) => index + 1;
      window.ghostModeLabelHtml = row => row.ghost_mode ? '<small>Ghost</small>' : '';
      window.pointsReceiptAttributes = id => 'data-points-receipt="' + escapeHtml(id) + '"';
      window.levelBadgeHtml = () => '<img class="qa-level-badge" alt="XP level" src="level.png">';
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
    eq(await page.locator('.leaderboard [data-public-athlete]').evaluateAll(rows => rows.map(row => [row.dataset.publicAthlete, row.querySelector('.points').textContent.trim()])), [['rider-b', '300 pts'], ['rider-a', '25 pts']], 'All-time preserves JKC score values and sorts by lifetime total');
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

    const identities = await page.evaluate(() => {
      const rows = [{ athlete_id: 'a' }, { athlete_id: 'b' }, { athlete_id: 'c' }, { athlete_id: 'bot', isBenchmarkBot: true }];
      const match = links => [...boardUciMembers(rows, links, qaSnapshot)].map(([id, entry]) => [id, entry.athleteId, entry.match.categoryKey]);
      return {
        exact: match([{ athlete_id: 'a', uci_id: '10000000000' }, { athlete_id: 'b', uci_id: '20000000000' }]),
        repeated: match([{ athlete_id: 'a', uci_id: '10000000000' }, { athlete_id: 'a', uci_id: '10000000000' }]),
        conflicts: match([{ athlete_id: 'a', uci_id: '10000000000' }, { athlete_id: 'b', uci_id: '10000000000' }]),
        excluded: match([{ athlete_id: 'hidden-rider', uci_id: '10000000000' }, { athlete_id: 'bot', uci_id: '20000000000' }, { athlete_id: 'c', uci_id: 'not-a-uci-id' }, { athlete_id: 'a', uci_id: '19999999999' }]),
        ambiguous: (() => {
          const snapshot = structuredClone(qaSnapshot);
          snapshot.categories.women.rows[0].uciId = '10000000000';
          return [...boardUciMembers(rows, [{ athlete_id: 'a', uci_id: '10000000000' }], snapshot)].length;
        })(),
      };
    });
    eq(identities.exact, [['10000000000', 'a', 'men'], ['20000000000', 'b', 'women']], 'Official stable IDs distinguish Men and Women without name matching');
    eq(identities.repeated, [['10000000000', 'a', 'men']], 'Repeated metadata for the same athlete does not lose a valid link');
    eq(identities.conflicts, [], 'Conflicting athlete claims never attribute the same UCI identity arbitrarily');
    eq(identities.excluded, [], 'Hidden accounts, benchmark rows, invalid IDs and absent official identities receive no affiliation');
    eq(identities.ambiguous, 0, 'An ambiguous identity in the official snapshot is never guessed');

    await page.evaluate(() => {
      qaSnapshot.categories.men.rows[0].name = 'KINDERMANN Lars';
      qaSnapshot.categories.women.rows[0].name = 'NORRIS Alirah';
      qaSnapshot.categories.men.rows[65].name = 'DE LA VERY LONG SURNAME Athlete With A Long Name';
      qaRows = Array.from({ length: 10 }, (_, i) => ({ athlete_id: 'rider-' + String.fromCharCode(97 + i), display_name: 'Rider ' + i, country_code: i % 2 ? 'AU' : 'DE', weekly_points: 20 - i, all_time_points: 25 + i * 100 }));
      qaRows[0].display_name = 'Lars';
      qaRows[1].display_name = 'Ali';
      qaRows[2].display_name = 'men Rider 2'; // An identical name without an approved identity link must not match.
      qaRows[3].display_name = 'Rider With A Very Long Display Name To Test Mobile Layout';
      qa.links = [
        { athlete_id: 'rider-a', uci_id: '10000000000' },
        { athlete_id: 'rider-b', uci_id: '20000000000' },
        { athlete_id: 'rider-d', uci_id: '10000000065' },
        { athlete_id: 'rider-e', uci_id: '10000000004' },
        { athlete_id: 'rider-f', uci_id: '10000000004' },
        { athlete_id: 'rider-g', uci_id: 'invalid' },
        { athlete_id: 'rider-h', uci_id: '19999999999' },
        { athlete_id: 'hidden-ghost', uci_id: '10000000005' },
      ];
      state.boardLeaderboardView = 'weekly';
      state.boardUciSearch = '';
      qa.delayNext = true;
      return renderBoard();
    });
    await page.waitForFunction(() => Boolean(qa.release));
    eq(await page.locator('[data-public-athlete="rider-a"] .points').textContent(), '20 pts', 'JKC points paint while optional UCI enrichment is still loading');
    eq(await page.locator('.leader-uci-rank').count(), 0, 'Pending UCI enrichment never fabricates a rank');
    eq(await page.locator('.qa-level-badge').count(), 0, 'Old XP badge image has been removed from JKC leaderboard names');
    await page.locator('.leaderboard-more summary').click();
    await page.locator('#board-message').fill('Keep this unsent message');
    await page.locator('#qa-clip').setInputFiles({ name: 'riding.webm', mimeType: 'video/webm', buffer: Buffer.from('synthetic') });
    await page.evaluate(() => { qa.release(); qa.release = null; });
    await page.waitForFunction(() => document.querySelectorAll('.leader-uci-rank').length === 3);
    eq(await page.locator('[data-public-athlete="rider-a"] .leader-uci-rank').textContent(), 'UCI #11Men', 'Men world rank appears beside the linked rider’s JKC display name');
    eq(await page.locator('[data-public-athlete="rider-b"] .leader-uci-rank').textContent(), 'UCI #11Women', 'Ali displays the linked Alirah Women ranking without guessing from her nickname');
    ok((await page.locator('[data-public-athlete="rider-a"] .leader-uci-rank').getAttribute('aria-label')).includes('20 Oct 2026'), 'Rank badge identifies the official ranking date accessibly');
    eq(await page.locator('[data-public-athlete="rider-c"] .leader-uci-rank').count(), 0, 'A matching display name alone never adds a UCI rank');
    eq(await page.locator('[data-public-athlete="rider-e"] .leader-uci-rank').count(), 0, 'Duplicate identity claims do not add a misleading rank badge');
    ok(await page.locator('.leaderboard-more').evaluate(node => node.open), 'Async rank enrichment preserves the expanded full leaderboard');
    eq(await page.locator('#board-message').inputValue(), 'Keep this unsent message', 'Async rank enrichment preserves typed chat');
    eq(await page.locator('#qa-clip').evaluate(input => input.files[0]?.name), 'riding.webm', 'Async rank enrichment preserves the selected chat attachment');
    await choose('allTime');
    await page.waitForFunction(() => document.querySelectorAll('.leader-uci-rank').length === 3);
    eq(await page.locator('.leaderboard [data-public-athlete]').first().getAttribute('data-public-athlete'), 'rider-j', 'UCI rank never replaces JKC all-time ordering');
    eq(await page.locator('[data-public-athlete="rider-a"] .points').textContent(), '25 pts', 'Official rank never replaces JKC all-time points');
    eq(await page.locator('[data-public-athlete="rider-b"] .leader-uci-rank').textContent(), 'UCI #11Women', 'All-time board receives the same official Women ranking');

    await choose('uciMen'); await waitUci();
    await page.locator('.uci-ranking-row.is-jkc').first().waitFor();
    eq(await page.locator('[data-uci-rows] .is-jkc .uci-rider strong').allTextContents(), ['KINDERMANN Lars'], 'Only approved visible JKC members receive a Men board affiliation');
    eq(await page.locator('.uci-jkc-mark img').first().getAttribute('src'), 'icons/jkc-logo.png?v=2.11.77', 'JKC mark uses the app’s real logo');
    await page.waitForFunction(() => [...document.querySelectorAll('.uci-jkc-mark img')].every(image => image.complete && image.naturalWidth > 0));
    ok(await page.locator('.uci-jkc-mark img').first().evaluate(image => image.naturalWidth > 0), 'The JKC logo asset successfully loads');
    eq(await page.locator('[data-uci-rows] [src="x"]').count(), 0, 'Official names stay escaped after adding the JKC logo');
    await page.locator('[data-uci-more]').click();
    eq(await page.locator('[data-uci-rows] .is-jkc .uci-rider strong').allTextContents(), ['KINDERMANN Lars', 'DE LA VERY LONG SURNAME Athlete With A Long Name'], 'Newly paginated rows retain exact-ID JKC affiliation');
    await page.locator('[data-uci-search]').fill('LONG SURNAME');
    eq(await page.locator('[data-uci-rows] .is-jkc').count(), 1, 'Name filtering preserves JKC affiliation');
    await page.setViewportSize({ width: 320, height: 844 });
    eq(await page.locator('.uci-ranking-row.is-jkc').evaluate(row => row.scrollWidth <= row.clientWidth + 2), true, 'Long official names plus JKC logo fit a 320px screen');
    await choose('uciWomen'); await waitUci();
    await page.locator('.uci-ranking-row.is-jkc').first().waitFor();
    eq(await page.locator('[data-uci-rows] .is-jkc .uci-rider strong').allTextContents(), ['NORRIS Alirah'], 'Women ranking highlights the approved official identity, not the app nickname');
    eq(await page.locator('[data-uci-rows] .is-jkc').getAttribute('role'), 'row', 'Highlighted rows retain table accessibility');

    await page.evaluate(() => { qa.fail = true; });
    await choose('weekly');
    await page.locator('[data-board-uci-retry]').waitFor();
    eq(await page.locator('[data-public-athlete="rider-a"] .points').textContent(), '20 pts', 'Failed UCI feed does not block JKC weekly points');
    eq(await page.locator('.leader-uci-rank').count(), 0, 'Failed feed never leaves a fabricated or mismatched rank');
    eq(await page.locator('#board-message').inputValue(), 'Keep this unsent message', 'Optional rank failure does not erase chat');
    await page.evaluate(() => { qa.fail = false; qa.stale = true; });
    await page.locator('[data-board-uci-retry]').click();
    await page.waitForFunction(() => document.querySelectorAll('.leader-uci-rank').length === 3);
    ok((await page.locator('[data-public-athlete="rider-a"] .leader-uci-rank').getAttribute('aria-label')).includes('Last available'), 'Cached UCI badge describes its stale status');
    eq(await page.evaluate(() => qa.uci.at(-1).force), true, 'JKC rank retry explicitly refreshes the feed');
    const feedReadsBeforeUnlink = await page.evaluate(() => qa.uci.length);
    await page.evaluate(() => { qa.savedLinks = qa.links; qa.links = []; });
    await page.locator('[data-board-uci-retry]').click();
    await page.waitForFunction(() => document.querySelectorAll('.leader-uci-rank').length === 0);
    eq(await page.locator('[data-board-uci-status]').textContent(), '', 'An empty refreshed link list clears all previously rendered rank chips');
    eq(await page.evaluate(() => qa.uci.length), feedReadsBeforeUnlink, 'Unlink refresh does not download the ranking feed again');
    eq(await page.locator('[data-public-athlete="rider-a"] .points').textContent(), '20 pts', 'Removing identity links leaves the JKC score intact');
    await page.evaluate(() => { qa.links = qa.savedLinks; });
    await page.evaluate(() => { qa.stale = false; qa.linkFail = true; });
    await choose('uciMen'); await waitUci();
    await page.locator('[data-uci-members-status]').getByRole('button').waitFor();
    eq(await page.locator('[data-uci-rows] [role="row"]').count(), 50, 'Unavailable JKC affiliation metadata never hides official rankings');
    eq(await page.locator('.uci-ranking-row.is-jkc').count(), 0, 'Failed private metadata cannot leak previous affiliation markers');
    await page.evaluate(() => { qa.linkFail = false; });
    await page.locator('[data-uci-members-status]').getByRole('button').click();
    await page.locator('.uci-ranking-row.is-jkc').first().waitFor();
    eq(await page.locator('.uci-ranking-row.is-jkc').count(), 1, 'Retry restores permitted JKC affiliation');

    for (const selected of ['weekly', 'uciMen']) {
      await choose(selected);
      await page.waitForFunction(selected => selected === 'weekly' ? document.querySelectorAll('.leader-uci-rank').length === 3 : Boolean(document.querySelector('.uci-ranking-row.is-jkc')), selected);
      if (selected === 'weekly') await page.locator('.leaderboard-more summary').click();
      else await page.locator('[data-uci-search]').fill('LONG SURNAME');
      for (const theme of ['dark', 'light']) for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 844 });
        await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
        const overflow = await page.locator('[data-board-rankings]').evaluate(panel => [...panel.querySelectorAll('*')].filter(node => {
          const style = getComputedStyle(node);
          return style.display !== 'inline' && node.clientWidth && node.scrollWidth > node.clientWidth + 2 && !['auto', 'scroll'].includes(style.overflowX);
        }).map(node => ({ class: node.className, width: node.clientWidth, scroll: node.scrollWidth })));
        eq(overflow, [], selected + ' linked-rider badges fit ' + theme + ' ' + width + 'px');
        if (process.env.JKCREW_SCREENSHOT_DIR && [390, 1440].includes(width)) await page.locator('[data-board-rankings]').screenshot({ path: path.join(process.env.JKCREW_SCREENSHOT_DIR, selected + '-linked-' + theme + '-' + width + '.png') });
      }
    }

    await choose('weekly');
    await page.waitForFunction(() => document.querySelectorAll('.leader-uci-rank').length === 3);
    await page.evaluate(() => { qa.linkDelay = true; });
    await choose('uciMen'); await waitUci();
    await page.waitForFunction(() => Boolean(qa.releaseLinks));
    eq(await page.locator('[data-uci-rows] [role="row"]').count(), 50, 'Official rankings remain usable while JKC identity metadata is pending');
    await choose('uciWomen'); await waitUci();
    await page.locator('.uci-ranking-row.is-jkc').first().waitFor();
    await page.evaluate(() => { qa.releaseLinks(); qa.releaseLinks = null; });
    await page.waitForTimeout(25);
    eq(await page.locator('[data-uci-rows] .is-jkc .uci-rider strong').allTextContents(), ['NORRIS Alirah'], 'Delayed Men affiliation cannot overwrite the current Women view');
    await choose('weekly');
    await page.waitForFunction(() => document.querySelectorAll('.leader-uci-rank').length === 3);
    await page.evaluate(() => { qa.linkDelay = true; });
    await choose('allTime');
    await page.waitForFunction(() => Boolean(qa.releaseLinks));
    const feedReadsBeforeAccountChange = await page.evaluate(() => qa.uci.length);
    await page.evaluate(() => { state.user = { id: 'new-viewer' }; state.sessionSetupVersion++; qa.releaseLinks(); qa.releaseLinks = null; });
    await page.waitForTimeout(25);
    eq(await page.locator('.leader-uci-rank').count(), 0, 'Pending affiliation cannot add ranks after the viewer changes');
    eq(await page.evaluate(() => qa.uci.length), feedReadsBeforeAccountChange, 'Expired viewer metadata does not trigger a further feed download');
    await page.evaluate(() => { state.user = { id: 'rider-a' }; state.sessionSetupVersion++; });

    await choose('weekly');
    await page.waitForFunction(() => document.querySelectorAll('.leader-uci-rank').length === 3);
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
    console.log('PASS: ' + checks + ' UCI leaderboard checks (roles, four tabs, exact linked identities, privacy, score preservation, search/pagination, mobile/light layouts, metadata/feed retries, cache status and stale-response guards).');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
