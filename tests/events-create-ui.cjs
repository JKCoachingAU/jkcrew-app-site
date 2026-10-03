// Isolated browser fixtures exercise production event creation without contacting real accounts.
const fs=require('fs'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=require('path').resolve(__dirname,'..');
const source=fs.readFileSync(root+'/app.js','utf8');
const extract=name=>{const start=source.search(new RegExp('^(?:async )?function '+name+'\\(','m'));assert(start>=0,name);const rest=source.slice(start);return rest.slice(0,rest.indexOf('\n}')+2)};
const names=['renderContests','sharedContestEventFormHtml','openCoachCreateEvent','saveSharedContestEvent','setButtonBusy','withTimeout','bindContestEventActions','contestEventCardsHtml'];
const fixture=`
const state={view:'contests',user:{id:'coach-a'},profile:{role:'coach'}};
const isCoachRole=role=>['coach','admin'].includes(role);
const escapeHtml=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const normalizeContestEventTitle=v=>v.trim().toLowerCase();
const contestEventDay=v=>new Date(v).toISOString().slice(0,10);
const firstName=v=>v?.display_name||'Rider';
const dateLabel=v=>new Date(v).toLocaleDateString();
const messageFrom=e=>e.message;
window.rows=[];window.inserts=[];window.attendance=[];window.notifications=[];window.fail=false;window.hold=false;
const client={from(table){if(table!=='dashboard_items')throw Error(table);return {insert(payload){inserts.push(payload);return {select(){return {async single(){if(hold)await new Promise(r=>window.release=r);if(fail)return {error:{message:'Connection interrupted. Try again.'}};const row={...payload,id:'saved-'+inserts.length};rows.push(row);return {data:row}}}}}}}}};
const getSharedUpcomingEventData=async()=>({events:rows,attendance:[]});
const getEventCoachRoster=async()=>[];
const getCoachContestRunPlans=async()=>[];
const getRiderRunSummaries=async()=>[];
const getParentRiderContext=async()=>({selected:{id:'child',display_name:'Child'}});
const parentChildSwitcherHtml=()=>'';
const setContestAttendance=async(id,going)=>attendance.push({id,going});
const notify=(message,tone)=>notifications.push({message,tone});
const cacheClear=()=>{};
const closeContestEventModal=()=>{};
const stopRunPlayback=()=>{};
const bindRunBuilderActions=()=>{};
const bindRiderSavedRuns=()=>{};
const bindCoachContestMergeActions=()=>{};
const bindParentPageActions=()=>{};
const openRunBuilder=()=>{};
const contestEventAttendees=()=>[];
const contestEventFacesHtml=()=>'<small>0 attending</small>';
const contestEventDataAttributes=()=>'';
const riderSavedRunsHtml=()=>'';
const runPlansHtml=()=>'';
const closedPanelAccordion=(title,subtitle,body,id)=>'<details id="'+id+'"><summary>'+title+'</summary>'+body+'</details>';
window.start=async(role='coach')=>{document.querySelector('dialog')?.close();state.profile.role=role;state.user.id=role+'-a';rows=[];inserts=[];attendance=[];notifications=[];fail=false;hold=false;await renderContests();};
`;
(async()=>{
const browser=await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.abort());
let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++};
try {
await page.setContent('<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"><div class="app-shell coach-shell"><main id="view" data-view="contests"></main></div></div></body></html>');
await page.addStyleTag({content:fs.readFileSync(root+'/styles.css','utf8')+'\n#app .app-shell{display:block!important}#view{margin:auto;padding:18px;max-width:1250px}'});
await page.addScriptTag({content:fixture+names.map(extract).join('\n')});
const plus=page.getByRole('button',{name:'Add new event',exact:true});
const fill=async()=>{await page.locator('#shared-event-title').fill('New crew contest');await page.locator('#shared-event-venue').fill('Loganland');await page.locator('#shared-event-start').fill('2027-12-01T09:00');await page.locator('#shared-event-end').fill('2027-12-01T16:00')};
const submit=async()=>page.locator('#shared-contest-event-form').evaluate(f=>f.requestSubmit());
for(const width of [320,390,1440]){
 await page.setViewportSize({width,height:900});await page.evaluate(()=>start());eq(await plus.count(),1);const b=await plus.boundingBox();eq([b.width,b.height],[44,44]);
 await plus.click();eq(await page.locator('dialog').count(),1);eq(await page.evaluate(()=>document.activeElement.id),'shared-event-title');
 eq(await page.locator('dialog').evaluate(d=>d.scrollWidth<=d.clientWidth),true);
 if(process.env.JKCREW_EVENT_SCREENSHOTS)await page.screenshot({path:'/tmp/jkcrew-add-event-'+width+'.png'});
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('dialog'));eq(await page.evaluate(()=>document.activeElement.id),'add-contest-event');
}
await page.evaluate(()=>start());await plus.click();await fill();await page.locator('#shared-event-end').fill('2027-11-30T09:00');await submit();eq(await page.evaluate(()=>inserts.length),0);eq(await page.locator('.shared-event-form-error').isVisible(),true);
await fill();await page.evaluate(()=>{fail=true});await submit();await page.waitForFunction(()=>!document.querySelector('form').dataset.saving);eq(await page.locator('#shared-event-title').inputValue(),'New crew contest');eq(await page.locator('.shared-event-form-error').textContent(),'Connection interrupted. Try again.');
await page.evaluate(()=>{fail=false;hold=true});await submit();await page.waitForFunction(()=>typeof release==='function');await submit();eq(await page.evaluate(()=>inserts.length),2);await page.keyboard.press('Escape');eq(await page.locator('dialog').count(),1);
await page.evaluate(()=>{hold=false;release()});await page.waitForFunction(()=>!document.querySelector('dialog'));eq(await page.evaluate(()=>attendance.length),0);eq(await page.evaluate(()=>rows.length),1);eq(await page.evaluate(()=>inserts.at(-1).owner_id),'coach-a');eq(await page.evaluate(()=>inserts.at(-1).created_by),'coach-a');eq(await page.getByRole('button',{name:'Open New crew contest and see who is going'}).count(),1);
await plus.click();await fill();await submit();await page.waitForFunction(()=>!document.querySelector('dialog'));eq(await page.evaluate(()=>inserts.length),2);eq(await page.evaluate(()=>rows.length),1);
// A stalled network save must release the modal and retain the draft for retry.
await page.evaluate(()=>start());await plus.click();await fill();await page.evaluate(()=>{hold=true});await submit();
await page.waitForFunction(()=>document.querySelector('.shared-event-form-error')?.textContent.includes('timed out'),null,{timeout:20000});
eq(await page.locator('button[type=submit]').isEnabled(),true);eq(await page.locator('#shared-event-title').inputValue(),'New crew contest');
await page.evaluate(()=>{hold=false;release()});await page.waitForFunction(()=>rows.length===1);await submit();await page.waitForFunction(()=>!document.querySelector('dialog'));eq(await page.evaluate(()=>inserts.length),1);
await page.evaluate(()=>start('admin'));await plus.click();await fill();await submit();await page.waitForFunction(()=>!document.querySelector('dialog'));eq(await page.evaluate(()=>rows.length),1);
await page.evaluate(()=>start('athlete'));eq(await plus.count(),0);await page.locator('#shared-event-create summary').click();await fill();await submit();await page.waitForFunction(()=>rows.length===1);eq(await page.evaluate(()=>attendance),[{id:'saved-1',going:true}]);
await page.evaluate(()=>start('parent'));eq(await plus.count(),0);eq(await page.locator('#shared-contest-event-form').count(),0);await page.evaluate(()=>openCoachCreateEvent());eq(await page.locator('dialog').count(),0);
eq(errors,[]);console.log('PASS: '+checks+' coach event UI/save checks, including mobile/desktop, keyboard, retry, duplicates and roles.');
}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
