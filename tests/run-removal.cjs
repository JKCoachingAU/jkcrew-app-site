const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
function extract(name) {
  const start = app.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'));
  assert(start >= 0, name);
  const rest = app.slice(start);
  return rest.slice(0, rest.indexOf('\n}') + 2);
}
const names = ['canEditRun', 'runRemovalButtonHtml', 'bindRunRemovalActions', 'refreshRunRemovalView',
  'archiveRunPlan', 'runSummaryCardHtml', 'runPlansHtml', 'coachEventRunViewerHtml',
  'openCoachEventRunModal', 'closeContestEventModal', 'riderSavedRunsHtml', 'openRiderSavedRuns',
  'bindRiderSavedRuns', 'openProgressRun', 'notify', 'showUndoToast', 'setButtonBusy', 'withTimeout',
  'coachEventAttendeeRunActionHtml', 'contestEventDataAttributes', 'openContestEventModal'];

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH });
  try {
    // All records and requests stay inside this browser fixture.
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.abort());
    await page.setContent('<html data-theme="dark"><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="app"><div class="app-shell coach-shell" style="display:block"><main id="view"><section id="run-builder-live"><input id="draft-title" value="Unfinished qualifying run"></section><div id="saved-list"></div></main></div></div><div id="toast" class="toast"></div></body></html>');
    await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'styles.css'), 'utf8') });
    await page.addScriptTag({ content: `
      const state={user:{id:'coach'},profile:{role:'coach',display_name:'Coach'},view:'contests',selectedAthleteId:'rider',runBuilder:{title:'Unfinished qualifying run',points:[{x:10,y:15},{x:70,y:80}]}};
      const toast=document.querySelector('#toast');
      const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
      const dateLabel=value=>String(value||''),isCoachRole=role=>role==='coach'||role==='admin',messageFrom=error=>error?.message||String(error);
      const playNotificationSound=()=>{},cacheClear=()=>{},setSyncStatus=()=>{};
      const runReviewPanelHtml=()=>'',runMapHtml=()=>'<div class="test-run-photo">Course photo</div>',runPlaybackControlsHtml=()=>'';
      const bindRunPlaybackControls=()=>{},stopRunPlayback=()=>{},editRunPlan=()=>{},openRunDuplicate=()=>{};
      const RUN_SUMMARY_SELECT=${JSON.stringify(app.match(/^const RUN_SUMMARY_SELECT = ("[^"]+");/m)?.[1] ? JSON.parse(app.match(/^const RUN_SUMMARY_SELECT = ("[^"]+");/m)[1]) : '')};
      const renderContests=async()=>{pageRenders++;},renderProfile=renderContests,renderStudentProfile=renderContests;
      const runBuilderRefreshView=async()=>{unexpectedRefreshes++;throw Error('Removing a saved run must not remount the unfinished builder');};
      // Keep unrelated event editing out of this fixture while using the real
      // attendee controls and event-modal click binding to reopen removed runs.
      const contestEventModalHtml=(item,attendees,runs,roster)=>'<section class="contest-event-modal"><button data-close-contest-event>Close event</button>'+attendees.map(attendee=>coachEventAttendeeRunActionHtml(item,attendee,runs,roster)).join('')+'</section>';
      window.records=[
        {id:'run-coach',athlete_id:'rider',coach_id:'coach',created_by:'coach',title:'Coach qualifying',venue:'Test park',contest_item_id:'event',updated_at:'2026-09-11T01:00:00Z',archived_at:null},
        {id:'run-rider',athlete_id:'rider',coach_id:'coach',created_by:'rider',title:'Rider final',venue:'Test park',contest_item_id:'event',updated_at:'2026-09-11T02:00:00Z',archived_at:null},
        {id:'run-archived',athlete_id:'rider',coach_id:'coach',created_by:'coach',title:'Old archived run',updated_at:'2026-09-10T01:00:00Z',archived_at:'2026-09-10T01:00:00Z'},
        {id:'run-stranger',athlete_id:'other-rider',coach_id:'other-coach',created_by:'other-rider',title:'Unrelated run',archived_at:null}
      ];
      window.writes=[];window.reads=[];window.nextFailure=null;window.holdUpdate=false;window.pendingUpdate=null;window.pageRenders=0;window.unexpectedRefreshes=0;
      const client={from(table){
        const filters=[];let patch=null,columns='*',promise;
        const query={
          select(value){columns=value;return this;},update(value){patch=structuredClone(value);return this;},
          eq(key,value){filters.push({operator:'eq',key,value});return this;},is(key,value){filters.push({operator:'is',key,value});return this;},
          order(){return this;},limit(){return this;},
          then(resolve,reject){return execute(false).then(resolve,reject);},single(){return execute(true);},maybeSingle(){return execute(true);}
        };
        function execute(single){
          if(promise)return promise;
          promise=(async()=>{
            if(table!=='run_plans')throw Error('Unexpected table '+table);
            const call={table,filters:structuredClone(filters),patch,columns};
            if(patch){
              writes.push(call);
              if(holdUpdate)await new Promise(resolve=>pendingUpdate=resolve);
              const failure=nextFailure;nextFailure=null;
              if(failure==='throw')throw Error('Simulated network failure');
              if(failure==='returned')return {data:null,error:{message:'Simulated database failure'}};
              if(failure==='no-row')return {data:single?null:[],error:null};
            }else reads.push(call);
            const matches=records.filter(record=>filters.every(filter=>(record[filter.key]??null)===filter.value));
            if(patch)matches.forEach(record=>Object.assign(record,structuredClone(patch),{updated_at:'2026-09-11T03:00:00.'+String(writes.length).padStart(3,'0')+'Z'}));
            return {data:single?structuredClone(matches[0]||null):structuredClone(matches),error:null};
          })();
          return promise;
        }
        return query;
      }};
      ${names.map(extract).join('\n')}
      window.originalRecords=structuredClone(records);window.originalDraft=state.runBuilder;window.originalDraftInput=document.querySelector('#draft-title');
      window.seed=(role='coach',surface='modal')=>{
        clearTimeout(notify.timeout);toast.className='toast';toast.textContent='';closeContestEventModal();
        state.user.id=role==='athlete'?'rider':'coach';state.profile.role=role;
        document.querySelector('.app-shell').className='app-shell '+(role==='athlete'?'rider-shell':'coach-shell');
        records=structuredClone(originalRecords);writes.length=0;reads.length=0;nextFailure=null;holdUpdate=false;pendingUpdate=null;pageRenders=0;unexpectedRefreshes=0;
        const own=records.filter(run=>run.athlete_id==='rider');
        document.querySelector('#saved-list').innerHTML='';
        if(surface==='modal'){
          window.modalRuns=structuredClone(own.filter(run=>!run.archived_at));
          openCoachEventRunModal(modalRuns,'Test Rider',{id:'event',title:'Test event'});
          window.originalBackdrop=document.querySelector('#contest-event-backdrop');
        }else if(surface==='full'){
          window.modalRuns=[{...structuredClone(own[0]),image_data_url:'photo',points:[{x:10,y:20},{x:80,y:90,label:'Final trick'}]}];
          openCoachEventRunModal(modalRuns,'Test Rider',{id:'event',title:'Test event'});
        }else {
          document.querySelector('#saved-list').innerHTML=runPlansHtml(own);
          bindRunRemovalActions(document.querySelector('#saved-list'));
        }
      };
    ` });
    const assertDraft = async () => {
      assert(await page.evaluate(() => state.runBuilder===originalDraft && document.querySelector('#draft-title')===originalDraftInput));
      assert.equal(await page.locator('#draft-title').inputValue(), 'Unfinished qualifying run');
      assert.equal(await page.evaluate(() => pageRenders), 0);
      assert.equal(await page.evaluate(() => unexpectedRefreshes), 0);
    };
    const assertScope = (call, role, id, archivedAt) => {
      assert.equal(call.table, 'run_plans');
      assert.deepEqual(Object.keys(call.patch), ['archived_at'], 'Removal changes no content, ownership or review fields');
      assert(call.filters.some(filter => filter.key==='id' && filter.value===id));
      assert(call.filters.some(filter => filter.key===(role==='athlete'?'athlete_id':'coach_id') && filter.value===(role==='athlete'?'rider':'coach')));
      assert(call.filters.some(filter => filter.key==='archived_at' && filter.value===archivedAt));
      assert(call.filters.some(filter => filter.key==='updated_at'), 'Archive and Undo protect against concurrent saved-run changes');
    };
    const captureControls = async label => {
      if(!process.env.JKCREW_REMOVAL_SHOTS)return;
      for(const width of [390,1024]){
        await page.setViewportSize({width,height:844});
        const sizing=await page.locator('#contest-event-backdrop').evaluate(backdrop=>({width:backdrop.clientWidth,scroll:backdrop.scrollWidth,page:document.documentElement.scrollWidth,viewport:innerWidth}));
        assert(sizing.scroll<=sizing.width+1&&sizing.page<=sizing.viewport+1,label+' has no horizontal overflow at '+width);
        const heights=await page.locator('#contest-event-backdrop [data-archive-run]').evaluateAll(buttons=>buttons.map(button=>button.getBoundingClientRect().height));
        assert(heights.every(height=>height>=44),label+' Remove controls have touch-sized targets');
        const file=path.join(process.env.JKCREW_REMOVAL_SHOTS,'jkcrew-run-removal-'+label+'-'+width+'.png');
        await page.screenshot({path:file});
        console.log('Screenshot: '+file);
      }
      await page.setViewportSize({width:390,height:844});
    };
    // Check the actual controls on all saved-run representations, including
    // coach-made and rider-made runs, archived runs and unrelated owners.
    for(const role of ['coach','athlete','admin','parent']){
      const counts=await page.evaluate(role=>{
        seed(role,'list');
        const own=records.filter(run=>run.athlete_id==='rider');
        const summary=own.map(run=>runSummaryCardHtml(run)).join('');
        const full=runPlansHtml(own.map(run=>({...run,image_data_url:'photo',points:[]})));
        const count=html=>({remove:(html.match(/data-archive-run=/g)||[]).length,restore:(html.match(/data-restore-run=/g)||[]).length});
        return {summary:count(summary),full:count(full),foreign:runRemovalButtonHtml(records.at(-1))};
      },role);
      assert.deepEqual(counts.summary,role==='parent'?{remove:0,restore:0}:{remove:2,restore:1});
      assert.deepEqual(counts.full,counts.summary);
      assert.equal(counts.foreign,'');
    }
    for(const role of ['coach','athlete']){
      await page.evaluate(role=>seed(role),role);
      assert.equal(await page.locator('[data-archive-run]').count(),2);
      if(role==='coach')await captureControls('coach');
      await page.evaluate(()=>{holdUpdate=true;});
      const remove=page.locator('[data-archive-run="run-coach"]');
      await remove.click();
      await page.waitForFunction(()=>pendingUpdate);
      assert(await remove.isDisabled());
      assert.equal(await remove.getAttribute('aria-busy'),'true');
      await remove.evaluate(button=>button.click());
      assert.equal(await page.evaluate(()=>writes.length),1,'Repeated click while pending sends one update');
      await page.evaluate(()=>{holdUpdate=false;pendingUpdate();});
      await page.waitForFunction(()=>records.find(run=>run.id==='run-coach').archived_at && !document.querySelector('[data-archive-run="run-coach"]'));
      assert(await page.locator('#contest-event-backdrop').isVisible());
      assert(await page.evaluate(()=>originalBackdrop===document.querySelector('#contest-event-backdrop')));
      assert((await page.locator('.coach-event-run-modal header p').first().innerText()).startsWith('1 saved private run'));
      const removed=await page.evaluate(()=>structuredClone(records.find(run=>run.id==='run-coach')));
      assert.equal(await page.evaluate(()=>modalRuns.find(run=>run.id==='run-coach').archived_at),removed.archived_at);
      assertScope(await page.evaluate(()=>writes[0]),role,'run-coach',null);
      await assertDraft();
      await page.locator('#toast').getByRole('button',{name:'Undo',exact:true}).click();
      await page.waitForFunction(()=>!records.find(run=>run.id==='run-coach').archived_at && document.querySelector('[data-archive-run="run-coach"]'));
      assertScope(await page.evaluate(()=>writes[1]),role,'run-coach',removed.archived_at);
      assert((await page.locator('.coach-event-run-modal header p').first().innerText()).startsWith('2 saved private runs'));
      await assertDraft();

      await page.locator('[data-archive-run="run-coach"]').click();
      await page.waitForFunction(()=>!document.querySelector('[data-archive-run="run-coach"]'));
      await page.locator('[data-archive-run="run-rider"]').click();
      await page.waitForFunction(()=>document.querySelectorAll('[data-archive-run]').length===0);
      assert(await page.locator('#contest-event-backdrop').isVisible());
      assert((await page.locator('.coach-event-run-modal header p').first().innerText()).startsWith('0 saved private runs'));
      assert.equal(await page.locator('.coach-event-run-viewer > .empty').count(),1,'Removing the last active run shows a helpful empty state');
      await page.locator('#toast').getByRole('button',{name:'Undo',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('[data-archive-run="run-rider"]'));
      assert.equal(await page.locator('[data-archive-run]').count(),1);
      assert.equal(await page.evaluate(()=>records.find(run=>run.id==='run-stranger').archived_at),null);
      assert.equal(await page.locator('.run-removed-history').evaluate(details=>details.open),false,'Removed runs stay collapsed until opened');
      await page.locator('.run-removed-history > summary').click();
      await page.locator('[data-restore-run="run-coach"]').click();
      await page.waitForFunction(()=>document.querySelector('[data-archive-run="run-coach"]'));
      assert.equal(await page.locator('[data-archive-run]').count(),2,'Restore also recovers a run after the Undo toast has been replaced');

      await page.evaluate(role=>seed(role,'full'),role);
      assert.equal(await page.locator('.coach-event-saved-run [data-archive-run]').count(),1);
      await page.locator('[data-archive-run="run-coach"]').click();
      await page.waitForFunction(()=>!document.querySelector('[data-archive-run="run-coach"]'));
      await page.locator('#toast').getByRole('button',{name:'Undo',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('.coach-event-saved-run [data-archive-run="run-coach"]'));
      assert.equal(await page.evaluate(()=>modalRuns[0].image_data_url),'photo');
      assert.equal(await page.evaluate(()=>modalRuns[0].points.length),2);

      // Default list refresh must leave an in-progress run and its inputs alone.
      for(const failure of ['returned','throw','no-row']){
        await page.evaluate(role=>seed(role,'list'),role);
        await page.evaluate(failure=>{nextFailure=failure;},failure);
        await page.locator('[data-archive-run="run-rider"]').click();
        await page.waitForFunction(()=>writes.length===1 && !document.querySelector('[data-archive-run="run-rider"]').disabled);
        assert.equal(await page.evaluate(()=>records.find(run=>run.id==='run-rider').archived_at),null);
        assert.equal(await page.locator('#toast button').count(),0,'An unsuccessful update does not offer a false Undo');
        assert(await page.locator('#toast').evaluate(element=>element.classList.contains('error')));
        await assertDraft();
        await page.locator('[data-archive-run="run-rider"]').click();
        await page.waitForFunction(()=>records.find(run=>run.id==='run-rider').archived_at);
        assert.equal(await page.locator('[data-archive-run="run-rider"]:visible').count(),0);
        await page.locator('#toast').getByRole('button',{name:'Undo',exact:true}).click();
        await page.waitForFunction(()=>!records.find(run=>run.id==='run-rider').archived_at);
        await assertDraft();
      }
      await page.evaluate(role=>seed(role,'list'),role);
      await page.locator('#saved-list .run-removed-history > summary').click();
      await page.locator('[data-restore-run="run-archived"]').click();
      await page.waitForFunction(()=>!records.find(run=>run.id==='run-archived').archived_at);
      assert(await page.locator('[data-archive-run="run-archived"]').isVisible(),'Restored card has an active Remove action');
      assert.equal(await page.locator('[data-saved-run-id="run-archived"]').evaluate(card=>Boolean(card.closest('.run-removed-history'))),false,'Restored run returns to the active list');
      await assertDraft();
      console.log('PASS: '+role+' Remove/Undo, owner and version filters, modal counts/empty state, failures and draft preservation.');
    }
    // Removed event runs must remain discoverable after closing and reopening
    // the coach's event, including when no active run remains.
    await page.evaluate(()=>{
      seed('coach','list');document.querySelector('#saved-list').innerHTML='';
      window.parentRuns=structuredClone(records.filter(run=>run.contest_item_id==='event'));
      window.openEvent=()=>openContestEventModal({id:'event',title:'Test event'},[{athlete_id:'rider',profile:{display_name:'Test Rider'}}],parentRuns,[{id:'rider',display_name:'Test Rider'}]);
      openEvent();
    });
    await page.locator('[data-view-rider-event-runs]').click();
    for(const id of ['run-coach','run-rider']){
      await page.locator('[data-archive-run="'+id+'"]').click();
      await page.waitForFunction(id=>!document.querySelector('[data-archive-run="'+id+'"]'),id);
    }
    assert(await page.evaluate(()=>parentRuns.every(run=>run.archived_at)),'Event data reflects both removals');
    await page.locator('[data-close-contest-event]').click();
    await page.evaluate(()=>{parentRuns=structuredClone(records.filter(run=>run.contest_item_id==='event'));openEvent();});
    assert((await page.locator('[data-view-rider-event-runs]').innerText()).toLowerCase().includes('removed'),'Coach can reopen removed runs even with zero active runs');
    await page.locator('[data-view-rider-event-runs]').click();
    assert.equal(await page.locator('[data-archive-run]').count(),0);
    await page.locator('.run-removed-history > summary').click();
    await page.locator('[data-restore-run="run-coach"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-archive-run="run-coach"]'));
    await page.locator('[data-close-contest-event]').click();
    await page.evaluate(()=>openEvent());
    assert((await page.locator('[data-view-rider-event-runs]').innerText()).includes('1'));
    await assertDraft();

    await page.evaluate(()=>{
      seed('athlete','list');
      document.querySelector('#view').insertAdjacentHTML('beforeend','<button id="open-saved-runs" data-rider-saved-runs="all">View saved runs</button>');
      bindRiderSavedRuns(document.querySelector('#view'));
    });
    await page.click('#open-saved-runs');
    await page.waitForFunction(()=>document.querySelector('#saved-runs-title'));
    await page.evaluate(()=>{window.riderBackdrop=document.querySelector('#contest-event-backdrop');});
    assert.equal(await page.locator('#contest-event-backdrop .saved-run-list-entry').count(),2);
    await captureControls('rider');
    for(const id of ['run-coach','run-rider']){
      await page.locator('#contest-event-backdrop [data-archive-run="'+id+'"]').click();
      await page.waitForFunction(id=>!document.querySelector('#contest-event-backdrop [data-archive-run="'+id+'"]'),id);
    }
    assert(await page.evaluate(()=>riderBackdrop===document.querySelector('#contest-event-backdrop')));
    assert((await page.locator('#contest-event-backdrop .notification-list').innerText()).includes('No saved runs yet'));
    await page.locator('#toast').getByRole('button',{name:'Undo',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#contest-event-backdrop [data-archive-run="run-rider"]'));
    assert.equal(await page.locator('#contest-event-backdrop .saved-run-list-entry').count(),1);
    await assertDraft();
    console.log('PASS: rider saved-run list removes coach/rider-created runs, preserves its modal and restores with Undo.');
    await page.evaluate(()=>{seed('coach','list');holdUpdate=true;});
    await page.locator('[data-archive-run="run-rider"]').click();
    await page.waitForFunction(()=>pendingUpdate);
    await page.evaluate(()=>{
      state.view='profile';state.runBuilder=null;
      document.querySelector('#view').innerHTML='<h1 id="new-page">A different page</h1>';
      holdUpdate=false;pendingUpdate();
    });
    await page.waitForFunction(()=>records.find(run=>run.id==='run-rider').archived_at);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
    assert.equal(await page.locator('#new-page').innerText(),'A different page');
    assert.equal(await page.evaluate(()=>unexpectedRefreshes),0,'An in-flight removal never refreshes a newly opened page');
    assert.deepEqual(errors, []);
    await page.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
