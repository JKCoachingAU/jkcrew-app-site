// Real bundled Auth SDK, synthetic storage/tokens and intercepted fetch only.
// A stalled native fetch/body must not pin every later getSession() forever.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const start = source.indexOf('function createBoundedAuthFetch(');
const helper = source.slice(start, source.indexOf('\n}', start) + 2);
const base = 'https://soanwttlorlgdfrzbvtp.supabase.co';
const make = vm.runInNewContext(helper + '\ncreateBoundedAuthFetch', { SUPABASE_URL: base, URL, AbortController, DOMException, Response, Promise, setTimeout, clearTimeout });
let checks = 0;
const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const bounded = (promise, ms = 5000) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('SDK recovery did not finish')), ms); })]).finally(() => clearTimeout(timer));
};
async function transportChecks() {
  for (const address of [base + '/rest/v1/rpc/record_assignment_action', base + '/storage/v1/upload', 'https://other.example/auth/v1/token']) {
    const options = { method: 'POST', body: 'unchanged', signal: new AbortController().signal };
    const response = new Response('unchanged'); let calls = 0;
    const result = await make(async (input, init) => { calls++; eq(input, address, 'Passthrough preserves URL'); eq(init, options, 'Passthrough preserves write/upload options'); return response; }, 20)(address, options);
    eq(result, response, 'Non-Auth response is untouched'); eq(calls, 1, 'No write or upload retry added');
  }
  for (const status of [200, 400, 401, 500, 503, 204]) {
    const body = status === 204 ? null : JSON.stringify({ status }); let sent;
    const result = await make(async (_, init) => { sent = init; return new Response(body, { status, headers: { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' } }); }, 50)(base + '/auth/v1/token', { method: 'POST', body: 'original', headers: { test: 'same' } });
    eq(result.status, status, 'Auth HTTP classification is preserved');
    eq(result.headers.get('x-supabase-api-version'), '2024-01-01', 'Auth version header is preserved');
    eq(await result.text(), body || '', 'Auth body is preserved');
    eq(sent.body, 'original', 'Token request body is preserved');
    eq(sent.headers.test, 'same', 'Token request headers are preserved');
  }
  let calls = 0, nativeSignal;
  await assert.rejects(make(async (_, init) => { calls++; nativeSignal = init.signal; return new Promise(() => {}); }, 20)(base + '/auth/v1/token'), e => e.name === 'AbortError'); checks++;
  eq(calls, 1, 'A timed-out Auth fetch has no application retry'); eq(nativeSignal.aborted, true, 'Underlying Auth request is aborted');
  let bodySignal;
  await assert.rejects(make(async (_, init) => { bodySignal = init.signal; return { status: 200, statusText: '', headers: new Headers(), arrayBuffer: () => new Promise(() => {}) }; }, 20)(base + '/auth/v1/user'), e => e.name === 'AbortError'); checks++;
  eq(bodySignal.aborted, true, 'Deadline also aborts a body stalled after headers');
  const caller = new AbortController(); let cancelled;
  const pending = make(async (_, init) => { cancelled = init.signal; return new Promise(() => {}); }, 500)(base + '/auth/v1/user', { signal: caller.signal });
  caller.abort(); await assert.rejects(pending, e => e.name === 'AbortError'); checks++;
  eq(cancelled.aborted, true, 'Caller cancellation reaches Auth transport');
  calls = 0;
  await assert.rejects(make(async () => { calls++; }, 20)(base + '/auth/v1/user', { signal: caller.signal }), e => e.name === 'AbortError'); checks++;
  eq(calls, 0, 'Already-cancelled Auth request never starts');
}
async function sdkRecovery(mode) {
  const sdk = vm.createContext({ console, URL, URLSearchParams, Request, Response, Headers, fetch, AbortController, DOMException, TextEncoder, TextDecoder, setTimeout, clearTimeout, setInterval, clearInterval, atob, btoa, crypto: require('node:crypto').webcrypto, WebSocket: class { constructor() { throw Error('Realtime network is forbidden in this Auth fixture'); } } });
  vm.runInContext(fs.readFileSync(path.join(root, 'vendor/supabase-2.116.0.min.js'), 'utf8'), sdk);
  const { createClient } = sdk.supabase;
  const id = '00000000-0000-4000-8000-000000000001';
  const now = Math.floor(Date.now() / 1000);
  const token = exp => [Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'), Buffer.from(JSON.stringify({ sub: id, aud: 'authenticated', role: 'authenticated', iat: now - 7200, exp })).toString('base64url'), 'synthetic-only'].join('.');
  const storageKey = 'jkcrew-auth-deadline-' + mode;
  const old = { access_token: token(now - 3600), refresh_token: 'synthetic-old', expires_in: 3600, expires_at: now - 3600, token_type: 'bearer', user: { id, role: 'authenticated', aud: 'authenticated' } };
  const fresh = { ...old, access_token: token(now + 3600), refresh_token: 'synthetic-new', expires_at: now + 3600 };
  const values = new Map([[storageKey, JSON.stringify(old)]]);
  const storage = { getItem: k => values.get(k) || null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
  let calls = 0, timedOutSignal;
  const transport = make(async (url, init) => {
    assert(String(url).includes('/auth/v1/token?grant_type=refresh_token'), 'Only synthetic refresh requests are permitted');
    calls++;
    if (calls === 1) {
      timedOutSignal = init.signal;
      if (mode === 'headers') return new Promise(() => {});
      let stream;
      const response = new Response(new ReadableStream({ start(controller) { stream = controller; } }), { headers: { 'content-type': 'application/json' } });
      init.signal.addEventListener('abort', () => stream.error(init.signal.reason), { once: true });
      return response;
    }
    return new Response(JSON.stringify(fresh), { headers: { 'content-type': 'application/json' } });
  }, 25);
  const client = createClient(base, 'synthetic-publishable-key', { global: { fetch: transport }, auth: { storageKey, storage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false } });
  try {
    const one = client.auth.getSession(), two = client.auth.getSession(), three = client.auth.getSession();
    await pause(60);
    eq(timedOutSignal.aborted, true, mode + ': Auth request was cancelled at deadline');
    eq(JSON.parse(values.get(storageKey)).refresh_token, 'synthetic-old', mode + ': transient timeout keeps saved token');
    eq(calls, 1, mode + ': concurrent session readers share one pending refresh');
    const results = await bounded(Promise.all([one, two, three]));
    for (const result of results) { eq(result.error, null, mode + ': SDK recovers after transient failure'); eq(result.data.session.refresh_token, 'synthetic-new', mode + ': caller receives verified refresh response'); }
    eq(calls, 2, mode + ': only SDK-owned retry occurred');
    eq(JSON.parse(values.get(storageKey)).refresh_token, 'synthetic-new', mode + ': token rotation saved once');
    eq((await client.auth.getSession()).data.session.refresh_token, 'synthetic-new', mode + ': later session read no longer hangs');
    eq(calls, 2, mode + ': later session read causes no extra request');
  } finally { await client.auth.stopAutoRefresh(); }
}
(async () => { await transportChecks(); await sdkRecovery('headers'); await sdkRecovery('body'); console.log(`PASS: ${checks} Auth transport checks (actual SDK; synthetic network/storage only).`); })().catch(error => { console.error(error); process.exitCode = 1; });
