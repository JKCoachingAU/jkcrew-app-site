/** A single cancellable rAF chain. Static/hidden states consume no render frames. */
export class FrameLoop{
 constructor(tick,{raf=cb=>requestAnimationFrame(cb),caf=id=>cancelAnimationFrame(id),now=()=>performance.now()}={}){this.tick=tick;this.raf=raf;this.caf=caf;this.now=now;this.handle=0;this.running=false;this.last=0;this.bound=t=>this.frame(t);}
 start(){if(this.running)return;this.running=true;this.last=this.now();this.handle=this.raf(this.bound);}
 stop(){this.running=false;if(this.handle)this.caf(this.handle);this.handle=0;}
 frame(now){this.handle=0;if(!this.running)return;const dt=Math.max(0,(now-this.last)/1000);this.last=now;this.tick(dt,now);if(this.running)this.handle=this.raf(this.bound);}
}
