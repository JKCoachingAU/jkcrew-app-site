const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const start = source.indexOf('async function getLeaderboardFallback(');
assert(start >= 0, 'Actual leaderboard fallback exists');
const fallback = source.slice(start, source.indexOf('\n}', start) + 2);

function fixture({ role = 'parent', disabledError = null } = {}) {
  const profiles = [
    { id: 'active', display_name: 'Active Rider', role: 'athlete', ghost_mode: false },
    { id: 'disabled', display_name: 'Disabled Rider', role: 'athlete', ghost_mode: false },
    { id: 'ghost', display_name: 'Ghost Rider', role: 'athlete', ghost_mode: true },
  ];
  const calls = [], notices = [];
  const context = vm.createContext({
    state: { user: { id: 'viewer' }, profile: { role } },
    console: { error() {} },
    isCoachRole: value => ['coach', 'admin'].includes(value),
    notify: (...args) => notices.push(args),
    messageFrom: error => error.message,
    client: {
      from(table) {
        assert.equal(table, 'profiles');
        const query = { select() { return query; }, eq() { return query; }, order() { return query; }, then(resolve, reject) {
          return Promise.resolve({ data: profiles, error: null }).then(resolve, reject);
        } };
        return query;
      },
      rpc(name) {
        assert.equal(name, 'get_disabled_leaderboard_rider_ids');
        calls.push(name);
        return Promise.resolve(disabledError
          ? { data: null, error: disabledError }
          : { data: [{ athlete_id: 'disabled' }], error: null });
      },
    },
  });
  vm.runInContext(fallback, context);
  return { context, calls, notices };
}

(async () => {
  const parent = fixture();
  const rows = await parent.context.getLeaderboardFallback(new Error('Scores unavailable'));
  assert.deepEqual(Array.from(rows, row => row.athlete_id), ['active'], 'Fallback omits disabled and parent-hidden ghost riders');
  assert.equal(parent.calls.length, 1, 'Fallback verifies disabled status once');
  assert.equal(rows[0].weekly_points, 0, 'Safe fallback keeps its established zero-score behavior');

  const coach = fixture({ role: 'coach' });
  const coachRows = await coach.context.getLeaderboardFallback(new Error('Scores unavailable'));
  assert.deepEqual(Array.from(coachRows, row => row.athlete_id), ['active', 'ghost'], 'Coach fallback retains visible ghosts but still omits disabled riders');

  const unavailable = fixture({ disabledError: new Error('Access check unavailable') });
  assert.deepEqual(Array.from(await unavailable.context.getLeaderboardFallback(new Error('Scores unavailable'))), [], 'Fallback fails closed when disabled status cannot be verified');
  assert.match(unavailable.notices[0][0], /temporarily unavailable/);
  console.log('PASS disabled leaderboard fallback: disabled filtering, ghost visibility, safe status-check failure.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
