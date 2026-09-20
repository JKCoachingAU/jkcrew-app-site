// Actual Shred Zone renderers and the bundled Yard game; no production accounts or data.
// Reuse the isolated navigation fixture, then serve the real game instead of its toy replacement.
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const {chromium}=require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root=path.resolve(__dirname,'..');
const original=fs.readFileSync(root+'/tests/shred-zone-ui.cjs','utf8');
const {fixture}=new Function('require','__dirname',original.split('(async () => {')[0]+'return {fixture};')(require,root+'/tests');
const html='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/shred-zone.css"><link rel="stylesheet" href="/games/jkc-yard/vendor/fonts.css"><style>body{margin:0;background:#071016}#app{display:block!important}#view{width:100%;max-width:1100px;margin:auto;padding:16px;box-sizing:border-box}</style></head><body><div id="app"><main id="view"></main></div></body></html>';
(async()=>{
 const server=http.createServer((req,res)=>{const p=new URL(req.url,'http://localhost').pathname;if(['/', '/riley-test/', '/riley-test/index.html'].includes(p)){res.setHeader('content-type','text/html');return res.end(html);}const f=path.resolve(root,'.'+p);if(!f.startsWith(root+'/')||!fs.existsSync(f)||!fs.statSync(f).isFile()){res.writeHead(404);return res.end();}res.setHeader('content-type',({'.js':'application/javascript','.html':'text/html','.css':'text/css','.ttf':'font/ttf','.png':'image/png'})[path.extname(f)]||'application/octet-stream');res.end(req.method==='HEAD'?'':fs.readFileSync(f));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{
 for(const test of [{route:'/',width:1280,height:900,label:'desktop'},{route:'/riley-test/index.html',width:844,height:390,label:'mobile'}]){
  const context=await browser.newContext({viewport:{width:test.width,height:test.height},isMobile:test.label==='mobile',hasTouch:test.label==='mobile',serviceWorkers:'block'});
  const bad=[],errors=[];await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)bad.push(r.url());});
  await page.goto(origin+test.route);await page.addScriptTag({content:fixture});await page.evaluate(()=>navigate('home'));await page.click('[data-open-shred-zone]');await page.click('[data-shred-destination="jkcYard"]');
  const frame=page.frameLocator('iframe');await frame.locator('#start-btn:not([disabled])').waitFor({timeout:30000});await page.locator('.jkc-yard-loading').waitFor({state:'hidden',timeout:30000});
  await page.locator('[data-yard-fullscreen]').click();await frame.locator('#start-btn').waitFor({state:'visible'});await page.screenshot({path:'/tmp/jkcrew-yard-integrated-'+test.label+'.png'});
  await frame.locator('#start-btn').click();
  assert.equal(await frame.locator('#intro').isVisible(),false);
  await page.locator('[data-yard-back]').click();assert.equal(await page.locator('iframe').count(),0);assert.equal(await page.locator('.shred-zone-page').count(),1);assert.equal(await page.evaluate(()=>!!document.fullscreenElement||document.body.classList.contains('jkc-yard-expanded')),false);
  assert.deepEqual(errors,[]);assert.deepEqual(bad,[]);console.log('PASS integrated '+test.label+' route '+test.route+' full-screen, actualgame start, Backcleanup, noerrororfailedassets');await context.close();
 }
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
