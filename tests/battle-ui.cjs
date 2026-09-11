const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.JKCREW_PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..'),app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const names=['battleContributionsHtml','battleTeamNumbers','battleFormatLabel','battleFormatOptionsHtml','parseBattleFormat','battlePrizePoints','battleTeamScore','battleParticipantFirstName','battleTeamHtml','weeklyBattleCardHtml','coachBattleTeamHtml','coachBattleCardHtml','riderHeadToHeadRecord','riderBattleRecord','riderBattleSelectionSize','updateRiderBattlePicker','requestWeeklyRiderBattle','coachBattleRiderSelect','showCoachBattleBuilder','renderChallenges'];
const code=names.map(name=>{const start=app.search(new RegExp('^(?:async )?function '+name+'\\(','m'));assert(start>=0,name);const rest=app.slice(start);return rest.slice(0,rest.indexOf('\n}')+2);}).join('\n');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH});
 const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<html data-theme="dark"><body><div id="app"><div class="app-shell rider-shell" style="display:block"><main id="view"></main></div></div></body></html>');
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
 await touch.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="app"><div class="app-shell coach-shell" style="display:block"><main id="view"></main></div></div></body>');
 await touch.addStyleTag({content:fs.readFileSync(path.join(root,'styles.css'),'utf8')});
 await touch.addScriptTag({content:harness.replace(/renderChallenges\(\);$/, '')});
 await touch.evaluate(()=>{state.profile.role='coach';for(let i=roster.length;i<20;i++)roster.push({id:'r'+i,athlete_id:'r'+i,display_name:'Test Rider '+i,weekly_points:i*2});});
 const cdp=await touch.context().newCDPSession(touch);
 for(const format of ['3v3','2v2v2','6v6v6']) {
   await touch.evaluate(()=>showCoachBattleBuilder(roster,async()=>{}));
   await touch.selectOption('#coach-battle-size',format);
   for(let i=0;i<14;i++) {
     const box=await touch.locator('[data-close-coach-builder]').boundingBox();
     if(box&&box.y>=0&&box.y+box.height<=667)break;
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
 // The maximum format uses 18 distinct riders, without changing the legacy
 // eight-rider cases above or issuing any real invitations.
 await page.evaluate(async()=>{
   for(let i=roster.length;i<20;i++)roster.push({id:'r'+i,athlete_id:'r'+i,display_name:'Test Rider '+i,weekly_points:i*2});
   state.profile.role='athlete';document.querySelector('.app-shell').className='app-shell rider-shell';
   await renderChallenges();
 });
 await page.click('#toggle-battle-rider-list');
 const riderFormats=await page.locator('#rider-battle-size option').allTextContents();
 for(const label of ['4v4','5v5','6v6','3v3v3','4v4v4','5v5v5','6v6v6'])assert(riderFormats.includes(label),'Rider format '+label+' is offered');
 await page.selectOption('#rider-battle-size',{label:'6v6v6'});
 const maxRiderTeams=[['teammateIds',Array.from({length:5},(_,i)=>'r'+(i+1))],['opponentIds',Array.from({length:6},(_,i)=>'r'+(i+6))],['thirdTeamIds',Array.from({length:6},(_,i)=>'r'+(i+12))]];
 for(const [name,ids] of maxRiderTeams)for(const id of ids)await page.check('[name='+name+'][value='+id+']');
 assert(await page.locator('#send-rider-battle').isEnabled(),'All 18 rider seats can be filled');
 const beforeDuplicate=await page.evaluate(()=>requests.length);
 await page.evaluate(async()=>{
   const form=document.querySelector('#battle-request-form');
   form.querySelector('[name=thirdTeamIds][value=r12]').checked=false;
   const duplicate=form.querySelector('[name=thirdTeamIds][value=r1]');duplicate.disabled=false;duplicate.checked=true;
   await requestWeeklyRiderBattle({preventDefault(){},currentTarget:form});
 });
 assert.equal(await page.evaluate(()=>requests.length),beforeDuplicate,'A duplicate rider cannot submit an 18-seat request');
 assert.equal(await page.evaluate(()=>notices.at(-1)),'Each rider can only appear once.');
 await page.evaluate(()=>{
   document.querySelector('[name=thirdTeamIds][value=r1]').checked=false;
   document.querySelector('[name=thirdTeamIds][value=r12]').checked=true;updateRiderBattlePicker();
 });
 await page.click('#send-rider-battle');
 assert.deepEqual((await page.evaluate(()=>requests.at(-1))).args,{p_team_one:['r0','r1','r2','r3','r4','r5'],p_team_two:['r6','r7','r8','r9','r10','r11'],p_team_three:['r12','r13','r14','r15','r16','r17'],p_duration_days:7,p_reward_points:5});
 await page.click('#toggle-battle-rider-list');
 const beforeInvalid=await page.evaluate(()=>requests.length);
 await page.evaluate(async()=>{
   const select=document.querySelector('#rider-battle-size');select.add(new Option('Invalid','7v7v7'));select.value='7v7v7';
   await requestWeeklyRiderBattle({preventDefault(){},currentTarget:document.querySelector('#battle-request-form')});
 });
 assert.equal(await page.evaluate(()=>requests.length),beforeInvalid,'Out-of-range rider format does not send a request');
 assert.equal(await page.evaluate(()=>notices.at(-1)),'Choose teams of one to six riders.');
 await page.evaluate(()=>renderChallenges());await page.click('#toggle-battle-rider-list');
 for(const id of ['r1','r2','r3','r4','r5'])await page.check('[name=teammateIds][value='+id+']');
 assert.equal(await page.locator('#rider-battle-size option:checked').textContent(),'6v6','Picking five teammates grows a two-sided battle to six per side');
 for(const id of ['r6','r7','r8','r9','r10','r11'])await page.check('[name=opponentIds][value='+id+']');
 assert(await page.locator('#send-rider-battle').isEnabled());await page.click('#send-rider-battle');
 assert.deepEqual((await page.evaluate(()=>requests.at(-1))).args,{p_team_one:['r0','r1','r2','r3','r4','r5'],p_team_two:['r6','r7','r8','r9','r10','r11'],p_team_three:[],p_duration_days:7,p_reward_points:5});
 await page.evaluate(()=>{state.profile.role='coach';document.querySelector('.app-shell').className='app-shell coach-shell';showCoachBattleBuilder(roster,async()=>{});});
 const coachFormats=await page.locator('#coach-battle-size option').allTextContents();
 for(const label of ['4v4','5v5','6v6','3v3v3','4v4v4','5v5v5','6v6v6'])assert(coachFormats.includes(label),'Coach format '+label+' is offered');
 await page.selectOption('#coach-battle-size',{label:'6v6v6'});
 assert.equal(await page.locator('#coach-battle-builder-form select[name$=Rider]:enabled').count(),18);
 for(const [team,offset] of [['One',0],['Two',6],['Three',12]])for(let i=0;i<6;i++)await page.locator('[name=team'+team+'Rider]').nth(i).selectOption('r'+(offset+i));
 assert.equal(await page.locator('#coach-battle-selection-status').textContent(),'18 of 18 riders selected');
 const coachBeforeDuplicate=await page.evaluate(()=>requests.length);
 await page.locator('[name=teamThreeRider]').first().selectOption('r0');
 await page.locator('#coach-battle-builder-form button[type=submit]').click();
 assert.equal(await page.evaluate(()=>requests.length),coachBeforeDuplicate);
 assert.equal(await page.evaluate(()=>notices.at(-1)),'Each rider can only appear once.');
 await page.locator('[name=teamThreeRider]').first().selectOption('r12');
 for(const [format,seats] of [['4v4',8],['5v5',10],['6v6',12],['3v3v3',9],['4v4v4',12],['5v5v5',15],['6v6v6',18]]){
   await page.selectOption('#coach-battle-size',{label:format});
   assert.equal(await page.locator('#coach-battle-builder-form select[name$=Rider]:enabled').count(),seats,'Only active seats stay enabled for '+format);
   assert.equal(await page.locator('#coach-battle-builder-form').evaluate(form=>[...new FormData(form).entries()].filter(([name])=>name.endsWith('Rider')).length),seats,'Hidden values are excluded from '+format+' submission');
   assert.equal(await page.locator('#coach-battle-selection-status').textContent(),seats+' of '+seats+' riders selected');
 }
 for(const width of [320,390,1024]){
   await page.setViewportSize({width,height:844});
   const bounds=await page.locator('#coach-battle-builder-modal').evaluate(modal=>({scroll:modal.scrollWidth,width:modal.clientWidth,page:document.documentElement.scrollWidth,viewport:innerWidth}));
   assert(bounds.scroll<=bounds.width+1&&bounds.page<=bounds.viewport+1,'18-seat form fits '+width+'px: '+JSON.stringify(bounds));
 }
 await page.locator('#coach-battle-builder-form button[type=submit]').click();
 assert.deepEqual((await page.evaluate(()=>requests.at(-1))).args,{p_team_one:['r0','r1','r2','r3','r4','r5'],p_team_two:['r6','r7','r8','r9','r10','r11'],p_team_three:['r12','r13','r14','r15','r16','r17'],p_duration_days:7,p_reward_points:5});
 await page.evaluate(()=>showCoachBattleBuilder(roster,async()=>{}));
 const coachBeforeInvalid=await page.evaluate(()=>requests.length);
 await page.evaluate(()=>{
   const select=document.querySelector('#coach-battle-size');select.add(new Option('Invalid','7v7v7'));select.value='7v7v7';
   document.querySelector('#coach-battle-builder-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
 });
 assert.equal(await page.evaluate(()=>requests.length),coachBeforeInvalid,'Out-of-range coach format does not send a request');
 assert.equal(await page.evaluate(()=>notices.at(-1)),'Choose teams of one to six riders.');
 await page.locator('[data-close-coach-builder]').click();
 for(const width of [320,390,1024]){
 await page.setViewportSize({width,height:844});
 await page.evaluate(()=>{window.battle={id:'test',status:'accepted',battle_size:2,team_count:3,reward_points:5,participants:roster.slice(0,6).map((r,i)=>({...r,athlete_id:r.id,team_number:Math.floor(i/2)+1,battle_points:i+1,response:'accepted'}))};document.querySelector('#view').innerHTML=weeklyBattleCardHtml(battle)+coachBattleCardHtml(battle);});
 assert.equal(await page.locator('.battle-team-versus .battle-team').count(),3);
 assert((await page.locator('.coach-battle-summary-matchup').innerText()).includes('Test Rider 5'));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
 }
 assert.equal(await page.evaluate(()=>battlePrizePoints(battle)),10);
 // Long six-person teams must stay readable even when a tablet sidebar leaves
 // only 650px of content. Check avatars against their own team (cards clip).
 for(const theme of ['dark','light'])for(const width of [320,390,1024]){
   await page.setViewportSize({width,height:844});
   await page.evaluate(({theme,width})=>{
     document.documentElement.dataset.theme=theme;
     const view=document.querySelector('#view');view.style.width='100%';view.style.maxWidth=width===1024?'650px':'100%';
     window.largeBattle={id:'large-test',status:'accepted',battle_size:6,team_count:3,reward_points:5,participants:roster.slice(0,18).map((r,i)=>({...r,display_name:'Rider '+i+' Longer-Surname',athlete_id:r.id,team_number:Math.floor(i/6)+1,battle_points:i+1,response:'accepted'}))};
     view.innerHTML=weeklyBattleCardHtml(largeBattle)+'<div class="coach-challenges-page">'+coachBattleCardHtml(largeBattle)+'</div>';
     view.querySelector('details.coach-battle-view-card').open=true;
   },{theme,width});
   assert.equal(await page.locator('.battle-team-avatars[data-team-size="6"] .avatar').count(),36);
   const clipped=await page.locator('.battle-team, .coach-battle-team').evaluateAll(teams=>teams.flatMap(team=>{
     const parent=team.getBoundingClientRect();
     return [...team.querySelectorAll('.avatar, :scope > strong')].flatMap(element=>{
       const child=element.getBoundingClientRect();
       return child.left<parent.left-1||child.right>parent.right+1||element.scrollWidth>element.clientWidth+1?[{team:team.className,element:element.className||element.tagName,left:child.left,right:child.right,parentLeft:parent.left,parentRight:parent.right,scroll:element.scrollWidth,width:element.clientWidth}]:[];
     });
   }));
   assert.deepEqual(clipped,[],theme+' '+width+'px: every rider avatar and team name fits its own team');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   if(theme==='light'){
     const contrasts=await page.locator('.battle-card .battle-team > strong').evaluateAll(names=>{
       const rgba=value=>value.match(/[\d.]+/g).map(Number);
       const luminance=channels=>channels.slice(0,3).map(channel=>{const value=channel/255;return value<=0.04045?value/12.92:((value+0.055)/1.055)**2.4;}).reduce((sum,value,index)=>sum+value*[0.2126,0.7152,0.0722][index],0);
       return names.map(name=>{
         const text=rgba(getComputedStyle(name).color),surface=rgba(getComputedStyle(name.parentElement).backgroundColor),alpha=surface[3]??1;
         // White behind a translucent dark tile is the lightest possible
         // backdrop, and therefore the strictest case for its light text.
         const background=surface.slice(0,3).map(channel=>channel*alpha+255*(1-alpha));
         const values=[luminance(text),luminance(background)].sort((a,b)=>b-a);
         return (values[0]+0.05)/(values[1]+0.05);
       });
     });
     assert(contrasts.every(ratio=>ratio>=4.5),'Light-mode rider team names retain readable contrast: '+contrasts.join(', '));
   }
   if(process.env.JKCREW_QA_SCREENSHOTS)await page.screenshot({path:path.join(process.env.JKCREW_QA_SCREENSHOTS,'jkcrew-6v6v6-'+theme+'-'+width+'.png'),fullPage:true});
 }
 // Losing to a third side must not count as losing to the other losing side.
 assert.deepEqual(await page.evaluate(()=>riderHeadToHeadRecord([{participants:[{athlete_id:'r0',team_number:1,is_winner:false},{athlete_id:'r1',team_number:2,is_winner:false},{athlete_id:'r2',team_number:3,is_winner:true}]}],'r1')),{wins:0,losses:0});
 assert.deepEqual(errors,[]);console.log('PASS: rider and coach formats through 6v6v6, exact 18-rider requests, duplicate/range checks, hidden-seat exclusion, full-shell touch scrolling, mobile/tablet layout and head-to-head records.');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
