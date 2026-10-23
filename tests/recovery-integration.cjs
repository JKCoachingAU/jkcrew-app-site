// Exercise the actual app integration with synthetic local accounts. No real
// rider data, network requests, or health records are read or written.
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
  'isTransientRequestError', 'retryNetworkRequest',
  'riderFeaturesDisabled', 'riderFeatureAccessUnknown', 'riderRecoveryActive',
  'showRiderAccessMessage', 'refreshRiderFeatureAccess', 'closeRestrictedRiderFeatures',
  'guardRiderFeatureInteraction', 'renderRiderRecoveryHome', 'renderRecoveryCoach',
  'renderShell', 'navigate', 'resetPageExpansions', 'closeJkcYard',
  'setupRealtimeSync', 'scheduleRealtimeRefresh', 'mountStartupPrompts',
  'refreshLiveRunInvites',
];
const accessConstant = app.match(/^const RIDER_ACCESS_MESSAGE = .*;$/m)?.[0];
assert(accessConstant, 'Existing access notice remains defined');
const captureListener = app.match(/^\["click", "submit", "pointerdown", "keydown", "input", "change"\].*guardRiderFeatureInteraction.*;$/m)?.[0];
assert(captureListener, 'Actual feature capture guard is installed');
const renderers = [...new Set(extract('navigate').match(/\brender[A-Z]\w+/g))];
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert(value, message); checks++; };

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"></div></body></html>');
    await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'styles.css'), 'utf8') });
    await page.evaluate(({ code, renderers }) => {
      window.app = document.querySelector('#app');
      window.state = {
        view: 'home', user: { id: 'rider-a', email: 'qa@example.test' },
        profile: { id: 'rider-a', role: 'athlete', display_name: 'QA Rider' },
        session: { access_token: 'local-fixture-only' }, sessionSetupVersion: 1,
        riderAccess: { athlete_id: 'rider-a', features_disabled: false, recovery_mode: true },
        riderAccessCheckedAt: 0, riderAccessRequest: null, riderAccessTimer: null,
        athleteHomeRenderVersion: 0, sessionRenderVersion: 0, loadingOverlayToken: 0,
        sessionOpenDailyVenues: new Set(), sessionOpenAssignmentSections: new Set(),
        videoReviewRecordedReplies: new Map(), videoReviewMedia: new Map(), notificationUnread: [],
      };
      window.liveRun = null;
      window.liveRunDiscoveryBusy = false;
      window.qa = { recovery: true, episodeId: 'episode-a', disabled: false, calls: [], actions: [], closes: [], mounts: [], notices: [],
        holdRead: false, reads: [], failRead: false, holdRoster: false, rosterReads: [], prompts: [], channels: [], renders: [] };
      window.wait = () => Promise.resolve();
      window.withTimeout = async promise => promise;
      window.escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
      window.messageFrom = error => error.message;
      window.notify = (message, tone) => qa.notices.push({ message, tone });
      window.isCoachRole = role => ['coach', 'admin'].includes(role);
      window.avatarHtml = () => '<span class="avatar">QA</span>';
      window.athleteNav = [['home', 'Home'], ['session', 'Session'], ['challenges', 'Challenges'], ['contests', 'Contests'], ['board', 'Board'], ['profile', 'Profile']];
      window.parentNav = [['home', 'Home'], ['parentWeek', 'This week'], ['profile', 'Profile']];
      window.coachNav = [['command', 'Command'], ['crew', 'Riders']];
      window.coachNavGroups = [{ id: 'crew', label: 'Riders', icon: '●', links: [['crew', 'Students']] }];
      window.coachPrimaryView = window.parentPrimaryView = window.athletePrimaryView = view => view;
      window.navNotificationBadge = () => '';
      window.setSyncStatus = () => {};
      window.showNotificationDrawer = () => qa.actions.push('notifications');
      window.refreshNotificationCentre = () => qa.actions.push('notification-query');
      window.refreshBoardChatUnread = () => qa.actions.push('chat-query');
      window.setLoading = () => { document.querySelector('#view').innerHTML = ''; return ++state.loadingOverlayToken; };
      window.finishScreenLoading = token => token === state.loadingOverlayToken;
      window.signOutCurrentDevice = () => qa.actions.push('signout');
      window.getCoachRoster = async () => [{ id: 'rider-a', display_name: 'Managed Rider' }];
      window.cacheClear = () => {};
      window.leaveLiveRun = async () => { qa.actions.push('leave-confirmation'); return false; };
      window.clearDailyFeatureMounts = () => qa.closes.push('daily-features');
      for (const name of ['stopRunPlayback', 'closeTrainingProgressViews', 'closeAthleteReviewViewer', 'closeContestEventModal', 'closeEventCourseViewer', 'closeContestMergeModal', 'clearHelpVideoPreview', 'teardownCoachVideoReviewEditor', 'teardownRealtimeSync', 'dismissDailyFinishForNavigation']) window[name] = () => qa.closes.push(name);
      window.disconnectLiveRun = () => { qa.closes.push('disconnectLiveRun'); liveRun = null; };
      window.JKCrewBikeGarage = { destroy: () => qa.closes.push('garage') };
      window.JKCrewTricktionaryTools = { installSuggestions: () => { qa.actions.push('tricktionary-suggestions'); return () => {}; }, close: () => {}, reset: () => {} };
      window.JKCRecovery = {
        cleanup: () => qa.closes.push('recovery-cleanup'),
        mountAthlete: async options => {
          qa.mounts.push({ kind: 'athlete', userId: options.userId, athleteId: options.athleteId });
          const host = options.element;
          host.setAttribute('data-recovery-scope', '');
          host.innerHTML = '<h1>Recovery check-in</h1><form id="qa-checkin"><label>Headache<input id="qa-symptom" type="range" min="0" max="10"></label><button id="qa-save" type="submit">Save check-in</button></form><button id="qa-account" data-recovery-account>Account</button>';
          host.querySelector('form').onsubmit = event => { event.preventDefault(); qa.actions.push('save-checkin'); };
          host.querySelector('input').oninput = () => qa.actions.push('symptom-input');
          return { destroy: () => qa.closes.push('recovery-destroy'), refresh: () => qa.actions.push('recovery-refresh') };
        },
        mountCoach: async options => {
          qa.mounts.push({ kind: 'coach', userId: options.userId, athleteId: options.athleteId });
          options.element.innerHTML = '<h1>Manage recovery</h1>';
          return { destroy: () => qa.closes.push('coach-recovery-destroy') };
        },
      };
      window.client = {
        rpc: async name => {
          qa.calls.push(name);
          if (name !== 'get_rider_feature_access') throw Error(`Unexpected RPC ${name}`);
          const result = { data: [{ athlete_id: state.user.id, features_disabled: qa.disabled, recovery_mode: qa.recovery, recovery_episode_id: qa.episodeId }] };
          if (qa.holdRead) return new Promise(resolve => qa.reads.push(() => resolve(result)));
          return qa.failRead ? { error: Error('Offline access check') } : result;
        },
        from: name => {
          qa.calls.push(`from:${name}`);
          const query = {};
          for (const method of ['select', 'eq', 'order', 'in', 'limit', 'delete', 'gt']) query[method] = () => query;
          query.then = (resolve, reject) => Promise.resolve({ data: [] }).then(resolve, reject);
          return query;
        },
        realtime: { setAuth: () => {} },
        channel: name => { qa.channels.push(name); return { on() { return this; }, subscribe() { return this; } }; },
      };
      window.realtimeVisibleAthleteIds = async () => qa.holdRoster ? new Promise(resolve => qa.rosterReads.push(resolve)) : [state.user.id];
      window.realtimeFilter = (key, ids) => `${key}=in.(${ids.join(',')})`;
      window.setupLiveRunDiscovery = () => qa.actions.push('live-discovery');
      window.pruneLiveRunWaiting = () => {};
      window.scheduleLiveRunWaitingExpiry = () => {};
      window.requestRiderSessionRefresh = async () => qa.actions.push('session-refresh');
      window.refreshSessionViewerLight = async () => {};
      window.refreshCoachBattleScores = async () => {};
      for (const name of ['mountWhatsNewPrompt', 'mountBattleIntroPrompt', 'mountPushSetupPrompt']) window[name] = () => { qa.prompts.push(name); return false; };
      window.qaNormalSurface = renderer => {
        qa.renders.push(renderer);
        document.querySelector('#view').innerHTML = '<h1>Normal training</h1><button id="qa-training">Land trick</button><form id="qa-training-form"><input id="qa-training-input"><button>Submit trick</button></form>';
        document.querySelector('#qa-training').onclick = () => qa.actions.push('training');
        document.querySelector('#qa-training-form').onsubmit = event => { event.preventDefault(); qa.actions.push('training-submit'); };
        document.querySelector('#qa-training-input').oninput = () => qa.actions.push('training-input');
      };
      for (const renderer of renderers) window[renderer] = async () => qaNormalSurface(renderer);
      (0, eval)(code);
      // renderAthleteHome's production recovery entry is separately asserted below.
      window.renderAthleteHome = async () => riderRecoveryActive() ? renderRiderRecoveryHome() : qaNormalSurface('renderAthleteHome');
    }, { code: [accessConstant, ...names.map(extract), captureListener].join('\n'), renderers });

    ok(extract('renderAthleteHome').includes('renderRiderRecoveryHome'), 'Actual athlete home delegates to the recovery renderer');
    await page.evaluate(async () => { renderShell(); await navigate('home'); });
    ok(await page.locator('#rider-recovery-home').isVisible(), 'Recovery opens as the athlete home');
    eq(await page.locator('[data-view="session"], [data-view="challenges"], [data-view="contests"], [data-view="board"], #notification-centre-bell').count(), 0, 'Recovery shell hides training navigation and ordinary notifications');
    eq(await page.evaluate(() => qa.actions.filter(value => ['notification-query', 'chat-query', 'tricktionary-suggestions'].includes(value))), [], 'Recovery shell starts no normal feed queries or suggestions');
    eq(await page.evaluate(() => qa.mounts.at(-1)), { kind: 'athlete', userId: 'rider-a', athleteId: 'rider-a' }, 'Check-in module receives only the signed-in rider identity');
    await page.locator('#qa-save').click();
    await page.locator('#qa-symptom').evaluate(input => input.dispatchEvent(new Event('input', { bubbles: true })));
    await page.locator('#sign-out').click();
    ok(await page.evaluate(() => ['save-checkin', 'symptom-input', 'signout'].every(action => qa.actions.includes(action))), 'Recovery form, symptom input and sign-out remain usable');
    await page.evaluate(() => {
      document.body.insertAdjacentHTML('beforeend', '<div id="app-update-notice"><button data-apply-app-update>Update app</button></div><button id="install-app">Install app</button>');
      document.querySelector('[data-apply-app-update]').onclick = () => qa.actions.push('app-update');
      document.querySelector('#install-app').onclick = () => qa.actions.push('app-install');
      document.querySelector('[data-apply-app-update]').click(); document.querySelector('#install-app').click();
    });
    ok(await page.evaluate(() => qa.actions.includes('app-update') && qa.actions.includes('app-install')), 'Recovery permits installed-app update and install actions');

    for (const view of ['session', 'contests', 'challenges', 'profile', 'board', 'bikeGarage', 'shredZone', 'jkcYard', 'tricktionary', 'coaching', 'recovery']) {
      await page.evaluate(view => navigate(view), view);
      eq(await page.evaluate(() => state.view), 'home', `Recovery blocks the ${view} deep link`);
      ok(await page.locator('#rider-recovery-home').isVisible(), `${view} returns to recovery home`);
    }
    await page.evaluate(async () => { liveRun = { session: { id: 'old-call' } }; await navigate('contests'); });
    eq(await page.evaluate(() => qa.actions.includes('leave-confirmation')), false, 'An old call cannot veto recovery routing with a leave confirmation');
    eq(await page.evaluate(() => liveRun), null, 'Recovery routing releases the old call');

    await page.evaluate(() => {
      document.querySelector('#view').insertAdjacentHTML('beforeend', '<button id="qa-stale">Land trick</button><form id="qa-stale-form"><input id="qa-stale-input"><button>Submit trick</button></form>');
      document.querySelector('#qa-stale').onclick = () => qa.actions.push('stale-training');
      document.querySelector('#qa-stale-form').onsubmit = event => { event.preventDefault(); qa.actions.push('stale-submit'); };
      document.querySelector('#qa-stale-input').oninput = () => qa.actions.push('stale-input');
      document.querySelector('#qa-stale').click();
      document.querySelector('#qa-stale-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      document.querySelector('#qa-stale-input').dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    });
    eq(await page.evaluate(() => qa.actions.filter(action => action.startsWith('stale-'))), [], 'Stale training controls outside the recovery scope cannot submit');
    await page.evaluate(async () => { qa.disabled = true; await refreshRiderFeatureAccess({ force: true }); await navigate('home'); });
    ok(await page.locator('#rider-recovery-home').isVisible(), 'Recovery check-in remains available when general feature access is disabled');
    eq(await page.evaluate(() => refreshRiderFeatureAccess({ force: true })), true, 'Recovery access is distinct from ordinary feature access');

    await page.evaluate(async () => {
      qa.calls = []; qa.prompts = []; qa.channels = []; qa.actions = [];
      await setupRealtimeSync(); scheduleRealtimeRefresh(); mountStartupPrompts(); await refreshLiveRunInvites();
    });
    eq(await page.evaluate(() => qa.channels), [], 'Recovery does not subscribe to ordinary progress realtime');
    eq(await page.evaluate(() => qa.prompts), [], 'Recovery suppresses training, battle and push setup prompts');
    eq(await page.evaluate(() => qa.calls), [], 'Recovery does not fetch live run invitations');
    eq(await page.evaluate(() => Boolean(state.syncRefreshTimer)), false, 'Recovery does not schedule normal screen refreshes');

    await page.evaluate(async () => { qa.disabled = false; qa.recovery = false; await refreshRiderFeatureAccess({ force: true }); });
    ok(await page.locator('[data-view="session"]').count() > 0, 'Turning recovery off restores normal navigation');
    ok(await page.locator('#qa-training').isVisible(), 'Turning recovery off restores the normal home');
    await page.locator('#qa-training').click();
    ok(await page.evaluate(() => qa.actions.includes('training')), 'Normal training actions are usable after recovery ends');
    await page.evaluate(async () => {
      state.view = 'session'; qa.recovery = true; qa.closes = [];
      state.jkcYardCleanup = () => qa.closes.push('yard'); liveRun = { session: { id: 'active-call' } };
      document.body.insertAdjacentHTML('beforeend', '<div role="dialog">Old training popup</div>');
      await refreshRiderFeatureAccess({ force: true });
    });
    ok(await page.locator('#rider-recovery-home').isVisible(), 'Turning recovery on during a session opens the check-in');
    eq(await page.locator('[role="dialog"]').count(), 0, 'Turning recovery on closes stale feature dialogs');
    ok(await page.evaluate(() => ['disconnectLiveRun', 'yard', 'garage'].every(name => qa.closes.includes(name))), 'Turning recovery on releases call, game and bike resources');
    ok(await page.evaluate(() => state.athleteHomeRenderVersion > 0 && state.sessionRenderVersion > 0), 'Recovery invalidates outstanding normal page renders');
    const beforeEpisodeMounts = await page.evaluate(() => qa.mounts.length);
    await page.evaluate(async () => { qa.episodeId = 'episode-b'; await refreshRiderFeatureAccess({ force: true }); });
    eq(await page.locator('#rider-recovery-home').getAttribute('data-recovery-episode'), 'episode-b', 'Rapid off/on between access polls switches to the new recovery episode');
    ok(await page.evaluate(() => qa.mounts.length) > beforeEpisodeMounts, 'A new recovery episode remounts the old form');

    await page.evaluate(async () => { qa.failRead = true; await refreshRiderFeatureAccess({ force: true }); });
    eq(await page.evaluate(() => riderRecoveryActive()), true, 'An offline access check preserves known recovery mode');
    await page.evaluate(() => { qa.failRead = false; qa.holdRead = true; window.qaOldAccess = refreshRiderFeatureAccess({ force: true }); });
    await page.waitForFunction(() => qa.reads.length === 1);
    await page.evaluate(async () => {
      state.user = { id: 'rider-b' }; state.profile = { role: 'athlete', display_name: 'Second Rider' }; state.sessionSetupVersion++;
      state.riderAccess = { athlete_id: 'rider-b', features_disabled: false, recovery_mode: false };
      qa.reads.shift()(); await qaOldAccess; qa.holdRead = false;
    });
    eq(await page.evaluate(() => state.riderAccess), { athlete_id: 'rider-b', features_disabled: false, recovery_mode: false }, 'A late access reply from the previous account cannot change the new account');

    await page.evaluate(() => {
      qa.holdRoster = true; qa.channels = []; window.qaOldRealtime = setupRealtimeSync();
    });
    await page.waitForFunction(() => qa.rosterReads.length === 1);
    await page.evaluate(async () => { state.riderAccess.recovery_mode = true; qa.rosterReads.shift()(['rider-b']); await qaOldRealtime; qa.holdRoster = false; });
    eq(await page.evaluate(() => qa.channels), [], 'A realtime setup started before recovery cannot reopen normal subscriptions after its await');
    await page.evaluate(() => {
      state.riderAccess.recovery_mode = false; qa.recovery = false; renderShell();
      window.renderSession = async () => { await new Promise(resolve => { window.qaReleaseSession = resolve; }); qaNormalSurface('late-session'); };
      window.qaLateNavigation = navigate('session', { accessChecked: true });
    });
    await page.waitForFunction(() => Boolean(window.qaReleaseSession));
    await page.evaluate(async () => { qa.recovery = true; await refreshRiderFeatureAccess({ force: true }); qaReleaseSession(); await qaLateNavigation; });
    ok(await page.locator('#rider-recovery-home').isVisible(), 'A late normal page render cannot overwrite the recovery home');
    eq(await page.locator('#qa-training').count(), 0, 'Stale training content is removed after its asynchronous render finishes');
    for (const role of ['coach', 'parent', 'admin']) {
      await page.evaluate(role => { state.profile.role = role; state.riderAccess = { features_disabled: true, recovery_mode: true }; renderShell(); qaNormalSurface('role-check'); }, role);
      eq(await page.evaluate(() => riderRecoveryActive()), false, `${role} is not switched into athlete recovery mode`);
      await page.locator('#qa-training').click();
    }
    await page.evaluate(async () => {
      state.user = { id: 'coach' }; state.profile = { role: 'coach', display_name: 'Coach' }; state.selectedAthleteId = 'rider-a';
      renderShell(); await navigate('recovery');
    });
    eq(await page.evaluate(() => qa.mounts.at(-1)), { kind: 'coach', userId: 'coach', athleteId: 'rider-a' }, 'Coach management receives the authorized selected rider');
    await page.evaluate(async () => { qa.mounts = []; state.selectedAthleteId = 'not-in-coach-roster'; await navigate('recovery'); });
    eq(await page.evaluate(() => qa.mounts), [], 'The coach page does not load recovery data for a rider outside their roster');
    eq(errors, [], 'No browser runtime errors');
    console.log(`PASS ${checks} recovery integration checks`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
