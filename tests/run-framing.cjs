const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = require('path').resolve(__dirname, '..');
const app = fs.readFileSync(root+'/app.js','utf8');
const names = ['syncRunPhotoFrame','fitFullscreenRunRoute','positionRunTrickLabel','runTiming','runTimedPosition','runTimingRowHtml','runPointColor','runPathBetween','runRouteSvg','runView','applyRunView','runMapHtml','cloneRunDialogPreview','fitRunDialogPreview','openRunCrop','openRunPlaybackFullscreen','runPlaybackDefaultSeconds','formatRunPlaybackTime','runPlaybackControlsHtml','runPlaybackSurface','paintRunPlayback','stopRunPlayback','toggleRunPlayback','scrubRunPlayback','setRunPlaybackDuration','updateRunPlaybackDuration','applyRunPlaybackDurationPreset','restartRunPlayback','bindRunPlaybackControls','runBuilderStage','runBuilderTrickEditorHtml','addRunBuilderPoint','dragRunPoint','updateRunBuilderMapDom','saveRunPlan','playFinishedRunBuilder'];
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
 const RUN_PLAYBACK_MAX_SECONDS=3600; const rememberRunEdit=()=>{}; let runUndoStack=[],runRedoStack=[];
 const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const currentRunFormState=()=>({...state.runBuilder});
 const runBuilderRefreshView=async()=>render();
 const notify=()=>{}; const isCoachRole=()=>false; const getLinkedCoachIdForCurrentAthlete=async()=> 'coach';
 const setSyncStatus=()=>{}; const cacheClear=()=>{};
 let saved; const client={from:()=>({insert:p=>{saved=p;return Promise.resolve({});}})};
 ${functions}
 let image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#154a43"/><path d="M0 100H600M0 200H600M0 300H600M0 400H600M0 500H600M100 0V600M200 0V600M300 0V600M400 0V600M500 0V600" stroke="#51aa98"/></svg>');
 state.runBuilder.imageDataUrl=image;
 state.runBuilder.points=Array.from({length:18},(_,i)=>({x:20+(i%6)*10,y:30+Math.floor(i/6)*15,label:i>0&&i<17?'Trick '+i:'',bend:0}));
 function render(){document.querySelector('#host').innerHTML='<div id="run-builder-live" class="run-builder-live"><button id="crop-run-image" onclick="openRunCrop()">Crop image</button><div class="run-map-stage"><div id="run-map">'+runMapHtml(image,state.runBuilder?.points||[], 'Park',true,true,state.runBuilder?.view)+'</div>'+runPlaybackControlsHtml(state.runBuilder?.points||[])+'</div></div>';bindRunPlaybackControls();document.querySelector('#run-map').onclick=addRunBuilderPoint;}
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
 for(const [photoWidth,photoHeight] of [[600,600],[964,1497],[1497,964]]){
 await page.evaluate(([w,h])=>{image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'"><rect width="100%" height="100%" fill="#154a43"/><path d="M0 100H1497M0 200H1497M0 300H1497M0 400H1497M100 0V1497M200 0V1497M300 0V1497M400 0V1497" stroke="#51aa98"/></svg>');state.runBuilder.imageDataUrl=image;},[photoWidth,photoHeight]);
 for(const [width,height] of [[390,844],[768,1024],[1024,768],[1366,1024]]){
 for(const card of [false,true]){
 for(const crop of [false,true]){
 await page.setViewportSize({width,height});
 await page.evaluate(({card,crop})=>{state.runBuilder.view=crop?{scale:4,x:100,y:-100}:runView();state.runBuilder.points[0]={...state.runBuilder.points[0],x:0,y:0};state.runBuilder.points[1]={...state.runBuilder.points[1],x:100,y:100,label:'Long trick name underneath the highlighted dot'};state.runBuilder.points[17]={...state.runBuilder.points[17],x:100,y:0};render();if(card)document.querySelector('.run-builder-live').className='run-card';}, {card,crop});
 await page.waitForFunction(()=>document.querySelector('.run-map-content img').complete);
 const before=await geometry('#run-map .run-map-preview');
 const expected=await page.evaluate(()=>state.runBuilder.points.map(p=>[p.x/100,p.y/100]));
 matches(expected,before); // Test photo anchoring itself, not just preservation of an already broken view.
 if(photoWidth===964&&width===1366&&!card&&!crop){
   await page.click('#crop-run-image');
   matches(expected,await geometry('.run-crop-dialog .run-map-preview'));
   await page.locator('.run-crop-dialog input').evaluate(input=>{input.value='2';input.dispatchEvent(new Event('input'));});
   matches(expected,await geometry('.run-crop-dialog .run-map-preview'));
   await page.click('[data-crop-cancel]');
 }

 await page.click('[data-run-expand]');
 await page.evaluate(()=>stopRunPlayback());
 matches(before,await geometry('.run-fullscreen-playback .run-map-preview'));
 await page.setViewportSize({width:height,height:width});
 matches(before,await geometry('.run-fullscreen-playback .run-map-preview'));
 const onScreen = await page.locator('.run-fullscreen-playback .run-map-preview').evaluate(preview => {
   const frame=preview.getBoundingClientRect();
   return [...preview.querySelectorAll('.run-marker')].every(marker=>{const r=marker.getBoundingClientRect();return r.left>=frame.left&&r.right<=frame.right&&r.top>=frame.top&&r.bottom<=frame.bottom&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;});
 });
 assert(onScreen,'Fullscreen must keep every dot inside the visible frame, including extreme crop/edge dots after rotation');
 await page.evaluate(()=>paintRunPlayback(document.querySelector('.run-fullscreen-controls'),1/17));
 const labelGeometry=await page.locator('.run-fullscreen-playback .run-map-preview').evaluate(preview=>{
   const dot=preview.querySelector('.run-marker.play-active').getBoundingClientRect(),label=preview.querySelector('.run-dot-label'),box=label.getBoundingClientRect();
   return {text:label.textContent,visible:!label.hidden,below:box.top>=dot.bottom,inside:box.left>=0&&box.right<=innerWidth&&box.bottom<=innerHeight};
 });
 assert(labelGeometry.visible&&labelGeometry.below&&labelGeometry.inside,'Active trick label should appear below the dot and remain on screen: '+JSON.stringify({photoWidth,photoHeight,width,height,card,crop,labelGeometry}));
 assert(labelGeometry.text.includes('Long trick name'));
 if(process.env.JKCREW_SCREENSHOT&&photoWidth===964&&width===1366&&!card&&!crop){await page.setViewportSize({width:1366,height:1024});await page.screenshot({path:process.env.JKCREW_SCREENSHOT});}
 await page.click('.run-fullscreen-close');
 await page.waitForFunction(()=>!document.querySelector('dialog'));
 cases++;
 }
 }
 }
 }
 // An unnamed route point is playable and saveable, including in fullscreen.
 await page.evaluate(async()=>{state.runBuilder.points[1].label='   ';state.runBuilder.stage='tricks';await playFinishedRunBuilder();stopRunPlayback();});
 assert.equal(await page.evaluate(()=>state.runBuilder.stage),'playback');
 await page.evaluate(()=>paintRunPlayback(document.querySelector('#run-builder-live [data-run-playback-controls]'),1/17));
 assert.equal(await page.locator('#run-builder-live [data-run-playback-label]').innerText(),'NO TRICK');
 await page.click('[data-run-expand]');await page.evaluate(()=>{stopRunPlayback();paintRunPlayback(document.querySelector('.run-fullscreen-controls'),1/17);});
 assert.equal(await page.locator('.run-fullscreen-playback [data-run-playback-label]').innerText(),'NO TRICK');
 await page.click('.run-fullscreen-close');
 await page.evaluate(async()=>{state.runBuilder.points[1].label='';const form=document.createElement('form');form.innerHTML='<input name="title" value="Unfinished qualifying run">';await saveRunPlan({preventDefault(){},currentTarget:form});});
 assert.equal(await page.evaluate(()=>saved.points[1].label),'');
 assert.equal(await page.evaluate(()=>saved.points.length),18);
 assert.deepEqual(errors,[]);
 console.log(`PASS: all 18 dots retain photo coordinates in ${cases} square/portrait/landscape photo, phone/iPad, builder/saved-run and crop cases, including rotation; unnamed dots also play and save.`);
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
