// Session Viewer keeps the roster read lightweight and only loads nested
// attempts/awards for the rider whose card is open. This protects the live
// session page when many riders are connected at once.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const extract = name => {
  const start = app.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert(start >= 0, `${name} exists`);
  const rest = app.slice(start);
  return rest.slice(0, rest.indexOf('\n}') + 2);
};

const calls = [];
const state = { sessionViewerDataVersion: 0, cache: {}, inFlight: new Map() };
const categoryInfo = { daily: {}, percentage: {}, one_bang: {}, dialled: {}, bonus: {}, lines: {}, trick_links: {} };
const rows = {
  summary: [
    { id: 'r1-daily', athlete_id: 'r1', category: 'daily', venue: 'Park', progress: { progress_date: '2026-11-12' }, percentage_attempt_count: 0 },
    { id: 'r1-percent', athlete_id: 'r1', category: 'percentage', venue: '', progress: null, percentage_attempt_count: 10 },
    { id: 'r1-bang', athlete_id: 'r1', category: 'one_bang', venue: '', progress: null, percentage_attempt_count: 0, recent_award_at: '2026-11-11T10:00:00Z' },
    { id: 'r2-daily', athlete_id: 'r2', category: 'daily', venue: 'Park', progress: null, percentage_attempt_count: 0 },
  ],
  detail: [
    { id: 'r1-daily', athlete_id: 'r1', category: 'daily', venue: 'Park', progress: { progress_date: '2026-11-12' }, percentage_attempts: [], assignment_attempts: [], awards: [] },
    { id: 'r1-percent', athlete_id: 'r1', category: 'percentage', venue: '', progress: null, percentage_attempts: Array.from({ length: 10 }, (_, i) => ({ attempt_number: i + 1, landed: i % 2 === 0 })), assignment_attempts: [], awards: [] },
    { id: 'r1-bang', athlete_id: 'r1', category: 'one_bang', venue: '', progress: { completed_at: '2026-11-11T10:00:00Z' }, percentage_attempts: [], assignment_attempts: [], awards: [] },
  ],
};

const context = {
  state,
  categoryInfo,
  cacheGet(key, ttl) { const entry = state.cache[key]; return entry && Date.now() - entry.time <= ttl ? entry.value : null; },
  cacheSet(key, value) { state.cache[key] = { value, time: Date.now() }; return value; },
  weekStartDateForCountry: () => '2026-11-08',
  reconcileAwardedProgress(assignment, progress, awards = []) {
    if (progress?.completed_at || !['dialled', 'one_bang', 'bonus', 'trick_links'].includes(assignment.category)) return progress;
    const award = awards.find(row => Number(row.points || 0) > 0);
    return award ? { ...(progress || {}), completed_at: award.created_at || new Date().toISOString() } : progress;
  },
  client: { rpc: async (name, args) => {
    calls.push({ name, args });
    return { data: name.endsWith('_summary') ? rows.summary : rows.detail, error: null };
  } },
  Date,
  Map,
  Set,
  Promise,
};
vm.createContext(context);
vm.runInContext(extract('getSessionViewerPlanData'), context);

(async () => {
  const roster = [{ id: 'r1', country_code: 'AU' }, { id: 'r2', country_code: 'AU' }];
  const summary = await context.getSessionViewerPlanData(roster);
  assert.deepEqual(calls.map(call => call.name), ['get_coach_session_viewer_plan_summary']);
  assert.equal(summary.assignmentsByAthlete.get('r1').find(row => row.category === 'percentage').percentageAttempts.length, 10);
  assert.equal(summary.assignmentsByAthlete.get('r1').find(row => row.category === 'one_bang').progress.completed_at, '2026-11-11T10:00:00Z');

  const beforeDetail = calls.length;
  const detail = await context.getSessionViewerPlanData(roster, { detailAthleteIds: ['r1'] });
  assert.deepEqual(calls.slice(beforeDetail).map(call => call.name), ['get_coach_session_viewer_plan_data']);
  assert.equal(detail.assignmentsByAthlete.get('r1').find(row => row.category === 'percentage').percentageAttempts[1].landed, false);
  assert.equal(detail.assignmentsByAthlete.get('r2').length, 1, 'Other riders keep the cached summary rows');

  const afterDetail = calls.length;
  await context.getSessionViewerPlanData(roster, { detailAthleteIds: ['r1'] });
  assert.equal(calls.length, afterDetail, 'Opening a list tab reuses the short-lived detail cache');

  const beforeSecond = calls.length;
  await context.getSessionViewerPlanData(roster, { detailAthleteIds: ['r2'] });
  assert.deepEqual(calls.slice(beforeSecond).map(call => call.name), ['get_coach_session_viewer_plan_data']);
  assert.equal(calls.at(-1).args.p_athlete_ids.length, 1, 'Full nested data is scoped to the opened rider');
  console.log('PASS: Session Viewer uses one lightweight roster read and rider-scoped detail reads with cache reuse.');
})().catch(error => { console.error(error); process.exitCode = 1; });
