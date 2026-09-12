import * as T from './vendor/three.module.min.js';

const V=(x,y,z=0)=>new T.Vector3(x,y,z);
const Y=V(0,1,0);
const TAU=Math.PI*2;
const metalParts=new Set(['frame','fork','bars','rims','hubs','cranks','sprocket','seatpost','stem','headset','pegs']);
const PARTS=()=>globalThis.JKCrewBikeParts;

/** Dimensioned 20-inch BMX mesh, built from a named component catalogue so
 * every part choice reads as a distinct, physically plausible real BMX
 * shape rather than a re-skin. Geometry, materials and view are separate
 * from saved config. */
export function createBike(configuration) {
  let c=globalThis.JKCrewBikeConfig.normalize(configuration);
  const parts=PARTS();
  const frameModel=parts?.frameById?.[c.frameModel]||{rear:[-.54,.266],front:[.505,.266],bb:[-.16,.295],seat:[-.255,.61],headLow:[.355,.58],headTop:[.324,.703]};
  const forkModel=parts?.forkById?.[c.forkModel]||{legRadius:.016,taper:.27,crownRadius:.025};
  const barModel=parts?.barById?.[c.barModel]||{riseY:.210,widthZ:.335};
  const tread=parts?.tireTreadById?.[c.tireTread]||{rows:3,blockScale:1,spacingJitter:.013};
  const group=new T.Group(); group.name='BMX';
  const groups={}, materials=new Set(), geometries=new Set(), textures=new Set();
  let disposed=false;
  const ready=[],imageCancels=new Set();
  const right=c.driveSide==='lhd'?-1:1;

  function part(name){if(!groups[name]){groups[name]=new T.Group();groups[name].name=name;groups[name].userData.part=name;group.add(groups[name]);}return groups[name];}
  function mat(settings){const m=new T.MeshPhysicalMaterial(settings);materials.add(m);return m;}
  const plain=(color,roughness=.45,metalness=0)=>mat({color,roughness,metalness});
  const steel=mat({color:'#afb5bb',metalness:1,roughness:.19});
  const darkSteel=mat({color:'#30363b',metalness:.85,roughness:.28});
  const rubberBase=plain('#1d2021',.88);
  const bead=plain('#141617',.65);
  const whiteRubber=plain('#e9ecea',.87);
  const blackTyreRubber=plain('#1d2021',.88);
  const blackPlastic=plain('#171b20',.55);

  // A small tileable procedural noise, reused as a normal-ish micro-bump on
  // paint (fine orange-peel) and as extra grain on rubber. Generated once,
  // locally — no image fetches, same approach as the existing seat bump.
  const noiseCanvas=document.createElement('canvas');noiseCanvas.width=noiseCanvas.height=64;
  {const nx=noiseCanvas.getContext('2d');const img=nx.createImageData(64,64);
    for(let i=0;i<64*64;i++){const n=128+(Math.random()-.5)*46;img.data[i*4]=img.data[i*4+1]=n;img.data[i*4+2]=255;img.data[i*4+3]=255;}
    nx.putImageData(img,0,0);}
  const microNoise=new T.CanvasTexture(noiseCanvas);microNoise.wrapS=microNoise.wrapT=T.RepeatWrapping;microNoise.repeat.set(26,26);textures.add(microNoise);

  const paints={},paintedPedalMaterials=[],seatSeamMaterials=[];
  for(const [key,color] of Object.entries(c.colors)){
    const finish=c.finishes[key]||'gloss';
    const brushed=finish==='raw'&&metalParts.has(key);
    paints[key]=finish==='chrome'?mat({color:'#e6ebf0',metalness:1,roughness:.095,envMapIntensity:1.12,clearcoat:.25,clearcoatRoughness:.06}):
      finish==='raw'?mat({color:'#969da1',metalness:1,roughness:.38,envMapIntensity:.9,anisotropy:brushed?1:0,anisotropyRotation:Math.PI/2}):
      finish==='jetfuel'?mat({color:'#bab4c4',metalness:1,roughness:.16,iridescence:1,iridescenceIOR:1.6,iridescenceThicknessRange:[180,580],clearcoat:.5,clearcoatRoughness:.12}):
      mat({color,metalness:metalParts.has(key)?.42:.025,roughness:finish==='matte'?.64:(key==='seat'?.66:.29),clearcoat:finish==='matte'?0:metalParts.has(key)?.8:.86,clearcoatRoughness:finish==='matte'?.18:.15,
        normalMap:['gloss','matte'].includes(finish)&&key!=='seat'?microNoise:null,normalScale:new T.Vector2(.045,.045)});
  }
  const tyres=c.tyreStyle==='white'?whiteRubber:blackTyreRubber;
  tyres.normalMap=microNoise;tyres.normalScale=new T.Vector2(.12,.12);
  const rimMat=paints.rims;
  function add(name,g,m,pos,rotation){geometries.add(g);const mesh=new T.Mesh(g,m);mesh.userData.part=name;mesh.castShadow=true;mesh.receiveShadow=true;if(pos)mesh.position.copy(pos);if(rotation)mesh.rotation.set(...rotation);part(name).add(mesh);return mesh;}
  function cylinder(name,a,b,r,m,r2=r,segments=20){const d=b.clone().sub(a),g=new T.CylinderGeometry(r2,r,d.length(),segments);const mesh=add(name,g,m,a.clone().add(b).multiplyScalar(.5));mesh.quaternion.setFromUnitVectors(Y,d.normalize());return mesh;}
  function tube(name,points,r,m,segments=48){const curve=new T.CatmullRomCurve3(points.map(p=>Array.isArray(p)?V(...p):p));return add(name,new T.TubeGeometry(curve,segments,r,10,false),m);}
  function sphere(name,p,r,m){return add(name,new T.SphereGeometry(r,12,8),m,p);}
  function box(name,p,w,h,d,m,rotation){
    const r=Math.min(.003,w*.18,h*.22,d*.22),shape=new T.Shape(),x=-w/2,y=-h/2;
    shape.moveTo(x+r,y);shape.lineTo(x+w-r,y);shape.quadraticCurveTo(x+w,y,x+w,y+r);shape.lineTo(x+w,y+h-r);shape.quadraticCurveTo(x+w,y+h,x+w-r,y+h);shape.lineTo(x+r,y+h);shape.quadraticCurveTo(x,y+h,x,y+h-r);shape.lineTo(x,y+r);shape.quadraticCurveTo(x,y,x+r,y);
    const bevel=Math.min(.0012,d*.16),g=new T.ExtrudeGeometry(shape,{depth:d-bevel*2,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:bevel,bevelThickness:bevel,curveSegments:3});g.translate(0,0,-d/2+bevel);return add(name,g,m,p,rotation);
  }
  function ring(name,p,r,t,m,rotation){return add(name,new T.TorusGeometry(r,t,10,64),m,p,rotation);}
  function bolt(name,p,axis=V(0,0,1),r=.0045){cylinder(name,p.clone().addScaledVector(axis,-.002),p.clone().addScaledVector(axis,.002),r,steel,r,6);cylinder(name,p.clone().addScaledVector(axis,.0021),p.clone().addScaledVector(axis,.0024),r*.4,darkSteel,r*.4,6);}
  function batch(name,g,m,transforms){geometries.add(g);const mesh=new T.InstancedMesh(g,m,transforms.length);mesh.userData.part=name;mesh.castShadow=!['spokes','nipples'].includes(name);mesh.receiveShadow=true;transforms.forEach((x,i)=>mesh.setMatrixAt(i,x));mesh.instanceMatrix.needsUpdate=true;part(name).add(mesh);return mesh;}
  function rodMatrix(a,b,r=1){const o=new T.Object3D();o.position.copy(a).add(b).multiplyScalar(.5);o.quaternion.setFromUnitVectors(Y,b.clone().sub(a).normalize());o.scale.set(r,a.distanceTo(b),r);return o.updateMatrix(),o.matrix.clone();}
  function weld(a,b,r,name='frame'){const d=b.clone().sub(a).normalize(),p=a.clone().addScaledVector(d,r*.62);const mesh=ring(name,p,r*.97,.00075,paints[name]||paints.frame);mesh.quaternion.setFromUnitVectors(V(0,0,1),d);}

  // Frame hardpoints come from the chosen frame model. Chainstay, wheelbase,
  // reach and stack all fall out of these six points and stay in realistic
  // BMX ranges across every preset (see bike-parts-catalog.js).
  const rear=V(...frameModel.rear),front=V(...frameModel.front),bb=V(...frameModel.bb),seat=V(...frameModel.seat),headLow=V(...frameModel.headLow),headTop=V(...frameModel.headTop);

  // Closed, double-wall rims, full-volume tyres, individual three-cross spokes,
  // spoke nipples and a hub shell shaped for the chosen hub style.
  for(const [wheel,p] of [['rear',rear],['front',front]]){
    const tyreMesh=ring('tyres',p,.235,.031,tyres);tyreMesh.geometry.dispose();geometries.delete(tyreMesh.geometry);tyreMesh.geometry=new T.TorusGeometry(.235,.031,16,96);geometries.add(tyreMesh.geometry);
    // Subtle sidewall mould lines and contrasting wall options do not tint the tread.
    for(const side of [-1,1]){
      const wall=c.tyreStyle==='tan-wall'?plain('#b89360',.83):c.tyreStyle==='white-wall'?plain('#e5e5dc',.8):tyres;
      const wallGeo=new T.RingGeometry(.218,.251,96);const wm=add('tyres',wallGeo,wall,p.clone().add(V(0,0,side*.026)));if(side<0)wm.rotation.y=Math.PI;
      ring('tyres',p.clone().add(V(0,0,side*.029)),.228,.0009,c.tyreStyle==='white'?plain('#cdd1ce',.86):bead);
      ring('rims',p.clone().add(V(0,0,side*.018)),.2085,.0051,rimMat);
    }
    const profile=[V(.199,-.017),V(.204,-.020),V(.211,-.019),V(.214,-.014),V(.214,.014),V(.211,.019),V(.204,.020),V(.199,.017),V(.199,-.017)].map(p=>new T.Vector2(p.x,p.y));
    const rim=add('rims',new T.LatheGeometry(profile,96),rimMat,p,[Math.PI/2,0,0]);
    const isDrive=wheel==='rear';
    const cassette=isDrive&&c.hubStyle==='cassette';
    cylinder('hubs',p.clone().add(V(0,0,-.046)),p.clone().add(V(0,0,.046)),wheel==='rear'?.020:.016,paints.hubs);
    for(const s of [-1,1]){
      const driveSideFlange=isDrive&&s===right;
      // Cassette hubs carry a larger driver body and a thin ratchet-ring
      // lip on the drive side; freecoaster shells stay symmetric and full.
      const flangeR=cassette&&driveSideFlange?.032:c.hubStyle==='freecoaster'?.030:.027;
      cylinder('hubs',p.clone().add(V(0,0,s*.032)),p.clone().add(V(0,0,s*.036)),flangeR,paints.hubs);
      if(cassette&&driveSideFlange){
        cylinder('hubs',p.clone().add(V(0,0,s*.036)),p.clone().add(V(0,0,s*.058)),.024,darkSteel);
        ring('hubs',p.clone().add(V(0,0,s*.058)),.024,.0016,steel);
      }
      cylinder('hubs',p.clone().add(V(0,0,s*.047)),p.clone().add(V(0,0,s*.069)),.005,steel);
      bolt('hubs',p.clone().add(V(0,0,s*.064)),V(0,0,s),.010);
    }
    const spokeMatrices=[],nippleMatrices=[];
    for(let i=0;i<36;i++){
      const theta=i/36*TAU,side=i%2?1:-1,hubTheta=theta+(i%4<2?.49:-.49);
      const a=p.clone().add(V(Math.cos(hubTheta)*.024,Math.sin(hubTheta)*.024,side*.035));
      const b=p.clone().add(V(Math.cos(theta)*.202,Math.sin(theta)*.202,side*.006));
      spokeMatrices.push(rodMatrix(a,b,.00085));
      nippleMatrices.push(rodMatrix(b.clone().lerp(a,.025),b,.0019));
    }
    if(c.spokeStyle==='rainbow')paints.spokes.color.set('#ffffff');
    const spokes=batch('spokes',new T.CylinderGeometry(1,1,1,6),paints.spokes,spokeMatrices);
    if(c.spokeStyle==='rainbow')for(let i=0;i<36;i++)spokes.setColorAt(i,new T.Color().setHSL(i/36,.8,.57));
    batch('nipples',new T.CylinderGeometry(1,1,1,6),paints.nipples,nippleMatrices);
    // Tread block instancing follows the chosen tyre-tread preset: a slick
    // centre strip, an all-round directional pattern, or tall knobby blocks.
    const treadRows=Math.max(1,tread.rows),trStripes=treadRows===1?[0]:treadRows===3?[-1,0,1]:[-1.5,-.5,.5,1.5];
    const treadObj=[];const tmp=new T.Object3D();
    for(let i=0;i<100;i++)for(const stripe of trStripes){
      const a=i/100*TAU+(stripe%2?1:0)*tread.spacingJitter;
      tmp.position.copy(p).add(V(Math.cos(a)*(.264-Math.abs(stripe)*.004*tread.blockScale),Math.sin(a)*(.264-Math.abs(stripe)*.004*tread.blockScale),stripe*.017));
      tmp.rotation.set(0,0,a-Math.PI/2);tmp.rotateY(stripe*.23);tmp.scale.set(.010*tread.blockScale,.0019*(.6+tread.blockScale*.4),.009);tmp.updateMatrix();treadObj.push(tmp.matrix.clone());
    }
    batch('tyres',new T.BoxGeometry(1,1,1),tyres,treadObj);
  }
  // Rear dropouts, twin stays and front triangle; no floating tube connections.
  for(const s of [-1,1]){
    const dropout=rear.clone().add(V(.005,.002,s*.048));
    cylinder('frame',dropout,bb.clone().add(V(0,0,s*.038)),.0105,paints.frame,.014);
    cylinder('frame',dropout,seat.clone().add(V(0,0,s*.015)),.010,paints.frame,.012);
    cylinder('frame',dropout.clone().add(V(0,0,-.003)),dropout.clone().add(V(0,0,.003)),.020,paints.frame);
  }
  // Chainstay bridge and seatstay bridge — real welded cross-tubes, not just
  // two independent stays floating in space.
  {const bridgeA=rear.clone().lerp(bb,.42).add(V(0,-.006,0)),bridgeB=rear.clone().lerp(seat,.4).add(V(0,.004,0));
    cylinder('frame',bridgeA.clone().add(V(0,0,-.036)),bridgeA.clone().add(V(0,0,.036)),.0062,paints.frame);
    cylinder('frame',bridgeB.clone().add(V(0,0,-.013)),bridgeB.clone().add(V(0,0,.013)),.0055,paints.frame);}
  const tubes=[[bb,seat,.0165],[seat,headTop.clone().add(V(.005,-.025,0)),.017],[bb,headLow,.0215],[headLow,headTop,.024]];
  for(const [a,b,r] of tubes){cylinder('frame',a,b,r,paints.frame);weld(a,b,r);weld(b,a,r);}
  cylinder('frame',bb.clone().add(V(0,0,-.038)),bb.clone().add(V(0,0,.038)),.026,paints.frame);
  // A small gusset under the top-tube/head-tube junction, as most street
  // frames carry, for a load path that reads as real rather than three
  // tubes floating into one point.
  {const gussetA=bb.clone().lerp(headLow,.86),gussetB=headLow.clone().addScaledVector(headTop.clone().sub(headLow).normalize(),.03);
    cylinder('frame',gussetA,gussetB,.0092,paints.frame,.0092,12);}
  // Fork steerer and gently curved tapered fork legs, sized by the chosen fork model.
  const steer=headTop.clone().sub(headLow).normalize();
  cylinder('fork',headLow.clone().addScaledVector(steer,-.016),headTop.clone().addScaledVector(steer,.049),.016,paints.fork);
  const crown=headLow.clone().addScaledVector(steer,-.026);
  const legR=forkModel.legRadius,legTaper=forkModel.taper;
  for(const s of [-1,1]){
    const start=crown.clone().add(V(0,0,s*.030)),end=front.clone().add(V(0,0,s*.052));
    const curve=new T.CatmullRomCurve3([start,start.clone().lerp(end,.58).add(V(-.005,0,0)),end]);
    const g=new T.TubeGeometry(curve,32,legR,14,false),positions=g.attributes.position;
    for(let j=0;j<=32;j++){const centre=curve.getPointAt(j/32),scale=1-j/32*legTaper;for(let k=0;k<=14;k++){const i=j*15+k,p=V().fromBufferAttribute(positions,i).sub(centre).multiplyScalar(scale).add(centre);positions.setXYZ(i,p.x,p.y,p.z);}}g.computeVertexNormals();add('fork',g,paints.fork);
    cylinder('fork',end.clone().add(V(0,0,-.004)),end.clone().add(V(0,0,.004)),legR,paints.fork);
  }
  cylinder('fork',crown.clone().add(V(0,0,-.035)),crown.clone().add(V(0,0,.035)),forkModel.crownRadius,paints.fork);
  for(const t of [-.009,.008,.129,.142]){
    const p=headLow.clone().addScaledVector(steer,t);cylinder('headset',p,p.clone().addScaledVector(steer,.005),t<.1?.028:.026,paints.headset);
  }
  // Seat tube follows the actual seat-tube axis, with clamp, rails and sewn
  // edge. The saddle sits a fixed distance up the same seatpost axis beyond
  // the seat-tube top, so it stays correctly placed across every frame model.
  const seatAxis=seat.clone().sub(bb).normalize();
  const saddle=seat.clone().addScaledVector(seatAxis,.127).add(V(.008,-.006,0));
  cylinder('seatpost',seat.clone().addScaledVector(seatAxis,-.015),saddle.clone().add(V(.006,-.015,0)),.0127,paints.seatpost);
  cylinder('seatpost',seat.clone().addScaledVector(seatAxis,-.005),seat.clone().addScaledVector(seatAxis,.009),.019,paints.seatpost);
  bolt('seatpost',seat.clone().add(V(-.014,.005,.020)),V(0,0,1),.004);
  for(const s of [-1,1])tube('seat',[saddle.clone().add(V(-.080,-.002,s*.020)),saddle.clone().add(V(-.021,-.016,s*.025)),saddle.clone().add(V(.046,-.014,s*.020)),saddle.clone().add(V(.092,.009,s*.01))],.0029,steel,20);
  const seatHeight=c.seatStyle==='padded'?.048:.035;
  const slices=[[-.414,.002],[-.405,.031],[-.391,.057],[-.365,.071],[-.334,.069],[-.302,.059],[-.270,.045],[-.237,.029],[-.204,.024],[-.176,.022],[-.163,.012],[-.159,.002]].map(([x,w])=>[x+(saddle.x-(-.285)),w]);
  const seatLift=saddle.y-.728;
  const pos=[],uv=[],indices=[],steps=16;
  for(let j=0;j<slices.length;j++)for(let i=0;i<=steps;i++){
    const angle=i/steps*TAU, [x,w]=slices[j],lift=(x+.3)*.025;
    const dome=Math.max(0,Math.sin(angle))*Math.sin(j/(slices.length-1)*Math.PI)*.009;pos.push(x,.749+seatLift+lift+Math.sin(angle)*seatHeight*.5+dome,Math.cos(angle)*w);
    uv.push(j/(slices.length-1),i/steps);
  }
  for(let j=0;j<slices.length-1;j++)for(let i=0;i<steps;i++){const a=j*(steps+1)+i,b=a+steps+1;indices.push(a,a+1,b,a+1,b+1,b);}
  for(const j of [0,slices.length-1]){const centre=pos.length/3,[x]=slices[j];pos.push(x,.749+seatLift+(x+.3)*.025,0);uv.push(j/(slices.length-1),.5);for(let i=0;i<steps;i++){const a=j*(steps+1)+i;indices.push(centre,...(j===0?[a+1,a]:[a,a+1]));}}
  const sg=new T.BufferGeometry();sg.setAttribute('position',new T.Float32BufferAttribute(pos,3));sg.setAttribute('uv',new T.Float32BufferAttribute(uv,2));sg.setIndex(indices);sg.computeVertexNormals();
  const seatMesh=add('seat',sg,paints.seat);paints.seat.side=T.DoubleSide;
  // Physical subtle upholstery grain, generated locally; no image fetches.
  const cloth=document.createElement('canvas');cloth.width=cloth.height=128;const cx=cloth.getContext('2d');cx.fillStyle='#999';cx.fillRect(0,0,128,128);for(let i=0;i<128;i+=3){cx.fillStyle=i%2?'#bbb':'#888';cx.fillRect(i,0,1,128);cx.fillRect(0,i,128,1);}const bump=new T.CanvasTexture(cloth);bump.wrapS=bump.wrapT=T.RepeatWrapping;bump.repeat.set(4,3);textures.add(bump);paints.seat.bumpMap=bump;paints.seat.bumpScale=.0007;
  for(const s of [-1,1]){const seam=plain(c.colors.seat,.8);seatSeamMaterials.push(seam);tube('seat',slices.map(([x,w])=>V(x,.749+seatLift+(x+.3)*.025-.007,s*w*.99)),.0011,seam,36);}
  if(c.seatDesign!=='solid'&&globalThis.JKCrewBikeSeats){
    const svg=globalThis.JKCrewBikeSeats.thumbnail(c.seatDesign);
    if(svg)ready.push(new Promise(resolve=>{const img=new Image();let finished=false,timer;
      const finish=()=>{if(finished)return;finished=true;clearTimeout(timer);img.onload=img.onerror=null;imageCancels.delete(finish);resolve();};
      imageCancels.add(finish);timer=setTimeout(finish,2500);
      img.onload=()=>{if(!disposed){const texture=new T.Texture(img);texture.colorSpace=T.SRGBColorSpace;texture.needsUpdate=true;textures.add(texture);paints.seat.map=texture;paints.seat.color.set('#fff');paints.seat.needsUpdate=true;}finish();};img.onerror=finish;img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
    }));
  }
  // Genuine top-load vs front-load clamp bodies and four separately visible fasteners.
  const stemCentre=headTop.clone().addScaledVector(steer,.036),barCentre=stemCentre.clone().add(V(.041,.014,0));
  cylinder('stem',stemCentre.clone().add(V(0,-.022,0)),stemCentre.clone().add(V(0,.006,0)),.022,paints.stem);
  box('stem',stemCentre.clone().lerp(barCentre,.48),.077,.035,.049,paints.stem);
  for(const z of [-.018,.018])bolt('stem',stemCentre.clone().add(V(-.021,-.002,z)),V(-1,0,0),.0038);
  if(c.stemStyle==='top-load'){
    box('stem',barCentre.clone().add(V(0,.019,0)),.041,.010,.048,paints.stem);
    for(const x of [-.013,.013])for(const z of [-.016,.016])bolt('stem',barCentre.clone().add(V(x,.026,z)),V(0,1,0),.004);
  }else{
    box('stem',barCentre.clone().add(V(.022,0,0)),.010,.040,.046,paints.stem);
    for(const y of [-.013,.013])for(const z of [-.015,.015])bolt('stem',barCentre.clone().add(V(.029,y,z)),V(1,0,0),.004);
  }
  bolt('stem',stemCentre.clone().add(V(0,.026,0)),V(0,1,0),.006);
  // Tall BMX bars: actual swept tubing, crossbar and grip ends, sized by the
  // chosen bar model (rise and width both scale proportionally from the
  // original hand-tuned tube shape, so every height reads as one coherent
  // bend rather than a stretched caricature).
  const barX=barCentre.x,barY=barCentre.y,gripY=barY+barModel.riseY;
  const wScale=barModel.widthZ/.335,rScale=barModel.riseY/.210;
  if(c.barStyle==='two-piece'){
    tube('bars',[V(barX-.067*rScale,gripY,-.335*wScale),V(barX-.055*rScale,gripY-.003,-.175*wScale),V(barX-.030*rScale,gripY-.022,-.113*wScale),V(barX,barY+.054*rScale,-.076*wScale),V(barX,barY,-.04*wScale),V(barX,barY,.04*wScale),V(barX,barY+.054*rScale,.076*wScale),V(barX-.030*rScale,gripY-.022,.113*wScale),V(barX-.055*rScale,gripY-.003,.175*wScale),V(barX-.067*rScale,gripY,.335*wScale)],.0111,paints.bars,100);
    tube('bars',[V(barX-.013*rScale,barY+.138*rScale,-.100*wScale),V(barX-.017*rScale,barY+.142*rScale,0),V(barX-.013*rScale,barY+.138*rScale,.100*wScale)],.008,paints.bars,20);
  }else{
    cylinder('bars',V(barX,barY,-.065*wScale),V(barX,barY,.065*wScale),.0111,paints.bars);
    for(const s of [-1,1]){
      tube('bars',[V(barX,barY,s*.06*wScale),V(barX-.012*rScale,barY+.108*rScale,s*.085*wScale),V(barX-.034*rScale,gripY-.018,s*.105*wScale),V(barX-.055*rScale,gripY,s*.158*wScale),V(barX-.067*rScale,gripY,s*.335*wScale)],.0111,paints.bars,48);
    }
    cylinder('bars',V(barX-.020*rScale,barY+.155*rScale,-.096*wScale),V(barX-.020*rScale,barY+.155*rScale,.096*wScale),.008,paints.bars);
  }
  // Grips follow the chosen flange style: a flanged inner lip, or a uniform
  // flangeless barrel that reads as an ODI Longneck-style grip.
  const gripRings=[],flanged=c.gripStyle!=='flangeless';
  for(const s of [-1,1]){
    const a=V(barX-.065*rScale,gripY,s*.204*wScale),b=V(barX-.068*rScale,gripY,s*.347*wScale);
    cylinder('grips',a,b,.016,paints.grips);
    if(flanged)cylinder('grips',a.clone().add(V(0,0,-s*.004)),a,.020,paints.grips);
    else cylinder('grips',a.clone().add(V(0,0,-s*.0015)),a,.0165,blackPlastic);
    for(let i=0;i<30;i++){const o=new T.Object3D();o.position.copy(a).lerp(b,i/30);o.updateMatrix();gripRings.push(o.matrix.clone());}
    cylinder('grips',b,b.clone().add(V(0,0,s*.005)),.015,blackPlastic);
  }
  batch('grips',new T.TorusGeometry(.0159,.00055,5,24),paints.grips,gripRings);
  // Drive side is physical geometry, not a mirrored right-drive photograph.
  const chainZ=right*.074,chainCentre=bb.clone().add(V(0,0,chainZ));
  function sprocket(name,p,r,teeth,m,thick,guard){const shape=new T.Shape();for(let i=0;i<teeth*4;i++){const a=i/(teeth*4)*TAU,rr=r*(i%4===1||i%4===2?1:.936);const x=Math.cos(a)*rr,y=Math.sin(a)*rr;i?shape.lineTo(x,y):shape.moveTo(x,y);}shape.closePath();const centreHole=new T.Path();centreHole.absarc(0,0,.009,0,TAU,true);shape.holes.push(centreHole);if(r>.025&&!guard)for(let i=0;i<5;i++){const a=i/5*TAU;const hole=new T.Path();hole.absellipse(Math.cos(a)*r*.54,Math.sin(a)*r*.54,r*.13,r*.18,0,TAU,true,a);shape.holes.push(hole);}const g=new T.ExtrudeGeometry(shape,{depth:thick,bevelEnabled:true,bevelSegments:1,steps:1,bevelSize:.0005,bevelThickness:.0005,curveSegments:8});return add(name,g,m,p.clone().add(V(0,0,-thick/2)));}
  sprocket('sprocket',chainCentre,.052,25,paints.sprocket,c.sprocketStyle==='guard'?.006:.004,c.sprocketStyle==='guard');
  sprocket('hubs',rear.clone().add(V(0,0,chainZ)),.020,9,darkSteel,.012);
  // Small alternating link loops and pins follow the chain's two tangents and sprockets.
  const chainPoints=[],x1=rear.x,y1=rear.y,r1=.021,x2=bb.x,y2=bb.y,r2=.052,dx=x2-x1,dy=y2-y1;
  const theta=Math.atan2(dy,dx),offset=Math.acos((r1-r2)/Math.hypot(dx,dy));
  const top=theta+offset,bottom=theta-offset;
  for(let i=0;i<=32;i++){const a=top+(bottom+TAU-top)*(i/32);chainPoints.push(V(x1+Math.cos(a)*r1,y1+Math.sin(a)*r1,chainZ));}
  for(let i=0;i<=48;i++){const a=bottom+(top-bottom)*(i/48);chainPoints.push(V(x2+Math.cos(a)*r2,y2+Math.sin(a)*r2,chainZ));}
  const curve=new T.CatmullRomCurve3(chainPoints,true,'catmullrom',.02),len=curve.getLength(),links=Math.floor(len/.007),matrices=[];
  const linkGeo=new T.TorusGeometry(.0028,.0007,5,8),obj=new T.Object3D();
  for(let i=0;i<links;i++){const p=curve.getPointAt(i/links),tan=curve.getTangentAt(i/links);obj.position.copy(p);obj.rotation.set(i%2?Math.PI/2:0,0,Math.atan2(tan.y,tan.x));obj.scale.set(1.7,1,.9);obj.updateMatrix();matrices.push(obj.matrix.clone());}
  batch('sprocket',linkGeo,darkSteel,matrices);
  // Cranks: a tubular 3-piece arm on a splined spindle, or a thicker
  // 2-piece wedge-cluster arm with no separate visible pinch bolt.
  const twoPiece=c.crankModel==='two-piece',crankR=twoPiece?.0185:.014;
  for(const s of [-1,1]){
    const p=bb.clone().add(V(0,0,s*.099)),angle=s===right?-.22:Math.PI-.22;
    const end=p.clone().add(V(Math.cos(angle)*.165,Math.sin(angle)*.165,0));
    cylinder('cranks',p,end,crankR,paints.cranks,.011);sphere('cranks',p,twoPiece?.0125:.016,paints.cranks);sphere('cranks',end,.012,paints.cranks);
    if(!twoPiece)bolt('cranks',p.clone().add(V(0,0,s*.015)),V(0,0,s),.008);
    const pedalCentre=end.clone().add(V(0,0,s*.062));
    cylinder('pedals',end,end.clone().add(V(0,0,s*.102)),.006,steel);
    const pm=c.pedalMaterial==='metal'?mat({color:c.colors.pedals,roughness:.22,metalness:.85,clearcoat:.5}):paints.pedals;
    paintedPedalMaterials.push(pm);
    const rail=c.pedalMaterial==='metal'?.010:.015;
    for(const z of [-.039,.039])box('pedals',pedalCentre.clone().add(V(0,0,z)),.106,rail,.010,pm);
    for(const x of [-.049,0,.049])box('pedals',pedalCentre.clone().add(V(x,0,0)),x===0?.017:.010,rail,.087,pm);
    const pins=[];for(const x of [-.042,-.021,.021,.042])for(const z of [-.035,.035])for(const sy of [-1,1])pins.push(rodMatrix(pedalCentre.clone().add(V(x,sy*rail*.5,z)),pedalCentre.clone().add(V(x,sy*(rail*.5+.0035),z)),.0015));batch('pedals',new T.CylinderGeometry(.94,1,1,6),c.pedalMaterial==='metal'?steel:pm,pins);
  }
  // Peg placement always opposite the drivetrain unless all four pegs are selected.
  const pegSides=c.pegs==='four'?[-1,1]:[-right],pegWheels=c.pegs==='rear'?[rear]:[rear,front];
  if(c.pegs!=='none')for(const p of pegWheels)for(const s of pegSides){const a=p.clone().add(V(0,0,s*.066)),b=p.clone().add(V(0,0,s*.173));cylinder('pegs',a,b,.019,paints.pegs);ring('pegs',b,.0156,.0034,paints.pegs);cylinder('pegs',b.clone().add(V(0,0,-s*.0001)),b,.012,blackPlastic);for(let i=0;i<10;i++)ring('pegs',a.clone().lerp(b,.3+i*.061),.019,.0005,paints.pegs);}
  // Independent front and rear U-brakes, pads, straddle wire, cables and levers.
  for(const which of ['front','rear'])if(c.brakeStyle===which||c.brakeStyle==='dual'){
    const wheel=which==='front'?front:rear,pivot=wheel.clone().add(V(which==='front'?-.025:.048,.174,0));
    for(const s of [-1,1]){
      const pivotSide=pivot.clone().add(V(0,0,s*.044)),armTop=pivot.clone().add(V(-.015,.049,s*.027));
      tube('brakes',[pivotSide.clone().add(V(.005,-.021,0)),pivotSide,armTop],.005,darkSteel,16);
      bolt('brakes',pivotSide,V(0,0,s),.004);
      box('brakes',pivotSide.clone().add(V(.002,-.014,-s*.016)),.023,.007,.009,rubberBase);
    }
    tube('brakes',[pivot.clone().add(V(-.015,.049,-.027)),pivot.clone().add(V(-.012,.067,0)),pivot.clone().add(V(-.015,.049,.027))],.0008,steel,16);
    const s=which==='front'?-1:1,lever=V(barX-.067*rScale,gripY-.013,s*.185*wScale);
    tube('brakes',[lever,lever.clone().add(V(.026,-.027,s*.012)),lever.clone().add(V(.059,-.04,s*.020))],.0047,darkSteel,14);
    cylinder('brakes',lever.clone().add(V(0,0,-.006)),lever.clone().add(V(0,0,.006)),.014,darkSteel);
    tube('brakes',[lever, V(barX+.088,gripY-.09,s*.09*wScale), V(headTop.x+.08,headTop.y-.10,s*.042), which==='front'?pivot.clone().add(V(.014,.115,0)):seat.clone().add(V(.06,.041,.023)),pivot.clone().add(V(-.012,.067,0))],.002,blackPlastic,64);
  }
  if(c.framePaint==='fade'&&['gloss','matte'].includes(c.finishes.frame)){
    const first=new T.Color(c.colors.frame),last=new T.Color(c.frameFadeColor);paints.frame.vertexColors=true;paints.frame.color.set('#fff');
    groups.frame.traverse(mesh=>{if(!mesh.isMesh)return;const geometry=mesh.geometry,p=geometry.attributes.position;const cols=[];mesh.updateMatrix();for(let i=0;i<p.count;i++){const point=V().fromBufferAttribute(p,i).applyMatrix4(mesh.matrix);const color=first.clone().lerp(last,T.MathUtils.smoothstep(point.x,-.5,.36));cols.push(color.r,color.g,color.b);}geometry.setAttribute('color',new T.Float32BufferAttribute(cols,3));});
  }
  if(c.decal!=='none'){
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;const ctx=canvas.getContext('2d');ctx.fillStyle='#121b23';ctx.textAlign='center';ctx.textBaseline='middle';if(c.decal==='jkcrew'){ctx.font='italic 900 74px sans-serif';ctx.fillText('JKCREW',256,66);}else{ctx.beginPath();ctx.moveTo(275,5);ctx.lineTo(191,70);ctx.lineTo(253,66);ctx.lineTo(224,122);ctx.lineTo(325,51);ctx.lineTo(268,57);ctx.closePath();ctx.fill();}
    const tex=new T.CanvasTexture(canvas);tex.colorSpace=T.SRGBColorSpace;textures.add(tex);const decalMat=mat({map:tex,transparent:true,roughness:.4,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2});
    for(const s of [-1,1]){const pos=bb.clone().lerp(headLow,.54).add(V(0,0,s*.0216));const mesh=add('decal',new T.PlaneGeometry(.22,.055),decalMat,pos);mesh.rotation.set(0,s<0?Math.PI:0,Math.atan2(headLow.y-bb.y,headLow.x-bb.x)*(s<0?-1:1));}
  }
  group.updateMatrixWorld(true);
  function updateColours(next){
    if(disposed||c.framePaint==='fade')return false;
    const oldStyle={...c,colors:null},newStyle={...next,colors:null};if(JSON.stringify(oldStyle)!==JSON.stringify(newStyle))return false;
    for(const [key,color] of Object.entries(next.colors)){if(['chrome','raw','jetfuel'].includes(next.finishes[key]))continue;if(key==='seat'&&paints.seat.map)continue;if(key==='spokes'&&c.spokeStyle==='rainbow')continue;paints[key]?.color.set(color);}
    for(const m of paintedPedalMaterials)m.color.set(next.colors.pedals);
    for(const m of seatSeamMaterials)m.color.set(next.colors.seat);
    c=next;return true;
  }
  return {group,get configuration(){return c;},ready:Promise.all(ready),parts:groups,updateColours,dispose(){if(disposed)return;disposed=true;for(const cancel of imageCancels)cancel();imageCancels.clear();group.traverse(obj=>{if(obj.isInstancedMesh)obj.dispose();});for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();group.clear();}};
}
