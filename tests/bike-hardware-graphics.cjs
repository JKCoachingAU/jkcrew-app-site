// Render actual photographic layers in Chromium. Pixel landmarks below are
// measured against the photographed hardware, independently of SVG mask paths.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.JKCREW_PLAYWRIGHT_PATH||'playwright');
const {PNG}=require(require.resolve('pngjs',{paths:[path.dirname(require.resolve(process.env.JKCREW_PLAYWRIGHT_PATH||'playwright'))]}));
const root=path.resolve(__dirname,'..');
const origin='https://jkcrew-hardware.fixture';
const mime={'.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};
let assertions=0;
const ok=(value,label)=>{assert(value,label);assertions++;};
const equal=(a,b,label)=>{assert.deepEqual(a,b,label);assertions++;};
async function fixture(browser,sourceOverride) {
  const page=await browser.newPage({viewport:{width:1536,height:1024},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin!==origin||route.request().method()!=='GET')return route.abort();
    if(url.pathname==='/hardware')return route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:transparent}#art{width:1536px;height:1024px}</style></head><body><div id="art"></div></body></html>'});
    const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
    if(!file.startsWith(root+path.sep)||!mime[path.extname(file)]||!fs.existsSync(file)||!fs.realpathSync(file).startsWith(fs.realpathSync(root)+path.sep))return route.abort();
    return route.fulfill({contentType:mime[path.extname(file)],body:fs.readFileSync(file)});
  });
  await page.goto(origin+'/hardware');
  for(const file of ['bike-config.js','bike-seat-designs.js','bike-photo-masks.js','bike-renderer.js'])await page.addScriptTag({content:sourceOverride?.[file]||fs.readFileSync(path.join(root,file),'utf8')});
  return {page,errors};
}
async function render(page,patch={},transparent=false) {
  const meta=await page.evaluate(async({patch,transparent})=>{
    const base=JKCrewBikeConfig.defaults;
    const config=JKCrewBikeConfig.normalize({...base,...patch,colors:{...base.colors,...patch.colors},finishes:{...base.finishes,...patch.finishes}});
    const before=JSON.stringify(config);
    await JKCrewBikeArt.prepare(config);
    document.querySelector('#art').innerHTML=JKCrewBikeArt.render(config,{idPrefix:'hardware-pixels',transparent});
    const sources=[...new Set([...document.querySelectorAll('#art image')].map(el=>el.getAttribute('href')))];
    await Promise.all(sources.map(async src=>{const image=new Image();image.src=src;await image.decode();}));
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    return {sources,unchanged:before===JSON.stringify(config)};
  },{patch,transparent});
  ok(meta.unchanged,'Rendering never mutates a saved configuration');
  const buffer=await page.locator('#art').screenshot({omitBackground:true,animations:'disabled'});
  return {pixels:PNG.sync.read(buffer),buffer,sources:meta.sources};
}
function pixel(image,x,y) {const i=(y*image.width+x)*4;return [...image.data.subarray(i,i+4)];}
const inside=(x,y,box)=>x>=box[0]&&y>=box[1]&&x<=box[2]&&y<=box[3];
function changed(a,b,box,invert=false) {
  equal([a.width,a.height],[b.width,b.height],'Compared photos retain the same registered dimensions');
  let count=0;
  for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++) {
    if(inside(x,y,box)===invert)continue;
    const i=(y*a.width+x)*4;
    if([0,1,2,3].some(channel=>Math.abs(a.data[i+channel]-b.data[i+channel])>3))count++;
  }
  return count;
}
function darkComposite(image) {
  const out=new PNG({width:image.width,height:image.height});
  for(let i=0;i<image.data.length;i+=4){const alpha=image.data[i+3]/255;for(let c=0;c<3;c++)out.data[i+c]=Math.round(image.data[i+c]*alpha+[13,20,26][c]*(1-alpha));out.data[i+3]=255;}
  return PNG.sync.write(out);
}
function connected(image,start,end,box,label) {
  ok(pixel(image,...start)[3]>230&&pixel(image,...end)[3]>230,`${label}: both attachment endpoints remain opaque`);
  const queue=[start],seen=new Set([start.join(',')]);
  for(let index=0;index<queue.length;index++) {
    const [x,y]=queue[index];if(x===end[0]&&y===end[1])return;
    for(const [dx,dy] of [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]]) {
      const next=[x+dx,y+dy],key=next.join(',');
      if(!inside(...next,box)||seen.has(key)||pixel(image,...next)[3]<96)continue;
      seen.add(key);queue.push(next);
    }
  }
  assert.fail(`${label}: hardware must connect to the bike instead of floating in the exported cutout`);
}
async function run(browser,sourceOverride) {
  const {page,errors}=await fixture(browser,sourceOverride);
  try {
    const stemBox=[1014,244,1129,328],pedalBox=[769,598,897,679];
    // The old plastic mask painted a red crescent behind/below the left edge.
    // This point lies outside the straight v5 pedal and must reveal the scene.
    const pedalProbe=await render(page,{pedalMaterial:'plastic',colors:{pedals:'#F26879'}},true);
    fs.writeFileSync('/tmp/jkcrew-hardware-plastic-cutout.png',darkComposite(pedalProbe.pixels));
    ok(pixel(pedalProbe.pixels,781,659)[3]<10,'The removed plastic-pedal crescent at781,659 stays transparent');
    const stems={};
    for(const stemStyle of ['top-load','front-load'])for(const barStyle of ['two-piece','four-piece']) {
      const label=`${stemStyle}/${barStyle}`;
      const red=await render(page,{stemStyle,barStyle,finishes:{stem:'gloss'},colors:{stem:'#F26879'}});
      const blue=await render(page,{stemStyle,barStyle,finishes:{stem:'gloss'},colors:{stem:'#428CFF'}});
      ok(changed(red.pixels,blue.pixels,stemBox)>300,`${label}: changing stem paint visibly changes the actual stem`);
      equal(changed(red.pixels,blue.pixels,stemBox,true),0,`${label}: stem paint stays out of every other part/background`);
      equal(changed(red.pixels,blue.pixels,[1045,215,1065,241]),0,`${label}: paint does not climb the handlebar`);
      equal(changed(red.pixels,blue.pixels,[1058,318,1084,325]),0,`${label}: paint does not recolour the headset`);
      if(stemStyle==='top-load'&&barStyle==='two-piece') {
        const a=pixel(red.pixels,1098,271),b=pixel(blue.pixels,1098,271);
        ok(Math.max(...a.slice(0,3).map((v,i)=>Math.abs(v-b[i])))>20,'The stem behind the obsolete bar/collar tail at1098,271 now takes its selected colour');
      }
      const chrome=await render(page,{stemStyle,barStyle,finishes:{stem:'chrome'}});
      ok(changed(red.pixels,chrome.pixels,stemBox)>300,`${label}: chrome retains visibly different photographic reflections`);
      ok(!chrome.sources.some(url=>/studio-chrome-(?:top|front)-stem-v3|studio-two-top-v5/.test(url)),`${label}: old reflections and the rejected unaligned stem photo are not used`);
      stems[`${stemStyle}/${barStyle}`]=chrome.pixels;
      const cutout=await render(page,{stemStyle,barStyle,finishes:{stem:'gloss'},colors:{stem:'#F26879'}},true);
      connected(cutout.pixels,[1050,292],[1077,332],[1010,235,1135,350],`${label} stem to head tube`);
      fs.writeFileSync(`/tmp/jkcrew-hardware-${stemStyle}-${barStyle}.png`,chrome.buffer);
      fs.writeFileSync(`/tmp/jkcrew-hardware-${stemStyle}-${barStyle}-cutout.png`,darkComposite(cutout.pixels));
    }
    for(const bars of ['two-piece','four-piece'])ok(changed(stems[`top-load/${bars}`],stems[`front-load/${bars}`],stemBox)>250,`${bars}: the two photographed stem designs visibly differ`);
    const pedals={};
    for(const pedalMaterial of ['plastic','metal'])for(const driveSide of ['rhd','lhd']) {
      const label=`${pedalMaterial}/${driveSide}`;
      const red=await render(page,{pedalMaterial,driveSide,colors:{pedals:'#F26879'}},true);
      const blue=await render(page,{pedalMaterial,driveSide,colors:{pedals:'#428CFF'}},true);
      ok(changed(red.pixels,blue.pixels,pedalBox)>300,`${label}: pedal paint is visible`);
      equal(changed(red.pixels,blue.pixels,pedalBox,true),0,`${label}: pedal paint stays out of the bike and scene`);
      equal(changed(red.pixels,blue.pixels,[745,644,765,658]),0,`${label}: pedal paint leaves the crank arm unchanged`);
      for(const point of [[781,659],[805,676],[892,648]])ok(pixel(red.pixels,...point)[3]<10,`${label}: exterior ${point.join(',')} reveals the scene without leftover pedal paint`);
      connected(red.pixels,[822,633],[769,647],[738,595,902,685],`${label} pedal to crank`);
      pedals[label]=red.pixels;
      fs.writeFileSync(`/tmp/jkcrew-hardware-${pedalMaterial}-${driveSide}-cutout.png`,darkComposite(red.pixels));
    }
    for(const drive of ['rhd','lhd'])ok(changed(pedals[`plastic/${drive}`],pedals[`metal/${drive}`],pedalBox)>200,`${drive}: plastic and metal have visibly distinct photographed platforms`);
    equal(errors,[],'All hardware combinations render without uncaught browser errors');
  }finally{await page.close();}
}
module.exports={fixture,render,pixel,changed,darkComposite,run};
if(require.main===module)(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH});
  try {await run(browser);console.log(`PASS: ${assertions} actual hardware pixel/registration checks; no production requests or data writes.`);}
  finally{await browser.close();}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
