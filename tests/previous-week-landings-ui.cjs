// Browser coverage for read-only previous-week evidence. All history is synthetic;
// every browser request is intercepted and no production connection is created.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const extract = name => {
  const start = app.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'));
  assert(start >= 0, 'Actual helper exists: ' + name);
  const rest = app.slice(start);
  return rest.slice(0, rest.indexOf('\n}') + 2);
};

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH });
  let checks = 0;
  const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
  const ok = (value, label) => { assert(value, label); checks++; };
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    const blockedRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      blockedRequests.push(route.request().url());
      return route.abort();
    });
    await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><main id="fixture" style="padding:12px;max-width:920px;margin:auto"></main>');
    await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'styles.css'), 'utf8') });
    await page.addScriptTag({ content: ['splitLineTricks', 'assignmentPresentation', 'tricktionaryLandingDate'].map(extract).join('\n') });
    await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'previous-week-landings.js'), 'utf8') });
    await page.evaluate(() => {
      window.countryTimezones = { AU: 'Australia/Brisbane', GB: 'Europe/London' };
      window.qa = {
        rows: [], queries: [], delayed: [], fail: false, delay: false,
        athleteId: 'rider-a', userId: 'coach-a', clicks: [], mounts: [],
      };
      window.escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      window.qaClient = {
        from(table) {
          if (table !== 'tricktionary_landing_history') throw Error('Unexpected history table: ' + table);
          const request = { table, operations: [] };
          qa.queries.push(request);
          let rows = structuredClone(qa.rows);
          let offset = 0;
          let end = Infinity;
          const query = {};
          const filter = (name, predicate) => (key, value) => {
            request.operations.push([name, key, value]);
            rows = rows.filter(row => predicate(row[key], value));
            return query;
          };
          query.select = fields => { request.operations.push(['select', fields]); return query; };
          query.eq = filter('eq', (left, right) => left === right);
          query.neq = filter('neq', (left, right) => left !== right);
          query.gte = filter('gte', (left, right) => left >= right);
          query.gt = filter('gt', (left, right) => left > right);
          query.lt = filter('lt', (left, right) => left < right);
          query.lte = filter('lte', (left, right) => left <= right);
          query.in = filter('in', (left, values) => values.includes(left));
          query.or = expression => {
            request.operations.push(['or', expression]);
            const dates = expression.match(/landing_date\.gte\.([^,]+),landing_date\.lt\.([^\)]+)/);
            const times = expression.match(/landed_at\.gte\.([^,]+),landed_at\.lt\.([^\)]+)/);
            if (!dates || !times) throw Error('Unexpected date-bound expression: ' + expression);
            rows = rows.filter(row => row.landing_date != null
              ? row.landing_date >= dates[1] && row.landing_date < dates[2]
              : row.landed_at >= times[1] && row.landed_at < times[2]);
            return query;
          };
          query.order = (key, options = {}) => {
            request.operations.push(['order', key, options]);
            rows.sort((a, b) => String(a[key]).localeCompare(String(b[key])) * (options.ascending === false ? -1 : 1));
            return query;
          };
          query.range = (from, to) => { request.operations.push(['range', from, to]); offset = from; end = to + 1; return query; };
          query.limit = limit => { request.operations.push(['limit', limit]); end = limit; return query; };
          query.abortSignal = signal => { request.operations.push(['abortSignal', signal.aborted]); return query; };
          query.then = (resolve, reject) => {
            const response = qa.fail
              ? { data: null, error: { message: 'Synthetic history unavailable' } }
              : { data: rows.slice(offset, end), error: null };
            const result = qa.delay ? new Promise(done => qa.delayed.push(() => done(response))) : Promise.resolve(response);
            return result.then(resolve, reject);
          };
          return query;
        },
        rpc: () => { throw Error('Previous-week indicators must not invoke mutation RPCs'); },
      };
      window.qaAssignments = [
        { id: 'backflip', athlete_id: 'rider-a', category: 'dialled', trick_name: 'Backflip', done: false },
        { id: 'tailwhip', athlete_id: 'rider-a', category: 'one_bang', trick_name: 'Tailwhip', done: true },
        { id: 'long', athlete_id: 'rider-a', category: 'dialled', trick_name: 'Opposite 360 downside tailwhip to a controlled landing', done: false },
        { id: 'line', athlete_id: 'rider-a', category: 'lines', trick_name: 'Backflip → Barspin → Tailwhip', done: false },
        { id: 'percentage', athlete_id: 'rider-a', category: 'percentage', trick_name: 'Double tailwhip', done: false },
      ];
      window.qaHistory = (athleteId = 'rider-a') => ['backflip', 'long', 'line', 'percentage'].map((id, index) => {
        const assignment = qaAssignments.find(row => row.id === id);
        return {
          id: 'evidence-' + index, athlete_id: athleteId, assignment_id: 'old-' + id,
          trick_name: assignment.trick_name, notes: '', category: assignment.category,
          landed_at: '2026-09-29T04:00:00Z', landing_date: '2026-09-29',
          landed_count: 1, evidence_type: assignment.category === 'percentage' ? 'percentage' : 'progress',
        };
      });
      window.qaRender = (athleteId = 'rider-a') => {
        qa.athleteId = athleteId;
        const markup = qaAssignments.map(source => {
          const assignment = { ...source, athlete_id: athleteId };
          const presentation = assignmentPresentation(assignment);
          const title = escapeHtml(presentation.title) + JKPreviousWeekLandings.marker(assignment, presentation.title);
          if (assignment.category === 'percentage') {
            const dots = Array.from({ length: 10 }, (_, index) => '<button type="button" class="attempt-dot" data-percentage-attempt-number="' + (index + 1) + '" data-percentage-cycle="" aria-label="Attempt ' + (index + 1) + '">' + (index + 1) + '</button>').join('');
            return '<div class="percentage-card" data-fixture-assignment="' + assignment.id + '"><div class="percentage-card-head"><div><strong>' + title + '</strong><small>0 landed · 0 missed · 0/10 attempts</small></div><span class="percentage-result">0%</span></div><div class="attempt-dots">' + dots + '</div></div>';
          }
          return '<div class="viewer-trick-row viewer-attempt-row ' + (assignment.done ? 'complete' : '') + '" data-fixture-assignment="' + assignment.id + '"><button class="assignment-check" type="button" data-assignment-id="' + assignment.id + '" data-viewer-assignment-action="' + (assignment.done ? 'unlanded' : 'landed') + '" aria-label="' + (assignment.done ? 'Untick landed' : 'Mark landed') + '">' + (assignment.done ? '✓' : '') + '</button><span><strong>' + title + '</strong><small>' + (assignment.done ? 'Complete' : 'Not landed this week') + '</small></span></div>';
        }).join('');
        document.querySelector('#fixture').innerHTML = '<div class="viewer-inline-list viewer-list-tone-dialled" data-viewer-plan="' + athleteId + '"><div class="panel-meta viewer-list-meta">Trick list · 1/5 complete</div><div class="viewer-trick-list">' + markup + '</div></div>';
        for (const button of document.querySelectorAll('[data-viewer-assignment-action], [data-percentage-cycle]')) {
          button.addEventListener('click', () => qa.clicks.push(button.dataset.assignmentId || 'attempt-' + button.dataset.percentageAttemptNumber));
        }
      };
      window.qaMount = () => {
        const athleteId = qa.athleteId;
        const userId = qa.userId;
        const panel = document.querySelector('[data-viewer-plan]');
        const promise = Promise.resolve(JKPreviousWeekLandings.mount({
          root: panel, client: qaClient, userId, athleteId, countryCode: 'AU', weekStart: '2026-10-04',
          landingDate: tricktionaryLandingDate, present: assignmentPresentation,
          isCurrent: () => qa.athleteId === athleteId && qa.userId === userId && panel.isConnected,
        }));
        qa.mounts.push(promise);
        return promise;
      };
      window.qaControls = () => Array.from(document.querySelectorAll('[data-viewer-assignment-action], [data-percentage-cycle]'), element => element.outerHTML);
      qa.rows = qaHistory();
      qaRender();
    });

    const controlsBefore = await page.evaluate(() => qaControls());
    eq(await page.locator('[data-previous-week-marker]:visible').count(), 0, 'Markers remain hidden before evidence loads');
    await page.evaluate(() => qaMount());
    await page.waitForFunction(() => document.querySelector('[data-fixture-assignment="backflip"] [data-previous-week-marker]')?.hidden === false);
    eq(await page.locator('[data-previous-week-marker]:visible').count(), 4, 'Prior-week evidence appears on standard, line and percentage assignments');
    eq(await page.locator('[data-fixture-assignment="tailwhip"] [data-previous-week-marker]:visible').count(), 0, 'Current completion alone cannot create prior-week evidence');
    eq(await page.evaluate(() => qaControls()), controlsBefore, 'Evidence leaves all current-week completion and percentage controls unchanged');
    ok(/last week|previous week/i.test(await page.locator('.viewer-list-meta').textContent()), 'The inline legend explains what the extra indicator means');
    const markerAccessibility = await page.locator('[data-fixture-assignment="backflip"] [data-previous-week-marker]').evaluate(element => ({
      tag: element.tagName,
      label: [element.getAttribute('aria-label'), element.getAttribute('title'), element.textContent].filter(Boolean).join(' '),
      tabIndex: element.tabIndex,
      interactiveAncestor: Boolean(element.closest('button, input, a, [role="button"], [role="checkbox"]')),
      color: getComputedStyle(element).color,
    }));
    eq(markerAccessibility.tag, 'SPAN', 'The extra tick is a read-only span');
    eq(markerAccessibility.interactiveAncestor, false, 'The history indicator is separate from interactive controls');
    eq(markerAccessibility.tabIndex, -1, 'Read-only history does not add a misleading keyboard stop');
    ok(/last week|previous week/i.test(markerAccessibility.label), 'The indicator has an accessible prior-week description');
    const rgb = markerAccessibility.color.match(/[\d.]+/g).map(Number);
    ok(rgb[1] > rgb[0] && rgb[1] > rgb[2], 'The history indicator is visibly green');
    await page.locator('[data-assignment-id="backflip"]').click();
    await page.locator('[data-percentage-attempt-number="1"]').click();
    eq(await page.evaluate(() => qa.clicks), ['backflip', 'attempt-1'], 'Original completion and percentage listeners still work');
    await page.locator('[data-fixture-assignment="backflip"] [data-previous-week-marker]').click();
    eq(await page.evaluate(() => qa.clicks), ['backflip', 'attempt-1'], 'Clicking the read-only tick never marks this week complete');

    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await page.evaluate(() => Array.from(document.querySelectorAll('[data-viewer-plan], .viewer-list-meta, .viewer-trick-row, .percentage-card, .percentage-card-head, [data-previous-week-marker]:not([hidden])')).flatMap(element => {
        const rect = element.getBoundingClientRect();
        return rect.left < -1 || rect.right > innerWidth + 1 || element.scrollWidth > element.clientWidth + 1
          ? [{ element: element.className, left: rect.left, right: rect.right, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }]
          : [];
      }));
      eq(overflow, [], 'Rows, percentage cards and legend fit the ' + width + 'px viewport');
      eq(await page.locator('[data-fixture-assignment="backflip"] strong').evaluate(element => {
        const title = document.createRange();
        title.selectNodeContents(element.firstChild);
        const text = title.getBoundingClientRect();
        const tick = element.querySelector('[data-previous-week-marker]').getBoundingClientRect();
        return tick.left >= text.right && tick.top < text.bottom && tick.bottom > text.top;
      }), true, 'The green tick sits inline beside the trick title at ' + width + 'px');
      if (width === 390 && process.env.JKCREW_SCREENSHOT_PATH) await page.screenshot({ path: process.env.JKCREW_SCREENSHOT_PATH, fullPage: true });
    }

    // A rider switch replaces the visible DOM while the first query is in flight.
    await page.evaluate(() => {
      JKPreviousWeekLandings.clear();
      qa.delay = true; qa.rows = qaHistory('rider-a'); qaRender('rider-a'); void qaMount();
    });
    await page.waitForFunction(() => qa.delayed.length === 1);
    await page.evaluate(() => {
      qa.delay = false; qa.rows = []; qaRender('rider-b'); return qaMount();
    });
    const nextRiderBefore = await page.locator('[data-viewer-plan]').innerHTML();
    await page.evaluate(async () => { qa.delayed.splice(0).forEach(resolve => resolve()); await Promise.all(qa.mounts); });
    eq(await page.locator('[data-viewer-plan]').innerHTML(), nextRiderBefore, 'A delayed prior-rider response cannot alter the current rider DOM');
    eq(await page.locator('[data-previous-week-marker]:visible').count(), 0, 'The new rider never receives the previous rider indicators');

    // The same rider can leave/reopen the list before the original request ends.
    await page.evaluate(() => {
      JKPreviousWeekLandings.clear(); qa.delay = true; qa.rows = qaHistory(); qaRender(); void qaMount();
    });
    await page.waitForFunction(() => qa.delayed.length === 1);
    await page.evaluate(() => {
      qaRender(); qa.userId = 'another-coach'; qa.delay = false; qa.rows = [];
    });
    const replacementBefore = await page.locator('[data-viewer-plan]').innerHTML();
    await page.evaluate(async () => { qa.delayed.splice(0).forEach(resolve => resolve()); await Promise.all(qa.mounts); });
    eq(await page.locator('[data-viewer-plan]').innerHTML(), replacementBefore, 'Detached DOM and changed viewer identity discard the stale result');

    await page.evaluate(() => {
      JKPreviousWeekLandings.clear(); qa.fail = true; qa.delay = false; qa.userId = 'coach-a'; qa.rows = qaHistory(); qaRender(); return qaMount();
    });
    const retry = page.getByRole('button', { name: /retry/i });
    await retry.waitFor({ state: 'visible' });
    eq(await page.locator('[data-previous-week-marker]:visible').count(), 0, 'A failed query never invents landed evidence');
    eq(await page.evaluate(() => qaControls()), controlsBefore, 'A failed history query leaves this-week controls available');
    const queriesBeforeRetry = await page.evaluate(() => qa.queries.length);
    await page.evaluate(() => { qa.fail = false; });
    await retry.click();
    await page.waitForFunction(() => document.querySelectorAll('[data-previous-week-marker]:not([hidden])').length === 4);
    ok(await page.evaluate(before => qa.queries.length > before, queriesBeforeRetry), 'Retry performs a new history request');
    eq(await retry.count(), 0, 'Successful retry removes the error action');
    eq(await page.evaluate(() => qaControls()), controlsBefore, 'Successful retry preserves current-week controls');
    const requests = await page.evaluate(() => qa.queries);
    ok(requests.every(request => request.operations.some(([op, key, value]) => op === 'eq' && key === 'athlete_id' && ['rider-a', 'rider-b'].includes(value))), 'Every history query is scoped to the requested rider');
    ok(requests.every(request => request.operations.some(([op, expression]) => op === 'or' && /landing_date\.gte\./.test(expression) && /landing_date\.lt\./.test(expression) && /landed_at\.gte\./.test(expression) && /landed_at\.lt\./.test(expression))), 'Every history request is bounded to the relevant time window');
    ok(requests.every(request => request.operations.some(([op, from, to]) => op === 'range' && Number.isInteger(from) && Number.isInteger(to) && to >= from)), 'History reads use bounded page ranges');

    // Exercise the actual app renderers and both event-binding entry points as
    // well as the standalone module. Unrelated UI services stay local stubs.
    await page.addScriptTag({ content: [
      'sessionViewerListContent', 'percentageAssignmentList', 'mountViewerPreviousWeekLandings',
      'bindSessionViewerActions', 'bindSessionViewerFastActions',
    ].map(extract).join('\n') });
    await page.evaluate(() => {
      JKPreviousWeekLandings.clear();
      qa.rows = qaHistory(); qa.clicks = []; qa.integrationMounts = []; qa.countryCalls = [];
      window.state = { view: 'sessionViewer', user: { id: 'coach-a' }, profile: { role: 'coach' } };
      window.client = qaClient;
      window.isCoachRole = role => ['coach', 'admin'].includes(role);
      window.weekStartDateForCountry = country => { qa.countryCalls.push(country); return '2026-10-04'; };
      window.sessionViewerAssignmentsForList = (entry, list) => entry.assignments.filter(row => row.category === list);
      window.isAssignmentComplete = assignment => assignment.done;
      window.categoryDisplayInfo = list => ({ label: list });
      window.sessionViewerAssignmentEditor = () => '';
      window.assignmentStatus = assignment => assignment.done ? 'Complete' : 'Not landed this week';
      window.percentageSummary = () => ({ attempts: 0, landed: 0, missed: 0, percentage: 0, complete: false });
      window.percentageAttemptsByNumber = () => new Map();
      window.nextPercentageAttemptNumber = () => 1;
      window.percentagePointsStatus = () => '0 points awarded';
      window.percentageClass = () => '';
      for (const name of [
        'mountDailyFeatures', 'bindTrainingProgressActions', 'openSessionViewerCounter', 'finishViewerDailyTimer',
        'recordViewerAssignmentAttempt', 'selectViewerListTab', 'toggleViewerGoal', 'toggleViewerRunPoint',
        'saveSessionViewerAssignments', 'startViewerGroupSession', 'toggleViewerGroupSessionPause',
        'endViewerGroupSession', 'addExtraRiderToGroupSession',
      ]) window[name] = () => {};
      window.recordViewerAssignmentAction = event => qa.clicks.push(event.currentTarget.dataset.assignmentId);
      window.recordViewerPercentageAttempt = event => qa.clicks.push('attempt-' + event.currentTarget.dataset.percentageAttemptNumber);
      const originalMount = JKPreviousWeekLandings.mount;
      JKPreviousWeekLandings.mount = options => {
        qa.integrationMounts.push({ userId: options.userId, athleteId: options.athleteId, countryCode: options.countryCode, weekStart: options.weekStart });
        const promise = originalMount(options); qa.mounts.push(promise); return promise;
      };
      window.qaIntegrationRender = (list, binding) => {
        const entry = { athlete: { id: 'rider-a', country_code: 'GB' }, assignments: qaAssignments };
        document.querySelector('#fixture').innerHTML = '<div class="viewer-inline-list viewer-list-tone-' + list + '" data-viewer-plan="rider-a" data-athlete-country="GB">' + sessionViewerListContent(entry, null, list) + '</div>';
        qa.integrationControls = qaControls();
        if (binding === 'full') bindSessionViewerActions(); else bindSessionViewerFastActions();
      };
    });
    for (const [list, binding, ticks] of [['dialled', 'full', 2], ['lines', 'light', 1], ['percentage', 'light', 1]]) {
      await page.evaluate(([list, binding]) => qaIntegrationRender(list, binding), [list, binding]);
      await page.waitForFunction(ticks => document.querySelectorAll('[data-previous-week-marker]:not([hidden])').length === ticks, ticks);
      eq(await page.locator('[data-previous-week-marker]:visible').count(), ticks, 'Actual ' + list + ' renderer and ' + binding + ' action binder display history');
      eq(await page.evaluate(() => qaControls()), await page.evaluate(() => qa.integrationControls), 'Actual ' + list + ' completion controls remain unchanged after the mount');
      eq(await page.evaluate(() => qa.integrationMounts.at(-1)), { userId: 'coach-a', athleteId: 'rider-a', countryCode: 'GB', weekStart: '2026-10-04' }, 'Actual mount hook passes authenticated viewer and rider-local week for ' + list);
    }
    eq(await page.locator('.percentage-card [data-percentage-cycle]').count(), 10, 'Actual percentage renderer retains all ten attempt controls');
    await page.locator('[data-percentage-cycle][data-percentage-attempt-number="1"]').click();
    eq(await page.evaluate(() => qa.clicks), ['attempt-1'], 'Actual fast binder retains the percentage event handler');
    await page.locator('[data-previous-week-marker]').click();
    eq(await page.evaluate(() => qa.clicks), ['attempt-1'], 'Actual percentage history tick does not trigger the scoring handler');
    await page.evaluate(() => qaIntegrationRender('dialled', 'full'));
    await page.waitForFunction(() => document.querySelectorAll('[data-previous-week-marker]:not([hidden])').length === 2);
    await page.locator('[data-assignment-id="backflip"]').click();
    eq(await page.evaluate(() => qa.clicks), ['attempt-1', 'backflip'], 'Actual full binder retains the completion event handler');
    const integrationMounts = await page.evaluate(() => qa.integrationMounts.length);
    await page.evaluate(() => { state.profile.role = 'athlete'; qaIntegrationRender('dialled', 'full'); });
    eq(await page.evaluate(() => qa.integrationMounts.length), integrationMounts, 'Actual mount hook does not fetch history outside coach access');
    eq(await page.locator('[data-previous-week-marker]:visible').count(), 0, 'Rider-role rendering cannot reveal coach history hints');
    await page.evaluate(() => { state.profile.role = 'coach'; state.view = 'home'; mountViewerPreviousWeekLandings(); });
    eq(await page.evaluate(() => qa.integrationMounts.length), integrationMounts, 'Actual mount hook does not run away from Session Viewer');
    eq(await page.evaluate(() => {
      const target = document.createElement('div');
      target.innerHTML = percentageAssignmentList(qaAssignments.filter(row => row.category === 'percentage'), '', true);
      return target.querySelectorAll('[data-previous-week-marker]').length;
    }), 0, 'Shared percentage renderer adds no history ticks outside Session Viewer');
    eq(errors, [], 'The real module runs without browser errors');
    eq(blockedRequests, [], 'The isolated browser fixture makes no network requests');
    console.log('PASS: ' + checks + ' previous-week indicator, mobile/desktop layout, unchanged controls, stale responses and retry checks.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
