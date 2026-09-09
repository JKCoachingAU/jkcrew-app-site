const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.JKCREW_PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..'),app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const names=['runTimeBudget','runTimeBudgetHtml','paintRunTimeBudget','runTiming','runPlaybackDefaultSeconds','runTimingRowHtml','runTimingEditorHtml','runBuilderTrickEditorHtml','runPointColor','updateRunTiming','updateRunFinalType','updateRunBuilderTrick','runMapHtml','runView','runRouteSvg','runPathBetween','bindRunBuilderActions'];
const extract=name=>{const start=app.search(new RegExp('^(?:async )?function '+name+'\\(','m'));const rest=app.slice(start);return rest.slice(0,rest.indexOf('\n}')+2);};
const handlers=[...extract('bindRunBuilderActions').matchAll(/addEventListener\("[^"]+", (\w+)\)/g)].map(m=>m[1]).filter(n=>!names.includes(n));
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH});
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><main id="host" class="content" style="padding:16px"></main>');
 await page.addStyleTag({content:fs.readFileSync(path.join(root,'styles.css'),'utf8')});
 await page.addScriptTag({content:`
 const bindLiveRunControls=()=>{};const liveRunCanEdit=()=>true;
 const bindRiderSavedRuns=()=>{};
 const state={runBuilder:{points:Array.from({length:14},(_,i)=>({x:i*7,y:50,label:'Trick '+i,travelSeconds:7,holdSeconds:0})),selectedPointIndex:7}};
 const escapeHtml=s=>String(s);const rememberRunEdit=()=>{};const stopRunPlayback=()=>{},bindRunPlaybackControls=()=>{};
 ${[...new Set(handlers)].filter(n=>n!=='rememberRunEdit').map(n=>`const ${n}=()=>{};`).join('\n')}
 ${names.map(extract).join('\n')}
 window.redraws=0;
 function render(){document.querySelector('#host').innerHTML='<div style="height:260px"></div><section id="run-builder-live" class="run-builder-stage-tricks">'+runTimeBudgetHtml(state.runBuilder.points)+runBuilderTrickEditorHtml(state.runBuilder.points)+runTimingEditorHtml(state.runBuilder.points)+'<div data-run-map-preview></div></section><div style="height:300px"></div>';document.querySelector('.run-trick-editor-list').style.cssText='max-height:360px!important;overflow-y:auto';bindRunBuilderActions();}
 const runBuilderRefreshView=()=>{redraws++;render();};render();
 `});
 const input=page.locator('[data-run-time-index="7"][data-run-time-key="travelSeconds"]');
 await input.evaluate(el=>el.scrollIntoView({block:'center'}));
 const before=await page.evaluate(()=>{window.originalInput=document.querySelector('[data-run-time-index="7"][data-run-time-key="travelSeconds"]');return {inner:document.querySelector('.run-trick-editor-list').scrollTop,outer:scrollY,scale:visualViewport.scale};});
 const stepper=input.locator('..');
 for(let i=0;i<4;i++)await stepper.getByRole('button',{name:'Increase Travel time to next trick'}).tap();
 assert.equal(await input.inputValue(),'11');
 assert.equal(await page.evaluate(()=>state.runBuilder.points[7].travelSeconds),11);
 assert.equal(await page.evaluate(()=>originalInput===document.querySelector('[data-run-time-index="7"][data-run-time-key="travelSeconds"]')),true);
 const after=await page.evaluate(()=>({inner:document.querySelector('.run-trick-editor-list').scrollTop,outer:scrollY,scale:visualViewport.scale}));
 assert.deepEqual(after,before,'Repeated timing taps preserve nested scroll, page position and viewport scale');
 assert.equal(await page.evaluate(()=>redraws),0);
 assert.equal(await page.evaluate(()=>JSON.parse(document.querySelector('[data-run-map-preview]').dataset.runTiming)[7].travel),11);
 assert((await page.locator('[data-run-total]').innerText()).startsWith('95 seconds planned'));
 await input.fill('12');await input.press('Tab');assert.equal(await input.inputValue(),'12');
 assert.equal(await page.evaluate(()=>state.runBuilder.points[7].travelSeconds),12);
 assert((await input.evaluate(el=>parseFloat(getComputedStyle(el).fontSize)))>=16);
 assert.equal(await stepper.getByRole('button',{name:'Increase Travel time to next trick'}).evaluate(el=>getComputedStyle(el).touchAction),'manipulation');
 await input.fill('120');await input.press('Tab');await stepper.getByRole('button',{name:'Increase Travel time to next trick'}).tap();assert.equal(await input.inputValue(),'120');
 // Total updates while typing, includes holds and shows proximity/over-limit in words and colour.
 await page.evaluate(()=>{state.runBuilder.points=[{x:10,y:10,travelSeconds:26},{x:40,y:40,travelSeconds:21,holdSeconds:5},{x:90,y:90}];render();});
 const total=page.locator('[data-run-budget-total]'),remaining=page.locator('[data-run-budget-remaining]'),counter=page.locator('[data-run-time-budget]');
 assert.equal(await total.innerText(),'52s / 60s');assert.equal(await remaining.innerText(),'8s remaining');assert.equal(await counter.getAttribute('data-budget-tone'),'near');
 const travel=page.locator('[data-run-time-index="1"][data-run-time-key="travelSeconds"]');
 await travel.fill('29');assert.equal(await total.innerText(),'60s / 60s');assert.equal(await remaining.innerText(),'Limit reached · 0s remaining');
 await travel.fill('31');assert.equal(await total.innerText(),'62s / 60s');assert.equal(await remaining.innerText(),'2s over limit');assert.equal(await counter.getAttribute('data-budget-tone'),'over');
 assert.equal(await counter.locator('[role="progressbar"]').getAttribute('aria-valuenow'),'60');
 await travel.fill('10');assert.equal(await total.innerText(),'41s / 60s');assert.equal(await counter.getAttribute('data-budget-tone'),'ready');
 await page.locator('[data-run-limit]').fill('45');assert.equal(await total.innerText(),'41s / 45s');assert.equal(await remaining.innerText(),'4s remaining');
 await page.evaluate(()=>{document.querySelector('#run-builder-live').style.paddingBottom='1000px';window.scrollTo(0,500);});
 const bounds=await counter.boundingBox();assert(bounds.y>=79&&bounds.y<=82,'Counter stays visible while the editor scrolls');
 // The last dot defaults to a finish, but can become a timed, named final trick.
 assert(await page.locator('[data-run-trick-index="2"]').isDisabled());
 await page.locator('[data-run-final-type]').selectOption('trick');
 await page.locator('[data-run-trick-index="2"]').fill('Flair');
 await page.locator('[data-run-time-index="2"][data-run-time-key="holdSeconds"]').fill('3');
 assert.equal(await page.evaluate(()=>state.runBuilder.points[2].label),'Flair');
 assert.equal(await page.evaluate(()=>runTiming(state.runBuilder.points)[2].hold),3);
 assert.equal(await total.innerText(),'44s / 45s');
 const markup=await page.evaluate(()=>runMapHtml('photo',state.runBuilder.points));
 assert(markup.includes('data-run-point-label="Flair"'));assert.equal((markup.match(/class="run-marker run-endpoint/g)||[]).length,1,'Only start is an endpoint for a final trick');
 await page.locator('[data-run-final-type]').selectOption('finish');
 assert.equal(await total.innerText(),'41s / 45s');assert(await page.locator('[data-run-trick-index="2"]').isDisabled());
 assert.equal(await page.locator('.run-timing-editor [data-run-time-index="0"]').count(),0,'Circled starting-time block is removed');
 assert.deepEqual(errors,[]);await browser.close();
 console.log('PASS: repeated touch timing adjustments retain the seventh trick, DOM/focus context, scroll and zoom; live typing, travel plus hold totals, 52/60/62-second states, custom limits, sticky visibility and playback timing stay in sync.');
})().catch(e=>{console.error(e);process.exit(1)});
