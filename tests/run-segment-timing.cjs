const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.JKCREW_PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..'),app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const names=['bindRunRemovalActions','refreshRunRemovalView','archiveRunPlan','runTiming','runTimedPosition','runPlaybackDefaultSeconds','runTimeBudget','runTimeBudgetHtml','paintRunTimeBudget','runTimingRowHtml','runTimingEditorHtml','bindRunTimingControls','runSegmentEditorHtml','paintRunSegmentSelection','selectRunSegment','runPointColor','runView','runPathBetween','runRouteSvg','runMapHtml','runBuilderStage','runBuilderTrickEditorHtml','updateRunTiming','bindRunBuilderActions','addRunBuilderPoint','updateRunBuilderMapDom','syncRunPhotoFrame','cloneRunDialogPreview','runPlaybackControlsHtml','formatRunPlaybackTime','runPlaybackSurface','paintRunPlayback','positionRunTrickLabel','setRunPlaybackDuration','rememberRunEdit','restoreRunEdit'];
const extract=name=>{const start=app.search(new RegExp('^(?:async )?function '+name+'\\(','m'));assert(start>=0,name);const rest=app.slice(start);return rest.slice(0,rest.indexOf('\n}')+2);};
const handlers=[...extract('bindRunBuilderActions').matchAll(/addEventListener\("[^"]+", (\w+)\)/g)].map(m=>m[1]).filter(n=>!names.includes(n));
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH});
 for(const viewport of [{width:390,height:844},{width:1024,height:768}]){
 const page=await browser.newPage({viewport,hasTouch:true,isMobile:viewport.width===390});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><main id="host" style="padding:16px;max-width:1000px;margin:auto"></main>');
 await page.addStyleTag({content:fs.readFileSync(path.join(root,'styles.css'),'utf8')});
 await page.addScriptTag({content:`
 let editable=true;const liveRunCanEdit=()=>editable,bindLiveRunControls=()=>{},bindRiderSavedRuns=()=>{},bindRunPlaybackControls=()=>{},stopRunPlayback=()=>{};
 const state={draggedRunPoint:null,runPointMapClickBlockUntil:0,runBuilder:{stage:'tricks',selectedPointIndex:3,points:[{x:10,y:15,travelSeconds:2},{x:80,y:15,travelSeconds:3},{x:80,y:45,travelSeconds:7},{x:15,y:45,travelSeconds:10,holdSeconds:2,label:'Manual'},{x:15,y:80,travelSeconds:12,label:'Barspin'},{x:80,y:80}]}};
 let runUndoStack=[],runRedoStack=[];const currentRunFormState=()=>({...state.runBuilder});const RUN_PLAYBACK_MAX_SECONDS=3600;
 const escapeHtml=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
 ${[...new Set(handlers)].map(n=>`const ${n}=()=>{};`).join('\n')}
 ${names.map(extract).join('\n')}
 const photo='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#244344"/><path d="M60 40H700V490H60Z M300 170H480V330H300Z" fill="#435758" stroke="#6b7d7e" stroke-width="20"/></svg>');
 state.runBuilder.imageDataUrl=photo;
 function render(){const p=state.runBuilder.points;document.querySelector('#host').innerHTML='<section id="run-builder-live"><form id="run-builder-form"><button type="button" data-run-history="undo">Undo</button><button type="button" data-run-history="redo">Redo</button><div class="run-map-stage"><div id="run-map" class="run-map">'+runMapHtml(photo,p,'Test course',true,false)+' </div>'+runSegmentEditorHtml(p,state.runBuilder.selectedSegmentIndex)+runPlaybackControlsHtml(p)+'</div>'+runBuilderTrickEditorHtml(p)+runTimingEditorHtml(p)+'</form></section>';bindRunBuilderActions();}
 const runBuilderRefreshView=async()=>render();render();
 window.inspect=()=>structuredClone(state.runBuilder);
 `});
 const hit=page.locator('[data-edit-run-segment="3"]');
 // Tap an actual rendered curve, not a synthetic event or its bounding-box corner.
 const tap=async locator=>{await locator.scrollIntoViewIfNeeded();const p=await locator.evaluate(el=>{const p=el.getPointAtLength(el.getTotalLength()/2);return new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM()).toJSON();});await page.touchscreen.tap(p.x,p.y);};
 await tap(hit);
 const panel=page.locator('[data-run-segment-editor]'),input=panel.locator('input');
 assert(await panel.isVisible());assert.equal(await panel.locator('.run-segment-heading strong').innerText(),'Dot 4 → Dot 5');
 assert.equal(await input.inputValue(),'10');assert((await panel.innerText()).includes('Manual → Barspin'));
 assert.equal((await page.evaluate(()=>inspect())).points.length,6,'Line taps never add dots');
 assert.equal(await page.locator('[data-run-segment="5"]').getAttribute('class'),'segment-selected');
 assert.equal(await page.locator('[data-run-time-index="3"]').last().locator('xpath=ancestor::*[contains(@class,"run-timing-row")]').locator('strong').innerText(),'Dot 4 → Dot 5','Sidebar uses photo dot numbers, not offset trick numbers');
 await input.fill('7');await input.press('Tab');
 let data=await page.evaluate(()=>inspect());assert.equal(data.points[3].travelSeconds,7);assert.equal(data.points[2].travelSeconds,7);assert.equal(data.points[4].travelSeconds,12);assert.equal(data.points[3].holdSeconds,2);
 assert.equal(await page.locator('.run-timing-row [data-run-time-index="3"][data-run-time-key="travelSeconds"]').inputValue(),'7');
 assert.equal(await page.locator('[data-run-playback-controls]').getAttribute('data-run-playback-seconds'),'33');
 // Playback leaves dot 4 after its 2s hold at t=14 and reaches dot 5 at t=21.
 const playback=await page.evaluate(()=>{const c=document.querySelector('[data-run-playback-controls]'),timing=runTiming(state.runBuilder.points);return [14,17.5,21].map(seconds=>{paintRunPlayback(c,seconds/33);return {position:runTimedPosition(timing,seconds/33),x:parseFloat(document.querySelector('[data-run-playhead]').style.left),y:parseFloat(document.querySelector('[data-run-playhead]').style.top)};});});
 assert.deepEqual(playback.map(x=>x.position),[3,3.5,4]);
 assert(Math.abs(playback[1].x-15)<.01&&Math.abs(playback[1].y-62.5)<.1,'Playhead is halfway along the correct physical line after half its time');
 // Touch +/- repeatedly without remounting inputs or resetting selected dots/zoom.
 await input.scrollIntoViewIfNeeded();await page.evaluate(()=>{window.originalInput=document.querySelector('[data-run-segment-editor] input');window.scale=visualViewport.scale;});
 for(let i=0;i<5;i++)await panel.getByRole('button',{name:'Increase travel time',exact:true}).tap();
 assert.equal(await input.inputValue(),'12');assert.equal(await page.evaluate(()=>originalInput===document.querySelector('[data-run-segment-editor] input')&&scale===visualViewport.scale),true);
 assert.equal((await page.evaluate(()=>inspect())).selectedPointIndex,3);
 assert.equal(await page.locator('[data-run-playback-controls]').getAttribute('data-run-playback-seconds'),'38');
 assert((await panel.locator('[data-run-segment-total]').innerText()).includes('38s planned'));
 // Undo/redo restores the same segment, travel time and budget.
 await page.getByRole('button',{name:'Undo',exact:true}).click();assert.equal(await input.inputValue(),'11');
 await page.getByRole('button',{name:'Redo',exact:true}).click();assert.equal(await input.inputValue(),'12');
 // Sidebar edits mirror into the already-open map editor.
 await page.locator('.run-timing-row [data-run-time-index="3"][data-run-time-key="travelSeconds"]').fill('9.5');assert.equal(await input.inputValue(),'9.5');
 // Newly loaded saved point JSON retains timing on its source dot.
 await page.evaluate(()=>{state.runBuilder.points=JSON.parse(JSON.stringify(state.runBuilder.points));render();});assert.equal(await input.inputValue(),'9.5');
 // Read-only live participants cannot change travel times even through an input event.
 await page.evaluate(()=>{editable=false;const input=document.querySelector('[data-run-segment-editor] input');input.value='40';input.dispatchEvent(new Event('input'));});assert.equal((await page.evaluate(()=>inspect())).points[3].travelSeconds,9.5);
 await page.evaluate(()=>{editable=true;render();});
 // Hit areas follow a moved/bent dot. The visible route still has exactly five playback paths.
 await page.evaluate(()=>{state.runBuilder.points[4].x=30;state.runBuilder.points[4].bend=35;updateRunBuilderMapDom(4);});
 assert.equal(await hit.getAttribute('d'),await page.locator('[data-run-segment="5"]').getAttribute('d'));assert.equal(await page.locator('[data-run-segment]').count(),5);
 await panel.getByRole('button',{name:'Done',exact:true}).click();assert(await panel.isHidden());
 await hit.focus();await page.keyboard.press('Enter');assert(await panel.isVisible());
 // Fullscreen copy contains no editable SVG buttons, even when entered from Build.
 assert.equal(await page.evaluate(()=>cloneRunDialogPreview(document.querySelector('[data-run-map-preview]')).querySelectorAll('[data-edit-run-segment]').length),0);
 // Watch renders no line editors/targets.
 assert.equal(await page.evaluate(()=>{const t=document.createElement('template');t.innerHTML=runMapHtml(photo,state.runBuilder.points,'Watch',false,true);return t.content.querySelectorAll('[data-edit-run-segment]').length;}),0);
 await page.screenshot({path:'/tmp/jkcrew-line-time-'+viewport.width+'.png',fullPage:true});
 assert.deepEqual(errors,[]);await page.close();
 }
 await browser.close();console.log('PASS: phone/tablet real line taps, exact dot 4→5 timing/playhead, holds, mirrored inputs, +/- focus and zoom, undo/redo, reload, readonly protection, bent hit targets, keyboard, and clean Watch/fullscreen.');
})().catch(e=>{console.error(e);process.exit(1)});
