import * as T from './vendor/three.module.js';
import {TRACKS,resolveTrack,trackAt,sampleSegment} from './track.js';
import {v,mesh,tube,box,mergeRigid} from './geometry.js';
import {BikeRider} from './rig.js';
import {PARK,ENVIRONMENTS,parkAt,parkHeight,resolveEnv} from './park.js';
import {buildFreePark,buildHalfPipe,buildContestPark} from './park-scene.js';
import {buildTrail} from './trail-scene.js';
import {ParticleBurst,buildSky,softDiscTexture} from './effects.js';
const clamp=T.MathUtils.clamp;
// Any 3D free-roam environment (street park or half pipe) shares camera/lighting/build
// branches; only the specific geometry builder differs. Flow tracks (easy/medium/hard)
// stay on the older side-on path untouched.
const isRoam=t=>!!t&&t.bounds!=null;
const resolveSceneTrack=t=>t&&t.bounds?t:t==='park'||t===PARK?PARK:typeof t==='string'&&resolveEnv(t).id!=='park'?resolveEnv(t):resolveTrack(t);
const standard=(color,roughness=.9,extra={})=>new T.MeshStandardMaterial({color,roughness,...extra});
// Every rideable vertex comes from the same Hermite surface used by physics.
function earth(segment,material){
 const pos=[],uv=[],colors=[],idx=[],n=Math.ceil((segment[3]-segment[0])*4),widths=[-8,-5,-3.2,-2.1,-1.55,0,1.55,2.1,3.2,5,8];
 for(let i=0;i<=n;i++){
  const x=T.MathUtils.lerp(segment[0],segment[3],i/n),top=sampleSegment(segment,x).height;
  for(let j=0;j<widths.length;j++){
   const z=widths[j],bank=clamp((Math.abs(z)-2.0)/5.8,0,1),y=T.MathUtils.lerp(top,-3.1,Math.sin(bank*Math.PI/2));
   pos.push(x,y,z);uv.push(x/2.1,z/2.1);
   const wear=Math.abs(z)<1.6?1:.79,noise=.95+.045*Math.sin(x*1.7+z*3.1);colors.push(wear*noise,wear*noise,wear*noise);
   if(i<n&&j<widths.length-1){const k=i*widths.length+j;idx.push(k,k+1,k+widths.length,k+1,k+widths.length+1,k+widths.length);}
  }
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.setIndex(idx);g.computeVertexNormals();return new T.Mesh(g,material);
}
export class SceneView{
 constructor(canvas,{track='easy'}={}){
  this.track=resolveSceneTrack(track);
  // Multisampling is on: phone GPUs are tile-based and resolve MSAA in tile memory, so it is
  // close to free there and it is what stops rails, coping and the rider's edges crawling —
  // the softness people read as "low graphics". The quality monitor still lowers the pixel
  // ratio the moment frames are actually being lost.
  this.renderer=new T.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
  // Phones have 2–3× pixel-density screens: rendering at one CSS pixel per texel (the old
  // cap) and letting the compositor stretch it 2–3× is what made every edge soft and every
  // rail crawl. The ceiling is now two device pixels per CSS pixel — sharp on a phone,
  // and the quality monitor still drops it the moment frames are actually being lost —
  // starting at 1.35 so the first seconds are never the slowest part of the session.
  this.phone=typeof matchMedia==='function'&&matchMedia('(pointer:coarse)').matches&&Math.min(innerWidth,innerHeight)<=560;
  this.maxPixelRatio=Math.min(devicePixelRatio||1,2);this.renderer.setPixelRatio(Math.min(this.maxPixelRatio,1.35));this.qualityHold=0;this.renderer.shadowMap.enabled=false;this.renderer.outputColorSpace=T.SRGBColorSpace;this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.03;
  this.scene=new T.Scene();this.scene.background=new T.Color('#cbd7d7');this.scene.fog=new T.Fog('#b7b5a4',42,135);
  this.scene.add(new T.HemisphereLight('#d9e6ff','#6a5a46',.95));const sun=new T.DirectionalLight('#ffd5a0',3.7);sun.position.set(-25,30,18);this.scene.add(sun);this.sun=sun;this.scene.add(sun.target);sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=sun.shadow.camera.bottom=-13;sun.shadow.camera.right=sun.shadow.camera.top=13;sun.shadow.camera.near=.5;sun.shadow.camera.far=80;sun.shadow.normalBias=.025;sun.shadow.bias=-.00015;sun.shadow.radius=this.phone?2:3;this.renderer.shadowMap.type=T.PCFSoftShadowMap;this.renderer.shadowMap.autoUpdate=false;
  // Soft cool fill + a small rim light keep the rider's face and gear from reading flat/fake
  // under the single hard sun, without adding another shadow-casting light (cheap on mobile).
  const fill=new T.DirectionalLight('#b9cfe8',.55);fill.position.set(18,12,-10);this.scene.add(fill);this.scene.add(fill.target);this.fillLight=fill;
  const rim=new T.DirectionalLight('#fff0d2',.75);rim.position.set(4,9,-22);this.scene.add(rim);this.scene.add(rim.target);this.rimLight=rim;
  this.camera=new T.PerspectiveCamera(36,innerWidth/innerHeight,.1,360);this.baseFov=36;this.look=v();this.cameraX=7;this.cameraY=2.5;this.cameraSpan=9.1;this.renders=0;this.assetsReady=false;this.assetError=null;this.resizeDirty=true;
  this.rig=new BikeRider();this.riderRoot=this.rig.root;this.scene.add(this.riderRoot);this.addFrameLettering();this.riderRoot.traverse(o=>{if(o.isMesh)o.castShadow=true;});
  this.shakeMag=0;
  this.dustMaterial=new T.MeshBasicMaterial({map:softDiscTexture('rgba(214,201,175,1)'),transparent:true,depthWrite:false,fog:true,toneMapped:false});
  this.sparkMaterial=new T.MeshBasicMaterial({map:softDiscTexture('rgba(255,224,140,1)'),transparent:true,depthWrite:false,fog:false,toneMapped:false,blending:T.AdditiveBlending});
  this.dust=new ParticleBurst(this.scene,this.dustMaterial,26);this.sparks=new ParticleBurst(this.scene,this.sparkMaterial,20);this.sparks.gravity=.4;
  this.buildMarkerBeacon();
  this.buildPark();this.buildShadow();this.resize();
  const loader=new T.TextureLoader();
  this.ready=Promise.all([loader.loadAsync('./assets/trail-dirt.png'),loader.loadAsync('./assets/rural-horizon.png'),loader.loadAsync('./assets/eucalyptus.png'),loader.loadAsync('./assets/rider-face.png'),loader.loadAsync('./assets/concrete-albedo.png'),loader.loadAsync('./assets/jkc-logo.png')]).then(([dirt,horizon,tree,face,concrete,logo])=>{
   for(const t of [dirt,horizon,tree,face,concrete,logo])t.colorSpace=T.SRGBColorSpace;dirt.wrapS=dirt.wrapT=T.RepeatWrapping;dirt.anisotropy=Math.min(4,this.renderer.capabilities.getMaxAnisotropy());face.wrapS=T.RepeatWrapping;face.anisotropy=4;
   concrete.wrapS=concrete.wrapT=T.RepeatWrapping;concrete.anisotropy=4;this.textures={dirt,horizon,tree,face,concrete};this.rig.m.face.map=face;this.rig.m.face.needsUpdate=true;this.applyTextures();this.addShirtPrint(logo);
   const reflection=horizon.clone();reflection.mapping=T.EquirectangularReflectionMapping;reflection.needsUpdate=true;this.scene.environment=reflection;this.scene.environmentIntensity=.7;this.assetsReady=true;
  }).catch(error=>{this.assetError=String(error);console.error('Track texture loading failed',error);});
  window.addEventListener('resize',()=>{this.resize();this.resizeDirty=true;});
 }
 // On a phone held upright the game is drawn turned 90° (body.rotated, see app.js), so the
 // canvas is as wide as the viewport is tall: the renderer takes the swapped dimensions.
 resize(){const rotated=!!document.body?.classList?.contains?.('rotated'),w=rotated?innerHeight:innerWidth,h=rotated?innerWidth:innerHeight;this.camera.aspect=w/h;const wasPortrait=this.portrait;this.portrait=h>w;if(wasPortrait!==this.portrait){this.baseFov=this.framing().fov;this.camera.fov=this.baseFov;}this.camera.updateProjectionMatrix();this.renderer.setSize(w,h,false);}
 // Phone framing. Landscape phone: the rider sits above the thumb controls with the line
 // ahead filling the middle of the screen; portrait: the camera stands higher and further
 // back with a taller field of view, so the next two features are on screen instead of a
 // wall of sky — the view a follow-camera game gives you when you hold the phone upright.
 framing(){const roam=isRoam(this.track),base=roam?50:36;if(!this.phone)return {fov:base,distance:0,height:0,ahead:1.8,lookY:.95};
  if(this.portrait)return {fov:roam?60:40,distance:1.1,height:.95,ahead:4.2,lookY:.30};
  return {fov:base+2,distance:.25,height:.30,ahead:2.6,lookY:.45};}
 buildMarkerBeacon(){
  const beacon=new T.Group();beacon.visible=false;this.scene.add(beacon);this.markerBeacon=beacon;
  const pole=mesh(new T.CylinderGeometry(.02,.02,1.5,8),new T.MeshStandardMaterial({color:'#e7e2d2',roughness:.6}),beacon,v(0,.75,0));
  const flagMat=new T.MeshBasicMaterial({color:'#16dfcf',side:T.DoubleSide,toneMapped:false});
  const flag=mesh(new T.PlaneGeometry(.42,.26),flagMat,beacon,v(.23,1.32,0));flag.userData.flag=true;
  const ring=mesh(new T.RingGeometry(.32,.4,28),new T.MeshBasicMaterial({color:'#16dfcf',transparent:true,opacity:.55,side:T.DoubleSide,toneMapped:false}),beacon,v(0,.02,0));ring.rotation.x=-Math.PI/2;this.markerRing=ring;this.markerFlag=flag;
 }
 addFrameLettering(){const c=document.createElement('canvas');c.width=512;c.height=96;const ctx=c.getContext('2d');ctx.fillStyle='#16dfcf';ctx.font='700 58px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('JKCREW',256,48);const texture=new T.CanvasTexture(c);texture.colorSpace=T.SRGBColorSpace;const material=new T.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1});
  for(const sign of [-1,1]){const label=mesh(new T.PlaneGeometry(.27,.033),material,this.rig.frame,v(.13-.384,.407-.67,sign*.0215));label.rotation.z=.464;if(sign<0){label.rotation.y=Math.PI;label.rotation.z=-.464;}}
 }
 addShirtPrint(logo){
  logo.repeat.set(865/1563,866/1563);logo.offset.set(303/1563,1-(348+866)/1563);logo.anisotropy=4;
  const pos=[],uv=[],ix=[],n=18;for(let j=0;j<=n;j++)for(let i=0;i<=n;i++){const z=(i/n-.5)*.29,y=-.14+j/n*.29,rx=y>.04?.146-(y-.04)*.03:.148,rz=.216+Math.max(0,y)*.057;pos.push(-rx*Math.sqrt(1-z*z/(rz*rz))-.003,y,z);uv.push(i/n,j/n);if(i<n&&j<n){const k=j*(n+1)+i;ix.push(k,k+1,k+n+1,k+1,k+n+2,k+n+1);}}
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(ix);g.computeVertexNormals();mesh(g,new T.MeshStandardMaterial({map:logo,roughness:1,transparent:true,alphaTest:.05,side:T.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2}),this.rig.torso);
 }
 applyTextures(){if(!this.textures)return;const {dirt,horizon,tree,concrete}=this.textures;
  if(isRoam(this.track)){if(this.concreteMaterial){this.concreteMaterial.map=concrete;this.concreteMaterial.bumpMap=concrete;this.concreteMaterial.bumpScale=.012;this.concreteMaterial.needsUpdate=true;}if(this.track.trail&&this.trailMaterial){this.trailMaterial.map=dirt;this.trailMaterial.bumpMap=dirt;this.trailMaterial.bumpScale=.03;this.trailMaterial.needsUpdate=true;}this.treeMaterial.map=tree;this.treeMaterial.needsUpdate=true;this.trees.visible=this.track.id==='park';return;}
  for(const m of [this.dirt,...this.capMaterials]){m.map=dirt;m.bumpMap=dirt;m.bumpScale=.026;m.needsUpdate=true;}this.groundMaterial.map=dirt;this.groundMaterial.needsUpdate=true;this.treeMaterial.map=tree;this.treeMaterial.needsUpdate=true;this.trees.visible=true;this.backdrop.material.map=horizon;this.backdrop.material.needsUpdate=true;this.backdrop.visible=true;
 }
 setTrack(track){const selected=resolveSceneTrack(track);if(selected===this.track)return;this.track=selected;
  // Dispose only replaced map geometry/materials. Shared texture and rider assets stay resident.
  const geometry=new Set(),materials=new Set();this.park.traverse(o=>{if(o.isInstancedMesh)o.dispose();if(o.geometry)geometry.add(o.geometry);if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);});this.scene.remove(this.park);for(const t of this.parkOwnedTextures||[])t.dispose();this.parkOwnedTextures=[];for(const g of geometry)g.dispose();for(const m of materials)m.dispose();this.buildPark();if(!isRoam(this.track))this.addTreeShadows();this.applyTextures();this.previousMode=null;this.landingPulse=0;this.crouch=0;this.crankAngle=0;this.railGlowActive=null;
 }
 buildPark(){
  const roam=isRoam(this.track),hard=this.track.id==='hard',easy=this.track.id==='easy';
  this.renderer.shadowMap.enabled=roam;this.sun.castShadow=roam;this.renderer.shadowMap.needsUpdate=true;this.baseFov=this.framing().fov;this.camera.fov=this.baseFov;this.camera.updateProjectionMatrix();this.scene.background.set(this.track.background||(this.track.id==='park'?'#dcc3a2':roam?'#c8dce8':'#cbd7d7'));this.scene.fog.near=roam?80:42;this.scene.fog.far=roam?170:135;
  this.sky?.dispose();const skyPalette=this.track.sky||(this.track.id==='park'?{top:'#2f5fa8',bottom:'#e9c79c'}:roam?{top:'#4f86c6',bottom:'#cfe6e8'}:hard?{top:'#5c6788',bottom:'#c9c3b0'}:easy?{top:'#79b7e6',bottom:'#e9efd2'}:{top:'#e08a52',bottom:'#f6dfb0'});
  this.sky=buildSky(this.scene,{...skyPalette,sunPosition:v(-90,58,42)});
  if(this.track.id==='park'){buildFreePark(this);return;}
  if(this.track.id==='halfpipe'){buildHalfPipe(this);return;}
  if(this.track.trail){buildTrail(this,this.track);return;}
  if(this.track.palette){buildContestPark(this,this.track);return;}
  this.park=new T.Group();this.scene.add(this.park);this.capMaterials=[];const SEGMENTS=this.track.segments,end=this.track.end;
  this.scene.fog.color.set(hard?'#a4a7ae':easy?'#bbc6a4':'#b7b5a4');

  this.dirt=standard(hard?'#d0c9bd':easy?'#e1dcbd':'#ebe0cf',.97,{vertexColors:true});
  this.environment=new T.Group();this.park.add(this.environment);
  for(let si=0;si<SEGMENTS.length;si++){const s=SEGMENTS[si],next=SEGMENTS[si+1],prev=SEGMENTS[si-1];this.environment.add(earth(s,this.dirt));
   // Rounded soil at the exposed takeoff and landing ends; no rectangular floating platforms.
   if((s[6]==='lip'&&next&&next[0]>s[3]+.01)||(prev&&prev[3]<s[0]-.01)){
    const lip=s[6]==='lip',x=lip?s[3]:s[0],height=lip?s[4]:s[1],direction=lip?1:-1;
    const p=[],uv=[],ix=[];for(let i=0;i<=8;i++){const t=i/8;for(let j=0;j<=8;j++){const z=-2+j*.5;p.push(x+direction*Math.sin(t*Math.PI/2)*.7,height-(height+2.6)*t,z);uv.push(x/2.1+t,z/2.1);if(i<8&&j<8){const k=i*9+j;ix.push(k,k+9,k+1,k+1,k+9,k+10);}}}
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(lip?ix:ix.reverse());g.computeVertexNormals();const cap=this.dirt.clone();cap.vertexColors=false;cap.side=T.DoubleSide;this.environment.add(new T.Mesh(g,cap));(this.capMaterials??=[]).push(cap);
   }
  }
  this.groundMaterial=standard(this.track.ground,1);const ground=mesh(new T.PlaneGeometry(350,180),this.groundMaterial,this.park,v(end/2,-3.15,-32));ground.rotation.x=-Math.PI/2;const uv=ground.geometry.attributes.uv;for(let i=0;i<uv.count;i++){uv.setXY(i,uv.getX(i)*100,uv.getY(i)*50);}
  // Original rural photograph-style matte painting is geometry at a distance, not a screen overlay.
  this.backdrop=mesh(new T.PlaneGeometry(Math.max(330,end+170),125),new T.MeshBasicMaterial({color:hard?'#c9c8d6':easy?'#e6f0ed':'#ffffff',toneMapped:false,fog:false}),this.park,v(end/2,3,-100));this.backdrop.visible=false;
  const objects=new T.Group();this.park.add(objects);const wood=standard('#766653'),stone=standard('#8c826b'),leaves=standard('#666b42'),dry=standard('#99905e'),wire=standard('#8b8471',.6,{metalness:.35});
  let seed=81;const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<Math.ceil(end/4)+7;i++){const x=-10+i*4,z=-8.5;box(objects,[.07,1.1,.085],[x,-2.65,z],wood);for(const y of [-2.5,-2.9])tube(objects,v(x,y,z),v(x+4,y,z),.006,wire,3);}
  // Low instanced grasses and rocks provide scale while keeping mobile draw calls bounded.
  const grassG=new T.BufferGeometry();grassG.setAttribute('position',new T.Float32BufferAttribute([-.045,0,0,.045,0,0,.018,.34,0,0,0,-.045,0,0,.045,0,.28,.02],3));grassG.computeVertexNormals();const grassMat=standard('#8b8455',1,{side:T.DoubleSide});const grass=new T.InstancedMesh(grassG,grassMat,1100);const dummy=new T.Object3D();
  for(let i=0;i<1100;i++){const x=-9+rand()*(end+28),z=(rand()>.52?1:-1)*(2.2+rand()*8),q=trackAt(x,this.track),bank=clamp((Math.abs(z)-2)/5.8,0,1),y=q.solid?T.MathUtils.lerp(q.height,-3.1,Math.sin(bank*Math.PI/2)):-3.1;dummy.position.set(x,y-.02,z);dummy.rotation.set(0,rand()*6.28,(rand()-.5)*.3);dummy.scale.setScalar(.35+rand()*.9);dummy.updateMatrix();grass.setMatrixAt(i,dummy.matrix);grass.setColorAt(i,new T.Color().setHSL(.12+rand()*.035,.18,.28+rand()*.14));}this.park.add(grass);
  const rocks=new T.InstancedMesh(new T.IcosahedronGeometry(1,1),stone,hard?260:125);for(let i=0;i<(hard?260:125);i++){const x=-7+rand()*(end+20),z=(rand()>.5?1:-1)*(3.2+rand()*4.5),q=trackAt(x,this.track),bank=clamp((Math.abs(z)-2)/5.8,0,1),y=q.solid?T.MathUtils.lerp(q.height,-3.1,Math.sin(bank*Math.PI/2)):-3.1;dummy.position.set(x,y-.035,z);dummy.rotation.set(rand(),rand()*4,rand());const r=hard?.10+rand()*.44:.05+rand()*.12;dummy.scale.set(r*1.5,r*.55,r);dummy.updateMatrix();rocks.setMatrixAt(i,dummy.matrix);}this.park.add(rocks);
  // Alpha-tested distant tree cards retain leaf detail at two triangles per tree.
  this.treeMaterial=new T.MeshBasicMaterial({color:'#d5d3c5',alphaTest:.45,side:T.DoubleSide,toneMapped:false});
  this.trees=new T.InstancedMesh(new T.PlaneGeometry(1,1),this.treeMaterial,hard?10:34);this.trees.visible=false;this.treeLocations=[];
  for(let i=0;i<(hard?10:34);i++){const x=-20+i*(end+45)/(hard?10:34)+rand()*2.5,z=-17-rand()*28,h=5.5+rand()*5;this.treeLocations.push({x,z,h});dummy.position.set(x,-3.15+h/2,z);dummy.rotation.set(0,(rand()-.5)*.2,0);dummy.scale.set(h*.667,h,1);dummy.updateMatrix();this.trees.setMatrixAt(i,dummy.matrix);this.trees.setColorAt(i,new T.Color().setScalar(.85+rand()*.15));}this.park.add(this.trees);
  const marker=standard('#ede1c6');for(const s of SEGMENTS.filter(s=>s[6]==='lip'))for(const z of [-2.05,2.05]){box(objects,[.075,.75,.075],[s[3]-.15,s[4]+.3,z],wood);box(objects,[.08,.14,.08],[s[3]-.15,s[4]+.62,z],marker);}
  for(const z of [-2.5,2.5])box(objects,[.12,3.4,.12],[end,1.7,z],wood);box(objects,[.14,.2,5.2],[end,3.4,0],wood);
  mergeRigid(objects);
 }
 buildShadow(){const c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d'),r=g.createRadialGradient(64,64,4,64,64,62);r.addColorStop(0,'rgba(35,29,20,.55)');r.addColorStop(.35,'rgba(35,29,20,.24)');r.addColorStop(1,'rgba(35,29,20,0)');g.fillStyle=r;g.fillRect(0,0,128,128);this.blob=mesh(new T.PlaneGeometry(2.3,1.0),new T.MeshBasicMaterial({map:new T.CanvasTexture(c),transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1}),this.scene);if(!isRoam(this.track))this.addTreeShadows();}
 addTreeShadows(){const shadows=new T.InstancedMesh(new T.PlaneGeometry(1,1),this.blob.material.clone(),this.treeLocations.length),dummy=new T.Object3D();shadows.material.opacity=.42;for(let i=0;i<this.treeLocations.length;i++){const t=this.treeLocations[i];dummy.position.set(t.x+.8,-3.12,t.z+.6);dummy.rotation.set(-Math.PI/2,0,.3);dummy.scale.set(t.h*.58,t.h*.32,1);dummy.updateMatrix();shadows.setMatrixAt(i,dummy.matrix);}this.park.add(shadows);}
 pose(s){this.rig.pose(s);}
 targets(s,intro){return {x:intro?s.x-1.15:s.x+3.2,y:intro?s.y+.95:Math.max(2.2,s.y*.53+1.35),span:intro?4.6:9.1+Math.min(1.1,Math.max(0,s.y-3)*.16)};}
 update(s,dt,intro=false){
  if(s.freeRoam){this.updateFreeRoam(s,dt,intro);return;}
  this.riderRoot.position.set(s.x,s.y,0);this.riderRoot.rotation.set(0,0,s.pitch||0);this.riderRoot.rotateY(s.yaw||0);if(this.previousMode==='air'&&s.mode==='ground')this.landingPulse=.12;this.landingPulse=(this.landingPulse||0)*Math.exp(-dt*11);this.previousMode=s.mode;this.crouch=(this.crouch||0)+((s.pump?.14:0)-(this.crouch||0))*(1-Math.exp(-dt*18));const crankTarget=s.mode==='ground'&&s.speed<6&&!s.pump?-(s.wheelSpin||0)*.3:0;this.crankAngle=(this.crankAngle||0)+Math.atan2(Math.sin(crankTarget-(this.crankAngle||0)),Math.cos(crankTarget-(this.crankAngle||0)))*(1-Math.exp(-dt*16));this.pose({...s,pump:false,compression:this.landingPulse+this.crouch,crankAngle:this.crankAngle});
  this.rig.body.rotation.z=s.mode==='crash'?-.7-(s.crashTilt||0)*.5:0;this.rig.body.position.set(s.mode==='crash'?-.5-(s.crashTilt||0)*.3:0,s.mode==='crash'?-.18:0,s.mode==='crash'?.25:0);if(s.mode==='crash'){this.riderRoot.rotation.z=s.pitch+(s.crashTilt||0);this.riderRoot.rotation.x=(s.crashSpin||0)*(s.crashTilt||0)*.4;}
  const p=trackAt(s.x,this.track),height=Math.max(0,s.y-p.height);this.blob.visible=p.solid;this.blob.position.set(s.x+.15,p.height+.035,.12);this.blob.rotation.set(-Math.PI/2,0,0);this.blob.rotateY(-Math.atan(p.slope));this.blob.material.opacity=Math.max(.15,1-height*.15);this.blob.scale.setScalar(1+height*.06);
  const target=this.targets(s,intro),a=1-Math.exp(-dt*8);this.cameraX+=(target.x-this.cameraX)*a;this.cameraY+=(target.y-this.cameraY)*a;this.cameraSpan+=(target.span-this.cameraSpan)*a;
  const fovTarget=this.baseFov+Math.min(6,Math.abs(s.speed||0)*.28);this.camera.fov+=(fovTarget-this.camera.fov)*(1-Math.exp(-dt*4));this.camera.updateProjectionMatrix();
  const span=Math.max(this.cameraSpan,Math.min(intro?13:12.5,(intro?11.8:20)/this.camera.aspect)),distance=span/(2*Math.tan(T.MathUtils.degToRad(this.camera.fov/2)));
  this.look.set(this.cameraX,this.cameraY,0);this.camera.position.set(this.cameraX+(intro?2.4:1.4),this.cameraY+distance*.17,distance);this.camera.lookAt(this.look);
  this.applyShake(dt);this.sky.dome.position.copy(this.camera.position);this.sky.sun.position.set(this.camera.position.x-90,this.camera.position.y+55,this.camera.position.z+40);
  this.fillLight.position.set(s.x+10,s.y+9,-9);this.fillLight.target.position.set(s.x,s.y,0);this.fillLight.target.updateMatrixWorld();
  this.rimLight.position.set(s.x+2,s.y+7,-16);this.rimLight.target.position.set(s.x,s.y,0);this.rimLight.target.updateMatrixWorld();
  this.dust.update(dt,this.camera);this.sparks.update(dt,this.camera);
  this.renderer.render(this.scene,this.camera);this.renders++;this.resizeDirty=false;
 }
 applyShake(dt){if(this.shakeMag>0){this.shakeMag*=Math.exp(-dt*9);if(this.shakeMag<6e-4)this.shakeMag=0;else{this.camera.position.x+=(Math.random()-.5)*this.shakeMag;this.camera.position.y+=(Math.random()-.5)*this.shakeMag*.7;this.camera.position.z+=(Math.random()-.5)*this.shakeMag*.4;}}}
 impactPulse(strength=1){this.shakeMag=Math.min(.58,(this.shakeMag||0)+Math.min(.5,strength*.028));const pos=isRoam(this.track)?v(this.riderRoot.position.x,this.riderRoot.position.y+.05,this.riderRoot.position.z):v(this.riderRoot.position.x,this.riderRoot.position.y+.04,0);this.dust.spawn(pos,Math.min(17,4+strength*.6),{duration:.45+Math.min(.5,strength*.024),spread:1.3+strength*.07,size:.15+Math.min(.19,strength*.009)});}
 snapCamera(s,intro=false){if(s.freeRoam){this.followHeading=s.travelHeading;this.followPosition=null;this.followLook=null;return;}const target=this.targets(s,intro);this.cameraX=target.x;this.cameraY=target.y;this.cameraSpan=target.span;}
 updateFreeRoam(s,dt,intro){
  const rig=this.rig,air=s.mode==='air';this.riderRoot.position.set(s.x,s.y,s.z);this.riderRoot.rotation.set(0,-s.heading,0);this.riderRoot.rotateZ(s.pitch||0);this.riderRoot.rotateX(s.roll||0);
  // Load, extend, tuck, reach and absorb are driven by the actual jump state.
  // Take-off pop (a brief leg extension), then a tuck that builds toward the apex and opens
  // again before the wheels touch, scaled by the flight the physics predicted, so a big lip
  // air gets a deep, unhurried tuck and a small hop just a quick pull.
  const lip=air&&s.lipAir,phase=air?(s.airPhase||0):0,extension=air?Math.sin(Math.min(1,s.airtime/.16)*Math.PI)*(s.lastHop?.10:.06):0,airPose=air?Math.pow(Math.sin(Math.PI*Math.min(1,phase*1.08)),.75):0,tuck=airPose*(lip?.10:.07);
  // A bunny hop gets a bigger, snappier knee-tuck/pull-up than a plain ramp launch.
  const hopPull=air&&s.lastHop?Math.sin(Math.min(1,s.airtime/.22)*Math.PI)*.16:0;
  // A hop is not a rigid lift: the front wheel pops up first (bars pulled), the rear
  // follows a beat later, then the bike levels out for the rest of the flight.
  const tri=(t,center,width)=>Math.max(0,1-Math.abs(t-center)/width);
  const hopFrontLift=air&&s.lastHop?tri(s.airtime,.045,.075):0,hopRearLift=air&&s.lastHop?tri(s.airtime,.145,.115):0;
  // How committed to a flip the rider is: the rotation already banked, plus a head start from
  // the rate, so the tuck is there from the throw rather than a beat late.
  const flip=air?Math.abs(s.flipTurn||0)+Math.min(.5,Math.abs(s.flipRate||0)*.09):0;
  this.pose({...s,pump:false,compression:(air?tuck-extension-hopPull:s.compression)||0,airPose,airLean:airPose*(lip?.13:.08),flip,turnLook:air?Math.max(-1,Math.min(1,(s.turnRate||0)*.3)):0,crankAngle:s.crankAngle,hopFrontLift,hopRearLift});
  rig.body.rotation.z=s.mode==='crash'?-.65-(s.crashTilt||0)*.55:0;rig.body.position.set(s.mode==='crash'?-.4-(s.crashTilt||0)*.3:0,s.mode==='crash'?-.12:0,s.mode==='crash'?.24:0);if(s.mode==='crash'){this.riderRoot.rotateZ(s.crashTilt||0);this.riderRoot.rotateX((s.crashSpin||0)*(s.crashTilt||0)*.35);this.riderRoot.rotateY((s.crashSpin||0)*(s.crashTilt||0)*.22);
   // The bike keeps sliding a beat after the rider comes off it, and tumbles on its own
   // axis, so the crash reads as two things separating instead of one rigid unit falling.
   const extra=Math.min(2.4,Math.max(0,(s.crashBikeSlideDist||0)-(s.crashSlideDist||0)));rig.bike.position.x+=extra*.55;rig.bike.position.y+=Math.min(.5,extra*.14);rig.bike.rotation.x+=(s.crashSpin||0)*(s.crashTilt||0)*.6;rig.bike.rotation.z+=-(s.crashSpin||0)*(s.crashTilt||0)*.3;
  }
  const q=parkAt(s.x,s.z,this.track);this.blob.visible=false;
  // Lip airs (up a wall, auto-180, back into the transition) get their own camera: the
  // follow heading swings round slowly over the whole flight instead of snapping behind
  // the reversed travel direction in the first half-second, and the camera stays near lip
  // height looking *up* at the rider rather than climbing with them and looking down from
  // above the deck — the rider grows in frame as they go up, the way a vert air reads.
  const angle=s.travelHeading??s.heading;this.followHeading??=angle;
  // Over a lip air the swing is capped at ~100°: the camera slides round to a side view of
  // the rider against the sky and stops there (the deck side of a tall wall is the worst
  // place to watch from); the ground follow finishes the turn once the rider is rolling
  // away from the wall, which is a short, quick arc rather than a pass through the rider.
  if(lip&&!this.lipSwing){this.lipSwing={from:this.followHeading,turned:0};}if(!lip)this.lipSwing=null;
  let turn=Math.atan2(Math.sin(angle-this.followHeading),Math.cos(angle-this.followHeading))*(1-Math.exp(-dt*(lip?1.5:air?3.6:5.6)));
  if(lip){const room=1.75-this.lipSwing.turned;turn=Math.sign(turn)*Math.min(Math.abs(turn),Math.max(0,room));this.lipSwing.turned+=Math.abs(turn);}
  this.followHeading+=turn;
  const fr=this.framing(),c=Math.cos(this.followHeading),z=Math.sin(this.followHeading),distance=(lip?5.4:4.4)+fr.distance+Math.min(1.2,s.speed*.06)+(this.phone?Math.min(.5,s.speed*.04):0),lipBase=lip?Math.max(0,s.airOrigin||0):0,above=Math.max(0,s.y-q.height),height=lip?1.5+Math.max(0,s.y-lipBase)*.30-(s.y-lipBase)+fr.height*.5:2.05+fr.height+above*.22,ahead=fr.ahead+(this.phone?Math.min(1.4,s.speed*.12):0);
  let desired=v(s.x-c*distance+z*1.4,s.y+height,s.z-z*distance-c*1.4),look=v(s.x+c*ahead,s.y+fr.lookY,s.z+z*ahead);
  if(lip)look.set(s.x+c*.5,s.y+.55,s.z+z*.5);else if(air){const ahead=Math.min(4,Math.max(1,-s.vy*.2+2));look.set(s.x+c*ahead,q.height+Math.max(.5,above*.7+.65),s.z+z*ahead);}
  // The home page shows the rider: the camera stands 3 m off the front-left quarter of the
  // bike at chest height with the rider framed right of centre (the menu card sits on the
  // left), the park behind them.
  if(intro){const az=(s.heading||0)+2.35,dist=this.phone?3.6:3.8,cx=Math.cos(az),cz=Math.sin(az),rightX=cz,rightZ=-cx,shift=this.phone?.95:1.15;desired.set(s.x+cx*dist,s.y+1.35,s.z+cz*dist);look.set(s.x-rightX*shift,s.y+.72,s.z-rightZ*shift);}
  // Lift the camera above any ramp crossing its sightline to the rider.
  const under=parkHeight(desired.x,desired.z,this.track);desired.y=Math.max(desired.y,under+(under>s.y+.6?2.3:1.2));for(let i=1;i<6;i++){const t=i/6,x=T.MathUtils.lerp(desired.x,s.x,t),zz=T.MathUtils.lerp(desired.z,s.z,t),rayY=T.MathUtils.lerp(desired.y,s.y+1,t),ground=parkHeight(x,zz,this.track)+.45;if(ground>rayY)desired.y+=(ground-rayY)/(1-t);}
  this.followPosition??=desired.clone();this.followLook??=look.clone();this.followPosition.lerp(desired,1-Math.exp(-dt*(intro?20:6)));this.followLook.lerp(look,1-Math.exp(-dt*6));this.camera.position.copy(this.followPosition);this.camera.lookAt(this.followLook);
  const fovTarget=this.baseFov+Math.min(10,s.speed*.5)+(air?4:0);this.camera.fov+=(fovTarget-this.camera.fov)*(1-Math.exp(-dt*3.5));this.camera.updateProjectionMatrix();
  this.applyShake(dt);this.sky.dome.position.copy(this.camera.position);this.sky.sun.position.set(this.camera.position.x-90,this.camera.position.y+55,this.camera.position.z+40);
  // Light up the rail a hop would lock onto from here (physics decides which), pulsing
  // gently so it reads as a cue rather than a piece of the park.
  const target=intro?null:(s.targetRail||null);if(this.railGlowActive!==target){const old=this.railGlow?.[this.railGlowActive];if(old)old.visible=false;const next=this.railGlow?.[target];if(next)next.visible=true;this.railGlowActive=target;}
  if(target&&this.railGlowMaterial){this.glowClock=(this.glowClock||0)+dt;this.railGlowMaterial.opacity=.46+.16*Math.sin(this.glowClock*7);}
  if(s.mode==='grind'&&!intro){this.grindSparkTimer=(this.grindSparkTimer||0)-dt;if(this.grindSparkTimer<=0){this.grindSparkTimer=.045;this.sparks.spawn(v(s.x,s.y+.03,s.z),2,{duration:.28,spread:.5,up:1.6,size:.05,gravity:1.4});}}
  if(s.mode==='ground'&&!intro&&Math.abs(s.speed)>5){this.rollDustTimer=(this.rollDustTimer||0)-dt;if(this.rollDustTimer<=0){this.rollDustTimer=.10;this.dust.spawn(v(s.x-Math.cos(s.heading)*.42,s.y+.02,s.z-Math.sin(s.heading)*.42),1,{duration:.4,spread:.3,up:.3,size:.08,gravity:1.6});}}
  this.dust.update(dt,this.camera);this.sparks.update(dt,this.camera);
  if(this.markerBeacon){this.markerBeacon.visible=!!s.markerPos&&!intro;if(s.markerPos){this.markerBeacon.position.set(s.markerPos.x,parkHeight(s.markerPos.x,s.markerPos.z,this.track),s.markerPos.z);this.markerFlag.rotation.y=Math.atan2(this.camera.position.x-this.markerBeacon.position.x,this.camera.position.z-this.markerBeacon.position.z);this.markerRing.rotation.z+=dt*.6;this.beaconClock=(this.beaconClock||0)+dt*4;this.markerBeacon.scale.setScalar(1+Math.sin(this.beaconClock)*.06);}}
  // The shadow camera rides with the bike in height too — the trail drops over a hundred
  // metres from the start deck to the finish and the shadows have to come down with it.
  const groundY=this.track.trail?parkHeight(s.x,s.z,this.track):0;this.sun.position.set(s.x-12,groundY+28,s.z+10);this.sun.target.position.set(s.x,groundY,s.z);this.sun.target.updateMatrixWorld();
  this.fillLight.position.set(s.x+14,s.y+9,s.z-8);this.fillLight.target.position.set(s.x,s.y,s.z);this.fillLight.target.updateMatrixWorld();
  this.rimLight.position.set(s.x+3,s.y+7,s.z-18);this.rimLight.target.position.set(s.x,s.y,s.z);this.rimLight.target.updateMatrixWorld();
  this.renderer.shadowMap.needsUpdate=intro||this.renders%2===0;this.renderer.render(this.scene,this.camera);this.renders++;this.resizeDirty=false;
 }
 // Adaptive resolution: step down hard and quickly when frames are actually dropped, step back
 // up gently if there's clear headroom, capped at whatever the device's own pixel ratio allows.
 // A step down locks the ratio for a few seconds so it can't seesaw between two levels, and a
 // long stall (p90 frame time) counts as dropped frames even when the average looks fine.
 quality(fps,p90=0){const p=this.renderer.getPixelRatio();this.qualityHold=Math.max(0,this.qualityHold-1);
  if((fps<50||p90>24)&&p>.6){this.renderer.setPixelRatio(Math.max(.6,p-.25));this.qualityHold=4;}
  else if(fps>=57&&p90<19&&!this.qualityHold&&p<this.maxPixelRatio)this.renderer.setPixelRatio(Math.min(this.maxPixelRatio,p+.1));
  else return;
  this.resize();}
 stats(){return {trackId:this.track.id,geometries:this.renderer.info.memory.geometries,textures:this.renderer.info.memory.textures,drawCalls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles,pixelRatio:this.renderer.getPixelRatio(),shadowPasses:isRoam(this.track)?1:0,renders:this.renders,assetsReady:this.assetsReady,assetError:this.assetError};}
}
