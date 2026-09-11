// Real workshop modules and app-shell CSS; requests are local artwork or mocked
// private garage reads. No production network traffic or database writes.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const navItems = [['◇','Command'],['●','Session'],['✦','Riders'],['⚡','Challenges'],['▤','Coach tools'],['•','More']];
const nav = navItems.map(([icon,label])=>`<button class="nav-btn" type="button"><span class="nav-icon">${icon}</span><span>${label}</span></button>`).join('');
// Match renderShell's layout surfaces. Omitting its topbar or bottom navigation
// would hide the overlap that originally made the workshop difficult to use.
// The available install prompt intentionally sits outside #app, matching index.html.
const shell = `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"><div class="app-shell coach-shell"><aside class="sidebar"><div class="sidebar-brand logo-sidebar-brand"><img src="/icons/jkc-logo.png" alt="JK Coaching"><span>JK Coaching</span></div><div class="role-pill">Coach account</div><nav class="nav-list">${nav}</nav></aside><div class="main-wrap"><header class="topbar"><div class="topbar-title"><img class="topbar-logo" src="/icons/jkc-logo.png" alt="">JKCREW live</div><div class="topbar-actions"><span class="sync-status"><i></i><b>Saved</b></span></div></header><main id="view" class="content" data-view="bikeGarage"></main></div><nav class="bottom-nav">${nav}</nav></div></div><button id="install-app" class="install-app" type="button">Install JK Coaching</button></body></html>`;
const mime = {'.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.svg':'image/svg+xml'};
async function routeLocal(route) {
  const url = new URL(route.request().url());
  if(url.origin!=='https://jkcrew.fixture'||route.request().method()!=='GET')return route.abort();
  if(url.pathname==='/garage')return route.fulfill({contentType:'text/html; charset=utf-8',body:shell});
  const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
  if(!file.startsWith(root+path.sep)||!mime[path.extname(file)]||!fs.existsSync(file))return route.abort();
  if(!fs.realpathSync(file).startsWith(fs.realpathSync(root)+path.sep))return route.abort();
  return route.fulfill({contentType:mime[path.extname(file)],body:fs.readFileSync(file)});
}
async function settle(page) {
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))));
}
async function boot(page) {
  await page.goto('https://jkcrew.fixture/garage');
  for(const file of ['styles.css','bike-garage.css','bike-preview.css'])await page.addStyleTag({content:fs.readFileSync(path.join(root,file),'utf8')});
  for(const file of ['bike-config.js','bike-seat-designs.js','bike-photo-masks.js','bike-renderer.js','bike-preview.js','bike-garage.js'])await page.addScriptTag({content:fs.readFileSync(path.join(root,file),'utf8')});
  await page.evaluate(()=>{
    window.layoutCalls=[];window.layoutOwner='layout-owner';window.confirm=()=>true;
    const builds=[1,2,3].map(slot=>({slot,name:`Saved layout bike ${slot}`,configuration:JKCrewBikeConfig.normalize({}),revision:1,updated_at:'2026-09-12T00:00:00Z'}));
    const client={rpc(method,args){layoutCalls.push({method,args});if(method==='delete_bike_build')return Promise.resolve({error:{message:'Connection interrupted'}});if(method!=='get_bike_garage')throw new Error('Unexpected layout-test write');return Promise.resolve({data:{builds}});}};
    JKCrewBikeGarage.mount({root:document.querySelector('#view'),client,userId:layoutOwner,isCurrent:()=>true,onBack(){}});
  });
  await page.waitForFunction(()=>document.querySelector('[data-bike-art]')?.getAttribute('aria-busy')==='false');
  await settle(page);
}
async function fitsShell(page,label) {
  assert(await page.locator('#install-app').isHidden(),`${label}: the global install prompt cannot cover the garage Save button`);
  const result=await page.evaluate(()=>{
    const rect=selector=>{const el=document.querySelector(selector),r=el?.getBoundingClientRect();return r?{top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height,display:getComputedStyle(el).display}:null;};
    const garage=rect('.bike-garage'),header=rect('.topbar'),nav=rect('.bottom-nav');
    return {garage,header,nav,stage:rect('.bike-stage'),save:rect('.bike-save-bar'),editor:rect('.bike-control-scroll'),viewport:[innerWidth,innerHeight],document:[document.documentElement.scrollWidth,document.documentElement.scrollHeight],scroll:[scrollX,scrollY]};
  });
  const bottom=result.nav?.display!=='none'?result.nav.top:result.viewport[1];
  assert(result.garage.top>=result.header.bottom-1,`${label}: workshop stays below the app header`);
  assert(result.garage.bottom<=bottom+1,`${label}: workshop stays above the bottom navigation (${JSON.stringify(result)})`);
  assert(result.garage.left>=-1&&result.garage.right<=result.viewport[0]+1,`${label}: workshop fits the available width`);
  assert(result.document[0]<=result.viewport[0]+1&&result.document[1]<=result.viewport[1]+1,`${label}: editing needs no outer-page scrolling`);
  assert(result.stage.height>60&&result.editor.height>40,`${label}: bike and editor retain useful visible space`);
  assert(result.save.bottom<=bottom+1&&result.save.top>=result.header.bottom,`${label}: save bar stays visible`);
  return result;
}
async function hitTest(locator,label) {
  const result=await locator.evaluate(el=>{const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);return {top:r.top,bottom:r.bottom,width:r.width,height:r.height,visible:r.top>=0&&r.bottom<=innerHeight,hit:!!hit&&(hit===el||el.contains(hit)),cover:hit?.className?.baseVal||hit?.className||hit?.tagName};});
  assert(result.visible&&result.hit,`${label}: visible and directly tappable (${JSON.stringify(result)})`);
  assert(result.height>=43,`${label}: keeps a44px touch target (${result.height})`);
}
async function choosePart(page,group,part) {
  await page.locator(`[data-bike-group="${group}"]`).click();
  const menu=page.locator('.bike-part-menu');
  if(await menu.count()) {
    if(!await menu.evaluate(el=>el.open))await menu.locator('summary').click();
    await page.locator(`[data-bike-select="${part}"]`).click();
    assert.equal(await menu.evaluate(el=>el.open),false,'Choosing a part closes the part menu');
  }
  await settle(page);
}
async function checkLayout(page,role,width,height,theme) {
  const label=`${role}/${width}x${height}/${theme}`;
  await page.setViewportSize({width,height});
  await page.evaluate(({role,theme})=>{document.querySelector('.app-shell').className=`app-shell ${role}-shell`;document.documentElement.dataset.theme=theme;},{role,theme});
  await settle(page);await page.locator('[data-bike-group="Frame"]').click();await choosePart(page,'Details','seat');
  await fitsShell(page,label);
  assert.equal(await page.locator('.bike-control-scroll').evaluate(el=>el.scrollTop),0,`${label}: changing parts begins at the top of its settings`);
  const before=await page.evaluate(()=>({y:scrollY,stage:document.querySelector('.bike-stage').getBoundingClientRect().toJSON(),nav:document.querySelector('.bike-control-navigation').getBoundingClientRect().toJSON(),save:document.querySelector('.bike-save-bar').getBoundingClientRect().toJSON()}));
  const editor=page.locator('.bike-control-scroll');
  await editor.hover();await page.mouse.wheel(0,900);
  await page.waitForFunction(()=>document.querySelector('.bike-control-scroll').scrollTop>0);await settle(page);
  const after=await page.evaluate(()=>({y:scrollY,stage:document.querySelector('.bike-stage').getBoundingClientRect().toJSON(),nav:document.querySelector('.bike-control-navigation').getBoundingClientRect().toJSON(),save:document.querySelector('.bike-save-bar').getBoundingClientRect().toJSON()}));
  assert.equal(after.y,before.y,`${label}: editor scrolling does not move the page`);
  for(const area of ['stage','nav','save'])for(const key of ['top','bottom','left','right'])assert(Math.abs(after[area][key]-before[area][key])<1,`${label}: ${area} stays still while settings scroll`);
  if(width===390&&role==='coach'&&theme==='dark') {
    await editor.evaluate(el=>el.scrollTop=0);
    const r=await editor.boundingBox(),x=r.x+r.width/2,from=r.y+r.height-16,to=r.y+16;
    const cdp=await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y:from}]});
    for(let step=1;step<=6;step++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:from+(to-from)*step/6}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
    await page.waitForFunction(()=>document.querySelector('.bike-control-scroll').scrollTop>0);
    assert.equal(await page.evaluate(()=>scrollY),before.y,'A native touch swipe scrolls the settings without moving the page');
  }
  for(const control of ['[data-bike-group="Frame"]','.bike-part-menu > summary','[data-bike-save]'])await hitTest(page.locator(control),`${label}/${control}`);
  // A same-part paint change must keep the rider's location in a long settings
  // pane, while a different part deliberately begins at the top.
  const swatch=page.locator('[data-bike-colour="#F26879"]');await swatch.scrollIntoViewIfNeeded();
  const scroll=await editor.evaluate(el=>el.scrollTop);await swatch.click();await settle(page);
  assert(Math.abs(await editor.evaluate(el=>el.scrollTop)-scroll)<2,`${label}: painting preserves the settings scroll position`);
  await page.locator('[data-bike-group="Details"]').click();await settle(page);
  assert(Math.abs(await editor.evaluate(el=>el.scrollTop)-scroll)<2,`${label}: tapping the current section preserves its settings position`);
  const name=page.locator('[data-bike-name]');await hitTest(name,`${label}/build name`);
  assert(await name.evaluate(el=>parseFloat(getComputedStyle(el).fontSize))>=16,`${label}: build name avoids mobile autozoom`);
  if(theme==='dark'&&role==='coach')await page.screenshot({path:`/tmp/jkcrew-garage-after-${width}x${height}.png`});
  if(theme==='light'&&role==='coach'&&width===390)await page.screenshot({path:'/tmp/jkcrew-garage-after-390x844-light.png'});
}
async function checkCollection(page) {
  await page.setViewportSize({width:390,height:844});await settle(page);
  assert.equal(await page.locator('.bike-collection-dialog[open]').count(),0,'Collection is closed until requested');
  await page.locator('[data-bike-name]').fill('Keep this unfinished bike');
  const snapshot=await page.evaluate(()=>localStorage.getItem('jkcrew-bike-draft-v1:layout-owner'));
  const opener=page.locator('[data-bike-collection-open]');await opener.click();
  const dialog=page.locator('.bike-collection-dialog');assert(await dialog.isVisible());
  assert(await dialog.locator('[data-bike-garage]').evaluate(el=>el.open),'My garage opens inside its collection drawer');
  assert.equal(await dialog.locator('.bike-parts-inspiration').evaluate(el=>el.open),false,'Inspiration stays closed');
  assert(await dialog.evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1&&r.left>=0&&r.right<=innerWidth+1;}),'Collection dialog is bounded by the phone viewport');
  await dialog.locator('[data-bike-remove="3"]').click();
  const status=dialog.locator('[data-bike-collection-status]');await status.filter({hasText:/Could not remove/}).waitFor();
  assert(await status.evaluate(el=>{const r=el.getBoundingClientRect(),body=el.closest('.bike-collection-body').getBoundingClientRect();return r.top>=body.top&&r.bottom<=body.bottom;}),'A failed removal on the lowest saved card brings its error into view');
  await hitTest(dialog.locator('[data-bike-reload]'),'retry after a failed removal');
  await page.locator('[data-bike-collection-close]').click();
  assert.equal(await page.locator('.bike-collection-dialog[open]').count(),0);
  assert.equal(await page.evaluate(()=>localStorage.getItem('jkcrew-bike-draft-v1:layout-owner')),snapshot,'Opening/closing the collection preserves the draft');
  assert(await opener.evaluate(el=>el===document.activeElement),'Closing the collection returns focus to My garage');
  await page.setViewportSize({width:390,height:550});await settle(page);await fitsShell(page,'phone keyboard-height viewport');await hitTest(page.locator('[data-bike-save]'),'save after viewport shrink');
  await page.setViewportSize({width:844,height:390});await settle(page);await fitsShell(page,'rotated phone');
  assert.equal(await page.locator('[data-bike-name]').inputValue(),'Keep this unfinished bike','Rotation and resizing preserve the current draft');
}
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH});
  try {
    const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});page.setDefaultTimeout(10000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',routeLocal);await boot(page);
    for(const role of ['coach','rider'])for(const [width,height] of [[390,844],[1024,768],[844,390],[320,650]])for(const theme of ['dark','light'])await checkLayout(page,role,width,height,theme);
    await checkCollection(page);
    await page.setViewportSize({width:1024,height:768});
    await page.evaluate(()=>{JKCrewBikeGarage.destroy();const view=document.querySelector('#view');view.dataset.view='home';view.innerHTML='<section><h1>Dashboard</h1></section>';});
    await settle(page);
    assert(await page.locator('#install-app').isVisible(),'The install prompt remains available after returning to another app page');
    assert.deepEqual(errors,[]);
    assert(await page.evaluate(()=>layoutCalls.every(call=>['get_bike_garage','delete_bike_build'].includes(call.method))&&layoutCalls.filter(call=>call.method==='delete_bike_build').length===1),'Layout tests only read fake builds and exercise one rejected mock deletion');
    console.log('PASS: real shell, stable bike/navigation/save, isolated settings scroll, touch targets, draft retention, collection dialog, resized phone/tablet layouts, and scoped install-prompt visibility.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
