const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {chromium}=require(process.env.JKCREW_PLAYWRIGHT_PATH||'playwright');
const {PNG}=require(require.resolve('pngjs',{paths:[path.dirname(require.resolve(process.env.JKCREW_PLAYWRIGHT_PATH||'playwright'))]}));
const root=path.resolve(__dirname,'..');
const threeRoot=process.env.JKCREW_3D_SOURCE_DIR||root;
const nav=[['◇','Command'],['●','Session'],['✦','Riders'],['⚡','Challenges'],['▤','Coach tools'],['•','More']].map(([icon,label])=>`<button type="button" class="nav-btn"><span class="nav-icon">${icon}</span><span>${label}</span></button>`).join('');
const modules=['bike-parts-catalog.js','bike-config.js','bike-seat-designs.js','bike-photo-masks.js','bike-renderer.js','bike-preview.js','bike-three.js','bike-garage.js'];
let checks=0;
function check(value,message){assert(value,message);checks++;}
function equal(actual,expected,message){assert.deepEqual(actual,expected,message);checks++;}
const fixture=`<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${['styles.css','bike-garage.css','bike-preview.css'].map(file=>`<link rel="stylesheet" href="/${file}">`).join('')}</head><body><div id="app"><div class="app-shell rider-shell"><aside class="sidebar"><div class="sidebar-brand logo-sidebar-brand"><img src="/icons/jkc-logo.png" alt="JK Coaching"><span>JK Coaching</span></div><div class="role-pill">Rider account</div><nav class="nav-list">${nav}</nav></aside><div class="main-wrap"><header class="topbar"><div class="topbar-title"><img class="topbar-logo" src="/icons/jkc-logo.png" alt="">JKCREW live</div><div class="topbar-actions"><span class="sync-status"><i></i><b>Saved</b></span></div></header><main id="view" class="content" data-view="bikeGarage"></main></div><nav class="bottom-nav">${nav}</nav></div></div><button id="install-app" type="button" class="install-app">Install JK Coaching</button>${modules.map(file=>`<script src="/${file}?v=bike-360-regression"></script>`).join('')}<script>
window.testCalls=[];window.testMounts=[];window.testMountPromises=[];window.testOwner='orbit-owner';window.testRows=[];
const actual3D=JKCrewBike3D;
globalThis.JKCrewBike3D={...actual3D,mount(options){const record={disposed:false,resolved:false,started:performance.now(),thumbnail:Boolean(options.element.dataset.bikeThumbnailRenderer!==undefined),configuration:JSON.stringify(options.configuration)};testMounts.push(record);const pending=actual3D.mount(options).then(handle=>{record.resolved=true;record.loadMs=performance.now()-record.started;const update=handle.update;handle.update=config=>{window.testLastUpdate=update(config);return testLastUpdate;};const dispose=handle.dispose;handle.dispose=()=>{record.disposed=true;dispose();};if(!record.thumbnail)window.testHandle=handle;return handle;});testMountPromises.push(pending);return pending;}};
window.testClient={rpc:async(method,args)=>{testCalls.push({method,args});if(method==='get_bike_garage')return {data:{builds:testRows}};if(method==='save_bike_build'){const row={slot:args.p_slot,name:args.p_name,configuration:args.p_configuration,revision:args.p_expected_revision+1,updated_at:new Date().toISOString()};testRows=[row];return {data:row};}throw new Error('Unexpected fixture RPC '+method);}};
window.testMount=(owner='orbit-owner')=>{testOwner=owner;JKCrewBikeGarage.mount({root:document.querySelector('#view'),client:testClient,userId:owner,isCurrent:()=>testOwner===owner,onBack:()=>{}});};
window.testDraft=()=>JSON.parse(localStorage.getItem('jkcrew-bike-draft-v1:'+testOwner)||'null');
window.testReady=true;
</script></body></html>`;
async function server(){
  const requests=[];
  const instance=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');requests.push(url.pathname);
    if(req.method!=='GET'){res.writeHead(405);res.end();return;}
    if(url.pathname==='/fixture'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(fixture);return;}
    const relative=decodeURIComponent(url.pathname).slice(1),base=/^(vendor\/|bike-three(?:-model)?\.js$)/.test(relative)?threeRoot:root;
    const file=path.resolve(base,relative),mime={'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2','.woff':'font/woff'}[path.extname(file)];
    if(!file.startsWith(path.resolve(base)+path.sep)||!mime||!fs.existsSync(file)||!fs.statSync(file).isFile()||!fs.realpathSync(file).startsWith(fs.realpathSync(base)+path.sep)){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':mime.startsWith('text/')?mime+'; charset=utf-8':mime,'Cache-Control':'no-store'});res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>instance.listen(0,'127.0.0.1',resolve));
  return {url:`http://127.0.0.1:${instance.address().port}`,requests,close:()=>new Promise(resolve=>instance.close(resolve))};
}
async function settle(page){
  await page.evaluate(async()=>{let previous='',stable=0;for(let i=0;i<80;i++){await new Promise(requestAnimationFrame);const v=testHandle.getView(),next=[v.yaw,v.polar,v.distance].map(n=>n.toFixed(5)).join(',');stable=next===previous?stable+1:0;previous=next;if(stable>=3)break;}});
}
async function ready(page){await page.waitForFunction(()=>document.querySelector('[data-bike-art][data-view="3d"] canvas')?.dataset.ready==='true');await settle(page);}
async function view(page){return page.evaluate(()=>testHandle.getView());}
function sameView(actual,expected,message){check(['yaw','polar','distance'].every(key=>Math.abs(actual[key]-expected[key])<.00001)&&actual.target.every((n,i)=>Math.abs(n-expected.target[i])<.00001),message);}
async function setView(page,value){await page.evaluate(value=>testHandle.setView(value),value);await settle(page);}
async function resetView(page){await page.evaluate(()=>testHandle.resetView());await settle(page);}
async function image(page){await settle(page);return PNG.sync.read(await page.locator('.bike-three-canvas').screenshot({animations:'disabled',style:'.bike-stage-top,.bike-stage-bottom,.bike-edit-tools{visibility:hidden!important}'}));}
function hash(png){return createHash('sha256').update(png.data).digest('hex');}
function redBounds(png){let minX=png.width,maxX=-1,minY=png.height,maxY=-1,count=0;for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){const i=(y*png.width+x)*4,[r,g,b]=png.data.subarray(i,i+3);if(r>90&&r>g*1.35&&r>b*1.25){count++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}}return {minX,maxX,minY,maxY,count,width:maxX-minX+1,height:maxY-minY+1};}
async function category(page,name){const button=page.locator(`[data-bike-group="${name}"]`);if(await button.getAttribute('aria-expanded')!=='true')await button.click();}
async function part(page,name,group){await category(page,group);if(name==='frame')return;const menu=page.locator('.bike-part-menu');if(!await menu.evaluate(el=>el.open))await menu.locator('summary').click();await page.locator(`[data-bike-select="${name}"]`).click();}
async function closeSheet(page){if(await page.locator('[data-bike-sheet]').isVisible())await page.locator('[data-bike-sheet-close]').click();await settle(page);}
async function point(page,xyz){return page.evaluate(async xyz=>{const T=await import('/vendor/three.module.min.js'),v=testHandle.getView(),canvas=testHandle.canvas,r=canvas.getBoundingClientRect(),camera=new T.PerspectiveCamera(33,r.width/r.height,.01,30),target=new T.Vector3(...v.target);camera.position.copy(target).add(new T.Vector3().setFromSpherical(new T.Spherical(v.distance,v.polar,v.yaw)));camera.lookAt(target);camera.updateMatrixWorld();const p=new T.Vector3(...xyz).project(camera);return {x:r.x+(p.x+1)*r.width/2,y:r.y+(1-p.y)*r.height/2};},xyz);}
async function projectedBounds(page){return page.evaluate(async()=>{
  const T=await import('/vendor/three.module.min.js'),{createBike}=await import('/bike-three-model.js'),model=createBike(testDraft().configuration),v=testHandle.getView(),r=testHandle.canvas.getBoundingClientRect(),camera=new T.PerspectiveCamera(33,r.width/r.height,.01,30),target=new T.Vector3(...v.target);
  camera.position.copy(target).add(new T.Vector3().setFromSpherical(new T.Spherical(v.distance,v.polar,v.yaw)));camera.lookAt(target);camera.updateMatrixWorld();model.group.updateMatrixWorld(true);
  let left=Infinity,right=-Infinity,top=-Infinity,bottom=Infinity;
  model.group.traverse(mesh=>{if(!mesh.isMesh)return;mesh.geometry.computeBoundingBox();const box=mesh.geometry.boundingBox;for(let n=0;n<(mesh.isInstancedMesh?mesh.count:1);n++){const matrix=mesh.matrixWorld.clone();if(mesh.isInstancedMesh){const instance=new T.Matrix4();mesh.getMatrixAt(n,instance);matrix.multiply(instance);}for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){const p=new T.Vector3(x,y,z).applyMatrix4(matrix).project(camera);left=Math.min(left,p.x);right=Math.max(right,p.x);top=Math.max(top,p.y);bottom=Math.min(bottom,p.y);}}});
  model.dispose();return {left,right,top,bottom};
});}
async function checkFit(page,label){const b=await projectedBounds(page);check(b.left>=-1.03&&b.right<=1.03&&b.top<=1.03&&b.bottom>=-1.03,`${label}: every part, including both tyres, fits the canvas (${JSON.stringify(b)})`);}
async function checksForModel(page){
  const results=await page.evaluate(async()=>{const {createBike}=await import('/bike-three-model.js'),T=await import('/vendor/three.module.min.js');const inspect=async patch=>{const model=createBike(JKCrewBikeConfig.normalize(patch));await model.ready;const parts={};for(const [name,group]of Object.entries(model.parts)){const box=new T.Box3().setFromObject(group),size=box.getSize(new T.Vector3());parts[name]={size:size.toArray(),center:box.getCenter(new T.Vector3()).toArray(),meshes:group.children.length,clampCentre:group.userData.clampCentre||null};}const fingerprint=JSON.stringify(model.configuration);model.dispose();return {parts,fingerprint,disposed:model.group.children.length===0};};return {none:await inspect({pegs:'none',brakeStyle:'none'}),right:await inspect({driveSide:'rhd',pegs:'both',brakeStyle:'front',stemStyle:'top-load'}),left:await inspect({driveSide:'lhd',pegs:'both',brakeStyle:'rear',stemStyle:'front-load'}),four:await inspect({pegs:'four',brakeStyle:'dual',barStyle:'four-piece'})};});
  for(const [name,result]of Object.entries(results)){check(result.disposed,`${name}: mesh resources can be disposed`);for(const part of ['frame','fork','bars','rims','tyres','pedals'])check(result.parts[part].size.every(n=>n>.005),`${name}/${part}: actual geometry has volume in all three axes`);}
  check(!results.none.parts.pegs&&!results.none.parts.brakes,'No-pegs/brakeless configuration removes those meshes');
  check(results.right.parts.sprocket.center[2]>0&&results.left.parts.sprocket.center[2]<0,'Drivetrain geometry moves to the selected physical side');
  check(results.right.parts.pegs.center[2]<0&&results.left.parts.pegs.center[2]>0,'Two pegs are physically opposite the drivetrain');
  check(results.four.parts.pegs.size[2]>results.right.parts.pegs.size[2]*2,'Four pegs occupy both sides of the bike');
  check(results.four.parts.brakes.meshes===results.right.parts.brakes.meshes+results.left.parts.brakes.meshes,'Independent front/rear brake meshes combine without replacing one another');
  check(results.right.parts.stem.clampCentre[1]-results.left.parts.stem.clampCentre[1]>.01,'Stem setup changes real attachment geometry');
  check(results.four.parts.bars.meshes!==results.none.parts.bars.meshes,'Four-piece bars have their own geometry');
}
async function componentDetailChecks(page){
  const result=await page.evaluate(async()=>{
    const T=await import('/vendor/three.module.min.js'),{createBike}=await import('/bike-three-model.js');
    const results=[];
    for(const driveSide of ['rhd','lhd'])for(const stemStyle of ['top-load','front-load']){
      const model=createBike(JKCrewBikeConfig.normalize({driveSide,stemStyle,tyreStyle:'black'}));await model.ready;model.group.updateMatrixWorld(true);
      const plates=model.group.getObjectByName('Chain side plates'),rollers=model.group.getObjectByName('Chain rollers'),pins=model.group.getObjectByName('Chain pins');
      const matrix=new T.Matrix4(),nextMatrix=new T.Matrix4(),plateMatrix=new T.Matrix4();let worstGap=0;
      for(let i=0;i<rollers.count;i++){
        rollers.getMatrixAt(i,matrix);rollers.getMatrixAt((i+1)%rollers.count,nextMatrix);plates.getMatrixAt(i*2,plateMatrix);
        const a=new T.Vector3().setFromMatrixPosition(matrix),b=new T.Vector3().setFromMatrixPosition(nextMatrix);
        const start=new T.Vector3(-model.group.userData.chain.pitch/2,0,0).applyMatrix4(plateMatrix),end=new T.Vector3(model.group.userData.chain.pitch/2,0,0).applyMatrix4(plateMatrix);
        worstGap=Math.max(worstGap,Math.hypot(start.x-a.x,start.y-a.y),Math.hypot(end.x-b.x,end.y-b.y));
      }
      const centre=new T.Vector3(...model.parts.stem.userData.clampCentre),ray=new T.Raycaster(centre.clone().add(new T.Vector3(0,0,-.2)),new T.Vector3(0,0,1),0,.4);
      const blockedBore=ray.intersectObject(model.parts.stem,true).length;
      results.push({driveSide,stemStyle,worstGap,plates:plates.count,rollers:rollers.count,pins:pins.count,blockedBore,rubberClearcoat:model.parts.grips.children[0].material.clearcoat});model.dispose();
    }return results;
  });
  for(const r of result){
    check(r.rollers>50&&r.plates===r.rollers*2&&r.pins===r.rollers,`${r.driveSide}/${r.stemStyle}: complete roller chain has two plates and a pin per roller`);
    check(r.worstGap<.000001,`${r.driveSide}/${r.stemStyle}: every plate meets both adjacent rollers, including the closing link`);
    equal(r.blockedBore,0,`${r.stemStyle}: the handlebar bore is physically open through the clamp`);
    equal(r.rubberClearcoat,0,'Rubber grips do not use a glossy plastic clearcoat');
  }
}
async function assemblyChecks(page){
  const results=await page.evaluate(async()=>{
    const T=await import('/vendor/three.module.min.js'),{createBike}=await import('/bike-three-model.js'),results=[];
    for(const frameModel of ['compact','standard','long','tall'])for(const driveSide of ['rhd','lhd']){
      const model=createBike(JKCrewBikeConfig.normalize({frameModel,driveSide,seatStyle:'padded'}));await model.ready;model.group.updateMatrixWorld(true);
      const bounds=part=>new T.Box3().setFromObject(part),spindle=model.group.getObjectByName('Bottom bracket spindle');
      const bosses=model.parts.cranks.children.filter(m=>m.name==='Crank axle boss'),legs=model.parts.fork.children.filter(m=>m.name==='Straight fork leg');
      const cross=model.group.getObjectByName('Welded crossbar'),halves=model.parts.bars.children.filter(m=>m.name==='Formed handlebar half');let joinGap=0;
      for(const side of [-1,1]){const endpoint=new T.Vector3(0,side*cross.geometry.parameters.height/2,0).applyMatrix4(cross.matrixWorld);let gap=Infinity;
        for(const mesh of halves)for(let i=0;i<mesh.geometry.attributes.position.count;i++)gap=Math.min(gap,new T.Vector3().fromBufferAttribute(mesh.geometry.attributes.position,i).applyMatrix4(mesh.matrixWorld).distanceTo(endpoint));joinGap=Math.max(joinGap,gap);
      }
      results.push({frameModel,driveSide,frameHeight:bounds(model.parts.frame).getSize(new T.Vector3()).y,seatLength:bounds(model.parts.seat).getSize(new T.Vector3()).x,connected:bosses.length===2&&bosses.every(b=>bounds(spindle).intersectsBox(bounds(b))),straight:legs.length===2&&legs.every(l=>l.geometry.type==='CylinderGeometry')&&Math.abs(legs[0].quaternion.dot(legs[1].quaternion))>.99999,joinGap});model.dispose();
    }return results;
  });
  for(const r of results){check(r.connected,`${r.frameModel}/${r.driveSide}: spindle physically reaches both crank bosses`);check(r.straight,`${r.frameModel}: fork legs are straight and parallel`);check(r.frameHeight<.49,`${r.frameModel}: frame stays compact relative to 20-inch wheels`);check(r.seatLength<.245,`${r.frameModel}: pivotal saddle has a compact rounded silhouette`);check(r.joinGap<.015,`${r.frameModel}: crossbar joins the formed uprights`);}
}
async function componentJoinChecks(page){
 const results=await page.evaluate(async()=>{
  const T=await import('/vendor/three.module.min.js'),{createBike}=await import('/bike-three-model.js'),out=[];
  for(const stemStyle of ['top-load','front-load'])for(const seatStyle of ['slim','padded']){
   const model=createBike(JKCrewBikeConfig.normalize({stemStyle,seatStyle}));await model.ready;model.group.updateMatrixWorld(true);
   const mesh=name=>model.group.getObjectByName(name),box=name=>new T.Box3().setFromObject(mesh(name));
   out.push({stemStyle,seatStyle,stack:box('Tapered headset dust cap').intersectsBox(box('Seated headset spacer'))&&box('Seated headset spacer').intersectsBox(box('Stem steerer clamp')),cap:box('Flush compression cap').intersectsBox(box('Stem steerer clamp')),post:box('Inserted seatpost').intersectsBox(box('Pivotal seat mount')),saddle:box('Pivotal seat mount').intersectsBox(box('Moulded saddle underside')),shoulders:model.parts.fork.children.filter(m=>m.name==='Formed fork shoulder').length,grain:Boolean(mesh('Contoured saddle upholstery').material.bumpMap)});model.dispose();
  }return out;
 });
 for(const r of results){check(r.stack,`${r.stemStyle}: tapered dust cap, spacer and stem form one seated stack`);check(r.cap,`${r.stemStyle}: compression cap sits on the stem`);check(r.post&&r.saddle,`${r.seatStyle}: seatpost, pivotal mount and moulded underside meet`);equal(r.shoulders,2,'Fork has two formed shoulders rather than a horizontal crown bar');check(r.grain,'Saddle keeps its fabric surface texture');}
}
async function interaction(page){
  check(await page.locator('[data-bike-sheet]').isHidden(),'3D opens with editing controls collapsed');
  check(await page.locator('.bike-three-canvas').evaluate(el=>Boolean(el.getContext('webgl2'))&&getComputedStyle(el).transform==='none'),'The view uses real WebGL rather than a CSS-rotated photo');
  await page.locator('[data-bike-name]').fill('Orbit regression');await page.locator('[data-bike-save]').click();await page.waitForFunction(()=>document.querySelector('[data-bike-status]').textContent.includes('Saved to your garage'));
  const clean=await page.evaluate(()=>JSON.stringify(testDraft()));const calls=await page.evaluate(()=>testCalls.length);
  let travelled=0,last=(await view(page)).yaw;
  const box=await page.locator('.bike-three-canvas').boundingBox();
  for(let i=0;i<8;i++){await page.mouse.move(box.x+box.width*.7,box.y+box.height*.52);await page.mouse.down();await page.mouse.move(box.x+box.width*.25,box.y+box.height*.52,{steps:12});await page.mouse.up();await settle(page);const current=(await view(page)).yaw;travelled+=Math.abs(Math.atan2(Math.sin(current-last),Math.cos(current-last)));last=current;}
  check(travelled>Math.PI*2,'Repeated real drags orbit through more than a full 360 degrees');
  check(await page.locator('[data-bike-sheet]').isHidden(),'Dragging does not open a part editor');
  equal(await page.evaluate(()=>JSON.stringify(testDraft())),clean,'Orbiting does not dirty or rewrite the saved build');equal(await page.evaluate(()=>testCalls.length),calls,'Orbiting never sends an account write');
  await page.evaluate(()=>testHandle.resetView());await settle(page);
  const target=await point(page,[.05,.576,0]);
  await page.mouse.move(target.x,target.y);await page.mouse.down();await page.mouse.move(target.x+55,target.y,{steps:8});await page.mouse.move(target.x,target.y,{steps:8});await page.mouse.up();await settle(page);
  check(await page.locator('[data-bike-sheet]').isHidden(),'A drag returning to its starting point is not mistaken for a tap');
  await page.evaluate(()=>testHandle.resetView());await settle(page);const tap=await point(page,[.05,.576,0]);await page.mouse.click(tap.x,tap.y);
  check(await page.locator('[data-bike-sheet]').isVisible(),'A deliberate tap on the 3D frame opens editing');
  equal(await page.locator('[data-bike-group="Frame"]').getAttribute('aria-expanded'),'true','Raycast selection opens the actual tapped part');
  await setView(page,{yaw:1.1,polar:1.1});const camera=await view(page);
  await page.locator('[data-bike-colour="#F26879"]').click();await settle(page);sameView(await view(page),camera,'Painting retains the current camera');
  await page.locator('[data-bike-undo]').click();await settle(page);sameView(await view(page),camera,'Undo retains the current camera');
  equal(await page.evaluate(()=>testDraft().configuration.colors.frame),'#F1F4F8','Undo still restores the saved paint');
  await closeSheet(page);
  const cdp=await page.context().newCDPSession(page),rect=await page.locator('.bike-three-canvas').boundingBox(),x=rect.x+rect.width*.5,y=rect.y+rect.height*.52;
  const distance=(await view(page)).distance;
  const touches=gap=>[{id:1,x:x-gap,y,radiusX:5,radiusY:5,force:1},{id:2,x:x+gap,y,radiusX:5,radiusY:5,force:1}];
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:touches(35)});
  for(const gap of [45,55,65,75])await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:touches(gap)});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await settle(page);
  check((await view(page)).distance<distance*.9,'Two real touch points pinch the camera closer');check(await page.locator('[data-bike-sheet]').isHidden(),'Pinching does not accidentally select a part');await cdp.detach();
  await resetView(page);
  check((await view(page)).distance>1.2,'Reset fits the whole bike after zooming');
}
async function geometryViews(page){
  await part(page,'frame','Frame');await page.locator('[data-bike-colour="#F26879"]').click();await closeSheet(page);
  const shots={};for(const [name,yaw]of [['right',0],['front',Math.PI/2],['left',Math.PI],['rear',-Math.PI/2]]){await setView(page,{yaw,polar:1.32});const png=await image(page);shots[name]=png;fs.writeFileSync(`/tmp/bike-360-${name}.png`,PNG.sync.write(png));await checkFit(page,name);}
  equal(new Set(Object.values(shots).map(hash)).size,4,'All four physical views show different rendered geometry/occlusion');
  const side=redBounds(shots.right),front=redBounds(shots.front);
  check(side.count>100&&front.count>20,'Paint is rendered on the actual model from both directions');check(front.width<side.width*.65,'Front-on tubes have real foreshortening, not a rotated flat photograph');
  const before=await page.evaluate(()=>JSON.stringify(testDraft().configuration));
  for(const [width,height]of [[1024,768],[390,844],[844,390]]){const old=await view(page);await page.setViewportSize({width,height});await settle(page);const resized=await view(page);check(Math.abs(resized.yaw-old.yaw)<.00001&&Math.abs(resized.polar-old.polar)<.00001,`${width}x${height}: resize preserves the viewing angle`);await checkFit(page,`${width}x${height}/automatic fit`);await resetView(page);const png=await image(page),bounds=redBounds(png);check(bounds.count>20&&bounds.minX>2&&bounds.maxX<png.width-3&&bounds.minY>2&&bounds.maxY<png.height-3,`${width}x${height}: fitted paint stays inside the resized canvas`);await checkFit(page,`${width}x${height}/reset`);fs.writeFileSync(`/tmp/bike-360-${width}x${height}.png`,PNG.sync.write(png));}
  equal(await page.evaluate(()=>JSON.stringify(testDraft().configuration)),before,'View changes and resize preserve the configuration');
  const exported=await page.evaluate(async()=>{const blob=await testHandle.exportBlob();return {type:blob.type,size:blob.size};});check(exported.type==='image/png'&&exported.size>10000,'The actual 3D view exports a nonempty PNG without a server');
}
async function optionUpdates(page){
  await page.setViewportSize({width:800,height:800});await settle(page);await resetView(page);
  for(const [name,group,key,value]of [['drivetrain','Details','driveSide','lhd'],['pegs','Wheels','pegs','four'],['stem','Front end','stemStyle','front-load'],['bars','Front end','barStyle','four-piece']]){
    await part(page,name,group);const camera=await view(page),before=hash(await image(page));await page.locator(`[data-bike-style="${value}"]`).click();await settle(page);
    equal(await page.evaluate(key=>testDraft().configuration[key],key),value,`${key}: editing stores the selected option`);sameView(await view(page),camera,`${key}: rebuilding geometry preserves the camera`);check(hash(await image(page))!==before,`${key}: the visible 3D geometry updates`);
  }
  await part(page,'brakes','Front end');await page.locator('[data-bike-brake="front"]').check();await page.locator('[data-bike-brake="rear"]').check();await settle(page);equal(await page.evaluate(()=>testDraft().configuration.brakeStyle),'dual','Both independent brake controls update the live model configuration');await closeSheet(page);
}
async function photoSourceChecks(page){
  await closeSheet(page);await setView(page,{yaw:2.6,polar:1.32});
  const screen=await image(page);
  const before=await page.evaluate(()=>{const c=testHandle.canvas,aspect=c.clientWidth/c.clientHeight;window.testPhotoOptions={width:aspect>=1?2048:Math.round(2048*aspect),height:aspect>=1?Math.round(2048/aspect):2048,view:testHandle.getView()};return {view:testHandle.getView(),width:c.width,height:c.height,config:JSON.stringify(testDraft().configuration),photoSize:[testPhotoOptions.width,testPhotoOptions.height]};});
  await page.locator('[data-bike-preview]').click();
  const photo=page.locator('[data-bike-model-photo]');await photo.waitFor();
  const readPhoto=async()=>PNG.sync.read(Buffer.from(await photo.evaluate(async image=>{await image.decode();const blob=await fetch(image.src).then(r=>r.blob());return await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(blob);});}),'base64'));
  const readModel=async()=>PNG.sync.read(Buffer.from(await page.evaluate(async()=>{const blob=await testHandle.exportBlob(testPhotoOptions);return await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(blob);});}),'base64'));
  const initial=await readPhoto();
  equal([initial.width,initial.height],before.photoSize,'Photo Studio preserves the viewport aspect at high resolution');
  const liveBounds=redBounds(screen),photoBounds=redBounds(initial);
  check(Math.abs(liveBounds.width/screen.width-photoBounds.width/initial.width)<.005&&Math.abs(liveBounds.height/screen.height-photoBounds.height/initial.height)<.005,'Photo projection matches the visible bike size without automatic reframing');
  equal(hash(initial),hash(await readModel()),'The photo pixels match the updated 360 model with customised parts and viewing angle');
  equal(await page.locator('[data-bike-preview-art] svg').count(),0,'The live photo contains no older SVG bike');
  await page.evaluate(()=>Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>false}));
  const downloadPromise=page.waitForEvent('download');await page.locator('[data-bike-export]').click();const download=await downloadPromise;
  equal(hash(PNG.sync.read(fs.readFileSync(await download.path()))),hash(initial),'The downloaded PNG is exactly the bike shown in Photo Studio');
  await page.locator('[data-bike-scene="street"]').click();await photo.waitFor();
  const street=await readPhoto();check(hash(street)!==hash(initial),'Changing the scene updates the photo');
  equal(hash(street),hash(await readModel()),'Scene changes retain the same actual 3D bike and background in both views');
  equal(await page.evaluate(()=>testDraft().configuration.background),'street','The selected scene persists in the draft');
  await page.screenshot({path:'/tmp/bike-360-photo-studio.png'});
  await page.locator('[data-bike-preview-close]').click();await settle(page);
  sameView(await view(page),before.view,'Photo export preserves the builder camera and zoom');
  equal(await page.evaluate(()=>[testHandle.canvas.width,testHandle.canvas.height]),[before.width,before.height],'High-resolution capture restores the live drawing buffer');
  equal(await page.evaluate(()=>{const c={...testDraft().configuration};c.background='studio';return JSON.stringify(c);}),before.config,'Photo export preserves every part and colour');
  // A GPU/export failure must offer retry instead of silently displaying the old bike.
  await page.evaluate(()=>{window.testExport=testHandle.exportBlob;testHandle.exportBlob=async()=>{throw new Error('Simulated capture failure');};});
  await page.locator('[data-bike-preview]').click();await page.locator('[data-bike-preview-retry]').waitFor();
  equal(await page.locator('[data-bike-preview-art] svg,[data-bike-model-photo]').count(),0,'Capture failure never substitutes the old bike');
  check(await page.locator('[data-bike-export]').isDisabled(),'A failed photo cannot be saved');
  await page.evaluate(()=>testHandle.exportBlob=testExport);await page.locator('[data-bike-preview-retry]').click();await photo.waitFor();
  equal(hash(await readPhoto()),hash(await readModel()),'Retry recovers the correct 3D photo');
  await page.locator('[data-bike-preview-close]').click();
  // A late capture cannot resurrect a closed photo dialog.
  await page.evaluate(()=>{window.testCaptureRelease=null;testHandle.exportBlob=async opts=>{await new Promise(resolve=>window.testCaptureRelease=resolve);return testExport(opts);};});
  await page.locator('[data-bike-preview]').click();await page.waitForFunction(()=>testCaptureRelease);
  await page.locator('[data-bike-preview-close]').click();await page.evaluate(()=>{testHandle.exportBlob=testExport;testCaptureRelease();});await settle(page);
  equal(await page.locator('.bike-photo-preview').count(),0,'Closing during capture prevents stale photo UI');
  console.log('PASS: matching 3D/photo pixels, PNG download, scenes, camera restoration and capture recovery.');
}
async function savedPreviewChecks(page){
  await page.locator('[data-bike-save]').click();await page.waitForFunction(()=>testRows.length===1);
  const before=await page.evaluate(()=>({view:testHandle.getView(),draft:JSON.stringify(testDraft()),configuration:JSON.stringify(testRows[0].configuration)}));
  await page.locator('[data-bike-collection-open]').click();
  const thumb=page.locator('[data-bike-saved-model]');await thumb.waitFor();
  check(await thumb.evaluate(async image=>{await image.decode();return image.naturalWidth===480&&image.naturalHeight===320;}),'Saved-bike cards contain a rendered 3D thumbnail');
  equal(await page.locator('.bike-saved-art svg').count(),0,'My garage never shows the legacy photographic bike');
  equal(await page.evaluate(()=>testMounts.filter(m=>m.thumbnail).at(-1).configuration),before.configuration,'Thumbnail uses the saved bike configuration, not unsaved editor changes');
  await page.waitForFunction(()=>testMounts.filter(m=>m.thumbnail).every(m=>m.disposed));
  equal(await page.locator('[data-bike-thumbnail-renderer]').count(),0,'Thumbnail generation releases its temporary GPU renderer');
  sameView(await view(page),before.view,'Generating thumbnails does not move the live bike');
  equal(await page.evaluate(()=>JSON.stringify(testDraft())),before.draft,'Generating thumbnails leaves the rider draft unchanged');
  const count=await page.evaluate(()=>testMounts.length);
  await page.locator('[data-bike-collection-close]').click();await page.locator('[data-bike-collection-open]').click();await thumb.waitFor();
  equal(await page.evaluate(()=>testMounts.length),count,'Reopening saved bikes reuses cached photos without another renderer');
  await page.locator('[data-bike-collection-close]').click();
}
async function captureAndMeasure(page){
  await page.setViewportSize({width:390,height:844});await settle(page);await resetView(page);await part(page,'frame','Frame');
  const timing=await page.evaluate(async()=>{const updates=[];for(const value of ['#428CFF','#F26879','#F1F4F8']){const start=performance.now();document.querySelector('[data-bike-colour="'+value+'"]').click();await testLastUpdate;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));updates.push(Math.round(performance.now()-start));}return {cold3DLoadMs:Math.round(testMounts[0].loadMs),colourEditsMs:updates,stats:testHandle.getStats()};});
  check(timing.colourEditsMs.length===3&&timing.colourEditsMs.every(n=>n>=0),'Three actual colour edits are measured through model update and rendered frames');await settle(page);await closeSheet(page);await page.screenshot({path:'/tmp/bike-360-final-phone-closed.png'});await category(page,'Frame');await page.screenshot({path:'/tmp/bike-360-final-phone-open.png'});await closeSheet(page);
  const titleColour=await page.locator('[data-bike-design-title]').evaluate(el=>getComputedStyle(el).color);equal(titleColour,'rgb(44, 52, 64)','The title keeps readable dark text on the light 3D stage');
  const fitted=await view(page);await setView(page,{yaw:.35,distance:fitted.distance});await page.screenshot({path:'/tmp/bike-360-final-phone-yaw035-white.png'});
  await part(page,'frame','Frame');await page.locator('[data-bike-colour="#F26879"]').click();await part(page,'tyres','Wheels');await page.locator('[data-bike-style="black"]').click();await closeSheet(page);await setView(page,{yaw:.35,distance:fitted.distance});await page.screenshot({path:'/tmp/bike-360-final-phone-yaw035-colour.png'});
  console.log('MEASURED local Chrome WebGL: '+JSON.stringify({...timing,titleColour,fittedView:fitted}));
}
async function performanceChecks(page){
  const before=await page.evaluate(()=>JSON.stringify(testDraft()));
  const measured=await page.evaluate(async()=>{
    const h=testHandle;h.selectPart('');h.setAutoRotate(true);
    await new Promise(resolve=>setTimeout(resolve,350));
    const start=h.getStats().renderedFrames,startTime=performance.now();let callbacks=0;
    const times=[];let last=startTime;
    await new Promise(resolve=>{function step(now){callbacks++;times.push(now-last);last=now;if(now-startTime<1200)requestAnimationFrame(step);else resolve();}requestAnimationFrame(step);});
    const stats=h.getStats(),elapsed=performance.now()-startTime;
    const blob=await h.exportBlob(),bitmap=await createImageBitmap(blob),exportWidth=bitmap.width;bitmap.close();
    h.setAutoRotate(false);
    await new Promise(resolve=>setTimeout(resolve,1400));
    const idleStart=h.getStats().renderedFrames;
    await new Promise(resolve=>setTimeout(resolve,400));
    times.sort((a,b)=>a-b);
    return {callbacks,rendered:stats.renderedFrames-start,fps:Math.round(callbacks*1000/elapsed),p95Ms:times[Math.floor(times.length*.95)],motionRatio:stats.pixelRatio,stillRatio:h.getStats().pixelRatio,exportWidth,cssWidth:h.canvas.clientWidth,idleFrames:h.getStats().renderedFrames-idleStart};
  });
  check(measured.callbacks>10,'Browser animation callbacks stay responsive during sustained rotation');
  check(measured.rendered<=measured.callbacks+1,'Orbit changes schedule at most one render per animation frame');
  check(measured.rendered>=measured.callbacks-1,'Sustained rotation continues to render each available frame');
  equal(measured.motionRatio,1,'High-DPI motion uses a lighter drawing buffer');
  equal(measured.stillRatio,1.75,'The still bike returns to full display sharpness');
  equal(measured.exportWidth,Math.floor(measured.cssWidth*1.75),'PNG export retains full resolution even during rotation');
  equal(measured.idleFrames,0,'A settled viewer performs no background renders');
  equal(await page.evaluate(()=>JSON.stringify(testDraft())),before,'Performance modes and export leave the saved draft unchanged');
  // Starting/stopping repeatedly must not create another animation chain.
  const repeated=await page.evaluate(async()=>{for(let i=0;i<5;i++){testHandle.setAutoRotate(true);testHandle.setAutoRotate(false);}testHandle.setAutoRotate(true);const start=testHandle.getStats().renderedFrames;for(let i=0;i<12;i++)await new Promise(requestAnimationFrame);const rendered=testHandle.getStats().renderedFrames-start;JKCrewBikeGarage.destroy();const stopped=testHandle.getStats().renderedFrames;await new Promise(resolve=>setTimeout(resolve,150));return {rendered,afterDispose:testHandle.getStats().renderedFrames-stopped};});
  check(repeated.rendered<=13,'Repeated spin toggles keep exactly one animation chain');
  equal(repeated.afterDispose,0,'Leaving a rotating viewer cancels its rendering work');
  console.log('MEASURED high-DPI local Chrome: '+JSON.stringify(measured));
}
async function run(){
  const local=await server(),browser=await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH,args:['--enable-unsafe-swiftshader']});
  const errors=[];const create=async(deviceScaleFactor=1)=>{const context=await browser.newContext({viewport:{width:800,height:800},hasTouch:true,deviceScaleFactor});const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>new URL(route.request().url()).origin===local.url?route.continue():route.abort());await page.goto(local.url+'/fixture');await page.waitForFunction(()=>testReady);return page;};
  try{
    const page=await create();check(!local.requests.some(file=>file.startsWith('/vendor/')),'Loading the garage script alone does not download WebGL dependencies');await page.evaluate(()=>testMount());await ready(page);
    equal(await page.evaluate(()=>['street-low','classic-mid','tall-ak'].map(barModel=>JKCrewBikeConfig.normalize({barModel}).barModel)),['classic-mid','classic-mid','classic-mid'],'Saved bar sizes normalize to medium');
    await part(page,'bars','Front end');equal(await page.locator('[data-bike-key="barModel"]').count(),0,'Handlebar size selector is removed');await closeSheet(page);
    equal(await page.locator('[data-bike-view-toggle]').count(),0,'The updated 360 bike is the default without a photographic view switch');
    equal(await page.locator('.bike-three-canvas').count(),1,'Opening the builder starts exactly one 3D renderer');
    if(process.env.JKCREW_360_CAPTURE_ONLY){await captureAndMeasure(page);return;}
    await checksForModel(page);await componentDetailChecks(page);await assemblyChecks(page);await componentJoinChecks(page);console.log('PASS: original 3D mesh volume, drivetrain, pegs, brakes and stems.');await interaction(page);console.log('PASS: real orbit/tap/pinch and camera-preserving edits.');await geometryViews(page);await optionUpdates(page);await photoSourceChecks(page);await savedPreviewChecks(page);console.log('PASS: four physical views, resized fit, live option geometry and PNG export.');
    const draftBeforeLoss=await page.evaluate(()=>JSON.stringify(testDraft()));await page.evaluate(()=>testHandle.canvas.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());await page.waitForFunction(()=>document.querySelector('[data-bike-art][data-view="photo"] .jkcrew-bike-art')&&document.querySelector('[data-bike-art]').getAttribute('aria-busy')==='false');check(await page.locator('[data-bike-3d-retry]').isVisible(),'A real GPU context loss offers a usable fallback and retry');equal(await page.evaluate(()=>JSON.stringify(testDraft())),draftBeforeLoss,'A GPU interruption preserves the exact local draft');await page.locator('[data-bike-3d-retry]').click();await ready(page);equal(await page.locator('.bike-three-canvas').count(),1,'Retry restores exactly one live renderer');await captureAndMeasure(page);
    await page.evaluate(()=>{JKCrewBikeGarage.destroy();document.querySelector('#view').innerHTML='<p>Outside the garage</p>';});equal(await page.locator('canvas.bike-three-canvas').count(),0,'Leaving the garage removes the canvas');check(await page.evaluate(()=>testMounts.every(m=>!m.resolved||m.disposed)),'Leaving the garage disposes every mounted renderer');await page.close();
    const failed=await create();await failed.route('**/bike-three-model.js*',route=>route.abort());await failed.evaluate(()=>testMount('fallback-owner'));await failed.waitForFunction(()=>document.querySelector('[data-bike-art][data-view="photo"] .jkcrew-bike-art')&&document.querySelector('[data-bike-art]').getAttribute('aria-busy')==='false');check(await failed.locator('[data-bike-3d-retry]').isVisible(),'A failed dependency offers a 360 retry and usable photo fallback');equal(await failed.locator('.bike-three-canvas').count(),0,'Failed initialisation leaves no dead canvas');equal(await failed.evaluate(()=>testCalls.filter(c=>c.method!=='get_bike_garage').length),0,'Fallback does not write account data');await failed.close();
    const stale=await create();let release;const gate=new Promise(resolve=>release=resolve);let seen;const requested=new Promise(resolve=>seen=resolve);await stale.route('**/bike-three-model.js*',async route=>{seen();await gate;await route.continue();});await stale.evaluate(()=>testMount('old-owner'));await requested;
    await stale.evaluate(()=>{JKCrewBikeGarage.destroy();document.querySelector('#view').innerHTML='<p>New account page</p>';});release();await stale.evaluate(()=>Promise.allSettled(testMountPromises));equal(await stale.locator('#view').innerHTML(),'<p>New account page</p>','A late module load cannot repaint a disposed private view');equal(await stale.locator('.bike-three-canvas').count(),0,'Stale loading does not attach a renderer');await stale.close();
    const slow=await create();await slow.clock.install();let releaseSlow,seenSlow;const slowGate=new Promise(resolve=>releaseSlow=resolve),slowRequest=new Promise(resolve=>seenSlow=resolve);await slow.route('**/bike-three-model.js*',async route=>{seenSlow();await slowGate;await route.continue();});
    await slow.evaluate(()=>testMount('slow-owner'));await slowRequest;await slow.clock.fastForward(12001);await slow.waitForFunction(()=>document.querySelector('[data-bike-art][data-view="photo"] .jkcrew-bike-art')&&document.querySelector('[data-bike-art]').getAttribute('aria-busy')==='false');
    check(await slow.locator('[data-bike-3d-retry]').isVisible(),'A never-replying startup is bounded by the 12-second photo fallback');await slow.locator('[data-bike-name]').fill('Kept during slow startup');await slow.locator('[data-bike-3d-retry]').click();releaseSlow();await ready(slow);await slow.evaluate(()=>Promise.allSettled(testMountPromises));
    equal(await slow.locator('.bike-three-canvas').count(),1,'Retry wins over the timed-out generation and mounts only one canvas');equal(await slow.locator('[data-bike-name]').inputValue(),'Kept during slow startup','A slow initial generation cannot erase newer edits');equal(await slow.evaluate(()=>testCalls.filter(c=>c.method!=='get_bike_garage').length),0,'Timeout and retry never save without the rider action');await slow.close();
    const performancePage=await create(2);await performancePage.setViewportSize({width:390,height:844});await performancePage.evaluate(()=>testMount('performance-owner'));await ready(performancePage);await performanceChecks(performancePage);await performancePage.close();
    equal(errors,[],'No uncaught browser errors');console.log(`PASS: ${checks} real 3D geometry, orbit, touch, camera, configuration, lifecycle and fallback checks; no production requests or writes.`);
  }finally{await browser.close();await local.close();}
}
run().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
