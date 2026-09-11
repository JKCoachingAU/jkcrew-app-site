const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.JKCREW_PLAYWRIGHT_PATH||'playwright');
const screenshotDir=process.env.JKCREW_SCREENSHOT_DIR;
if(screenshotDir)fs.mkdirSync(screenshotDir,{recursive:true});
const capture=async(page,name)=>{if(screenshotDir)await page.screenshot({path:path.join(screenshotDir,name+'.png'),animations:'disabled'});};
const root=path.resolve(__dirname,'..'),app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const names=['battleContributionsHtml','battleTeamNumbers','battleFormatLabel','battleFormatOptionsHtml','parseBattleFormat','battlePrizePoints','battleTeamScore','battleParticipantFirstName','battleTeamHtml','weeklyBattleCardHtml','coachBattleTeamHtml','coachBattleCardHtml','riderHeadToHeadRecord','riderBattleRecord','riderBattleSelectionSize','updateRiderBattlePicker','requestWeeklyRiderBattle','coachBattleRiderSelect','showCoachBattleBuilder','renderChallenges'];
const extracted=names.map(name=>{const start=app.search(new RegExp('^(?:async )?function '+name+'\\(','m'));assert(start>=0,name);const rest=app.slice(start);return rest.slice(0,rest.indexOf('\n}')+2);}).join('\n');
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>route.abort());
    await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><html data-theme="dark"><body><div id="app"><div class="app-shell rider-shell" style="display:block"><main id="view"></main></div></div></body></html>');
    for(const file of ['styles.css','battle-rematches.css'])await page.addStyleTag({content:fs.readFileSync(path.join(root,file),'utf8')});
    await page.addScriptTag({content:fs.readFileSync(path.join(root,'battle-rematches.js'),'utf8')});
    await page.addScriptTag({content:`
      const state={user:{id:'r12'},profile:{role:'athlete'}};
      window.requests=[];window.notices=[];window.optionsReads=0;window.missing=[];window.holdOptions=false;
      const roster=Array.from({length:20},(_,i)=>({id:'r'+i,athlete_id:'r'+i,display_name:'Test Rider '+i,weekly_points:i*2,recent_training_points:20+i,active_battle_count:0}));
      window.battles=[{id:'old-battle',status:'completed',battle_size:6,team_count:3,duration_days:4,reward_points:7,participants:roster.slice(0,18).map((r,i)=>({...r,team_number:Math.floor(i/6)+1,is_winner:i<6,response:'accepted',points_delta:i<6?2:-1}))}];
      const client={rpc:async(name,args)=>{
        if(name==='get_battle_match_options'){optionsReads++;if(holdOptions){holdOptions=false;await new Promise(resolve=>window.releaseOptions=resolve);}return {data:{riders:roster.filter(r=>!missing.includes(r.id))}};}
        requests.push({name,args});return {};
      }};
      const getLeaderboard=async()=>roster,getWeeklyRiderBattles=async()=>battles,getMyWeeklyChallenge=async()=>null;
      const hydrateRiderBattleIdentities=b=>b,categoryInfo={},notify=(message)=>notices.push(message),messageFrom=e=>e.message;
      const avatarHtml=p=>'<span class="avatar">'+p.display_name.slice(-1)+'</span>',escapeHtml=s=>String(s??'').replaceAll('<','&lt;').replaceAll('"','&quot;');
      const dateLabel=s=>s||'',setButtonBusy=button=>{const text=button.textContent;button.disabled=true;return()=>{button.disabled=false;button.textContent=text;};},navigate=()=>{},showBattleRulesModal=()=>{},showAchievementCelebration=()=>{},respondWeeklyRiderBattle=()=>{},forfeitWeeklyRiderBattle=()=>{},renderCoachBattleViewer=()=>{};
      ${extracted}
      function coachPage(){state.user.id='coach';state.profile.role='coach';document.querySelector('.app-shell').className='app-shell coach-shell';const view=document.querySelector('#view');view.innerHTML=coachBattleCardHtml(battles[0]);JKCrewBattleRematches.bindCoach({view,battles,viewerId:state.user.id,currentViewer:()=>state.user.id,client,notify,messageFrom,openBuilder:(available,draft)=>showCoachBattleBuilder(available,async()=>{},draft)});}
      renderChallenges();
    `});
    assert.equal(await page.locator('[data-rematch-battle]').count(),1);
    assert.equal(await page.evaluate(()=>optionsReads),0,'No background options request');
    assert.equal(await page.evaluate(()=>requests.length),0,'No creation or acceptance on render');
    await page.click('[data-rematch-battle]');
    assert.equal(await page.inputValue('#rider-battle-size'),'6v6v6');assert.equal(await page.inputValue('#battle-duration'),'4');assert.equal(await page.inputValue('#battle-reward-points'),'7');
    const selected=await page.locator('#battle-request-form').evaluate(form=>Object.fromEntries(['teammateIds','opponentIds','thirdTeamIds'].map(name=>[name,[...form.querySelectorAll('[name='+name+']:checked')].map(el=>el.value)])));
    assert.deepEqual(selected,{teammateIds:['r13','r14','r15','r16','r17'],opponentIds:['r0','r1','r2','r3','r4','r5'],thirdTeamIds:['r6','r7','r8','r9','r10','r11']});
    assert.equal(await page.evaluate(()=>requests.length),0,'Rematch only opens review');
    assert(await page.locator('.battle-rematch-review').innerText().then(text=>text.includes('only when you tap Send')));
    await capture(page,'battle-rematch-phone');
    await page.evaluate(()=>roster[0].active_battle_count=3);await page.click('#send-rider-battle');
    assert.equal(await page.evaluate(()=>requests.length),0);assert((await page.locator('.battle-rematch-review').innerText()).includes('3 active battles'));
    await page.evaluate(()=>{roster[0].active_battle_count=0;holdOptions=true;const form=document.querySelector('#battle-request-form');form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
    await page.waitForFunction(()=>Boolean(window.releaseOptions));await page.evaluate(()=>releaseOptions());await page.waitForFunction(()=>requests.length===1);
    assert.deepEqual((await page.evaluate(()=>requests[0])).args,{p_team_one:['r12','r13','r14','r15','r16','r17'],p_team_two:['r0','r1','r2','r3','r4','r5'],p_team_three:['r6','r7','r8','r9','r10','r11'],p_duration_days:4,p_reward_points:7});
    assert.equal(await page.evaluate(()=>requests.some(row=>row.name.includes('respond'))),false);
    await page.evaluate(()=>{requests=[];missing=['r0'];});await page.click('[data-rematch-battle]');
    assert((await page.locator('.battle-rematch-review').innerText()).includes('Test Rider 0 is unavailable'));
    await page.click('#send-rider-battle');assert.equal(await page.evaluate(()=>requests.length),0);
    await page.evaluate(()=>{missing=[];battles.push(...Array.from({length:3},(_,i)=>({id:'active'+i,status:'pending',battle_size:1,team_count:2,participants:[{...roster[12],team_number:1},{...roster[19],team_number:2}]})));});await page.evaluate(()=>renderChallenges());await page.click('[data-rematch-battle]');
    assert((await page.evaluate(()=>notices.at(-1))).includes('3 active battles'));
    await page.evaluate(()=>{battles=battles.slice(0,1);state.user.id='r0';roster[0].recent_training_points=20;roster[1].recent_training_points=19;});await page.evaluate(()=>renderChallenges());
    await page.click('.battle-suggest-trigger');assert((await page.locator('.battle-suggestion').innerText()).includes('Last 7 days'));
    await page.locator('.battle-suggestion button').click();assert.equal(await page.inputValue('#rider-battle-size'),'1');assert.equal(await page.evaluate(()=>requests.length),0);
    await page.evaluate(()=>coachPage());await page.locator('.coach-battle-view-card summary').first().click();await page.click('[data-rematch-battle]');
    assert.equal(await page.locator('#coach-battle-builder-form select[name$=Rider]:enabled').count(),18);
    await capture(page,'battle-rematch-coach-phone');
    assert.equal(await page.inputValue('#coach-battle-duration'),'4');assert.equal(await page.inputValue('#coach-battle-reward-points'),'7');
    for(const [team,offset] of [['One',0],['Two',6],['Three',12]])assert.deepEqual(await page.locator('[name=team'+team+'Rider]').evaluateAll(selects=>selects.map(select=>select.value)),Array.from({length:6},(_,i)=>'r'+(offset+i)));
    assert.equal(await page.evaluate(()=>requests.length),0);
    for(const width of [320,390,1024]){await page.setViewportSize({width,height:844});assert(await page.locator('#coach-battle-builder-modal').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Review fits viewport '+width);}
    await page.locator('#coach-battle-builder-form button[type=submit]').click();await page.waitForFunction(()=>requests.length===1);
    assert.equal((await page.evaluate(()=>requests[0])).args.p_team_three.length,6);
    await page.evaluate(()=>{requests=[];missing=['r0'];coachPage();});await page.locator('.coach-battle-view-card summary').first().click();await page.click('[data-rematch-battle]');
    assert((await page.locator('[name=teamOneRider]').first().locator('option:checked').innerText()).includes('unavailable'));
    await page.locator('#coach-battle-builder-form button[type=submit]').click();assert.equal(await page.evaluate(()=>requests.length),0);
    await page.locator('[name=teamOneRider]').first().selectOption('r19');await page.locator('#coach-battle-builder-form button[type=submit]').click();await page.waitForFunction(()=>requests.length===1);
    await page.evaluate(()=>{requests=[];missing=[];showCoachBattleBuilder(roster,async()=>{});});
    await page.selectOption('[name=teamOneRider]:enabled','r0');await page.locator('#coach-battle-builder-form .battle-suggest-trigger').click();
    assert((await page.locator('#coach-battle-builder-form .battle-suggestion').innerText()).includes('training points'));
    await page.locator('#coach-battle-builder-form .battle-suggestion button').click();assert.equal(await page.evaluate(()=>requests.length),0);
    assert.equal(await page.inputValue('[name=teamTwoRider]:enabled'),'r1');
    assert.deepEqual(errors,[]);
    console.log('PASS mobile/tablet rider and coach rematches, losing third-side rotation,18 seats, review/no autosend, changed eligibility, unavailable replacements, active limits, double-submit protection and factual suggestions. All requests isolated.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
