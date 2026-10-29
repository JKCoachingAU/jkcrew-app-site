// Optional, owner-only WHOOP integration. No provider secret or OAuth token is
// returned to the browser. GET callback uses one-use state; POST verifies Auth.
const APP_URL = 'https://jkcoachingau.github.io/jkcrew-app-site/';
const APP_ORIGIN = 'https://jkcoachingau.github.io';
const AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
const API_URL = 'https://api.prod.whoop.com/developer/v2';
const SCOPES = 'offline read:sleep read:recovery read:cycles';
const utf8 = new TextEncoder();
type Json = Record<string, any>;
class HealthError extends Error {
  status: number;
  constructor(message: string, status = 503) { super(message); this.status = status; }
}
const env = (key: string) => Deno.env.get(key) || '';
const jsonHeaders = () => ({'Content-Type':'application/json','Cache-Control':'no-store',
  'Access-Control-Allow-Origin':APP_ORIGIN,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin','Referrer-Policy':'no-referrer'});
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers:jsonHeaders()});
const disconnectState = {connection:'disconnected', summary:null, synced_at:null, retry_after:null, syncing:false, sync_due:false};
const envelope = (data: Json, ready: boolean, message?: string) => ({provider:'whoop',availability:ready?'ready':'not_configured',...data,...(message?{message}:{})});
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
async function encryptionKey() {
  try {
    const raw = unb64(env('WHOOP_TOKEN_ENCRYPTION_KEY'));
    if(raw.length !== 32) return null;
    return await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
  } catch { return null; }
}
async function seal(tokens: Json, actor: string, key: CryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:utf8.encode(`jkcrew:whoop:${actor}`)},key,utf8.encode(JSON.stringify(tokens)));
  return `v1.${b64(iv)}.${b64(new Uint8Array(encrypted))}`;
}
async function unseal(value: string, actor: string, key: CryptoKey) {
  const [version,iv,body] = value.split('.');
  if(version !== 'v1' || !iv || !body) throw new HealthError('Reconnect WHOOP to continue.');
  const decrypted = await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv),additionalData:utf8.encode(`jkcrew:whoop:${actor}`)},key,unb64(body));
  return JSON.parse(new TextDecoder().decode(decrypted));
}
async function hashState(state: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',utf8.encode(state))), b=>b.toString(16).padStart(2,'0')).join('');
}
// The abort covers the body stream too; neither malicious huge responses nor a
// slow provider can leave a lease/HTTP request running indefinitely.
async function requestJson(url: string, options: RequestInit = {}, timeout = 10000): Promise<{status:number,data:Json}> {
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(),timeout);
  try {
    const response = await fetch(url,{...options,signal:controller.signal,redirect:'error'});
    if(response.status === 204) return {status:204,data:{}};
    if(Number(response.headers.get('content-length')||0)>262144) throw new Error('Response too large');
    const reader = response.body?.getReader(); let text='', bytes=0; const decoder = new TextDecoder();
    if(reader) {
      while(true) {
        const part = await reader.read(); if(part.done) break;
        bytes += part.value.byteLength;
        if(bytes>262144) { await reader.cancel(); throw new Error('Response too large'); }
        text += decoder.decode(part.value,{stream:true});
      }
      text += decoder.decode();
    }
    let data: Json = {};
    try { data = text ? JSON.parse(text) : {}; } catch { if(response.ok) throw new Error('Invalid response'); }
    return {status:response.status,data};
  } finally { clearTimeout(timer); }
}
async function backend(action: string, actor: string|null, data: Json = {}) {
  const result = await requestJson(`${env('SUPABASE_URL')}/rest/v1/rpc/jkcrew_health_whoop_backend`,{
    method:'POST', headers:{apikey:env('SUPABASE_SERVICE_ROLE_KEY'),Authorization:`Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`,'Content-Type':'application/json'},
    body:JSON.stringify({p_action:action,p_actor:actor,p_data:data})
  },8000);
  if(result.status<200 || result.status>=300) throw new HealthError('Health connection is temporarily unavailable. Please try again.');
  return result.data;
}
async function authenticatedRider(request: Request) {
  const token = request.headers.get('authorization') || '';
  if(!/^Bearer \S+$/.test(token)) throw new HealthError('Sign in to view your health summary.',401);
  const user = await requestJson(`${env('SUPABASE_URL')}/auth/v1/user`,{headers:{apikey:env('SUPABASE_ANON_KEY'),Authorization:token}},8000);
  if(user.status !== 200 || !/^[0-9a-f-]{36}$/i.test(user.data.id||'') || user.data.is_anonymous) throw new HealthError('Sign in again to view your health summary.',401);
  // Current database role, never editable user_metadata or a role sent by caller.
  const profile = await requestJson(`${env('SUPABASE_URL')}/rest/v1/profiles?id=eq.${user.data.id}&select=id,role`,{
    headers:{apikey:env('SUPABASE_SERVICE_ROLE_KEY'),Authorization:`Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`}
  },8000);
  if(profile.status !== 200) throw new HealthError('Health connection is temporarily unavailable. Please try again.');
  if(!Array.isArray(profile.data) || profile.data.length!==1 || profile.data[0].role !== 'athlete') throw new HealthError('Health connections are private to rider accounts.',403);
  return user.data.id as string;
}
function tokenPayload(data: Json) {
  if(typeof data.access_token!=='string' || typeof data.refresh_token!=='string' || !data.access_token || !data.refresh_token ||
    data.access_token.length>4096 || data.refresh_token.length>4096 || !Number.isFinite(data.expires_in) || data.expires_in<=0 || data.expires_in>2592000) {
    throw new HealthError('WHOOP did not complete the connection. Please reconnect.');
  }
  // Require the requested grant. Never silently return empty metrics due to a
  // partial OAuth grant; preserve zero values separately from absent values.
  if(typeof data.scope==='string' && SCOPES.split(' ').some(scope=>!data.scope.split(/\s+/).includes(scope))) throw new HealthError('Please allow the requested WHOOP summary permissions.');
  return {access_token:data.access_token,refresh_token:data.refresh_token};
}
async function exchange(params: Record<string,string>) {
  return requestJson(TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({...params,client_id:env('WHOOP_CLIENT_ID'),client_secret:env('WHOOP_CLIENT_SECRET')}).toString()});
}
const finite = (value: unknown, max: number) => typeof value==='number' && Number.isFinite(value) && value>=0 && value<=max ? value : null;
const iso = (value: unknown) => typeof value==='string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
function newest(records: Json[], key: string) {
  return [...records].sort((a,b)=>(Date.parse(b[key])||0)-(Date.parse(a[key])||0))[0] || null;
}
function makeSummary(sleeps: Json[], recoveries: Json[], cycles: Json[], now: string) {
  const sleep = newest(sleeps.filter(s=>s.nap===false),'start');
  // The recovery collection is already sorted by related sleep. Do not skip a
  // newest unscored record to present an older score as the current recovery.
  const recovery = recoveries[0] || null;
  const cycle = newest(cycles,'start');
  const stages = sleep?.score_state==='SCORED' ? sleep.score?.stage_summary : null;
  const durations = stages ? ['total_light_sleep_time_milli','total_slow_wave_sleep_time_milli','total_rem_sleep_time_milli'].map(k=>finite(stages[k],172800000)) : [];
  const sleepMinutes = durations.length===3 && durations.every(v=>v!==null) ? Math.round(durations.reduce<number>((a,b)=>a+(b??0),0)/60000) : null;
  const r = recovery?.score_state==='SCORED' ? recovery.score : null;
  // WHOOP reports energy expended over a physiological cycle, which need not
  // match a calendar day. Convert its reported kJ to Calories (kcal).
  const kilojoules = cycle?.score_state==='SCORED' ? finite(cycle.score?.kilojoule,Number.MAX_SAFE_INTEGER) : null;
  const calories = kilojoules!==null ? Math.round(kilojoules/4.184) : null;
  const score = finite(r?.recovery_score,100);
  const recoverySleep = sleeps.find(s=>s.id===recovery?.sleep_id);
  const times = {
    sleep: sleepMinutes!==null ? iso(sleep?.end) : null,
    recovery: score!==null ? (iso(recoverySleep?.end)||iso(recovery?.created_at)) : null,
    // A recalculation today must not relabel an older completed cycle as today.
    calories: calories!==null ? (iso(cycle?.end)||iso(cycle?.start)) : null
  };
  return {source:'WHOOP',synced_at:now,observed_at:Object.values(times).filter(Boolean).sort().at(-1)||null,
    metric_observed_at:times,sleep_minutes:sleepMinutes,recovery_percent:score,calories_kcal:calories};
}
async function providerData(path: string, token: string) {
  const result = await requestJson(`${API_URL}/${path}`,{headers:{Authorization:`Bearer ${token}`}});
  if(result.status===401) throw new HealthError('Reconnect WHOOP to continue.',401);
  if(result.status!==200 || !Array.isArray(result.data.records)) throw new HealthError('WHOOP could not refresh your summary. Please try again shortly.');
  return result.data.records;
}
async function sync(actor: string, key: CryptoKey) {
  const claim = await backend('claim_sync',actor);
  if(!claim.claimed) return envelope(claim.status,true);
  const lease = {generation:claim.generation,lease_id:claim.lease_id};
  let rotating = false;
  try {
    let tokens;
    try { tokens=await unseal(claim.token_cipher,actor,key); }
    catch { throw new HealthError('Reconnect WHOOP to continue.',401); }
    if(!iso(claim.token_expires_at) || Date.parse(claim.token_expires_at)<=Date.now()+60000) {
      rotating=true;
      const refreshed=await exchange({grant_type:'refresh_token',refresh_token:tokens.refresh_token,scope:'offline'});
      if(refreshed.status!==200) {
        if(refreshed.status===400 || refreshed.status===401) throw new HealthError('Reconnect WHOOP to continue.',401);
        throw new HealthError('WHOOP could not refresh your connection. Please reconnect.',401);
      }
      tokens=tokenPayload(refreshed.data);
      const saved=await backend('save_tokens',actor,{...lease,token_cipher:await seal(tokens,actor,key),token_expires_at:new Date(Date.now()+refreshed.data.expires_in*1000).toISOString()});
      if(!saved.saved) throw new HealthError('The health connection changed. Please refresh the page.');
      rotating=false;
    }
    const start=new Date(Date.now()-7*86400000).toISOString();
    const query=`limit=25&start=${encodeURIComponent(start)}`;
    const [sleeps,recoveries,cycles]=await Promise.all([
      providerData(`activity/sleep?${query}`,tokens.access_token),providerData(`recovery?${query}`,tokens.access_token),providerData(`cycle?${query}`,tokens.access_token)
    ]);
    const summary=makeSummary(sleeps,recoveries,cycles,new Date().toISOString());
    const saved=await backend('save_summary',actor,{...lease,summary});
    if(!saved.saved) throw new HealthError('The health connection changed. Please refresh the page.');
    return envelope(saved.status,true);
  } catch(error) {
    // A timed-out rotation may have invalidated the old token. Do not blindly
    // replay a rotating refresh token; ask for consent again instead.
    const reconnect = rotating || (error instanceof HealthError && error.status===401);
    const result=await backend(reconnect?'reconnect':'sync_failed',actor,lease);
    return envelope(result.status || await backend('status',actor),true,reconnect?'Reconnect WHOOP to continue.':'WHOOP could not refresh your summary. Your last summary is still available.');
  }
}
const randomSecret = () => Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
const callbackRedirect = (ticket: string|null) => new Response(null,{status:303,headers:{Location:ticket?`${APP_URL}?health=complete#whoop_complete=${ticket}`:`${APP_URL}?health=error`,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
async function callback(request: Request, key: CryptoKey|null, ready: boolean) {
  const query = new URL(request.url).searchParams;
  const state=query.get('state')||'', code=query.get('code')||'';
  if(!ready || !key || !/^[a-f0-9]{64}$/.test(state)) return callbackRedirect(null);
  let claim: Json|null=null;
  try {
    claim=await backend('consume_state',null,{state_hash:await hashState(state)});
    if(!claim || query.has('error') || !code || code.length>4096) {
      if(claim) await backend('sync_failed',claim.athlete_id,claim);
      return callbackRedirect(null);
    }
    const result=await exchange({grant_type:'authorization_code',code,redirect_uri:`${env('SUPABASE_URL')}/functions/v1/health-whoop/callback`});
    if(result.status!==200) throw new HealthError('Connection failed');
    const tokens=tokenPayload(result.data);
    const ticket=randomSecret();
    const saved=await backend('stage_tokens',claim.athlete_id,{...claim,ticket_hash:await hashState(ticket),token_cipher:await seal(tokens,claim.athlete_id,key),token_expires_at:new Date(Date.now()+result.data.expires_in*1000).toISOString()});
    if(!saved.saved) {
      await requestJson(`${API_URL}/user/access`,{method:'DELETE',headers:{Authorization:`Bearer ${tokens.access_token}`}}).catch(()=>{});
    }
    return callbackRedirect(saved.saved===true?ticket:null);
  } catch {
    if(claim) await backend('sync_failed',claim.athlete_id,claim).catch(()=>{});
    return callbackRedirect(null);
  }
}
Deno.serve(async (request: Request) => {
  const key=await encryptionKey();
  const ready=Boolean(env('WHOOP_CLIENT_ID') && env('WHOOP_CLIENT_SECRET') && key);
  const isCallback=new URL(request.url).pathname.endsWith('/health-whoop/callback');
  if(request.method==='GET' && isCallback) return callback(request,key,ready);
  if(request.headers.get('origin')!==APP_ORIGIN) return reply({error:'Open JKCREW to manage your health connection.'},403);
  if(request.method==='OPTIONS') return new Response(null,{status:204,headers:jsonHeaders()});
  if(request.method!=='POST') return reply({error:'Method not allowed'},405);
  try {
    if(!env('SUPABASE_URL') || !env('SUPABASE_ANON_KEY') || !env('SUPABASE_SERVICE_ROLE_KEY')) throw new HealthError('Health connection setup is not complete.');
    const actor=await authenticatedRider(request);
    if(Number(request.headers.get('content-length')||0)>1024) return reply({error:'Invalid request'},400);
    const raw=await request.text();
    if(raw.length>1024) return reply({error:'Invalid request'},400);
    let body: Json; try { body=JSON.parse(raw); } catch { return reply({error:'Invalid request'},400); }
    if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(k=>k!=='action' && !(body.action==='complete' && k==='ticket')) || !['status','connect','refresh','disconnect','complete'].includes(body.action)) return reply({error:'Invalid request'},400);
    // Missing/rotated deployment secrets must not pretend that an existing
    // connection was removed. Status remains factual and local removal works.
    if(!ready && body.action!=='disconnect') return reply(envelope(await backend('status',actor),false,'WHOOP connection setup is not complete yet.'));
    if(body.action==='status') return reply(envelope(await backend('status',actor),true));
    if(body.action==='refresh') return reply(await sync(actor,key!));
    if(body.action==='complete') {
      if(typeof body.ticket!=='string' || !/^[a-f0-9]{64}$/.test(body.ticket)) return reply({error:'This WHOOP connection link is not valid. Please connect again.'},400);
      const result=await backend('complete',actor,{ticket_hash:await hashState(body.ticket)});
      if(!result.saved) return reply({error:'This WHOOP connection link has expired or belongs to a different rider. Please connect again.'},400);
      return reply(envelope(result.status,true,'WHOOP connected.'));
    }
    if(body.action==='connect') {
      const state=randomSecret();
      const started=await backend('begin',actor,{state_hash:await hashState(state)});
      if(started.busy) return reply({error:'Please wait a moment before connecting again.'},409);
      if(started.already_connected) return reply(envelope(await backend('status',actor),true));
      const url=new URL(AUTH_URL);
      url.search=new URLSearchParams({response_type:'code',client_id:env('WHOOP_CLIENT_ID'),redirect_uri:`${env('SUPABASE_URL')}/functions/v1/health-whoop/callback`,scope:SCOPES,state}).toString();
      return reply({provider:'whoop',availability:'ready',authorization_url:url.href});
    }
    const claim=await backend('claim_disconnect',actor);
    if(!claim.claimed) {
      if(claim.status?.syncing) return reply({error:'Your health summary is refreshing. Try disconnecting again in a moment.'},409);
      return reply(envelope(claim.status,ready));
    }
    let revoked=true;
    if(claim.token_cipher && key) {
      try {
        const tokens=await unseal(claim.token_cipher,actor,key);
        const result=await requestJson(`${API_URL}/user/access`,{method:'DELETE',headers:{Authorization:`Bearer ${tokens.access_token}`}});
        revoked=result.status===204;
      } catch { revoked=false; }
    } else if(claim.token_cipher) revoked=false;
    const result=await backend('disconnect',actor,claim);
    return reply(envelope(result.status||disconnectState,ready,revoked?'WHOOP disconnected.': 'WHOOP disconnected from JKCREW. Also remove JKCREW access in WHOOP to revoke its permission.'));
  } catch(error) {
    return reply({error:error instanceof HealthError?error.message:'Health connection is temporarily unavailable. Please try again.'},error instanceof HealthError?error.status:503);
  }
});
