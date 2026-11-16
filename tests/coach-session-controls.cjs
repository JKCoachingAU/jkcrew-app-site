// Render the actual coach controls with synthetic sessions and blocked network.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const extract = name => {
  const start = app.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert(start >= 0, `Actual ${name} exists`);
  const tail = app.slice(start);
  return tail.slice(0, tail.indexOf('\n}') + 2);
};
const names = ['renderSessionViewer', 'bindSessionViewerActions', 'sessionViewerVenueOptions',
  'sessionViewerGroupOptions', 'sessionViewerClockFaceHtml', 'sessionViewerSnapshotHtml',
  'groupSessionElapsedSeconds', 'updateGroupSessionTimerDom'];
const screenshots = process.env.JKCREW_SCREENSHOT_DIR;
if (screenshots) fs.mkdirSync(screenshots, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 1000 } });
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push(request.url()));
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"><div class="app-shell coach-shell" style="display:block"><main id="view" class="content" data-view="sessionViewer"></main></div></div></body></html>');
    await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'styles.css'), 'utf8') });
    await page.evaluate(() => {
      window.qa = { now: Date.parse('2026-11-16T12:00:00Z'), session: null, calls: [], tasks: [] };
      Date.now = () => qa.now;
      window.state = { view: 'sessionViewer', user: { id: 'synthetic-coach' }, profile: { role: 'coach' },
        sessionViewerGroup: 'monday', sessionViewerVenue: 'The Village', sessionViewerSearch: '',
        sessionViewerSetupOpen: true, sessionViewerRenderVersion: 0, sessionViewerOpenAthleteId: '',
        sessionViewerActiveList: '', sessionViewerRosterCache: [], sessionViewerActiveSessionCache: null };
      window.coachGroups = [['monday', 'Monday Team'], ['tuesday', 'Tuesday Team'], ['wednesday', 'Wednesday Team'],
        ['online', 'Online Training'], ['elite', 'Elite Riders'], ['injured', 'Injured Athletes']];
      window.contestPrepGroupId = 'contest_prep';
      window.qaRoster = coachGroups.map(([group, label]) => ({ id: group, display_name: `${label} rider`, country_code: 'AU', groupNames: [group] }));
      window.qaRows = new Map(qaRoster.map(rider => [rider.id, ['The Village', 'Ramp Attack'].map((venue, index) => ({
        id: `${rider.id}-${index}`, athlete_id: rider.id, category: 'daily', venue, trick_name: 'Manual', progress: index ? {} : { completed_at: '2026-11-16T01:00:00Z' },
      }))]));
      window.qaParks = ['The Village', 'Ramp Attack', 'HOTBOX – Australian National Training Facility with a long park name',
        ...Array.from({ length: 37 }, (_, index) => `Saved Park ${index + 1}`)].map(name => ({ name }));
      window.getSessionViewerRoster = async () => qaRoster;
      window.getActiveCoachGroupSession = async () => qa.session;
      window.getCoachVenues = async () => qaParks;
      window.getSessionViewerPlanData = async () => ({ assignmentsByAthlete: qaRows, runsByAthlete: new Map(), runProgressByPlan: new Map() });
      window.withTimeout = promise => promise;
      window.client = { rpc: async name => { assertRpc(name); return { data: [] }; } };
      window.assertRpc = name => { if (name !== 'get_coach_rider_battles_v2') throw Error(`Unexpected RPC ${name}`); };
      window.isCoachRole = role => ['coach', 'admin'].includes(role);
      window.escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
      window.normalizeAssignmentProgress = (_row, progress) => progress;
      window.isAssignmentComplete = row => Boolean(row.progress?.completed_at);
      window.dailyVenues = rows => [...new Set(rows.map(row => row.venue))];
      window.assignmentsForVenue = (rows, venue) => rows.filter(row => row.venue === venue);
      window.venueKey = window.venueLabel = value => String(value || '');
      window.venueIdentityKey = value => String(value || '').trim().toLowerCase();
      window.coachGroupLabel = group => coachGroups.find(row => row[0] === group)?.[1] || group;
      window.groupLabelList = groups => groups.join(', ');
      window.formatTime = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
      window.sessionViewerRiderCardHtml = entry => `<article class="panel" data-test-rider="${entry.athlete.id}">${escapeHtml(entry.athlete.display_name)} · ${escapeHtml(entry.venue)}</article>`;
      window.parkKingCardHtml = (_data, venue, options) => `<section id="${options.id}" class="panel">${escapeHtml(venue)}</section>`;
      window.sessionGroupBattlesHtml = () => '';
      window.startViewerGroupSession = () => qa.calls.push('start');
      window.toggleViewerGroupSessionPause = () => qa.calls.push(qa.session?.status === 'paused' ? 'resume' : 'pause');
      window.endViewerGroupSession = () => qa.calls.push('end');
      window.showAddDailyLocation = () => qa.calls.push('add-location');
      for (const name of ['refreshParkKingCard', 'bindCoachBattleControls', 'showCoachBattleBuilder', 'refreshSessionViewerLight',
        'addExtraRiderToGroupSession', 'finishViewerDailyTimer', 'recordViewerAssignmentAction', 'recordViewerAssignmentAttempt',
        'recordViewerPercentageAttempt', 'selectViewerListTab', 'toggleViewerGoal', 'toggleViewerRunPoint', 'saveSessionViewerAssignments',
        'bindTrainingProgressActions', 'mountDailyFeatures', 'navigate']) window[name] = () => {};
    });
    await page.addScriptTag({ content: names.map(extract).join('\n') + '\nconst actualRender = renderSessionViewer; window.renderSessionViewer = options => { const task = actualRender(options); qa.tasks.push(task); return task; };' });
    const settle = () => page.evaluate(async () => { await Promise.all(qa.tasks); });
    const clock = () => page.locator('#group-session-timer');
    const face = () => clock().textContent().then(value => value.replace(/\s/g, ''));
    await page.evaluate(() => renderSessionViewer());
    assert.equal(await face(), '00:00', 'Ready clock starts at zero');
    assert.equal(await clock().getAttribute('role'), 'timer');
    assert.equal(await page.locator('#viewer-group-filter option').count(), 6);
    assert.equal(await page.locator('#viewer-venue-filter option').count(), 40, 'Many saved parks stay in the compact selector');
    assert.equal(await page.locator('[data-viewer-group], [data-viewer-venue]').count(), 0, 'The former chip wall is removed');
    assert.equal(await page.locator('.session-snapshot > div').count(), 3, 'All three progress summaries remain');
    for (const id of ['viewer-group-filter', 'viewer-venue-filter']) {
      assert(await page.locator(`label[for="${id}"]`).count(), `${id} has an associated label`);
    }
    await page.locator('#start-group-session').click();
    await page.locator('#add-daily-location').click();
    assert.deepEqual(await page.evaluate(() => qa.calls), ['start', 'add-location']);

    await page.evaluate(() => { state.sessionViewerOpenAthleteId = 'monday'; state.sessionViewerActiveList = 'lines'; });
    await page.locator('#viewer-group-filter').selectOption('tuesday'); await settle();
    assert.deepEqual(await page.evaluate(() => [state.sessionViewerGroup, state.sessionViewerOpenAthleteId, state.sessionViewerActiveList]), ['tuesday', '', '']);
    assert.equal(await page.locator('[data-test-rider="tuesday"]').count(), 1, 'Group selection refreshes the correct roster');
    const longPark = await page.evaluate(() => qaParks[2].name);
    await page.locator('#viewer-venue-filter').selectOption(longPark); await settle();
    assert.equal(await page.locator('#viewer-venue-filter').inputValue(), longPark);
    assert.equal(await page.locator('#session-viewer-park-king').textContent(), longPark, 'Park record follows the selected location');

    for (const status of ['ready', 'active', 'paused']) {
      await page.evaluate(async status => {
        qa.session = status === 'ready' ? null : { id: 'active-session', group_name: 'tuesday', venue: qaParks[2].name, status,
          started_at: new Date(qa.now - 754000).toISOString(), paused_at: status === 'paused' ? new Date(qa.now - 34000).toISOString() : null,
          total_paused_seconds: 45, coach_group_session_participants: [{ athlete_id: 'tuesday' }] };
        await renderSessionViewer();
      }, status);
      const expected = status === 'ready' ? '00:00' : status === 'paused' ? '11:15' : '11:49';
      assert.equal(await face(), expected, `${status} clock matches existing pause arithmetic`);
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const theme of ['dark', 'light']) {
          await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
          const layout = await page.locator('#view').evaluate(view => {
            const clock = view.querySelector('#group-session-timer');
            const controls = view.querySelector('.session-setup-fields');
            const card = view.querySelector('.group-session-control');
            const inside = element => { const box = element.getBoundingClientRect(); return box.width > 0 && box.left >= -1 && box.right <= innerWidth + 1; };
            return { overflow: document.documentElement.scrollWidth > innerWidth + 1,
              clock: inside(clock), controls: inside(controls), card: inside(card), height: card.getBoundingClientRect().height,
              selects: [...view.querySelectorAll('#viewer-group-filter,#viewer-venue-filter')].every(inside),
              targets: [...view.querySelectorAll('#start-group-session,#pause-group-session,#end-group-session,#add-daily-location')].map(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })),
              digits: [...clock.querySelectorAll('.session-clock-digits')].map(el => el.scrollWidth <= el.clientWidth + 1),
              fieldHeight: controls.getBoundingClientRect().height };
          });
          assert(!layout.overflow && layout.clock && layout.controls && layout.card && layout.selects, `${width}/${theme}/${status}: controls fit without horizontal overflow`);
          assert(layout.digits.every(Boolean), `${width}/${theme}/${status}: clock digits are not clipped`);
          assert(layout.targets.every(box => box.width >= 44 && box.height >= 44), `${width}/${theme}/${status}: touch targets remain accessible`);
          assert(layout.fieldHeight < (width < 600 ? 270 : 190), `${width}/${theme}/${status}: forty parks keep setup compact (${layout.fieldHeight}px)`);
          if (screenshots && [390, 1440].includes(width)) await page.screenshot({ path: path.join(screenshots, `coach-controls-${status}-${width}-${theme}.png`), fullPage: true, animations: 'disabled' });
        }
      }
      if (status !== 'ready') {
        assert(await page.locator('#viewer-group-filter').isDisabled());
        assert(await page.locator('#viewer-venue-filter').isDisabled());
        assert(await page.locator('#add-daily-location').isEnabled(), 'Adding a park for later remains available during a live session');
        await page.evaluate(() => {
          for (const [id, value] of [['viewer-group-filter', 'monday'], ['viewer-venue-filter', 'Ramp Attack']]) {
            const select = document.getElementById(id); select.disabled = false; select.value = value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });
        assert.deepEqual(await page.evaluate(() => [state.sessionViewerGroup, state.sessionViewerVenue]), ['tuesday', longPark], 'Live filter protection also rejects programmatically dispatched changes');
        await page.locator('#pause-group-session').click(); await page.locator('#end-group-session').click();
        assert.deepEqual(await page.evaluate(() => qa.calls.slice(-2)), [status === 'paused' ? 'resume' : 'pause', 'end']);
      }
    }
    await page.evaluate(() => { qa.now += 55000; updateGroupSessionTimerDom(); });
    assert.equal(await face(), '11:15', 'Paused clock remains frozen as wall time advances');
    await page.evaluate(async () => {
      qa.session.status = 'active'; qa.session.paused_at = null;
      qa.session.started_at = new Date(qa.now - ((125 * 60 + 7 + 45) * 1000)).toISOString();
      await renderSessionViewer();
    });
    assert.equal(await face(), '125:07', 'Long sessions preserve the full minute count');
    await page.setViewportSize({ width: 320, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'Long timer remains within narrow screens');
    assert(await clock().locator('.session-clock-digits').evaluateAll(elements => elements.every(el => el.scrollWidth <= el.clientWidth + 1)), 'Three-digit minutes remain readable without clipping');
    for (const theme of ['dark', 'light']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      if (screenshots) await page.screenshot({ path: path.join(screenshots, `coach-controls-long-320-${theme}.png`), fullPage: true, animations: 'disabled' });
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await clock().isVisible(), true);
    assert.deepEqual(errors, [], 'No runtime errors');
    assert.deepEqual(requests, [], 'No network or production data');
    console.log('PASS: compact native coach selectors, 40 saved parks, group/location effects, live filter guards, add/start/pause/resume/end hooks, exact ready/live/paused/long clock math and dark/light 320/390/768/1440px layouts. Synthetic data only.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
