// Fifteen real, isolated browser clients use the shipped page and SDK together.
// All Auth/Data/Storage traffic is intercepted. No production account or data
// is used. A shared bounded API models contention; optional services can stall.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const revision = process.env.JKCREW_BURST_APP_REVISION || '';
assert(!revision || /^(?:HEAD|[a-f0-9]{7,40})$/.test(revision), 'Baseline revision must be HEAD or a commit hash');
const appSource = revision ? execFileSync('git', ['show', revision + ':app.js'], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }) : fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const profileSelect = appSource.match(/^const PROFILE_SELECT = "([^"]+)";/m)[1];
const whatsNew = appSource.match(/^const WHATS_NEW_RELEASE_ID = "([^"]+)";/m)[1];
const baseline = process.env.JKCREW_BURST_BASELINE === '1';
const riderCount = Number(process.env.JKCREW_BURST_RIDERS || 15);
assert(riderCount >= 15 && riderCount <= 30, 'Exercise at least 15 clients, with a bounded maximum');
const uuid = (group, n) => `${String(group).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const today = () => new Date(Date.now() + 10 * 3600000).toISOString().slice(0, 10);
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)];
const timing = values => ({ p50: percentile(values, .5), p95: percentile(values, .95), max: Math.max(...values) });
const jsonHeaders = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-expose-headers': 'Content-Range', 'content-range': '*/0' };

function fixture(n) {
  const id = uuid(1, n), email = `burst-rider-${n}@example.test`, name = `Burst Rider ${n}`;
  const profile = { id, email, display_name: name, role: 'athlete', app_theme: 'dark', country_code: 'AU', country_name: 'Australia', goals: [], rider_extra_tricks: [], achievements: [], badges: [], onboarding_completed_at: new Date().toISOString(), uci_id: null };
  const user = { id, aud: 'authenticated', role: 'authenticated', email, email_confirmed_at: new Date().toISOString(), app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: { display_name: name }, identities: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  const assignments = ['MANUAL', 'BUNNY HOP', '180'].map((trick, index) => ({ id: uuid(2 + index, n), athlete_id: id, coach_id: uuid(9, 1), category: 'daily', venue: 'BURST TEST PARK', trick_name: `${name} ${trick}`, target_reps: 1, sort_order: index, week_start: '2026-11-16' }));
  const session = () => {
    const now = Math.floor(Date.now() / 1000), encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const token = encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({ sub: id, aud: 'authenticated', role: 'authenticated', email, iat: now, exp: now + 3600, iss: 'https://soanwttlorlgdfrzbvtp.supabase.co/auth/v1', session_id: uuid(8, n) }) + '.isolated-burst-fixture';
    return { access_token: token, refresh_token: 'isolated-burst-refresh-' + n, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, user };
  };
  return { n, id, email, name, profile, user, assignments, session, progress: [], active: null, calls: [], failures: [], errors: [], failedRequests: [], tickSaves: 0 };
}

class SharedBackend {
  constructor() { this.limit = 6; this.active = 0; this.maxActive = 0; this.queue = []; this.maxQueue = 0; this.arrived = new Set(); this.barrier = deferred(); this.optional = deferred(); this.optionalReleased = false; this.total = 0; this.aborted = new Set(); }
  arrive(rider) { this.arrived.add(rider.id); if (this.arrived.size === riderCount) this.barrier.resolve(); return this.barrier.promise; }
  async slot(request, delay = 80) {
    this.total++;
    await new Promise(resolve => { this.queue.push(resolve); this.maxQueue = Math.max(this.maxQueue, this.queue.length); this.pump(); });
    try { if (!this.aborted.has(request)) await sleep(delay); }
    finally { this.active--; this.pump(); }
  }
  pump() { while (this.active < this.limit && this.queue.length) { this.active++; this.maxActive = Math.max(this.maxActive, this.active); this.queue.shift()(); } }
  releaseOptional() { this.optionalReleased = true; this.optional.resolve(); }
}

(async () => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    const contentType = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
    if (url.pathname === '/app.js') { res.writeHead(200, { 'content-type': contentType }); return res.end(appSource); }
    res.writeHead(200, { 'content-type': contentType }); res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
  let checks = 0;
  const reports = [];
  const check = (condition, why) => { assert(condition, why); checks++; };
  const eq = (actual, expected, why) => { assert.deepEqual(actual, expected, why); checks++; };
  async function burst(mode) {
    const backend = new SharedBackend(), riders = Array.from({ length: riderCount }, (_, index) => fixture(index + 1));
    const contexts = [];
    let started = 0;
    try {
      await Promise.all(riders.map(async rider => {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' }); contexts.push(context); rider.context = context;
        await context.addInitScript(({ saved, session, id, whatsNew }) => {
          if (saved) localStorage.setItem('sb-soanwttlorlgdfrzbvtp-auth-token', JSON.stringify(session));
          localStorage.setItem(`jkcrew-whats-new:${id}:${whatsNew}`, '1');
          localStorage.setItem(`jkcrew-battle-intro:${id}:v3`, '1');
          localStorage.setItem(`jkcrew-push-setup-shown:${id}:v2`, '1');
        }, { saved: mode === 'saved-session', session: rider.session(), id: rider.id, whatsNew });
        context.on('requestfailed', request => { backend.aborted.add(request); const url = new URL(request.url()); rider.failedRequests.push({ api: url.hostname === 'soanwttlorlgdfrzbvtp.supabase.co', url: url.pathname, error: request.failure()?.errorText }); });
        await context.route('**/*', async route => {
          const request = route.request(), url = new URL(request.url());
          if (url.origin === origin) return route.continue();
          if (url.hostname !== 'soanwttlorlgdfrzbvtp.supabase.co') return route.abort();
          const json = (data, status = 200) => route.fulfill({ status, headers: jsonHeaders, body: request.method() === 'HEAD' ? '' : JSON.stringify(data) }).catch(() => {});
          if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: jsonHeaders });
          let body = {}; try { body = request.postDataJSON() || {}; } catch (_) {}
          const endpoint = url.pathname.replace(/^\/rest\/v1\//, '');
          if (url.pathname.startsWith('/rest/v1/') || url.pathname.startsWith('/functions/v1/')) {
            try {
              const token = request.headers().authorization?.replace(/^Bearer\s+/i, '') || '';
              const claims = JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64url').toString('utf8'));
              if (claims.sub !== rider.id) rider.failures.push('API authorization belongs to another rider');
            } catch (_) { rider.failures.push('Private API request has no rider session'); }
          }
          if (body.p_athlete_id && body.p_athlete_id !== rider.id) rider.failures.push('RPC used a foreign rider ID');
          const athleteFilter = url.searchParams.get('athlete_id');
          if (athleteFilter && athleteFilter !== 'eq.' + rider.id) rider.failures.push('Table query used a foreign rider filter');
          rider.calls.push({ endpoint, method: request.method(), at: Date.now(), body, criticalProfile: endpoint === 'profiles' && url.searchParams.get('select') === profileSelect });
          if (url.pathname === '/auth/v1/token') {
            if (body.email && body.email !== rider.email) rider.failures.push('Foreign sign-in identity');
            await backend.arrive(rider); await backend.slot(request, 100); return json(rider.session());
          }
          if (url.pathname === '/auth/v1/user') { await backend.slot(request); return json(rider.user); }
          if (url.pathname === '/auth/v1/logout') return json({});
          const isProfile = endpoint === 'profiles' && url.searchParams.get('select') === profileSelect;
          if (mode === 'saved-session' && isProfile) await backend.arrive(rider);
          // Optional services have their own simulated outage. They do not consume
          // the primary read pool; the screen must not wait for their replies.
          const optional = /leaderboard|park_king|rider_battles|app_notifications|board_chat|crew_posts|app_unread|health-whoop|milestones|coach_messages|broadcast|help_requests|progress_milestones/.test(endpoint + url.pathname);
          if (optional) {
            await backend.optional.promise;
            if (/health-whoop/.test(url.pathname)) return json({ provider: 'whoop', availability: 'not_configured', connection: 'disconnected', summary: null });
            if (/leaderboard/.test(endpoint)) return json([{ athlete_id: rider.id, display_name: rider.name, weekly_points: 7 }]);
            if (/park_king/.test(endpoint)) return json([]);
            if (/unread/.test(endpoint)) return json({});
            return json([]);
          }
          await backend.slot(request);
          if (isProfile) {
            const requestedId = url.searchParams.get('id');
            if (requestedId !== 'eq.' + rider.id) rider.failures.push('Profile read used foreign ID');
            // Three riders get one transient error during the coordinated burst.
            const count = rider.calls.filter(call => call.criticalProfile).length;
            if (rider.n % 5 === 0 && count === 1) return json({ code: '08006', message: 'Synthetic transient connection reset' }, 503);
            return json([rider.profile]);
          }
          if (endpoint === 'profiles') return json([rider.profile]);
          if (endpoint === 'rpc/ensure_current_profile') return json(rider.profile);
          if (endpoint === 'rpc/get_rider_feature_access') return json([{ athlete_id: rider.id, features_disabled: false }]);
          if (endpoint === 'rpc/ensure_current_week_assignments') return json(0);
          if (endpoint === 'rpc/get_effective_weekly_assignments') {
            if (body.p_athlete_id !== rider.id) rider.failures.push('Assignment read used foreign ID');
            return json(rider.assignments);
          }
          if (endpoint === 'assignment_progress') return json(rider.progress);
          if (endpoint === 'training_sessions') return json(rider.active ? [rider.active] : []);
          if (endpoint === 'coach_athletes') return json([{ athlete_id: rider.id, coach_id: uuid(9, 1) }]);
          if (endpoint === 'rpc/start_daily_tricks') {
            rider.active = { id: uuid(7, rider.n), athlete_id: rider.id, daily_venue: body.p_venue, started_at: new Date().toISOString(), ended_at: null, total_points: 0, daily_completed_seconds: null, daily_completed_at: null };
            return json(rider.active);
          }
          if (endpoint === 'rpc/record_daily_trick_action') {
            if (!rider.assignments.some(assignment => assignment.id === body.p_assignment_id)) rider.failures.push('Tick saved for a foreign assignment');
            rider.tickSaves++;
            rider.progress = [{ assignment_id: body.p_assignment_id, athlete_id: rider.id, progress_date: today(), streak_count: 1, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }];
            return json({ athlete_id: rider.id, assignment_id: body.p_assignment_id, category: 'daily', points_awarded: 0, message: 'Daily Trick saved', completion_candidate: null });
          }
          if (endpoint === 'rpc/get_daily_finish_results') return json([]);
          if (endpoint === 'rpc/record_my_app_open') return json(null);
          if (request.method() !== 'GET' && !endpoint.startsWith('rpc/')) rider.failures.push('Unexpected direct write: ' + endpoint);
          return json([]);
        });
        await context.routeWebSocket('**', socket => socket.onMessage(message => {
          try { const frame = JSON.parse(String(message)); if (Array.isArray(frame) && ['phx_join', 'heartbeat'].includes(frame[3])) socket.send(JSON.stringify([frame[0], frame[1], frame[2], 'phx_reply', { status: 'ok', response: { postgres_changes: [] } }])); } catch (_) {}
        }));
        rider.page = await context.newPage(); rider.page.setDefaultTimeout(12000);
        rider.page.on('pageerror', error => rider.errors.push(error.message));
      }));
      if (mode === 'sign-in') {
        await Promise.all(riders.map(async rider => {
          await rider.page.goto(origin, { waitUntil: 'domcontentloaded' });
          await rider.page.locator('#auth-form').waitFor();
          await rider.page.locator('#email').fill(rider.email);
          await rider.page.locator('#password').fill('isolated-burst-password');
        }));
        started = Date.now();
        await Promise.all(riders.map(rider => rider.page.evaluate(() => document.querySelector('#auth-form').requestSubmit())));
      } else {
        started = Date.now();
        void Promise.all(riders.map(rider => rider.page.goto(origin, { waitUntil: 'domcontentloaded' }))).catch(() => {});
      }
      await Promise.all(riders.map(async rider => {
        try {
          await rider.page.locator('.athlete-scoreboard').waitFor({ timeout: 12000 });
          await rider.page.waitForFunction(() => !document.querySelector('#app').inert, { timeout: 12000 });
          rider.homeMs = Date.now() - started;
          eq(await rider.page.locator('.athlete-scoreboard h1').textContent(), rider.name, 'Every Home displays the correct isolated rider');
          const score = await rider.page.locator('.score-ranking-stat .stat-value').first().textContent();
          eq(score, '—', 'Unavailable leaderboard does not fabricate zero points');
        } catch (error) { rider.homeError = String(error.message); }
      }));
      const homeApiRequests = riders.reduce((sum, rider) => sum + rider.calls.length, 0);
      const trainingStart = Date.now();
      await Promise.all(riders.map(async rider => {
        if (rider.homeError) return;
        try {
          await rider.page.locator('.bottom-nav [data-view="session"]').click();
          await rider.page.locator('#create-session').waitFor({ timeout: baseline ? 4500 : 10000 });
          await rider.page.waitForFunction(() => !document.querySelector('#app').inert, { timeout: 10000 });
          rider.trainingMs = Date.now() - trainingStart;
          eq(await rider.page.locator('[data-assignment-category="daily"][data-assignment-action="landed"]').count(), 3, 'All three real fixture Daily tricks load');
          check((await rider.page.locator('#view').textContent()).includes(rider.name + ' MANUAL'), 'Daily sheet uses the correct rider content');
        } catch (error) { rider.trainingError = String(error.message); }
      }));
      // Record the outage result before releasing nonessential services. Baseline
      // mode then continues so it can report eventual recovery as well.
      const beforeRelease = { homes: riders.filter(r => !r.homeError).length, training: riders.filter(r => !r.homeError && !r.trainingError).length };
      const trainingApiRequests = riders.reduce((sum, rider) => sum + rider.calls.length, 0);
      backend.releaseOptional();
      if (baseline) {
        await Promise.all(riders.filter(r => !r.homeError && r.trainingError).map(async rider => {
          try { await rider.page.locator('#create-session').waitFor({ timeout: 10000 }); delete rider.trainingError; } catch (_) {}
        }));
      }
      const actionStart = Date.now();
      await Promise.all(riders.map(async rider => {
        if (rider.homeError || rider.trainingError) return;
        try {
          await rider.page.locator('#create-session').click();
          await rider.page.locator('#trick-timer').waitFor();
          await rider.page.locator('[data-daily-venue] > summary').first().click();
          const button = rider.page.locator(`[data-assignment-id="${rider.assignments[0].id}"][data-assignment-action="landed"]`).first();
          await button.click();
          await rider.page.waitForFunction(id => document.querySelector(`[data-assignment-id="${id}"]`)?.classList.contains('complete'), rider.assignments[0].id);
          await rider.page.waitForFunction(() => !document.querySelector('#app').inert);
          await rider.page.waitForFunction(() => document.querySelector('#sync-status b')?.textContent === 'Saved');
          rider.actionMs = Date.now() - actionStart;
          eq(rider.tickSaves, 1, 'One real UI tap saves exactly one synthetic Daily tick');
          eq(rider.progress[0].athlete_id, rider.id, 'Saved progress belongs to the same rider');
          eq(rider.active.total_points, 0, 'One partial Daily trick does not mint a full-list point');
        } catch (error) { rider.actionError = String(error.message); }
      }));
      const report = {
        mode, riders: riderCount, optionalOutage: true, primaryConcurrencyLimit: backend.limit, maxPrimaryConcurrency: backend.maxActive, maxQueuedPrimary: backend.maxQueue,
        beforeOptionalRelease: beforeRelease, successes: riders.filter(r => !r.homeError && !r.trainingError && !r.actionError).length,
        homeMs: timing(riders.map(r => r.homeMs).filter(Number.isFinite)), trainingMs: timing(riders.map(r => r.trainingMs).filter(Number.isFinite)), actionMs: timing(riders.map(r => r.actionMs).filter(Number.isFinite)),
        primaryRequests: backend.total, homeApiRequests, trainingApiRequests, totalApiRequests: riders.reduce((sum, rider) => sum + rider.calls.length, 0),
        maxRequestsPerRider: Math.max(...riders.map(r => r.calls.length)),
        passwordGrants: riders.reduce((sum, rider) => sum + rider.calls.filter(call => call.endpoint === '/auth/v1/token').length, 0),
        maxProfileAttempts: Math.max(...riders.map(r => r.calls.filter(call => call.criticalProfile).length)),
        abortedApiRequests: riders.reduce((sum, rider) => sum + rider.failedRequests.filter(request => request.api).length, 0),
        errors: riders.filter(r => r.homeError || r.trainingError || r.actionError || r.errors.length || r.failures.length).map(r => ({ rider: r.n, home: r.homeError, training: r.trainingError, action: r.actionError, errors: r.errors, scope: r.failures })),
      };
      reports.push(report);
      console.log(JSON.stringify(report));
      if (process.env.JKCREW_BURST_REPORT) fs.writeFileSync(process.env.JKCREW_BURST_REPORT, JSON.stringify({ status: 'IN_PROGRESS', reports }, null, 2));
      if (!baseline) {
        eq(beforeRelease.homes, riderCount, `${mode}: all ${riderCount} start screens work before optional services recover`);
        eq(beforeRelease.training, riderCount, `${mode}: all ${riderCount} Daily sheets work before optional services recover`);
        eq(report.successes, riderCount, `${mode}: every rider can start and save a Daily trick`);
        eq(report.errors, [], `${mode}: no script, rendering, ownership or interaction errors`);
        check(report.homeMs.max < 12000, `${mode}: bounded Home startup`);
        check(report.trainingMs.max < 10000, `${mode}: bounded Daily startup`);
        eq(report.passwordGrants, mode === 'sign-in' ? riderCount : 0, 'No duplicate password grants under load');
        check(backend.maxActive <= backend.limit, 'The shared backend simulator never exceeds its configured capacity');
        check(report.maxProfileAttempts <= 2, 'Critical profile retries remain bounded during a synchronized transient failure');
      }
    } finally { backend.barrier.resolve(); backend.releaseOptional(); await Promise.all(contexts.map(context => context.close())); }
  }
  try {
    for (const mode of ['sign-in', 'saved-session']) await burst(mode);
    const output = { status: baseline ? 'BASELINE' : 'PASS', checks, productionRequests: 0, description: 'Actual shipped browser app; synthetic shared backend, not a production capacity benchmark', reports };
    if (process.env.JKCREW_BURST_REPORT) fs.writeFileSync(process.env.JKCREW_BURST_REPORT, JSON.stringify(output, null, 2));
    console.log(JSON.stringify(output));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
