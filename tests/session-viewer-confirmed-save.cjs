// Actual save/refresh functions with synthetic controls and deferred responses.
// No network, real accounts, point receipts, or production connection is used.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const daily = fs.readFileSync(path.join(root, 'daily-completion.js'), 'utf8');
const extract = (source, name) => {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert(start >= 0, name);
  const rest = source.slice(start);
  return rest.slice(0, rest.indexOf('\n}') + 2);
};
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
let checks = 0;
const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };

function control(data = {}, complete = false) {
  const classes = new Set(complete ? ['complete'] : []);
  const classList = { contains: key => classes.has(key), add: key => classes.add(key), toggle(key, on) { const next = on === undefined ? !classes.has(key) : on; if (next) classes.add(key); else classes.delete(key); return next; } };
  const row = { classList };
  const button = {
    dataset: { assignmentId: 'a1', athleteId: 'r1', assignmentCategory: 'one_bang', viewerAssignmentAction: complete ? 'unlanded' : 'landed', ...data },
    classList, disabled: false, isConnected: true, textContent: complete ? '✓' : '', innerHTML: '<span>Attempt</span><span class="attempt-pill">0</span>', attrs: {},
    setAttribute(key, value) { this.attrs[key] = value; }, removeAttribute(key) { delete this.attrs[key]; },
    closest(selector) { if (selector === '.viewer-trick-row' || selector === '.assignment-row') return row; if (selector === '[data-viewer-athlete-card]') return { dataset: { viewerAthleteCard: 'r1' } }; return null; },
    querySelector(selector) { return selector === '.attempt-pill' ? { textContent: this.innerHTML.match(/attempt-pill">(\d+)/)?.[1] || '0' } : null; },
  };
  return { button, row, event: { currentTarget: button, preventDefault() {}, stopPropagation() {} } };
}

function fixture() {
  const state = { user: { id: 'coach' }, sessionSetupVersion: 1, view: 'sessionViewer', sessionViewerRenderVersion: 0, sessionViewerDataVersion: 0, sessionViewerVenue: 'Park', sessionViewerActiveSessionCache: { id: 'group' }, sessionOpenAssignmentSections: new Set(), pendingAssignmentProgress: new Map(), pendingPercentageAttempts: new Map(), inFlight: new Map(), cache: {} };
  const calls = [], notices = [], refreshes = [], warnings = [];
  const saves = [], timeoutOverrides = {};
  const context = {
    state, calls, notices, refreshes, warnings, saves, timeoutOverrides,
    console: { warn: (...args) => warnings.push(args) }, Promise, Map, Set, Date, AbortController, setTimeout, clearTimeout,
    withTimeout: (promise, label, ms) => context.realTimeout(promise, label, timeoutOverrides[label] ?? ms),
    saveProgressRpc(name, args) { calls.push({ name, args }); return Promise.resolve(saves.shift() || { data: { assignment_id: 'a1', message: 'Trick complete', points_awarded: 2, attempt_count: 5, attempts: 1, attempt_number: 1 } }); },
    setButtonBusy(button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); return () => { button.disabled = false; button.removeAttribute('aria-busy'); }; },
    setPendingAssignmentProgress(id, complete) { state.pendingAssignmentProgress.set(id, { complete }); }, clearPendingAssignmentProgress(id) { state.pendingAssignmentProgress.delete(id); },
    setPendingPercentageAttempt(id, number, landed) { state.pendingPercentageAttempts.set(id + ':' + number, landed); }, clearPendingPercentageAttempt(id, number) { state.pendingPercentageAttempts.delete(id + ':' + number); },
    cacheClear: key => calls.push({ clear: key }), invalidateSessionViewerData: () => state.sessionViewerDataVersion++,
    notify: (message, kind) => notices.push({ message, kind }), messageFrom: error => error.message,
    refreshOpenTrainingProgress: async () => {}, getActiveCoachGroupSession: async () => ({ id: 'group' }),
    refreshSessionViewerLight() { state.sessionViewerRenderVersion++; const request = deferred(); refreshes.push(request); return request.promise; },
    setSyncStatus: status => calls.push({ sync: status }),
    dailyFinishContext(button, viewer) { return { userId: state.user.id, athleteId: 'r1', view: state.view, venue: 'Park', tappedAt: '2026-11-21T00:00:00Z', viewer }; },
    dailyFinishContextIsCurrent: context => state.user.id === context.userId && state.view === context.view,
    handleDailyCompletionAction: async () => false,
    renderSession: () => context.refreshSessionViewerLight(), renderAthleteHome: () => context.refreshSessionViewerLight(),
  };
  vm.createContext(context);
  vm.runInContext(extract(app, 'withTimeout').replace('function withTimeout(', 'function realTimeout(') + '\n' + ['queueSessionViewerRefresh', 'recordViewerAssignmentAction', 'recordViewerAssignmentAttempt', 'recordViewerPercentageAttempt'].map(name => extract(app, name)).join('\n') + '\n' + extract(daily, 'recordDailyTrainingAction'), context);
  return context;
}

async function saveChecks() {
  for (const kind of ['weekly', 'attempt', 'percentage', 'daily']) {
    const f = fixture(), c = control(kind === 'attempt' ? { viewerAssignmentAttempt: 'a1' } : kind === 'percentage' ? { percentageCycle: 'empty', percentageAttemptNumber: '1' } : kind === 'daily' ? { assignmentCategory: 'daily', viewerAssignmentAction: 'landed' } : {});
    const fn = kind === 'weekly' ? 'recordViewerAssignmentAction' : kind === 'attempt' ? 'recordViewerAssignmentAttempt' : kind === 'percentage' ? 'recordViewerPercentageAttempt' : 'recordDailyTrainingAction';
    const response = deferred(); f.saves.push(response.promise);
    const saving = f[fn](c.event, kind === 'daily');
    eq(c.button.disabled, true, kind + ' remains disabled until the write is confirmed');
    eq(f.notices.length, 0, kind + ' reports no invented points before a receipt');
    response.resolve({ data: { assignment_id: 'a1', message: 'Confirmed', points_awarded: 2, attempt_count: 5, attempts: 1, attempt_number: 1 } });
    await saving;
    eq(c.button.disabled, false, kind + ' re-enables immediately while list refresh remains pending');
    eq(f.refreshes.length, 1, kind + ' schedules one background list refresh');
    eq(f.calls.filter(call => call.name).length, 1, kind + ' submits exactly one write');
    if (kind === 'weekly' || kind === 'daily') {
      eq(c.row.classList.contains('complete'), true, kind + ' keeps the confirmed tick');
      eq(c.button.dataset.viewerAssignmentAction, 'unlanded', kind + ' updates the next action before refresh');
    }
    if (kind === 'attempt') eq(c.button.innerHTML.includes('>5</span>'), true, 'Attempt button uses the confirmed server count');
    if (kind === 'percentage') eq(c.button.dataset.percentageCycle, 'landed', 'Percentage cycle advances from the confirmed action');
    f.refreshes[0].reject(new Error('Refresh failed after commit'));
    await f.state.sessionViewerRefreshRequest.promise;
    eq(c.button.disabled, false, kind + ' stays enabled after refresh failure');
    if (kind === 'weekly' || kind === 'daily') eq(c.row.classList.contains('complete'), true, kind + ' never rolls back a committed tick on read failure');
    if (kind === 'attempt') eq(c.button.innerHTML.includes('>5</span>'), true, 'Read failure preserves the confirmed attempt count');
    if (kind === 'percentage') eq(f.state.pendingPercentageAttempts.get('a1:1'), true, 'Read failure preserves confirmed percentage evidence');
    eq(f.notices.at(-1).message.startsWith('Saved.'), true, kind + ' clearly distinguishes a failed refresh from a failed save');
  }
  for (const kind of ['weekly', 'attempt', 'percentage', 'daily']) {
    const f = fixture(), c = control(kind === 'attempt' ? { viewerAssignmentAttempt: 'a1' } : kind === 'percentage' ? { percentageCycle: 'empty', percentageAttemptNumber: '1' } : {});
    f.saves.push({ error: new Error('Write denied') });
    const fn = kind === 'weekly' ? 'recordViewerAssignmentAction' : kind === 'attempt' ? 'recordViewerAssignmentAttempt' : kind === 'percentage' ? 'recordViewerPercentageAttempt' : 'recordDailyTrainingAction';
    await f[fn](c.event, kind === 'daily');
    eq(c.button.disabled, false, kind + ' releases the button after a real write failure');
    eq(f.refreshes.length, 0, kind + ' does not schedule a success refresh after write failure');
    eq(f.state.pendingAssignmentProgress.size + f.state.pendingPercentageAttempts.size, 0, kind + ' clears unconfirmed optimistic state');
    eq(f.notices.at(-1).message.includes('Write denied'), true, kind + ' reports the actual write error');
  }
  {
    const f = fixture(), c = control(), response = deferred(); f.saves.push(response.promise);
    const saving = f.recordViewerAssignmentAction(c.event);
    f.state.user = { id: 'different-coach' }; f.state.sessionSetupVersion++;
    response.resolve({ data: { points_awarded: 2 } }); await saving;
    eq(f.notices.length, 0, 'Late save receipt cannot show a private toast in another account');
    eq(f.refreshes.length, 0, 'Late save receipt cannot start a read for another account');
  }
  {
    const f = fixture();
    const first = f.queueSessionViewerRefresh(); f.queueSessionViewerRefresh(); f.queueSessionViewerRefresh();
    eq(f.refreshes.length, 1, 'Concurrent post-save reads share one in-flight refresh');
    f.refreshes[0].resolve(); await tick();
    eq(f.refreshes.length, 2, 'Concurrent later saves coalesce into one follow-up read');
    f.refreshes[1].resolve(); await first;
    eq(f.state.sessionViewerRefreshRequest, null, 'Coalesced refresh state clears after completion');
  }
  {
    const f = fixture(); f.timeoutOverrides['Refresh rider list'] = 20;
    const before = f.state.sessionViewerRenderVersion;
    eq(await f.queueSessionViewerRefresh(), false, 'A hung refresh has a bounded wait');
    eq(f.state.sessionViewerRefreshRequest, null, 'A timed-out refresh does not retain an in-flight guard');
    eq(f.state.sessionViewerRenderVersion, before + 2, 'A timed-out old render is invalidated before a late response');
  }
}

async function readChecks() {
  const f = fixture(); let aborted = false, reads = 0;
  f.categoryInfo = { daily: {} }; f.weekStartDateForCountry = () => '2026-11-15';
  f.reconcileAwardedProgress = (_assignment, progress) => progress;
  f.cacheGet = () => null; f.cacheSet = (_key, value) => value;
  f.client = { rpc() { reads++; const response = deferred(); const query = { order() { return query; }, range() { return query; }, abortSignal(signal) { signal.addEventListener('abort', () => { aborted = true; response.reject(new Error('Aborted')); }, { once: true }); return query; }, then: (resolve, reject) => response.promise.then(resolve, reject) }; return query; } };
  f.timeoutOverrides['Load rider trick list'] = 20;
  vm.runInContext(extract(app, 'getSessionViewerPlanData'), f);
  await assert.rejects(f.getSessionViewerPlanData([{ id: 'r1', country_code: 'AU' }]), /timed out/); checks++;
  eq(aborted, true, 'A timed-out summary read aborts the underlying request');
  eq(reads, 1, 'A timed-out summary read is not automatically retried');
  eq(f.state.inFlight.size, 0, 'A timed-out summary read releases its single-flight entry');
  for (const change of ['account', 'evidence']) {
    const f = fixture(), grid = { isConnected: true, innerHTML: 'confirmed visible cards' }, plan = deferred(), started = deferred();
    const athlete = { id: 'r1', display_name: 'Rider', country_code: 'AU', groupNames: ['group'] };
    Object.assign(f.state, { profile: { role: 'coach' }, loadingOverlayToken: 1, sessionViewerGroup: 'group', sessionViewerVenue: 'Park', sessionViewerSearch: '', sessionViewerRosterCache: [athlete], sessionViewerOpenAthleteId: 'r1', sessionViewerActiveList: 'daily' });
    f.state.sessionViewerWorkspace = { userId: 'coach', setupVersion: 1, navigationToken: 1, group: 'group', venue: 'Park', search: '', groupRoster: [athlete], filteredRoster: [athlete], dataVersion: 0, entries: new Map([['r1', { athlete, detailReady: true, weekStart: '2026-11-15', dataVersion: 0 }]]), cards: new Map() };
    f.document = { querySelector: () => grid }; f.isCoachRole = () => true; f.sessionViewerWeekSignature = () => 'r1:2026-11-15';
    f.state.sessionViewerWorkspace.weekSignature = f.sessionViewerWeekSignature();
    f.paintSessionViewerCounts = f.paintSessionViewerSelection = async () => {};
    f.getSessionViewerPlanData = () => { started.resolve(); return plan.promise; };
    vm.runInContext(['waitForSessionGesture', 'sessionViewerWorkspaceCurrent', 'getSessionViewerSelectedDetail', 'refreshSessionViewerLight'].map(name => extract(app, name)).join('\n'), f);
    const refreshing = f.refreshSessionViewerLight({ force: true });
    await started.promise;
    if (change === 'account') f.state.user = { id: 'new-coach' };
    else f.state.sessionViewerDataVersion++;
    plan.resolve({ assignmentsByAthlete: new Map(), runsByAthlete: new Map(), runProgressByPlan: new Map() });
    await refreshing;
    eq(grid.innerHTML, 'confirmed visible cards', 'A late read cannot repaint after changed ' + change);
  }
}

(async () => { await saveChecks(); await readChecks(); console.log(`PASS: ${checks} confirmed-save, read-failure, isolation, bounded-read and coalescing checks (synthetic controls only).`); })().catch(error => { console.error(error); process.exitCode = 1; });
