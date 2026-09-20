// Actual bundled Yard startup and controls. Local assets only; no accounts or production requests.
// Mobile runs are browser emulation, not physical-device performance measurements.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..'), gameRoot = path.join(root, 'games/jkc-yard');
let checks = 0;
const eq = (a, b, message) => { assert.deepEqual(a, b, message); checks++; };
const ok = (value, message) => { assert(value, message); checks++; };
const walk = dir => fs.readdirSync(dir, {withFileTypes:true}).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);

(async () => {
  ok(fs.existsSync(path.join(gameRoot, 'index.html')), 'Current Yard bundle exists');
  const files = walk(gameRoot), index = fs.readFileSync(path.join(gameRoot, 'index.html'), 'utf8');
  ok(!index.includes('__FRAME_PREAMBLE') && !index.includes('frame-runtime'), 'Claude preview runtime removed');
  for (const file of files.filter(file => file.endsWith('.js'))) {
    const source = fs.readFileSync(file, 'utf8');
    execFileSync(process.execPath, ['--input-type=module', '--check'], {input:source, stdio:['pipe','pipe','pipe']});
    checks++;
    for (const match of source.matchAll(/(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g)) {
      if (match[1].startsWith('.')) ok(fs.existsSync(path.resolve(path.dirname(file), match[1].split('?')[0])), path.basename(file) + ' import exists: ' + match[1]);
    }
  }
  for (const file of files.filter(file => file.endsWith('.css'))) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/url\(['"]?([^)'"\s]+)/g)) {
      if (!match[1].startsWith('data:')) ok(fs.existsSync(path.resolve(path.dirname(file), match[1].split('?')[0])), 'CSS asset exists: ' + match[1]);
    }
  }
  const requests = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    requests.push(url.pathname);
    if (!file.startsWith(gameRoot + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { response.writeHead(404); return response.end('Not found'); }
    const types = {'.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.png':'image/png', '.webp':'image/webp', '.svg':'image/svg+xml', '.ttf':'font/ttf', '.woff2':'font/woff2', '.webmanifest':'application/manifest+json', '.json':'application/json'};
    response.writeHead(200, {'content-type':types[path.extname(file)] || 'application/octet-stream'});
    response.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({headless:true, executablePath:process.env.JKCREW_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args:['--enable-unsafe-swiftshader']});
  const observations = [];
  async function scenario(name, viewport, mobile) {
    const context = await browser.newContext({viewport, isMobile:mobile, hasTouch:mobile, serviceWorkers:'block'});
    const external = [], errors = [], consoleErrors = [], failures = [];
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      external.push(route.request().url()); return route.abort();
    });
    await context.addInitScript(() => {
      // The parent wrapper's separate tests cover fullscreen. Keep this viewport stable.
      Object.defineProperty(Element.prototype, 'requestFullscreen', {configurable:true, value:undefined});
      localStorage.setItem('sb-isolated-fixture-auth-token', 'not-a-real-token');
      window.storageReads = []; window.storageWrites = [];
      const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
      Storage.prototype.getItem = function(key) { storageReads.push(String(key)); return get.call(this,key); };
      Storage.prototype.setItem = function(key,value) { storageWrites.push(String(key)); return set.call(this,key,value); };
    });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('response', response => { if (response.status() >= 400) failures.push([response.status(),response.url()]); });
    await page.goto(origin + '/games/jkc-yard/index.html', {waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => window.copingDiagnostics?.().render.assetsReady && !document.querySelector('#start-btn').disabled, null, {timeout:30000});
    eq(await page.locator('.edition').textContent(), 'BMX YARD / 2.6', name + ': current game displayed');
    eq(await page.locator('#error').isVisible(), false, name + ': no startup error');
    eq(await page.locator('.track-choice').count(), 11, name + ': all eleven locations available');
    const ids = await page.locator('.track-choice').evaluateAll(items => items.map(item => item.dataset.track));
    for (const id of ['park','trail','urban']) ok(ids.includes(id), name + ': ' + id + ' present');
    for (const id of ['trail','urban','park']) {
      if (mobile) {
        for (let i=0; i<ids.length && await page.evaluate(() => copingDiagnostics().state.trackId) !== id; i++) await page.locator('#track-next').click();
      } else await page.locator('[data-track="'+id+'"]').click();
      eq(await page.evaluate(() => copingDiagnostics().state.trackId), id, name + ': location switches to ' + id);
      eq(await page.evaluate(() => copingDiagnostics().render.trackId), id, name + ': renderer and physics use same location');
      eq(await page.locator('[data-track="'+id+'"]').getAttribute('aria-pressed'), 'true', name + ': selected location marked');
    }
    if (name === 'mobile-portrait') {
      ok(await page.locator('body').evaluate(element => element.classList.contains('phone') && element.classList.contains('rotated')), 'Portrait phone uses landscape game rotation');
      ok(await page.locator('#game').evaluate(element => getComputedStyle(element).transform !== 'none'), 'Portrait rotation applied visually');
      await page.screenshot({path:'/tmp/jkcrew-yard-game-portrait.png'});
    }
    await page.locator('#start-btn').click();
    eq(await page.locator('#tutorial').isVisible(), true, name + ': first ride shows tutorial');
    await page.locator('#tutorial-go').click();
    await page.waitForFunction(() => copingDiagnostics().loopRunning);
    const initialFrames = await page.evaluate(() => copingDiagnostics().metrics.activeRenderedFrames);
    if (mobile) {
      const target = await page.locator('#pump-btn').boundingBox();
      ok(target && target.width > 20 && target.height > 20, name + ': pedal is visible');
      const session = await context.newCDPSession(page);
      await session.send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[{x:target.x+target.width/2, y:target.y+target.height/2, id:1}]});
      await page.waitForFunction(() => copingDiagnostics().input.pump);
      await page.waitForFunction(before => copingDiagnostics().metrics.activeRenderedFrames > before + 5, initialFrames);
      await session.send('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[]});
      await page.waitForFunction(() => !copingDiagnostics().input.pump);
      await session.detach();
    } else {
      await page.keyboard.down('e');
      await page.waitForFunction(() => copingDiagnostics().input.pump);
      await page.waitForFunction(before => copingDiagnostics().metrics.activeRenderedFrames > before + 5, initialFrames);
      await page.keyboard.up('e');
    }
    ok(await page.evaluate(() => copingDiagnostics().state.speed > 0), name + ': pedal drives bike');
    ok(await page.evaluate(() => copingDiagnostics().metrics.activeRenderedFrames > 0 && copingDiagnostics().render.triangles > 0), name + ': actual WebGL scene renders');
    await page.locator('#pause-btn').click();
    eq(await page.evaluate(() => [copingDiagnostics().paused,copingDiagnostics().loopRunning,copingDiagnostics().input.pump]), [true,false,false], name + ': pause stops animation and clears input');
    const pausedFrames = await page.evaluate(() => copingDiagnostics().metrics.activeRenderedFrames);
    await page.waitForTimeout(200);
    eq(await page.evaluate(() => copingDiagnostics().metrics.activeRenderedFrames), pausedFrames, name + ': paused scene consumes no active frames');
    await page.screenshot({path:'/tmp/jkcrew-yard-game-'+name+'.png'});
    await page.locator('#resume-btn').click();
    await page.waitForFunction(() => copingDiagnostics().loopRunning);
    await page.locator('#reset-btn').click();
    eq(await page.evaluate(() => copingDiagnostics().state.trackId), 'park', name + ': reset keeps selected park');
    eq(await page.evaluate(() => copingDiagnostics().state.score), 0, name + ': no unearned score from reset');
    await page.locator('#tracks-btn').click();
    eq(await page.evaluate(() => [copingDiagnostics().intro,copingDiagnostics().loopRunning]), [true,false], name + ': returning to location menu stops simulation');
    eq(await page.evaluate(() => [...new Set([...storageReads,...storageWrites])].sort()), ['jkcrew-kit','jkcrew-rider'], name + ': only cosmetic game preferences access storage');
    eq(external, [], name + ': no external requests');
    eq(failures, [], name + ': no failed local assets');
    eq(errors, [], name + ': no JavaScript errors');
    eq(consoleErrors, [], name + ': no console errors');
    observations.push({name, locations:ids, rendered:true, assetsReady:true, externalRequests:external.length});
    await context.close();
  }
  try {
    await scenario('desktop', {width:1100,height:700}, false);
    await scenario('mobile-landscape', {width:844,height:390}, true);
    await scenario('mobile-portrait', {width:390,height:844}, true);
    console.log(JSON.stringify({status:'PASS',checks,observations,production_requests:0,physical_device_performance:'not measured'},null,2));
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => {console.error(error);process.exitCode=1;});
