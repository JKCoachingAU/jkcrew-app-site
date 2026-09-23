'use strict';
// Execute the production UI functions with isolated fixtures: no real accounts,
// network data, uploads, or production writes are used by this regression test.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
function extract(name) {
  const start = app.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'));
  assert(start >= 0, 'Production function exists: ' + name);
  const rest = app.slice(start);
  return rest.slice(0, rest.indexOf('\n}') + 2);
}
const names = [...new Set([
  ...[...app.matchAll(/^(?:async )?function (\w*[Pp]astEvent\w*)\(/gm)].map(match => match[1]),
  'renderCoachTools', 'coachHubCard', 'coachHubTone', 'withTimeout', 'setButtonBusy',
  'eventCourseViewerHtml', 'openEventCourseViewer', 'closeEventCourseViewer', 'closeContestEventModal',
])];
const fixture = String.raw`
const state={user:{id:'coach-a'},profile:{role:'coach'},view:'pastEvents'};
let recentEventCoursePhoto=null;
const copy=value=>JSON.parse(JSON.stringify(value));
const escapeHtml=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const isCoachRole=role=>['coach','admin'].includes(role);
const dateLabel=value=>new Intl.DateTimeFormat('en-AU',{day:'numeric',month:'short',year:'numeric',timeZone:'Australia/Brisbane'}).format(new Date(value));
const messageFrom=error=>error?.message||String(error);
const notify=(message,tone)=>notifications.push({message,tone});
window.rows=[];window.calls=[];window.photoCalls=[];window.notifications=[];window.waiting=[];
window.holdRead=false;window.holdPhoto=false;window.failRead=null;window.failPhoto=null;
window.photo='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#123b3a"/><path d="M0 800Q300 0 600 600T1200 50" fill="none" stroke="#00d4c5" stroke-width="30"/></svg>');
window.seed=count=>{rows=Array.from({length:count},(_,i)=>({id:'event-'+i,title:i===1?'Loganland Finals':'Finished contest '+i,details:i===1?'Brisbane indoor park':'Park '+i,due_at:new Date(Date.UTC(2026,8,20-i,8)).toISOString(),end_at:new Date(Date.UTC(2026,8,20-i,12)).toISOString(),completed:i%2===0,effective_finished_at:new Date(Date.UTC(2026,8,20-i,12)).toISOString(),course_photo_available:i!==2}));};
window.release=kind=>{const selected=waiting.filter(item=>!kind||item.kind===kind);waiting=waiting.filter(item=>kind&&item.kind!==kind);for(const item of selected)item.resolve();};
const client={async rpc(name,args){
  if(name!=='get_past_contest_events')throw Error('Unexpected RPC '+name);
  calls.push({name,args:copy(args)});
  const search=String(args.p_search||'').toLowerCase();
  const data=copy(rows.filter(row=>!search||(row.title+' '+row.details).toLowerCase().includes(search)).slice(args.p_offset,args.p_offset+args.p_limit));
  const error=failRead;failRead=null;
  if(holdRead)await new Promise(resolve=>waiting.push({kind:'read',resolve}));
  return error?{data:null,error}:{data,error:null};
}};
const getEventCoursePhoto=async id=>{
  photoCalls.push(id);const error=failPhoto;failPhoto=null;
  const image=rows.find(row=>row.id===id)?.course_photo_available?{event_id:id,image_data_url:photo}:null;
  if(holdPhoto)await new Promise(resolve=>waiting.push({kind:'photo',resolve}));
  if(error)throw error;
  return image;
};
const saveEventCoursePhoto=()=>{throw Error('Archived layouts must not upload or overwrite a photo');};
const navigate=async view=>{state.view=view;document.querySelector('#view').dataset.view=view;if(view==='pastEvents')return renderPastEvents();document.querySelector('#view').textContent=view;};
window.start=async(count=50,role='coach')=>{
  release();closeEventCourseViewer();calls=[];photoCalls=[];notifications=[];holdRead=false;holdPhoto=false;failRead=null;failPhoto=null;
  state.user={id:'coach-a'};state.profile={role};state.view='pastEvents';seed(count);
  document.querySelector('#view').dataset.view='pastEvents';await renderPastEvents();
};
`;

async function main() {
  let checks=0;
  const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
  const ok=(value,message)=>{assert(value,message);checks++;};
  const browser=await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH||process.env.JKCREW_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.abort());
  const list=()=>page.locator('[data-past-event-list]');
  const status=()=>page.locator('[data-past-event-status]');
  const buttons=()=>page.locator('[data-view-past-course]');
  const settle=()=>page.waitForFunction(()=>!document.querySelector('[data-past-event-refresh]')?.disabled);
  const waitRows=n=>page.waitForFunction(n=>document.querySelector('[data-past-event-list]')?.children.length===n,n);
  const search=async value=>{await page.locator('#past-event-search').fill(value);await page.locator('#past-event-search-form').evaluate(form=>form.requestSubmit());await settle();};
  try {
    await page.setContent('<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app" class="coach-shell"><main id="view" data-view="pastEvents"></main></div></body></html>');
    await page.addStyleTag({content:fs.readFileSync(path.join(root,'styles.css'),'utf8')+'\nbody{margin:0}#app{display:block!important}#view{max-width:1200px;padding:16px;margin:auto}'});
    await page.addScriptTag({content:fixture+'\n'+names.map(extract).join('\n')});

    await page.evaluate(()=>start());
    await waitRows(24);
    eq(await page.evaluate(()=>calls),[{name:'get_past_contest_events',args:{p_search:'',p_limit:25,p_offset:0}}],'Initial read is bounded metadata with one lookahead row');
    eq(await page.evaluate(()=>photoCalls.length),0,'Opening the archive does not download course images');
    eq(await list().locator('img').count(),0,'List does not eagerly render or fetch image previews');
    ok(await page.locator('[data-past-event-more]').isVisible(),'Next page available');
    await page.locator('[data-past-event-more]').click();await waitRows(48);await settle();
    eq(await page.evaluate(()=>calls.at(-1).args.p_offset),24,'Next page starts after displayed rows, including previous lookahead exactly once');
    await page.locator('[data-past-event-more]').click();await waitRows(50);await settle();
    eq(await page.evaluate(()=>calls.at(-1).args.p_offset),48,'Final page has stable offset');
    eq(await page.locator('[data-past-event-more]').isVisible(),false,'More disappears at the end');
    const ids=await buttons().evaluateAll(elements=>elements.map(element=>element.dataset.viewPastCourse));
    eq(new Set(ids).size,ids.length,'Pagination does not duplicate archive entries');
    eq(await page.evaluate(()=>photoCalls.length),0,'Pagination still requests no images');

    await page.evaluate(()=>start(50));
    await page.evaluate(()=>{failRead={message:'Connection interrupted while loading more'};});
    await page.locator('[data-past-event-more]').click();
    await page.locator('[data-past-event-retry]').waitFor({state:'visible'});await settle();
    await waitRows(24);
    eq(await page.evaluate(()=>calls.at(-1).args.p_offset),24,'Failed additional page retains its requested offset');
    await page.locator('[data-past-event-retry]').click();await waitRows(48);await settle();
    eq(await page.evaluate(()=>calls.at(-1).args.p_offset),24,'Retry does not skip the failed page');

    await search('Loganland');await waitRows(1);
    ok((await list().textContent()).includes('Loganland Finals'),'Search finds title');
    eq(await page.evaluate(()=>calls.at(-1).args),{p_search:'Loganland',p_limit:25,p_offset:0},'Search resets pagination');
    await search('Brisbane');await waitRows(1);
    await search('no matches anywhere');
    ok(/no|found|match/i.test(await status().textContent()),'Empty search gives explanatory feedback');
    eq(await buttons().count(),0,'Empty search has no phantom course button');

    await page.evaluate(()=>start(0));
    ok(/no|finished|past/i.test(await status().textContent()),'Empty archive explains how finished contests appear');
    eq(await buttons().count(),0);
    await page.evaluate(()=>start(3));
    ok(/no.*(layout|photo)|not.*(saved|available)/i.test(await list().textContent()),'Missing layout is clearly labelled');

    await page.evaluate(()=>{failRead={code:'network',message:'Connection interrupted. Please try again.'};});
    await page.locator('[data-past-event-refresh]').click();
    await page.locator('[data-past-event-retry]').waitFor({state:'visible'});await settle();
    ok(/connection|try again|load/i.test(await status().textContent()),'Failed read has recoverable feedback');
    await page.locator('[data-past-event-retry]').click();await waitRows(3);await settle();
    eq(await page.locator('[data-past-event-retry]').isVisible(),false,'Retry clears the error after successful read');

    await page.evaluate(()=>{holdRead=true;});
    await page.locator('[data-past-event-refresh]').click();
    await page.waitForFunction(()=>waiting.some(item=>item.kind==='read'));
    const pendingCalls=await page.evaluate(()=>calls.length);
    await page.locator('[data-past-event-refresh]').evaluate(button=>{button.click();button.click();});
    eq(await page.evaluate(()=>calls.length),pendingCalls,'Rapid refresh taps cannot duplicate the in-flight request');
    await page.evaluate(()=>{holdRead=false;release('read');});await settle();

    await page.evaluate(()=>{holdPhoto=true;});
    const originalButton=await page.locator('[data-view-past-course="event-0"]').innerHTML();
    await page.locator('[data-view-past-course="event-0"]').click();
    await page.waitForFunction(()=>waiting.some(item=>item.kind==='photo'));
    await page.locator('[data-view-past-course="event-0"]').evaluate(button=>{button.click();button.click();});
    eq(await page.evaluate(()=>photoCalls.length),1,'Repeated layout taps request one image');
    await page.evaluate(()=>{holdPhoto=false;release('photo');});
    await page.locator('#event-course-backdrop').waitFor();
    ok(await page.locator('#event-course-backdrop img').isVisible(),'Clicked course opens in the existing image viewer');
    eq(await page.locator('#event-course-backdrop [data-event-course-photo-input]').count(),0,'Past layout viewer cannot replace the retained course');
    eq(await page.locator('#event-course-backdrop input[type="file"]').count(),0);
    await page.locator('[data-close-event-course]').first().click();
    eq(await page.locator('#event-course-backdrop').count(),0,'Layout viewer closes');
    eq(await page.evaluate(()=>document.activeElement?.dataset.viewPastCourse),'event-0','Closing returns keyboard focus to the opened layout');
    eq(await page.locator('[data-view-past-course="event-0"]').innerHTML(),originalButton,'Loading preserves the layout button icon and alignment');

    await page.evaluate(()=>{failPhoto=new Error('Layout connection failed');});
    await page.locator('[data-view-past-course="event-0"]').click();await settle();
    await page.waitForFunction(()=>notifications.some(item=>item.message.includes('Layout connection failed')));
    ok(await page.locator('[data-view-past-course="event-0"]').isEnabled(),'Image failure leaves the open button retryable');
    await page.locator('[data-view-past-course="event-0"]').click();
    await page.locator('#event-course-backdrop').waitFor();
    await page.locator('#event-course-backdrop img').evaluate(image=>{image.src='data:image/png;base64,bm90YW5pbWFnZQ==';});
    await page.locator('.event-course-image-error').waitFor({state:'visible'});
    eq(await page.locator('#event-course-backdrop img').isVisible(),false,'A corrupt image has an explanatory error instead of a broken preview');
    await page.keyboard.press('Escape');
    eq(await page.locator('#event-course-backdrop').count(),0,'Escape closes course viewer');

    await page.evaluate(()=>{rows[0].course_photo_available=false;});
    await page.locator('[data-view-past-course="event-0"]').click();
    await page.waitForFunction(()=>notifications.some(item=>/no course photo/i.test(item.message)));
    eq(await page.locator('#event-course-backdrop').count(),0,'A missing image after the list loaded gives feedback without opening an empty modal');
    ok(await page.locator('[data-view-past-course="event-0"]').isEnabled(),'Missing layout leaves the action recoverable');

    // Private archive data from a slow request must never render on a new page/account.
    for(const transition of ['navigation','account']) {
      await page.evaluate(()=>start(3));await page.evaluate(()=>{holdRead=true;});
      await page.locator('[data-past-event-refresh]').click();await page.waitForFunction(()=>waiting.some(item=>item.kind==='read'));
      await page.evaluate(transition=>{if(transition==='navigation')state.view='session';else state.user={id:'coach-b'};document.querySelector('#view').textContent='New screen';holdRead=false;release('read');},transition);
      await page.waitForTimeout(25);
      eq(await page.locator('#view').textContent(),'New screen',transition+': late archive response cannot replace the next screen');
      await page.evaluate(()=>start(3));await page.evaluate(()=>{holdPhoto=true;});
      await page.locator('[data-view-past-course="event-0"]').click();await page.waitForFunction(()=>waiting.some(item=>item.kind==='photo'));
      await page.evaluate(transition=>{if(transition==='navigation')state.view='session';else state.user={id:'coach-b'};document.querySelector('#view').textContent='New screen';holdPhoto=false;release('photo');},transition);
      await page.waitForTimeout(25);
      eq(await page.locator('#event-course-backdrop').count(),0,transition+': late image cannot reopen a private layout');
    }

    await page.evaluate(()=>start(3));await page.evaluate(()=>{holdPhoto=true;});
    await page.locator('[data-view-past-course="event-0"]').click();await page.waitForFunction(()=>waiting.some(item=>item.kind==='photo'));
    await page.evaluate(async()=>{state.view='session';document.querySelector('#view').textContent='Session';state.view='pastEvents';await renderPastEvents();holdPhoto=false;release('photo');});
    await page.waitForTimeout(25);
    eq(await page.locator('#event-course-backdrop').count(),0,'Navigating away and back cannot reopen an old layout over a fresh archive');
    await waitRows(3);

    await page.evaluate(()=>{holdPhoto=true;});
    await page.locator('[data-view-past-course="event-0"]').click();await page.waitForFunction(()=>waiting.some(item=>item.kind==='photo'));
    await search('Loganland');await waitRows(1);
    await page.evaluate(()=>{holdPhoto=false;release('photo');});await page.waitForTimeout(25);
    eq(await page.locator('#event-course-backdrop').count(),0,'An old layout cannot interrupt a new search after its opening button was replaced');
    ok((await list().textContent()).includes('Loganland Finals'),'New search results are retained after the old image resolves');

    for(const role of ['athlete','parent']) {
      await page.evaluate(role=>start(3,role),role);
      eq(await page.evaluate(()=>calls.length),0,role+': archive guard performs no request');
      eq(await page.locator('#past-events-page').count(),0,role+': coach archive is not rendered');
    }
    await page.evaluate(()=>start(3,'admin'));await waitRows(3);
    eq(await page.evaluate(()=>calls.length),1,'Admins retain existing coach-role access');
    await page.evaluate(async()=>{state.view='coachTools';await renderCoachTools();});
    ok(await page.locator('button[data-view="pastEvents"]').isVisible(),'Coach Tools contains Past Events');
    await page.locator('button[data-view="pastEvents"]').click();await waitRows(3);
    ok(await page.locator('#past-events-page').isVisible(),'Coach Tools action opens the archive');

    await page.evaluate(()=>{rows[0].title='<img src=x onerror="window.injected=true">';rows[0].details='<script>window.injected=true</script>';});
    await page.locator('[data-past-event-refresh]').click();await waitRows(3);await settle();
    eq(await list().locator('img,script').count(),0,'Event names and details are escaped');
    eq(await page.evaluate(()=>Boolean(window.injected)),false);
    await page.evaluate(()=>start(3));
    const screenshotDir=process.env.JKCREW_SCREENSHOT_DIR||'/tmp/jkcrew-past-events';fs.mkdirSync(screenshotDir,{recursive:true});
    for(const width of [320,390,1024]) {
      await page.setViewportSize({width,height:844});
      const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,heights:[...document.querySelectorAll('#past-events-page button')].filter(button=>button.getClientRects().length).map(button=>button.getBoundingClientRect().height)}));
      eq(layout.overflow,false,width+': archive has no horizontal overflow');
      ok(layout.heights.every(height=>height>=43.5),width+': visible controls have 44px touch targets');
      await page.screenshot({path:path.join(screenshotDir,'archive-'+width+'.png'),fullPage:true});
      await page.locator('[data-view-past-course="event-0"]').click();await page.locator('#event-course-backdrop').waitFor();
      ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),width+': layout viewer fits viewport');
      await page.screenshot({path:path.join(screenshotDir,'layout-'+width+'.png'),fullPage:true});
      await page.locator('[data-close-event-course]').first().click();
    }
    eq(errors,[],'No browser exceptions');
    console.log('PASS: '+checks+' Past Events browser checks: bounded metadata, pagination, search, lazy layout loading, retries, duplicate taps, role/stale guards, escaping and mobile/desktop layouts. Screenshots: '+screenshotDir);
  } finally {await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
