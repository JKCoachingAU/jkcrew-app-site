const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const {chromium}=require(process.env.JKCREW_PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..'), app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const code=app.slice(app.indexOf('async function getMyProgressMilestones('),app.indexOf('async function renderAthleteHome('));
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH});
  const page=await browser.newPage({viewport:{width:390,height:844}}); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<body><main id="view" style="padding:16px"></main></body>');
  await page.addStyleTag({content:fs.readFileSync(path.join(root,'styles.css'),'utf8')});
  await page.addScriptTag({content:`
    const state={user:{id:'r'},profile:{role:'athlete',country_code:'AU'},view:'contests'};
    const escapeHtml=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
    const isCoachRole=role=>role==='coach'; const countryTimezones={AU:'Australia/Brisbane'};
    const dateForTimezone=(z,date=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:z}).format(date);
    const dateForCountryCode=()=>dateForTimezone('Australia/Brisbane'); const dateLabel=d=>'9 Sep';
    const notify=()=>{},cacheClear=()=>{},setSyncStatus=()=>{},messageFrom=e=>e.message;
    const setButtonBusy=b=>{b.disabled=true;return()=>b.disabled=false;};
    window.requests=[];window.run={id:'run',athlete_id:'r',coach_id:'c',created_by:'r',plan_type:'competition',title:'Qualifying',run_status:'planned',updated_at:'v1'};
    const client={rpc:async(name,args)=>{requests.push(args);run={...run,run_status:args.p_status,updated_at:'v2'};return {data:run};}};
    ${code}
    document.querySelector('#view').innerHTML=privateProgressMilestonesHtml({consistency:[{trick_name:'Manual <test>',landed:7,previous_best:4,started_at:'2026-01-01',completed_at:'2026-01-01',venue:'Park A'}],runs:[{...run,run_status:'ready_for_review'}]})+runReviewPanelHtml(run);
  `});
  assert(await page.getByText('Manual <test>',{exact:true}).isVisible());
  assert.equal(await page.getByText(/7\/10 today/).count(),0,'Old sets must not claim today');
  assert(await page.getByText('4/10',{exact:true}).isVisible());
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.getByRole('button',{name:'Ready for coach review',exact:true}).click();
  await page.getByText('Return to draft',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Mark reviewed',exact:true}).count(),0,'Riders cannot approve themselves');
  assert.equal(await page.evaluate(()=>requests[0].p_expected_updated_at),'v1');
  await page.evaluate(()=>{state.profile.role='coach';state.user.id='c';document.querySelector('[data-run-review-panel]').outerHTML=runReviewPanelHtml(run);});
  await page.getByRole('button',{name:'Mark reviewed',exact:true}).click();
  await page.getByText('✓ Coach reviewed',{exact:true}).waitFor();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(process.env.JKCREW_SCREENSHOT) await page.screenshot({path:process.env.JKCREW_SCREENSHOT,fullPage:true});
  assert.deepEqual(errors,[]);await browser.close();
  console.log('PASS: private mobile cards, escaped names, accurate day wording, no sideways overflow, rider submission, coach review and version-aware saves.');
})().catch(e=>{console.error(e);process.exit(1)});
