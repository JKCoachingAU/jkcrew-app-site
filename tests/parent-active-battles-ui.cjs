// Real parent Home, navigation and active-battle renderer; synthetic accounts only.
// No production credentials, data writes or outbound network requests.
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
const productionFunctions = ['parentSelectionStorageKey', 'storedParentAthleteId', 'rememberParentAthleteId', 'getParentRiderContext',
  'parentWaitingHtml', 'parentChildSwitcherHtml', 'parentPageHeadHtml', 'renderCurrentParentView', 'bindParentPageActions',
  'renderParentHome', 'navigate', 'teardownRealtimeSync'];
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (actual, message) => { assert(actual, message); checks++; };
const serverEpoch = Date.parse('2026-10-25T02:00:00Z');
const deviceEpoch = serverEpoch + 2 * 86400000;
let browser;
const errors = [];
async function setup() {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install({ time: deviceEpoch });
  await page.clock.pauseAt(deviceEpoch);
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://jkcrew.test') return route.abort();
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/active-battles.css"></head><body><div class="app-shell parent-shell" style="display:block"><main id="view" class="content" data-view="home"></main></div></body></html>' });
    const file = path.join(root, decodeURIComponent(url.pathname));
    return file.startsWith(root + path.sep) && fs.existsSync(file) ? route.fulfill({ path: file }) : route.abort();
  });
  await page.goto('http://jkcrew.test/');
  await page.addScriptTag({ path: path.join(root, 'active-battles.js') });
  await page.evaluate(({ serverEpoch, deviceEpoch }) => {
    window.qa = { calls: [], reads: [], writes: [], errors: [], visible: true, online: true, fail: false, hold: false, releases: [], forceRows: null, rows: {},
      notices: [], failAssignments: false, denial: false, leaderboardBinds: 0, extraRenders: [], assignmentHold: false, releaseAssignments: null };
    window.qaNow = () => serverEpoch + Date.now() - deviceEpoch;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => qa.visible ? 'visible' : 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => !qa.visible });
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => qa.online });
    window.children = [
      { id: 'child-a', role: 'athlete', display_name: 'Ali Fixture', level: 5 },
      { id: 'child-b', role: 'athlete', display_name: 'Koby Fixture', level: 5 },
      { id: 'other-child', role: 'athlete', display_name: 'Other Family', level: 2 },
    ];
    window.links = { 'parent-one': ['child-a', 'child-b'], 'parent-two': ['other-child'], 'parent-empty': [] };
    window.state = { view: 'home', user: { id: 'parent-one' }, profile: { id: 'parent-one', role: 'parent', display_name: 'Parent Fixture' },
      sessionSetupVersion: 1, parentAthleteId: '', loadingOverlayToken: 0, activeBattles: null };
    window.qaBattle = (id, childId = 'child-a', sizes = [1, 1], options = {}) => ({
      id, status: 'active', starts_at: new Date(qaNow() - 3600000).toISOString(), ends_at: new Date(qaNow() + 3600000).toISOString(),
      reward_points: 7, battle_size: sizes[0], team_count: sizes.length, format: sizes.join('v'),
      participants: sizes.flatMap((size, index) => Array.from({ length: size }, (_, slot) => ({
        athlete_id: index === 0 && slot === 0 ? childId : id + '-' + index + '-' + slot,
        display_name: index === 0 && slot === 0 ? children.find(child => child.id === childId)?.display_name || childId : id + ' Rival ' + (index + 1) + '.' + (slot + 1),
        team_number: index + 1, forfeited_at: null, battle_points: 999,
      }))), teams: sizes.map((_size, index) => ({ team_number: index + 1, score: [32, 27, 19][index], forfeited: false })), ...options,
    });
    window.client = {
      from: table => {
        const query = { filters: {}, select: () => query, eq: (key, value) => { query.filters[key] = value; return query; },
          in: (key, value) => { query.filters[key] = value; return query; }, order: () => query, limit: () => query,
          update: () => { qa.writes.push(table); throw Error('Parent must never write'); }, insert: () => { qa.writes.push(table); throw Error('Parent must never write'); },
          then: (resolve, reject) => {
            const filters = structuredClone(query.filters); qa.reads.push({ table, filters });
            if (!['parent_athletes', 'profiles', 'training_sessions'].includes(table)) return Promise.reject(Error('Unexpected parent query: ' + table)).then(resolve, reject);
            const rows = table === 'parent_athletes' ? (links[filters.parent_id] || []).map(athlete_id => ({ athlete_id, relationship: 'Parent' }))
              : table === 'profiles' ? children.filter(child => filters.id?.includes(child.id)) : [];
            return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
          },
        }; return query;
      },
      rpc: (name, args) => {
        const call = { name, args: structuredClone(args), userId: state.user?.id, aborted: false }; qa.calls.push(call);
        const authorised = name === 'get_parent_active_rider_battles' && (links[call.userId] || []).includes(args.p_athlete_id);
        const sourceRows = qa.forceRows || (qa.rows[args.p_athlete_id] || []).filter(row => row.status === 'active');
        const start = args.p_after_id ? sourceRows.findIndex(row => row.id === args.p_after_id) + 1 : 0;
        const rows = sourceRows.slice(start, start + args.p_limit), more = start + rows.length < sourceRows.length;
        const payload = { data: { athlete_id: args.p_athlete_id, server_now: new Date(qaNow()).toISOString(), battles: structuredClone(rows), has_more: more,
          next_cursor: more ? { id: rows.at(-1).id, ends_at: rows.at(-1).ends_at } : null }, error: null };
        const result = !authorised ? { data: null, error: { message: 'Unauthorised fixture query' } }
          : qa.denial ? { data: null, error: { code: '42501', message: 'Parent link revoked' } } : qa.fail ? { data: null, error: { message: 'Synthetic network failure' } } : payload;
        const promise = qa.hold ? (qa.hold = false, new Promise(resolve => qa.releases.push(() => resolve(result)))) : Promise.resolve(result);
        const query = { then: (resolve, reject) => promise.then(resolve, reject), abortSignal: signal => {
          call.aborted = signal.aborted; signal.addEventListener('abort', () => { call.aborted = true; }); return query;
        } };
        return query;
      },
    };
    window.PROFILE_SELECT = 'id,display_name,role';
    window.escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    window.firstName = value => String(value?.display_name || '').split(' ')[0];
    window.avatarHtml = row => '<span class="avatar">' + escapeHtml(firstName(row).slice(0, 2)) + '</span>';
    window.getLeaderboard = async () => [{ athlete_id: 'child-a', weekly_points: 32 }, { athlete_id: 'child-b', weekly_points: 21 }];
    window.getWeeklyAssignments = async () => { if (qa.failAssignments) throw Error('Synthetic Home reload failure'); if (qa.assignmentHold) { qa.assignmentHold = false; await new Promise(resolve => qa.releaseAssignments = resolve); } return { assignments: [], awards: [], assignmentAttempts: [] }; };
    window.getMyCoachMessages = window.getHelpRequests = window.getDashboardItems = async () => [];
    window.getXpSummary = async () => ({ level: 5, xp_needed: 20, next_level: 6 });
    window.normalizeXpSummary = value => value;
    window.completionAssignments = rows => rows;
    window.isAssignmentComplete = () => false;
    window.weeklyCompletionPercent = () => 0;
    window.pointsReceiptAttributes = () => '';
    window.coachMessagesHtml = window.parentEngagementAlertHtml = window.parentLatestCoachMessageHtml = window.parentNextItemHtml = window.parentLatestFeedbackHtml = window.parentRecentActivityHtml = () => '';
    window.boardRankingsShellHtml = () => '<section data-parent-leaderboards>Leaderboards fixture</section>';
    window.bindBoardRankings = () => qa.leaderboardBinds++;
    window.loadParentRoadToLa28Card = async () => {};
    window.withTimeout = async promise => promise;
    window.notify = value => qa.notices.push(value);
    window.messageFrom = error => error.message;
    window.liveRun = null; window.liveRunDiscoveryTimer = null; window.liveRunWaitingExpiryTimer = null;
    window.riderRecoveryActive = window.riderFeaturesDisabled = window.riderFeatureAccessUnknown = () => false;
    window.isCoachRole = role => ['coach', 'admin'].includes(role);
    window.coachPrimaryView = window.parentPrimaryView = window.athletePrimaryView = view => view;
    window.setLoading = () => { state.loadingOverlayToken++; document.querySelector('#view').innerHTML = '<p>Loading</p>'; return state.loadingOverlayToken; };
    window.finishScreenLoading = token => token === state.loadingOverlayToken;
    for (const name of ['bindDailyVenueAccordions', 'bindSessionAssignmentAccordions', 'cacheClear', 'dismissCoachMessage', 'playRunPreview',
      'dismissDailyFinishForNavigation', 'stopRunPlayback', 'closeAthleteReviewViewer', 'resetPageExpansions', 'refreshLiveRunInvites', 'disconnectLiveRun',
      'renderRiderRecoveryHome', 'renderAthleteHome', 'renderRecoveryCoach', 'renderAthleteCoaching', 'renderSession', 'renderChallenges', 'renderTricktionary',
      'renderCoachCommand', 'renderSessionViewer', 'renderCoachBattleViewer', 'renderCoachTools', 'renderPastEvents', 'renderCoachMore', 'renderBikeGarage',
      'renderShredZone', 'renderJkcYard', 'renderCoachAdminRecords', 'renderPlanner', 'renderParents', 'renderVideoReviews', 'renderBoard', 'renderCrew',
      'renderAthleteCrew', 'renderStudentProfile', 'renderCoachPreview', 'renderPublicAthleteProfile', 'renderNotes', 'renderParentWeek', 'renderParentCoaching',
      'renderContests', 'renderParentCalendar', 'renderUciTracker', 'renderUciSchedule', 'renderParentMore', 'renderParentTricktionary', 'renderProfile']) {
      window[name] = () => { if (name.startsWith('render')) { qa.extraRenders.push(name); document.querySelector('#view').innerHTML = '<div data-destination>' + escapeHtml(name) + '</div>'; } };
    }
  }, { serverEpoch, deviceEpoch });
  await page.addScriptTag({ content: productionFunctions.map(extract).join('\n') });
  return page;
}
const calls = page => page.evaluate(() => qa.calls.length);
const settle = page => page.evaluate(() => state.activeBattles?.refresh());
const idle = page => page.waitForFunction(() => document.querySelector('[data-active-battles-list]')?.getAttribute('aria-busy') === 'false');
const home = page => page.evaluate(() => { state.view = 'home'; return renderParentHome(); });
const feed = page => page.locator('#active-rider-battles');
const release = page => page.evaluate(() => { qa.releases.splice(0).forEach(resolve => resolve()); });
(async () => {
  browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  try {
    const page = await setup();
    await page.evaluate(() => {
      qa.rows['child-a'] = [qaBattle('one'), qaBattle('unequal', 'child-a', [2, 1]), qaBattle('three', 'child-a', [1, 1, 1])];
      qa.rows['child-a'][1].participants[1].display_name = '<img src=x onerror="window.injected=true"> Long Name & O\'Brien';
      qa.rows['child-a'][2].teams[1].score = 32;
      qa.rows['child-a'][2].teams[2].forfeited = true; qa.rows['child-a'][2].teams[2].score = 0;
      qa.rows['child-a'][2].participants[2].forfeited_at = new Date(qaNow() - 1000).toISOString();
      qa.rows['child-b'] = [qaBattle('koby', 'child-b')];
    });
    await home(page); await idle(page);
    eq(await calls(page), 1, 'Real parent Home performs one bounded battle request');
    eq(await page.evaluate(() => qa.calls[0].name), 'get_parent_active_rider_battles', 'Parent uses scoped read RPC, never the broad rider feed');
    eq(await page.evaluate(() => qa.calls[0].args), { p_athlete_id: 'child-a', p_limit: 12, p_after_ends_at: null, p_after_id: null }, 'Request targets the selected linked child');
    eq(await feed(page).locator('[data-active-battle-id]').count(), 3, 'All current selected-child battles appear on actual Home');
    for (const format of ['1v1', '2v1', '1v1v1']) ok((await feed(page).innerText()).includes(format), 'Format retained: ' + format);
    eq(await feed(page).locator('li.is-linked-child').count(), 3, 'Selected child is highlighted in each roster');
    eq(await feed(page).locator('.crew-live-mine').count(), 3, 'Each card labels the linked child’s battle');
    ok(/your child.s battle/i.test(await feed(page).locator('.crew-live-mine').first().innerText()), 'Parent context does not label it as the parent’s own battle');
    eq(await feed(page).locator('[data-active-battle-id=one] .team-1 .crew-live-score strong').textContent(), '32', 'Shows canonical current team score');
    ok(!(await feed(page).innerText()).includes('999'), 'Does not use participant lifetime/reward totals for live score');
    eq(await feed(page).locator('[data-active-battle-id=three]').getByText('Tied', { exact: true }).count(), 2, 'Tied teams remain tied');
    eq(await feed(page).locator('[data-active-battle-id=three] .team-3 .crew-live-score strong').textContent(), '0', 'Forfeit state preserves server score');
    ok(/(?:prize|reward|winner|at the end|ends)/i.test(await feed(page).locator('footer').first().innerText()), 'Prize is clearly separate from points already earned');
    eq(await feed(page).locator('img[src=x]').count(), 0, 'Display names are escaped');
    eq(await page.evaluate(() => Boolean(window.injected)), false, 'Untrusted display name does not execute');
    eq(await feed(page).locator('form,input,select,[data-forfeit-battle],[data-battle-response],[data-rematch-battle]').count(), 0, 'Parent cards have no editable battle controls');
    eq(await page.evaluate(() => qa.writes), [], 'Viewing a live battle never writes or credits a reward');
    eq(await page.locator('[data-parent-leaderboards]').count(), 1, 'Existing Home leaderboards remain present');
    ok(await feed(page).evaluate(section => section.compareDocumentPosition(document.querySelector('#parent-road-la28-card')) & Node.DOCUMENT_POSITION_FOLLOWING), 'Battle card is easy to find above Road to LA28');

    // Small screens, themes, clear child highlight and accessible refresh controls.
    for (const theme of ['dark', 'light']) for (const width of [320, 390, 430, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      ok(await feed(page).evaluate(section => section.getBoundingClientRect().left >= 0 && section.getBoundingClientRect().right <= innerWidth), theme + '/' + width + ' panel fits viewport');
      const overflow = await feed(page).locator('*').evaluateAll(nodes => nodes.filter(node => {
        const style = getComputedStyle(node);
        return style.display !== 'inline' && node.clientWidth > 0 && node.scrollWidth > node.clientWidth + 2 && !['auto', 'scroll'].includes(style.overflowX);
      }).map(node => ({ className: node.className, width: node.clientWidth, scroll: node.scrollWidth })));
      eq(overflow, [], theme + '/' + width + ' names, score and controls fit their cards');
      const rect = await feed(page).locator('[data-active-battles-refresh]').boundingBox();
      ok(rect.height >= 44 && rect.width >= 44, theme + '/' + width + ' refresh has a 44px target');
      if (process.env.JKCREW_SCREENSHOT_DIR && [390, 1440].includes(width)) {
        fs.mkdirSync(process.env.JKCREW_SCREENSHOT_DIR, { recursive: true });
        await feed(page).screenshot({ path: path.join(process.env.JKCREW_SCREENSHOT_DIR, 'parent-battles-' + theme + '-' + width + '.png'), animations: 'disabled' });
      }
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    eq(await feed(page).locator('.crew-live-badge').evaluate(node => getComputedStyle(node, '::before').animationName), 'none', 'Reduced motion disables live pulse');

    // Fresh scores update independently of Home, without altering weekly points.
    const baseReads = await page.evaluate(() => qa.reads.length);
    await page.evaluate(() => { qa.rows['child-a'][0].teams[0].score = 44; });
    await page.clock.runFor(21000); await settle(page);
    eq(await feed(page).locator('[data-active-battle-id=one] .team-1 .crew-live-score strong').textContent(), '44', 'Timed refresh updates team score');
    eq(await page.evaluate(() => qa.reads.length), baseReads, 'Score refresh does not re-fetch parent profiles, weekly sheet or roster');
    ok((await page.locator('.parent-home-metrics').innerText()).includes('32'), 'Live battle does not add unearned reward to weekly total');
    await page.evaluate(() => { qa.fail = true; }); await settle(page);
    eq(await feed(page).locator('[data-active-battle-id=one] .team-1 .crew-live-score strong').textContent(), '44', 'Refresh failure preserves last good score');
    ok(/last update|couldn.t refresh/i.test(await feed(page).innerText()), 'Stale scores are clearly labelled');
    await page.evaluate(() => { qa.fail = false; qa.rows['child-a'][0].teams[0].score = 46; });
    await feed(page).locator('[data-active-battles-refresh]').click(); await idle(page);
    eq(await feed(page).locator('[data-active-battle-id=one] .team-1 .crew-live-score strong').textContent(), '46', 'Local retry recovers score refresh');
    await page.evaluate(() => { qa.hold = true; window.pendingRead = state.activeBattles.refresh(); });
    const pendingCount = await calls(page);
    await page.evaluate(() => { void state.activeBattles.refresh(); void state.activeBattles.refresh(); });
    await page.clock.runFor(41000);
    eq(await calls(page), pendingCount, 'Rapid taps and timer ticks share one in-flight request');
    await release(page); await page.evaluate(() => pendingRead);
    for (const mode of ['hidden', 'offline']) {
      await page.evaluate(mode => { if (mode === 'hidden') { qa.visible = false; document.dispatchEvent(new Event('visibilitychange')); } else { qa.online = false; dispatchEvent(new Event('offline')); } }, mode);
      const before = await calls(page); await page.clock.runFor(41000); await settle(page);
      eq(await calls(page), before, mode + ' pauses polling and manual requests');
      if (mode === 'offline') ok(/offline/i.test(await feed(page).innerText()), 'Offline scores are labelled offline');
      await page.evaluate(mode => { if (mode === 'hidden') { qa.visible = true; document.dispatchEvent(new Event('visibilitychange')); } else { qa.online = true; dispatchEvent(new Event('online')); } }, mode);
      await idle(page);
      eq(await calls(page), before + 1, mode + ' resumes with one fresh request');
    }

    // A failed full Home reload leaves the visible, current child's feed refreshable.
    await page.evaluate(async () => { qa.failAssignments = true; try { await renderParentHome(); } catch (_) {} qa.failAssignments = false; });
    const afterFailedHome = await calls(page);
    await settle(page);
    eq(await calls(page), afterFailedHome + 1, 'Failed Home reload does not invalidate the still-visible battle feed');
    eq(await feed(page).locator('[data-active-battle-id]').count(), 3, 'Failed Home reload retains current child cards');

    // Real child selector destroys pending work; a previous child's delayed result cannot return.
    await page.evaluate(() => { qa.hold = true; window.pendingOldChild = state.activeBattles.refresh(); });
    const oldCall = await calls(page);
    await page.locator('#parent-athlete-select').selectOption('child-b'); await page.waitForFunction(() => document.querySelector('[data-active-battle-id=koby]')); await idle(page);
    eq(await page.evaluate(index => qa.calls[index - 1].aborted, oldCall), true, 'Child switch aborts the previous request');
    eq(await page.evaluate(() => qa.calls.at(-1).args.p_athlete_id), 'child-b', 'Child selector reads only the new linked child');
    await release(page); await page.evaluate(() => pendingOldChild);
    eq(await feed(page).locator('[data-active-battle-id]').getAttribute('data-active-battle-id'), 'koby', 'Late Ali response cannot paint into Koby Home');
    await page.clock.runFor(21000); await settle(page);
    ok((await page.evaluate(index => qa.calls.slice(index).map(call => call.args.p_athlete_id), oldCall)).every(id => id === 'child-b'), 'Old child timer is gone');

    // Defensive client scope and server-relative expiry, even with device clock two days ahead.
    await page.evaluate(() => { qa.forceRows = [qaBattle('wrong-child', 'child-a'), qaBattle('expires', 'child-b', [1, 1], { ends_at: new Date(qaNow() + 1000).toISOString() }),
      qaBattle('ended', 'child-b', [1, 1], { ends_at: new Date(qaNow()).toISOString() }), qaBattle('future', 'child-b', [1, 1], { starts_at: new Date(qaNow() + 60000).toISOString() })]; });
    await settle(page);
    eq(await feed(page).locator('[data-active-battle-id]').count(), 1, 'Only selected-child, currently running battle survives malformed/stale response');
    eq(await feed(page).locator('[data-active-battle-id]').getAttribute('data-active-battle-id'), 'expires', 'Server clock handles fast device time');
    await page.clock.runFor(1001);
    eq(await feed(page).locator('[data-active-battle-id]').count(), 0, 'Expired battle disappears without waiting for another request');
    ok(/not in|no (?:active|live|current)|isn.t in/i.test(await feed(page).innerText()), 'No active battle is explicit');
    await page.evaluate(() => { qa.forceRows = null; qa.rows['child-b'][0].status = 'cancelled'; }); await settle(page);
    eq(await feed(page).locator('[data-active-battle-id]').count(), 0, 'Cancelled battle disappears when scoped server summary removes it');

    // Actual navigation and account teardown immediately cancel timers and in-flight reads.
    await page.evaluate(() => { qa.hold = true; window.pendingNavigation = state.activeBattles.refresh(); });
    const navCall = await calls(page);
    await page.evaluate(() => navigate('parentCoaching'));
    eq(await page.evaluate(index => qa.calls[index - 1].aborted, navCall), true, 'Real navigation aborts battle request');
    eq(await page.evaluate(() => state.activeBattles), null, 'Real navigation clears the battle mount');
    await release(page); await page.evaluate(() => pendingNavigation); await page.clock.runFor(41000);
    eq(await calls(page), navCall, 'No background polling after leaving Home');
    eq(await feed(page).count(), 0, 'Late response cannot replace another page');
    await home(page); await idle(page);
    await page.evaluate(() => { qa.hold = true; window.pendingAccount = state.activeBattles.refresh(); });
    const accountCall = await calls(page);
    await page.evaluate(() => { teardownRealtimeSync(); state.user = { id: 'parent-two' }; state.profile = { id: 'parent-two', role: 'parent' }; state.sessionSetupVersion++; state.parentAthleteId = ''; });
    eq(await page.evaluate(index => qa.calls[index - 1].aborted, accountCall), true, 'Account teardown aborts previous family request');
    await home(page); await idle(page); await release(page); await page.evaluate(() => pendingAccount);
    eq(await page.evaluate(() => qa.calls.at(-1).args.p_athlete_id), 'other-child', 'New account selects only its own linked child');
    ok(!(await feed(page).innerText()).includes('Ali Fixture'), 'Old family response is absent after account switch');
    await page.evaluate(() => { qa.rows['other-child'] = [qaBattle('other-live', 'other-child')]; }); await settle(page);
    eq(await feed(page).locator('[data-active-battle-id]').count(), 1, 'Other family has its own current snapshot');
    await page.evaluate(() => { qa.denial = true; }); await settle(page);
    eq(await feed(page).locator('[data-active-battle-id]').count(), 0, 'Access denial clears a prior child snapshot instead of retaining private data');
    await page.close();

    // Unlinked parent and first-load failures never fabricate activity.
    const empty = await setup();
    await empty.evaluate(() => { state.user.id = 'parent-empty'; state.profile.id = 'parent-empty'; }); await home(empty);
    eq(await calls(empty), 0, 'Unlinked parent does not request a battle feed');
    eq(await feed(empty).count(), 0, 'Unlinked parent keeps the existing waiting screen');
    await empty.close();
    const failed = await setup();
    await failed.evaluate(() => { qa.fail = true; }); await home(failed); await idle(failed);
    ok(/couldn.t load|unavailable|retry/i.test(await feed(failed).innerText()), 'Initial network failure is recoverable');
    ok(!/own battle controls|forfeit|accept battle/i.test(await feed(failed).innerText()), 'Parent error state never points at rider-only controls');
    eq(await failed.locator('[data-parent-leaderboards]').count(), 1, 'Battle failure does not break Home leaderboards');
    await failed.evaluate(() => { qa.fail = false; qa.rows['child-a'] = [qaBattle('recovered')]; });
    await feed(failed).getByRole('button', { name: /retry/i }).click(); await idle(failed);
    eq(await feed(failed).locator('[data-active-battle-id]').getAttribute('data-active-battle-id'), 'recovered', 'Initial failure retry succeeds');
    await failed.close();
    eq(errors, [], 'No browser errors across all journeys');
    console.log(JSON.stringify({ passed: checks, file: 'tests/parent-active-battles-ui.cjs', screenshots: process.env.JKCREW_SCREENSHOT_DIR || null }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
