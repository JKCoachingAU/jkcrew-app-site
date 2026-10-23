// Full shipped index, real auth flow and recovery module. HTTP responses and
// identities are synthetic; no production accounts or health records are used.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const riderId = '11111111-1111-4111-8111-111111111111';
const episodeId = '44444444-4444-4444-8444-444444444444';
const email = 'recovery-fixture@example.test';
const profile = { id: riderId, email, display_name: 'Recovery Test Rider', role: 'athlete', app_theme: 'dark', country_code: 'AU', country_name: 'Australia', uci_id: '10000000001', xp_total: 45, level: 1, goals: [], rider_extra_tricks: [], achievements: [], badges: [], onboarding_completed_at: new Date().toISOString() };
const user = { id: riderId, aud: 'authenticated', role: 'authenticated', email, email_confirmed_at: new Date().toISOString(), app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: { display_name: profile.display_name }, identities: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
const symptomKeys = ['headache', 'dizziness', 'nausea', 'sensitivity', 'brain_fog', 'fatigue', 'balance', 'neck_pain'];
function session() {
  const now = Math.floor(Date.now() / 1000), encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({ sub: riderId, aud: 'authenticated', role: 'authenticated', email, iat: now, exp: now + 3600, iss: 'https://soanwttlorlgdfrzbvtp.supabase.co/auth/v1', session_id: '22222222-2222-4222-8222-222222222222' }) + '.isolated-fixture-signature';
  return { access_token: token, refresh_token: 'isolated-refresh', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, user };
}
(async () => {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { response.writeHead(404); return response.end(); }
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
    response.writeHead(200, { 'content-type': type }); response.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH });
  let checks = 0;
  const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
  const ok = (value, message) => { assert(value, message); checks++; };
  const errors = [], unexpected = [], backendRequests = [], rankingRequests = [], saveRequests = [], stored = new Map();
  let failSaveResponseOnce = true;
  const info = () => ({ athlete_id: riderId, recovery_mode: true, can_manage: false, can_checkin: true, today_date: '2026-10-21', timezone: 'Australia/Brisbane',
    episode: { id: episodeId, athlete_id: riderId, title: 'Return to riding', plan_text: '', clinician_approved: true, clinician_name: '', plan_version: 1, started_at: '2026-10-21T00:00:00Z' },
    episodes: [], checkins: [...stored.values()], has_more: false, next_before_date: null });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const headers = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-expose-headers': 'Content-Range', 'content-range': '*/0' };
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.hostname === 'raw.githubusercontent.com' && url.pathname.includes('uci-rankings')) rankingRequests.push(url.href);
      if (url.origin === origin) return route.continue();
      if (url.hostname !== 'soanwttlorlgdfrzbvtp.supabase.co') return route.abort();
      const json = (value, status = 200) => route.fulfill({ status, headers, body: request.method() === 'HEAD' ? '' : JSON.stringify(value) }).catch(() => {});
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (url.pathname === '/auth/v1/token') return json(session());
      if (url.pathname === '/auth/v1/user') return json(user);
      if (url.pathname === '/auth/v1/logout') return json({});
      if (!url.pathname.startsWith('/rest/v1/')) { unexpected.push(url.pathname); return route.abort(); }
      const name = url.pathname.slice('/rest/v1/'.length); backendRequests.push(name);
      if (name === 'profiles') return json([profile]);
      if (name === 'rpc/ensure_current_profile') return json(profile);
      if (name === 'rpc/get_rider_feature_access') return json([{ athlete_id: riderId, features_disabled: false, recovery_mode: true, recovery_episode_id: episodeId }]);
      if (name === 'rpc/record_my_app_open') return json(null);
      if (name === 'rpc/get_rider_recovery') {
        eq(request.postDataJSON().p_athlete_id, riderId, 'Recovery read targets only the signed-in rider');
        return json(info());
      }
      if (name === 'rpc/save_recovery_checkin') {
        const args = request.postDataJSON(); saveRequests.push(args);
        eq(args.p_episode_id, episodeId, 'Check-in save targets the current recovery episode');
        if (!stored.has(args.p_request_id)) stored.set(args.p_request_id, {
          id: '55555555-5555-4555-8555-555555555555', episode_id: episodeId, athlete_id: riderId,
          checkin_date: args.p_checkin_date, ratings: args.p_ratings, sleep: args.p_sleep, notes: args.p_notes,
          version: 1, created_at: '2026-10-21T05:00:00Z', updated_at: '2026-10-21T05:00:00Z',
        });
        // Simulate an acknowledged database write whose HTTP response was lost.
        if (failSaveResponseOnce) { failSaveResponseOnce = false; return json({ code: 'PGRST002', message: 'Synthetic response interrupted' }, 503); }
        return json(info());
      }
      unexpected.push(name); return json({ message: 'Unexpected synthetic endpoint' }, 500);
    });
    await context.routeWebSocket('**', socket => { unexpected.push('websocket'); socket.close(); });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/?push=contests', { waitUntil: 'domcontentloaded' });
    await page.locator('#auth-form').waitFor();
    await page.locator('#email').fill(email); await page.locator('#password').fill('isolated-fixture-password');
    await page.getByRole('button', { name: 'Enter JKCREW', exact: true }).click();
    await page.locator('[data-recovery-checkin-form]').waitFor();
    await page.waitForFunction(() => !document.querySelector('#app').inert);
    eq(await page.evaluate(() => state.view), 'home', 'A contest push deep link opens recovery instead of training after login');
    eq(await page.locator('.recovery-shell').count(), 1, 'Real shipped page renders the recovery shell');
    eq(await page.locator('#notification-centre-bell, [data-view="session"], [data-view="challenges"], [data-view="contests"], .athlete-scoreboard, #live-run-invites').count(), 0, 'No ordinary training screens, nav, scoreboards or invitations appear');
    eq(await page.locator('.home-uci-card, [data-leader-uci], [data-recovery-toggle], [data-recovery-edit-plan]').count(), 0, 'A UCI-linked recovering rider sees neither ranking cards nor coach-only recovery controls');
    eq(await page.locator('.recovery-nav button').allTextContents(), ['Check-in', 'History', 'My plan', 'Support'], 'Recovery presents exactly the four intended areas');
    eq(await page.locator('[data-recovery-number]').evaluateAll(inputs => inputs.map(input => input.value)), Array(8).fill(''), 'New symptom ratings start unanswered, not as fabricated zeros');
    eq(await page.locator('input[name="recovery-sleep"]:checked').count(), 0, 'Sleep has no implicit answer');
    await page.getByRole('button', { name: 'Save check-in', exact: true }).click();
    eq(saveRequests.length, 0, 'Incomplete check-ins are validated without a write');
    ok((await page.locator('[role="alert"]').innerText()).includes('Rate all eight symptoms'), 'Incomplete form explains the missing answers');

    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `Check-in has no horizontal overflow at ${width}px`);
      ok(await page.locator('[data-recovery-page]').evaluateAll(buttons => buttons.every(button => button.getBoundingClientRect().height >= 40)), `Recovery tabs retain usable tap targets at ${width}px`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [index, key] of symptomKeys.entries()) await page.locator(`[data-recovery-number="${key}"]`).fill(String(index % 3));
    await page.locator('input[name="recovery-sleep"][value="normal"]').check();
    await page.locator('#recovery-notes').fill('Synthetic check-in note for test only.');
    eq(await page.locator('[data-recovery-total]').innerText(), '7 /80', 'Symptom total is computed from explicit answers');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: '/tmp/jkcrew-recovery-mobile.png', fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: 'Save check-in', exact: true }).click();
    await page.locator('[data-recovery-retry]').waitFor();
    eq(saveRequests.length, 1, 'One tap produces one save request');
    eq(await page.locator('#recovery-notes').inputValue(), 'Synthetic check-in note for test only.', 'Unconfirmed save preserves the rider note');
    await page.locator('[data-recovery-retry]').click();
    await page.getByRole('heading', { name: 'Check-in saved', exact: true }).waitFor();
    eq(saveRequests.length, 2, 'Retry confirms the uncertain save');
    eq(saveRequests[0].p_request_id, saveRequests[1].p_request_id, 'Retry reuses the idempotency key');
    eq(stored.size, 1, 'The synthetic server contains one saved check-in after retry');
    eq(await page.locator('.recovery-record').getByText('Synthetic check-in note for test only.', { exact: true }).count(), 1, 'Saved note is confirmed visibly');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Check-in saved', exact: true }).waitFor();
    eq(await page.locator('#auth-form').count(), 0, 'Reload reuses the signed-in session');
    eq(await page.locator('.recovery-record').getByText('Synthetic check-in note for test only.', { exact: true }).count(), 1, 'Saved recovery check-in survives a full page reload');
    eq(await page.locator('.recovery-record .recovery-total strong').innerText(), '7 /80', 'Persisted ratings are displayed correctly after reload');
    const privateStorage = await page.evaluate(async ({ episodeId, note }) => {
      const needles = [episodeId, note, '"headache"', '"brain_fog"', '"ratings"'];
      const containsHealth = value => needles.some(needle => String(value).includes(needle));
      const persisted = [];
      for (const [name, storage] of [['localStorage', localStorage], ['sessionStorage', sessionStorage]]) {
        for (let index = 0; index < storage.length; index++) {
          const key = storage.key(index);
          if (containsHealth(key) || containsHealth(storage.getItem(key))) persisted.push(name + ':' + key);
        }
      }
      const cachedRequests = [];
      for (const cacheName of await caches.keys()) {
        const cache = await caches.open(cacheName);
        for (const request of await cache.keys()) if (/get_rider_recovery|save_recovery_checkin|recovery_episodes|recovery_checkins/.test(request.url)) cachedRequests.push(request.url);
      }
      return { persisted, cachedRequests, appCacheHasHealth: containsHealth(JSON.stringify(state.cache || {})) };
    }, { episodeId, note: 'Synthetic check-in note for test only.' });
    eq(privateStorage.persisted, [], 'Symptom answers, notes and episode identity are not persisted in browser storage');
    eq(privateStorage.cachedRequests, [], 'Recovery API responses are not copied into Cache Storage');
    eq(privateStorage.appCacheHasHealth, false, 'Health records do not enter the generic application cache');
    for (const view of ['history', 'plan', 'support', 'today']) {
      await page.locator(`[data-recovery-page="${view}"]`).first().click();
      for (const width of [320, 390, 768]) {
        await page.setViewportSize({ width, height: 844 });
        ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${view} has no horizontal overflow at ${width}px`);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `/tmp/jkcrew-recovery-${view}-mobile.png`, fullPage: true, animations: 'disabled' });
    }
    await page.locator('[data-recovery-page="plan"]').click();
    ok((await page.locator('[data-recovery-root]').textContent()).includes('Plan details to be added'), 'Unprovided clinical instructions are not invented');
    ok((await page.locator('[data-recovery-root]').textContent()).includes('Clinician approval recorded by your coach.'), 'Recorded clinician approval is shown without inventing the missing plan');
    eq(rankingRequests, [], 'Recovery mode downloads no optional public UCI ranking feed');
    eq(backendRequests.filter(name => !['profiles', 'rpc/ensure_current_profile', 'rpc/get_rider_feature_access', 'rpc/record_my_app_open', 'rpc/get_rider_recovery', 'rpc/save_recovery_checkin'].includes(name)), [], 'Recovery issues only profile, access, activity and recovery requests');
    eq(unexpected, [], 'No ordinary training/realtime endpoint or unexpected backend request');
    eq(errors, [], 'Full shipped page has no runtime exceptions');
    await context.close();
    console.log(`PASS ${checks} full-page recovery checks; screenshot /tmp/jkcrew-recovery-mobile.png. No production traffic.`);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
