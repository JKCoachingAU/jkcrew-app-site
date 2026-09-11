const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const extract = name => {
  const start = app.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'));
  assert(start >= 0, name);
  const rest = app.slice(start);
  return rest.slice(0, rest.indexOf('\n}') + 2);
};
const names = ['renderShell', 'navigate', 'resetPageExpansions', 'dailyVenueGroups', 'assignmentGroups', 'bindDailyVenueAccordions', 'bindSessionAssignmentAccordions', 'commandAccordionSection', 'planAccordionSection', 'activeSessionViewerList', 'sessionViewerPlanList', 'selectViewerListTab'];
const renderers = [...new Set(extract('navigate').match(/\brender[A-Z]\w+/g))];
(async () => {
  const browser = await chromium.launch({headless: true, executablePath: process.env.JKCREW_BROWSER_PATH});
  try {
    const page = await browser.newPage({viewport: {width: 390, height: 844}});
    await page.setContent('<div id="app"></div>');
    await page.evaluate(({code, renderers}) => {
      window.app = document.querySelector('#app');
      window.state = {view: '', user: {id: 'test', email: 'test@example.test'}, profile: {role: 'athlete'}, sessionOpenDailyVenues: new Set(), sessionOpenAssignmentSections: new Set(), sessionViewerOpenAthleteId: '', sessionViewerActiveList: '', videoReviewRecordedReplies: new Map(), videoReviewMedia: new Map(), loadingOverlayToken: 0};
      window.liveRun = null;
      for (const name of ['stopRunPlayback', 'closeAthleteReviewViewer', 'closeContestEventModal', 'closeContestMergeModal', 'clearHelpVideoPreview', 'teardownCoachVideoReviewEditor', 'refreshLiveRunInvites', 'setSyncStatus', 'refreshNotificationCentre', 'refreshBoardChatUnread', 'showNotificationDrawer', 'dismissDailyFinishForNavigation']) window[name] = () => {};
      window.isCoachRole = role => role === 'coach';
      window.coachPrimaryView = window.parentPrimaryView = window.athletePrimaryView = view => view;
      window.escapeHtml = value => String(value || '');
      window.navNotificationBadge = window.avatarHtml = () => '';
      window.coachNav = [['command', 'Command'], ['sessionViewer', 'Session']];
      window.athleteNav = window.parentNav = [['home', 'Home'], ['session', 'Session']];
      window.coachNavGroups = [{id: 'command', label: 'Command', icon: '', links: [['command', 'Dashboard']]}, {id: 'sessionViewer', label: 'Session', icon: '', links: [['sessionViewer', 'Session Viewer']]}];
      window.setLoading = () => { document.querySelector('#view').innerHTML = ''; return ++state.loadingOverlayToken; };
      window.finishScreenLoading = token => token === state.loadingOverlayToken;
      window.notify = message => { throw Error(message); };
      window.messageFrom = error => error.message;
      window.categoryDisplayInfo = category => ({label: category, description: 'Training list'});
      window.categoryRewardLabels = {};
      window.dailyVenues = assignments => [...new Set(assignments.map(item => item.venue))];
      window.venueIdentityKey = window.venueLabel = value => value;
      window.assignmentsForVenue = (items, venue) => items.filter(item => item.venue === venue);
      window.isAssignmentComplete = item => Boolean(item.complete);
      window.assignmentList = window.percentageAssignmentList = items => items.map(item => '<p>' + item.trick_name + '</p>').join('');
      window.sessionViewerListTabs = [{id: 'daily', label: 'Daily'}, {id: 'lines', label: 'Lines'}];
      window.sessionViewerTabsForEntry = () => sessionViewerListTabs;
      window.sessionViewerListCount = () => 1;
      window.sessionViewerListContent = (_entry, _session, list) => '<div data-list-content="' + list + '">Training tricks</div>';
      window.refreshSessionViewerLight = () => {
        document.querySelector('#viewer-tabs').innerHTML = sessionViewerPlanList({}, null);
        document.querySelectorAll('[data-viewer-list-tab]').forEach(button => button.addEventListener('click', selectViewerListTab));
      };
      window.mount = () => {
        document.querySelector('#view').innerHTML = commandAccordionSection('command-test', 'Command section', '', '<p>Detail</p>') + planAccordionSection('Training plan', '', '<p>Editor</p>') + assignmentGroups([{category: 'daily', venue: 'Park', trick_name: 'Manual'}], state.profile.role === 'athlete', {}, 'Park') + '<div id="viewer-tabs"></div>';
        bindDailyVenueAccordions();
        bindSessionAssignmentAccordions();
        refreshSessionViewerLight();
      };
      for (const renderer of renderers) window[renderer] = async () => mount();
      (0, eval)(code);
    }, {code: names.map(extract).join('\n'), renderers});
    for (const role of ['coach', 'athlete', 'parent']) {
      await page.evaluate(role => { state.profile.role = role; renderShell(); }, role);
      for (const view of ['home', 'session', 'sessionViewer', 'command', 'planner', 'profile', 'parentWeek', 'parentMore', 'challenges', 'tricktionary', 'contests', 'board']) {
        await page.evaluate(async view => {
          state.sessionOpenDailyVenues.add('Park');
          state.sessionOpenAssignmentSections.add('bonus');
          state.sessionViewerOpenAthleteId = 'previous-rider';
          state.sessionViewerActiveList = 'daily';
          await navigate(view);
        }, view);
        assert.equal(await page.locator('details[open]').count(), 0, role + ': closed on ' + view);
        assert.equal(await page.locator('[data-list-content]').count(), 0, role + ': no training tab preselected');
      }
      await page.locator('.daily-venue-accordion > summary').click();
      await page.waitForFunction(() => state.sessionOpenDailyVenues.has('Park'));
      await page.evaluate(() => mount());
      assert.equal(await page.locator('.daily-venue-accordion[open]').count(), 1, 'In-page training refresh keeps explicitly opened list');
      await page.locator('[data-viewer-list-tab="lines"]').click();
      assert.equal(await page.locator('[data-list-content="lines"]').count(), 1);
      await page.locator('[data-viewer-list-tab="lines"]').click();
      assert.equal(await page.locator('[data-list-content]').count(), 0, 'Tap selected training tab to close');
      await page.evaluate(() => navigate(state.view));
      assert.equal(await page.locator('details[open]').count(), 0, 'Re-tap current page resets to closed');
    }
    await page.evaluate(() => { state.profile.role = 'coach'; renderShell(); });
    await page.locator('summary[data-view="sessionViewer"]').click();
    assert.equal(await page.locator('[data-nav-group="sessionViewer"][open]').count(), 1, 'Explicit sidebar expansion still works');
    await page.locator('.nav-sub-btn[data-view="sessionViewer"]').click();
    assert.equal(await page.locator('.sidebar-nav-group[open]').count(), 0, 'Following a sidebar link closes the group');
    await page.locator('summary[data-view="command"]').click();
    await page.locator('summary[data-view="command"]').click();
    assert.equal(await page.locator('.sidebar-nav-group[open]').count(), 0, 'Sidebar group can be closed again');
    console.log('PASS: all-role page-entry and same-page resets, closed active-training Daily lists, explicit expansion survives in-page refresh, training tab open/close and sidebar navigation.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
