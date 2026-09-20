import {TIERS,sector} from './control-map.js';
import {deadzone,MotionLean} from './motion.js';
/** Right thumb: the trick stick, T1/T2/T3 above PEDAL. Left thumb: the analog pad — steer and
 * balance in a park; in the air (and on a flow line) left/right spin, up front flip, down
 * backflip. Motion can supply the flip lean on flow lines instead. */
export class InputController {
  constructor({hop,trick,releaseTrick=()=>{},reset,pause,unlock,marker=()=>{},mode=()=> 'ground',changed=()=>{},freeRoam=()=>false}){
    this.keys=new Set();this.pointers=new Map();this.joy=null;this.enabled=false;
    this.tier=0;this.opposite=false;this.selection=null;this.lastTap=-Infinity;
    this.freeRoam=freeRoam;this.steerX=0;this.leanY=0;this.steerPointer=null;this.mode=mode;this.changed=changed;this.releaseTrick=releaseTrick;this.motion=new MotionLean(changed);
    const find=id=>document.querySelector(id);
    // On a phone held upright the game is drawn turned 90° (body.rotated): pointer positions
    // arrive in screen space, so they are mapped into the game's own frame here (game x runs
    // down the screen, game y runs from right to left), and element boxes are read the same
    // way — every stick and button then works in its own coordinates, turned or not.
    const rotated=()=>!!document.body?.classList?.contains?.('rotated');
    const point=e=>rotated()?{x:e.clientY,y:innerWidth-e.clientX}:{x:e.clientX,y:e.clientY};
    const rect=el=>{const b=el.getBoundingClientRect();if(!rotated())return {left:b.left,top:b.top,width:b.width,height:b.height};return {left:b.top,top:innerWidth-b.left-b.width,width:b.height,height:b.width};};
    this.pointAt=point;this.rectOf=rect;
    this.stick=find('#stick');this.label=find('#stick-name');
    // The trick set (T1 basic, T2 advanced, T3 the grabs and variations) is sticky: it stays
    // until another button is tapped (or T cycles it on a keyboard).
    this.tierButtons=Array.from(document.querySelectorAll?.('.tier-btn')||[]);
    const setTier=t=>{this.tier=((t%TIERS.length)+TIERS.length)%TIERS.length;for(const b of this.tierButtons){const on=Number(b.dataset?.tier)===this.tier;b.classList?.toggle?.('active',on);b.setAttribute?.('aria-pressed',String(on));}changed();};this.setTier=setTier;
    const choose=(index,held=false)=>{
      const map=TIERS[this.tier],id=map[index];
      this.selection=index;this.lastSelectedMap=map;trick(id,{held});changed();
    };
    this.choose=choose;
    this.crouch=0;this.hHoldStart=null;
    const drive=(id,name)=>{
      const el=find(id);
      el.addEventListener('pointerdown',e=>{
        if(!this.enabled)return;e.preventDefault();unlock();
        el.setPointerCapture(e.pointerId);const q=point(e);this.pointers.set(e.pointerId,{name,startX:q.x,startY:q.y,dx:0,dy:0,peakDy:0,peakUpSpeed:0,lastT:e.timeStamp||performance.now(),startT:e.timeStamp||performance.now(),lastDy:0,hopFired:false});el.classList.add('active');
      });
      el.addEventListener('pointermove',e=>{
        const p=this.pointers.get(e.pointerId);if(!p)return;const q=point(e);p.dx=q.x-p.startX;
        // Pedal, in free roam only: drag down to crouch/preload, flick back up to bunny hop.
        // charge tracks how far it was dragged down (the preload); flickSpeed tracks how fast
        // it snapped back up, so a fast short flick and a slow deep crouch can both pop high.
        if(name==='pump'&&this.freeRoam()){
          const dy=q.y-p.startY,t=e.timeStamp||performance.now(),dt=Math.max(1,t-p.lastT),upSpeed=Math.max(0,(p.lastDy-dy)/dt);
          p.peakUpSpeed=Math.max(p.peakUpSpeed,upSpeed);p.dy=dy;p.peakDy=Math.max(p.peakDy,dy);this.crouch=Math.max(0,Math.min(1,dy/68));
          if(!p.hopFired&&p.peakDy>24&&dy<p.peakDy-22){
            p.hopFired=true;const charge=Math.max(0,Math.min(1,p.peakDy/70)),flickSpeed=Math.max(0,Math.min(1,p.peakUpSpeed/1.1));
            this.crouch=0;hop(charge,flickSpeed);
          }
          p.lastT=t;p.lastDy=dy;
        }
        this.updateDrive();
      });
      const release=e=>{const p=this.pointers.get(e.pointerId);this.pointers.delete(e.pointerId);if(![...this.pointers.values()].some(p=>p.name===name))el.classList.remove('active');
        // Free roam: a quick tap on PEDAL (no drag, under 220 ms) is a plain bunny hop — the
        // instant, reliable hop for lining up a grind — while holding it still pedals and the
        // drag-down-flick-up gesture still gives the bigger charged hop. Event timestamps
        // (not processing time) decide the tap, so a busy frame on a slow phone can't eat it.
        if(p&&name==='pump'&&this.freeRoam()&&e.type==='pointerup'&&!p.hopFired&&(e.timeStamp||performance.now())-p.startT<220&&Math.abs(p.dx)<12&&p.peakDy<12&&this.enabled)hop(.35,.45);
        if(name==='pump')this.crouch=0;this.updateDrive();};
      for(const event of ['pointerup','pointercancel','lostpointercapture'])el.addEventListener(event,release);
    };
    drive('#pump-btn','pump');drive('#brake-btn','brake');
    for(const b of this.tierButtons)b.addEventListener('pointerdown',e=>{if(!this.enabled)return;e.preventDefault();setTier(Number(b.dataset?.tier)||0);});
    const joy=find('#joystick');
    const move=e=>{
      if(!this.joy||e.pointerId!==this.joy.id)return;
      const b=rect(joy),q=point(e),dx=q.x-b.left-b.width/2,dy=q.y-b.top-b.height/2;
      const length=Math.hypot(dx,dy),max=b.width*.32,k=Math.min(1,max/(length||1));
      this.stick.style.transform=`translate(${dx*k}px,${dy*k}px)`;
      if(length<14){if(!this.joy.armed)releaseTrick();this.joy.armed=true;this.selection=null;return;}
      if(length<24||!this.joy.armed)return;
      this.joy.moved=true;this.joy.armed=false;choose(sector(dx,dy),true);
    };
    joy.addEventListener('pointerdown',e=>{if(!this.enabled||this.joy)return;e.preventDefault();unlock();joy.setPointerCapture(e.pointerId);this.joy={id:e.pointerId,armed:true,moved:false,start:performance.now()};move(e);});
    joy.addEventListener('pointermove',move);
    const release=e=>{
      if(!this.joy||e.pointerId!==this.joy.id)return;
      releaseTrick({cancelBuffered:e.type!=='pointerup'});this.joy=null;this.selection=null;this.stick.style.transform='';changed();
    };
    for(const event of ['pointerup','pointercancel','lostpointercapture'])joy.addEventListener(event,release);
    // Steering pad. On a phone the whole lower-left of the screen is the pad's zone and the
    // ring appears wherever the thumb lands (a floating stick), so steering never needs a
    // glance to find it and the thumb's own landing spot is neutral; it slides home again on
    // release. On a desktop or tablet the ring stays put and works as before.
    const steering=find('#steering');if(steering){const stick=find('#steer-stick'),zone=steering.parentElement||steering,floating=()=>!!document.body?.classList?.contains('phone');
     const place=e=>{if(!floating())return;const z=rect(zone),r=rect(steering),q=point(e),w=r.width||136,h=r.height||136,x=Math.max(w*.5,Math.min(z.width-w*.5,q.x-z.left)),y=Math.max(h*.5,Math.min(z.height-h*.5,q.y-z.top));steering.style.left=(x-w/2)+'px';steering.style.top=(y-h/2)+'px';steering.style.right='auto';steering.style.bottom='auto';steering.classList.add('floating');};
     const home=()=>{steering.style.left=steering.style.top=steering.style.right=steering.style.bottom='';steering.classList.remove('floating');};this.homeSteer=home;
     const moveSteer=e=>{if(this.steerPointer!==e.pointerId)return;const b=rect(steering),q=point(e),dx=q.x-b.left-b.width/2,dy=q.y-b.top-b.height/2;this.steerX=deadzone(dx,9,b.width*.36);this.leanY=deadzone(-dy,12,b.height*.36);const len=Math.hypot(dx,dy),k=Math.min(1,b.width*.32/(len||1));stick.style.transform=`translate(${dx*k}px,${dy*k}px)`;};
     zone.addEventListener('pointerdown',e=>{if(!this.enabled||this.steerPointer!==null)return;e.preventDefault();unlock();zone.setPointerCapture(e.pointerId);this.steerPointer=e.pointerId;place(e);moveSteer(e);});zone.addEventListener('pointermove',moveSteer);for(const type of ['pointerup','pointercancel','lostpointercapture'])zone.addEventListener(type,e=>{if(e.pointerId!==this.steerPointer)return;this.steerPointer=null;this.steerX=this.leanY=0;stick.style.transform='';home();});}
    const gameKeys=new Set(['Space','KeyE','KeyH','KeyM','KeyR','Escape','KeyQ','KeyT','ShiftLeft','ShiftRight','KeyA','KeyD','ArrowLeft','ArrowRight','KeyW','KeyS','ArrowUp','ArrowDown',...Array.from({length:8},(_,i)=>'Digit'+(i+1))]);
    window.addEventListener('keydown',e=>{
      if(gameKeys.has(e.code))e.preventDefault();
      if(e.code==='Escape'&&!e.repeat){pause();return;}
      if(e.code==='KeyR'&&!e.repeat){reset();return;}
      if(!this.enabled)return;this.keys.add(e.code);if(e.repeat)return;unlock();
      // Free roam: holding H charges the hop like dragging Pedal down; releasing pops it,
      // a longer hold reaching a bigger charge. Elsewhere H still fires an instant hop.
      if(e.code==='KeyH'){if(freeRoam())this.hHoldStart=performance.now();else hop();}
      else if(e.code==='KeyM'&&freeRoam())marker();else if(e.code==='KeyT')setTier(this.tier+1);else if(/^Digit[1-8]$/.test(e.code)){if(!e.repeat)choose(Number(e.code.slice(-1))-1,true);}
    });
    window.addEventListener('keyup',e=>{
      this.keys.delete(e.code);
      // A trick key held down keeps a whip or barspin turning (double, triple); letting go catches it.
      if(/^Digit[1-8]$/.test(e.code))releaseTrick();
      if(e.code==='KeyH'&&this.hHoldStart!=null){
        const charge=Math.max(0,Math.min(1,(performance.now()-this.hHoldStart)/480));this.hHoldStart=null;hop(charge,.55);
      }
    });
    window.addEventListener('blur',()=>this.clear());
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.clear();});
  }
  updateDrive(){}
  state(){
    const roam=this.freeRoam(),k=this.keys,holds=[...this.pointers.values()];
    // The pad's axes: x steers (a park) or spins (the air, a flow line), y balances (a park,
    // on the ground) or flips (up = front flip, down = backflip). The keyboard mirrors it:
    // A/D and W/S. Spin direction: +1 is a left (anti-clockwise) spin — the pad's side when
    // it is pushed, otherwise the rider's preference from the home page.
    const keyX=(k.has('KeyD')||k.has('ArrowRight')?1:0)-(k.has('KeyA')||k.has('ArrowLeft')?1:0),keyY=(k.has('KeyW')||k.has('ArrowUp')?1:0)-(k.has('KeyS')||k.has('ArrowDown')?1:0);
    const padX=Math.max(-1,Math.min(1,this.steerX+keyX)),padY=Math.max(-1,Math.min(1,this.leanY+keyY));
    return {
      lean:roam?padY:Math.max(-1,Math.min(1,(this.motion.enabled?this.motion.value:0)+padY)),
      ...(roam?{steer:padX,crouch:Math.max(this.crouch||0,this.hHoldStart!=null?Math.min(1,(performance.now()-this.hHoldStart)/480):0)}:{}),
      pump:holds.some(p=>p.name==='pump')||k.has('Space')||k.has('KeyE'),
      spin:(!roam&&Math.abs(padX)>.5)||k.has('KeyQ'),
      spinDirection:!roam&&Math.abs(padX)>.5?(padX<0?1:-1):(this.opposite?-1:1),
      advanced:false,
      brake:holds.some(p=>p.name==='brake')||k.has('ShiftLeft')||k.has('ShiftRight')
    };
  }
  clear(){this.steerPointer=null;this.steerX=this.leanY=0;this.crouch=0;this.hHoldStart=null;const steerStick=document.querySelector('#steer-stick');if(steerStick)steerStick.style.transform='';if(this.homeSteer)this.homeSteer();this.lastTap=-Infinity;this.releaseTrick({cancelBuffered:true});this.keys.clear();this.pointers.clear();this.joy=null;this.selection=null;this.stick.style.transform='';document.querySelectorAll('.hold-control').forEach(el=>el.classList.remove('active','leaning'));for(const b of this.tierButtons)b.classList?.toggle?.('active',Number(b.dataset?.tier)===this.tier);this.motion.calibrate();}
}
