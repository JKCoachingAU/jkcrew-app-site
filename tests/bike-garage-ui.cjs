const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const fixtureHtml = '<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"><div class="app-shell coach-shell"><aside class="sidebar"><strong>JKCREW</strong></aside><div class="main-wrap"><main id="view" class="content" data-view="bikeGarage"></main></div></div></div></body></html>';
const fixtureScript = `
window.cloud = {}; window.rpcCalls = []; window.rpcModes = []; window.pendingRpc = [];
window.currentUser = 'rider-a'; window.backCalls = 0; window.confirmCalls = []; window.confirmAnswer = true;
window.confirm = message => { confirmCalls.push(message); return confirmAnswer; };
const clone = value => JSON.parse(JSON.stringify(value));
function reply(method,args,owner) {
  const rows = cloud[owner] ||= [];
  if (method==='get_bike_garage') return {data:{builds:clone(rows)}};
  const row = rows.find(row=>row.slot===args.p_slot);
  if ((row?.revision||0)!==args.p_expected_revision) return {error:{code:'40001',message:'Garage space changed on another device'}};
  if (method==='save_bike_build') {
    const saved = {slot:args.p_slot,name:args.p_name,configuration:clone(args.p_configuration),revision:(row?.revision||0)+1,updated_at:new Date().toISOString()};
    cloud[owner]=[...rows.filter(row=>row.slot!==args.p_slot),saved].sort((a,b)=>a.slot-b.slot);
    return {data:clone(saved)};
  }
  if (method==='delete_bike_build') {cloud[owner]=rows.filter(row=>row.slot!==args.p_slot);return {data:{deleted:true}};}
  throw new Error('Unexpected RPC: '+method);
}
const client = { rpc(method,args) {
  const owner=currentUser; rpcCalls.push({method,args:args?clone(args):null,owner});
  const index=rpcModes.findIndex(mode=>mode.method===method);
  const mode=index<0?{}:rpcModes.splice(index,1)[0];
  if(mode.type==='hold') return new Promise(resolve=>pendingRpc.push({method,owner,resolve:()=>resolve(reply(method,args,owner))}));
  if(mode.type==='commit-error') {reply(method,args,owner);return Promise.resolve({error:{code:'NETWORK',message:'Reply lost after commit'}});}
  if(mode.type==='error') return Promise.resolve({error:{code:mode.code||'NETWORK',message:mode.message||'Connection interrupted'}});
  if(mode.type==='invalid') return Promise.resolve({data:{}});
  return Promise.resolve(reply(method,args,owner));
}};
function mountGarage(owner='rider-a') {
  currentUser=owner;
  JKCrewBikeGarage.mount({root:document.querySelector('#view'),client,userId:owner,isCurrent:()=>currentUser===owner,onBack:()=>backCalls++});
}
`;
async function boot(page) {
  await page.goto('https://jkcrew.fixture/garage');
  for(const file of ['styles.css','bike-garage.css']) await page.addStyleTag({content:fs.readFileSync(path.join(root,file),'utf8')});
  for(const file of ['bike-renderer.js','bike-garage.js']) await page.addScriptTag({content:fs.readFileSync(path.join(root,file),'utf8')});
  await page.addScriptTag({content:fixtureScript});
  await page.evaluate(()=>mountGarage());
  await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);
}
async function checkStickyPreview(page) {
  for(const [width,height] of [[390,900],[320,650]]) {
    await page.setViewportSize({width,height});
    await page.locator('.bike-palette').evaluate((el,height)=>{const bounds=el.getBoundingClientRect();window.scrollBy(0,bounds.top-(height>700?500:410));},height);
    const sticky=await page.locator('.bike-stage').evaluate(el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,position:getComputedStyle(el).position};});
    assert.equal(sticky.position,'sticky');assert(Math.abs(sticky.top-78)<2,`${width} phone bike stays pinned at 78px (${sticky.top})`);
    const swatch=page.getByRole('button',{name:'Electric blue frame',exact:true});
    const clear=await swatch.evaluate(el=>{const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {y,visible:y>0&&y<innerHeight,hit:el.contains(document.elementFromPoint(x,y))};});
    const blank=page.getByRole('button',{name:'+ Blank bike',exact:true});
    assert(await blank.isVisible());assert((await blank.boundingBox()).height>=44,'Sticky Blank bike control keeps a full touch target');
    assert(clear.visible&&clear.y>sticky.bottom&&clear.hit,`${width}: sticky bike leaves the palette visible and tappable`);
    await swatch.click();assert.equal(await page.locator('#bmx-garage-main-frame stop').nth(1).getAttribute('stop-color'),'#428CFF');
    if(width===390)await page.screenshot({path:'/tmp/bike-garage-phone-editing.png'});
    await page.getByRole('button',{name:'Undo last change',exact:true}).click();
  }
}
async function run(page) {
  for(const [width,name] of [[390,'phone'],[1440,'desktop']]) {
    await page.setViewportSize({width,height:900});
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:`/tmp/bike-garage-${name}.png`,fullPage:true});
    await page.getByRole('button',{name:'Expand bike preview',exact:true}).click();
    await page.screenshot({path:`/tmp/bike-garage-white-${name}-preview.png`});
    await page.getByRole('button',{name:'Close bike preview',exact:true}).click();await page.locator('.bike-fullscreen').waitFor({state:'detached'});
  }
  console.log('Screenshots ready: /tmp/bike-garage-phone.png and /tmp/bike-garage-desktop.png');
  if(process.env.JKCREW_BIKE_SCREENSHOTS_ONLY) return;
  await checkStickyPreview(page);
  if(process.env.JKCREW_BIKE_STICKY_ONLY) return;
  const draft = () => page.evaluate(()=>JSON.parse(localStorage.getItem(`jkcrew-bike-draft-v1:${currentUser}`)||'null'));
  const config = async () => (await draft()).configuration;
  const nameField = () => page.getByRole('textbox',{name:'NAME YOUR BUILD',exact:true});
  const count = method => page.evaluate(method=>rpcCalls.filter(call=>call.method===method).length,method);
  const save = async () => {await page.locator('[data-bike-save]').click();await page.getByText('Saved to your garage ✓',{exact:true}).waitFor();};
  const refresh = async () => {await page.getByRole('button',{name:'Refresh garage',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);};
  const selectPart = async part => {const button=page.locator(`[data-bike-art] [data-bike-part="${part}"]`).first();await button.focus();await button.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement?.dataset.bikePart),part,'Keyboard selection retains SVG focus');};
  const frameColour = () => page.locator('#bmx-garage-main-frame stop').nth(1).getAttribute('stop-color');
  const shelf = async () => {if(!await page.locator('[data-bike-garage]').evaluate(el=>el.open))await page.locator('[data-bike-garage] summary').click();};
  assert.equal(await page.locator('[data-bike-garage]').evaluate(el=>el.open),false,'Collection starts closed');
  assert.equal(await count('save_bike_build'),0);assert.equal(await count('delete_bike_build'),0);
  const neutralDefaults=await page.evaluate(()=>JKCrewBikeGarage.defaults);
  assert.equal(Object.keys(neutralDefaults.colors).length,10);assert(Object.values(neutralDefaults.colors).every(colour=>colour==='#F1F4F8'),'Every blank-bike part starts neutral white');
  assert.equal(neutralDefaults.tyreStyle,'white');assert.equal(neutralDefaults.pegs,'none');assert.equal(neutralDefaults.decal,'none');
  assert.equal(await page.locator('[data-bike-new]').count(),1,'Only one Blank bike action exists');
  assert(await page.locator('.bike-stage-top').getByRole('button',{name:'+ Blank bike',exact:true}).isVisible(),'Blank bike is available while the garage shelf is closed');
  const normalized=await page.evaluate(()=>JKCrewBikeGarage.normalize({colors:{frame:'#abcd12',fork:'url(secret)',unrelated:'#000000'},barStyle:'unsupported',pegs:'rear',private_data:'never'}));
  assert.equal(normalized.colors.frame,'#ABCD12');assert.equal(normalized.colors.fork,'#F1F4F8');assert.equal(normalized.barStyle,'two-piece');assert.equal(normalized.pegs,'rear');assert(!('private_data' in normalized));assert(!('unrelated' in normalized.colors));

  // Existing colourful bikes retain their saved appearance; Blank bike affects only the draft.
  await page.evaluate(()=>{
    window.legacyBike={version:1,colors:{frame:'#AD8AFF',fork:'#252B39',bars:'#252B39',grips:'#AD8AFF',rims:'#BCC7D6',hubs:'#AD8AFF',seat:'#252B39',pedals:'#AD8AFF',cranks:'#BCC7D6',sprocket:'#AD8AFF'},barStyle:'four-piece',tyreStyle:'tan-wall',seatStyle:'padded',pegs:'both',decal:'jkcrew'};
    cloud['legacy-bike']=[{slot:1,name:'Existing coloured bike',configuration:clone(legacyBike),revision:7,updated_at:new Date().toISOString()}];mountGarage('legacy-bike');
  });
  await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);await shelf();await page.locator('[data-bike-load="1"]').click();
  assert.deepEqual(await config(),await page.evaluate(()=>legacyBike),'Opening an existing saved bike never applies new blank defaults');
  assert.equal(await frameColour(),'#AD8AFF');
  await page.evaluate(()=>mountGarage('legacy-bike'));await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);
  assert.deepEqual(await config(),await page.evaluate(()=>legacyBike),'Remount preserves existing saved colours and styles');
  const originalSavedRows=await page.evaluate(()=>JSON.stringify(cloud['legacy-bike']));
  await nameField().fill('Unfinished custom idea');await page.getByRole('button',{name:'Pink frame',exact:true}).click();
  const unfinished=await draft();const writesBeforeBlank=await count('save_bike_build');
  await page.evaluate(()=>confirmAnswer=false);await page.getByRole('button',{name:'+ Blank bike',exact:true}).click();
  assert.deepEqual(await draft(),unfinished,'Cancelling Blank bike preserves all draft state');assert.equal(await nameField().inputValue(),'Unfinished custom idea');
  await page.evaluate(()=>confirmAnswer=true);await page.getByRole('button',{name:'+ Blank bike',exact:true}).click();
  assert.deepEqual(await config(),neutralDefaults,'Confirmed Blank bike resets every part/style to neutral defaults');
  assert.equal(await nameField().inputValue(),'My dream bike');assert.equal((await draft()).slot,null);assert.equal((await draft()).revision,0);assert.equal((await draft()).pendingSave,null);
  assert(await page.getByRole('button',{name:'Undo last change',exact:true}).isDisabled());assert(await page.getByRole('button',{name:'Redo change',exact:true}).isDisabled());
  assert.equal(await count('save_bike_build'),writesBeforeBlank,'Blank bike never writes to the garage automatically');
  assert.equal(await page.evaluate(()=>JSON.stringify(cloud['legacy-bike'])),originalSavedRows,'Existing saved rows remain intact after Blank bike');
  await nameField().fill('White studio build');await save();
  assert.equal(await page.evaluate(()=>cloud['legacy-bike'].length),2);assert.deepEqual(await page.evaluate(()=>cloud['legacy-bike'].find(row=>row.slot===2).configuration),neutralDefaults,'All-white tyres and parts survive save roundtrip');
  await page.evaluate(()=>mountGarage('legacy-bike'));await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);await shelf();
  await page.locator('[data-bike-load="1"]').click();assert.deepEqual(await config(),await page.evaluate(()=>legacyBike));
  await page.locator('[data-bike-load="2"]').click();assert.deepEqual(await config(),neutralDefaults,'Opening the saved white build retains white tyres');
  await page.evaluate(()=>mountGarage('rider-a'));await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);

  const savesBeforeEditing=await count('save_bike_build');

  // Changes repaint the real SVG; selecting and colouring remain keyboard-accessible.
  await page.setViewportSize({width:390,height:900});
  const originalColour=await frameColour();
  await page.getByRole('button',{name:'Electric blue frame',exact:true}).click();
  assert.equal(await frameColour(),'#428CFF');assert.equal((await config()).colors.frame,'#428CFF');
  assert.equal(await page.evaluate(()=>document.activeElement?.dataset.bikeColour),'#428CFF','Palette repaint keeps keyboard focus');
  await page.getByRole('button',{name:'Undo last change',exact:true}).click();assert.equal(await frameColour(),originalColour);
  await page.getByRole('button',{name:'Redo change',exact:true}).click();assert.equal(await frameColour(),'#428CFF');
  for(const [part,label] of [['fork','forks'],['bars','handlebars'],['grips','grips'],['rims','rims'],['hubs','hubs'],['seat','seat'],['pedals','pedals'],['cranks','cranks'],['sprocket','sprocket']]) {
    await selectPart(part);await page.getByRole('button',{name:`Mint ${label}`,exact:true}).click();
    assert.equal((await config()).colors[part],'#7CE3B8');
    assert.equal(await page.locator(`#bmx-garage-main-${part} stop`).nth(1).getAttribute('stop-color'),'#7CE3B8');
  }
  for(const [part,key,choices] of [['bars','barStyle',[['Four piece','four-piece'],['Two piece','two-piece']]],['tyres','tyreStyle',[['Tan wall','tan-wall'],['White wall','white-wall'],['All black','black'],['All white','white']]],['seat','seatStyle',[['Padded','padded'],['Slim','slim']]],['pegs','pegs',[['Rear only','rear'],['Front & rear','both'],['No pegs','none']]],['decal','decal',[['Lightning','lightning'],['Clean frame','none'],['JKCREW','jkcrew']]]]) {
    await selectPart(part);
    for(const [label,value] of choices){const before=await page.locator(`[data-bike-art] [data-bike-part="${part}"]`).first().innerHTML();await page.getByRole('button',{name:label,exact:true}).click();assert.equal((await config())[key],value);assert.notEqual(await page.locator(`[data-bike-art] [data-bike-part="${part}"]`).first().innerHTML(),before,`${label} changes real artwork`);}
  }
  await selectPart('frame');
  await page.getByRole('textbox',{name:'NAME YOUR BUILD',exact:true}).fill('Night Rider');
  await page.getByLabel('Custom frame colour',{exact:true}).evaluate(input=>{input.value='#123abc';input.dispatchEvent(new Event('change',{bubbles:true}));});
  assert.equal(await frameColour(),'#123ABC');
  const firstConfig=await config();
  assert.equal(await count('save_bike_build'),savesBeforeEditing,'Editing never saves automatically');
  await page.evaluate(()=>mountGarage());await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);
  assert.equal(await nameField().inputValue(),'Night Rider');assert.deepEqual(await config(),firstConfig,'Unmount/remount restores local draft');
  await boot(page);assert.equal(await nameField().inputValue(),'Night Rider');assert.equal(await frameColour(),'#123ABC','Full page reload restores durable local draft');
  await page.evaluate(()=>mountGarage('rider-b'));await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);
  assert.equal(await nameField().inputValue(),'My dream bike');assert.equal(await frameColour(),'#F1F4F8');
  await nameField().fill('Rider B only');
  await page.evaluate(()=>mountGarage('rider-a'));await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);
  assert.equal(await nameField().inputValue(),'Night Rider','Accounts never inherit each other’s drafts');

  // Save exactly three private slots; copying does not overwrite the original.
  await save();assert.equal(await page.locator('[data-bike-count]').textContent(),'1 / 3');
  let calls=await page.evaluate(()=>rpcCalls.filter(call=>call.method==='save_bike_build'));
  assert.equal(calls.at(-1).args.p_slot,1);assert.equal(calls.at(-1).args.p_expected_revision,0);
  await nameField().fill('Acid Session');await page.getByRole('button',{name:'Acid frame',exact:true}).click();
  await page.getByRole('button',{name:'Save as new',exact:true}).click();await page.getByText('Saved to your garage ✓',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-bike-count]').textContent(),'2 / 3');
  assert.equal(await page.evaluate(()=>cloud['rider-a'][0].name),'Night Rider');
  await nameField().fill('Finals Bike');await page.getByRole('button',{name:'Coral frame',exact:true}).click();
  await page.getByRole('button',{name:'Save as new',exact:true}).click();await page.getByText('Saved to your garage ✓',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-bike-count]').textContent(),'3 / 3');assert(await page.getByRole('button',{name:'Save as new',exact:true}).isDisabled());
  await shelf();const fullSaveCount=await count('save_bike_build');await page.getByRole('button',{name:'+ Blank bike',exact:true}).click();await page.locator('[data-bike-save]').click();await page.getByText(/three garage spaces are full/).waitFor();assert.equal(await count('save_bike_build'),fullSaveCount,'A full garage cannot create a fourth slot');
  await page.locator('[data-bike-load="1"]').click();assert.equal(await nameField().inputValue(),'Night Rider');
  await nameField().fill('Night Rider II');await save();assert.equal(await page.evaluate(()=>cloud['rider-a'][0].revision),2);
  await page.evaluate(()=>mountGarage());await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);await shelf();
  assert.equal(await page.locator('.bike-saved-card').count(),3);assert.equal(await nameField().inputValue(),'Night Rider II');
  const beforeDelete=await count('delete_bike_build');
  await page.evaluate(()=>confirmAnswer=false);await page.getByRole('button',{name:'Remove Acid Session',exact:true}).click();
  assert.equal(await count('delete_bike_build'),beforeDelete,'Cancelled removal has no RPC');
  await page.evaluate(()=>confirmAnswer=true);await page.getByRole('button',{name:'Remove Acid Session',exact:true}).click();
  await page.getByText('Removed from your garage.',{exact:true}).waitFor();assert.equal(await page.locator('[data-bike-count]').textContent(),'2 / 3');
  assert.equal(await page.evaluate(()=>cloud['rider-a'].map(row=>row.slot).join(',')),'1,3');
  await nameField().fill('Space Two');await page.getByRole('button',{name:'Save as new',exact:true}).click();await page.getByText('Saved to your garage ✓',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>rpcCalls.filter(call=>call.method==='save_bike_build').at(-1).args.p_slot),2,'Freed slot is reused without touching others');

  // A failed save never claims success or enables blind retries against stale rows.
  await nameField().fill('Kept after failure');
  await page.evaluate(()=>rpcModes.push({method:'save_bike_build',type:'error'}));await page.locator('[data-bike-save]').click();
  await page.getByText(/The save wasn't confirmed/).waitFor();assert(await page.locator('[data-bike-save]').isDisabled());assert(await page.getByRole('button',{name:'Refresh garage',exact:true}).isVisible());
  assert.equal(await nameField().inputValue(),'Kept after failure');
  await refresh();assert.equal(await nameField().inputValue(),'Kept after failure');await save();

  // A real revision conflict preserves the local design until opening the latest saved bike.
  await nameField().fill('Local conflict draft');
  await page.evaluate(()=>{const row=cloud['rider-a'].find(row=>row.slot===2);row.name='Cloud latest';row.revision++;row.configuration.colors.frame='#51D5E8';});
  await page.locator('[data-bike-save]').click();await page.getByText(/garage space changed on another device/).waitFor();
  assert(await page.locator('[data-bike-save]').isDisabled());await refresh();
  assert.equal(await nameField().inputValue(),'Local conflict draft','Refresh does not erase the unsaved draft');
  await shelf();await page.locator('[data-bike-load="2"]').click();assert.equal(await nameField().inputValue(),'Cloud latest');assert.equal(await frameColour(),'#51D5E8');
  await nameField().fill('Updated cloud version');await save();assert.equal(await page.evaluate(()=>cloud['rider-a'].find(row=>row.slot===2).name),'Updated cloud version');
  // Error while loading keeps designing available and retry reachable outside the closed shelf.
  await page.evaluate(()=>{rpcModes.push({method:'get_bike_garage',type:'error'});mountGarage();});
  await page.getByText(/garage could not load/).waitFor();assert.equal(await page.locator('[data-bike-garage]').evaluate(el=>el.open),false);
  assert(await page.getByRole('button',{name:'Refresh garage',exact:true}).isVisible());assert(await page.locator('[data-bike-save]').isDisabled());
  await page.getByRole('button',{name:'Pink frame',exact:true}).click();await refresh();assert.equal(await frameColour(),'#E789D0');

  // The 15-second timeout releases busy controls and requires a safe refresh.
  assert(page.clock?.install && page.clock?.fastForward,'Playwright clock is available for timeout coverage');
  await page.clock.install();await page.evaluate(()=>rpcModes.push({method:'save_bike_build',type:'hold'}));
  await page.locator('[data-bike-save]').click();assert(await nameField().isDisabled());
  await page.clock.fastForward(15001);await page.getByText(/The save wasn't confirmed/).waitFor();
  assert(!(await nameField().isDisabled()));assert(await page.locator('[data-bike-save]').isDisabled());
  await page.evaluate(()=>pendingRpc.shift().resolve());await refresh();
  assert.equal(await frameColour(),'#E789D0','An uncertain save reply does not replace the draft');

  // Late old-account responses are disposed without repainting or changing another draft.
  await nameField().fill('Pending old account');await page.evaluate(()=>rpcModes.push({method:'save_bike_build',type:'hold'}));await page.locator('[data-bike-save]').click();
  await page.evaluate(()=>mountGarage('rider-b'));await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);
  await page.evaluate(()=>pendingRpc.shift().resolve());assert.equal(await nameField().inputValue(),'Rider B only');assert.equal(await page.locator('[data-bike-count]').textContent(),'0 / 3');
  await page.evaluate(()=>{rpcModes.push({method:'get_bike_garage',type:'hold'});mountGarage('rider-a');currentUser='departed-account';});
  const beforeStale=await page.locator('#view').innerHTML();await page.evaluate(()=>pendingRpc.shift().resolve());assert.equal(await page.locator('#view').innerHTML(),beforeStale,'isCurrent blocks late refresh repaint');
  await page.evaluate(()=>{JKCrewBikeGarage.destroy();mountGarage('rider-b');});await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);

  // A server commit with a lost reply is recovered by exact snapshot, never duplicated.
  await page.evaluate(()=>mountGarage('uncertain-save'));await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);
  await nameField().fill('Cloud saved once');await page.evaluate(()=>rpcModes.push({method:'save_bike_build',type:'commit-error'}));
  await page.locator('[data-bike-save]').click();await page.getByText(/The save wasn't confirmed/).waitFor();
  assert.equal(await page.evaluate(()=>cloud['uncertain-save'].length),1);
  await nameField().fill('Newer local idea');await page.getByRole('button',{name:'Gold frame',exact:true}).click();
  await refresh();assert.equal(await nameField().inputValue(),'Newer local idea');assert.equal(await frameColour(),'#F2BC57','Recovery preserves edits made after the uncertain save');
  assert.equal((await draft()).revision,1,'Refresh adopts the remotely committed revision');
  assert.equal((await draft()).slot,1);assert.equal((await draft()).pendingSave,null);
  await save();const recoveredCall=await page.evaluate(()=>rpcCalls.filter(call=>call.method==='save_bike_build').at(-1));
  assert.equal(recoveredCall.args.p_slot,1);assert.equal(recoveredCall.args.p_expected_revision,1);assert.equal(await page.evaluate(()=>cloud['uncertain-save'].length),1,'Retry updates the same slot instead of creating a duplicate');
  await shelf();await page.evaluate(()=>rpcModes.push({method:'delete_bike_build',type:'error'}));await page.getByRole('button',{name:'Remove Newer local idea',exact:true}).click();
  await page.getByText(/Could not remove/).waitFor();assert(await page.locator('[data-bike-save]').isDisabled());assert.equal(await page.locator('.bike-saved-card').count(),1,'A failed remove keeps the saved card');
  await refresh();await page.getByRole('button',{name:'Remove Newer local idea',exact:true}).click();await page.getByText('Removed from your garage.',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-bike-count]').textContent(),'0 / 3');assert.equal(await nameField().inputValue(),'Newer local idea','Removing current saved bike retains its editable draft');
  assert.equal((await draft()).slot,null);assert.equal((await draft()).revision,0);
  await page.evaluate(()=>{rpcModes.push({method:'get_bike_garage',type:'hold'});mountGarage('loading-test');});
  assert(await page.locator('[data-bike-save]').isDisabled(),'Save is disabled while the garage is loading');
  await page.evaluate(()=>pendingRpc.shift().resolve());await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);

  // Disabled localStorage retains a per-account draft for this visit and warns on exit.
  await page.evaluate(()=>{window.realStorageGet=Storage.prototype.getItem;window.realStorageSet=Storage.prototype.setItem;Storage.prototype.getItem=function(){throw new Error('Storage blocked')};Storage.prototype.setItem=function(){throw new Error('Storage blocked')};mountGarage('memory-a');});
  await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);await nameField().fill('Memory-only bike');
  assert(await page.getByText(/Draft kept for this visit/).isVisible());
  assert.equal(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;}),true);
  await page.evaluate(()=>mountGarage('memory-b'));await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);assert.equal(await nameField().inputValue(),'My dream bike');
  await page.evaluate(()=>mountGarage('memory-a'));await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);assert.equal(await nameField().inputValue(),'Memory-only bike');
  await page.evaluate(()=>{Storage.prototype.getItem=realStorageGet;Storage.prototype.setItem=realStorageSet;mountGarage('rider-a');});await page.waitForFunction(()=>!document.querySelector('[data-bike-save]').disabled);

  // Real app styling in both roles, themes and narrow widths; full-screen stays a clean fitted view.
  for(const role of ['rider','coach'])for(const width of [320,390,1024])for(const theme of ['dark','light']) {
    await page.setViewportSize({width,height:900});await page.evaluate(({role,theme})=>{document.querySelector('.app-shell').className=`app-shell ${role}-shell`;document.documentElement.dataset.theme=theme;window.scrollTo(0,0);},{role,theme});
    const geometry=await page.locator('.bike-garage').evaluate(el=>({scroll:el.scrollWidth,width:el.clientWidth,document:document.documentElement.scrollWidth,viewport:innerWidth}));
    assert(geometry.scroll<=geometry.width+1,`${role}/${width}/${theme}: workshop has no overflow`);assert(geometry.document<=geometry.viewport+1,`${role}/${width}/${theme}: page has no overflow`);
    assert(Number(await nameField().evaluate(el=>parseFloat(getComputedStyle(el).fontSize)))>=16,'Name input avoids mobile autozoom');
    await page.getByRole('button',{name:'Expand bike preview',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Full bike preview',exact:true});assert(await dialog.isVisible());assert.equal(await dialog.getByRole('button').count(),1,'Fullscreen only has Close');
    const fit=await dialog.evaluate(el=>{const d=el.getBoundingClientRect(),s=el.querySelector('svg').getBoundingClientRect();return {d:{x:d.x,y:d.y,right:d.right,bottom:d.bottom},s:{x:s.x,y:s.y,right:s.right,bottom:s.bottom},sw:el.scrollWidth,cw:el.clientWidth,sh:el.scrollHeight,ch:el.clientHeight};});
    assert(fit.sw<=fit.cw+1&&fit.sh<=fit.ch+1,`${role}/${width}/${theme}: fullscreen fits without scrolling`);assert(fit.s.x>=fit.d.x&&fit.s.right<=fit.d.right+1&&fit.s.y>=fit.d.y&&fit.s.bottom<=fit.d.bottom+1,`${role}/${width}/${theme}: bike stays inside fullscreen`);
    await page.getByRole('button',{name:'Close bike preview',exact:true}).click();await dialog.waitFor({state:'detached'});
  }
  await page.setViewportSize({width:844,height:390});await page.getByRole('button',{name:'Expand bike preview',exact:true}).click();
  assert(await page.locator('.bike-fullscreen').evaluate(el=>el.scrollHeight<=el.clientHeight+1&&el.scrollWidth<=el.clientWidth+1),'Landscape phone fullscreen fits without scrolling');
  await page.getByRole('button',{name:'Close bike preview',exact:true}).click();await page.locator('.bike-fullscreen').waitFor({state:'detached'});
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('[data-bike-save]').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
  await page.getByRole('button',{name:'← Back',exact:true}).click();assert.equal(await page.evaluate(()=>backCalls),1);
  await page.getByRole('button',{name:'Expand bike preview',exact:true}).click();await page.evaluate(()=>JKCrewBikeGarage.destroy());assert.equal(await page.locator('.bike-fullscreen').count(),0,'Dispose removes a fullscreen preview');
  assert((await page.evaluate(()=>rpcCalls)).every(call=>['get_bike_garage','save_bike_build','delete_bike_build'].includes(call.method)),'No training, scoring, invitation or notification RPCs');
  console.log('PASS: neutral white defaults, preserved colourful builds, safe Blank bike reset/white save roundtrip, live colours/styles, keyboard focus, undo/redo, private drafts/accounts, three-slot CRUD, revisions, safe refresh/retry/timeout, uncertain-commit recovery without duplicates, disposal, blocked-storage fallback, fullscreen, and 320/390/1024 dark/light layouts.');

}
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH});
  try {
    const page=await browser.newPage({viewport:{width:390,height:900}});
    page.setDefaultTimeout(6000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>route.request().url()==='https://jkcrew.fixture/garage'?route.fulfill({contentType:'text/html',body:fixtureHtml}):route.abort());
    await boot(page);await run(page);assert.deepEqual(errors,[]);
    console.log('PASS: isolated Bike Garage UI; no production requests or writes.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error.stack || error);process.exitCode=1;});
