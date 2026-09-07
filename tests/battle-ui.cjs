const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.JKCREW_PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..'),app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const names=['battleTeamNumbers','battleFormatLabel','battleFormatOptionsHtml','parseBattleFormat','battlePrizePoints','battleTeamScore','battleParticipantFirstName','battleTeamHtml','weeklyBattleCardHtml','coachBattleTeamHtml','coachBattleCardHtml','riderHeadToHeadRecord','riderBattleRecord','riderBattleSelectionSize','updateRiderBattlePicker','requestWeeklyRiderBattle','coachBattleRiderSelect','showCoachBattleBuilder','renderChallenges'];
const code=names.map(name=>{const start=app.search(new RegExp('^(?:async )?function '+name+'\\(','m'));assert(start>=0,name);const rest=app.slice(start);return rest.slice(0,rest.indexOf('\n}')+2);}).join('\n');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH});
 const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<html data-theme="dark"><body><div id="view"></div></body></html>');
 await page.addStyleTag({content:fs.readFileSync(path.join(root,'styles.css'),'utf8')});
 const harness=`
 const state={user:{id:'r0'},profile:{role:'athlete'}};window.requests=[];window.notices=[];
 const roster=Array.from({length:8},(_,i)=>({id:'r'+i,athlete_id:'r'+i,display_name:'Test Rider '+i,weekly_points:i*2}));
 const client={rpc:async(name,args)=>{window.requests.push({name,args});return {};}};
 const getLeaderboard=async()=>roster,getWeeklyRiderBattles=async()=>[],getMyWeeklyChallenge=async()=>null;
 const hydrateRiderBattleIdentities=b=>b,categoryInfo={},notify=(message)=>window.notices.push(message),messageFrom=e=>e.message;
 const avatarHtml=p=>'<span class="avatar">'+p.display_name.slice(-1)+'</span>',escapeHtml=s=>String(s).replaceAll('<','&lt;').replaceAll('"','&quot;');
 const dateLabel=s=>s||'',setButtonBusy=button=>{button.disabled=true;return()=>button.disabled=false;},navigate=()=>{},showBattleRulesModal=()=>{},showAchievementCelebration=()=>{},respondWeeklyRiderBattle=()=>{},forfeitWeeklyRiderBattle=()=>{},renderCoachBattleViewer=()=>{};
 ${code}
 renderChallenges();`;
 await page.addScriptTag({content:harness});
 await page.click('#toggle-battle-rider-list');
 await page.selectOption('#rider-battle-size','1v1v1');
 assert.equal(await page.locator('#rider-battle-third-team').isVisible(),true);
 assert.equal(await page.locator('[name=teammateIds]:disabled').count(),7);
 await page.check('[name=opponentIds][value=r1]');assert.equal(await page.locator('[name=thirdTeamIds][value=r1]').isDisabled(),true);
 await page.check('[name=thirdTeamIds][value=r2]');
 await page.click('#send-rider-battle');
 assert.deepEqual(await page.evaluate(()=>requests.at(-1)),{name:'request_rider_battle_v3',args:{p_team_one:['r0'],p_team_two:['r1'],p_team_three:['r2'],p_duration_days:7,p_reward_points:5}});
 await page.click('#toggle-battle-rider-list');await page.selectOption('#rider-battle-size','2v2v2');
 for(const [name,ids] of [['teammateIds',['r1']],['opponentIds',['r2','r3']],['thirdTeamIds',['r4','r5']]])for(const id of ids)await page.check('[name='+name+'][value='+id+']');
 assert.equal(await page.locator('#send-rider-battle').isEnabled(),true);await page.click('#send-rider-battle');
 assert.deepEqual((await page.evaluate(()=>requests.at(-1))).args.p_team_three,['r4','r5']);
 // Real touch gestures on the backdrop must scroll long forms, including beside the card.
 const touch=await browser.newPage({viewport:{width:390,height:667},isMobile:true,hasTouch:true});
 await touch.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><body></body>');
 await touch.addStyleTag({content:fs.readFileSync(path.join(root,'styles.css'),'utf8')});
 await touch.addScriptTag({content:harness.replace(/renderChallenges\(\);$/, '')});
 const cdp=await touch.context().newCDPSession(touch);
 for(const format of ['3v3','2v2v2']) {
   await touch.evaluate(()=>showCoachBattleBuilder(roster,async()=>{}));
   await touch.selectOption('#coach-battle-size',format);
   for(let i=0;i<5;i++) {
     await cdp.send('Input.synthesizeScrollGesture',{x:4,y:530,yDistance:-420,speed:850,gestureSourceType:'touch'});
   }
   assert(await touch.locator('#coach-battle-builder-modal').evaluate(e=>e.scrollTop>100),'Touch swipes beside the battle card scroll the form');
   const cancel=touch.locator('[data-close-coach-builder]');
   const box=await cancel.boundingBox();assert(box.y>=0&&box.y+box.height<=667,'Cancel reachable by swiping');
   await cancel.click();assert.equal(await touch.locator('#coach-battle-builder-modal').count(),0);
 }
 await touch.close();
 await page.evaluate(()=>showCoachBattleBuilder(roster,async()=>{}));await page.selectOption('#coach-battle-size','2v2v2');
 for(const [team,ids] of [['One',['r0','r1']],['Two',['r2','r3']],['Three',['r4','r5']]])for(let i=0;i<ids.length;i++)await page.locator('[name=team'+team+'Rider]').nth(i).selectOption(ids[i]);
 assert.equal(await page.locator('#coach-battle-builder-form select:not([disabled])').count(),8);
 await page.locator('#coach-battle-builder-form button[type=submit]').click();
 assert.deepEqual((await page.evaluate(()=>requests.at(-1))).args.p_team_one,['r0','r1']);assert.deepEqual((await page.evaluate(()=>requests.at(-1))).args.p_team_three,['r4','r5']);
 await page.evaluate(()=>showCoachBattleBuilder(roster,async()=>{}));await page.selectOption('#coach-battle-size','1v1v1');await page.selectOption('[name=teamOneRider]:not([disabled])','r0');await page.selectOption('[name=teamTwoRider]:not([disabled])','r1');await page.selectOption('[name=teamThreeRider]:not([disabled])','r0');await page.locator('#coach-battle-builder-form button[type=submit]').click();assert.equal(await page.evaluate(()=>notices.at(-1)),'Each rider can only appear once.');
 await page.locator('[data-close-coach-builder]').click();
 for(const width of [390,1024]){
 await page.setViewportSize({width,height:844});
 await page.evaluate(()=>{window.battle={id:'test',status:'accepted',battle_size:2,team_count:3,reward_points:5,participants:roster.slice(0,6).map((r,i)=>({...r,athlete_id:r.id,team_number:Math.floor(i/2)+1,battle_points:i+1,response:'accepted'}))};document.querySelector('#view').innerHTML=weeklyBattleCardHtml(battle)+coachBattleCardHtml(battle);});
 assert.equal(await page.locator('.battle-team-versus .battle-team').count(),3);
 assert((await page.locator('.coach-battle-summary-matchup').innerText()).includes('Test Rider 5'));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
 }
 assert.equal(await page.evaluate(()=>battlePrizePoints(battle)),10);
 // Losing to a third side must not count as losing to the other losing side.
 assert.deepEqual(await page.evaluate(()=>riderHeadToHeadRecord([{participants:[{athlete_id:'r0',team_number:1,is_winner:false},{athlete_id:'r1',team_number:2,is_winner:false},{athlete_id:'r2',team_number:3,is_winner:true}]}],'r1')),{wins:0,losses:0});
 assert.deepEqual(errors,[]);console.log('PASS: rider and coach 1v1v1/2v2v2 selection, duplicate prevention, requests, all three teams, mobile/tablet layout and head-to-head records.');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
