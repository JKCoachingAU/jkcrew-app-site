const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.JKCREW_PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..'),app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const names=['openRunDuplicate','duplicateCurrentRun','editRunPlan','saveRunPlan','canEditRun','runRemovalButtonHtml','runSummaryCardHtml','runPlansHtml','coachEventRunViewerHtml','runView','currentRunFormState','runBuilderStage'];
const extract=name=>{const start=app.search(new RegExp('^(?:async )?function '+name+'\\(','m'));assert(start>=0,name);const rest=app.slice(start);return rest.slice(0,rest.indexOf('\n}')+2);};
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH});
 for(const role of ['athlete','coach']){
 const page=await browser.newPage({viewport:role==='athlete'?{width:390,height:844}:{width:1024,height:768},hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><main id="host"></main>');
 await page.addStyleTag({content:fs.readFileSync(path.join(root,'styles.css'),'utf8')});
 await page.addScriptTag({content:`
 const state={user:{id:${JSON.stringify(role==='coach'?'coach':'rider')}},profile:{role:${JSON.stringify(role)}},selectedAthleteId:'wrong-rider'};
 let liveRun=null,runUndoStack=[],runRedoStack=[];const isCoachRole=r=>r==='coach';
 const escapeHtml=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
 const dateLabel=()=>'',runMapHtml=()=>'',runReviewPanelHtml=()=>'',runPlaybackControlsHtml=()=>'';
 window.messages=[];const notify=m=>messages.push(m),messageFrom=e=>e.message,stopRunPlayback=()=>{},cacheClear=()=>{},setSyncStatus=()=>{},closeContestEventModal=()=>{},withTimeout=async p=>p;
 const setButtonBusy=b=>{b.disabled=true;return()=>b.disabled=false;};
 const getLinkedCoachIdForCurrentAthlete=async()=>{throw Error('A duplicate must retain its original coach');};
 window.original={id:'original',athlete_id:'rider',coach_id:'coach',created_by:'coach',title:'Qualifying',venue:'Park',plan_type:'competition',notes:'Coach notes',contest_item_id:'event',image_data_url:'photo',updated_at:'v1',archived_at:'yesterday',review_status:'approved',points:[{x:10,y:20,travelSeconds:7,view:{scale:1.5,x:2,y:3},timeLimitSeconds:60},{x:45,y:70,label:'Manual',holdSeconds:2,travelSeconds:12},{x:90,y:60,label:'Flair',isTrick:true,holdSeconds:3}]};
 window.inserts=[];window.reads=[];window.failRead=false;window.failSave=false;
 const client={from:table=>({select(){return this},eq(k,id){reads.push(id);return this},single:async()=>failRead?{error:{message:'Offline'}}:{data:structuredClone(original)},insert:async payload=>{if(failSave)return {error:{message:'Save failed'}};inserts.push(structuredClone(payload));return {};}}),rpc:()=>{throw Error('Copies must insert a new run, never update their source');}};
 ${names.map(extract).join('\n')}
 const render=()=>{document.querySelector('#host').innerHTML=state.runBuilder?'<section id="run-builder-live"><form id="run-builder-form"><input id="run-title" name="title" value="'+escapeHtml(state.runBuilder.title)+'"><button type="button" data-run-copy>Duplicate run</button><button type="submit">Save run</button></form></section>':runSummaryCardHtml(original,'Test rider');document.querySelector('[data-copy-saved-run]')?.addEventListener('click',openRunDuplicate);document.querySelector('[data-run-copy]')?.addEventListener('click',openRunDuplicate);document.querySelector('form')?.addEventListener('submit',saveRunPlan);};
 const navigate=async()=>render(),runBuilderRefreshView=async()=>render();render();
 `});
 const original=await page.evaluate(()=>structuredClone(original));
 for(const round of ['Qualifying','Semi-final','Final']){
 await page.evaluate(()=>{state.runBuilder=null;render();});
 await page.getByRole('button',{name:'Duplicate run',exact:true}).click();
 assert.equal(await page.locator('[data-copy-round]').inputValue(),'Semi-final','Qualifying suggests the next round');
 assert.equal(await page.locator('[data-copy-round] option').count(),3);
 await page.locator('[data-copy-round]').selectOption(round);
 assert.equal(await page.locator('[data-copy-name]').inputValue(),round);
 const title=round+' – Plan B';await page.locator('[data-copy-name]').fill(title);
 if(round==='Semi-final')await page.screenshot({path:'/tmp/jkcrew-duplicate-'+role+'.png'});
 await page.getByRole('button',{name:'Create editable copy'}).click();
 await page.locator('#run-title').waitFor();assert.equal(await page.locator('#run-title').inputValue(),title);
 const draft=await page.evaluate(()=>structuredClone(state.runBuilder));
 assert.equal(draft.id,null);assert.equal(draft.updatedAt,null);assert.equal(draft.athleteId,'rider');assert.equal(draft.coachId,'coach');
 assert.deepEqual(draft.points,original.points);assert.deepEqual(draft.view,original.points[0].view);assert.equal(draft.imageDataUrl,'photo');assert.equal(draft.contestItemId,'event');assert.equal(draft.notes,'Coach notes');assert.equal(draft.review_status,undefined);assert.equal(draft.archived_at,undefined);
 await page.evaluate(()=>{state.runBuilder.points[1].label='Barspin';});
 assert.deepEqual(await page.evaluate(()=>original),original,'Editing a copy cannot change the original');
 const before=await page.evaluate(()=>inserts.length);await page.getByRole('button',{name:'Save run',exact:true}).click();
 assert.equal(await page.evaluate(()=>inserts.length),before+1);
 const saved=await page.evaluate(()=>inserts.at(-1));assert.equal(saved.title,title);assert.equal(saved.athlete_id,'rider');assert.equal(saved.coach_id,'coach');assert.equal(saved.created_by,role==='coach'?'coach':'rider');assert.equal(saved.id,undefined);assert.equal(saved.archived_at,undefined);assert.equal(saved.points[1].label,'Barspin');
 assert.deepEqual(await page.evaluate(()=>original),original);
 }
 // Cancel is entirely local and performs no fetch or insert.
 const counts=await page.evaluate(()=>[reads.length,inserts.length]);await page.getByRole('button',{name:'Duplicate run',exact:true}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.deepEqual(await page.evaluate(()=>[reads.length,inserts.length]),counts);
 // Failed loading keeps the existing state and permits retry.
 await page.evaluate(()=>failRead=true);await page.getByRole('button',{name:'Duplicate run',exact:true}).click();await page.getByRole('button',{name:'Create editable copy'}).click();assert.equal(await page.evaluate(()=>state.runBuilder??null),null);assert.equal(await page.evaluate(()=>messages.at(-1)),'Offline');await page.evaluate(()=>failRead=false);
 // The builder copy includes unsaved timing changes but has an independent point array.
 await page.getByRole('button',{name:'Duplicate run',exact:true}).click();await page.getByRole('button',{name:'Create editable copy'}).click();
 await page.evaluate(()=>{state.runBuilder.points[1].travelSeconds=19;window.sourceDraft=state.runBuilder;});
 await page.getByRole('button',{name:'Duplicate run',exact:true}).click();assert.equal(await page.locator('[data-copy-round]').inputValue(),'Final');await page.getByRole('button',{name:'Create editable copy'}).click();
 assert.equal(await page.locator('#run-title').inputValue(),'Final');assert.equal(await page.evaluate(()=>state.runBuilder.points[1].travelSeconds),19);
 await page.evaluate(()=>state.runBuilder.points[1].travelSeconds=21);assert.equal(await page.evaluate(()=>sourceDraft.points[1].travelSeconds),19,'Builder duplicate owns a deep copy');
 await page.evaluate(()=>failSave=true);await page.getByRole('button',{name:'Save run',exact:true}).click();assert.equal(await page.evaluate(()=>state.runBuilder.title),'Final','Failed saving keeps the new draft');
 // Parents and unrelated riders never receive duplicate actions.
 assert.equal(await page.evaluate(()=>{state.profile.role='parent';return runSummaryCardHtml(original).includes('data-copy-saved-run');}),false);
 assert.equal(await page.evaluate(()=>{state.profile.role='athlete';state.user.id='outsider';return runPlansHtml([original]).includes('data-copy-saved-run');}),false);
 assert.deepEqual(errors,[]);await page.close();
 }
 await browser.close();console.log('PASS: rider/coach Qualifying, Semi-final and Final copies, editable names, source isolation, all run content, correct ownership/new inserts, current draft copies, cancel, load/save failures and private actions.');
})().catch(e=>{console.error(e);process.exit(1)});
