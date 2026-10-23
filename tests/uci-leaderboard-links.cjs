// Exact production metadata loader, isolated from Supabase and real accounts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const extract = name => {
  const start = source.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'));
  assert(start >= 0, 'Production function exists: ' + name);
  const rest = source.slice(start);
  return rest.slice(0, rest.indexOf('\n}') + 2);
};
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (actual, message) => { assert(actual, message); checks++; };
const qa = { now: 100000, calls: [], queue: [] };
const state = { user: { id: 'viewer-a' }, profile: { role: 'athlete', ghost_mode: false }, sessionSetupVersion: 1, cache: {}, inFlight: new Map() };
const context = vm.createContext({
  state,
  Date: { now: () => qa.now },
  client: { rpc: name => {
    qa.calls.push(name);
    assert.equal(name, 'get_leaderboard_uci_links', 'Only the scoped compact metadata RPC is used');
    assert(qa.queue.length, 'Every request must use an explicit synthetic response');
    return qa.queue.shift();
  } },
  withTimeout: async request => request,
});
vm.runInContext(['cacheGet', 'cacheSet', 'cacheClear', 'invalidateLeaderboardUciLinks', 'getLeaderboardUciLinks'].map(extract).join('\n'), context);
const load = options => context.getLeaderboardUciLinks(options);
const response = data => ({ data, error: null });
const link = (athlete, id) => [{ athlete_id: athlete, uci_id: id }];
const a = link('rider-a', '10000000001');
const b = link('rider-b', '20000000001');
const reset = () => { state.cache = {}; state.inFlight.clear(); };
const watchdog = setTimeout(() => { console.error('Metadata regression did not finish: a synthetic request was left pending.'); process.exit(1); }, 5000);

(async () => {
  state.user = null;
  eq(plain(await load()), [], 'Anonymous visitors receive no identity metadata');
  eq(qa.calls.length, 0, 'Anonymous visits never call the RPC');
  state.user = { id: 'viewer-a' };

  const first = deferred();
  qa.queue.push(first.promise);
  const firstRequest = load();
  const duplicateRequest = load();
  eq(qa.calls.length, 1, 'Concurrent consumers share one metadata RPC');
  eq(state.inFlight.size, 1, 'Only one pending operation is tracked');
  first.resolve(response(a));
  eq(plain(await firstRequest), a, 'Initial metadata request resolves');
  eq(plain(await duplicateRequest), a, 'The shared consumer receives the same approved links');
  eq(state.inFlight.size, 0, 'Completed operation releases its pending slot');
  eq(plain(await load()), a, 'Repeated reads use the metadata cache');
  eq(qa.calls.length, 1, 'Fresh cache avoids repeated requests across leaderboard tabs');
  qa.now += 60000;
  eq(plain(await load()), a, 'Metadata stays fresh for the specified 60-second TTL');
  qa.now += 1;
  qa.queue.push(response(b));
  eq(plain(await load()), b, 'Expired metadata refreshes from the authorized RPC');
  eq(qa.calls.length, 2, 'TTL expiry triggers one new request');
  qa.queue.push(response(a));
  eq(plain(await load({ force: true })), a, 'Explicit refresh replaces a fresh cached result');
  eq(qa.calls.length, 3, 'Forced refresh performs a request');

  qa.queue.push({ data: null, error: new Error('Synthetic outage') });
  await assert.rejects(load({ force: true }), /Synthetic outage/); checks++;
  eq(Object.keys(state.cache), [], 'A failed forced refresh is never cached');
  eq(state.inFlight.size, 0, 'Failure releases the pending slot so retry is possible');
  qa.queue.push(response(b));
  eq(plain(await load()), b, 'Retry after failure can load valid metadata');
  qa.queue.push(response({ unexpected: true }));
  await assert.rejects(load({ force: true }), /couldn’t load/); checks++;
  eq(Object.keys(state.cache), [], 'Malformed metadata cannot become a cached success');
  qa.queue.push(response([]));
  eq(plain(await load()), [], 'An authorized empty result is valid');
  const beforeEmptyRead = qa.calls.length;
  eq(plain(await load()), [], 'An empty result is cached too');
  eq(qa.calls.length, beforeEmptyRead, 'An empty roster does not cause polling loops');

  reset();
  const oldAccount = deferred();
  qa.queue.push(oldAccount.promise);
  const accountARequest = load();
  state.user = { id: 'viewer-b' };
  state.sessionSetupVersion++;
  qa.queue.push(response(b));
  eq(plain(await load()), b, 'Another account receives its own scoped response');
  oldAccount.resolve(response(a));
  await assert.rejects(accountARequest, /Rider links changed/); checks++;
  eq(Object.keys(state.cache), [`leaderboard-uci:viewer-b:athlete:public:${state.sessionSetupVersion}:${state.leaderboardUciVersion}`], 'A previous account’s late response cannot enter the new cache');
  eq(plain(await load()), b, 'A previous response cannot replace the current account’s metadata');
  eq(state.inFlight.size, 0, 'Account-switch responses release all their own pending slots');

  reset();
  const oldSetup = deferred();
  qa.queue.push(oldSetup.promise);
  const setupRequest = load();
  state.sessionSetupVersion++;
  qa.queue.push(response(b));
  eq(plain(await load()), b, 'New session setup does not share an old pending identity request');
  oldSetup.resolve(response(a));
  await assert.rejects(setupRequest, /Rider links changed/); checks++;
  eq(Object.values(state.cache).map(entry => plain(entry.value)), [b], 'An old session response cannot overwrite current metadata');
  eq(plain(await load()), b, 'New session cache survives the old operation finishing');

  reset();
  const oldLinkVersion = deferred();
  qa.queue.push(oldLinkVersion.promise);
  const oldLinkRequest = load();
  context.invalidateLeaderboardUciLinks();
  qa.queue.push(response([]));
  eq(plain(await load()), [], 'Profile unlink invalidation starts a fresh identity request');
  oldLinkVersion.resolve(response(a));
  await assert.rejects(oldLinkRequest, /Rider links changed/); checks++;
  eq(plain(await load()), [], 'A response from before a profile unlink cannot resurrect its affiliation');

  state.profile.role = 'coach';
  qa.queue.push(response(a));
  eq(plain(await load()), a, 'A coach does not reuse athlete-scoped metadata');
  state.profile.ghost_mode = true;
  qa.queue.push(response(b));
  eq(plain(await load()), b, 'Ghost-mode visibility uses a separate metadata scope');
  const cachedKeys = Object.keys(state.cache);
  ok(cachedKeys.some(key => key.startsWith('leaderboard-uci:viewer-b:coach:public:')) && cachedKeys.some(key => key.startsWith('leaderboard-uci:viewer-b:coach:ghost:')), 'Role and ghost visibility are represented in cache isolation');

  reset();
  const retry = deferred();
  qa.queue.push(retry.promise);
  const beforeForcedReads = qa.calls.length;
  const forceOne = load({ force: true });
  const forceTwo = load({ force: true });
  eq(qa.calls.length, beforeForcedReads + 1, 'Repeated forced refresh taps share one RPC');
  retry.resolve(response(a));
  await Promise.all([forceOne, forceTwo]);
  eq(plain(await load()), a, 'Shared forced refresh leaves a usable cached result');

  reset();
  const ordinaryPending = deferred();
  qa.queue.push(ordinaryPending.promise);
  const ordinaryRequest = load();
  qa.queue.push(response(b));
  eq(plain(await load({ force: true })), b, 'Explicit refresh supersedes an ordinary pending request');
  ordinaryPending.resolve(response(a));
  await assert.rejects(ordinaryRequest, /Rider links changed/); checks++;
  eq(plain(await load()), b, 'Superseded ordinary response cannot roll back the refreshed metadata');

  reset();
  const forcedBeforeUnlink = deferred();
  qa.queue.push(forcedBeforeUnlink.promise);
  const staleForcedRequest = load({ force: true });
  context.invalidateLeaderboardUciLinks();
  qa.queue.push(response([]));
  eq(plain(await load({ force: true })), [], 'Profile changes invalidate even a pending forced refresh');
  forcedBeforeUnlink.resolve(response(a));
  await assert.rejects(staleForcedRequest, /Rider links changed/); checks++;
  eq(plain(await load()), [], 'An old forced request cannot restore a removed identity link');
  eq(qa.queue.length, 0, 'Every fixture response was consumed without hidden extra requests');
  console.log('PASS: ' + checks + ' leaderboard UCI metadata cache checks (scoped RPC, single-flight, TTL, retries, empty results, role/ghost/account/setup isolation).');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
