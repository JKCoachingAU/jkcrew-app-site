/** Project gravity into the current screen orientation, independent of compass heading. */
export function screenTilt(beta, gamma, angle = 90) {
  if (![beta, gamma, angle].every(Number.isFinite)) return null;
  const r = Math.PI / 180, b = beta*r, g = gamma*r, a = angle*r;
  const x = -Math.cos(b)*Math.sin(g), y = Math.sin(b);
  return Math.asin(Math.max(-1, Math.min(1, x*Math.cos(a)+y*Math.sin(a))))/r;
}
export function deadzone(value, zone, maximum) {
  return Math.sign(value)*Math.min(1, Math.max(0, Math.abs(value)-zone)/(maximum-zone));
}
export class MotionLean {
  constructor(onChange = ()=>{}) {
    this.enabled=false; this.value=0; this.neutral=null; this.raw=null;
    this.onChange=onChange; this.status='Touch lean'; this.lastSample=0; this.timer=0; this.requestId=0;
    this.onOrientation=e=>{
      if(!this.enabled)return;
      // A turned game (body.rotated: the phone held sideways with its viewport still portrait)
      // is landscape with the notch on the left, whatever the OS reports.
      const angle=(typeof document!=='undefined'&&document.body?.classList?.contains?.('rotated'))?90:(window.screen?.orientation?.angle ?? window.orientation ?? 90);
      const raw=screenTilt(e.beta,e.gamma,angle);
      if(raw===null)return;
      this.lastSample=performance.now(); this.raw=raw;
      if(this.neutral===null)this.neutral=raw;
      this.value=deadzone(raw-this.neutral,4,26);
      if(this.status!=='Tilt on'){this.status='Tilt on';this.onChange();}
    };
    window.addEventListener('deviceorientation',this.onOrientation);
    window.addEventListener('orientationchange',()=>this.calibrate());
  }
  available(){return Boolean(window.isSecureContext && window.DeviceOrientationEvent);}
  async enable(){
    const id=++this.requestId;
    if(!this.available()){this.status='Tilt needs HTTPS. Touch lean is ready.';this.onChange();return false;}
    try{
      const Event=window.DeviceOrientationEvent;
      const permission=typeof Event.requestPermission==='function'?await Event.requestPermission():'granted';
      if(id!==this.requestId)return false;
      if(permission!=='granted'){this.status='Tilt permission declined. Use touch lean.';this.onChange();return false;}
      this.enabled=true;this.neutral=null;this.value=0;this.status='Hold the phone comfortably…';this.onChange();
      this.lastSample=performance.now();const watch=()=>{if(!this.enabled)return;if(this.checkSignal())this.timer=setTimeout(watch,750);};this.timer=setTimeout(watch,750);
      return true;
    }catch{this.disable();this.status='Tilt unavailable. Touch lean is ready.';this.onChange();return false;}
  }
  checkSignal(now=performance.now()){if(now-this.lastSample>1800){this.disable();this.status='Tilt signal stopped. Touch lean is ready.';this.onChange();return false;}return true;}
  calibrate(){this.neutral=null;this.value=0;}
  disable(){this.requestId++;clearTimeout(this.timer);this.enabled=false;this.value=0;this.neutral=null;this.status='Touch lean';this.onChange();}
}
