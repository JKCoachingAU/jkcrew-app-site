// Real auth functions and styles with synthetic SDK responses; no account writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.JKCREW_PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'app.js'),'utf8');
const extract=name=>{const start=source.search(new RegExp('^(?:async )?function '+name+'\\(','m'));if(start<0)return '';const rest=source.slice(start);return rest.slice(0,rest.indexOf('\n}')+2);};
const names=['authHeroMarkup','renderAuth','renderForgotPassword','renderPasswordRecovery','handleAuth','requestPasswordReset','updateRecoveredPassword','signOutCurrentDevice','beginAuthFormRequest','showAuthFormMessage','authErrorMessage','isTransientRequestError','retryNetworkRequest','setButtonBusy'];
const start=source.indexOf('const messageFrom = '),rest=source.slice(start),messageFrom=rest.slice(0,rest.indexOf('\n};')+3);
const fixture=String.raw`
const app=document.querySelector('#app'),state={authEventVersion:0,user:null,session:null};let liveRun=null;
window.calls=[];window.queue={};window.errors=[];window.notices=[];window.timeoutOverrides={};window.departures=0;
window.defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject};};
const consume=(name,details={})=>{calls.push({name,...details});return Promise.resolve(queue[name]?.length?queue[name].shift():{data:{}});};
const client={auth:{signInWithPassword:credentials=>consume('password',credentials),getSession:()=>consume('session'),resetPasswordForEmail:(email,opts)=>consume('reset',{email,opts}),updateUser:body=>consume('update',body),signOut:options=>consume('logout',{options})},functions:{invoke:(name,body)=>consume('signup',{body})},from(){return{delete(){return this},eq(){return this},then(resolve,reject){return consume('pushDelete').then(resolve,reject)}}}};
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cancelScreenLoading=()=>{},renderBootRecovery=message=>{app.innerHTML='<div class="boot-recovery">'+escapeHtml(message)+'</div>';};
const wait=()=>Promise.resolve(),withTimeout=(promise,label,ms)=>testTimeout(promise,label,timeoutOverrides[label]??ms);
const notify=(message,kind)=>notices.push({message,kind}),handleSessionOnce=async session=>{state.session=session;state.user=session?.user||null;app.innerHTML='<main id="view">Dashboard</main>';};
const cleanPasswordRecoveryUrl=()=>{},leaveLiveRun=async()=>true,supportsPushNotifications=()=>window.pushEnabled===true,clearLocalAuthSession=()=>{calls.push({name:'clearLocal'});};
window.settle=()=>new Promise(resolve=>setTimeout(resolve,0));
`;
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});let checks=0;const failures=[];
 const eq=(a,b,m)=>{checks++;try{assert.deepEqual(a,b,m);}catch(error){failures.push(error.message);}},ok=(a,m)=>eq(Boolean(a),true,m);
 async function fresh(width=390,height=844){const page=await browser.newPage({viewport:{width,height}});page.setDefaultTimeout(3000);
  await page.route('**/*',r=>r.request().url()==='https://jkcrew.test/'?r.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div>'}):r.abort());await page.goto('https://jkcrew.test/');
  page.on('pageerror',e=>failures.push('Uncaught: '+e.message));await page.addStyleTag({content:fs.readFileSync(path.join(root,'styles.css'),'utf8')});
  await page.addScriptTag({content:fixture+'\n'+messageFrom+'\n'+extract('withTimeout').replace('function withTimeout(','function testTimeout(')+'\n'+names.map(extract).join('\n')});return page;}
 try{
  {
   const p=await fresh();await p.evaluate(()=>{queue.password=[{error:{message:'Invalid login credentials',code:'invalid_credentials',status:400}}];renderAuth();});await p.locator('#email').fill('rider@example.test');await p.locator('#password').fill('wrong-password');await p.locator('#auth-form').evaluate(form=>form.requestSubmit());await p.waitForFunction(()=>document.querySelector('.auth-message')?.textContent.includes('incorrect'));
   eq(await p.locator('#email').inputValue(),'rider@example.test','Invalid credentials preserve email');eq(await p.locator('#password').inputValue(),'wrong-password','Invalid credentials preserve password for correction');ok(await p.getByRole('button',{name:'Enter JKCREW',exact:true}).isEnabled(),'Form unlocks after invalid credentials');await p.close();
  }
  {
   const p=await fresh();await p.evaluate(()=>{window.pending=defer();queue.password=[pending.promise,pending.promise];renderAuth();document.querySelector('#email').value='rider@example.test';document.querySelector('#password').value='fixture-password';const form=document.querySelector('#auth-form');window.jobs=[handleAuth({preventDefault(){},currentTarget:form},'login'),handleAuth({preventDefault(){},currentTarget:form},'login')];});
   eq(await p.evaluate(()=>calls.filter(c=>c.name==='password').length),1,'Repeated login submits start one password grant');await p.evaluate(async()=>{pending.resolve({error:{message:'Invalid login credentials'}});await Promise.all(jobs);});await p.close();
  }
  {
   const p=await fresh();await p.evaluate(()=>{queue.signup=[{data:{error:'An account already exists'}}];renderAuth('signup');});await p.locator('#display-name').fill('Rider Parent');await p.locator('#role').selectOption('parent');await p.locator('#email').fill('parent@example.test');await p.locator('#password').fill('fixture-password');await p.locator('#auth-form').evaluate(form=>form.requestSubmit());await p.waitForFunction(()=>document.querySelector('.auth-message')?.textContent.includes('already'));
   eq(await p.locator('#display-name').inputValue(),'Rider Parent','Signup failure preserves display name');eq(await p.locator('#email').inputValue(),'parent@example.test','Signup failure preserves email');eq(await p.locator('#role').inputValue(),'parent','Signup failure preserves parent account type');eq(await p.locator('#password').inputValue(),'fixture-password','Signup failure preserves password');await p.close();
  }
  {
   const p=await fresh();await p.evaluate(()=>{window.pending=defer();queue.signup=[pending.promise];renderAuth('signup');const f=document.querySelector('#auth-form');f.displayName.value='Rider';f.email.value='rider@example.test';f.password.value='fixture-password';window.job=handleAuth({preventDefault(){},currentTarget:f},'signup');renderForgotPassword();});await p.evaluate(async()=>{pending.resolve({data:{ok:true}});await job;});
   eq(await p.evaluate(()=>calls.filter(c=>c.name==='password').length),0,'Detached signup cannot silently sign in over reset screen');eq(await p.locator('#forgot-password-form').count(),1,'Detached signup leaves current screen intact');await p.close();
  }
  {
   const p=await fresh();await p.evaluate(async()=>{queue.reset=[{error:{message:'Failed to fetch',status:503}}];renderForgotPassword('','rider@example.test');await requestPasswordReset({preventDefault(){},currentTarget:document.querySelector('#forgot-password-form')});});eq(await p.evaluate(()=>calls.filter(c=>c.name==='reset').length),1,'Reset email is never automatically sent again after uncertain network failure');eq(await p.locator('#recovery-email').inputValue(),'rider@example.test','Reset failure preserves email');ok(await p.getByRole('button',{name:'Send reset link',exact:true}).isEnabled(),'Reset error allows explicit retry');await p.close();
  }
  {
   const p=await fresh();await p.evaluate(()=>{window.pending=defer();queue.reset=[pending.promise,pending.promise];renderForgotPassword('','rider@example.test');const f=document.querySelector('#forgot-password-form');window.jobs=[requestPasswordReset({preventDefault(){},currentTarget:f}),requestPasswordReset({preventDefault(){},currentTarget:f})];renderAuth();});eq(await p.evaluate(()=>calls.filter(c=>c.name==='reset').length),1,'Repeated reset submit sends one request');await p.evaluate(async()=>{pending.resolve({});await Promise.all(jobs);});eq(await p.locator('#auth-form').count(),1,'Late reset result cannot replace sign-in form');await p.close();
  }
  {
   const p=await fresh();await p.evaluate(()=>renderPasswordRecovery());await p.locator('#new-password').fill('new-fixture-password');await p.locator('#confirm-password').fill('different-fixture-password');await p.locator('#password-recovery-form').evaluate(f=>f.requestSubmit());await p.waitForFunction(()=>document.querySelector('.auth-message')?.textContent.includes('match'));
   eq(await p.locator('#new-password').inputValue(),'new-fixture-password','Password mismatch does not discard new password');eq(await p.locator('#confirm-password').inputValue(),'different-fixture-password','Password mismatch keeps confirmation editable');eq(await p.evaluate(()=>calls.filter(c=>c.name==='update').length),0,'Mismatch never updates password');await p.close();
  }
  {
   const p=await fresh();await p.evaluate(async()=>{queue.update=[{error:{message:'Failed to fetch',status:503}},{error:{message:'Failed to fetch',status:503}}];renderPasswordRecovery();const f=document.querySelector('#password-recovery-form');f.password.value=f.confirmPassword.value='new-fixture-password';await updateRecoveredPassword({preventDefault(){},currentTarget:f});});eq(await p.evaluate(()=>calls.filter(c=>c.name==='update').length),1,'Password change never automatically repeats after network uncertainty');eq(await p.locator('#new-password').inputValue(),'new-fixture-password','Password save failure preserves input');ok(await p.getByRole('button',{name:'Save new password',exact:true}).isEnabled(),'Password save error releases button');await p.close();
  }
  {
   const p=await fresh();await p.evaluate(()=>{state.user={id:'rider'};state.session={user:state.user};window.pending=defer();queue.logout=[pending.promise,pending.promise];window.jobs=[signOutCurrentDevice(),signOutCurrentDevice()];});await p.evaluate(()=>settle());eq(await p.evaluate(()=>calls.filter(c=>c.name==='logout').length),1,'Repeated logout starts one revocation');eq(await p.evaluate(()=>calls.find(c=>c.name==='logout')?.options?.scope),'local','Sign out affects this device only');await p.evaluate(async()=>{pending.resolve({});await Promise.all(jobs);});await p.close();
  }
  {
   const p=await fresh();await p.evaluate(async()=>{state.user={id:'rider'};state.session={user:state.user};window.pushEnabled=true;window.pending=defer();queue.pushDelete=[pending.promise];timeoutOverrides['Notification sign-out cleanup']=30;Object.defineProperty(navigator,'serviceWorker',{value:{getRegistration:async()=>({pushManager:{getSubscription:async()=>({endpoint:'https://push.example.test/test',unsubscribe:async()=>{calls.push({name:'unsubscribe'});}})}})}});await signOutCurrentDevice();});
   eq(await p.evaluate(()=>calls.filter(c=>c.name==='logout').length),1,'Hung push database cleanup cannot block sign out');eq(await p.evaluate(()=>calls.filter(c=>c.name==='unsubscribe').length),1,'Browser push subscription is removed even while remote cleanup hangs');eq(await p.evaluate(()=>state.signingOut),false,'Logout releases pending state');await p.close();
  }
  {
   const p=await fresh();await p.evaluate(()=>renderPasswordRecovery());await p.getByRole('button',{name:'Request a new reset link',exact:true}).click();eq(await p.locator('#forgot-password-form').count(),1,'Expired recovery has a direct way to request a new link');await p.close();
  }
  for(const role of ['athlete','parent']){
   const p=await fresh();await p.evaluate(async role=>{queue.signup=[{data:{ok:true}}];queue.password=[{data:{session:{user:{id:'new-'+role,email:'new@example.test'}}}}];renderAuth('signup');const f=document.querySelector('#auth-form');f.displayName.value='New '+role;f.email.value='new@example.test';f.password.value='fixture-password';f.role.value=role;await handleAuth({preventDefault(){},currentTarget:f},'signup');},role);
   eq(await p.evaluate(()=>calls.filter(c=>c.name==='signup').length),1,role+' signup invokes account function once');eq(await p.evaluate(()=>calls.find(c=>c.name==='signup').body.body.role),role,role+' signup retains permitted account type');eq(await p.evaluate(()=>state.user.id),'new-'+role,role+' successful signup opens authenticated account');await p.close();
  }
  {
   const p=await fresh();await p.evaluate(async()=>{window.pending=defer();queue.reset=[pending.promise];timeoutOverrides['Password reset']=25;renderForgotPassword('','rider@example.test');await requestPasswordReset({preventDefault(){},currentTarget:document.querySelector('#forgot-password-form')});});
   eq(await p.locator('#recovery-email').inputValue(),'rider@example.test','Timed out reset preserves email');ok(await p.getByRole('button',{name:'Send reset link',exact:true}).isEnabled(),'Timed out reset never leaves a stuck loading button');eq(await p.evaluate(()=>state.authPendingForm),null,'Timed out reset releases operation lock');await p.evaluate(async()=>{pending.resolve({});await settle();});ok((await p.locator('.auth-message').textContent()).includes('couldn’t reach'),'Late reset success cannot overwrite timeout recovery feedback');await p.close();
  }
  for(const width of [320,375,390]){
   const p=await fresh(width,844);await p.evaluate(()=>renderAuth());const box=await p.getByRole('button',{name:'Enter JKCREW',exact:true}).boundingBox();console.log('Sign-in button bottom at '+width+'px:',Math.round(box.y+box.height));ok(box.y+box.height<=844,'Sign in visible without scrolling on '+width+'px phone');eq(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No horizontal auth overflow at '+width+'px');eq(await p.locator('#email').getAttribute('inputmode'),'email','Email keyboard requested');ok(Number.parseFloat(await p.locator('#password').evaluate(e=>getComputedStyle(e).fontSize))>=16,'Inputs avoid iOS auto-zoom');await p.close();
  }
  if(failures.length){console.error(failures.join('\n'));throw new Error(failures.length+' of '+checks+' checks failed');}
  console.log('PASS: '+checks+' auth duplicate prevention, recoverable input, stale-response, logout and mobile layout checks.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
