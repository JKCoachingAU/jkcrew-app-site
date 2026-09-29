// Deterministic client transport checks. No network or production accounts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../live-run-call.js'), 'utf8');
let checks = 0;
const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
const ok = (value, label) => { assert(value, label); checks++; };
async function fixture({legacy = false, denied = false, realtime = false} = {}) {
  let now = 100000, nextTimer = 0, getMediaCalls = 0, removed = 0;
  const timers = new Map(), listeners = new Map(), nodes = new Map(), requests = [], tracks = [];
  const session = {id:'test-call', athlete_id:'rider', coach_id:'coach', call_status:'ringing', call_mode:'audio'};
  const node = () => ({classList:{toggle(){},add(){},remove(){}},setAttribute(){},querySelectorAll(){return [];},querySelector(selector){if(!nodes.has(selector)) nodes.set(selector,node());return nodes.get(selector);},play:async()=>{},remove(){},hidden:false});
  const document = {createElement:node,body:{append(){},classList:{add(){},remove(){}}},querySelector:()=>null,addEventListener:(k,fn)=>listeners.set(k,fn),removeEventListener:(k)=>listeners.delete(k)};
  const timeout = (fn,ms=0) => { const id=++nextTimer; timers.set(id,{fn,at:now+ms}); return id; };
  let subscription, subscribed;
  const client = {rpc:async(name,args)=>{
    requests.push(args);
    if(denied) return {error:{code:'42501',message:'This call is not available to you'}};
    if(legacy&&args.p_action==='status')return {error:{message:'Unknown call action'}};
    assert.notEqual(args.p_action,'get','Never request the full draft while ringing');
    return {data:{session:{...session},signals:[]}};
  }};
  if(realtime)client.channel=()=>({on:(event,filter,fn)=>{subscription={event,filter,fn};return {subscribe:fn=>{subscribed=fn;fn('SUBSCRIBED');return {unsubscribe(){removed++;}};}};}});
  const window = {addEventListener:(k,fn)=>listeners.set(k,fn),removeEventListener:k=>listeners.delete(k),matchMedia:()=>({matches:true})};
  const context = vm.createContext({window,document,TextEncoder,console,Date:class extends Date{static now(){return now;}},navigator:{onLine:true,mediaDevices:{getUserMedia:async()=>{getMediaCalls++; const t={kind:'audio',enabled:true,readyState:'live',stop(){this.readyState='ended';}};tracks.push(t);return {getTracks:()=>[t],getAudioTracks:()=>[t],getVideoTracks:()=>[]};}}},setTimeout:timeout,clearTimeout:id=>timers.delete(id),setInterval:(fn,ms)=>{const id=timeout(fn,ms);timers.get(id).interval=ms;return id;},clearInterval:id=>timers.delete(id)});
  vm.runInContext(source,context);
  const handle = window.JKCrewLiveRunCall.mount({client,userId:'rider',clientId:'test-device',session});
  const flush = async()=>{for(let i=0;i<10;i++)await new Promise(resolve=>setImmediate(resolve));};
  const advance = async(ms)=>{const end=now+ms;for(;;){const pending=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!pending)break;const[id,t]=pending;now=t.at;if(t.interval)t.at+=t.interval;else timers.delete(id);t.fn();await flush();}now=end;await flush();};
  await flush();
  return {handle,session,requests,listeners,tracks,advance,flush,getMediaCalls:()=>getMediaCalls,removed:()=>removed,subscription:()=>subscription,subscribed:()=>subscribed};
}
(async()=>{
  const f=await fixture();await f.advance(30000);
  eq(f.requests.filter(r=>r.p_action==='status').length,11,'30 seconds uses 11 compact status reads, not 46 full images');
  ok(f.requests.length<=13,'Heartbeat plus status traffic stays bounded');
  eq(f.requests.filter(r=>r.p_action==='get').length,0);
  const before=f.requests.length;f.listeners.get('pagehide')();await f.advance(30000);eq(f.requests.length,before,'BFCache pagehide suspends network polling');
  ok(f.tracks.every(t=>t.readyState==='ended'),'BFCache releases media');
  f.listeners.get('pageshow')();await f.advance(3000);ok(f.requests.length>before,'Restoring page resumes status');
  f.handle.destroy();const count=f.requests.length;await f.advance(30000);eq(f.requests.length,count,'Destroy stops timers');
  const legacy=await fixture({legacy:true});await legacy.advance(9000);
  eq(legacy.requests.filter(r=>r.p_action==='status').length,1,'Old backend capability probe happens only once');
  ok(legacy.requests.filter(r=>r.p_action==='heartbeat').length>=3,'Legacy fallback reads only heartbeat metadata');legacy.handle.destroy();
  const forbidden=await fixture({denied:true});await forbidden.advance(30000);eq(forbidden.requests.length,1,'Access denial stops retrying');eq(forbidden.handle.inspect().ended,true);forbidden.handle.destroy();
  const rt=await fixture({realtime:true});await rt.advance(100);const base=rt.requests.length;
  eq(rt.subscription().filter.filter,'recipient_id=eq.rider','Subscribe only to authenticated recipient signalling');
  rt.subscription().fn({new:{session_id:'someone-else'}});await rt.advance(100);eq(rt.requests.length,base,'Other session cannot wake call transport');
  rt.subscription().fn({new:{session_id:'test-call'}});await rt.advance(100);ok(rt.requests.length>base,'Peer signalling wakes bounded metadata fetch');
  rt.handle.destroy();eq(rt.removed(),1,'Destroy removes realtime subscription');
  console.log(`PASS: ${checks} call metadata, fallback, polling, lifecycle and recipient realtime checks.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
