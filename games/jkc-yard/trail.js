import {sampleSegment,transitionRun} from './track.js';
// JKC Trail — a Crankworx-style slopestyle: one line, top to bottom, down a hillside. You
// drop in off a start deck and the hill does the work; twelve dirt jumps grow from a
// knee-high roller-lip to three monster trick jumps near the bottom, every one a built lip
// (a real radius to 52°) over a step-down gap onto a long sloped landing, with berms in the
// bends between them and a flat run-out to the finish banner.
//
// Everything here is data plus a few functions the physics and the scenery both use:
// `heightAt(x, z)` is the terrain, `where(x, z)` the closest point on the line (arc length,
// signed lateral offset) — which is also how the game keeps the rider on the track — and
// `pointAt(s)` walks the line. The terrain is the hill's elevation along the line, plus the
// jump profile along it, plus a cross-section across it (a 6.4 m packed line, dirt walls
// off both edges that turn a wandering bike back, and the ground falling away beyond).
const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
// The course is built from the jumps outward: every jump sits on a straight (an approach,
// the lip, the gap, the landing, a run-off), and after every second jump the line swings
// through a 40° bend of 60 m radius — a berm — the opposite way to the last one, so the
// jumps are always hit square and the berms are where the speed gets carried round. It
// starts with a timber start deck and ends with a flat run-out to the finish line.
// [lip height, lip angle in degrees, gap lip→knuckle]. At the 15–16 m/s the hill delivers,
// a lip's angle sets the height of the air (a knee-high 24° roller gives less than a metre,
// the 58° monster nearly six) while the range saturates near 20 m, so the gaps grow from 7
// to 18.5 m. Every jump is a real double: a steep back off the lip, a pit at the hill's
// level, and the landing's own face climbing to the knuckle — come up short and you are in
// the pit or on the knuckle. Every landing is a long straight face — 8 m on the first
// roller, 15 m on the monsters — pitched to meet the flight (12° for the rollers, 32° for
// the monsters), so a slow or fast run still comes down on the landing.
const SPEC=[[.7,24,8],[.9,27,11],[1.2,30,13],[1.5,33,13.5],[1.8,37,14.5],[2.2,41,15],[2.6,45,15.5],[3.0,48,16.5],[3.4,51,17],[3.8,54,17],[4.3,56,17.5],[4.8,58,17.5]];
export const START_DECK={height:3.2,deck:7,ramp:5.5};
const APPROACH=14,RUNOFF=8,BEND_RADIUS=60,BEND_DEGREES=40;
const STEP=.5;
function buildLine(){
 const pts=[];let x=-300,z=0,heading=0,s=0,dir=1;const jumps=[];
 const walk=(len,curv)=>{const n=Math.max(1,Math.round(len/STEP)),step=len/n;for(let i=0;i<n;i++){pts.push({x,z,s,tx:Math.cos(heading),tz:Math.sin(heading),len:step,curv});x+=Math.cos(heading)*step;z+=Math.sin(heading)*step;heading+=curv*step;s+=step;}};
 walk(START_DECK.deck+START_DECK.ramp+22,0);
 // A landing is built from the knuckle down at its design angle: the dirt profile drops the
 // knuckle's height over the landing's length and the hill itself steepens underneath (a
 // landing hill) for the rest, so the face is straight at that angle from the knuckle to
 // where it rounds out into the run-off — and the step-down it makes is where the hill loses
 // most of its height, the way a slopestyle course does.
 SPEC.forEach(([H,deg,G],i)=>{const run=transitionRun(H,deg),drop=.22*H,K=H-drop,land=7+1.8*H,landDeg=Math.min(32,Math.max(12,deg-22)),m=K/land,hillGrade=Math.tan(landDeg*Math.PI/180)-m,approach=APPROACH+1.2*H,knuckle=s+approach+run+G;
  // The gap: the lip's back drops to the pit over 1.3× its height (a 45–50° face), the pit
  // floor is the hill itself, and the landing's front climbs to the knuckle over 0.9× its height.
  const back=Math.max(1.5,1.3*H),face=Math.max(1.4,.9*K);
  jumps.push({s:s+approach,H,deg,lip:run,gap:G,drop,K,land,m,landDeg,hillGrade,approach,knuckle,back,face,pit:[s+approach+run+back,knuckle-face],hillFrom:knuckle-3,hillTo:knuckle+land+6});walk(approach+run+G+land+RUNOFF+i*1.5,0);
  if(i%3===2&&i<SPEC.length-1){walk(BEND_RADIUS*BEND_DEGREES*Math.PI/180,dir/BEND_RADIUS);dir=-dir;}});
 const last=jumps.at(-1),flatFrom=last.hillTo;
 walk(48,0);pts.push({x,z,s,tx:Math.cos(heading),tz:Math.sin(heading),len:0,curv:0});
 // Grade down the hill: 10 % through the small jumps at the top, 12 % through the middle,
 // 11.5 % under the monster jumps, flattening out after the last landing for the finish. The
 // 14 m before every lip is a shelf (3.5 %) so the lip leaves at its design angle, and the
 // landing hills steepen in over the knuckle and ease out over the 6 m past the landing.
 const gradeAt=q=>{const f=q/flatFrom;let g=f<.2?.10:f<.6?.12:.115;for(const j of jumps){if(q>=j.hillFrom&&q<=j.hillTo){const t=q<j.hillFrom+6?(q-j.hillFrom)/6:q>j.hillTo-6?(j.hillTo-q)/6:1;g+=(j.hillGrade-g)*smooth(t);}if(q>=j.s-j.approach&&q<=j.s+j.lip){const t=q<j.s-j.approach+4?(q-(j.s-j.approach))/4:1;g-=(g-.05)*Math.max(0,Math.min(1,t));}}return q<flatFrom?g:g*Math.max(0,1-(q-flatFrom)/36);};
 const m=pts.length;let e=0;for(let i=0;i<m;i++){pts[i].e=e;e-=gradeAt(pts[i].s)*pts[i].len;}
 // Smooth the curvature over ±12 m so berms bank up and fade out gradually instead of switching on.
 const curv=pts.map(q=>q.curv),k=24;for(let i=0;i<m;i++){let sum=0,c=0;for(let j=-k;j<=k;j++){const idx=i+j;if(idx<0||idx>=m)continue;sum+=curv[idx];c++;}pts[i].curv=sum/c;}
 let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;for(const q of pts){minX=Math.min(minX,q.x);maxX=Math.max(maxX,q.x);minZ=Math.min(minZ,q.z);maxZ=Math.max(maxZ,q.z);}
 return {pts,length:s,jumps,flatFrom,extent:{minX,maxX,minZ,maxZ}};
}
const LINE=buildLine();
export const TRAIL_LENGTH=LINE.length;
// The hill's elevation along the line (the base every feature is built on).
export function elevationAt(s){s=Math.max(0,Math.min(TRAIL_LENGTH,s));const pts=LINE.pts;let lo=0,hi=pts.length-1;while(lo<hi){const mid=(lo+hi+1)>>1;if(pts[mid].s<=s)lo=mid;else hi=mid-1;}const p=pts[lo],q=pts[Math.min(pts.length-1,lo+1)],t=p.len?Math.min(1,(s-p.s)/p.len):0;return p.e+(q.e-p.e)*t;}
export const JUMPS=LINE.jumps;
export const EXTENT=LINE.extent;
export const FINISH_S=LINE.flatFrom+36;
export function profileAt(s){let h=0;
 // The start deck: a timber platform 3.2 m up, and the drop-in off its edge.
 if(s<START_DECK.deck)h=START_DECK.height;else if(s<START_DECK.deck+START_DECK.ramp)h=sampleSegment([START_DECK.deck,START_DECK.height,0,START_DECK.deck+START_DECK.ramp,0,-.15],s).height;
 // Lip (a circular arc to its angle), the lip's back (a rounded crest into a steep face down
 // to the pit), the pit (the hill), the knuckle face (a steep face up to a rounded knuckle),
 // landing (a straight face at the design pitch for four fifths of its length, rounding out
 // into the run-off over the last fifth).
 for(const j of JUMPS){const u=s-j.s;if(u<-.5||u>j.lip+j.gap+j.land+.5)continue;const k=j.lip+j.gap,straight=k+j.land*.8;
  if(u<=j.lip)h=Math.max(h,sampleSegment([0,0,0,j.lip,j.H,0,'arc'],u).height);
  else if(u<=j.lip+j.back)h=Math.max(h,sampleSegment([j.lip,j.H,0,j.lip+j.back,0,-.15],u).height);
  else if(u<k-j.face)h=Math.max(h,0);
  else if(u<=k)h=Math.max(h,sampleSegment([k-j.face,0,.15,k,j.K,0],u).height);
  else if(u<=straight)h=Math.max(h,sampleSegment([k,j.K,-j.m,straight,j.K*.2,-j.m],u).height);
  else h=Math.max(h,sampleSegment([straight,j.K*.2,-j.m,k+j.land,0,0],u).height);}
 return h;}
// Spatial hash of the samples for the closest-point search; a coarse scan backs it up for
// points well off the line (scenery), which the fast path never sees.
const CELL=6,GRID=new Map();
LINE.pts.forEach((q,i)=>{const key=Math.floor(q.x/CELL)+','+Math.floor(q.z/CELL);let list=GRID.get(key);if(!list){list=[];GRID.set(key,list);}list.push(i);});
export function where(x,z){
 const cx=Math.floor(x/CELL),cz=Math.floor(z/CELL);let best=-1,bestD=Infinity;
 // The nine cells round the point cover the line itself; a point out on the walls or beyond
 // widens the search to 25 cells (so the closest sample is never one just over a cell edge),
 // and the far scenery falls back to a coarse scan of the whole line.
 const scan=r=>{for(let i=-r;i<=r;i++)for(let j=-r;j<=r;j++){if(r>1&&Math.abs(i)<r&&Math.abs(j)<r)continue;const list=GRID.get((cx+i)+','+(cz+j));if(!list)continue;for(const k of list){const q=LINE.pts[k],d=(q.x-x)*(q.x-x)+(q.z-z)*(q.z-z);if(d<bestD){bestD=d;best=k;}}}};
 scan(1);if(bestD>36)scan(2);
 if(best<0||bestD>144){for(let k=0;k<LINE.pts.length;k+=8){const q=LINE.pts[k],d=(q.x-x)*(q.x-x)+(q.z-z)*(q.z-z);if(d<bestD){bestD=d;best=k;}}for(let k=Math.max(0,best-8);k<=Math.min(LINE.pts.length-1,best+8);k++){const q=LINE.pts[k],d=(q.x-x)*(q.x-x)+(q.z-z)*(q.z-z);if(d<bestD){bestD=d;best=k;}}}
 // Refine onto the two segments touching the closest sample.
 const m=LINE.pts.length;let out=null;
 for(const a of [Math.max(0,best-1),Math.min(m-2,best)]){const p=LINE.pts[a],dx=x-p.x,dz=z-p.z,t=Math.max(0,Math.min(1,(dx*p.tx+dz*p.tz)/p.len)),px=p.x+p.tx*t*p.len,pz=p.z+p.tz*t*p.len,dist=Math.hypot(x-px,z-pz);
  if(!out||dist<out.dist){const side=-(x-px)*p.tz+(z-pz)*p.tx;out={dist,s:p.s+t*p.len,d:side,tx:p.tx,tz:p.tz,curv:LINE.pts[best].curv};}}
 return {s:out.s,d:out.d,tx:out.tx,tz:out.tz,curv:out.curv,on:Math.abs(out.d)<=HALF_WIDTH};
}
export const HALF_WIDTH=3.6,EDGE=6.8;
// Cross-section: flat packed line, berm banking on the outside of every bend, dirt walls
// rising off both edges, and the hillside falling away beyond them.
// A berm is a bowl: on the outside of a bend the ground banks up from the centre of the line
// to the crest of the wall (2.6 m up, 6.4 m out) and falls away beyond it like the wall does,
// so a bike carving out onto it is always on a concave face and never on an edge to fly off.
export function sectionAt(d,curv){const a=Math.abs(d),beyond=a<=6.4?1:a<=9.5?1-smooth((a-6.4)/3.1):0;
 const wall=a<=HALF_WIDTH?0:2.2*Math.min(1,(a-HALF_WIDTH)/2.8)**2*beyond;
 const bermH=2.6*smooth(Math.abs(curv)/.010),outside=Math.max(0,-d*Math.sign(curv||1));
 const berm=bermH>0&&outside>0?bermH*(Math.min(6.4,outside)/6.4)**2.2*beyond:0;
 return Math.max(wall,berm);}
// The hill beyond the line: the line's own elevation, falling away at 10 % to either side of
// the mound with a gentle roll to it, so the line rides the crest of the hill.
// The line steers with you (a yaw rate for the physics to apply, and the only yaw on the
// trail): the bends' curvature feeds straight into the heading so the berms carry the bike
// round; the stick picks a heading across the line — up to 24° off it at full deflection —
// and the bike leans to it in about a third of a second, then eases back parallel when the
// stick is centred; and the walls do what dirt walls do — a bike that drifts off the packed
// line is turned back toward it, harder the further out it is.
export function guideAt(x,z,heading,speed=0,steer=0){const w=where(x,z),a=Math.abs(w.d),along=Math.atan2(w.tz,w.tx),want=along+Math.max(-1,Math.min(1,steer))*.42;let err=Math.atan2(Math.sin(want-heading),Math.cos(want-heading));if(Math.abs(err)>Math.PI/2)err-=Math.sign(err)*Math.PI;
 let rate=w.curv*speed+err*6;
 const out=a-HALF_WIDTH*.8;if(out>0){const toward=-Math.sign(w.d)*Math.min(1,out/2.5);rate+=toward*(1.6+1.2*smooth((a-5.2)/1.4));}
 return rate;}
// The walls are solid: a bike on the ground cannot get past 6 m out (3.1 m on the start deck
// and its drop-in, where the railing is), so the physics moves it back to the wall and turns
// it along the line — a bump off the dirt wall, with a bit of speed lost — instead of letting
// it ride up over the crest. Only a bike in the air can still leave the trail.
export function confineAt(x,z,heading){const w=where(x,z),a=Math.abs(w.d),limit=w.s<START_DECK.deck+START_DECK.ramp+.5?3.1:6.0;
 if(w.s<.3){const q=pointAt(.3),d=Math.max(-limit,Math.min(limit,w.d));return {x:q.x-q.tz*d,z:q.z+q.tx*d};}
 if(a<=limit)return null;const d=Math.sign(w.d)*limit,q=pointAt(w.s),along=Math.atan2(q.tz,q.tx),forward=Math.cos(heading-along)>=0;return {x:q.x-q.tz*d,z:q.z+q.tx*d,heading:forward?along:along+Math.PI};}
export function groundAt(x,z){const w=where(x,z),a=Math.abs(w.d),out=Math.max(0,a-9.5);return elevationAt(w.s)-out*.10-1.2*Math.sin(w.s*.05+a*.17)*Math.min(1,out/8);}
// The terrain: the hill, the jumps (built the full width of the line out to the crest of the
// walls, so their sides fall away only beyond the walls and never under a bike that has
// drifted wide), and the cross-section on top.
export function heightAt(x,z){const w=where(x,z),a=Math.abs(w.d);if(a>9.5)return groundAt(x,z);const base=elevationAt(w.s),fade=a<=6.4?1:1-smooth((a-6.4)/3.1);return base+profileAt(w.s)*fade+sectionAt(w.d,w.curv);}
// What the wheels ride: the same terrain, except that for the first metre past a lip's
// crest the take-off's tangent carries on in place of the steep back (the physics models the
// bike on its two wheels, and with a pit behind the lip the front wheel would drop off the
// crest while the rear was still climbing, launching the bike early, low and slow — a real
// bike leaves a lip when its rear wheel does). The renderer never sees this.
export function contactProfileAt(s){let h=profileAt(s);for(const j of JUMPS){const u=s-j.s-j.lip;if(u>0&&u<=2.5){const top=sampleSegment([0,0,0,j.lip,j.H,0,'arc'],j.lip);h=Math.max(h,j.H+top.slope*u);}}return h;}
// Did a move from (x0, z0) to (x1, z1) carry the bike forward over a lip's crest? The physics
// launches there, at the lip's full angle, instead of waiting for the wheels to find air.
export function crossedCrest(x0,z0,x1,z1){const w0=where(x0,z0),w1=where(x1,z1);if(Math.abs(w1.d)>6.4)return false;return JUMPS.some(j=>{const c=j.s+j.lip;return w0.s<c&&w1.s>=c;});}
export function contactHeightAt(x,z){const w=where(x,z),a=Math.abs(w.d);if(a>9.5)return groundAt(x,z);const base=elevationAt(w.s),fade=a<=6.4?1:1-smooth((a-6.4)/3.1);return base+contactProfileAt(w.s)*fade+sectionAt(w.d,w.curv);}
export function pointAt(s){s=Math.max(0,Math.min(TRAIL_LENGTH,s));const pts=LINE.pts;let lo=0,hi=pts.length-1;while(lo<hi){const mid=(lo+hi+1)>>1;if(pts[mid].s<=s)lo=mid;else hi=mid-1;}const p=pts[lo],t=p.len?Math.min(1,(s-p.s)/p.len):0;return {x:p.x+p.tx*t*p.len,z:p.z+p.tz*t*p.len,tx:p.tx,tz:p.tz,curv:p.curv,heading:Math.atan2(p.tz,p.tx),e:elevationAt(s)};}
export const TRAIL_START=(()=>{const q=pointAt(2.5);return {x:q.x,z:q.z,heading:q.heading,speed:0};})();
export const TRAIL_LINE=LINE.pts;
export const GRADE=0;
// The next lip ahead of a point on the line (for the HUD cue): its number, height and distance.
export function nextJumpAt(s){for(let i=0;i<JUMPS.length;i++){const j=JUMPS[i];if(s<j.s+j.lip)return {index:i+1,H:j.H,gap:j.gap,distance:j.s+j.lip-s};}return null;}
