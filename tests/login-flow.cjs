// Full index.html + shipped Supabase SDK + actual app. All external HTTP and
// WebSockets are intercepted; credentials, profiles and sessions are synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.JKCREW_PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..'),appSource=fs.readFileSync(path.join(root,'app.js'),'utf8');
const profileSelect=appSource.match(/^const PROFILE_SELECT = "([^"]+)";/m)[1];
const riderId='11111111-1111-4111-8111-111111111111',email='login-fixture@example.test';
const profile={id:riderId,email,display_name:'Test Login Rider',role:'athlete',app_theme:'dark',country_code:'AU',country_name:'Australia',xp_total:0,level:1,goals:[],rider_extra_tricks:[],achievements:[],badges:[],onboarding_completed_at:new Date().toISOString()};
const user={id:riderId,aud:'authenticated',role:'authenticated',email,email_confirmed_at:new Date().toISOString(),app_metadata:{provider:'email',providers:['email']},user_metadata:{display_name:profile.display_name},identities:[],created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
function session(){const now=Math.floor(Date.now()/1000),encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');const token=encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:riderId,aud:'authenticated',role:'authenticated',email,iat:now,exp:now+3600,iss:'https://soanwttlorlgdfrzbvtp.supabase.co/auth/v1',session_id:'22222222-2222-4222-8222-222222222222'})+'.'+Buffer.from('isolated-test-signature').toString('base64url');return{access_token:token,refresh_token:'isolated-test-refresh-token',token_type:'bearer',expires_in:3600,expires_at:now+3600,user};}
(async()=>{
 const server=http.createServer((request,response)=>{const url=new URL(request.url,'http://localhost'),file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){response.writeHead(404);return response.end();}const ext=path.extname(file),mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'}[ext]||'application/octet-stream';response.writeHead(200,{'content-type':mime});response.end(fs.readFileSync(file));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});let checks=0;
 const eq=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;},ok=(condition,message)=>{assert(condition,message);checks++;};
 async function scenario({profileFailures=0,persistentProfileFailure=false,invalidPassword=false,access='enabled',push=''}={}){
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  const counts={password:0,profile:0,refresh:0,websocket:0,access:0},errors=[],requests=[],unexpected=[];
  const controls={profileFailures,persistentProfileFailure,invalidPassword};
  const headers={'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-expose-headers':'Retry-After, Content-Range','retry-after':'0'};
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin===origin)return route.continue();
   if(url.hostname!=='soanwttlorlgdfrzbvtp.supabase.co')return route.abort();
   requests.push({method:request.method(),path:url.pathname});
   const json=(data,status=200,extra={})=>route.fulfill({status,headers:{...headers,...extra},body:request.method()==='HEAD'?'':JSON.stringify(data)});
   if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
   if(url.pathname==='/auth/v1/token'){
    const grant=url.searchParams.get('grant_type');
    if(grant==='password'){counts.password++;if(controls.invalidPassword)return json({code:'invalid_credentials',message:'Invalid login credentials'},400);return json(session());}
    if(grant==='refresh_token'){counts.refresh++;return json(session());}
   }
   if(url.pathname==='/auth/v1/user')return json(user);
   if(url.pathname==='/auth/v1/logout')return json({});
   if(url.pathname.startsWith('/rest/v1/')){
    const name=url.pathname.slice('/rest/v1/'.length);
    if(name==='profiles'&&url.searchParams.get('select')===profileSelect){
     counts.profile++;
     if(controls.persistentProfileFailure||controls.profileFailures-->0)return json({code:'PGRST002',message:'Temporary profile service failure',details:null,hint:null},503);
     return json([profile]);
    }
    if(name==='rpc/get_rider_feature_access'){counts.access++;if(access==='failed')return json({code:'PGRST002',message:'Temporary access service failure'},503);return json([{athlete_id:riderId,features_disabled:access==='disabled'}]);}
    if(name==='rpc/get_weekly_leaderboard')return json([{athlete_id:riderId,display_name:profile.display_name,weekly_points:7,level:1,xp_total:0,rank_number:1}]);
    if(name==='rpc/ensure_current_profile')return json(profile);
    if(name==='rpc/get_my_progress_milestones')return json({});
    if(name==='profiles')return json([profile]);
    return json([],200,{'content-range':'*/0'});
   }
   unexpected.push(request.method()+' '+url.pathname);return route.abort();
  });
  // A local socket stand-in prevents any Realtime connection leaving the test.
  await context.routeWebSocket('**',socket=>{counts.websocket++;socket.onMessage(message=>{
   try{const frame=JSON.parse(String(message));if(Array.isArray(frame)&&['phx_join','heartbeat'].includes(frame[3]))socket.send(JSON.stringify([frame[0],frame[1],frame[2],'phx_reply',{status:'ok',response:{postgres_changes:[]}}]));}catch{}
  });});
  const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+(push?'/?push='+encodeURIComponent(push):''),{waitUntil:'domcontentloaded'});await page.locator('#auth-form').waitFor();
  const signIn=async()=>{await page.locator('#email').fill(email);await page.locator('#password').fill('isolated-fixture-password');await page.getByRole('button',{name:'Enter JKCREW',exact:true}).click();};
  const ready=async()=>{await page.locator('.athlete-scoreboard').waitFor();await page.waitForFunction(()=>!document.querySelector('#app').inert);};
  return{page,context,counts,controls,errors,requests,unexpected,signIn,ready};
 }
 try{
  {
   const test=await scenario({profileFailures:2});const {page,counts}=test;
   ok(await page.evaluate(()=>typeof window.supabase?.createClient==='function'),'Full page loaded the shipped Supabase SDK');
   const started=Date.now();await test.signIn();await test.ready();
   eq(counts.password,1,'Two temporary profile failures require only one password grant');eq(counts.profile,3,'Real SDK/app recover after two mocked HTTP 503 profile responses');
   eq(await page.evaluate(()=>[state.user.id,state.profile.id,state.sessionReadyUserId]),[riderId,riderId,riderId],'Real SDK auth callbacks initialize one matching rider account');
   eq(await page.locator('#auth-form').count(),0);eq(await page.locator('.boot-recovery').count(),0);eq(await page.locator('.view-error').count(),0);
   const persisted=await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('sb-')&&key.endsWith('-auth-token')).length);eq(persisted,1,'Actual SDK persists its session');
   const priorReads=counts.profile;await page.reload({waitUntil:'domcontentloaded'});await test.ready();
   eq(counts.password,1,'Reload restores the saved SDK session without another password grant');eq(counts.profile,priorReads+1,'INITIAL_SESSION and getSession restoration share one profile load');
   eq(await page.evaluate(()=>state.profile.id),riderId);eq(test.errors,[],'No page errors during real SDK sign-in and reload');eq(test.unexpected,[],'All synthetic backend routes are accounted for');
   console.log('Full-page transient/reload scenario: '+(Date.now()-started)+'ms, '+counts.password+' password grant, '+counts.profile+' profile requests.');await test.context.close();
  }
  {
   const test=await scenario({persistentProfileFailure:true});await test.signIn();await test.page.locator('.boot-recovery').waitFor();
   eq(test.counts.password,1,'Persistent profile failure does not repeat password authentication');ok(test.counts.profile>=3,'Persistent profile errors exhaust bounded retries');
   eq(await test.page.evaluate(()=>state.session?.user?.id),riderId,'Recovery preserves the SDK-authenticated session');eq(await test.page.locator('#auth-form').count(),0,'Profile failure does not ask for credentials again');
   test.controls.persistentProfileFailure=false;const prior=test.counts.profile;await test.page.locator('#boot-retry').click();await test.ready();
   eq(test.counts.password,1,'Actual Boot Try again reuses the saved session');eq(test.counts.profile,prior+1,'Boot retry performs one fresh successful profile request');eq(await test.page.locator('.boot-recovery').count(),0);eq(await test.page.evaluate(()=>state.profile.id),riderId);eq(test.errors,[]);eq(test.unexpected,[]);await test.context.close();
  }
  {
   const test=await scenario({invalidPassword:true});await test.signIn();await test.page.waitForFunction(()=>document.querySelector('.auth-message')?.textContent.includes('Email or password is incorrect'));
   eq(test.counts.password,1,'Real SDK invalid-credential response issues exactly one grant');eq(test.counts.profile,0,'Invalid credentials never start a profile load');ok(await test.page.getByRole('button',{name:'Enter JKCREW',exact:true}).isEnabled(),'Friendly invalid-credential error leaves the form usable');eq(await test.page.evaluate(()=>state.session),null);eq(test.errors,[]);eq(test.unexpected,[]);await test.context.close();
  }
  for(const access of ['disabled','failed']){
   const test=await scenario({access,push:'coaching'});await test.signIn();await test.page.locator('#rider-access-dashboard').waitFor();await test.page.waitForFunction(()=>!document.querySelector('#app').inert);
   eq(test.counts.password,1,access+' feature access still requires only one password grant');
   eq(await test.page.evaluate(()=>state.view),'home',access+' push startup opens restricted Home instead of an empty coaching shell');
   ok((await test.page.locator('#rider-access-dashboard').textContent()).includes(profile.display_name),'Restricted Home contains the authenticated rider');
   ok(await test.page.locator('[data-rider-access-retry]').isVisible(),'Access recovery remains available');
   eq(await test.page.locator('#auth-form, .boot-recovery, .view-error').count(),0,'Access restriction does not regress login or screen loading');
   eq(test.counts.websocket,0,'Restricted startup does not subscribe to feature realtime');
   ok(!test.requests.some(request=>/trick_help_requests|weekly_trick_assignments|run_plans|live_run/.test(request.path)),'Restricted push startup never loads coaching/training/run data');
   if(access==='failed')ok(test.counts.access>=2,'Temporary access failure is retried before restricted Home');
   eq(test.errors,[],'No page errors for '+access+' push startup');eq(test.unexpected,[]);await test.context.close();
  }
  console.log('PASS: '+checks+' full-index bundled-SDK login, transient HTTP recovery, saved-session reload, Boot retry and invalid-credential checks; no production traffic.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
