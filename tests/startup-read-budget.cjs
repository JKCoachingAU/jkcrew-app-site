// Bound the real client's retry policy and safe-read behavior. All transport is
// synthetic; no production accounts, sessions or points are read or changed.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..'), source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const extract = name => {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
};
let checks = 0;
const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
async function retryChecks() {
  const waits = [], context = vm.createContext({ AbortController, setTimeout, clearTimeout, Promise, Error, Number, String, Math, wait: async ms => { waits.push(ms); } });
  vm.runInContext(['withTimeout', 'isTransientRequestError', 'retryNetworkRequest'].map(extract).join('\n'), context);
  let active = 0, maxActive = 0, calls = 0, aborted = 0;
  const result = await context.retryNetworkRequest(signal => {
    calls++; active++; maxActive = Math.max(maxActive, active);
    if (calls > 1) { active--; return Promise.resolve({ data: { ok: true } }); }
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted++; active--; reject(Error('aborted')); }, { once: true }));
  }, 'Profile load', { timeoutMs: 15 });
  eq(result.data.ok, true, 'A safe read can recover after one timeout');
  eq(calls, 2, 'Safe reads have at most two attempts by default');
  eq(aborted, 1, 'The timed-out fetch is actually aborted');
  eq(maxActive, 1, 'A replacement never overlaps the abandoned request');
  eq(active, 0, 'No orphaned request remains after recovery');
  eq(waits.length, 1, 'Only one retry delay');
  eq(waits[0] >= 400 && waits[0] < 700, true, 'Retry jitter remains bounded');
  calls = 0; aborted = 0;
  await assert.rejects(context.retryNetworkRequest(signal => {
    calls++;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted++; reject(Error('aborted')); }, { once: true }));
  }, 'Feature access check', { timeoutMs: 15 }), /timed out/); checks++;
  eq([calls, aborted], [2, 2], 'Permanent stalls fail recoverably with both underlying reads stopped');
  calls = 0;
  const denial = await context.retryNetworkRequest(() => { calls++; return Promise.resolve({ error: { code: '42501', status: 403, message: 'Not allowed' } }); }, 'Profile load');
  eq(calls, 1, 'Authorization denial is never retried');
  eq(denial.error.code, '42501', 'Authorization errors remain intact');
}
async function summaryChecks() {
  const calls = [], state = { user: { id: 'rider-a' }, sessionSetupVersion: 1, cache: {}, inFlight: new Map() };
  let release, held = false;
  const context = vm.createContext({ state, Date, Promise, Map, Set, Error, String, Number, client: { rpc(name) {
    const call = { name }; calls.push(call);
    const query = { select(fields) { call.fields = fields; return query; }, then(resolve, reject) {
      const data = { data: [{ athlete_id: 'rider-a', weekly_points: 12.5 }] };
      return (held ? new Promise(done => { release = () => done(data); }) : Promise.resolve(data)).then(resolve, reject);
    } };
    return query;
  }, from() { throw Error('Lean scores must not read profile extras'); } }, retryNetworkRequest: async factory => factory() });
  vm.runInContext(['cacheGet', 'cacheSet', 'getAthleteHomeVerifiedLeaderboard'].map(extract).join('\n'), context);
  const first = context.getAthleteHomeVerifiedLeaderboard(), second = context.getAthleteHomeVerifiedLeaderboard();
  await Promise.all([first, second]);
  eq(calls.length, 1, 'Home and training share one pending summary request');
  eq(calls[0], { name: 'get_weekly_leaderboard_with_half_points', fields: 'athlete_id,weekly_points' }, 'Only IDs and verified scores are requested; photos are excluded');
  await context.getAthleteHomeVerifiedLeaderboard();
  eq(calls.length, 1, 'Recently verified scores are reused');
  await context.getAthleteHomeVerifiedLeaderboard({ force: true });
  eq(calls.length, 2, 'A saved point refreshes its total instead of reusing the old cache');
  held = true;
  const stale = context.getAthleteHomeVerifiedLeaderboard({ force: true });
  await new Promise(resolve => setImmediate(resolve));
  state.sessionSetupVersion++;
  release();
  await assert.rejects(stale, /account access changed/); checks++;
  eq(context.cacheGet('leaderboard:summary:rider-a:verified'), null, 'Reapproval/account epochs invalidate even the same rider ID');
}
async function sdkChecks() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  try {
    const page = await browser.newPage({ serviceWorkers: 'block' });
    const requests = [];
    await page.route('**/*', route => {
      if (route.request().url() === 'https://jkcrew.test/') return route.fulfill({ contentType: 'text/html', body: '<main></main>' });
      const request = route.request(); requests.push({ method: request.method(), url: request.url() });
      return route.fulfill({ status: request.method() === 'GET' ? 503 : 500, contentType: 'application/json', body: JSON.stringify({ code: 'FIXTURE_FAILURE', message: 'Synthetic unavailable' }) });
    });
    await page.goto('https://jkcrew.test/');
    await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'vendor/supabase-2.116.0.min.js'), 'utf8') });
    await page.addScriptTag({ content: source.slice(0, source.indexOf('\nconst app =')) });
    await page.evaluate(async () => { await client.from('profiles').select('id'); });
    await page.waitForTimeout(150);
    eq(requests.filter(row => row.method === 'GET').length, 1, 'The shipped SDK does not secretly retry a failed read');
    await page.evaluate(async () => { await client.rpc('record_assignment_progress', { p_assignment_id: 'synthetic' }); });
    await page.waitForTimeout(150);
    eq(requests.filter(row => row.method === 'POST').length, 1, 'A failed points write is not retried automatically');
    eq(requests.length, 2, 'No other auth, profile or background traffic was generated');
  } finally { await browser.close(); }
}
(async () => { await retryChecks(); await summaryChecks(); await sdkChecks(); console.log(`PASS: ${checks} startup read-budget checks; real SDK retry ownership, aborted requests, no overlap, bounded jitter, lean summary reuse and stale-account denial. No production traffic.`); })().catch(error => { console.error(error); process.exitCode = 1; });
