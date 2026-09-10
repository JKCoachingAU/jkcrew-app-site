const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm');
const {chromium}=require(process.env.JKCREW_PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..'),app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const extract=name=>{const start=app.search(new RegExp('^(?:async )?function '+name+'\\(','m'));assert(start>=0,name);const rest=app.slice(start);return rest.slice(0,rest.indexOf('\n}')+2);};
(async()=>{
 // Verify dashboard queries really omit heavy data and do not poison full-screen caches.
 const calls=[],cache=new Map(),ctx={state:{user:{id:'coach'}},PROFILE_SELECT:'id,avatar,tricktionary_meta',cacheGet:k=>cache.get(k),cacheSet:(k,v)=>{cache.set(k,v);return v},weekStartIso:()=> '2026-09-07',weekStartDate:()=> '2026-09-07',weekStartDateForCountry:()=> '2026-09-07',client:{rpc:async()=>({data:[]}),from:table=>{const record={table,select:''};calls.push(record);const q={};for(const key of ['select','eq','in','gte','order','limit','not','is'])q[key]=(...args)=>{if(key==='select')record.select=args[0];return q};q.maybeSingle=()=>Promise.resolve({data:null});q.then=(ok,fail)=>Promise.resolve({data:table==='coach_athletes'?[{athlete_id:'rider',group_name:'tuesday'}]:table==='profiles'?[{id:'rider',display_name:'Rider',country_code:'AU'}]:[]}).then(ok,fail);return q;}}};
 vm.createContext(ctx);vm.runInContext(['getCoachRoster','getCoachCommandData'].map(extract).join('\n'),ctx);
 const roster=await ctx.getCoachRoster({summary:true});assert.equal(roster[0].groupName,'tuesday');assert(!calls.some(c=>c.table==='training_sessions'));assert(!calls.find(c=>c.table==='profiles').select.includes('avatar'));
 calls.length=0;await ctx.getCoachCommandData(roster,{overview:true});for(const table of ['training_sessions','assignment_attempts','assignment_point_awards','attendance_sessions'])assert(!calls.some(c=>c.table===table),table+' deferred from HQ');
 calls.length=0;await ctx.getCoachRoster();assert(calls.some(c=>c.table==='profiles'&&c.select.includes('avatar')));assert(calls.some(c=>c.table==='training_sessions'));
 calls.length=0;await ctx.getCoachCommandData(roster);for(const table of ['training_sessions','assignment_attempts','assignment_point_awards','attendance_sessions'])assert(calls.some(c=>c.table===table),table+' still available for detailed screens and summaries');
 const browser=await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH});const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<main id="view"></main>');
 // Run the actual HQ renderer with the ranking response held indefinitely.
 await page.addScriptTag({content:`
 const state={user:{id:'coach'},profile:{role:'coach'},view:'command'};window.events=[];
 const getCoachRoster=async options=>{events.push('roster');return [{id:'rider',display_name:'Rider'}]};
 const getCoachCommandData=async (roster,options)=>{events.push('command');return {}};
 let resolveRanking,rejectRanking;const getLeaderboard=()=>new Promise((resolve,reject)=>{resolveRanking=resolve;rejectRanking=reject});
 const getAllParkKings=async()=>[],getSharedUpcomingEventData=async()=>({events:[],attendance:[]});
 const client={from:()=>({select(){return this},eq(){return this},order(){return this},limit(){return Promise.resolve({data:[]})}})};
 const withTimeout=async p=>p,weekStartIso=()=>'',combinedCoachCalendarItems=()=>[],groupCoachCalendarItems=()=>[],highPriorityTasks=()=>[],leaderboardWithBenchmark=rows=>rows;
 const commandLeaderboardPreviewHtml=()=>'<button data-view="board">View Full Leaderboard</button><button data-public-athlete="rider">Rider</button>';
 const navigate=async view=>{state.view=view;document.querySelector('#view').innerHTML='<h1>'+view+'</h1>'};
 const commandAccordionSection=()=>'',coachRunReviewQueueHtml=()=>'',coachListRequestsHtml=()=>'',coachTrickRequestsHtml=()=>'',coachEventRunPlansHtml=()=>'',coachCalendarForm=()=>'',weeklyNotificationControlsHtml=()=>'',commandMetricCard=()=>'',highPriorityTodoHtml=()=>'',coachBroadcastComposerHtml=()=>'',coachSharedEventsSummaryHtml=()=>'',commandParkKingsAccordionHtml=()=>'',commandHubAccordion=()=>'';
 ${[...extract('renderCoachCommand').matchAll(/addEventListener\("[^"]+", (\w+)\)/g)].map(m=>m[1]).filter((n,i,a)=>a.indexOf(n)===i).map(n=>'const '+n+'=()=>{};').join('\n')}
 ${extract('renderCoachCommand')}
 window.start=async()=>{await renderCoachCommand();window.ready=true;};start();
 `});
 await page.waitForFunction(()=>window.ready);assert(await page.getByRole('heading',{name:'Coach HQ'}).isVisible());assert(await page.getByRole('button',{name:/Start Coaching/}).isVisible());assert(await page.locator('[data-command-leaderboard]').isVisible());
 await page.evaluate(()=>resolveRanking([]));await page.getByRole('button',{name:'View Full Leaderboard'}).click();assert.equal(await page.evaluate(()=>state.view),'board','Deferred leaderboard controls bind after arrival');
 // Late rankings cannot overwrite another tab or another account.
 await page.evaluate(async()=>{state.view='command';await renderCoachCommand();await navigate('contests');resolveRanking([]);});assert.equal(await page.locator('#view').innerText(),'contests');
 await page.evaluate(async()=>{state.view='command';await renderCoachCommand();state.user.id='other';document.querySelector('#view').textContent='Other account';resolveRanking([]);});assert.equal(await page.locator('#view').innerText(),'Other account');
 assert.deepEqual(errors,[]);await browser.close();
 console.log('PASS: HQ skips roster photos and five training/history requests; full data caches remain separate; dashboard becomes usable with rankings stalled; deferred ranking controls and stale-account/tab protection work.');
})().catch(e=>{console.error(e);process.exit(1)});
