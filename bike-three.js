/* Original local 3D BMX viewer. No module, image or GPU work begins before mount(). */
(function(global){
  'use strict';
  const scriptURL=document.currentScript?.src||new URL('bike-three.js',location.href).href;
  const baseURL=new URL('.',scriptURL);
  const modelURL=new URL('bike-three-model.js',baseURL);modelURL.search=new URL(scriptURL).search;
  let dependencies;
  function modules(){return dependencies||(dependencies=Promise.all([
    import(new URL('vendor/three.module.min.js',baseURL)),
    import(new URL('vendor/OrbitControls.js',baseURL)),
    import(new URL('vendor/RoomEnvironment.js',baseURL)),
    import(modelURL)
  ]).catch(error=>{dependencies=null;throw error;}));}
  // Named camera views. "fit" views frame the whole bike (yaw/polar chosen,
  // distance computed from the actual model bounds); "focus" views dolly in
  // on one area of the bike at a fixed distance for a studio-style detail
  // shot. Local coordinates are in the same metres/origin the bike model
  // itself uses, and are close enough across every frame preset to still
  // read as a clean close-up.
  const CAMERA_PRESETS=Object.freeze([
    {id:'hero',label:'Full bike',kind:'fit',yawByAspect:true,polar:1.31},
    {id:'side',label:'Side profile',kind:'fit',yaw:Math.PI/2,polar:1.40},
    {id:'top',label:'Top down',kind:'fit',yaw:.6,polar:.62},
    {id:'cockpit',label:'Cockpit',kind:'focus',local:[.30,.665,0],yaw:.95,polar:1.20,distance:.44},
    {id:'drivetrain',label:'Drivetrain',kind:'focus',local:[-.16,.30,.05],yaw:-.75,polar:1.28,distance:.40},
    {id:'wheel',label:'Front wheel',kind:'focus',local:[.505,.266,.03],yaw:1.0,polar:1.40,distance:.34},
  ]);
  const BACKGROUND_MOOD={
    studio:{sky:'#e9edf2',fog:'#e9edf2',ground:'#e3e8ee',key:'#fff7ee',fill:'#d5e7ff',keyIntensity:2.7,fillIntensity:1.2},
    street:{sky:'#c7d2dc',fog:'#c7d2dc',ground:'#8b9096',key:'#fff4e2',fill:'#cfe0f2',keyIntensity:2.85,fillIntensity:1.15},
    skatepark:{sky:'#dbe6ee',fog:'#dbe6ee',ground:'#aab0b6',key:'#fffaf0',fill:'#d8ecff',keyIntensity:3.0,fillIntensity:1.25},
    warehouse:{sky:'#453b34',fog:'#453b34',ground:'#585049',key:'#ffcf94',fill:'#8f9db8',keyIntensity:2.35,fillIntensity:.95},
    rooftop:{sky:'#e7a980',fog:'#d99a7c',ground:'#6c6a6e',key:'#ffb27a',fill:'#7d8fc4',keyIntensity:2.5,fillIntensity:1.35},
  };
  async function mount({element,configuration,onSelect,onError,onAutoRotateChange,isCurrent=()=>true}={}){
    if(!element?.appendChild)throw new TypeError('The 3D viewer needs a container.');
    let T,OrbitControls,RoomEnvironment,createBike;
    try{const d=await modules();[T,{OrbitControls},{RoomEnvironment},{createBike}]=d;}catch(error){if(isCurrent())onError?.(error);throw error;}
    if(!isCurrent())throw new DOMException('The bike view has changed.','AbortError');
    let renderer;
    try{renderer=new T.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance',preserveDrawingBuffer:false});}catch(error){if(isCurrent())onError?.(error);throw error;}
    let failCleanup=()=>{renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();};
    try{
    const stillPixelRatio=Math.min(global.devicePixelRatio||1,1.75);
    renderer.setPixelRatio(stillPixelRatio);
    renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.96;
    renderer.shadowMap.enabled=true;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;renderer.shadowMap.type=T.VSMShadowMap;
    const canvas=renderer.domElement;canvas.className='bike-three-canvas';canvas.setAttribute('role','img');canvas.setAttribute('aria-label','Your custom BMX. Drag to rotate. Pinch or use plus and minus to zoom. Arrow keys rotate; Home resets the view.');canvas.tabIndex=0;
    Object.assign(canvas.style,{width:'100%',height:'100%',display:'block',touchAction:'none',outlineOffset:'-3px'});element.appendChild(canvas);
    const scene=new T.Scene();scene.background=new T.Color('#e9edf2');scene.fog=new T.Fog('#e9edf2',5,13);
    const camera=new T.PerspectiveCamera(33,1,.01,30),target=new T.Vector3(-.015,.48,0);
    const controls=new OrbitControls(camera,canvas);controls.target.copy(target);controls.enableDamping=true;controls.dampingFactor=.12;controls.enablePan=false;controls.minDistance=.26;controls.maxDistance=4.6;controls.minPolarAngle=Math.PI*.10;controls.maxPolarAngle=Math.PI*.495;controls.rotateSpeed=.72;controls.zoomSpeed=.85;controls.autoRotateSpeed=1.5;
    controls.touches={ONE:T.TOUCH.ROTATE,TWO:T.TOUCH.DOLLY_PAN};
    const pmrem=new T.PMREMGenerator(renderer),room=new RoomEnvironment(),environment=pmrem.fromScene(room,.04);
    scene.environment=environment.texture;scene.environmentIntensity=1.05;room.dispose();pmrem.dispose();
    const hemi=new T.HemisphereLight('#eff5ff','#69717e',.48);scene.add(hemi);
    const key=new T.DirectionalLight('#fff7ee',2.7);key.position.set(1.1,3.2,2.3);key.castShadow=true;key.shadow.mapSize.set(2048,2048);key.shadow.camera.left=-1.5;key.shadow.camera.right=1.5;key.shadow.camera.top=1.5;key.shadow.camera.bottom=-1.5;key.shadow.camera.near=.1;key.shadow.camera.far=7;key.shadow.normalBias=.001;key.shadow.bias=-.0001;key.shadow.radius=4;key.shadow.blurSamples=8;scene.add(key);
    const fill=new T.DirectionalLight('#d5e7ff',1.2);fill.position.set(-1.8,1.8,-2.2);scene.add(fill);
    // A soft rim/back light for edge separation against the backdrop, and a
    // faint ground bounce so shadowed undersides never go fully flat —
    // together they read as a small studio softbox setup rather than one
    // bare sun lamp.
    const rim=new T.DirectionalLight('#eaf3ff',.9);rim.position.set(-.6,1.4,-3.0);scene.add(rim);
    const bounce=new T.PointLight('#fff2df',.35,4,2);bounce.position.set(0,.05,.9);scene.add(bounce);
    const groundMaterial=new T.MeshStandardMaterial({color:'#e3e8ee',roughness:.87});
    const groundGeometry=new T.PlaneGeometry(80,80),ground=new T.Mesh(groundGeometry,groundMaterial);ground.rotation.x=-Math.PI/2;ground.position.y=-.002;ground.receiveShadow=true;scene.add(ground);
    const contactCanvas=document.createElement('canvas');contactCanvas.width=contactCanvas.height=128;const contactContext=contactCanvas.getContext('2d'),gradient=contactContext.createRadialGradient(64,64,2,64,64,64);gradient.addColorStop(0,'rgba(20,24,30,.42)');gradient.addColorStop(.38,'rgba(20,24,30,.17)');gradient.addColorStop(1,'rgba(20,24,30,0)');contactContext.fillStyle=gradient;contactContext.fillRect(0,0,128,128);const contactTexture=new T.CanvasTexture(contactCanvas),contactMaterial=new T.MeshBasicMaterial({map:contactTexture,transparent:true,depthWrite:false}),contactGeometry=new T.PlaneGeometry(.22,.12);for(const x of [-.54,.505]){const contact=new T.Mesh(contactGeometry,contactMaterial);contact.rotation.x=-Math.PI/2;contact.position.set(x,.0002,0);scene.add(contact);}
    let model=null,disposed=false,frame=0,framesLeft=0,buildNumber=0,currentFingerprint='',selected='',ready=Promise.resolve(),hasFit=false,lastFitDistance=0,lastWidth=0,lastHeight=0,currentBackground='studio';
    const temporaryMaterials=[],temporaryGeometries=[],temporaryTextures=[];
    let groundMapTexture=null;
    const scenery=new T.Group();scene.add(scenery);
    function clearScenery(){for(const g of temporaryGeometries)g.dispose();for(const m of temporaryMaterials)m.dispose();for(const t of temporaryTextures)t.dispose();temporaryGeometries.length=temporaryMaterials.length=temporaryTextures.length=0;scenery.clear();}
    function sceneryBox(position,size,color){const g=new T.BoxGeometry(...size),m=new T.MeshStandardMaterial({color,roughness:.9});temporaryGeometries.push(g);temporaryMaterials.push(m);const obj=new T.Mesh(g,m);obj.position.set(...position);obj.castShadow=obj.receiveShadow=true;scenery.add(obj);return obj;}
    function canvasTexture(size,draw){const cnv=document.createElement('canvas');cnv.width=cnv.height=size;draw(cnv.getContext('2d'),size);const tex=new T.CanvasTexture(cnv);tex.colorSpace=T.SRGBColorSpace;temporaryTextures.push(tex);return tex;}
    // A full 360° textured cylinder around the bike so every background
    // reads correctly from any orbit angle, not just from one "front" side.
    function cyclorama(radius,height,draw,repeatX=3){
      const tex=canvasTexture(512,draw);tex.wrapS=T.RepeatWrapping;tex.repeat.set(repeatX,1);
      const g=new T.CylinderGeometry(radius,radius,height,56,1,true),m=new T.MeshStandardMaterial({map:tex,side:T.BackSide,roughness:1,fog:true});
      temporaryGeometries.push(g);temporaryMaterials.push(m);
      const mesh=new T.Mesh(g,m);mesh.position.y=height/2-.01;scenery.add(mesh);return mesh;
    }
    // A soft dusk sky dome (rooftop) — the skyline silhouette is baked into
    // the same panoramic texture, so it too is correct from every angle.
    function skyDome(radius,draw){
      const tex=canvasTexture(512,draw);tex.wrapS=T.RepeatWrapping;
      const g=new T.SphereGeometry(radius,40,20,0,TAU2),m=new T.MeshBasicMaterial({map:tex,side:T.BackSide,fog:false});
      temporaryGeometries.push(g);temporaryMaterials.push(m);
      const mesh=new T.Mesh(g,m);scenery.add(mesh);return mesh;
    }
    const TAU2=Math.PI*2;
    function setGroundTexture(draw,repeat=16){
      if(groundMapTexture){groundMapTexture.dispose();groundMapTexture=null;}
      groundMapTexture=draw?canvasTexture(256,draw):null;
      if(groundMapTexture){groundMapTexture.wrapS=groundMapTexture.wrapT=T.RepeatWrapping;groundMapTexture.repeat.set(repeat,repeat);}
      groundMaterial.map=groundMapTexture;groundMaterial.needsUpdate=true;
    }
    // Each background swaps the studio cyc for a lightweight, fully-surround
    // 3D environment and re-tints the lighting to match its mood — the 3D
    // orbit view now honours the same background choice as Photo Studio,
    // instead of ignoring it.
    function background(name){
      clearScenery();
      const mood=BACKGROUND_MOOD[name]||BACKGROUND_MOOD.studio;
      currentBackground=BACKGROUND_MOOD[name]?name:'studio';
      scene.background=new T.Color(mood.sky);scene.fog.color.set(mood.fog);
      key.color.set(mood.key);key.intensity=mood.keyIntensity;fill.color.set(mood.fill);fill.intensity=mood.fillIntensity;
      groundMaterial.color.set(mood.ground);
      if(currentBackground==='studio'){setGroundTexture(null);scene.fog.near=5;scene.fog.far=13;return;}
      scene.fog.near=2.6;scene.fog.far=currentBackground==='rooftop'?11:7.4;
      if(currentBackground==='street'){
        setGroundTexture((ctx,s)=>{ctx.fillStyle='#8b9096';ctx.fillRect(0,0,s,s);for(let i=0;i<420;i++){ctx.fillStyle=`rgba(0,0,0,${.03+Math.random()*.05})`;ctx.beginPath();ctx.arc(Math.random()*s,Math.random()*s,.6+Math.random()*1.6,0,TAU2);ctx.fill();}ctx.strokeStyle='#d8d3c4';ctx.lineWidth=3;ctx.setLineDash([10,9]);ctx.beginPath();ctx.moveTo(s*.5,0);ctx.lineTo(s*.5,s);ctx.stroke();},20);
        cyclorama(3.3,3.1,(ctx,s)=>{ctx.fillStyle='#c9c2b4';ctx.fillRect(0,0,s,s);for(let x=0;x<s;x+=s/24)ctx.fillRect(x,0,1,s);for(let y=0;y<s;y+=s/9)ctx.fillRect(0,y,s,1);
          const blocks=[['#9c5b6b',.06],['#6a7f97',.10],['#c9a24a',.05],['#516b58',.07]];
          for(const [color,cover] of blocks){ctx.fillStyle=color;const w=s*cover*3,h=s*.32;ctx.fillRect(Math.random()*(s-w),s*.42+Math.random()*(s*.2),w,h);}
          ctx.fillStyle='#3a3f46';ctx.fillRect(0,s*.82,s,s*.18);},4);
      }else if(currentBackground==='skatepark'){
        setGroundTexture((ctx,s)=>{ctx.fillStyle='#aab0b6';ctx.fillRect(0,0,s,s);for(let i=0;i<260;i++){ctx.fillStyle=`rgba(255,255,255,${.02+Math.random()*.04})`;ctx.beginPath();ctx.arc(Math.random()*s,Math.random()*s,1+Math.random()*3,0,TAU2);ctx.fill();}for(let x=0;x<s;x+=s/5){ctx.strokeStyle='rgba(60,66,72,.18)';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,s);ctx.stroke();}},14);
        cyclorama(3.3,2.9,(ctx,s)=>{ctx.fillStyle='#c4cad0';ctx.fillRect(0,0,s,s);ctx.fillStyle='#aeb6bc';ctx.fillRect(0,s*.62,s,s*.06);for(let x=0;x<s;x+=s/5){ctx.strokeStyle='rgba(70,78,86,.22)';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,s*.68);ctx.stroke();}ctx.fillStyle='#8f97a0';ctx.fillRect(0,s*.68,s,s*.32);},4);
      }else if(currentBackground==='warehouse'){
        setGroundTexture((ctx,s)=>{ctx.fillStyle='#585049';ctx.fillRect(0,0,s,s);for(let i=0;i<300;i++){ctx.fillStyle=`rgba(0,0,0,${.04+Math.random()*.08})`;ctx.beginPath();ctx.arc(Math.random()*s,Math.random()*s,1+Math.random()*4,0,TAU2);ctx.fill();}},12);
        cyclorama(3.1,3.4,(ctx,s)=>{ctx.fillStyle='#6b5f52';ctx.fillRect(0,0,s,s);ctx.fillStyle='#5a5045';for(let y=0;y<s*.6;y+=s/18){for(let x=(y/(s/18))%2*s/12;x<s;x+=s/6)ctx.fillRect(x,y,s/6-2,s/18-2);}
          ctx.fillStyle='#2c2723';ctx.fillRect(0,0,s,s*.05);for(let x=0;x<s;x+=s/6){ctx.fillRect(x,0,s*.02,s*.28);}
          ctx.fillStyle='#3a332c';ctx.fillRect(0,s*.66,s,s*.34);},5);
      }else if(currentBackground==='rooftop'){
        setGroundTexture((ctx,s)=>{ctx.fillStyle='#6c6a6e';ctx.fillRect(0,0,s,s);for(let i=0;i<240;i++){ctx.fillStyle=`rgba(0,0,0,${.03+Math.random()*.06})`;ctx.beginPath();ctx.arc(Math.random()*s,Math.random()*s,1+Math.random()*3,0,TAU2);ctx.fill();}},10);
        skyDome(6,(ctx,s)=>{const g=ctx.createLinearGradient(0,0,0,s);g.addColorStop(0,'#4a4f7c');g.addColorStop(.42,'#c97a72');g.addColorStop(.62,'#e7a980');g.addColorStop(1,'#8a8078');ctx.fillStyle=g;ctx.fillRect(0,0,s,s);
          ctx.fillStyle='rgba(35,32,45,.85)';for(let i=0;i<9;i++){const w=s*(.05+Math.random()*.07),h=s*(.14+Math.random()*.2),x=(i/9)*s+Math.random()*10;ctx.fillRect(x,s*.66-h,w,h);for(let wy=s*.66-h+6;wy<s*.65;wy+=8)for(let wx=x+4;wx<x+w-4;wx+=7)if(Math.random()>.5){ctx.fillStyle='rgba(255,214,150,.5)';ctx.fillRect(wx,wy,2.5,3);ctx.fillStyle='rgba(35,32,45,.85)';}}
          ctx.fillStyle='#55535f';ctx.fillRect(0,s*.66,s,s*.34);});
        // A low parapet ledge ring, close enough to read from every angle.
        {const g=new T.TorusGeometry(1.85,.05,8,48),m=new T.MeshStandardMaterial({color:'#8a8a86',roughness:.85});temporaryGeometries.push(g);temporaryMaterials.push(m);const ring=new T.Mesh(g,m);ring.rotation.x=Math.PI/2;ring.position.y=.14;scenery.add(ring);}
      }
    }
    function getView(){return {yaw:controls.getAzimuthalAngle(),polar:controls.getPolarAngle(),distance:camera.position.distanceTo(controls.target),target:[controls.target.x,controls.target.y,controls.target.z]};}
    function updateReadout(){const view=getView();canvas.dataset.yaw=String(view.yaw);canvas.dataset.polar=String(view.polar);canvas.dataset.distance=String(view.distance);canvas.dataset.ready=model?'true':'false';canvas.dataset.drawCalls=String(renderer.info.render.calls);canvas.dataset.triangles=String(renderer.info.render.triangles);canvas.dataset.background=currentBackground;}
    let renderingTick=false,renderedFrames=0,lastTickTime=0;
    function draw(){if(disposed||!isCurrent())return;renderer.render(scene,camera);renderedFrames++;updateReadout();}
    function tick(now){
      frame=0;if(disposed||!isCurrent()||document.hidden)return;
      // OrbitControls emits change synchronously from update(). Keep that
      // callback from starting a second animation chain inside this frame.
      renderingTick=true;
      const delta=lastTickTime?Math.min((now-lastTickTime)/1000,.05):1/60;lastTickTime=now;
      controls.update(delta);draw();renderingTick=false;
      if(controls.autoRotate)framesLeft=Math.max(framesLeft,2);
      if(--framesLeft>0)frame=requestAnimationFrame(tick);
      else {lastTickTime=0;setMotionQuality(false);}
    }
    function setMotionQuality(moving){
      // Keep full resolution for a still bike and exports. Touch rotation
      // does not need to shade every high-DPI phone pixel on every frame.
      const ratio=moving?Math.min(stillPixelRatio,1):stillPixelRatio;
      if(renderer.getPixelRatio()!==ratio){renderer.setPixelRatio(ratio);requestDraw();}
    }
    function requestDraw(count=2){if(disposed)return;framesLeft=Math.max(framesLeft,count);if(!frame&&!renderingTick&&!document.hidden)frame=requestAnimationFrame(tick);}
    function setView(value={}){if(disposed)return;const old=getView();const yaw=Number.isFinite(value.yaw)?value.yaw:old.yaw,polar=T.MathUtils.clamp(Number.isFinite(value.polar)?value.polar:old.polar,controls.minPolarAngle,controls.maxPolarAngle),distance=T.MathUtils.clamp(Number.isFinite(value.distance)?value.distance:old.distance,controls.minDistance,controls.maxDistance);if(Array.isArray(value.target)&&value.target.length===3&&value.target.every(Number.isFinite))controls.target.set(...value.target);const sphere=new T.Spherical(distance,polar,yaw);camera.position.copy(controls.target).add(new T.Vector3().setFromSpherical(sphere));camera.lookAt(controls.target);controls.update();requestDraw(16);}
    let flightFrame=0;
    function cancelFlight(){if(flightFrame){cancelAnimationFrame(flightFrame);flightFrame=0;}}
    const easeInOutCubic=t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
    function animateToView(nextView,duration=700){
      cancelFlight();setMotionQuality(true);
      const startView=getView(),startTime=performance.now();
      let yawDelta=nextView.yaw-startView.yaw;yawDelta=((yawDelta+Math.PI)%TAU2+TAU2)%TAU2-Math.PI;
      const startTarget=controls.target.clone(),endTarget=Array.isArray(nextView.target)?new T.Vector3(...nextView.target):controls.target.clone();
      const startDistance=startView.distance,startPolar=startView.polar;
      function step(now){
        if(disposed||!isCurrent()){flightFrame=0;return;}
        const t=Math.min(1,(now-startTime)/duration),e=easeInOutCubic(t);
        setView({
          yaw:startView.yaw+yawDelta*e,
          polar:startPolar+(nextView.polar-startPolar)*e,
          distance:startDistance+(nextView.distance-startDistance)*e,
          target:[startTarget.x+(endTarget.x-startTarget.x)*e,startTarget.y+(endTarget.y-startTarget.y)*e,startTarget.z+(endTarget.z-startTarget.z)*e]
        });
        flightFrame=t<1?requestAnimationFrame(step):0;
      }
      flightFrame=requestAnimationFrame(step);
    }
    function fitDistance(yaw,polar){
      if(!model)return 2.5;
      const direction=new T.Vector3().setFromSpherical(new T.Spherical(1,polar,yaw));
      const horizontal=new T.Vector3().crossVectors(new T.Vector3(0,1,0),direction).normalize(),vertical=new T.Vector3().crossVectors(direction,horizontal).normalize();
      const tanVertical=Math.tan(T.MathUtils.degToRad(camera.fov)*.5),tanHorizontal=tanVertical*camera.aspect;
      let distance=1.13;
      model.group.updateMatrixWorld(true);const matrix=new T.Matrix4(),instance=new T.Matrix4();
      model.group.traverse(mesh=>{if(!mesh.isMesh)return;mesh.geometry.computeBoundingBox();const box=mesh.geometry.boundingBox,count=mesh.isInstancedMesh?mesh.count:1;
        for(let i=0;i<count;i++){matrix.copy(mesh.matrixWorld);if(mesh.isInstancedMesh){mesh.getMatrixAt(i,instance);matrix.multiply(instance);}
          for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){const delta=new T.Vector3(x,y,z).applyMatrix4(matrix).sub(controls.target),radius=Math.hypot(delta.x,delta.z),sine=Math.sin(polar),cosine=Math.cos(polar);
            // Fit the complete horizontal orbit, including the near tyre in front/rear views.
            const across=radius*Math.hypot(1.10/tanHorizontal,sine)+delta.y*cosine;
            const near=Math.abs(delta.y*sine-radius*cosine)*1.10/tanVertical+delta.y*cosine+radius*sine;
            const far=Math.abs(delta.y*sine+radius*cosine)*1.10/tanVertical+delta.y*cosine-radius*sine;
            distance=Math.max(distance,across,near,far);}
        }
      });
      controls.maxDistance=Math.max(4.6,distance*2.2);
      return distance;
    }
    // Every named camera view (see CAMERA_PRESETS) resolves to a concrete
    // {yaw,polar,distance,target}. "fit" views always frame the whole bike
    // from the shared default target; "focus" views dolly to a fixed point
    // and distance for a close, studio-style detail shot.
    function viewForPreset(id){
      const preset=CAMERA_PRESETS.find(p=>p.id===id)||CAMERA_PRESETS[0];
      if(preset.kind==='focus'){
        return {yaw:preset.yaw,polar:preset.polar,distance:preset.distance,target:preset.local};
      }
      const yaw=preset.yawByAspect?(camera.aspect<.85?.32:.48):preset.yaw;
      // fitDistance reads controls.target internally; compute against the
      // shared default target without leaving controls.target mutated, so
      // an in-flight transition can still animate the target smoothly.
      const restoreTarget=controls.target.clone();controls.target.copy(target);
      const distance=fitDistance(yaw,preset.polar);
      controls.target.copy(restoreTarget);
      return {yaw,polar:preset.polar,distance,target:[target.x,target.y,target.z]};
    }
    function setCameraPreset(id,{animate=true}={}){
      if(disposed)return;
      const view=viewForPreset(id);
      if(id==='hero'||CAMERA_PRESETS.find(p=>p.id===id)?.kind==='fit')lastFitDistance=view.distance;
      if(animate)animateToView(view);else{controls.target.set(...view.target);setView(view);}
    }
    function resetView(animate=false){setCameraPreset('hero',{animate});}
    function setAutoRotate(on){if(disposed)return;controls.autoRotate=Boolean(on);setMotionQuality(controls.autoRotate);if(controls.autoRotate){cancelFlight();requestDraw(2);}}
    function resize(){if(disposed)return;const w=Math.max(1,Math.round(element.clientWidth)),h=Math.max(1,Math.round(element.clientHeight));if(w===lastWidth&&h===lastHeight)return;lastWidth=w;lastHeight=h;const previous=getView(),zoomRatio=lastFitDistance?previous.distance/lastFitDistance:1;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
      // Cheap, harmless safeguard: force one fresh shadow pass whenever the canvas
      // is resized, in case anything shadow-related was sized off the old aspect.
      renderer.shadowMap.needsUpdate=true;
      if(w>1&&h>1){if(!hasFit){hasFit=true;resetView(false);}else{lastFitDistance=fitDistance(previous.yaw,previous.polar);setView({...previous,distance:lastFitDistance*zoomRatio});}}requestDraw(2);}
    const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(element);
    // A cheap, self-contained "inflated hull" outline: a slightly enlarged,
    // back-face-only duplicate of the selected part's own meshes. It shares
    // geometry with the model (never cloned) and uses one shared material,
    // so selecting parts costs almost nothing and needs no shader passes.
    const highlightMaterial=new T.MeshBasicMaterial({color:'#7CE9DD',transparent:true,opacity:.55,side:T.BackSide,depthWrite:false});highlightMaterial.toneMapped=false;
    let highlightMeshes=[];
    function clearHighlight(){for(const mesh of highlightMeshes)mesh.parent?.remove(mesh);highlightMeshes=[];}
    function applyHighlight(partName){
      clearHighlight();
      const group=model?.parts?.[partName];if(!disposed&&group){
        const scale=1.09;
        group.traverse(obj=>{
          if(obj.isMesh&&!obj.isInstancedMesh){
            const geometry=obj.geometry;
            if(!geometry.boundingSphere)geometry.computeBoundingSphere();
            // This model's meshes carry their vertex positions directly in the
            // parent group's space rather than centred on a local (0,0,0),
            // so a plain object.scale() would inflate outward from the wrong
            // point (the whole model's origin) and balloon far off the part.
            // Scaling instead around each mesh's own bounding-sphere centre,
            // by folding a compensating offset into the outline's position,
            // keeps the inflated hull anchored tightly to the selected part.
            const center=geometry.boundingSphere?geometry.boundingSphere.center:null;
            const outline=new T.Mesh(geometry,highlightMaterial);
            outline.quaternion.copy(obj.quaternion);
            outline.scale.setScalar(scale);
            outline.position.copy(obj.position);
            if(center){const offset=center.clone().multiplyScalar(1-scale).applyQuaternion(obj.quaternion);outline.position.add(offset);}
            obj.parent.add(outline);
            highlightMeshes.push(outline);
          }
        });
      }
      requestDraw(6);
    }
    function selectedPart(part){selected=typeof part==='string'?part:'';canvas.dataset.selectedPart=selected;applyHighlight(selected);}
    function update(config){if(disposed||!isCurrent())return Promise.resolve();const normalized=global.JKCrewBikeConfig.normalize(config),fingerprint=JSON.stringify(normalized);if(fingerprint===currentFingerprint)return ready;const backgroundChanged=normalized.background!==currentBackground;currentFingerprint=fingerprint;if(model?.updateColours(normalized)){if(backgroundChanged){background(normalized.background);renderer.shadowMap.needsUpdate=true;}requestDraw();return ready;}const build=++buildNumber;
      let next;try{next=createBike(normalized);}catch(error){currentFingerprint='';if(!model)throw error;if(isCurrent())onError?.(error);return Promise.resolve();}clearHighlight();const old=model;model=next;scene.add(model.group);if(old){scene.remove(old.group);old.dispose();}background(normalized.background);renderer.shadowMap.needsUpdate=true;requestDraw();ready=model.ready.then(()=>{if(!disposed&&build===buildNumber){selectedPart(selected);draw();}},error=>{if(!disposed&&isCurrent())onError?.(error);});return ready;
    }
    const raycaster=new T.Raycaster(),pointer=new T.Vector2(),pointers=new Map();let tap=null,multitouch=false,hoverFrame=0;
    function partUnderPointer(clientX,clientY){
      if(!model)return null;
      const rect=canvas.getBoundingClientRect();pointer.set((clientX-rect.left)/rect.width*2-1,-(clientY-rect.top)/rect.height*2+1);
      raycaster.setFromCamera(pointer,camera);
      return raycaster.intersectObject(model.group,true).find(hit=>hit.object.userData.part)||null;
    }
    function pointerDown(event){pointers.set(event.pointerId,[event.clientX,event.clientY]);if(pointers.size>1)multitouch=true;else{multitouch=false;tap={id:event.pointerId,x:event.clientX,y:event.clientY,moved:false,time:performance.now()};}if(pointers.size)cancelFlight();}
    function pointerMove(event){
      if(tap&&tap.id===event.pointerId&&Math.hypot(event.clientX-tap.x,event.clientY-tap.y)>6)tap.moved=true;
      if(event.pointerType==='mouse'&&!pointers.size&&!hoverFrame){const x=event.clientX,y=event.clientY;hoverFrame=requestAnimationFrame(()=>{hoverFrame=0;if(disposed||!isCurrent())return;const hit=partUnderPointer(x,y);canvas.style.cursor=hit?'pointer':'';});}
    }
    function pointerUp(event){if(disposed||!isCurrent()||(event.pointerType==='mouse'&&event.button!==0))return;pointers.delete(event.pointerId);if(!tap||tap.moved||multitouch||tap.id!==event.pointerId||Math.hypot(event.clientX-tap.x,event.clientY-tap.y)>6||performance.now()-tap.time>650){if(!pointers.size)tap=null;return;}tap=null;const hit=partUnderPointer(event.clientX,event.clientY);if(hit){selectedPart(hit.object.userData.part);onSelect?.(hit.object.userData.part);}}
    function pointerCancel(event){pointers.delete(event.pointerId);tap=null;multitouch=true;}
    function keyDown(event){if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','_','Home'].includes(event.key))return;event.preventDefault();cancelFlight();const view=getView();if(event.key==='Home')return resetView(true);if(event.key==='ArrowLeft')view.yaw-=.13;if(event.key==='ArrowRight')view.yaw+=.13;if(event.key==='ArrowUp')view.polar-=.08;if(event.key==='ArrowDown')view.polar+=.08;if(event.key==='+'||event.key==='=')view.distance*=.9;if(event.key==='-'||event.key==='_')view.distance*=1.1;setView(view);}
    function visibility(){if(document.hidden){if(frame)cancelAnimationFrame(frame);frame=0;}else requestDraw(2);}
    function lost(event){event.preventDefault();onError?.(new Error('The 3D preview was interrupted. Reopen the preview to continue.'));}
    canvas.addEventListener('pointerdown',pointerDown);canvas.addEventListener('pointermove',pointerMove);canvas.addEventListener('pointerup',pointerUp);canvas.addEventListener('pointercancel',pointerCancel);canvas.addEventListener('keydown',keyDown);canvas.addEventListener('webglcontextlost',lost);document.addEventListener('visibilitychange',visibility);
    controls.addEventListener('change',()=>requestDraw(12));
    controls.addEventListener('start',()=>{cancelFlight();setMotionQuality(true);if(controls.autoRotate){controls.autoRotate=false;onAutoRotateChange?.(false);}requestDraw(24);});
    controls.addEventListener('end',()=>requestDraw(24));
    const handle={canvas,ready,update,selectPart:selectedPart,getView,setView,resetView,setCameraPreset,setAutoRotate,
      getStats:()=>({renderedFrames,pixelRatio:renderer.getPixelRatio(),calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures}),
      async exportBlob({type='image/png',quality=.94}={}){await ready;if(disposed||!isCurrent())throw new Error('The bike preview has closed.');const ratio=renderer.getPixelRatio();renderer.setPixelRatio(stillPixelRatio);draw();return new Promise((resolve,reject)=>canvas.toBlob(blob=>{if(!disposed){renderer.setPixelRatio(ratio);requestDraw();}blob?resolve(blob):reject(new Error('The image could not be created.'));},type,quality));},
      dispose(){if(disposed)return;disposed=true;buildNumber++;cancelFlight();if(hoverFrame)cancelAnimationFrame(hoverFrame);if(frame)cancelAnimationFrame(frame);resizeObserver.disconnect();controls.dispose();canvas.removeEventListener('pointerdown',pointerDown);canvas.removeEventListener('pointermove',pointerMove);canvas.removeEventListener('pointerup',pointerUp);canvas.removeEventListener('pointercancel',pointerCancel);canvas.removeEventListener('keydown',keyDown);canvas.removeEventListener('webglcontextlost',lost);document.removeEventListener('visibilitychange',visibility);clearHighlight();highlightMaterial.dispose();model?.dispose();clearScenery();if(groundMapTexture)groundMapTexture.dispose();groundGeometry.dispose();groundMaterial.dispose();contactTexture.dispose();contactMaterial.dispose();contactGeometry.dispose();key.shadow.dispose();environment.dispose();renderer.renderLists.dispose();renderer.dispose();renderer.forceContextLoss();canvas.remove();scene.clear();}
    };
    failCleanup=()=>handle.dispose();
    try{await update(configuration);if(!isCurrent())throw new DOMException('The bike view has changed.','AbortError');resize();draw();handle.ready=ready;return handle;}catch(error){handle.dispose();if(error.name!=='AbortError')onError?.(error);throw error;}
    }catch(error){failCleanup();throw error;}
  }
  global.JKCrewBike3D=Object.freeze({mount,cameraPresets:CAMERA_PRESETS.map(({id,label})=>Object.freeze({id,label}))});
})(globalThis);
