// Exercise production venue selection, dropdown and point-save actions using
// synthetic sessions only. No network or production rider data is accessed.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const extract = name => {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert(start >= 0, `Production ${name} exists`);
  const tail = source.slice(start);
  return tail.slice(0, tail.indexOf('\n}') + 2);
};
const names = ['selectedVenueFor', 'venueSelectorHtml', 'dailySessionHubHtml', 'latestDailyTime',
  'bindVenueSelector', 'renderSession', 'recordAssignmentAction', 'recordPercentageAttempt'];

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH });
  try {
    const page = await browser.newPage();
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push(request.url()));
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><html><body><main id="view"></main></body></html>');
    await page.evaluate(() => {
      window.qa = { today: '2026-11-16', saves: [], calls: [] };
      window.state = { user: { id: 'rider' }, profile: { country_code: 'AU' }, view: 'session', selectedVenue: 'Ramp Attack',
        riderVenueSessionContext: null, activeTraining: null, sessionOpenAssignmentSections: new Set(), loadingOverlayToken: 1, sessionRenderVersion: 0 };
      window.countryTimezones = { AU: 'Australia/Brisbane' };
      window.dateForTimezone = (_zone, date) => date ? new Date(date.getTime() + 10 * 60 * 60 * 1000).toISOString().slice(0, 10) : qa.today;
      window.venueIdentityKey = value => String(value || '').toLowerCase().replace(/^the\s+/, '').replace(/\s+/g, '');
      window.venueLabel = window.dailyRpcVenue = value => String(value || '').trim();
      window.dailyVenues = rows => [...new Map(rows.filter(row => row.category === 'daily').map(row => [venueIdentityKey(row.venue), row.venue])).values()];
      window.assignmentsForVenue = (rows, venue) => rows.filter(row => venueIdentityKey(row.venue) === venueIdentityKey(venue));
      window.escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
      window.isAssignmentComplete = () => false;
      window.formatTime = window.formatPbTime = value => String(value ?? '—');
      window.trainingProgressButtonHtml = () => '<button type="button">Progress</button>';
      window.qaRows = [{ id: 'daily', category: 'daily', venue: 'Ramp Attack' }];
      window.qaActive = { id: 'village-1', athlete_id: 'rider', daily_venue: 'The Village', started_at: '2026-11-15T23:19:00Z', ended_at: null };
      window.getWeeklyAssignments = () => { qa.calls.push('assignments'); return new Promise(resolve => { qa.releaseAssignments = () => resolve({ assignments: qaRows, awards: [] }); }); };
      window.getLeaderboard = async () => { qa.calls.push('leaderboard'); return []; };
      window.client = { from: () => {
        const query = { then: resolve => { qa.calls.push('recent-training'); return Promise.resolve({ data: [] }).then(resolve); } };
        for (const method of ['select', 'eq', 'gte', 'order', 'limit']) query[method] = () => query;
        return query;
      } };
      window.loadActiveSession = () => { qa.calls.push('active-training'); return new Promise(resolve => { qa.releaseActive = resolve; }); };
      window.riderFeaturesDisabled = window.riderFeatureAccessUnknown = () => false;
      window.canRefreshRiderSession = () => true;
      window.saveProgressRpc = async (name, args) => { qa.saves.push({ name, args }); return { data: { message: 'Saved', points_awarded: 2 } }; };
      for (const name of ['setSyncStatus', 'setPendingAssignmentProgress', 'clearPendingAssignmentProgress', 'cacheClear', 'notify',
        'refreshOwnXpAfterAction', 'showUpdatedWeeklyScore', 'refreshOpenTrainingProgress', 'setPendingPercentageAttempt', 'clearPendingPercentageAttempt']) window[name] = async () => {};
    });
    await page.addScriptTag({ content: names.map(extract).join('\n') });

    // The active-session read must begin without waiting for the slow weekly
    // list, and a navigation during either read cannot change venue state.
    await page.evaluate(() => { window.qaRender = renderSession(); });
    await page.waitForFunction(() => qa.releaseActive && qa.releaseAssignments);
    assert.deepEqual(await page.evaluate(() => [...qa.calls].sort()), ['active-training', 'assignments', 'leaderboard', 'recent-training']);
    await page.evaluate(async () => { state.view = 'home'; qa.releaseActive(); qa.releaseAssignments(); await qaRender; });
    assert.equal(await page.evaluate(() => state.selectedVenue), 'Ramp Attack', 'Obsolete render never adopts a venue');

    assert.equal(await page.evaluate(() => {
      state.view = 'session'; state.activeTraining = { ...qaActive };
      return selectedVenueFor(qaRows);
    }), 'The Village', 'Current active session overrides the initial assigned-park default');
    await page.evaluate(() => {
      document.querySelector('#view').innerHTML = dailySessionHubHtml(qaRows, state.selectedVenue, state.activeTraining);
      window.renderSession = async () => {};
      bindVenueSelector();
    });
    assert.equal(await page.locator('#session-venue').inputValue(), 'The Village', 'Actual dropdown displays the adopted session park without a Daily assignment there');
    assert.equal(await page.locator('#session-venue option').count(), 2);

    await page.selectOption('#session-venue', 'Ramp Attack');
    assert.equal(await page.evaluate(() => selectedVenueFor(qaRows)), 'Ramp Attack', 'Explicit dropdown choice survives the same active-session refresh');
    await page.evaluate(() => { state.activeTraining = { ...qaActive, id: 'village-2' }; selectedVenueFor(qaRows); });
    assert.equal(await page.evaluate(() => state.selectedVenue), 'The Village', 'A new active session adopts its actual park');
    assert.equal(await page.evaluate(() => {
      state.activeTraining = null;
      return selectedVenueFor(qaRows);
    }), 'The Village', 'An already adopted park stays selected after the same-day timer ends');
    assert.equal(await page.evaluate(() => {
      const fixture = document.createElement('div');
      fixture.innerHTML = venueSelectorHtml([...qaRows, { category: 'daily', venue: 'Village' }]);
      return fixture.querySelectorAll('option').length;
    }), 2, 'Park aliases do not create duplicate options');

    // Actual weekly/Lines/percentage handlers must send the displayed park,
    // without inventing a closed training-session attachment.
    await page.evaluate(async () => {
      document.querySelector('#view').innerHTML = dailySessionHubHtml(qaRows, state.selectedVenue);
      for (const category of ['one_bang', 'lines']) {
        const row = document.createElement('div'); row.className = 'assignment-row';
        row.innerHTML = `<strong>Test trick</strong><button data-assignment-id="${category}" data-assignment-category="${category}" data-assignment-action="landed"></button>`;
        document.body.append(row);
        await recordAssignmentAction({ currentTarget: row.querySelector('button'), preventDefault() {}, stopPropagation() {} });
      }
      const button = document.createElement('button'); button.dataset.assignmentId = 'percentage'; button.dataset.percentageAction = 'true';
      await recordPercentageAttempt({ currentTarget: button, preventDefault() {}, stopPropagation() {} });
    });
    const saves = await page.evaluate(() => qa.saves);
    assert.deepEqual(saves.map(save => save.name), ['record_assignment_action_at_venue', 'record_line_action_at_venue', 'set_percentage_attempt_at_venue']);
    const displayedVenue = await page.locator('#session-venue').inputValue();
    assert.equal(await page.evaluate(value => venueIdentityKey(value), displayedVenue), 'village');
    assert(saves.every(save => save.args.p_venue === displayedVenue && !('p_session_id' in save.args)), 'Every action uses the displayed venue without guessing a closed session');

    assert.equal(await page.evaluate(() => {
      qa.today = '2026-11-17'; state.activeTraining = null;
      return selectedVenueFor(qaRows);
    }), 'Ramp Attack', 'Remembered session venue expires at local midnight');
    assert.equal(await page.evaluate(() => {
      state.selectedVenue = ''; state.riderVenueSessionContext = null; qa.today = '2026-11-16';
      state.activeTraining = { ...qaActive, started_at: '2026-11-14T23:19:00Z' };
      return selectedVenueFor(qaRows);
    }), 'Ramp Attack', 'A previous-day active record cannot supply a park');
    assert.equal(await page.evaluate(() => {
      state.activeTraining = { ...qaActive, ended_at: '2026-11-15T23:44:00Z' };
      return selectedVenueFor(qaRows);
    }), 'Ramp Attack', 'A newly loaded closed session cannot supply a park');
    assert.equal(await page.evaluate(() => {
      state.activeTraining = { ...qaActive, athlete_id: 'other-rider' };
      state.riderVenueSessionContext = { userId: 'other-rider', sessionId: 'other', venue: 'The Village', ridingDay: qa.today };
      return selectedVenueFor(qaRows);
    }), 'Ramp Attack', 'Another rider’s active or remembered park cannot carry across accounts');
    assert.equal(await page.evaluate(() => state.riderVenueSessionContext), null);
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
    console.log('PASS: current-day active session venue, same-day retention, explicit selection, alias options, concurrent loading, navigation guard and real weekly/Lines/percentage save venue. No closed-session inference or production data.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
