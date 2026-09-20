/** Original synthesized ride audio: looped tyre/freewheel/wind/grind beds plus one-shot
 * impact/trick sounds, all generated from noise buffers and oscillators. No samples,
 * no per-frame oscillator allocation for the continuous loops. Aims for the layered,
 * physical feel of a free-roam BMX park — rolling tyre, freewheel ratchet, wind rush
 * in the air, a harsh rail screech and a soft ambient bed — without copying any
 * commercial game's actual audio assets or code. */
function noiseBuffer(c,seconds,smoothing){
 const b=c.createBuffer(1,Math.max(1,Math.round(c.sampleRate*seconds)),c.sampleRate),d=b.getChannelData(0);
 let prev=0;for(let i=0;i<d.length;i++){prev=(prev+(Math.random()*2-1)*(1-smoothing))/(2-smoothing);d[i]=prev;}
 return b;
}
function clickBuffer(c,teeth=10,decay=20,volume=.22){
 const b=c.createBuffer(1,c.sampleRate,c.sampleRate),d=b.getChannelData(0);
 for(let i=0;i<teeth;i++)for(let j=0;j<180;j++)d[Math.floor(i*c.sampleRate/teeth)+j]=(Math.random()*2-1)*Math.exp(-j/decay)*volume;
 return b;
}
function loopSource(c,buffer,rate=1){const s=c.createBufferSource();s.buffer=buffer;s.loop=true;s.playbackRate.value=rate;s.start();return s;}
export class RideAudio{
 constructor(){this.enabled=false;this.context=null;this.lastUpdate=0;this.wantsRunning=false;}
 async unlock(){
  if(!this.enabled)return;this.wantsRunning=true;
  if(!this.context){
   const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;
   const c=this.context=new Audio();
   this.master=c.createGain();this.master.gain.value=.34;
   this.compressor=c.createDynamicsCompressor();this.compressor.threshold.value=-20;this.compressor.knee.value=16;this.compressor.ratio.value=3.5;this.compressor.attack.value=.004;this.compressor.release.value=.22;
   this.master.connect(this.compressor).connect(c.destination);
   // Rolling tyre: filtered rumble that brightens and rises with ground speed.
   this.noise=loopSource(c,noiseBuffer(c,2,.90));this.filter=c.createBiquadFilter();this.filter.type='lowpass';this.roll=c.createGain();this.roll.gain.value=0;
   this.noise.connect(this.filter).connect(this.roll).connect(this.master);
   // Freewheel ratchet clicks while coasting without pedaling.
   this.freewheel=loopSource(c,clickBuffer(c));this.clickGain=c.createGain();this.clickGain.gain.value=0;
   this.freewheel.connect(this.clickGain).connect(this.master);
   // Wind rush: smoother, higher noise bed that swells in the air and at speed.
   this.wind=loopSource(c,noiseBuffer(c,2.4,.975));this.windFilter=c.createBiquadFilter();this.windFilter.type='bandpass';this.windFilter.frequency.value=650;this.windFilter.Q.value=.5;this.windGain=c.createGain();this.windGain.gain.value=0;
   this.wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
   // Rail grind: harsh narrow-band metallic rasp, distinct from the tyre roll.
   this.grindNoise=loopSource(c,noiseBuffer(c,1,.35));this.grindFilter=c.createBiquadFilter();this.grindFilter.type='bandpass';this.grindFilter.frequency.value=2400;this.grindFilter.Q.value=7;this.grindGain=c.createGain();this.grindGain.gain.value=0;
   const grindFilter2=c.createBiquadFilter();grindFilter2.type='highpass';grindFilter2.frequency.value=1200;
   this.grindNoise.connect(this.grindFilter).connect(grindFilter2).connect(this.grindGain).connect(this.master);
   // Quiet ambient bed (distant hum/air) so the park never feels dead silent.
   this.ambient=loopSource(c,noiseBuffer(c,3,.985));this.ambientFilter=c.createBiquadFilter();this.ambientFilter.type='lowpass';this.ambientFilter.frequency.value=320;this.ambientGain=c.createGain();this.ambientGain.gain.value=0;
   this.ambient.connect(this.ambientFilter).connect(this.ambientGain).connect(this.master);
  }
  if(this.context.state==='suspended')try{await this.context.resume();if(!this.wantsRunning||!this.enabled)await this.context.suspend();}catch{}
 }
 async toggle(){this.enabled=!this.enabled;if(this.enabled)await this.unlock();else this.pause();return this.enabled;}
 pause(){this.wantsRunning=false;for(const g of [this.roll,this.clickGain,this.windGain,this.grindGain,this.ambientGain])if(g)g.gain.value=0;if(this.context&&this.context.state==='running')this.context.suspend().catch(()=>{});}
 update(s){
  if(!this.enabled||!this.context||this.context.state!=='running')return;const c=this.context,t=c.currentTime;if(t-this.lastUpdate<.05)return;this.lastUpdate=t;
  const ground=s.mode==='ground',grind=s.mode==='grind',air=s.mode==='air',v=Math.abs(s.speed);
  this.roll.gain.setTargetAtTime(grind?0:ground?Math.min(.55,v*.026):.045,t,.06);
  this.filter.frequency.setTargetAtTime(ground?220+v*40:900,t,.08);
  this.clickGain.gain.setTargetAtTime(ground&&!s.pump?.16:0,t,.06);
  this.freewheel.playbackRate.setTargetAtTime(Math.max(.3,v*.1),t,.08);
  const airtime=s.airtime||0,windTarget=grind?0:air?Math.min(.42,.05+airtime*.11+v*.012):ground?Math.min(.14,Math.max(0,v-9)*.03):0;
  this.windGain.gain.setTargetAtTime(windTarget,t,.16);this.windFilter.frequency.setTargetAtTime(480+v*32,t,.2);
  this.grindGain.gain.setTargetAtTime(grind?Math.min(.5,.24+v*.018):0,t,.045);this.grindFilter.frequency.setTargetAtTime(2100+v*65,t,.09);
  this.ambientGain.gain.setTargetAtTime(s.freeRoam?.045:.02,t,.6);
 }
 tone(frequency,duration,volume=.1,type='sine'){if(!this.enabled||!this.context||this.context.state!=='running')return;const c=this.context,o=c.createOscillator(),g=c.createGain();o.type=type;o.frequency.setValueAtTime(frequency,c.currentTime);g.gain.setValueAtTime(volume,c.currentTime);g.gain.exponentialRampToValueAtTime(.0001,c.currentTime+duration);o.connect(g).connect(this.master);o.onended=()=>{o.disconnect();g.disconnect();};o.start();o.stop(c.currentTime+duration);}
 sweep(f0,f1,duration,volume=.12,type='sine'){if(!this.enabled||!this.context||this.context.state!=='running')return;const c=this.context,o=c.createOscillator(),g=c.createGain();o.type=type;o.frequency.setValueAtTime(f0,c.currentTime);o.frequency.exponentialRampToValueAtTime(Math.max(1,f1),c.currentTime+duration);g.gain.setValueAtTime(volume,c.currentTime);g.gain.exponentialRampToValueAtTime(.0001,c.currentTime+duration);o.connect(g).connect(this.master);o.onended=()=>{o.disconnect();g.disconnect();};o.start();o.stop(c.currentTime+duration);}
 burst(duration,volume=.2,filterType='bandpass',frequency=1200,q=1.2){if(!this.enabled||!this.context||this.context.state!=='running')return;const c=this.context,src=c.createBufferSource();src.buffer=noiseBuffer(c,duration,.2);const f=c.createBiquadFilter();f.type=filterType;f.frequency.value=frequency;f.Q.value=q;const g=c.createGain();g.gain.setValueAtTime(volume,c.currentTime);g.gain.exponentialRampToValueAtTime(.0001,c.currentTime+duration);src.connect(f).connect(g).connect(this.master);src.onended=()=>{src.disconnect();f.disconnect();g.disconnect();};src.start();src.stop(c.currentTime+duration);}
 /** Bunny hop: a quick upward-pitched pop, distinct from a ramp launch. */
 pop(){this.sweep(180,420,.11,.16,'triangle');this.burst(.05,.08,'highpass',1800,.8);}
 /** Ramp/lip launch: a soft rising whoosh. */
 launch(){this.sweep(140,260,.16,.07,'sine');}
 /** Rail catch: a short metallic clack as the pegs lock on. */
 grindCatch(){this.tone(1400,.05,.16,'square');this.burst(.06,.22,'bandpass',2600,4);}
 /** Grind hop-out. */
 grindExit(){this.sweep(320,180,.09,.12,'triangle');}
 /** Wheel/peg impact on landing: a low thud plus a short transient click, scaled by impact speed. */
 contact(impact){const hit=Math.min(1,impact/14);this.tone(70+hit*20,.17,Math.min(.55,.14+hit*.32),'triangle');this.burst(.05,Math.min(.28,.05+hit*.22),'lowpass',900+hit*600,.9);}
 /** Brutal crash: layered low-end thud, harsh metallic clatter and a gritty noise tail. */
 crash(){this.tone(48,.55,.55,'sawtooth');this.sweep(140,40,.22,.3,'square');this.burst(.4,.42,'bandpass',420,1.1);this.burst(.14,.3,'highpass',2600,2.2);this.tone(1800,.06,.14,'square');}
 /** Marker set: a short bright confirmation chime. */
 marker(){this.tone(880,.09,.13,'sine');this.tone(1320,.11,.10,'sine');}
}
