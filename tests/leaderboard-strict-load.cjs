// Execute the real leaderboard loader without production network or credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const start = source.indexOf('async function getLeaderboard(');
const fn = source.slice(start, source.indexOf('\n}', start) + 2);
let checks = 0;
const eq = (value, expected, message) => { assert.deepEqual(value, expected, message); checks++; };
const memory = new Map();
const qa = { calls: 0, fallback: 0, extras: 0, fail: true, hold: false, release: null };
const scores = [{ athlete_id: 'child-a', display_name: 'Child A', weekly_points: 32, all_time_points: 125, rank_number: 4 }];
const context = vm.createContext({
  state: { user: { id: 'parent-a' }, profile: { role: 'parent' }, inFlight: new Map() },
  console: { error() {}, warn() {} },
  cacheGet: key => memory.get(key),
  cacheSet: (key, value) => { memory.set(key, value); return value; },
  retryNetworkRequest: async request => request(),
  getLeaderboardFallback: async () => { qa.fallback++; return [{ athlete_id: 'child-a', weekly_points: 0, rank_number: 1 }]; },
  riderXpSummary: () => ({ level: 5, current_badge: 'test' }),
  client: {
    rpc: async name => {
      assert.equal(name, 'get_weekly_leaderboard');
      qa.calls++;
      const fail = qa.fail;
      if (qa.hold) await new Promise(resolve => { qa.release = resolve; });
      return fail ? { error: new Error('Fixture outage') } : { data: scores, error: null };
    },
    from: table => {
      assert.equal(table, 'profiles');
      return { select: () => ({ in: async () => { qa.extras++; return { data: [], error: null }; } }) };
    },
  },
});
vm.runInContext(fn, context);
(async () => {
  await assert.rejects(context.getLeaderboard({ allowFallback: false }), /Fixture outage/); checks++;
  eq(qa.fallback, 0, 'Strict Home never fabricates zero scores');
  eq(qa.extras, 0, 'Failed scores do not fetch profile extras');
  eq(memory.size, 0, 'Failure is not cached as empty standings');
  eq(context.state.inFlight.size, 0, 'Failure clears the in-flight request for retry');
  const fallback = await context.getLeaderboard();
  eq(fallback[0].weekly_points, 0, 'Existing fallback remains available to existing callers');
  eq(qa.fallback, 1, 'Only non-strict caller used legacy fallback');
  qa.fail = false;
  const restored = await context.getLeaderboard({ allowFallback: false });
  eq(restored[0].weekly_points, 32, 'Retry recovers the real weekly score');
  eq(restored[0].all_time_points, 125, 'Lifetime score is preserved');
  eq(restored[0].rank_number, 4, 'Official crew rank is preserved');
  const calls = qa.calls;
  await context.getLeaderboard({ allowFallback: false });
  eq(qa.calls, calls, 'Strict requests reuse their successful score cache');
  context.state.user.id = 'parent-b';
  await context.getLeaderboard({ allowFallback: false });
  eq(qa.calls, calls + 1, 'Different parent never reuses another parent’s cache');
  memory.clear(); qa.fail = true; qa.hold = true;
  const legacyPending = context.getLeaderboard();
  const legacyRelease = qa.release;
  qa.fail = false;
  const strictPending = context.getLeaderboard({ allowFallback: false });
  const strictRelease = qa.release;
  assert.notEqual(strictRelease, legacyRelease, 'Strict request does not join a legacy fallback request'); checks++;
  const extraStrict = context.getLeaderboard({ allowFallback: false });
  eq(qa.release, strictRelease, 'Concurrent strict requests share a single flight');
  strictRelease(); legacyRelease();
  const [legacy, strict, joined] = await Promise.all([legacyPending, strictPending, extraStrict]);
  eq(legacy[0].weekly_points, 0, 'Legacy failed request remains independent');
  eq(strict[0].weekly_points, 32, 'Concurrent strict request receives only actual scores');
  eq(joined[0].weekly_points, 32, 'Joined strict request receives actual scores');
  eq(context.state.inFlight.size, 0, 'All completed requests are cleaned up');
  console.log(`PASS: ${checks} strict leaderboard loading checks.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
