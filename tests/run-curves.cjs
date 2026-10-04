const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');

const root = process.env.JKCREW_TEST_ROOT || path.resolve(__dirname, '..');
const app = fs.readFileSync(process.env.JKCREW_RUN_SOURCE || path.join(root, 'app.js'), 'utf8');
const extract = name => {
  const start = app.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'));
  assert(start >= 0, name);
  const rest = app.slice(start);
  return rest.slice(0, rest.indexOf('\n}') + 2);
};
const names = [
  'runBuilderPanel', 'runBuilderStage', 'runBuilderStepsHtml', 'runBuilderRouteEditorHtml',
  'runBuilderTrickEditorHtml', 'runBuilderPlaybackEditorHtml', 'runBuilderPhotoSetupHtml',
  'runTiming', 'runPlaybackDefaultSeconds', 'runTimeBudget', 'runTimeBudgetHtml', 'paintRunTimeBudget',
  'runTimingRowHtml', 'runTimingEditorHtml', 'bindRunTimingControls', 'updateRunTiming',
  'runSegmentEditorHtml', 'paintRunSegmentSelection', 'selectRunSegment',
  'runPointColor', 'runPathBetween', 'runRouteSvg', 'runView', 'runMapHtml', 'syncRunPhotoFrame',
  'runPlaybackControlsHtml', 'formatRunPlaybackTime', 'bindRunBuilderActions', 'currentRunFormState',
  'refreshMountedRunBuilder', 'runBuilderRefreshView', 'setRunBuilderStage',
  'startRunPointDrag', 'dragRunPoint', 'stopRunPointDrag', 'selectRunPoint',
  'addRunBuilderPoint', 'updateSelectedRunPoint', 'updateRunBuilderMapDom',
  'rememberRunEdit', 'restoreRunEdit', 'focusRunBuilderTrick', 'updateRunBuilderTrick',
];
// Optional only so JKCREW_RUN_SOURCE can demonstrate the original tap-selection failure.
if (app.includes('function bindRunBendControls(')) names.push('bindRunBendControls');
const unusedHandlers = [...new Set([...extract('bindRunBuilderActions')
  .matchAll(/addEventListener\("[^"]+", (\w+)\)/g)].map(match => match[1]))]
  .filter(name => !names.includes(name));

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.JKCREW_BROWSER_PATH });
  try {
    for (const mobile of [true, false]) {
      const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 }, isMobile: mobile, hasTouch: mobile });
      page.setDefaultTimeout(5000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => route.abort());
      await page.setContent('<html data-theme="dark"><meta name="viewport" content="width=device-width, initial-scale=1"><body><main id="host" style="padding:16px;max-width:1100px;margin:auto"></main></body></html>');
      await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'styles.css'), 'utf8') });
      await page.addScriptTag({ content: `
        const state={user:{id:'rider'},profile:{role:'athlete'},view:'contests',draggedRunPoint:null,runPointMapClickBlockUntil:0,runPointDragClickBlockUntil:0};
        let liveRun=null,editable=true,runUndoStack=[],runRedoStack=[];
        const RUN_PLAYBACK_MAX_SECONDS=3600;
        const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        const isCoachRole=role=>role==='coach',notify=()=>{},stopRunPlayback=()=>{};
        const liveRunCanEdit=()=>editable,liveRunBarHtml=()=>'',liveRunWorkspaceHtml=()=>'',bindLiveRunControls=()=>{},bindRiderSavedRuns=()=>{};
        const bindRunPlaybackControls=(root=document)=>root.querySelectorAll('[data-run-map-preview]').forEach(preview=>{const img=preview.querySelector('img');syncRunPhotoFrame(preview);img.addEventListener('load',()=>syncRunPhotoFrame(preview),{once:true});});
        ${unusedHandlers.map(name => 'const ' + name + '=()=>{};').join('\n')}
        ${names.map(extract).join('\n')}
        window.seed=(options={})=>{
          liveRun=options.live?{}:null;editable=true;runUndoStack=[];runRedoStack=[];
          state.draggedRunPoint=null;state.runPointMapClickBlockUntil=0;state.runPointDragClickBlockUntil=0;
          state.runBuilder={title:'Curve regression',stage:'route',selectedPointIndex:0,liveToolsCollapsed:Boolean(options.live),
            imageDataUrl:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#234e48"/></svg>'),
            points:[{id:'a',x:15,y:22,bend:0,travelSeconds:3},{id:'b',x:80,y:22,bend:25,label:'Manual',travelSeconds:4},{id:'c',x:80,y:75,bend:-20,label:'Barspin',travelSeconds:5},{id:'d',x:15,y:75,bend:0}]};
          document.querySelector('#host').innerHTML=runBuilderPanel([],{live:true,showRunList:false});bindRunBuilderActions();
        };
        window.snapshot=()=>structuredClone(state.runBuilder);
        seed();
      ` });
      const label = mobile ? 'touch phone' : 'desktop mouse';
      const activate = locator => mobile ? locator.tap() : locator.click();
      const pathFor = index => page.locator('[data-run-segment="' + (index + 1) + '"]');
      const slider = () => page.locator('[data-selected-run-bend]:visible').first();
      const setRange = async (locator, fraction) => {
        await locator.scrollIntoViewIfNeeded();
        await locator.click({ trial: true });
        // Selecting a line scrolls its editor smoothly; wait for stable native hit coordinates.
        await locator.evaluate(el=>new Promise(resolve=>{let previous='',stable=0;const tick=()=>{const r=el.getBoundingClientRect(),next=[r.x,r.y,r.width,r.height].join(',');stable=next===previous?stable+1:0;previous=next;if(stable>=4)resolve();else requestAnimationFrame(tick);};tick();}));
        const box = await locator.boundingBox();
        assert(box && box.width > 50, label + ': slider is reachable');
        const value = await locator.evaluate(input => ({ value: Number(input.value), min: Number(input.min), max: Number(input.max) }));
        const fromX = box.x + 12 + (box.width - 24) * (value.value - value.min) / (value.max - value.min);
        const toX = box.x + 12 + (box.width - 24) * fraction, y = box.y + box.height / 2;
        if (mobile) {
          const cdp = await page.context().newCDPSession(page);
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fromX, y }] });
          for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: fromX + (toX - fromX) * i / 6, y }] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await cdp.detach();
        } else {
          await page.mouse.move(fromX, y);await page.mouse.down();await page.mouse.move(toX, y, { steps: 6 });await page.mouse.up();
        }
        return Number(await locator.inputValue());
      };
      const assertCurve = async (index, value, before) => {
        const actual = await page.evaluate(index => {
          const p=state.runBuilder.points,svg=document.querySelector('[data-run-segment="'+(index+1)+'"]');
          const midpoint=svg.getPointAtLength(svg.getTotalLength()/2),a=p[index-1],b=p[index];
          return {bend:p[index].bend,path:svg.getAttribute('d'),hit:document.querySelector('[data-edit-run-segment="'+(index-1)+'"]').getAttribute('d'),distance:Math.abs((b.x-a.x)*(midpoint.y-a.y)-(b.y-a.y)*(midpoint.x-a.x))/Math.hypot(b.x-a.x,b.y-a.y)};
        }, index);
        assert.equal(actual.bend,value,label+': slider writes the chosen endpoint');
        assert.notEqual(actual.path,before,label+': visible SVG path changes');
        assert.equal(actual.hit,actual.path,label+': touch hit area follows the curve');
        assert(actual.distance>2,label+': drawn curve bends away from the straight segment');
      };

      for (const live of [false,true]) {
        await page.evaluate(live=>seed({live}),live);
        await page.waitForFunction(()=>document.querySelector('#run-map img').naturalWidth>0);
        if(live)assert(await page.locator('#run-workspace-editor-body').isHidden());
        // Title edits live in the form until the next action captures them.
        const draftTitle=label+' unsaved '+(live?'shared':'private')+' title';
        await page.locator('#run-title').fill(draftTitle);
        assert.equal(await page.evaluate(()=>state.runBuilder.title),'Curve regression','Title is still a DOM-only edit before selecting a dot');
        // An actual no-movement gesture used to select state only and leave dot 1's disabled editor mounted.
        await activate(page.locator('[data-run-point-index="1"]'));
        assert.equal(await page.evaluate(()=>state.runBuilder.selectedPointIndex),1);
        assert.equal(await page.locator('#run-title').inputValue(),draftTitle,label+': dot selection preserves the unsaved title in the remounted form');
        assert.equal(await page.evaluate(()=>state.runBuilder.title),draftTitle,label+': dot selection captures the unsaved title in the draft');
        assert.equal(await page.locator('[data-selected-run-point]').getAttribute('data-selected-run-point'),'1',label+': tapping dot 2 refreshes the start-dot editor');
        assert(await slider().isEnabled(),label+': tapping dot 2 enables bend editing');
        if(live)assert(await page.locator('#run-workspace-editor-body').isVisible(),label+': selecting a dot opens collapsed live tools');
        assert.equal(await slider().inputValue(),'25');
        const before=await pathFor(1).getAttribute('d'),unchanged=await pathFor(2).getAttribute('d');
        const value=await setRange(slider(),.85);
        assert(value>40,label+': real slider drag changes its value');
        await assertCurve(1,value,before);
        assert.equal(await pathFor(2).getAttribute('d'),unchanged,label+': changing the incoming line leaves its neighbour intact');
        assert.equal(await page.evaluate(()=>state.runBuilder.points.length),4,'Dot selection never adds a route point');
        // Selecting another dot must update its value and accept a negative bend.
        await activate(page.locator('[data-run-point-index="2"]'));
        assert.equal(await page.locator('[data-selected-run-point]').getAttribute('data-selected-run-point'),'2');
        assert.equal(await slider().inputValue(),'-20');
        const prior=await pathFor(2).getAttribute('d'),negative=await setRange(slider(),.1);
        assert(negative < -40);await assertCurve(2,negative,prior);
        if(live){
          await activate(page.locator('[data-run-sheet-toggle]'));assert(await page.locator('#run-workspace-editor-body').isHidden());
          await activate(page.locator('[data-run-point-index="2"]'));
          assert(await page.locator('#run-workspace-editor-body').isVisible(),'Tapping the already selected dot reopens its live tools');
        }
      }

      await page.evaluate(()=>seed());
      await page.locator('[data-run-point-index="1"]').focus();await page.keyboard.press('Enter');
      assert.equal(await page.locator('[data-selected-run-point]').getAttribute('data-selected-run-point'),'1','Keyboard selection refreshes the same controls');
      assert(await slider().isEnabled());

      // Finish-route selection is cleared in Tricks/Watch. Build must restore an editable route dot.
      await page.evaluate(()=>seed());
      await activate(page.locator('.run-finish-actions [data-run-builder-stage="tricks"]'));
      assert.equal(await page.evaluate(()=>state.runBuilder.selectedPointIndex),-1);
      await activate(page.locator('[data-run-mode="playback"]'));
      await activate(page.locator('[data-run-mode="route"]'));
      const selected=await page.evaluate(()=>state.runBuilder.selectedPointIndex);
      assert(selected>0,label+': Watch → Build restores a non-start route point');
      assert.equal(await page.locator('[data-selected-run-point]').getAttribute('data-selected-run-point'),String(selected));
      assert(await slider().isEnabled());

      // A line editor owns its endpoint independently of the separately selected dot.
      for (const stage of ['route','tricks']) for (const live of [false,true]) {
        await page.evaluate(({stage,live})=>{seed({live});state.runBuilder.stage=stage;state.runBuilder.selectedPointIndex=3;refreshMountedRunBuilder();},{stage,live});
        const hit=page.locator('[data-edit-run-segment="0"]');
        await hit.scrollIntoViewIfNeeded();
        const midpoint=await hit.evaluate(el=>{const p=el.getPointAtLength(el.getTotalLength()/2);return new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM()).toJSON();});
        if(mobile)await page.touchscreen.tap(midpoint.x,midpoint.y);else await page.mouse.click(midpoint.x,midpoint.y);
        const curve=page.locator('[data-run-segment-editor] [data-run-bend-index="1"]');
        assert(await curve.isVisible(),label+': '+stage+' line editor exposes its curve');
        if(live)assert(await page.locator('#run-workspace-editor-body').isVisible(),'Selecting a line opens collapsed live tools');
        const before=await pathFor(1).getAttribute('d'),other=await page.evaluate(()=>state.runBuilder.points[3].bend);
        const value=await setRange(curve,.8);assert(value>40,label+': '+stage+' native line slider drag changes its value');await assertCurve(1,value,before);
        assert.equal(await page.evaluate(()=>state.runBuilder.points[3].bend),other,'Line editing does not bend the separately selected dot');
        // The rendered line survives serialization and a normal panel remount.
        await page.evaluate(()=>{state.runBuilder.points=JSON.parse(JSON.stringify(state.runBuilder.points));refreshMountedRunBuilder();});
        assert.equal(await curve.inputValue(),String(value));
        assert.equal(await page.locator('[data-run-bend-output-index="1"]').first().innerText(),String(value));
        await page.evaluate(()=>{editable=false;const control=document.querySelector('[data-run-segment-editor] [data-run-bend-index="1"]');control.value='-100';control.dispatchEvent(new Event('input',{bubbles:true}));});
        assert.equal(await page.evaluate(()=>state.runBuilder.points[1].bend),value,'Read-only participant cannot mutate a bend through input');
      }
      assert.deepEqual(errors,[],label+': no browser errors');
      await page.close();
    }
  } finally { await browser.close(); }
  console.log('PASS: touch/mouse/keyboard dot selection, positive/negative native curve drags, private/live layouts and collapsed tools, unsaved title preservation, SVG geometry/hit targets, Watch→Build selection, explicit Route/Tricks line endpoints, reload and read-only protection.');
})().catch(error=>{console.error(error);process.exit(1);});
