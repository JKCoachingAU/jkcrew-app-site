const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.JKCREW_PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..'),app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const names=['runTiming','runPlaybackDefaultSeconds','runTimingRowHtml','runTimingEditorHtml','runBuilderTrickEditorHtml','runPointColor','updateRunTiming','bindRunBuilderActions'];
const extract=name=>{const start=app.search(new RegExp('^(?:async )?function '+name+'\\(','m'));const rest=app.slice(start);return rest.slice(0,rest.indexOf('\n}')+2);};
const handlers=[...extract('bindRunBuilderActions').matchAll(/addEventListener\("[^"]+", (\w+)\)/g)].map(m=>m[1]).filter(n=>!names.includes(n));
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH});
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><main id="host" style="padding:16px"></main>');
 await page.addStyleTag({content:fs.readFileSync(path.join(root,'styles.css'),'utf8')});
 await page.addScriptTag({content:`
 const state={runBuilder:{points:Array.from({length:14},(_,i)=>({x:i*7,y:50,label:'Trick '+i,travelSeconds:7,holdSeconds:0})),selectedPointIndex:7}};
 const escapeHtml=s=>String(s);const rememberRunEdit=()=>{};const stopRunPlayback=()=>{},bindRunPlaybackControls=()=>{};
 ${[...new Set(handlers)].filter(n=>n!=='rememberRunEdit').map(n=>`const ${n}=()=>{};`).join('\n')}
 ${names.map(extract).join('\n')}
 window.redraws=0;
 function render(){document.querySelector('#host').innerHTML='<div style="height:260px"></div><section id="run-builder-live">'+runBuilderTrickEditorHtml(state.runBuilder.points)+runTimingEditorHtml(state.runBuilder.points)+'<div data-run-map-preview></div></section><div style="height:300px"></div>';document.querySelector('.run-trick-editor-list').style.cssText='max-height:360px!important;overflow-y:auto';bindRunBuilderActions();}
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
 assert.deepEqual(errors,[]);await browser.close();
 console.log('PASS: repeated touch timing adjustments retain the seventh trick, DOM/focus context, scroll and zoom; manual entry, limits, total and playback timing stay in sync.');
})().catch(e=>{console.error(e);process.exit(1)});
