import {trackAt,SEGMENTS,TRACK_END,resolveTrack} from './track.js';
export {trackAt,SEGMENTS,TRACK_END} from './track.js';
export const STEP=1/120,G=14;
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const wrap=x=>Math.atan2(Math.sin(x),Math.cos(x));
// Render interpolation ("fix your timestep"): the physics runs fixed 120 Hz steps and a
// frame rarely lands exactly on a step, so each step remembers where the bike was before it
// and the snapshot is read a fraction of a step back along that line — the rendered bike
// then moves the same distance every frame instead of skipping by up to a whole step when
// the frame rate and the step rate don't divide (a 90 Hz phone, a dropped frame).
export const POSE_FIELDS=['x','y','z','heading','angle','roll','wheelSpin','spin'];
export function rememberPose(p){const o=p.prevPose||(p.prevPose={});for(const k of POSE_FIELDS)o[k]=p[k];o.mode=p.mode;}
export function interpolatePose(p,s){const o=p.prevPose;if(!o||o.mode!==p.mode||p.mode==='crash')return s;const a=clamp(p.accumulator/STEP,0,1);if(a>=1)return s;
 const mix=k=>o[k]+(p[k]-o[k])*a;
 s.x=mix('x');s.y=mix('y');if(typeof p.z==='number'&&typeof o.z==='number')s.z=mix('z');s.pitch=mix('angle');if(typeof p.wheelSpin==='number')s.wheelSpin=mix('wheelSpin');
 if(typeof p.roll==='number'&&s.roll!==undefined)s.roll=mix('roll');
 if(s.heading!==undefined&&typeof p.heading==='number'){const h=o.heading+wrap(p.heading-o.heading)*a;s.heading=h;s.yaw=-h;}
 else if(p.mode==='air'&&typeof p.spin==='number'&&typeof o.spin==='number')s.yaw=mix('spin');
 return s;}
const TAU=Math.PI*2;
export const TRICKS={
 barspin:{name:'Barspin',duration:.45,points:200,pose:'barspin'},tailwhip:{name:'Tailwhip',duration:.54,points:350,pose:'tailwhip'},
 tabletop:{name:'Tabletop',duration:.50,points:180,pose:'tabletop'},turndown:{name:'Turndown',duration:.52,points:250,pose:'turndown'},
 doublebarspin:{name:'Double barspin',duration:.78,points:450,pose:'barspin',turns:2},doubletailwhip:{name:'Double tailwhip',duration:.86,points:750,pose:'tailwhip',turns:2},
 triplebarspin:{name:'Triple barspin',duration:1.0,points:750,pose:'barspin',turns:3},tripletailwhip:{name:'Triple tailwhip',duration:1.14,points:1200,pose:'tailwhip',turns:3},
 invert:{name:'Invert',duration:.62,points:350,pose:'invert'},nohander:{name:'No hander',duration:.65,points:400,pose:'nohander'}
,
 cancan:{name:'Can-can',duration:.5,points:230,pose:'cancan'},toboggan:{name:'Toboggan',duration:.5,points:230,pose:'toboggan'},superman:{name:'Superman',duration:.6,points:350,pose:'superman'},
 onehandtable:{name:'One-hand table',duration:.55,points:320,pose:'onehandtable'},suicide:{name:'Suicide no-hander',duration:.6,points:350,pose:'suicide'},decade:{name:'Decade',duration:.75,points:500,pose:'decade'},nofootcancan:{name:'No-foot can-can',duration:.6,points:350,pose:'nofootcancan'},kickout:{name:'Kickout',duration:.5,points:300,pose:'kickout'},xup:{name:'X-up',duration:.5,points:250,pose:'xup'},bikeflip:{name:'Bikeflip',duration:.75,points:600,pose:'bikeflip'},cliffhanger:{name:'Cliffhanger',duration:.65,points:450,pose:'cliffhanger'},
 // T3: the seat grab, the tuck, the bike flipped forward under the rider, the X-up with a foot
 // out, the frame swung out and back, the no-foot can-can with a hand off, the can-can with
 // the front tyre grabbed, and the leg kicked back over the rear of the bike.
 indy:{name:'Indy',duration:.55,points:320,pose:'indy'},cannonball:{name:'Cannonball',duration:.55,points:340,pose:'cannonball'},frontbikeflip:{name:'Front bikeflip',duration:.8,points:700,pose:'frontbikeflip'},onefootxup:{name:'One-foot X-up',duration:.55,points:360,pose:'onefootxup'},pendulum:{name:'Pendulum',duration:.7,points:450,pose:'pendulum'},nofootcanonehander:{name:'No-foot can one-hander',duration:.65,points:480,pose:'nofootcanonehander'},cancantyregrab:{name:'Can-can tyre grab',duration:.6,points:440,pose:'cancantyregrab'},nacnac:{name:'Nac-nac',duration:.55,points:330,pose:'nacnac'}
};
export const ADVANCED={barspin:'doublebarspin',tailwhip:'doubletailwhip',tabletop:'invert',turndown:'nohander'};
// Holding a rotating trick past its single-turn duration steps it up to the next tier.
export const UPGRADE_TRICK={barspin:'doublebarspin',doublebarspin:'triplebarspin',tailwhip:'doubletailwhip',doubletailwhip:'tripletailwhip'};
export class GamePhysics{
 constructor({track='medium',env}={}){this.track=resolveTrack(track);this.env=env;this.reset(true);}
 setTrack(track){this.track=resolveTrack(track);this.reset(true);}
 reset(clear=false){const score=clear?0:this.score||0,best=clear?0:this.best||0;if(clear)this.checkpoint=null;Object.assign(this,{x:this.track.start.x,y:trackAt(this.track.start.x,this.track).height,z:0,v:this.track.start.speed,vx:0,vy:0,mode:'ground',time:0,airtime:0,score,best,angle:0,omega:0,preLean:0,spin:0,spinStart:0,fakie:false,spinVelocity:0,spinHeld:false,spinHeldTime:0,rotation:0,flipCount:0,combo:[],active:[],events:[],input:{lean:0,pump:false,brake:false,spin:false,advanced:false},wheelSpin:0,pumpCharge:0,pumpGrace:this.track.pumpGrace,airOrigin:0,airPeak:0,airHeight:0,airMax:0,maxHeight:0,launches:0,landings:0,crashes:0,accumulator:0,pending:null,stable:0,lastLanding:null,crashTilt:0,hopQueued:false,buffered:[],jumpCooldown:0,releaseBonus:false,landAssist:false,finished:false,crashReason:null,stalled:0,bufferUntil:0});}
 setInput(next){const held=this.input.pump;this.input={...this.input,...next};this.input.lean=clamp(Number(this.input.lean)||0,-1,1);if(held&&!this.input.pump&&this.mode==='air'&&this.airtime<=this.pumpGrace&&!this.releaseBonus){this.releaseBonus=true;this.events.push({type:'release',quality:'Good release'});}}
 hop(){if(this.mode!=='ground'||this.jumpCooldown>0)return false;this.hopQueued=true;return true;}
 trick(id,{held=false}={}){if(this.input.advanced&&ADVANCED[id])id=ADVANCED[id];if(!TRICKS[id])return {ok:false,reason:'Unknown trick'};if(this.mode==='ground'){const q=trackAt(this.x,this.track),nearLip=q.lip!==null&&q.lip-this.x<Math.max(0,this.v*Math.cos(this.angle))*.16;if(this.hopQueued||nearLip){this.buffered=[{id,held}];this.bufferUntil=this.time+.18;return {ok:true,buffered:true};}}if(this.mode!=='air')return {ok:false,reason:'Take it to the air'};const spec=TRICKS[id];if(this.active.some(t=>TRICKS[t.id].pose===spec.pose))return {ok:false,reason:'Finish this trick first'};this.active.push({id,t:0,held,wasHeld:held,releasing:false,releaseT:0,pose:0,releaseFrom:0});this.events.push({type:'trick-start',name:spec.name});return {ok:true};}
 releaseTrick({cancelBuffered=false}={}){if(cancelBuffered)this.buffered=[];for(const t of this.active)if(t.held){t.held=false;t.releasing=true;t.releaseT=0;t.releaseFrom=t.pose;}for(const t of this.buffered)if(typeof t==='object')t.held=false;}
 advance(dt,input){if(input)this.setInput(input);this.accumulator+=clamp(dt,0,.1);while(this.accumulator>=STEP-1e-10){this.step(STEP);this.accumulator-=STEP;}return this;}
 step(dt=STEP){rememberPose(this);this.time+=dt;if(this.mode==='ground'&&this.time>this.bufferUntil&&!this.hopQueued)this.buffered=[];this.jumpCooldown=Math.max(0,this.jumpCooldown-dt);if(this.mode==='finished')return;if(this.mode==='crash'){this.crashTilt=Math.min(2.8,this.crashTilt+dt*10);this.vy-=G*dt;this.y=Math.max(trackAt(this.x,this.track).height+.1,this.y+this.vy*dt);return;}if(this.mode==='ground')this.ground(dt);else this.air(dt);this.wheelSpin+=Math.max(0,this.mode==='ground'?this.v:this.vx)*dt/.265;if(this.pending&&this.mode==='ground'){this.stable+=dt;if(this.stable>=.1)this.bank();}if(this.x>=this.track.end&&this.mode==='ground'){this.bank();this.mode='finished';this.finished=true;this.events.push({type:'finish',score:this.score,best:this.best,time:this.time});}}
 ground(dt){const p=trackAt(this.x,this.track);if(!p.solid){this.launch(p,0,false);return;}const slope=p.slope,theta=Math.atan(slope),u=this.input;this.angle=theta;this.preLean+=(-u.lean*2.5-this.preLean)*Math.min(1,dt*8);this.pumpCharge=clamp(this.pumpCharge+(u.pump?dt*1.4:-dt*3),0,1);const pedal=u.pump&&!u.brake?(2.6+21*Math.max(0,-Math.sin(theta)))*Math.max(.1,1-this.v/21):0;let a=-G*Math.sin(theta)+pedal-.055*this.v;
   if(u.brake){this.v=Math.max(0,this.v-18*dt);a=Math.min(0,a);}const oldX=this.x,oldV=this.v;this.v=clamp(this.v+a*dt,0,19);this.x+=(oldV+this.v)*.5*Math.cos(theta)*dt;this.stalled=this.v<.15&&slope>.12&&!u.brake?this.stalled+dt:0;if(this.stalled>1.5){this.crash('Lost your momentum. Pump the approach and try again.');return;}const s=this.track.segments[p.segment];
   if(p.lip!==null&&this.x>=p.lip){const f=clamp((p.lip-oldX)/(this.x-oldX),0,1);this.x=p.lip;this.v=oldV+a*dt*f;this.y=trackAt(this.x,this.track).height;this.angle=Math.atan(s[5]);this.launch(trackAt(this.x,this.track),this.pumpCharge*1.05,false);if(f<1)this.air(dt*(1-f));return;}
   const q=trackAt(this.x,this.track);this.y=q.height;this.angle=Math.atan(q.slope);if(this.hopQueued){this.hopQueued=false;this.jumpCooldown=.3;this.launch(q,3,true);}
 }
 launch(p,pop,hop){this.bank();this.mode='air';this.hopQueued=false;this.launches++;this.airtime=0;this.vx=Math.max(1.5,this.v*Math.cos(this.angle));this.vy=this.v*Math.sin(this.angle)+pop;this.y+=.015;this.omega=this.preLean;this.spinStart=this.fakie?Math.PI:0;this.spin=this.spinStart;this.spinVelocity=0;this.spinHeld=false;this.spinHeldTime=0;this.rotation=0;this.flipCount=0;this.active=[];this.combo=[];this.airOrigin=this.y;this.airPeak=this.y;this.airHeight=0;this.airMax=0;this.releaseBonus=false;this.landAssist=false;this.pending=null;this.stable=0;this.events.push({type:'launch',hop});if(hop)this.combo.push({name:'Bunny hop',points:80});for(const queued of this.buffered.splice(0))this.trick(queued.id||queued,{held:queued.held||false});}
 air(dt){this.airtime+=dt;const u=this.input,diving=u.pump&&this.airtime>this.pumpGrace;const g=G+(diving?17*clamp((this.airtime-this.pumpGrace)/.12,0,1):0),oldX=this.x,oldY=this.y;this.x+=this.vx*dt;this.y+=this.vy*dt-g*.5*dt*dt;this.vy-=g*dt;
   if(Math.abs(u.lean)>.04)this.omega=clamp(this.omega-u.lean*17*dt,-9,9);else this.omega*=Math.exp(-dt*5.5);const rotation=this.omega*dt;this.angle+=rotation;this.rotation+=rotation;if(u.spin&&!this.spinHeld){this.spinVelocity=(u.spinDirection||1)*3.6;this.spinHeldTime=0;}this.spinHeld=u.spin;if(u.spin)this.spinHeldTime+=dt;
   // Spins the Pumped BMX way: a tap starts a rotation, holding spins faster, and letting go
   // lets the turn carry on to the next half-turn and stop square there — so a tap is a 180,
   // a longer hold a 360, and the length of the air never decides how far you rotate.
   if(u.spin)this.spinVelocity+=((u.spinDirection||1)*(this.spinHeldTime<.18?3.6:u.pump?8:7.5)-this.spinVelocity)*Math.min(1,dt*5);else this.spinVelocity*=Math.exp(-dt*.4);
   const spinBefore=this.spin;this.spin+=this.spinVelocity*dt;
   if(!u.spin&&this.spinVelocity!==0){const k0=Math.floor(spinBefore/Math.PI+1e-9),k1=Math.floor(this.spin/Math.PI+1e-9);if(k0!==k1){this.spin=(this.spinVelocity>0?k1:k0)*Math.PI;this.spinVelocity=0;}}
   const flips=Math.floor((Math.abs(this.rotation)+.08)/TAU);if(flips>this.flipCount){this.combo.push({name:this.rotation>0?'Backflip':'Frontflip',points:600});this.flipCount=flips;this.events.push({type:'trick-complete',name:this.rotation>0?'Backflip':'Frontflip'});}
   this.active=this.active.filter(t=>{
     t.t+=dt;const spec=TRICKS[t.id],rotating=['barspin','tailwhip','decade','bikeflip','frontbikeflip','pendulum'].includes(spec.pose);
     if(t.held){t.pose=rotating?Math.min(.999,t.t/spec.duration):Math.min(.5,t.t/.44);return true;}
     if(t.releasing){t.releaseT+=dt;t.pose=rotating?Math.min(1,t.t/spec.duration):t.releaseFrom+(1-t.releaseFrom)*clamp(t.releaseT/.14,0,1);if(rotating?t.t<spec.duration:t.releaseT<.14)return true;}
     else {t.pose=t.t/spec.duration;if(t.t<spec.duration)return true;}
     const points=Math.round(spec.points*(t.wasHeld?1+Math.min(.5,Math.max(0,t.t-spec.duration)*.35):1));
     this.combo.push({name:spec.name,points});this.events.push({type:'trick-complete',name:spec.name});return false;
   });
   const terrain=trackAt(this.x,this.track),clearance=this.y-terrain.height;
   // Small final alignment correction only near the slope, with neutral lean and low spin.
   this.landAssist=false;if(terrain.solid&&this.vy<0&&clearance<2.1&&Math.abs(u.lean)<.04&&Math.abs(this.omega)<3.5){const target=Math.atan(terrain.slope),error=wrap(target-this.angle);if(Math.abs(error)<1.35){this.angle+=error*(1-Math.exp(-dt*12));this.omega*=Math.exp(-dt*8);this.landAssist=true;}}
   this.airPeak=Math.max(this.airPeak,this.y);this.airHeight=Math.max(0,this.y-this.airOrigin);this.airMax=Math.max(this.airMax,this.airHeight);this.maxHeight=Math.max(this.maxHeight,this.airMax);
   if(terrain.solid&&this.y<=terrain.height){const prev=trackAt(oldX,this.track);if(!prev.solid&&oldY<terrain.height-.3){this.crash('You came up short. Release PUMP at takeoff.');return;}let a=0,b=1;for(let i=0;i<9;i++){const m=(a+b)*.5,x=oldX+(this.x-oldX)*m,y=oldY+(this.y-oldY)*m,q=trackAt(x,this.track);if(!q.solid||y>q.height)a=m;else b=m;}this.x=oldX+(this.x-oldX)*b;const hit=trackAt(this.x,this.track);this.y=hit.height;this.land(hit);return;}
   if(this.y<-2.3||this.airtime>5)this.crash('Missed the landing. Release PUMP for more air.');
 }
 land(p){const target=Math.atan(p.slope),error=Math.abs(wrap(this.angle-target)),yawError=Math.min(Math.abs(wrap(this.spin)),Math.abs(wrap(this.spin-Math.PI))),impact=-(this.vy*Math.cos(target)-this.vx*Math.sin(target));this.lastLanding={pitchError:error,yawError,impact,unfinished:this.active.length>0,airtime:this.airtime};if(this.active.length){this.crash('The trick wasn’t finished.');return;}if(error>.95){this.crash('Match the wheels to the landing.');return;}if(yawError>.65){this.crash('Finish the spin before landing.');return;}if(impact>(this.input.pump?18:14)){this.crash('Too steep. Catch the downslope.');return;}
   const landedFlips=Math.abs(Math.round((this.angle-target)/TAU));if(landedFlips>this.flipCount&&Math.abs(this.rotation)>Math.PI*1.35){for(let i=this.flipCount;i<landedFlips;i++)this.combo.push({name:this.rotation>0?'Backflip':'Frontflip',points:600});this.flipCount=landedFlips;}this.fakie=Math.cos(this.spin)<0;const turns=Math.round((this.spin-this.spinStart)/Math.PI);if(turns!==0)this.combo.push({name:(turns<0?'Opposite ':'')+(Math.abs(turns)*180)+' spin',points:Math.abs(turns)*200});const clean=error<.35&&yawError<.28;this.mode='ground';this.landings++;this.angle=target;this.omega=0;const tangent=this.vx*Math.cos(target)+this.vy*Math.sin(target);this.v=Math.max(2,tangent*(clean?.99:.91)+(this.input.pump?1.25:0));this.pending={names:this.combo.map(t=>t.name),points:Math.round(this.combo.reduce((n,t)=>n+t.points,0)*(1+Math.max(0,this.combo.length-1)*.5)*(clean?1.1:1)),quality:clean?'Perfect landing':'Landed',air:this.airMax};this.combo=[];this.stable=0;this.events.push({type:'contact',impact:Math.max(0,impact)});
 }
 bank(){if(!this.pending)return;this.score+=this.pending.points;this.best=Math.max(this.best,this.pending.points);this.events.push({type:'land',...this.pending});this.pending=null;
  // Every safely banked landing is a checkpoint: a crash recovers here instead of sending a
  // whole course back to its start, while the deliberate RESET control still restarts the run.
  this.checkpoint={x:this.x,v:Math.max(this.track.start.speed,this.v)};}
 // Crash recovery only (distinct from reset()/RESET, which always restarts the whole run):
 // respawn on two wheels at the last banked checkpoint, or the start if none exists yet.
 recover(){if(this.mode!=='crash')return false;const cp=this.checkpoint,x=cp?cp.x:this.track.start.x,v=cp?cp.v:this.track.start.speed;
  Object.assign(this,{x,y:trackAt(x,this.track).height,z:0,v,vx:0,vy:0,mode:'ground',time:this.time,airtime:0,angle:0,omega:0,preLean:0,spin:0,spinStart:0,fakie:false,spinVelocity:0,spinHeld:false,spinHeldTime:0,rotation:0,flipCount:0,combo:[],active:[],wheelSpin:this.wheelSpin,pumpCharge:0,airOrigin:0,airPeak:0,airHeight:0,airMax:0,pending:null,stable:0,crashTilt:0,hopQueued:false,buffered:[],jumpCooldown:0,releaseBonus:false,landAssist:false,finished:false,crashReason:null,stalled:0,input:{...this.input,pump:false,brake:false,spin:false}});
  this.events.push({type:'checkpoint-recover',atStart:!cp});return true;}
 crash(reason){this.mode='crash';this.crashes++;this.crashReason=reason;this.pending=null;this.combo=[];this.active=[];this.crashSpin=(Math.random()<.5?-1:1)*(1.6+Math.random()*2);this.events.push({type:'crash',reason});}
 drainEvents(){return this.events.splice(0);}
 snapshot(){const tricks={},active=[];for(const t of this.active){const spec=TRICKS[t.id];tricks[spec.pose]=(t.pose||0)*(spec.turns||1);active.push(t.id);}const p=trackAt(this.x,this.track);return interpolatePose(this,{trackId:this.track.id,trackName:this.track.name,x:this.x,y:this.y,z:0,mode:this.mode,time:this.time,speed:['crash','finished'].includes(this.mode)?0:this.mode==='ground'?this.v:this.vx,direction:1,cameraDirection:1,pitch:this.angle,baseYaw:0,yaw:this.mode==='air'?this.spin:this.fakie?Math.PI:0,flip:0,lean:this.input.lean,steer:0,pump:this.input.pump,wheelSpin:this.wheelSpin,tricks,active,combo:this.combo.map(t=>t.name),score:this.score,best:this.best,airHeight:this.airHeight,airMax:this.airMax,airtime:this.airtime,crashTilt:this.crashTilt,crashSpin:this.crashSpin||0,progress:clamp(this.x/this.track.end,0,1),pumpCue:this.mode==='ground'?(p.lip&&p.lip-this.x<2?'RELEASE AT THE LIP':this.input.pump?'KEEP PUMPING':'HOLD PUMP'):this.airtime<=this.pumpGrace?'RELEASE PUMP':this.vy<0?'PUMP INTO THE LANDING':'LEAN + TRICK',diving:this.mode==='air'&&this.input.pump&&this.airtime>this.pumpGrace,landAssist:this.landAssist});}
}
