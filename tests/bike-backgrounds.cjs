const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {chromium}=require(process.env.JKCREW_PLAYWRIGHT_PATH||'playwright');
const {PNG}=require(require.resolve('pngjs',{paths:[path.dirname(require.resolve(process.env.JKCREW_PLAYWRIGHT_PATH||'playwright'))]}));
const {server,ready,settle}=require('./bike-360-ui.cjs');
const scenes=['street','skatepark','warehouse','rooftop'];
let checks=0;
function check(value,message){assert(value,message);checks++;}
function equal(value,expected,message){assert.deepEqual(value,expected,message);checks++;}
function hash(png){return createHash('sha256').update(png.data).digest('hex');}
function meanDifference(a,b){equal([a.width,a.height],[b.width,b.height],'Compared photos keep the same dimensions');let delta=0;for(let i=0;i<a.data.length;i+=4)for(let channel=0;channel<3;channel++)delta+=Math.abs(a.data[i+channel]-b.data[i+channel]);return delta/(a.width*a.height*3);}
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};}
const scenePath=scene=>'/images/bike-garage/scene-'+scene+'-v4.webp';
async function photoReady(page){
  await page.waitForFunction(()=>document.querySelector('[data-bike-export]')?.disabled===false);
  await page.locator('[data-bike-model-photo]').evaluate(image=>image.decode());
}
async function readPhoto(page){
  const base64=await page.locator('[data-bike-model-photo]').evaluate(async image=>{
    await image.decode();const blob=await fetch(image.src).then(response=>response.blob());
    return new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(blob);});
  });
  return PNG.sync.read(Buffer.from(base64,'base64'));
}
async function readModel(page){
  const base64=await page.evaluate(async()=>{
    const blob=await testHandle.exportBlob(testPhotoOptions);
    return new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(blob);});
  });
  return PNG.sync.read(Buffer.from(base64,'base64'));
}
async function photoOptions(page){await page.evaluate(()=>{const canvas=testHandle.canvas,aspect=canvas.clientWidth/canvas.clientHeight;window.testPhotoOptions={width:aspect>=1?2048:Math.round(2048*aspect),height:aspect>=1?Math.round(2048/aspect):2048,view:testHandle.getView()};});}
async function openPhoto(page){await photoOptions(page);await page.locator('[data-bike-preview]').click();await photoReady(page);}
async function selectScene(page,scene){await page.locator('[data-bike-scene="'+scene+'"]').click();await photoReady(page);}
async function scenePixels(page,scene){
  // Inspect the actual photograph above the bike, comparing against an
  // independently cropped source image. A tint or generic 3D wall cannot pass.
  return page.evaluate(async url=>{
    const photo=document.querySelector('[data-bike-model-photo]');await photo.decode();
    const source=new Image();source.src=url;await source.decode();
    const width=photo.naturalWidth,height=photo.naturalHeight;
    const actual=document.createElement('canvas'),expected=document.createElement('canvas');
    actual.width=expected.width=width;actual.height=expected.height=height;
    const a=actual.getContext('2d'),b=expected.getContext('2d');a.drawImage(photo,0,0);
    const scale=Math.max(width/source.naturalWidth,height/source.naturalHeight);
    const cropWidth=width/scale,cropHeight=height/scale;
    b.drawImage(source,(source.naturalWidth-cropWidth)/2,(source.naturalHeight-cropHeight)/2,cropWidth,cropHeight,0,0,width,height);
    let total=0,samples=0;
    for(const fy of [.04,.09,.14,.19])for(const fx of [.07,.2,.33,.46,.59,.72,.85,.93]){
      const x=Math.round(width*fx),y=Math.round(height*fy),aa=a.getImageData(x,y,5,5).data,bb=b.getImageData(x,y,5,5).data;
      for(let channel=0;channel<3;channel++){let av=0,bv=0;for(let pixel=0;pixel<25;pixel++){av+=aa[pixel*4+channel];bv+=bb[pixel*4+channel];}total+=Math.abs(av-bv)/25;samples++;}
    }
    return {meanChannelError:total/samples,dimensions:[width,height]};
  },scenePath(scene));
}
async function fixture(browser,local,viewport,gate=async()=>true,beforeMount=async()=>{}){
  const context=await browser.newContext({viewport,hasTouch:true,acceptDownloads:true}),page=await context.newPage();
  const errors=[],external=[],requests=[];page.setDefaultTimeout(25000);page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==local.url||request.method()!=='GET'){external.push({url:request.url(),method:request.method()});return route.abort();}
    requests.push(url.pathname);
    if(await gate(url.pathname)===false)return route.fulfill({status:503,contentType:'text/plain',body:'Simulated background image failure'});
    return route.continue();
  });
  await page.goto(local.url+'/fixture');await page.waitForFunction(()=>testReady);await beforeMount(page);await page.evaluate(()=>testMount());await ready(page);
  await page.locator('[data-bike-name]').fill('Background regression');await settle(page);
  return {page,requests,async close(){
    equal(errors,[],'Background flows have no uncaught browser errors');
    equal(external,[],'The fixture never contacts an external host or sends a non-GET request');
    equal(await page.evaluate(()=>testCalls.filter(call=>call.method!=='get_bike_garage')),[],'Scene controls never write garage data');
    await context.close();
  }};
}
async function completeScenes(browser,local,viewport){
  const f=await fixture(browser,local,viewport),{page}=f;
  try{
    await openPhoto(page);const studio=await readPhoto(page),viewBefore=await page.evaluate(()=>testHandle.getView());
    const bikeBefore=await page.evaluate(()=>{const config={...testDraft().configuration};delete config.background;return config;});
    const photos=new Set();
    for(const scene of scenes){
      await selectScene(page,scene);const photo=await readPhoto(page);
      check(f.requests.includes(scenePath(scene)),scene+': the full photograph is loaded');
      const pixels=await scenePixels(page,scene);
      check(pixels.meanChannelError<9,scene+': exported background matches its photograph (mean error '+pixels.meanChannelError.toFixed(2)+')');
      equal(hash(photo),hash(await readModel(page)),scene+': Photo Studio uses the actual 3D model and camera');
      equal(await page.locator('[data-bike-preview-art] svg').count(),0,scene+': no older SVG bike is substituted');
      equal(await page.locator('[data-bike-scene="'+scene+'"]').getAttribute('aria-pressed'),'true',scene+': the chosen scene stays selected');
      equal(await page.evaluate(()=>testDraft().configuration.background),scene,scene+': the draft keeps the selected scene');
      photos.add(hash(photo));
      if(scene==='warehouse'||scene==='rooftop')await page.screenshot({path:'/tmp/bike-backgrounds-'+viewport.width+'-'+scene+'.png'});
    }
    equal(photos.size,4,'All four scenes produce different photos');
    await selectScene(page,'studio');const studioDifference=meanDifference(await readPhoto(page),studio);
    // Rebuilt paint uses procedural micro-grain, so compare perceptually.
    check(studioDifference<2,'Returning to Studio restores the bike and studio (mean difference '+studioDifference.toFixed(3)+')');
    equal(await page.evaluate(()=>testHandle.getView()),viewBefore,'Scene selection and export preserve the camera');
    equal(await page.evaluate(()=>{const config={...testDraft().configuration};delete config.background;return config;}),bikeBefore,'Scene selection preserves every bike part and colour');
    await page.evaluate(()=>{for(const scene of ['street','warehouse','skatepark','studio','rooftop'])document.querySelector('[data-bike-scene="'+scene+'"]').click();});
    await photoReady(page);equal(await page.evaluate(()=>testDraft().configuration.background),'rooftop','Rapid selection keeps the latest scene');
    check((await scenePixels(page,'rooftop')).meanChannelError<9,'Rapid selection exports the latest photograph');
    await page.evaluate(()=>Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>false}));
    const downloadEvent=page.waitForEvent('download');await page.locator('[data-bike-export]').click();const download=await downloadEvent;
    equal(await download.failure(),null,'The browser accepts the completed photo download');
    equal(hash(PNG.sync.read(fs.readFileSync(await download.path()))),hash(await readPhoto(page)),'The downloaded PNG exactly matches Photo Studio');
    console.log('PASS: '+viewport.width+'×'+viewport.height+' actual photo pixels, same 3D bike, Studio return, rapid selection and PNG download.');
  }finally{await f.close();}
}
async function loadingRecovery(browser,local){
  const held=deferred(),observed=deferred();let fail=true;
  const f=await fixture(browser,local,{width:390,height:844},async url=>{
    if(url===scenePath('street')){observed.resolve();await held.promise;}
    return url!==scenePath('warehouse')||!fail;
  }),{page}=f;
  try{
    await openPhoto(page);
    await page.locator('[data-bike-scene="street"]').click();await observed.promise;
    check(await page.locator('[data-bike-export]').isDisabled(),'Save stays disabled while the selected photograph is pending');
    equal(await page.locator('[data-bike-preview-art]').getAttribute('aria-busy'),'true','Pending photograph exposes loading state');
    equal(await page.locator('[data-bike-preview-art] img,[data-bike-preview-art] svg').count(),0,'Pending photograph never offers an old or incomplete photo');
    await selectScene(page,'studio');equal(await page.locator('.bike-three-canvas').getAttribute('data-background-status'),'ready','Returning to Studio does not wait for an unfinished photograph');
    await page.locator('[data-bike-scene="street"]').click();
    await selectScene(page,'rooftop');const latest=hash(await readPhoto(page));
    const lateResponse=page.waitForResponse(response=>new URL(response.url()).pathname===scenePath('street'));held.resolve();await (await lateResponse).finished();await settle(page);
    equal(hash(await readPhoto(page)),latest,'A late earlier photograph cannot replace the newest photo');
    equal(await page.evaluate(()=>testHandle.canvas.dataset.background),'rooftop','A late image does not replace the current 3D background');
    await page.locator('[data-bike-scene="warehouse"]').click();await page.locator('[data-bike-preview-retry]').waitFor({state:'visible'});
    check(await page.locator('[data-bike-export]').isDisabled(),'A failed image cannot be saved');
    equal(await page.locator('[data-bike-preview-art] img,[data-bike-preview-art] svg').count(),0,'Failed image never substitutes old bike artwork');
    equal(await page.locator('[data-bike-art][data-view="3d"] canvas').count(),1,'Background loading failure keeps the working 3D viewer');
    equal(await page.locator('.bike-three-canvas').getAttribute('data-background-status'),'error','The viewer records the background error');
    check(await page.evaluate(async()=>{try{await testHandle.exportBlob(testPhotoOptions);return false;}catch{return true;}}),'Direct export also rejects an unready background');
    fail=false;await page.locator('[data-bike-preview-retry]').click();await photoReady(page);
    equal(await page.locator('.bike-three-canvas').getAttribute('data-background-status'),'ready','Retry restores background readiness');
    check(!(await page.locator('[data-bike-status]').textContent()).includes('background photo could not load'),'Successful Retry clears only the stale background error in the garage');
    check((await scenePixels(page,'warehouse')).meanChannelError<9,'Retry loads the requested full photograph');
    equal(hash(await readPhoto(page)),hash(await readModel(page)),'Retry restores the same 3D bike photo');
    await page.screenshot({path:'/tmp/bike-backgrounds-recovered-phone.png'});
    await page.locator('[data-bike-preview-close]').click();
    await page.evaluate(()=>{window.originalExport=testHandle.exportBlob;testHandle.exportBlob=async()=>new Blob(['Invalid PNG bytes'],{type:'image/png'});});
    await page.locator('[data-bike-preview]').click();await page.locator('[data-bike-preview-retry]').waitFor({state:'visible'});
    check(await page.locator('[data-bike-export]').isDisabled(),'A PNG that cannot decode is never declared ready or offered for saving');
    equal(await page.locator('[data-bike-preview-art] img,[data-bike-preview-art] svg').count(),0,'An invalid PNG never displays a broken image as the finished photo');
    check((await page.locator('[data-bike-preview-art]').textContent()).includes('could not load'),'PNG decode failure displays a visible explanation');
    await page.evaluate(()=>testHandle.exportBlob=originalExport);await page.locator('[data-bike-preview-retry]').click();await photoReady(page);
    equal(hash(await readPhoto(page)),hash(await readModel(page)),'Retry after PNG decode failure recovers the actual model photo');
    console.log('PASS: pending Save state, late-response isolation, image/PNG failure without substitution, and retry.');
  }finally{held.resolve();await f.close();}
}
async function savedBackgroundTimeout(browser,local){
  const held=deferred(),observed=deferred();let delay=true;
  const f=await fixture(browser,local,{width:390,height:844},async url=>{
    if(url===scenePath('street')&&delay){observed.resolve();await held.promise;}
    return true;
  },async page=>{
    await page.clock.install();
    await page.evaluate(()=>localStorage.setItem('jkcrew-bike-draft-v1:orbit-owner',JSON.stringify({configuration:JKCrewBikeConfig.normalize({background:'street'}),name:'Saved Street bike'})));
  }),{page}=f;
  try{
    await observed.promise;
    equal(await page.locator('[data-bike-art][data-view="3d"] canvas').count(),1,'A saved photo background does not delay the usable 3D model');
    await photoOptions(page);await page.locator('[data-bike-preview]').click();
    check(await page.locator('[data-bike-export]').isDisabled(),'The saved scene cannot export before its photograph loads');
    await page.clock.fastForward(12001);await page.locator('[data-bike-preview-retry]').waitFor({state:'visible'});
    equal(await page.locator('[data-bike-art][data-view="3d"] canvas').count(),1,'A saved scene photo timeout keeps its original 3D viewer');
    check(await page.locator('[data-bike-3d-retry]').isHidden(),'An image timeout does not invoke the SVG/model fallback');
    equal(await page.locator('.bike-three-canvas').getAttribute('data-background-status'),'error','The saved scene reports its bounded image timeout');
    delay=false;held.resolve();await page.locator('[data-bike-preview-retry]').click();await photoReady(page);
    check((await scenePixels(page,'street')).meanChannelError<9,'Retry after a saved scene timeout loads its requested photograph');
    equal(await page.evaluate(()=>testDraft().configuration.background),'street','Timeout and retry preserve the saved background choice');
    equal(hash(await readPhoto(page)),hash(await readModel(page)),'Timeout recovery preserves the actual model photo');
    console.log('PASS: saved scene loads the 3D bike promptly, survives image timeout, and retries without SVG fallback.');
  }finally{delay=false;held.resolve();await f.close();}
}
async function run(){
  const local=await server(),browser=await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH,args:['--enable-unsafe-swiftshader']});
  try{for(const viewport of [{width:1024,height:768},{width:390,height:844}])await completeScenes(browser,local,viewport);await loadingRecovery(browser,local);await savedBackgroundTimeout(browser,local);console.log('PASS: '+checks+' focused background/photo checks; no production requests or writes.');}
  finally{await browser.close();await local.close();}
}
run().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
