/** Small original visual-effects helpers shared by the free-roam park and flow tracks:
 * a lightweight instanced particle pool (dust puffs, rail sparks) and a gradient sky
 * dome with a soft sun glow. Kept cheap enough for mobile GPUs: fixed pools, no
 * per-frame allocation, one draw call per effect type. */
import * as T from './vendor/three.module.js';
const DUMMY=new T.Object3D(),FAR=new T.Vector3(0,-9999,0);
export function softDiscTexture(color='rgba(255,255,255,1)'){
 const c=document.createElement('canvas');c.width=c.height=64;const ctx=c.getContext('2d');
 const g=ctx.createRadialGradient(32,32,0,32,32,32);g.addColorStop(0,color);g.addColorStop(.55,color.replace(/,1\)$/,',.55)'));g.addColorStop(1,color.replace(/,1\)$/,',0)'));
 ctx.fillStyle=g;ctx.fillRect(0,0,64,64);const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;return t;
}
export class ParticleBurst{
 constructor(scene,material,count=32){
  this.mesh=new T.InstancedMesh(new T.PlaneGeometry(1,1),material,count);
  this.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);this.mesh.frustumCulled=false;this.mesh.renderOrder=5;
  scene.add(this.mesh);this.count=count;this.cursor=0;this.gravity=2.4;
  this.particles=Array.from({length:count},()=>({life:0,duration:1,pos:new T.Vector3(),vel:new T.Vector3(),size:.1}));
 }
 spawn(pos,n,{duration=.55,spread=1.2,up=1,size=.14,gravity}={}){
  for(let i=0;i<n;i++){
   const p=this.particles[this.cursor];this.cursor=(this.cursor+1)%this.count;
   p.life=p.duration=duration;p.pos.copy(pos);p.size=size;if(gravity!==undefined)p.gravity=gravity;
   p.vel.set((Math.random()-.5)*spread,up*(.35+Math.random()*.65),(Math.random()-.5)*spread);
  }
 }
 update(dt,camera){
  let any=false;
  for(let i=0;i<this.count;i++){
   const p=this.particles[i];
   if(p.life>0){
    any=true;p.life=Math.max(0,p.life-dt);
    p.pos.addScaledVector(p.vel,dt);p.vel.y-=(p.gravity??this.gravity)*dt;p.vel.multiplyScalar(Math.max(0,1-dt*1.1));
    const t=p.life/p.duration;DUMMY.position.copy(p.pos);DUMMY.scale.setScalar(p.size*(.35+t*.85));
   }else{DUMMY.position.copy(FAR);DUMMY.scale.setScalar(0);}
   if(camera)DUMMY.quaternion.copy(camera.quaternion);
   DUMMY.updateMatrix();this.mesh.setMatrixAt(i,DUMMY.matrix);
  }
  if(any)this.mesh.instanceMatrix.needsUpdate=true;
  return any;
 }
}
/** A large inward-facing gradient sphere plus a soft sun disc; cheap stand-in for a
 * physically-based sky that still reads as open air with real atmospheric depth. */
const mix=(a,b,t)=>{const c=new T.Color(a).lerp(new T.Color(b),t);return '#'+c.getHexString();};
// A cumulus: a handful of soft discs piled into a flat-bottomed heap, drawn once. Two variants.
let cloudSeed=7;const crnd=()=>{cloudSeed=(cloudSeed*1664525+1013904223)>>>0;return cloudSeed/4294967296;};
export function cloudTexture(variant=0){
 const c=document.createElement('canvas');c.width=256;c.height=128;const ctx=c.getContext('2d');cloudSeed=11+variant*97;
 const puff=(x,y,r,a)=>{const g=ctx.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,`rgba(255,255,255,${a})`);g.addColorStop(.6,`rgba(255,255,255,${a*.55})`);g.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=g;ctx.fillRect(x-r,y-r,r*2,r*2);};
 for(let i=0;i<14;i++){const t=i/13,x=40+t*176+(crnd()-.5)*20,r=22+crnd()*22*(1-Math.abs(t-.5)),y=88-r*.55-crnd()*14*(1-Math.abs(t-.5)*2);puff(x,y,r,.75+crnd()*.2);}
 for(let i=0;i<8;i++)puff(56+crnd()*144,94,14+crnd()*10,.35);
 const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;return t;
}
export function buildSky(scene,{top='#4f86c6',bottom='#dce9ea',sunColor='#fff3d6',sunPosition,clouds=true}={}){
 const c=document.createElement('canvas');c.width=1;c.height=128;const ctx=c.getContext('2d');
 const g=ctx.createLinearGradient(0,0,0,128);g.addColorStop(0,top);g.addColorStop(.40,mix(top,bottom,.55));g.addColorStop(.62,bottom);g.addColorStop(1,bottom);
 ctx.fillStyle=g;ctx.fillRect(0,0,1,128);const texture=new T.CanvasTexture(c);texture.colorSpace=T.SRGBColorSpace;
 const dome=new T.Mesh(new T.SphereGeometry(280,20,14),new T.MeshBasicMaterial({map:texture,side:T.BackSide,fog:false,depthWrite:false,toneMapped:false}));
 dome.renderOrder=-10;scene.add(dome);
 // The sun: a tight disc inside a wide, faint halo, so it glows into the sky instead of
 // sitting on it like a cut-out.
 const sun=new T.Sprite(new T.SpriteMaterial({map:softDiscTexture('rgba(255,246,214,1)'),color:sunColor,transparent:true,depthWrite:false,fog:false,toneMapped:false,blending:T.AdditiveBlending}));
 sun.scale.setScalar(26);if(sunPosition)sun.position.copy(sunPosition);scene.add(sun);
 const halo=new T.Sprite(new T.SpriteMaterial({map:sun.material.map,color:sunColor,transparent:true,opacity:.28,depthWrite:false,fog:false,toneMapped:false,blending:T.AdditiveBlending}));
 halo.scale.setScalar(110);sun.add(halo);
 // Clouds: a dozen billboards on the dome (they ride with the camera like the dome does),
 // low on the sky and lit from the sun's side by a warm tint — twelve sprites, no cost to speak of.
 const cloudMaps=clouds?[cloudTexture(0),cloudTexture(1)]:[];cloudSeed=5;
 if(clouds)for(let i=0;i<12;i++){const a=i/12*Math.PI*2+crnd()*.4,el=.10+crnd()*.22,r=250,x=Math.cos(a)*Math.cos(el)*r,y=Math.sin(el)*r,z=Math.sin(a)*Math.cos(el)*r;
  const m=new T.SpriteMaterial({map:cloudMaps[i%2],color:mix('#ffffff',sunColor,.35),transparent:true,opacity:.55+crnd()*.3,depthWrite:false,fog:false,toneMapped:false});const cloud=new T.Sprite(m);cloud.position.set(x,y,z);const w=70+crnd()*90;cloud.scale.set(w,w*.5,1);cloud.renderOrder=-9;dome.add(cloud);}
 return {dome,sun,texture,dispose(){dome.geometry.dispose();dome.material.dispose();texture.dispose();dome.traverse(o=>{if(o.isSprite)o.material.dispose();});for(const t of cloudMaps)t.dispose();scene.remove(dome);halo.material.dispose();sun.material.map.dispose();sun.material.dispose();scene.remove(sun);}};
}
