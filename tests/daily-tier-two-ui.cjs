const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.JKCREW_PLAYWRIGHT_PATH||'playwright');
const root=path.resolve(__dirname,'..');
const fixture=String.raw`
window.calls=[];window.changes=[];window.fail=false;window.hold=false;window.release=null;window.current=true;
window.round={unlocked:false,eligible:false,athlete_id:'rider',local_date:'2026-09-20',reset_at:new Date(Date.now()+60000).toISOString(),items:[],points:0,reward_points:4};
window.template={items:null,default_round:true};
window.items=[{id:'item1',trick_name:'Bunny hop',notes:'Controlled landing',landed:false},{id:'item2',trick_name:'Manual',notes:'Choose your distance',landed:false}];
window.client={async rpc(name,args){calls.push({name,args});if(hold)await new Promise(resolve=>release=resolve);if(fail)return {error:{message:'Connection lost. Please retry.'}};
if(name==='get_daily_tier_two_template')return {data:structuredClone(template)};
if(name==='set_daily_tier_two_template'){template={items:args.p_items,default_round:!args.p_items};return {data:structuredClone(template)};}
if(name==='unlock_daily_tier_two'&&round.eligible)Object.assign(round,{unlocked:true,source:'daily_round_two',items:structuredClone(items),completed_count:0,total_count:2,revealed_at:null});
let extra={};if(name==='claim_daily_tier_two_reveal'){extra.reveal_claimed=!round.revealed_at;round.revealed_at=round.revealed_at||new Date().toISOString();}
if(name==='record_daily_tier_two_trick'){round.items.find(i=>i.id===args.p_item_id).landed=args.p_landed;round.completed_count=round.items.filter(i=>i.landed).length;}
if(name==='complete_daily_tier_two'){extra.points_awarded=round.completed_at?0:4;round.completed_at=round.completed_at||new Date().toISOString();round.points=4;}
return {data:{...structuredClone(round),...extra}};}};
window.start=opts=>{window.control?.destroy();window.control=JKCrewDailyTierTwo.mount(document.querySelector('#tier'),{client,athleteId:'rider',canEdit:true,canReveal:true,isCurrent:()=>current,onChange:value=>changes.push(value),...opts});return control.ready;};
`;
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH});let checks=0;
 const ok=(v,m)=>{assert(v,m);checks++;},eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.abort());
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;padding:16px;background:#080e14;color:white;font-family:Arial,sans-serif"><div id="tier"></div><div id="editor"></div></body>');
  await page.addStyleTag({content:fs.readFileSync(path.join(root,'daily-tier-two.css'),'utf8')});await page.addScriptTag({content:fs.readFileSync(path.join(root,'daily-tier-two.js'),'utf8')});await page.addScriptTag({content:fixture});
  await page.evaluate(()=>start());eq(await page.locator('#tier').isHidden(),true,'No spoilers before eligibility');eq(await page.evaluate(()=>calls.some(c=>c.name==='unlock_daily_tier_two')),false);
  await page.evaluate(async()=>{round.eligible=true;await control.refresh();});ok(await page.getByRole('heading',{name:'Tier 2 Unlocked'}).isVisible());eq(await page.locator('input[type=checkbox]').count(),0,'Surprise stays closed until rider opens');
  await page.getByRole('button',{name:'Open Tier 2'}).click();await page.waitForFunction(()=>changes.some(c=>c.reveal_claimed));eq(await page.locator('input[type=checkbox]').count(),2);ok(await page.locator('.daily-tier-two--reveal').count());
  eq(await page.getByRole('button',{name:'Complete round · +4'}).isDisabled(),true);await page.evaluate(()=>control.refresh());eq(await page.locator('.daily-tier-two--reveal').count(),0,'Refresh never replays celebration');
  await page.locator('.daily-tier-two__trick').first().click();await page.waitForFunction(()=>control.getState().completed_count===1);eq(await page.getByRole('button',{name:'Complete round · +4'}).isDisabled(),true);eq(await page.evaluate(()=>control.getState().points),0);
  await page.locator('.daily-tier-two__trick').first().click();await page.waitForFunction(()=>control.getState().completed_count===0);eq(await page.locator('input[type=checkbox]').first().isChecked(),false,'Tap again corrects a tick');
  await page.locator('.daily-tier-two__trick').first().click();await page.waitForFunction(()=>control.getState().completed_count===1);await page.locator('.daily-tier-two__trick').nth(1).click();await page.waitForFunction(()=>control.getState().completed_count===2);
  await page.getByRole('button',{name:'Complete round · +4'}).click();await page.waitForFunction(()=>control.getState().points===4);ok(await page.getByRole('heading',{name:'Tier 2 complete'}).isVisible());eq(await page.locator('input:disabled').count(),2);
  await page.evaluate(()=>start());eq(await page.locator('.daily-tier-two--reveal').count(),0,'New device/mount uses saved reveal state');eq(await page.evaluate(()=>calls.filter(c=>c.name==='claim_daily_tier_two_reveal').length),1);
  await page.evaluate(async()=>{round.completed_at=null;round.points=0;round.revealed_at=null;round.items.forEach(i=>i.landed=false);round.completed_count=0;await start({canReveal:false});});eq(await page.getByRole('button',{name:'Open Tier 2'}).count(),0,'Coach sees checklist without consuming surprise');eq(await page.locator('input').count(),2);
  await page.evaluate(async()=>{round.scoring_paused=true;await control.refresh();});eq(await page.locator('input:disabled').count(),2);ok(await page.getByText('Scoring is paused. Contact your coach before continuing.').isVisible());
  await page.evaluate(async()=>{round.scoring_paused=false;fail=true;await control.refresh();});ok(await page.getByRole('alert').isVisible());await page.evaluate(()=>fail=false);await page.getByRole('button',{name:'Retry'}).click();await page.waitForFunction(()=>!document.querySelector('[role=alert]'));
  await page.evaluate(async()=>{control.destroy();round.unlocked=false;round.eligible=false;fail=true;await start({eligibleHint:true});});ok(await page.getByRole('alert').isVisible(),'Known qualifying finish gets retry on network failure');
  await page.evaluate(async()=>{fail=false;round.eligible=true;await start({timeoutMs:30});hold=true;window.pending=control.refresh();});await page.waitForTimeout(60);await page.evaluate(()=>pending);ok(await page.getByText('The connection is taking too long. Please retry.',{exact:false}).isVisible(),'Network request cannot hang the interface forever');
  await page.evaluate(()=>{hold=false;release?.();});
  // An old account/navigation request is never allowed to paint the new view.
  await page.evaluate(()=>{hold=true;window.pending=control.refresh();});await page.waitForFunction(()=>!!release);await page.evaluate(()=>{control.destroy();document.querySelector('#tier').textContent='New screen';hold=false;release();});await page.evaluate(()=>pending);eq(await page.locator('#tier').textContent(),'New screen');
  await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(async()=>{round.unlocked=true;round.revealed_at=null;await start();});await page.getByRole('button',{name:'Open Tier 2'}).click();await page.waitForFunction(()=>control.getState().revealed_at);eq(await page.locator('.daily-tier-two--reveal').count(),0,'Reduced motion has no animated reveal');
  for(const width of [320,390,820,1280]){await page.setViewportSize({width,height:900});ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`No horizontal scrolling at ${width}px`);}
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'no-preference'});
  if(process.env.JKCREW_SCREENSHOT_DIR){fs.mkdirSync(process.env.JKCREW_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.JKCREW_SCREENSHOT_DIR,'daily-tier-two-mobile.png'),fullPage:true});}
  await page.evaluate(async()=>{window.editor=JKCrewDailyTierTwo.mountEditor(document.querySelector('#editor'),{client,athleteId:'rider',isCurrent:()=>current});await editor.ready;});
  await page.locator('textarea').fill('Bunny hop | Soft landing\nManual');await page.getByRole('button',{name:'Save Tier 2'}).click();await page.waitForFunction(()=>template.items?.length===2);eq(await page.evaluate(()=>template.items[0]),{trick_name:'Bunny hop',notes:'Soft landing'});await page.getByRole('button',{name:'Use Daily list',exact:true}).click();await page.waitForFunction(()=>template.default_round);eq(await page.locator('textarea').inputValue(),'');
  await page.evaluate(()=>JKCrewDailyTierTwo.destroyAll());eq(await page.locator('#editor').textContent(),'');eq(await page.locator('#tier').textContent(),'');eq(errors,[],'No uncaught browser errors');
  console.log(`PASS: ${checks} mobile layout, hidden eligibility, reveal-once, coach, correction, completion, reduced-motion, timeout, stale-context, editor and error recovery browser checks.`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
