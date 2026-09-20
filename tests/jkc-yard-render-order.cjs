// Real Yard frame ordering and WebGL pixels around adaptive resolution changes.
// Local assets only. Mobile emulation is not a physical-device performance test.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), vm = require('node:vm');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..'), gameRoot = path.join(root, 'games/jkc-yard');
// Supply an older app.js to demonstrate that the regression fails before the fix.
const appSource = fs.readFileSync(process.env.JKCREW_YARD_APP_PATH || path.join(gameRoot, 'app.js'), 'utf8');
const tickStart = appSource.indexOf(' function tick('), tickEnd = appSource.indexOf('\n const trackRecords=', tickStart);
assert(tickStart >= 0 && tickEnd > tickStart, 'Actual game tick is available for the fixture');
const tickSource = appSource.slice(tickStart, tickEnd);
const observations = [], failures = [];
let checks = 0;
function check(value, message) { checks++; if (!value) failures.push(message); }

function tickOrder(kind, frameMs, initialFps) {
  const calls = [], qualityInputs = [];
  const context = {
    stopped: () => false, sync() {}, performance: {now: () => 2000},
    p: {mode: 'ground', advance() {}}, input: {state: () => ({})}, events() {},
    state: () => ({mode:'ground'}), renderTime: 0, qualityTime: 1.21,
    lastRender: 2000-frameMs, lastHud: 2000, fps: initialFps,
    metrics: {frameTimes:Array(72).fill(frameMs), activeRenderedFrames:0, stallCount:0},
    view: {quality: (fps,p90) => {calls.push('quality');qualityInputs.push({fps,p90});}, update: () => calls.push('render')},
    sound: {update() {}}, renderHud() {},
  };
  vm.runInNewContext(tickSource + '\ntick(1/60,2000);', context);
  check(JSON.stringify(calls) === JSON.stringify(['quality','render']), kind + ': actual tick adjusts quality before rendering');
  check(qualityInputs.length === 1 && qualityInputs[0].fps === initialFps && Math.abs(qualityInputs[0].p90-frameMs) < .001, kind + ': existing quality inputs are preserved');
  check(context.metrics.activeRenderedFrames === 1, kind + ': tick renders exactly once');
  observations.push({test:'tick-order', kind, calls, qualityInputs});
}

// This observer is injected into the local HTTP response, never the shipped bundle.
// It keeps the real game tick, SceneView, adaptive-quality method and WebGL renderer.
// Only the next quality measurement is forced so both branches run on any test GPU.
const browserProbe = `
 const probe = window.__yardRenderTest = {results:[], events:[], armed:null, pending:null};
 const originalRender = view.renderer.render.bind(view.renderer);
 view.renderer.render = (...args) => {if(probe.armed || probe.pending)probe.events.push('render');return originalRender(...args);};
 const originalSize = view.renderer.setSize.bind(view.renderer);
 view.renderer.setSize = (...args) => {if(probe.armed || probe.pending)probe.events.push('resize');return originalSize(...args);};
 const originalQuality = view.quality.bind(view);
 view.quality = (fps,p90) => {
  const kind = probe.armed;
  if(!kind)return originalQuality(fps,p90);
  const before=view.renderer.getPixelRatio();
  originalQuality(kind==='downshift'?35:60,kind==='downshift'?32:16);
  probe.pending={kind,before,after:view.renderer.getPixelRatio()};probe.armed=null;
 };
 probe.forceQuality = kind => {
  if(stopped())throw new Error('The game must be running');
  view.renderer.setPixelRatio(kind==='downshift'?1.35:1);
  view.maxPixelRatio=2;view.qualityHold=0;
  staticDraw();probe.events=[];probe.armed=kind;qualityTime=1.21;
 };
 probe.endFrame = () => {
  if(!probe.pending)return;
  const gl=view.renderer.getContext(),pixel=new Uint8Array(4),samples=[];
  // Read synchronously before the browser presents/discards the non-preserved buffer.
  for(const y of [.15,.5,.85])for(const x of [.15,.5,.85]){
   gl.readPixels(Math.floor(gl.drawingBufferWidth*x),Math.floor(gl.drawingBufferHeight*y),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
   samples.push(Array.from(pixel));
  }
  probe.results.push({...probe.pending,events:probe.events.slice(),samples,glError:gl.getError(),width:gl.drawingBufferWidth,height:gl.drawingBufferHeight});
  probe.pending=null;probe.events=[];
 };
`;

(async () => {
  tickOrder('downshift', 32, 35);
  tickOrder('upshift', 1000/60, 60);
  const anchor = '\n const trackRecords=';
  const instrumentedApp = appSource.replace(anchor, browserProbe + anchor);
  const server = http.createServer((request,response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const file = path.resolve(root, '.' + decodeURIComponent(pathname));
    if (!file.startsWith(gameRoot + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {response.writeHead(404);return response.end('Not found');}
    const types = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.ttf':'font/ttf'};
    response.writeHead(200, {'content-type':types[path.extname(file)] || 'application/octet-stream'});
    response.end(file === path.join(gameRoot,'app.js') ? instrumentedApp : fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({headless:true, executablePath:process.env.JKCREW_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--enable-unsafe-swiftshader']});
    for (const [name,viewport,mobile] of [['desktop',{width:800,height:450},false],['mobile-portrait',{width:390,height:844},true]]) {
      const context = await browser.newContext({viewport,deviceScaleFactor:2,isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
      const external = [], errors = [];
      await context.route('**/*',route => {
        if(new URL(route.request().url()).origin === origin)return route.continue();
        external.push(route.request().url());return route.abort();
      });
      await context.addInitScript(() => {
        Object.defineProperty(Element.prototype,'requestFullscreen',{configurable:true,value:undefined});
        const raf = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = callback => raf(time => {callback(time);window.__yardRenderTest?.endFrame();});
      });
      const page = await context.newPage();
      page.on('pageerror',error => errors.push(error.message));
      await page.goto(origin+'/games/jkc-yard/index.html',{waitUntil:'domcontentloaded'});
      await page.waitForFunction(() => window.copingDiagnostics?.().render.assetsReady && !document.querySelector('#start-btn').disabled);
      await page.locator('#start-btn').click();
      await page.locator('#tutorial-go').click();
      await page.waitForFunction(() => copingDiagnostics().loopRunning);
      if(mobile)check(await page.locator('body').evaluate(el => el.classList.contains('rotated')), name + ': portrait viewport exercises rotated canvas');
      for(const kind of ['downshift','upshift']) {
        await page.evaluate(kind => __yardRenderTest.forceQuality(kind),kind);
        await page.waitForFunction(kind => __yardRenderTest.results.some(result => result.kind === kind),kind);
        const result = await page.evaluate(kind => __yardRenderTest.results.find(result => result.kind === kind),kind);
        check(kind === 'downshift' ? result.after < result.before : result.after > result.before,name + ': '+kind+' changes actual pixel ratio');
        check(result.events.includes('resize') && result.events.at(-1) === 'render',name + ': '+kind+' renders after all canvas resizes');
        check(result.glError === 0,name + ': '+kind+' framebuffer read succeeds');
        check(result.samples.filter(pixel => pixel[0]+pixel[1]+pixel[2] > 30).length >= 3,name + ': '+kind+' ends its RAF with visible pixels, not a cleared black canvas');
        observations.push({test:'webgl-frame',name,...result});
      }
      await page.locator('#pause-btn').click();
      check(await page.evaluate(() => copingDiagnostics().paused && !copingDiagnostics().loopRunning),name + ': pause stops the frame loop');
      const pausedFrames = await page.evaluate(() => copingDiagnostics().metrics.activeRenderedFrames);
      await page.waitForTimeout(180);
      check(await page.evaluate(() => copingDiagnostics().metrics.activeRenderedFrames) === pausedFrames,name + ': pause adds no active renders');
      await page.locator('#resume-btn').click();
      await page.waitForFunction(before => copingDiagnostics().loopRunning && copingDiagnostics().metrics.activeRenderedFrames > before+2,pausedFrames);
      check(await page.evaluate(() => !copingDiagnostics().paused && copingDiagnostics().render.triangles > 0),name + ': resume renders the scene again');
      check(external.length === 0,name + ': no external requests');
      check(errors.length === 0,name + ': no JavaScript errors: '+errors.join('; '));
      await context.close();
    }
  } finally {
    if(browser)await browser.close();
    server.closeAllConnections();await new Promise(resolve => server.close(resolve));
  }
  console.log(JSON.stringify({status:failures.length?'FAIL':'PASS',checks,failures,observations,production_requests:0},null,2));
  assert.equal(failures.length,0,failures.join('\n'));
})().catch(error => {console.error(error);process.exitCode=1;});
