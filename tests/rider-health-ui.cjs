const assert = require('node:assert/strict'), path = require('node:path');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
let browser;
(async () => {
 browser = await chromium.launch({headless:true, executablePath:process.env.JKCREW_BROWSER_PATH});
 const page = await browser.newPage({viewport:{width:390,height:844}}), errors=[];
 page.on('pageerror', e=>errors.push(e.message));
 await page.route('**/*',route=>route.request().url()==='http://localhost:54321/' ? route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><main style="max-width:900px;padding:12px;margin:auto"><div id="health"></div></main>'}) : route.abort());
 await page.goto('http://localhost:54321/');
 await page.addStyleTag({path:path.join(root,'styles.css')});await page.addStyleTag({path:path.join(root,'rider-health.css')});await page.addScriptTag({path:path.join(root,'rider-health.js')});
 await page.evaluate(()=>{
  window.persisted=[]; Storage.prototype.setItem=function(k,v){persisted.push(k)};
  window.calls=[]; window.next=[];window.activeUser='rider';window.go=[];
  window.fixture={provider:'whoop',availability:'not_configured',connection:'disconnected',summary:null};
  window.client={functions:{invoke:async (name,options)=>{calls.push({name,...options.body});let outcome=next.shift();if(outcome?.delay)await new Promise(r=>setTimeout(r,outcome.delay));if(outcome?.error)throw outcome.error;return {data:outcome?.data || structuredClone(fixture)}}}};
  window.attach=()=>{const id=activeUser;window.handle=JKCRiderHealth.mount({element:document.getElementById('health'),client,userId:id,isCurrent:()=>activeUser===id,navigate:url=>go.push(url)});};attach();
 });
 await page.waitForFunction(()=>document.querySelector('section[aria-busy=false]'));
 assert.equal(await page.locator('.rider-health-connection').innerText(),'Not connected');
 assert.equal(await page.locator('[data-health-action=connect]').count(),0,'No fake connect action without credentials');
 assert.equal(await page.locator('.rider-health-metric').count(),0,'No placeholder zeros or fake readings');
 await page.locator('summary').click();await page.locator('[data-health-provider=apple]').click();
 assert.match(await page.locator('.rider-health-provider-detail').innerText(),/iPhone app connection/);
 await page.locator('[data-health-provider=garmin]').click();assert.match(await page.locator('.rider-health-provider-detail').innerText(),/approved Garmin integration/);
 await page.locator('[data-health-provider=whoop]').click();assert.match(await page.locator('.rider-health-provider-detail').innerText(),/coach needs to finish/);
 for(const width of [320,390,768,1280]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`Disconnected layout fits ${width}`)}
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/jkcrew-health-unconnected.png',fullPage:true});
 // A real ready integration gets a consent explanation and provider redirect.
 await page.evaluate(async()=>{fixture.availability='ready';await handle.refresh()});
 await page.evaluate(()=>next.push({delay:120,data:{provider:'whoop',authorization_url:'https://api.prod.whoop.com/oauth/oauth2/auth?state=test'}}));
 await page.locator('[data-health-action=connect]').evaluate(b=>{b.click();b.click()});
 await page.waitForFunction(()=>go.length===1);assert.equal(await page.evaluate(()=>calls.filter(c=>c.action==='connect').length),1,'Double taps only start one OAuth connection');
 assert.match(await page.locator('.rider-health-provider-detail').innerText(),/disconnect and remove/);
 await page.evaluate(()=>next.push({data:{provider:'whoop',availability:'ready',connection:'connected',summary:null}}));
 await page.locator('[data-health-action=connect]').click();await page.waitForFunction(()=>document.querySelector('.rider-health-status').textContent.includes('already connected'));
 assert.equal(await page.locator('[data-health-action=confirm-disconnect]').count(),1,'Cross-device connect result adopted as connected');
 await page.evaluate(()=>handle.refresh());await page.waitForSelector('[data-health-action=connect]');
 await page.evaluate(()=>next.push({data:{provider:'whoop',authorization_url:'https://example.com/steal'}}));
 await page.locator('[data-health-action=connect]').click();await page.waitForSelector('.rider-health-status.is-error');assert.equal(await page.evaluate(()=>go.length),1,'Untrusted redirects are rejected');
 await page.evaluate(async()=>{
  fixture.connection='connected';fixture.summary={synced_at:new Date().toISOString(),metric_observed_at:{sleep:'2026-10-28T08:00:00Z',recovery:'2026-10-28T08:00:00Z',calories:'2026-10-29T07:00:00Z'},sleep_minutes:452,resting_heart_rate_bpm:53,hrv_rmssd_ms:68.3,recovery_percent:0,strain:12.4,calories_kcal:2310};await handle.refresh();
 });
 assert.deepEqual(await page.locator('.rider-health-metric dd').allTextContents(),['7h 32m','0%','2,310kcal'],'Real zeros remain zero; units preserved');
 assert.match(await page.locator('.rider-health-metric').first().innerText(),/28 Oct/,'Old sleep date is shown');
 assert.deepEqual(await page.locator('.rider-health-metric dt').allTextContents(),['Sleep','Recovery','Calories burned'],'Only the three requested basic readings are displayed, even with legacy extra metrics');
 assert.match(await page.locator('.rider-health-note').innerText(),/WHOOP.*estimate.*cycle/,'Calories are labelled as an estimated cycle total');
 await page.evaluate(async()=>{fixture.summary.calories_kcal=0;await handle.refresh()});
 assert.equal(await page.locator('.rider-health-metric.calories dd').innerText(),'0\nkcal','A genuine zero calorie value stays zero');
 await page.evaluate(async()=>{fixture.summary.calories_kcal=2310;await handle.refresh()});
 await page.evaluate(async()=>{window.savedSummary=structuredClone(fixture.summary);fixture.summary={synced_at:new Date().toISOString(),sleep_minutes:null,resting_heart_rate_bpm:'',hrv_rmssd_ms:undefined,recovery_percent:null};await handle.refresh()});
 assert.deepEqual(await page.locator('.rider-health-metric dd').allTextContents(),['—','—','—'],'Missing individual metrics do not become zero');
 await page.evaluate(async()=>{fixture.summary={synced_at:new Date().toISOString(),sleep_minutes:false,recovery_percent:' ',calories_kcal:true};await handle.refresh()});
 assert.deepEqual(await page.locator('.rider-health-metric dd').allTextContents(),['—','—','—'],'Malformed values do not become health readings');
 await page.evaluate(async()=>{fixture.summary=savedSummary;await handle.refresh()});
 const refreshBefore=await page.evaluate(()=>calls.filter(c=>c.action==='refresh').length);await page.evaluate(()=>handle.refresh());
 assert.equal(await page.evaluate(()=>calls.filter(c=>c.action==='refresh').length),refreshBefore,'Fresh status does not call provider again');
 for(const theme of ['light','dark']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);for(const width of [320,390,768,1280]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`Summary fits ${theme} ${width}`)}}
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/jkcrew-health-summary.png',fullPage:true});
 await page.evaluate(()=>next.push({error:new Error('offline')}));await page.locator('[data-health-action=refresh]').click();await page.waitForSelector('.rider-health-status.is-error');
 assert.match(await page.locator('.rider-health-status').innerText(),/last saved readings/);assert.equal(await page.locator('.rider-health-metric').count(),3,'Offline refresh preserves and labels last readings');
 await page.evaluate(()=>next.push({error:{context:{status:403}}}));await page.locator('[data-health-action=retry]').click();await page.waitForFunction(()=>document.querySelector('.rider-health-status').textContent.includes('Sign in again'));
 assert.equal(await page.locator('.rider-health-metric').count(),0,'Revoked access clears private metrics');
 await page.evaluate(()=>handle.refresh());await page.waitForSelector('.rider-health-metric');
 await page.locator('[data-health-action=confirm-disconnect]').click();assert.equal(await page.evaluate(()=>calls.filter(c=>c.action==='disconnect').length),0,'Disconnect requires confirmation');
 await page.evaluate(()=>{fixture.connection='disconnected';fixture.summary=null;fixture.message='Saved readings removed. Also remove JKCREW access in WHOOP to revoke its permission.'});await page.locator('[data-health-action=disconnect]').click();await page.waitForFunction(()=>document.querySelector('.rider-health-status').textContent.includes('Saved readings removed'));
 assert.equal(await page.locator('.rider-health-metric').count(),0);
 assert.match(await page.locator('.rider-health-status').innerText(),/Also remove JKCREW access/,'Provider revocation warning is retained');
 // An old account's delayed response never paints into the next rider's view.
 await page.evaluate(()=>{next.push({delay:200,data:{provider:'whoop',availability:'ready',connection:'connected',summary:{synced_at:new Date().toISOString(),sleep_minutes:999}}});handle.refresh();activeUser='different';attach()});
 await page.waitForTimeout(300);assert.equal(await page.locator('.rider-health-metric').count(),0);
 assert.deepEqual(await page.evaluate(()=>persisted),[],'No health data persisted in browser storage');
 await page.evaluate(()=>JKCRiderHealth.cleanup());assert.equal(await page.locator('#health').innerText(),'','Logout cleanup clears DOM and data');
 // OAuth completion fragment is scrubbed before app startup and used only once.
 await page.evaluate(()=>{history.replaceState({},'', '/?health=complete#whoop_complete='+'a'.repeat(64));calls=[];fixture={provider:'whoop',availability:'ready',connection:'connected',summary:null,sync_due:false}});
 await page.addScriptTag({path:path.join(root,'rider-health.js')});
 assert.equal(await page.evaluate(()=>location.hash),'');assert.equal(await page.evaluate(()=>location.search),'');
 await page.evaluate(()=>attach());await page.waitForFunction(()=>calls.length===1 && document.querySelector('section[aria-busy=false]'));
 assert.equal(await page.evaluate(()=>calls[0].action),'complete');assert.equal(await page.evaluate(()=>calls[0].ticket),'a'.repeat(64));
 await page.evaluate(()=>handle.refresh());assert.equal(await page.evaluate(()=>calls.at(-1).action),'status','Consumed callback ticket is not replayed');
 await page.evaluate(()=>{JKCRiderHealth.cleanup();history.replaceState({},'', '/?health=error');fixture={provider:'whoop',availability:'ready',connection:'disconnected',summary:null}});
 await page.addScriptTag({path:path.join(root,'rider-health.js')});await page.evaluate(()=>attach());
 await page.waitForFunction(()=>document.querySelector('.rider-health-status').textContent.includes('wasn’t completed'));
 assert.equal(await page.evaluate(()=>location.search),'','Cancelled callback query removed');assert.equal(await page.locator('details').getAttribute('open'),'','Retry controls opened after cancelled OAuth');
 assert.deepEqual(errors,[]);console.log('PASS: health UI readiness, explicit provider consent, double taps, redirect allowlist, timestamps/zero/null handling, cooldown, connection errors, access revocation, disconnect confirmation, account isolation, no storage, 320–1280px dark/light layouts.');
 await browser.close();
})().catch(async e=>{console.error(e);if(browser)await browser.close();process.exitCode=1});
