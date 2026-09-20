import {sampleSegment,transitionRun} from './track.js';
import {CONTEST_PARKS} from './parks-data.js';
import {heightAt as trailHeight,contactHeightAt as trailContact,crossedCrest as trailCrest,where as trailWhere,guideAt as trailGuide,confineAt as trailConfine,nextJumpAt as trailNextJump,elevationAt as trailElevation,TRAIL_START,EDGE as TRAIL_EDGE,TRAIL_LENGTH,JUMPS as TRAIL_JUMPS,FINISH_S as TRAIL_FINISH,EXTENT as TRAIL_EXTENT} from './trail.js';
const TAU=Math.PI*2;
// Two riding environments share the same height-field engine: a big NYC-style street
// plaza, and a compact vert bowl for linking airs. Every existing call site that omits
// the trailing `env` argument keeps addressing the street park exactly as before, so
// this stays fully backward compatible with code and tests written against one park.
// JKCREW Yard, laid out like a real skatepark plan rather than ramps dropped on a plaza:
// a 92 × 64 m pad inside its perimeter quarters and banks, every zone a line you ride end
// to end and back, with the gaps between features kept to a few bike lengths.
//  • THE LINE (z 2..10, west wall to x 22): drop in off the west quarter, spine, box
//    jump, spine, box jump, then a 2.4 m quarter with coping at the far end to turn round.
//  • HALF PIPE (north-west): a 2.7 m half-pipe, 12 m wide, coping on both lips, a
//    roll-on bank onto each deck.  • MINI RAMP (south-west): the 2 m mini, 8 m wide.
//  • THE BOWL (north-middle): the sunken pool.  • STREET (east, x 36): eight-stair with
//    handrail and hubba, kink rail, manual pad, ledge rail and a bank to a deck with a
//    flatbar — a straight line of street spots hit one after another.
//  • THE HIP (south-east): two banks at 90° sharing a corner, to transfer over.
//  • The middle keeps the long tabletop, practice rail, pyramid, flatbar, A-frame, a
//    ledge and two stair sets, so the plaza still has things to hop between the zones.
// Everything runs along x or z (no odd angles) so the lines read at a glance.
//
// Ramp shapes are real ramp shapes: every quarter, mini, half-pipe wall and spine face is a
// circular transition ('arc' segments, see track.js) carried to 75–78° at the coping, the
// way a builder cuts a ramp template, and a box jump's take-off is a shallower radius to
// 48° so it throws you up and over the deck onto the landing rather than straight up.
const arcUp=(u0,h,run)=>[u0,0,0,u0+run,h,0,'arc'],arcDown=(u0,h,run)=>[u0,h,0,u0+run,0,0,'arc'];
// A spine: two transitions back to back sharing a ridge, coping along the ridge (from
// `spine`, see lipRails), no `lips` so the ridge is transferred over, not aired off.
const spine=(name,x,z,yaw,width,h,degrees,surface)=>{const run=transitionRun(h,degrees);return {name,x,z,yaw,width,shoulder:.45,surface,spine:true,segments:[arcUp(0,h,run),arcDown(run,h,run)]};};
// A box jump: radius take-off to 48°, flat deck, a straight landing that flattens out.
const boxJump=(name,x,z,yaw,width,h,deck,land,surface)=>{const run=transitionRun(h,48);return {name,x,z,yaw,width,shoulder:.45,surface,box:true,segments:[arcUp(0,h,run),[run,h,0,run+deck,h,0],[run+deck,h,-h/land*1.5,run+deck+land,0,0]]};};
// A mini ramp / half-pipe: bank onto the deck, deck, transition down, flat, transition up,
// deck, bank off — with the coping (lips) at the fixed deck edges either side of the flat.
const halfPipe=(name,x,z,yaw,width,h,degrees,bank,deck,flat,surface,copingName)=>{const run=transitionRun(h,degrees),lipA=bank+deck,lipB=lipA+run+flat+run,end=lipB+deck+bank,bs=h/bank;return {name,x,z,yaw,width,shoulder:.45,surface,coping:true,copingName,segments:[[0,0,bs,bank,h,bs],[bank,h,0,lipA,h,0],arcDown(lipA,h,run),[lipA+run,0,0,lipA+run+flat,0,0],arcUp(lipA+run+flat,h,run),[lipB,h,0,lipB+deck,h,0],[lipB+deck,h,-bs,end,0,-bs]],lips:[lipA,lipB]};};
const STREET_FEATURES=[
 // THE LINE — west to east along z 6, 8 m wide: spine, box, spine, box, quarter.
 spine('Line spine A',-40,6,0,8,1.6,74,'skatelite'),
 boxJump('Box jump',-28,6,0,8,1.8,3.0,5.5,'wood'),
 spine('Line spine B',-8,6,0,8,2.0,75,'skatelite'),
 boxJump('Big box',4,6,0,8,2.0,3.2,6.0,'wood'),
 {name:'Line quarter',x:20,z:6,yaw:0,width:8,shoulder:.45,surface:'skatelite',closed:true,coping:true,copingName:'Line quarter coping',segments:[arcUp(0,2.4,transitionRun(2.4,76)),[transitionRun(2.4,76),2.4,0,transitionRun(2.4,76)+3,2.4,0]],lips:[transitionRun(2.4,76)]},
 // A big spine on its own in the south-east plaza, wide enough to hit at any angle.
 spine('Big spine',26,-8,Math.PI/2,10,2.4,76,'skatelite'),
 // HALF PIPE — 2.7 m walls, 12 m wide, running east–west in the north-west corner.
 halfPipe('Half pipe',-44,22,0,12,2.7,78,3,2.5,14-2*transitionRun(2.7,78),'skatelite','Half pipe coping'),
 // MINI RAMP — deck, quarter down, the flat, quarter up, deck, with a gentle bank off the
 // back of each deck so you can roll on and off it from the plaza. Both lips carry coping
 // rails (generated from `lips`) and count as `lips` for the wall-air launch bonus.
 halfPipe('Mini ramp',-38,-24,0,8,2.0,75,2.4,2.2,12.4-2*transitionRun(2.0,75),'wood','Mini coping'),
 // The middle of the plaza.
 {name:'Long tabletop',x:-15,z:-10,yaw:0,width:8,shoulder:.5,surface:'concrete',segments:[[0,0,0,6,1.9,.70],[6,1.9,0,8.4,1.9,0],[8.4,1.9,-.45,16,0,0]]},
 {name:'School ledge',x:-14,z:14,yaw:0,width:3.2,shoulder:.3,surface:'concrete',segments:[[0,0,0,.7,.32,0],[.7,.32,0,9,.32,0],[9,.32,0,9.7,0,0]]},
 // West stairs run east–west along the west side: six steps with a rail.
 {name:'West stairs',x:-44,z:-8,yaw:0,width:5,shoulder:.45,surface:'concrete',segments:[[0,0,0,3,1.2,.45],[3,1.2,0,7,1.2,0],[7,1.2,-.45,12,0,0]],stairs:{segment:2,steps:6}},
 // Stair set south of the tabletop: a bank up onto a landing, then the steps down with a
 // handrail (`stairs` tells the scene which segment to dress with real treads).
 {name:'Stair set',x:-14,z:-21,yaw:0,width:5,shoulder:.45,surface:'concrete',segments:[[0,0,0,3,1.05,.42],[3,1.05,0,9,1.05,0],[9,1.05,-.42,14,0,0]],stairs:{segment:2,steps:7}},
 // STREET — a north–south line at x 36: eight-stair, hubba, kink rail, manual pad, ledge, bank.
 {name:'Eight stair',x:36,z:-30,yaw:Math.PI/2,width:4.5,shoulder:.45,surface:'concrete',segments:[[0,0,0,3,1.4,.5],[3,1.4,0,7,1.4,0],[7,1.4,-.45,12.5,0,0]],stairs:{segment:2,steps:8}},
 {name:'Hubba ledge',x:31.9,z:-23,yaw:Math.PI/2,width:2.4,shoulder:.3,surface:'concrete',segments:[[0,0,0,.6,.42,0],[.6,.42,0,7,.42,0],[7,.42,0,7.6,0,0]]},
 {name:'Manual pad',x:36,z:0,yaw:Math.PI/2,width:3.2,shoulder:.3,surface:'concrete',segments:[[0,0,0,.8,.28,0],[.8,.28,0,9,.28,0],[9,.28,0,9.8,0,0]]},
 {name:'Street ledge',x:36,z:12,yaw:Math.PI/2,width:3.2,shoulder:.3,surface:'concrete',segments:[[0,0,0,.7,.32,0],[.7,.32,0,8,.32,0],[8,.32,0,8.7,0,0]]},
 {name:'Loading dock bank',x:36,z:21,yaw:Math.PI/2,width:5,shoulder:.45,surface:'concrete',closed:true,segments:[[0,0,0,5,1.6,.35],[5,1.6,0,9,1.6,0]]},
 // THE HIP — two 1.7 m banks at 90° to each other sharing a corner at (20.2, -23.8): ride up
 // one face, turn in the air and come down the other.
 {name:'Hip (left)',x:17,z:-27,yaw:Math.PI/4,width:7,shoulder:.45,surface:'concrete',closed:true,segments:[[0,0,0,4.5,1.7,.7],[4.5,1.7,0,6.5,1.7,0]]},
 {name:'Hip (right)',x:23.4,z:-27,yaw:Math.PI*3/4,width:7,shoulder:.45,surface:'concrete',closed:true,segments:[[0,0,0,4.5,1.7,.7],[4.5,1.7,0,6.5,1.7,0]]}
];
// A four-sided pyramid in the south-middle of the plaza: hips on every corner, hit from any side.
const STREET_PYRAMIDS=[{name:'Pyramid',x:12,z:-12,yaw:0,a:5,b:5,h:1.6,flat:.3,surface:'concrete'}];
const STREET_RAILS=[
 {id:'school',name:'Practice rail',a:{x:-24,z:-3,y:.46},b:{x:-14,z:-3,y:.46},radius:.035},
 {id:'ledge',name:'School ledge rail',a:{x:-13.3,z:14,y:.34},b:{x:-5,z:14,y:.34},radius:.035},
 {id:'centre',name:'Centre flatbar',a:{x:6,z:-2,y:.50},b:{x:12,z:-2,y:.50},radius:.035},
 {id:'aframe-a',name:'A-frame rail',a:{x:2,z:-20,y:.32},b:{x:6,z:-20,y:.78},radius:.035},
 {id:'aframe-b',name:'A-frame rail',a:{x:6,z:-20,y:.78},b:{x:12,z:-20,y:.78},radius:.035},
 {id:'aframe-c',name:'A-frame rail',a:{x:12,z:-20,y:.78},b:{x:16,z:-20,y:.32},radius:.035},
 {id:'north',name:'North curb rail',a:{x:-10,z:44,y:1.74},b:{x:10,z:44,y:1.74},radius:.035},
 {id:'south',name:'South curb rail',a:{x:-10,z:-44,y:1.74},b:{x:10,z:-44,y:1.74},radius:.035},
 // Runs along the descending half of the Stair set, right where the steps would be —
 // offset 1.2 m to one side of the run so you can ride down the middle or hop onto it.
 {id:'stairs',name:'Stair rail',a:{x:-5,z:-19.8,y:1.08},b:{x:0,z:-19.8,y:.08},radius:.035},
 {id:'weststairs',name:'West stair rail',a:{x:-37,z:-6.3,y:1.23},b:{x:-32,z:-6.3,y:.03},radius:.035},
 // Coping on the mini ramp, the half pipe, the line quarter and both spine ridges is
 // generated from the features themselves (lipRails), so it always sits on the lip.
 // STREET: handrail down the eight-stair, the hubba's edge, the kink rail, the ledge and the dock flatbar.
 {id:'eight',name:'Eight-stair rail',a:{x:37.3,z:-23,y:1.43},b:{x:37.3,z:-17.5,y:.03},radius:.035},
 {id:'hubba',name:'Hubba rail',a:{x:31.9,z:-22.4,y:.45},b:{x:31.9,z:-16.5,y:.45},radius:.035},
 {id:'kink-a',name:'Kink rail',a:{x:36,z:-12,y:.50},b:{x:36,z:-5,y:.50},radius:.035},
 {id:'kink-b',name:'Kink rail',a:{x:36,z:-5,y:.50},b:{x:36,z:-2,y:.18},radius:.035},
 {id:'street-ledge',name:'Street ledge rail',a:{x:36,z:12.6,y:.34},b:{x:36,z:20,y:.34},radius:.035},
 {id:'dock',name:'Loading dock rail',a:{x:36,z:26.5,y:2.1},b:{x:36,z:29.5,y:2.1},radius:.035}
];
// One big open-world bowl: a wide flat pit ringed by a continuous coping wall, the same
// raised-quarter-pipe math used everywhere else, just swept around a circle instead of a
// straight line. Placed in the open north field, clear of every other feature.
const STREET_BOWLS=[{cx:8,cz:24,flatRadius:4.0,radius:2.4}];
// The big bowl is sunk into the plaza like a real skatepark pool: the flat bottom sits a
// transition's height below grade and the wall curves up to a coping ring flush with the
// plaza, so you roll up to the edge and drop in — not an above-ground tank with a deck and
// a fence around it. hard (render-only) drops the coarse grid slightly *under* the true
// dish so the smooth radial pool mesh drawn on top always wins.
export function bowlDepth(b){return quarter(b.radius*.97,b.radius);}
function bowlHeight(x,z,b,hard=false){const d=Math.hypot(x-b.cx,z-b.cz)-b.flatRadius,rim=b.radius*.97;
 if(d>=rim)return 0;const h=(d<=0?0:quarter(d,b.radius))-bowlDepth(b);return hard?h-.22:h;
}
export function nearBowl(env,x,z){for(const b of env.bowls||[]){const d=Math.hypot(x-b.cx,z-b.cz);if(d>b.flatRadius-1&&d<b.flatRadius+b.radius*.97+.6)return true;}return false;}
// Built features have vertical side panels. If a bike is in the narrow physics shoulder
// of a tall one and moving *into* it faster than a nudge, that's a side-wall hit — the
// caller crashes it instead of letting it climb an invisible slope up the panel.
export function sideWall(env,x,z,vx,vz){for(const f of env.features){if(!f.surface)continue;const c=Math.cos(f.yaw),s=Math.sin(f.yaw),u=(x-f.x)*c+(z-f.z)*s,w=-(x-f.x)*s+(z-f.z)*c,sh=f.shoulder||1;if(u<f.segments[0][0]||u>f.segments.at(-1)[3])continue;const aw=Math.abs(w);if(aw<f.width/2||aw>f.width/2+sh)continue;const seg=f.segments.find(a=>u>=a[0]&&u<=a[3]);if(!seg)continue;const h=sampleSegment(seg,u).height;if(h<.5)continue;const into=-(vx*-s+vz*c)*Math.sign(w);if(into>2.0)return {feature:f,height:h};}return null;}
// Curved quarter-pipes (contest-park corners and pockets): a straight quarter profile
// swept around a sector of a circle. `inner` is the flat radius the transition starts
// from, so the profile's u is distance-from-centre minus inner; the sector is [a0, a1]
// going anticlockwise (a1 > a0). The hard (render-only) cut hides the coarse grid behind
// the back panel, exactly as for straight closed ramps.
export function arcHeight(x,z,a,hard=false){const dx=x-a.cx,dz=z-a.cz;let rel=Math.atan2(dz,dx)-a.a0;rel-=Math.floor(rel/TAU)*TAU;if(rel>a.a1-a.a0)return 0;const d=Math.hypot(dx,dz)-a.inner,u1=a.segments.at(-1)[3];if(d<=0||d>=u1||(hard&&d>u1-.5))return 0;const seg=a.segments.find(s=>d>=s[0]&&d<=s[3]);const h=seg?sampleSegment(seg,d).height:0;
 // Render-only: the coarse floor grid sits a quarter metre under the drawn face, so its
 // straight chords across the concave transition never poke through (the face carries a
 // flat apron just outside the base to hide the resulting step).
 return hard?Math.max(0,h-.30):h;}
export function arcContains(a,x,z){const dx=x-a.cx,dz=z-a.cz;let rel=Math.atan2(dz,dx)-a.a0;rel-=Math.floor(rel/TAU)*TAU;return rel<=a.a1-a.a0&&Math.hypot(dx,dz)-a.inner<a.segments.at(-1)[3];}
// Four-sided jump box: a flat top with a straight bank down every side, hips where the
// banks meet (Chebyshev distance from the centre, so the footprint is a rectangle).
export function pyramidHeight(f,x,z){const c=Math.cos(f.yaw),s=Math.sin(f.yaw),u=(x-f.x)*c+(z-f.z)*s,w=-(x-f.x)*s+(z-f.z)*c,d=Math.max(Math.abs(u)/f.a,Math.abs(w)/f.b);if(d>=1)return 0;const flat=f.flat||.35;return d<=flat?f.h:f.h*(1-d)/(1-flat);}
// Any feature that declares `lips` (quarter-pipe and mini-ramp crests) counts as a wall
// for the coping-air launch bonus, the same way the perimeter walls and the bowl do —
// and so does the rim of every curved quarter.
export function nearLip(env,x,z){for(const f of env.features){if(!f.lips)continue;const c=Math.cos(f.yaw),s=Math.sin(f.yaw),u=(x-f.x)*c+(z-f.z)*s,w=-(x-f.x)*s+(z-f.z)*c;if(Math.abs(w)>f.width/2+.5)continue;for(const lip of f.lips)if(Math.abs(u-lip)<1.3)return true;}
 for(const a of env.arcs||[]){if(!arcContains(a,x,z))continue;const d=Math.hypot(x-a.cx,z-a.cz)-a.inner;for(const lip of a.lips||[])if(Math.abs(d-lip)<1.3)return true;}return false;}
// Coping along an arc's rim as a chain of short straight rails (one per ~10°), so the
// straight-line grind and peg-catch code works around the curve unmodified.
function arcRails(a,prefix){const lip=a.lips?.[0];if(lip==null)return [];const seg=a.segments.find(s=>lip>=s[0]&&lip<=s[3])||a.segments.at(-1),top=sampleSegment(seg,Math.min(lip,seg[3])).height,rim=a.inner+lip-.03,n=Math.max(3,Math.ceil((a.a1-a.a0)/(Math.PI/10))),list=[];
 for(let i=0;i<n;i++){const t0=a.a0+(a.a1-a.a0)*i/n,t1=a.a0+(a.a1-a.a0)*(i+1)/n;list.push({id:prefix+i,name:a.name+' coping',a:{x:a.cx+Math.cos(t0)*rim,z:a.cz+Math.sin(t0)*rim,y:top+.03},b:{x:a.cx+Math.cos(t1)*rim,z:a.cz+Math.sin(t1)*rim,y:top+.03},radius:.035});}return list;}
// Coping along every straight quarter lip that declares one, and along every spine's
// ridge, as a rail across the ramp's width at the lip.
function lipRails(f,prefix){const lips=f.lips&&f.coping?f.lips:f.spine?[f.segments[0][3]]:null;if(!lips)return [];const c=Math.cos(f.yaw),s=Math.sin(f.yaw),list=[];lips.forEach((lip,i)=>{const seg=f.segments.find(a=>lip>=a[0]&&lip<=a[3])||f.segments.at(-1),top=sampleSegment(seg,Math.min(lip,seg[3])).height,u=f.spine?lip:lip-.03,W=f.width/2;list.push({id:prefix+i,name:f.copingName||f.name+' coping',a:{x:f.x+c*u+s*W,z:f.z+s*u-c*W,y:top+.03},b:{x:f.x+c*u-s*W,z:f.z+s*u+c*W,y:top+.03},radius:.035});});return list;}
// The spine whose ridge is within reach of (x, z), for the transfer over it, and how far
// into the ridge zone the point is (0 at 1.2 m out, 1 within 0.6 m of the coping).
export function nearSpine(env,x,z){for(const f of env.features){if(!f.spine)continue;const c=Math.cos(f.yaw),s=Math.sin(f.yaw),u=(x-f.x)*c+(z-f.z)*s,w=-(x-f.x)*s+(z-f.z)*c,d=Math.abs(u-f.segments[0][3]);if(Math.abs(w)<=f.width/2+.5&&d<1.2)return {feature:f,blend:smooth((1.2-d)/.6),toRidge:f.segments[0][3]-u,along:c,across:s};}return null;}
// True while a bike moving (dx, dz) is in a spine's ridge zone with the coping still ahead
// of it: it stays on the face until it actually crests, instead of leaving early.
export function ridgeAhead(env,x,z,dx,dz){const r=nearSpine(env,x,z);if(!r)return false;const du=dx*r.along+dz*r.across;return r.toRidge*Math.sign(du||1)>.03;}
// Approximate the circular coping with a ring of short straight rail segments so the
// existing straight-line grind/peg-catch code works around the whole bowl unmodified.
function bowlRails(b,prefix,n=20){const rim=b.flatRadius+b.radius*.97-.03,list=[];for(let i=0;i<n;i++){const a1=i/n*Math.PI*2,a2=(i+1)/n*Math.PI*2;list.push({id:prefix+i,name:'Bowl coping',a:{x:b.cx+Math.cos(a1)*rim,z:b.cz+Math.sin(a1)*rim,y:.03},b:{x:b.cx+Math.cos(a2)*rim,z:b.cz+Math.sin(a2)*rim,y:.03},radius:.04});}return list;}
// A compact vert bowl: two facing quarter-pipe walls separated by a short flat channel,
// with coping rails along both lips. Airing wall-to-wall and linking those airs (or
// grinding the coping) is the whole point of this environment, so no street furniture.
// The Vert Bowl is a contest vert ramp: a 4.4 m radius transition carried to 84° (the
// height-field's practical vert), so the walls stand 3.96 m (13 ft) tall over a 4.9 m flat
// bottom, 18 m wide, with 3.6 m decks behind both copings and a roll-in tower on the
// right deck whose bank drops riders in from 3.2 m above the deck.
const HALFPIPE_RADIUS=4.4,HALFPIPE_CUT=.995,HALFPIPE_FLAT=2.45,HALFPIPE_TOP=HALFPIPE_RADIUS*(1-Math.sqrt(1-HALFPIPE_CUT*HALFPIPE_CUT)),HALFPIPE_LIP=HALFPIPE_FLAT+HALFPIPE_RADIUS*HALFPIPE_CUT-.045,HALFPIPE_DECK=3.6;
const HALFPIPE_FEATURES=[
 {name:'Roll-in tower',x:HALFPIPE_LIP+.9,z:5,yaw:0,width:4,shoulder:.3,surface:'skatelite',closed:true,segments:[[0,HALFPIPE_TOP,0,4.2,HALFPIPE_TOP+3.2,.55],[4.2,HALFPIPE_TOP+3.2,0,6.6,HALFPIPE_TOP+3.2,0]]}
];
const HALFPIPE_RAILS=[
 {id:'coping-left',name:'Left coping',a:{x:-HALFPIPE_LIP,z:-9,y:HALFPIPE_TOP+.03},b:{x:-HALFPIPE_LIP,z:9,y:HALFPIPE_TOP+.03},radius:.035},
 {id:'coping-right',name:'Right coping',a:{x:HALFPIPE_LIP,z:-9,y:HALFPIPE_TOP+.03},b:{x:HALFPIPE_LIP,z:9,y:HALFPIPE_TOP+.03},radius:.035}
];
export const HALFPIPE_SPEC=Object.freeze({radius:HALFPIPE_RADIUS,cut:HALFPIPE_CUT,flat:HALFPIPE_FLAT,top:HALFPIPE_TOP,lip:HALFPIPE_LIP,deck:HALFPIPE_DECK,width:9});
function finalizeRails(list){return list.map(r=>Object.freeze({...r,coping:/coping/i.test(r.name),length:Math.hypot(r.b.x-r.a.x,r.b.z-r.a.z),heading:Math.atan2(r.b.z-r.a.z,r.b.x-r.a.x)}));}
const withGroundTerrain=env=>{const ground=Object.freeze({...env,terrain:trailContact});return Object.freeze({...env,groundEnv:ground});};
export const ENVIRONMENTS=Object.freeze({
 street:Object.freeze({id:'park',name:'JKCREW Yard',label:'Free roam',description:'Spines & box jumps · half pipe · mini ramp · bowl · street line · hip',accent:'#16dfcf',number:0,end:144,jumps:0,start:{x:-27,z:-10,speed:0},pumpGrace:.25,bounds:{x:88,z:60},quarterStart:46,bankStart:32,radius:3.3,features:STREET_FEATURES,pyramids:STREET_PYRAMIDS,bowls:STREET_BOWLS,rails:finalizeRails([...STREET_RAILS,...STREET_FEATURES.flatMap((f,i)=>lipRails(f,'park-lip'+i+'-')),...STREET_BOWLS.flatMap((b,i)=>bowlRails(b,'bowl'+i+'-'))])}),
 // JKC Trail: the slopestyle in trail.js — a point-to-point downhill with a finish line. No
 // features or rails (the terrain function is the whole surface); `outside` is the line the
 // physics crashes past, `finish` and `progress` drive the run's end and the HUD bar.
 trail:withGroundTerrain({id:'trail',name:'JKC Trail',label:'Slopestyle',description:'12 gap jumps, roller to monster · '+Math.round(trailElevation(0)-trailElevation(TRAIL_FINISH))+' m of downhill · berms · start deck · finish line',accent:'#8fd15c',number:0,end:Math.round(TRAIL_FINISH),drop:Math.round(trailElevation(0)-trailElevation(TRAIL_FINISH)),jumps:TRAIL_JUMPS.length,lips:[TRAIL_JUMPS[0].H,TRAIL_JUMPS[TRAIL_JUMPS.length-1].H],start:TRAIL_START,pumpGrace:.25,bounds:{x:Math.max(Math.abs(TRAIL_EXTENT.minX),Math.abs(TRAIL_EXTENT.maxX))+60,z:Math.max(Math.abs(TRAIL_EXTENT.minZ),Math.abs(TRAIL_EXTENT.maxZ))+60},quarterStart:9999,bankStart:9999,radius:3.3,features:[],rails:finalizeRails([]),terrain:trailHeight,crest:trailCrest,outside:(x,z)=>Math.abs(trailWhere(x,z).d)>TRAIL_EDGE,finish:(x,z)=>trailWhere(x,z).s>=TRAIL_FINISH,progress:(x,z)=>trailWhere(x,z).s/TRAIL_FINISH,guide:trailGuide,confine:trailConfine,nextJump:(x,z)=>trailNextJump(trailWhere(x,z).s),trail:true,sky:{top:'#6c9fd2',bottom:'#e3ead6'},fog:'#b3c4a2',background:'#b3c4a2'}),
 halfpipe:Object.freeze({id:'halfpipe',name:'Vert Ramp',label:'Vert',description:'13 ft walls · coping · roll-in tower · link your airs',accent:'#ff8a3d',number:0,end:60,jumps:0,start:{x:0,z:0,speed:0},pumpGrace:.25,bounds:{x:HALFPIPE_LIP+HALFPIPE_DECK+4.2,z:10},quarterStart:HALFPIPE_FLAT,bankStart:9999,radius:HALFPIPE_RADIUS,wallCut:HALFPIPE_CUT,features:HALFPIPE_FEATURES,rails:finalizeRails(HALFPIPE_RAILS)})
});
// Contest parks from parks-data.js: same engine, no perimeter walls (quarterStart and
// bankStart pushed far outside the bounds), coping on every lip and arc rim, and a
// palette/sky the scene uses to dress them.
export const CONTEST_ENVIRONMENTS=Object.freeze(Object.fromEntries(CONTEST_PARKS.map(spec=>{const surface=spec.palette?.surface,features=spec.features.map(f=>({...f,surface:f.surface||surface,coping:!!f.lips})),arcs=(spec.arcs||[]).map(a=>({...a,surface:a.surface||surface})),pyramids=(spec.pyramids||[]).map(f=>({...f,surface:f.surface||surface}));return [spec.id,Object.freeze({...spec,number:0,end:120,jumps:0,pumpGrace:.25,quarterStart:9999,bankStart:9999,radius:3.3,features,arcs,pyramids,rails:finalizeRails([...spec.rails,...features.flatMap((f,i)=>lipRails(f,spec.id+'-lip'+i+'-')),...arcs.flatMap((a,i)=>arcRails(a,spec.id+'-arc'+i+'-'))])})];})));
export function resolveEnv(id){return ENVIRONMENTS[id]||CONTEST_ENVIRONMENTS[id]||ENVIRONMENTS.street;}
export function allEnvironments(){return {...ENVIRONMENTS,...CONTEST_ENVIRONMENTS};}
// Backward-compatible aliases: every call site (and every existing test) that doesn't
// pass an environment keeps addressing exactly the same street park as before.
export const PARK=ENVIRONMENTS.street;
export const PARK_BOUNDS=ENVIRONMENTS.street.bounds;
export const QUARTER_START=ENVIRONMENTS.street.quarterStart,BANK_START=ENVIRONMENTS.street.bankStart;
export const FEATURES=ENVIRONMENTS.street.features;
export const RAILS=ENVIRONMENTS.street.rails;
const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
// `shoulder` is how far a feature's sides slope out past its rideable width. Dirt-style
// tabletops and hips keep a soft metre; built structures (ramps, stairs, ledges) get a
// tight shoulder so they read as walls and edges rather than snowdrifts.
// `hard` (render-only) drops a built feature's shoulder to a near-vertical step, so the drawn
// plaza meets its side panels at a wall instead of sloping out; physics always uses the
// soft shoulder so contact stays continuous if a bike clips a ramp's side.
export function featureHeight(f,x,z,hard=false){const c=Math.cos(f.yaw),s=Math.sin(f.yaw),u=(x-f.x)*c+(z-f.z)*s,w=-(x-f.x)*s+(z-f.z)*c,sh=f.shoulder||1.0;const seg=f.segments.find(a=>u>=a[0]&&u<=a[3]);if(!seg)return 0;
 // Render-only hard edge: the drawn plaza drops to grade 0.75 m *inside* the side panel, so
 // the 0.5 m grid's transition triangles all stay hidden behind the panel and the face.
 if(hard&&f.closed&&u>f.segments.at(-1)[3]-.5)return 0;
 // Render-only: under a built face the coarse plaza grid sits 0.3 m below the true surface,
 // so its straight chords across a concave transition can never poke up through the face
 // (they did at the lip of every steep quarter and read as a grey band across the wall).
 if(hard&&f.surface)return Math.abs(w)>f.width/2-.75?0:Math.max(0,sampleSegment(seg,u).height-.30);
 if(Math.abs(w)>f.width/2+sh)return 0;const side=1-smooth((Math.abs(w)-f.width/2)/sh);return sampleSegment(seg,u).height*side;}
function quarter(d,r=3.3,cut=.97){if(d<=0)return 0;if(d>=r*cut)return r-Math.sqrt(r*r-(r*cut)**2);return r-Math.sqrt(r*r-d*d);}
export function parkHeight(x,z,env=ENVIRONMENTS.street,hard=false){
 // A terrain environment (the trail) is its own surface, hillside and all — it can sit below
 // zero, so it is the base every feature stands on rather than one more thing to max with.
 if(env.terrain){let t=env.terrain(x,z);for(const f of env.features)t=Math.max(t,featureHeight(f,x,z,hard));return t;}
 let h=0;for(const f of env.features)h=Math.max(h,featureHeight(f,x,z,hard));
 for(const a of env.arcs||[])h=Math.max(h,arcHeight(x,z,a,hard));for(const f of env.pyramids||[])h=Math.max(h,pyramidHeight(f,x,z));
 for(const b of env.bowls||[]){const bh=bowlHeight(x,z,b,hard);if(bh<0)return bh;}
 // Two broad opposing quarter-pipes/walls and (on the street) softer perimeter banks connect to a flat deck.
 const qx=quarter(Math.abs(x)-env.quarterStart,env.radius,env.wallCut||.97),qz=env.bankStart>500?0:1.7*smooth((Math.abs(z)-env.bankStart)/4.5);return Math.max(h,qx,qz);
}
export function parkAt(x,z,env=ENVIRONMENTS.street){const h=parkHeight(x,z,env),e=.04,dx=(parkHeight(x+e,z,env)-parkHeight(x-e,z,env))/(2*e),dz=(parkHeight(x,z+e,env)-parkHeight(x,z-e,env))/(2*e);
 const bowl=(env.bowls||[]).find(b=>Math.hypot(x-b.cx,z-b.cz)<b.flatRadius+b.radius*.97+.3);
 const name=env.features.find(f=>featureHeight(f,x,z)>.12)?.name
  ||(env.arcs||[]).find(a=>arcHeight(x,z,a)>.12)?.name||(env.pyramids||[]).find(f=>pyramidHeight(f,x,z)>.12)?.name
  ||(bowl?(bowlHeight(x,z,bowl)>-bowlDepth(bowl)+.12?(bowlHeight(x,z,bowl)>-.4?'Bowl coping':'Bowl wall'):'Bowl bottom'):null)
  ||(env.terrain?'Trail':(Math.abs(x)>env.quarterStart-1)?(env.id==='halfpipe'?'Transition wall':'Quarter-pipe'):(env.bankStart<500&&Math.abs(z)>env.bankStart)?'Bank':(env.id==='halfpipe'?'Flat bottom':env.palette?'Floor':'Open plaza'));
 return {height:h,dx,dz,solid:Math.abs(x)<=env.bounds.x&&Math.abs(z)<=env.bounds.z,name};}
function contactPose(x,z,heading,env){const c=Math.cos(heading),s=Math.sin(heading);let pitch=0,h=0;for(let i=0;i<2;i++){const projection=Math.cos(pitch),rear=parkHeight(x-.445*c*projection,z-.445*s*projection,env),front=parkHeight(x+.525*c*projection,z+.525*s*projection,env);pitch=Math.atan2(front-rear,.97*projection);h=(rear*.525+front*.445)/.97;}return {height:h,pitch};}
export function bikeContact(x,z,heading,env=ENVIRONMENTS.street){const p=contactPose(x,z,heading,env),q=parkAt(x,z,env),e=.06;
 // Over a spine's ridge the two wheels straddle two steep faces and their average would sink
 // the frame a metre into the coping, so there the bike rides the surface under its centre
 // instead (its pitch still from the wheels): it climbs the face right to the coping, crests
 // there and leaves from the ridge itself.
 const dx=(contactPose(x+e,z,heading,env).height-contactPose(x-e,z,heading,env).height)/(2*e),dz=(contactPose(x,z+e,heading,env).height-contactPose(x,z-e,heading,env).height)/(2*e),ridge=nearSpine(env,x,z);
 if(ridge){const k=ridge.blend;return {...q,pitch:p.pitch,height:p.height+(q.height-p.height)*k,dx:dx+(q.dx-dx)*k,dz:dz+(q.dz-dz)*k};}
 return {...q,...p,dx,dz};}

// Rail top coordinates are shared by mesh construction, swept catches and peg constraints.
export function railPoint(r,u){return {x:r.a.x+(r.b.x-r.a.x)*u,z:r.a.z+(r.b.z-r.a.z)*u,y:r.a.y+(r.b.y-r.a.y)*u};}
export function closestRailPoint(r,x,z){const u=((x-r.a.x)*(r.b.x-r.a.x)+(z-r.a.z)*(r.b.z-r.a.z))/(r.length*r.length),point=railPoint(r,Math.max(0,Math.min(1,u)));return {...point,u,distance:Math.hypot(x-point.x,z-point.z)};}
