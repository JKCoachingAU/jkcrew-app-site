// Parent LA28 app integration with linked-child fixtures; no production accounts or writes.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..'), source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const extract = name => {
  const start = source.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'));
  assert(start >= 0, 'Production helper exists: ' + name);
  const rest = source.slice(start); return rest.slice(0, rest.indexOf('\n}') + 2);
};
const array = name => { const start = source.indexOf('const ' + name + ' = ['); assert(start >= 0, name); return source.slice(start, source.indexOf('\n];', start) + 3); };
const helpers = [
  'coachPrimaryView', 'parentPrimaryView', 'athletePrimaryView', 'notificationPrimaryView', 'navNotificationBadge',
  'riderHasUciPoints', 'primaryNavButtonHtml', 'updateRiderUciNavigation', 'loadRiderUciNavigation', 'renderShell',
  'parentSelectionStorageKey', 'storedParentAthleteId', 'rememberParentAthleteId', 'getParentRiderContext',
  'parentWaitingHtml', 'parentChildSwitcherHtml', 'parentPageHeadHtml', 'renderCurrentParentView', 'bindParentPageActions',
  'parentRoadToLa28CardHtml', 'loadParentRoadToLa28Card', 'renderParentHome',
  'boardUciDate', 'boardUciSourceUrl', 'renderUciTracker', 'renderUciSchedule', 'navigate',
];
let browser, checks = 0;
const eq = (value, expected, label) => { assert.deepEqual(value, expected, label); checks++; };
const ok = (value, label) => { assert(value, label); checks++; };
(async () => {
  browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5000); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://jkcrew.test') return route.abort();
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/uci-tracker.css"><link rel="stylesheet" href="/recovery-mode.css"></head><body><div id="app"></div></body></html>' });
    const file = path.join(root, decodeURIComponent(url.pathname));
    return file.startsWith(root + path.sep) && fs.existsSync(file) ? route.fulfill({ path: file }) : route.abort();
  });
  await page.goto('http://jkcrew.test/');
  await page.addScriptTag({ path: path.join(root, 'uci-rankings.js') });
  await page.evaluate(() => {
    window.qa = { requests: [], writes: [], holds: new Set(), failures: new Set(), releases: {}, mounts: [], scheduleMounts: [], destroys: 0, messages: [] };
    window.waitQa = async (key, value) => {
      const frozen = structuredClone(value);
      if (qa.holds.has(key)) await new Promise(resolve => qa.releases[key] = resolve);
      if (qa.failures.has(key)) throw new Error('Fixture connection unavailable');
      return frozen;
    };
    window.children = [
      { id: 'child-koby', role: 'athlete', display_name: 'Koby Fixture', uci_id: '10000000001', level: 5 },
      { id: 'child-lara', role: 'athlete', display_name: 'Lara Fixture', uci_id: '10000000003', level: 5 },
      { id: 'child-unranked', role: 'athlete', display_name: 'Unranked Fixture', uci_id: null, level: 2 },
      { id: 'other-child', role: 'athlete', display_name: 'Unrelated Fixture', uci_id: '10000000004', level: 1 },
    ];
    window.links = { 'parent-one': ['child-koby', 'child-lara', 'child-unranked'], 'parent-two': ['other-child'], 'parent-empty': [] };
    window.state = {
      view: 'home', user: { id: 'parent-one', email: 'parent@example.invalid' }, profile: { id: 'parent-one', role: 'parent', display_name: 'Parent Fixture', uci_id: '10000000004' },
      parentAthleteId: '', selectedAthleteId: '', sessionSetupVersion: 1, notificationUnread: [],
      videoReviewRecordedReplies: new Map(), videoReviewMedia: new Map(), athleteHomeRenderVersion: 0, sessionRenderVersion: 0,
    };
    window.app = document.querySelector('#app');
    window.PROFILE_SELECT = 'id,display_name,role,uci_id';
    window.escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    window.firstName = profile => String(profile?.display_name || '').split(' ')[0];
    window.avatarHtml = profile => `<span class="avatar">${escapeHtml(firstName(profile))}</span>`;
    window.isCoachRole = role => ['coach', 'admin'].includes(role);
    window.riderRecoveryActive = window.riderFeaturesDisabled = window.riderFeatureAccessUnknown = () => false;
    window.refreshRiderFeatureAccess = async () => true;
    window.client = { from: table => {
      const query = { filters: {}, select: () => query, eq: (key, value) => { query.filters[key] = value; return query; }, in: (key, value) => { query.filters[key] = value; return query; }, order: () => query, limit: () => query,
        update: () => { qa.writes.push(table); throw Error('Parent must never write'); },
        then: (resolve, reject) => {
          const filters = { ...query.filters }; qa.requests.push({ table, filters });
          const rows = table === 'parent_athletes' ? (links[filters.parent_id] || []).map(athlete_id => ({ athlete_id, relationship: 'Parent' }))
            : table === 'profiles' ? children.filter(child => filters.id?.includes(child.id)) : [];
          return waitQa(table + ':' + (filters.parent_id || filters.athlete_id || 'profiles'), { data: rows, error: null }).then(resolve, reject);
        },
      }; return query;
    }, rpc: async name => { throw Error('Unexpected app RPC ' + name); } };
    window.snapshot = {
      schemaVersion: 1, eventBreakdowns: {}, checkedAt: new Date().toISOString(), stale: false,
      categories: {
        men: { rankingDate: '2026-10-20', sourceUrl: 'https://dataride.uci.org/iframe/RankingDetails/156', rows: [
          { rank: 13, name: 'KOBY Official', nation: 'AUS', points: 125, uciId: '10000000001' },
          { rank: 15, name: 'UNRELATED Official', nation: 'GER', points: 999, uciId: '10000000004' },
        ] },
        women: { rankingDate: '2026-10-20', sourceUrl: 'https://dataride.uci.org/iframe/RankingDetails/157', rows: [
          { rank: 7, name: 'LARA Official', nation: 'GER', points: 350, uciId: '10000000003' },
        ] },
      },
    };
    const findRider = JKCUciRankings.findRider;
    window.JKCUciRankings = { findRider, peek: () => snapshot, load: () => waitQa('rankings', snapshot) };
    window.JKCUciTracker = { mount: (root, options) => {
      qa.mounts.push(options); root.innerHTML = `<div data-parent-tracker-fixture>Read-only tracker for ${escapeHtml(options.riderId || '')}</div>`;
      return { destroy: () => qa.destroys++, hasUnsavedChanges: () => false };
    } };
    window.UCI2027Schedule = { mount: (root, options) => {
      qa.scheduleMounts.push(options); root.innerHTML = '<div data-parent-schedule-fixture>Official schedule</div>';
      return { destroy: () => {}, reload: () => {} };
    } };
    window.getWeeklyAssignments = id => waitQa('assignments:' + id, { assignments: [], awards: [], assignmentAttempts: [] });
    window.getMyCoachMessages = window.getHelpRequests = window.getDashboardItems = window.getLeaderboard = async () => [];
    window.getXpSummary = async () => ({ level: 5, xp_needed: 20, next_level: 6 });
    window.normalizeXpSummary = value => value;
    window.completionAssignments = rows => rows;
    window.isAssignmentComplete = () => false;
    window.weeklyCompletionPercent = () => 0;
    window.pointsReceiptAttributes = () => '';
    // Full leaderboard behavior is exercised in parent-home-leaderboards.cjs.
    window.boardRankingsShellHtml = () => '<section data-parent-leaderboards></section>';
    window.bindBoardRankings = () => {};
    window.coachMessagesHtml = window.parentEngagementAlertHtml = window.parentLatestCoachMessageHtml = window.parentNextItemHtml = window.parentLatestFeedbackHtml = window.parentRecentActivityHtml = () => '';
    window.notify = value => qa.messages.push(value);
    window.messageFrom = error => error.message;
    window.setLoading = () => ++state.loadingOverlayToken || (state.loadingOverlayToken = 1);
    window.finishScreenLoading = () => true;
    window.setButtonBusy = () => () => {};
    window.cacheClear = () => {};
    window.liveRun = null; window.runUndoStack = []; window.runRedoStack = [];
    const noops = ['setSyncStatus','refreshNotificationCentre','refreshBoardChatUnread','showNotificationDrawer','signOutCurrentDevice','bindDailyVenueAccordions','bindSessionAssignmentAccordions','dismissCoachMessage','playRunPreview',
      'clearDailyFeatureMounts','dismissDailyFinishForNavigation','closeTrainingProgressViews','closeAthleteReviewViewer','closeContestEventModal','closeContestMergeModal','closeEventCourseViewer','clearHelpVideoPreview','stopRunPlayback','disconnectLiveRun','closeJkcYard','resetPageExpansions','refreshLiveRunInvites','mountStartupPrompts','cancelScreenLoading','resetVideoReviewPrivateState','applyTheme','renderRecoveryCoach','renderAthleteCoaching','renderParentWeek','renderParentCoaching','renderParentCalendar','renderParentMore','renderSession','renderChallenges','renderTricktionary','renderCoachCommand','renderSessionViewer','renderCoachBattleViewer','renderCoachTools','renderPastEvents','renderCoachMore','renderBikeGarage','renderShredZone','renderJkcYard','renderCoachAdminRecords','renderPlanner','renderParents','renderVideoReviews','renderBoard','renderCrew','renderAthleteCrew','renderStudentProfile','renderCoachPreview','renderPublicAthleteProfile','renderNotes','renderProfile','renderParentTricktionary','renderAthleteHome','renderRiderRecoveryHome'];
    noops.forEach(name => window[name] = () => {});
    window.renderContests = async () => {
      const context = await getParentRiderContext(); qa.eventChildId = context.selected?.id;
      document.querySelector('#view').innerHTML = '<button data-open-contest-event="official-event">View event</button>';
      document.querySelector('[data-open-contest-event]').onclick = () => { qa.eventOpened = { role: state.profile.role, childId: state.parentAthleteId }; };
    };
  });
  await page.addScriptTag({ content: ['athleteNav','parentNav','coachNav','coachNavGroups'].map(array).join('\n') + '\n' + helpers.map(extract).join('\n') });
  await page.evaluate(() => { renderShell(); return navigate('home'); });
  await page.locator('#parent-road-la28-card').waitFor();
  await page.waitForFunction(() => document.querySelector('#parent-road-la28-card')?.textContent.includes('125'));
  const firstCard = await page.locator('#parent-road-la28-card').innerText();
  ok(firstCard.includes('Koby') && firstCard.includes('13') && firstCard.includes('125'), 'Parent Home shows selected linked child name, rank and official points');
  ok(!firstCard.includes('999'), 'Parent’s own unrelated UCI ID is not used for child card');
  ok(firstCard.includes('2026'), 'Parent card includes the official ranking date');
  eq(await page.locator('#parent-road-la28-card .parent-uci-source').getAttribute('href'), 'https://dataride.uci.org/iframe/RankingDetails/156', 'Parent card links to the selected child’s official category source');
  eq(await page.locator('.bottom-nav [data-view="uciTracker"]').count(), 1, 'Parent has a dedicated LA28 tab');
  eq(await page.locator('.bottom-nav .nav-btn').count(), 7, 'Parent nav has seven destinations');
  eq(await page.locator('#parent-athlete-select option').count(), 3, 'Parent child switcher lists only linked children');
  eq(await page.locator('#parent-athlete-select option[value="other-child"]').count(), 0, 'Unrelated rider never appears in switcher');
  await page.locator('.bottom-nav [data-view="uciTracker"]').click();
  await page.locator('[data-parent-tracker-fixture]').waitFor();
  eq(await page.evaluate(() => [qa.mounts.at(-1).userId, qa.mounts.at(-1).role, qa.mounts.at(-1).riderId]), ['parent-one', 'parent', 'child-koby'], 'Tracker receives parent identity and selected linked child explicitly');
  ok(await page.evaluate(() => qa.mounts.at(-1).isActive()), 'Selected-child tracker begins active');
  await page.evaluate(() => window.firstMount = qa.mounts.at(-1));
  await page.locator('#parent-athlete-select').selectOption('child-lara');
  await page.waitForFunction(() => qa.mounts.at(-1).riderId === 'child-lara');
  eq(await page.evaluate(() => state.parentAthleteId), 'child-lara', 'Switching tracker child updates shared parent selection');
  eq(await page.evaluate(() => firstMount.isActive()), false, 'Old child callbacks become inactive immediately');
  eq(await page.evaluate(() => localStorage.getItem(parentSelectionStorageKey())), 'child-lara', 'Child selection is persisted per parent account');
  await page.evaluate(() => qa.mounts.at(-1).onOpenEvent('official-event'));
  eq(await page.evaluate(() => state.view), 'contests', 'Parent tracker event action opens existing Contests');
  eq(await page.evaluate(() => qa.eventOpened), { role: 'parent', childId: 'child-lara' }, 'Event opens with read-only parent role and selected child');
  await page.evaluate(() => navigate('uciTracker'));
  await page.evaluate(() => qa.mounts.at(-1).onOpenSchedule());
  eq(await page.evaluate(() => state.view), 'uciSchedule', 'Parent can open official schedule from tracker');
  eq(await page.evaluate(() => qa.scheduleMounts.at(-1).canManage), false, 'Parent schedule has no management capability');
  eq(await page.evaluate(() => qa.scheduleMounts.at(-1).parentView), true, 'Parent schedule uses its dedicated read-only data path');
  await page.evaluate(() => qa.scheduleMounts.at(-1).onBack());
  eq(await page.evaluate(() => state.view), 'uciTracker', 'Schedule returns parent to LA28');
  eq(await page.evaluate(() => qa.mounts.at(-1).riderId), 'child-lara', 'Schedule return retains child selection');
  await page.evaluate(() => navigate('home'));
  await page.waitForFunction(() => document.querySelector('#parent-road-la28-card')?.textContent.includes('350'));
  ok((await page.locator('#parent-road-la28-card').innerText()).includes('Lara'), 'Home follows tracker child selection');
  eq(await page.locator('#parent-road-la28-card .parent-uci-source').getAttribute('href'), 'https://dataride.uci.org/iframe/RankingDetails/157', 'Women’s child ranking uses the women’s official source');
  // Failed public ranking loads remain recoverable without changing the selected child.
  await page.evaluate(() => { qa.failures.add('rankings'); return renderParentHome(); });
  await page.locator('#parent-road-la28-card [data-parent-uci-retry]').waitFor();
  ok((await page.locator('#parent-road-la28-card').innerText()).includes('unavailable'), 'Parent card gives a clear failed-load state');
  await page.evaluate(() => qa.failures.delete('rankings'));
  await page.locator('#parent-road-la28-card [data-parent-uci-retry]').click();
  await page.waitForFunction(() => document.querySelector('#parent-road-la28-card')?.textContent.includes('350'));
  eq(await page.evaluate(() => state.parentAthleteId), 'child-lara', 'Retry restores the same child ranking');
  await page.locator('#parent-athlete-select').selectOption('child-unranked');
  await page.waitForFunction(() => state.parentAthleteId === 'child-unranked' && document.querySelector('#parent-road-la28-card')?.textContent.includes('Unranked'));
  const unranked = await page.locator('#parent-road-la28-card').innerText();
  ok(!unranked.includes('#13') && !unranked.includes('350'), 'Unlinked UCI child never inherits sibling ranking');
  eq(await page.locator('.bottom-nav [data-view="uciTracker"]').count(), 1, 'Parent retains event-planning tab for an unranked child');
  await page.evaluate(() => { snapshot.stale = true; rememberParentAthleteId('child-koby'); return renderCurrentParentView(); });
  await page.waitForFunction(() => document.querySelector('#parent-road-la28-card')?.textContent.toLowerCase().includes('last'));
  ok((await page.locator('#parent-road-la28-card').innerText()).toLowerCase().includes('last'), 'Parent card labels last available stale rankings');
  await page.evaluate(() => { snapshot.stale = false; });
  // Slow child progress must not overwrite a newer sibling selection.
  await page.evaluate(() => { qa.holds.add('assignments:child-koby'); rememberParentAthleteId('child-koby'); window.slowHome = renderParentHome(); });
  await page.waitForFunction(() => typeof qa.releases['assignments:child-koby'] === 'function');
  await page.evaluate(() => { rememberParentAthleteId('child-lara'); return renderParentHome(); });
  await page.evaluate(async () => { qa.holds.delete('assignments:child-koby'); qa.releases['assignments:child-koby'](); await slowHome; });
  ok((await page.locator('#parent-road-la28-card').innerText()).includes('Lara'), 'Late old-child Home data cannot overwrite current child');
  // A slow public ranking update must not overwrite another page.
  await page.evaluate(() => { qa.holds.add('rankings'); rememberParentAthleteId('child-koby'); return renderParentHome(); });
  await page.waitForFunction(() => typeof qa.releases.rankings === 'function');
  await page.evaluate(() => navigate('contests'));
  await page.evaluate(() => { qa.holds.delete('rankings'); qa.releases.rankings(); });
  eq(await page.locator('#parent-road-la28-card').count(), 0, 'Late Home rank response does not replace Contests');
  // An old child-switch failure must not replace the destination chosen while it was loading.
  await page.evaluate(() => navigate('uciTracker'));
  await page.evaluate(() => { delete qa.releases['parent_athletes:parent-one']; qa.holds.add('parent_athletes:parent-one'); });
  await page.locator('#parent-athlete-select').selectOption('child-lara');
  await page.waitForFunction(() => typeof qa.releases['parent_athletes:parent-one'] === 'function');
  await page.evaluate(() => { qa.holds.delete('parent_athletes:parent-one'); return navigate('contests'); });
  await page.evaluate(() => { qa.failures.add('parent_athletes:parent-one'); qa.releases['parent_athletes:parent-one'](); });
  await page.waitForTimeout(30);
  eq(await page.locator('[data-open-contest-event]').count(), 1, 'Late failed child switch cannot replace current Contests page');
  await page.evaluate(() => qa.failures.delete('parent_athletes:parent-one'));
  // A link lookup from the previous account cannot select a child after an account switch.
  await page.evaluate(() => { delete qa.releases['parent_athletes:parent-one']; qa.holds.add('parent_athletes:parent-one'); window.oldAccountHome = navigate('home'); });
  await page.waitForFunction(() => typeof qa.releases['parent_athletes:parent-one'] === 'function');
  await page.evaluate(() => { state.user = { id: 'parent-two', email: 'other@example.invalid' }; state.profile = { id: 'parent-two', role: 'parent', display_name: 'Other Parent' }; state.sessionSetupVersion++; renderShell(); return navigate('home'); });
  await page.waitForFunction(() => state.parentAthleteId === 'other-child');
  await page.evaluate(async () => { qa.holds.delete('parent_athletes:parent-one'); qa.releases['parent_athletes:parent-one'](); await oldAccountHome; });
  eq(await page.evaluate(() => [state.parentAthleteId, localStorage.getItem(parentSelectionStorageKey())]), ['other-child', 'other-child'], 'Late old-account context cannot replace current parent selection or storage');
  eq(await page.locator('#parent-athlete-select').count(), 0, 'Single linked child has no unrelated choice list');
  ok((await page.locator('#parent-road-la28-card').innerText()).includes('Unrelated'), 'Second parent gets only their linked child');
  await page.evaluate(() => { state.user = { id: 'parent-empty', email: 'empty@example.invalid' }; state.profile = { id: 'parent-empty', role: 'parent', display_name: 'Waiting Parent' }; state.sessionSetupVersion++; renderShell(); return navigate('uciTracker'); });
  ok((await page.locator('#view').innerText()).includes('Waiting'), 'Parent with no linked rider receives waiting state');
  eq(await page.locator('[data-parent-tracker-fixture]').count(), 0, 'No-child parent does not mount a default unrelated tracker');
  await page.evaluate(() => { state.user = { id: 'parent-one', email: 'parent@example.invalid' }; state.profile = { id: 'parent-one', role: 'parent', display_name: 'Parent Fixture' }; state.sessionSetupVersion++; state.parentAthleteId = 'child-koby'; renderShell(); return navigate('home'); });
  await page.waitForFunction(() => document.querySelector('#parent-road-la28-card')?.textContent.includes('125'));
  // The compact parent navigation remains usable on small and larger mobile screens.
  for (const theme of ['dark','light']) for (const width of [320,390,430,768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    const layout = await page.locator('.bottom-nav').evaluate(nav => {
      const buttons = [...nav.querySelectorAll('.nav-btn')];
      return { count: buttons.length, rows: new Set(buttons.map(b => b.getBoundingClientRect().y)).size,
        targets: buttons.every(b => b.getBoundingClientRect().width >= 44 && b.getBoundingClientRect().height >= 44), overflow: nav.scrollWidth > nav.clientWidth || document.documentElement.scrollWidth > innerWidth };
    });
    eq(layout.count, 7, `${theme}/${width}: parent has seven tabs`); eq(layout.rows, 1, `${theme}/${width}: parent tabs stay in one row`);
    ok(layout.targets && !layout.overflow, `${theme}/${width}: parent tap targets fit without overflow`);
    const cardFits = await page.locator('#parent-road-la28-card').evaluate(card => {
      const { left, right } = card.getBoundingClientRect();
      return left >= 0 && right <= innerWidth && card.scrollWidth <= card.clientWidth;
    });
    ok(cardFits, `${theme}/${width}: linked-child Home card fits the screen`);
  }
  eq(await page.evaluate(() => qa.writes), [], 'Parent app flow never issues writes');
  eq(errors, [], 'No browser exceptions during parent navigation and child switching');
  console.log(`PASS: ${checks} parent Road to LA28 app integration checks.`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); });
