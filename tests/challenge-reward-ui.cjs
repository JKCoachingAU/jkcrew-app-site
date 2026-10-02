// Actual rider Challenges renderer and realtime notification handler; synthetic data only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.JKCREW_PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..'),app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const extract=name=>{const start=app.search(new RegExp('^(?:async )?function '+name+'\\(','m'));assert(start>=0,name);const rest=app.slice(start);return rest.slice(0,rest.indexOf('\n}')+2);};
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH});let checks=0;
 const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.abort());
  await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><main id="view" class="content"></main>');await page.addStyleTag({content:fs.readFileSync(path.join(root,'styles.css'),'utf8')});
  await page.evaluate(()=>{
   window.state={user:{id:'rider'},profile:{role:'athlete'},view:'challenges',sessionSetupVersion:1,session:{access_token:'synthetic'}};
   window.challenge=null;window.celebrations=[];window.notices=[];window.realtimeHandlers=[];window.rpcCalls=[];
   window.client={rpc:async name=>{rpcCalls.push(name);if(name!=='get_my_weekly_challenge')throw Error('Unexpected RPC');return{data:structuredClone(challenge),error:null};},realtime:{setAuth:()=>{}},channel:()=>{const channel={on:(_event,filter,handler)=>{realtimeHandlers.push({filter,handler});return channel;},subscribe:()=>{}};return channel;}};
   window.getLeaderboard=window.getWeeklyRiderBattles=async()=>[];window.hydrateRiderBattleIdentities=v=>v;window.riderBattleRecord=()=>({wins:0,losses:0});
   window.escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
   window.categoryInfo={dialled:{label:'Dialled'},percentage:{label:'Percentage'}};window.battleFormatOptionsHtml=()=>'<option value="1">1v1</option>';
   window.requestWeeklyRiderBattle=window.updateRiderBattlePicker=window.respondWeeklyRiderBattle=window.forfeitWeeklyRiderBattle=window.showBattleRulesModal=()=>{};
   window.showAchievementCelebration=value=>celebrations.push(value);window.notify=value=>notices.push(value);
   window.riderFeaturesDisabled=window.riderFeatureAccessUnknown=()=>false;window.realtimeVisibleAthleteIds=async()=>['rider'];window.setupLiveRunDiscovery=()=>{};
   window.refreshNotificationCentre=window.refreshLiveRunInvites=()=>{};
  });
  await page.addScriptTag({content:['getMyWeeklyChallenge','renderChallenges','setupRealtimeSync','realtimeFilter'].map(extract).join('\n')});
  const render=async values=>{await page.evaluate(async values=>{challenge={id:'challenge',title:'Crew challenge',description:'Complete the target',category:'dialled',target_count:3,reward_points:5,progress:0,completed:false,new_award:false,...values};await renderChallenges();},values);return page.locator('.challenge-progress-copy strong').textContent();};
  eq(await render({progress:1}),'2 to go','Incomplete challenge does not claim a reward');
  eq(await render({progress:3}),'Target reached · reward not yet confirmed','Full progress alone never claims awarded points');
  eq(await render({progress:3,completed:true}),'Challenge complete · +5 pts','Authoritative completed reward uses configured five points');
  eq(await render({progress:3,completed:true,reward_points:10,completion_rule:'percentage_perfect',category:'percentage'}),'Challenge complete · +10 pts','Perfectionist confirmed reward uses ten points');
  eq(await render({progress:1,completed:true,reward_points:10}),'Challenge complete · +10 pts','Correction after earning never hides the saved completion');
  eq(await render({progress:3,completed:undefined}),'Target reached · reward not yet confirmed','Missing award confirmation never implies completion');
  eq(await page.evaluate(()=>celebrations.length),0,'Rendering status does not invent an award celebration');
  for(const width of [320,390,820]){await page.setViewportSize({width,height:844});eq(await page.locator('.challenge-progress-copy').evaluate(el=>{const box=el.getBoundingClientRect(),label=el.querySelector('strong').getBoundingClientRect(),percent=el.querySelector('span').getBoundingClientRect();return label.left>=box.left-1&&label.right<=percent.left&&percent.right<=box.right+1&&box.right<=innerWidth;}),true,'Pending reward label fits '+width+'px');}
  await page.evaluate(()=>setupRealtimeSync());
  for(const points of [5,10]){
   const title='+'+points+' leaderboard points';
   await page.evaluate(title=>{realtimeHandlers.find(h=>h.filter.table==='app_notifications').handler({new:{notification_type:'weekly_challenge_completed',title,body:'Your challenge reward is saved.',payload:{celebration:'weekly_challenge'}}});},title);
   eq(await page.evaluate(()=>celebrations.at(-1).title),title,'Realtime reward celebration retains the server title');eq(await page.evaluate(()=>notices.at(-1)),title,'Toast agrees with server reward');
  }
  await page.evaluate(()=>{realtimeHandlers.find(h=>h.filter.table==='app_notifications').handler({new:{title:'General update',payload:{}}});});eq(await page.evaluate(()=>celebrations.length),2,'Unrelated notifications cannot create challenge reward celebrations');
  eq(errors,[],'Actual renderer and notification handler have no browser errors');
  console.log('PASS: '+checks+' rider challenge reward confirmation, correction persistence, mobile layout and realtime five/ten-point notification checks.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
