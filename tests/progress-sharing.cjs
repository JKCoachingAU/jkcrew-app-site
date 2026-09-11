const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const extract = name => { const source = appSource.slice(appSource.indexOf(`function ${name}(`)); return source.slice(0, source.indexOf('\n}') + 2); };
const screenshotDirectory = process.env.JKCREW_SCREENSHOT_DIR || '/tmp';
const dailyResult = {
  athlete_id: 'rider', rider_name: 'Lars Test Rider', result_id: 'result-1', local_date: '2026-09-11',
  seconds: 752, completion_points: 3, completion_xp: 35, previous_pb_seconds: 810, pb_seconds: 752,
  pb_comparable: true, is_new_pb: true, is_first_pb: false, weekly_score: 32, rank_number: 4,
  venue: 'Test park', completed_at: '2026-09-11T03:32:00Z',
  email: 'SECRET_EMAIL', private_feedback: 'SECRET_COACH_FEEDBACK', run_plans: [{ title: 'SECRET_RUN' }]
};
const progress = {
  athlete_id: 'rider', rider_name: 'Lars Test Rider', local_date: '2026-09-11', timezone: 'Australia/Brisbane',
  daily_results: [dailyResult], today_points: 13, today_xp: 155, weekly_score: 32,
  completed_categories: [
    { category: 'daily', items: [{ id: 'd1', trick_name: 'Manual' }, { id: 'd2', trick_name: '180 flyout' }] },
    { category: 'one_bangs', items: [{ id: 'ob', trick_name: 'Tailwhip air' }] },
    { category: 'dialled', items: [{ id: 'di', trick_name: '360 no hander' }] },
    { category: 'lines', items: [{ id: 'li', trick_name: 'Manual → Barspin → 180', notes: 'SECRET_COACH_FEEDBACK - PRIVATE_INSTRUCTION - NEVER_EXPORT' }, {id:'legacy-line', trick_name:'360',notes:'Barspin - No hander'}, {id:'private-line', trick_name:'Truck box',notes:'Private coaching feedback - call PRIVATE_CONTACT - NEVER_EXPORT_NOTES'}] },
    { category: 'bonus', items: [{ id: 'bo', trick_name: 'Opposite 360' }] }
  ],
  improvements: [{ type: 'daily_pb', seconds: 752, previous_pb_seconds: 810, venue: 'Test park' }],
  next_goal: { category: 'lines', trick_name: 'Manual → 180 → Half cab' },
  contact_details: 'SECRET_CONTACT', private_feedback: 'SECRET_COACH_FEEDBACK', run_plans: [{ title: 'SECRET_RUN' }]
};

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
    const errors = [];
    let downloads = 0;
    page.on("download", () => downloads++);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.abort());
    await page.setContent('<html data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"><div class="app-shell rider-shell"><main id="view"><input id="ongoing-training" value="unchanged"><div id="progress-trigger"></div></main></div></div></body></html>');
    await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'styles.css'), 'utf8') });
    await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'progress-sharing.css'), 'utf8') });
    await page.addScriptTag({ content: `
      const state = { user:{id:'rider'}, profile:{role:'athlete'}, activeTraining:{id:'ongoing'}, attempts:[{id:'existing'}] };
      window.fixture = ${JSON.stringify(progress)};
      window.dailyFixture = ${JSON.stringify(dailyResult)};
      window.rpcCalls = []; window.rpcQueue = []; window.pendingRpc = [];
      const client = { rpc(name,args) {
        rpcCalls.push({name,args});
        const mode = rpcQueue.shift();
        if(mode==='deferred') return new Promise(resolve => pendingRpc.push(resolve));
        if(mode==='error') return Promise.resolve({error:{message:'Network unavailable'}});
        if(mode==='denied') return Promise.resolve({error:{code:'42501',message:'Not linked'}});
        return Promise.resolve({data:structuredClone(fixture)});
      }};
      window.drawnText=[];
      const fillText = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function(value,...args){drawnText.push(String(value));return fillText.call(this,value,...args);};
      window.shareCalls=[];
      Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});
      Object.defineProperty(navigator,'share',{configurable:true,value:async(data)=>{shareCalls.push({title:data.title,names:data.files.map(f=>f.name),types:data.files.map(f=>f.type),sizes:data.files.map(f=>f.size)});}});
    ` });
    await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'progress-sharing.js'), 'utf8') });
    // In the app, these helpers are defined by the later deferred app script.
    await page.addScriptTag({ content: ['splitLineTricks','assignmentPresentation'].map(extract).join('\n') });
    await page.evaluate(() => { document.querySelector('#progress-trigger').innerHTML = trainingProgressButtonHtml('rider', 'Lars Test Rider'); bindTrainingProgressActions(); bindTrainingProgressActions(); });
    assert.equal(await page.evaluate(() => TRAINING_SHARE_CARDS_ENABLED), false, 'Release share-card gate stays disabled');
    const originalState = await page.evaluate(() => JSON.stringify({training:state.activeTraining,attempts:state.attempts}));
    await page.getByRole('button', { name: "Today's Progress" }).click();
    await page.getByText('Updated just now', { exact: true }).waitFor();
    assert.equal((await page.evaluate(() => rpcCalls)).length, 1, 'Opening after idempotent binding must query once');
    assert.deepEqual(await page.evaluate(() => rpcCalls[0]), { name: 'get_today_training_progress', args: { p_athlete_id: 'rider' } });
    assert.equal(await page.locator('.training-progress-stats strong').allTextContents().then(x=>x.join('/')), '13/155');
    assert.equal(await page.locator('.training-progress-weekly strong').textContent(), '32');
    for (const name of ['Tailwhip air', '360 no hander', 'Manual → Barspin → 180', 'Opposite 360']) assert(await page.locator('.training-progress-category li').filter({hasText:name}).isVisible());
    assert(await page.locator('.training-progress-category li').filter({hasText:'360 → Barspin → No hander'}).isVisible());
    assert(await page.getByText('12:32 · previous best 13:30', {exact:true}).isVisible());
    assert.equal(await page.locator('dialog details[open]').count(), 0);
    assert(!(await page.locator('dialog').textContent()).includes('SECRET_'));
    assert(!(await page.locator('dialog').textContent()).includes('overall duration'));
    assert.equal(await page.getByRole('button', {name:/share|save image/i}).count(),0,'Today has no sharing controls');

    for (const width of [320, 390, 1024]) {
      for (const theme of ['dark', 'light']) {
        await page.setViewportSize({ width, height: width > 500 ? 900 : 844 });
        await page.evaluate(theme => {document.documentElement.dataset.theme=theme;document.querySelector('dialog').scrollTop=0;}, theme);
        const dimensions=await page.locator('.training-today-dialog').evaluate(el=>({scroll:el.scrollWidth,client:el.clientWidth,top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom}));
        assert(dimensions.scroll<=dimensions.client+1, `${width}/${theme}: no horizontal dialog overflow`);
        assert(dimensions.top>=0 && dimensions.bottom<= (width>500?900:844), `${width}/${theme}: within viewport`);
        await page.screenshot({path:path.join(screenshotDirectory,`jkcrew-today-progress-${width}-${theme}.png`)});
      }
    }
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>{document.documentElement.dataset.theme='dark';fixture.today_points=15;fixture.today_xp=165;fixture.completed_categories[1].items.push({id:'ob2',trick_name:'Can can'});return refreshOpenTrainingProgress('rider')});
    assert.equal(await page.locator('.training-progress-stats strong').first().textContent(),'15');
    assert(await page.locator('.training-progress-category li').filter({hasText:'Can can'}).isVisible());
    // A stale request cannot repaint a newer activity response.
    await page.evaluate(()=>{rpcQueue.push('deferred');void refreshOpenTrainingProgress('rider');});
    await page.evaluate(()=>{fixture.today_points=16;return refreshOpenTrainingProgress('rider');});
    await page.evaluate(()=>{pendingRpc.shift()({data:{...structuredClone(fixture),today_points:999}})});
    assert.equal(await page.locator('.training-progress-stats strong').first().textContent(),'16');
    // A failed refresh retains labelled prior data and the release never exposes sharing.
    await page.evaluate(()=>{rpcQueue.push('error');return refreshOpenTrainingProgress('rider')});
    assert(await page.getByText(/Couldn't update/).isVisible());
    assert.equal(await page.locator('[data-progress-preview]').count(),0);
    assert.equal(await page.locator('.training-progress-stats strong').first().textContent(),'16');
    await page.locator('[data-progress-refresh]').click();
    await page.getByText('Updated just now',{exact:true}).waitFor();

    // This release excludes share cards even when native sharing is supported.
    // Public preview/data entries are safe no-ops with either source payload.
    for (const kind of ['dailyResult','todayProgress']) {
      assert.equal(await page.evaluate(kind => buildTrainingShareData({[kind]:kind==='dailyResult'?dailyFixture:fixture}),kind),null,'Export model is unavailable');
      await page.evaluate(kind => showTrainingSharePreview({[kind]:kind==='dailyResult'?dailyFixture:fixture}),kind);
    }
    await page.evaluate(()=>showTrainingSharePreview());
    assert.equal(await page.locator('.training-share-dialog, .training-share-image, [data-share-native], [data-share-save], [data-progress-preview]').count(),0,'No direct preview or export path opens');
    assert.equal(await page.getByRole('button',{name:/share|save image/i}).count(),0);
    assert.equal(await page.evaluate(()=>drawnText.length),0,'Disabled feature never renders an export canvas');
    assert.equal(await page.evaluate(()=>shareCalls.length),0,'Disabled feature never calls native sharing');
    assert.equal(downloads,0,'Disabled feature never starts a download');
    assert(await page.locator('.training-today-dialog').isVisible(),'Direct preview no-op preserves the private summary');
    assert.equal(await page.locator('.training-progress-stats strong').first().textContent(),'16');
    await page.locator('[data-progress-continue]').click();
    await page.waitForFunction(()=>!document.querySelector('dialog'));
    assert.equal(await page.locator('dialog').count(),0);
    assert.equal(await page.evaluate(()=>JSON.stringify({training:state.activeTraining,attempts:state.attempts})),originalState,'Private summary never changes training');
    await page.evaluate(()=>showTrainingSharePreview({dailyResult:dailyFixture}));
    assert.equal(await page.locator('dialog').count(),0,'Direct preview is also unavailable with no summary open');

    // Fresh queries reflect a new local date, empty day, no fabricated rewards/PB.
    await page.evaluate(()=>{fixture.local_date='2026-09-12';fixture.daily_results=[];fixture.completed_categories=[];fixture.improvements=[];fixture.next_goal=null;fixture.today_points=0;fixture.today_xp=null;fixture.xp_attribution='partial';fixture.attributable_today_xp=35;return openTodayTrainingProgress({athleteId:'rider'});});
    assert(await page.getByText('No finish recorded today',{exact:true}).isVisible());
    assert.equal(await page.locator('.training-progress-stats strong').last().textContent(),'—');
    assert(await page.getByText('Today’s full XP total is unavailable because earlier rewards were adjusted today.',{exact:true}).isVisible());
    assert.equal(await page.evaluate(()=>buildTrainingShareData({todayProgress:fixture})),null,'Partial XP does not expose an export path');
    assert.equal(await page.locator('.training-progress-pb').count(),0);
    await page.evaluate(()=>{fixture.daily_results=[{...dailyFixture,legacy:true,pb_comparable:false,completion_points:null}];return refreshOpenTrainingProgress('rider')});
    assert(await page.getByText(/Previously saved time/).isVisible());
    assert.equal(await page.locator('.training-progress-daily-result b').textContent(),'—');
    assert.equal(await page.locator('.training-progress-pb').count(),0,'Legacy incompatible time never gains a PB treatment');
    await page.evaluate(()=>closeTrainingProgressViews());
    await page.waitForFunction(()=>!document.querySelector('dialog'));
    const before=await page.evaluate(()=>rpcCalls.length);
    await page.evaluate(()=>openTodayTrainingProgress({athleteId:'unrelated'}));
    assert.equal(await page.evaluate(()=>rpcCalls.length),before,'Rider cannot request someone else through UI');
    // Late responses after account changes must not expose previous rider data.
    await page.evaluate(()=>{rpcQueue.push('deferred');void openTodayTrainingProgress({athleteId:'rider'});state.user.id='other-account';pendingRpc.shift()({data:structuredClone(fixture)});return refreshOpenTrainingProgress();});
    await page.waitForFunction(()=>!document.querySelector('dialog'));
    assert.equal(await page.locator('dialog').count(),0);
    await page.evaluate(()=>{state.user.id='coach';state.profile.role='coach';fixture.athlete_id='second-rider';fixture.rider_name='Second rider with a long name';return openTodayTrainingProgress({athleteId:'second-rider',riderName:'Second rider'})});
    assert.equal(await page.locator('[data-progress-name]').textContent(),'Second rider with a long name');
    assert.deepEqual(await page.evaluate(()=>rpcCalls.at(-1).args),{p_athlete_id:'second-rider'});
    await page.evaluate(()=>{rpcQueue.push('denied');return refreshOpenTrainingProgress('second-rider');});
    assert(await page.getByText('Progress is no longer available for this rider.',{exact:true}).isVisible());
    assert.equal(await page.locator('.training-progress-stats').count(),0,'Access revoked clears an earlier private summary');
    assert.equal(await page.locator('[data-progress-preview]').count(),0);
    await page.evaluate(()=>closeTrainingProgressViews());
    await page.waitForFunction(()=>!document.querySelector('dialog'));
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.evaluate(()=>{state.user.id='rider';state.profile.role='athlete';fixture.athlete_id='rider';return openTodayTrainingProgress({athleteId:'rider'})});
    assert.equal(await page.locator('.training-today-dialog').evaluate(el=>getComputedStyle(el).animationName),'none');
    assert.equal(await page.getByRole('button',{name:/share|save image/i}).count(),0,'Sharing stays absent after account changes and refreshes');
    assert.equal(await page.evaluate(()=>shareCalls.length),0);
    assert.equal(downloads,0);
    assert.deepEqual(errors,[]);
    console.log('PASS: fresh private local-day summaries, updates/stale/error guards, exact completions/rewards/PB, phone/tablet light/dark layouts, disabled share controls and direct preview/export entries, no canvas/native share/download, no training mutation, account isolation, reduced motion.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
