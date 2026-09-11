const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(process.env.JKCREW_RUN_SOURCE || path.join(root, 'app.js'), 'utf8');
function extract(name) {
  const start = app.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'));
  assert(start >= 0, name);
  const rest = app.slice(start);
  return rest.slice(0, rest.indexOf('\n}') + 2);
}
const names = [...new Set([
  ...fs.readFileSync(path.join(__dirname, 'run-framing.cjs'), 'utf8')
    .match(/const names = (\[[^;]+\]);/)[1].matchAll(/'([^']+)'/g),
].map(match => match[1]).concat([
  'bindRunTimingControls', 'runSegmentEditorHtml', 'paintRunSegmentSelection', 'selectRunSegment',
  'runTimeBudget', 'runTimeBudgetHtml', 'paintRunTimeBudget', 'currentRunFormState',
  'refreshMountedRunBuilder', 'runBuilderRefreshView', 'runBuilderPanel', 'runBuilderStepsHtml',
  'runBuilderRouteEditorHtml', 'runBuilderPlaybackEditorHtml', 'runTimingEditorHtml',
  'bindRunBuilderActions', 'runBuilderLoadingHtml', 'updateRunBuilderTrick', 'updateRunTiming',
  'updateRunFinalType', 'updateSelectedRunPoint', 'rememberRunEdit', 'restoreRunEdit',
  'setRunBuilderStage', 'selectRunPoint', 'startRunPointDrag', 'stopRunPointDrag',
  'focusRunBuilderTrick', 'advanceRunBuilderTrick', 'deleteSelectedRunPoint', 'clearRunBuilder',
  'liveRunOwnsEditor', 'liveRunCanEdit', 'liveRunBarHtml', 'paintLiveRunControls',
  'bindLiveRunControls', 'withTimeout', 'setButtonBusy',
  ...['bindRunRemovalActions', 'refreshRunRemovalView', 'archiveRunPlan'].filter(name => app.includes('function ' + name + '(')),
]))];
// Unrelated photo/upload/archive actions are never exercised. Save, Watch,
// remount, form reading, live read-only rules and all playback code are real.
const unusedHandlers = [...new Set([...extract('bindRunBuilderActions')
  .matchAll(/addEventListener\("[^"]+", (\w+)\)/g)].map(match => match[1]))]
  .filter(name => !names.includes(name));

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH });
  try {
    for (const role of ['coach', 'athlete']) for (const mobile of [false, true]) {
      const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1024, height: 768 }, isMobile: mobile, hasTouch: true });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => route.abort());
      await page.setContent('<html data-theme="dark"><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="app"><div class="app-shell ' + (role === 'coach' ? 'coach-shell' : 'rider-shell') + '" style="display:block"><main id="view"></main></div></div></body></html>');
      await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'styles.css'), 'utf8') });
      await page.addScriptTag({ content: `
        const state = {user:{id:${JSON.stringify(role === 'coach' ? 'coach' : 'rider')}},profile:{role:${JSON.stringify(role)}},view:'contests',selectedAthleteId:'rider',draggedRunPoint:null,runPointMapClickBlockUntil:0,runPointDragClickBlockUntil:0};
        let runUndoStack=[],runRedoStack=[],liveRun=null;
        const RUN_PLAYBACK_MAX_SECONDS=3600;
        const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        const isCoachRole=role=>role==='coach'||role==='admin',messageFrom=e=>e?.message||String(e);
        window.requests=[];window.messages=[];window.sync=[];window.invalids=[];window.renders=0;
        const notify=(message,type)=>messages.push({message,type}),setSyncStatus=status=>sync.push(status),cacheClear=()=>{};
        const bindRiderSavedRuns=()=>{},handleLiveRunAction=()=>{throw Error('Unexpected live invitation');};
        const saveLiveRun=async()=>{throw Error('Unexpected live save');};
        const getLinkedCoachIdForCurrentAthlete=async()=>'coach';
        window.saveFailure=null;window.pendingSave=null;window.holdSave=false;window.failAfterSaveRender=false;
        async function request(name,payload){
          requests.push({name,payload:structuredClone(payload)});
          if(holdSave)await new Promise(resolve=>pendingSave=resolve);
          if(saveFailure?.throw)throw Error(saveFailure.message);
          return saveFailure?{error:{message:saveFailure.message}}:{};
        }
        const client={rpc:(name,args)=>request(name,args),from:table=>({insert:payload=>request(table,payload)})};
        const renderContests=async()=>{renders++;if(failAfterSaveRender&&!state.runBuilder)throw Error('Events refresh failed');document.querySelector('#view').innerHTML=state.runBuilder?runBuilderPanel([],{live:true,showRunList:false}):'<h1>Events & runs</h1>';if(state.runBuilder)bindRunBuilderActions();};
        const renderProfile=renderContests,renderStudentProfile=renderContests;
        const navigate=async view=>{state.view=view;await renderContests();};
        ${unusedHandlers.map(name => 'const ' + name + '=()=>{};').join('\n')}
        ${names.map(extract).join('\n')}
        document.addEventListener('invalid',event=>invalids.push({id:event.target.id,index:event.target.dataset.runTimeIndex,key:event.target.dataset.runTimeKey,value:event.target.value,message:event.target.validationMessage}),true);
        window.seed=async(options={})=>{
          stopRunPlayback();liveRun=null;messages.length=0;invalids.length=0;sync.length=0;saveFailure=null;holdSave=false;pendingSave=null;failAfterSaveRender=false;
          state.runBuilder={id:options.saved?'saved-run':null,updatedAt:options.saved?'2026-09-11T00:00:00Z':null,coachId:'coach',athleteId:'rider',athleteName:'Test Rider',title:'Finals test run',notes:'Preserve these notes',venue:'Test park',planType:'competition',contestItemId:'test-contest',stage:'tricks',selectedPointIndex:17,
            imageDataUrl:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" fill="#23554e"/></svg>'),
            points:Array.from({length:20},(_,i)=>({x:10+(i%5)*18,y:15+Math.floor(i/5)*20,label:i===0||i===19?'':i===8?'':'Trick '+i,bend:0,holdSeconds:i>0&&i<19?0.25:0,travelSeconds:i===0?3.6:3.2,...(i===0?{timeLimitSeconds:options.decimalLimit?60.5:60}:{})}))};
          if(options.liveViewer)liveRun={clientId:'viewer-tab',connected:true,session:{id:'shared',status:'active',invitation_status:'accepted',athlete_id:'rider',coach_id:'coach',athlete_name:'Test Rider',editor_id:state.user.id==='coach'?'rider':'coach',editor_client:'other-tab',lease_until:new Date(Date.now()+60000).toISOString()}};
          await renderContests();
        };
        window.snapshot=()=>({stage:state.runBuilder?.stage,builder:state.runBuilder,playing:Boolean(state.runPlayback),requests:structuredClone(requests),messages:structuredClone(messages),invalids:structuredClone(invalids),sync:[...sync],renders});
      ` });
      const label = role + (mobile ? ' phone' : ' tablet');
      await page.evaluate(() => seed());
      await page.waitForFunction(() => document.querySelector('#run-map img').complete);
      assert.equal(await page.locator('[data-run-budget-total]').innerText(), '65.7s / 60s');
      const initialCount = await page.evaluate(() => requests.length);
      await page.locator('#run-builder-form button[type=submit]').first().click();
      if (process.env.JKCREW_REPRO) {
        console.log(label + ' save:', JSON.stringify(await page.evaluate(() => ({requests:requests.length,stage:state.runBuilder?.stage,invalids:invalids.slice(0,2),invalidCount:invalids.length,messages}))));
        await page.evaluate(() => seed());
        await page.click('#finish-run-builder');
        console.log(label + ' Watch:', JSON.stringify(await page.evaluate(() => ({stage:state.runBuilder.stage,playing:Boolean(state.runPlayback),messages}))));
        await page.evaluate(() => seed());
        await page.click('[data-run-mode="playback"]');
        await page.locator('#run-builder-form button[type=submit]').first().click();
        console.log(label + ' old top Watch then Save workaround:', JSON.stringify(await page.evaluate(() => ({saved:!state.runBuilder,requests:requests.length,invalids,messages}))));
        await page.evaluate(() => seed({liveViewer:true}));
        console.log(label + ' live viewer controls:', JSON.stringify(await page.evaluate(() => ({finishDisabled:document.querySelector('#finish-run-builder').disabled,watchDisabled:document.querySelector('[data-run-mode="playback"]').disabled}))));
        await page.evaluate(() => seed({decimalLimit:true}));
        console.log(label + ' decimal limit valid:', await page.locator('[data-run-limit]').evaluate(input => input.validity.valid));
        await page.close();
        continue;
      }
      await page.waitForFunction(count => requests.length === count + 1 && !state.runBuilder, initialCount);
      assert.equal(await page.locator('#view h1').innerText(), 'Events & runs');
      const inserted = await page.evaluate(() => requests.at(-1));
      assert.equal(inserted.name, 'run_plans');
      assert.equal(inserted.payload.created_by, role === 'coach' ? 'coach' : 'rider');
      assert.equal(inserted.payload.athlete_id, 'rider');
      assert.equal(inserted.payload.points.length, 20);
      assert.equal(inserted.payload.points[1].holdSeconds, 0.25, 'Legacy quarter-second holds are saved unchanged');
      assert.equal(inserted.payload.points[8].label, '', 'An unnamed trick does not block saving');
      assert.deepEqual(await page.evaluate(() => invalids), [], label + ': legacy timing passes native form validation');

      // Finish Watch must remount the real panel, rebind its real controls,
      // retain the decoded photo, and begin playback without making a write.
      await page.evaluate(() => seed({saved:true}));
      await page.waitForFunction(() => document.querySelector('#run-map img').complete);
      await page.locator('#run-title').fill('Finals edited before watching');
      const beforeWatch = await page.evaluate(() => {
        window.originalPhoto=document.querySelector('#run-map img');
        window.originalPanel=document.querySelector('#run-builder-live');
        return {requests:requests.length,renders,points:structuredClone(state.runBuilder.points)};
      });
      await page.click('#finish-run-builder');
      await page.waitForFunction(() => state.runBuilder.stage==='playback' && state.runPlayback?.controls.isConnected);
      assert.equal(await page.evaluate(() => originalPanel===document.querySelector('#run-builder-live')), false, 'Watch replaces the mounted editor');
      assert.equal(await page.evaluate(() => originalPhoto===document.querySelector('#run-map img')), true, 'Watch keeps the decoded park photo');
      assert.equal(await page.evaluate(() => renders), beforeWatch.renders, 'Watch does not reload the Events page');
      assert.equal(await page.evaluate(() => requests.length), beforeWatch.requests, 'Watching never saves implicitly');
      assert.deepEqual(await page.evaluate(() => state.runBuilder.points), beforeWatch.points);
      assert.equal(await page.locator('#run-title').inputValue(), 'Finals edited before watching');
      assert.equal(await page.locator('[data-run-play-toggle]').innerText(), 'PAUSE');
      assert.equal(await page.locator('[data-run-playback-controls]').getAttribute('data-run-playback-seconds'), '65.7');
      assert.equal(await page.locator('#run-map .run-marker').count(), 20);
      await page.locator('[data-run-scrub]').evaluate(input => {
        const timing=runTiming(state.runBuilder.points);
        const elapsed=timing.slice(0,8).reduce((sum,item)=>sum+item.hold+item.travel,0)+0.1;
        input.value=String(Math.round(elapsed/runPlaybackDefaultSeconds(state.runBuilder.points)*1000));
        input.dispatchEvent(new Event('input',{bubbles:true}));
      });
      assert.equal(await page.locator('[data-run-playback-label]').innerText(), 'NO TRICK');
      assert.equal(await page.locator('.run-marker.play-active').getAttribute('data-run-point-number'), '9');
      await page.locator('#run-builder-form button[type=submit]').first().click();
      await page.waitForFunction(() => !state.runBuilder);
      const savedWatch = await page.evaluate(() => requests.at(-1));
      assert.equal(savedWatch.name, 'save_shared_run_edits');
      assert.equal(savedWatch.payload.p_run_id, 'saved-run');
      assert.equal(savedWatch.payload.p_expected_updated_at, '2026-09-11T00:00:00Z');
      assert.equal(savedWatch.payload.p_content.title, 'Finals edited before watching');
      assert.equal(savedWatch.payload.p_content.notes, 'Preserve these notes');
      assert.equal(savedWatch.payload.p_content.points[8].label, '');

      // A coach or rider who is watching a shared draft may play it, but may
      // not edit the other person's draft or save while it is read-only.
      await page.evaluate(() => seed({liveViewer:true}));
      assert(await page.locator('#finish-run-builder').isEnabled(), label + ': live viewer can finish Watch');
      assert(await page.locator('[data-run-trick-index="1"]').isDisabled());
      assert(await page.locator('#run-builder-form button[type=submit]').first().isDisabled());
      const liveBefore = await page.evaluate(() => ({requests:requests.length,points:structuredClone(state.runBuilder.points)}));
      await page.click('#finish-run-builder');
      await page.waitForFunction(() => state.runPlayback?.controls.isConnected);
      assert.equal(await page.locator('[data-run-play-toggle]').innerText(), 'PAUSE');
      assert.equal(await page.evaluate(() => requests.length), liveBefore.requests);
      assert.deepEqual(await page.evaluate(() => state.runBuilder.points), liveBefore.points);
      assert(await page.locator('#run-title').isDisabled());
      assert(await page.locator('#run-builder-form button[type=submit]').first().isDisabled());

      // Both real save buttons reflect the pending write. A second native
      // submit during that write must not create another run or edit request.
      await page.evaluate(() => seed({saved:true,decimalLimit:true}));
      assert(await page.locator('[data-run-limit]').evaluate(input => input.validity.valid));
      assert.equal(await page.locator('#run-builder-form button[type=submit]').count(), 2);
      await page.locator('#run-title').fill('Deferred final');
      const deferredBefore = await page.evaluate(() => {holdSave=true;return requests.length;});
      await page.locator('.run-finish-actions button[type=submit]').click();
      await page.waitForFunction(() => pendingSave && state.runPlanSaving);
      assert.equal(await page.locator('#run-builder-form button[type=submit]:disabled[aria-busy="true"]').count(), 2);
      assert((await page.locator('#run-builder-form button[type=submit]').allTextContents()).every(text => text==='Saving…'));
      await page.locator('#run-builder-form').evaluate(form => {form.querySelector('button[type=submit]').click();form.requestSubmit();});
      assert.equal(await page.evaluate(() => requests.length), deferredBefore + 1);
      await page.evaluate(() => {holdSave=false;pendingSave();});
      await page.waitForFunction(() => !state.runBuilder && !state.runPlanSaving);
      assert.equal(await page.evaluate(() => requests.at(-1).payload.p_content.points[0].timeLimitSeconds), 60.5);

      for (const thrown of [false,true]) {
        await page.evaluate(saved => seed({saved}), !thrown);
        await page.locator('#run-title').fill('Retain and retry this final');
        const beforeFailure = await page.evaluate(thrown => {saveFailure={throw:thrown,message:'Simulated connection failure'};return requests.length;}, thrown);
        await page.locator('.run-finish-actions button[type=submit]').click();
        await page.waitForFunction(() => sync.at(-1)==='error' && !state.runPlanSaving);
        assert.equal(await page.evaluate(() => requests.length), beforeFailure + 1);
        assert.equal(await page.locator('#run-title').inputValue(), 'Retain and retry this final');
        assert.equal(await page.evaluate(() => state.runBuilder.points[1].holdSeconds), 0.25);
        assert.equal(await page.locator('#run-builder-form button[type=submit]:enabled').count(), 2);
        assert.equal(await page.locator('#run-builder-form [aria-busy="true"]').count(), 0);
        assert((await page.evaluate(() => messages.at(-1).message)).includes('Your run edits are still here.'));
        await page.evaluate(() => {saveFailure=null;});
        await page.locator('.run-finish-actions button[type=submit]').click();
        await page.waitForFunction(() => !state.runBuilder);
        assert.equal(await page.evaluate(() => requests.length), beforeFailure + 2);
        const retried = await page.evaluate(() => requests.at(-1));
        assert.equal((retried.payload.p_content || retried.payload).title, 'Retain and retry this final');
      }

      // A successful write followed by a failed Events reload is still saved.
      await page.evaluate(() => seed());
      const beforeRefreshFailure = await page.evaluate(() => {failAfterSaveRender=true;return requests.length;});
      await page.locator('.run-finish-actions button[type=submit]').click();
      await page.waitForFunction(() => !state.runBuilder && !state.runPlanSaving);
      assert.equal(await page.evaluate(() => requests.length), beforeRefreshFailure + 1);
      assert.equal(await page.evaluate(() => sync.at(-1)), 'saved');
      assert.equal(await page.evaluate(() => messages.at(-1).message), 'Your run was saved. Reopen Events & runs to view it.');

      // Relaxing timing steps must retain ordinary title validation.
      await page.evaluate(() => seed());
      await page.locator('#run-title').fill('');
      const beforeInvalidTitle = await page.evaluate(() => requests.length);
      await page.locator('.run-finish-actions button[type=submit]').click();
      assert.equal(await page.evaluate(() => requests.length), beforeInvalidTitle);
      assert.equal(await page.evaluate(() => invalids.at(-1).id), 'run-title');
      assert.deepEqual(errors, [], label + ': no unhandled errors');
      console.log('PASS: ' + label + ' real Save/Watch, fractional timing, read-only playback, busy/retry and refresh-error cases.');
      await page.close();
    }
    console.log(process.env.JKCREW_REPRO ? 'Completed old-source reproduction.' : 'PASS: actual run-builder Save/Watch integration.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
