const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = require('path').resolve(__dirname, '..');
const app = fs.readFileSync(root+'/app.js','utf8');
const names = ['runPointColor','runPathBetween','runRouteSvg','runView','applyRunView','runMapHtml','cloneRunDialogPreview','fitRunDialogPreview','openRunCrop','openRunPlaybackFullscreen','runPlaybackDefaultSeconds','formatRunPlaybackTime','runPlaybackControlsHtml','runPlaybackSurface','paintRunPlayback','stopRunPlayback','toggleRunPlayback','scrubRunPlayback','setRunPlaybackDuration','updateRunPlaybackDuration','applyRunPlaybackDurationPreset','restartRunPlayback','bindRunPlaybackControls','runBuilderStage','runBuilderTrickEditorHtml','addRunBuilderPoint','dragRunPoint','updateRunBuilderMapDom','saveRunPlan'];
const functions = names.map(name => {
 const start = app.search(new RegExp('^(?:async )?function '+name+'\\(', 'm'));
 assert(start>=0,name);
 const rest = app.slice(start); const end = rest.indexOf('\n}',rest.indexOf('{'));
 return rest.slice(0,end+2);
}).join('\n');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH});
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<html><body><main id="host"></main></body></html>');
 await page.addStyleTag({content:fs.readFileSync(root+'/styles.css','utf8')});
 await page.addScriptTag({content:`
 const state = {runBuilder:{stage:'route',imageDataUrl:'', points:[]}, draggedRunPoint:null, runPointMapClickBlockUntil:0, profile:{role:'athlete'},user:{id:'test'}};
 const RUN_PLAYBACK_MAX_SECONDS=60;
 const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const currentRunFormState=()=>({...state.runBuilder});
 const runBuilderRefreshView=async()=>render();
 const notify=()=>{}; const isCoachRole=()=>false; const getLinkedCoachIdForCurrentAthlete=async()=> 'coach';
 const setSyncStatus=()=>{}; const cacheClear=()=>{};
 let saved; const client={from:()=>({insert:p=>{saved=p;return Promise.resolve({});}})};
 ${functions}
 const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#154a43"/><path d="M0 100H600M0 200H600M0 300H600M0 400H600M0 500H600M100 0V600M200 0V600M300 0V600M400 0V600M500 0V600" stroke="#51aa98"/></svg>');
 state.runBuilder.imageDataUrl=image;
 state.runBuilder.points=Array.from({length:18},(_,i)=>({x:20+(i%6)*10,y:30+Math.floor(i/6)*15,label:i>0&&i<17?'Trick '+i:'',bend:0}));
 function render(){document.querySelector('#host').innerHTML='<div class="run-builder-live"><button id="crop-run-image" onclick="openRunCrop()">Crop image</button><div class="run-map-stage"><div id="run-map">'+runMapHtml(image,state.runBuilder?.points||[], 'Park',true,true,state.runBuilder?.view)+'</div>'+runPlaybackControlsHtml(state.runBuilder?.points||[])+'</div></div>';bindRunPlaybackControls();document.querySelector('#run-map').onclick=addRunBuilderPoint;}
 render();`});


 const geometry = async selector => page.locator(selector).evaluate(el=>{
 const img=el.querySelector('img');const ir=img.getBoundingClientRect();
 const factor=Math.min(ir.width/img.naturalWidth,ir.height/img.naturalHeight);
 const w=img.naturalWidth*factor,h=img.naturalHeight*factor;
 const pos=getComputedStyle(img).objectPosition.split(' ').map(x=>parseFloat(x)/100);
 return [...el.querySelectorAll('.run-marker')].map(marker=>{const mr=marker.getBoundingClientRect();return [((mr.x+mr.width/2)-(ir.x+(ir.width-w)*pos[0]))/w,((mr.y+mr.height/2)-(ir.y+(ir.height-h)*pos[1]))/h];});
 });
 const matches=(before,after)=>before.forEach((point,i)=>point.forEach((v,j)=>assert(Math.abs(v-after[i][j])<0.002,`Dot ${i+1} shifted relative to the photo: ${v} -> ${after[i][j]}`)));
 let cases=0;
 for(const [width,height] of [[390,844],[768,1024],[1024,768]]){
 for(const card of [false,true]){
 for(const crop of [false,true]){
 await page.setViewportSize({width,height});
 await page.evaluate(({card,crop})=>{state.runBuilder.view=crop?{scale:2,x:15,y:-20}:runView();render();if(card)document.querySelector('.run-builder-live').className='run-card';}, {card,crop});
 await page.waitForFunction(()=>document.querySelector('.run-map-content img').complete);
 const before=await geometry('#run-map .run-map-preview');
 await page.click('[data-run-expand]');
 await page.evaluate(()=>stopRunPlayback());
 matches(before,await geometry('.run-fullscreen-playback .run-map-preview'));
 await page.setViewportSize({width:height,height:width});
 matches(before,await geometry('.run-fullscreen-playback .run-map-preview'));
 await page.click('.run-fullscreen-close');
 await page.waitForFunction(()=>!document.querySelector('dialog'));
 cases++;
 }
 }
 }
 assert.deepEqual(errors,[]);
 console.log(`PASS: all 18 dots retain photo coordinates in ${cases} phone/tablet, builder/saved-run, crop/full-photo cases, including rotation.`);
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
