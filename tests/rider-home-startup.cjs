// Full shipped page and actual Home renderer, with synthetic HTTP/auth responses only.
// Stalls, failures and delayed replies never contact production or mutate rider data.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const profileSelect = source.match(/^const PROFILE_SELECT = "([^"]+)";/m)[1];
const riderId = '11111111-1111-4111-8111-111111111111';
const email = 'home-fixture@example.test';
const profile = { id: riderId, email, display_name: 'Home Test Rider', role: 'athlete', app_theme: 'dark', country_code: 'AU', country_name: 'Australia', xp_total: 45, level: 1, goals: [], rider_extra_tricks: [], achievements: [], badges: [], onboarding_completed_at: new Date().toISOString() };
const user = { id: riderId, aud: 'authenticated', role: 'authenticated', email, email_confirmed_at: new Date().toISOString(), app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: { display_name: profile.display_name }, identities: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
const activeSession = { id: '33333333-3333-4333-8333-333333333333', athlete_id: riderId, started_at: new Date().toISOString(), ended_at: null, total_points: 12, daily_completed_seconds: null, daily_completed_at: null, daily_venue: 'Test park' };
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
  const browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  let checks = 0;
  const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
  const ok = (value, message) => { assert(value, message); checks++; };
  async function scenario(initial = {}) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const controls = { rankings: 'ok', battles: 'ok', active: 'ok', week: 'ok', milestones: 'ok', ...initial };
    const held = new Map(), counts = {}, errors = [], unexpected = [];
    const headers = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-expose-headers': 'Content-Range', 'content-range': '*/0' };
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === origin) return route.continue();
      if (url.hostname !== 'soanwttlorlgdfrzbvtp.supabase.co') return route.abort();
      const json = (value, status = 200) => route.fulfill({ status, headers, body: request.method() === 'HEAD' ? '' : JSON.stringify(value) }).catch(() => {});
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (url.pathname === '/auth/v1/token') return json(session());
      if (url.pathname === '/auth/v1/user') return json(user);
      if (url.pathname === '/auth/v1/logout') return json({});
      if (!url.pathname.startsWith('/rest/v1/')) { unexpected.push(url.pathname); return route.abort(); }
      const name = url.pathname.slice('/rest/v1/'.length);
      if (name === 'profiles' && url.searchParams.get('select') === profileSelect) return json([profile]);
      if (name === 'rpc/get_rider_feature_access') return json([{ athlete_id: riderId, features_disabled: false }]);
      if (name === 'rpc/ensure_current_profile') return json(profile);
      if (name === 'profiles') return json([profile]);
      const keys = { 'rpc/get_weekly_leaderboard': 'rankings', 'rpc/get_my_rider_battles': 'battles', 'rpc/get_effective_weekly_assignments': 'week', 'rpc/get_my_progress_milestones': 'milestones' };
      const key = keys[name] || (name === 'training_sessions' && url.searchParams.get('ended_at') === 'is.null' ? 'active' : '');
      if (key) {
        counts[key] = (counts[key] || 0) + 1;
        let mode = controls[key];
        if (mode === 'stall') mode = await new Promise(resolve => { const pending = held.get(key) || []; pending.push(resolve); held.set(key, pending); });
        if (mode === 'fail') return json({ code: 'PGRST002', message: 'Synthetic temporary ' + key + ' failure' }, 503);
        if (key === 'rankings') return json([{ athlete_id: riderId, display_name: profile.display_name, weekly_points: 7, xp_total: 45, level: 1 }]);
        if (key === 'battles') return json([{ id: 'test-battle', status: 'completed', participants: [{ athlete_id: riderId, is_winner: true }] }]);
        if (key === 'active') return json(mode === 'session' ? [activeSession] : mode === 'completed' ? [{ ...activeSession, daily_completed_seconds: 60 }] : []);
        if (key === 'milestones') return json({});
      }
      return json([]);
    });
    await context.routeWebSocket('**', socket => socket.onMessage(message => {
      try { const frame = JSON.parse(String(message)); if (Array.isArray(frame) && ['phx_join', 'heartbeat'].includes(frame[3])) socket.send(JSON.stringify([frame[0], frame[1], frame[2], 'phx_reply', { status: 'ok', response: { postgres_changes: [] } }])); } catch {}
    }));
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin, { waitUntil: 'domcontentloaded' }); await page.locator('#auth-form').waitFor();
    await page.evaluate(id => { localStorage.setItem(`jkcrew-whats-new:${id}:${WHATS_NEW_RELEASE_ID}`, '1'); localStorage.setItem(`jkcrew-battle-intro:${id}:v3`, '1'); localStorage.setItem(`jkcrew-push-setup-shown:${id}:v2`, '1'); }, riderId);
    await page.locator('#email').fill(email); await page.locator('#password').fill('isolated-fixture-password');
    const started = Date.now(); await page.getByRole('button', { name: 'Enter JKCREW', exact: true }).click();
    await page.locator('.athlete-scoreboard').waitFor(); await page.waitForFunction(() => !document.querySelector('#app').inert);
    const startupMs = Date.now() - started;
    const release = (key, mode = 'ok') => { const pending = held.get(key) || []; held.delete(key); pending.forEach(resolve => resolve(mode)); };
    const close = async () => { eq(errors, [], 'No browser exceptions'); eq(unexpected, [], 'No unexpected backend endpoints'); for (const key of held.keys()) release(key); await context.close(); };
    return { page, context, controls, held, counts, errors, release, close, startupMs };
  }
  try {
    {
      const t = await scenario({ rankings: 'stall', active: 'stall' }), page = t.page;
      ok(t.startupMs < 3500, 'Home is usable before stalled optional requests settle');
      eq(await page.locator('.athlete-scoreboard h1').textContent(), profile.display_name);
      eq(await page.locator('.score-ranking-stat .stat-value').nth(0).textContent(), '—', 'Pending points are unknown, not fabricated zero');
      await page.waitForFunction(() => document.querySelector('.battle-ranking-stat .stat-value')?.textContent.includes('1W'));
      ok((await page.locator('.xp-title').textContent()).includes('45 XP'), 'Persisted XP renders immediately');
      eq(await page.locator('#goal-form').count(), 0, 'Goals no longer take space on Home');
      eq(await page.locator('#athlete-home-week, #athlete-home-trick-requests').count(), 0, 'Removed Home panels are absent');
      eq(await page.locator('[data-open-shred-zone]').count(), 1, 'Shred Zone replaces Garage on Home');
      eq(await page.locator('#open-home-run-builder').count(), 1);
      eq(await page.locator('#open-athlete-coaching').count(), 1);
      await page.evaluate(() => { window.actionCalls = []; navigate = view => window.actionCalls.push(view); openRunBuilder = () => window.actionCalls.push('run'); });
      await page.locator('#open-home-run-builder').click(); await page.locator('#open-athlete-coaching').click(); await page.locator('[data-open-shred-zone]').click();
      eq(await page.evaluate(() => actionCalls), ['run', 'coaching', 'shredZone'], 'Immediate primary action callbacks remain connected');
      await page.locator('[data-home-retry="rankings"]').waitFor(); await page.locator('[data-home-retry="active-session"]').waitFor();
      eq(await page.locator('.score-ranking-stat .stat-value').nth(0).textContent(), '—', 'Timed out scores stay unknown');
      eq(await page.locator('.view-error').count(), 0, 'Timeout does not replace Home with whole-screen error');
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: '/tmp/jkcrew-home-rankings-unavailable-mobile.png', fullPage: true });
      t.controls.rankings = 'ok'; t.controls.active = 'session';
      await page.locator('[data-home-retry="rankings"]').click(); await page.locator('[data-home-retry="active-session"]').click();
      await page.waitForFunction(() => document.querySelector('.score-ranking-stat .stat-value')?.textContent === '7pts');
      await page.locator('#trick-timer').waitFor();
      ok(await page.evaluate(() => !!state.timer), 'Retry restores the current session timer');
      eq(await page.evaluate(() => state.activeTraining.total_points), 12);
      eq(await page.locator('[data-home-retry="rankings"]').count(), 0);
      const expected = await page.evaluate(() => state.activeTraining.id);
      t.release('rankings', 'fail'); t.release('active', 'completed');
      await page.waitForTimeout(100);
      eq(await page.evaluate(() => state.activeTraining.id), expected, 'Original timed-out request cannot replace retried current session');
      eq(await page.evaluate(() => state.activeTraining.daily_completed_seconds), null);
      await t.close();
    }
    {
      const t = await scenario({ rankings: 'fail', active: 'fail', week: 'stall' }), page = t.page;
      await page.locator('[data-home-retry="rankings"]').waitFor(); await page.locator('[data-home-retry="active-session"]').waitFor();
      eq(await page.locator('.score-ranking-stat .stat-value').nth(0).textContent(), '—');
      await page.locator('#rider-proposal-form').waitFor({ state: 'attached' });
      eq(t.counts.week || 0, 0, 'Home no longer fetches the removed weekly summary');
      eq(await page.locator('.battle-ranking-stat .stat-value').textContent(), '1W — 0L');
      await page.locator('#toggle-rider-proposal').click(); await page.locator('#proposal-title').fill('Keep this unsaved request');
      t.controls.rankings = 'ok'; await page.locator('[data-home-retry="rankings"]').click();
      await page.waitForFunction(() => document.querySelector('.score-ranking-stat .stat-value')?.textContent === '7pts');
      eq(await page.locator('#proposal-title').inputValue(), 'Keep this unsaved request', 'Section retry preserves unrelated form edits');
      t.controls.active = 'completed'; await page.locator('[data-home-retry="active-session"]').click(); await page.locator('#trick-timer').waitFor();
      eq(await page.evaluate(() => state.timer), null, 'Completed Daily session shows saved timer without running interval');
      await t.close();
    }
    {
      const t = await scenario(), page = t.page;
      await page.waitForFunction(() => document.querySelector('.score-ranking-stat .stat-value')?.textContent === '7pts');
      await page.locator('#rider-proposal-form').waitFor({ state: 'attached' });
      eq(await page.locator('#trick-request-form').count(), 0, 'Single trick requests removed from Home');
      ok(await page.evaluate(() => Boolean(document.querySelector('[data-open-shred-zone]').compareDocumentPosition(document.querySelector('#athlete-home-proposals')) & Node.DOCUMENT_POSITION_FOLLOWING)), 'Shred Zone appears above retained weekly list requests');
      eq(await page.locator('#athlete-home-active-session').textContent(), '', 'Verified no active session omits timer');
      eq(await page.evaluate(() => state.activeTraining), null);
      eq(await page.locator('.score-ranking-stat .stat-value').nth(1).textContent(), '#1');
      eq(await page.locator('.xp-title').textContent(), 'Level 145 XP');
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(50);
      await page.screenshot({ path: '/tmp/jkcrew-home-loaded-mobile.png', fullPage: true });
      await t.close();
    }
    for (const invalidation of ['account', 'signout', 'navigation', 'token', 'version', 'disabled', 'unknown', 'replaced-view']) {
      const t = await scenario({ rankings: 'stall', active: 'stall', milestones: 'stall' }), page = t.page;
      await page.waitForFunction(() => document.querySelector('.battle-ranking-stat .stat-value')?.textContent.includes('1W'));
      await page.evaluate(mode => {
        if (mode === 'account') state.user = { id: 'another-rider' };
        if (mode === 'signout') state.user = null;
        if (mode === 'navigation') state.view = 'session';
        if (mode === 'token') state.loadingOverlayToken++;
        if (mode === 'version') state.athleteHomeRenderVersion++;
        if (mode === 'disabled') state.riderAccess = { athlete_id: state.user.id, features_disabled: true };
        if (mode === 'unknown') state.riderAccess = null;
        if (mode === 'replaced-view') { const replacement = document.createElement('div'); replacement.id = 'view'; document.querySelector('#view').replaceWith(replacement); }
        state.activeTraining = { id: 'newer-context' };
        document.querySelector('#view').innerHTML = '<div id="new-context">New context</div>';
      }, invalidation);
      t.release('rankings'); t.release('active', 'session'); t.release('milestones');
      await page.waitForTimeout(150);
      eq(await page.locator('#new-context').textContent(), 'New context', 'Late data cannot paint after ' + invalidation);
      eq(await page.evaluate(() => state.activeTraining.id), 'newer-context', 'Late session cannot mutate state after ' + invalidation);
      eq(await page.evaluate(() => state.timer), null, 'Late session cannot start timer after ' + invalidation);
      await t.close();
    }
    {
      const t = await scenario({ active: 'session' }), page = t.page;
      await page.locator('#trick-timer').waitFor();
      await page.evaluate(() => {
        window.oldTimer = state.timer; state.view = 'session';
        window.nextTimer = setInterval(() => {}, 10000); state.timer = window.nextTimer;
      });
      await page.waitForTimeout(1100);
      eq(await page.evaluate(() => state.timer === window.nextTimer), true, 'Stale Home timer does not clear a newer page timer');
      await t.close();
    }
    console.log('PASS: ' + checks + ' full-page rider Home startup, independent failure/timeout/retry, primary actions, timer, secondary form preservation and stale-access/account checks. No production traffic.');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
