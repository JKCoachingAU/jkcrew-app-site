// Actual parent Home and shared leaderboard UI with synthetic linked families only.
// No production credentials, network calls, account impersonation or data writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const extract = name => {
  const start = source.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'));
  assert(start >= 0, 'Production function exists: ' + name);
  const rest = source.slice(start);
  return rest.slice(0, rest.indexOf('\n}') + 2);
};
const functions = [
  'parentSelectionStorageKey', 'storedParentAthleteId', 'rememberParentAthleteId', 'getParentRiderContext',
  'parentWaitingHtml', 'parentChildSwitcherHtml', 'parentPageHeadHtml', 'renderCurrentParentView', 'bindParentPageActions',
  'parentRoadToLa28CardHtml', 'loadParentRoadToLa28Card', 'renderParentHome',
  'boardLeaderboardViews', 'boardRankingsShellHtml', 'boardUciSourceUrl', 'boardUciDate', 'boardUciSearchText',
  'boardUciMembers', 'leaderUciRankHtml', 'leaderRow', 'compactLeaderboardHtml', 'leaderboardWithBenchmark',
  'loadJkcBoardUciRanks', 'updateBoardUciRows', 'renderBoardRankings', 'bindBoardRankings',
];
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (actual, message) => { assert(actual, message); checks++; };
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://jkcrew.test') return route.abort();
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div class="app-shell parent-shell" style="display:block"><main id="view" class="content" data-view="home"></main></div></body></html>' });
      const file = path.join(root, decodeURIComponent(url.pathname));
      return file.startsWith(root + path.sep) && fs.existsSync(file) ? route.fulfill({ path: file }) : route.abort();
    });
    await page.goto('http://jkcrew.test/');
    await page.addScriptTag({ path: path.join(root, 'uci-rankings.js') });
    await page.evaluate(() => {
      window.qa = { requests: [], writes: [], jkcReads: 0, jkcOptions: [], failJkc: false, chatReads: 0, profileOpens: 0, links: [], linkCalls: [], failLinks: false,
        uciCalls: [], failUci: false, stale: false, holdNextUci: false, releaseUci: null, holdNextLinks: false, releaseLinks: null,
        holdAssignments: '', releaseAssignments: null, notices: [], navigation: [] };
      window.children = [
        { id: 'child-a', role: 'athlete', display_name: 'Ali Fixture', uci_id: '20000000000', level: 5 },
        { id: 'child-b', role: 'athlete', display_name: 'Koby Fixture', uci_id: '10000000000', level: 5 },
        { id: 'child-unranked', role: 'athlete', display_name: 'Unranked Fixture', uci_id: null, level: 2 },
        { id: 'other-child', role: 'athlete', display_name: 'Other Family', uci_id: null, level: 2 },
      ];
      window.familyLinks = { 'parent-one': ['child-a', 'child-b', 'child-unranked'], 'parent-two': ['other-child'], 'parent-empty': [] };
      window.state = { view: 'home', user: { id: 'parent-one' }, profile: { id: 'parent-one', role: 'parent', display_name: 'Parent Fixture' }, sessionSetupVersion: 1,
        parentAthleteId: '', loadingOverlayToken: 0, boardLeaderboardView: 'weekly', boardUciLimit: 50 };
      window.PROFILE_SELECT = 'id,display_name,role,uci_id';
      window.escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      window.firstName = profile => String(profile?.display_name || '').split(' ')[0];
      window.avatarHtml = row => '<span class="avatar">' + escapeHtml(firstName(row).slice(0, 2)) + '</span>';
      window.medalForRank = () => '';
      window.earnedBadges = badges => badges || [];
      window.countryBadge = row => '<span class="country-flag">' + (row.country_code === 'DE' ? '🇩🇪' : '🇦🇺') + '</span>';
      window.formatPbTime = value => String(value);
      window.leaderboardRankForRow = (_row, index) => index + 1;
      window.ghostModeLabelHtml = row => row.ghost_mode ? '<small>Ghost</small>' : '';
      window.pointsReceiptAttributes = id => 'data-points-receipt="' + escapeHtml(id) + '"';
      window.openPublicAthleteProfile = () => qa.profileOpens++;
      window.getBoardChat = async () => { qa.chatReads++; throw Error('Parent Home must not request chat'); };
      window.client = { from: table => {
        const query = { filters: {}, select: () => query, eq: (key, value) => { query.filters[key] = value; return query; }, in: (key, value) => { query.filters[key] = value; return query; }, order: () => query, limit: () => query,
          update: () => { qa.writes.push(table); throw Error('Parent must never write'); },
          then: (resolve, reject) => {
            const filters = structuredClone(query.filters); qa.requests.push({ table, filters });
            if (!['parent_athletes', 'profiles', 'training_sessions'].includes(table)) return Promise.reject(Error('Unexpected parent query: ' + table)).then(resolve, reject);
            const rows = table === 'parent_athletes' ? (familyLinks[filters.parent_id] || []).map(athlete_id => ({ athlete_id, relationship: 'Parent' }))
              : table === 'profiles' ? children.filter(child => filters.id?.includes(child.id)) : [];
            return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
          },
        }; return query;
      }, rpc: async name => { throw Error('Unexpected app RPC ' + name); } };
      window.qaRows = [
        { athlete_id: 'child-a', display_name: 'Ali Fixture', weekly_points: 32, all_time_points: 125, country_code: 'AU' },
        { athlete_id: 'child-b', display_name: 'Koby Fixture', weekly_points: 20, all_time_points: 300, country_code: 'AU' },
        { athlete_id: 'rider-c', display_name: 'Men Rider 2', weekly_points: 18, all_time_points: 100, country_code: 'DE' },
        { athlete_id: 'rider-d', display_name: 'Rider With A Very Long Display Name To Test The Parent Phone Layout', weekly_points: 15, all_time_points: 75, country_code: 'DE' },
        { athlete_id: 'rider-e', display_name: 'Duplicate E', weekly_points: 12, all_time_points: 60 },
        { athlete_id: 'rider-f', display_name: 'Duplicate F', weekly_points: 10, all_time_points: 55 },
        { athlete_id: 'child-unranked', display_name: 'Unranked Fixture', weekly_points: 8, all_time_points: 40 },
        { athlete_id: 'other-child', display_name: 'Other Family', weekly_points: 4, all_time_points: 20 },
        { athlete_id: 'rider-z', display_name: 'No Activity', weekly_points: 0, all_time_points: 0 },
      ];
      qa.links = [
        { athlete_id: 'child-a', uci_id: '20000000000' }, { athlete_id: 'child-b', uci_id: '10000000000' },
        { athlete_id: 'rider-d', uci_id: '10000000065' }, { athlete_id: 'rider-e', uci_id: '10000000004' },
        { athlete_id: 'rider-f', uci_id: '10000000004' }, { athlete_id: 'hidden-ghost', uci_id: '10000000005' },
      ];
      window.qaSnapshot = { schemaVersion: 1, checkedAt: '2026-10-21T10:00:00Z', categories: {} };
      for (const [key, count] of [['men', 121], ['women', 61]]) qaSnapshot.categories[key] = {
        rankingDate: '2026-10-20', sourceUrl: 'https://dataride.uci.ch/iframe/RankingDetails/' + (key === 'men' ? 91 : 92),
        rows: Array.from({ length: count }, (_, i) => ({ rank: i + 11, name: (key === 'men' ? 'Men' : 'Women') + ' Rider ' + i, nation: i % 2 ? 'GER' : 'AUS', points: 2000 - i, uciId: String((key === 'men' ? 10000000000 : 20000000000) + i), change: i % 2 ? -2 : 1 })),
      };
      qaSnapshot.categories.men.rows[0].name = 'KOBY Official';
      qaSnapshot.categories.women.rows[0].name = 'NORRIS Alirah';
      qaSnapshot.categories.men.rows[1].name = '<img src=x onerror="window.injected=true">';
      qaSnapshot.categories.men.rows[3].name = 'Éli Park';
      qaSnapshot.categories.men.rows[65].name = 'DE LA VERY LONG SURNAME Athlete With A Long Name';
      const findRider = JKCUciRankings.findRider;
      window.JKCUciRankings = { findRider, peek: () => qaSnapshot, load: async options => {
        qa.uciCalls.push(options); const result = { ...structuredClone(qaSnapshot), stale: qa.stale };
        if (qa.holdNextUci) { qa.holdNextUci = false; await new Promise(resolve => qa.releaseUci = resolve); }
        if (qa.failUci) throw Error('Synthetic UCI outage');
        return result;
      } };
      window.getLeaderboardUciLinks = async options => {
        qa.linkCalls.push(options); const result = structuredClone(qa.links);
        if (qa.holdNextLinks) { qa.holdNextLinks = false; await new Promise(resolve => qa.releaseLinks = resolve); }
        if (qa.failLinks) throw Error('Synthetic affiliation outage');
        return result;
      };
      window.getLeaderboard = async options => { qa.jkcReads++; qa.jkcOptions.push(options); if (qa.failJkc) throw Error('Synthetic JKC outage'); return structuredClone(qaRows); };
      window.getWeeklyAssignments = async id => {
        if (qa.holdAssignments === id) { qa.holdAssignments = ''; await new Promise(resolve => qa.releaseAssignments = resolve); }
        return { assignments: [], awards: [], assignmentAttempts: [] };
      };
      window.getMyCoachMessages = window.getHelpRequests = window.getDashboardItems = async () => [];
      window.getXpSummary = async () => ({ level: 5, xp_needed: 20, next_level: 6 });
      window.normalizeXpSummary = value => value;
      window.completionAssignments = rows => rows;
      window.isAssignmentComplete = () => false;
      window.weeklyCompletionPercent = () => 0;
      window.coachMessagesHtml = window.parentEngagementAlertHtml = window.parentLatestCoachMessageHtml = window.parentNextItemHtml = window.parentLatestFeedbackHtml = window.parentRecentActivityHtml = () => '';
      window.notify = value => qa.notices.push(value);
      window.messageFrom = error => error.message;
      window.navigate = async view => {
        qa.navigation.push(view); state.view = view; state.loadingOverlayToken++;
        if (view === 'home') return renderParentHome();
        document.querySelector('#view').innerHTML = '<div data-destination>' + escapeHtml(view) + '</div>';
      };
      for (const name of ['bindDailyVenueAccordions', 'bindSessionAssignmentAccordions', 'cacheClear', 'dismissCoachMessage', 'playRunPreview', 'renderParentWeek', 'renderParentCoaching', 'renderContests', 'renderParentCalendar', 'renderUciTracker', 'renderUciSchedule', 'renderParentMore', 'renderParentTricktionary', 'renderProfile']) window[name] = () => {};
    });
    await page.addScriptTag({ content: functions.map(extract).join('\n') });
    const board = page.locator('[data-parent-leaderboards]');
    const choose = key => board.locator('[data-board-view="' + key + '"]').click();
    const uciReady = async () => { await board.locator('[data-uci-search]').waitFor(); await page.waitForFunction(() => !document.querySelector('[data-uci-members-status]')?.textContent.includes('Finding')); };
    const home = async () => { await page.evaluate(() => { state.view = 'home'; return renderParentHome(); }); await board.waitFor(); };
    const release = name => page.evaluate(name => { qa[name]?.(); qa[name] = null; }, name);
    await home();
    await page.waitForFunction(() => document.querySelectorAll('[data-parent-leaderboards] .leader-uci-rank').length === 3);
    eq(await board.getByRole('tab').allTextContents(), ['JKC Weekly', 'JKC All-Time', 'UCI Men', 'UCI Women'], 'Actual parent Home contains all four leaderboard views');
    eq(await page.evaluate(() => qa.jkcReads), 1, 'Parent Home reuses its one existing JKC request');
    eq(await page.evaluate(() => qa.jkcOptions[0]?.allowFallback), false, 'Parent leaderboard rejects fabricated fallback scores');
    eq(await board.locator('.leader-row').count(), 9, 'All visible JKC riders remain available, including collapsed extra rows');
    eq(await board.locator('.leader-row.me').getAttribute('data-leader-athlete'), 'child-a', 'Selected linked child is highlighted');
    eq(await board.locator('[data-leader-athlete="child-a"] .points').textContent(), '32 pts', 'Parent sees real weekly score');
    eq(await board.locator('[data-leader-athlete="rider-z"] .points').textContent(), 'DNS', 'No-activity rider uses the existing leaderboard state');
    eq(await board.locator('[data-public-athlete], [data-points-receipt]').count(), 0, 'Parent leaderboard has no private-profile or points-receipt actions');
    eq(await board.locator('button.leader-row').count(), 0, 'Parent rows are read-only, not inactive-looking profile buttons');
    eq(await board.locator('[data-leader-athlete="child-a"] .leader-uci-rank').textContent(), 'UCI #11Women', 'Exact linked Women identity enriches the JKC score');
    eq(await board.locator('[data-leader-athlete="child-b"] .leader-uci-rank').textContent(), 'UCI #11Men', 'Exact linked Men identity enriches the JKC score');
    eq(await board.locator('[data-leader-athlete="rider-c"] .leader-uci-rank').count(), 0, 'Matching display names alone do not fabricate UCI links');
    eq(await board.locator('[data-leader-athlete="rider-e"] .leader-uci-rank').count(), 0, 'Conflicting identity claims do not fabricate a UCI rank');
    await board.locator('.leaderboard-more summary').click();
    ok(await board.locator('[data-leader-athlete="other-child"]').isVisible(), 'Read-only leaderboard expands to all visible riders');
    const base = await page.evaluate(() => ({ jkc: qa.jkcReads, requests: qa.requests, chat: qa.chatReads }));
    await choose('allTime');
    eq(await board.locator('.leader-row').first().getAttribute('data-leader-athlete'), 'child-b', 'All-time sorts by lifetime points');
    eq(await board.locator('[data-leader-athlete="child-a"] .points').textContent(), '125 pts', 'All-time uses lifetime score, not weekly score');
    eq(await board.locator('.leader-row.me').getAttribute('data-leader-athlete'), 'child-a', 'Child highlight survives all-time reordering');
    await choose('uciMen'); await uciReady();
    eq(await board.locator('[data-uci-rows] [role="row"]').count(), 50, 'Official board initially renders 50 rows');
    eq(await board.locator('.uci-rank').first().textContent(), '11', 'Official source ranking is retained');
    eq(await board.locator('.uci-ranking-date time').textContent(), '20 Oct 2026', 'Official publication date is shown');
    eq(await board.locator('.uci-source-link').getAttribute('href'), 'https://dataride.uci.ch/iframe/RankingDetails/91', 'Men category links to its official source');
    eq(await board.locator('[data-uci-rows] .is-jkc .uci-rider strong').allTextContents(), ['KOBY Official'], 'Only exact linked visible JKC riders get a logo');
    eq(await board.locator('[data-uci-rows] [src="x"]').count(), 0, 'Untrusted official names remain escaped');
    eq(await page.evaluate(() => Boolean(window.injected)), false, 'Official source cannot inject executable markup');
    await board.locator('[data-uci-more]').click();
    eq(await board.locator('[data-uci-rows] [role="row"]').count(), 100, 'Pagination adds the next 50 rows');
    eq(await board.locator('[data-uci-rows] .is-jkc .uci-rider strong').allTextContents(), ['KOBY Official', 'DE LA VERY LONG SURNAME Athlete With A Long Name'], 'Pagination retains exact JKC affiliation');
    await board.locator('[data-uci-search]').fill('eli');
    eq(await board.locator('[data-uci-rows] [role="row"]').count(), 1, 'Accent-insensitive rider search works');
    await board.locator('[data-uci-search]').fill('GER');
    eq(await board.locator('[data-uci-rows] [role="row"]').count(), 50, 'Country search resets bounded pagination');
    await board.locator('[data-uci-search]').fill('does not exist');
    ok(await board.locator('[data-uci-empty]').isVisible(), 'No-match state appears');
    await choose('uciWomen'); await uciReady();
    eq(await board.locator('[data-uci-search]').inputValue(), '', 'Changing category clears the old search');
    eq(await board.locator('[data-uci-rows] .is-jkc .uci-rider strong').allTextContents(), ['NORRIS Alirah'], 'Women include the linked child under her official UCI name');
    eq(await board.locator('.uci-source-link').getAttribute('href'), 'https://dataride.uci.ch/iframe/RankingDetails/92', 'Women category uses its own official source');
    eq(await page.evaluate(() => ({ jkc: qa.jkcReads, requests: qa.requests, chat: qa.chatReads })), base, 'Tabs reuse Home JKC data without fetching linked profiles, private child data or chat again');
    eq(await page.locator('#board-chat-form, .board-chat-panel').count(), 0, 'Parent Home never mounts crew chat');

    // Both themes and all key phone/tablet/desktop widths use the production CSS.
    for (const key of ['weekly', 'uciWomen']) {
      await choose(key); if (key === 'uciWomen') await uciReady();
      for (const theme of ['dark', 'light']) for (const width of [320, 390, 430, 768, 1440]) {
        await page.setViewportSize({ width, height: 844 });
        await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
        const overflow = await board.evaluate(panel => [...panel.querySelectorAll('*')].filter(node => {
          const style = getComputedStyle(node);
          return style.display !== 'inline' && node.clientWidth && node.scrollWidth > node.clientWidth + 2 && !['auto', 'scroll'].includes(style.overflowX);
        }).map(node => ({ className: node.className, width: node.clientWidth, scroll: node.scrollWidth })));
        eq(overflow, [], `${key}/${theme}/${width}: contents fit without horizontal overflow`);
        ok(await board.evaluate(panel => panel.getBoundingClientRect().left >= 0 && panel.getBoundingClientRect().right <= innerWidth), `${key}/${theme}/${width}: board fits viewport`);
        for (const tab of await board.getByRole('tab').all()) { const rect = await tab.boundingBox(); ok(rect.height >= 44 && rect.width >= 44, `${key}/${theme}/${width}: 44px tab target`); }
        if (key === 'uciWomen') ok(await board.locator('[data-uci-rows]').evaluate(rows => rows.scrollHeight > rows.clientHeight && ['auto', 'scroll'].includes(getComputedStyle(rows).overflowY)), `${theme}/${width}: large UCI list scrolls inside bounded Home panel`);
        if (process.env.JKCREW_SCREENSHOT_DIR && [390, 1440].includes(width)) {
          fs.mkdirSync(process.env.JKCREW_SCREENSHOT_DIR, { recursive: true });
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({ path: path.join(process.env.JKCREW_SCREENSHOT_DIR, `parent-${key}-${theme}-${width}.png`), fullPage: true });
        }
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await board.locator('[data-board-view="uciWomen"]').focus();
    await page.keyboard.press('Home');
    eq(await board.locator('[role="tab"][aria-selected="true"]').textContent(), 'JKC Weekly', 'Keyboard Home selects first tab');
    await page.keyboard.press('ArrowLeft'); await uciReady();
    eq(await board.locator('[role="tab"][aria-selected="true"]').textContent(), 'UCI Women', 'Keyboard arrow navigation wraps');
    eq(await board.locator('[role="tab"][tabindex="0"]').count(), 1, 'Only active tab is in normal tab order');

    // Failed public feed or affiliation lookup stays local and retryable.
    await choose('weekly');
    await page.evaluate(() => { qa.failUci = true; });
    await choose('uciMen');
    await board.getByText('Rankings couldn’t load').waitFor();
    eq(await board.getByRole('tab').count(), 4, 'Failed feed retains JKC and category choices');
    await page.evaluate(() => { qa.failUci = false; qa.stale = true; });
    await board.locator('[data-uci-retry]').click(); await uciReady();
    ok(await board.locator('.uci-refresh-status.is-stale').isVisible(), 'Fallback ranking is clearly labelled stale');
    eq(await page.evaluate(() => qa.uciCalls.at(-1).force), true, 'Parent retry requests a forced public refresh');
    eq(await page.evaluate(() => state.view), 'home', 'UCI retry remains on parent Home');
    await page.evaluate(() => { qa.stale = false; });
    await board.locator('[data-uci-retry]').click(); await uciReady();
    eq(await board.locator('.is-stale').count(), 0, 'Successful refresh removes stale label');
    await page.evaluate(() => { qa.failLinks = true; });
    await choose('uciWomen'); await uciReady();
    ok(await board.locator('[data-board-uci-retry]').isVisible(), 'Affiliation failure offers a local retry');
    eq(await board.locator('[data-uci-rows] [role="row"]').count(), 50, 'Affiliation failure does not hide official rankings');
    eq(await board.locator('.is-jkc').count(), 0, 'Failed links never guess membership');
    await page.evaluate(() => { qa.failLinks = false; });
    await board.locator('[data-board-uci-retry]').click(); await uciReady();
    eq(await board.locator('.is-jkc').count(), 1, 'Retry restores exact affiliation on parent Home');
    await page.evaluate(() => { qa.failUci = true; });
    await choose('weekly');
    await board.locator('[data-board-uci-retry]').waitFor();
    eq(await board.locator('[data-leader-athlete="child-a"] .points').textContent(), '32 pts', 'JKC remains visible if optional rank enrichment fails');
    await page.evaluate(() => { qa.failUci = false; });
    await board.locator('[data-board-uci-retry]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-parent-leaderboards] .leader-uci-rank').length === 3);
    eq(await page.evaluate(() => qa.jkcReads), base.jkc, 'Retries do not refetch JKC or private child records');

    // Unavailable JKC data must not turn into false zero scores or remove the family dashboard.
    await page.evaluate(() => { qa.failJkc = true; state.boardLeaderboardView = 'weekly'; return renderParentHome(); });
    await board.locator('[data-jkc-retry]').waitFor();
    ok((await board.textContent()).includes('JKC scores couldn’t load'), 'JKC outage has a clear recoverable state');
    eq(await board.locator('.leader-row').count(), 0, 'JKC outage never fabricates zero-score leaderboard rows');
    ok((await page.locator('.parent-home-metrics').textContent()).includes('Scores unavailable'), 'Child score is honestly marked unavailable');
    ok((await page.locator('.parent-home-metrics').textContent()).includes('—'), 'Unavailable child score uses a dash rather than false zero');
    eq(await page.locator('.parent-home-grid').count(), 1, 'JKC outage leaves the rest of the family dashboard available');
    await choose('uciMen'); await uciReady();
    eq(await board.locator('[data-uci-rows] [role="row"]').count(), 50, 'Official UCI rankings remain usable during a JKC outage');
    eq(await board.locator('.is-jkc').count(), 0, 'Unavailable JKC roster does not invent affiliation highlights');
    await choose('weekly');
    await board.locator('[data-jkc-retry]').click();
    await board.locator('[data-jkc-retry]').waitFor();
    ok(await board.locator('[data-jkc-retry]').isEnabled(), 'Repeated failed JKC retry becomes available again');
    await page.evaluate(() => { qa.failJkc = false; });
    await board.locator('[data-jkc-retry]').click();
    await board.locator('[data-leader-athlete="child-a"]').waitFor();
    eq(await board.locator('[data-leader-athlete="child-a"] .points').textContent(), '32 pts', 'JKC retry restores verified weekly scores');
    ok(!(await page.locator('.parent-home-metrics').textContent()).includes('Scores unavailable'), 'Successful JKC retry restores the linked child summary');
    eq(await page.evaluate(() => state.parentAthleteId), 'child-a', 'JKC failure and retry preserve the linked child');
    ok(await page.evaluate(() => qa.jkcOptions.every(options => options?.allowFallback === false)), 'All Home retries continue to reject synthetic score fallbacks');

    // Genuine child switch rerenders Home and highlights only the newly selected child.
    await page.locator('#parent-athlete-select').selectOption('child-b');
    await page.waitForFunction(() => document.querySelector('[data-parent-leaderboards] .leader-row.me')?.dataset.leaderAthlete === 'child-b');
    eq(await board.locator('.leader-row.me').count(), 1, 'Sibling switch has exactly one selected-child marker');
    eq(await page.evaluate(() => state.parentAthleteId), 'child-b', 'Leaderboard follows the real linked-child selector');
    await page.locator('#parent-athlete-select').selectOption('child-unranked');
    await page.waitForFunction(() => document.querySelector('[data-parent-leaderboards] .leader-row.me')?.dataset.leaderAthlete === 'child-unranked');
    eq(await board.getByRole('tab').count(), 4, 'Unranked children’s parents can still view both public UCI boards');

    // A late tab load, child load, navigation or account switch must never overwrite the destination.
    await page.evaluate(() => { qa.holdNextUci = true; });
    await choose('uciMen');
    await page.waitForFunction(() => Boolean(qa.releaseUci));
    await choose('uciWomen'); await uciReady();
    await release('releaseUci');
    await page.waitForTimeout(30);
    ok((await board.locator('.panel-title').first().textContent()).includes('Women'), 'Late Men response cannot overwrite selected Women tab');
    await choose('weekly');
    await page.evaluate(() => { qa.holdNextUci = true; });
    await choose('uciMen');
    await page.waitForFunction(() => Boolean(qa.releaseUci));
    await page.evaluate(() => { state.boardLeaderboardView = 'weekly'; });
    await page.locator('#parent-athlete-select').selectOption('child-a');
    await page.waitForFunction(() => document.querySelector('[data-parent-leaderboards] .leader-row.me')?.dataset.leaderAthlete === 'child-a');
    await release('releaseUci'); await page.waitForTimeout(30);
    eq(await board.locator('[data-uci-search]').count(), 0, 'Old-child UCI completion cannot replace new-child JKC view');
    eq(await board.locator('.leader-row.me').getAttribute('data-leader-athlete'), 'child-a', 'New-child identity remains current after old completion');
    await page.evaluate(() => { qa.holdAssignments = 'child-a'; window.slowHome = renderParentHome(); });
    await page.waitForFunction(() => Boolean(qa.releaseAssignments));
    await page.evaluate(() => { rememberParentAthleteId('child-b'); return renderParentHome(); });
    await release('releaseAssignments');
    await page.evaluate(() => slowHome);
    eq(await board.locator('.leader-row.me').getAttribute('data-leader-athlete'), 'child-b', 'Late previous-child Home data cannot replace newer Home');
    await page.evaluate(() => { qa.holdNextUci = true; });
    await choose('uciMen');
    await page.waitForFunction(() => Boolean(qa.releaseUci));
    await page.evaluate(() => navigate('contests'));
    await release('releaseUci'); await page.waitForTimeout(30);
    eq(await page.locator('[data-destination]').textContent(), 'contests', 'Late Home UCI request cannot replace another destination');
    await page.evaluate(() => { state.boardLeaderboardView = 'weekly'; }); await home();
    await page.evaluate(() => { qa.holdNextUci = true; });
    await choose('uciMen');
    await page.waitForFunction(() => Boolean(qa.releaseUci));
    await page.evaluate(() => { state.user = { id: 'parent-two' }; state.profile = { id: 'parent-two', role: 'parent', display_name: 'Other Parent' }; state.sessionSetupVersion++; state.parentAthleteId = ''; state.boardLeaderboardView = 'weekly'; return renderParentHome(); });
    await page.waitForFunction(() => document.querySelector('[data-parent-leaderboards] .leader-row.me')?.dataset.leaderAthlete === 'other-child');
    await release('releaseUci'); await page.waitForTimeout(30);
    eq(await board.locator('.leader-row.me').getAttribute('data-leader-athlete'), 'other-child', 'Old-account public feed completion cannot overwrite new family state');
    eq(await page.locator('#parent-athlete-select').count(), 0, 'New parent cannot select prior account’s children');
    await page.evaluate(() => { state.boardLeaderboardView = 'weekly'; qa.holdNextLinks = true; return renderParentHome(); });
    await page.waitForFunction(() => Boolean(qa.releaseLinks));
    await page.evaluate(() => { state.profile.role = 'athlete'; state.sessionSetupVersion++; document.querySelector('#view').innerHTML = '<div data-signed-out>Account changed</div>'; });
    await release('releaseLinks'); await page.waitForTimeout(30);
    eq(await page.locator('[data-signed-out]').textContent(), 'Account changed', 'Delayed link enrichment does not paint after account role changes');
    await page.evaluate(() => { state.user = { id: 'parent-empty' }; state.profile = { id: 'parent-empty', role: 'parent', display_name: 'Waiting Parent' }; state.sessionSetupVersion++; state.parentAthleteId = ''; state.view = 'home'; return renderParentHome(); });
    eq(await board.count(), 0, 'Unlinked parent retains waiting state rather than selecting an unrelated child');
    ok((await page.locator('#view').textContent()).includes('Waiting'), 'Unlinked family state remains explanatory');
    eq(await page.evaluate(() => qa.writes), [], 'Parent journeys never issue data writes');
    eq(await page.evaluate(() => qa.chatReads), 0, 'No parent leaderboard flow reads crew chat');
    eq(await page.evaluate(() => qa.profileOpens), 0, 'No parent leaderboard flow opens another rider’s private profile');
    eq(errors, [], 'No browser exceptions across tab, retry, child and account transitions');
    console.log(JSON.stringify({ checks, result: 'passed', screenshots: process.env.JKCREW_SCREENSHOT_DIR || null }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
