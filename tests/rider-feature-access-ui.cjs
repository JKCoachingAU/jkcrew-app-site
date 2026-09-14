const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const extract = name => {
  const start = app.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert(start >= 0, `Actual ${name} exists`);
  const rest = app.slice(start);
  return rest.slice(0, rest.indexOf('\n}') + 2);
};
const names = [
  'riderFeaturesDisabled', 'riderFeatureAccessUnknown', 'showRiderAccessMessage',
  'refreshRiderFeatureAccess', 'closeRestrictedRiderFeatures', 'startRiderFeatureAccessWatch',
  'guardRiderFeatureInteraction', 'renderRestrictedRiderHome', 'riderAccessToggleHtml',
  'toggleRiderFeatureAccess', 'renderCrew', 'renderShell', 'navigate', 'resetPageExpansions',
  'signOutCurrentDevice', 'renderAthleteHome',
];
const accessConstant = app.match(/^const RIDER_ACCESS_MESSAGE = .*;$/m)?.[0];
assert(accessConstant, 'Actual restriction message exists');
const captureListener = app.match(/^\["click", "submit", "pointerdown", "keydown", "input", "change"\].*guardRiderFeatureInteraction.*;$/m)?.[0];
assert(captureListener, 'Actual capture handler is installed for pointer, keyboard, and forms');
const renderers = [...new Set(extract('navigate').match(/\brender[A-Z]\w+/g))];
const screenshotDir = process.env.JKCREW_SCREENSHOT_DIR;
if (screenshotDir) fs.mkdirSync(screenshotDir, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 1000 } });
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push(request.url()));
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"></div><div id="toast"></div></body></html>');
    await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'styles.css'), 'utf8') });
    await page.evaluate(({ code, renderers }) => {
      window.app = document.querySelector('#app');
      window.state = {
        view: 'home', user: { id: 'rider', email: 'qa@example.test' }, profile: { id: 'rider', role: 'athlete', display_name: 'Alex & Rider' },
        riderAccess: null, riderAccessCheckedAt: 0, riderAccessRequest: null, riderAccessTimer: null,
        athleteHomeRenderVersion: 0, sessionRenderVersion: 0, loadingOverlayToken: 0,
        sessionOpenDailyVenues: new Set(), sessionOpenAssignmentSections: new Set(),
        videoReviewRecordedReplies: new Map(), videoReviewMedia: new Map(),
      };
      window.liveRun = null;
      window.qaCalls = []; window.qaNotices = []; window.qaActions = []; window.qaClosed = [];
      window.qaDisabled = true; window.qaFailRead = false; window.qaFailWrite = false;
      window.qaHoldRead = false; window.qaHeldReads = []; window.qaHoldWrite = false; window.qaHeldWrites = [];
      window.qaRoster = [
        { id: 'rider', display_name: 'Alex & Rider', groupNames: ['monday', 'wednesday'] },
        { id: 'other', display_name: 'Other <img src=x onerror="window.injected=true">', groupNames: ['tuesday'] },
      ];
      window.qaAccess = [{ athlete_id: 'rider', features_disabled: false }, { athlete_id: 'other', features_disabled: true }];
      window.client = {
        rpc: async (name, args) => {
          qaCalls.push({ name, args });
          if (name === 'get_rider_feature_access') {
            const result = { data: state.profile.role === 'athlete' ? [{ athlete_id: state.user.id, features_disabled: qaDisabled }] : qaAccess.map(row => ({ ...row })) };
            if (qaHoldRead) return new Promise(resolve => qaHeldReads.push(() => resolve(result)));
            return qaFailRead ? { error: Error('Access unavailable') } : result;
          }
          if (name === 'set_rider_feature_access') {
            if (qaHoldWrite) await new Promise(resolve => qaHeldWrites.push(resolve));
            if (qaFailWrite) return { error: Error('Write rejected') };
            const row = { athlete_id: args.p_athlete_id, features_disabled: args.p_disabled };
            qaAccess = [...qaAccess.filter(item => item.athlete_id !== row.athlete_id), row];
            return { data: [row] };
          }
          throw Error(`Unexpected RPC ${name}`);
        },
        from: table => {
          const query = {};
          for (const method of ['select', 'eq', 'order', 'in', 'limit', 'delete']) query[method] = () => query;
          query.then = (resolve, reject) => Promise.resolve({ data: table === 'profiles' ? qaRoster : [] }).then(resolve, reject);
          return query;
        },
        auth: { signOut: async () => { qaActions.push('signout'); } },
      };
      window.withTimeout = async promise => promise;
      window.notify = (message, tone) => { qaNotices.push({ message, tone }); document.querySelector('#toast').textContent = message; };
      window.messageFrom = error => error.message;
      window.escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
      window.avatarHtml = () => '<div class="avatar student-chip-avatar" aria-hidden="true">AR</div>';
      window.isCoachRole = role => ['coach', 'admin'].includes(role);
      window.coachGroups = [['monday', 'Monday Team'], ['tuesday', 'Tuesday Team'], ['wednesday', 'Wednesday Team']];
      window.injuredGroupId = 'injured';
      window.getCoachRoster = async () => qaRoster;
      window.getCoachCommandData = async () => ({ statuses: [] });
      window.getCoachLiveActivity = async () => [];
      window.statusByAthlete = () => new Map();
      window.statCard = () => ''; window.coachLiveActivityHtml = () => '';
      window.getAthleteHomeLeaderboard = async () => [{ athlete_id: state.user.id, weekly_points: 42 }];
      window.xpProgressHtml = () => '<p>250 XP</p>'; window.riderXpSummary = () => ({});
      window.setButtonBusy = (button, label) => { const caption = button.textContent; button.disabled = true; button.textContent = label; return () => { button.disabled = false; button.textContent = caption; }; };
      window.setLoading = () => { document.querySelector('#view').innerHTML = ''; return ++state.loadingOverlayToken; };
      window.finishScreenLoading = token => token === state.loadingOverlayToken;
      window.coachPrimaryView = window.parentPrimaryView = window.athletePrimaryView = view => view;
      window.navNotificationBadge = () => '';
      window.athleteNav = [['home', 'Home'], ['session', 'Session'], ['challenges', 'Challenges'], ['contests', 'Contests'], ['board', 'Board'], ['profile', 'Profile']];
      window.parentNav = [['home', 'Home'], ['parentWeek', 'This week'], ['profile', 'Profile']];
      window.coachNav = [['command', 'Command'], ['crew', 'Riders']];
      window.coachNavGroups = [{ id: 'crew', label: 'Riders', icon: '●', links: [['crew', 'Students']] }];
      window.setupRealtimeSync = async () => {};
      window.supportsPushNotifications = () => false;
      for (const name of ['getWeeklyRiderBattles', 'getTrickRequestsForAthlete', 'getRiderSheetProposals', 'getMyCoachMessages', 'getHelpRequestSummaries']) window[name] = async () => [];
      window.getActiveSession = async () => null;
      window.getWeeklyAssignments = async () => ({ assignments: [], awards: [] });
      window.getMyProgressMilestones = async () => ({});
      window.riderBattleRecord = () => ({});
      for (const name of ['battleDashboardAlertsHtml', 'scoreRankingCard', 'athleteCoachingCtaHtml', 'quoteSection', 'goalsSection', 'privateProgressMilestonesHtml', 'coachMessagesHtml', 'weekSummaryHtml', 'riderProposalForm', 'athleteTrickRequestSection']) window[name] = () => '';
      for (const name of ['bindGoalActions', 'dismissCoachMessage', 'submitRiderSheetProposal', 'updateRiderProposalCounts', 'submitTrickRequest']) window[name] = () => {};
      window.athleteRunBuilderCtaHtml = () => '<button id="open-home-run-builder">Build run</button>';
      window.openRunBuilder = () => qaActions.push('#open-home-run-builder');
      for (const name of ['stopRunPlayback', 'closeTrainingProgressViews', 'closeAthleteReviewViewer', 'closeContestEventModal', 'closeContestMergeModal', 'clearHelpVideoPreview', 'teardownCoachVideoReviewEditor', 'disconnectLiveRun', 'teardownRealtimeSync', 'dismissDailyFinishForNavigation']) window[name] = () => qaClosed.push(name);
      for (const name of ['setSyncStatus', 'refreshNotificationCentre', 'refreshBoardChatUnread', 'refreshLiveRunInvites', 'mountStartupPrompts', 'addAthlete', 'createStudent', 'addAthleteToGroup', 'removeAthleteFromGroup']) window[name] = () => {};
      window.showNotificationDrawer = () => qaActions.push('notifications');
      window.qaFeatureSurface = () => {
        document.querySelector('#view').innerHTML = '<h1>Feature fixture</h1><button id="open-home-run-builder">Build run</button><button data-open-progress-run="saved">Watch saved run</button><button data-goal-toggle="goal">Complete goal</button><form id="rider-proposal-form"><input id="proposal-input"><button type="submit">Submit proposal</button></form><details><summary>Training list</summary><button data-assignment-action="landed">Landed</button></details><div role="button" tabindex="0" id="custom-feature">Custom feature</div><a id="feature-link" href="#feature">Feature link</a>';
        for (const selector of ['#open-home-run-builder', '[data-open-progress-run]', '[data-goal-toggle]', '[data-assignment-action]', '#custom-feature', '#feature-link']) document.querySelector(selector).addEventListener('click', () => qaActions.push(selector));
        document.querySelector('#rider-proposal-form').addEventListener('submit', event => { event.preventDefault(); qaActions.push('submit'); });
        document.querySelector('#proposal-input').addEventListener('change', () => qaActions.push('change'));
        document.querySelector('#proposal-input').addEventListener('input', () => qaActions.push('input'));
      };
      for (const renderer of renderers) window[renderer] = async () => qaFeatureSurface();
      (0, eval)(code);
    }, { code: [accessConstant, ...names.map(extract), captureListener].join('\n'), renderers });

    await page.evaluate(async () => { renderShell(); await navigate('home'); });
    assert(await page.locator('#rider-access-dashboard').isVisible(), 'Disabled athlete reaches the dashboard');
    assert.equal(await page.locator('#rider-access-dashboard h1').textContent(), 'Alex & Rider');
    assert.equal(await page.locator('#rider-access-week').innerText(), '42 points this week');
    assert.equal(await page.locator('.rider-access-notice [role="status"]').innerText(), "You don't have access to this feature, contact your coach");
    assert.equal(await page.locator('#open-home-run-builder, [data-open-bike-garage], form').count(), 0, 'Restricted dashboard renders no active tools');
    await page.locator('.bottom-nav [data-view="session"]').click();
    assert.equal(await page.evaluate(() => state.view), 'home');
    assert.equal((await page.evaluate(() => qaNotices.at(-1))).message, "You don't have access to this feature, contact your coach");
    await page.locator('#notification-centre-bell').click();
    assert.equal(await page.evaluate(() => qaActions.length), 0, 'Notifications are not an alternate route into features');
    for (const view of ['session', 'contests', 'bikeGarage', 'profile', 'tricktionary', 'board', 'challenges', 'coaching']) {
      await page.evaluate(view => navigate(view), view);
      assert.equal(await page.evaluate(() => state.view), 'home', `Direct navigation to ${view} is blocked`);
    }
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, 'rider-access-dashboard-phone.png'), fullPage: true, animations: 'disabled' });
    await page.locator('[data-rider-access-logout]').click();
    assert.deepEqual(await page.evaluate(() => qaActions), ['signout'], 'Sign out remains usable');
    await page.evaluate(() => { qaActions = []; qaFeatureSurface(); });
    for (const selector of ['#open-home-run-builder', '[data-open-progress-run]', '[data-goal-toggle]', '#custom-feature', '#feature-link', 'summary']) await page.locator(selector).click();
    await page.locator('#open-home-run-builder').focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Space');
    await page.evaluate(() => {
      document.querySelector('#rider-proposal-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      const input = document.querySelector('#proposal-input');
      input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    });
    assert.deepEqual(await page.evaluate(() => qaActions), [], 'Stale inline controls, keyboard, links, input and forms cannot bypass the restriction');
    assert.equal(await page.locator('details[open]').count(), 0, 'Collapsed feature list stays closed');
    await page.evaluate(async () => { await navigate('home'); qaFailRead = true; });
    await page.locator('[data-rider-access-retry]').click();
    assert.equal(await page.evaluate(() => riderFeaturesDisabled()), true, 'Failed refresh never unlocks a disabled account');
    await page.evaluate(() => { qaFailRead = false; qaDisabled = false; });
    await page.locator('[data-rider-access-retry]').click();
    await page.waitForSelector('#open-home-run-builder');
    await page.locator('#open-home-run-builder').click();
    assert.deepEqual(await page.evaluate(() => qaActions), ['#open-home-run-builder'], 'Re-enabling restores normal actions');

    await page.evaluate(async () => {
      qaActions = []; qaDisabled = true; state.view = 'session';
      document.body.insertAdjacentHTML('beforeend', '<div role="dialog"><button>Old modal tool</button></div>');
      await refreshRiderFeatureAccess({ force: true });
    });
    assert.equal(await page.evaluate(() => state.view), 'home', 'Mid-session disable returns athlete to dashboard');
    assert.equal(await page.locator('[role="dialog"]').count(), 0, 'Stale feature dialogs close');
    assert(await page.evaluate(() => state.sessionRenderVersion > 0 && state.athleteHomeRenderVersion > 0), 'Pending home/session renders are invalidated');
    assert(await page.evaluate(() => qaClosed.includes('disconnectLiveRun')), 'Live run connections close');

    await page.evaluate(async () => {
      qaHoldRead = true; state.riderAccessCheckedAt = 0;
      window.oldAccountRead = refreshRiderFeatureAccess({ force: true });
    });
    await page.waitForFunction(() => qaHeldReads.length === 1);
    await page.evaluate(async () => {
      state.user = { id: 'new-rider' }; state.profile = { role: 'athlete', display_name: 'New Rider' };
      state.riderAccess = { athlete_id: 'new-rider', features_disabled: false };
      qaHeldReads.shift()(); await oldAccountRead; qaHoldRead = false;
    });
    assert.deepEqual(await page.evaluate(() => state.riderAccess), { athlete_id: 'new-rider', features_disabled: false }, 'Late previous-account response cannot restrict the next account');

    for (const role of ['parent', 'coach', 'admin']) {
      await page.evaluate(role => { state.profile.role = role; state.riderAccess = { features_disabled: true }; qaActions = []; renderShell(); qaFeatureSurface(); }, role);
      await page.locator('#open-home-run-builder').click();
      assert.deepEqual(await page.evaluate(() => qaActions), ['#open-home-run-builder'], `${role} actions are not restricted`);
      assert.equal(await page.evaluate(() => riderFeaturesDisabled()), false);
    }

    await page.evaluate(async () => { state.profile.role = 'coach'; state.user.id = 'coach'; state.view = 'crew'; qaActions = []; qaCalls = []; renderShell(); await renderCrew(); });
    const toggles = rider => page.locator(`[data-rider-access-toggle="${rider}"]`);
    assert.equal(await toggles('rider').count(), 2, 'Each membership gets a control beside the rider name');
    assert.deepEqual(await toggles('rider').allTextContents(), ['Disable', 'Disable']);
    assert.deepEqual(await toggles('other').allTextContents(), ['Enable']);
    assert.equal(await page.locator('.student-chip button, button button').count(), 0, 'No nested interactive controls');
    assert.equal(await page.locator('.student-chip img').count(), 0, 'Names remain escaped');
    assert.equal(await page.evaluate(() => Boolean(window.injected)), false);
    await toggles('rider').first().focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => [...document.querySelectorAll('[data-rider-access-toggle="rider"]')].every(button => button.textContent === 'Enable'));
    assert.equal(await page.locator('.features-disabled [data-rider-access-toggle="rider"]').count(), 2);
    assert.equal(await page.locator('.features-disabled .student-chip > span .rider-access-label').count(), 3, 'Dashboard-only status sits beside each disabled rider name');
    assert.equal(await page.evaluate(() => state.selectedAthleteId || null), null, 'Access control does not open the profile');
    assert.deepEqual(await page.evaluate(() => qaCalls.filter(row => row.name === 'set_rider_feature_access').map(row => row.args)), [{ p_athlete_id: 'rider', p_disabled: true }]);
    await page.evaluate(() => { qaFailWrite = true; }); await toggles('rider').last().click();
    await page.waitForFunction(() => !document.querySelector('[data-rider-access-toggle="rider"]').disabled);
    assert.deepEqual(await toggles('rider').allTextContents(), ['Enable', 'Enable'], 'Failed update keeps both membership states unchanged');
    assert.equal((await page.evaluate(() => qaNotices.at(-1))).message, 'Write rejected');
    await page.evaluate(() => { qaFailWrite = false; qaHoldWrite = true; }); await toggles('rider').first().click();
    await page.waitForFunction(() => qaHeldWrites.length === 1);
    assert(await toggles('rider').evaluateAll(buttons => buttons.every(button => button.disabled)), 'Both duplicate controls lock during saving');
    await page.evaluate(() => { document.querySelectorAll('[data-rider-access-toggle="rider"]')[1].dispatchEvent(new MouseEvent('click', { bubbles: true })); qaHeldWrites.shift()(); qaHoldWrite = false; });
    await page.waitForFunction(() => [...document.querySelectorAll('[data-rider-access-toggle="rider"]')].every(button => button.textContent === 'Disable'));
    assert.equal(await page.evaluate(() => qaCalls.filter(row => row.name === 'set_rider_feature_access').length), 3, 'Duplicate control cannot submit a second write while busy');

    for (const width of [320, 390, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const theme of ['dark', 'light']) {
        await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
        assert(await toggles('rider').evaluateAll(buttons => buttons.every(button => {
          const row = button.closest('.student-chip-wrap').getBoundingClientRect();
          const box = button.getBoundingClientRect();
          return box.width >= 40 && box.height >= 40 && box.left >= row.left - 1 && box.right <= row.right + 1;
        })), `${width}px ${theme}: access controls fit their row and have usable tap targets`);
        if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `rider-feature-access-${width}-${theme}.png`), fullPage: true, animations: 'disabled' });
      }
    }
    assert.deepEqual(errors, []);
    assert(requests.every(url => !url.includes('supabase.co')), 'No production requests');
    console.log('PASS: disabled dashboard and sign out, all-feature click/keyboard/form guards, direct navigation, refresh errors, re-enable and mid-session enforcement, stale account protection, unaffected parent/coach/admin, coach duplicate memberships, RPC errors and concurrent toggles, mobile/desktop controls. All data isolated.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
