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
 async function scenario({profileFailures=0,persistentProfileFailure=false,invalidPassword=false,access='enabled',push='',role='athlete',restore='',recovery=false,logoutFailure=false}={}){
  const accountProfile={...profile,role};
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  const counts={password:0,profile:0,refresh:0,websocket:0,access:0,logout:0,update:0},errors=[],requests=[],unexpected=[];
  const controls={profileFailures,persistentProfileFailure,invalidPassword};
  if(restore){const saved=session();if(restore.startsWith('expired'))saved.expires_at=Math.floor(Date.now()/1000)-120;await context.addInitScript(value=>{if(!localStorage.getItem('fixture-seeded')){localStorage.setItem('sb-soanwttlorlgdfrzbvtp-auth-token',JSON.stringify(value));localStorage.setItem('fixture-seeded','yes');}},saved);}
  const headers={'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-expose-headers':'Retry-After, Content-Range','retry-after':'0'};
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin===origin)return route.continue();
   if(url.hostname!=='soanwttlorlgdfrzbvtp.supabase.co')return route.abort();
   requests.push({method:request.method(),path:url.pathname,search:url.search});
   const json=(data,status=200,extra={})=>route.fulfill({status,headers:{...headers,...extra},body:request.method()==='HEAD'?'':JSON.stringify(data)});
   if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
   if(url.pathname==='/auth/v1/token'){
    const grant=url.searchParams.get('grant_type');
    if(grant==='password'){counts.password++;if(controls.invalidPassword)return json({code:'invalid_credentials',message:'Invalid login credentials'},400);return json(session());}
    if(grant==='refresh_token'){counts.refresh++;if(restore==='expired-invalid')return json({code:'refresh_token_not_found',message:'Invalid Refresh Token: Refresh Token Not Found'},400);return json(session());}
   }
   if(url.pathname==='/auth/v1/user'){if(request.method()==='PUT')counts.update++;return json(user);}
   if(url.pathname==='/auth/v1/logout'){counts.logout++;return logoutFailure?json({message:'Service unavailable'},503):json({});}
   if(url.pathname.startsWith('/rest/v1/')){
    const name=url.pathname.slice('/rest/v1/'.length);
    if(name==='profiles'&&url.searchParams.get('select')===profileSelect){
     counts.profile++;
     if(controls.persistentProfileFailure||controls.profileFailures-->0)return json({code:'PGRST002',message:'Temporary profile service failure',details:null,hint:null},503);
     return json([accountProfile]);
    }
    if(name==='rpc/get_rider_feature_access'){counts.access++;if(access==='failed')return json({code:'PGRST002',message:'Temporary access service failure'},503);return json([{athlete_id:riderId,features_disabled:access==='disabled'}]);}
    if(name==='rpc/get_weekly_leaderboard')return json([{athlete_id:riderId,display_name:profile.display_name,weekly_points:7,level:1,xp_total:0,rank_number:1}]);
    if(name==='rpc/ensure_current_profile')return json(accountProfile);
    if(name==='rpc/get_my_progress_milestones')return json({});
    if(name==='profiles')return json([accountProfile]);
    return json([],200,{'content-range':'*/0'});
   }
   unexpected.push(request.method()+' '+url.pathname);return route.abort();
  });
  // A local socket stand-in prevents any Realtime connection leaving the test.
  await context.routeWebSocket('**',socket=>{counts.websocket++;socket.onMessage(message=>{
   try{const frame=JSON.parse(String(message));if(Array.isArray(frame)&&['phx_join','heartbeat'].includes(frame[3]))socket.send(JSON.stringify([frame[0],frame[1],frame[2],'phx_reply',{status:'ok',response:{postgres_changes:[]}}]));}catch{}
  });});
  const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+(recovery?'/?password-recovery=1':push?'/?push='+encodeURIComponent(push):''),{waitUntil:'domcontentloaded'});if(!restore)await page.locator('#auth-form').waitFor();
  const signIn=async()=>{await page.locator('#email').fill(email);await page.locator('#password').fill('isolated-fixture-password');await page.getByRole('button',{name:'Enter JKCREW',exact:true}).click();};
  const ready=async()=>{await page.waitForFunction(()=>state.sessionReadyUserId&&document.querySelector('#view')&&!document.querySelector('#app').inert);if(role==='athlete')await page.locator('.athlete-scoreboard').waitFor();};
  return{page,context,counts,controls,errors,requests,unexpected,signIn,ready};
 }
 try{
  {
   const test=await scenario({profileFailures:2});const {page,counts}=test;
   ok(await page.evaluate(()=>typeof window.supabase?.createClient==='function'),'Full page loaded the shipped Supabase SDK');
   for(const width of [320,375,390,768]){await page.setViewportSize({width,height:844});await page.locator('.auth-hero img').evaluate(image=>image.decode().catch(()=>{}));const button=await page.getByRole('button',{name:'Enter JKCREW',exact:true}).boundingBox();ok(button.y+button.height<=844,'Actual login button fits first screen at '+width+'px');eq(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Actual login stays within '+width+'px viewport');if(width===375)await page.screenshot({path:'/tmp/jkcrew-auth-mobile375.png',fullPage:true});}await page.setViewportSize({width:390,height:844});

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
  {
   const test=await scenario({logoutFailure:true});await test.signIn();await test.ready();
   await test.page.evaluate(()=>{localStorage.setItem('jkcrew-draft-fixture','unsaved run');localStorage.setItem('sb-other-project-auth-token','other application');void signOutCurrentDevice();});
   await test.page.locator('#auth-form').waitFor();
   eq(await test.page.evaluate(()=>localStorage.getItem('sb-soanwttlorlgdfrzbvtp-auth-token')),null,'Backend sign-out failure still clears this device session');
   eq(await test.page.evaluate(()=>localStorage.getItem('jkcrew-draft-fixture')),'unsaved run','Fallback logout preserves rider drafts');
   eq(await test.page.evaluate(()=>localStorage.getItem('sb-other-project-auth-token')),'other application','Fallback logout leaves other app credentials intact');
   eq(test.errors,[],'Offline fallback sign-out has no unhandled page errors');await test.context.close();
  }
  for(const role of ['parent','coach']){
   const test=await scenario({role});await test.signIn();await test.ready();
   eq(await test.page.evaluate(()=>state.profile.role),role,'Correct '+role+' role restored from profile');eq(test.counts.password,1,role+' signs in once');
   eq(await test.page.evaluate(()=>state.view),role==='coach'?'command':'home',role+' opens the correct landing page');
   eq(await test.page.locator('.boot-recovery,#auth-form,.view-error').count(),0,role+' login has no error UI');
   await test.page.reload({waitUntil:'domcontentloaded'});await test.ready();eq(test.counts.password,1,role+' session persists on reload');
   await test.page.evaluate(()=>signOutCurrentDevice());await test.page.locator('#auth-form').waitFor();
   eq(test.counts.logout,1,role+' signs out once');eq(test.requests.find(r=>r.path==='/auth/v1/logout')?.search,'?scope=local','SDK sends local-scoped logout');
   eq(await test.page.evaluate(()=>localStorage.getItem('sb-soanwttlorlgdfrzbvtp-auth-token')),null,'SDK removes '+role+' persisted credentials');
   eq(test.errors,[],role+' startup/reload/logout have no uncaught errors');eq(test.unexpected,[]);await test.context.close();
  }
  {
   const test=await scenario({restore:'expired-valid'});await test.ready();eq(test.counts.refresh,1,'Expired access token refreshes once');eq(test.counts.password,0,'Expired session restoration never asks for password');eq(await test.page.evaluate(()=>state.profile.id),riderId,'Token refresh restores matching rider');eq(test.errors,[]);await test.context.close();
  }
  {
   const test=await scenario({restore:'expired-invalid'});await test.page.locator('#auth-form').waitFor();
   await test.page.waitForFunction(()=>!localStorage.getItem('sb-soanwttlorlgdfrzbvtp-auth-token'));
   eq(test.counts.refresh,1,'Revoked refresh token is tried once');eq(test.counts.password,0,'Revoked session returns to usable sign in');eq(await test.page.locator('.boot-recovery').count(),0,'Revoked session does not get stuck on loading recovery');eq(test.errors,[]);await test.context.close();
  }
  {
   const test=await scenario({restore:'valid',recovery:true});await test.page.locator('#password-recovery-form').waitFor();
   await test.page.locator('#new-password').fill('new-fixture-password');await test.page.locator('#confirm-password').fill('new-fixture-password');
   await test.page.evaluate(()=>client.auth.refreshSession());
   eq(await test.page.locator('#new-password').inputValue(),'new-fixture-password','SDK TOKEN_REFRESHED leaves password reset input intact');
   await test.page.getByRole('button',{name:'Save new password',exact:true}).click();await test.ready();
   eq(test.counts.update,1,'Password recovery performs exactly one update with bundled SDK');eq(test.counts.password,0,'Recovery keeps session without password login');eq(await test.page.locator('#password-recovery-form').count(),0,'Successful password reset opens rider Home');
   ok(!test.page.url().includes('password-recovery'),'Recovery URL cleaned after success');eq(test.errors,[]);eq(test.unexpected,[]);await test.context.close();
  }
  console.log('PASS: '+checks+' full-index bundled-SDK login, transient HTTP recovery, saved-session reload, Boot retry and invalid-credential checks; no production traffic.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
