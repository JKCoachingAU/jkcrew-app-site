// Actual auth callbacks, session setup and sign-in form, with only remote
// responses / unrelated dashboard modules stubbed. No production requests.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.JKCREW_PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'app.js'),'utf8');
const extract=name=>{const start=source.search(new RegExp('^(?:async )?function '+name+'\\(','m'));assert(start>=0,name);const rest=source.slice(start);return rest.slice(0,rest.indexOf('\n}')+2);};
const names=['init','handleSessionOnce','handleSession','handleAuth','renderAuth','renderBootRecovery','isTransientRequestError','retryNetworkRequest','setButtonBusy','beginAuthFormRequest','showAuthFormMessage','authErrorMessage'];
const messageStart=source.indexOf('const messageFrom = '),messageRest=source.slice(messageStart);assert(messageStart>=0);
const actualMessage=messageRest.slice(0,messageRest.indexOf('\n};')+3);
const fixture=String.raw`
const app=document.querySelector('#app');
const state={session:null,user:null,profile:null,view:'home',authEventVersion:0,sessionSetupVersion:0,sessionHandlePromise:null,sessionHandleUserId:'',sessionReadyUserId:'',cache:{},inFlight:new Map(),athleteHomeRenderVersion:0,sessionRenderVersion:0,sessionViewerRenderVersion:0,loadingOverlayToken:0};
const PROFILE_SELECT='id,display_name,role,app_theme',RILEY_TEST_ACCOUNT_ID='test-only';let runUndoStack=[],runRedoStack=[];
window.calls=[];window.paints=[];window.notices=[];window.errors=[];window.profileQueue={};window.sessionQueue=[];window.passwordQueue=[];window.recoveryQueue=[];window.timeoutOverrides={};window.recoveryUrl=false;
window.defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject};};
window.session=id=>({user:{id,email:id+'@example.test'},access_token:'fixture-'+id});
const profile=id=>({id,display_name:'Rider '+id,role:'athlete',app_theme:'dark'});
const consume=(queue,fallback)=>Promise.resolve(queue.length?queue.shift():fallback);
const client={auth:{onAuthStateChange(callback){window.authCallback=callback;return{data:{subscription:{unsubscribe(){}}}}},getSession(){calls.push({name:'getSession'});return consume(sessionQueue,{data:{session:state.session}})},signInWithPassword(credentials){calls.push({name:'password',email:credentials.email});return consume(passwordQueue,{data:{session:session('A')}})}},from(table){let id;const query={select(){return query},eq(key,value){if(key==='id')id=value;return query},maybeSingle(){calls.push({name:'profile',id});return consume(profileQueue[id]||[],{data:profile(id)})}};return query},rpc(name){calls.push({name});return consume(recoveryQueue,{data:profile(state.user?.id)})}};
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const wait=()=>Promise.resolve();
const withTimeout=(promise,label,ms)=>testRealTimeout(promise,label,timeoutOverrides[label]??ms);
const cancelScreenLoading=()=>{state.loadingOverlayToken++;app.inert=false;},loadingScreenCopy=()=>({}),beginScreenLoading=()=>++state.loadingOverlayToken,finishScreenLoading=()=>{};
const closeJkcYard=()=>{},teardownRealtimeSync=()=>{},dismissDailyFinishForNavigation=()=>{},closeTrainingProgressViews=()=>{},closeAthleteReviewViewer=()=>{},closeContestEventModal=()=>{},closeEventCourseViewer=()=>{},resetVideoReviewPrivateState=()=>{},clearDailyFeatureMounts=()=>{},applyTheme=()=>{},recordMyAppOpen=()=>{},startRiderFeatureAccessWatch=()=>{},setupRealtimeSync=async()=>{},isRileyTestRoute=()=>false;
const riderFeaturesDisabled=()=>false,riderFeatureAccessUnknown=()=>false;
const refreshRiderFeatureAccess=async()=>true,isCoachRole=role=>role==='coach',notify=message=>notices.push(message);
const navigate=async view=>{state.view=view;paints.push({kind:'navigate',view,user:state.user?.id});};
function renderShell(){paints.push({kind:'shell',user:state.user?.id,profile:state.profile?.id});app.innerHTML='<main id="view" data-user="'+escapeHtml(state.user?.id)+'" data-profile="'+escapeHtml(state.profile?.id)+'">Rider dashboard</main>';}
const authHeroMarkup=()=>'',isPasswordRecoveryUrl=()=>recoveryUrl,cleanPasswordRecoveryUrl=()=>{recoveryUrl=false;},renderForgotPassword=()=>{app.innerHTML='<section id="forgot">Reset link required</section>';};
function renderPasswordRecovery(){paints.push({kind:'recovery',user:state.user?.id});app.innerHTML='<section id="password-recovery">Choose a new password</section>';}
const clearLocalAuthSession=()=>{};
window.settle=()=>new Promise(resolve=>setTimeout(resolve,0));
`;
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});let checks=0;
 const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;},ok=(condition,message)=>{assert(condition,message);checks++;};
 const pages=[];
 async function fresh(){
  const page=await browser.newPage({viewport:{width:390,height:844}});pages.push(page);page.setDefaultTimeout(5000);
  await page.route('**/*',route=>route.request().url()==='https://jkcrew.test/'?route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div>'}):route.abort());
  await page.goto('https://jkcrew.test/');page.on('pageerror',error=>{void page.evaluate(message=>errors.push(message),error.message).catch(()=>{});});
  await page.addScriptTag({content:fixture+'\n'+actualMessage+'\n'+extract('withTimeout').replace('function withTimeout(','function testRealTimeout(')+'\n'+names.map(extract).join('\n')});
  return page;
 }
 try{
  {
   const page=await fresh();
   await page.evaluate(()=>{window.initial=defer();sessionQueue.push(initial.promise);window.boot=init();});
   await page.locator('#email').fill('rider@example.test');await page.locator('#password').fill('fixture-password');
   await page.evaluate(async()=>{initial.resolve({data:{session:null}});await boot;});
   eq(await page.locator('#email').inputValue(),'rider@example.test','Late empty session restoration preserves typed email');
   eq(await page.locator('#password').inputValue(),'fixture-password','Late empty session restoration preserves typed password');
   eq(await page.locator('.auth-message').innerText(),'','Connection check clears without replacing the form');
   await page.close();
  }
  // INITIAL_SESSION wins; the older initial read may time out or return stale
  // null/another user. None may replace the valid shell or re-request a grant.
  for(const late of ['timeout','null','other']){
   const page=await fresh();
   await page.evaluate(()=>{window.initial=defer();sessionQueue.push(initial.promise);timeoutOverrides['Sign in check']=120;window.boot=init();authCallback('INITIAL_SESSION',session('A'));});
   await page.waitForSelector('#view[data-user="A"]');
   if(late==='timeout')await page.evaluate(()=>boot);
   else await page.evaluate(async kind=>{initial.resolve({data:{session:kind==='null'?null:session('OLD')}});await boot;},late);
   eq(await page.locator('#view').getAttribute('data-user'),'A','Late initial '+late+' cannot replace authenticated account');
   eq(await page.locator('#auth-form').count(),0,'Late initial '+late+' does not demand another login');
   await page.evaluate(async()=>{authCallback('SIGNED_IN',session('A'));await settle();});
   eq(await page.evaluate(()=>calls.filter(call=>call.name==='profile').length),1,'Ready same-user callback does not reload the profile');
   eq(await page.evaluate(()=>errors),[],'No late initial '+late+' errors');await page.close();
  }
  {
   const page=await fresh();
   await page.evaluate(()=>{window.initial=defer();sessionQueue.push(initial.promise);window.boot=init();authCallback('SIGNED_IN',session('B'));});
   await page.waitForSelector('#view[data-user="B"]');
   await page.evaluate(async()=>{authCallback('INITIAL_SESSION',session('A'));initial.resolve({data:{session:session('A')}});await boot;await settle();});
   eq(await page.evaluate(()=>[state.user.id,state.profile.id]),['B','B'],'Late INITIAL_SESSION cannot supersede a newer successful SIGNED_IN');
   eq(await page.evaluate(()=>calls.filter(call=>call.name==='profile').map(call=>call.id)),['B'],'Obsolete INITIAL_SESSION does not load another profile');
   eq(await page.locator('#view').getAttribute('data-user'),'B');await page.close();
  }
  {
   const page=await fresh();
   await page.evaluate(()=>{window.oldProfile=defer();profileQueue.A=[oldProfile.promise];window.oldSetup=handleSessionOnce(session('A'));});
   await page.evaluate(()=>handleSessionOnce(session('B')));await page.waitForSelector('#view[data-user="B"]');
   await page.evaluate(async()=>{oldProfile.resolve({data:profile('A')});await oldSetup;});
   eq(await page.evaluate(()=>[state.user.id,state.profile.id,state.sessionReadyUserId]),['B','B','B'],'Late A profile cannot overwrite current B');
   eq(await page.locator('#view').getAttribute('data-profile'),'B');
   eq(await page.evaluate(()=>paints.filter(row=>row.kind==='shell').length),1,'Stale setup never paints a second shell');await page.close();
  }
  {
   const page=await fresh();
   await page.evaluate(()=>{window.oldProfile=defer();profileQueue.A=[oldProfile.promise];window.oldSetup=handleSessionOnce(session('A'));});
   await page.evaluate(()=>handleSessionOnce(null));await page.waitForSelector('#auth-form');
   await page.evaluate(async()=>{oldProfile.resolve({data:profile('A')});await oldSetup;});
   eq(await page.evaluate(()=>[state.user,state.profile]),[null,null],'Signed-out state remains empty after delayed profile read');
   eq(await page.locator('#view').count(),0,'Sign-out cannot be reversed by stale setup');eq(await page.locator('#auth-form').count(),1);eq(await page.evaluate(()=>errors),[]);await page.close();
  }
  // Failure leaves a signed-in account recoverable without submitting another
  // password. A later same-user auth event must retry unfinished initialization.
  {
   const page=await fresh();
   await page.evaluate(async()=>{sessionQueue.push({data:{session:null}});await init();profileQueue.A=[{error:{message:'Profile denied',status:403}}];recoveryQueue=[{error:{message:'Profile service unavailable',status:503}}];authCallback('SIGNED_IN',session('A'));});
   await page.waitForSelector('.boot-recovery');
   eq(await page.evaluate(()=>state.user.id),'A','Profile setup failure retains the authenticated session');
   eq(await page.locator('#auth-form').count(),0,'Profile failure stays on recovery, not password sign-in');
   await page.evaluate(()=>authCallback('SIGNED_IN',session('A')));await page.waitForSelector('#view[data-user="A"]');
   eq(await page.evaluate(()=>calls.filter(call=>call.name==='password').length),0,'Same-user recovery makes no password grant');eq(await page.evaluate(()=>state.sessionReadyUserId),'A');await page.close();
  }
  // Recovery takes priority over both an in-flight profile and initial-session
  // callbacks queued in the same task, preserving the password reset form.
  for(const order of ['profile-pending','same-task']){
   const page=await fresh();
   await page.evaluate(async mode=>{
    window.initial=defer();sessionQueue.push(initial.promise);window.boot=init();window.oldProfile=defer();profileQueue.A=[oldProfile.promise];
    authCallback('INITIAL_SESSION',session('A'));
    if(mode==='profile-pending')await settle();
    authCallback('PASSWORD_RECOVERY',session('A'));await settle();
    oldProfile.resolve({data:profile('A')});initial.resolve({data:{session:session('A')}});await boot;await settle();
   },order);
   ok(await page.locator('#password-recovery').isVisible(),'Password recovery wins over '+order+' normal setup');eq(await page.locator('#view').count(),0,'No dashboard replaces the reset form');eq(await page.evaluate(()=>errors),[]);await page.close();
  }
  // Exercise real DOM submit -> real handleAuth -> real session setup.
  {
   const page=await fresh();await page.evaluate(()=>{profileQueue.A=[{error:{message:'Profile denied',status:403}}];recoveryQueue=[{error:{message:'Unavailable',status:503}}];renderAuth();});
   await page.locator('#email').fill('A@example.test');await page.locator('#password').fill('fixture-password');await page.getByRole('button',{name:'Enter JKCREW',exact:true}).click();
   await page.waitForSelector('.boot-recovery');eq(await page.locator('#auth-form').count(),0,'Successful password grant followed by setup failure keeps recovery UI');eq(await page.evaluate(()=>calls.filter(call=>call.name==='password').length),1,'Setup failure never repeats the password grant');
   await page.locator('#boot-retry').click();await page.waitForSelector('#view[data-user="A"]');eq(await page.evaluate(()=>calls.filter(call=>call.name==='password').length),1,'Try again reuses the authenticated session without another password');await page.close();
  }
  {
   const page=await fresh();await page.evaluate(()=>{passwordQueue=[{error:{message:'Failed to fetch',status:503}}];sessionQueue=[{data:{session:session('A')}}];renderAuth();});
   await page.locator('#email').fill('A@example.test');await page.locator('#password').fill('fixture-password');await page.getByRole('button',{name:'Enter JKCREW',exact:true}).click();
   await page.waitForSelector('.boot-recovery');eq(await page.locator('#auth-form').count(),0,'Returned transient sign-in error offers saved-session recovery');
   eq(await page.evaluate(()=>calls.filter(call=>call.name==='password').length),1,'Returned transient error does not repeat a password grant');
   await page.locator('#boot-retry').click();await page.waitForSelector('#view[data-user="A"]');
   eq(await page.evaluate(()=>calls.filter(call=>call.name==='password').length),1,'Retry checks the SDK session after returned transient sign-in error');await page.close();
  }
  {
   const page=await fresh();await page.evaluate(()=>{passwordQueue=[{error:{message:'Invalid login credentials',status:400,code:'invalid_credentials'}}];renderAuth();});
   await page.locator('#email').fill('A@example.test');await page.locator('#password').fill('wrong-password');await page.getByRole('button',{name:'Enter JKCREW',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('.auth-message')?.textContent.includes('Email or password is incorrect'));
   eq(await page.evaluate(()=>calls.filter(call=>call.name==='password').length),1,'Invalid credentials are never automatically retried');eq(await page.evaluate(()=>calls.filter(call=>call.name==='profile').length),0,'Bad credentials never read a profile');ok(await page.getByRole('button',{name:'Enter JKCREW',exact:true}).isEnabled(),'User can correct credentials');await page.close();
  }
  {
   const page=await fresh();
   const result=await page.evaluate(async()=>{
    const cases=[new TypeError('Failed to fetch'),new Error('NetworkError when attempting to fetch resource.'),{error_description:'Connection closed',status:0},{code:'08006',message:'Request failed'},{status:503,message:'Unavailable'}],counts=[];
    for(const error of cases){let calls=0;const result=await retryNetworkRequest(async()=>{calls++;return calls===1?{error}:{data:{ok:true}};},'Profile load',{attempts:3});counts.push({calls,ok:result.data?.ok===true});}
    let thrownCalls=0;await retryNetworkRequest(async()=>{thrownCalls++;if(thrownCalls===1)throw new TypeError('Failed to fetch');return{data:{ok:true}};},'Profile load',{attempts:3});
    let invalid=0;await retryNetworkRequest(async()=>{invalid++;return{error:{status:400,code:'invalid_credentials',message:'Invalid login credentials'}};},'Sign in',{attempts:3});
    return{counts,invalid,thrownCalls};
   });
   eq(result.counts,Array(5).fill({calls:2,ok:true}),'Raw transient error details drive retry even after friendly message formatting');eq(result.invalid,1,'Nontransient credentials are not retried by the generic helper');eq(result.thrownCalls,2,'Rejected fetch requests also retry once before succeeding');await page.close();
  }
  console.log('PASS: '+checks+' actual auth startup races, recovery priority, session isolation, real sign-in form and transient retry checks.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
