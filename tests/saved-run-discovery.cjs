const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.JKCREW_PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..'),app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const extract=name=>{const start=app.search(new RegExp('^(?:async )?function '+name+'\\(','m'));assert(start>=0,name);const rest=app.slice(start);return rest.slice(0,rest.indexOf('\n}')+2);};
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH});
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<main><section id="run-builder-live"><input id="draft-title" value="My unfinished run"><button data-rider-saved-runs="all">Saved runs</button><button data-rider-saved-runs="event-a">Event runs</button></section></main>');
 await page.addStyleTag({content:fs.readFileSync(path.join(root,'styles.css'),'utf8')});
 await page.addScriptTag({content:`
 const state={user:{id:'rider'},profile:{role:'athlete',display_name:'Test Rider'},runBuilder:{title:'My unfinished run',points:[{x:1,y:2}]}};
 const RUN_SUMMARY_SELECT=${app.match(/^const RUN_SUMMARY_SELECT = ("[^"]+");/m)[1]},isCoachRole=role=>role==='coach'||role==='admin';
 const escapeHtml=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
 const dateLabel=s=>s;const messageFrom=e=>e.message;const cacheClear=()=>{};const notify=m=>{throw Error(m)};
 window.calls=[];window.opened=null;
 const rows=[{id:'coach-run',athlete_id:'rider',title:'Urban Sessions',created_by:'coach',contest_item_id:'event-a',updated_at:'Today'}, {id:'rider-run',athlete_id:'rider',title:'My finals',created_by:'rider',contest_item_id:'event-b',updated_at:'Yesterday'}];
 const client={from:table=>{const filters=[],q={select(columns){calls.push({table,columns,filters});return this},eq(k,v){filters.push([k,v]);return this},is(){return this},order(){return this},limit(){return this},then(resolve){return Promise.resolve({data:rows.filter(r=>filters.every(([k,v])=>r[k]===v))}).then(resolve)},single:async()=>({data:{...rows.find(r=>filters.every(([k,v])=>r[k]===v)),image_data_url:'photo',points:[{x:1,y:2}]}})};return q}};
 const openCoachEventRunModal=(runs)=>{window.opened=runs;closeContestEventModal()};
 ${['canEditRun','runRemovalButtonHtml','bindRunRemovalActions','refreshRunRemovalView','archiveRunPlan','riderSavedRunsHtml','openRiderSavedRuns','bindRiderSavedRuns','openProgressRun','closeContestEventModal','withTimeout','setButtonBusy'].map(extract).join('\n')}
 document.addEventListener('click',event=>{const button=event.target.closest('[data-open-progress-run]');if(button)void openProgressRun(button)});
 bindRiderSavedRuns();
 `});
 await page.getByRole('button',{name:'Saved runs',exact:true}).click();
 assert(await page.getByText('From your coach',{exact:true}).isVisible());assert(await page.getByText('Urban Sessions',{exact:true}).isVisible());
 assert(await page.getByText('Made by you',{exact:true}).isVisible());
 assert.equal(await page.inputValue('#draft-title'),'My unfinished run');
 assert.equal(await page.evaluate(()=>state.runBuilder.points.length),1,'Opening saved runs preserves the unfinished builder');
 const call=await page.evaluate(()=>calls[0]);assert(!call.columns.includes('image_data_url'));assert.deepEqual(call.filters,[['athlete_id','rider']]);
 await page.locator('[data-open-progress-run="coach-run"]').click();
 await page.waitForFunction(()=>opened?.[0]?.id==='coach-run');assert.equal(await page.evaluate(()=>opened[0].image_data_url),'photo');
 await page.getByRole('button',{name:'Event runs',exact:true}).click();
 assert.equal(await page.locator('[data-open-progress-run]').count(),1);assert(await page.getByText('Urban Sessions',{exact:true}).isVisible());
 await page.getByRole('button',{name:'Close saved runs'}).click();
 const count=await page.evaluate(()=>calls.length);await page.evaluate(()=>{state.profile.role='parent'});await page.getByRole('button',{name:'Saved runs',exact:true}).click();assert.equal(await page.evaluate(()=>calls.length),count,'Parent does not query private saved runs');
 assert.deepEqual(errors,[]);await browser.close();
 console.log('PASS: fresh coach-made runs visible, rider-scoped metadata, event filtering, full photo on demand, unfinished builder preserved and parent access excluded.');
})().catch(e=>{console.error(e);process.exit(1)});
