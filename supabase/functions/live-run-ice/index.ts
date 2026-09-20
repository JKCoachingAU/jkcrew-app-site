// TURN REST credentials: the long-lived shared secret never reaches a browser.
const origins = new Set(['https://jkcoachingau.github.io', 'http://localhost:8089', 'http://127.0.0.1:8089', 'http://localhost:4173', 'http://127.0.0.1:4173']);
const headers = (origin: string) => ({'Content-Type':'application/json','Access-Control-Allow-Origin':origins.has(origin) ? origin : 'https://jkcoachingau.github.io','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin','Cache-Control':'no-store'});
Deno.serve(async (request: Request) => {
  const origin = request.headers.get('origin') || '';
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body),{status,headers:headers(origin)});
  if (!origins.has(origin)) return reply({error:'Use JKCREW to start the call.'},403);
  if (request.method === 'OPTIONS') return new Response(null,{status:204,headers:headers(origin)});
  if (request.method !== 'POST') return reply({error:'Method not allowed'},405);
  const token = request.headers.get('authorization') || '';
  if (!/^Bearer \S+$/.test(token)) return reply({error:'Sign in to join the call.'},401);
  const url = Deno.env.get('SUPABASE_URL') || '';
  const apiKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const authHeaders = {Authorization:token,apikey:apiKey,'Content-Type':'application/json'};
  try {
    const userResponse = await fetch(`${url}/auth/v1/user`,{headers:authHeaders});
    if (!userResponse.ok) return reply({error:'Sign in again to join the call.'},401);
    const user = await userResponse.json();
    const body = await request.json();
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuid.test(body.sessionId || '') || !uuid.test(body.clientId || '')) return reply({error:'A valid call is required.'},400);
    // The RPC checks current coach/rider links, feature access, expiry and client binding.
    const access = await fetch(`${url}/rest/v1/rpc/live_run_call_action`,{method:'POST',headers:authHeaders,body:JSON.stringify({p_action:'get',p_session_id:body.sessionId,p_client_id:body.clientId})});
    if (!access.ok) return reply({error:'This call is not available to your account.'},403);
    const data = await access.json();
    if (data.session?.call_status !== 'active' || ![data.session.athlete_id,data.session.coach_id].includes(user.id)) return reply({error:'Accept the call first.'},403);
    const iceServers: Array<Record<string, unknown>> = [{urls:'stun:stun.l.google.com:19302'}];
    const secret = Deno.env.get('TURN_SHARED_SECRET');
    const urls = (Deno.env.get('TURN_URLS') || '').split(',').map(s => s.trim()).filter(s => /^turns?:[^\s]+$/i.test(s));
    const expiresAt = Math.floor(Date.now()/1000) + 3600;
    if (secret && urls.length) {
      const username = `${expiresAt}:${user.id}`;
      const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-1'},false,['sign']);
      const signature = new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(username)));
      const credential = btoa(String.fromCharCode(...signature));
      iceServers.push({urls,username,credential});
    }
    return reply({iceServers,relayConfigured:iceServers.length>1,expiresAt});
  } catch { return reply({error:'Call connection settings are temporarily unavailable.'},503); }
});
