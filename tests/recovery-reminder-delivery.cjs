// Execute the production browser helpers, service worker handlers and Edge worker
// against synthetic devices only. No account, health record or real push is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const worker = stripTypeScriptTypes(fs.readFileSync(path.join(root, 'supabase/functions/send-jkcrew-push/index.ts'), 'utf8').replace(/^import .*;\n/gm, ''));
const extract = name => {
  const start = app.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert(start >= 0, `Production ${name} exists`);
  const source = app.slice(start);
  return source.slice(0, source.indexOf('\n}') + 2);
};
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
let checks = 0;
const eq = (a, b, message) => { assert.deepEqual(plain(a), plain(b), message); checks++; };
const ok = (condition, message) => { assert(condition, message); checks++; };
const rejects = async (fn, pattern, message) => { await assert.rejects(fn, pattern, message); checks++; };

function browserFixture(options = {}) {
  const calls = [], reads = [], writes = [], timeouts = [];
  const state = { user: { id: 'rider-a' }, profile: { role: 'athlete' }, view: 'home', recoveryMount: null };
  const sub = { endpoint: 'https://push.example.test/device-a', toJSON: () => ({ endpoint: sub.endpoint, keys: { p256dh: 'synthetic-key', auth: 'synthetic-auth' } }) };
  let existing = options.existing === false ? null : sub;
  const manager = {
    getSubscription: () => { calls.push('get-subscription'); return options.slowSubscription ? new Promise(() => {}) : Promise.resolve(existing); },
    subscribe: async () => { calls.push('subscribe'); existing = sub; return sub; },
  };
  const registration = { pushManager: manager };
  const Notification = { permission: options.permission || 'default', requestPermission() {
    calls.push('permission');
    return Promise.resolve(options.permissionResult || options.permission || 'granted').then(value => { Notification.permission = value; return value; });
  } };
  const serviceWorker = { ready: options.ready || Promise.resolve(registration), getRegistration: () => Promise.resolve(registration) };
  const context = vm.createContext({
    state, navigator: { serviceWorker, userAgent: 'Synthetic browser', platform: 'Test phone' }, Notification,
    window: { PushManager: function() {}, Notification, atob: value => Buffer.from(value, 'base64').toString('binary') },
    Uint8Array, Promise, Date, Error,
    PUSH_VAPID_PUBLIC_KEY: 'YWJj',
    setTimeout(fn, ms) { timeouts.push(ms); return setTimeout(fn, 10); }, clearTimeout,
    savePushPreferences: async () => calls.push('save-preferences'), notify: () => calls.push('notify'),
    client: { from(table) {
      calls.push(`table:${table}`);
      return {
        upsert(row, config) { writes.push({ table, row, config }); return Promise.resolve(options.writeError ? { error: new Error('Connection unavailable') } : {}); },
        select(columns) {
          const query = { table, columns, filters: [] }; reads.push(query);
          return { eq(key, value) { query.filters.push([key, value]); return this; }, maybeSingle() { return Promise.resolve(options.readError ? { error: new Error('Status unavailable') } : { data: { enabled: options.serverEnabled !== false } }); } };
        },
      };
    } },
  });
  if (options.unsupported) delete context.window.PushManager;
  const names = ['supportsPushNotifications', 'urlBase64ToUint8Array', 'withTimeout', 'getRecoveryDeviceNotificationState', 'enableRecoveryDeviceNotifications', 'enablePushNotifications'];
  vm.runInContext(names.map(extract).join('\n'), context);
  return { context, calls, reads, writes, state, Notification, timeouts };
}

const NOW = Date.parse('2026-10-29T08:05:00Z');
class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [NOW])); } static now() { return NOW; } }
const reminder = { id: 'reminder-a', recipient_id: 'rider-a', notification_type: 'recovery_checkin_reminder', title: 'Your daily check-in', body: 'Take a moment to complete today’s check-in in JKCREW.', url: './?push=home&checkin=today', payload: { view: 'home', recovery_page: 'today', episode_id: 'private-episode', checkin_date: '2026-10-29', symptoms: 'never-copy-payload-to-phone' } };
async function runWorker(options = {}) {
  const sends = [], validations = [], finishes = [], updates = [], lookups = [];
  const subscriptions = options.subscriptions || [{ id: 'device-a', endpoint: 'https://push.example.test/a', p256dh: 'fixture', auth: 'fixture' }];
  const queue = options.queue || [reminder];
  let handler;
  const client = {
    async rpc(name, args) {
      if (name === 'get_jkcrew_push_worker_config') return { data: { vapid_public_key: 'fixture', vapid_private_key: 'fixture' } };
      if (name === 'claim_jkcrew_push_notifications') return { data: queue };
      if (name === 'validate_jkcrew_recovery_push') {
        validations.push(args);
        if (options.validationError) return { error: new Error('Validation unavailable') };
        const data = options.validations?.[validations.length - 1] || options.validation || { eligible: true, expires_at: new Date(NOW + 45 * 60000).toISOString() };
        return { data };
      }
      if (name === 'finish_jkcrew_push_notification') { finishes.push(args); return {}; }
      throw new Error(`Unexpected RPC ${name}`);
    },
    from(table) {
      assert.equal(table, 'push_subscriptions');
      return {
        select(columns) { const lookup = { columns, filters: [] }; lookups.push(lookup); return { eq(key, value) { lookup.filters.push([key, value]); return this; }, async limit(value) { lookup.limit = value; return options.subscriptionError ? { error: new Error('Subscriptions unavailable') } : { data: subscriptions }; } }; },
        update(values) { return { async eq(key, value) { updates.push({ key, value, values }); return {}; } }; },
      };
    },
  };
  const context = vm.createContext({
    Deno: { env: { get: name => ({ SUPABASE_URL: 'https://db.example.test', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key' }[name]) }, serve: fn => { handler = fn; } },
    createClient: () => client,
    webpush: { setVapidDetails() {}, async sendNotification(subscription, payload, config) { if (options.sendError) throw options.sendError; sends.push({ subscription, payload: JSON.parse(payload), config }); } },
    Request, Response, URL, Date: ClockDate, Error, console: { error() {} },
  });
  vm.runInContext(worker, context);
  const response = await handler(new Request('https://db.example.test/functions/v1/send-jkcrew-push', { method: 'POST', headers: { 'x-push-worker-secret': 'synthetic-worker-secret' } }));
  return { status: response.status, result: await response.json(), sends, validations, finishes, updates, lookups };
}

async function workerNavigationTests() {
  const listeners = {}, shown = [], posts = [], opened = [];
  let existing = true, focused = 0, closed = 0;
  const context = vm.createContext({ URL, self: {
    location: { origin: 'https://app.example.test' },
    registration: { scope: 'https://app.example.test/jkcrew/', showNotification: async (title, options) => shown.push({ title, options }) },
    addEventListener: (event, handler) => { listeners[event] = handler; },
    clients: { matchAll: async () => existing ? [{ url: 'https://app.example.test/jkcrew/', focus: async () => focused++, postMessage: message => posts.push(message) }] : [], openWindow: async url => opened.push(url) },
  } });
  vm.runInContext(sw, context);
  let done;
  const payload = { ...reminder, type: reminder.notification_type, view: 'home', notificationId: 'notification-a' };
  listeners.push({ data: { json: () => payload }, waitUntil: p => { done = p; } }); await done;
  eq(shown[0].options.data, { url: './?push=home&checkin=today', view: 'home', recoveryPage: 'today' }, 'Notification tap carries the check-in destination');
  const event = { notification: { data: shown[0].options.data, close: () => closed++ }, waitUntil: p => { done = p; } };
  listeners.notificationclick(event); await done;
  eq(posts, [{ type: 'JKCREW_PUSH_NAVIGATE', view: 'home', recoveryPage: 'today' }], 'Already open app receives explicit check-in request');
  eq(focused, 1, 'Existing app is focused');
  existing = false; listeners.notificationclick(event); await done;
  eq(opened, ['https://app.example.test/jkcrew/?push=home&checkin=today'], 'Closed app opens a URL selecting today’s check-in');
  eq(closed, 2, 'Tapped notifications are closed');

  const code = app.slice(app.lastIndexOf('if ("serviceWorker" in navigator) {'));
  let listener, showToday = 0, navigations = [];
  const state = { profile: { role: 'athlete' }, view: 'home', recoveryMount: { showToday() { showToday++; } } };
  const navContext = vm.createContext({ state, navigator: { serviceWorker: { addEventListener: (_event, fn) => { listener = fn; } } }, isCoachRole: () => false, riderRecoveryActive: () => true, navigate: view => navigations.push(view) });
  vm.runInContext(code, navContext);
  listener({ data: posts[0] });
  eq(showToday, 1, 'Reminder opens today within existing recovery mount');
  eq(navigations, [], 'Existing check-in draft is not destroyed by navigation');
  state.recoveryMount = null; state.view = 'plan'; listener({ data: posts[0] });
  eq(state.recoveryOpenCheckin, true, 'A later mount receives the explicit today destination');
  eq(navigations, ['home'], 'New recovery mount navigates home');
}

(async () => {
  const fresh = browserFixture({ existing: false });
  const attempt = fresh.context.enableRecoveryDeviceNotifications();
  eq(fresh.calls, ['permission'], 'The browser permission request happens synchronously within the tap');
  eq(await attempt, { supported: true, enabled: true, permission: 'granted' }, 'Enabled state requires the registered server device');
  eq(fresh.writes.length, 1, 'Device registers exactly once');
  eq(fresh.writes[0].row.user_id, 'rider-a', 'Registration stays attached to the starting rider');
  ok(!fresh.calls.includes('save-preferences'), 'Recovery device setup never overwrites existing training or quiet-hour preferences');
  ok(!fresh.calls.includes('notify'), 'Recovery setup does not trigger the ordinary notification UI');
  eq(fresh.reads[0].filters, [['user_id', 'rider-a'], ['endpoint', 'https://push.example.test/device-a']], 'Device status checks the current user and this exact browser subscription');
  const disabled = browserFixture({ permission: 'granted', serverEnabled: false });
  eq((await disabled.context.getRecoveryDeviceNotificationState()).enabled, false, 'Browser permission alone is not an enabled server subscription');
  const denied = browserFixture({ permission: 'denied' });
  await rejects(() => denied.context.enableRecoveryDeviceNotifications(), /blocked.*settings/, 'Denied notification permission is actionable');
  eq(denied.writes.length, 0, 'Denied permission makes no registration');
  const unsupported = browserFixture({ unsupported: true });
  eq(await unsupported.context.getRecoveryDeviceNotificationState(), { supported: false, enabled: false, permission: 'unsupported' }, 'Unsupported browser is reported honestly');
  await rejects(() => unsupported.context.enableRecoveryDeviceNotifications(), /not supported/, 'Unsupported browser does not start registration');
  const pendingRegistration = deferred(), changed = browserFixture({ ready: pendingRegistration.promise });
  const oldAttempt = changed.context.enableRecoveryDeviceNotifications(); changed.state.user = { id: 'rider-b' };
  pendingRegistration.resolve({ pushManager: { getSubscription: async () => ({ toJSON() { throw new Error('Wrong account should not be read'); } }) } });
  await rejects(() => oldAttempt, /account changed/, 'Changing account during setup aborts registration');
  eq(changed.writes.length, 0, 'A different account never receives the earlier user subscription');
  const slow = browserFixture({ slowSubscription: true });
  await rejects(() => slow.context.enableRecoveryDeviceNotifications(), /Notification setup timed out/, 'A stalled browser subscription has a bounded timeout');
  ok(slow.timeouts.includes(12000), 'Production notification setup uses its twelve-second bound');
  const failed = browserFixture({ writeError: true });
  await rejects(() => failed.context.enableRecoveryDeviceNotifications(), /Connection unavailable/, 'Failed device save is recoverable, not reported enabled');
  ok(!failed.calls.includes('save-preferences'), 'Failed setup preserves all preferences');
  const failedStatus = browserFixture({ permission: 'granted', readError: true });
  await rejects(() => failedStatus.context.getRecoveryDeviceNotificationState(), /Status unavailable/, 'Status failure never masquerades as enabled');

  const sent = await runWorker();
  eq(sent.result, { claimed: 1, delivered: 1, failed: 0 }, 'Valid reminder is delivered once');
  eq(sent.sends[0].config, { TTL: 2700, urgency: 'normal' }, 'Reminder expires at its server-provided deadline');
  eq(sent.validations[0].p_notification_id, 'reminder-a', 'Dispatch checks this exact claimed reminder');
  eq(sent.lookups[0].filters, [['user_id', 'rider-a'], ['enabled', true]], 'Worker only targets the recipient’s enabled devices');
  eq(Object.keys(sent.sends[0].payload).sort(), ['body','notificationId','recovery_page','title','type','url','view'].sort(), 'Only generic reminder content reaches the push provider');
  ok(!JSON.stringify(sent.sends[0].payload).includes('private-episode') && !JSON.stringify(sent.sends[0].payload).includes('never-copy'), 'Private queue metadata is not sent to the phone');
  const long = await runWorker({ validation: { eligible: true, expires_at: new Date(NOW + 24 * 3600000).toISOString() } });
  eq(long.sends[0].config.TTL, 7200, 'Even long-lived queue rows get a maximum two-hour push TTL');
  for (const [reason, validation] of [
    ['already completed', { eligible: false, expires_at: new Date(NOW + 3600000).toISOString() }],
    ['recovery off', { eligible: false }],
    ['expired', { eligible: true, expires_at: new Date(NOW - 1000).toISOString() }],
    ['missing expiry', { eligible: true }],
  ]) {
    const skipped = await runWorker({ validation });
    eq(skipped.sends.length, 0, `${reason}: no push leaves the server`);
    eq([skipped.finishes[0].p_delivered, skipped.finishes[0].p_failed], [0, 0], `${reason}: marked skipped without a delivery claim`);
    eq(skipped.updates.length, 0, `${reason}: no device status is changed`);
  }
  const unavailable = await runWorker({ validationError: true });
  eq(unavailable.sends.length, 0, 'Validation outage fails closed');
  eq([unavailable.finishes[0].p_delivered, unavailable.finishes[0].p_failed], [0, 1], 'Validation outage is retryable rather than falsely delivered');
  eq(unavailable.updates.length, 0, 'Database validation failure does not mark the browser subscription broken');
  const perDevice = await runWorker({ subscriptions: [{ id: 'a', endpoint: 'https://push.example.test/a' }, { id: 'b', endpoint: 'https://push.example.test/b' }], validations: [{ eligible: true, expires_at: new Date(NOW + 3600000).toISOString() }, { eligible: false }] });
  eq(perDevice.validations.length, 2, 'Reminder eligibility is rechecked immediately before each device');
  eq(perDevice.sends.length, 1, 'Completion between devices stops the later delivery');
  const noDevices = await runWorker({ subscriptions: [] });
  eq(noDevices.result, { claimed: 1, delivered: 0, failed: 0 }, 'No registered device is not reported as a delivered reminder');
  const normal = await runWorker({ queue: [{ ...reminder, notification_type: 'crew_chat', payload: { view: 'board' } }] });
  eq(normal.validations.length, 0, 'Ordinary chat notifications retain their existing path');
  eq(normal.sends[0].config, { TTL: 21600, urgency: 'high' }, 'Chat TTL and urgency are unchanged');
  eq(normal.sends[0].payload.view, 'board', 'Ordinary notifications retain their existing destination');
  const gone = await runWorker({ sendError: Object.assign(new Error('Expired subscription'), { statusCode: 410 }) });
  eq(gone.updates[0].values.enabled, false, 'A genuinely expired browser subscription is disabled');
  eq(gone.finishes[0].p_failed, 1, 'Failed delivery is reported to the retry mechanism');
  await workerNavigationTests();
  console.log(`PASS: ${checks} recovery reminder browser, worker and notification navigation checks (synthetic devices; no real pushes).`);
})().catch(error => { console.error(error); process.exitCode = 1; });
