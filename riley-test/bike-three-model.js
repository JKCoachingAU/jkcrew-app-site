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
    const finish=c.finishes[key]||'matte';
    const brushed=finish==='raw'&&metalParts.has(key);
    paints[key]=finish==='chrome'?mat({color:'#e6ebf0',metalness:1,roughness:.095,envMapIntensity:1.12,clearcoat:.25,clearcoatRoughness:.06}):
      finish==='raw'?mat({color:'#969da1',metalness:1,roughness:.26,envMapIntensity:1,anisotropy:brushed?.6:0,anisotropyRotation:Math.PI/2}):
      finish==='jetfuel'?mat({color:'#bab4c4',metalness:1,roughness:.16,iridescence:1,iridescenceIOR:1.6,iridescenceThicknessRange:[180,580],clearcoat:.5,clearcoatRoughness:.12}):
      mat({color,metalness:metalParts.has(key)?.12:0,roughness:finish==='matte'?.68:(key==='seat'?.82:.30),clearcoat:finish==='matte'?0:metalParts.has(key)?.65:0,clearcoatRoughness:.20,
        normalMap:['gloss','matte'].includes(finish)&&key!=='seat'?microNoise:null,normalScale:new T.Vector2(.045,.045)});
  }
  const tyres=c.tyreStyle==='white'?whiteRubber:blackTyreRubber;
  tyres.normalMap=microNoise;tyres.normalScale=new T.Vector2(.12,.12);
  const rimMat=paints.rims;
  function add(name,g,m,pos,rotation){geometries.add(g);const mesh=new T.Mesh(g,m);mesh.userData.part=name;mesh.castShadow=true;mesh.receiveShadow=true;if(pos)mesh.position.copy(pos);if(rotation)mesh.rotation.set(...rotation);part(name).add(mesh);return mesh;}
  function cylinder(name,a,b,r,m,r2=r,segments=28){const d=b.clone().sub(a),g=new T.CylinderGeometry(r2,r,d.length(),segments);const mesh=add(name,g,m,a.clone().add(b).multiplyScalar(.5));mesh.quaternion.setFromUnitVectors(Y,d.normalize());return mesh;}
  function tube(name,points,r,m,segments=48){
    const curve=new T.CatmullRomCurve3(points.map(p=>Array.isArray(p)?V(...p):p));
    // Keep the bar's clamped section straight; a spline otherwise sags below
    // the two bottom control points and cuts through the stem's circular bore.
    if(name==='bars'&&points.length===10){const sample=curve.getPoint.bind(curve),centre=points[4];curve.getPoint=(t,target)=>{const p=sample(t,target),blend=T.MathUtils.smoothstep(Math.abs(p.z),.028,.063);p.y=T.MathUtils.lerp(centre.y,p.y,blend);p.x=T.MathUtils.lerp(centre.x,p.x,blend);return p;};}
    return add(name,new T.TubeGeometry(curve,segments,r,12,false),m);
  }
  function sphere(name,p,r,m){return add(name,new T.SphereGeometry(r,24,16),m,p);}
  function box(name,p,w,h,d,m,rotation){
    const r=Math.min(.003,w*.18,h*.22,d*.22),shape=new T.Shape(),x=-w/2,y=-h/2;
    shape.moveTo(x+r,y);shape.lineTo(x+w-r,y);shape.quadraticCurveTo(x+w,y,x+w,y+r);shape.lineTo(x+w,y+h-r);shape.quadraticCurveTo(x+w,y+h,x+w-r,y+h);shape.lineTo(x+r,y+h);shape.quadraticCurveTo(x,y+h,x,y+h-r);shape.lineTo(x,y+r);shape.quadraticCurveTo(x,y,x+r,y);
    const bevel=Math.min(.0012,d*.16),g=new T.ExtrudeGeometry(shape,{depth:d-bevel*2,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:bevel,bevelThickness:bevel,curveSegments:3});g.translate(0,0,-d/2+bevel);return add(name,g,m,p,rotation);
  }
  function ring(name,p,r,t,m,rotation){return add(name,new T.TorusGeometry(r,t,10,64),m,p,rotation);}
  // Socket-head hardware: a round cap with an actual recessed hex socket.
  function bolt(name,p,axis=V(0,0,1),r=.0045){
    const shape=new T.Shape();shape.absarc(0,0,r,0,TAU,false);
    const hole=new T.Path();for(let i=0;i<6;i++){const a=-i/6*TAU,x=Math.cos(a)*r*.47,y=Math.sin(a)*r*.47;i?hole.lineTo(x,y):hole.moveTo(x,y);}hole.closePath();shape.holes.push(hole);
    const g=new T.ExtrudeGeometry(shape,{depth:r*.55,bevelEnabled:true,bevelSize:r*.08,bevelThickness:r*.06,bevelSegments:1,curveSegments:16,steps:1});
    const cap=add(name,g,steel,p.clone().addScaledVector(axis,-r*.18));cap.quaternion.setFromUnitVectors(V(0,0,1),axis);
    cylinder(name,p.clone().addScaledVector(axis,-r*.20),p.clone().addScaledVector(axis,-r*.16),r*.48,darkSteel,r*.48,6);
  }
  function smoothMachinedSides(g){
    // Extrusion's cap stays planar, while curved walls and bevel bands share
    // normals. This removes polygon-strip reflections from machined metal.
    const side=g.groups.find(group=>group.materialIndex===1);if(!side)return g;
    const positions=g.attributes.position,normals=g.attributes.normal,buckets=new Map();
    for(let i=side.start;i<side.start+side.count;i++){
      const key=[positions.getX(i),positions.getY(i),positions.getZ(i)].map(n=>Math.round(n*1e7)).join(',');
      let entry=buckets.get(key);if(!entry){entry={normal:V(),indices:[]};buckets.set(key,entry);}entry.normal.add(V(normals.getX(i),normals.getY(i),normals.getZ(i)));entry.indices.push(i);
    }
    for(const {normal,indices} of buckets.values()){normal.normalize();for(const i of indices)normals.setXYZ(i,normal.x,normal.y,normal.z);}return g;
  }
  function profile(name,shape,depth,m,position,rotation){
    const g=new T.ExtrudeGeometry(shape,{depth:depth-.002,steps:1,bevelEnabled:true,bevelSize:.001,bevelThickness:.001,bevelSegments:3,curveSegments:12});g.translate(0,0,-depth/2+.001);smoothMachinedSides(g);return add(name,g,m,position,rotation);
  }

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
    const valve=p.clone().add(V(0,-.196,0));
    cylinder('rims',valve,valve.clone().add(V(0,.020,0)),.0028,blackPlastic);
    cylinder('rims',valve.clone().add(V(0,.017,0)),valve.clone().add(V(0,.022,0)),.0031,steel);
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
    // Fine blocks follow the round tyre surface; no floating saw-tooth fins.
    const treadObj=[],tmp=new T.Object3D(),knobby=c.tireTread==='knobby';
    const rows=c.tireTread==='slick'?3:5,columns=knobby?92:144;
    for(let i=0;i<columns;i++)for(let row=0;row<rows;row++){
      const lateral=(row-(rows-1)/2)*.012,angle=i/columns*TAU+(row%2)*Math.PI/columns;
      const slope=Math.asin(lateral/.031),surface=.235+Math.sqrt(.031*.031-lateral*lateral);
      const height=knobby?.0018:.0006;
      tmp.position.copy(p).add(V(Math.cos(angle)*(surface+height*.15),Math.sin(angle)*(surface+height*.15),lateral));
      tmp.rotation.set(0,0,angle-Math.PI/2);tmp.rotateX(slope);
      tmp.scale.set(knobby?.011:.0085,height,knobby?.009:.0105);tmp.updateMatrix();treadObj.push(tmp.matrix.clone());
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
  cylinder('fork',crown.clone().add(V(0,0,-.035)),crown.clone().add(V(0,0,.035)),forkModel.crownRadius*.72,paints.fork);
  for(const t of [-.009,.008,.129,.142]){
    const p=headLow.clone().addScaledVector(steer,t);cylinder('headset',p,p.clone().addScaledVector(steer,.005),t<.1?.028:.026,paints.headset);
  }
  // Seat tube follows the actual seat-tube axis, with clamp, rails and sewn
  // edge. The saddle sits a fixed distance up the same seatpost axis beyond
  // the seat-tube top, so it stays correctly placed across every frame model.
  const seatAxis=seat.clone().sub(bb).normalize();
  const saddle=seat.clone().addScaledVector(seatAxis,.075).add(V(.008,-.006,0));
  cylinder('seatpost',seat.clone().addScaledVector(seatAxis,-.015),saddle.clone().add(V(.006,-.015,0)),.0127,paints.seatpost);
  cylinder('seatpost',seat.clone().addScaledVector(seatAxis,-.005),seat.clone().addScaledVector(seatAxis,.009),.019,paints.seatpost);
  bolt('seatpost',seat.clone().add(V(-.014,.005,.020)),V(0,0,1),.004);
  // Compact pivotal saddle mount, seated directly on the post (no road-bike rails).
  cylinder('seat',saddle.clone().add(V(0,-.018,0)),saddle.clone().add(V(0,.014,0)),.013,blackPlastic);
  box('seat',saddle.clone().add(V(0,.012,0)),.045,.012,.037,blackPlastic);

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
  // Machined stem with a split circular handlebar bore and separate faceplate.
  const stemCentre=headTop.clone().addScaledVector(steer,.043);
  const topLoad=c.stemStyle==='top-load',bx=.047,by=topLoad?.013:-.003,clampR=.0116;
  const barCentre=stemCentre.clone().add(V(bx,by,0));
  part('stem').userData.clampCentre=barCentre.toArray();
  cylinder('stem',stemCentre.clone().addScaledVector(steer,-.025),stemCentre.clone().addScaledVector(steer,.008),.021,paints.stem);
  const body=new T.Shape(),cap=new T.Shape();
  if(topLoad){
    body.moveTo(-.022,-.018);body.lineTo(bx-.006,by-.021);body.quadraticCurveTo(bx+.023,by-.021,bx+.023,by-.010);body.lineTo(bx+.023,by-.001);
    body.lineTo(bx+clampR,by-.001);body.absarc(bx,by,clampR,0,-Math.PI,true);body.lineTo(-.022,by);body.closePath();
    cap.moveTo(bx-.024,by+.001);cap.lineTo(bx-clampR,by+.001);cap.absarc(bx,by,clampR,Math.PI,0,true);
    cap.lineTo(bx+.024,by+.001);cap.lineTo(bx+.024,by+.012);cap.quadraticCurveTo(bx+.024,by+.017,bx+.017,by+.017);cap.lineTo(bx-.017,by+.017);cap.quadraticCurveTo(bx-.024,by+.017,bx-.024,by+.012);cap.closePath();
    profile('stem',cap,.050,paints.stem,stemCentre);
    for(const x of [-.017,.017])for(const z of [-.017,.017])bolt('stem',barCentre.clone().add(V(x,.018,z)),Y,.0038);
  }else{
    body.moveTo(-.023,-.019);body.quadraticCurveTo(bx-.006,-.025,bx-.001,by-.020);body.lineTo(bx-.001,by-clampR);body.absarc(bx,by,clampR,-Math.PI/2,-Math.PI*1.5,true);body.lineTo(bx-.001,by+.020);body.quadraticCurveTo(bx-.006,.022,-.023,.020);body.closePath();
    cap.moveTo(bx+.001,by-clampR);cap.lineTo(bx+.001,by-.023);cap.lineTo(bx+.020,by-.023);cap.quadraticCurveTo(bx+.025,by-.023,bx+.025,by-.016);cap.lineTo(bx+.025,by+.016);cap.quadraticCurveTo(bx+.025,by+.023,bx+.020,by+.023);cap.lineTo(bx+.001,by+.023);cap.lineTo(bx+.001,by+clampR);cap.absarc(bx,by,clampR,Math.PI/2,-Math.PI/2,true);cap.closePath();
    profile('stem',cap,.048,paints.stem,stemCentre);
    for(const y of [-.016,.016])for(const z of [-.016,.016])bolt('stem',barCentre.clone().add(V(.026,y,z)),V(1,0,0),.0038);
  }
  profile('stem',body,.048,paints.stem,stemCentre);
  for(const z of [-.018,.018])bolt('stem',stemCentre.clone().add(V(-.023,-.005,z)),V(-1,0,0),.0038);
  cylinder('stem',stemCentre.clone().add(V(0,.023,0)),stemCentre.clone().add(V(0,.026,0)),.015,darkSteel);
  bolt('stem',stemCentre.clone().add(V(0,.027,0)),Y,.005);
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
  function sprocket(name,p,r,teeth,m,thick,guard){const shape=new T.Shape();for(let i=0;i<teeth*4;i++){const a=i/(teeth*4)*TAU,rr=r*(i%4===1||i%4===2?1:.936);const x=Math.cos(a)*rr,y=Math.sin(a)*rr;i?shape.lineTo(x,y):shape.moveTo(x,y);}shape.closePath();const centreHole=new T.Path();centreHole.absarc(0,0,.009,0,TAU,true);shape.holes.push(centreHole);if(r>.025&&!guard)for(let i=0;i<5;i++){const a=i/5*TAU;const hole=new T.Path();hole.absellipse(Math.cos(a)*r*.54,Math.sin(a)*r*.54,r*.14,r*.27,0,TAU,true,a);shape.holes.push(hole);}const g=new T.ExtrudeGeometry(shape,{depth:thick,bevelEnabled:true,bevelSegments:1,steps:1,bevelSize:.0005,bevelThickness:.0005,curveSegments:16});return add(name,g,m,p.clone().add(V(0,0,-thick/2)));}
  sprocket('sprocket',chainCentre,.052,25,paints.sprocket,c.sprocketStyle==='guard'?.006:.004,c.sprocketStyle==='guard');
  sprocket('hubs',rear.clone().add(V(0,0,chainZ)),.020,9,darkSteel,.012);
  // Roller chain: two straight tangents and correctly wrapped pitch circles.
  // Side plates, pins and rollers are instanced, keeping the close-up detail cheap.
  const x1=rear.x,y1=rear.y,r1=.019,x2=bb.x,y2=bb.y,r2=.052;
  const theta=Math.atan2(y2-y1,x2-x1),offset=Math.acos((r1-r2)/Math.hypot(x2-x1,y2-y1));
  const top=theta+offset,bottom=theta-offset;
  const at=(x,y,r,a)=>V(x+Math.cos(a)*r,y+Math.sin(a)*r,chainZ);
  const rearTop=at(x1,y1,r1,top),frontTop=at(x2,y2,r2,top),rearBottom=at(x1,y1,r1,bottom),frontBottom=at(x2,y2,r2,bottom);
  const straight=rearTop.distanceTo(frontTop),frontArc=(top-bottom)*r2,rearArc=(TAU-top+bottom)*r1,total=2*straight+frontArc+rearArc;
  const links=Math.round(total/.0127/2)*2,pitch=total/links;
  function chainPoint(distance){let d=(distance%total+total)%total;if(d<straight)return rearTop.clone().lerp(frontTop,d/straight);d-=straight;if(d<frontArc)return at(x2,y2,r2,top-d/r2);d-=frontArc;if(d<straight)return frontBottom.clone().lerp(rearBottom,d/straight);d-=straight;return at(x1,y1,r1,bottom-d/r1);}
  const shape=new T.Shape(),half=pitch/2,pr=.0039;
  shape.moveTo(-half,pr);shape.quadraticCurveTo(0,.0015,half,pr);shape.absarc(half,0,pr,Math.PI/2,-Math.PI/2,true);shape.quadraticCurveTo(0,-.0015,-half,-pr);shape.absarc(-half,0,pr,-Math.PI/2,-Math.PI*1.5,true);shape.closePath();
  const plates=[],rollers=[],pins=[],o=new T.Object3D();
  for(let i=0;i<links;i++){
    const a=chainPoint(i*pitch),b=chainPoint((i+1)*pitch),middle=a.clone().lerp(b,.5),angle=Math.atan2(b.y-a.y,b.x-a.x);
    for(const side of [-1,1]){o.position.copy(middle).add(V(0,0,side*(i%2?.0037:.0027)));o.rotation.set(0,0,angle);o.scale.set(a.distanceTo(b)/pitch,1,1);o.updateMatrix();plates.push(o.matrix.clone());}
    rollers.push(rodMatrix(a.clone().add(V(0,0,-.0024)),a.clone().add(V(0,0,.0024)),.0032));
    pins.push(rodMatrix(a.clone().add(V(0,0,-.0045)),a.clone().add(V(0,0,.0045)),.0016));
  }
  const plateGeometry=new T.ExtrudeGeometry(shape,{depth:.0008,bevelEnabled:false,curveSegments:5,steps:1});plateGeometry.translate(0,0,-.0004);
  batch('sprocket',plateGeometry,darkSteel,plates).name='Chain side plates';
  batch('sprocket',new T.CylinderGeometry(1,1,1,8),steel,rollers).name='Chain rollers';
  batch('sprocket',new T.CylinderGeometry(1,1,1,8),steel,pins).name='Chain pins';
  group.userData.chain={links,pitch,closedGap:chainPoint(0).distanceTo(chainPoint(total)),frontRadius:r2,rearRadius:r1};
  // Cranks: a tubular 3-piece arm on a splined spindle, or a thicker
  // 2-piece wedge-cluster arm with no separate visible pinch bolt.
  const twoPiece=c.crankModel==='two-piece',crankR=twoPiece?.0185:.014;
  for(const s of [-1,1]){
    const p=bb.clone().add(V(0,0,s*.099)),angle=s===right?-.22:Math.PI-.22;
    const end=p.clone().add(V(Math.cos(angle)*.165,Math.sin(angle)*.165,0));
    const direction=end.clone().sub(p).normalize();
    const arm=cylinder('cranks',p.clone().addScaledVector(direction,.009),end.clone().addScaledVector(direction,-.006),crankR,paints.cranks,.011);arm.geometry.scale(1,1,.82);
    for(const [centre,r,holeR] of [[p,.017,.009],[end,.013,.0047]]){const eye=new T.Shape();eye.absarc(0,0,r,0,TAU,false);const hole=new T.Path();hole.absarc(0,0,holeR,0,TAU,true);eye.holes.push(hole);profile('cranks',eye,.023,paints.cranks,centre);}
    if(!twoPiece)bolt('cranks',p.clone().add(V(0,0,s*.015)),V(0,0,s),.008);
    const pedalCentre=end.clone().add(V(0,0,s*.062));
    cylinder('pedals',end,end.clone().add(V(0,0,s*.102)),.006,steel);
    const pm=c.pedalMaterial==='metal'?mat({color:c.colors.pedals,roughness:.22,metalness:.85,clearcoat:.5}):paints.pedals;
    paintedPedalMaterials.push(pm);
    const rail=c.pedalMaterial==='metal'?.011:.016;
    const outline=new T.Shape();outline.moveTo(-.046,-.048);outline.lineTo(.043,-.048);outline.quadraticCurveTo(.054,-.048,.056,-.035);outline.lineTo(.056,.034);outline.quadraticCurveTo(.054,.048,.043,.048);outline.lineTo(-.046,.048);outline.quadraticCurveTo(-.056,.045,-.056,.034);outline.lineTo(-.056,-.034);outline.quadraticCurveTo(-.056,-.048,-.046,-.048);
    for(const x of [-1,1])for(const z of [-1,1]){
      const hole=new T.Path(),cx=x*.030,cz=z*.024,w=.014,h=.013,r=.003;
      hole.moveTo(cx-w+r,cz-h);hole.lineTo(cx+w-r,cz-h);hole.quadraticCurveTo(cx+w,cz-h,cx+w,cz-h+r);hole.lineTo(cx+w,cz+h-r);hole.quadraticCurveTo(cx+w,cz+h,cx+w-r,cz+h);hole.lineTo(cx-w+r,cz+h);hole.quadraticCurveTo(cx-w,cz+h,cx-w,cz+h-r);hole.lineTo(cx-w,cz-h+r);hole.quadraticCurveTo(cx-w,cz-h,cx-w+r,cz-h);hole.closePath();outline.holes.push(hole);
    }
    profile('pedals',outline,rail,pm,pedalCentre,[Math.PI/2,0,0]);
    cylinder('pedals',pedalCentre.clone().add(V(0,0,-.045)),pedalCentre.clone().add(V(0,0,.045)),rail*.54,pm);
    const pins=[];for(const x of [-.046,-.023,.023,.046])for(const z of [-.042,.042])for(const sy of [-1,1])pins.push(rodMatrix(pedalCentre.clone().add(V(x,sy*rail*.5,z)),pedalCentre.clone().add(V(x,sy*(rail*.5+.003),z)),.0013));
    batch('pedals',new T.CylinderGeometry(.85,1,1,8),c.pedalMaterial==='metal'?steel:pm,pins).name='Pedal grip pins';

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
