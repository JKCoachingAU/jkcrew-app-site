// Actual Shred Zone/Yard renderers, isolated navigation/data stubs and a local toy game.
// This checks integration lifecycle and layout, not the external game's gameplay.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..'), source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
function block(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert(from >= 0 && to > from, 'Actual source block found: ' + start);
  return source.slice(from, to);
}
const renderers = block('function shredZoneIcon(', 'async function renderCoachMore(');
const tricktionary = block('async function renderTricktionary()', 'async function getWeeklyRiderBattles(');
const returnState = block('  if (previousView === "shredZone" &&', '  resetPageExpansions(options);');
const routePredicate = source.match(/^const isRileyTestRoute = .*;$/m)?.[0];
assert(routePredicate, 'Actual Riley route predicate found');
const fixture = `
const state = { user: { id: 'fixture-rider' }, profile: { role: 'athlete' }, view: 'home' };
const client = {}, isCoachRole = role => ['coach', 'admin'].includes(role);
window.navigations = [];
const JKCrewBikeGarage = { mount(options) { window.garageOptions = options; options.root.innerHTML = '<button id="garage-back">Back</button>'; document.querySelector('#garage-back').onclick = options.onBack; } };
const getTricktionaryData = async () => ({profile: { role: 'athlete', daily_pb_seconds: null }, attempts: []});
const landedTricktionaryEntries = () => [], formatPbTime = () => '—', tricktionaryBoardHtml = () => '<p>No landed tricks yet</p>';
const weeklyAttemptsHtml = () => '', weekStartDate = () => '2026-09-21', bindTricktionaryBoard = () => {};
const saveManualTrick = event => event.preventDefault(), removeManualTrick = () => {};
async function navigate(view) {
  const previousView = state.view;
  if (previousView === 'jkcYard') closeJkcYard();
  ${returnState}
  state.view = view; navigations.push(view);
  if (view === 'shredZone') return renderShredZone();
  if (view === 'jkcYard') return renderJkcYard();
  if (view === 'bikeGarage') return renderBikeGarage();
  if (view === 'tricktionary') return renderTricktionary();
  document.querySelector('#view').innerHTML = shredZoneTeaserHtml();
  document.querySelector('[data-open-shred-zone]').onclick = () => navigate('shredZone');
}
${routePredicate}
${renderers}
${tricktionary}
`;

(async () => {
  const requests = [], held = [];
  let gameMode = 'ok', checks = 0;
  const eq = (a, b, message) => { assert.deepEqual(a, b, message); checks++; };
  const ok = (value, message) => { assert(value, message); checks++; };
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname.endsWith('/games/jkc-yard/index.html')) {
      requests.push({path: url.pathname, method: request.method});
      if (request.method === 'HEAD' && gameMode === 'hold') { held.push(response); return; }
      response.writeHead(gameMode === 'fail' ? 503 : 200, { 'content-type': 'text/html' });
      return response.end(request.method === 'HEAD' ? '' : '<!doctype html><html><body><h1>Local toy Yard fixture</h1><button>Pedal</button></body></html>');
    }
    if (['/', '/index.html', '/riley-test/', '/riley-test/index.html'].includes(url.pathname)) {
      response.writeHead(200, {'content-type': 'text/html'});
      return response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/shred-zone.css"><style>body{margin:0;background:#071016}#app{display:block!important}#view{width:100%;max-width:1100px;margin:auto;padding:16px;box-sizing:border-box}</style></head><body><div id="app"><main id="view"></main></div></body></html>');
    }
    const file = path.resolve(root, '.' + url.pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { response.writeHead(404); return response.end(); }
    response.writeHead(200, { 'content-type': path.extname(file) === '.css' ? 'text/css' : 'application/octet-stream' });
    response.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({headless: true, executablePath: process.env.JKCREW_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  async function fresh(route = '/', width = 390) {
    const context = await browser.newContext({viewport: {width, height: 844}, serviceWorkers: 'block'});
    const errors = [], external = [];
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      external.push(route.request().url()); return route.abort();
    });
    await context.addInitScript(() => {
      window.yardSignals = []; window.yardTimers = new Map();
      const fetchOriginal = window.fetch.bind(window), timeoutOriginal = window.setTimeout.bind(window), clearOriginal = window.clearTimeout.bind(window);
      window.fetch = (url, options) => { if (String(url).includes('/games/jkc-yard/')) yardSignals.push(options.signal); return fetchOriginal(url, options); };
      window.setTimeout = (callback, delay, ...args) => { const id = timeoutOriginal(callback, delay, ...args); if (delay === 30000) yardTimers.set(id, callback); return id; };
      window.clearTimeout = id => { yardTimers.delete(id); return clearOriginal(id); };
      // Exercise the app's real iPhone/PWA fallback without requesting OS fullscreen.
      Object.defineProperty(Element.prototype, 'requestFullscreen', { configurable: true, value: undefined });
    });
    const page = await context.newPage(); page.setDefaultTimeout(5000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + route); await page.addScriptTag({content: fixture});
    await page.evaluate(() => navigate('home'));
    return {context, page, errors, external};
  }
  try {
    for (const route of ['/', '/riley-test/', '/riley-test/index.html']) {
      const {context, page, errors} = await fresh(route);
      const count = requests.length;
      eq(await page.locator('[data-open-shred-zone] strong').textContent(), 'SHRED ZONE', 'Home entry renamed');
      await page.click('[data-open-shred-zone]');
      eq(await page.locator('[data-shred-destination]').evaluateAll(items => items.map(item => [item.dataset.shredDestination, item.querySelector('strong').textContent])), [['bikeGarage','JKC GARAGE'],['jkcYard','JKC YARD'],['tricktionary','TRICKTIONARY']], 'Three exact destinations');
      eq(requests.length, count, 'No game request before Yard entry');
      await page.click('[data-shred-destination="bikeGarage"]');
      eq(await page.evaluate(() => state.shredZoneReturn), 'bikeGarage', 'Actual return tracking selects garage');
      await page.click('#garage-back'); eq(await page.locator('.shred-zone-page').count(), 1, 'Garage returns to Shred Zone');
      await page.click('[data-shred-destination="tricktionary"]');
      eq(await page.locator('[data-back-shred-zone]').count(), 1, 'Tricktionary offers return link');
      await page.click('[data-back-shred-zone]');
      await page.click('[data-shred-destination="jkcYard"]');
      await page.locator('.jkc-yard-loading').waitFor({state: 'hidden'});
      eq(await page.locator('iframe').getAttribute('src'), origin + '/games/jkc-yard/index.html', 'Root and Riley load one shared game');
      eq(requests.slice(count).map(item => item.method), ['HEAD','GET'], 'Game fetched only on entry');
      eq(await page.locator('iframe').getAttribute('title'), 'JKC Yard BMX game', 'Game frame labelled');
      eq(await page.evaluate(() => yardTimers.size), 0, 'Load clears timeout');
      await page.click('[data-yard-fullscreen]');
      eq(await page.locator('[data-yard-fullscreen]').getAttribute('aria-pressed'), 'true', 'Fallback fullscreen state exposed');
      ok(await page.locator('body').evaluate(el => el.classList.contains('jkc-yard-expanded')), 'Fallback locks outer scroll');
      await page.keyboard.press('Escape');
      eq(await page.locator('[data-yard-fullscreen]').getAttribute('aria-pressed'), 'false', 'Escape exits expanded view');
      await page.click('[data-yard-fullscreen]'); await page.click('[data-yard-back]');
      eq(await page.locator('iframe').count(), 0, 'Leaving removes game/media document');
      eq(await page.evaluate(() => [state.jkcYardCleanup, document.body.classList.contains('jkc-yard-expanded'), yardSignals.every(signal => signal.aborted), yardTimers.size]), [null,false,true,0], 'Leaving clears cleanup, expansion, requests and timer');
      await page.click('[data-shred-back]'); eq(await page.evaluate(() => state.view), 'home', 'Hub returns rider home');
      await page.evaluate(() => { state.user = null; return navigate('shredZone'); });
      eq(await page.evaluate(() => state.view), 'home', 'Anonymous hub access returns home');
      eq(errors, [], 'No page errors'); await context.close();
    }
    {
      const {context, page, errors} = await fresh(); gameMode = 'fail';
      await page.evaluate(() => navigate('jkcYard')); await page.locator('.jkc-yard-error').waitFor({state:'visible'});
      eq(await page.locator('iframe').count(), 0, 'HTTP failure creates no game');
      eq(await page.evaluate(() => [yardTimers.size, yardSignals[0].aborted]), [0,true], 'Failed request cleaned up');
      gameMode = 'ok'; await page.click('[data-yard-retry]'); await page.locator('.jkc-yard-loading').waitFor({state:'hidden'});
      eq(await page.locator('iframe').count(), 1, 'Retry loads one new game');
      await page.locator('iframe').dispatchEvent('error'); await page.locator('.jkc-yard-error').waitFor({state:'visible'});
      eq(await page.locator('iframe').count(), 0, 'Frame error removes failed game');
      await page.click('[data-yard-back]'); eq(errors, [], 'Failure/retry has no uncaught error'); await context.close();
    }
    {
      const {context, page, errors} = await fresh(); gameMode = 'hold';
      await page.evaluate(() => { void navigate('jkcYard'); }); await page.waitForFunction(() => yardSignals.length === 1);
      await page.click('[data-yard-back]');
      eq(await page.evaluate(() => [yardSignals[0].aborted, yardTimers.size]), [true,0], 'Leaving aborts pending game availability request');
      held.splice(0).forEach(response => response.end());
      eq(await page.locator('iframe').count(), 0, 'Late availability response cannot reopen game');
      await page.evaluate(() => { void navigate('jkcYard'); }); await page.waitForFunction(() => yardSignals.length === 2);
      await page.evaluate(() => { [...yardTimers.values()][0](); });
      await page.locator('.jkc-yard-error').waitFor({state:'visible'});
      eq(await page.evaluate(() => [yardSignals[1].aborted, yardTimers.size]), [true,0], 'Timed-out request is aborted with retry state');
      await page.click('[data-yard-back]'); eq(errors, [], 'Interrupted request has no uncaught error'); await context.close();
      held.splice(0).forEach(response => response.end()); gameMode = 'ok';
    }
    for (const width of [320,390,768,1280]) {
      const {context, page, errors} = await fresh('/', width);
      for (const view of ['home','shredZone','jkcYard']) {
        await page.evaluate(view => navigate(view), view);
        ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow: '+view+' / '+width);
      }
      if (width === 390) {
        await page.evaluate(() => navigate('shredZone'));
        await page.screenshot({path:'/tmp/jkcrew-shred-zone-mobile.png',fullPage:true});
      }
      eq(errors, [], 'Responsive views have no page errors'); await context.close();
    }
    console.log(JSON.stringify({status:'PASS',checks,coverage:['actual hub/teaser/garage/tricktionary renderers','root and Riley shared game URL','on-demand loading','failure/retry/timeout','leave cleanup','fullscreen fallback','320–1280px layout'],game:'isolated local toy fixture; current Claude game not validated',production_requests:0},null,2));
  } finally { held.splice(0).forEach(response => response.end()); await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
