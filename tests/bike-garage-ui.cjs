const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const { PNG } = require(require.resolve('pngjs', {paths:[path.dirname(require.resolve(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright'))]}));
const root = path.resolve(__dirname, '..');
const fixtureHtml = '<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"><div class="app-shell coach-shell"><aside class="sidebar"><strong>JKCREW</strong></aside><div class="main-wrap"><main id="view" class="content" data-view="bikeGarage"></main></div></div></div></body></html>';
const fixtureScript = `
window.cloud = {}; window.rpcCalls = []; window.rpcModes = []; window.pendingRpc = [];
window.currentUser = 'rider-a'; window.backCalls = 0; window.confirmCalls = []; window.confirmAnswer = true;
window.confirm = message => { confirmCalls.push(message); return confirmAnswer; };
const clone = value => JSON.parse(JSON.stringify(value));
function reply(method,args,owner) {
  const rows = cloud[owner] ||= [];
  if (method==='get_bike_garage') return {data:{builds:clone(rows)}};
  const row = rows.find(row=>row.slot===args.p_slot);
  if ((row?.revision||0)!==args.p_expected_revision) return {error:{code:'40001',message:'Garage space changed on another device'}};
  if (method==='save_bike_build') {
    const saved = {slot:args.p_slot,name:args.p_name,configuration:clone(args.p_configuration),revision:(row?.revision||0)+1,updated_at:new Date().toISOString()};
    cloud[owner]=[...rows.filter(row=>row.slot!==args.p_slot),saved].sort((a,b)=>a.slot-b.slot);
    return {data:clone(saved)};
  }
  if (method==='delete_bike_build') {cloud[owner]=rows.filter(row=>row.slot!==args.p_slot);return {data:{deleted:true}};}
  throw new Error('Unexpected RPC: '+method);
}
const client = { rpc(method,args) {
  const owner=currentUser; rpcCalls.push({method,args:args?clone(args):null,owner});
  const index=rpcModes.findIndex(mode=>mode.method===method);
  const mode=index<0?{}:rpcModes.splice(index,1)[0];
  if(mode.type==='hold') return new Promise(resolve=>pendingRpc.push({method,owner,resolve:()=>resolve(reply(method,args,owner))}));
  if(mode.type==='commit-error') {reply(method,args,owner);return Promise.resolve({error:{code:'NETWORK',message:'Reply lost after commit'}});}
  if(mode.type==='error') return Promise.resolve({error:{code:mode.code||'NETWORK',message:mode.message||'Connection interrupted'}});
  if(mode.type==='invalid') return Promise.resolve({data:{}});
  return Promise.resolve(reply(method,args,owner));
}};
function mountGarage(owner='rider-a') {
  currentUser=owner;
  JKCrewBikeGarage.mount({root:document.querySelector('#view'),client,userId:owner,isCurrent:()=>currentUser===owner,onBack:()=>backCalls++});
}
`;
// Allow only local artwork into this fixture; no app APIs or external hosts.
const artworkMime = {'.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg','.avif':'image/avif','.svg':'image/svg+xml'};
async function serveFixture(route, servedAssets, assetGate) {
  try {
    const url=new URL(route.request().url());
    if(url.origin!=='https://jkcrew.fixture'||route.request().method()!=='GET')return route.abort();
    if(url.pathname==='/garage')return route.fulfill({contentType:'text/html',body:fixtureHtml});
    const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
    if(!file.startsWith(root+path.sep)||!artworkMime[path.extname(file).toLowerCase()]||!fs.existsSync(file))return route.abort();
    const actual=fs.realpathSync(file),base=fs.realpathSync(root);
    if(!actual.startsWith(base+path.sep)||!fs.statSync(actual).isFile())return route.abort();
    servedAssets.push(url.pathname);
    if(assetGate && await assetGate(url.pathname)===false)return route.abort();
    return route.fulfill({contentType:artworkMime[path.extname(file).toLowerCase()],body:fs.readFileSync(actual)});
  }catch{return route.abort();}
}
async function waitForArtwork(page,selector='[data-bike-art], .bike-fullscreen') {
  await page.waitForFunction(selector=>[...document.querySelectorAll(selector)].every(root=>root.getAttribute('aria-busy')!=='true'&&root.querySelector('.jkcrew-bike-art')),selector);
  return page.evaluate(async selector=>{
    const elements=[...document.querySelectorAll(selector)].flatMap(root=>[root,...root.querySelectorAll('*')]);
    const sources=new Set();
    const add=value=>{if(!value||value.startsWith('#'))return;const url=new URL(value,document.baseURI);if(url.pathname===location.pathname&&url.hash)return;sources.add(url.href);};
    for(const el of elements){
      if(el instanceof HTMLImageElement)add(el.currentSrc||el.src);
      if(el.tagName.toLowerCase()==='image')add(el.getAttribute('href')||el.getAttributeNS('http://www.w3.org/1999/xlink','href'));
      const css=getComputedStyle(el);
      for(const value of [css.backgroundImage,css.maskImage,css.webkitMaskImage])for(const match of (value||'').matchAll(/url\(["']?([^"')]+)["']?\)/g))add(match[1]);
    }
    await Promise.all([...sources].map(async src=>{const image=new Image();image.src=src;await image.decode();if(!image.naturalWidth)throw new Error('Artwork failed to load: '+src);}));
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    return [...sources];
  },selector);
}
function visiblePixelChanges(before,after) {
  const a=PNG.sync.read(before),b=PNG.sync.read(after);
  assert.equal(a.width,b.width,'Compared previews have the same width');assert.equal(a.height,b.height,'Compared previews have the same height');
  let changed=0;
  // Chrome may round an otherwise identical filtered/photo pixel by one channel
  // value after repaint. Ignore only that observed raster noise, not real changes.
  for(let i=0;i<a.data.length;i++)if(Math.abs(a.data[i]-b.data[i])>1)changed++;
  return changed;
}
async function displayedBike(page) {
  // Keep the selected part unchanged, remove transient focus/hover decoration,
  // and compare real rendered pixels rather than SVG tubes or mask internals.
  await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);});await page.mouse.move(0,0);
  await waitForArtwork(page);
  return page.locator('[data-bike-art]').screenshot({animations:'disabled',caret:'hide'});
}
const frameIndicator = page => page.locator('[data-bike-frame-colour]').evaluate(el=>{
  const channels=getComputedStyle(el).backgroundColor.match(/\d+/g).slice(0,3);
  return '#'+channels.map(value=>Number(value).toString(16).padStart(2,'0')).join('').toUpperCase();
});
async function boot(page,{waitForPhotos=true}={}) {
  await page.goto('https://jkcrew.fixture/garage');
  for(const file of ['styles.css','bike-garage.css']) await page.addStyleTag({content:fs.readFileSync(path.join(root,file),'utf8')});
  for(const file of ['bike-config.js','bike-seat-designs.js','bike-photo-masks.js','bike-renderer.js','bike-garage.js']) await page.addScriptTag({content:fs.readFileSync(path.join(root,file),'utf8')});
  await page.addScriptTag({content:fixtureScript});
  await page.evaluate(()=>mountGarage());
  await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);
  if(waitForPhotos)await waitForArtwork(page);
}
// Check the actual bike texture, not just gallery thumbnails. A seat choice must
// never recolour the frame, seatpost, wheels or backdrop around its silhouette.
async function checkSeatArtwork(browser) {
  const page=await browser.newPage({viewport:{width:1536,height:1024},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>serveFixture(route,[]));
  try {
    await page.goto('https://jkcrew.fixture/garage');
    await page.addStyleTag({content:'html,body{margin:0;width:1536px;height:1024px}#art{width:1536px}'});
    await page.evaluate(()=>{document.body.innerHTML='<div id="art"></div>';});
    for(const file of ['bike-config.js','bike-seat-designs.js','bike-photo-masks.js','bike-renderer.js'])await page.addScriptTag({content:fs.readFileSync(path.join(root,file),'utf8')});
    const ids=await page.evaluate(()=>JKCrewBikeSeats.designs.map(design=>design.id));
    const render=async(id,seatStyle='slim')=>{
      const untouched=await page.evaluate(async({id,seatStyle})=>{
        const configuration=JKCrewBikeConfig.normalize({...JKCrewBikeConfig.defaults,seatDesign:id,seatStyle});
        const before=JSON.stringify(configuration);
        await JKCrewBikeArt.prepare(configuration);
        document.querySelector('#art').innerHTML=JKCrewBikeArt.render(configuration,{idPrefix:'seat-material-test'});
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        return JSON.stringify(configuration)===before;
      },{id,seatStyle});
      assert(untouched,'Rendering a seat never mutates the saved configuration');
      return PNG.sync.read(await page.locator('#art').screenshot({animations:'disabled'}));
    };
    const solid=await render('solid'),hashes=new Set();
    const seatBox={x:438,y:302,right:682,bottom:414}; // includes both photographed seat silhouettes, not the seatpost
    function inspectSeat(pixels,baseline,label){
      assert.equal(pixels.width,1536);assert.equal(pixels.height,1024);
      const painted=[];let changed=0,outside=0;
      for(let y=0;y<pixels.height;y++)for(let x=0;x<pixels.width;x++){
        const i=(y*pixels.width+x)*4,inSeat=x>=seatBox.x&&x<=seatBox.right&&y>=seatBox.y&&y<=seatBox.bottom;
        const diff=[0,1,2].some(c=>Math.abs(pixels.data[i+c]-baseline.data[i+c])>1);
        if(inSeat){painted.push(pixels.data[i],pixels.data[i+1],pixels.data[i+2]);if(diff)changed++;}
        else if(diff)outside++;
      }
      assert(changed>100,`${label}: its material appears on the actual bike seat`);
      assert.equal(outside,0,`${label}: material stays on the seat without altering nearby parts/background`);
      return createHash('sha256').update(Buffer.from(painted)).digest('hex');
    }
    for(const id of ids)hashes.add(inspectSeat(await render(id),solid,id));
    assert.equal(ids.length,50);assert.equal(hashes.size,50,'Every design is visually distinct on the actual slim bike seat');
    const padded=await render('solid','padded');
    for(const id of ['design-01','design-23','design-50'])inspectSeat(await render(id,'padded'),padded,`${id}/padded`);
    assert.deepEqual(errors,[]);
    console.log('PASS: all fifty actual seat materials are distinct, slim/padded silhouettes contain their paint, and rendering preserves saved configuration.');
  } finally {await page.close();}
}
async function checkLegacyDraftUpgrade(page) {
  await page.evaluate(()=>{
    const parts=['frame','fork','bars','grips','rims','hubs','seat','pedals','cranks','sprocket'];
    window.fingerprintLegacy={version:1,colors:Object.fromEntries(parts.map(part=>[part,part==='frame'?'#AD8AFF':'#F1F4F8'])),barStyle:'four-piece',tyreStyle:'tan-wall',seatStyle:'padded',pegs:'both',decal:'jkcrew'};
    const name='Saved before the parts update',configuration=clone(fingerprintLegacy);
    cloud['legacy-clean-fingerprint']=[{slot:1,name,configuration,revision:7,updated_at:new Date().toISOString()}];
    localStorage.setItem('jkcrew-bike-draft-v1:legacy-clean-fingerprint',JSON.stringify({name,configuration,slot:1,revision:7,savedFingerprint:JSON.stringify({name,configuration}),pendingSave:null}));
    mountGarage('legacy-clean-fingerprint');
  });
  await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);await waitForArtwork(page);
  assert.equal(await page.locator('[data-bike-status]').textContent(),'Saved to your garage','A clean v1 fingerprint remains clean after normalisation');
  const writes=await page.evaluate(()=>rpcCalls.filter(call=>call.method==='save_bike_build').length);
  const prompts=await page.evaluate(()=>confirmCalls.length);
  await page.locator('[data-bike-garage] summary').click();await page.locator('[data-bike-load="1"]').click();
  assert.equal(await page.evaluate(()=>confirmCalls.length),prompts,'Opening an unchanged legacy draft does not prompt about false unsaved changes');
  assert.equal(await page.evaluate(()=>cloud['legacy-clean-fingerprint'][0].configuration.version),1,'Local normalisation does not automatically migrate the saved row');
  await page.evaluate(()=>{
    const name='Committed by the old app',configuration=clone(fingerprintLegacy);
    cloud['legacy-pending-fingerprint']=[{slot:1,name,configuration,revision:1,updated_at:new Date().toISOString()}];
    const newer=clone(configuration);newer.colors.frame='#F2BC57';
    localStorage.setItem('jkcrew-bike-draft-v1:legacy-pending-fingerprint',JSON.stringify({name:'Newer local idea',configuration:newer,slot:null,revision:0,savedFingerprint:'',pendingSave:{slot:1,expectedRevision:0,name,configuration}}));
    mountGarage('legacy-pending-fingerprint');
  });
  await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);await waitForArtwork(page);
  const recovered=await page.evaluate(()=>JSON.parse(localStorage.getItem('jkcrew-bike-draft-v1:legacy-pending-fingerprint')));
  assert.equal(recovered.pendingSave,null);assert.equal(recovered.slot,1);assert.equal(recovered.revision,1);
  assert.equal(recovered.configuration.version,2);assert.equal(recovered.configuration.colors.frame,'#F2BC57');assert.equal(recovered.name,'Newer local idea','Recovering a v1 pending save preserves newer local edits');
  assert.equal(await page.evaluate(()=>rpcCalls.filter(call=>call.method==='save_bike_build').length),writes,'Legacy fingerprint recovery itself never writes');
  await page.locator('[data-bike-save]').click();await page.getByText('Saved to your garage ✓',{exact:true}).waitFor();
  const updated=await page.evaluate(()=>({call:rpcCalls.filter(call=>call.method==='save_bike_build').at(-1),rows:cloud['legacy-pending-fingerprint']}));
  assert.equal(updated.call.args.p_expected_revision,1);assert.equal(updated.call.args.p_configuration.version,2);
  assert.equal(updated.rows.length,1);assert.equal(updated.rows[0].revision,2,'Saving after recovery edits the committed slot instead of creating a duplicate');
  console.log('PASS: v1 clean fingerprints and uncertain-save recovery preserve local edits without false prompts or duplicate builds.');
}
async function checkExpandedParts(page) {
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(()=>{document.querySelector('.app-shell').className='app-shell coach-shell';document.documentElement.dataset.theme='dark';mountGarage('expanded-parts');});
  await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);await waitForArtwork(page);
  const draft=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('jkcrew-bike-draft-v1:expanded-parts')));
  const config=async()=>(await draft()).configuration;
  const select=async part=>{const target=page.locator(`[data-bike-art] [data-bike-part="${part}"]`).first();await target.focus();await target.press('Enter');await waitForArtwork(page);};
  const click=async selector=>{await page.locator(selector).click();await waitForArtwork(page);};
  for(const part of ['seatpost','stem','headset','spokes','nipples','pegs']) {
    await select(part);
    if(part==='pegs')await click('[data-bike-style="four"]');
    if(await page.locator('[data-bike-finish="gloss"]').count())await click('[data-bike-finish="gloss"]');
    const before=await displayedBike(page);await click('[data-bike-colour="#F26879"]');
    assert.equal((await config()).colors[part],'#F26879');
    assert(visiblePixelChanges(before,await displayedBike(page))>5,`${part} colour changes the actual displayed hardware`);
  }
  await select('frame');await click('[data-bike-colour="#428CFF"]');
  for(const finish of ['matte','chrome','raw','jetfuel','gloss']) {
    const before=await displayedBike(page);await click(`[data-bike-finish="${finish}"]`);
    assert.equal((await config()).finishes.frame,finish);
    assert(visiblePixelChanges(before,await displayedBike(page))>20,`${finish} visibly changes the frame material`);
  }
  await click('[data-bike-option="framePaint"][data-bike-value="fade"]');
  const beforeFade=await displayedBike(page);
  await page.locator('[data-bike-fade-colour]').evaluate(input=>{input.value='#f2bc57';input.dispatchEvent(new Event('change',{bubbles:true}));});
  assert.equal((await config()).frameFadeColor,'#F2BC57');assert(visiblePixelChanges(beforeFade,await displayedBike(page))>20,'The second colour changes the visible frame fade');
  await click('[data-bike-finish="chrome"]');assert.equal((await config()).framePaint,'solid','Metal finishes clear an incompatible fade');
  await click('[data-bike-option="framePaint"][data-bike-value="fade"]');assert.equal((await config()).finishes.frame,'gloss','Selecting a fade restores a paintable finish');
  for(const [part,key,values] of [['pedals','pedalMaterial',['metal','plastic','metal']],['stem','stemStyle',['front-load','top-load','front-load']],['brakes','brakeStyle',['rear','dual','none','dual']],['spokes','spokeStyle',['rainbow','standard','rainbow']]]) {
    await select(part);
    for(const value of values){const before=await displayedBike(page);await click(`[data-bike-style="${value}"]`);assert.equal((await config())[key],value);assert(visiblePixelChanges(before,await displayedBike(page))>5,`${key}/${value} changes actual artwork`);}
  }
  for(const [part,finish] of [['stem','jetfuel'],['hubs','chrome'],['cranks','raw'],['rims','matte']]){await select(part);await click(`[data-bike-finish="${finish}"]`);}
  await select('seat');
  const catalogue=await page.evaluate(()=>JKCrewBikeSeats.designs.map(({id,category})=>({id,category})));
  assert.equal(catalogue.length,50);const found=[],thumbnails=new Set();
  const sampleIds=new Set(['design-01','design-09','design-23','design-50']);
  for(let pageNumber=0;pageNumber<7;pageNumber++) {
    const tiles=page.locator('.bike-seat-grid [data-bike-seat-design]');const ids=await tiles.evaluateAll(nodes=>nodes.map(node=>node.dataset.bikeSeatDesign));
    assert(ids.length>0&&ids.length<=8,'Seat designs are shown in pages of at most eight');
    for(const id of ids) {
      found.push(id);
      const pixels=PNG.sync.read(await page.locator(`[data-bike-seat-design="${id}"] .bike-seat-thumb`).screenshot({animations:'disabled'}));
      thumbnails.add(createHash('sha256').update(pixels.data).digest('hex'));
      if(sampleIds.has(id)){const before=await displayedBike(page);await click(`[data-bike-seat-design="${id}"]`);assert.equal((await config()).seatDesign,id);assert(visiblePixelChanges(before,await displayedBike(page))>20,`${id} visibly appears on the bike seat`);}
    }
    const next=page.locator('[data-bike-seat-page="1"]');
    if(pageNumber===6)assert(await next.isDisabled());else{assert(await next.isEnabled());await next.click();}
  }
  assert.deepEqual(found,catalogue.map(item=>item.id),'Every one of the fifty designs is reachable through real pagination');
  assert.equal(thumbnails.size,50,'All fifty thumbnails have genuinely different rendered pixels');
  for(const category of [...new Set(catalogue.map(item=>item.category))]) {
    await page.locator('[data-bike-seat-category]').selectOption(category);
    assert(await page.locator('[data-bike-seat-page="-1"]').isDisabled(),'Changing collection resets pagination');
    const visible=await page.locator('.bike-seat-grid [data-bike-seat-design]').evaluateAll(nodes=>nodes.map(node=>node.dataset.bikeSeatDesign));
    assert(visible.length&&visible.every(id=>catalogue.some(item=>item.id===id&&item.category===category)),'A seat collection only shows its matching designs');
  }
  await page.locator('[data-bike-seat-category]').selectOption('All');
  assert.equal((await config()).seatDesign,'design-50','Browsing collections preserves the chosen design');
  await page.getByRole('textbox',{name:'NAME YOUR BUILD',exact:true}).fill('Complete v2 workshop');
  const expected=await config();assert.equal(expected.version,2);assert.equal(Object.keys(expected.colors).length,16);assert.equal(expected.pegs,'four');
  assert.equal(await page.evaluate(()=>rpcCalls.filter(call=>call.owner==='expanded-parts'&&call.method==='save_bike_build').length),0,'Part and design browsing never saves automatically');
  await page.locator('[data-bike-save]').click();await page.getByText('Saved to your garage ✓',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>cloud['expanded-parts'][0].configuration),expected,'Saving round-trips every v2 option');
  await page.evaluate(()=>mountGarage('expanded-parts'));await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);await waitForArtwork(page);
  assert.deepEqual(await config(),expected,'Reopening the workshop preserves all v2 options');
  assert.equal(await page.locator('[data-bike-status]').textContent(),'Saved to your garage');
  await page.getByRole('textbox',{name:'NAME YOUR BUILD',exact:true}).fill('Kept during v2 conflict');
  await page.evaluate(()=>{const row=cloud['expanded-parts'][0];row.revision++;row.configuration.seatDesign='design-01';});
  await page.locator('[data-bike-save]').click();await page.getByText(/garage space changed on another device/).waitFor();
  assert.deepEqual(await config(),expected,'A v2 revision conflict preserves the local design');
  await page.getByRole('button',{name:'Refresh garage',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);
  await page.locator('[data-bike-garage] summary').click();await page.locator('[data-bike-load="1"]').click();
  assert.deepEqual(await config(),{...expected,seatDesign:'design-01'},'Opening the current cloud revision preserves its full v2 configuration');
  await page.getByRole('textbox',{name:'NAME YOUR BUILD',exact:true}).fill('Updated v2 workshop');await page.locator('[data-bike-save]').click();await page.getByText('Saved to your garage ✓',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>rpcCalls.filter(call=>call.method==='save_bike_build').at(-1).args.p_expected_revision),2);
  await select('seat');
  for(const width of [320,390,1024])for(const theme of ['dark','light']) {
    await page.setViewportSize({width,height:900});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    const layout=await page.locator('.bike-garage').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,page:document.documentElement.scrollWidth,viewport:innerWidth}));
    assert(layout.scroll<=layout.width+1&&layout.page<=layout.viewport+1,`${width}/${theme}: new controls and seat gallery fit without horizontal overflow`);
    const selectFont=await page.locator('[data-bike-seat-category]').evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
    assert(selectFont>=16,`${width}/${theme}: seat collection select avoids mobile autozoom (${selectFont}px)`);
    if(width===390&&theme==='dark')await page.screenshot({path:'/tmp/bike-garage-v2-seat-gallery.png',fullPage:true});
  }
  console.log('PASS: sixteen colour parts, material finishes, fade, hardware choices, fifty distinct seats, v2 save/reopen/conflicts and narrow gallery layouts.');
}
async function checkPhotoLoading(browser) {
  const errors=[],servedAssets=[];
  const create=async gate=>{
    const page=await browser.newPage({viewport:{width:390,height:900}});page.setDefaultTimeout(6000);
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>serveFixture(route,servedAssets,gate));return page;
  };
  const writes=page=>page.evaluate(()=>rpcCalls.filter(call=>call.method!=='get_bike_garage').length);
  const checkUnavailable=async page=>{
    assert(await page.getByRole('button',{name:'Expand bike preview',exact:true}).isDisabled());
    assert(await page.getByRole('button',{name:'Electric blue frame',exact:true}).isDisabled());
    assert.equal(await writes(page),0,'Photo loading/retry never writes a build');
  };

  // A failed real image request exposes a photo-only retry and retains the draft.
  let failPhoto=true;
  const failed=await create(()=>!failPhoto);
  try {
    await boot(failed,{waitForPhotos:false});await failed.getByRole('button',{name:'Retry photo',exact:true}).waitFor();
    assert.equal(await failed.locator('[data-bike-art]').getAttribute('aria-busy'),'false');await checkUnavailable(failed);
    await failed.getByRole('textbox',{name:'NAME YOUR BUILD',exact:true}).fill('Kept while photo is offline');
    const calls=await failed.evaluate(()=>rpcCalls.length);failPhoto=false;
    await failed.getByRole('button',{name:'Retry photo',exact:true}).click();await waitForArtwork(failed);
    assert.equal(await failed.getByRole('textbox',{name:'NAME YOUR BUILD',exact:true}).inputValue(),'Kept while photo is offline');
    assert.equal(await failed.evaluate(()=>rpcCalls.length),calls,'Retry photo does not reload or mutate garage data');
    assert(await failed.locator('[data-bike-photo-status]').isHidden());
    assert(await failed.getByRole('button',{name:'Expand bike preview',exact:true}).isEnabled());
    await failed.getByRole('button',{name:'Electric blue frame',exact:true}).click();assert.equal(await frameIndicator(failed),'#428CFF');
  } finally {await failed.close();}

  // A request that never replies releases the loading state after 12 seconds.
  let releasePhoto;const heldPhoto=new Promise(resolve=>{releasePhoto=resolve;});let holdPhoto=true;
  const timeout=await create(async()=>{if(holdPhoto)await heldPhoto;return true;});
  try {
    await timeout.clock.install();await boot(timeout,{waitForPhotos:false});
    assert.equal(await timeout.locator('[data-bike-art]').getAttribute('aria-busy'),'true');
    assert(await timeout.getByText('Loading your bike…',{exact:true}).isVisible());await checkUnavailable(timeout);
    await timeout.clock.fastForward(12001);await timeout.getByRole('button',{name:'Retry photo',exact:true}).waitFor();await checkUnavailable(timeout);
    holdPhoto=false;releasePhoto();await timeout.getByRole('button',{name:'Retry photo',exact:true}).click();await waitForArtwork(timeout);
    assert(await timeout.getByRole('button',{name:'Expand bike preview',exact:true}).isEnabled());assert.equal(await writes(timeout),0);
  } finally {holdPhoto=false;releasePhoto();await timeout.close();}

  // The optional photograph may finish after switching accounts or leaving the page.
  for(const action of ['account','dispose']) {
    let releaseOptions;const optionsReady=new Promise(resolve=>{releaseOptions=resolve;});
    const stale=await create(async url=>{if(url.endsWith('studio-options-v1.webp'))await optionsReady;return true;});
    try {
      await boot(stale);
      await stale.locator('[data-bike-art] [data-bike-part="bars"]').focus();await stale.locator('[data-bike-art] [data-bike-part="bars"]').press('Enter');
      await stale.getByRole('button',{name:'Four piece',exact:true}).click();
      assert.equal(await stale.locator('[data-bike-art]').getAttribute('aria-busy'),'true');
      if(action==='account') {
        await stale.evaluate(()=>mountGarage('photo-new-account'));await stale.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);
        await stale.getByRole('textbox',{name:'NAME YOUR BUILD',exact:true}).fill('New account stays separate');
      } else await stale.evaluate(()=>{JKCrewBikeGarage.destroy();document.querySelector('#view').innerHTML='<p>Outside the garage</p>';});
      const before=await stale.locator('#view').innerHTML();releaseOptions();
      await stale.evaluate(()=>JKCrewBikeArt.prepare({barStyle:'four-piece'}));
      await stale.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      assert.equal(await stale.locator('#view').innerHTML(),before,`Late optional photo cannot repaint after ${action}`);
      assert.equal(await writes(stale),0);
      if(action==='account')assert.equal(await stale.getByRole('textbox',{name:'NAME YOUR BUILD',exact:true}).inputValue(),'New account stays separate');
    } finally {releaseOptions();await stale.close();}
  }
  assert.deepEqual(errors,[],'Photo errors/retries/disposal cause no uncaught JavaScript errors');
  console.log('PASS: real photo loading, retry, bounded timeout, draft retention, and stale account/disposal guards.');
}
async function checkStickyPreview(page) {
  for(const [width,height] of [[390,900],[320,650]]) {
    await page.setViewportSize({width,height});
    await page.locator('.bike-palette').evaluate((el,height)=>{const bounds=el.getBoundingClientRect();window.scrollBy(0,bounds.top-(height>700?500:410));},height);
    const sticky=await page.locator('.bike-stage').evaluate(el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,position:getComputedStyle(el).position};});
    assert.equal(sticky.position,'sticky');assert(Math.abs(sticky.top-78)<2,`${width} phone bike stays pinned at 78px (${sticky.top})`);
    const swatch=page.getByRole('button',{name:'Electric blue frame',exact:true});
    const clear=await swatch.evaluate(el=>{const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {y,visible:y>0&&y<innerHeight,hit:el.contains(document.elementFromPoint(x,y))};});
    const blank=page.getByRole('button',{name:'+ Blank bike',exact:true});
    assert(await blank.isVisible());assert((await blank.boundingBox()).height>=44,'Sticky Blank bike control keeps a full touch target');
    assert(clear.visible&&clear.y>sticky.bottom&&clear.hit,`${width}: sticky bike leaves the palette visible and tappable`);
    await swatch.click();await waitForArtwork(page);assert.equal(await frameIndicator(page),'#428CFF');
    if(width===390)await page.screenshot({path:'/tmp/bike-garage-phone-editing.png'});
    await page.getByRole('button',{name:'Undo last change',exact:true}).click();
  }
}
async function run(page) {
  for(const [width,name] of [[390,'phone'],[1440,'desktop']]) {
    await page.setViewportSize({width,height:900});
    await page.evaluate(()=>window.scrollTo(0,0));
    await waitForArtwork(page);await page.screenshot({path:`/tmp/bike-garage-${name}.png`,fullPage:true});
    await page.getByRole('button',{name:'Expand bike preview',exact:true}).click();
    await waitForArtwork(page);await page.screenshot({path:`/tmp/bike-garage-photo-${name}-preview.png`});
    await page.getByRole('button',{name:'Close bike preview',exact:true}).click();await page.locator('.bike-fullscreen').waitFor({state:'detached'});
  }
  console.log('Screenshots ready: /tmp/bike-garage-phone.png and /tmp/bike-garage-desktop.png');
  if(process.env.JKCREW_BIKE_SCREENSHOTS_ONLY) return;
  await checkStickyPreview(page);
  if(process.env.JKCREW_BIKE_STICKY_ONLY) return;
  const draft = () => page.evaluate(()=>JSON.parse(localStorage.getItem(`jkcrew-bike-draft-v1:${currentUser}`)||'null'));
  const config = async () => (await draft()).configuration;
  const nameField = () => page.getByRole('textbox',{name:'NAME YOUR BUILD',exact:true});
  const count = method => page.evaluate(method=>rpcCalls.filter(call=>call.method===method).length,method);
  const save = async () => {await page.locator('[data-bike-save]').click();await page.getByText('Saved to your garage ✓',{exact:true}).waitFor();};
  const refresh = async () => {await page.getByRole('button',{name:'Refresh garage',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);};
  const selectPart = async part => {const button=page.locator(`[data-bike-art] [data-bike-part="${part}"]`).first();await button.focus();await button.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement?.dataset.bikePart),part,'Keyboard selection retains bike-part focus');};
  const frameColour = () => frameIndicator(page);
  const shelf = async () => {if(!await page.locator('[data-bike-garage]').evaluate(el=>el.open))await page.locator('[data-bike-garage] summary').click();};
  assert.equal(await page.locator('[data-bike-garage]').evaluate(el=>el.open),false,'Collection starts closed');
  assert.equal(await count('save_bike_build'),0);assert.equal(await count('delete_bike_build'),0);
  const neutralDefaults=await page.evaluate(()=>JKCrewBikeGarage.defaults);
  assert.equal(neutralDefaults.version,2);assert.equal(Object.keys(neutralDefaults.colors).length,16);
  for(const part of ['frame','fork','bars','grips','rims','hubs','seat','pedals','cranks','sprocket'])assert.equal(neutralDefaults.colors[part],'#F1F4F8','Existing blank-bike parts stay neutral white');
  for(const part of ['seatpost','stem','headset','spokes','nipples','pegs'])assert.equal(neutralDefaults.colors[part],'#BCC7D6','New hardware starts silver/chrome');
  assert.equal(neutralDefaults.tyreStyle,'white');assert.equal(neutralDefaults.pegs,'none');assert.equal(neutralDefaults.decal,'none');
  assert.equal(await page.locator('[data-bike-new]').count(),1,'Only one Blank bike action exists');
  assert(await page.locator('.bike-stage-top').getByRole('button',{name:'+ Blank bike',exact:true}).isVisible(),'Blank bike is available while the garage shelf is closed');
  const normalized=await page.evaluate(()=>JKCrewBikeGarage.normalize({colors:{frame:'#abcd12',fork:'url(secret)',unrelated:'#000000'},barStyle:'unsupported',pegs:'rear',private_data:'never'}));
  assert.equal(normalized.colors.frame,'#ABCD12');assert.equal(normalized.colors.fork,'#F1F4F8');assert.equal(normalized.barStyle,'two-piece');assert.equal(normalized.pegs,'rear');assert(!('private_data' in normalized));assert(!('unrelated' in normalized.colors));

  // Existing colourful bikes retain their saved appearance; Blank bike affects only the draft.
  await page.evaluate(()=>{
    window.legacyBike={version:1,colors:{frame:'#AD8AFF',fork:'#252B39',bars:'#252B39',grips:'#AD8AFF',rims:'#BCC7D6',hubs:'#AD8AFF',seat:'#252B39',pedals:'#AD8AFF',cranks:'#BCC7D6',sprocket:'#AD8AFF'},barStyle:'four-piece',tyreStyle:'tan-wall',seatStyle:'padded',pegs:'both',decal:'jkcrew'};
    cloud['legacy-bike']=[{slot:1,name:'Existing coloured bike',configuration:clone(legacyBike),revision:7,updated_at:new Date().toISOString()}];mountGarage('legacy-bike');
  });
  await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);await shelf();await page.locator('[data-bike-load="1"]').click();
  assert.deepEqual(await config(),await page.evaluate(()=>JKCrewBikeConfig.normalize(legacyBike)),'Opening a v1 bike preserves its previous colours/options and fills the new part fields');
  assert.equal(await frameColour(),'#AD8AFF');
  await page.evaluate(()=>mountGarage('legacy-bike'));await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);
  assert.deepEqual(await config(),await page.evaluate(()=>JKCrewBikeConfig.normalize(legacyBike)),'Remount preserves existing saved colours and styles');
  const originalSavedRows=await page.evaluate(()=>JSON.stringify(cloud['legacy-bike']));
  await nameField().fill('Unfinished custom idea');await page.getByRole('button',{name:'Pink frame',exact:true}).click();
  const unfinished=await draft();const writesBeforeBlank=await count('save_bike_build');
  await page.evaluate(()=>confirmAnswer=false);await page.getByRole('button',{name:'+ Blank bike',exact:true}).click();
  assert.deepEqual(await draft(),unfinished,'Cancelling Blank bike preserves all draft state');assert.equal(await nameField().inputValue(),'Unfinished custom idea');
  await page.evaluate(()=>confirmAnswer=true);await page.getByRole('button',{name:'+ Blank bike',exact:true}).click();
  assert.deepEqual(await config(),neutralDefaults,'Confirmed Blank bike resets every part/style to neutral defaults');
  assert.equal(await nameField().inputValue(),'My dream bike');assert.equal((await draft()).slot,null);assert.equal((await draft()).revision,0);assert.equal((await draft()).pendingSave,null);
  assert(await page.getByRole('button',{name:'Undo last change',exact:true}).isDisabled());assert(await page.getByRole('button',{name:'Redo change',exact:true}).isDisabled());
  assert.equal(await count('save_bike_build'),writesBeforeBlank,'Blank bike never writes to the garage automatically');
  assert.equal(await page.evaluate(()=>JSON.stringify(cloud['legacy-bike'])),originalSavedRows,'Existing saved rows remain intact after Blank bike');
  await nameField().fill('White studio build');await save();
  assert.equal(await page.evaluate(()=>cloud['legacy-bike'].length),2);assert.deepEqual(await page.evaluate(()=>cloud['legacy-bike'].find(row=>row.slot===2).configuration),neutralDefaults,'All-white tyres and parts survive save roundtrip');
  await page.evaluate(()=>mountGarage('legacy-bike'));await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);await shelf();
  await page.locator('[data-bike-load="1"]').click();assert.deepEqual(await config(),await page.evaluate(()=>JKCrewBikeConfig.normalize(legacyBike)));
  await page.locator('[data-bike-load="2"]').click();assert.deepEqual(await config(),neutralDefaults,'Opening the saved white build retains white tyres');
  await page.evaluate(()=>mountGarage('rider-a'));await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);

  const savesBeforeEditing=await count('save_bike_build');

  // Changes repaint real displayed materials; selection remains keyboard-accessible.
  await page.setViewportSize({width:390,height:900});
  const originalColour=await frameColour();const originalPixels=await displayedBike(page);
  assert.equal(visiblePixelChanges(originalPixels,await displayedBike(page)),0,'Repeated unchanged artwork has stable pixels');
  await page.getByRole('button',{name:'Electric blue frame',exact:true}).click();
  assert.equal(await frameColour(),'#428CFF');assert.equal((await config()).colors.frame,'#428CFF');
  assert.equal(await page.evaluate(()=>document.activeElement?.dataset.bikeColour),'#428CFF','Palette repaint keeps keyboard focus');
  const bluePixels=await displayedBike(page);assert(visiblePixelChanges(originalPixels,bluePixels)>20,'Frame colour changes actual bike pixels');
  await page.getByRole('button',{name:'Undo last change',exact:true}).click();assert.equal(await frameColour(),originalColour);assert.equal(visiblePixelChanges(originalPixels,await displayedBike(page)),0,'Undo restores displayed material');
  await page.getByRole('button',{name:'Redo change',exact:true}).click();assert.equal(await frameColour(),'#428CFF');
  const redoPixels=await displayedBike(page),redoChanges=visiblePixelChanges(bluePixels,redoPixels);
  if(redoChanges){fs.writeFileSync('/tmp/bike-v2-blue-before.png',bluePixels);fs.writeFileSync('/tmp/bike-v2-blue-redo.png',redoPixels);}
  assert.equal(redoChanges,0,'Redo restores displayed material');
  for(const [part,label] of [['fork','forks'],['bars','handlebars'],['grips','grips'],['rims','rims'],['hubs','hubs'],['seat','seat'],['pedals','pedals'],['cranks','cranks'],['sprocket','sprocket']]) {
    await selectPart(part);const beforePixels=await displayedBike(page);await page.getByRole('button',{name:`Mint ${label}`,exact:true}).click();
    assert.equal((await config()).colors[part],'#7CE3B8');
    assert(visiblePixelChanges(beforePixels,await displayedBike(page))>20,`${label} changes the displayed bike material`);
  }
  for(const [part,key,choices] of [['bars','barStyle',[['Four piece','four-piece'],['Two piece','two-piece']]],['tyres','tyreStyle',[['Tan wall','tan-wall'],['White wall','white-wall'],['All black','black'],['All white','white']]],['seat','seatStyle',[['Padded','padded'],['Slim','slim']]],['pegs','pegs',[['1 rear peg','rear'],['2 pegs','both'],['No pegs','none']]],['decal','decal',[['Lightning','lightning'],['Clean frame','none'],['JKCREW','jkcrew']]]]) {
    await selectPart(part);
    for(const [label,value] of choices){const beforePixels=await displayedBike(page);await page.getByRole('button',{name:label,exact:true}).click();assert.equal((await config())[key],value);assert(visiblePixelChanges(beforePixels,await displayedBike(page))>20,`${label} changes displayed artwork`);}
  }
  await selectPart('frame');
  await page.getByRole('textbox',{name:'NAME YOUR BUILD',exact:true}).fill('Night Rider');
  const beforeCustomColour=await displayedBike(page);
  await page.getByLabel('Custom frame colour',{exact:true}).evaluate(input=>{input.value='#123abc';input.dispatchEvent(new Event('change',{bubbles:true}));});
  assert.equal(await frameColour(),'#123ABC');assert(visiblePixelChanges(beforeCustomColour,await displayedBike(page))>20,'Custom colour visibly changes the material');
  const firstConfig=await config();
  assert.equal(await count('save_bike_build'),savesBeforeEditing,'Editing never saves automatically');
  await page.evaluate(()=>mountGarage());await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);
  assert.equal(await nameField().inputValue(),'Night Rider');assert.deepEqual(await config(),firstConfig,'Unmount/remount restores local draft');
  await boot(page);assert.equal(await nameField().inputValue(),'Night Rider');assert.equal(await frameColour(),'#123ABC','Full page reload restores durable local draft');
  await page.evaluate(()=>mountGarage('rider-b'));await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);
  assert.equal(await nameField().inputValue(),'My dream bike');assert.equal(await frameColour(),'#F1F4F8');
  await nameField().fill('Rider B only');
  await page.evaluate(()=>mountGarage('rider-a'));await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);
  assert.equal(await nameField().inputValue(),'Night Rider','Accounts never inherit each other’s drafts');

  // Save exactly three private slots; copying does not overwrite the original.
  await save();assert.equal(await page.locator('[data-bike-count]').textContent(),'1 / 3');
  let calls=await page.evaluate(()=>rpcCalls.filter(call=>call.method==='save_bike_build'));
  assert.equal(calls.at(-1).args.p_slot,1);assert.equal(calls.at(-1).args.p_expected_revision,0);
  await nameField().fill('Acid Session');await page.getByRole('button',{name:'Acid frame',exact:true}).click();
  await page.getByRole('button',{name:'Save as new',exact:true}).click();await page.getByText('Saved to your garage ✓',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-bike-count]').textContent(),'2 / 3');
  assert.equal(await page.evaluate(()=>cloud['rider-a'][0].name),'Night Rider');
  await nameField().fill('Finals Bike');await page.getByRole('button',{name:'Coral frame',exact:true}).click();
  await page.getByRole('button',{name:'Save as new',exact:true}).click();await page.getByText('Saved to your garage ✓',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-bike-count]').textContent(),'3 / 3');assert(await page.getByRole('button',{name:'Save as new',exact:true}).isDisabled());
  await shelf();const fullSaveCount=await count('save_bike_build');await page.getByRole('button',{name:'+ Blank bike',exact:true}).click();await page.locator('[data-bike-save]').click();await page.getByText(/three garage spaces are full/).waitFor();assert.equal(await count('save_bike_build'),fullSaveCount,'A full garage cannot create a fourth slot');
  await page.locator('[data-bike-load="1"]').click();assert.equal(await nameField().inputValue(),'Night Rider');
  await nameField().fill('Night Rider II');await save();assert.equal(await page.evaluate(()=>cloud['rider-a'][0].revision),2);
  await page.evaluate(()=>mountGarage());await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);await shelf();
  assert.equal(await page.locator('.bike-saved-card').count(),3);assert.equal(await nameField().inputValue(),'Night Rider II');
  const beforeDelete=await count('delete_bike_build');
  await page.evaluate(()=>confirmAnswer=false);await page.getByRole('button',{name:'Remove Acid Session',exact:true}).click();
  assert.equal(await count('delete_bike_build'),beforeDelete,'Cancelled removal has no RPC');
  await page.evaluate(()=>confirmAnswer=true);await page.getByRole('button',{name:'Remove Acid Session',exact:true}).click();
  await page.getByText('Removed from your garage.',{exact:true}).waitFor();assert.equal(await page.locator('[data-bike-count]').textContent(),'2 / 3');
  assert.equal(await page.evaluate(()=>cloud['rider-a'].map(row=>row.slot).join(',')),'1,3');
  await nameField().fill('Space Two');await page.getByRole('button',{name:'Save as new',exact:true}).click();await page.getByText('Saved to your garage ✓',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>rpcCalls.filter(call=>call.method==='save_bike_build').at(-1).args.p_slot),2,'Freed slot is reused without touching others');

  // A failed save never claims success or enables blind retries against stale rows.
  await nameField().fill('Kept after failure');
  await page.evaluate(()=>rpcModes.push({method:'save_bike_build',type:'error'}));await page.locator('[data-bike-save]').click();
  await page.getByText(/The save wasn't confirmed/).waitFor();assert(await page.locator('[data-bike-save]').isDisabled());assert(await page.getByRole('button',{name:'Refresh garage',exact:true}).isVisible());
  assert.equal(await nameField().inputValue(),'Kept after failure');
  await refresh();assert.equal(await nameField().inputValue(),'Kept after failure');await save();

  // A real revision conflict preserves the local design until opening the latest saved bike.
  await nameField().fill('Local conflict draft');
  await page.evaluate(()=>{const row=cloud['rider-a'].find(row=>row.slot===2);row.name='Cloud latest';row.revision++;row.configuration.colors.frame='#51D5E8';});
  await page.locator('[data-bike-save]').click();await page.getByText(/garage space changed on another device/).waitFor();
  assert(await page.locator('[data-bike-save]').isDisabled());await refresh();
  assert.equal(await nameField().inputValue(),'Local conflict draft','Refresh does not erase the unsaved draft');
  await shelf();await page.locator('[data-bike-load="2"]').click();assert.equal(await nameField().inputValue(),'Cloud latest');assert.equal(await frameColour(),'#51D5E8');
  await nameField().fill('Updated cloud version');await save();assert.equal(await page.evaluate(()=>cloud['rider-a'].find(row=>row.slot===2).name),'Updated cloud version');
  // Error while loading keeps designing available and retry reachable outside the closed shelf.
  await page.evaluate(()=>{rpcModes.push({method:'get_bike_garage',type:'error'});mountGarage();});
  await page.getByText(/garage could not load/).waitFor();assert.equal(await page.locator('[data-bike-garage]').evaluate(el=>el.open),false);
  assert(await page.getByRole('button',{name:'Refresh garage',exact:true}).isVisible());assert(await page.locator('[data-bike-save]').isDisabled());
  await page.getByRole('button',{name:'Pink frame',exact:true}).click();await refresh();assert.equal(await frameColour(),'#E789D0');

  // The 15-second timeout releases busy controls and requires a safe refresh.
  assert(page.clock?.install && page.clock?.fastForward,'Playwright clock is available for timeout coverage');
  await page.clock.install();await page.evaluate(()=>rpcModes.push({method:'save_bike_build',type:'hold'}));
  await page.locator('[data-bike-save]').click();assert(await nameField().isDisabled());
  await page.clock.fastForward(15001);await page.getByText(/The save wasn't confirmed/).waitFor();
  assert(!(await nameField().isDisabled()));assert(await page.locator('[data-bike-save]').isDisabled());
  await page.evaluate(()=>pendingRpc.shift().resolve());await refresh();
  assert.equal(await frameColour(),'#E789D0','An uncertain save reply does not replace the draft');

  // Late old-account responses are disposed without repainting or changing another draft.
  await nameField().fill('Pending old account');await page.evaluate(()=>rpcModes.push({method:'save_bike_build',type:'hold'}));await page.locator('[data-bike-save]').click();
  await page.evaluate(()=>mountGarage('rider-b'));await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);
  await page.evaluate(()=>pendingRpc.shift().resolve());assert.equal(await nameField().inputValue(),'Rider B only');assert.equal(await page.locator('[data-bike-count]').textContent(),'0 / 3');
  await page.evaluate(()=>{rpcModes.push({method:'get_bike_garage',type:'hold'});mountGarage('rider-a');currentUser='departed-account';});
  const beforeStale=await page.locator('#view').innerHTML();await page.evaluate(()=>pendingRpc.shift().resolve());assert.equal(await page.locator('#view').innerHTML(),beforeStale,'isCurrent blocks late refresh repaint');
  await page.evaluate(()=>{JKCrewBikeGarage.destroy();mountGarage('rider-b');});await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);

  // A server commit with a lost reply is recovered by exact snapshot, never duplicated.
  await page.evaluate(()=>mountGarage('uncertain-save'));await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);
  await nameField().fill('Cloud saved once');await page.evaluate(()=>rpcModes.push({method:'save_bike_build',type:'commit-error'}));
  await page.locator('[data-bike-save]').click();await page.getByText(/The save wasn't confirmed/).waitFor();
  assert.equal(await page.evaluate(()=>cloud['uncertain-save'].length),1);
  await nameField().fill('Newer local idea');await page.getByRole('button',{name:'Gold frame',exact:true}).click();
  await refresh();assert.equal(await nameField().inputValue(),'Newer local idea');assert.equal(await frameColour(),'#F2BC57','Recovery preserves edits made after the uncertain save');
  assert.equal((await draft()).revision,1,'Refresh adopts the remotely committed revision');
  assert.equal((await draft()).slot,1);assert.equal((await draft()).pendingSave,null);
  await save();const recoveredCall=await page.evaluate(()=>rpcCalls.filter(call=>call.method==='save_bike_build').at(-1));
  assert.equal(recoveredCall.args.p_slot,1);assert.equal(recoveredCall.args.p_expected_revision,1);assert.equal(await page.evaluate(()=>cloud['uncertain-save'].length),1,'Retry updates the same slot instead of creating a duplicate');
  await shelf();await page.evaluate(()=>rpcModes.push({method:'delete_bike_build',type:'error'}));await page.getByRole('button',{name:'Remove Newer local idea',exact:true}).click();
  await page.getByText(/Could not remove/).waitFor();assert(await page.locator('[data-bike-save]').isDisabled());assert.equal(await page.locator('.bike-saved-card').count(),1,'A failed remove keeps the saved card');
  await refresh();await page.getByRole('button',{name:'Remove Newer local idea',exact:true}).click();await page.getByText('Removed from your garage.',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-bike-count]').textContent(),'0 / 3');assert.equal(await nameField().inputValue(),'Newer local idea','Removing current saved bike retains its editable draft');
  assert.equal((await draft()).slot,null);assert.equal((await draft()).revision,0);
  await page.evaluate(()=>{rpcModes.push({method:'get_bike_garage',type:'hold'});mountGarage('loading-test');});
  assert(await page.locator('[data-bike-save]').isDisabled(),'Save is disabled while the garage is loading');
  await page.evaluate(()=>pendingRpc.shift().resolve());await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);

  // Disabled localStorage retains a per-account draft for this visit and warns on exit.
  await page.evaluate(()=>{window.realStorageGet=Storage.prototype.getItem;window.realStorageSet=Storage.prototype.setItem;Storage.prototype.getItem=function(){throw new Error('Storage blocked')};Storage.prototype.setItem=function(){throw new Error('Storage blocked')};mountGarage('memory-a');});
  await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);await nameField().fill('Memory-only bike');
  assert(await page.getByText(/Draft kept for this visit/).isVisible());
  assert.equal(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;}),true);
  await page.evaluate(()=>mountGarage('memory-b'));await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);assert.equal(await nameField().inputValue(),'My dream bike');
  await page.evaluate(()=>mountGarage('memory-a'));await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);assert.equal(await nameField().inputValue(),'Memory-only bike');
  await page.evaluate(()=>{Storage.prototype.getItem=realStorageGet;Storage.prototype.setItem=realStorageSet;mountGarage('rider-a');});await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);

  // Real app styling in both roles, themes and narrow widths; full-screen stays a clean fitted view.
  for(const role of ['rider','coach'])for(const width of [320,390,1024])for(const theme of ['dark','light']) {
    await page.setViewportSize({width,height:900});await page.evaluate(({role,theme})=>{document.querySelector('.app-shell').className=`app-shell ${role}-shell`;document.documentElement.dataset.theme=theme;window.scrollTo(0,0);},{role,theme});
    const geometry=await page.locator('.bike-garage').evaluate(el=>({scroll:el.scrollWidth,width:el.clientWidth,document:document.documentElement.scrollWidth,viewport:innerWidth}));
    assert(geometry.scroll<=geometry.width+1,`${role}/${width}/${theme}: workshop has no overflow`);assert(geometry.document<=geometry.viewport+1,`${role}/${width}/${theme}: page has no overflow`);
    assert(Number(await nameField().evaluate(el=>parseFloat(getComputedStyle(el).fontSize)))>=16,'Name input avoids mobile autozoom');
    await page.getByRole('button',{name:'Expand bike preview',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Full bike preview',exact:true});assert(await dialog.isVisible());await waitForArtwork(page);assert.equal(await dialog.getByRole('button').count(),1,'Fullscreen only has Close');
    const fit=await dialog.evaluate(el=>{const d=el.getBoundingClientRect(),s=el.querySelector('.jkcrew-bike-art').getBoundingClientRect();return {d:{x:d.x,y:d.y,right:d.right,bottom:d.bottom},s:{x:s.x,y:s.y,right:s.right,bottom:s.bottom},sw:el.scrollWidth,cw:el.clientWidth,sh:el.scrollHeight,ch:el.clientHeight};});
    assert(fit.sw<=fit.cw+1&&fit.sh<=fit.ch+1,`${role}/${width}/${theme}: fullscreen fits without scrolling`);assert(fit.s.x>=fit.d.x&&fit.s.right<=fit.d.right+1&&fit.s.y>=fit.d.y&&fit.s.bottom<=fit.d.bottom+1,`${role}/${width}/${theme}: bike stays inside fullscreen`);
    await page.getByRole('button',{name:'Close bike preview',exact:true}).click();await dialog.waitFor({state:'detached'});
  }
  await page.setViewportSize({width:844,height:390});await page.getByRole('button',{name:'Expand bike preview',exact:true}).click();
  assert(await page.locator('.bike-fullscreen').evaluate(el=>el.scrollHeight<=el.clientHeight+1&&el.scrollWidth<=el.clientWidth+1),'Landscape phone fullscreen fits without scrolling');
  await page.getByRole('button',{name:'Close bike preview',exact:true}).click();await page.locator('.bike-fullscreen').waitFor({state:'detached'});
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('[data-bike-save]').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
  await page.getByRole('button',{name:'← Back',exact:true}).click();assert.equal(await page.evaluate(()=>backCalls),1);
  await page.getByRole('button',{name:'Expand bike preview',exact:true}).click();await page.evaluate(()=>JKCrewBikeGarage.destroy());assert.equal(await page.locator('.bike-fullscreen').count(),0,'Dispose removes a fullscreen preview');
  assert((await page.evaluate(()=>rpcCalls)).every(call=>['get_bike_garage','save_bike_build','delete_bike_build'].includes(call.method)),'No training, scoring, invitation or notification RPCs');
  console.log('PASS: neutral white defaults, preserved colourful builds, safe Blank bike reset/white save roundtrip, live colours/styles, keyboard focus, undo/redo, private drafts/accounts, three-slot CRUD, revisions, safe refresh/retry/timeout, uncertain-commit recovery without duplicates, disposal, blocked-storage fallback, fullscreen, and 320/390/1024 dark/light layouts.');

}
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH});
  try {
    if(process.env.JKCREW_BIKE_PHOTOS_ONLY){await checkPhotoLoading(browser);return;}
    if(process.env.JKCREW_BIKE_SEATS_ONLY){await checkSeatArtwork(browser);return;}
    const page=await browser.newPage({viewport:{width:390,height:900}});
    page.setDefaultTimeout(6000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const servedAssets=[];await page.route('**/*',route=>serveFixture(route,servedAssets));
    await boot(page);
    if(process.env.JKCREW_BIKE_PARTS_ONLY){await checkLegacyDraftUpgrade(page);await checkExpandedParts(page);assert.deepEqual(errors,[]);return;}
    await run(page);assert.deepEqual(errors,[]);
    assert(servedAssets.some(asset=>/\.(png|webp|jpe?g|avif)$/i.test(asset)),'Photographic artwork is loaded from local fixture assets');
    if(!process.env.JKCREW_BIKE_SCREENSHOTS_ONLY&&!process.env.JKCREW_BIKE_STICKY_ONLY){await boot(page);await checkLegacyDraftUpgrade(page);await checkExpandedParts(page);await checkSeatArtwork(browser);await checkPhotoLoading(browser);}
    console.log('PASS: isolated Bike Garage UI; no production requests or writes.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error.stack || error);process.exitCode=1;});
