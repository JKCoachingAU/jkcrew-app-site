import {GamePhysics,TRICKS,STEP,clamp,wrap,UPGRADE_TRICK,rememberPose,interpolatePose} from './physics.js';
import {TRACKS} from './track.js';
import {ENVIRONMENTS,resolveEnv,parkAt,bikeContact,parkHeight,closestRailPoint,railPoint,nearBowl,nearLip,nearSpine,ridgeAhead,sideWall} from './park.js';
const GRAVITY=9.81,TAU=Math.PI*2,smooth=x=>{x=clamp(x,0,1);return x*x*(3-2*x);},driveDirectionOf=v=>v<0?-1:1;
// The single / double / triple spec for a rotating trick family, by completed turns.
const tierSpec=(pose,n)=>{const chain=pose==='barspin'?['barspin','doublebarspin','triplebarspin']:pose==='tailwhip'?['tailwhip','doubletailwhip','tripletailwhip']:null;if(!chain){const spec=Object.values(TRICKS).find(t=>t.pose===pose);return {name:spec.name,points:spec.points};}return TRICKS[chain[Math.max(0,Math.min(2,n-1))]];};
export class FreeRidePhysics extends GamePhysics{
 constructor(envId='street'){super({track:'easy',env:resolveEnv(envId)});}
 reset(clear=false){this.track=TRACKS.easy;super.reset(clear);this.track=this.env;this.input.steer=0;this.input.crouch=0;if(clear)this.marker=null;const spawn=this.marker||this.env.start;Object.assign(this,{x:spawn.x,z:spawn.z,y:this.marker?parkHeight(spawn.x,spawn.z,this.env):0,v:0,vz:0,heading:this.marker?this.marker.heading:(this.env.start.heading||0),travelHeading:0,roll:0,steering:0,crankAngle:0,compression:0,extension:0,nearestRamp:this.env.id==='halfpipe'?'Flat bottom':'Open plaza',launchAngle:0,lastGroundPitch:0,spinStart:0,lastImpact:0,hopLoad:0,hopPower:0,lastHop:false,balance:0,manualTime:0,manualDistance:0,manualKind:null,grindState:null,grindCount:0,grindCooldown:0,exitBalance:0,blockedRail:null,finished:false,confined:false});}
 // Rejects unsafe spots (mid-air, mid-grind, balancing a manual) so a marker always
 // resumes cleanly on two solid wheels facing the direction you set it.
 setMarker(){if(this.mode!=='ground'||this.manualKind)return false;this.marker={x:this.x,z:this.z,heading:this.heading};this.events.push({type:'marker'});return true;}
 // charge (0-1, how far the pedal was dragged down) and flickSpeed (0-1, how fast it
 // snapped back up) both add extra pop on top of the baseline hop, within a sensible cap.
 hop(charge=0,flickSpeed=0){if(this.mode==='grind'){this.leaveGrind(true);return true;}if(this.mode!=='ground'||this.jumpCooldown>0||this.hopQueued)return false;this.hopQueued=true;this.hopLoad=.12;this.hopPower=clamp(charge*.72+flickSpeed*.28,0,1);return true;}
 setTrack(){this.reset(true);}
 setInput(next){super.setInput(next);this.input.steer=clamp(Number(next.steer)||0,-1,1);this.input.crouch=clamp(Number(next.crouch)||0,0,1);}
 trick(id,options={}){if(this.mode==='ground'&&this.hopQueued){this.buffered=[{id,held:options.held||false}];return {ok:true,buffered:true};}if(this.mode!=='air')return {ok:false,reason:'Hop before starting an aerial trick'};const result=super.trick(id,options);if(result.ok&&!result.buffered){const t=this.active[this.active.length-1];if(t)t.bankedTier=0;}return result;}
 step(dt=STEP){rememberPose(this);this.time+=dt;this.jumpCooldown=Math.max(0,this.jumpCooldown-dt);this.grindCooldown=Math.max(0,this.grindCooldown-dt);if(this.mode==='crash'){this.crashTilt=Math.min(2.6,this.crashTilt+dt*9);this.crashSlide(dt);return;}if(this.mode==='finished')return;if(this.mode==='ground')this.ground(dt);else if(this.mode==='grind')this.grind(dt);else this.air(dt);
  this.wheelSpin+=(this.mode!=='air'?this.v:Math.hypot(this.vx,this.vz))*dt/.267;
  if(this.pending&&this.mode==='ground'&&!this.manualKind&&!this.hopQueued&&Math.abs(this.balance)<.05){this.stable+=dt;if(this.stable>.14)this.bank();}
  if(Math.abs(this.x)>this.env.bounds.x-.25||Math.abs(this.z)>this.env.bounds.z-.25)this.crash('Outside the park. Reset and choose another line.');else if(this.env.outside&&this.env.outside(this.x,this.z))this.crash('Off the trail. Stay on the line.');
  // A point-to-point line (the slopestyle) ends at its finish: bank the last landing and stop.
  else if(this.env.finish&&this.mode==='ground'&&!this.finished&&this.env.finish(this.x,this.z)){this.bank();this.mode='finished';this.finished=true;this.events.push({type:'finish',score:this.score,best:this.best,time:this.time});}
  this.nearestRamp=parkAt(this.x,this.z,this.env).name;
 }
 // The bike separates and slides/tumbles to a stop instead of freezing mid-air or bouncing
 // forever: fall to the ground first if the crash started mid-flight, then skid to a halt
 // along the travel direction. scene.js reads crashSlideDist/crashBikeSlideDist to draw the
 // rider and bike visibly separating instead of crashing down as one rigid block.
 crashSlide(dt){if(this.crashSlideV===undefined)return;const ground=parkHeight(this.x,this.z,this.env);
  if(this.y>ground+.02){this.crashFallVY=(this.crashFallVY||0)-GRAVITY*dt;this.y+=this.crashFallVY*dt;if(this.y<=ground){this.y=ground;this.crashFallVY=0;}return;}
  this.y=ground;const drag=Math.max(0,1-dt*1.6);
  this.x+=Math.cos(this.crashHeading)*this.crashSlideV*dt;this.z+=Math.sin(this.crashHeading)*this.crashSlideV*dt;
  this.crashSlideV*=drag;this.crashBikeSlideV*=drag;this.crashSlideDist=(this.crashSlideDist||0)+Math.abs(this.crashSlideV)*dt;this.crashBikeSlideDist=(this.crashBikeSlideDist||0)+Math.abs(this.crashBikeSlideV)*dt;}
 // On the ground the wheels ride the environment's ground terrain where it has one (the
 // trail's, which carries a lip's tangent on past the crest); in the air the real terrain.
 get groundEnv(){return this.env.groundEnv||this.env;}
 ground(dt){const u=this.input,q=bikeContact(this.x,this.z,this.heading,this.groundEnv),c=Math.cos(this.heading),s=Math.sin(this.heading),slope=q.dx*c+q.dz*s;
  // Arcade-BMX handling rather than a road-bike model: the stick snaps in quickly, there's
  // a floor on turning authority at walking pace (you can pivot without needing speed),
  // and the yaw-rate ceiling stays high well into cruising speed — a full-stick 90° takes
  // about half a second at 8 m/s instead of over a second. Turning always follows the
  // stick relative to the direction of travel, so riding fakie never inverts steering.
  this.steering+=((u.steer||0)*.58-this.steering)*(1-Math.exp(-dt*15));
  // On a guided line (the trail) the bike is doing 50–70 km/h down a course that steers with
  // it: the line's guide owns the yaw — the stick picks a heading across the line rather than
  // flicking the bars — so the bicycle model below only runs in the parks.
  const authority=Math.max(Math.abs(this.v),3.0),rateLimit=Math.min(3.2,24/Math.max(3,Math.abs(this.v)));let yawRate=Math.abs(this.v)<.05||this.env.guide?0:clamp(authority*Math.tan(this.steering)/.97,-rateLimit,rateLimit);
  if(this.env.guide&&Math.abs(this.v)>1)yawRate+=this.env.guide(this.x,this.z,this.heading,Math.abs(this.v),u.steer||0)*driveDirectionOf(this.v);
  this.heading+=yawRate*dt;
  const crossSlope=-q.dx*s+q.dz*c,desiredRoll=clamp(Math.atan(this.v*yawRate/GRAVITY)*.45-Math.atan(crossSlope),-.55,.55);this.roll+=(desiredRoll-this.roll)*(1-Math.exp(-dt*7));
  // Pedal adds speed in the current travel direction; neutral input preserves momentum.
  // Limit only the added drive, so faster landings/downhills are never clamped away.
  const pedaling=u.pump&&!u.brake&&Math.abs(u.lean)<.25,speed=Math.abs(this.v),driveDirection=speed<.15?1:Math.sign(this.v);
  // Pedalling gets you to a cruise (11.5 m/s) and no further — anything above that has to
  // come from pumping transitions and dropping in, the Pipe / BMX Streets way.
  const boost=pedaling?Math.min(Math.max(0,11.5-speed),5.2*Math.max(.10,1-speed/14)*dt):0;
  // Pumping: holding PEDAL while descending a transition pushes through it and adds speed
  // beyond the flat-ground pedal cap — how riders actually build speed in bowls, quarters
  // and the mini ramp, so a ramp line can be sustained instead of decaying every hit.
  // A bigger transition is steeper for longer, so it pays out more speed than a small one.
  this.pumpWindow=Math.max(0,(this.pumpWindow||0)-dt);const descending=-slope*driveDirection,pump=u.pump&&!u.brake&&descending>.10&&speed<15?Math.min(1.6,descending)*(this.pumpWindow>0?6.5:3.4)*dt:0;
  this.pumping=pump>0;
  // Rolling resistance and wind (Pipe / BMX Streets feel): a coasting bike bleeds speed on
  // the flat — slowly at a cruise, faster at a sprint — so speed has to be kept up with the
  // pedals or, better, by pumping transitions; gravity along the slope (next line) is what
  // makes a climb cost speed and a drop-in or a big transition give it back.
  const drag=Math.min(speed,(.15+.0045*speed*speed)*dt);
  this.v+=driveDirection*(boost+pump)-(Math.sign(this.v)||1)*drag-GRAVITY*Math.sin(Math.atan(slope))*dt;
  if(u.brake)this.v=Math.sign(this.v)*Math.max(0,Math.abs(this.v)-12*dt);
  const flatSpeed=this.v/Math.sqrt(1+slope*slope);let dx=Math.cos(this.heading)*flatSpeed,dz=Math.sin(this.heading)*flatSpeed;
  const oldPitch=q.pitch,oldY=q.height,oldVisualY=this.y,oldX=this.x,oldZ=this.z;this.x+=dx*dt;this.z+=dz*dt;let held=false;if(this.env.confine){const c=this.env.confine(this.x,this.z,this.heading);if(c){held=true;this.x=c.x;this.z=c.z;if(c.heading!==undefined){this.heading=c.heading;dx=Math.cos(this.heading)*flatSpeed;dz=Math.sin(this.heading)*flatSpeed;if(!this.confined){this.v*=.85;this.events.push({type:'wall'});}}this.confined=true;}else this.confined=false;}const next=bikeContact(this.x,this.z,this.heading,this.groundEnv),vy=flatSpeed*slope,crest=!!(this.env.crest&&driveDirection>0&&this.env.crest(oldX,oldZ,this.x,this.z));
  const wall=sideWall(this.env,this.x,this.z,this.v*c,this.v*s);if(wall){this.crash('Ride the transition, not the side of the '+wall.feature.name.toLowerCase()+'.');return;}
  this.pumpCharge=clamp(this.pumpCharge+(pedaling?dt*1.5:-dt*3),0,1);
  this.hopLoad=Math.max(0,this.hopLoad-dt);const load=this.hopQueued?.18:u.crouch?Math.min(.34,.08+u.crouch*.32):pedaling&&Math.abs(slope)>.16?.11:0;this.compression+=(load-this.compression)*(1-Math.exp(-dt*12));
  if(pedaling&&Math.abs(this.balance)<.1&&Math.abs(slope)<.22&&Math.abs(this.v)<9)this.crankAngle-=driveDirection*dt*(2.5+Math.abs(this.v)*.5);else this.crankAngle+=wrap(-this.crankAngle)*(1-Math.exp(-dt*10));
  // Leave only when the next surface falls away from the bicycle's tangent.
  const predicted=oldY+vy*dt-GRAVITY*dt*dt*.5,drop=predicted-next.height;
  // Climbing a spine's face the surface is still rising, so the bike stays welded to it
  // right up to the coping; only once the ridge is behind the wheels does it leave.
  const climbingSpine=!this.hopQueued&&ridgeAhead(this.env,this.x,this.z,dx,dz);
  if(!climbingSpine&&((this.hopQueued&&this.hopLoad===0)||crest||(!held&&Math.abs(this.v)>3&&drop>(this.env.trail?.006:.0007)))){
   const hop=this.hopQueued;this.hopQueued=false;this.jumpCooldown=.30;
   // Riding a quarter-pipe/wall (or the big bowl's coping) fast enough airs you off it
   // instead of just rolling onto the deck. The boost ramps in smoothly with speed rather
   // than snapping on past a hard cutoff, so airing a ramp feels progressive, not binary.
   const wallMargin=this.env.radius*(this.env.wallCut||.97)+.5,onWall=Math.abs(oldX)>this.env.quarterStart-1&&Math.abs(oldX)<this.env.quarterStart+wallMargin;
   // Only a bike travelling *up* the transition airs off the lip; the two-wheel contact
   // model also "falls away" rolling back down over a lip (the rear wheel drops off the
   // deck edge), and that must stay a plain roll-off, not a second bounce off the coping.
   const wallLip=onWall||nearBowl(this.env,oldX,oldZ)||nearLip(this.env,oldX,oldZ);
   const ascending=slope*driveDirection>.25,onQuarter=!hop&&ascending&&wallLip,copingT=clamp((Math.abs(this.v)-3.4)/3.6,0,1),copingAmount=onQuarter?copingT*copingT*(3-2*copingT):0,coping=copingAmount>0;
   const copingBoost=coping?Math.min(5.5,Math.abs(this.v)*.45)*copingAmount:0,horizontalScale=coping?1-.22*copingAmount:1;
   // Hopping pushes off the surface normal — on a transition you are rotated with the wall,
   // so that push carries you out over the coping. Off a steep *jump* lip (a box take-off, a
   // spine ridge) there is no coping to clear and the rider pulls up instead, so the pop goes
   // vertical rather than firing the bike backwards off the face.
   const normalLength=Math.sqrt(1+q.dx*q.dx+q.dz*q.dz),hopImpulse=3.6*(1+.35*(this.hopPower||0)),impulse=hop?hopImpulse:copingBoost,alongNormal=hop&&!wallLip?1-smooth((Math.abs(slope)-.45)/.75):1;
   this.vx=dx*horizontalScale-impulse*alongNormal*q.dx/normalLength;this.vz=dz*horizontalScale-impulse*alongNormal*q.dz/normalLength;this.vy=vy+impulse*(alongNormal/normalLength+(1-alongNormal));
   // A spine is transferred, not aired: cresting the ridge pitched up pops the bike over it
   // with its speed kept and a modest lift, so it comes down on the far transition (or the
   // flat just past it) rather than flying straight up off a 75° face.
   const spineRidge=!hop&&!coping?nearSpine(this.env,oldX,oldZ):null;
   // Speed is conserved over the ridge and mostly stays horizontal — a pop over the spine
   // that carries into the next feature, not a launch straight up that dumps every metre per
   // second into a flat landing. Hopping at the ridge is how you turn it into a real air.
   if(spineRidge){const S=Math.abs(this.v),tx=Math.sign(this.v||1)*Math.cos(this.heading),tz=Math.sign(this.v||1)*Math.sin(this.heading),up=Math.min(S*.55,3.6),forward=Math.sqrt(Math.max(.25,S*S-up*up));this.vx=forward*tx;this.vz=forward*tz;this.vy=up;this.combo.push({name:'Spine transfer',points:150});}
   // A real quarter-pipe goes vertical at the lip, so an air goes *up* and comes back down
   // into the same transition. The height-field's lips top out around 60-70°, which would
   // fire every air forward onto the deck as a flyout. So at a coping launch the velocity is
   // redirected toward vertical (fully so at speed), with a slight drift back toward the
   // flat, and the rider auto-turns 180° over the flight unless the stick takes over — the
   // Tony Hawk quarter-pipe air, not a jump over the deck.
   // The redirect is geometric, not speed-based: the wall is vertical whatever speed you
   // reach it at, so every no-hop lip launch goes up and drifts back into the transition —
   // a slow hit is a small air that drops back in (fakie if it's too short to turn), never
   // a roll out onto the deck. Speed only decides the height. Hopping at the lip is the
   // deliberate flyout onto the deck (hop launches skip this block entirely).
   if(coping){const S=Math.abs(this.v),tx=Math.sign(this.v||1)*Math.cos(this.heading),tz=Math.sign(this.v||1)*Math.sin(this.heading),theta=1.40;
    // Cap the air at a believable height for the lip in question (about 3.2 m over a 2 m
    // mini ramp, 4 m over a 3.6 m vert wall) — pedalling hard on the flat can otherwise
    // bank enough speed for 8 m airs, which no transition this size actually gives.
    // The path over the coping is a narrow arc, not an elevator: it leaves the lip drifting
    // *out* over the deck (more with speed), and a steady pull back toward the transition
    // over the flight brings it down about 0.7 m inside the lip — the carve back in.
    const allowance=2.5+.55*Math.max(0,oldY),upward=Math.min(S*Math.sin(theta)+copingBoost*.35,Math.sqrt(2*GRAVITY*allowance)),forward=.55+.35*copingAmount;
    this.vx=forward*tx;this.vz=forward*tz;this.vy=upward;
    const flight=2*this.vy/GRAVITY;this.lipAir=true;this.autoTurn=Math.PI;this.autoTurnDir=Math.abs(u.steer||0)>.15?Math.sign(u.steer):-(u.spinDirection||1);this.airFlight=flight;this.lipDir={x:tx,z:tz};this.lipPull=2*(-.3-forward*flight)/(flight*flight);}
   else{this.lipAir=false;this.autoTurn=0;}
   this.finishManual();this.y=Math.max(hop?oldVisualY:oldY,next.height)+.018;this.angle=hop&&Math.abs(this.balance)>.1?this.angle:oldPitch+(hop?.15:0);this.launchAngle=oldPitch;this.lastHop=hop;this.hopPower=0;this.startAir(hop);
   if(coping)this.combo.push({name:this.env.id==='halfpipe'?'Wall air':nearBowl(this.env,oldX,oldZ)?'Bowl air':onWall?'Quarter-pipe air':'Coping air',points:150});
   return;
  }
  const intent=Math.abs(u.lean)>.25&&Math.abs(this.v)>.8&&Math.abs(next.pitch)<.38&&!u.brake?-u.lean:0;
  if(intent)this.pending=null;
  if(intent&&(!this.manualKind||Math.sign(intent)!==Math.sign(this.balance))){this.finishManual();this.manualKind=intent>0?'Manual':'Nose manual';this.events.push({type:'balance',name:this.manualKind});}
  if(!intent)this.finishManual();this.balance+=(intent-this.balance)*(1-Math.exp(-dt*8));
  if(this.manualKind){this.manualTime+=dt;this.manualDistance+=Math.abs(this.v)*dt;}
  this.angle=next.pitch+this.balance*.48;const axle=this.balance>0?-.445:.525;this.y=Math.abs(this.balance)>.005?parkHeight(this.x+axle*Math.cos(this.angle)*Math.cos(this.heading),this.z+axle*Math.cos(this.angle)*Math.sin(this.heading),this.env)+.267-axle*Math.sin(this.angle)-.267*Math.cos(this.angle):next.height;this.lastGroundPitch=next.pitch;
  this.railCollision();
 }
 startAir(hop){this.grindState=null;this.blockedRail=null;this.mode='air';this.launches++;this.airtime=0;if(!this.lipAir){this.airFlight=Math.max(.25,2*Math.max(0,this.vy)/GRAVITY);this.lipPull=0;}this.airOrigin=this.y;this.airPeak=this.y;this.airHeight=0;this.airMax=0;this.travelHeading=Math.atan2(this.vz,this.vx);this.spinStart=this.heading;this.spin=this.heading;this.omega=0;this.rotation=0;this.flipCount=0;this.spinVelocity=0;this.active=[];if(hop)this.combo.push({name:'Bunny hop',points:80});this.pending=null;this.stable=0;this.lastImpact=0;this.events.push({type:'launch',hop});for(const queued of this.buffered.splice(0))this.trick(queued.id,{held:queued.held});}
 animateTricks(dt){this.active=this.active.filter(t=>{t.t+=dt;const spec=TRICKS[t.id],rotating=['barspin','tailwhip','decade','bikeflip','frontbikeflip','pendulum'].includes(spec.pose),single=['bikeflip','frontbikeflip','pendulum'].includes(spec.pose);
  // Rotations normally finish and catch on time. A held tailwhip/barspin/decade keeps
  // spinning into a double or triple instead of stopping at one turn. Grabs may remain
  // held in extension as before.
  if(rotating){
   if(spec.pose==='decade'){
    // Decade's raw pose value already drives continuous multi-turn rotation in rig.js.
    const cap=Math.max(t.turnCap||1,t.held?3:1);t.turnCap=cap;t.pose=Math.min(cap,t.t/spec.duration);
    if(t.t<cap*spec.duration){if(t.pose>=(t.bankedTier||0)+1){t.bankedTier=(t.bankedTier||0)+1;t.bankedSpec={name:spec.name,points:spec.points};}return true;}
    this.combo.push({name:spec.name,points:Math.round(spec.points*cap)});this.events.push({type:'trick-complete',name:spec.name});return false;
   }
   // Barspins and tailwhips are one continuous rotation counted in turns: while the stick
   // is held the frame (or bars) keeps going, up to a triple; the moment it is let go the
   // rotation is capped at the end of the turn it is in (or the next one if it is already
   // within a fifth of a turn of finishing, so the catch is never a snap), and every
   // completed turn is banked so a landing mid-rotation still pays for the turns done.
   const base=spec.turns||1,perTurn=spec.duration/base;if(t.turnCap==null)t.turnCap=base;
   // A bikeflip (either way) and a pendulum are one rotation however long the stick is held.
   if(single)t.turnCap=1;else if(t.held)t.turnCap=3;else if(!t.capLocked){t.turnCap=Math.min(3,Math.max(base,Math.ceil(t.t/perTurn+.2)));t.capLocked=true;}
   const cap=t.turnCap;t.pose=Math.min(cap,t.t/perTurn);
   if(t.t<cap*perTurn){const tier=Math.floor(t.pose);if(tier>(t.bankedTier||0)){t.bankedTier=tier;t.bankedSpec=tierSpec(spec.pose,tier);}return true;}
   const done=tierSpec(spec.pose,cap);this.combo.push({name:done.name,points:done.points});this.events.push({type:'trick-complete',name:done.name});return false;
  }
  else if(t.held){t.pose=Math.min(.5,t.t/.44);return true;}
  else if(t.releasing){t.releaseT+=dt;t.pose=t.releaseFrom+(1-t.releaseFrom)*clamp(t.releaseT/.20,0,1);if(t.releaseT<.20)return true;}
  else {t.pose=t.t/spec.duration;if(t.t<spec.duration)return true;}
  this.combo.push({name:spec.name,points:spec.points});this.events.push({type:'trick-complete',name:spec.name});return false;});}
 air(dt){const u=this.input,ox=this.x,oy=this.y,oz=this.z;this.airtime+=dt;this.balance*=Math.exp(-dt*8);this.x+=this.vx*dt;this.z+=this.vz*dt;this.y+=this.vy*dt-GRAVITY*dt*dt*.5;this.vy-=GRAVITY*dt;
  const railSetup=this.lastHop&&this.grindCooldown===0&&this.env.rails.some(r=>{const q=closestRailPoint(r,this.x,this.z);return q.distance<1.1&&q.u>-.2&&q.u<1.2&&Math.abs(this.y+.267-q.y)<1.8;});
  if(this.exitBalance&&Math.sign(u.lean)!==this.exitBalance)this.exitBalance=0;
  if(this.exitBalance){this.omega=0;this.angle+=wrap(-this.exitBalance*.23-this.angle)*(1-Math.exp(-dt*10));}
  else if(railSetup&&Math.abs(u.lean)>.25){const target=u.lean<0?.52:-.48;this.omega=0;this.angle+=wrap(target-this.angle)*(1-Math.exp(-dt*12));}
  // Flips are thrown, not wound up: the first tenth of a second off the lip sets the rate
  // (a real rider commits the shoulders at take-off), then it holds, so a flip started early
  // in the flight always has time to come round. A 360° turn takes about three quarters of a
  // second at full stick — box-jump and quarter airtime.
  else if(Math.abs(u.lean)>.08)this.omega=clamp(this.omega-u.lean*(Math.abs(this.omega)<4?30:12)*dt,-8.4,8.4);else this.omega*=Math.exp(-dt*3.5);
  this.angle+=this.omega*dt;this.rotation+=this.omega*dt;
  // While a lip air is auto-turning, a resting thumb on the stick is not a spin: only the
  // spin button or a decisive push (past 60%) takes the rotation over. A light push early
  // in the flight just picks which way the auto-180 turns.
  const autoTurning=this.autoTurn>0&&!(u.spin||Math.abs(u.steer||0)>.45),deadzone=this.lipAir?.45:.08,spinInput=autoTurning?0:u.spin?-(u.spinDirection||1):Math.abs(u.steer||0)>deadzone?Math.sign(u.steer)*Math.min(1,Math.abs(u.steer)*1.25):0;
  // Spins are quick to start and quick to stop: full stick reaches 7 rad/s (a 360 in well
  // under a second) within a tenth of a second, and letting go bleeds it off just as fast.
  this.spinVelocity+=(spinInput*7.0-this.spinVelocity)*(1-Math.exp(-dt*(Math.abs(spinInput)>.08?9:8)));this.heading+=this.spinVelocity*dt;
  const flips=Math.floor((Math.abs(this.rotation)+.05)/TAU);if(flips>this.flipCount){this.combo.push({name:this.rotation>0?'Backflip':'Frontflip',points:600});this.flipCount=flips;}
  if(this.lipAir&&this.lipPull){this.vx+=this.lipPull*this.lipDir.x*dt;this.vz+=this.lipPull*this.lipDir.z*dt;}
  this.animateTricks(dt);const surface=bikeContact(this.x,this.z,this.heading,this.env),clearance=this.y-surface.height,phase=clamp(this.airtime/Math.max(.2,this.airFlight||1),0,1);this.airPhase=phase;
  // Neutral posture naturally levels, then points at the upcoming landing. No force is added
  // to flight. A lip air follows a real air's pitch: it leaves nose-high at the transition's
  // angle, settles to about 15° nose-up around the apex, then tips over to meet the wall.
  // Flip landing assist: a flip let go of on the way down is carried round to the wheels
  // rather than left hanging at 300°. `wrap` takes the short way, so past the half-way point
  // that means finishing the turn — the arcade-skate equivalent of spotting the landing.
  const toGround=clearance/Math.max(1.5,-this.vy),settling=Math.abs(u.lean)<.08&&this.vy<0&&(clearance<3.0||toGround<.5)&&Math.abs(this.rotation)>1.0;
  if(settling&&Math.abs(this.omega)>1.7)this.omega*=Math.exp(-dt*7);
  // The closer the wheels are, the harder the assist pulls, so even a flip let go of late
  // comes all the way round instead of landing a few degrees short.
  const settleRate=9+18*(1-clamp(toGround/.5,0,1));
  this.landAssist=false;if(Math.abs(u.lean)<.08&&(Math.abs(this.omega)<1.7||settling)){let target=this.vy<0&&clearance<2.0?surface.pitch:Math.atan2(this.vy,Math.hypot(this.vx,this.vz))*.50;
   if(this.lipAir){const launch=Math.abs(this.launchAngle||.9),apex=.26;target=phase<.45?launch+(apex-launch)*smooth(phase/.45):this.vy<0&&clearance<2.0?surface.pitch:apex+(-launch*.85-apex)*smooth((phase-.45)/.55);}
   const error=wrap(target-this.angle);if(Math.abs(error)<.85||this.lipAir||this.lastHop||settling){this.angle+=error*(1-Math.exp(-dt*(settling?settleRate:this.lipAir?7:this.lastHop?6.5:4.5)));this.landAssist=true;}}
  // Lip-air auto-turn: rotate through 180° over the flight so the landing is forward into
  // the transition. Any stick/spin input hands control to the player and cancels it. The
  // auto rotation is folded into spinStart so it is never credited as a spin trick.
  if(this.autoTurn>0){if(!autoTurning)this.autoTurn=0;else{const progress=Math.PI-this.autoTurn,want=Math.abs(u.steer||0)>.15?Math.sign(u.steer):this.autoTurnDir;if(want!==this.autoTurnDir&&progress<.6){this.heading-=this.autoTurnDir*progress;this.spinStart-=this.autoTurnDir*progress;this.autoTurn=Math.PI;this.autoTurnDir=want;}
   // The 180 is carved, not spun on a turntable: it eases in after take-off, turns fastest
   // around the apex and is done before re-entry (a smoothstep of the flight's progress).
   const wanted=Math.PI*smooth((phase-.10)/.72),step=clamp(wanted-(Math.PI-this.autoTurn),0,Math.min(this.autoTurn,Math.max(7,Math.PI/Math.max(.12,(this.airFlight||.5)*.55))*dt));this.heading+=this.autoTurnDir*step;this.spinStart+=this.autoTurnDir*step;this.autoTurn-=step;this.turnRate=this.autoTurnDir*step/dt;}}
  if(!(this.autoTurn>0))this.turnRate=this.spinVelocity;
  // Bank into the turn: the bike and rider roll toward the inside of a 180 or a spin, and
  // level out again before the wheels touch.
  const bank=clamp((this.turnRate||0)*.11,-.36,.36)*(this.vy<0&&clearance<1.2?clearance/1.2:1);this.roll+=(bank-this.roll)*(1-Math.exp(-dt*6));
  // Landing snap: once the stick is released on the way down, the rotation settles onto
  // the nearest half-turn (forward or fakie) over the last stretch of the flight, so a
  // 180/360 that's let go at 150° or 200° still lands square instead of on a diagonal —
  // the arcade-skate landing assist. It never adds rotation the player didn't start.
  if(Math.abs(spinInput)<.08&&this.vy<0&&clearance<3.5&&!this.autoTurn){const rel=wrap(this.heading-this.spinStart),err=Math.round(rel/Math.PI)*Math.PI-rel;if(Math.abs(err)<1.4){this.heading+=err*(1-Math.exp(-dt*12));this.spinVelocity*=Math.exp(-dt*10);}}
  // Rail magnet: after a hop (or off a lip), a rail that's roughly lined up and within
  // 1.3 m pulls the bike onto its line during the flight, so a grind needs intent and a
  // rough aim rather than pixel-perfect placement — the two-thumb equivalent of how
  // arcade skate games catch rails.
  if((this.lastHop||this.lipAir)&&!this.grindCooldown&&!this.active.length&&this.airtime>.05){let best=null;for(const r of this.env.rails){if(r.id===this.blockedRail)continue;const alignment=Math.abs(wrap(this.heading-r.heading)),error=Math.min(alignment,Math.abs(Math.PI-alignment));if(error>(r.coping?1.3:.95))continue;const q=closestRailPoint(r,this.x,this.z);if(q.u<-.1||q.u>1.1||q.distance>1.3||Math.abs(this.y+.245-q.y)>1.6)continue;if(!best||q.distance<best.q.distance)best={r,q};}
   if(best){const n={x:-Math.sin(best.r.heading),z:Math.cos(best.r.heading)},d=(this.x-best.q.x)*n.x+(this.z-best.q.z)*n.z,target=Math.sign(d||1)*.13,pull=(d-target)*(1-Math.exp(-dt*7));this.x-=n.x*pull;this.z-=n.z*pull;}}
  this.airPeak=Math.max(this.airPeak,this.y);this.airHeight=Math.max(0,this.y-this.airOrigin);this.airMax=Math.max(this.airMax,this.airHeight);this.maxHeight=Math.max(this.maxHeight,this.airMax);
  if(this.catchRail(ox,oy,oz))return;this.railCollision();if(this.mode==='crash')return;
  if(this.y<=surface.height){let a=0,b=1;for(let i=0;i<9;i++){const m=(a+b)/2,q=bikeContact(ox+(this.x-ox)*m,oz+(this.z-oz)*m,this.heading,this.env);if(oy+(this.y-oy)*m>q.height)a=m;else b=m;}this.x=ox+(this.x-ox)*b;this.z=oz+(this.z-oz)*b;const hit=bikeContact(this.x,this.z,this.heading,this.env);this.y=hit.height;this.land(hit);}
  if(this.airtime>6||this.y<(this.env.terrain?this.env.terrain(this.x,this.z)-4:-4))this.crash('Reset to the roll-in.');
 }
 land(q){this.balance=0;
  // A coping air always rides out forwards: whatever is left of its 180 is finished as the
  // wheels touch (a few degrees on a short air), instead of landing fakie and coasting
  // backwards out of the transition.
  if(this.lipAir&&this.autoTurn>0){this.heading+=this.autoTurnDir*this.autoTurn;this.spinStart+=this.autoTurnDir*this.autoTurn;}
  this.lipAir=false;this.autoTurn=0;const error=Math.abs(wrap(this.angle-q.pitch)),velocityHeading=Math.atan2(this.vz,this.vx),yaw=wrap(this.heading-velocityHeading),yawError=Math.hypot(this.vx,this.vz)<.5?0:Math.min(Math.abs(yaw),Math.abs(wrap(yaw-Math.PI))),impact=Math.max(0,(q.dx*this.vx+q.dz*this.vz-this.vy)/Math.sqrt(1+q.dx*q.dx+q.dz*q.dz));this.lastLanding={pitchError:error,yawError,impact,unfinished:this.active.length>0,airtime:this.airtime};
  if(this.active.length){const unfinished=this.active.filter(t=>!(t.bankedTier>0));if(unfinished.length)return this.crash('Catch the bike before the wheels touch.');for(const t of this.active)this.combo.push({name:t.bankedSpec.name,points:t.bankedSpec.points});this.active=[];}
  if(error>1.10)return this.crash('Line up both wheels with the landing.');if(yawError>0.95)return this.crash('Land facing your direction of travel.');if(impact>13.5)return this.crash('Heavy landing. Aim for the downslope.');
  const landedFlips=Math.abs(Math.round((this.angle-q.pitch)/TAU));if(landedFlips>this.flipCount&&Math.abs(this.rotation)>Math.PI*1.35){for(let i=this.flipCount;i<landedFlips;i++)this.combo.push({name:this.rotation>0?'Backflip':'Frontflip',points:600});this.flipCount=landedFlips;}
  this.creditSpin();
  // Amplitude scores on the slopestyle: every metre of air above the lip is worth 60 points.
  if(this.env.trail&&this.airMax>=1)this.combo.push({name:Math.round(this.airMax*10)/10+' m air',points:Math.round(this.airMax*60)});
  const clean=error<.30&&yawError<.25;this.v=(this.vx*Math.cos(this.heading)+this.vz*Math.sin(this.heading)+this.vy*Math.tan(q.pitch))/Math.sqrt(1+Math.tan(q.pitch)**2)*(clean?1:.84);
  // Catching a transition smoothly with PEDAL held is a pump: a clean landing on a down-slope
  // adds speed on touchdown and opens a short window where pumping through the rest of the
  // transition pays out double — the Pipe / BMX Streets reward for absorbing the landing.
  const downslope=-(q.dx*Math.cos(this.heading)+q.dz*Math.sin(this.heading))*Math.sign(this.v||1);if(clean&&this.input.pump&&!this.input.brake&&downslope>.12){this.v+=Math.sign(this.v||1)*Math.min(1.6,.6+downslope*1.4);this.pumpWindow=1.2;}this.mode='ground';this.landings++;this.angle=q.pitch;this.omega=0;this.lastImpact=impact;this.compression=clamp(impact*.020,.035,.20);this.pending={names:this.combo.map(t=>t.name),points:Math.round(this.combo.reduce((n,t)=>n+t.points,0)*(1+Math.max(0,this.combo.length-1)*.5)*(clean?1.1:1)),quality:clean?'Clean landing':'Landed',air:this.airMax};this.stable=0;this.events.push({type:'contact',impact});
 }
 // The slopestyle's cue: the next lip (number, height, distance), the pump window, the finish.
 trailCue(){const n=this.env.nextJump(this.x,this.z);if(!n)return this.input.pump?'FINISH AHEAD • PEDAL':'FINISH AHEAD • HOLD PEDAL';if(n.distance<9)return 'JUMP '+n.index+' • POP IT • STEER TO SPIN';if(this.pumpWindow>0)return 'PUMPING • +SPEED';if(!this.input.pump&&Math.abs(this.v)>.04)return 'COASTING • HOLD PEDAL';return 'JUMP '+n.index+' • '+n.gap+' M GAP • '+Math.round(n.distance)+' M';}
 creditSpin(){const turns=Math.round((this.heading-this.spinStart)/Math.PI);if(turns&&Math.abs((this.heading-this.spinStart)-turns*Math.PI)<.60)this.combo.push({name:Math.abs(turns)*180+' spin',points:Math.abs(turns)*200});this.spinStart=this.heading;}
 bank(){const had=!!this.pending;super.bank();if(had)this.combo=[];}
 // Free roam already recovers at the rider's own marker (or the park entrance) via reset();
 // this just gives the crash overlay the same uniform recover() call track modes use.
 recover(){this.reset();return true;}
 finishManual(){if(this.manualKind&&this.manualTime>.35&&this.manualDistance>.7)this.combo.push({name:this.manualKind,points:Math.round(this.manualDistance*35)});if(this.manualKind&&this.combo.length){this.pending={names:this.combo.map(t=>t.name),points:Math.round(this.combo.reduce((n,t)=>n+t.points,0)*(1+Math.max(0,this.combo.length-1)*.5)),quality:'Balanced line',air:this.airMax};this.stable=0;}this.manualKind=null;this.manualTime=0;this.manualDistance=0;}
 crash(reason){if(this.mode==='crash')return;this.lipAir=false;this.autoTurn=0;
  // Momentum carries into the tumble: falling first if it started mid-air, then the rider
  // and bike skid to a stop along the travel direction instead of freezing in place. The
  // bike is given a longer, wider slide than the rider so scene.js can draw them visibly
  // separating rather than crashing down as one rigid unit.
  const speed=this.mode==='air'?Math.hypot(this.vx,this.vz):Math.abs(this.v),heading=this.mode==='air'?Math.atan2(this.vz,this.vx):this.heading;
  this.crashHeading=heading;this.crashSlideV=Math.min(11,speed*.82+1.4);this.crashBikeSlideV=Math.min(13,speed*1.05+2.1);this.crashSlideDist=0;this.crashBikeSlideDist=0;this.crashFallVY=this.mode==='air'?this.vy:0;
  this.grindState=null;this.manualKind=null;this.balance=0;this.exitBalance=0;this.crashSpin=(Math.random()<.5?-1:1)*(1.4+Math.random()*1.6);this.crashKick={x:(Math.random()-.5)*2.4,y:1.6+Math.random()*1.4,z:(Math.random()-.5)*2.4};super.crash(reason);}

 peg(axle,side,x=this.x,y=this.y,z=this.z,angle=this.angle){const forward=axle*Math.cos(angle)-.267*Math.sin(angle),c=Math.cos(this.heading),s=Math.sin(this.heading);return {x:x+c*forward-s*side,y:y+axle*Math.sin(angle)+.267*Math.cos(angle)-.022,z:z+s*forward+c*side};}
 catchRail(ox,oy,oz){if(!(this.lastHop||this.lipAir)||this.grindCooldown||this.airtime<.06||this.active.length||this.vy>2.2)return false;
  // Forgiving assisted lock-on: hopping near a rail with roughly the right angle and
  // balance reliably catches, using approach angle, peg position and lean together
  // rather than demanding pixel-perfect alignment.
  const kind=this.input.lean<-.25?'Icepick':this.input.lean>.25?'Toothpick':'Double peg',axle=kind==='Icepick'?-.445:kind==='Toothpick'?.525:.04,target=kind==='Icepick'?.52:kind==='Toothpick'?-.48:0;
  const pitchError=Math.abs(wrap(this.angle-target));if(pitchError>1.05||Math.abs(this.omega)>4.5)return false;
  const rising=this.lastHop&&this.vy>0&&this.airtime<.4;
  // Coping is caught from a steeper angle than a street rail: you ride *up* the transition
  // at it, so the bike is crossing the coping line when the pegs get there.
  for(const r of this.env.rails){if(r.id===this.blockedRail)continue;const limit=r.coping?1.3:.95,alignment=Math.abs(wrap(this.heading-r.heading)),reverse=alignment>Math.PI/2,error=Math.min(alignment,Math.abs(Math.PI-alignment));if(error>limit)continue;if(pitchError>(kind==='Double peg'?(r.coping?1.05:.55):.85))continue;
   const along=(this.vx*Math.cos(r.heading)+this.vz*Math.sin(r.heading));const across=-this.vx*Math.sin(r.heading)+this.vz*Math.cos(r.heading);if(Math.abs(along)<.6||Math.abs(Math.atan2(across,Math.abs(along)))>limit)continue;
   for(const side of [-.12,.12]){const peg=this.peg(axle,side),previous=this.peg(axle,side,ox,oy,oz),q=closestRailPoint(r,peg.x,peg.z);if(q.u<0||q.u>1||q.distance>.60||peg.y>q.y+.12||peg.y<q.y-.32)continue;if(!rising&&previous.y<q.y-.14)continue;if(rising&&peg.y<q.y-.10)continue;
    if(-this.vy>8){this.crash('Heavy rail impact. Use a lower hop or a smoother approach.');return true;}this.creditSpin();this.lipAir=false;this.autoTurn=0;this.mode='grind';this.grindCount++;this.grindState={rail:r,u:q.u,side,axle,kind,target,along,distance:0,time:0};this.heading=r.heading+(reverse?Math.PI:0);this.angle=target;this.omega=0;this.roll=0;this.active=[];this.placeOnRail();this.events.push({type:'grind',name:kind});return true;
   }
  }return false;
 }
 placeOnRail(){const g=this.grindState,q=railPoint(g.rail,g.u),offset=this.peg(g.axle,g.side,0,0,0);this.x=q.x-offset.x;this.y=q.y-offset.y;this.z=q.z-offset.z;this.v=g.along*Math.cos(this.heading-g.rail.heading);this.vx=g.along*Math.cos(g.rail.heading);this.vz=g.along*Math.sin(g.rail.heading);this.vy=0;}
 grind(dt){const g=this.grindState;if(!g)return;const slope=(g.rail.b.y-g.rail.a.y)/g.rail.length,sign=Math.sign(g.along);g.along-=sign*(this.input.brake?9:.65)*dt+GRAVITY*slope*dt;g.time+=dt;g.distance+=Math.abs(g.along)*dt;g.u+=g.along*dt/g.rail.length;this.placeOnRail();
  if(g.u<=0||g.u>=1||Math.abs(g.along)<.8||(g.time>.15&&((g.kind==='Icepick'&&this.input.lean>-.18)||(g.kind==='Toothpick'&&this.input.lean<.18))))this.leaveGrind(false);
 }
 leaveGrind(hop){const g=this.grindState;if(!g)return;if(g.distance>.25)this.combo.push({name:g.kind,points:Math.round(160+g.distance*65)});this.blockedRail=g.rail.id;if(hop){const push=Math.min(.75,Math.abs(g.along)*.15)*Math.sign(g.side);this.vx+=Math.sin(this.heading)*push;this.vz-=Math.cos(this.heading)*push;}this.exitBalance=Math.abs(this.input.lean)>.25?Math.sign(this.input.lean):0;this.grindState=null;this.mode='air';this.vy=hop?3.1:.35;this.airtime=0;this.airOrigin=this.y;this.airPeak=this.y;this.airHeight=0;this.airMax=0;this.angle=wrap(this.angle)*.55;this.omega=0;this.spinStart=this.heading;this.rotation=0;this.flipCount=0;this.spinVelocity=0;this.grindCooldown=.30;this.lastHop=hop;this.events.push({type:'grind-exit',hop});if(hop)this.combo.push({name:'Hop out',points:80});}
 // Coping (round pipe flush with a lip) is ridden over when dropping in or rolling onto a
 // deck; only street rails stop a bike that rides straight into them.
 railCollision(){if(this.mode==='grind'||this.mode==='crash'||(this.mode==='ground'&&this.hopQueued))return;const rising=this.mode==='air'&&this.lastHop&&this.vy>0&&this.airtime<.4;for(const r of this.env.rails){if(r.coping)continue;
  // Early in a hop, a rail you're lined up with is a grind target, not an obstacle: the
  // magnet is still moving the pegs onto it, so the wheel passing its height doesn't bail.
  if(rising){const alignment=Math.abs(wrap(this.heading-r.heading));if(Math.min(alignment,Math.abs(Math.PI-alignment))<.95)continue;}for(const axle of [-.445,.525]){const p=this.peg(axle,0);p.y+=.022;const q=closestRailPoint(r,p.x,p.z);if(q.u<0||q.u>1||q.distance>.065)continue;if(Math.hypot(p.y-(q.y-r.radius),q.distance)<.267+r.radius){this.crash(this.mode==='ground'?'Hop beside the rail to catch it with your pegs.':'Your wheel caught the rail. Aim your pegs beside it.');return;}}}}
 // The rail a hop would catch from here: lined up within ~55°, within the magnet's lateral
 // reach and about to pass over it. The HUD lights that rail up so the player knows when a
 // tap will lock on, instead of guessing — the affordance arcade skate games give a grind.
 targetRail(){if(this.mode==='grind'||this.mode==='crash')return null;const air=this.mode==='air';if(air&&!(this.lastHop||this.lipAir))return null;
  const c=Math.cos(this.heading),s=Math.sin(this.heading),dir=air?1:(Math.sign(this.v)||1);let best=null;
  for(const r of this.env.rails){if(r.id===this.blockedRail||(r.coping&&air&&!this.lastHop))continue;const alignment=Math.abs(wrap(this.heading-r.heading)),error=Math.min(alignment,Math.abs(Math.PI-alignment));if(error>(r.coping?1.3:.95))continue;
   const q=closestRailPoint(r,this.x,this.z),lateral=Math.abs(-(this.x-r.a.x)*Math.sin(r.heading)+(this.z-r.a.z)*Math.cos(r.heading));if((air?q.distance:lateral)>(air?1.3:1.6)||Math.abs(this.y+.245-q.y)>1.6)continue;
   // On the ground the rail has to be ahead (or under) the bike within a hop's reach.
   const ahead=((q.x-this.x)*c+(q.z-this.z)*s)*dir,alongRail=Math.abs((r.b.x-r.a.x)*c+(r.b.z-r.a.z)*s)/r.length;
   if(q.u<-.05||q.u>1.05){if(air)continue;const nearEnd=q.u<0?r.a:r.b,gap=((nearEnd.x-this.x)*c+(nearEnd.z-this.z)*s)*dir;if(gap<0||gap>6.5||alongRail<.5)continue;}
   else if(!air&&ahead<-1.0&&q.u>.85)continue;
   const rank=q.distance+(q.u<0||q.u>1?.5:0);if(!best||rank<best.rank)best={id:r.id,rank};}
  return best?best.id:null;}
 snapshot(){const tricks={},trickCap={},active=[];for(const t of this.active){const spec=TRICKS[t.id];tricks[spec.pose]=t.pose||0;trickCap[spec.pose]=t.turnCap||spec.turns||1;active.push(t.id);}return interpolatePose(this,{trackId:this.env.id,trickCap,trackName:this.env.name,freeRoam:true,x:this.x,y:this.y,z:this.z,mode:this.mode,manual:this.manualKind,balance:this.balance,grind:this.grindState?.kind||null,grindRail:this.grindState?.rail.id||null,time:this.time,speed:this.mode==='crash'?0:Math.abs(this.mode!=='air'?this.v:Math.hypot(this.vx,this.vz)),signedSpeed:this.v,direction:this.v<0?-1:1,pitch:this.angle,heading:this.heading,yaw:-this.heading,travelHeading:this.mode==='air'?Math.atan2(this.vz,this.vx):this.heading+(this.v<0?Math.PI:0),roll:this.roll,steer:this.steering,lean:this.input.lean,pump:this.input.pump,crankAngle:this.crankAngle,compression:this.compression,wheelSpin:this.wheelSpin,tricks,active,combo:this.combo.map(t=>t.name),score:this.score,best:this.best,airHeight:this.airHeight,airMax:this.airMax,airtime:this.airtime,vy:this.vy,crashTilt:this.crashTilt,crashSpin:this.crashSpin||0,crashKick:this.crashKick||null,crashSlideDist:this.crashSlideDist||0,crashBikeSlideDist:this.crashBikeSlideDist||0,crashHeading:this.crashHeading||0,lastHop:this.lastHop,lipAir:!!this.lipAir&&this.mode==='air',flipTurn:this.mode==='air'?(this.rotation||0):0,flipRate:this.mode==='air'?(this.omega||0):0,airOrigin:this.airOrigin,airFlight:this.airFlight||0,airPhase:this.mode==='air'?(this.airPhase||0):0,turnRate:this.mode==='air'?(this.turnRate||0):0,targetRail:this.targetRail(),marker:!!this.marker,markerPos:this.marker?{x:this.marker.x,z:this.marker.z}:null,progress:this.env.progress?clamp(this.env.progress(this.x,this.z),0,1):0,pumpCue:this.mode==='grind'?this.grindState.kind.toUpperCase()+' • HOP TO EXIT':this.manualKind?this.manualKind.toUpperCase():this.mode==='ground'?(this.env.nextJump?this.trailCue():this.input.pump?'AIM FOR A RAMP':Math.abs(this.v)>.04?(this.v<0?'FAKIE • STEER ROUND OR BRAKE':'COASTING • HOLD PEDAL'):'HOLD PEDAL TO RIDE'):this.vy>0?'TRICK IN THE AIR':'RELEASE TRICK • LINE UP WHEELS',diving:false,landAssist:this.landAssist,feature:this.nearestRamp,lastImpact:this.lastImpact});}
}
