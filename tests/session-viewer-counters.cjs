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
const categories = ['one_bang', 'dialled', 'percentage', 'lines', 'bonus'];
const labels = ['One Bangs', 'Dialled', 'Percentage', 'Lines', 'Bonus'];
const names = [
  'pendingAssignmentState', 'setPendingAssignmentProgress', 'clearPendingAssignmentProgress',
  'percentageAttemptKey', 'setPendingPercentageAttempt', 'clearPendingPercentageAttempt',
  'percentageAttemptsByNumber', 'isAssignmentComplete', 'normalizeAssignmentProgress',
  'profileGroupNames', 'isContestPrepProfile', 'categoryDisplayInfo',
  'newestDailyListForVenue', 'assignmentsForVenue', 'dailyVenues',
  'sessionViewerAssignmentsForList', 'sessionViewerRiderCountersHtml', 'sessionViewerRiderCardHtml',
  'activeSessionViewerList', 'sessionViewerTabsForEntry', 'sessionViewerPlanList', 'sessionViewerListCount',
  'openSessionViewerCounter', 'selectViewerListTab',
  'sessionViewerSnapshotHtml', 'paintSessionViewerSnapshot', 'renderSessionViewer', 'refreshSessionViewerLight',
  'sessionViewerVenueOptions', 'sessionViewerGroupTabs', 'sessionViewerVenueTabs',
  'groupSessionElapsedSeconds', 'updateGroupSessionTimerDom',
  'bindSessionViewerActions', 'bindSessionViewerFastActions', 'dailySessionHubHtml',
];
const categoryConstants = ['categoryInfo', 'contestPrepCategoryInfo'].map(name => {
  const start = app.indexOf(`const ${name} = {`);
  assert(start >= 0, `Actual ${name} exists`);
  return app.slice(start, app.indexOf('\n};', start) + 3);
}).join('\n');
const tabsStart = app.indexOf('const sessionViewerListTabs = [');
assert(tabsStart >= 0, 'Actual Session Viewer tabs exist');
const tabsConstant = app.slice(tabsStart, app.indexOf('\n];', tabsStart) + 3);
const code = `const PENDING_PROGRESS_TTL_MS = 2 * 60 * 1000;\n${categoryConstants}\n${tabsConstant}\n${names.map(extract).join('\n')}`;
assert(!extract('sessionViewerRiderCardHtml').includes('trainingProgressButtonHtml'), 'Coach card no longer calls the Today\'s Progress helper');
assert(extract('dailySessionHubHtml').includes('trainingProgressButtonHtml'), 'The student training hub retains its Today\'s Progress hook');
const screenshotDir = process.env.JKCREW_SCREENSHOT_DIR;
if (screenshotDir) fs.mkdirSync(screenshotDir, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 1100 } });
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push(request.url()));
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"><div class="app-shell coach-shell" style="display:block"><main id="view" class="content" data-view="sessionViewer"></main></div></div></body></html>');
    for (const file of ['styles.css', 'daily-completion.css', 'progress-sharing.css']) {
      await page.addStyleTag({ content: fs.readFileSync(path.join(root, file), 'utf8') });
    }
    await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'progress-sharing.js'), 'utf8') });
    await page.evaluate(code => {
      window.state = {
        view: 'sessionViewer', user: { id: 'coach' }, profile: { role: 'coach' },
        sessionViewerGroup: 'tuesday', sessionViewerVenue: 'Park A', sessionViewerSearch: '',
        sessionViewerSetupOpen: false, sessionViewerRenderVersion: 0, sessionViewerOpenAthleteId: '',
        sessionViewerActiveList: '', sessionViewerRosterCache: [], sessionViewerActiveSessionCache: null,
        pendingAssignmentProgress: new Map(), pendingPercentageAttempts: new Map(),
      };
      window.coachGroups = [['tuesday', 'Tuesday Team']];
      window.contestPrepGroupId = 'contest_prep';
      window.qaToday = '2026-09-13';
      window.qaRoster = [
        { id: 'rider', display_name: 'Alex <img src=x onerror="window.qaInjected=true"> & Rider', country_code: 'AU', groupNames: ['tuesday'] },
        { id: 'empty', display_name: 'No assignments yet', country_code: 'AU', groupNames: ['tuesday'] },
      ];
      const row = (id, category, done = false, extra = {}) => ({
        id, athlete_id: 'rider', category, venue: 'Park B', trick_name: id,
        progress: done ? { completed_at: '2026-09-10T12:00:00Z', progress_date: '2026-09-10' } : {}, ...extra,
      });
      const attempts = (count, landed = false) => Array.from({ length: count }, (_, i) => ({ attempt_number: i + 1, landed }));
      window.qaRows = [
        row('daily-a', 'daily', false, { venue: 'Park A', progress: { progress_date: qaToday } }),
        row('daily-b', 'daily', false, { venue: 'Park A' }),
        row('daily-other-park', 'daily', false, { progress: { progress_date: qaToday } }),
        row('one-done', 'one_bang', true), row('one-todo', 'one_bang'),
        row('dialled-a', 'dialled', true), row('dialled-b', 'dialled', true), row('dialled-c', 'dialled'),
        row('percent-missed', 'percentage', false, { percentageAttempts: attempts(10) }),
        row('percent-duplicates', 'percentage', true, { percentageAttempts: [...attempts(9, true), { attempt_number: 1, landed: true }] }),
        row('percent-nine', 'percentage', false, { percentageAttempts: attempts(9, true) }),
        row('line-done', 'lines', true, { trick_name: 'Manual → 180 → Barspin → Air' }),
        row('line-todo', 'lines'), row('bonus-todo', 'bonus'), row('foam-done', 'foam_pit', true),
      ];
      window.qaSession = null;
      window.qaHoldPlan = false; window.qaPendingPlans = []; window.qaCounterTasks = []; window.qaScrolls = [];
      window.qaPlan = () => ({ assignmentsByAthlete: new Map([['rider', qaRows], ['empty', []]]), runsByAthlete: new Map(), runProgressByPlan: new Map() });
      window.getSessionViewerRoster = window.getCoachRoster = async () => qaRoster;
      window.getActiveCoachGroupSession = async () => qaSession;
      window.getSessionViewerPlanData = async () => qaHoldPlan ? new Promise(resolve => qaPendingPlans.push({ resolve, data: qaPlan() })) : qaPlan();
      window.client = { rpc: async name => {
        if (name !== 'get_coach_rider_battles_v2') throw Error(`Unexpected RPC: ${name}`);
        return { data: [] };
      } };
      window.escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
      window.avatarHtml = () => '<span class="student-chip-avatar" aria-hidden="true">AR</span>';
      window.isCoachRole = role => ['coach', 'admin'].includes(role);
      window.assignmentLocalDate = () => qaToday;
      window.venueKey = window.venueLabel = value => String(value || '');
      window.venueIdentityKey = window.rawVenueIdentityKey = value => String(value || '').trim().toLowerCase();
      window.coachGroupLabel = () => 'Tuesday Team';
      window.groupLabelList = groups => groups.join(', ');
      window.formatTime = seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
      window.formatPbTime = () => '-';
      window.latestDailyTime = () => '-';
      window.sessionViewerListContent = (entry, _session, listId) => `<div class="viewer-trick-list" data-qa-list="${listId}" data-qa-list-athlete="${entry.athlete.id}" style="min-height:160px">${escapeHtml(categoryDisplayInfo(listId, entry.athlete).label)} fixture</div>`;
      window.parkKingCardHtml = () => '';
      window.sessionGroupBattlesHtml = () => '';
      for (const name of [
        'refreshParkKingCard', 'bindCoachBattleControls', 'showCoachBattleBuilder', 'navigate',
        'startViewerGroupSession', 'toggleViewerGroupSessionPause', 'endViewerGroupSession', 'addExtraRiderToGroupSession',
        'finishViewerDailyTimer', 'recordViewerAssignmentAction', 'recordViewerAssignmentAttempt', 'recordViewerPercentageAttempt',
        'toggleViewerGoal', 'toggleViewerRunPoint', 'saveSessionViewerAssignments',
      ]) window[name] = () => {};
      (0, eval)(code);
      const actualCounterAction = openSessionViewerCounter;
      window.openSessionViewerCounter = event => { const task = actualCounterAction(event); qaCounterTasks.push(task); return task; };
      const actualScroll = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function(options) {
        qaScrolls.push({ athlete: this.dataset.viewerPlan, list: this.querySelector('[data-viewer-list-tab].active')?.dataset.viewerListTab, options });
        return actualScroll.call(this, options);
      };
    }, code);
    const toggle = rider => page.locator(`[data-viewer-athlete="${rider}"]`);
    const card = rider => toggle(rider).locator('xpath=ancestor::article[1]');
    const counter = (rider, category) => card(rider).locator(`[data-viewer-counter="${category}"]`);
    const counters = async rider => card(rider).locator('[data-viewer-counter]').evaluateAll(elements =>
      elements.map(el => ({ category: el.dataset.viewerCounter, value: el.querySelector('strong').textContent.trim(), label: el.querySelector(':scope > span').textContent.trim() })));
    const expectCounters = async (values, rider = 'rider') => {
      assert.deepEqual(await counters(rider), categories.map((category, index) => ({ category, value: values[index], label: labels[index] })));
      assert.equal(await card(rider).locator('.viewer-rider-counters > .viewer-category-counter').count(), 5);
    };
    await page.evaluate(() => renderSessionViewer());
    const baseline = ['1/2', '2/3', '1/3', '1/2', '0/1'];
    await expectCounters(baseline);
    await expectCounters(['0/0', '0/0', '0/0', '0/0', '0/0'], 'empty');
    assert.equal(await page.locator('[data-today-training-progress], .viewer-rider-score, .viewer-training-actions').count(), 0, 'No coach Today\'s Progress, old Daily counter, or empty action wrapper');
    assert.equal(await card('rider').locator('.viewer-card-head strong').textContent(), await page.evaluate(() => qaRoster[0].display_name));
    assert.equal(await page.locator('.viewer-rider-grid img').count(), 0, 'Rider name is escaped instead of parsed as markup');
    assert.equal(await page.evaluate(() => Boolean(window.qaInjected)), false);
    assert.equal(await card('rider').locator('.viewer-rider-card').evaluate(element => element.tagName), 'DIV', 'Card container is noninteractive');
    assert.equal(await toggle('rider').evaluate(element => element.tagName), 'BUTTON', 'Rider header remains a native button');
    assert.equal(await page.locator('.viewer-rider-grid button button').count(), 0, 'No nested buttons');
    assert.equal(await toggle('rider').locator('[data-viewer-counter]').count(), 0, 'Counter actions are outside the rider toggle');
    assert(await card('rider').locator('[data-viewer-counter]').evaluateAll(elements => elements.every(element => element.tagName === 'BUTTON' && element.type === 'button' && element.dataset.viewerCounterAthlete === 'rider')));
    assert.equal(await card('rider').locator('[data-viewer-counter="percentage"]').getAttribute('class').then(value => value.includes('viewer-list-tone-percentage')), true);
    await page.evaluate(async () => { qaRoster[0].display_name = 'Alex Montgomery-Williams'; await refreshSessionViewerLight(); });

    for (const width of [320, 390, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1100 });
      for (const theme of ['dark', 'light']) {
        await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
        await expectCounters(baseline);
        const layout = await card('rider').evaluate(element => {
          const outer = element.getBoundingClientRect();
          const items = [...element.querySelectorAll('[data-viewer-counter]')];
          return {
            overflow: document.documentElement.scrollWidth > innerWidth + 1,
            clipped: items.some(item => { const r = item.getBoundingClientRect(); return r.width <= 0 || r.left < outer.left - 1 || r.right > outer.right + 1 || item.scrollWidth > item.clientWidth + 1; }),
            splitLabel: items.some(item => { const label = item.querySelector(':scope > span'); const range = document.createRange(); range.selectNodeContents(label); return !label.textContent.trim().includes(' ') && range.getClientRects().length > 1; }),
            tones: items.map(item => getComputedStyle(item).getPropertyValue('--viewer-list-tone').trim()),
            percentageColor: getComputedStyle(element.querySelector('[data-viewer-counter="percentage"] > span')).color,
          };
        });
        assert.equal(layout.overflow, false, `${width}px ${theme}: no horizontal page overflow`);
        assert.equal(layout.clipped, false, `${width}px ${theme}: all five counters fit the card`);
        assert.equal(layout.splitLabel, false, `${width}px ${theme}: category labels do not split within words`);
        assert.equal(new Set(layout.tones).size, 5, `${theme}: five distinct category colours`);
        assert(layout.tones.every(Boolean), `${theme}: counter category colours resolve`);
        const [red, green, blue] = layout.percentageColor.match(/[\d.]+/g).map(Number);
        assert(green > red && green > blue, `${theme}: Percentage remains green`);
        if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `session-viewer-counters-${width}-${theme}.png`), fullPage: true, animations: 'disabled' });
      }
    }

    const contestLabels = await page.evaluate(() => {
      const element = document.createElement('div');
      element.innerHTML = sessionViewerRiderCountersHtml({ athlete: { ...qaRoster[0], groupNames: ['contest_prep'] }, assignments: qaRows, venue: 'Park A' });
      return [...element.querySelectorAll('[data-viewer-counter] > span')].map(label => label.textContent);
    });
    assert.deepEqual(contestLabels, ['Practice 2', 'Practice 3', 'Warm Up', 'Lines', 'Run 1 / Run 2'], 'Contest Prep counters retain their training sheet labels');
    await toggle('rider').click();
    await page.waitForFunction(() => document.querySelector('[data-viewer-athlete="rider"]')?.getAttribute('aria-expanded') === 'true');
    await expectCounters(baseline);

    const expectOpen = async (rider, category) => {
      await page.waitForFunction(({ rider, category }) => {
        const plan = document.querySelector(`[data-viewer-plan="${rider}"]`);
        return state.sessionViewerOpenAthleteId === rider && state.sessionViewerActiveList === category
          && plan?.querySelector(`[data-viewer-list-tab="${category}"].active`) === document.activeElement;
      }, { rider, category });
      assert.equal(await toggle(rider).getAttribute('aria-expanded'), 'true');
      assert.equal(await counter(rider, category).getAttribute('aria-expanded'), 'true');
      assert.equal(await page.locator('[data-viewer-plan]').count(), 1);
      assert.equal(await page.locator(`[data-qa-list="${category}"][data-qa-list-athlete="${rider}"]`).count(), 1);
      assert.equal(await card(rider).locator('[data-viewer-counter][aria-expanded="true"]').count(), 1);
      const scroll = await page.evaluate(() => qaScrolls.at(-1));
      assert.equal(scroll.athlete, rider, 'Scroll targets the selected rider\'s plan');
      assert.equal(scroll.list, category, 'Scroll targets the selected category');
      assert(await page.locator(`[data-viewer-plan="${rider}"] [data-viewer-list-tab="${category}"]`).evaluate(tab => {
        const rect = tab.getBoundingClientRect(), strip = tab.parentElement.getBoundingClientRect();
        return rect.left >= strip.left - 1 && rect.right <= strip.right + 1;
      }), 'The selected category tab is visible within the scrolling tab strip');
    };
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const category of categories) {
      await counter('rider', category).click();
      await expectOpen('rider', category);
      assert.notEqual(await page.evaluate(() => qaScrolls.at(-1).options.behavior), 'smooth', 'Reduced-motion selection avoids smooth scrolling');
      await expectCounters(baseline);
    }
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      for (const category of ['percentage', 'bonus']) {
        await counter('rider', category).click();
        await expectOpen('rider', category);
      }
    }
    await counter('rider', 'bonus').click();
    await expectOpen('rider', 'bonus');
    await toggle('rider').click();
    await page.waitForFunction(() => document.querySelector('[data-viewer-athlete="rider"]')?.getAttribute('aria-expanded') === 'false');
    assert.equal(await page.locator('[data-viewer-plan]').count(), 0, 'The separate rider header can still close its list');
    await counter('rider', 'bonus').click();
    await expectOpen('rider', 'bonus');
    await counter('empty', 'lines').click();
    await expectOpen('empty', 'lines');
    assert.equal(await toggle('rider').getAttribute('aria-expanded'), 'false', 'A counter on another rider switches the open card');
    await counter('rider', 'one_bang').press('Enter');
    await expectOpen('rider', 'one_bang');
    await counter('rider', 'percentage').press('Space');
    await expectOpen('rider', 'percentage');
    assert.equal(await counter('rider', 'percentage').evaluate(element => getComputedStyle(element).getPropertyValue('--viewer-list-tone').trim()),
      await page.locator('[data-viewer-plan="rider"] [data-viewer-list-tab="percentage"]').evaluate(element => getComputedStyle(element).getPropertyValue('--viewer-list-tone').trim()),
      'The selected Percentage tab and counter keep the same green category colour');
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, 'session-viewer-counter-percentage-open-390.png'), fullPage: true, animations: 'disabled' });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await counter('rider', 'dialled').click();
    await expectOpen('rider', 'dialled');
    assert.equal(await page.evaluate(() => qaScrolls.at(-1).options.behavior), 'smooth', 'Normal motion preference uses smooth scrolling');
    await page.emulateMedia({ reducedMotion: 'reduce' });

    // Resolve the latest counter read first, then deliver its obsolete predecessor.
    await page.evaluate(() => {
      qaHoldPlan = true; qaCounterTasks = []; qaScrolls = [];
      document.querySelector('[data-viewer-counter-athlete="rider"][data-viewer-counter="one_bang"]').click();
    });
    await page.waitForFunction(() => qaPendingPlans.length === 1);
    await page.evaluate(() => document.querySelector('[data-viewer-counter-athlete="empty"][data-viewer-counter="bonus"]').click());
    await page.waitForFunction(() => qaPendingPlans.length === 2);
    await page.evaluate(async () => { const latest = qaPendingPlans.pop(); latest.resolve(latest.data); await qaCounterTasks[1]; });
    await expectOpen('empty', 'bonus');
    assert.equal(await page.evaluate(() => qaScrolls.length), 1);
    await page.evaluate(async () => { const older = qaPendingPlans.shift(); older.resolve(older.data); await Promise.all(qaCounterTasks); qaHoldPlan = false; });
    await expectOpen('empty', 'bonus');
    assert.equal(await page.evaluate(() => qaScrolls.length), 1, 'An older click cannot scroll or refocus after the latest selection wins');

    // An older request for the exact same rider/category is stale as well.
    await page.evaluate(() => {
      qaHoldPlan = true; qaCounterTasks = []; qaScrolls = [];
      const button = document.querySelector('[data-viewer-counter-athlete="rider"][data-viewer-counter="percentage"]');
      button.click(); button.click();
    });
    await page.waitForFunction(() => qaPendingPlans.length === 2);
    await page.evaluate(async () => { const latest = qaPendingPlans.pop(); latest.resolve(latest.data); await qaCounterTasks[1]; });
    await expectOpen('rider', 'percentage');
    await page.evaluate(async () => { const older = qaPendingPlans.shift(); older.resolve(older.data); await Promise.all(qaCounterTasks); qaHoldPlan = false; });
    assert.equal(await page.evaluate(() => qaScrolls.length), 1, 'Repeated identical selection still discards the older refresh before scrolling');

    // Neither navigation nor a changed filter may be pulled back by a delayed counter read.
    for (const changed of ['view', 'sessionViewerGroup', 'sessionViewerVenue', 'sessionViewerSearch']) {
      await page.evaluate(() => {
        qaHoldPlan = true; qaCounterTasks = []; qaScrolls = [];
        document.querySelector('[data-viewer-counter-athlete="rider"][data-viewer-counter="lines"]').click();
      });
      await page.waitForFunction(() => qaPendingPlans.length === 1);
      await page.evaluate(async changed => {
        state[changed] = changed === 'view' ? 'command' : 'changed-after-click';
        const sentinel = document.createElement('button'); sentinel.id = 'qa-navigation-focus'; sentinel.textContent = 'Continue here';
        document.querySelector('#view').prepend(sentinel); sentinel.focus();
        const pending = qaPendingPlans.shift(); pending.resolve(pending.data); await Promise.all(qaCounterTasks);
      }, changed);
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'qa-navigation-focus', `${changed}: delayed work does not steal focus`);
      assert.equal(await page.evaluate(() => qaScrolls.length), 0, `${changed}: delayed work does not scroll a stale selection`);
      await page.evaluate(async () => {
        qaHoldPlan = false; state.view = 'sessionViewer'; state.sessionViewerGroup = 'tuesday'; state.sessionViewerVenue = 'Park A'; state.sessionViewerSearch = '';
        await renderSessionViewer();
      });
    }
    await page.evaluate(async () => { state.sessionViewerVenue = 'Park B'; await refreshSessionViewerLight(); });
    await expectCounters(baseline); // Weekly categories do not follow the Daily venue filter.
    await page.evaluate(async () => {
      setPendingAssignmentProgress('one-todo', true);
      setPendingAssignmentProgress('dialled-a', false);
      setPendingPercentageAttempt('percent-nine', 10, false);
      await refreshSessionViewerLight();
    });
    await expectCounters(['2/2', '1/3', '2/3', '1/2', '0/1']);
    await page.evaluate(async () => { setPendingPercentageAttempt('percent-missed', 10, null); await refreshSessionViewerLight(); });
    await expectCounters(['2/2', '1/3', '1/3', '1/2', '0/1']);
    await page.evaluate(async () => {
      state.pendingAssignmentProgress.clear(); state.pendingPercentageAttempts.clear();
      state.pendingAssignmentProgress.set('bonus-todo', { complete: true, time: Date.now() - 180000 });
      state.pendingPercentageAttempts.set('percent-nine:10', { attemptNumber: 10, landed: true, time: Date.now() - 180000 });
      await refreshSessionViewerLight();
    });
    await expectCounters(baseline);
    await page.evaluate(async () => {
      qaRows.find(row => row.id === 'bonus-todo').progress = { completed_at: '2026-09-13T01:00:00Z' };
      await refreshSessionViewerLight({ force: true });
    });
    await expectCounters(['1/2', '2/3', '1/3', '1/2', '1/1']);
    await page.evaluate(() => renderSessionViewer());
    await expectCounters(['1/2', '2/3', '1/3', '1/2', '1/1']);

    await page.evaluate(async () => {
      qaSession = { id: 'active', group_name: 'tuesday', venue: 'Park A', status: 'running', started_at: new Date().toISOString(), coach_group_session_participants: [{ athlete_id: 'rider' }] };
      await renderSessionViewer();
    });
    const finish = page.locator('[data-finish-daily-athlete="rider"]');
    assert.equal(await finish.isDisabled(), true, 'Daily finish remains disabled before its venue list is complete');
    await page.evaluate(async () => { qaRows.find(row => row.id === 'daily-b').progress = { progress_date: qaToday }; await refreshSessionViewerLight(); });
    assert.equal(await finish.isDisabled(), false);
    await page.evaluate(async () => { qaSession.coach_group_session_participants[0].daily_finish_seconds = 90; await refreshSessionViewerLight(); });
    assert.equal(await finish.textContent(), 'View Daily result', 'Saved Daily results remain reachable');
    assert.equal(await page.locator('[data-today-training-progress]').count(), 0);
    await expectCounters(['1/2', '2/3', '1/3', '1/2', '1/1']);
    const student = await page.evaluate(() => {
      state.profile = { role: 'athlete', display_name: 'Student & Rider' }; state.user.id = 'rider';
      const element = document.createElement('div'); element.innerHTML = dailySessionHubHtml(qaRows, 'Park A');
      const button = element.querySelector('[data-today-training-progress]');
      return { label: button?.textContent, athlete: button?.dataset.todayTrainingProgress, name: button?.dataset.progressRiderName };
    });
    assert.equal(student.athlete, 'rider'); assert.equal(student.name, 'Student & Rider'); assert(student.label.includes("Today's Progress"));
    assert.deepEqual(errors, [], 'No browser runtime errors');
    assert(!requests.some(url => /supabase|jkcrew|\.pages\.dev/i.test(url)), 'No production requests; data and RPCs use local fixtures');
    console.log('PASS: real category completion and pending helpers; unique 10-attempt Percentage sets including misses; weekly venue independence; zeros, escaped names and Contest Prep labels; full/light refresh; counter click, repeated selection, rider switching, Enter/Space, focus/scroll and stale-read guards; native unnested buttons; Daily finish and student progress preserved; green Percentage and dark/light layouts at 320/390/1024/1440px.');
    await page.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
