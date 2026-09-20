// Exercise the actual invitation/discovery code without any account or server writes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.JKCREW_PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..'),app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const begin=app.indexOf('const seenLiveRunInvites ='),end=app.indexOf('window.addEventListener("beforeunload"',begin);
assert(begin>=0&&end>begin,'Actual discovery block found');const discovery=app.slice(begin,end);
assert(discovery.includes('function liveRunIncomingCall('),'Actual incoming-call predicate found');
const fixture=String.raw`
const state={user:{id:'coach'},profile:{role:'coach'},view:'command'};
let liveRun=null,liveRunDiscoveryBusy=false,liveRunDiscoveryTimer=null;
window.rows=[];window.queries=[];window.joins=[];window.notices=[];window.sounds=[];window.failReads=false;window.holdRead=false;window.releaseRead=null;
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const isCoachRole=role=>['coach','admin'].includes(role),riderFeaturesDisabled=()=>false,riderFeatureAccessUnknown=()=>false;
const notify=message=>notices.push(message),playNotificationSound=kind=>sounds.push(kind),messageFrom=e=>e.message||String(e);
const setButtonBusy=(button,label)=>{const previous=button.textContent;button.disabled=true;button.textContent=label;return()=>{button.disabled=false;button.textContent=previous;};};
async function joinLiveRun(id,accept){joins.push({id,accept});}
async function liveRunCallRequest(action,{session}){if(action==='decline'){rows=rows.map(row=>row.id===session.id?{...row,call_status:'declined',status:'ended',invitation_status:'declined'}:row);}return {session};}
const liveRunRequest=liveRunCallRequest;
const clone=value=>JSON.parse(JSON.stringify(value));
const future=ms=>new Date(Date.now()+ms).toISOString();
const waiting=(changes={})=>({id:'waiting',title:'Shared finals',athlete_id:'rider',coach_id:'coach',created_by:'rider',athlete_name:'Rider One',coach_name:'Coach JK',caller_name:'Rider One',status:'active',call_status:'ringing',invitation_status:'pending',ring_expires_at:future(60000),expires_at:future(86400000),updated_at:new Date().toISOString(),...changes});
const client={from(table){const ops=[];let fields='*',single=false;const builder={
 select(value){fields=value;ops.push(['select',value]);return builder;},
 eq(key,value){ops.push(['eq',key,value]);return builder;},neq(key,value){ops.push(['neq',key,value]);return builder;},
 gt(key,value){ops.push(['gt',key,value]);return builder;},in(key,value){ops.push(['in',key,value]);return builder;},
 order(key,value){ops.push(['order',key,value]);return builder;},limit(value){ops.push(['limit',value]);return builder;},
 single(){single=true;return execute();},then(resolve,reject){return execute().then(resolve,reject);}
 };async function execute(){queries.push({table,ops:clone(ops),single});let data=clone(rows);const failed=failReads;
 for(const [op,key,value]of ops){
  if(op==='eq')data=data.filter(row=>row[key]===value);if(op==='neq')data=data.filter(row=>row[key]!==value);
  if(op==='gt')data=data.filter(row=>Number.isFinite(Date.parse(row[key]))&&Date.parse(row[key])>Date.parse(value));
  if(op==='in')data=data.filter(row=>value.includes(row[key]));
  if(op==='order')data.sort((a,b)=>(String(a[key]).localeCompare(String(b[key])))*(value?.ascending===false?-1:1));
  if(op==='limit')data=data.slice(0,key);
 }
 if(fields!=='*')data=data.map(row=>Object.fromEntries(fields.split(',').map(key=>[key,row[key]])));
 if(holdRead){holdRead=false;await new Promise(resolve=>releaseRead=resolve);}
 return failed?{data:null,error:{message:'Offline fixture'}}:{data:single?data[0]||null:data,error:null};
 }return builder;}};
`;
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});let checks=0;
 const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;},ok=(value,message)=>{assert(value,message);checks++;};
 async function fresh(role='coach'){
  const page=await browser.newPage({viewport:{width:1000,height:800}}),errors=[];page.setDefaultTimeout(4000);page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>route.abort());
  await page.setContent('<!doctype html><html><body><main id="view"><p id="page-marker">Dashboard</p></main></body></html>');
  await page.addScriptTag({content:fixture+'\n'+discovery});if(role==='athlete')await page.evaluate(()=>{state.user.id='rider';state.profile.role='athlete';state.view='home';});
  return {page,errors};
 }
 try{
  {
   const {page,errors}=await fresh();
   eq(await page.evaluate(()=>liveRunIncomingCall(waiting())),true,'Rider ringing linked coach is incoming');
   eq(await page.evaluate(()=>liveRunIncomingCall(waiting({created_by:'coach'}),'rider')),true,'Coach ringing rider is incoming');
   const invalid=[{call_status:'idle'},{call_status:'active',invitation_status:'accepted'},{call_status:'cancelled'},{call_status:'declined'},{call_status:'ended'},{call_status:'missed'},{invitation_status:'accepted'},{invitation_status:'declined'},{status:'ended'},{created_by:'coach'},{created_by:'stranger'},{coach_id:'other-coach'},{ring_expires_at:null},{ring_expires_at:'invalid'},{expires_at:null},{expires_at:'invalid'},{ring_expires_at:'2000-01-01T00:00:00Z'},{expires_at:'2000-01-01T00:00:00Z'}];
   for(const change of invalid)eq(await page.evaluate(change=>liveRunIncomingCall(waiting(change)),change),false,'Invalid waiting candidate rejected: '+JSON.stringify(change));
   await page.evaluate(async()=>{rows=[waiting()];await refreshLiveRunInvites();});
   eq(await page.locator('#live-run-invites .run-live-invite').count(),1,'Genuine waiting rider shown');eq(await page.locator('#live-run-invitation').count(),1,'Genuine incoming call popup shown');
   eq(await page.locator('[data-join-live-run="waiting"]').getAttribute('data-accept-live-run'),'true','Coach action accepts waiting request');
   await page.click('[data-join-live-run="waiting"]');eq(await page.evaluate(()=>joins),[{id:'waiting',accept:true}],'Waiting button joins correct rider with acceptance');
   const ops=await page.evaluate(()=>queries[0].ops),limit=ops.findIndex(op=>op[0]==='limit');
   ok(ops.findIndex(op=>op[0]==='eq'&&op[1]==='call_status'&&op[2]==='ringing')<limit&&ops.some(op=>op[0]==='eq'&&op[1]==='call_status'&&op[2]==='ringing'),'Ringing constraint runs before limit');
   ok(ops.some(op=>op[0]==='eq'&&op[1]==='invitation_status'&&op[2]==='pending'),'Pending constraint applied server side');
   ok(ops.some(op=>op[0]==='gt'&&op[1]==='ring_expires_at'),'Ring deadline applied server side');
   eq(errors,[]);await page.close();
  }
  {
   const {page,errors}=await fresh();await page.evaluate(async()=>{rows=Array.from({length:30},(_,i)=>waiting({id:'old-'+i,call_status:'idle',updated_at:future(1000+i)}));rows.push(waiting({id:'real-waiting'}));rows.push(waiting({id:'outgoing',created_by:'coach'}));await refreshLiveRunInvites();});
   eq(await page.locator('[data-join-live-run]').evaluateAll(elements=>elements.map(el=>el.dataset.joinLiveRun)),['real-waiting'],'Old drafts before query limit cannot hide a waiting rider');
   await page.evaluate(async()=>{rows=rows.map(row=>row.id==='real-waiting'?{...row,call_status:'active',invitation_status:'accepted'}:row);await refreshLiveRunInvites();});
   eq(await page.locator('#live-run-invites,#live-run-invitation').count(),0,'Accepted call leaves waiting card and popup immediately');
   await page.evaluate(async()=>{rows=[waiting({id:'cancel-me'})];await refreshLiveRunInvites();rows[0].call_status='cancelled';rows[0].status='ended';await refreshLiveRunInvites();});
   eq(await page.locator('#live-run-invites,#live-run-invitation').count(),0,'Cancelled call removes waiting UI');eq(errors,[]);await page.close();
  }
  {
   const {page,errors}=await fresh();await page.evaluate(async()=>{rows=[waiting({ring_expires_at:future(350)})];await refreshLiveRunInvites();failReads=true;Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});});
   eq(await page.locator('#live-run-invites').count(),1,'Waiting card appears before short deadline');
   await page.waitForFunction(()=>!document.querySelector('#live-run-invites,#live-run-invitation'));
   eq(await page.locator('#live-run-invites,#live-run-invitation').count(),0,'Local timer removes expired card and popup without a successful fetch');eq(errors,[]);await page.close();
  }
  {
   const {page,errors}=await fresh();await page.evaluate(()=>{rows=[waiting()];holdRead=true;void refreshLiveRunInvites();});await page.waitForFunction(()=>!!releaseRead);
   await page.evaluate(()=>{state.user={id:'another-coach'};document.querySelector('#view').innerHTML='<p>Other account</p>';releaseRead();});await page.waitForFunction(()=>!liveRunDiscoveryBusy);
   eq(await page.locator('#live-run-invites,#live-run-invitation').count(),0,'Late old-account response opens neither card nor popup');eq(await page.locator('#view').textContent(),'Other account');eq(errors,[]);await page.close();
  }
  {
   const {page,errors}=await fresh();await page.evaluate(()=>{rows=[waiting()];holdRead=true;void refreshLiveRunInvites();});await page.waitForFunction(()=>!!releaseRead);
   await page.evaluate(()=>{state.view='sessionViewer';const next=document.createElement('main');next.id='view';next.textContent='Session screen';document.querySelector('#view').replaceWith(next);releaseRead();});await page.waitForFunction(()=>!liveRunDiscoveryBusy);
   eq(await page.locator('#live-run-invites').count(),0,'Late prior-view response does not prepend dashboard into new view');eq(await page.locator('#view').textContent(),'Session screen');eq(errors,[]);await page.close();
  }
  {
   const {page,errors}=await fresh();
   for(const change of [{call_status:'idle'},{ring_expires_at:'2000-01-01T00:00:00Z'},{call_status:'cancelled',status:'ended'},{ring_expires_at:'invalid'}]){
    await page.evaluate(async change=>{rows=[waiting(change)];await openLiveRunInvitation('waiting');},change);
    eq(await page.locator('#live-run-invitation,#live-run-invites').count(),0,'Old notification cannot show non-waiting popup: '+JSON.stringify(change));
   }
   eq(await page.evaluate(()=>joins.length),0,'Old notifications never silently join abandoned drafts');
   await page.evaluate(async()=>{rows=[waiting()];await openLiveRunInvitation('waiting');});eq(await page.locator('#live-run-invitation').count(),1,'Current notification still opens waiting invitation');eq(errors,[]);await page.close();
  }
  {
   const {page,errors}=await fresh('athlete');await page.evaluate(async()=>{rows=[waiting({id:'my-draft',created_by:'rider',call_status:'idle',invitation_status:'accepted'})];await refreshLiveRunInvites();});
   eq(await page.locator('[data-join-live-run="my-draft"]').count(),1,'Rider can still resume own legacy draft');eq(await page.locator('#live-run-invitation').count(),0,'Legacy draft does not pretend to be a new call');
   await page.evaluate(async()=>{rows=[waiting({id:'coach-calling',created_by:'coach'})];await refreshLiveRunInvites();});eq(await page.locator('#live-run-invitation').count(),1,'Rider receives genuine coach incoming call');eq(errors,[]);await page.close();
  }
  console.log(JSON.stringify({status:'PASS',checks,coverage:['strict incoming recipient/status/expiry','coach server filtering before limit','local offline deadline removal','accept/cancel updates','late account/view responses','old notification links','rider draft compatibility'],production_requests:0},null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
