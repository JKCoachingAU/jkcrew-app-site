'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');

// All data and RPCs below are isolated fixtures; this test never contacts Supabase.
const fixture = String.raw`
const copy = value => JSON.parse(JSON.stringify(value));
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
window.riders = [
  {id:uuid(901), display_name:'Byron Stephens', full_name:'Byron Stephens'},
  {id:uuid(902), display_name:'Lara', full_name:'Lara'}
];
window.rows=[]; window.calls=[]; window.notifications=[]; window.releases=[];
window.current=true; window.failRead=null; window.failReview=null;
window.holdRead=false; window.holdReview=false; window.injectUnknown=false;
window.authoritativeDecision=null;
window.fixtureVisibility='visible';
Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>fixtureVisibility});
const nativeSetInterval=window.setInterval.bind(window);
window.setInterval=(callback,delay,...args)=>{
 if(delay===30000)window.queueTick=()=>callback(...args);
 return nativeSetInterval(callback,delay,...args);
};
window.seed = count => {
 rows=Array.from({length:count},(_,i)=>({
  id:uuid(i+1), athlete_id:riders[i%2].id,
  trick_name:i===0?'Opposite 360':i===1?'Barspin over the box':'Extra trick '+(i+1),
  note:i%2?'First one landed today':'Landed over the box jump', venue:'LOGANLAND',
  submitted_at:new Date(Date.UTC(2026,8,20,1,Math.floor(i/2))).toISOString(),
  status:'pending',points:0,reviewed_at:null,reviewer_id:null
 }));
 rows.push({id:uuid(701),athlete_id:uuid(999),trick_name:'PRIVATE OUTSIDER TRICK',note:'PRIVATE OUTSIDER NOTE',venue:'Other park',submitted_at:'2026-09-19T01:00:00Z',status:'pending',points:0});
 rows.push({id:uuid(702),athlete_id:riders[0].id,trick_name:'Already reviewed',note:'',venue:'LOGANLAND',submitted_at:'2026-09-18T01:00:00Z',status:'approved',points:1});
};
window.release = kind => {
 const waiting=releases.filter(x=>!kind||x.kind===kind);
 releases=releases.filter(x=>kind&&x.kind!==kind);
 for(const item of waiting)item.resolve();
};
const client = {
 from(table) {
  const request={kind:'query',table,orders:[]};
  return {
   select(projection,options){request.projection=projection;request.options=copy(options||{});return this;},
   in(column,values){request.in={column,values:copy(values)};return this;},
   eq(column,value){request.eq={column,value};return this;},
   order(column,options){request.orders.push({column,...copy(options||{})});return this;},
   async range(start,end){
    request.range=[start,end];calls.push(copy(request));
    let matching=rows.filter(row=>request.in.values.includes(row[request.in.column])&&row[request.eq.column]===request.eq.value);
    matching.sort((a,b)=>a.submitted_at.localeCompare(b.submitted_at)||a.id.localeCompare(b.id));
    const snapshot={data:copy(matching.slice(start,end+1)),count:matching.length,error:null};
    if(injectUnknown)snapshot.data.unshift(copy(rows.find(row=>row.athlete_id===uuid(999))));
    if(holdRead)await new Promise(resolve=>releases.push({kind:'read',resolve}));
    if(failRead){const error=failRead;failRead=null;return{data:null,count:null,error};}
    return snapshot;
   }
  };
 },
 async rpc(name,args){
  calls.push({kind:'rpc',name,args:copy(args)});
  if(name!=='review_other_thing_landed')throw Error('Unexpected RPC '+name);
  if(holdReview)await new Promise(resolve=>releases.push({kind:'review',resolve}));
  if(failReview){const error=failReview;failReview=null;return{data:null,error};}
  const item=rows.find(row=>row.id===args.p_submission_id);
  if(!item)return{error:{code:'42501',message:'Submission is unavailable'}};
  if(authoritativeDecision){item.status=authoritativeDecision;item.points=authoritativeDecision==='approved'?1:0;authoritativeDecision=null;}
  const already=item.status!=='pending';
  if(!already){item.status=args.p_decision;item.points=args.p_decision==='approved'?1:0;}
  item.reviewed_at='2026-09-20T03:00:00Z';item.reviewer_id=uuid(800);
  return{data:{item:copy(item),already_reviewed:already}};
 }
};
window.start = async (count=65, roster=riders) => {
 window.handle?.destroy(); release(); seed(count); calls=[];notifications=[];
 current=true;failRead=null;failReview=null;holdRead=false;holdReview=false;injectUnknown=false;authoritativeDecision=null;
 handle=JKCrewOtherThingsLanded.mountCoachQueue({element:document.querySelector('#host'),client,roster,isCurrent:()=>current,onChanged:event=>notifications.push(copy(event))});
 await handle.ready;
};
`;

async function run() {
 let checks=0;
 const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
 const ok=(value,message)=>{assert(value,message);checks++;};
 const server=http.createServer((req,res)=>{
  const asset={'/styles.css':'styles.css','/other-things-landed.css':'other-things-landed.css','/other-things-landed.js':'other-things-landed.js'}[req.url];
  if(asset){res.setHeader('Content-Type',asset.endsWith('.css')?'text/css':'application/javascript');return res.end(fs.readFileSync(path.join(root,asset)));}
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/other-things-landed.css"><style>body{margin:0}#app{display:block!important}#view{padding:16px;max-width:950px;margin:auto}.panel{margin:0}</style></head><body><div id="app" class="coach-shell"><main id="view" data-view="coach-command"><div id="host"></div></main></div><script src="/other-things-landed.js"></script><script>${fixture}</script></body></html>`);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({executablePath:process.env.JKCREW_CHROME_PATH||process.env.JKCREW_BROWSER_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const articles=()=>page.locator('[data-other-queue-item]');
 const count=()=>page.locator('[data-other-queue-count]');
 const status=()=>page.locator('[data-other-queue-status]');
 const settle=()=>page.waitForFunction(()=>!document.querySelector('[data-other-queue-refresh]')?.disabled);
 const waitRows=n=>page.waitForFunction(n=>document.querySelectorAll('[data-other-queue-item]').length===n,n);
 try {
  await page.goto(origin);
  await page.evaluate(()=>start());
  eq(await articles().count(),30,'First page shows 30 pending submissions');
  ok(/65/.test(await count().textContent()),'Count includes every pending page');
  eq(await page.getByText('PRIVATE OUTSIDER TRICK').count(),0,'Other coaches’ riders are excluded');
  eq(await page.getByText('Already reviewed',{exact:true}).count(),0,'Only pending submissions appear');
  const firstQuery=await page.evaluate(()=>calls.find(call=>call.kind==='query'));
  eq(firstQuery.table,'other_things_landed');eq(firstQuery.options.count,'exact');
  eq(firstQuery.in.column,'athlete_id');eq(firstQuery.in.values,await page.evaluate(()=>riders.map(rider=>rider.id)));
  eq(firstQuery.eq,{column:'status',value:'pending'});
  eq(firstQuery.orders.map(order=>order.column),['submitted_at','id'],'Ties have stable ordering');
  eq(firstQuery.orders[0].ascending,true);eq(firstQuery.range,[0,29]);
  ok(!firstQuery.projection.includes('*'),'Projection requests named fields only');
  for(const field of ['id','athlete_id','trick_name','note','venue','submitted_at','status'])ok(firstQuery.projection.split(',').map(s=>s.trim()).includes(field),'Projection contains '+field);
  ok((await articles().first().textContent()).includes('Byron Stephens'),'Coach can identify the rider beside each trick');
  await page.locator('[data-other-queue-more]').click();await waitRows(60);await settle();
  eq(await page.evaluate(()=>calls.filter(call=>call.kind==='query').at(-1).range),[0,59]);
  ok(/65/.test(await count().textContent()),'Expanding the page preserves the total count');
  const firstId=await articles().first().getAttribute('data-other-queue-item');
  await articles().first().locator('[data-other-queue-review="approved"]').click();
  await page.waitForFunction(id=>rows.find(row=>row.id===id)?.status==='approved',firstId);
  await page.waitForFunction(()=>document.querySelector('[data-other-queue-count]').textContent.includes('64'));await waitRows(60);await settle();
  eq(await page.locator(`[data-other-queue-item="${firstId}"]`).count(),0,'Reviewed row leaves the pending queue');
  eq(await page.evaluate(()=>calls.filter(call=>call.kind==='query').at(-1).range),[0,59],'Review reloads the top slice instead of advancing an offset');
  ok(await page.locator('[data-other-queue-item="00000000-0000-4000-8000-000000000061"]').count(),'Next waiting row fills the removed position');
  await page.locator('[data-other-queue-more]').click();await waitRows(64);await settle();
  eq(await page.evaluate(()=>calls.filter(call=>call.kind==='query').at(-1).range),[0,89]);
  eq(await page.locator('[data-other-queue-more]').isVisible(),false,'Show more disappears when all pending rows are shown');

  await page.evaluate(()=>start(3));
  await page.evaluate(()=>authoritativeDecision='declined');
  await articles().first().locator('[data-other-queue-review="approved"]').click();await waitRows(2);await settle();
  eq(await page.evaluate(()=>rows[0].points),0,'A concurrent decline never earns a point');
  ok(/declined|already reviewed/i.test(await status().textContent()),'Server decision wins over the clicked action');
  const authoritative=await page.evaluate(()=>notifications.filter(event=>event.kind==='review').at(-1));
  eq(authoritative.status,'declined');eq(authoritative.points,0);

  await page.evaluate(()=>{failReview={message:'Review connection failed',code:'network'};});
  const reviewId=await articles().first().getAttribute('data-other-queue-item');
  await articles().first().locator('[data-other-queue-review="declined"]').click();
  await page.locator('[data-other-queue-retry]').waitFor({state:'visible'});
  eq(await page.evaluate(id=>rows.find(row=>row.id===id).status,reviewId),'pending','Failed reviews remain pending');
  ok(/failed|try again|connection/i.test(await status().textContent()),'Review failures are visible');
  await page.evaluate(()=>handle.refresh({quiet:true}));await settle();
  ok(await page.locator('[data-other-queue-retry]').isVisible(),'A background refresh preserves the failed review retry');
  ok(/connection failed/i.test(await status().textContent()),'Polling preserves the review error until it is resolved');
  await page.locator('[data-other-queue-retry]').click();await waitRows(1);await settle();
  const retries=await page.evaluate(()=>calls.filter(call=>call.kind==='rpc').slice(-2).map(call=>call.args));
  eq(retries[0],retries[1],'Retry repeats the same submission and decision');

  await page.evaluate(()=>{failRead={code:'network',message:'Pending submissions could not load'};});
  await page.locator('[data-other-queue-refresh]').click();await page.locator('[data-other-queue-retry]').waitFor({state:'visible'});
  ok(/could not load|try again|load/i.test(await status().textContent()),'Fetch failure has a readable error');
  ok(!/^0\b/.test((await count().textContent()).trim()),'Fetch failure never invents a zero pending count');
  await page.locator('[data-other-queue-retry]').click();await waitRows(1);await settle();
  await page.evaluate(()=>{failRead={code:'42501',message:'Your access was removed'};});
  await page.locator('[data-other-queue-refresh]').click();await page.locator('[data-other-queue-retry]').waitFor({state:'visible'});await settle();
  eq(await articles().count(),0,'Authorization loss clears old private submissions');

  await page.evaluate(()=>start(2));
  await page.evaluate(()=>{holdRead=true;handle.refresh();});
  await page.waitForFunction(()=>releases.some(item=>item.kind==='read'));
  await articles().first().locator('[data-other-queue-review="approved"]').click();
  await page.waitForFunction(()=>rows[0].status==='approved');
  await page.evaluate(()=>{holdRead=false;release('read');});await waitRows(1);await settle();
  eq(await page.locator('[data-other-queue-item="00000000-0000-4000-8000-000000000001"]').count(),0,'An older read cannot restore a reviewed item');

  await page.evaluate(()=>start(2));
  await page.evaluate(()=>{holdReview=true;notifications=[];});
  await articles().first().locator('[data-other-queue-review="approved"]').click();
  await page.waitForFunction(()=>releases.some(item=>item.kind==='review'));
  await articles().first().locator('[data-other-queue-review="approved"]').evaluate(button=>button.click());
  eq(await page.evaluate(()=>calls.filter(call=>call.kind==='rpc').length),1,'Busy review prevents duplicate requests');
  await page.evaluate(()=>{current=false;handle.destroy();holdReview=false;release('review');});
  await page.waitForTimeout(30);eq(await page.locator('#host').textContent(),'');
  eq(await page.evaluate(()=>notifications.length),0,'Late reviews cannot notify the next account');
  eq(await page.evaluate(()=>calls.filter(call=>call.kind==='query').length),1,'Late reviews do not fetch another account’s queue');

  await page.evaluate(()=>start(2));
  await page.evaluate(()=>{holdRead=true;handle.refresh();});await page.waitForFunction(()=>releases.some(item=>item.kind==='read'));
  await page.evaluate(()=>{current=false;handle.destroy();release('read');});await page.waitForTimeout(30);
  eq(await page.locator('#host').textContent(),'','Destroyed mounts cannot repopulate private results');
  await page.evaluate(()=>start(2,[]));
  eq(await page.evaluate(()=>calls.length),0,'Empty roster performs no unscoped database query');
  eq(await articles().count(),0);
  await page.evaluate(()=>start(2,[...riders,riders[0]]));
  eq(await page.evaluate(()=>calls.find(call=>call.kind==='query').in.values.length),2,'Repeated roster entries are deduplicated');
  await page.evaluate(()=>{injectUnknown=true;return handle.refresh();});
  eq(await page.getByText('PRIVATE OUTSIDER TRICK').count(),0,'An unexpected out-of-roster response cannot render another rider’s trick');
  eq(await page.getByText('PRIVATE OUTSIDER NOTE').count(),0,'Unexpected private notes never render');
  ok(/verified|refresh/i.test(await status().textContent()),'Unscoped responses show a verification error');
  await page.evaluate(()=>{injectUnknown=false;return handle.refresh();});
  await page.evaluate(()=>{rows[0].trick_name='<img src=x onerror="window.injected=true">';rows[0].note='<script>window.injected=true</script>';return handle.refresh();});
  eq(await articles().first().locator('img').count(),0,'Submitted markup remains plain text');
  eq(await page.evaluate(()=>!!window.injected),false);

  for(const event of ['focus','online']){
   const before=await page.evaluate(()=>calls.filter(call=>call.kind==='query').length);
   await page.evaluate(event=>window.dispatchEvent(new Event(event)),event);
   await page.waitForFunction(before=>calls.filter(call=>call.kind==='query').length>before,before);await settle();
   eq(await page.evaluate(()=>calls.filter(call=>call.kind==='query').length),before+1,`${event} refreshes pending submissions`);
  }
  const beforeHidden=await page.evaluate(()=>calls.filter(call=>call.kind==='query').length);
  await page.evaluate(()=>{fixtureVisibility='hidden';document.dispatchEvent(new Event('visibilitychange'));queueTick();});
  eq(await page.evaluate(()=>calls.filter(call=>call.kind==='query').length),beforeHidden,'A hidden tab does not poll');
  await page.evaluate(()=>{fixtureVisibility='visible';document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForFunction(before=>calls.filter(call=>call.kind==='query').length>before,beforeHidden);await settle();
  eq(await page.evaluate(()=>calls.filter(call=>call.kind==='query').length),beforeHidden+1,'Returning to the visible tab refreshes pending submissions');
  await page.evaluate(()=>queueTick());await settle();
  eq(await page.evaluate(()=>calls.filter(call=>call.kind==='query').length),beforeHidden+2,'Visible background polling refreshes the queue');

  await page.evaluate(()=>start(3));
  const screenshotDir=process.env.JKCREW_SCREENSHOT_DIR||'/tmp/jkcrew-other-landed-coach-queue';fs.mkdirSync(screenshotDir,{recursive:true});
  for(const theme of ['dark','light'])for(const width of [320,390,1024]){
   await page.setViewportSize({width,height:844});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
   const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,buttons:[...document.querySelectorAll('#host button')].filter(button=>button.getClientRects().length).map(button=>button.getBoundingClientRect().height)}));
   eq(layout.overflow,false,`${theme} ${width}: no horizontal overflow`);ok(layout.buttons.every(height=>height>=43.5),`${theme} ${width}: 44px touch targets`);
   await page.screenshot({path:path.join(screenshotDir,`${theme}-${width}.png`),fullPage:true});
  }
  eq(errors,[],'No browser errors');
  console.log(`PASS: ${checks} coach queue checks for exact counts, pagination, review/retry, authoritative status, stale/privacy guards and responsive layout. Screenshots: ${screenshotDir}`);
 } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
}
run().catch(error=>{console.error(error.stack);process.exitCode=1;});
