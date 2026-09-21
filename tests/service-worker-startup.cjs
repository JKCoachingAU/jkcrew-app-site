// Executes the actual page update handler and worker lifecycle; synthetic local
// assets only. The browser cases use a fresh disposable service-worker scope.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const { MessageChannel } = require('node:worker_threads');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const start = source.indexOf('let serviceWorkerRefreshStarted = false;');
const stop = source.indexOf('window.setInterval', start);
assert(start >= 0 && stop > start, 'Actual worker controller handler exists');
const handler = source.slice(start, stop);
const release = worker.match(/const RELEASE_VERSION = "([^"]+)"/)[1];
const nextRelease = release.replace(/\d+$/, value => String(Number(value) + 1));
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
function pageVm({ controlled = false, stored = false, storageThrows = false, signedIn = false, entered = false, pendingAuth = false, activeCall = false } = {}) {
  const listeners = {}, redirects = [], storage = new Map(stored ? [[`jkcrew-controller-refresh:${nextRelease}`, '1']] : []);
  const navigator = { serviceWorker: { controller: controlled ? { scriptURL: `https://jkcrew.test/sw.js?v=${release}` } : null, addEventListener: (name, fn) => listeners[name] = fn } };
  const controls = {}, notices = [];
  const document = { querySelector: () => null, querySelectorAll: () => entered ? [{type:'password',value:'unsent'}] : [], body:{append:node=>notices.push(node)}, createElement:()=>({ setAttribute(){},querySelector:selector=>controls[selector] ||= {},remove(){} }) };
  const state = {user:signedIn ? {id:'local-rider'} : null,authPendingForm:pendingAuth ? {isConnected:true} : null};
  const sandbox = { document, state, liveRun:activeCall ? {} : null, RELEASE_VERSION: release, navigator, MessageChannel, setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 30)), clearTimeout, sessionStorage: { getItem: key => { if (storageThrows) throw Error('Storage blocked'); return storage.get(key); }, setItem: (key, value) => { if (storageThrows) throw Error('Storage blocked'); storage.set(key, value); } }, window: { location: { href: 'https://jkcrew.test/?push=home#login', replace: url => redirects.push(url) } }, URL };
  vm.runInNewContext(handler, sandbox);
  const change = (version, scriptVersion = release, behavior = 'reply') => {
    navigator.serviceWorker.controller = version === null ? null : { scriptURL: `https://jkcrew.test/sw.js?v=${scriptVersion}`, postMessage(message, ports) {
      if (behavior === 'throw') throw Error('Worker gone');
      if (behavior !== 'silent') ports[0].postMessage({ type: 'JKCREW_RELEASE_VERSION', version });
    } };
    return listeners.controllerchange();
  };
  return { change, repeat: () => listeners.controllerchange(), redirects, storage, notices, apply:()=>controls["[data-apply-app-update]"].onclick() };
}
async function testVm() {
  const first = pageVm(); await first.change(release);
  eq(first.redirects, [], 'First controller acquisition leaves the login page in place');
  eq(first.storage.size, 0, 'First installation does not consume a future upgrade refresh');
  await first.change(nextRelease, release);
  eq(first.redirects.length, 1, 'New body at the same script URL still upgrades a previously uncontrolled page');
  eq(new URL(first.redirects[0]).searchParams.get('jkcrew-version'), nextRelease, 'Refresh uses incoming worker body release, not old URL release');
  eq(new URL(first.redirects[0]).searchParams.get('push'), 'home', 'Upgrade preserves existing navigation intent');
  eq(new URL(first.redirects[0]).hash, '#login', 'Upgrade preserves URL fragment');
  await first.repeat(); eq(first.redirects.length, 1, 'Duplicate controller notifications do not reload twice');
  const existing = pageVm({ controlled: true }); await existing.change(nextRelease, release);
  eq(existing.redirects.length, 1, 'Previously controlled installed apps continue to upgrade');
  const remembered = pageVm({ controlled: true, stored: true }); await remembered.change(nextRelease, release);
  eq(remembered.redirects.length, 1, 'Old URL-based storage markers cannot suppress a newer worker body');
  const blocked = pageVm({ controlled: true, storageThrows: true }); await blocked.change(nextRelease); await blocked.repeat();
  eq(blocked.redirects.length, 1, 'Blocked session storage does not block upgrades or duplicate reloads');
  const same = pageVm({ controlled: true }); await same.change(release, nextRelease); await same.repeat();
  eq(same.redirects, [], 'A different registration URL with the running body release never reloads');
  await same.change(nextRelease, nextRelease);
  eq(same.redirects.length, 1, 'Skipping a same-body registration does not suppress a future update');
  for (const behavior of ['silent', 'throw']) {
    const legacy = pageVm({ controlled: true }); await legacy.change(nextRelease, release, behavior); await legacy.repeat();
    eq(legacy.redirects.length, 1, 'Legacy '+behavior+' worker falls back to one bounded reload');
    eq(new URL(legacy.redirects[0]).searchParams.has('jkcrew-version'), false, 'Fallback never guesses release from worker URL');
  }
  const lost = pageVm({ controlled: true }); await lost.change(null); await lost.change(release);
  eq(lost.redirects, [], 'Controller loss and fresh acquisition do not interrupt the form');
  for (const options of [{signedIn:true},{entered:true},{pendingAuth:true},{activeCall:true,signedIn:true}]) {
    const busy = pageVm({controlled:true,...options}); await busy.change(nextRelease);
    eq(busy.redirects, [], 'An update cannot silently discard active work or login input');
    eq(busy.notices.length, 1, 'A deferred update remains available to the user');
    busy.apply();
    eq(busy.redirects.length, options.pendingAuth || options.activeCall ? 0 : 1, 'Explicit update waits for pending auth and live calls');
  }
  const events = {}, deleted = [], visits = []; let claims = 0, lifetime;
  const priorRelease = release.replace(/\d+$/, value => String(Number(value) - 1));
  const olderRelease = release.replace(/\d+$/, value => String(Number(value) - 2));
  vm.runInNewContext(worker, { self: { addEventListener: (name, fn) => events[name] = fn, clients: { claim: async () => { claims++; }, matchAll: async () => [{ url: 'https://jkcrew.test/', navigate: async url => visits.push(url) }] }, location: { origin: 'https://jkcrew.test' } }, caches: { keys: async () => ['jkcrew-shell-vold', `jkcrew-shell-v${olderRelease}`, `jkcrew-shell-v${priorRelease}`, `jkcrew-shell-v${release}`, 'jkcrew-riley-shell-v1.0.0', 'other-app-cache'], delete: async key => deleted.push(key) }, URL });
  events.activate({ waitUntil: promise => lifetime = promise }); await lifetime;
  eq(deleted, ['jkcrew-shell-vold', `jkcrew-shell-v${olderRelease}`], 'Activation retains current, one actual previous release, and unrelated app caches');
  eq(claims, 1, 'Activation still claims clients for online/offline shell support');
  eq(visits, [], 'Worker never starts a competing navigation, including for old page clients');
  let reply; events.message({data:{type:'JKCREW_GET_RELEASE_VERSION'},ports:[{postMessage:value=>reply=value}]});
  eq(JSON.parse(JSON.stringify(reply)), {type:'JKCREW_RELEASE_VERSION',version:release}, 'Actual worker answers with its body version');
  eq(fs.readFileSync(path.join(root, 'riley-test/sw.js'), 'utf8').replace('jkcrew-riley-shell-', 'jkcrew-shell-'), worker, 'Test route uses identical worker update behavior');
}
async function testBrowser() {
  let currentRelease = release;
  const errors = [], requests = [];
  const html = () => `<!doctype html><html><head><meta charset="utf-8"><title>Local sign-in fixture</title></head><body><form id="auth-form"><input id="email"><input id="password" type="password"></form><script>const RELEASE_VERSION=${JSON.stringify(currentRelease)};sessionStorage.setItem('loads',String(Number(sessionStorage.getItem('loads')||0)+1));${handler}\nwindow.installWorker=version=>navigator.serviceWorker.register('/sw.js?v='+version,{updateViaCache:'none'});</script></body></html>`;
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('Cache-Control', 'no-store');
    if (url.pathname === '/sw.js') {
      res.setHeader('Content-Type', 'application/javascript');
      return res.end(worker.split(release).join(currentRelease));
    }
    if (url.pathname === '/fixture.html' || url.pathname === '/' || url.pathname === '/index.html') {
      res.setHeader('Content-Type', 'text/html'); return res.end(html());
    }
    res.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'application/javascript' : 'text/plain');
    res.end('');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    const page = await browser.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/fixture.html');
    await page.locator('#email').fill('rider@example.test');
    await page.locator('#password').fill('unsent-local-fixture');
    await page.evaluate(version => window.installWorker(version), release);
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));
    eq(await page.evaluate(() => sessionStorage.getItem('loads')), '1', 'Real initial worker installation never reloads the form');
    eq(await page.locator('#email').inputValue(), 'rider@example.test', 'Unsubmitted rider email survives first installation');
    eq(await page.locator('#password').inputValue(), 'unsent-local-fixture', 'Unsubmitted password survives first installation');
    eq(page.url(), origin + '/fixture.html', 'First-install URL is unchanged');
    const garageUrls = [`/bike-three.js?v=${release}`, '/vendor/three.module.min.js', '/images/bike-garage/scene-street-v4.webp'];
    eq(await page.evaluate(async urls => Promise.all(urls.map(async url => (await fetch(url)).ok)), garageUrls), [true,true,true], 'First Garage use fills only the current public cache');
    currentRelease = nextRelease;
    await page.evaluate(() => refreshServiceWorkerRelease());
    await page.locator('#app-update-notice').waitFor();
    eq(await page.locator('#email').inputValue(), 'rider@example.test', 'A new release preserves a partly completed login');
    eq(await page.locator('#password').inputValue(), 'unsent-local-fixture', 'An upgrade never discards an entered password');
    eq(await page.evaluate(() => sessionStorage.getItem('loads')), '1', 'Upgrade is deferred until the user is ready');
    const retainedCaches = await page.evaluate(() => caches.keys());
    assert(retainedCaches.includes(`jkcrew-shell-v${release}`) && retainedCaches.includes(`jkcrew-shell-v${nextRelease}`)); checks++;
    await page.context().setOffline(true);
    try {
      eq(await page.evaluate(async urls => Promise.all(urls.map(async url => (await fetch(url)).ok)), garageUrls), [true,true,true], 'Deferred page keeps its cached Garage scripts, 3D engine and background after an offline upgrade');
    } finally { await page.context().setOffline(false); }
    await page.getByRole('button', {name:'Update app',exact:true}).click();
    await page.waitForURL(url => url.searchParams.get('jkcrew-version') === nextRelease);
    await page.waitForFunction(() => sessionStorage.getItem('loads') === '2');
    eq(await page.evaluate(() => sessionStorage.getItem('loads')), '2', 'Same-URL registration.update discovers new body and reloads exactly once');
    eq(await page.evaluate(version => navigator.serviceWorker.controller.scriptURL.endsWith('v='+version), release), true, 'Worker URL still names the original release after update');
    await page.locator('#email').fill('after-upgrade@example.test');
    await page.evaluate(version => window.installWorker(version), nextRelease);
    await page.waitForFunction(version => navigator.serviceWorker.controller.scriptURL.endsWith('v='+version), nextRelease);
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));
    eq(await page.locator('#email').inputValue(), 'after-upgrade@example.test', 'Same-body registration at a new URL preserves the current page');
    await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event('controllerchange')));
    eq(await page.evaluate(() => sessionStorage.getItem('loads')), '2', 'Repeated upgrade event cannot trigger a second navigation');
    eq(errors, [], 'No browser errors during installation or upgrade');
    assert(requests.some(url => url === `/sw.js?v=${release}`) && requests.some(url => url === `/sw.js?v=${nextRelease}`)); checks++;
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
(async () => { await testVm(); await testBrowser(); console.log(JSON.stringify({ status: 'PASS', checks, coverage: ['actual controller handler and worker activation', 'real browser first install preserves sign-in fields', 'same-scriptURL changed-body upgrade reloads once' , 'old controlled pages still upgrade', 'same-body new URL does not reload; bounded legacy fallback'], production_requests: 0 }, null, 2)); })().catch(error => { console.error(error); process.exitCode = 1; });
