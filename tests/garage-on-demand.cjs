// Real optional assets and local synthetic account data; no production requests.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.JKCREW_PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..'),app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const from=app.indexOf('const bikeGarageAssetLoads ='),to=app.indexOf('async function renderCoachMore()',from);
assert(from>0&&to>from);
const loader=app.slice(from,to),release=app.match(/^const RELEASE_VERSION = "([^"]+)"/m)[1];
const files=['bike-garage.css','bike-preview.css','bike-parts-catalog.js','bike-config.js','bike-seat-designs.js','bike-photo-masks.js','bike-renderer.js','bike-preview.js','bike-three.js','bike-garage.js'];
let checks=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++};
(async()=>{
 const requests=[],errors=[];let fail='bike-seat-designs.js',hold=false,held=[];
 const fixture=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="styles.css"></head><body><div id="app"><main id="view"></main></div><script>const RELEASE_VERSION=${JSON.stringify(release)};const state={user:{id:'fixture-rider'},view:'bikeGarage',profile:{role:'athlete'}};const client={rpc:async()=>({data:{builds:[]}})};const isCoachRole=()=>false;const navigate=view=>state.view=view;const withTimeout=p=>p;${loader}</script></body></html>`;
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://test'),file=url.pathname.split('/').pop();requests.push(url.pathname);
  if(file==='fixture.html'){res.setHeader('Content-Type','text/html');return res.end(fixture)}
  const actual=path.join(root,url.pathname==='/'?'index.html':url.pathname);
  if(file===fail){fail='';res.writeHead(503);return res.end('unavailable')}
  if(!actual.startsWith(root)||!fs.existsSync(actual)){res.writeHead(404);return res.end()}
  const send=()=>{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':(file.endsWith('.html')||url.pathname==='/')?'text/html':'application/octet-stream');res.end(fs.readFileSync(actual))};
  if(hold&&file==='bike-config.js'){held.push(send);return;}send();
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  await context.route(/https:\/\//,r=>r.abort());
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin,{waitUntil:'domcontentloaded'});await page.locator('#auth-form').waitFor();
  eq(requests.filter(p=>files.some(f=>p.endsWith('/'+f))).length,0,'Login downloads no Garage code or styles');
  await page.goto(origin+'/fixture.html');
  const failed=await page.evaluate(()=>loadBikeGarageAssets().then(()=>'',e=>e.message));
  assert(failed.includes('try again'));checks++;
  await page.evaluate(()=>Promise.all([loadBikeGarageAssets(),loadBikeGarageAssets()]));
  for(const file of files)eq(requests.filter(p=>p==='/'+file).length,file==='bike-seat-designs.js'?2:1,'Retry/coalescing avoids duplicate script execution: '+file);
  await page.evaluate(()=>renderBikeGarage());await page.locator('[data-bike-name]').waitFor();
  eq(await page.locator('[data-bike-name]').inputValue(),'My dream bike','Real editor opens after lazy load');
  await page.locator('[data-bike-name]').fill('Kept on device');
  await page.evaluate(()=>JKCrewBikeGarage.destroy());
  await page.evaluate(()=>renderBikeGarage());await page.locator('[data-bike-name]').waitFor();
  eq(await page.locator('[data-bike-name]').inputValue(),'Kept on device','Reopening retains the rider draft');
  eq(await page.evaluate(()=>typeof JKCrewBike3D),'object','The real 360 viewer is loaded');
  await page.evaluate(()=>JKCrewBikeGarage.destroy());await page.close();
  // A delayed optional chunk may finish after navigation. It must not paint the old view.
  hold=true;const slow=await context.newPage();slow.on('pageerror',e=>errors.push(e.message));await slow.goto(origin+'/fixture.html');
  await slow.evaluate(()=>{window.opening=renderBikeGarage()});
  while (!held.length) await new Promise(resolve=>setTimeout(resolve,10));
  await slow.evaluate(()=>{state.view='session';document.querySelector('#view').textContent='Session remains here'});
  held.splice(0).forEach(send=>send());await slow.evaluate(()=>window.opening);
  eq(await slow.locator('#view').textContent(),'Session remains here','Late Garage downloads cannot overwrite another page');
  await slow.close();
  const retry=await context.newPage();retry.on('pageerror',e=>errors.push(e.message));await retry.goto(origin+'/fixture.html');
  const timedOut=await retry.evaluate(()=>loadBikeGarageAsset('bike-config.js',false,50).then(()=>false,()=>true));
  eq(timedOut,true,'A stalled asset request times out recoverably');
  hold=false;await retry.evaluate(()=>loadBikeGarageAssets());
  held.splice(0).forEach(send=>send());
  eq(await retry.evaluate(()=>document.querySelectorAll('script[data-asset-url*="bike-config.js"]').length),1,'Aborted late response cannot execute globals twice after retry');
  eq(errors,[],'No JavaScript errors during retry/reopen/navigation');
  console.log(JSON.stringify({status:'PASS',checks,initial_requests_removed:10,initial_uncompressed_bytes_removed:files.reduce((n,f)=>n+fs.statSync(path.join(root,f)).size,0),production_requests:0},null,2));
 }finally{await browser.close();await new Promise(r=>server.close(r))}
})().catch(e=>{console.error(e);process.exitCode=1});
