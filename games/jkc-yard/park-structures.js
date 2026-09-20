import * as T from './vendor/three.module.js';
import {FEATURES,parkHeight,ENVIRONMENTS,arcContains,featureHeight,arcHeight,pyramidHeight} from './park.js';
import {sampleSegment} from './track.js';
import {v,mesh,box,mergeRigid} from './geometry.js';
// Built structures for the JKCREW Yard. The height-field stays the single source of truth
// for physics; this module draws every feature that declares a `surface` as a real built
// object on top of it — a dense riding face with a proper material (plywood, skatelite or
// concrete), vertical side panels with framing, and deck trim — so ramps read as ramps
// somebody built, not as bumps in the ground. Everything here is procedural: the textures
// are drawn to canvases at build time, no image assets.
let seed=4242;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
function canvas(size,paint){const c=document.createElement('canvas');c.width=c.height=size;const g=c.getContext('2d');paint(g,size);const t=new T.CanvasTexture(c);t.wrapS=t.wrapT=T.RepeatWrapping;t.colorSpace=T.SRGBColorSpace;t.anisotropy=4;return t;}
const grain=(g,s,base,amp)=>{const img=g.getImageData(0,0,s,s),d=img.data;for(let i=0;i<s*s;i++){const n=(rnd()-.5)*amp;d[i*4]=Math.max(0,Math.min(255,d[i*4]+n));d[i*4+1]=Math.max(0,Math.min(255,d[i*4+1]+n));d[i*4+2]=Math.max(0,Math.min(255,d[i*4+2]+n));}g.putImageData(img,0,0);};
// One canvas tile = 1.2 m of surface (a plywood sheet is 2.4 m, so seams land every second tile).
export function makeSurfaceTextures(){
 const plywood=canvas(512,(g,s)=>{g.fillStyle='#c8a46e';g.fillRect(0,0,s,s);for(let i=0;i<70;i++){const y=rnd()*s,a=.05+rnd()*.12;g.strokeStyle=`rgba(90,55,20,${a})`;g.lineWidth=.6+rnd()*1.8;g.beginPath();g.moveTo(0,y);for(let x=0;x<=s;x+=16)g.lineTo(x,y+Math.sin(x*.05+y)*2.2+(rnd()-.5)*1.2);g.stroke();}grain(g,s,0,26);
  // Sheet seam along one edge and a row of countersunk screws.
  g.fillStyle='rgba(60,40,18,.55)';g.fillRect(0,0,s,3);g.fillRect(0,0,3,s);for(let x=40;x<s;x+=116){g.fillStyle='rgba(40,30,20,.7)';g.beginPath();g.arc(x,12,2.4,0,Math.PI*2);g.fill();}});
 const skatelite=canvas(512,(g,s)=>{g.fillStyle='#31383d';g.fillRect(0,0,s,s);grain(g,s,0,18);g.fillStyle='rgba(0,0,0,.35)';g.fillRect(0,0,s,2);g.fillRect(0,0,2,s);for(let i=0;i<14;i++){g.fillStyle=`rgba(255,255,255,${.03+rnd()*.05})`;g.fillRect(rnd()*s,rnd()*s,4+rnd()*30,1+rnd()*2);}});
 const concrete=canvas(512,(g,s)=>{g.fillStyle='#9aa0a3';g.fillRect(0,0,s,s);grain(g,s,0,34);for(let i=0;i<40;i++){g.fillStyle=`rgba(0,0,0,${.04+rnd()*.08})`;g.beginPath();g.arc(rnd()*s,rnd()*s,1+rnd()*3,0,Math.PI*2);g.fill();}g.strokeStyle='rgba(40,44,46,.5)';g.lineWidth=2;g.strokeRect(1,1,s-2,s-2);});
 // Side panels: painted black ply with horizontal framing battens every half metre (the
 // canvas is 1 m tall), and a scuffed lower kick-strip.
 const panelDark=canvas(512,(g,s)=>{g.fillStyle='#1d2124';g.fillRect(0,0,s,s);grain(g,s,0,14);for(const y of [0,s/2]){g.fillStyle='rgba(0,0,0,.6)';g.fillRect(0,y,s,4);g.fillStyle='rgba(255,255,255,.07)';g.fillRect(0,y+4,s,2);}for(let i=0;i<24;i++){g.fillStyle=`rgba(255,255,255,${.04+rnd()*.06})`;g.fillRect(rnd()*s,s-30+rnd()*30,6+rnd()*40,1+rnd()*2);}});
 // Framed plywood side: a pale ply sheet with the frame's studs showing through every half
 // metre and a darker kick-strip, for parks whose ramps are built in raw or stained ply.
 const panelPly=canvas(512,(g,s)=>{g.fillStyle='#d9c39c';g.fillRect(0,0,s,s);for(let i=0;i<40;i++){const y=rnd()*s;g.strokeStyle=`rgba(90,55,20,${.05+rnd()*.10})`;g.lineWidth=.6+rnd()*1.4;g.beginPath();g.moveTo(0,y);for(let x=0;x<=s;x+=16)g.lineTo(x,y+Math.sin(x*.05+y)*2+(rnd()-.5));g.stroke();}grain(g,s,0,20);for(const y of [0,s/2]){g.fillStyle='rgba(60,35,15,.45)';g.fillRect(0,y,s,5);g.fillStyle='rgba(255,255,255,.10)';g.fillRect(0,y+5,s,2);}for(const x of [0,s*.33,s*.66]){g.fillStyle='rgba(60,35,15,.28)';g.fillRect(x,0,3,s);}g.fillStyle='rgba(0,0,0,.22)';g.fillRect(0,s-16,s,16);});
 const panelConcrete=canvas(512,(g,s)=>{g.fillStyle='#82898d';g.fillRect(0,0,s,s);grain(g,s,0,28);g.fillStyle='rgba(0,0,0,.25)';g.fillRect(0,s-14,s,14);});
 return {plywood,skatelite,concrete,panelDark,panelPly,panelConcrete};
}
export function buildStructures(park,tex,env=ENVIRONMENTS.street){
 const group=new T.Group();park.add(group);const pal=env.palette||{};
 // Contest parks tint their riding surface (dark plywood, pale-blue Olympic concrete, grey
 // skatelite) through palette.surfaceColor; the Yard keeps the untinted textures.
 const tint=pal.surfaceColor||'#ffffff';
 const face={wood:new T.MeshStandardMaterial({map:tex.plywood,color:pal.surface==='wood'?tint:'#ffffff',roughness:.72,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}),skatelite:new T.MeshStandardMaterial({map:tex.skatelite,color:pal.surface==='skatelite'?tint:'#ffffff',roughness:.5,metalness:.05,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}),concrete:new T.MeshStandardMaterial({map:tex.concrete,color:pal.surface==='concrete'?tint:'#ffffff',roughness:.9,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2})};
 const panel={wood:new T.MeshStandardMaterial({map:pal.panelColor?tex.panelPly:tex.panelDark,color:pal.panelColor||'#ffffff',roughness:.85}),skatelite:new T.MeshStandardMaterial({map:tex.panelDark,roughness:.85}),concrete:new T.MeshStandardMaterial({map:tex.panelConcrete,color:pal.panelColor||'#ffffff',roughness:.92})};
 const trim=new T.MeshStandardMaterial({color:pal.trim||'#2a2e31',roughness:.7,metalness:.3,emissive:pal.trim||'#000000',emissiveIntensity:pal.trim?.35:0}),deckEdge=new T.MeshStandardMaterial({color:pal.trim||'#b98f5c',roughness:.8,emissive:pal.trim||'#000000',emissiveIntensity:pal.trim?.35:0});
 const materials=[...Object.values(face),...Object.values(panel),trim,deckEdge];
 const geometryOf=(pos,uv,ix)=>{const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));if(uv)g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(ix);g.computeVertexNormals();return g;};
 // A vertical panel along an arbitrary polyline of ground points (x,z) up to h(x,z): the
 // closed back of a ramp at the park edge, or the end walls of an open-ended curved pocket.
 const wallAlong=(points,heightAt,material,flip=false)=>{const sp=[],suv=[],six=[];let along=0;points.forEach((p,i)=>{if(i)along+=Math.hypot(p.x-points[i-1].x,p.z-points[i-1].z);const h=Math.max(.02,heightAt(p.x,p.z)+.01);sp.push(p.x,-.03,p.z,p.x,h,p.z);suv.push(along,0,along,h);if(i<points.length-1){const k=i*2;if(flip)six.push(k,k+1,k+2,k+1,k+3,k+2);else six.push(k,k+2,k+1,k+1,k+2,k+3);}});const m=mesh(geometryOf(sp,suv,six),material,group);m.castShadow=true;m.receiveShadow=true;return m;};
 // Where two built surfaces overlap (an extension beside a wall, a corner arc meeting the
 // straight wall either side of it, a wedge's two faces) both faces used to be drawn at the
 // same height and fought for the pixels — dark flickering leaves on a phone. Now exactly one
 // surface owns every point: the first in park order whose own height reaches the top of the
 // height-field there. The owner's face floats 12 mm above the surface, everyone else's 4 mm,
 // so an overlapped face is simply under the one on top.
 const surfaces=[...env.features.filter(f=>f.surface||pal.surface).map(f=>({kind:'feature',f})),...(env.arcs||[]).map(a=>({kind:'arc',a})),...(env.pyramids||[]).map(f=>({kind:'pyramid',f}))];
 const ownHeight=(su,x,z)=>su.kind==='feature'?featureHeight(su.f,x,z):su.kind==='arc'?arcHeight(x,z,su.a):pyramidHeight(su.f,x,z);
 const lift=(su,x,z)=>{const top=parkHeight(x,z,env),mine=ownHeight(su,x,z);if(mine<top-.004)return .004;for(const other of surfaces){if(other===su)return .012;if(ownHeight(other,x,z)>=top-.004)return .004;}return .012;};
 // Face rows every 0.18 m of *arc length* along the profile (not of run), so the steep top of
 // a 78° transition gets the same tessellation as its bottom instead of one big flat facet.
 const profileRows=(f,u0,u1)=>{const bounds=f.segments.map(a=>a[3]).filter(b=>b>u0+.01&&b<u1-.01).sort((a,b)=>a-b),rows=[u0];let acc=0,prev=null,next=0;const hAt=u=>{const seg=f.segments.find(a=>u>=a[0]-1e-9&&u<=a[3]+1e-9)||f.segments.at(-1);return sampleSegment(seg,Math.min(Math.max(u,seg[0]),seg[3])).height;};
  for(let u=u0;u<u1-1e-9;){const step=Math.min(.025,u1-u,next<bounds.length?Math.max(1e-4,bounds[next]-u):Infinity),h0=hAt(u),h1=hAt(u+step);acc+=Math.hypot(step,h1-h0);u+=step;const atBound=next<bounds.length&&Math.abs(u-bounds[next])<1e-6;if(atBound)next++;if(acc>=.18||atBound){rows.push(u);acc=0;}}
  if(rows.at(-1)<u1-.005)rows.push(u1);else rows[rows.length-1]=u1;return rows;};
 for(const f of env.features){const surface=f.surface||pal.surface;if(!surface)continue;const own=surfaces.find(q=>q.f===f);
  const c=Math.cos(f.yaw),s=Math.sin(f.yaw),u0=f.segments[0][0],u1=f.segments.at(-1)[3],W=f.width;
  const world=(u,w)=>({x:f.x+c*u-s*w,z:f.z+s*u+c*w});
  const height=(u,w)=>parkHeight(world(u,w).x,world(u,w).z,env);
  // Riding face: a dense strip over the feature's own footprint, sampled from the same
  // height-field the bike rides, floated 12 mm above the plaza mesh so it always wins.
  // Stair sets keep their real treads exposed: the face skips the stairs segment.
  const skip=f.stairs?f.segments[f.stairs.segment]:null;
  const rows=profileRows(f,u0,u1),nu=rows.length-1,nw=Math.max(8,Math.ceil(W/.25)),pos=[],uv=[],ix=[];
  for(let i=0;i<=nu;i++)for(let j=0;j<=nw;j++){const u=rows[i],w=-W/2+W*j/nw,p=world(u,w);pos.push(p.x,height(u,w)+lift(own,p.x,p.z),p.z);uv.push(u/1.2,(w+W/2)/1.2);if(i<nu&&j<nw){const uMid=(rows[i]+rows[i+1])/2;if(skip&&uMid>skip[0]+.05&&uMid<skip[3]-.05)continue;const k=i*(nw+1)+j;ix.push(k,k+1,k+nw+1,k+1,k+nw+2,k+nw+1);}}
  const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(pos,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geo.setIndex(ix);geo.computeVertexNormals();const faceMesh=mesh(geo,face[surface],group);faceMesh.receiveShadow=true;faceMesh.castShadow=false;
  // Vertical side panels along both edges, from just below grade to the face's edge height.
  for(const side of [-1,1]){const w=side*(W/2+.012),sp=[],suv=[],six=[];
   // The panel only rises above whatever stands just outside it, so a ramp that butts into
   // another structure (a wing onto a box, an extension beside a quarter) shows no fin.
   for(let i=0;i<=nu;i++){const u=rows[i],p=world(u,w),h=Math.max(.02,height(u,side*W/2)+.01),outside=parkHeight(world(u,side*(W/2+.3)).x,world(u,side*(W/2+.3)).z,env)-.03,bottom=Math.min(h-.001,Math.max(-.03,outside));sp.push(p.x,bottom,p.z,p.x,h,p.z);suv.push(u,bottom,u,h);if(i<nu){const k=i*2;if(side>0)six.push(k,k+2,k+1,k+1,k+2,k+3);else six.push(k,k+1,k+2,k+1,k+3,k+2);}}
   const sg=new T.BufferGeometry();sg.setAttribute('position',new T.Float32BufferAttribute(sp,3));sg.setAttribute('uv',new T.Float32BufferAttribute(suv,2));sg.setIndex(six);sg.computeVertexNormals();const pm=mesh(sg,panel[surface],group);pm.castShadow=true;pm.receiveShadow=true;
   // A steel angle along the top edge of the panel reads as the ramp's edge trim.
   const step=Math.max(.4,(u1-u0)/40);for(let u=u0;u<u1-.01;u+=step){const a=world(u,w),b=world(Math.min(u1,u+step),w),ha=height(u,side*W/2)+.012,hb=height(Math.min(u1,u+step),side*W/2)+.012;if(ha<.05&&hb<.05)continue;const m=box(group,[Math.hypot(b.x-a.x,b.z-a.z)+.02,.035,.05],[(a.x+b.x)/2,(ha+hb)/2,(a.z+b.z)/2],surface==='concrete'?trim:deckEdge);m.rotation.set(0,-f.yaw,0);m.rotateZ(Math.atan2(hb-ha,Math.hypot(b.x-a.x,b.z-a.z)));}
  }
  // Closed backs (ramps against the park edge, roll-in decks) get a vertical back panel
  // across the width at the far end, matching the render-side hard cut in featureHeight.
  if(f.closed){const pts=[];const n=Math.max(2,Math.ceil(W/.5));for(let j=0;j<=n;j++){const w=-W/2-.012+(W+.024)*j/n;pts.push(world(u1-.02,w));}wallAlong(pts,(x,z)=>parkHeight(f.x+c*(u1-.3)-s*0,f.z+s*(u1-.3),env),panel[surface],true);}
  // A translucent wall-ride panel standing along the middle of a box deck (Urban Sessions'
  // green plexi wall) — visual only, the height-field does not know about it.
  if(f.plexi){const w=f.plexi,len=w.u1-w.u0,mid=world((w.u0+w.u1)/2,0),top=parkHeight(mid.x,mid.z,env);const glass=new T.MeshStandardMaterial({color:w.color||'#39ff9c',transparent:true,opacity:.42,roughness:.15,metalness:.1,side:T.DoubleSide,emissive:w.color||'#39ff9c',emissiveIntensity:.25});materials.push(glass);const pane=box(group,[len,w.h,.04],[mid.x,top+w.h/2+.02,mid.z],glass);pane.rotation.y=-f.yaw;for(const du of [-len/2+.03,len/2-.03]){const q=world((w.u0+w.u1)/2+du,0);const post=box(group,[.06,w.h+.05,.06],[q.x,top+w.h/2+.02,q.z],trim);post.rotation.y=-f.yaw;}}
  // Flat decks on wooden ramps get a visible plywood lip board and understructure battens.
  if(surface==='wood')for(const seg of f.segments){if(Math.abs(seg[1]-seg[4])>.01||seg[1]<.5)continue;const mid=(seg[0]+seg[3])/2,p=world(mid,0),len=seg[3]-seg[0];for(let y=.45;y<seg[1]-.2;y+=.5)for(const side of [-1,1]){const q=world(mid,side*(W/2+.02));const bt=box(group,[len,.06,.04],[q.x,y,q.z],trim);bt.rotation.y=-f.yaw;}
   const lipBoard=box(group,[len,.05,W+.04],[p.x,seg[1]+.02,p.z],deckEdge);lipBoard.rotation.y=-f.yaw;}
 }
 // Curved quarters: the same dense face, sampled on a polar grid over the sector, a
 // curved back panel at the deck's far edge, coping trim along the rim, and radial end
 // walls when the arc is an open-ended pocket rather than a corner joining two straights.
 for(const a of env.arcs||[]){const surface=a.surface||pal.surface;if(!surface)continue;const u1=a.segments.at(-1)[3],span=a.a1-a.a0,na=Math.max(12,Math.ceil(span*(a.inner+u1)/.3)),nr=Math.max(12,Math.ceil(u1/.2)),pos=[],uv=[],ix=[];
  // Rows: a flat apron 0.7 m outside the base (covers the floor grid's step), then the face.
  const rows=[-.7,-.35,0];{let acc=0,prev=null;for(let d=0;d<=u1+1e-9;d+=.025){const seg=a.segments.find(q=>d>=q[0]&&d<=q[3])||a.segments.at(-1),h=sampleSegment(seg,Math.min(d,seg[3])).height;if(prev!==null)acc+=Math.hypot(.025,h-prev);prev=h;if(acc>=.18){rows.push(Math.min(d,u1));acc=0;}}if(rows.at(-1)<u1-.01)rows.push(u1);}
  const ownArc=surfaces.find(q=>q.a===a);
  for(let i=0;i<rows.length;i++)for(let j=0;j<=na;j++){const d=rows[i],t=a.a0+span*j/na,r=Math.max(.05,a.inner+d),x=a.cx+Math.cos(t)*r,z=a.cz+Math.sin(t)*r;pos.push(x,parkHeight(x,z,env)+lift(ownArc,x,z),z);uv.push(d/1.2,t*(a.inner+u1*.5)/1.2);if(i<rows.length-1&&j<na){const k=i*(na+1)+j;ix.push(k,k+1,k+na+1,k+1,k+na+2,k+na+1);}}
  const g=geometryOf(pos,uv,ix);if(g.attributes.normal.getY(Math.floor(g.attributes.normal.count/2))<0){for(let i=0;i<ix.length;i+=3){const t=ix[i+1];ix[i+1]=ix[i+2];ix[i+2]=t;}g.setIndex(ix);g.computeVertexNormals();}const fm=mesh(g,face[surface],group);fm.receiveShadow=true;
  const back=[];for(let j=0;j<=na;j++){const t=a.a0+span*j/na,r=a.inner+u1-.02;back.push({x:a.cx+Math.cos(t)*r,z:a.cz+Math.sin(t)*r});}wallAlong(back,(x,z)=>{const t=Math.atan2(z-a.cz,x-a.cx),r=a.inner+u1-.3;return parkHeight(a.cx+Math.cos(t)*r,a.cz+Math.sin(t)*r,env);},panel[surface],true);
  if(a.ends)for(const [t,flip] of [[a.a0,false],[a.a1,true]]){const pts=[];const n=Math.max(4,Math.ceil(u1/.4));for(let i=0;i<=n;i++){const r=a.inner+u1*i/n;pts.push({x:a.cx+Math.cos(t)*r,z:a.cz+Math.sin(t)*r});}const inward=t+(flip?-.02:.02);wallAlong(pts,(x,z)=>{const r=Math.hypot(x-a.cx,z-a.cz);return parkHeight(a.cx+Math.cos(inward)*r,a.cz+Math.sin(inward)*r,env);},panel[surface],flip);}
  const lip=a.lips?.[0];if(lip!=null){const rr=a.inner+lip;for(let j=0;j<na;j++){const t0=a.a0+span*j/na,t1=a.a0+span*(j+1)/na,p0={x:a.cx+Math.cos(t0)*rr,z:a.cz+Math.sin(t0)*rr},p1={x:a.cx+Math.cos(t1)*rr,z:a.cz+Math.sin(t1)*rr},h=parkHeight((p0.x+p1.x)/2,(p0.z+p1.z)/2,env)+.012,m=box(group,[Math.hypot(p1.x-p0.x,p1.z-p0.z)+.02,.035,.06],[(p0.x+p1.x)/2,h,(p0.z+p1.z)/2],surface==='concrete'?trim:deckEdge);m.rotation.y=-Math.atan2(p1.z-p0.z,p1.x-p0.x);}}
 }
 // Four-sided jump boxes: one dense face over the rectangle (the hips fall out of the
 // height-field), no panels.
 for(const f of env.pyramids||[]){const surface=f.surface||pal.surface;if(!surface)continue;const c=Math.cos(f.yaw),s=Math.sin(f.yaw),nu=Math.max(16,Math.ceil(f.a*2/.25)),nw=Math.max(16,Math.ceil(f.b*2/.25)),pos=[],uv=[],ix=[];
  const ownPyr=surfaces.find(q=>q.f===f);
  for(let i=0;i<=nu;i++)for(let j=0;j<=nw;j++){const u=-f.a+2*f.a*i/nu,w=-f.b+2*f.b*j/nw,x=f.x+c*u-s*w,z=f.z+s*u+c*w;pos.push(x,parkHeight(x,z,env)+lift(ownPyr,x,z),z);uv.push(u/1.2,w/1.2);if(i<nu&&j<nw){const k=i*(nw+1)+j;ix.push(k,k+1,k+nw+1,k+1,k+nw+2,k+nw+1);}}
  const g=geometryOf(pos,uv,ix);if(g.attributes.normal.getY(Math.floor(g.attributes.normal.count/2))<0){for(let i=0;i<ix.length;i+=3){const t=ix[i+1];ix[i+1]=ix[i+2];ix[i+2]=t;}g.setIndex(ix);g.computeVertexNormals();}const fm=mesh(g,face[surface],group);fm.receiveShadow=true;
  // Edge trim around the flat top so the box top reads as a built deck.
  const flat=f.flat||.35;for(const [du,dw,len,rot] of [[0,f.b*flat,2*f.a*flat,0],[0,-f.b*flat,2*f.a*flat,0],[f.a*flat,0,2*f.b*flat,Math.PI/2],[-f.a*flat,0,2*f.b*flat,Math.PI/2]]){const x=f.x+c*du-s*dw,z=f.z+s*du+c*dw,m=box(group,[len+.04,.035,.06],[x,f.h+.012,z],surface==='concrete'?trim:deckEdge);m.rotation.y=-f.yaw+rot;}
 }
 // The bowl is a sunken concrete pool: one smooth radial dish mesh from the flat bottom up
 // the transition to a flat lip apron at plaza grade (drawn over the coarse grid, which is
 // dropped just under it), a pool-tile band under the coping, and the coping ring itself
 // comes from the rail builder. No deck, no retaining wall, no fence — you ride up to the
 // edge and drop in, like a real park bowl.
 const pool=new T.MeshStandardMaterial({map:tex.concrete,color:'#dfe7ea',roughness:.55,side:T.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}),tile=new T.MeshStandardMaterial({color:'#2f6f8f',roughness:.35,polygonOffset:true,polygonOffsetFactor:-3,polygonOffsetUnits:-3});
 for(const b of env.bowls||[]){const rim=b.flatRadius+b.radius*.97,rOut=rim+1.1,na=96,pos=[],uv=[],ix=[],rings=[];
  for(let r=0;r<b.flatRadius;r+=.5)rings.push(r);for(let r=b.flatRadius;r<rim-.001;r+=.12)rings.push(r);rings.push(rim-.001,rim+.02,rim+.5,rOut);
  for(let i=0;i<rings.length;i++)for(let j=0;j<=na;j++){const r=rings[i],a=j/na*Math.PI*2,x=b.cx+Math.cos(a)*r,z=b.cz+Math.sin(a)*r;pos.push(x,parkHeight(x,z,env)+.012,z);uv.push(x/1.2,z/1.2);if(i<rings.length-1&&j<na){const k=i*(na+1)+j;ix.push(k,k+na+1,k+1,k+1,k+na+1,k+na+2);}}
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(ix);g.computeVertexNormals();if(g.attributes.normal.getY(Math.floor(g.attributes.normal.count/2))<0){for(let i=0;i<ix.length;i+=3){const t=ix[i+1];ix[i+1]=ix[i+2];ix[i+2]=t;}g.setIndex(ix);g.computeVertexNormals();}const dish=mesh(g,pool,group);dish.receiveShadow=true;
  // Tile band: the last 35 cm of transition under the coping.
  const rTile0=rim-.42,rTile1=rim-.05,tp=[],tix=[];for(let j=0;j<=na;j++){const a=j/na*Math.PI*2;for(const r of [rTile0,rTile1]){const x=b.cx+Math.cos(a)*r,z=b.cz+Math.sin(a)*r;tp.push(x,parkHeight(x,z,env)+.02,z);}if(j<na){const k=j*2;tix.push(k,k+2,k+1,k+1,k+2,k+3);}}
  const tg=new T.BufferGeometry();tg.setAttribute('position',new T.Float32BufferAttribute(tp,3));tg.setIndex(tix);tg.computeVertexNormals();mesh(tg,tile,group);
 }
 mergeRigid(group);group.traverse(o=>{if(o.isMesh){o.receiveShadow=true;}});
 return {group,materials};
}
