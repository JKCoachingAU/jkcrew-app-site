import {TRACKS,trackAt,sampleSegment} from './track.js';
import {PARK,ENVIRONMENTS,CONTEST_ENVIRONMENTS,parkAt,bikeContact} from './park.js';
import {FreeRidePhysics} from './free-ride.js';
const LOCATIONS={park:PARK,trail:ENVIRONMENTS.trail,halfpipe:ENVIRONMENTS.halfpipe,...(typeof CONTEST_ENVIRONMENTS!=='undefined'?CONTEST_ENVIRONMENTS:{}),...TRACKS};
// Any location with a bounds box is a 3D free-roam environment (street park or half pipe),
// sharing the pedal/hop/grind control scheme, as opposed to the side-on pump-track flow.
const isRoam=t=>!!t&&t.bounds!=null;
import {SceneView} from './scene.js';
import {KITS} from './rig.js';
import {GamePhysics,TRICKS,ADVANCED} from './physics.js';
import {InputController} from './input.js';
import {TIERS,TIER_LABELS,ARROWS} from './control-map.js';
import {RideAudio} from './audio.js';
import {FrameLoop} from './runtime.js';
const $=s=>document.querySelector(s);
try{
 // Phone layout: a coarse pointer on a small screen switches the HUD to the thumbs-first
 // layout (style.css `body.phone`). The game is always landscape on a phone: when the
 // viewport is portrait (the phone held upright, or the OS rotation lock on) the whole game
 // is drawn turned 90° (`body.rotated`, style.css) so it appears in landscape — the player
 // turns the phone to match, and if the OS then rotates the viewport itself the turn is
 // simply dropped. Re-checked on every resize/rotation; the renderer swaps its dimensions.
 let view=null;
 // The stylesheet's media queries measure the screen, but the turned game is laid out in a
 // frame whose width is the screen's height and vice versa — so every landscape/portrait and
 // width/height condition would answer for the wrong axis (the menu got the tall-phone
 // layout squeezed sideways: one track card visible, a two-thousand-pixel scroll). While the
 // game is turned, every media rule is rewritten with its axes swapped (max-height → max-width,
 // landscape → portrait, …) so it answers for the game's frame; turned back, the originals return.
 const mediaSwap=(()=>{const original=new Map();const swap=t=>t.replace(/\b(max|min)-(width|height)\b/g,(m,a,b)=>a+'-'+(b==='width'?'height':'width')).replace(/orientation\s*:\s*(landscape|portrait)/g,(m,o)=>'orientation:'+(o==='landscape'?'portrait':'landscape'));
  return rotated=>{try{for(const sheet of document.styleSheets){let rules;try{rules=sheet.cssRules;}catch{continue;}for(const rule of rules){if(!rule.media)continue;if(!original.has(rule))original.set(rule,rule.media.mediaText);const base=original.get(rule),want=rotated?swap(base):base;if(rule.media.mediaText!==want)rule.media.mediaText=want;}}}catch(e){console.warn('media swap unavailable',e);}};})();
 const phoneClass=()=>{const coarse=typeof matchMedia==='function'&&matchMedia('(pointer:coarse)').matches,phone=coarse&&Math.min(innerWidth,innerHeight)<=560,rotated=phone&&innerHeight>innerWidth;document.body.classList.toggle('phone',phone);document.body.classList.toggle('rotated',rotated);mediaSwap(rotated);if(view)view.resize();};phoneClass();window.addEventListener('resize',phoneClass);
 // Where the browser allows it (Android Chrome, in fullscreen), lock the screen to landscape
 // for the session and drop the browser chrome; iOS ignores both and uses the turned game.
 // JKCREW owns fullscreen when embedded, keeping its Back and Exit buttons reachable.
 const lockLandscape=async()=>{if(window.self!==window.top||!document.body.classList.contains?.('phone'))return;try{const root=document.documentElement;if(root.requestFullscreen&&!document.fullscreenElement)await root.requestFullscreen({navigationUI:'hide'});}catch{}try{await screen.orientation?.lock?.('landscape');}catch{}};
 // Haptics (Android Chrome; a no-op where vibrate is missing): a tick for a landing that
 // scales with the impact, a short buzz for a caught rail or finished trick, a rumble for a bail.
 const buzz=pattern=>{try{if(document.body.classList.contains?.('phone')&&navigator.vibrate)navigator.vibrate(pattern);}catch{}};
 view=new SceneView($('#scene'),{track:'park'});const sound=new RideAudio();let p=new FreeRidePhysics(),intro=true,paused=false,help=false,wasStarted=false,graphicsLost=false,feedbackTimer=0,lastHud=0,renderTime=0,lastRender=0,qualityTime=0,fps=0;
 const ui=Object.fromEntries(['score','best','speed','height','speed-fill','ride-status','fps','feedback-tag','feedback-title','feedback-detail','pump-cue','progress-fill','run-progress'].map(id=>[id,$('#'+id)])),feedbackEl=$('.feedback');
 const metrics={frameTimes:[],renderTimes:[],activeRenderedFrames:0,stallCount:0,simulationMs:0,rendererCpuMs:0};
 const write=(el,value)=>{if(el.textContent!==String(value))el.textContent=value;};
 const vignetteEl=$('.vignette');
 function flash(kind){if(!vignetteEl)return;vignetteEl.classList.remove('flash-crash','flash-land');void vignetteEl.offsetWidth;vignetteEl.classList.add(kind);}
 function scorePop(points){if(!points)return;const el=document.createElement('div');el.className='score-pop';el.textContent='+'+points.toLocaleString();$('#game').append(el);setTimeout(()=>el.remove?.(),1000);ui.score.classList.remove('pop');void ui.score.offsetWidth;ui.score.classList.add('pop');}
 function setMarker(){if(p.setMarker)p.setMarker();}
 const input=new InputController({hop:(charge,flickSpeed)=>{p.setInput(input.state());p.hop(charge,flickSpeed);},trick:(id,options)=>{p.setInput(input.state());const r=p.trick(id,options);if(!r.ok)feedback('TRY THE NEXT JUMP',r.reason,'',1);return r;},releaseTrick:options=>p.releaseTrick(options),reset:()=>reset(),pause:()=>help?closeHelp():pause(),unlock:()=>sound.unlock(),marker:()=>setMarker(),mode:()=>p.mode,freeRoam:()=>isRoam(p.track),changed:()=>controlHud()});
 const loop=new FrameLoop(tick);
 $('#start-btn').disabled=true;$('.intro-hint').textContent='LOADING TRACK DETAILS…';
 function state(){return p.snapshot();}
 function staticDraw(){if(graphicsLost)return;const s=state();if(intro&&!isRoam(p.track)){s.x=p.track.segments.find(seg=>seg[6]==='lip')[0]+1;s.y=trackAt(s.x,p.track).height;s.pitch=Math.atan(trackAt(s.x,p.track).slope);s.yaw=-.60;}if(intro&&s.freeRoam){const spot=p.track.id==='park'?{x:-18,z:-10}:p.track.start;s.x=spot.x;s.z=spot.z;s.y=bikeContact(s.x,s.z,0,p.track).height;}view.snapCamera(s,intro);view.update(s,1,intro);renderHud(s);}
 function stopped(){return graphicsLost||intro||paused||help||document.hidden||['crash','finished'].includes(p.mode);}
 function sync(){input.enabled=!stopped();if(stopped()){loop.stop();p.accumulator=0;sound.pause();}else{lastRender=performance.now();renderTime=0;loop.start();}}
 function feedback(tag,title,detail='',seconds=2){clearTimeout(feedbackTimer);write(ui['feedback-tag'],tag);write(ui['feedback-title'],title);write(ui['feedback-detail'],detail);feedbackEl.classList.remove('quiet');feedbackEl.classList.remove('pop');void feedbackEl.offsetWidth;feedbackEl.classList.add('pop');feedbackTimer=setTimeout(()=>feedbackEl.classList.add('quiet'),seconds*1000);}
 function begin(){lockLandscape();const first=!wasStarted;intro=false;paused=false;wasStarted=true;p.reset();document.body.classList.remove('intro-mode');$('#intro').hidden=true;if(!sound.enabled)sound.toggle().then(audioUI);if(first)openHelp(true);else {help=false;sync();}staticDraw();}
 function openHelp(first=false){help=true;input.clear();$('#pause-overlay').hidden=true;$('#tutorial').hidden=false;$('#tutorial-go').textContent=isRoam(p.track)?'RIDE THE PARK ↗':first?'RIDE THE LINE ↗':'BACK TO THE LINE ↗';sync();$('#tutorial-go').focus();}
 function closeHelp(){help=false;$('#tutorial').hidden=true;$('#pause-overlay').hidden=!paused;input.clear();sound.unlock();sync();if(!intro)feedback(p.track.trail?'DROP IN':'FIND YOUR LINE',p.track.trail?'Hold PEDAL and let the hill run.':isRoam(p.track)?'Pedal toward a ramp.':'Hold. Release. Land.',p.track.trail?'Twelve doubles, roller to monster. Pump every landing — clear the gaps.':isRoam(p.track)?'Pull down to manual. Hop beside a rail to grind.':'Hold PUMP down the roll-in. Release at the lip.',3.5);}
 function pause(force){if(intro)return;paused=typeof force==='boolean'?force:!paused;input.clear();$('#pause-overlay').hidden=!paused;$('#pause-btn').setAttribute('aria-label',paused?'Resume game':'Pause game');if(!paused)sound.unlock();sync();renderHud(state());}
 function reset(){if(intro)return;p.reset();input.clear();$('#crash-overlay').hidden=true;$('#finish-overlay').hidden=true;view.snapCamera(state());sound.unlock();feedback('FRESH RUN','Make it flow.',p.track.trail?'Hold PEDAL. Drop in.':isRoam(p.track)?'Hold PEDAL. Pick a line.':'Hold PUMP. Release at takeoff.',2);staticDraw();sync();}
 // The crash overlay's own button recovers at the last checkpoint (free roam: your marker;
 // a track/challenge: the last line you safely banked) instead of restarting the whole run —
 // that stays what the top RESET control and R key do.
 function recoverFromCrash(){if(intro)return;const recovered=p.recover&&p.recover();if(!recovered){reset();return;}input.clear();$('#crash-overlay').hidden=true;$('#finish-overlay').hidden=true;view.snapCamera(state());sound.unlock();feedback('BACK ON THE BIKE',isRoam(p.track)?'Pick up where you left off.':'Checkpoint recovered.','',2);staticDraw();sync();}
 function audioUI(){const el=$('#audio-btn');el.setAttribute('aria-label',sound.enabled?'Mute sound':'Enable sound');el.setAttribute('aria-pressed',String(sound.enabled));el.style.color=sound.enabled?'var(--lime)':'';}
 $('#tilt-btn').onclick=async()=>{if(input.motion.enabled)input.motion.disable();else await input.motion.enable();controlHud();};$('#calibrate-btn').onclick=()=>input.motion.calibrate();$('#marker-btn').onclick=()=>{if(input.enabled)setMarker();};
 $('#start-btn').onclick=begin;$('#help-btn').onclick=()=>openHelp();$('#close-help').onclick=closeHelp;$('#tutorial-go').onclick=closeHelp;$('#pause-btn').onclick=()=>pause();$('#resume-btn').onclick=()=>pause(false);$('#pause-help').onclick=()=>openHelp();$('#reset-btn').onclick=reset;$('#crash-reset').onclick=recoverFromCrash;$('#replay-btn').onclick=reset;$('#audio-btn').onclick=async()=>{await sound.toggle();audioUI();if(stopped())sound.pause();};
 document.addEventListener('visibilitychange',()=>{if(document.hidden){input.clear();if(wasStarted&&!intro)pause(true);else sync();}else{if(!stopped())sync();}});
 window.addEventListener('blur',()=>{if(wasStarted&&!intro&&!help)pause(true);});
 window.addEventListener('resize',()=>{input.clear();if(stopped())staticDraw();sync();});
 $('#scene').addEventListener('webglcontextlost',e=>{e.preventDefault();graphicsLost=true;sync();$('#error').hidden=false;$('#error').textContent='Graphics were interrupted. Reload to restart your line.';});
 function events(){for(const e of p.drainEvents()){if(e.type==='launch'){if(e.hop){sound.pop();buzz(6);}else sound.launch();}if(e.type==='release'&&!isRoam(p.track))feedback('GOOD TIMING','That’s the release.','Lean and trick. Pump into the downslope.',.8);if(e.type==='trick-start')feedback('IN THE AIR',e.name,'',1.3);if(e.type==='trick-complete'){feedback('COMBO',p.combo.map(t=>t.name).join(' + '),'Land it to bank it.',1.4);buzz(9);}if(e.type==='balance')feedback('BALANCE',e.name,'Release the stick to set both wheels down.',1.2);if(e.type==='grind'){feedback('ON THE RAIL',e.name,'Hold your balance. HOP to exit.',1.6);sound.grindCatch();buzz(14);}if(e.type==='grind-exit'){feedback('LINK IT',p.combo.map(t=>t.name).join(' + '),'Land to bank the line.',1.2);sound.grindExit();}if(e.type==='contact'){sound.contact(e.impact);view.impactPulse(e.impact);if(e.impact>9)flash('flash-land');buzz(Math.round(Math.min(28,5+e.impact*1.6)));}if(e.type==='land'){feedback(e.quality.toUpperCase(),e.names.length?e.names.join(' + '):'Keep the flow.',e.points?`+${e.points.toLocaleString()} POINTS`:'Carry your speed into the next takeoff.',1.8);scorePop(e.points);}if(e.type==='crash'){$('#crash-overlay').hidden=false;$('#crash-reason').textContent=e.reason;feedbackEl.classList.add('quiet');sound.crash();view.impactPulse(20);flash('flash-crash');buzz([45,40,45]);}if(e.type==='wall'){sound.contact(5);buzz(10);feedback('DIRT WALL','Bumped back onto the line.','Ease the stick — the berms carry you round.',1.2);}if(e.type==='marker'){sound.marker();feedback('MARKER SET','You’ll respawn here after a crash.','',1.6);}if(e.type==='finish'){$('#finish-overlay').hidden=false;$('#finish-score').textContent=e.score.toLocaleString();$('#finish-time').textContent=e.time.toFixed(2)+' SEC';feedbackEl.classList.add('quiet');}}}
 function renderHud(s){write(ui.score,String(s.score).padStart(5,'0'));write(ui.best,s.best.toLocaleString());write(ui.speed,Math.round(s.speed*3.6));write(ui.height,(s.mode==='air'?s.airHeight:s.airMax).toFixed(1));ui['speed-fill'].style.transform=`scaleX(${Math.min(1,s.speed/19)})`;ui['progress-fill'].style.transform=`scaleX(${s.progress})`;write(ui['run-progress'],Math.floor(s.progress*100)+'%');write(ui['ride-status'],paused?'PAUSED':s.mode==='crash'?'BAILED':s.mode==='finished'?'LINE COMPLETE':s.diving?'PUMPING DOWN':s.mode==='air'?'AIRBORNE':'ON THE LINE');write(ui.fps,fps?fps+' FPS':'READY');write(ui['pump-cue'],s.pumpCue);ui['pump-cue'].classList.toggle('release',s.pumpCue.includes('RELEASE'));controlHud();}
 function controlHud(){
   const tier=input.tier||0,map=TIERS[tier];
   document.querySelectorAll('[data-sector]').forEach(el=>{const i=Number(el.dataset.sector);write(el,TIER_LABELS[tier][i]);el.classList.toggle('selected',input.selection===i);});
   write($('#stick-name'),input.selection===null?(tier?'T'+(tier+1)+' TRICKS':'TRICKS'):TRICKS[(input.lastSelectedMap||map)[input.selection]]?.name||'TRICKS');
   write($('#lean-hint'),isRoam(p.track)?'PEDAL • HOP • TRICK':input.motion.enabled?'TILT PHONE TO FLIP':'PAD: SPIN · FLIP');
   write($('#motion-status'),input.motion.status);
   $('#tilt-btn').disabled=!input.motion.available();write($('#tilt-btn'),input.motion.enabled?'USE TOUCH LEAN':'ENABLE PHONE TILT');$('#calibrate-btn').hidden=!input.motion.enabled;
   write($('#pitch-help'),p.track.trail?'Drop in off the start deck and let the hill run. Every jump is a double with a pit between the lip and the landing: hold PEDAL through every landing to pump for speed — the gaps grow from a roller to three monsters, and coming up short puts you in the pit. Spin and flip with the pad, flick for tricks, land on the down-slope. The dirt walls keep you on the line; the finish banner ends the run.':isRoam(p.track)?'Hop beside a rail. Hold the pad DOWN for an icepick (rear peg), UP for a toothpick (front peg), or centre it for double pegs. HOP exits. In the air the same pad spins (left / right) and flips (up front flip, down backflip).':input.motion.enabled?'Tilt your phone gently to flip; the pad still spins. Return to your comfortable holding angle to slow rotation. Match the wheels to the landing.':'In the air, push the pad left or right to spin, up for a front flip, down for a backflip. Let it go to stop rotating and line up the landing.');
   write($('#map-title'),'TRICK STICK / T'+(tier+1));
   const text=map.map((id,i)=>ARROWS[i]+' '+TRICKS[id].name).join(' · ');write($('#trick-map'),text);
   input.updateDrive();
 }

 // Render cadence: every animation frame on a 60 Hz screen, every second frame on a 120 Hz
 // phone, and a steady 45 on a 90 Hz one — a regular beat rather than the 45/60 mix a
 // modulo gate produced — while the physics keeps its own fixed 120 Hz step underneath and
 // the snapshot interpolates between steps so the cadence never shows as jitter.
 function tick(dt,now){
  if(stopped()){sync();return;}
  const a=performance.now();
  p.advance(dt,input.state());metrics.simulationMs=performance.now()-a;events();
  renderTime+=dt;qualityTime+=dt;
  if(renderTime>=1/70||['crash','finished'].includes(p.mode)){
   const s=state(),frameMs=now-lastRender;lastRender=now;renderTime=0;
   if(frameMs>0){metrics.frameTimes.push(frameMs);if(frameMs>50)metrics.stallCount++;if(metrics.frameTimes.length>600)metrics.frameTimes.shift();}
   if(now-lastHud>100){const samples=metrics.frameTimes.slice(-60);fps=Math.round(1000/(samples.reduce((n,t)=>n+t,0)/samples.length));renderHud(s);lastHud=now;}
   // Resizing WebGL clears its drawing buffer. Adjust resolution BEFORE drawing so
   // the browser always presents a complete frame, including on high-DPI phones.
   if(qualityTime>1.2){const sorted=metrics.frameTimes.slice(-72).sort((a,b)=>a-b),p90=sorted.length>10?sorted[Math.floor(sorted.length*.9)]:0;view.quality(fps,p90);qualityTime=0;}
   const t=performance.now();
   view.update(s,Math.min(frameMs/1000,.1));sound.update(s);
   metrics.rendererCpuMs=performance.now()-t;metrics.activeRenderedFrames++;
  }
  if(['crash','finished'].includes(p.mode)){renderHud(state());loop.stop();input.clear();input.enabled=false;setTimeout(()=>{if(stopped())sound.pause();},400);}
 }

 const trackRecords=new Map();
 function trackLabels(){const t=p.track,roam=isRoam(t),pipe=t.id==='halfpipe',trail=!!t.trail;document.body.classList.toggle('park-mode',roam);document.body.classList.toggle('pipe-mode',pipe);$('.pump-label').textContent=roam?'PEDAL':'PUMP';const pumpCaption=document.querySelector('#pump-btn small');if(pumpCaption)pumpCaption.textContent=roam?'HOLD · TAP = HOP':'HOLD / RELEASE';const roamCount=Object.values(LOCATIONS).filter(isRoam).length,lineCount=Object.keys(TRACKS).length;$('.intro-kicker').innerHTML='OPEN SESSION <span>'+roamCount+' PARKS · '+lineCount+' LINES</span>';$('#tutorial-title').textContent=roam?(pipe?'Your ramp. Your air.':trail?'Your hill. Twelve jumps.':'Your park. Your line.'):'Two thumbs. More flow.';const steps=document.querySelectorAll('.tutorial-steps article');if(steps.length){steps[2].querySelector('h3').textContent=roam?(pipe?'Link your airs':trail?'Carry speed, land the face':'Hop onto rails'):'Lean and land';steps[0].querySelector('h3').textContent=roam?'Steer and balance':'Right thumb: Pump';steps[0].querySelector('p').textContent=roam?'Hold PEDAL to accelerate — and hold it down a transition to pump for speed. Tap PEDAL for a quick hop; drag it down and flick up for a bigger one. The pad on the left steers; hold it DOWN for a manual or UP for a nose manual; in the air it spins (left / right) and flips (up front flip, down backflip).':'Hold PUMP down the ramp. Release just after takeoff. Press again on the descent. T1 · T2 · T3 above it pick the trick set.';steps[1].querySelector('h3').textContent='Right thumb: Tricks';steps[1].querySelector('p').textContent=roam?(pipe?'Ride up either wall fast enough to air off the coping, trick, then turn back down into the transition. HOP off the coping to grind it.':'Tap PEDAL to hop near a rail and the pegs lock on; hold DOWN or UP in the air for icepick or toothpick. Ride up a quarter, the bowl or the mini ramp and you air, turn and drop back in on your own; pump a spine and you pop clean over the coping — steer in the air to spin (let go and it lands square), or tap PEDAL at the lip to hop out onto the deck. Flick ↗ Barspin, → Tailwhip, ↑ Tabletop; T2 and T3 put more tricks on the same eight flicks.'):'Flick the stick: left Barspin, right Tailwhip, up Tabletop. Hold for style, then release before landing. T2 and T3 put more tricks on the same eight flicks — T3 is the grabs and variations.';} write($('#track-name'),t.name.toUpperCase());write($('#track-meta'),roam?(pipe?'VERT · 13 FT WALLS · ROLL-IN':trail?'SLOPESTYLE · 12 GAP JUMPS · '+t.drop+' M OF DOWNHILL · FINISH LINE':t.palette?'FREE ROAM · '+t.description.toUpperCase():'FREE ROAM · SPINES · BOX JUMPS · HALF PIPE · MINI · BOWL · STREET'):t.label.toUpperCase()+' · '+t.jumps+(t.id==='easy'?' TABLETOPS':' GAPS'));write($('#track-number'),roam?'FR':String(t.number).padStart(2,'0'));write($('#selected-track-name'),t.name.toUpperCase());write($('#selected-track-detail'),roam?(pipe?'13 FT WALLS · 18 M WIDE · ROLL-IN TOWER':trail?t.end+' M DOWNHILL · '+t.drop+' M DROP · 12 DOUBLES · '+t.lips[0]+'–'+t.lips[1]+' M LIPS':t.palette?Math.round(t.bounds.x*2)+' × '+Math.round(t.bounds.z*2)+' M · '+t.label.toUpperCase()+' · '+t.features.length+' RAMPS · '+t.rails.filter(r=>!r.coping).length+' RAILS':'92 × 64 M PAD · 2 SPINES · 2 BOX JUMPS · HALF PIPE · MINI · BOWL · STREET'):t.jumps+(t.id==='easy'?' TABLETOPS':' GAPS')+' · '+t.end+' M');write($('#start-label'),roam?(pipe?'DROP IN':trail?'RIDE THE TRAIL':t.palette?'RIDE '+t.name.toUpperCase():'ENTER THE PARK'):'RIDE '+t.label.toUpperCase());document.querySelectorAll('[data-track]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.track===t.id)));}
 function selectTrack(id){document.querySelectorAll('.track-choice').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.track===id)));if(p.track.id!==id){trackRecords.set(p.track.id,{score:p.score,best:p.best});input.clear();p=isRoam(LOCATIONS[id])?new FreeRidePhysics(id):new GamePhysics({track:id});Object.assign(p,trackRecords.get(id)||{});view.setTrack(p.track);metrics.frameTimes=[];metrics.activeRenderedFrames=0;metrics.stallCount=0;fps=0;qualityTime=0;}trackLabels();staticDraw();if(window.__trackPage)window.__trackPage();}
 function openTracks(){input.clear();intro=true;help=false;paused=false;p.reset();document.body.classList.add('intro-mode');for(const id of ['tutorial','pause-overlay','crash-overlay','finish-overlay'])$('#'+id).hidden=true;$('#intro').hidden=false;$('#pause-btn').setAttribute('aria-label','Pause game');feedbackEl.classList.add('quiet');sync();trackLabels();staticDraw();document.querySelector('[data-track="'+p.track.id+'"]').focus();}
 for(const t of Object.values(LOCATIONS)){const button=document.createElement('button');button.className='track-choice';button.dataset.track=t.id;button.style.setProperty('--accent',t.accent);button.setAttribute('aria-pressed',String(t.id===p.track.id));button.setAttribute('aria-label',t.label+' — '+t.name);let path='';for(const seg of t.segments||[]){for(let j=0;j<=12;j++){const x=seg[0]+(seg[3]-seg[0])*j/12;path+=(j?' L':' M')+(4+(x+8)/(t.end+20)*94).toFixed(1)+','+(35-sampleSegment(seg,x).height*4.5).toFixed(1);}}button.innerHTML='<span><span class="difficulty">'+t.label.toUpperCase()+'</span><span class="track-title">'+t.name+'</span><small>'+t.description+'</small></span><svg viewBox="0 0 104 42" aria-hidden="true"><path d="'+path+'"/></svg>';button.onclick=()=>selectTrack(t.id);$('#track-list').append(button);}
 // The track picker. On a phone it is a pager — one card at a time, arrows either side, a
 // swipe across the card (pointer events mapped into the game's own frame, so the turned game
 // swipes along the phone's long edge) and a row of dots — because a scrolling list inside
 // the turned game scrolled along the wrong axis. On a desktop it stays a list that scrolls,
 // dragged with pointer events (mapped the same way).
 {const list=$('#track-list'),ids=Object.values(LOCATIONS).map(t=>t.id),dots=$('#track-dots'),phone=()=>!!document.body.classList?.contains?.('phone');
  dots.innerHTML=ids.map(()=>'<i></i>').join('');
  const page=()=>{const i=Math.max(0,ids.indexOf(p.track.id));if(phone())list.style.transform='translateX(-'+i*100+'%)';else list.style.transform='';Array.from(dots.children||[]).forEach((d,k)=>d.classList.toggle('on',k===i));};
  const step=dir=>{const i=ids.indexOf(p.track.id),next=(i+dir+ids.length)%ids.length;selectTrack(ids[next]);};
  $('#track-prev').onclick=()=>step(-1);$('#track-next').onclick=()=>step(1);window.addEventListener('resize',page);
  let start=null,startTop=0,dragging=false,pid=null,justDragged=false;
  list.addEventListener('pointerdown',e=>{pid=e.pointerId;start=input.pointAt(e);startTop=list.scrollTop;dragging=false;});
  list.addEventListener('pointermove',e=>{if(e.pointerId!==pid||!start)return;const q=input.pointAt(e),dx=q.x-start.x,dy=q.y-start.y;if(!dragging&&Math.hypot(dx,dy)>6){dragging=true;try{list.setPointerCapture(pid);}catch{}}if(dragging&&!phone()){list.scrollTop=startTop-dy;e.preventDefault();}});
  const endDrag=e=>{if(e.pointerId!==pid)return;if(dragging){try{list.releasePointerCapture(pid);}catch{}justDragged=true;if(phone()&&start){const dx=input.pointAt(e).x-start.x;if(Math.abs(dx)>36)step(dx<0?1:-1);}}dragging=false;pid=null;start=null;};
  list.addEventListener('pointerup',endDrag);list.addEventListener('pointercancel',endDrag);
  list.addEventListener('click',e=>{if(justDragged){e.stopPropagation();e.preventDefault();justDragged=false;}},true);
  window.__trackPage=page;page();
 }
 $('#tracks-btn').onclick=openTracks;$('#finish-tracks').onclick=openTracks;trackLabels();
 // Rider kit: cycles the bike's frame finish and the pants (the tee is always the black JK
 // Coaching shirt), remembered per device. Guarded so the controller still boots in the test
 // harness (no rig, no storage) and if storage is off.
 try{if(typeof KITS!=='undefined'&&view.rig?.applyKit){let kitIndex=0;try{kitIndex=Math.max(0,KITS.findIndex(k=>k.id===localStorage.getItem('jkcrew-kit')));}catch{}
  const applyKit=()=>{const k=view.rig.applyKit(kitIndex);write($('#kit-btn'),'KIT · '+k.name+' ›');try{localStorage.setItem('jkcrew-kit',k.id);}catch{}if(stopped())staticDraw();};
  $('#kit-btn').onclick=()=>{kitIndex=(kitIndex+1)%KITS.length;applyKit();};applyKit();}}catch(e){console.warn('kit selector unavailable',e);}
 // The rider: boy or girl, stance (which foot rides forward) and spin direction (the way a
 // lip air, a SPIN and the keyboard spin turn), chosen on the home page and remembered.
 try{const rider={build:'boy',stance:'right',spin:'left'};try{Object.assign(rider,JSON.parse(localStorage.getItem('jkcrew-rider')||'{}'));}catch{}
  const applyRider=()=>{if(view.rig?.setRider)view.rig.setRider(rider);input.opposite=rider.spin==='right';document.querySelectorAll('.seg').forEach(seg=>{const opt=seg.dataset.option;seg.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.value===rider[opt])));});try{localStorage.setItem('jkcrew-rider',JSON.stringify(rider));}catch{}if(stopped())staticDraw();};
  document.querySelectorAll('.seg button').forEach(b=>{b.onclick=()=>{rider[b.closest('.seg').dataset.option]=b.dataset.value;applyRider();};});applyRider();window.__rider=rider;}catch(e){console.warn('rider options unavailable',e);}
 if(!input.motion.available())input.motion.status=window.isSecureContext?'Touch lean is ready.':'Tilt needs HTTPS. Touch lean works on this Wi-Fi link.';document.body.classList.add('intro-mode');staticDraw();
 view.ready.then(()=>{if(stopped())staticDraw();$('#start-btn').disabled=false;$('.intro-hint').textContent=view.assetError?'TEXTURES UNAVAILABLE — RELOAD TO RETRY':document.body.classList.contains?.('phone')?'LANDSCAPE • SOUND ON • ADD TO HOME SCREEN FOR FULL SCREEN':'TOUCH + KEYBOARD • SOUND ON RECOMMENDED';});
 window.copingDiagnostics=()=>({version:'0.9.0',state:state(),metrics:{...metrics,frameTimes:metrics.frameTimes.slice(),fps},render:view.stats(),loopRunning:loop.running,counts:{launches:p.launches,landings:p.landings,crashes:p.crashes},input:input.state(),controls:{tier:input.tier,opposite:input.opposite,tilt:input.motion.enabled,motionStatus:input.motion.status},paused,intro,helpOpen:help,lastLanding:p.lastLanding});
 if(document.modelContext?.registerTool){const controller=new AbortController();for(const t of [{name:'read_bmx_session',description:'Read BMX state and active-render performance samples.',annotations:{readOnlyHint:true},execute:()=>window.copingDiagnostics()},{name:'reset_bmx_rider',description:'Restart the current line, preserving banked session score.',annotations:{readOnlyHint:false},execute:args=>{if(args&&Object.keys(args).length)throw new Error('No parameters accepted');if(intro)throw new Error('Start the session first');reset();return {mode:p.mode,score:p.score};}}])try{Promise.resolve(document.modelContext.registerTool({...t,inputSchema:{type:'object',properties:{},additionalProperties:false}},{signal:controller.signal})).catch(()=>{});}catch{}window.addEventListener('pagehide',()=>{controller.abort();loop.stop();sound.pause();},{once:true});}
}catch(e){$('#error').hidden=false;$('#error').textContent='The ride could not start: '+e.message;console.error(e);}
