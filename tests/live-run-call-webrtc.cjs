// Two independent Chrome processes use native RTCPeerConnection/getUserMedia.
// Only the signalling/ICE-config service is replaced with a localhost fixture.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.JKCREW_PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..');
const states=new Map();
const make=(id,mode='video',status='active')=>{const session={id,athlete_id:'rider',coach_id:'coach',athlete_name:'Test Rider',coach_name:'Test Coach',call_mode:mode,call_status:status};const state={session,signals:[],seq:0,requests:[]};states.set(id,state);return state;};
const fixture=String.raw`
window.current=true;window.streams=[];window.peers=[];window.denyVideo=0;window.holdMedia=false;window.releaseMedia=null;window.iceDelay=0;window.iceNever=false;window.localIceOnly=false;window.peerConfigs=[];
const params=new URLSearchParams(location.search),caseId=params.get('case'),userId=params.get('user');
const nativeMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async constraints=>{if(constraints.video&&denyVideo>0){denyVideo--;throw new DOMException('Denied by local test','NotAllowedError');}const stream=await nativeMedia(constraints);streams.push(stream);if(holdMedia)await new Promise(resolve=>releaseMedia=resolve);return stream;};
const NativePC=RTCPeerConnection;window.RTCPeerConnection=class extends NativePC{constructor(config){super(localIceOnly?{iceServers:[]}:config);peerConfigs.push(config);peers.push(this);}};
const client={rpc:async(name,args)=>{if(name!=='live_run_call_action')throw Error('Unexpected RPC');const response=await fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({caseId,userId,args})});return await response.json();},functions:{invoke:async()=>{if(iceNever)return new Promise(()=>{});if(iceDelay)await new Promise(r=>setTimeout(r,iceDelay));return{data:{iceServers:[]}};}}};
window.start=async()=>{const session=await(await fetch('/state?case='+caseId)).json();window.handle=JKCrewLiveRunCall.mount({client,userId,clientId:userId+'-device',session,isCurrent:()=>current,onSession:()=>{},onEnd:async()=>{const result=await client.rpc('live_run_call_action',{p_action:'end'});handle.update(result.data.session);}});};
document.querySelector('#start').onclick=()=>start();
`;
async function run(){
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/state'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(states.get(url.searchParams.get('case')).session));}
  if(url.pathname==='/rpc'){let text='';for await(const chunk of req)text+=chunk;const {caseId,userId,args}=JSON.parse(text),state=states.get(caseId);state.requests.push({userId,...args});
    if(args.p_action==='signal'&&!state.signals.some(s=>s.id===args.p_message_id))state.signals.push({id:args.p_message_id,seq:++state.seq,userId,kind:args.p_payload.kind,payload:args.p_payload.data});
    if(args.p_action==='end')state.session.call_status='ended';
    res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({data:{session:state.session,signals:args.p_action==='signals'?state.signals.filter(s=>s.userId!==userId&&s.seq>(args.p_after||0)):[]}}));
  }
  const file={'/live-run-call.js':'live-run-call.js','/live-run-call.css':'live-run-call.css','/styles.css':'styles.css'}[url.pathname];
  if(file){res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':'text/css');return res.end(fs.readFileSync(path.join(root,file)));}
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/live-run-call.css"><style>body{min-height:100vh}main{padding:24px}#app{display:block!important}</style></head><body><div id="app" class="rider-shell"><main id="view"><h2>Build together</h2><p>Shared run · saved</p><button id="start">Join local test call</button></main></div><script src="/live-run-call.js"></script><script>${fixture}</script></body></html>`);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const options={executablePath:process.env.JKCREW_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']};
 const browsers=await Promise.all([chromium.launch(options),chromium.launch(options)]);const contexts=await Promise.all(browsers.map(b=>b.newContext({permissions:['camera','microphone'],viewport:{width:390,height:844}})));let checks=0;const pages=[];const errors=[];
 const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};const ok=(a,m)=>{assert(a,m);checks++;};
 const pair=async(id,setupA=null,setupB=null)=>{const pair=await Promise.all(contexts.map(c=>c.newPage()));pages.push(...pair);for(let i=0;i<2;i++){pair[i].on('pageerror',e=>errors.push(e.message));await pair[i].goto(`${origin}/?case=${id}&user=${i?'coach':'rider'}`);if(i?setupB:setupA)await pair[i].evaluate(i?setupB:setupA);}return pair;};
 const connected=p=>p.waitForFunction(()=>handle.inspect().connectionState==='connected',{},{timeout:20000});
 const stopped=p=>p.waitForFunction(()=>handle.inspect().localTracks===0&&handle.inspect().connectionState==='closed');
 try{
  const video=make('video','video','ringing');const [caller,callee]=await pair('video');await caller.locator('#start').click();await caller.waitForFunction(()=>handle.inspect().localTracks===2);eq(await caller.locator('[data-call="end"]').textContent(),'Cancel call');
  video.session.call_status='active';await callee.locator('#start').click();await Promise.all([connected(caller),connected(callee)]);
  for(const p of [caller,callee]){const info=await p.evaluate(()=>handle.inspect());eq(info.localTracks,2);eq(info.remoteTracks,2);ok(await p.locator('[data-remote]').evaluate(video=>video.srcObject.getVideoTracks()[0]?.readyState==='live'));ok(await p.evaluate(()=>peers.every(p=>p instanceof NativePC)),'Connections are native WebRTC');}
  ok(video.signals.some(s=>s.kind==='offer'));ok(video.signals.some(s=>s.kind==='answer'));ok(video.signals.some(s=>s.kind==='ice'));
  await caller.locator('[data-call="mic"]').click();eq(await caller.evaluate(()=>streams.at(-1).getAudioTracks()[0].enabled),false);eq(await caller.locator('[data-call="mic"]').getAttribute('aria-pressed'),'true');await caller.locator('[data-call="mic"]').click();
  await caller.locator('[data-call="camera"]').click();eq(await caller.evaluate(()=>streams.at(-1).getVideoTracks()[0].enabled),false);await caller.locator('[data-call="camera"]').click();eq(await caller.evaluate(()=>streams.at(-1).getVideoTracks()[0].enabled),true);
  await caller.locator('[data-call="size"]').click();eq(await caller.locator('.run-call').evaluate(e=>e.classList.contains('is-minimized')),true);await caller.locator('[data-call="size"]').click();
  const bounds=await caller.locator('.run-call').boundingBox();ok(bounds.x>=0&&bounds.x+bounds.width<=390,'Mobile call stays inside the viewport');
  await caller.screenshot({path:'/tmp/jkcrew-live-run-call-connected-mobile.png'});
  await caller.locator('[data-call="end"]').click();await Promise.all([stopped(caller),stopped(callee)]);for(const p of [caller,callee]){ok(await p.evaluate(()=>streams.flatMap(s=>s.getTracks()).every(t=>t.readyState==='ended')));eq(await p.locator('[data-local]').evaluate(v=>v.srcObject),null);}

  make('denied');const [denied,receiver]=await pair('denied',()=>{denyVideo=1;});await Promise.all([denied.locator('#start').click(),receiver.locator('#start').click()]);await denied.locator('.run-call-error').waitFor({state:'visible'});ok((await denied.locator('.run-call-error').textContent()).includes('permission was denied'));eq(await denied.evaluate(()=>handle.inspect().localTracks),0);await denied.locator('[data-call="retry"]').click();await Promise.all([connected(denied),connected(receiver)]);await denied.waitForFunction(()=>handle.inspect().localTracks===2);eq(await denied.locator('.run-call-error').isVisible(),false);await denied.locator('[data-call="end"]').click();await Promise.all([stopped(denied),stopped(receiver)]);

  make('fallback');const [fallback,other]=await pair('fallback',()=>{denyVideo=1;});await Promise.all([fallback.locator('#start').click(),other.locator('#start').click()]);await fallback.locator('.run-call-error').waitFor({state:'visible'});await fallback.locator('[data-call="audio"]').click();await Promise.all([connected(fallback),connected(other)]);eq(await fallback.evaluate(()=>streams.at(-1).getVideoTracks().length),0);eq(await fallback.evaluate(()=>handle.inspect().localTracks),1);eq(await fallback.locator('[data-call="camera"]').textContent(),'Camera off');await fallback.locator('[data-call="end"]').click();await Promise.all([stopped(fallback),stopped(other)]);

  make('audio','audio');const [audioA,audioB]=await pair('audio');await Promise.all([audioA.locator('#start').click(),audioB.locator('#start').click()]);await Promise.all([connected(audioA),connected(audioB)]);eq(await audioA.evaluate(()=>handle.inspect().localTracks),1);eq(await audioB.evaluate(()=>handle.inspect().remoteTracks),1);await audioA.locator('[data-call="camera"]').click();await audioA.waitForFunction(()=>handle.inspect().localTracks===2);await audioB.waitForFunction(()=>handle.inspect().remoteTracks>=2);await audioA.locator('[data-call="end"]').click();await Promise.all([stopped(audioA),stopped(audioB)]);

  make('late-media');const [late,unused]=await pair('late-media',()=>{holdMedia=true;});await late.locator('#start').click();await late.waitForFunction(()=>!!releaseMedia);await late.evaluate(()=>{handle.destroy();releaseMedia();});await late.waitForFunction(()=>streams.flatMap(s=>s.getTracks()).every(t=>t.readyState==='ended'));eq(await late.locator('.run-call').count(),0,'Late media permission cannot recreate the ended UI');

  make('slow-ice');const [slow,fast]=await pair('slow-ice',()=>{iceDelay=2200;});await Promise.all([slow.locator('#start').click(),fast.locator('#start').click()]);await Promise.all([connected(slow),connected(fast)]);await slow.locator('[data-call="end"]').click();await Promise.all([stopped(slow),stopped(fast)]);
  make('hung-ice');const [hung,healthy]=await pair('hung-ice',()=>{iceNever=true;localIceOnly=true;});
  await Promise.all([hung.locator('#start').click(),healthy.locator('#start').click()]);await Promise.all([connected(hung),connected(healthy)]);
  ok(await hung.evaluate(()=>peerConfigs.some(config=>config.iceServers.some(server=>String(server.urls).startsWith('stun:')))),'A hung ICE-config service falls back after the deadline; native test connections remain localhost-only');
  await hung.locator('[data-call="end"]').click();await Promise.all([stopped(hung),stopped(healthy)]);
  for(const p of pages)await p.evaluate(()=>window.handle?.destroy());eq(errors,[],'No unhandled browser errors');console.log(`PASS: ${checks} actual two-browser WebRTC offer/answer/ICE, media, controls, denial/retry/audio, cleanup and mobile checks.`);
 }finally{await Promise.all(browsers.map(b=>b.close()));await new Promise(r=>server.close(r));}
}
run().catch(error=>{console.error(error.stack);process.exitCode=1;});
