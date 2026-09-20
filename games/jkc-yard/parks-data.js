import {transitionRun} from './track.js';
// Three contest parks rebuilt as replicas of the reference images Josh sent (September 2026):
//  • Urban Sessions — the green isometric render: a black contest stage with a quarter wall
//    the full length of the left end (taller extension on its back half) and a roll-in bank
//    in the front-left corner; a rounded corner into the back wall, which carries a taller
//    extension and ends in a spine sticking out into the park; a cross jump box centre-right;
//    the plexi-wall box out front; and the right end walled by three quarters that step up
//    in height toward the front (the vert wall). No rails — the render has none.
//  • Outbox — the drone photo, measured off it at 30 px/m: a plywood park on a 32 × 50 m
//    pad with a north quarter wall that wraps a rounded north-west corner into a diagonal
//    bank, a taller north-east extension, two step-up launch boxes off the wall's base, a
//    long cross box across the middle fed by a tall roll-in from the north, a west wing
//    crossing it, a raised east platform with its own quarter, and a south quarter wall with
//    a taller extension.
//  • Tokyo 2020 — the grey render of the Olympic course: pale-blue walls round the back and
//    both sides with rounded corners, a V-shaped pocket in the back wall, a spine off the
//    right wall, banks in both front corners, a jump box and hip on the left and the big
//    A-frame out front.
//
// Everything is plain data for the height-field engine in park.js: straight ramps are
// `features` (a profile of Hermite segments swept along a width), curved quarters are
// `arcs` (the same profile swept around a sector), boxes with four hips are `pyramids`, and
// every quarter lip and arc rim carries coping. Helpers keep the numbers readable: Q =
// quarter with deck, B = bank, X = jump box, S = spine, F = flat deck fill, A = arc quarter,
// P = pyramid, R = rail. Sizes are metres. Every quarter face is a true circular
// transition carried to 76° at the coping (an 'arc' segment, see track.js), a box jump's
// take-off is the circular arc through its lip, and a spine is two of those back to back
// with coping along the ridge. A feature's origin is the centre of its base line and it
// rises along its yaw.
const PI=Math.PI;
const LIP=76,run=h=>transitionRun(h,LIP);
const transition=h=>[[0,0,0,run(h),h,0,'arc']];
export const Q=(name,x,z,yaw,width,h,o={})=>({name,x,z,yaw,width,shoulder:o.shoulder??.45,surface:o.surface,closed:o.closed??true,lips:[run(h)],segments:[...transition(h),[run(h),h,0,run(h)+(o.deck??2.4),h,0]]});
export const B=(name,x,z,yaw,width,h,len,o={})=>({name,x,z,yaw,width,shoulder:o.shoulder??.45,surface:o.surface,closed:o.closed??false,segments:o.deck?[[0,0,h/len,len,h,h/len],[len,h,0,len+o.deck,h,0]]:[[0,0,h/len,len,h,h/len]]});
export const X=(name,x,z,yaw,width,h,l1,deck,l2,o={})=>({name,x,z,yaw,width,shoulder:o.shoulder??.45,surface:o.surface,closed:false,box:true,plexi:o.plexi,segments:[[0,0,0,l1,h,0,'arc'],[l1,h,0,l1+deck,h,0],[l1+deck,h,-h/l2*1.5,l1+deck+l2,0,0]]});
export const S=(name,x,z,yaw,width,h,l,o={})=>({name,x,z,yaw,width,shoulder:o.shoulder??.45,surface:o.surface,closed:false,spine:true,segments:[[0,0,0,l,h,0,'arc'],[l,h,0,2*l,0,0,'arc']]});
export const F=(name,x,z,yaw,width,h,len,o={})=>({name,x,z,yaw,width,shoulder:o.shoulder??.45,surface:o.surface,closed:o.closed??true,flat:true,segments:[[0,h,0,len,h,0]]});
export const A=(name,cx,cz,inner,a0,a1,h,o={})=>({name,cx,cz,inner,a0,a1,surface:o.surface,ends:!!o.ends,lips:[run(h)],segments:[...transition(h),[run(h),h,0,run(h)+(o.deck??2.4),h,0]]});
export const P=(name,x,z,yaw,a,b,h,flat=.35,o={})=>({name,x,z,yaw,a,b,h,flat,surface:o.surface});
export const R=(id,name,ax,az,ay,bx,bz,by,radius=.035)=>({id,name,a:{x:ax,z:az,y:ay},b:{x:bx,z:bz,y:by},radius});

export const CONTEST_PARKS=[
 {
  // Urban Sessions: a 40 × 24 m black stage (x −20..20, z −12 front .. 12 back).
  id:'urban',name:'Urban Sessions',label:'Contest park',description:'Left wall & roll-in · corner into the back wall & spine · cross box · plexi box · stepped vert wall',accent:'#39ff9c',
  bounds:{x:25,z:18},start:{x:-6,z:-1,speed:0,heading:PI},introCamera:{position:[-30,15,-30],look:[0,0,2]},
  palette:{floor:'#15181b',floorTone:.22,surface:'concrete',surfaceColor:'#7f8990',panelColor:'#3a4045',trim:'#39ff9c',barrier:'#2a2f33'},
  sky:{top:'#0b3d2c',bottom:'#35e39a'},fog:'#2fcf8f',background:'#2fcf8f',
  features:[
   // Left end: a 3 m quarter the length of the stage, a 4 m extension on its back half, and
   // the roll-in bank dropping into the front-left corner.
   Q('Left wall',-16,1,PI,16,3.0),
   Q('Left extension',-16,7.5,PI,5,4.0),
   B('Roll-in',-12,-10,PI,5,3.2,6,{deck:2.4,closed:true}),
   // Back: the wall from the rounded corner to mid-stage, a taller extension in it, and the
   // spine sticking out of its east end into the park.
   Q('Back wall',-4.5,11,PI/2,17,3.0),
   Q('Back extension',-2,11,PI/2,5,3.8),
   S('Back spine',4.5,9.5,0,5,2.2,3),
   // Out front: the plexi-wall box.
   X('Plexi box',-9,-7.5,0,5,1.5,3,3,3,{plexi:{u0:3,u1:6,h:2.0,color:'#39ff9c'}}),
   // Right end: three quarters that step up toward the front — the vert wall.
   Q('Right wall back',16,8,0,8,3.0),
   Q('Right extension',16,2,0,5,4.0),
   Q('Right vert',16,-6,0,10,4.6)
  ],
  arcs:[A('Back-left corner',-13,8,3,PI/2,PI,3.0)],
  pyramids:[P('Cross box',8,1,0,5,5,2.0,.35)],
  rails:[]
 },
 {
  // Outbox: plywood on a 32 × 50 m concrete pad (x −16..16, z −25 south .. 25 north),
  // positions read off the drone photo.
  id:'outbox',name:'Outbox',label:'Plywood park',description:'Wrapped north wall · launch boxes · roll-in into the cross box · east platform · south wall',accent:'#c8763f',
  bounds:{x:21,z:27},start:{x:13,z:8,speed:0,heading:PI/2},introCamera:{position:[-34,14,-40],look:[0,1,0]},
  palette:{floor:'#b4b8ba',floorTone:.88,surface:'wood',surfaceColor:'#8c5d3f',panelColor:'#7a5238',trim:'#2b2b2b',barrier:'#3a3f44',concreteFloor:true},
  sky:{top:'#6f8fb5',bottom:'#dfe6ea'},fog:'#d8dfe4',background:'#d8dfe4',
  features:[
   // North wall: the 3 m quarter, its rounded corner (see arcs) into a diagonal bank on the
   // west, and the taller extension on the east.
   Q('North quarter',1.6,16.2,PI/2,20,3.0),
   Q('North-west bank',-13.8,12.3,3*PI/4,8,3.0),
   Q('North-east extension',13.8,16.2,PI/2,4.4,3.4),
   // Two step-up launch boxes off the wall's base.
   B('North box A',-1.05,15.0,PI/2,4.7,1.5,2.4,{deck:3.4,closed:true}),
   B('North box B',8.3,15.0,PI/2,4.7,1.7,2.8,{deck:3.4,closed:true}),
   // The middle: a 19 m cross box, the west wing crossing it, and the roll-in that drops
   // from 4.4 m onto the box's deck from the north.
   X('Cross box',-12.9,-3.9,0,5,1.6,2.8,13.4,2.8),
   X('West wing',-9.6,-10.4,PI/2,3.2,1.6,3,6.7,3),
   {name:'Roll-in',x:-1.05,z:-3.9,yaw:PI/2,width:4.7,shoulder:.45,closed:true,segments:[[0,1.6,0,8.5,4.4,.5],[8.5,4.4,0,11,4.4,0]]},
   // East platform: a raised deck with a bank up from the north and down to the south.
   X('East platform',11,-0.7,-PI/2,10,1.4,2.5,9.5,2.5),
   // South wall and its taller extension.
   Q('South quarter',2,-16.1,-PI/2,28,2.4),
   Q('South extension',-1,-16.1,-PI/2,4.5,3.4)
  ],
  arcs:[A('North-west corner',-8.4,12.5,3.7,PI/2,3*PI/4,3.0)],
  pyramids:[],
  rails:[]
 },
 {
  // Tokyo 2020: a 44 × 26 m black floor (x −22..22, z −13 front .. 13 back).
  id:'tokyo',name:'Tokyo 2020',label:'Olympic course',description:'Walls round the back and sides · wedge · spine · A-frame · box and hip',accent:'#8fb2e8',
  bounds:{x:25.5,z:19.5},start:{x:-4,z:-3,speed:0,heading:PI/2},introCamera:{position:[-36,14,-38],look:[0,0,2]},
  palette:{floor:'#2b2826',floorTone:.30,surface:'concrete',surfaceColor:'#c5d2e4',panelColor:'#dfe6ee',trim:'#8fb2e8',barrier:'#cfd6de'},
  sky:{top:'#3a6ab0',bottom:'#dbe6f0'},fog:'#c9d5e0',background:'#c9d5e0',
  features:[
   // Back wall from the rounded left corner to the wedge: two quarter faces meeting like a
   // ship's bow at (9, 5), facing out to the south-west and south-east, decks behind them.
   Q('Back wall',-6,13,PI/2,20,2.8),
   Q('Wedge left',5.8,8.2,PI/4,9,2.8),
   Q('Wedge right',12.2,8.2,3*PI/4,9,2.8),
   Q('Back wall right',12.5,13,PI/2,7,2.8),
   // Left side: the wall, its taller section and the front-left bank.
   Q('Left wall',-19,3,PI,14,2.8),
   Q('Left extension',-19,-1.5,PI,5,3.6),
   B('Front-left bank',-19,-9.5,PI,6,1.8,4,{deck:2,closed:true}),
   // Right side: the wall, the spine off it and the front-right bank.
   Q('Right wall',19,2,0,16,2.8),
   S('Right spine',12.5,-2,PI/2,6,2.0,3),
   B('Front-right bank',19,-10,0,6,1.8,4,{deck:2,closed:true}),
   // The middle: the jump box on the left and the A-frame out front.
   X('Centre box',-12,-2,PI/2,6,1.7,3,2.5,3),
   X('A-frame',-3,-9,0,8,2.2,4.5,1,4.5)
  ],
  arcs:[A('Back-left corner',-16,10,3,PI/2,PI,2.8),A('Back-right corner',16,10,3,0,PI/2,2.8)],
  pyramids:[P('Centre hip',-7.5,-7,PI/4,2.6,2.6,1.5,.2)],
  rails:[]
 }
];
