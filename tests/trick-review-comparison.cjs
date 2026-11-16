// Real synthetic media only: local red/blue clips, linked HTML videos and
// decoded canvas-recorded reply. No production accounts or network reads.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.JKCREW_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const extract = name => {
  const start = app.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert(start >= 0, `Actual ${name} exists`);
  const text = app.slice(start);
  return text.slice(0, text.indexOf('\n}') + 2);
};
const names = ['coachReviewWorkspaceHtml', 'videoReviewTimeLabel', 'activeCoachReviewComparison', 'clearCoachReviewComparison',
  'coachReviewFrameTime', 'coachReviewLinkedRange', 'pauseCoachReviewVideos', 'syncCoachReviewReference', 'seekCoachReviewVideos',
  'playCoachReviewVideos', 'updateCoachReviewComparisonUi', 'bindCoachReviewComparison', 'releaseVideoReviewMedia',
  'clearCoachRecordedReply', 'cleanupCoachReviewRecordingSession', 'discardCoachReviewRecording', 'teardownCoachVideoReviewEditor',
  'resetVideoReviewPrivateState', 'activeCoachReviewDrawings', 'coachReviewCanvasPoint', 'drawCoachReviewShape',
  'coachReviewRecordingMimeTypes', 'createCoachReviewMediaRecorder', 'coachReviewRecordingSize', 'paintCoachReviewRecordingFrame',
  'setCoachReviewRecordingControlsLocked', 'updateCoachReviewRecordingClock', 'finishCoachReviewRecording', 'stopCoachReviewRecording',
  'waitForCoachReviewVideoFrame', 'startCoachReviewRecording', 'redrawCoachReviewCanvas', 'updateCoachReviewPlayerUi',
  'bindCoachVideoReviewEditor', 'baseVideoMimeType', 'supportedHelpVideoFile', 'selectCoachReplyVideoFile'];

(async () => {
  const browser = await chromium.launch({headless:true,executablePath:process.env.JKCREW_BROWSER_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  try {
    const page = await browser.newPage({viewport:{width:1024,height:1000}});
    const errors = [], requests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => requests.push(r.url()));
    await page.route('**/*', route => /^(blob:|data:)/.test(route.request().url()) ? route.continue() : route.abort());
    await page.setContent('<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"><div class="app-shell coach-shell" style="display:block"><main id="view" data-view="videoReviews"></main></div></div></body></html>');
    await page.addStyleTag({content:fs.readFileSync(path.join(root,'styles.css'),'utf8')});
    await page.evaluate(async () => {
      window.qa = {notices:[],revoked:[],renders:0};
      const oldRevoke = URL.revokeObjectURL.bind(URL);
      URL.revokeObjectURL = url => {qa.revoked.push(url); oldRevoke(url);};
      window.state = {user:{id:'synthetic-coach'},profile:{role:'coach'},view:'videoReviews',videoReviewActiveRequestId:'review',
        videoReviewMedia:new Map(),videoReviewRecordedReplies:new Map(),videoReviewComparisons:new Map(),videoReviewDrawings:new Map(),
        videoReviewDrawTool:'pen',videoReviewDrawColor:'#20e3c3',videoReviewDrawEnabled:false,videoReviewRenderSerial:0,inFlight:new Map()};
      window.COACH_REVIEW_RECORDING_MAX_SECONDS = 120; window.COACH_VIDEO_MAX_BYTES = 50*1024*1024;
      window.escapeHtml = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      window.avatarHtml = () => ''; window.dateLabel = () => '16 Nov'; window.videoSizeLabel = () => '1 MB';
      window.firstName = p => p.display_name.split(' ')[0]; window.messageFrom = e => e.message || String(e);
      window.videoFileExtension = f => f.name.split('.').pop().toLowerCase();
      window.notify = (message,type) => qa.notices.push({message,type});
      window.renderVideoReviews = async () => {qa.renders++;};
      async function makeClip(colour) {
        const canvas=document.createElement('canvas');canvas.width=160;canvas.height=120;
        const ctx=canvas.getContext('2d');const stream=canvas.captureStream(25);const chunks=[];
        const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});
        const stopped=new Promise(resolve=>recorder.addEventListener('stop',resolve,{once:true}));
        let frame=0;
        const paint=()=>{ctx.fillStyle=colour;ctx.fillRect(0,0,160,120);ctx.fillStyle='#fff';ctx.fillRect((frame++*3)%150,0,8,18);};
        paint();const interval=setInterval(paint,40);
        recorder.addEventListener('dataavailable',e=>chunks.push(e.data));recorder.start();
        await new Promise(resolve=>setTimeout(resolve,2400));recorder.stop();await stopped;clearInterval(interval);stream.getTracks().forEach(t=>t.stop());
        return new File(chunks,[colour==='red'?'rider':'reference','.webm'].join(''),{type:'video/webm'});
      }
      [qa.riderFile,qa.referenceFile]=await Promise.all([makeClip('red'),makeClip('blue')]);
      qa.riderUrl=URL.createObjectURL(qa.riderFile);
      state.videoReviewMedia.set('review',{video_playback_url:qa.riderUrl});
      qa.audioContext=new AudioContext();qa.audioDestination=qa.audioContext.createMediaStreamDestination();
      qa.oscillator=qa.audioContext.createOscillator();qa.oscillator.connect(qa.audioDestination);qa.oscillator.start();
      Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>qa.audioDestination.stream}});
    });
    await page.addScriptTag({content:names.map(extract).join('\n')});
    await page.evaluate(() => {
      qa.request={id:'review',athlete_id:'synthetic-rider',athlete:{display_name:'Synthetic Rider'},question:'Compare my take-off',status:'open'};
      document.querySelector('#view').innerHTML=coachReviewWorkspaceHtml(qa.request);bindCoachVideoReviewEditor();
    });
    await page.waitForFunction(()=>document.querySelector('#coach-review-video')?.readyState>=2);
    assert.equal(await page.locator('#coach-review-reference-stage').isVisible(),false);
    await page.evaluate(()=>{
      const transfer=new DataTransfer();transfer.items.add(qa.referenceFile);
      const input=document.querySelector('#coach-review-reference-file');input.files=transfer.files;input.dispatchEvent(new Event('change'));
    });
    await page.waitForFunction(()=>document.querySelector('#coach-review-reference-video')?.readyState>=2);
    assert.equal(await page.locator('#coach-review-reference-stage').isVisible(),true);
    assert.equal(await page.locator('[data-review-link]').getAttribute('aria-pressed'),'false');
    await page.evaluate(()=>{seekCoachReviewVideos(.4);seekCoachReviewVideos(.9,true);});
    await page.locator('[data-review-link]').click();
    assert.equal(await page.locator('[data-review-link]').getAttribute('aria-pressed'),'true');
    const anchors=await page.evaluate(()=>({r:activeCoachReviewComparison().riderAnchor,s:activeCoachReviewComparison().referenceAnchor}));
    assert(Math.abs(anchors.s-anchors.r-.5)<.01,'Coach aligns independently chosen sync frames');
    await page.selectOption('#coach-review-frame-rate','25');
    await page.locator('[data-review-step="1"]').click();
    let times=await page.evaluate(()=>({r:document.querySelector('#coach-review-video').currentTime,s:document.querySelector('#coach-review-reference-video').currentTime}));
    assert(Math.abs(times.r-.44)<.01 && Math.abs(times.s-.94)<.01,'A chosen 25fps step seeks both actual media elements together');
    await page.locator('[data-review-speed="0.5"]').click();
    assert.deepEqual(await page.evaluate(()=>[document.querySelector('#coach-review-video').playbackRate,document.querySelector('#coach-review-reference-video').playbackRate]),[.5,.5]);
    await page.locator('[data-review-play]').click();
    await page.waitForTimeout(350);
    times=await page.evaluate(()=>({r:document.querySelector('#coach-review-video').currentTime,s:document.querySelector('#coach-review-reference-video').currentTime}));
    assert(times.r>.45 && Math.abs(times.s-times.r-.5)<.18,`Real linked playback advances and keeps the alignment offset: ${JSON.stringify({times,status:await page.evaluate(()=>({r:document.querySelector('#coach-review-video').duration,s:document.querySelector('#coach-review-reference-video').duration,notices:qa.notices}))})}`);
    await page.evaluate(()=>document.querySelector('#coach-review-reference-video').dispatchEvent(new Event('waiting')));
    assert(await page.evaluate(()=>document.querySelector('#coach-review-video').paused && document.querySelector('#coach-review-reference-video').paused),'Buffering either view holds both clips');
    await page.evaluate(()=>document.querySelector('#coach-review-reference-video').dispatchEvent(new Event('canplay')));
    await page.waitForFunction(()=>!document.querySelector('#coach-review-video').paused);
    await page.evaluate(()=>pauseCoachReviewVideos());
    await page.evaluate(()=>seekCoachReviewVideos(99));
    assert(await page.evaluate(()=>{const v=document.querySelector('#coach-review-video'),r=document.querySelector('#coach-review-reference-video');return Math.abs(v.currentTime-(r.duration-.5))<.04 && r.currentTime<=r.duration;}),'Linked seeking respects both clip boundaries');
    await page.evaluate(()=>{seekCoachReviewVideos(.3);const r=document.querySelector('#coach-review-reference-video');qa.play=r.play;r.play=()=>Promise.reject(new Error('Synthetic refusal'));});
    await page.locator('[data-review-play]').click();
    await page.waitForFunction(()=>qa.notices.some(n=>n.message.includes('Playback could not start')));
    assert(await page.evaluate(()=>document.querySelector('#coach-review-video').paused && document.querySelector('#coach-review-reference-video').paused),'One rejected play safely pauses both clips');
    await page.evaluate(()=>{document.querySelector('#coach-review-reference-video').play=qa.play;seekCoachReviewVideos(.3);});

    for(const width of [320,390,768,1440]) for(const theme of ['dark','light']) {
      await page.setViewportSize({width,height:1000});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`No comparison overflow at ${width}px ${theme}`);
      const boxes=await page.locator('#coach-review-stage,#coach-review-reference-stage').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().width));
      assert(boxes[0]>70 && Math.abs(boxes[0]-boxes[1])<2,'Both comparison panels remain equal and visible');
      if(process.env.JKCREW_SCREENSHOT_DIR && width===390){fs.mkdirSync(process.env.JKCREW_SCREENSHOT_DIR,{recursive:true});await page.locator('.coach-review-editor').screenshot({path:path.join(process.env.JKCREW_SCREENSHOT_DIR,`trick-review-comparison-390-${theme}.png`)});}
    }
    await page.setViewportSize({width:1024,height:1000});
    await page.evaluate(async()=>{
      seekCoachReviewVideos(.3);await new Promise(resolve=>setTimeout(resolve,120));
      state.videoReviewDrawings.set('review',[{tool:'line',color:'#20e3c3',points:[{x:.1,y:.1},{x:.8,y:.6}]}]);
      await startCoachReviewRecording('review');
    });
    assert(await page.evaluate(()=>Boolean(state.videoReviewRecording?.referenceVideo)),'Actual recorder includes the reference source');
    await page.waitForTimeout(550);
    await page.evaluate(()=>stopCoachReviewRecording());
    await page.waitForFunction(()=>state.videoReviewRecordedReplies.has('review'),null,{timeout:15000});
    const output=await page.evaluate(async()=>{
      const reply=state.videoReviewRecordedReplies.get('review');
      const v=document.createElement('video');v.muted=true;v.src=reply.url;
      await new Promise((resolve,reject)=>{v.onloadeddata=resolve;v.onerror=reject;});
      v.currentTime=.15;await new Promise(resolve=>v.addEventListener('seeked',resolve,{once:true}));
      const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d').drawImage(v,0,0);
      const pixel=(x,y)=>Array.from(c.getContext('2d').getImageData(x,y,1,1).data);
      const drawPixels=c.getContext('2d').getImageData(280,295,30,30).data;
      let green=0;for(let i=0;i<drawPixels.length;i+=4)if(drawPixels[i]<130 && drawPixels[i+1]>120 && drawPixels[i+2]>70)green++;
      return {width:v.videoWidth,height:v.videoHeight,left:pixel(170,500),right:pixel(950,500),green,size:reply.file.size,mime:reply.file.type,
        selected:selectCoachReplyVideoFile(null,reply)===reply.file,trackStopped:qa.audioDestination.stream.getTracks().every(t=>t.readyState==='ended')};
    });
    assert.equal(output.width,1280);assert.equal(output.height,720);
    assert(output.left[0]>150 && output.left[2]<70,'Decoded private reply contains the red rider view');
    assert(output.right[2]>150 && output.right[0]<70,'Decoded private reply contains the blue second view');
    assert(output.green>4,'Decoded private reply retains the coach’s drawing in the rider view');
    assert(output.size>0 && output.selected && output.trackStopped,'Recording is sendable via existing reply selector and microphone stream is released');
    await page.evaluate(()=>{clearCoachRecordedReply('review');setCoachReviewRecordingControlsLocked(false);});
    const referenceUrl=await page.evaluate(()=>activeCoachReviewComparison().url);
    await page.locator('[data-review-reference-remove]').click();
    assert.equal(await page.locator('#coach-review-reference-stage').isVisible(),false);
    assert(await page.evaluate(url=>qa.revoked.includes(url),referenceUrl),'Removing a second clip revokes its local URL');
    assert.equal(await page.evaluate(()=>state.videoReviewComparisons.size),0);
    await page.evaluate(()=>{
      const transfer=new DataTransfer();transfer.items.add(new File(['not video'],'example.txt',{type:'text/plain'}));
      const input=document.querySelector('#coach-review-reference-file');input.files=transfer.files;input.dispatchEvent(new Event('change'));
    });
    assert.equal(await page.evaluate(()=>state.videoReviewComparisons.size),0,'Unsupported reference files do not create playback URLs');
    await page.evaluate(()=>{
      const transfer=new DataTransfer();transfer.items.add(qa.referenceFile);
      const input=document.querySelector('#coach-review-reference-file');input.files=transfer.files;input.dispatchEvent(new Event('change'));
      qa.lastReferenceUrl=activeCoachReviewComparison().url;
    });
    await page.evaluate(()=>{resetVideoReviewPrivateState();qa.oscillator.stop();qa.audioContext.close();});
    assert.equal(await page.evaluate(()=>state.videoReviewComparisonRaf),null,'Account reset stops comparison animation work');
    assert.equal(await page.evaluate(()=>state.videoReviewMedia.size),0);
    assert(await page.evaluate(()=>qa.revoked.includes(qa.lastReferenceUrl)),'Account reset revokes the unsent local comparison');
    assert.deepEqual(errors,[]);
    assert(requests.every(url=>/^(data:|blob:|about:)/.test(url)),'No external media requests');
    console.log('PASS: actual synthetic videos align, link/play/seek/frame-step at chosen FPS, share slow motion, clamp bounds and pause on play rejection; dark/light responsive comparison; decoded private reply includes both views and cleans streams/URLs.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
