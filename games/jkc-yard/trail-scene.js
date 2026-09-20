import * as T from './vendor/three.module.js';
import {v,mesh,tube,mergeRigid} from './geometry.js';
import {TRAIL_LINE,TRAIL_LENGTH,heightAt,groundAt,where,pointAt,JUMPS,HALF_WIDTH,START_DECK,FINISH_S} from './trail.js';
import {splitSurfaceGeometry} from './park-scene.js';
// JKC Trail scenery: the dirt ribbon (packed line, lips, landings, berms, walls and the mound
// beyond, all sampled from the same height function physics rides), the hillside falling
// away either side of it, a forest of crossed billboards kept off the line, the timber start
// deck, numbered boards at every lip and the finish banner.
// Phone budget: one ribbon in culling chunks, one hillside grid in chunks, one instanced
// mesh for every tree, merged props — a few dozen draw calls in total.
let seed=1337;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
export function buildTrail(view,env){
 const scene=view.scene,park=view.park=new T.Group();scene.add(park);
 scene.fog.color.set(env.fog||'#b3c4a2');scene.fog.near=40;scene.fog.far=150;
 const dirt=new T.MeshStandardMaterial({color:'#ffffff',roughness:.96,vertexColors:true});view.concreteMaterial=null;view.trailMaterial=dirt;view.capMaterials=[];
 const deckEnd=START_DECK.deck+START_DECK.ramp;
 // ---- The ribbon: a row of vertices across the line every metre along it, every half metre
 // through the lips, over the knuckles and down the start ramp, where the shape is. ----
 const cols=[-9.5,-7.4,-5.6,-4.6,-3.8,-3.05,-2.2,-1.1,0,1.1,2.2,3.05,3.8,4.6,5.6,7.4,9.5];
 // Rows: the line's samples (every metre, every half metre through the shapes) plus a row on
 // every edge of every shape — the foot and the top of each lip, the knuckle, the foot of the
 // landing, the edges of the start deck — doubled at the lips' take-off edges so the crease
 // is a crease and not a smoothed-over hump.
 const detail=s=>s<deckEnd+1||JUMPS.some(j=>(s>j.s-1&&s<j.s+j.lip+j.back+1)||(s>j.knuckle-j.face-1&&s<j.knuckle+2.5));
 const at=new Set();for(let i=0;i<TRAIL_LINE.length;i++){const r=TRAIL_LINE[i];if(i%2===0||i===TRAIL_LINE.length-1||detail(r.s))at.add(r.s);}
 for(const e of [START_DECK.deck-.005,START_DECK.deck+.005,deckEnd])at.add(e);
 for(const j of JUMPS)for(const e of [j.s,j.s+j.lip-.005,j.s+j.lip+.005,j.s+j.lip+j.back,j.knuckle-j.face,j.knuckle,j.knuckle+j.land*.8,j.knuckle+j.land])at.add(e);
 const rows=[...at].filter(s=>s>=0&&s<=TRAIL_LENGTH).sort((a,b)=>a-b).map(s=>{const q=pointAt(s);return {x:q.x,z:q.z,s,tx:q.tx,tz:q.tz};});
 const pos=[],uv=[],colors=[],ix=[],packed=new T.Color('#7f624a'),loose=new T.Color('#a0805e'),pitDirt=new T.Color('#6e553f'),grass=new T.Color('#6b8a44'),plank=new T.Color('#b08a5a'),plankDark=new T.Color('#8a6a45'),cladding=new T.Color('#6a4f36');
 const inPit=s=>JUMPS.some(j=>s>=j.pit[0]&&s<=j.pit[1]);
 rows.forEach((r,ri)=>{cols.forEach((d,ci)=>{const x=r.x-r.tz*d,z=r.z+r.tx*d,h=heightAt(x,z),a=Math.abs(d);pos.push(x,h,z);uv.push(r.s/2.6,d/2.6);
   // Colour: planks on the start deck and its drop-in (darker cladding down its sides), packed
   // dirt on the line, loose dirt up the walls and berms, grass on the mound.
   let c;if(r.s<deckEnd&&a<=6.2)c=a<=HALF_WIDTH?(Math.floor(r.s/.3)%2?plank:plankDark).clone():cladding.clone();else if(a<=HALF_WIDTH&&inPit(r.s))c=pitDirt.clone().lerp(loose,.25+.25*Math.sin(r.s*1.7+d*2.3));else c=a<=HALF_WIDTH?packed.clone().lerp(loose,a/HALF_WIDTH*.35):a<=5.6?loose.clone():loose.clone().lerp(grass,Math.min(1,(a-5.6)/2.2));
   // A touch of contact shadow where the walls and berms meet the packed line.
   const foot=Math.max(0,Math.min(1,(a-2.9)/1.0))*(1-Math.max(0,Math.min(1,(a-4.6)/1.4)));const shade=(.9+.1*Math.sin(r.s*.37+d*1.3))*(1-.15*foot);colors.push(c.r*shade,c.g*shade,c.b*shade);
   if(ci<cols.length-1&&ri<rows.length-1){const n=cols.length,k=ri*n+ci,k2=(ri+1)*n+ci;ix.push(k,k+1,k2,k+1,k2+1,k2);}});});
 const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(pos,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geo.setAttribute('color',new T.Float32BufferAttribute(colors,3));geo.setIndex(ix);geo.computeVertexNormals();
 for(const chunk of splitSurfaceGeometry(geo,28)){const m=mesh(chunk,dirt,park);m.receiveShadow=true;}geo.dispose();
 // ---- The hillside: a grass grid out to 52 m either side of the line, every 4 m along it,
 // sampled from the same ground function the trees stand on. ----
 const gcols=[-52,-40,-30,-22,-16,-12,-9.5,9.5,12,16,22,30,40,52],gpos=[],gcol=[],gix=[],grows=[];
 for(let i=0;i<TRAIL_LINE.length;i+=8)grows.push(TRAIL_LINE[i]);grows.push(TRAIL_LINE[TRAIL_LINE.length-1]);
 const g0=new T.Color('#5f7d3c'),g1=new T.Color('#4c6a33');
 grows.forEach((r,ri)=>{gcols.forEach((d,ci)=>{const x=r.x-r.tz*d,z=r.z+r.tx*d;gpos.push(x,groundAt(x,z)-.04,z);const c=g0.clone().lerp(g1,.5+.5*Math.sin(r.s*.11+d*.23));gcol.push(c.r,c.g,c.b);
   if(ri<grows.length-1&&ci<gcols.length-1&&ci!==6){const n=gcols.length,k=ri*n+ci,k2=(ri+1)*n+ci;gix.push(k,k+1,k2,k+1,k2+1,k2);}});});
 const ground=new T.BufferGeometry();ground.setAttribute('position',new T.Float32BufferAttribute(gpos,3));ground.setAttribute('color',new T.Float32BufferAttribute(gcol,3));ground.setIndex(gix);ground.computeVertexNormals();
 const grassMaterial=new T.MeshStandardMaterial({color:'#ffffff',roughness:1,vertexColors:true});
 for(const chunk of splitSurfaceGeometry(ground,60)){const m=mesh(chunk,grassMaterial,park);m.receiveShadow=true;}ground.dispose();
 // ---- Trees: crossed billboards, kept 8 m off the line, thicker along the corridor. ----
 const count=1400,trees=new T.InstancedMesh(new T.PlaneGeometry(1,1),view.treeMaterial,count*2),dummy=new T.Object3D(),tint=new T.Color();let placed=0;
 for(let tries=0;tries<count*30&&placed<count;tries++){const near=tries%3!==0,q=pointAt(rnd()*TRAIL_LENGTH),side=rnd()<.5?-1:1,off=near?8.5+rnd()*12:20+rnd()*34,px=q.x-q.tz*off*side,pz=q.z+q.tx*off*side;
  const w=where(px,pz);if(Math.abs(w.d)<8.2||(w.s<deckEnd+4&&Math.abs(w.d)<11))continue;const h=6.5+rnd()*7,y=groundAt(px,pz)-.1;
  for(let j=0;j<2;j++){dummy.position.set(px,y+h/2,pz);dummy.rotation.set(0,rnd()*Math.PI*2+j*Math.PI/2,0);dummy.scale.set(h*.62,h,1);dummy.updateMatrix();trees.setMatrixAt(placed*2+j,dummy.matrix);tint.setRGB(.68+rnd()*.25,.78+rnd()*.22,.60+rnd()*.2);trees.setColorAt(placed*2+j,tint);}
  placed++;}
 trees.count=placed*2;trees.instanceMatrix.needsUpdate=true;if(trees.instanceColor)trees.instanceColor.needsUpdate=true;trees.frustumCulled=false;park.add(trees);view.forest=trees;
 // ---- Props: the start deck's posts and rails, numbered boards at every lip, the start and
 // finish banners, log fences on the outside of the berms. ----
 const props=new T.Group();park.add(props);const timber=new T.MeshStandardMaterial({color:'#5b4630',roughness:.95});
 const label=(text,w,h,fg,bg,size)=>{const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');g.fillStyle=bg;g.fillRect(0,0,w,h);g.fillStyle=fg;g.font='800 '+size+'px Arial';g.textAlign='center';g.textBaseline='middle';g.fillText(text,w/2,h/2+2);const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;return t;};
 const textures=[];
 // Start deck: posts down to the hill at the four corners, a rail round the back and sides.
 const deckTop=q=>heightAt(q.x,q.z);
 for(const s of [.4,START_DECK.deck-.4]){for(const side of [-1,1]){const q=pointAt(s),x=q.x-q.tz*3.3*side,z=q.z+q.tx*3.3*side,top=heightAt(q.x,q.z);tube(props,v(x,groundAt(x,z)-.5,z),v(x,top+1.05,z),.07,timber,8);}}
 {const a=pointAt(.4),b=pointAt(START_DECK.deck-.4),top=heightAt(a.x,a.z);for(const side of [-1,1]){const ax=a.x-a.tz*3.3*side,az=a.z+a.tx*3.3*side,bx=b.x-b.tz*3.3*side,bz=b.z+b.tx*3.3*side;tube(props,v(ax,top+1.0,az),v(bx,top+1.0,bz),.035,timber,6);tube(props,v(ax,top+.55,az),v(bx,top+.55,bz),.03,timber,6);}
  const lx=a.x-a.tz*3.3,lz=a.z+a.tx*3.3,rx=a.x+a.tz*3.3,rz=a.z-a.tx*3.3;tube(props,v(lx,top+1.0,lz),v(rx,top+1.0,rz),.035,timber,6);tube(props,v(lx,top+.55,lz),v(rx,top+.55,rz),.03,timber,6);}
 // Numbered boards at every lip, alternating sides.
 JUMPS.forEach((j,i)=>{const q=pointAt(j.s+j.lip*.55),side=i%2?-1:1,x=q.x-q.tz*4.9*side,z=q.z+q.tx*4.9*side,y=heightAt(x,z);
  tube(props,v(x,y,z),v(x,y+1.6,z),.045,timber,6);const t=label(String(i+1),128,128,'#101314','#e9e3d3',84);textures.push(t);
  const board=mesh(new T.PlaneGeometry(.7,.7),new T.MeshStandardMaterial({map:t,roughness:.8,side:T.DoubleSide}),props,v(x,y+1.55,z));board.rotation.y=-q.heading-Math.PI/2;});
 // Banners: JKC TRAIL over the drop-in edge of the start deck, FINISH over the finish line.
 const gate=(s,text,fg,bg,w)=>{const q=pointAt(s),top=deckTop(q);for(const side of [-1,1]){const x=q.x-q.tz*4.3*side,z=q.z+q.tx*4.3*side;tube(props,v(x,heightAt(x,z)-.3,z),v(x,top+5.2,z),.06,timber,8);}
  const t=label(text,1024,192,fg,bg,120);textures.push(t);const banner=mesh(new T.PlaneGeometry(8.6,1.5),new T.MeshStandardMaterial({map:t,roughness:.8,side:T.DoubleSide}),props,v(q.x,top+4.3,q.z));banner.rotation.y=-q.heading-Math.PI/2;};
 gate(START_DECK.deck-.2,'JKC TRAIL','#16dfcf','#0b1113');gate(FINISH_S,'FINISH','#0b1113','#e9e3d3');
 // Log fence along the outside of every berm, where the line bends hardest.
 for(let s=0;s<TRAIL_LINE.length-6;s+=6){const q=TRAIL_LINE[s];if(Math.abs(q.curv)<.012)continue;const side=-Math.sign(q.curv),x=q.x-q.tz*6.6*side,z=q.z+q.tx*6.6*side,y=heightAt(x,z);tube(props,v(x,y,z),v(x,y+.9,z),.05,timber,6);
  const n=TRAIL_LINE[s+6];if(Math.abs(n.curv)<.012)continue;const nx=n.x-n.tz*6.6*side,nz=n.z+n.tx*6.6*side,ny=heightAt(nx,nz);tube(props,v(x,y+.8,z),v(nx,ny+.8,nz),.04,timber,6);}
 mergeRigid(props);props.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
 view.parkOwnedTextures=[...(view.parkOwnedTextures||[]),...textures];
}
