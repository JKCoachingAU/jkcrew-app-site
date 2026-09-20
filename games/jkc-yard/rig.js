import * as T from './vendor/three.module.js';
import {v,mesh,tube,box,ellipsoid,sections,mergeRigid,limbJoint} from './geometry.js';
const UP=v(0,1,0),TAU=Math.PI*2,HEAD=v(.384,.67,0),AXIS=v(-.032,.12,0).normalize(),GRIP_CENTER=v(.31,1.025,0);
const smooth=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
const NEUTRAL_SPINE=v(.28,.35,0).normalize();
const envelope=p=>Math.sin(Math.PI*Math.max(0,Math.min(1,p)));
const blend=(a,b,t)=>a.clone().lerp(b,smooth(t));
// Rider kits: pants and frame finish. The tee is always the black JK Coaching shirt — in
// every park, every view — so a kit only changes the bike and the pants. Applied live to the
// shared materials, so a kit change is instant and costs nothing per frame.
export const TEE='#1b1d20',TEE_SHEEN='#565c60';
export const KITS=[
 {id:'blackout',name:'BLACKOUT',pants:'#1a1c1f',frame:'#252b2e',frameMetal:.82},
 {id:'crew',name:'TEAL FRAME',pants:'#1a1c1f',frame:'#12b8ab',frameMetal:.7},
 {id:'white',name:'CHROME FRAME',pants:'#2a2d31',frame:'#d5dadd',frameMetal:.95},
 {id:'red',name:'RED FRAME',pants:'#1a1c1f',frame:'#b8312c',frameMetal:.6},
 {id:'olive',name:'RAW / OLIVE PANTS',pants:'#3f4a34',frame:'#8e9296',frameMetal:.9}
];
export class BikeRider {
 constructor(){
  this.root=new T.Group();this.bike=new T.Group();this.root.add(this.bike);
  const material=(color,roughness=.7,metalness=0,extra={})=>new T.MeshPhysicalMaterial({color,roughness,metalness,...extra});
  // Procedural surface detail, drawn once at build time (no image assets): a jersey knit
  // for the tee, a twill weave for the pants, fine pores for skin and strands for hair.
  // Bump maps only, so they cost nothing extra per frame beyond a texture fetch, and they
  // give the fabric and skin the micro-shading that a flat single-color surface lacks —
  // which is most of what made the rider read as a smooth plastic toy up close. Skipped
  // outside a browser (the physics/rig tests construct this class in Node).
  let seed=90271;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const bumpTexture=(size,repeat,paint)=>{if(typeof document==='undefined')return null;const c=document.createElement('canvas');c.width=c.height=size;const g=c.getContext('2d');const img=g.createImageData(size,size),d=img.data;for(let i=0;i<size*size;i++){const n=128+(rnd()-.5)*paint.grain;d[i*4]=d[i*4+1]=d[i*4+2]=n;d[i*4+3]=255;}g.putImageData(img,0,0);paint.draw?.(g,size);const t=new T.CanvasTexture(c);t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(repeat,repeat);return t;};
  const knit=bumpTexture(128,14,{grain:34,draw:(g,s)=>{for(let x=0;x<s;x+=6){g.fillStyle='rgba(255,255,255,.22)';g.fillRect(x,0,2,s);g.fillStyle='rgba(0,0,0,.28)';g.fillRect(x+3,0,1,s);}for(let y=0;y<s;y+=4){g.fillStyle='rgba(0,0,0,.10)';g.fillRect(0,y,s,1);}}});
  const twill=bumpTexture(128,12,{grain:26,draw:(g,s)=>{g.lineWidth=1.6;for(let x=-s;x<s;x+=6){g.strokeStyle='rgba(255,255,255,.20)';g.beginPath();g.moveTo(x,0);g.lineTo(x+s,s);g.stroke();g.strokeStyle='rgba(0,0,0,.24)';g.beginPath();g.moveTo(x+3,0);g.lineTo(x+3+s,s);g.stroke();}}});
  const pores=bumpTexture(128,9,{grain:22,draw:(g,s)=>{for(let i=0;i<260;i++){g.fillStyle=`rgba(0,0,0,${.10+rnd()*.14})`;const r=.6+rnd()*1.1;g.beginPath();g.arc(rnd()*s,rnd()*s,r,0,TAU);g.fill();}}});
  const strands=bumpTexture(128,7,{grain:40,draw:(g,s)=>{for(let i=0;i<420;i++){const x=rnd()*s,y=rnd()*s,l=6+rnd()*22;g.strokeStyle=`rgba(${rnd()<.5?0:255},${rnd()<.5?0:255},${rnd()<.5?0:255},${.18+rnd()*.22})`;g.lineWidth=.8+rnd()*.8;g.beginPath();g.moveTo(x,y);g.lineTo(x+(rnd()-.5)*3,y+l);g.stroke();}}});
  const bump=(map,scale)=>map?{bumpMap:map,bumpScale:scale}:{};
  // Physical materials with subtle clearcoat (paint/helmet) and cloth sheen (shirt/pants).
  // The tee and pants sit a touch above pure black so light can actually describe their
  // form instead of collapsing them into a silhouette; skin is matte, not lacquered.
  this.m={frame:material('#252b2e',.22,.82,{clearcoat:.5,clearcoatRoughness:.28}),rubber:material('#161817',.95),metal:material('#d3d8d7',.16,.95,{clearcoat:.35,clearcoatRoughness:.2}),black:material('#20272a',.5,.12),skin:material('#b27b57',.74,0,{clearcoat:.04,clearcoatRoughness:.7,...bump(pores,.0013)}),shirt:material('#1b1d20',.93,0,{sheen:.6,sheenRoughness:.68,sheenColor:new T.Color('#565c60'),...bump(knit,.0034)}),pants:material('#1a1c1f',.92,0,{sheen:.36,sheenRoughness:.78,sheenColor:new T.Color('#3c4245'),...bump(twill,.003)}),gloves:material('#101214',.82,0,{clearcoat:.15,clearcoatRoughness:.5}),shoes:material('#eeeae1',.82,0,{clearcoat:.12,clearcoatRoughness:.6}),sole:material('#e9e6d9',.9),helmet:material('#1b1e21',.52,.06,{clearcoat:.30,clearcoatRoughness:.48}),trim:material('#16dfcf',.4,.2,{clearcoat:.4,clearcoatRoughness:.3}),hair:material('#1c1510',.94,0,{...bump(strands,.0045)}),face:material('#ffffff',.6,0,{clearcoat:.06,clearcoatRoughness:.7}),whitewall:material('#e8e2ce',.9)};
  this.frame=new T.Group();this.frame.position.copy(HEAD);this.bike.add(this.frame);
  this.front=new T.Group();this.front.position.copy(HEAD);this.bike.add(this.front);
  const local=a=>v(...a).sub(HEAD),ft=(a,b,r,m=this.m.frame)=>tube(this.frame,local(a),local(b),r,m,12),st=(a,b,r,m=this.m.frame)=>tube(this.front,local(a),local(b),r,m,12);
  // 20-inch street BMX: low BB, compact rear triangle, 75-degree steering, 32 mm fork offset.
  for(const z of [-.045,.045]){ft([-.445,.267,z],[-.10,.292,z*.65],.011);ft([-.445,.267,z],[-.164,.515,z*.20],.010);}
  ft([-.10,.292,0],[-.164,.515,0],.016);ft([-.164,.515,0],[.384,.67,0],.018);ft([-.1,.292,0],[.416,.55,0],.021);ft([.416,.55,0],[.384,.67,0],.023);ft([-.164,.515,0],[-.207,.666,0],.012,this.m.black);
  ft([-.10,.292,-.047],[-.1,.292,.047],.024,this.m.black);
  this.saddle=ellipsoid(this.frame,[.135,.031,.068],[-.207-HEAD.x,.69-HEAD.y,0],this.m.black,24);
  for(const z of [-.046,.046])ft([-.29,.698,z],[-.11,.698,z*.7],.0015,this.m.sole);
  st([.416,.55,-.047],[.416,.55,.047],.024);for(const z of [-.047,.047]){st([.416,.55,z],[.525,.267,z],.016);box(this.front,[.04,.06,.008],local([.525,.28,z]).toArray(),this.m.frame);}
  st([.384,.67,0],[.36,.761,0],.014,this.m.black);box(this.front,[.077,.029,.044],local([.376,.78,0]).toArray(),this.m.black);
  for(const x of [.35,.395])for(const z of [-.016,.016])ellipsoid(this.front,[.004,.003,.004],local([x,.797,z]).toArray(),this.m.metal,8);
  const bends=[[-.365,1.026,.302],[-.215,1.02,.334],[-.19,1.0,.338],[-.16,.817,.373],[-.14,.801,.376],[.14,.801,.376],[.16,.817,.373],[.19,1.0,.338],[.215,1.02,.334],[.365,1.026,.302]].map(([z,y,x])=>local([x,y,z]));
  mesh(new T.TubeGeometry(new T.CatmullRomCurve3(bends),56,.011,10,false),this.m.frame,this.front);
  st([.355,.886,-.175],[.355,.886,.175],.0085);
  for(const sign of [-1,1]){st([.334,1.02,sign*.215],[.302,1.026,sign*.365],.015,this.m.rubber);st([.302,1.026,sign*.365],[.301,1.026,sign*.370],.0155,this.m.black);}
  // Axle pegs stay with the frame/fork rather than spinning with the wheels.
  for(const sign of [-1,1]){ft([-.445,.267,sign*.06],[-.445,.267,sign*.16],.022,this.m.black);st([.525,.267,sign*.06],[.525,.267,sign*.16],.022,this.m.black);}
  this.grips=[local([.317,1.023,.29]),local([.317,1.023,-.29])];
  this.wheels=[];
  const wheel=(parent,center)=>{
    const g=new T.Group();g.position.copy(local(center));parent.add(g);
    // Exposed sidewalls and rim surfaces; nested tori hid the old tire details.
    const band=(profile,material)=>{const o=mesh(new T.LatheGeometry(profile.map(([r,z])=>new T.Vector2(r,z)),64),material,g);o.rotation.x=Math.PI/2;};
    band([[.253,-.020],[.264,-.012],[.267,0],[.264,.012],[.253,.020]],this.m.rubber);
    band([[.208,-.022],[.222,-.029],[.241,-.028],[.253,-.020]],this.m.whitewall);
    band([[.253,.020],[.241,.028],[.222,.029],[.208,.022]],this.m.whitewall);
    mesh(new T.TorusGeometry(.201,.008,8,64),this.m.metal,g);
    for(const sign of [-1,1]){const rim=mesh(new T.RingGeometry(.193,.208,64),this.m.metal,g,v(0,0,sign*.023));if(sign<0)rim.rotation.y=Math.PI;}
    tube(g,v(0,0,-.041),v(0,0,.041),.018,this.m.metal,16);
    for(let i=0;i<36;i++){const a=i/36*TAU,sign=i%2?1:-1,h=a+sign*.35;tube(g,v(Math.cos(h)*.018,Math.sin(h)*.018,sign*.03),v(Math.cos(a)*.197,Math.sin(a)*.197,sign*.013),.00125,this.m.metal,3);}
    // Fine street tread, with no mountain-bike knobs.
    for(const z of [-.008,.008]){const groove=mesh(new T.TorusGeometry(.266,.0008,3,64),this.m.black,g,v(0,0,z));}
    mergeRigid(g);this.wheels.push(g);return g;
  };
  wheel(this.frame,[-.445,.267,0]);wheel(this.front,[.525,.267,0]);
  this.crank=new T.Group();this.crank.position.copy(local([-.1,.292,0]));this.frame.add(this.crank);
  tube(this.crank,v(0,0,-.10),v(0,0,.10),.015,this.m.metal);
  this.pedals=[];
  for(let i=0;i<2;i++){const sign=i===0?1:-1;tube(this.crank,v(0,0,sign*.09),v(sign*.165,0,sign*.09),.012,this.m.black);const pedal=new T.Group();pedal.position.set(sign*.165,0,sign*.145);this.crank.add(pedal);box(pedal,[.1,.025,.095],[0,0,0],this.m.black);for(const z of [-.03,.03])box(pedal,[.09,.009,.008],[0,.016,z],this.m.metal);mergeRigid(pedal);this.pedals.push(pedal);}
  for(const sign of [-1,1]){const disc=mesh(new T.RingGeometry(.015,.058,32),this.m.black,this.frame,local([-.10,.292,.089+sign*.003]));if(sign<0)disc.rotation.y=Math.PI;}
  ft([-.1,.292,.08],[-.1,.292,.097],.018,this.m.metal);ft([-.445,.267,.055],[-.445,.267,.095],.019,this.m.black);
  const chainPoints=[];for(let i=0;i<=16;i++){const a=-Math.PI/2+i/16*Math.PI;chainPoints.push(local([-.1+Math.cos(a)*.061,.292+Math.sin(a)*.061,.095]));}for(let i=0;i<=12;i++){const a=Math.PI/2+i/12*Math.PI;chainPoints.push(local([-.445+Math.cos(a)*.020,.267+Math.sin(a)*.020,.095]));}
  const chainPath=new T.CurvePath();for(let i=0;i<chainPoints.length;i++)chainPath.add(new T.LineCurve3(chainPoints[i],chainPoints[(i+1)%chainPoints.length]));mesh(new T.TubeGeometry(chainPath,90,.0035,4,true),this.m.metal,this.frame);
  for(let i=0;i<25;i++){const a=i/25*TAU;const tooth=box(this.frame,[.008,.008,.006],local([-.1+Math.cos(a)*.061,.292+Math.sin(a)*.061,.095]).toArray(),this.m.black);tooth.rotation.z=a;}
  mergeRigid(this.frame,new Set([this.wheels[0],this.crank]));mergeRigid(this.front,new Set([this.wheels[1]]));mergeRigid(this.crank,new Set(this.pedals));
  this.body=new T.Group();this.root.add(this.body);
  this.torso=mesh(sections([[-.30,.150,.207],[-.275,.155,.215],[-.21,.147,.210],[-.08,.148,.216],[.04,.146,.222],[.14,.143,.224],[.21,.113,.198],[.235,.064,.078]],20),this.m.shirt,this.body);
  this.pelvis=ellipsoid(this.body,[.112,.10,.146],[0,0,0],this.m.pants);
  // A short neck (the old one was nearly as tall as the face, so the head sat on a stalk)
  // flaring into a ribbed crew collar, instead of a bare tube vanishing into a hole.
  this.neck=mesh(new T.CylinderGeometry(.058,.074,.10,16),this.m.skin,this.body);
  const collarGeo=new T.TorusGeometry(.071,.013,8,28);collarGeo.rotateX(Math.PI/2);this.collar=mesh(collarGeo,this.m.shirt,this.body);
  this.head=new T.Group();this.body.add(this.head);
  // Sculpted adult face. Texture UVs wrap around the skull, with its front at U=.5.
  const face=sections([[-.13,.039,.045,.015],[-.112,.061,.064,.011],[-.087,.081,.077,.009],[-.045,.092,.085,.006],[0,.098,.088],[.035,.103,.088],[.075,.10,.083],[.112,.079,.067],[.136,.025,.028]],56);
  const fp=face.attributes.position,fu=face.attributes.uv;
  for(let i=0;i<fp.count;i++){const angle=fu.getX(i)*TAU,yy=fp.getY(i),front=Math.max(0,Math.cos(angle));let xx=fp.getX(i);
   // Nose bridge/tip, brow ridge, cheek bones and chin are part of the face surface, so
   // the profile has real relief instead of a painted-on nose on a smooth egg.
   xx+=.050*Math.exp(-Math.pow(yy/.030,2))*Math.pow(front,30)+.010*Math.exp(-Math.pow((yy-.032)/.034,2))*Math.pow(front,8)+.007*Math.exp(-Math.pow((yy-.058)/.016,2))*Math.pow(front,3)+.006*Math.exp(-Math.pow((yy+.108)/.02,2))*Math.pow(front,4);
   fp.setX(i,xx);fu.setXY(i,fu.getX(i)+.50,(yy+.14)/.28);
  }face.computeVertexNormals();mesh(face,this.m.face,this.head);
  // Ears lie flat against the skull rather than flaring out like wings.
  for(const sign of [-1,1]){ellipsoid(this.head,[.019,.029,.009],[-.008,-.012,sign*.086],this.m.skin,16);ellipsoid(this.head,[.010,.017,.004],[-.004,-.011,sign*.092],this.m.skin,12);}
  // Short hair as one smooth matte cap hugging the skull (back, sides and temples, open at
  // the face), plus a lower piece down the nape. The previous "curls" were a ring of loose
  // shiny ellipsoids that read as bubbles wherever they poked out under the helmet.
  // SphereGeometry's phi=0 points to -x (the back of the head), so the open front wedge is
  // centred on phi=π.
  // The cap stops just above the ears at the sides (so they show, as on a real short cut),
  // while the nape piece carries the hair further down only at the back of the head.
  const hairCap=mesh(new T.SphereGeometry(1,40,22,Math.PI*1.355,Math.PI*1.29,0,Math.PI*.515),this.m.hair,this.head,v(-.004,.022,0));hairCap.scale.set(.111,.128,.096);
  const nape=mesh(new T.SphereGeometry(1,30,12,Math.PI*1.59,Math.PI*.82,Math.PI*.48,Math.PI*.27),this.m.hair,this.head,v(-.006,.024,0));nape.scale.set(.109,.127,.094);
  // Wavy hair showing at the sideburn in front of each ear, and behind/below the ear.
  for(const sign of [-1,1]){const burn=ellipsoid(this.head,[.009,.026,.006],[.021,-.006,sign*.087],this.m.hair,10);burn.rotation.z=-.12;}
  // Thick dark brows as real geometry along the brow ridge (the painted ones sat in the
  // helmet's shadow and vanished), angled to follow the face's curve.
  for(const sign of [-1,1]){const a=sign*.36,brow=ellipsoid(this.head,[.021,.0045,.007],[.100*Math.cos(a)+.004,.061,.086*Math.sin(a)],this.m.hair,10);brow.rotation.y=-(a+Math.PI/2);brow.rotation.z=sign*.10;}
  // Skate helmet modelled on the reference: a matte, slightly elongated shell that sits
  // low — rim just above the brows at the front, sweeping down past the ears at the sides
  // and lower still at the back — built by projecting a deep sphere onto a tilted cut
  // plane, rather than a shiny hemisphere perched on top of the head.
  const helmetGeo=new T.SphereGeometry(1,44,26,0,TAU,0,Math.PI*.78),hp=helmetGeo.attributes.position,HS=[.131,.113,.122],cutAt=x=>-.013+x*.30;
  for(let i=0;i<hp.count;i++){const x=hp.getX(i)*HS[0],z=hp.getZ(i)*HS[2];let y=hp.getY(i)*HS[1];const cut=cutAt(x);if(y<cut)y=cut;hp.setXYZ(i,x,y,z);}
  helmetGeo.computeVertexNormals();const HC=v(-.012,.052,0),helmet=mesh(helmetGeo,this.m.helmet,this.head,HC);
  // A rubbery edge trim runs along the tilted rim.
  const rim=mesh(new T.TorusGeometry(.122,.0065,6,48),this.m.rubber,this.head,HC.clone().add(v(0,-.013,0)));rim.scale.set(1.06,1,.985);rim.quaternion.copy(new T.Quaternion().setFromAxisAngle(v(0,0,1),Math.atan(.30))).multiply(new T.Quaternion().setFromAxisAngle(v(1,0,0),Math.PI/2));
  // Oval vents inset into the shell, and a side rivet above each ear.
  const onShell=(theta,phi,inset=1)=>v(HS[0]*Math.sin(theta)*Math.cos(phi)*inset,HS[1]*Math.cos(theta)*inset,HS[2]*Math.sin(theta)*Math.sin(phi)*inset),shellNormal=p=>v(p.x/(HS[0]*HS[0]),p.y/(HS[1]*HS[1]),p.z/(HS[2]*HS[2])).normalize();
  const vents=[[.42,.45],[.42,-.45],[.36,0],[.50,2.55],[.50,-2.55],[1.02,1.32],[1.02,-1.32],[.98,1.90],[.98,-1.90]];
  for(const [theta,phi] of vents){const p=onShell(theta,phi,.985),vent=ellipsoid(this.head,[.017,.0045,.0095],HC.clone().add(p).toArray(),this.m.rubber,12);vent.quaternion.setFromUnitVectors(UP,shellNormal(p));}
  for(const sign of [-1,1]){const p=onShell(1.30,sign*1.62,1.0),rivet=mesh(new T.CylinderGeometry(.0065,.0065,.004,14),this.m.metal,this.head,HC.clone().add(p));rivet.quaternion.setFromUnitVectors(UP,shellNormal(p));}
  // Flat webbing chin straps: front and rear straps meet at a Y-divider just below each
  // ear, then a single strap runs under the chin. Boxes oriented end-to-end, not tubes.
  const strap=(a,b,w=.011,t=.0018)=>{const d=b.clone().sub(a),o=mesh(new T.BoxGeometry(d.length(),t,w),this.m.rubber,this.head,a.clone().add(b).multiplyScalar(.5));o.quaternion.setFromUnitVectors(v(1,0,0),d.normalize());return o;};
  for(const sign of [-1,1]){const y=v(.004,-.058,sign*.083);strap(v(.056,.040,sign*.104),y);strap(v(-.062,.008,sign*.104),y);strap(y,v(.014,-.134,sign*.022));
   const divider=box(this.head,[.013,.017,.005],y.toArray(),this.m.black);divider.rotation.x=sign*.35;}
  mergeRigid(this.head);
  // A ponytail for the girl build: a hair tie at the nape below the helmet's rim, then a
  // tapered tail hanging down the back. Hidden for the boy build (setRider).
  this.ponytail=new T.Group();this.head.add(this.ponytail);{const base=v(-.118,.004,0);ellipsoid(this.ponytail,[.040,.032,.040],base.toArray(),this.m.hair,12);const tie=mesh(new T.TorusGeometry(.027,.006,6,16),this.m.trim,this.ponytail,base.clone().add(v(-.036,-.006,0)));tie.rotation.y=Math.PI/2;
   const path=[base.clone().add(v(-.042,-.008,0)),v(-.205,-.045,0),v(-.238,-.120,0),v(-.248,-.205,0),v(-.240,-.290,0)],radii=[.029,.027,.023,.017,.009];for(let i=0;i<path.length-1;i++){tube(this.ponytail,path[i],path[i+1],radii[i],this.m.hair,8);ellipsoid(this.ponytail,[radii[i+1]*1.05,radii[i+1]*1.05,radii[i+1]*1.05],path[i+1].toArray(),this.m.hair,10);}mergeRigid(this.ponytail);this.ponytail.visible=false;}
  this.necklace=new T.Group();this.body.add(this.necklace);for(let i=0;i<40;i++){const a=i/40*TAU,drop=Math.max(0,Math.cos(a));const link=mesh(new T.TorusGeometry(.0056,.0017,4,10),this.m.metal,this.necklace,v(Math.cos(a)*(.081+drop*.012),-.022-drop*.062,Math.sin(a)*.094));link.rotation.y=a+(i%2)*Math.PI/2;link.rotation.x=(i%2)*.4;}
  mergeRigid(this.necklace);
  this.chestMark=box(this.torso,[.002,.018,.018],[.144,.14,.095],this.m.trim);
  this.arms=[];this.legs=[];this.hands=[];this.feet=[];this.contacts=[];this.bones=[];
  for(let i=0;i<2;i++){
    const upper=mesh(sections([[-.15,.057,.052],[-.10,.061,.054],[.01,.054,.049],[.15,.037,.035]],16),this.m.skin,this.body);const fore=mesh(sections([[-.145,.040,.037],[-.09,.044,.039],[.045,.034,.030],[.145,.025,.024]],16),this.m.skin,this.body);
    const sleeve=mesh(sections([[-.125,.094,.093],[-.08,.098,.093],[.035,.097,.088],[.10,.086,.083],[.125,.087,.084]],18),this.m.shirt,this.body);
    const shoulderCap=ellipsoid(this.body,[.091,.083,.088],[0,0,0],this.m.shirt,14);
    const elbow=ellipsoid(this.body,[.041,.041,.041],[0,0,0],this.m.skin,10);
    const hand=new T.Group();this.body.add(hand);ellipsoid(hand,[.044,.022,.031],[0,0,0],this.m.gloves,12);for(let f=0;f<4;f++){tube(hand,v(.011,-.002,(f-1.5)*.012),v(.034,-.015,(f-1.5)*.012),.006,this.m.gloves,6);tube(hand,v(.034,-.015,(f-1.5)*.012),v(.019,-.023,(f-1.5)*.012),.005,this.m.gloves,6);}tube(hand,v(-.019,0,.021),v(.007,-.020,.029),.008,this.m.gloves,7);mergeRigid(hand);hand.userData.closed=[...hand.children];const open=new T.Group();hand.add(open);ellipsoid(open,[.044,.019,.032],[0,0,0],this.m.gloves,12);for(let f=0;f<4;f++){const z=(f-1.5)*.016,l=f===0||f===3?.061:.075;tube(open,v(.025,0,z),v(l,.003,z*1.22),.006,this.m.gloves,6);}tube(open,v(-.008,0,.026),v(.032,0,.061),.008,this.m.gloves,6);mergeRigid(open);open.visible=false;hand.userData.open=open;this.hands.push(hand);this.arms.push({upper,fore,sleeve,elbow,shoulderCap});
    const thigh=mesh(sections([[-.235,.112,.101],[-.16,.114,.102],[-.05,.105,.096],[.09,.094,.088],[.18,.092,.087],[.235,.096,.089]],14),this.m.pants,this.body);
    const shin=mesh(sections([[-.235,.093,.088],[-.14,.097,.090],[-.055,.091,.086],[.07,.086,.081],[.125,.089,.083],[.155,.079,.076]],14),this.m.pants,this.body);
    const knee=ellipsoid(this.body,[.092,.085,.087],[0,0,0],this.m.pants,12);this.legs.push({thigh,shin,knee});
    const shoe=new T.Group();this.body.add(shoe);
    ellipsoid(shoe,[.118,.039,.052],[.042,.055,0],this.m.shoes,20);ellipsoid(shoe,[.112,.029,.048],[.046,.078,0],this.m.shoes,20);
    const outline=new T.Shape();outline.moveTo(-.070,-.045);outline.quadraticCurveTo(-.088,0,-.070,.045);outline.lineTo(.132,.049);outline.quadraticCurveTo(.176,0,.132,-.049);outline.closePath();const soleGeo=new T.ExtrudeGeometry(outline,{depth:.027,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.006,bevelThickness:.003,curveSegments:8});soleGeo.rotateX(Math.PI/2);mesh(soleGeo,this.m.sole,shoe,v(0,.033,0));
    for(const side of [-1,1]){const stripe=[[.125,.060],[.081,.068],[.050,.055],[.020,.074],[-.043,.080]];for(let j=0;j<stripe.length-1;j++)tube(shoe,v(stripe[j][0],stripe[j][1],side*.049),v(stripe[j+1][0],stripe[j+1][1],side*.049),.0045,this.m.sole,5);tube(shoe,v(-.065,.035,side*.047),v(.13,.035,side*.05),.0018,this.m.black,4);}
    for(let j=0;j<4;j++){tube(shoe,v(.003+j*.017,.102,-.025),v(.020+j*.017,.102,.025),.0024,this.m.sole,4);tube(shoe,v(.003+j*.017,.102,.025),v(.020+j*.017,.102,-.025),.0024,this.m.sole,4);}mergeRigid(shoe);this.feet.push(shoe);
  }
  this.pose({mode:'ground',tricks:{},wheelSpin:0});
 }
 applyKit(kit){const k=typeof kit==='number'?KITS[((kit%KITS.length)+KITS.length)%KITS.length]:kit;if(!k)return;this.m.shirt.color.set(TEE);this.m.shirt.sheenColor.set(TEE_SHEEN);this.m.pants.color.set(k.pants);this.m.frame.color.set(k.frame);this.m.frame.metalness=k.frameMetal;this.m.frame.needsUpdate=true;this.kit=k;return k;}
 // The rider: boy or girl (a ponytail out the back of the helmet, a narrower torso) and the
 // stance — which foot rides forward on the cranks when coasting (regular: right foot forward).
 setRider({build='boy',stance='right'}={}){this.build=build;this.stance=stance;const girl=build==='girl';if(this.ponytail)this.ponytail.visible=girl;this.torso.scale.z=girl?.90:1;this.pelvis.scale.set(.112,.10,girl?.152:.146);for(const a of this.arms)a.sleeve.scale.x=a.sleeve.scale.z=girl?.92:1;return this;}
 point(object,position){object.updateWorldMatrix(true,false);return this.root.worldToLocal(object.localToWorld(position.clone()));}
 align(object,a,b,rest){object.position.copy(a).add(b).multiplyScalar(.5);object.quaternion.setFromUnitVectors(UP,b.clone().sub(a).normalize());object.scale.y=a.distanceTo(b)/rest;}
 pose(s){
  const tr=s.tricks||{},amount=id=>envelope(tr[id]||0),air=s.mode==='air',roam=!!s.freeRoam;
  const table=amount('tabletop')+amount('onehandtable'),invert=amount('invert'),turn=amount('turndown'),tobo=amount('toboggan'),superman=amount('superman'),cliff=amount('cliffhanger'),whip=tr.tailwhip||0,bar=tr.barspin||0,decade=tr.decade||0,bikeflip=tr.bikeflip||0;
  // T3: the seat grab (indy), the tuck (cannonball), the front bikeflip, the one-foot X-up,
  // the pendulum (frame swung out and back), the no-foot can one-hander, the can-can tyre
  // grab and the nac-nac — built from the same parts as the sets above.
  const indy=amount('indy'),cannon=amount('cannonball'),fbike=tr.frontbikeflip||0,oneXup=amount('onefootxup'),pend=tr.pendulum||0,nfOne=amount('nofootcanonehander'),ccTyre=amount('cancantyregrab'),nac=amount('nacnac');
  const tuck=amount('nohander'),suicide=amount('suicide'),can=Math.max(amount('cancan'),ccTyre),nofoot=Math.max(amount('nofootcancan'),nfOne),one=Math.max(amount('onehandtable'),nfOne),xup=Math.max(amount('xup'),oneXup),kick=amount('kickout');
  // Rotations are counted in turns (free roam may extend a held whip or barspin to a double
  // or triple while it is in progress, so the count comes from the physics' current cap).
  // The throw has a per-turn rhythm — a touch slower as the frame or bars come round to be
  // caught, faster through the middle of each turn — that never depends on the final count,
  // so extending or capping the rotation mid-flight can't make it jump.
  const turns=pose=>s.trickCap?.[pose]||(s.active?.includes(pose==='barspin'?'triplebarspin':'tripletailwhip')?3:s.active?.includes(pose==='barspin'?'doublebarspin':'doubletailwhip')?2:1);
  const throwPhase=phase=>s.freeRoam?phase-.10*Math.sin(TAU*phase)/TAU:phase;
  // How far each hand is off the bars through a barspin and each foot off the pedals through
  // a whip (0 on, 1 fully released): the left hand throws first and catches first, the left
  // foot kicks first and lands first, so the windows are staggered per side.
  const barC=turns('barspin'),whipC=turns('tailwhip');
  const barWindow=i=>bar?smooth(Math.min((bar-(i===0?.06:.02))/.15,(barC-1+(i===0?.95:.82)-bar)/.18)):0;
  const whipWindow=i=>whip?smooth(Math.min(whip/.18,(whipC-whip)/(i===0?.16:.23))):0;
  const barLift=Math.max(barWindow(0),barWindow(1)),whipLift=Math.max(whipWindow(0),whipWindow(1));
  // The bike's attitude relative to the rider: laid flat for a table, inverted, yawed for a
  // turndown or kickout, and lifted at the nose through a barspin or no-hander, where a
  // rider pulls the front end up to the body and pinches the saddle between the knees.
  this.bike.quaternion.setFromEuler(new T.Euler(-table*1.20-invert*2.30+turn*.90-indy*.55,-turn*.45+kick*.60+indy*.22,-tobo*.22+turn*.10+tuck*.25-superman*.10+(s.freeRoam?barLift*.10:0),'YXZ'));
  this.bike.position.copy(GRIP_CENTER).sub(GRIP_CENTER.clone().applyQuaternion(this.bike.quaternion));
  this.bike.position.y+=table*.09+invert*.30+indy*.06;
  // Front bikeflip: the bike turns over forwards about the bars, in the rider's hands.
  if(fbike){this.bike.quaternion.setFromAxisAngle(v(0,0,1),-fbike*TAU);const pivot=GRIP_CENTER.clone();this.bike.position.copy(pivot).sub(pivot.clone().applyQuaternion(this.bike.quaternion));}
  if(bikeflip){this.bike.quaternion.setFromAxisAngle(v(0,.30,1).normalize(),-bikeflip*TAU);const pivot=v(.20,.99,0);this.bike.position.copy(pivot).sub(pivot.clone().applyQuaternion(this.bike.quaternion));}
  // Sequential bunny-hop pop: the front end rises on its own first, the rear catches up a
  // beat later, instead of the whole bike translating upward as one rigid block.
  this.frame.position.copy(HEAD);this.frame.position.y+=(s.hopRearLift||0)*.075;
  this.front.position.copy(HEAD);this.front.position.y+=(s.hopFrontLift||0)*.095;
  const swing=pend?Math.sin(Math.min(1,pend)*Math.PI)*.40:0;this.frame.quaternion.setFromAxisAngle(AXIS,-(throwPhase(whip)+swing)*TAU);
  this.front.quaternion.setFromAxisAngle(AXIS,throwPhase(bar)*TAU+(s.freeRoam&&s.mode==='ground'?-(s.steer||0):0)+turn*Math.PI+tobo*Math.PI/2+xup*Math.PI);
  for(const wheel of this.wheels)wheel.rotation.z=-(s.wheelSpin||0);
  const crankAngle=(s.crankAngle??(air?0:-(s.wheelSpin||0)*.30))+(this.stance==='left'?Math.PI:0);this.crank.rotation.z=crankAngle;for(const pedal of this.pedals)pedal.rotation.z=-crankAngle;
  this.bike.updateWorldMatrix(true,true);this.root.updateWorldMatrix(true,false);
  const grips=this.grips.map(g=>this.point(this.front,g)),restGrips=this.grips.map(g=>this.point(this.bike,g.clone().add(HEAD)));const pedals=this.pedals.map(p=>this.point(p,v(0,.028,0)));const seat=this.point(this.frame,v(-.16-HEAD.x,.71-HEAD.y,0));
  // ---- Body posture: where the hips sit and which way the torso leans. ----
  // Standing on the pedals: hips just behind and above the saddle, torso leaning forward
  // over the bars. Laid-over tricks (table, invert, turndown, cliffhanger) carry the hips
  // with the bike; a whip, superman or cliffhanger then set their own posture below.
  let hip=v(-.24+invert*.04,1.04-(s.pump?.14:0)-(s.compression||0)+table*.14+invert*.21+turn*.12+cliff*.74,-table*.13+invert*.05+turn*.12);
  if(s.freeRoam&&s.balance){hip.x-=s.balance*.22;hip.y-=Math.abs(s.balance)*.07;}if(s.grind){hip.x+=s.grind==='Icepick'?-.14:s.grind==='Toothpick'?.18:0;hip.y-=.08;}
  let spine=NEUTRAL_SPINE.clone().multiplyScalar(.44);const torsoQ=new T.Quaternion();const tip=(axis,angle)=>{if(!angle)return;spine.applyAxisAngle(axis,angle);torsoQ.premultiply(new T.Quaternion().setFromAxisAngle(axis,angle));};
  // Carve lean: on the ground in free roam the whole upper body tips further into the turn
  // than the bike does (roll comes from physics), so the rider reads as leaning through a
  // carve rather than sitting bolt upright on a tilting bike. Applied to the spine before
  // the IK solve, so shoulders, arms and head all move with it and the hands stay on the grips.
  if(s.freeRoam&&s.mode==='ground'&&s.roll)tip(v(1,0,0),s.roll*.65);
  // Air posture (free roam): the rider compacts over the bike — hips drop a hand's width and
  // sit back, knees and elbows bend (the IK does that once the hips are lower), the torso
  // comes a little further over the bars — building to the apex and opening up again to
  // reach for the landing. The body stays nearer to world-vertical than the bike: when the
  // bike points up the wall the rider is forward over the bars, when it points down the
  // wall on re-entry the rider stands up off it, instead of tipping as one rigid block.
  // Tricks that own the whole body (whip, superman, cliffhanger) fade the tuck out.
  const owned=Math.max(whipLift,superman,cliff);
  // A flip is the one air where the rider does NOT stay upright: past about 30° of rotation
  // they go rigid with the bike and tuck — hips up under the saddle, knees and elbows in,
  // chin down — so bike and body turn over as one. `flip` fades the upright counter-lean out
  // over that first 30–80°, which is what stopped flips looking like a rider fighting a bike
  // that had gone upside down without them.
  const flip=s.freeRoam&&air?smooth(((Math.abs(s.flip||0))-.52)/.88):0;
  const airPitch=(s.pitch||0)*(1-flip);
  if(s.freeRoam&&air){const ap=(s.airPose||0)*(1-owned);hip.y-=ap*.09;hip.x-=ap*.03-Math.max(0,airPitch)*.08;tip(v(0,0,1),-(s.airLean||0)*(1-owned)-airPitch*.30);if(s.roll)tip(v(1,0,0),s.roll*.85*(1-flip));
   if(flip){hip.y+=flip*.11;hip.x+=flip*.05;tip(v(0,0,1),flip*.30);}}
  // A tabletop lays the body over with the bike instead of leaving it standing upright
  // on a sideways frame.
  if(table)tip(v(1,0,0),-table*.62);
  // An invert carries the whole rider round with the bike: hips up beside the upturned
  // frame, legs reaching up to the pedals, torso and head hanging below.
  if(invert)tip(v(1,0,0),-invert*2.2);
  // Turndown: the bike is laid over to the right with the bars turned right round; the
  // rider twists to face that way and leans over with it, arms crossed in front of the body.
  if(turn)tip(v(1,0,0),turn*.35);
  // Tailwhip: the rider springs up off the pedals and tucks — hips rise, knees come up and
  // out, feet spread — so the frame passes underneath, then drops back onto the pedals.
  // The torso stays over the bars, leaning in to watch the frame come round.
  if(whip){hip.y+=whipLift*Math.max(0,1.14-hip.y);hip.x+=whipLift*.05;tip(v(0,0,1),-whipLift*.12);}
  // Barspin: chest over the stem, eyes on the bars.
  if(bar)tip(v(0,0,1),-barLift*.10);
  // No-hander: chest up and open; suicide: arched back with the chest thrown forward.
  if(tuck)tip(v(0,0,1),tuck*.22);if(suicide){hip.x+=suicide*.10;tip(v(0,0,1),suicide*.42);}
  // Bikeflip: the rider springs up, back and to the right of the bike and leans away from it.
  const flipW=bikeflip?smooth(Math.min((bikeflip%1)/.15,(1-bikeflip%1)/.15)):0;if(flipW){hip.x-=flipW*.12;hip.y+=flipW*.22;hip.z+=flipW*.26;tip(v(0,0,1),flipW*.30);}
  // Front bikeflip: the rider springs up and tucks over the bars while the bike turns over
  // under them; pendulum: up off the pedals for the swing like a whip; cannonball: pulled up
  // into a ball; indy: leans over with the bike toward the seat; tyre grab: folded forward
  // over the bars to reach the front wheel.
  const flipF=fbike?smooth(Math.min((fbike%1)/.15,(1-fbike%1)/.15)):0;if(flipF){hip.y+=flipF*.24;hip.x+=flipF*.04;tip(v(0,0,1),-flipF*.22);}
  const pendLift=pend?smooth(Math.min(pend/.14,(1-pend)/.16)):0;if(pendLift){hip.y+=pendLift*Math.max(0,1.14-hip.y);hip.x+=pendLift*.05;tip(v(0,0,1),-pendLift*.12);}
  if(cannon){hip.y+=cannon*.16;hip.x+=cannon*.04;tip(v(0,0,1),-cannon*.18);}
  if(indy){hip.y+=indy*.05;tip(v(1,0,0),-indy*.28);}
  if(ccTyre){hip.x+=ccTyre*.14;hip.y-=ccTyre*.10;tip(v(0,0,1),-ccTyre*.38);}
  hip.x-=superman*.50+tobo*.16;hip.x+=cliff*.45;hip.y+=superman*.20;tip(v(0,0,1),-superman*.745);
  if(cliff)tip(v(0,0,1),cliff*.607);
  hip.x+=tuck*.22;spine.normalize().multiplyScalar(.44);
  const bodyYaw=-decade*TAU-turn*.55-nac*.45,bodyQ=new T.Quaternion().setFromAxisAngle(UP,bodyYaw),lateral=v(0,0,1).applyQuaternion(bodyQ);
  if(decade){const a=decade*TAU,weight=smooth(Math.min((decade%1)/.12,(1-decade%1)/.12));hip.lerp(v(HEAD.x-.48*Math.cos(a),1.10,-.48*Math.sin(a)),weight);spine.applyQuaternion(bodyQ);torsoQ.premultiply(bodyQ);}else if(turn||nac)torsoQ.premultiply(bodyQ);
  // ---- Limb targets. ----
  // Free hands and feet are placed relative to the body (a shoulder, a hip) so they hold
  // the same shape whether the rider is standing tall or tucked low; anything that touches
  // the bike (grips, pedals, saddle, hovering over the bars) is placed relative to the bike.
  const shoulderAt=i=>hip.clone().addScaledVector(spine,.84).addScaledVector(lateral,i===0?.185:-.185),legRoot=i=>hip.clone().addScaledVector(lateral,i===0?.10:-.10);
  const handTargets=grips.map(g=>g.clone()),footTargets=pedals.map(p=>p.clone());let handContact=['grip','grip'],footContact=[true,true],footBar=[false,false];
  const phase=(id)=>tr[id]?tr[id]%1:0;
  // Barspin: both hands hover just above where the grips will come back round — palms down
  // over the bars, elbows out — never up in the air.
  if(bar){for(let i=0;i<2;i++){const release=barWindow(i);if(release>0){handContact[i]=null;handTargets[i]=grips[i].clone().lerp(restGrips[i].clone().add(v(-.04,.13,i===0?-.05:.05)),release);}}}
  // Tailwhip: a tight tuck under the hips, feet spread wider than the frame; the kicking
  // (left) foot follows the tail out and back for the first part of the throw.
  if(whip){for(let i=0;i<2;i++){const lift=whipWindow(i);footContact[i]=lift<.00001;const sweep=s.freeRoam&&i===1?Math.sin(Math.min(1,whip/.30)*Math.PI):0;footTargets[i]=blend(pedals[i],legRoot(i).add(v(.24-sweep*.14,-.33-sweep*.05,(i===0?.17:-.17)-sweep*.12)),lift);}}
  // No-hander: arms spread wide from the shoulders like wings; suicide: flung out behind.
  if(tuck||suicide){const a=Math.max(tuck,suicide);for(let i=0;i<2;i++){handContact[i]=a<.03?'grip':null;const sh=shoulderAt(i),sign=i===0?1:-1;handTargets[i]=blend(grips[i],sh.add(suicide>tuck?v(-.30,.16,sign*.42):v(.03,.24,sign*.44)),a);}}
  if(one){handContact[0]=one<.03?'grip':null;handTargets[0]=blend(grips[0],shoulderAt(0).add(v(-.34,.30,.32)),one);}
  if(tobo){handContact[0]=tobo>.8?'seat':tobo<.03?'grip':null;handTargets[0]=blend(grips[0],seat,Math.min(1,tobo*1.3));}
  // Can-can: the right leg swings over the top tube and points out beside the left foot;
  // no-foot can-can: both legs out to the left side together.
  if(can||nofoot){for(let i=0;i<2;i++)if(i===0||nofoot){const a=Math.max(can,nofoot);footContact[i]=a<.03;footTargets[i]=blend(pedals[i],legRoot(i).add(nofoot>can?(i===0?v(.28,-.20,-.70):v(.22,-.20,-.60)):v(.36,-.18,-.72)),a);}}
  // Superman: legs stretched straight out behind the hips.
  if(superman){for(let i=0;i<2;i++){footContact[i]=superman<.03;footTargets[i]=blend(pedals[i],hip.clone().add(v(-.75,-.12,i===0?.11:-.11)),superman);}}
  if(cliff){for(let i=0;i<2;i++){footContact[i]=cliff<.03;footTargets[i]=blend(pedals[i],grips[i].clone().add(v(-.05,-.045,0)),Math.min(1,cliff*1.1));footBar[i]=cliff>1/1.1;handContact[i]=cliff<.03?'grip':null;handTargets[i]=blend(grips[i],shoulderAt(i).add(v(0,.26,i===0?.40:-.40)),cliff);}}
  if(decade){const p=phase('decade');for(let i=0;i<2;i++){footContact[i]=p===0;const a=decade*TAU;footTargets[i]=blend(pedals[i],v(HEAD.x-.58*Math.cos(a),.69,-.58*Math.sin(a)+(i===0?.10:-.10)),smooth(Math.min(p/.13,(1-p)/.15)));}}
  // Bikeflip: knees tucked up while the bike turns over underneath, the left hand off.
  if(bikeflip){const p=phase('bikeflip');for(let i=0;i<2;i++){footContact[i]=p===0;footTargets[i]=blend(pedals[i],legRoot(i).add(v(.24,-.32,i===0?.16:-.12)),flipW);if(i===1){const release=smooth(Math.min((p-.035)/.13,(.96-p)/.16));if(release>0){handContact[i]=null;handTargets[i]=grips[i].clone().lerp(shoulderAt(1).add(v(.12,-.06,-.14)),release);}}}}
  // Front bikeflip and pendulum: feet tucked up out of the way while the bike moves under them.
  if(fbike){const p=phase('frontbikeflip');for(let i=0;i<2;i++){footContact[i]=p===0;footTargets[i]=blend(pedals[i],legRoot(i).add(v(.22,-.30,i===0?.17:-.17)),flipF);}}
  if(pend){for(let i=0;i<2;i++){footContact[i]=pendLift<.00001;footTargets[i]=blend(pedals[i],legRoot(i).add(v(.24,-.33,i===0?.17:-.17)),pendLift);}}
  // Cannonball: both feet off, knees pulled up to the chest.
  if(cannon){for(let i=0;i<2;i++){footContact[i]=cannon<.03;footTargets[i]=blend(pedals[i],legRoot(i).add(v(.30,-.10,i===0?.15:-.15)),cannon);}}
  // Indy: the right hand off the grip to the seat, the bike pulled up sideways.
  if(indy){handContact[0]=indy>.8?'seat':indy<.03?'grip':null;handTargets[0]=blend(grips[0],seat,Math.min(1,indy*1.3));}
  // One-foot X-up: the bars crossed (above) and the right foot kicked out to the side.
  if(oneXup){footContact[0]=oneXup<.03;footTargets[0]=blend(pedals[0],legRoot(0).add(v(.20,-.30,.48)),oneXup);}
  // Can-can tyre grab: the leg over the frame (can-can, above) and the left hand down on the
  // front tyre. Nac-nac: the left leg kicked back over the rear of the bike to the right.
  if(ccTyre){handContact[1]=ccTyre<.03?'grip':null;handTargets[1]=blend(grips[1],this.point(this.front,v(.60-HEAD.x,.50-HEAD.y,-.06)),ccTyre);}
  if(nac){footContact[1]=nac<.03;footTargets[1]=blend(pedals[1],legRoot(1).add(v(-.40,-.14,.52)),nac);}
  // Keep the torso rigid. Translate it to satisfy reachable contacts; never stretch limb lengths.
  for(let n=0;n<16;n++){
    for(let i=0;i<2;i++){const sign=i===0?1:-1;const shoulder=hip.clone().addScaledVector(spine,.84).addScaledVector(lateral,sign*.185);const d=handTargets[i].clone().sub(shoulder),len=d.length();if(len>.588)hip.addScaledVector(d,(len-.588)/len*.8);
      const start=hip.clone().addScaledVector(lateral,sign*.10),f=footTargets[i].clone().sub(start),fl=f.length();if((footContact[i]||footBar[i])&&fl>.848)hip.addScaledVector(f,(fl-.848)/fl*.8);}
  }
  const chest=hip.clone().add(spine);
  // The head, neck and chain ride on the torso: they were placed for the neutral forward
  // lean, so everything the spine has been tipped or twisted by (torsoQ) carries them too —
  // a superman looks along its stretched body, an invert hangs the head below the chest —
  // instead of leaving the head standing upright in bike space on a laid-out body.
  const head=chest.clone().add(v(.060,.162,0).applyQuaternion(torsoQ));this.align(this.torso,hip,chest,.47);this.torso.rotateY(bodyYaw);this.pelvis.position.copy(hip);this.pelvis.rotation.y=bodyYaw;this.neck.position.copy(chest).add(v(.020,.030,0).applyQuaternion(torsoQ));this.neck.quaternion.copy(torsoQ).multiply(new T.Quaternion().setFromAxisAngle(v(0,0,1),-.40));this.collar.position.copy(chest).addScaledVector(spine,.012);this.collar.quaternion.copy(this.torso.quaternion);this.necklace.position.copy(chest).add(v(.018,.022,0).applyQuaternion(torsoQ));this.necklace.quaternion.copy(torsoQ);this.head.position.copy(head);
  // Where the eyes go: down at the bars through a barspin, at the frame through a whip, at
  // the landing on the way back into a transition; chin up on a superman or suicide so the
  // face isn't buried by the lean of the body.
  const gaze=s.freeRoam&&air?Math.max(-.22,Math.min(.34,-airPitch*.40)):0;
  this.head.quaternion.setFromEuler(new T.Euler(0,turn*-.30+(s.freeRoam&&air?(s.turnLook||0)*.75:0),-.12+superman*.50-suicide*.22-tuck*.12-invert*.30-flipW*.30-flip*.26-Math.max(barLift,whipLift)*.26+gaze)).premultiply(torsoQ);
  this.contacts=[];this.bones=[];
  for(let i=0;i<2;i++){
    const sign=i===0?1:-1,shoulder=chest.clone().addScaledVector(spine,-.16).addScaledVector(lateral,sign*.185),ar=limbJoint(shoulder,handTargets[i],.30,.29,v(-.8,.15,sign*.5).applyQuaternion(bodyQ)),a=this.arms[i];
    this.align(a.upper,shoulder,ar.joint,.30);this.align(a.fore,ar.joint,ar.end,.29);this.align(a.sleeve,shoulder,shoulder.clone().lerp(ar.joint,.78),.25);a.elbow.position.copy(ar.joint);a.shoulderCap.position.copy(shoulder);this.hands[i].position.copy(ar.end);
    const upper=hip.clone().addScaledVector(lateral,sign*.10),leg=limbJoint(upper,footTargets[i],.43,.43,v(.9,.25,sign*.3).applyQuaternion(bodyQ)),l=this.legs[i];this.align(l.thigh,upper,leg.joint,.43);this.align(l.shin,leg.joint,leg.end,.43);l.knee.position.copy(leg.joint);this.feet[i].position.copy(leg.end);
    const q=new T.Quaternion();this.pedals[i].getWorldQuaternion(q);q.premultiply(this.root.getWorldQuaternion(new T.Quaternion()).invert());this.feet[i].quaternion.copy(footBar[i]?this.front.quaternion.clone().premultiply(this.bike.quaternion):footContact[i]?q:new T.Quaternion());if(handContact[i]==='grip')this.hands[i].quaternion.copy(this.front.quaternion).premultiply(this.bike.quaternion);else if(handContact[i]==='seat')this.hands[i].quaternion.copy(this.frame.quaternion).premultiply(this.bike.quaternion);else {const gripQ=this.front.quaternion.clone().premultiply(this.bike.quaternion),freeQ=new T.Quaternion().setFromUnitVectors(v(1,0,0),ar.end.clone().sub(ar.joint).normalize());this.hands[i].quaternion.copy(gripQ).slerp(freeQ,smooth(ar.end.distanceTo(grips[i])/.15));}
    const openHand=!!s.freeRoam&&!handContact[i];this.hands[i].userData.open.visible=openHand;for(const mesh of this.hands[i].userData.closed)mesh.visible=!openHand;
    if(s.freeRoam&&!footContact[i]&&!footBar[i]){const pointed=new T.Quaternion().setFromUnitVectors(v(1,0,0),leg.end.clone().sub(leg.joint).normalize());this.feet[i].quaternion.slerp(pointed,smooth(leg.end.distanceTo(pedals[i])/.40));}
    if(handContact[i])this.contacts.push({name:(i?'left':'right')+' '+handContact[i],error:ar.end.distanceTo(handContact[i]==='seat'?seat:grips[i])});
    if(footBar[i])this.contacts.push({name:(i?'left':'right')+' bar hook',error:leg.end.distanceTo(grips[i].clone().add(v(-.05,-.045,0)))});
    if(footContact[i])this.contacts.push({name:(i?'left':'right')+' pedal',error:leg.end.distanceTo(pedals[i])});
    this.bones.push({upperArm:shoulder.distanceTo(ar.joint),forearm:ar.joint.distanceTo(ar.end),thigh:upper.distanceTo(leg.joint),shin:leg.joint.distanceTo(leg.end)});
  }
  this.debug={contacts:this.contacts,bones:this.bones,hip:hip.toArray(),grips:grips.map(p=>p.toArray()),pedals:pedals.map(p=>p.toArray()),handContact,footContact};
 }
}
