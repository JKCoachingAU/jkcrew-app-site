const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const { PNG } = require(require.resolve('pngjs', {paths:[path.dirname(require.resolve(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright'))]}));
const root = path.resolve(__dirname, '..');
const origin = 'https://jkcrew-preview.fixture';
const html = '<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"><div class="app-shell coach-shell"><main id="view" class="content" data-view="bikeGarage"><button id="open-preview">Preview bike</button></main></div></div></body></html>';
const nodePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const mime = {'.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml'};
let assertions = 0;
const ok = (value, message) => { assert(value, message); assertions++; };
const equal = (value, expected, message) => { assert.deepEqual(value, expected, message); assertions++; };
const ready = page => page.waitForFunction(() => { const button=document.querySelector('[data-bike-export]'); return button&&!button.disabled; });
const status = page => page.locator('[data-bike-export-status]').textContent();
const tick = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const viewState = page => page.locator('[data-bike-preview-art]').evaluate(el=>{
  const art=el.getBoundingClientRect(),canvas=el.parentElement.getBoundingClientRect();
  return {transform:getComputedStyle(el).transform,relativeBounds:[art.x-canvas.x,art.y-canvas.y,art.width,art.height],markup:el.innerHTML};
});
function pixelChanges(a, b) {
  equal([a.width,a.height],[b.width,b.height],'Compared export dimensions match');
  let changed=0;
  for(let i=0;i<a.data.length;i+=4)if(Math.max(Math.abs(a.data[i]-b.data[i]),Math.abs(a.data[i+1]-b.data[i+1]),Math.abs(a.data[i+2]-b.data[i+2]))>4)changed++;
  return changed;
}
function inspectPng(buffer, label) {
  const png=PNG.sync.read(buffer);
  equal([png.width,png.height],[2048,1365],label+': exported photo keeps full 2048×1365 resolution');
  let translucent=0;const colours=new Set();
  for(let i=0;i<png.data.length;i+=4){if(png.data[i+3]!==255)translucent++;if(i%64===0)colours.add((png.data[i]>>3)+','+(png.data[i+1]>>3)+','+(png.data[i+2]>>3));}
  equal(translucent,0,label+': saved photo has an opaque background');
  ok(colours.size>150,label+': exported photo contains real colour detail');
  return png;
}
async function fixture(browser,{assetGate}={}) {
  const page=await browser.newPage({viewport:{width:390,height:844},acceptDownloads:true});
  const errors=[],requests=[],downloads=[],unexpectedRequests=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('download',download=>downloads.push(download));
  await page.route('**/*',async route=>{
    try {
      const url=new URL(route.request().url());
      // Nothing in this harness may contact a real app, API, shop, or account.
      if(url.origin!==origin||route.request().method()!=='GET'){unexpectedRequests.push(route.request().url());return route.abort();}
      if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:html});
      const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
      if(!file.startsWith(root+path.sep)||!mime[path.extname(file)]||!fs.existsSync(file))return route.abort();
      const real=fs.realpathSync(file);if(!real.startsWith(fs.realpathSync(root)+path.sep))return route.abort();
      requests.push(url.pathname);
      if(assetGate&&await assetGate(url.pathname)===false)return route.abort();
      return route.fulfill({contentType:mime[path.extname(real)],body:fs.readFileSync(real)});
    } catch { return route.abort(); }
  });
  await page.goto(origin+'/');
  for(const name of ['styles.css','bike-garage.css','bike-preview.css'])await page.addStyleTag({content:fs.readFileSync(path.join(root,name),'utf8')});
  for(const name of ['bike-config.js','bike-seat-designs.js','bike-photo-masks.js','bike-renderer.js','bike-preview.js'])await page.addScriptTag({content:fs.readFileSync(path.join(root,name),'utf8')});
  await page.evaluate(()=>{
    window.previewCurrent=true;window.previewCloseCalls=0;window.backgroundChanges=[];window.backgroundAccept=true;window.shareCalls=[];window.shareMode='success';window.allowFileShare=false;window.clickGesture=false;
    window.createdBlobUrls=[];window.revokedBlobUrls=[];window.anchorClicks=[];
    const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
    URL.createObjectURL=blob=>{const url=create(blob);createdBlobUrls.push({url,type:blob.type});return url;};
    URL.revokeObjectURL=url=>{revokedBlobUrls.push(url);return revoke(url);};
    const click=HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click=function(){anchorClicks.push({href:this.href,download:this.download});return click.call(this);};
    // Track the synchronous body of the actual click handler. A capture-phase
    // microtask flag is unreliable because browsers can checkpoint between
    // event listeners; preserve removeEventListener identity as well.
    const addListener=EventTarget.prototype.addEventListener,removeListener=EventTarget.prototype.removeEventListener,clickListeners=new WeakMap();
    EventTarget.prototype.addEventListener=function(type,listener,options){
      if(type==='click'&&listener&&(typeof listener==='function'||typeof listener==='object')){
        if(!clickListeners.has(listener))clickListeners.set(listener,function(event){const prior=clickGesture;clickGesture=event.isTrusted;try{return typeof listener==='function'?listener.call(this,event):listener.handleEvent(event);}finally{clickGesture=prior;}});
        return addListener.call(this,type,clickListeners.get(listener),options);
      }
      return addListener.call(this,type,listener,options);
    };
    EventTarget.prototype.removeEventListener=function(type,listener,options){return removeListener.call(this,type,type==='click'&&listener?clickListeners.get(listener)||listener:listener,options);};
    Object.defineProperty(navigator,'canShare',{configurable:true,value:options=>allowFileShare&&Array.isArray(options.files)&&options.files.every(file=>file instanceof File&&file.type==='image/png')});
    Object.defineProperty(navigator,'share',{configurable:true,value:async options=>{
      const call={gesture:clickGesture,activation:navigator.userActivation.isActive,files:[],title:options.title,text:options.text,url:options.url};shareCalls.push(call);
      call.files=await Promise.all((options.files||[]).map(file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve({name:file.name,type:file.type,size:file.size,dataUrl:reader.result});reader.onerror=reject;reader.readAsDataURL(file);})));
      if(shareMode==='cancel')throw new DOMException('Sharing cancelled','AbortError');
      if(shareMode==='error')throw new Error('Share destination unavailable');
      if(shareMode==='hold')await new Promise(resolve=>{window.resolveShare=resolve;});
    }});
    window.mountPreview=(background='studio',frame='#428CFF')=>{
      window.previewHandle?.destroy();previewCurrent=true;
      const configuration=JKCrewBikeConfig.normalize({background,colors:{...JKCrewBikeConfig.defaults.colors,frame},tyreStyle:'black',seatDesign:'design-09',driveSide:'lhd',brakeStyle:'dual'});
      window.previewInput=JSON.parse(JSON.stringify(configuration));window.previewPassed=configuration;window.previewOwnerState=JSON.parse(JSON.stringify(configuration));
      window.previewHandle=JKCrewBikePreview.mount({configuration,name:'Finals / bike <3>',isCurrent:()=>previewCurrent,onBackgroundChange:value=>{
        backgroundChanges.push(value);if(!backgroundAccept)return null;
        previewOwnerState=JKCrewBikeConfig.normalize({...previewOwnerState,background:value});return JSON.parse(JSON.stringify(previewOwnerState));
      },onClose:()=>previewCloseCalls++});
      return configuration;
    };
  });
  return {page,errors,requests,downloads,unexpectedRequests};
}
async function saveDownload(page,label,selector='[data-bike-export]') {
  const event=page.waitForEvent('download');await page.locator(selector).click();const download=await event;
  equal(await download.failure(),null,label+': browser accepted the file download');
  ok(/\.png$/i.test(download.suggestedFilename()),label+': download has a PNG filename');
  ok(!/[<>/\\\x00-\x1f]/.test(download.suggestedFilename()),label+': suggested filename is filesystem safe');
  const file=await download.path();return {png:inspectPng(fs.readFileSync(file),label),download};
}
async function checkScenesAndDownloads(browser) {
  const f=await fixture(browser),{page}=f;
  try {
    const hashes=new Set();
    for(const background of ['street','skatepark','warehouse','rooftop']){
      await page.evaluate(background=>mountPreview(background),background);await ready(page);
      equal(await page.evaluate(()=>shareCalls.length),0,'Opening a preview never shares automatically');
      const beforeCalls=f.downloads.length;const first=await saveDownload(page,background);
      equal(f.downloads.length,beforeCalls+1,'Only pressing Save photo starts one download');
      hashes.add(createHash('sha256').update(first.png.data).digest('hex'));
      const original=await page.evaluate(()=>previewInput);
      equal(original.background,background,'The fixture passed the requested scene');
      const svg=await page.evaluate(()=>JKCrewBikePreview.renderScene(previewInput,{idPrefix:'export-contract'}));
      ok(typeof svg==='string'&&/viewBox=["']0 0 1536 1024["']/.test(svg),'renderScene returns the documented full-resolution SVG');
      ok(!/on(?:click|load|error)=/i.test(svg),'Scene export contains no inline event handlers');
      // A second colour of the same bike proves every PNG contains the actual
      // configurable bike, not only the background or a stale cached export.
      await page.evaluate(background=>mountPreview(background,'#F26879'),background);await ready(page);
      const second=await saveDownload(page,background+' pink frame');
      ok(pixelChanges(first.png,second.png)>300,background+': changing frame colour changes the exported bike');
    }
    equal(hashes.size,4,'All four photographic backgrounds produce different exported PNGs');
    await page.evaluate(()=>mountPreview('studio'));await ready(page);
    for(const background of ['street','skatepark','warehouse','rooftop','studio']){
      await page.locator(`[data-bike-scene="${background}"]`).click();await ready(page);
      equal(await page.evaluate(()=>backgroundChanges.at(-1)),background,'Scene buttons report the selected scene to the owner');
    }
    equal(await page.evaluate(()=>previewPassed),await page.evaluate(()=>previewInput),'Selecting preview scenes does not mutate the configuration passed by the owner');
    for(const width of [320,390,1024]){
      await page.setViewportSize({width,height:844});await tick(page);
      const layout=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth,buttons:[...document.querySelectorAll('[data-bike-scene],[data-bike-export]')].map(el=>({w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height}))}));
      ok(layout.scroll<=layout.width+1,`${width}: preview has no horizontal page overflow`);
      ok(layout.buttons.every(b=>b.w>=43&&b.h>=43),`${width}: scene and export controls retain usable touch targets`);
    }
    const fullScene=await saveDownload(page,'Full scene before view controls');
    await page.evaluate(()=>{backgroundAccept=false;});await page.locator('[data-bike-scene="street"]').click();await ready(page);await tick(page);
    const rejected=await saveDownload(page,'Rejected scene change');
    equal(pixelChanges(fullScene.png,rejected.png),0,'An owner-rejected background change retains the last accepted exported scene');
    await page.evaluate(()=>{backgroundAccept=true;});
    // Compare the fixed viewing window, not the transformed artwork element:
    // its own bounding box intentionally grows and swaps dimensions on rotate.
    const initial=await page.locator('[data-bike-photo-canvas]').screenshot({animations:'disabled'});
    const initialView=await viewState(page);
    await page.locator('[data-bike-zoom="in"]').click();await page.locator('[data-bike-rotate="right"]').click();await tick(page);
    const changed=await page.locator('[data-bike-photo-canvas]').screenshot({animations:'disabled'});
    ok(pixelChanges(PNG.sync.read(initial),PNG.sync.read(changed))>300,'Zoom and rotation change the actual visible preview');
    const afterViewing=await saveDownload(page,'Full scene after zoom and rotation');
    equal(pixelChanges(fullScene.png,afterViewing.png),0,'View-only zoom/rotation do not crop or rotate the exported full scene');
    await page.locator('[data-bike-zoom="out"]').click();await page.locator('[data-bike-rotate="left"]').click();
    await page.locator('[data-bike-view-reset]').click();await tick(page);
    const reset=await page.locator('[data-bike-photo-canvas]').screenshot({animations:'disabled'});
    equal(await viewState(page),initialView,'Reset restores the exact initial transform, position, dimensions and scene markup');
    const beforePixels=PNG.sync.read(initial),resetPixels=PNG.sync.read(reset);
    equal([beforePixels.width,beforePixels.height],[resetPixels.width,resetPixels.height],'Reset keeps the same viewing window');
    let rasterError=0,largeDifferences=0;
    for(let i=0;i<beforePixels.data.length;i+=4){const delta=Math.max(...[0,1,2].map(c=>Math.abs(beforePixels.data[i+c]-resetPixels.data[i+c])));rasterError+=delta;if(delta>40)largeDifferences++;}
    // Chrome re-rasterises this filtered SVG after zoom: the observed return to
    // the identical geometry averages .42/255 at anti-aliased edges (max35).
    // Keep a tight perceptual check as well as the exact geometry/content check.
    ok(rasterError/(beforePixels.width*beforePixels.height)<1&&largeDifferences<10,'The reset image matches within bounded SVG re-rasterisation noise');
    const closeCalls=await page.evaluate(()=>previewCloseCalls);
    await page.getByRole('button',{name:'Close bike preview',exact:true}).click();
    equal(await page.evaluate(()=>previewCloseCalls),closeCalls+1,'The visible close button notifies its owner once');
    equal(await page.locator('[data-bike-preview-art]').count(),0,'Destroy removes the preview');
    equal(f.errors,[],'Scene and download flows have no uncaught browser errors');
    equal(f.unexpectedRequests,[],'Preview never requests an app API or external host');
    console.log('PASS: four actual photo/bike PNGs, colour fidelity, opaque export, download, scene controls and responsive preview.');
  } finally {await page.close();}
}
async function checkNativeShare(browser) {
  const f=await fixture(browser),{page}=f;
  try {
    await page.evaluate(()=>{allowFileShare=true;mountPreview('street');});await ready(page);
    await page.locator('[data-bike-export]').click();
    await page.waitForFunction(()=>shareCalls[0]?.files.length===1);await ready(page);
    const call=await page.evaluate(()=>shareCalls[0]);
    ok(call.gesture&&call.activation,'File sharing begins synchronously within the original click gesture');
    equal(call.files.length,1,'Native sharing sends exactly one image file');
    equal(call.files[0].type,'image/png','Native sharing receives a genuine PNG File');
    inspectPng(Buffer.from(call.files[0].dataUrl.split(',')[1],'base64'),'Native shared file');
    equal(call.url,undefined,'Native file export never substitutes an app/account URL');
    equal(f.downloads.length,0,'Native share success does not also download a duplicate');
    for(const mode of ['cancel','error']){
      await page.evaluate(mode=>{shareMode=mode;},mode);const count=await page.evaluate(()=>shareCalls.length);
      await page.locator('[data-bike-export]').click();await page.waitForFunction(count=>shareCalls.length===count+1,count);await ready(page);await tick(page);
      ok(!/\bsaved\b|\bshared\b|download started/i.test(await status(page)),mode+': no false save/share success is displayed');
      equal(f.downloads.length,0,mode+': cancellation or failed native share does not force a download');
    }
    ok(await page.locator('[data-bike-download]').isVisible(),'A blocked native share exposes an explicit download fallback');
    await saveDownload(page,'Explicit native-share fallback','[data-bike-download]');
    equal(f.downloads.length,1,'Download fallback starts only after its separate button is pressed');
    await page.evaluate(()=>{shareMode='hold';});await page.locator('[data-bike-export]').click();
    await page.waitForFunction(()=>typeof resolveShare==='function');
    await page.evaluate(()=>{previewCurrent=false;previewHandle.destroy();resolveShare();});await tick(page);
    equal(await page.locator('[data-bike-preview-art]').count(),0,'Late native share completion cannot restore a closed/stale preview');
    equal(f.errors,[],'Native share outcomes are handled without uncaught errors');
    console.log('PASS: eager PNG native File sharing keeps click activation; cancellation, errors and late completion never claim false success.');
  } finally {await page.close();}
}
async function checkLoadingAndDisposal(browser) {
  let fail=true;const f=await fixture(browser,{assetGate:()=>!fail}),{page}=f;
  try {
    await page.evaluate(()=>mountPreview('warehouse'));
    await page.locator('[data-bike-preview-retry]').waitFor({state:'visible'});
    ok(await page.locator('[data-bike-export]').isDisabled(),'Failed artwork cannot be saved as a blank or incomplete image');
    equal(f.downloads.length,0,'A failed image load never triggers a download');
    fail=false;await page.locator('[data-bike-preview-retry]').click();await ready(page);
    await saveDownload(page,'Retried image');
    equal(f.errors,[],'Failed image loading and retry have no uncaught errors');
  } finally {await page.close();}
  for(const mode of ['destroy','stale']){
    let release,seen;const held=new Promise(resolve=>{release=resolve;});const observed=new Promise(resolve=>{seen=resolve;});
    const f=await fixture(browser,{assetGate:async()=>{seen();await held;return true;}}),{page}=f;
    try {
      await page.evaluate(()=>mountPreview('rooftop'));await observed;
      ok(await page.locator('[data-bike-export]').isDisabled(),'Save stays disabled while actual image data is pending');
      if(mode==='destroy')await page.evaluate(()=>previewHandle.destroy());else await page.evaluate(()=>{previewCurrent=false;});
      release();await page.waitForLoadState('networkidle');await tick(page);
      if(mode==='destroy')equal(await page.locator('[data-bike-preview-art]').count(),0,'A late photo response cannot reopen a destroyed preview');
      else {await page.evaluate(()=>document.querySelector('[data-bike-export]')?.click());await tick(page);}
      equal(f.downloads.length,0,mode+': late image preparation cannot export after ownership is no longer current');
      equal(await page.evaluate(()=>shareCalls.length),0,mode+': no native share runs after disposal/account change');
      equal(await page.evaluate(()=>backgroundChanges.length),0,mode+': loading alone never changes the saved background');
      await page.evaluate(()=>previewHandle.destroy());await tick(page);
      const live=await page.evaluate(()=>createdBlobUrls.filter(item=>!revokedBlobUrls.includes(item.url)));
      equal(live,[],mode+': temporary object URLs are released');
      equal(f.errors,[],mode+': late responses produce no uncaught errors');
    } finally {release();await page.close();}
  }
  console.log('PASS: photo errors/retry, disabled loading export, pending disposal and stale-account guards.');
}
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.JKCREW_CHROME_PATH||nodePath});
  try {await checkScenesAndDownloads(browser);await checkNativeShare(browser);await checkLoadingAndDisposal(browser);console.log(`Bike Preview export regressions passed (${assertions} assertions; isolated local images, no app APIs or production access).`);}
  finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
