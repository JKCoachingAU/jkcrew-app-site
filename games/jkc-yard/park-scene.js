import * as T from './vendor/three.module.js';
import {PARK_BOUNDS,QUARTER_START,BANK_START,RAILS,railPoint,FEATURES,featureHeight,parkHeight,ENVIRONMENTS,arcContains,pyramidHeight,HALFPIPE_SPEC} from './park.js';
import {v,mesh,tube,box,mergeRigid,ellipsoid} from './geometry.js';
import {makeSurfaceTextures,buildStructures} from './park-structures.js';
// Refine only the tight quarter transitions. Include the exact deck break so
// rendered coping and physical contact agree without a dense grid over the plaza.
export function createParkSurfaceGeometry(){
 const pos=[],uv=[],colors=[],ix=[];
 const range=(a,b,step)=>{const values=[];for(let n=0;a+n*step<b-.00001;n++)values.push(a+n*step);values.push(b);return values;};
 // Vertex colours sort the surface into materials by eye: pale plaza concrete, a darker
 // smooth "skatelite" grey on the ramp faces themselves, teal-painted shoulders on their
 // sides, and a pale pool-blue inside the bowl, so the park reads as built structures on
 // a plaza rather than one continuous grey lump.
 const bowls=ENVIRONMENTS.street.bowls||[];
 const section=(xs,zs)=>{const base=pos.length/3;for(let i=0;i<xs.length;i++)for(let j=0;j<zs.length;j++){const x=xs[i],z=zs[j],h=parkHeight(x,z,ENVIRONMENTS.street,true);pos.push(x,h,z);uv.push(x/3,z/3);let tone=.91+.035*Math.sin(x*.77+z*.2)+.018*Math.sin(z*2.1);let ramp=false,side=false,tint=null,ao=1;for(const f of FEATURES){const c=Math.cos(f.yaw),sn=Math.sin(f.yaw),u=(x-f.x)*c+(z-f.z)*sn,w=-(x-f.x)*sn+(z-f.z)*c;
   // Contact shadow: the flat darkens within a metre of a built structure's side panel.
   if(f.surface&&u>=f.segments[0][0]-.4&&u<=f.segments.at(-1)[3]+.4){const d=Math.abs(w)-f.width/2;if(d>0&&d<1.1&&parkHeight(f.x+c*u-sn*Math.sign(w)*f.width/2*.98,f.z+sn*u+c*Math.sign(w)*f.width/2*.98)>.3)ao=Math.min(ao,.62+.38*(d/1.1));}
   if(featureHeight(f,x,z)<=.08)continue;if(Math.abs(w)>f.width/2+.1)side=true;else{ramp=true;if(f.tint)tint=f.tint;}}tone*=ao;const inBowl=bowls.some(b=>Math.hypot(x-b.cx,z-b.cz)<b.flatRadius+b.radius*.97+.2);
  if(inBowl)colors.push(tone*.86,tone*.90,tone*.93);else if(side)colors.push(tone*.20,tone*.23,tone*.26);else if(ramp&&tint)colors.push(tone*tint[0],tone*tint[1],tone*tint[2]);else if(ramp)colors.push(tone*.72,tone*.75,tone*.78);else colors.push(tone,tone,tone);
  if(i<xs.length-1&&j<zs.length-1){const k=base+i*zs.length+j;ix.push(k,k+1,k+zs.length,k+1,k+zs.length+1,k+zs.length);}}};
 section(range(-QUARTER_START,QUARTER_START,.5),range(-PARK_BOUNDS.z,PARK_BOUNDS.z,.5));const zs=[-PARK_BOUNDS.z,...range(-BANK_START-4.5,-BANK_START,.25),...range(-BANK_START+3,BANK_START-3,6),...range(BANK_START,BANK_START+4.5,.25),PARK_BOUNDS.z],right=[...range(QUARTER_START,QUARTER_START+3.201,.06),58,72,PARK_BOUNDS.x];section(right,zs);section(right.map(x=>-x).reverse(),zs);
 const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(pos,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geo.setAttribute('color',new T.Float32BufferAttribute(colors,3));geo.setIndex(ix);geo.computeVertexNormals();return geo;
}
// Small spatial chunks allow iPhone GPUs to skip concrete behind the follow camera.
export function splitSurfaceGeometry(geo,size=24){const groups=new Map(),pos=geo.attributes.position;
 for(let i=0;i<geo.index.count;i+=3){const ids=[geo.index.getX(i),geo.index.getX(i+1),geo.index.getX(i+2)],x=ids.reduce((n,k)=>n+pos.getX(k),0)/3,z=ids.reduce((n,k)=>n+pos.getZ(k),0)/3,key=Math.floor(x/size)+','+Math.floor(z/size);let g=groups.get(key);if(!g){g={source:[],lookup:new Map(),indices:[]};groups.set(key,g);}for(const id of ids){if(!g.lookup.has(id)){g.lookup.set(id,g.source.length);g.source.push(id);}g.indices.push(g.lookup.get(id));}}
 return [...groups.values()].map(part=>{const g=new T.BufferGeometry();for(const [name,a] of Object.entries(geo.attributes)){const values=new Float32Array(part.source.length*a.itemSize);part.source.forEach((id,i)=>{for(let j=0;j<a.itemSize;j++)values[i*a.itemSize+j]=a.array[id*a.itemSize+j];});g.setAttribute(name,new T.BufferAttribute(values,a.itemSize));}g.setIndex(part.indices);g.computeBoundingSphere();return g;});
}

// Rails read from any angle: a brighter, less mirror-like steel than the fence tubes (a
// fully metallic tube with only the horizon to reflect renders as a dark thread), a soft
// contact shadow on the ground under ground-level rails, and a hidden glow sleeve per rail
// that scene.js switches on for the rail a hop would catch from where the bike is.
const railSteel=new T.MeshStandardMaterial({color:'#dde6eb',metalness:.55,roughness:.34}),railShadow=new T.MeshBasicMaterial({color:'#000000',transparent:true,opacity:.26,depthWrite:false}),railGlowMaterial=new T.MeshBasicMaterial({color:'#4ff0dc',transparent:true,opacity:.5,depthWrite:false});
export function buildRails(view,park,props,rails,env){
 view.railGlow={};view.railGlowMaterial=railGlowMaterial;const glowGroup=new T.Group();park.add(glowGroup);
 for(const rail of rails){const a=railPoint(rail,0),b=railPoint(rail,1),r=rail.radius*1.18;
  tube(props,v(a.x,a.y-rail.radius,a.z),v(b.x,b.y-rail.radius,b.z),rail.coping?rail.radius*1.3:r,railSteel,12);
  if(!rail.coping)for(let u=.08;u<1;u+=.28){const q=railPoint(rail,u),floor=parkHeight(q.x,q.z,env);tube(props,v(q.x,floor,q.z),v(q.x,q.y-rail.radius,q.z),.03,railSteel,8);box(props,[.24,.024,.24],[q.x,floor+.012,q.z],railSteel);}
  if(!rail.coping){const n=Math.max(2,Math.round(rail.length/1.5));for(let i=0;i<n;i++){const q0=railPoint(rail,i/n),q1=railPoint(rail,(i+1)/n),f0=parkHeight(q0.x,q0.z,env),f1=parkHeight(q1.x,q1.z,env);if(q0.y-f0>1.1||q1.y-f1>1.1)continue;
   const g=new T.PlaneGeometry(Math.hypot(q1.x-q0.x,q1.z-q0.z,f1-f0),.6),m=mesh(g,railShadow,props,v((q0.x+q1.x)/2,(f0+f1)/2+.014,(q0.z+q1.z)/2));m.rotation.set(-Math.PI/2,0,0);m.rotateZ(-rail.heading);m.rotateY(-Math.atan2(f1-f0,Math.hypot(q1.x-q0.x,q1.z-q0.z)));}}
  const glow=tube(glowGroup,v(a.x,a.y-rail.radius,a.z),v(b.x,b.y-rail.radius,b.z),rail.radius*3.4,railGlowMaterial,10);glow.visible=false;glow.renderOrder=3;view.railGlow[rail.id]=glow;}
}
export function buildFreePark(view){
 const scene=view.scene,park=view.park=new T.Group();scene.add(park);scene.fog.color.set('#d9c3a6');
 const concrete=new T.MeshStandardMaterial({color:'#aab2b7',roughness:.9,vertexColors:true}),edge=new T.MeshStandardMaterial({color:'#167f78',roughness:.7}),steel=new T.MeshStandardMaterial({color:'#b8c7cf',metalness:.85,roughness:.32}),wood=new T.MeshStandardMaterial({color:'#8c6550',roughness:.9});
 view.concreteMaterial=concrete;view.capMaterials=[];
 const geo=createParkSurfaceGeometry();for(const chunk of splitSurfaceGeometry(geo)){const surface=mesh(chunk,concrete,park);surface.receiveShadow=true;}geo.dispose();
 const surfaceTextures=makeSurfaceTextures();buildStructures(park,surfaceTextures);
 const props=new T.Group();park.add(props);
 // Narrow saw-cut expansion joints on the plaza and coping at the quarter decks.
 const seam=new T.MeshStandardMaterial({color:'#84959c',roughness:1});
 for(let x=-QUARTER_START;x<=QUARTER_START;x+=6)for(let z=-BANK_START+1;z<BANK_START-1;z+=.8){if(Math.abs(parkHeight(x,z))<.015&&Math.abs(parkHeight(x,z+.8))<.015)tube(props,v(x,.008,z),v(x,.008,z+.8),.006,seam,3);}
 for(const x of [-QUARTER_START-3.20,QUARTER_START+3.20])tube(props,v(x,parkHeight(x,0)+.018,-BANK_START),v(x,parkHeight(x,0)+.018,BANK_START),.035,steel,10);
 // Blue deck edging gives the concrete forms a readable silhouette at riding speed.
 for(const side of [-1,1]){box(props,[.28,.16,PARK_BOUNDS.z*2+2],[side*(PARK_BOUNDS.x-.3),2.50,0],edge);box(props,[PARK_BOUNDS.x*2+2,.16,.25],[0,1.70,side*(PARK_BOUNDS.z-.3)],edge);}
 for(const f of FEATURES){if(f.surface)continue;const c=Math.cos(f.yaw),s=Math.sin(f.yaw);for(const side of [-1,1]){for(let k=0;k<f.segments.at(-1)[3];k+=.30){const x=f.x+c*k-s*(f.width/2+.20)*side,z=f.z+s*k+c*(f.width/2+.20)*side,x2=f.x+c*(k+.3)-s*(f.width/2+.20)*side,z2=f.z+s*(k+.3)+c*(f.width/2+.20)*side;tube(props,v(x,parkHeight(x,z)+.008,z),v(x2,parkHeight(x2,z2)+.008,z2),.014,edge,3);}}}
 // Perimeter guardrail and seating sit beyond the playable boundary.
 for(const side of [-1,1])for(let x=-PARK_BOUNDS.x;x<=PARK_BOUNDS.x;x+=4){const z=side*(PARK_BOUNDS.z+1.2);for(const h of [2.25,2.7])tube(props,v(x,h,z),v(Math.min(x+4,PARK_BOUNDS.x),h,z),.025,steel,6);tube(props,v(x,1.6,z),v(x,2.75,z),.025,steel,6);}
 for(const side of [-1,1])for(let z=-(PARK_BOUNDS.z-2);z<=PARK_BOUNDS.z-2;z+=4){const x=side*(PARK_BOUNDS.x+1.2);tube(props,v(x,2.4,z),v(x,3.5,z),.025,steel,6);tube(props,v(x,3.45,z),v(x,3.45,Math.min(PARK_BOUNDS.z-2,z+4)),.025,steel,6);}
 for(const x of [-23,-9,9,23]){for(let i=0;i<4;i++)box(props,[2.9,.055,.13],[x,.57,PARK_BOUNDS.z+3+i*.17],wood);for(const dx of [-1,1]){box(props,[.07,.58,.58],[x+dx,.27,PARK_BOUNDS.z+3.27],steel);}}
 mergeRigid(props);props.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
 // Rideable rail tops exactly match the peg catch segments in physics.
 buildRails(view,park,props,RAILS,ENVIRONMENTS.street);
 mergeRigid(props);
 // Industrial buildings frame the yard without adding expensive interactive interiors.
 const buildings=new T.Group();park.add(buildings);const brick=new T.MeshStandardMaterial({color:'#625b56',roughness:.96}),panel=new T.MeshStandardMaterial({color:'#38474e',roughness:.82}),glass=new T.MeshStandardMaterial({color:'#52636b',roughness:.3,metalness:.4}),dark=new T.MeshStandardMaterial({color:'#202a2d',roughness:.9});
 for(const [x,z,w,h,d] of [[-36,-77,42,11,12],[23,-80,52,15,15],[-107,0,12,9,99],[107,25,12,13,85]]){box(buildings,[w,h,d],[x,h/2,z],brick);box(buildings,[w+.5,.28,d+.5],[x,h+.14,z],dark);for(let xx=x-w/2+2;xx<x+w/2-1;xx+=3.5){box(buildings,[2.1,2.3,.08],[xx,h-3,z+d/2+.06],glass);box(buildings,[2.3,.14,.19],[xx,h-4.2,z+d/2+.12],panel);}if(w<20){const wall=x-Math.sign(x)*(w/2+.06);for(let zz=z-d/2+3;zz<z+d/2-2;zz+=4){box(buildings,[.08,2.3,2.3],[wall,h-3,zz],glass);box(buildings,[.18,.14,2.5],[wall,h-4.2,zz],panel);}for(let zz=z-d/2+6;zz<z+d/2;zz+=15){box(buildings,[.12,5.1,6],[wall,2.6,zz],panel);for(let yy=.5;yy<5;yy+=.38)box(buildings,[.15,.035,5.9],[wall,yy,zz],dark);}}if(w>20)for(let xx=x-w/2+5;xx<x+w/2;xx+=13){box(buildings,[6,5.1,.12],[xx,2.6,z+d/2+.04],panel);for(let yy=.5;yy<5;yy+=.38)box(buildings,[5.9,.035,.03],[xx,yy,z+d/2+.12],dark);}}
 // Street lamps and a fire escape line along the near buildings for the NYC-block feel.
 for(const x of [-64,-21,21,64])for(const z of [-65,65]){tube(buildings,v(x,1.7,z),v(x,9,z),.07,dark,8);box(buildings,[1.4,.18,.5],[x,9,z],panel);}
 for(let zz=-30;zz<30;zz+=5){box(buildings,[.06,3.2,1.1],[-107-6.1,4.6,zz],dark);box(buildings,[1.1,.06,1.1],[-107-6.1,3,zz],dark);}
 mergeRigid(buildings);buildings.traverse(o=>{if(o.isMesh)o.receiveShadow=true;});
 // The surrounding asphalt sheet has a hole cut for each sunken bowl (it lies just under
 // grade, so it would otherwise cap the bowl); the plane is rotated -90° about X, which
 // maps world z to local -y.
 const groundShape=new T.Shape();groundShape.moveTo(-220,-220);groundShape.lineTo(220,-220);groundShape.lineTo(220,220);groundShape.lineTo(-220,220);groundShape.closePath();
 for(const b of ENVIRONMENTS.street.bowls||[]){const hole=new T.Path();hole.absarc(b.cx,-b.cz,b.flatRadius+b.radius*.97+.6,0,Math.PI*2,true);groundShape.holes.push(hole);}
 const ground=mesh(new T.ShapeGeometry(groundShape,48),new T.MeshStandardMaterial({color:'#5a5f62',roughness:1}),park,v(0,-.08,0));ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;
 view.treeMaterial=new T.MeshBasicMaterial({color:'#d2dcd4',alphaTest:.45,side:T.DoubleSide,toneMapped:false});view.trees=new T.InstancedMesh(new T.PlaneGeometry(1,1),view.treeMaterial,56);view.trees.visible=false;view.treeLocations=[];const dummy=new T.Object3D();
 for(let i=0;i<28;i++){const a=i/28*Math.PI*2,r=110+(i%4)*6,x=Math.cos(a)*r,z=Math.sin(a)*r,h=6+i%5;view.treeLocations.push({x,z,h});for(let j=0;j<2;j++){dummy.position.set(x,h/2-.08,z);dummy.rotation.set(0,a+j*Math.PI/2,0);dummy.scale.set(h*.667,h,1);dummy.updateMatrix();view.trees.setMatrixAt(i*2+j,dummy.matrix);}}park.add(view.trees);
 // A distant Manhattan-style skyline silhouette reads as a city block from every angle instead of rural hills.
 const skyline=new T.Group();park.add(skyline);const skylineMat=new T.MeshStandardMaterial({color:'#4b545c',roughness:1}),skylineMat2=new T.MeshStandardMaterial({color:'#5e6a73',roughness:1});
 for(let i=0;i<34;i++){const a=i/34*Math.PI*2,r=175+(i%5)*10,w=14+(i%3)*7,h=26+(i%6)*13,tower=mesh(new T.BoxGeometry(w,h,w),i%2?skylineMat:skylineMat2,skyline,v(Math.cos(a)*r,h/2-9,Math.sin(a)*r));tower.rotation.y=a+.3;if(i%4===0)mesh(new T.BoxGeometry(w*.35,h*.16,w*.35),skylineMat,skyline,v(Math.cos(a)*r,h+h*.08-9,Math.sin(a)*r));}
 mergeRigid(skyline);
 const signCanvas=document.createElement('canvas');signCanvas.width=1024;signCanvas.height=256;const ctx=signCanvas.getContext('2d');ctx.fillStyle='#090e11';ctx.fillRect(0,0,1024,256);ctx.fillStyle='#16dfcf';ctx.font='italic 800 105px Arial';ctx.textAlign='center';ctx.fillText('JKCREW',512,140);ctx.font='28px Arial';ctx.fillText('RIDE TOGETHER. PROGRESS TOGETHER.',512,198);const signTexture=new T.CanvasTexture(signCanvas);signTexture.colorSpace=T.SRGBColorSpace;const groundPrint=mesh(new T.PlaneGeometry(7,1.75),new T.MeshStandardMaterial({map:signTexture,roughness:1}),park,v(-27,.013,-15.5));groundPrint.rotation.x=-Math.PI/2;const sign=mesh(new T.PlaneGeometry(8,2),new T.MeshStandardMaterial({map:signTexture,roughness:.8,side:T.DoubleSide}),park,v(0,4,-BANK_START-9.7));sign.castShadow=true;
 // Open-world touches: the dense ramp cluster and the new big bowl each get their own
 // painted ground label, like the signage at a real multi-area skatepark.
 const zoneTexture=(text,color,w=512,h=128,size=60)=>{const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');g.fillStyle=color;g.font='800 '+size+'px Arial';g.textAlign='center';g.textBaseline='middle';g.fillText(text,w/2,h/2);const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;return t;};
 // Painted zone names on the plaza, one per line, like the signage at a real multi-area park.
 const bowl=ENVIRONMENTS.street.bowls[0],zoneTextures=[];
 for(const [text,color,x,z,turn,w] of [['THE LINE','#16dfcf',-16,13,0,10],['HALF PIPE','#16dfcf',-31.5,31.2,0,10],['MINI RAMP','#16dfcf',-27,-16.5,0,10],['THE BOWL','#ff8a3d',bowl.cx,bowl.cz-bowl.flatRadius-bowl.radius-1.9,0,8],['STREET','#ff8a3d',41.5,-14,Math.PI/2,8],['THE HIP','#ff8a3d',20.2,-31.4,0,8],['BIG SPINE','#ff8a3d',26,-12.6,0,8]]){
  const texture=zoneTexture(text,color,512,128,text.length>8?54:66);zoneTextures.push(texture);const label=mesh(new T.PlaneGeometry(w,w/4),new T.MeshStandardMaterial({map:texture,transparent:true,roughness:1,depthWrite:false}),park,v(x,.014,z));label.rotation.x=-Math.PI/2;label.rotation.z=turn;}
 // Real stair steps on every feature that declares `stairs`: a run of concrete treads
 // across the full width of the descending segment, each sitting at the bank's height at
 // its own centre, with a dark nosing strip. The rider physically rides the smooth bank
 // underneath (that's what keeps the physics continuous), but the treads poke through by
 // half a rise each, so the drop reads unmistakably as a stair set from any angle.
 const stepMat=new T.MeshStandardMaterial({color:'#8d9599',roughness:.92}),stepEdge=new T.MeshStandardMaterial({color:'#3e4649',roughness:.8});
 for(const f of FEATURES){if(!f.stairs)continue;const seg=f.segments[f.stairs.segment],c=Math.cos(f.yaw),s=Math.sin(f.yaw),run=(seg[3]-seg[0])/f.stairs.steps;
  for(let i=0;i<f.stairs.steps;i++){const u0=seg[0]+i*run,uMid=u0+run/2,h=Math.max(.05,parkHeight(f.x+c*uMid,f.z+s*uMid)),tread=box(props,[run+.02,h,f.width+.3],[f.x+c*uMid,h/2,f.z+s*uMid],stepMat);tread.rotation.y=-f.yaw;
   const nose=box(props,[.07,.03,f.width+.3],[f.x+c*(u0+.035),h+.016,f.z+s*(u0+.035)],stepEdge);nose.rotation.y=-f.yaw;}
  // Low block walls flank the steps so the run reads as a built stairway, not a bank.
  for(const side of [-1,1]){const w=side*(f.width/2+.32),u0=seg[0]-.2,u1=seg[3]+.2,uMid=(u0+u1)/2,top=Math.max(parkHeight(f.x+c*u0-s*w,f.z+s*u0+c*w),.2);const wall=box(props,[u1-u0,top+.12,.26],[f.x+c*uMid-s*w,(top+.12)/2-.02,f.z+s*uMid+c*w],stepMat);wall.rotation.y=-f.yaw;}
 }
 // Floodlight towers at the four corners of the riding area, a three-tier bleacher along
 // the north-east edge with JKCREW banners on its back, painted speed-lane markings down
 // the long south straight, and tyre stacks by the mini ramp — the props that make a
 // yard feel like somewhere sessions actually happen rather than an empty lot.
 const pole=new T.MeshStandardMaterial({color:'#2b3134',roughness:.7,metalness:.5}),lamp=new T.MeshBasicMaterial({color:'#fff3d0',toneMapped:false}),tyre=new T.MeshStandardMaterial({color:'#141516',roughness:.95});
 for(const [x,z] of [[-45.4,-30.6],[45.4,-30.6],[-45.4,30.6],[45.4,30.6]]){tube(props,v(x,0,z),v(x,11,z),.12,pole,10);box(props,[.9,.5,.5],[x,11.2,z],pole);const toward=Math.atan2(-z,-x);for(let i=0;i<3;i++){const l=box(props,[.42,.28,.5],[x+Math.cos(toward)*.55,11.55+i*.02,z+Math.sin(toward)*.55+(i-1)*.62],lamp);l.rotation.y=-toward;}tube(props,v(x,0,z),v(x+Math.cos(toward)*.9,3.2,z+Math.sin(toward)*.9),.05,pole,6);}
 const seat=new T.MeshStandardMaterial({color:'#8e969a',roughness:.85,metalness:.35});
 const deckY=1.7,bleacherZ=BANK_START+6;for(let tier=0;tier<3;tier++){box(props,[22,.10,.7],[30,deckY+.42+tier*.42,bleacherZ+tier*.9],seat);box(props,[22,.42+tier*.42,.10],[30,deckY+(.42+tier*.42)/2,bleacherZ+.35+tier*.9],seat);}
 for(let x=19.5;x<=40.5;x+=7)tube(props,v(x,deckY,bleacherZ+3),v(x,deckY+3.3,bleacherZ+3),.05,pole,6);
 const banner=mesh(new T.PlaneGeometry(20.4,1.9),new T.MeshStandardMaterial({map:signTexture,roughness:.85,side:T.DoubleSide}),park,v(30,deckY+2.3,bleacherZ+3.02));
 const lane=new T.MeshStandardMaterial({color:'#16dfcf',roughness:1,transparent:true,opacity:.75,depthWrite:false});
 // A painted start box and arrow at the drop-in end of THE LINE.
 for(const z of [2.4,9.6]){const line=mesh(new T.PlaneGeometry(7,.16),lane,park,v(-44,.012,z));line.rotation.x=-Math.PI/2;}
 for(let x=-46.5;x<=-41.5;x+=2.5){for(const sign of [-1,1]){const chev=mesh(new T.PlaneGeometry(1.6,.16),lane,park,v(x+.5,.012,6+sign*.55));chev.rotation.x=-Math.PI/2;chev.rotation.z=sign*.7;}}
 for(const [x,z,n] of [[-41.5,-17,3],[-40.2,-15.7,2],[-43,-15.5,4]])for(let i=0;i<n;i++){const t=mesh(new T.TorusGeometry(.30,.09,8,20),tyre,props,v(x,.09+i*.18,z));t.rotation.x=Math.PI/2;}
 // A short chain-link-fenced alley and dumpster tucked beside the north warehouse, an
 // original spray-paint mural on its inner wall, and a two-tone curb along the plaza edge
 // fill in the street-level detail a bare plaza-plus-buildings layout was still missing.
 const alleyX=-36+21+.4,alleyZ0=-77-6,alleyZ1=-77+6,alleyDepth=9;
 const alleyBrick=new T.MeshStandardMaterial({color:'#514a45',roughness:.97});
 box(buildings,[.5,9,alleyZ1-alleyZ0],[alleyX,4.5,(alleyZ0+alleyZ1)/2],alleyBrick);
 box(buildings,[alleyDepth,9,.5],[alleyX+alleyDepth/2,4.5,alleyZ0],alleyBrick);
 box(buildings,[alleyDepth,9,.5],[alleyX+alleyDepth/2,4.5,alleyZ1],alleyBrick);
 // Original abstract spray-paint mural, generated at build time (no borrowed artwork or logos).
 const graffiti=document.createElement('canvas');graffiti.width=512;graffiti.height=256;const g=graffiti.getContext('2d');
 g.fillStyle='#3a352f';g.fillRect(0,0,512,256);
 const tagColors=['#ff5d73','#ffce4d','#16dfcf','#7d5fff','#ff8a3d'];let seed=7;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
 for(let i=0;i<5;i++){g.fillStyle=tagColors[i%tagColors.length];g.globalAlpha=.85;const cx=40+rnd()*430,cy=60+rnd()*140,r=30+rnd()*46;g.beginPath();g.ellipse(cx,cy,r,r*.62,rnd()*Math.PI,0,Math.PI*2);g.fill();}
 g.globalAlpha=1;g.fillStyle='#0d0f10';g.font='italic 900 84px Arial';g.textAlign='center';g.fillText('JKC',256,150);
 g.strokeStyle='#f5f2e6';g.lineWidth=4;g.strokeText('JKC',256,150);
 for(let i=0;i<40;i++){g.fillStyle=`rgba(245,242,230,${.05+rnd()*.08})`;g.fillRect(rnd()*512,rnd()*256,2+rnd()*3,2+rnd()*3);}
 const graffitiTexture=new T.CanvasTexture(graffiti);graffitiTexture.colorSpace=T.SRGBColorSpace;
 const mural=mesh(new T.PlaneGeometry(alleyDepth-1,6.5),new T.MeshStandardMaterial({map:graffitiTexture,roughness:.95}),buildings,v(alleyX+alleyDepth/2,4.2,alleyZ1-.28));mural.rotation.y=Math.PI;
 // Chain-link fence closing the alley mouth: alpha-tested diamond mesh on a canvas texture.
 const chain=document.createElement('canvas');chain.width=chain.height=64;const cg=chain.getContext('2d');cg.strokeStyle='rgba(200,205,206,.95)';cg.lineWidth=2.4;cg.beginPath();for(let i=-1;i<3;i++){cg.moveTo(i*32,-16);cg.lineTo(i*32+64,80);cg.moveTo(i*32+64,-16);cg.lineTo(i*32,80);}cg.stroke();
 const chainTexture=new T.CanvasTexture(chain);chainTexture.wrapS=chainTexture.wrapT=T.RepeatWrapping;chainTexture.repeat.set(3,1.4);
 const fence=mesh(new T.PlaneGeometry(alleyZ1-alleyZ0-.5,3.6),new T.MeshStandardMaterial({map:chainTexture,transparent:true,alphaTest:.4,side:T.DoubleSide,roughness:.8,metalness:.3}),buildings,v(alleyX-.02,1.8,(alleyZ0+alleyZ1)/2));fence.rotation.y=Math.PI/2;
 for(const z of [alleyZ0+.02,alleyZ1-.02])tube(buildings,v(alleyX,0,z),v(alleyX,3.7,z),.035,steel,6);
 // Chain-link fence around the whole riding area, hung on the existing guardrail posts —
 // the thing every real skatepark has around it. Finer mesh than the alley's panel.
 const fenceTexture=chainTexture.clone();fenceTexture.needsUpdate=true;const fenceMat=new T.MeshStandardMaterial({map:fenceTexture,transparent:true,alphaTest:.4,side:T.DoubleSide,roughness:.8,metalness:.3});
 for(const side of [-1,1]){const zEdge=side*(PARK_BOUNDS.z+1.2),zFence=mesh(new T.PlaneGeometry(PARK_BOUNDS.x*2,2.5),fenceMat.clone(),park,v(0,1.3,zEdge));zFence.material.map=fenceTexture.clone();zFence.material.map.repeat.set(PARK_BOUNDS.x*2/.9,2.5/.9);zFence.material.map.needsUpdate=true;
  const xEdge=side*(PARK_BOUNDS.x+1.2),xFence=mesh(new T.PlaneGeometry(PARK_BOUNDS.z*2,2.5),fenceMat.clone(),park,v(xEdge,1.3,0));xFence.rotation.y=Math.PI/2;xFence.material.map=fenceTexture.clone();xFence.material.map.repeat.set(PARK_BOUNDS.z*2/.9,2.5/.9);xFence.material.map.needsUpdate=true;
  view.parkOwnedTextures=(view.parkOwnedTextures||[]).concat([zFence.material.map,xFence.material.map]);}
 fenceTexture.dispose();
 // A dumpster tucked in the alley, with a hinged-looking lid and a couple of trash bags.
 const dumpsterMat=new T.MeshStandardMaterial({color:'#2f5a3d',roughness:.75,metalness:.15}),lidMat=new T.MeshStandardMaterial({color:'#274d34',roughness:.7,metalness:.2}),bagMat=new T.MeshStandardMaterial({color:'#1c1d1f',roughness:.95});
 const dumpsterZ=(alleyZ0+alleyZ1)/2,dumpsterX=alleyX+2.4;
 box(buildings,[2.4,1.35,1.5],[dumpsterX,.68,dumpsterZ],dumpsterMat);box(buildings,[2.5,.12,1.6],[dumpsterX,1.4,dumpsterZ],lidMat);
 for(const [dx,dz] of [[.7,-.3],[1.3,.35]])ellipsoid(buildings,[.34,.28,.34],[dumpsterX+dx,.32,dumpsterZ+dz],bagMat,8);
 // A raised, lighter-toned curb strip separates the ridden plaza from the surrounding sidewalk.
 const curb=new T.MeshStandardMaterial({color:'#c7cdc9',roughness:.85});
 for(const side of [-1,1]){box(props,[.5,.14,PARK_BOUNDS.z*2-1],[side*(PARK_BOUNDS.x-.85),.07,0],curb);box(props,[PARK_BOUNDS.x*2-1,.14,.5],[0,.07,side*(PARK_BOUNDS.z-.85)],curb);}
 mergeRigid(buildings,new Set([mural,fence]));mergeRigid(props);
 view.parkOwnedTextures=[...(view.parkOwnedTextures||[]),signTexture,graffitiTexture,chainTexture,...zoneTextures,...Object.values(surfaceTextures)];
}
// The Vert Ramp: a contest vert ramp the way one is actually built — two 13 ft
// transitions over a 4.9 m flat, blue Skatelite riding surface with panel seams, steel
// coping, plywood decks behind both lips with guard rails, the roll-in tower on the
// right deck, plywood profile walls closing the ends, the whole thing standing on a
// scaffold stage 1.2 m above the arena floor, with crowd barriers and floodlights.
export function buildHalfPipe(view){
 const scene=view.scene,park=view.park=new T.Group();scene.add(park);scene.fog.color.set('#cfd6dd');const env=view.track,S=HALFPIPE_SPEC,W=S.width,STAGE=1.2;
 const tex=makeSurfaceTextures();
 const ride=new T.MeshStandardMaterial({map:tex.concrete,color:'#2f6fcc',roughness:.5,metalness:.03}),deckMat=new T.MeshStandardMaterial({map:tex.plywood,color:'#5a463a',roughness:.85}),sideMat=new T.MeshStandardMaterial({map:tex.panelDark,roughness:.88,side:T.DoubleSide}),steel=new T.MeshStandardMaterial({color:'#dfe6ea',metalness:.6,roughness:.35}),scaffold=new T.MeshStandardMaterial({color:'#8c9399',metalness:.7,roughness:.4}),stage=new T.MeshStandardMaterial({color:'#23272a',roughness:.95});
 view.concreteMaterial=new T.MeshStandardMaterial({color:'#3a3f44',roughness:1});view.capMaterials=[];
 // Ramp profile (walls + decks, without the roll-in): sampled by arc angle up the
 // transitions so the near-vertical top is smooth, straight across the flat and decks.
 const profile=x=>{const d=Math.abs(x)-S.flat;if(d<=0)return 0;if(d>=S.radius*S.cut)return S.top;return S.radius-Math.sqrt(S.radius*S.radius-d*d);};
 const xs=[];const back=S.lip+S.deck;for(let x=-back;x<-S.lip-.001;x+=.6)xs.push(x);xs.push(-S.lip);const thetaMax=Math.asin(S.cut);for(let i=60;i>=1;i--){const t=thetaMax*i/60;xs.push(-(S.flat+S.radius*Math.sin(t)));}for(let x=-S.flat;x<=S.flat+.001;x+=.35)xs.push(x);for(let i=1;i<=60;i++){const t=thetaMax*i/60;xs.push(S.flat+S.radius*Math.sin(t));}xs.push(S.lip);for(let x=S.lip+.6;x<=back+.001;x+=.6)xs.push(x);
 const zs=[];for(let z=-W;z<=W+.001;z+=.5)zs.push(z);
 const arc=[];let acc=0;for(let i=0;i<xs.length;i++){if(i)acc+=Math.hypot(xs[i]-xs[i-1],profile(xs[i])-profile(xs[i-1]));arc.push(acc);}
 const strip=(from,to,material)=>{const pos=[],uv=[],ix=[];let n=0;for(let i=from;i<=to;i++){for(let j=0;j<zs.length;j++){const x=xs[i],z=zs[j];pos.push(x,profile(x)+.012,z);uv.push(arc[i]/1.22,z/1.22);}if(i<to){for(let j=0;j<zs.length-1;j++){const k=n*zs.length+j;ix.push(k,k+1,k+zs.length,k+1,k+zs.length+1,k+zs.length);}}n++;}
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(ix);g.computeVertexNormals();const m=mesh(g,material,park);m.receiveShadow=true;return m;};
 const lipL=xs.indexOf(-S.lip),lipR=xs.indexOf(S.lip);strip(0,lipL,deckMat);strip(lipL,lipR,ride);strip(lipR,xs.length-1,deckMat);
 // Panel seams across the riding surface every 1.22 m (4 ft sheets), thin dark strips.
 const seam=new T.MeshStandardMaterial({color:'#1c2f4a',roughness:.6}),seams=new T.Group();park.add(seams);for(let z=-W+1.22;z<W;z+=1.22){for(let i=lipL;i<lipR;i++){const a=v(xs[i],profile(xs[i])+.02,z),b=v(xs[i+1],profile(xs[i+1])+.02,z);tube(seams,a,b,.012,seam,4);}}mergeRigid(seams);
 const props=new T.Group();park.add(props);
 // Coping (from the physics rails) and the roll-in tower (a built structure on the deck).
 buildRails(view,park,props,env.rails,env);buildStructures(park,tex,env);
 // Profile walls closing both ends of the ramp, from the arena floor to the riding surface.
 for(const side of [-1,1]){const sp=[],six=[];for(let i=0;i<xs.length;i++){const x=xs[i],z=side*(W+.06);sp.push(x,-STAGE,z,x,profile(x)+.005,z);if(i<xs.length-1){const k=i*2;six.push(k,k+2,k+1,k+1,k+2,k+3);}}const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(sp,3));g.setIndex(six);g.computeVertexNormals();const wall=mesh(g,sideMat,park);wall.castShadow=true;wall.receiveShadow=true;}
 // Back walls behind the decks and the stage skirt under the flat.
 for(const side of [-1,1])box(props,[.12,S.top+STAGE,W*2+.2],[side*(back+.06),(S.top-STAGE)/2,0],sideMat);
 box(props,[back*2,STAGE,W*2+.12],[0,-STAGE/2,0],stage);
 // Deck guard rails: two rails and posts along the back edge and both sides of each deck.
 const rail=(a,b)=>{for(const y of [.55,1.05])tube(props,v(a.x,S.top+y,a.z),v(b.x,S.top+y,b.z),.024,steel,6);const len=Math.hypot(b.x-a.x,b.z-a.z),n=Math.max(1,Math.round(len/1.8));for(let i=0;i<=n;i++){const x=a.x+(b.x-a.x)*i/n,z=a.z+(b.z-a.z)*i/n;tube(props,v(x,S.top,z),v(x,S.top+1.08,z),.024,steel,6);}};
 for(const side of [-1,1]){rail({x:side*back,z:-W},{x:side*back,z:W});for(const zz of [-W,W])rail({x:side*S.lip+side*.35,z:zz},{x:side*back,z:zz});}
 // Scaffold under the decks, visible from outside: posts and diagonal braces every bay.
 for(const side of [-1,1])for(let z=-W+1;z<=W-.9;z+=3){for(const x of [S.lip+.6,S.lip+2.1,back-.4]){tube(props,v(side*x,-STAGE,z),v(side*x,S.top-.12,z),.045,scaffold,6);}tube(props,v(side*(S.lip+.6),-STAGE,z),v(side*(back-.4),S.top-.12,z),.03,scaffold,5);for(const y of [-STAGE+.9,S.top*.5])tube(props,v(side*(S.lip+.6),y,z),v(side*(back-.4),y,z),.03,scaffold,5);}
 // Stairs up the back of the roll-in tower.
 const tower=env.features[0];if(tower){const topY=tower.segments.at(-1)[1],x0=tower.x+tower.segments.at(-1)[3],steps=12;for(let i=0;i<steps;i++){const t=(i+.5)/steps;box(props,[.32,.06,1.1],[x0+.16+i*.3,(topY+STAGE)*(1-t)-STAGE+.03,tower.z],deckMat);}for(const dz of [-.6,.6]){tube(props,v(x0+.1,topY,tower.z+dz),v(x0+steps*.3,-STAGE,tower.z+dz),.02,steel,5);}}
 // Arena: crowd barriers and floodlights around the stage, and a banner wall behind each deck.
 const barrier=new T.MeshStandardMaterial({color:'#2f353b',metalness:.6,roughness:.4}),bx=env.bounds.x+2,bz=env.bounds.z+2.4;
 const panelAt=(x0,z0,x1,z1)=>{const len=Math.hypot(x1-x0,z1-z0),n=Math.max(1,Math.round(len/2.5));for(let i=0;i<n;i++){const t0=i/n,t1=(i+1)/n,ax=x0+(x1-x0)*t0,az=z0+(z1-z0)*t0,cx=x0+(x1-x0)*(t0+t1)/2,cz=z0+(z1-z0)*(t0+t1)/2,seg=len/n,rot=-Math.atan2(z1-z0,x1-x0);for(const y of [.35,.72,1.08]){const m=box(props,[seg-.12,.04,.04],[cx,y-STAGE,cz],barrier);m.rotation.y=rot;}const post=box(props,[.05,1.12,.05],[ax,.56-STAGE,az],barrier);post.rotation.y=rot;}};
 panelAt(-bx,-bz,bx,-bz);panelAt(bx,-bz,bx,bz);panelAt(bx,bz,-bx,bz);panelAt(-bx,bz,-bx,-bz);
 const mast=new T.MeshStandardMaterial({color:'#2a2d30',roughness:.6,metalness:.5}),lamp=new T.MeshBasicMaterial({color:'#fff6dc'});for(const [sx,sz] of [[-1,-1],[1,-1],[1,1],[-1,1]]){const x=sx*(bx+2.5),z=sz*(bz+2.5);tube(props,v(x,-STAGE,z),v(x,15,z),.12,mast,8);box(props,[1.6,.5,.35],[x,15.2,z],mast);box(props,[1.4,.28,.08],[x,15.1,z-sz*.2],lamp);}
 const bannerCanvas=document.createElement('canvas');bannerCanvas.width=1024;bannerCanvas.height=256;const g=bannerCanvas.getContext('2d');g.fillStyle='#090e11';g.fillRect(0,0,1024,256);g.fillStyle='#ff8a3d';g.font='italic 800 110px Arial';g.textAlign='center';g.fillText('JKCREW VERT',512,150);g.font='30px Arial';g.fillStyle='#dfe6ea';g.fillText('RIDE TOGETHER. PROGRESS TOGETHER.',512,210);const bannerTex=new T.CanvasTexture(bannerCanvas);bannerTex.colorSpace=T.SRGBColorSpace;const bannerMat=new T.MeshStandardMaterial({map:bannerTex,roughness:.8,side:T.DoubleSide});
 for(const side of [-1,1]){const b=mesh(new T.PlaneGeometry(W*2,3.4),bannerMat,park,v(side>0?env.bounds.x+.4:-(back+.9),S.top+2.2,0));b.rotation.y=side>0?-Math.PI/2:Math.PI/2;}
 mergeRigid(props);props.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
 const ground=mesh(new T.PlaneGeometry(240,240),new T.MeshStandardMaterial({color:'#3a3f44',roughness:1}),park,v(0,-STAGE-.02,0));ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;
 view.treeMaterial=new T.MeshBasicMaterial({color:'#d2dcd4',alphaTest:.45,side:T.DoubleSide,toneMapped:false});view.trees=new T.InstancedMesh(new T.PlaneGeometry(1,1),view.treeMaterial,1);view.trees.visible=false;view.treeLocations=[];
 view.parkOwnedTextures=[...Object.values(tex),bannerTex];
}
// Contest parks (Urban Sessions, Outbox, Tokyo 2020): a flat competition floor in the
// park's own colour, every ramp drawn as a built structure from the shared height-field,
// coping and rails, crowd barriers around the edge, floodlight masts and a plain
// backdrop — no city block, these are temporary event builds on a hard stand.
export function buildContestPark(view,env){
 const scene=view.scene,park=view.park=new T.Group();scene.add(park);const pal=env.palette||{};scene.fog.color.set(env.fog||'#d8dfe4');
 const floor=new T.MeshStandardMaterial({color:'#ffffff',roughness:.92,vertexColors:true});view.concreteMaterial=floor;view.capMaterials=[];
 // Floor grid at 0.5 m over the whole bounds, sampled from the hard (render) height-field
 // so the coarse mesh hides under every built face; vertex colour is the floor tone with a
 // contact shadow within a metre of any structure and a darker tint where a ramp sits.
 const step=.5,xs=[],zs=[];for(let x=-env.bounds.x;x<env.bounds.x-1e-6;x+=step)xs.push(x);xs.push(env.bounds.x);for(let z=-env.bounds.z;z<env.bounds.z-1e-6;z+=step)zs.push(z);zs.push(env.bounds.z);
 const base=new T.Color(pal.floor||'#8a8f93'),pos=[],uv=[],colors=[],ix=[];
 for(let i=0;i<xs.length;i++)for(let j=0;j<zs.length;j++){const x=xs[i],z=zs[j],h=parkHeight(x,z,env,true);pos.push(x,h,z);uv.push(x/3,z/3);
  let tone=1+.05*Math.sin(x*.9+z*.3)+.03*Math.sin(z*2.3),ao=1;const near=Math.max(parkHeight(x+.9,z,env),parkHeight(x-.9,z,env),parkHeight(x,z+.9,env),parkHeight(x,z-.9,env));if(h<.05&&near>.4)ao=.72;else if(h<.05&&Math.max(parkHeight(x+1.6,z,env),parkHeight(x-1.6,z,env),parkHeight(x,z+1.6,env),parkHeight(x,z-1.6,env))>.4)ao=.86;
  const ramp=h>.05;const k=tone*ao*(ramp?.8:1);colors.push(base.r*k,base.g*k,base.b*k);if(i<xs.length-1&&j<zs.length-1){const q=i*zs.length+j;ix.push(q,q+1,q+zs.length,q+1,q+zs.length+1,q+zs.length);}}
 const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(pos,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geo.setAttribute('color',new T.Float32BufferAttribute(colors,3));geo.setIndex(ix);geo.computeVertexNormals();
 for(const chunk of splitSurfaceGeometry(geo,20)){const surface=mesh(chunk,floor,park);surface.receiveShadow=true;}geo.dispose();
 const tex=makeSurfaceTextures();buildStructures(park,tex,env);
 const props=new T.Group();park.add(props);
 buildRails(view,park,props,env.rails,env);
 // Crowd barriers: linked steel panels on feet all the way round, 1.1 m high, set 1.2 m
 // outside the riding bounds, with a gap at the rider's entry corner.
 const barrier=new T.MeshStandardMaterial({color:pal.barrier||'#3a3f44',metalness:.6,roughness:.4}),bx=env.bounds.x+1.2,bz=env.bounds.z+1.2;
 const panelAt=(x0,z0,x1,z1)=>{const len=Math.hypot(x1-x0,z1-z0),n=Math.max(1,Math.round(len/2.5));for(let i=0;i<n;i++){const t0=i/n,t1=(i+1)/n,ax=x0+(x1-x0)*t0,az=z0+(z1-z0)*t0,cx=x0+(x1-x0)*(t0+t1)/2,cz=z0+(z1-z0)*(t0+t1)/2,seg=len/n,rot=-Math.atan2(z1-z0,x1-x0);for(const y of [.35,.72,1.08]){const m=box(props,[seg-.12,.04,.04],[cx,y,cz],barrier);m.rotation.y=rot;}for(const y of [.55]){const m=box(props,[seg-.2,.5,.02],[cx,y,cz],barrier);m.rotation.y=rot;}const post=box(props,[.05,1.12,.05],[ax,.56,az],barrier);post.rotation.y=rot;const foot=box(props,[.5,.03,.16],[ax,.015,az],barrier);foot.rotation.y=rot;}};
 panelAt(-bx,-bz,bx,-bz);panelAt(bx,-bz,bx,bz);panelAt(bx,bz,-bx,bz);panelAt(-bx,bz,-bx,-bz);
 // Floodlight masts at the corners and a sponsor-free banner wall behind the far side.
 const mast=new T.MeshStandardMaterial({color:'#2a2d30',roughness:.6,metalness:.5}),lamp=new T.MeshBasicMaterial({color:'#fff6dc'});
 for(const [sx,sz] of [[-1,-1],[1,-1],[1,1],[-1,1]]){const x=sx*(bx+3),z=sz*(bz+3);tube(props,v(x,0,z),v(x,14,z),.12,mast,8);box(props,[1.6,.5,.35],[x,14.2,z],mast);box(props,[1.4,.28,.08],[x-sx*.0,14.1,z-sz*.2],lamp);}
 const banner=new T.MeshStandardMaterial({color:pal.floor||'#222',roughness:.9,side:T.DoubleSide});for(const side of [-1,1]){box(props,[bx*2+2,2.2,.14],[0,1.1,side*(bz+2.4)],banner);}
 mergeRigid(props);props.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
 // Hard stand outside the floor, then the event site fades into fog.
 const groundColor=pal.concreteFloor?'#9da2a5':'#3a3d40';const ground=mesh(new T.PlaneGeometry(400,400),new T.MeshStandardMaterial({color:groundColor,roughness:1}),park,v(0,-.08,0));ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;
 view.treeMaterial=new T.MeshBasicMaterial({color:'#d2dcd4',alphaTest:.45,side:T.DoubleSide,toneMapped:false});view.trees=new T.InstancedMesh(new T.PlaneGeometry(1,1),view.treeMaterial,1);view.trees.visible=false;view.treeLocations=[];
 view.parkOwnedTextures=Object.values(tex);
}
