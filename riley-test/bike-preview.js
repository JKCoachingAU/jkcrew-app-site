/* Local photo composition and export. No account data or remote write path. */
const JKCrewBikePreview = (() => {
  'use strict';
  const scenes = Object.freeze([
    {id:'studio',name:'Studio',url:'',tint:[1,1,1]},
    {id:'street',name:'Street',url:'./images/bike-garage/scene-street-v4.webp',tint:[.98,.975,.97]},
    {id:'skatepark',name:'Skatepark',url:'./images/bike-garage/scene-skatepark-v4.webp',tint:[.99,.985,.975]},
    {id:'warehouse',name:'The workshop',url:'./images/bike-garage/scene-warehouse-v4.webp',tint:[.92,.90,.87]},
    {id:'rooftop',name:'Rooftop dusk',url:'./images/bike-garage/scene-rooftop-v4.webp',tint:[.81,.85,.94]}
  ].map(Object.freeze));
  const html = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const sceneFor = value => scenes.find(scene=>scene.id===value) || scenes[0];
  const safeId = value => String(value || 'bike-photo').replace(/[^a-z0-9_-]/gi,'-').slice(0,60);
  const assetData = new Map(); // Only immutable, explicitly listed public artwork.
  const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
  function renderScene(configuration, {idPrefix='bike-photo'}={}) {
    const config=JKCrewBikeConfig.normalize(configuration),scene=sceneFor(config.background),id=safeId(idPrefix);
    const art=JKCrewBikeArt.render(config,{idPrefix:id+'-bike',transparent:scene.id!=='studio'});
    if(scene.id==='studio')return art;
    const body=art.replace(/^<svg\b[^>]*>/,'').replace(/<\/svg>\s*$/,'');
    const [r,g,b]=scene.tint;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1536 1024" class="jkcrew-bike-scene" role="img" aria-labelledby="${id}-title" data-scene="${scene.id}" data-drive-side="${config.driveSide}"><title id="${id}-title">Custom BMX at ${html(scene.name)}</title><defs><filter id="${id}-ambient" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${r} 0 0 0 0 0 ${g} 0 0 0 0 0 ${b} 0 0 0 0 0 1 0"/></filter><filter id="${id}-shadow" x="-20%" y="-200%" width="140%" height="500%"><feGaussianBlur stdDeviation="13 6"/></filter><filter id="${id}-contact" x="-40%" y="-200%" width="180%" height="500%"><feGaussianBlur stdDeviation="6 2.3"/></filter></defs><image href="${scene.url}" width="1536" height="1024" preserveAspectRatio="none"/><g transform="translate(123 108) scale(.84)"><g fill="#10151a" filter="url(#${id}-shadow)" opacity=".24"><ellipse cx="755" cy="926" rx="576" ry="18"/><ellipse cx="328" cy="914" rx="169" ry="11"/><ellipse cx="1188" cy="937" rx="170" ry="11"/></g><g fill="#070b10" filter="url(#${id}-contact)" opacity=".64"><ellipse cx="329" cy="914" rx="66" ry="5"/><ellipse cx="1188" cy="937" rx="66" ry="5"/></g><g filter="url(#${id}-ambient)">${body}</g></g></svg>`;
  }
  function allowedAssets() {
    return new Set([...Object.values(JKCrewBikeArt.assetUrls),...scenes.filter(s=>s.url).map(s=>s.url)].map(url=>new URL(url,document.baseURI).href));
  }
  async function inlineAsset(url,signal) {
    const absolute=new URL(url,document.baseURI).href;
    if(!allowedAssets().has(absolute))throw new Error('This photo is not a Bike Garage asset.');
    if(assetData.has(absolute))return assetData.get(absolute);
    const request=new AbortController(),cancel=()=>request.abort();
    if(signal.aborted)throw new DOMException('Preview closed','AbortError');
    signal.addEventListener('abort',cancel,{once:true});
    const timer=setTimeout(cancel,12000);
    try {
      const response=await fetch(absolute,{signal:request.signal,credentials:'omit'});
      if(!response.ok)throw new Error('A bike photo could not load.');
      const blob=await response.blob();
      if(!blob.size || blob.size>8*1024*1024)throw new Error('The photo could not be prepared.');
      const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('The photo could not be read.'));reader.readAsDataURL(blob);});
      if(signal.aborted)throw new DOMException('Preview closed','AbortError');
      assetData.set(absolute,data);return data;
    } finally {clearTimeout(timer);signal.removeEventListener('abort',cancel);}
  }
  function decodeImage(url,signal) {
    return new Promise((resolve,reject)=>{
      const image=new Image();let settled=false;
      const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',cancel);image.onload=null;image.onerror=null;error?reject(error):resolve(image);};
      const cancel=()=>{finish(new DOMException('Preview closed','AbortError'));image.src='';};
      const timer=setTimeout(()=>finish(new Error('The photo took too long to prepare.')),12000);
      signal.addEventListener('abort',cancel,{once:true});
      image.onload=()=>finish();image.onerror=()=>finish(new Error('The photo could not be rendered.'));
      if(signal.aborted)return cancel();image.src=url;
    });
  }
  async function pngFromSvg(markup,signal) {
    const documentSvg=new DOMParser().parseFromString(markup,'image/svg+xml');
    if(documentSvg.querySelector('parsererror'))throw new Error('The bike photo could not be composed.');
    const svg=documentSvg.documentElement;
    svg.setAttribute('width','2048');svg.setAttribute('height','1365');svg.removeAttribute('style');
    await Promise.all([...svg.querySelectorAll('image')].map(async image=>{
      const href=image.getAttribute('href');if(href)image.setAttribute('href',await inlineAsset(href,signal));
    }));
    if(signal.aborted)throw new DOMException('Preview closed','AbortError');
    const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml;charset=utf-8'}));
    try {
      const image=await decodeImage(url,signal);
      if(signal.aborted)throw new DOMException('Preview closed','AbortError');
      const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=1365;
      const context=canvas.getContext('2d');if(!context)throw new Error('This browser could not create the photo.');
      context.fillStyle='#eef0f2';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
      return await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('The photo could not be saved.')),'image/png'));
    } finally {URL.revokeObjectURL(url);}
  }
  function mount({configuration,name='My dream bike',isCurrent=()=>true,capture=null,onBackgroundChange=()=>null,onClose=()=>{}}={}) {
    let config=JKCrewBikeConfig.normalize(configuration),alive=true,sequence=0,photoFile=null,fileUrl='',sharing=false;
    let zoom=1,rotation=0,panX=0,panY=0,gesture=null;
    const pointers=new Map(),controller=new AbortController(),signal=controller.signal,returnFocus=document.activeElement;
    const dialog=document.createElement('dialog');dialog.className='bike-fullscreen bike-photo-preview';dialog.setAttribute('aria-label','Full bike preview');
    dialog.innerHTML=`<header class="bike-photo-top"><div><span>JKCREW / PHOTO STUDIO</span><h2>${html(name)}</h2></div><button type="button" class="bike-photo-close" data-bike-preview-close aria-label="Close bike preview">×</button></header><div class="bike-photo-body"><section class="bike-photo-view"><div class="bike-photo-canvas" tabindex="0" aria-label="Bike photo. Pinch to zoom or drag to move." data-bike-photo-canvas><div class="bike-photo-transform" data-bike-preview-art aria-busy="true"></div></div><div class="bike-photo-tools" aria-label="Photo viewing controls"><button type="button" data-bike-zoom="out" aria-label="Zoom out">−</button><output data-bike-zoom-level>100%</output><button type="button" data-bike-zoom="in" aria-label="Zoom in">+</button><span class="bike-photo-tool-separator"></span><button type="button" data-bike-rotate="left" aria-label="Rotate image left">↶</button><button type="button" data-bike-rotate="right" aria-label="Rotate image right">↷</button><button type="button" data-bike-view-reset>Reset view</button></div><p class="bike-photo-view-tip">Pinch to zoom · Drag to explore · Rotate image</p></section><aside class="bike-photo-options"><div class="bike-photo-scene-heading"><span>MAKE IT YOURS</span><h3>Set the scene</h3><p>Choose a spot for your finished bike.</p></div><div class="bike-scene-list" aria-label="Photo background">${scenes.map(scene=>`<button type="button" data-bike-scene="${scene.id}" aria-pressed="${config.background===scene.id}">${scene.url?`<img src="${scene.url.replace('.webp','-thumb.webp')}" alt="" width="240" height="160">`:'<span class="bike-scene-studio" aria-hidden="true">◇</span>'}<span>${html(scene.name)}</span><b aria-hidden="true">✓</b></button>`).join('')}</div><div class="bike-photo-export"><button type="button" data-bike-export disabled>↓ Save photo</button><button type="button" data-bike-download hidden>Download PNG</button><p data-bike-export-status role="status" aria-live="polite">Preparing your photo…</p><button type="button" data-bike-preview-retry hidden>Try again</button><p class="bike-photo-save-tip">On iPhone or iPad, choose <strong>Save Image</strong> in the share sheet. The photo keeps your chosen bike view and background.</p></div></aside></div>`;
    document.body.append(dialog);dialog.showModal();
    const art=dialog.querySelector('[data-bike-preview-art]'),canvas=dialog.querySelector('[data-bike-photo-canvas]');
    const exportButton=dialog.querySelector('[data-bike-export]'),downloadButton=dialog.querySelector('[data-bike-download]'),status=dialog.querySelector('[data-bike-export-status]'),retry=dialog.querySelector('[data-bike-preview-retry]');
    function current() {if(!alive)return false;if(!dialog.isConnected||!isCurrent()){destroy();return false;}return true;}
    function destroy() {
      if(!alive)return;alive=false;sequence++;controller.abort();pointers.clear();
      if(fileUrl)URL.revokeObjectURL(fileUrl);fileUrl='';photoFile=null;
      dialog.remove();onClose();
      if(returnFocus?.isConnected&&isCurrent())returnFocus.focus({preventScroll:true});
    }
    function message(text,error=false){if(!current())return;status.textContent=text;status.classList.toggle('error',error);}
    function updateView() {
      zoom=clamp(zoom,1,3);const rect=canvas.getBoundingClientRect();
      const extra=Math.abs(rotation)%180===90?.25:0;
      panX=clamp(panX,-rect.width*((zoom-1)/2+extra),rect.width*((zoom-1)/2+extra));
      panY=clamp(panY,-rect.height*((zoom-1)/2+extra),rect.height*((zoom-1)/2+extra));
      art.style.transform=`translate(${panX}px,${panY}px) rotate(${rotation}deg) scale(${zoom})`;
      dialog.querySelector('[data-bike-zoom-level]').textContent=Math.round(zoom*100)+'%';
      dialog.querySelector('[data-bike-zoom="out"]').disabled=zoom<=1;
      dialog.querySelector('[data-bike-zoom="in"]').disabled=zoom>=3;
    }
    function resetView(){zoom=1;rotation=0;panX=0;panY=0;pointers.clear();gesture=null;updateView();}
    async function preparePhoto() {
      const mine=++sequence,snapshot=JKCrewBikeConfig.normalize(config);
      photoFile=null;exportButton.disabled=true;downloadButton.hidden=true;retry.hidden=true;
      if(fileUrl)URL.revokeObjectURL(fileUrl);fileUrl='';
      art.innerHTML='<p class="bike-photo-placeholder">Preparing your bike photo…</p>';art.setAttribute('aria-busy','true');message('Preparing your photo…');
      try {
        let blob;
        if(capture){
          // Use the same model as the 360 viewer; never substitute older artwork
          // if capturing the current bike fails.
          blob=await capture(snapshot);
        }else{
          await JKCrewBikeArt.prepare(snapshot);
          const scene=sceneFor(snapshot.background);
          if(scene.url)await inlineAsset(scene.url,signal);
          if(!current()||mine!==sequence)return;
          const markup=renderScene(snapshot,{idPrefix:'garage-photo-'+mine});art.innerHTML=markup;
          blob=await pngFromSvg(markup,signal);
        }
        if(!current()||mine!==sequence)return;
        const filename=(String(name).trim().replace(/[^a-z0-9_-]+/gi,'-').slice(0,50)||'my-dream-bike')+'-jkcrew.png';
        const nextUrl=URL.createObjectURL(blob);
        let image;
        try{if(capture)image=await decodeImage(nextUrl,signal);}catch(error){URL.revokeObjectURL(nextUrl);throw error;}
        if(!current()||mine!==sequence){URL.revokeObjectURL(nextUrl);return;}
        photoFile=new File([blob],filename,{type:'image/png'});fileUrl=nextUrl;exportButton.disabled=false;
        if(image){image.alt=name+' — your finished bike';image.dataset.bikeModelPhoto='';art.replaceChildren(image);}
        art.setAttribute('aria-busy','false');
        message('Photo ready · High-resolution PNG');
      } catch(error) {
        if(!current()||mine!==sequence)return;
        art.innerHTML='<p class="bike-photo-placeholder">The photo could not load.<br>Choose Try again below.</p>';art.setAttribute('aria-busy','false');retry.hidden=false;message('Could not prepare the photo. Check your connection and try again.',true);
      }
    }
    function download() {
      if(!current()||!photoFile||!fileUrl)return;
      const link=document.createElement('a');link.href=fileUrl;link.download=photoFile.name;document.body.append(link);link.click();link.remove();
      message('Photo downloaded. Open it from Downloads to save to Photos.');
    }
    async function savePhoto() {
      if(!current()||!photoFile||sharing)return;
      const file=photoFile;
      let supported=false;try{supported=Boolean(navigator.canShare?.({files:[file]})&&navigator.share);}catch{}
      if(!supported)return download();
      sharing=true;exportButton.disabled=true;
      try {
        // Prepared ahead of this click: share retains the browser's user gesture.
        await navigator.share({files:[file],title:String(name)});
        if(current())message('Photo opened in your device’s share sheet.');
      } catch(error) {
        if(!current())return;
        if(error?.name==='AbortError')message('Photo ready · High-resolution PNG');
        else {downloadButton.hidden=false;message('The share sheet could not open. Try again or download the PNG.',true);}
      } finally {sharing=false;if(current())exportButton.disabled=!photoFile;}
    }
    dialog.addEventListener('close',destroy,{signal});dialog.addEventListener('cancel',event=>{event.preventDefault();destroy();},{signal});
    dialog.addEventListener('click',event=>{
      const button=event.target.closest('button');if(!button||button.disabled||!current())return;
      if(button.hasAttribute('data-bike-preview-close'))return destroy();
      if(button.hasAttribute('data-bike-export'))return void savePhoto();
      if(button.hasAttribute('data-bike-download'))return download();
      if(button.hasAttribute('data-bike-preview-retry'))return void preparePhoto();
      if(button.dataset.bikeZoom){zoom+=button.dataset.bikeZoom==='in'?.25:-.25;return updateView();}
      if(button.dataset.bikeRotate){rotation=(rotation+(button.dataset.bikeRotate==='left'?-90:90))%360;return updateView();}
      if(button.hasAttribute('data-bike-view-reset'))return resetView();
      if(button.dataset.bikeScene) {
        const next=button.dataset.bikeScene;if(sharing||!scenes.some(scene=>scene.id===next)||next===config.background)return;
        let accepted;try{accepted=onBackgroundChange(next);}catch{accepted=null;}
        if(!accepted||!current()){if(alive)message('Finish saving your bike, then try this background again.',true);return;}
        const canonical=JKCrewBikeConfig.normalize(accepted);if(canonical.background!==next)return;
        config=canonical;for(const choice of dialog.querySelectorAll('[data-bike-scene]'))choice.setAttribute('aria-pressed',String(choice.dataset.bikeScene===next));
        resetView();void preparePhoto();
      }
    },{signal});
    function beginGesture(){const values=[...pointers.values()];gesture=values.length>=2?{distance:Math.hypot(values[1].x-values[0].x,values[1].y-values[0].y),zoom,x:(values[0].x+values[1].x)/2,y:(values[0].y+values[1].y)/2,panX,panY}:values.length?{x:values[0].x,y:values[0].y,panX,panY}:null;}
    canvas.addEventListener('pointerdown',event=>{if(!current())return;event.preventDefault();pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});canvas.setPointerCapture(event.pointerId);beginGesture();},{signal});
    canvas.addEventListener('pointermove',event=>{if(!pointers.has(event.pointerId)||!current())return;pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});const points=[...pointers.values()];if(points.length>=2&&gesture?.distance){zoom=gesture.zoom*Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y)/Math.max(1,gesture.distance);panX=gesture.panX+(points[0].x+points[1].x)/2-gesture.x;panY=gesture.panY+(points[0].y+points[1].y)/2-gesture.y;}else if(gesture){panX=gesture.panX+event.clientX-gesture.x;panY=gesture.panY+event.clientY-gesture.y;}updateView();},{signal});
    for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,event=>{pointers.delete(event.pointerId);beginGesture();},{signal});
    canvas.addEventListener('wheel',event=>{if(!current())return;event.preventDefault();zoom*=Math.exp(-event.deltaY*.002);updateView();},{signal,passive:false});
    canvas.addEventListener('dblclick',resetView,{signal});
    canvas.addEventListener('keydown',event=>{if(!current())return;if(['+','=','-','0','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))event.preventDefault();if(event.key==='+'||event.key==='=')zoom+=.25;else if(event.key==='-')zoom-=.25;else if(event.key==='0')return resetView();else if(event.key==='ArrowLeft')panX-=30;else if(event.key==='ArrowRight')panX+=30;else if(event.key==='ArrowUp')panY-=30;else if(event.key==='ArrowDown')panY+=30;updateView();},{signal});
    updateView();void preparePhoto();
    return Object.freeze({destroy});
  }
  return Object.freeze({mount,renderScene,scenes});
})();
globalThis.JKCrewBikePreview=JKCrewBikePreview;
