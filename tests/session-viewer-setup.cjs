const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../styles.css'), 'utf8');
const extract = name => {
  const start = app.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert(start >= 0, `Actual ${name} exists`);
  const rest = app.slice(start);
  return rest.slice(0, rest.indexOf('\n}') + 2);
};
const names = ['renderSessionViewer', 'bindSessionViewerActions', 'sessionViewerVenueOptions', 'sessionViewerGroupTabs', 'sessionViewerVenueTabs', 'sessionViewerSnapshotHtml', 'groupSessionElapsedSeconds', 'updateGroupSessionTimerDom', 'resetPageExpansions', 'navigate'];
const renderers = [...new Set(extract('navigate').match(/\brender[A-Z]\w+/g))];
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH });
  try {
    for (const width of [390, 1024]) {
      const page = await browser.newPage({ viewport: { width, height: 1100 }, hasTouch: width < 500, isMobile: width < 500 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => route.abort());
      await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"><div class="app-shell coach-shell" style="display:block"><main id="view" class="content" data-view="sessionViewer"></main></div></div></body></html>');
      await page.addStyleTag({ content: css });
      await page.evaluate(({ code, renderers }) => {
        window.state = {
          view: 'sessionViewer', user: { id: 'coach' }, profile: { role: 'coach' },
          sessionViewerGroup: 'tuesday', sessionViewerVenue: 'Park A', sessionViewerSearch: '',
          sessionViewerSetupOpen: false, sessionViewerRenderVersion: 0, sessionViewerOpenAthleteId: '', sessionViewerActiveList: '',
          sessionViewerRosterCache: [], sessionViewerActiveSessionCache: null,
          sessionOpenDailyVenues: new Set(), sessionOpenAssignmentSections: new Set(), loadingOverlayToken: 0,
          videoReviewRecordedReplies: new Map(), videoReviewMedia: new Map(),
        };
        window.liveRun = null; window.qaSession = null; window.qaHoldPlan = false; window.qaPendingPlans = []; window.qaRenderTasks = [];
        window.coachGroups = [['monday', 'Monday Team'], ['tuesday', 'Tuesday Team'], ['wednesday', 'Wednesday Team']];
        window.contestPrepGroupId = 'contest_prep';
        window.qaRoster = coachGroups.map(([group, label]) => ({ id: group, display_name: `${label} rider`, country_code: 'AU', groupNames: [group] }));
        window.qaRows = new Map(qaRoster.map(rider => [rider.id, ['Park A', 'Park B'].map((venue, index) => ({ id: `${rider.id}-${index}`, athlete_id: rider.id, category: 'daily', venue, trick_name: 'Manual', progress: {} }))]));
        window.qaPlan = () => ({ assignmentsByAthlete: qaRows, runsByAthlete: new Map(), runProgressByPlan: new Map() });
        window.getSessionViewerRoster = async () => qaRoster;
        window.getActiveCoachGroupSession = async () => qaSession;
        window.getSessionViewerPlanData = async roster => qaHoldPlan ? new Promise(resolve => qaPendingPlans.push({ resolve, data: qaPlan(), riders: roster.map(row => row.id) })) : qaPlan();
        window.client = { rpc: async name => { if (name !== 'get_coach_rider_battles_v2') throw Error(`Unexpected RPC: ${name}`); return { data: [] }; } };
        window.isCoachRole = role => role === 'coach' || role === 'admin';
        window.escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
        window.normalizeAssignmentProgress = (_assignment, progress) => progress;
        window.isAssignmentComplete = row => Boolean(row.progress?.completed_at);
        window.dailyVenues = rows => [...new Set(rows.map(row => row.venue))];
        window.assignmentsForVenue = (rows, venue) => rows.filter(row => row.venue === venue);
        window.venueIdentityKey = value => String(value || '').toLowerCase();
        window.venueKey = window.venueLabel = value => String(value || '');
        window.coachGroupLabel = group => coachGroups.find(row => row[0] === group)?.[1] || group;
        window.groupLabelList = groups => groups.join(', ');
        window.formatTime = seconds => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
        window.sessionViewerRiderCardHtml = entry => `<article data-test-rider="${entry.athlete.id}">${entry.athlete.display_name} · ${entry.venue}</article>`;
        window.parkKingCardHtml = (_data, venue, options) => `<section id="${options.id}">${venue}</section>`;
        window.sessionGroupBattlesHtml = () => '';
        for (const name of [
          'refreshParkKingCard', 'bindCoachBattleControls', 'refreshSessionViewerLight', 'showCoachBattleBuilder',
          'startViewerGroupSession', 'toggleViewerGroupSessionPause', 'endViewerGroupSession', 'addExtraRiderToGroupSession',
          'finishViewerDailyTimer', 'recordViewerAssignmentAction', 'recordViewerAssignmentAttempt', 'recordViewerPercentageAttempt',
          'selectViewerListTab', 'toggleViewerGoal', 'toggleViewerRunPoint', 'saveSessionViewerAssignments',
          'stopRunPlayback', 'closeAthleteReviewViewer', 'closeContestEventModal', 'closeContestMergeModal',
          'clearHelpVideoPreview', 'teardownCoachVideoReviewEditor', 'refreshLiveRunInvites',
          'bindTrainingProgressActions', 'dismissDailyFinishForNavigation'
        ]) window[name] = () => {};
        window.coachPrimaryView = window.parentPrimaryView = window.athletePrimaryView = view => view;
        window.setLoading = () => { document.querySelector('#view').innerHTML = ''; return ++state.loadingOverlayToken; };
        window.finishScreenLoading = token => token === state.loadingOverlayToken;
        window.notify = message => { throw Error(message); };
        window.messageFrom = error => error.message;
        for (const renderer of renderers) window[renderer] = async () => { document.querySelector('#view').innerHTML = '<p>Other page</p>'; };
        (0, eval)(code);
        const actualRender = renderSessionViewer;
        window.renderSessionViewer = options => { const task = actualRender(options); qaRenderTasks.push(task); return task; };
      }, { code: names.map(extract).join('\n'), renderers });
      const setup = () => page.locator('#session-viewer-setup');
      const summary = () => setup().locator(':scope > summary');
      const assertOpen = async (expected, message) => {
        await page.waitForFunction(expected => document.querySelector('#session-viewer-setup')?.open === expected && state.sessionViewerSetupOpen === expected, expected);
        assert.equal(await setup().evaluate(element => element.open), expected, message);
      };
      const clickRefresh = async () => {
        await page.evaluate(() => { window.qaOldSetup = document.querySelector('#session-viewer-setup'); });
        await page.locator('#viewer-refresh').click();
        await page.waitForFunction(() => qaOldSetup && !qaOldSetup.isConnected && Boolean(document.querySelector('#session-viewer-setup')));
      };
      await page.evaluate(() => renderSessionViewer());
      await assertOpen(false, 'Fresh Session view starts closed');
      await summary().click(); await assertOpen(true, 'Native summary opens setup');
      await page.locator('[data-viewer-group="monday"]').click();
      await page.waitForFunction(() => document.querySelector('[data-viewer-group="monday"]')?.getAttribute('aria-pressed') === 'true' && document.querySelector('[data-test-rider="monday"]'));
      await assertOpen(true, 'Choosing a group keeps location options open');
      await page.locator('[data-viewer-venue="Park B"]').click();
      await page.waitForFunction(() => document.querySelector('[data-viewer-venue="Park B"]')?.getAttribute('aria-pressed') === 'true');
      await assertOpen(true, 'Choosing a venue keeps setup open');
      await clickRefresh(); await assertOpen(true, 'Refresh preserves explicitly opened setup');
      await summary().click(); await assertOpen(false, 'Explicit close is recorded');
      await clickRefresh(); await assertOpen(false, 'Refresh does not reopen explicitly closed setup');
      await summary().focus(); await page.keyboard.press('Enter'); await assertOpen(true, 'Keyboard toggle opens setup');
      await page.evaluate(async () => { document.querySelector('#session-viewer-setup > summary').click(); await renderSessionViewer(); });
      await assertOpen(false, 'An immediate render reads a native close before its queued toggle event');
      await page.evaluate(async () => { document.querySelector('#session-viewer-setup > summary').click(); await renderSessionViewer(); });
      await assertOpen(true, 'An immediate render reads a native open before its queued toggle event');

      // Close the current disclosure while a group render waits for its plans.
      await page.evaluate(() => { qaHoldPlan = true; });
      await page.locator('[data-viewer-group="tuesday"]').click();
      await page.waitForFunction(() => qaPendingPlans.length === 1);
      await page.evaluate(() => { window.qaDetachedSetup = document.querySelector('#session-viewer-setup'); });
      await summary().click(); await assertOpen(false, 'Close takes effect during a pending render');
      await page.evaluate(async () => { const read = qaPendingPlans.shift(); read.resolve(read.data); await Promise.all(qaRenderTasks); });
      await assertOpen(false, 'Completing an in-flight render respects the latest close');
      assert.equal(await page.locator('[data-test-rider="tuesday"]').count(), 1);
      await page.evaluate(() => { qaDetachedSetup.open = true; qaDetachedSetup.dispatchEvent(new Event('toggle')); });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await assertOpen(false, 'A detached disclosure cannot overwrite current state');

      // Resolve the latest group first, then deliver its older response last.
      await summary().click(); await assertOpen(true, 'Setup can reopen after a delayed close');
      await page.locator('[data-viewer-group="monday"]').click();
      await page.waitForFunction(() => qaPendingPlans.length === 1);
      await page.locator('[data-viewer-group="wednesday"]').click();
      await page.waitForFunction(() => qaPendingPlans.length === 2);
      await page.evaluate(() => { const newest = qaPendingPlans.pop(); newest.resolve(newest.data); });
      await page.waitForFunction(() => Boolean(document.querySelector('[data-test-rider="wednesday"]')));
      await assertOpen(true, 'The latest group render preserves setup state');
      await page.evaluate(async () => { const older = qaPendingPlans.shift(); older.resolve(older.data); await Promise.all(qaRenderTasks); qaHoldPlan = false; });
      assert.equal(await page.locator('[data-test-rider="wednesday"]').count(), 1, 'An older response cannot restore a stale group');
      assert.equal(await page.locator('[data-test-rider="monday"]').count(), 0);
      await assertOpen(true, 'An older response cannot collapse setup');

      // Test the view guard separately from the detached-element guard.
      await summary().click(); await assertOpen(false, 'Prepare a closed state');
      await page.evaluate(() => { state.view = 'command'; const element = document.querySelector('#session-viewer-setup'); element.open = true; element.dispatchEvent(new Event('toggle')); });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.evaluate(() => state.sessionViewerSetupOpen), false, 'A toggle outside Session Viewer cannot update its remembered state');
      await page.evaluate(() => navigate('sessionViewer'));
      await assertOpen(false, 'Returning to a render uses remembered state');
      await summary().click(); await assertOpen(true, 'Reopen before navigation');
      await page.evaluate(async () => { await navigate('command'); await navigate('sessionViewer'); });
      await assertOpen(false, 'Real navigation back to Session Viewer resets setup');
      await summary().click(); await assertOpen(true, 'Open before same-page navigation');
      await page.evaluate(() => navigate('sessionViewer'));
      await assertOpen(false, 'Re-tapping the current page resets setup too');

      await page.evaluate(async () => {
        qaSession = { id: 'active', group_name: 'monday', venue: 'Park B', status: 'active', started_at: new Date().toISOString(), total_paused_seconds: 0, coach_group_session_participants: [{ athlete_id: 'monday' }] };
        await renderSessionViewer();
      });
      await summary().click(); await assertOpen(true, 'Active session setup remains inspectable');
      const filters = page.locator('[data-viewer-group], [data-viewer-venue]');
      assert((await filters.count()) >= 5);
      assert(await filters.evaluateAll(buttons => buttons.every(button => button.disabled)), 'Active sessions keep group and location filters disabled');
      await filters.evaluateAll(buttons => buttons.forEach(button => button.click()));
      assert.deepEqual(await page.evaluate(() => [state.sessionViewerGroup, state.sessionViewerVenue]), ['monday', 'Park B']);
      await clickRefresh(); await assertOpen(true, 'Active-session refresh retains setup expansion');
      assert(await filters.evaluateAll(buttons => buttons.every(button => button.disabled)));
      assert.deepEqual(errors, [], `No browser errors at width ${width}`);
      console.log(`PASS ${width}px: setup open/close, group/location/refresh continuity, keyboard, in-flight close, stale/disconnected toggle guards, latest group wins, navigation reset and active-session filter lock.`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
