// Run the production rider timer, Home shortcut and finish dialog against
// synthetic sessions and the exact prepare/confirm request payloads.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const dailyCompletion = fs.readFileSync(path.join(__dirname, '..', 'daily-completion.js'), 'utf8');
function extract(name) {
  const start = app.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'));
  assert(start >= 0, name);
  return app.slice(start, app.indexOf('\n}', start) + 2);
}
const homeStart = app.indexOf('  section("active-session", "Current session"');
const homeEnd = app.indexOf('\n\n  section("coach-messages"', homeStart);
assert(homeStart >= 0 && homeEnd > homeStart, 'Extract the real Home timer section');

const fixture = String.raw`
const state = { user: { id: "rider" }, profile: { display_name: "Rider" }, view: "session" };
const calls = [];
const notifications = [];
const views = [];
const candidates = new Map();
const notices = () => notifications;
let sessions = new Map();
let assignments = [];
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));
const venueIdentityKey = venue => String(venue || "").toLowerCase().replace(/^the /, "").replace(/\W/g, "");
const venueLabel = venue => venue || "Default Daily List";
const dailyVenues = rows => [...new Set(rows.filter(row => row.category === "daily").map(row => row.venue))];
const assignmentsForVenue = (rows, venue) => rows.filter(row => venueIdentityKey(row.venue) === venueIdentityKey(venue));
const isAssignmentComplete = row => row.complete;
const formatTime = seconds => String(seconds);
const formatPbTime = seconds => String(seconds ?? "—");
const trainingProgressButtonHtml = () => '<button type="button">Progress</button>';
const cacheClear = () => {};
const clearCoachCaches = () => {};
const setSyncStatus = () => {};
const withTimeout = promise => promise;
const messageFrom = error => error.message;
const notify = (message, tone) => notifications.push({ message, tone });
const setButtonBusy = (button, label) => {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = label;
  return () => { button.disabled = false; button.textContent = original; };
};
const navigate = view => { views.push(view); };
const updateTimer = () => {
  const timer = document.querySelector("#trick-timer");
  if (timer) timer.textContent = String(state.activeTraining?.daily_completed_seconds ?? 45);
};
function renderSession() {
  const view = document.querySelector("#view");
  view.innerHTML = dailySessionHubHtml(assignments, state.selectedVenue, state.activeTraining);
  view.querySelector("#finish-daily-tricks")?.addEventListener("click", event => requestDailyFinish(event.currentTarget));
}
const renderSessionViewer = async () => {};
const renderAthleteHome = async () => {};
const client = {
  async rpc(name, parameters) {
    calls.push({ name, parameters });
    if (name === "prepare_daily_finish") {
      if (window.holdPrepare) await new Promise(resolve => { window.releasePrepare = resolve; });
      const session = sessions.get(parameters.p_session_id);
      if (!session || session.athlete !== parameters.p_athlete_id) return { error: new Error("That session is unavailable") };
      const venue = parameters.p_venue ?? session.groupVenue ?? "";
      if (venueIdentityKey(venue) !== venueIdentityKey(session.venue)) return { error: new Error("Start Daily Tricks for this venue before finishing its list") };
      const rows = assignmentsForVenue(assignments, venue);
      if (!rows.length) return { error: new Error("There are no Daily tricks in this list") };
      const candidate = {
        candidate_id: "candidate", session_id: parameters.p_session_id,
        group_session_id: session.groupVenue == null ? null : "coach-group",
        athlete_id: session.athlete, venue, seconds: 45, completed_count: rows.filter(isAssignmentComplete).length,
        total_count: rows.length, all_completed: false
      };
      candidates.set(candidate.candidate_id, candidate);
      return { data: { completion_candidate: candidate } };
    }
    assertForBrowser(name === "confirm_daily_finish");
    const result = candidates.get(parameters.p_candidate_id);
    return { data: {
      ...result, venue: result.venue || "default", result_id: "saved-finish",
      completed_at: new Date().toISOString(), completion_points: 0
    } };
  }
};
function assertForBrowser(condition) {
  if (!condition) throw new Error("Unexpected mock SDK call");
}
function reset({ selected, timerVenue, groupVenue, rows = [], saved = null }) {
  dismissDailyFinishForNavigation();
  calls.length = notifications.length = views.length = 0;
  candidates.clear();
  window.holdPrepare = false;
  window.releasePrepare = null;
  state.user = { id: "rider" };
  state.profile = { display_name: "Rider" };
  state.view = "session";
  state.selectedVenue = selected;
  state.activeTraining = {
    id: "training-1", athlete_id: "rider", daily_venue: timerVenue,
    started_at: new Date(Date.now() - 45000).toISOString(), daily_completed_seconds: saved
  };
  assignments = rows.map(([venue, complete], i) => ({ id: "trick-"+i, venue, complete, category: "daily" }));
  sessions = new Map([["training-1", { athlete: "rider", venue: dailyRpcVenue(timerVenue ?? groupVenue), groupVenue }]]);
  renderSession();
}
function renderHomeTimer(activeSession) {
  state.view = "home";
  const view = document.querySelector("#view");
  view.innerHTML = '<div id="athlete-home-active-session"></div>';
  const isCurrent = () => state.view === "home";
  const getActiveSession = () => activeSession;
  const section = (_key, _label, _load, apply) => apply(activeSession);
` + app.slice(homeStart, homeEnd) + String.raw`
  clearInterval(state.timer);
}
`;

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.JKCREW_BROWSER_PATH ? { executablePath: process.env.JKCREW_BROWSER_PATH } : {}),
  });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    const attemptedRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => attemptedRequests.push(request.url()));
    await page.route('**/*', route => route.abort());
    await page.setContent('<main id="view"></main>');
    await page.addScriptTag({
      content: dailyCompletion + '\n' + fixture + '\n'
        + ['dailySessionHubHtml', 'latestDailyTime'].map(extract).join('\n'),
    });
    const finish = page.getByRole('button', { name: 'Finish Daily Tricks', exact: true });
    const run = options => page.evaluate(params => reset(params), options);
    const recorded = () => page.evaluate(() => calls);
    const selected = 'BMX Park';
    const venue = 'The Village';

    await run({ selected, timerVenue: venue, rows: [[venue, true], [venue, false]] });
    assert(await finish.isEnabled(), 'Active venue list enables Finish while a different park without a list is open');
    assert.match(await page.locator('.hub-timer').textContent(), /Daily timer · The Village/);
    await finish.click();
    await page.getByRole('button', { name: 'Yes — finish Daily Tricks' }).waitFor();
    let request = (await recorded())[0];
    assert.equal(request.parameters.p_venue, venue, 'Finish sends the active venue, never the browsed park');
    assert.equal(request.parameters.p_session_id, 'training-1');
    assert.equal(request.parameters.p_athlete_id, 'rider');
    assert.match(await page.locator('.daily-confirm-copy').textContent(), /1\/2 tricks landed/);
    await page.getByRole('button', { name: 'Yes — finish Daily Tricks' }).click();
    await page.getByText('Daily practice finished · 1/2 landed').waitFor();
    assert.equal(await page.locator('.daily-result-stats strong').first().textContent(), '+0');
    assert.equal(await page.evaluate(() => state.activeTraining.daily_completed_seconds), 45);
    assert.deepEqual((await recorded()).map(row => row.name), ['prepare_daily_finish', 'confirm_daily_finish']);
    await page.getByRole('button', { name: 'Keep riding' }).click();
    assert(await page.getByRole('button', { name: 'Start Daily Tricks' }).isVisible(), 'Another park can start after prior finish');

    await run({ selected, timerVenue: 'default', rows: [['', false]] });
    assert(await finish.isEnabled(), 'Default venue timer remains available from a different park');
    assert.match(await page.locator('.hub-timer').textContent(), /Default Daily List/);
    await finish.click();
    await page.getByRole('button', { name: 'Go back' }).waitFor();
    assert.equal((await recorded())[0].parameters.p_venue, '', 'Definitively bound Default uses an explicit blank venue');
    await page.getByRole('button', { name: 'Go back' }).click();
    assert.equal(await page.evaluate(() => state.activeTraining.daily_completed_seconds), null);

    await run({ selected, timerVenue: venue, rows: [[selected, false]] });
    assert(await finish.isDisabled(), 'A known running venue with no tricks cannot finish a different park’s list');
    assert.equal((await recorded()).length, 0);

    await run({ selected, timerVenue: venue, rows: [[venue, false]] });
    await page.evaluate(async () => {
      const stale = document.querySelector('#finish-daily-tricks');
      state.activeTraining = { ...state.activeTraining, id: 'replacement-timer' };
      await requestDailyFinish(stale);
    });
    assert.equal((await recorded()).length, 0, 'A previous timer’s button cannot submit against a replacement session');

    await run({ selected, timerVenue: venue, rows: [[venue, false]] });
    await page.evaluate(async () => {
      state.activeTraining.athlete_id = 'other-rider';
      await requestDailyFinish(document.querySelector('#finish-daily-tricks'));
    });
    assert.equal((await recorded()).length, 0, 'Another rider’s timer cannot be submitted');

    await run({ selected, timerVenue: venue, rows: [[venue, false]] });
    await page.evaluate(() => {
      window.holdPrepare = true;
      window.pendingFinish = requestDailyFinish(document.querySelector('#finish-daily-tricks'));
    });
    await page.waitForFunction(() => typeof window.releasePrepare === 'function');
    await page.evaluate(async () => {
      state.user = { id: 'another-account' };
      window.releasePrepare();
      await window.pendingFinish;
    });
    assert.equal(await page.locator('.daily-finish-backdrop').count(), 0, 'A pending finish cannot show after an account switch');
    assert.equal((await recorded()).length, 1, 'An obsolete prepare does not submit a confirm');


    await run({ selected, timerVenue: null, groupVenue: venue, rows: [[venue, false]] });
    assert(await finish.isEnabled(), 'An unresolved coach timer can finish hands-off from another park');
    await finish.click();
    await page.getByRole('button', { name: 'Yes — finish Daily Tricks' }).waitFor();
    request = (await recorded())[0];
    assert.equal(request.parameters.p_venue, null, 'Group venue is resolved from the linked session by the server');
    assert.equal(request.parameters.p_session_id, 'training-1');
    assert.match(await page.locator('.daily-confirm-copy').textContent(), /0\/1 tricks landed/);
    await page.getByRole('button', { name: 'Yes — finish Daily Tricks' }).click();
    await page.getByText('Daily practice finished · 0/1 landed').waitFor();
    assert.equal(await page.evaluate(() => state.activeTraining.daily_result.group_session_id), 'coach-group');
    assert.equal(await page.locator('.daily-result-stats strong').first().textContent(), '+0');

    await run({ selected, timerVenue: null, groupVenue: venue, rows: [[selected, false]] });
    await finish.click();
    await page.waitForFunction(() => notices().some(note => note.message === 'There are no Daily tricks in this list'));
    assert.deepEqual((await recorded()).map(row => row.name), ['prepare_daily_finish']);
    assert.equal(await page.evaluate(() => state.activeTraining.daily_completed_seconds), null, 'Truly empty group list has no saved time');

    await run({ selected: venue, timerVenue: null, groupVenue: venue, rows: [[venue, false]] });
    await page.evaluate(async () => {
      state.user = { id: 'coach' };
      state.profile = { display_name: 'Coach' };
      state.view = 'sessionViewer';
      state.sessionViewerRosterCache = [{ id: 'rider', display_name: 'Rider' }];
      state.sessionViewerVenue = 'The Village';
      state.sessionViewerActiveSessionCache = { id: 'coach-group', coach_group_session_participants: [{ athlete_id: 'rider', training_session_id: 'training-1' }] };
      const coachFinish = document.createElement('button');
      coachFinish.dataset.finishDailyAthlete = 'rider';
      await requestDailyFinish(coachFinish, true);
    });
    assert.equal((await recorded())[0].parameters.p_venue, venue, 'Coach Finish keeps the selected group venue');
    assert.equal((await recorded())[0].parameters.p_session_id, 'training-1');

    await run({ selected: venue, timerVenue: venue, rows: [[venue, false]] });
    await page.evaluate(() => renderHomeTimer(state.activeTraining));
    await page.getByRole('button', { name: 'Open Daily timer' }).click();
    assert.deepEqual(await page.evaluate(() => views), ['session']);
    assert.equal((await recorded()).length, 0, 'Home shortcut only navigates');
    await page.evaluate(() => renderHomeTimer({ ...state.activeTraining, daily_completed_seconds: 0 }));
    assert.equal(await page.getByRole('button', { name: 'Open Daily timer' }).count(), 0, 'A saved zero time is not running');

    assert.deepEqual(errors, []);
    assert.deepEqual(attemptedRequests, []);
    console.log('PASS: real rider and coach Daily finish controls, active/default/group venue payloads, stale guards, no-list rejection, partial time, and Home shortcut. No network.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
