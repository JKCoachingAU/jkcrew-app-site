// Actual HQ renderer/read scheduler with controlled synthetic service failures.
// No production requests, user accounts, identifiers, credentials or point writes.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const extract = name => { const a = source.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm')); assert(a >= 0, name); return source.slice(a, source.indexOf('\n}', a) + 2); };
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (actual, message) => { assert(actual, message); checks++; };
const flush = () => new Promise(resolve => setImmediate(resolve));
async function schedulerChecks() {
  const context = vm.createContext({ Date, Promise, Array, Set, Error, AbortController, setTimeout, clearTimeout });
  vm.runInContext(extract('withTimeout') + '\n' + extract('readCoachDashboardQueries'), context);
  let active = 0, maximum = 0, started = 0;
  const rows = await context.readCoachDashboardQueries(Array.from({ length: 18 }, (_, i) => () => new Promise(resolve => {
    active++; started++; maximum = Math.max(maximum, active);
    setTimeout(() => { active--; resolve({ data: i }); }, 5);
  })));
  eq(started, 18, 'Every overview read remains available');
  eq(maximum, 3, 'One HQ overview never occupies eighteen concurrent database slots');
  eq(Array.from(rows, row => row.data), Array.from({ length: 18 }, (_, i) => i), 'Bounded scheduling preserves result order');
  let timedStarted = 0, aborted = 0;
  const held = () => { timedStarted++; let signal; return { abortSignal(value) { signal = value; return this; }, then(resolve, reject) { signal.addEventListener('abort', () => { aborted++; reject(new Error('Aborted')); }); } }; };
  await assert.rejects(context.readCoachDashboardQueries(Array.from({ length: 18 }, () => held), { timeoutMs: 30 }), /timed out/); checks++;
  eq(timedStarted, 3, 'A stalled batch does not start its remaining fifteen reads');
  eq(aborted, 3, 'A timed-out batch aborts all active reads before a retry');
  let current = true, startedAfterLeave = 0;
  await assert.rejects(context.readCoachDashboardQueries(Array.from({ length: 18 }, () => () => { startedAfterLeave++; current = false; return { data: [] }; }), { isCurrent: () => current }), /no longer active/); checks++;
  eq(startedAfterLeave, 1, 'Navigation stops queued overview reads before they start');
}
async function coalescingChecks() {
  const calls=[], cache=new Map();
  const riders=Array.from({length:35},(_,n)=>({id:'synthetic-'+n,display_name:'Synthetic '+n,country_code:'AU'}));
  let heldLinks=null;
  const state={user:{id:'coach'},view:'command',sessionSetupVersion:1,inFlight:new Map(),coachRosterIds:new Set()};
  const context=vm.createContext({state,Date,Map,Set,Array,Promise,Error,PROFILE_SELECT:'id,display_name,country_code',withTimeout:p=>p,
    cacheGet:key=>cache.get(key),cacheSet:(key,value)=>{cache.set(key,value);return value},getCoachTeamScopeIds:async()=>['coach'],
    weekStartDateForCountry:()=> '2026-11-16',weekStartDate:()=> '2026-11-16',weekStartIso:()=> '2026-11-16',
    client:{rpc:async name=>{calls.push(name);return {data:[]}},from(table){
      const query={};for(const method of ['select','eq','in','gte','order','limit','not','is'])query[method]=()=>query;
      query.maybeSingle=()=>query;
      query.then=(resolve,reject)=>{
        calls.push(table);
        const data=table==='coach_athletes'?riders.map(r=>({athlete_id:r.id,group_name:'monday'})):table==='profiles'?riders:table==='coach_athlete_groups'?[]:table==='weekly_progress_notification_settings'?null:[];
        return (table==='coach_athletes'&&heldLinks?heldLinks:Promise.resolve()).then(()=>resolve({data}),reject);
      };return query;
    }},
  });
  vm.runInContext(['readCoachDashboardQueries','getCoachRoster','getCoachCommandData'].map(extract).join('\n'),context);
  const [first,second]=await Promise.all([context.getCoachRoster({summary:true}),context.getCoachRoster({summary:true})]);
  eq(first.length,35,'Coalesced roster retains all35 authorized synthetic riders');
  eq(first,second,'Parallel roster consumers receive the same result');
  eq(calls.filter(t=>t==='coach_athletes').length,1,'Parallel roster consumers share one link read');
  eq(calls.filter(t=>t==='profiles').length,1,'Parallel roster consumers share one profile read');
  calls.length=0;
  const [overview,duplicate]=await Promise.all([context.getCoachCommandData(first,{overview:true}),context.getCoachCommandData(first,{overview:true})]);
  eq(overview,duplicate,'Parallel overview consumers share one result');
  eq(calls.filter(t=>t==='coach_calendar_events').length,1,'Parallel overviews do not duplicate their query batch');
  eq(state.inFlight.size,0,'Successful roster and overview reads release their in-flight keys');
  cache.clear();calls.length=0;
  let release;heldLinks=new Promise(resolve=>{release=resolve});
  const old=context.getCoachRoster({summary:true});const rejected=assert.rejects(old,/account access changed/);
  await flush();state.user={id:'new-coach'};state.sessionSetupVersion++;state.coachRosterIds=new Set(['new-team-rider']);state.inFlight.clear();release();
  await rejected;checks++;
  eq([...state.coachRosterIds],['new-team-rider'],'A stale roster never replaces the next account authorization set');
  eq(calls.filter(t=>t==='profiles').length,0,'A stale link response starts no more private profile reads');
}

const fixture = `
  const state={user:{id:'coach'},profile:{role:'coach'},view:'command',sessionSetupVersion:1,inFlight:new Map()};
  window.events=[];window.calls={};window.gates={};window.queueDestroys=0;
  const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject};};
  for(const name of ['roster','operations','events','crowns','messages','ranking'])gates[name]=defer();
  const read=name=>{calls[name]=(calls[name]||0)+1;return gates[name].promise};
  window.riders=Array.from({length:35},(_,n)=>({id:'rider-'+n,display_name:'Synthetic Rider '+n,country_code:'AU'}));
  const getCoachRoster=()=>read('roster'),getCoachCommandData=()=>read('operations'),getAllParkKings=()=>read('crowns'),getSharedUpcomingEventData=()=>read('events'),getLeaderboard=()=>read('ranking');
  const readCoachDashboardQueries=async factories=>Promise.all(factories.map(fn=>fn()));
  const client={from(){return{select(){return this},eq(){return this},order(){return this},limit(){return read('messages').then(data=>({data}))}}}};
  const escapeHtml=value=>String(value??''),dateLabel=value=>value,weekStartIso=()=> '2026-11-16';
  const combinedCoachCalendarItems=()=>[],groupCoachCalendarItems=()=>[],highPriorityTasks=()=>[],leaderboardWithBenchmark=rows=>rows;
  const highPriorityTodoHtml=()=>'<p data-verified-tasks>Priority tasks loaded</p>';
  const commandAccordionSection=(id,title,meta,body)=>'<details id="'+id+'"><summary>'+title+'</summary>'+body+'</details>';
  const commandHubAccordion=(id,n,title,meta,summary,body)=>'<details id="'+id+'"><summary>'+title+'</summary>'+body+'</details>';
  const coachRunReviewQueueHtml=()=>'',coachListRequestsHtml=()=>'',coachTrickRequestsHtml=()=>'',coachEventRunPlansHtml=()=>'',coachCalendarForm=()=>'',weeklyNotificationControlsHtml=()=>'';
  const coachSharedEventsSummaryHtml=events=>'<p data-verified-events>'+events.length+' events loaded</p>';
  const commandParkKingsAccordionHtml=(rows,kings)=>'<details id="command-park-kings"><summary>Park Kings &amp; Queens</summary><p data-verified-crown>'+kings[0].display_name+'</p></details>';
  const commandLeaderboardPreviewHtml=rows=>'<button data-view="board">Verified leaderboard '+rows[0].weekly_points+'</button>';
  const mountLa28Countdown=(element,current)=>{element.textContent='LA28 countdown';return{destroy(){}}};
  const loadCommandUciLeaderboard=async()=>{};
  const cacheClear=()=>{},notify=message=>events.push(message),messageFrom=error=>error.message,setButtonBusy=()=>()=>{},refreshCommandParkKings=async()=>{};
  const saveCoachCalendarEvent=()=>{},sendCoachBroadcast=event=>event.preventDefault(),saveWeeklyNotificationSettings=()=>{},generateWeeklyNotificationPreviews=()=>{};
  const dismissCoachTask=()=>{},acceptTrickRequest=()=>{},declineTrickRequest=()=>{},setCoachProposalEditMode=()=>{},reviewRiderSheetProposal=()=>{},updateCoachProposalCounts=()=>{},renderCommandParkKingSelection=()=>{};
  const navigate=async name=>{state.view=name;document.querySelector('#view').innerHTML='<h1>New '+name+'</h1>'};
  window.JKCrewOtherThingsLanded={mountCoachQueue({element}){element.textContent='Review queue';return{destroy(){queueDestroys++}}}};
`;
async function browserChecks() {
  const browser = await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const errors=[];
  async function fresh() {
    const page = await browser.newPage({ viewport:{ width:390,height:844 } }); page.setDefaultTimeout(5000);
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*', route=>route.abort());
    await page.setContent('<main id="view"></main>');
    await page.addScriptTag({ content:fixture+'\n'+['commandMetricCard','coachBroadcastComposerHtml','renderCoachCommand'].map(extract).join('\n') });
    await page.evaluate(()=>renderCoachCommand()); return page;
  }
  try {
    const page=await fresh();
    ok(await page.getByRole('heading',{name:'Coach HQ'}).isVisible(),'HQ opens while roster and every optional service remain stalled');
    ok(await page.getByRole('button',{name:/Start Coaching/}).isEnabled(),'Coach can start training before the roster response');
    eq(await page.locator('[data-command-metrics] strong').allTextContents(),Array(6).fill('—'),'Unverified counters never invent zero values');
    eq(await page.evaluate(()=>calls),{roster:1},'Only the roster read starts on the first paint');
    await page.evaluate(()=>gates.roster.resolve(riders));
    await page.waitForFunction(()=>calls.operations===1);
    eq(await page.locator('[data-command-metrics] strong').first().textContent(),'35','The authorized 35-rider roster updates independently');
    eq(await page.evaluate(()=>calls.crowns||0),0,'Closed crown accordion makes no expensive all-park request');
    eq(await page.evaluate(()=>calls.messages||0),0,'Closed message composer makes no history request');
    await page.locator('[data-command-messages] > summary').click();
    await page.waitForFunction(()=>calls.messages===1);
    await page.locator('#coach-broadcast-message').fill('Keep this unsent draft');
    await page.evaluate(()=>{document.querySelector('.coach-broadcast-history').open=true;gates.messages.reject(new Error('History service unavailable'))});
    await page.locator('.coach-broadcast-history [data-retry-command-panel]').waitFor();
    eq(await page.locator('#coach-broadcast-message').inputValue(),'Keep this unsent draft','A failed history read cannot discard a message being composed');
    await page.evaluate(()=>{gates.messages=defer()});
    await page.locator('.coach-broadcast-history [data-retry-command-panel]').click();
    await page.waitForFunction(()=>calls.messages===2);
    await page.evaluate(()=>gates.messages.resolve([]));
    await page.waitForFunction(()=>document.querySelector('.coach-broadcast-history summary span').textContent==='0');
    await page.evaluate(()=>gates.operations.resolve({helpRequests:[{},{}],sheetProposals:[{}],eventRunPlans:[],battles:[],scheduleRows:[]}));
    await page.waitForSelector('[data-verified-tasks]');
    eq(await page.locator('#coach-broadcast-message').inputValue(),'Keep this unsent draft','Late overview rendering never replaces a message draft');
    eq(await page.locator('[data-command-metrics] strong').nth(1).textContent(),'2','Confirmed overview replaces only the matching counters');
    await page.waitForFunction(()=>calls.events===1);
    await page.evaluate(()=>gates.events.resolve({events:[],attendance:[]}));
    await page.waitForSelector('[data-verified-events]');
    eq(await page.locator('[data-command-metrics] strong').nth(4).textContent(),'0','Zero is displayed only after an authoritative empty response');
    await page.locator('#command-park-kings > summary').click();
    await page.waitForFunction(()=>calls.crowns===1);
    await page.evaluate(()=>gates.crowns.reject(new Error('Database statement timed out')));
    await page.locator('[data-command-crown-content] [data-retry-command-panel]').waitFor();
    ok(await page.getByRole('button',{name:/Start Coaching/}).isEnabled(),'A failed crown read cannot block training controls');
    eq(await page.locator('[data-command-crowns]').getByText('0 claimed',{exact:true}).count(),0,'A failed crown read is not presented as zero champions');
    await page.evaluate(()=>{gates.crowns=defer()});
    await page.locator('[data-command-crown-content] [data-retry-command-panel]').click();
    await page.waitForFunction(()=>calls.crowns===2);
    await page.evaluate(()=>gates.crowns.resolve([{display_name:'Verified champion',points:14}]));
    await page.waitForSelector('[data-verified-crown]');
    eq(await page.locator('[data-verified-crown]').textContent(),'Verified champion','A crown retry recovers in its own panel');
    eq(await page.locator('#coach-broadcast-message').inputValue(),'Keep this unsent draft','Panel retries preserve unrelated unsent input');
    await page.evaluate(()=>gates.ranking.resolve([{athlete_id:'rider-0',weekly_points:12}]));
    await page.locator('[data-command-leaderboard] button').click();
    eq(await page.locator('#view').textContent(),'New board','Late leaderboard navigation remains usable');
    await page.close();
    const failed=await fresh();
    await failed.evaluate(()=>gates.roster.reject(new Error('Profile service unavailable')));
    await failed.locator('[data-command-roster-status] [data-retry-command-panel]').waitFor();
    ok(await failed.getByRole('button',{name:/Start Coaching/}).isEnabled(),'A roster failure stays local and does not pin the full-screen loader');
    eq(await failed.locator('[data-command-metrics] strong').allTextContents(),Array(6).fill('—'),'A roster failure does not fabricate an empty team');
    await failed.evaluate(()=>{gates.roster=defer()});
    await failed.locator('[data-command-roster-status] [data-retry-command-panel]').click();
    await failed.waitForFunction(()=>calls.roster===2);
    await failed.evaluate(()=>gates.roster.resolve(riders));
    await failed.waitForFunction(()=>document.querySelector('[data-command-metrics] strong').textContent==='35');
    eq(await failed.evaluate(()=>calls.roster),2,'Retry makes one replacement roster request');
    await failed.evaluate(()=>{state.user={id:'another-coach'};state.sessionSetupVersion++;state.view='home';document.querySelector('#view').textContent='Other account';gates.operations.resolve({});gates.events.resolve({events:[],attendance:[]});gates.ranking.resolve([])});
    await failed.waitForTimeout(1800);
    eq(await failed.locator('#view').textContent(),'Other account','Late data and deferred work cannot overwrite another account');
    eq(await failed.evaluate(()=>calls.crowns||0),0,'Navigation does not start unopened crown work');
    await failed.close();
    eq(errors,[],'No rendering or unhandled promise errors');
  } finally { await browser.close(); }
}
(async()=>{await schedulerChecks();await coalescingChecks();await browserChecks();console.log('PASS: '+checks+' coach startup, 35-rider degraded-service, draft, retry, isolation and bounded-read checks.');})().catch(error=>{console.error(error);process.exitCode=1});
