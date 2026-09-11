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
  async function mount({element,configuration,onSelect,onError,isCurrent=()=>true}={}){
    if(!element?.appendChild)throw new TypeError('The 3D viewer needs a container.');
    let T,OrbitControls,RoomEnvironment,createBike;
    try{const d=await modules();[T,{OrbitControls},{RoomEnvironment},{createBike}]=d;}catch(error){if(isCurrent())onError?.(error);throw error;}
    if(!isCurrent())throw new DOMException('The bike view has changed.','AbortError');
    let renderer;
    try{renderer=new T.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance',preserveDrawingBuffer:false});}catch(error){if(isCurrent())onError?.(error);throw error;}
    let failCleanup=()=>{renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();};
    try{
    renderer.setPixelRatio(Math.min(global.devicePixelRatio||1,1.75));
    renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.96;
    renderer.shadowMap.enabled=true;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;renderer.shadowMap.type=T.VSMShadowMap;
    const canvas=renderer.domElement;canvas.className='bike-three-canvas';canvas.setAttribute('role','img');canvas.setAttribute('aria-label','Your custom BMX. Drag to rotate. Pinch or use plus and minus to zoom. Arrow keys rotate; Home resets the view.');canvas.tabIndex=0;
    Object.assign(canvas.style,{width:'100%',height:'100%',display:'block',touchAction:'none',outlineOffset:'-3px'});element.appendChild(canvas);
    const scene=new T.Scene();scene.background=new T.Color('#e9edf2');scene.fog=new T.Fog('#e9edf2',5,13);
    const camera=new T.PerspectiveCamera(33,1,.01,30),target=new T.Vector3(-.015,.48,0);
    const controls=new OrbitControls(camera,canvas);controls.target.copy(target);controls.enableDamping=true;controls.dampingFactor=.12;controls.enablePan=false;controls.minDistance=1.13;controls.maxDistance=4.6;controls.minPolarAngle=Math.PI*.16;controls.maxPolarAngle=Math.PI*.495;controls.rotateSpeed=.72;controls.zoomSpeed=.85;
    controls.touches={ONE:T.TOUCH.ROTATE,TWO:T.TOUCH.DOLLY_PAN};
    const pmrem=new T.PMREMGenerator(renderer),room=new RoomEnvironment(),environment=pmrem.fromScene(room,.04);
    scene.environment=environment.texture;scene.environmentIntensity=1.05;room.dispose();pmrem.dispose();
    const hemi=new T.HemisphereLight('#eff5ff','#69717e',.48);scene.add(hemi);
    const key=new T.DirectionalLight('#fff7ee',2.7);key.position.set(1.1,3.2,2.3);key.castShadow=true;key.shadow.mapSize.set(2048,2048);key.shadow.camera.left=-1.5;key.shadow.camera.right=1.5;key.shadow.camera.top=1.5;key.shadow.camera.bottom=-1.5;key.shadow.camera.near=.1;key.shadow.camera.far=7;key.shadow.normalBias=.001;key.shadow.bias=-.0001;key.shadow.radius=4;key.shadow.blurSamples=8;scene.add(key);
    const fill=new T.DirectionalLight('#d5e7ff',1.2);fill.position.set(-1.8,1.8,-2.2);scene.add(fill);
    const groundMaterial=new T.MeshStandardMaterial({color:'#e3e8ee',roughness:.87});
    const groundGeometry=new T.PlaneGeometry(80,80),ground=new T.Mesh(groundGeometry,groundMaterial);ground.rotation.x=-Math.PI/2;ground.position.y=-.002;ground.receiveShadow=true;scene.add(ground);
    const contactCanvas=document.createElement('canvas');contactCanvas.width=contactCanvas.height=128;const contactContext=contactCanvas.getContext('2d'),gradient=contactContext.createRadialGradient(64,64,2,64,64,64);gradient.addColorStop(0,'rgba(20,24,30,.42)');gradient.addColorStop(.38,'rgba(20,24,30,.17)');gradient.addColorStop(1,'rgba(20,24,30,0)');contactContext.fillStyle=gradient;contactContext.fillRect(0,0,128,128);const contactTexture=new T.CanvasTexture(contactCanvas),contactMaterial=new T.MeshBasicMaterial({map:contactTexture,transparent:true,depthWrite:false}),contactGeometry=new T.PlaneGeometry(.22,.12);for(const x of [-.54,.505]){const contact=new T.Mesh(contactGeometry,contactMaterial);contact.rotation.x=-Math.PI/2;contact.position.set(x,.0002,0);scene.add(contact);}
    let model=null,disposed=false,frame=0,framesLeft=0,buildNumber=0,currentFingerprint='',selected='',ready=Promise.resolve(),hasFit=false,lastFitDistance=0,lastWidth=0,lastHeight=0;
    const temporaryMaterials=[],temporaryGeometries=[];
    const scenery=new T.Group();scene.add(scenery);
    function clearScenery(){for(const g of temporaryGeometries)g.dispose();for(const m of temporaryMaterials)m.dispose();temporaryGeometries.length=temporaryMaterials.length=0;scenery.clear();}
    function sceneryBox(position,size,color){const g=new T.BoxGeometry(...size),m=new T.MeshStandardMaterial({color,roughness:.9});temporaryGeometries.push(g);temporaryMaterials.push(m);const obj=new T.Mesh(g,m);obj.position.set(...position);obj.castShadow=obj.receiveShadow=true;scenery.add(obj);return obj;}
    // Orbit uses a coherent studio environment. Existing photo scenes remain export options.
    function background(){clearScenery();}
    function getView(){return {yaw:controls.getAzimuthalAngle(),polar:controls.getPolarAngle(),distance:camera.position.distanceTo(controls.target),target:[controls.target.x,controls.target.y,controls.target.z]};}
    function updateReadout(){const view=getView();canvas.dataset.yaw=String(view.yaw);canvas.dataset.polar=String(view.polar);canvas.dataset.distance=String(view.distance);canvas.dataset.ready=model?'true':'false';canvas.dataset.drawCalls=String(renderer.info.render.calls);canvas.dataset.triangles=String(renderer.info.render.triangles);}
    function draw(){if(disposed||!isCurrent())return;renderer.render(scene,camera);updateReadout();}
    function tick(){frame=0;if(disposed||!isCurrent()||document.hidden)return;controls.update();draw();if(--framesLeft>0)frame=requestAnimationFrame(tick);}
    function requestDraw(count=2){if(disposed)return;framesLeft=Math.max(framesLeft,count);if(!frame&&!document.hidden)frame=requestAnimationFrame(tick);}
    function setView(value={}){if(disposed)return;const old=getView();const yaw=Number.isFinite(value.yaw)?value.yaw:old.yaw,polar=T.MathUtils.clamp(Number.isFinite(value.polar)?value.polar:old.polar,controls.minPolarAngle,controls.maxPolarAngle),distance=T.MathUtils.clamp(Number.isFinite(value.distance)?value.distance:old.distance,controls.minDistance,controls.maxDistance);if(Array.isArray(value.target)&&value.target.length===3&&value.target.every(Number.isFinite))controls.target.set(...value.target);const sphere=new T.Spherical(distance,polar,yaw);camera.position.copy(controls.target).add(new T.Vector3().setFromSpherical(sphere));camera.lookAt(controls.target);controls.update();requestDraw(16);}
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
    function resetView(){controls.target.copy(target);const yaw=camera.aspect<.85?.32:.48,polar=1.31;lastFitDistance=fitDistance(yaw,polar);setView({yaw,polar,distance:lastFitDistance});}
    function resize(){if(disposed)return;const w=Math.max(1,Math.round(element.clientWidth)),h=Math.max(1,Math.round(element.clientHeight));if(w===lastWidth&&h===lastHeight)return;lastWidth=w;lastHeight=h;const previous=getView(),zoomRatio=lastFitDistance?previous.distance/lastFitDistance:1;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();if(w>1&&h>1){if(!hasFit){hasFit=true;resetView();}else{lastFitDistance=fitDistance(previous.yaw,previous.polar);setView({...previous,distance:lastFitDistance*zoomRatio});}}requestDraw(2);}
    const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(element);
    function selectedPart(part){selected=typeof part==='string'?part:'';canvas.dataset.selectedPart=selected;requestDraw();}
    function update(config){if(disposed||!isCurrent())return Promise.resolve();const normalized=global.JKCrewBikeConfig.normalize(config),fingerprint=JSON.stringify(normalized);if(fingerprint===currentFingerprint)return ready;currentFingerprint=fingerprint;if(model?.updateColours(normalized)){requestDraw();return ready;}const build=++buildNumber;
      let next;try{next=createBike(normalized);}catch(error){currentFingerprint='';if(!model)throw error;if(isCurrent())onError?.(error);return Promise.resolve();}const old=model;model=next;scene.add(model.group);if(old){scene.remove(old.group);old.dispose();}background(normalized.background);renderer.shadowMap.needsUpdate=true;requestDraw();ready=model.ready.then(()=>{if(!disposed&&build===buildNumber){selectedPart(selected);draw();}},error=>{if(!disposed&&isCurrent())onError?.(error);});return ready;
    }
    const raycaster=new T.Raycaster(),pointer=new T.Vector2(),pointers=new Map();let tap=null,multitouch=false;
    function pointerDown(event){pointers.set(event.pointerId,[event.clientX,event.clientY]);if(pointers.size>1)multitouch=true;else{multitouch=false;tap={id:event.pointerId,x:event.clientX,y:event.clientY,moved:false,time:performance.now()};}}
    function pointerMove(event){if(tap&&tap.id===event.pointerId&&Math.hypot(event.clientX-tap.x,event.clientY-tap.y)>6)tap.moved=true;}
    function pointerUp(event){if(disposed||!isCurrent()||(event.pointerType==='mouse'&&event.button!==0))return;pointers.delete(event.pointerId);if(!tap||tap.moved||multitouch||tap.id!==event.pointerId||Math.hypot(event.clientX-tap.x,event.clientY-tap.y)>6||performance.now()-tap.time>650){if(!pointers.size)tap=null;return;}tap=null;const rect=canvas.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObject(model.group,true).find(hit=>hit.object.userData.part);if(hit){selectedPart(hit.object.userData.part);onSelect?.(hit.object.userData.part);}}
    function pointerCancel(event){pointers.delete(event.pointerId);tap=null;multitouch=true;}
    function keyDown(event){if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','_','Home'].includes(event.key))return;event.preventDefault();const view=getView();if(event.key==='Home')return resetView();if(event.key==='ArrowLeft')view.yaw-=.13;if(event.key==='ArrowRight')view.yaw+=.13;if(event.key==='ArrowUp')view.polar-=.08;if(event.key==='ArrowDown')view.polar+=.08;if(event.key==='+'||event.key==='=')view.distance*=.9;if(event.key==='-'||event.key==='_')view.distance*=1.1;setView(view);}
    function visibility(){if(document.hidden){if(frame)cancelAnimationFrame(frame);frame=0;}else requestDraw(2);}
    function lost(event){event.preventDefault();onError?.(new Error('The 3D preview was interrupted. Reopen the preview to continue.'));}
    canvas.addEventListener('pointerdown',pointerDown);canvas.addEventListener('pointermove',pointerMove);canvas.addEventListener('pointerup',pointerUp);canvas.addEventListener('pointercancel',pointerCancel);canvas.addEventListener('keydown',keyDown);canvas.addEventListener('webglcontextlost',lost);document.addEventListener('visibilitychange',visibility);
    controls.addEventListener('change',()=>requestDraw(12));controls.addEventListener('start',()=>requestDraw(24));controls.addEventListener('end',()=>requestDraw(24));
    const handle={canvas,ready,update,selectPart:selectedPart,getView,setView,resetView,getStats:()=>({calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures}),
      async exportBlob({type='image/png',quality=.94}={}){await ready;if(disposed||!isCurrent())throw new Error('The bike preview has closed.');draw();return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('The image could not be created.')),type,quality));},
      dispose(){if(disposed)return;disposed=true;buildNumber++;if(frame)cancelAnimationFrame(frame);resizeObserver.disconnect();controls.dispose();canvas.removeEventListener('pointerdown',pointerDown);canvas.removeEventListener('pointermove',pointerMove);canvas.removeEventListener('pointerup',pointerUp);canvas.removeEventListener('pointercancel',pointerCancel);canvas.removeEventListener('keydown',keyDown);canvas.removeEventListener('webglcontextlost',lost);document.removeEventListener('visibilitychange',visibility);model?.dispose();clearScenery();groundGeometry.dispose();groundMaterial.dispose();contactTexture.dispose();contactMaterial.dispose();contactGeometry.dispose();key.shadow.dispose();environment.dispose();renderer.renderLists.dispose();renderer.dispose();renderer.forceContextLoss();canvas.remove();scene.clear();}
    };
    failCleanup=()=>handle.dispose();
    try{await update(configuration);if(!isCurrent())throw new DOMException('The bike view has changed.','AbortError');resize();draw();handle.ready=ready;return handle;}catch(error){handle.dispose();if(error.name!=='AbortError')onError?.(error);throw error;}
    }catch(error){failCleanup();throw error;}
  }
  global.JKCrewBike3D=Object.freeze({mount});
})(globalThis);
