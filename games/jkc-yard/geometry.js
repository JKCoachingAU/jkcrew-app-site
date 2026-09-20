import * as T from './vendor/three.module.js';
export const v=(x=0,y=0,z=0)=>new T.Vector3(x,y,z);
const up=v(0,1,0);
export function mesh(g,m,parent,pos){const o=new T.Mesh(g,m);if(pos)o.position.copy(pos);parent.add(o);return o;}
export function tube(parent,a,b,r,m,sides=10){const d=b.clone().sub(a);const o=mesh(new T.CylinderGeometry(r,r,d.length(),sides),m,parent,a.clone().add(b).multiplyScalar(.5));o.quaternion.setFromUnitVectors(up,d.normalize());return o;}
export function box(parent,size,pos,m){return mesh(new T.BoxGeometry(...size),m,parent,v(...pos));}
export function ellipsoid(parent,radii,pos,m,segments=16){const o=mesh(new T.SphereGeometry(1,segments,12),m,parent,v(...pos));o.scale.set(...radii);return o;}
// Smooth tailored cross sections, for cloth, shoes and the head silhouette.
export function sections(rings,segments=16){const p=[],uv=[],ix=[];for(let i=0;i<rings.length;i++){const [y,rx,rz,cx=0,cz=0]=rings[i];for(let j=0;j<=segments;j++){const a=j/segments*Math.PI*2;p.push(cx+Math.cos(a)*rx,y,cz+Math.sin(a)*rz);uv.push(j/segments,i/(rings.length-1));if(i&&j){const k=i*(segments+1)+j;ix.push(k,k-segments-2,k-1,k,k-segments-1,k-segments-2);}}}const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(ix);g.computeVertexNormals();return g;}
export function mergeRigid(group,excluded=new Set()){
 group.updateWorldMatrix(true,true);const inv=group.matrixWorld.clone().invert(),batches=new Map();
 const walk=o=>{if(excluded.has(o))return;if(o.isMesh){const g=o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone();g.applyMatrix4(new T.Matrix4().multiplyMatrices(inv,o.matrixWorld));let b=batches.get(o.material.uuid);if(!b){b={mat:o.material,parts:[],old:[]};batches.set(o.material.uuid,b);}b.parts.push(g);b.old.push(o);}else for(const c of [...o.children])walk(c);};for(const c of [...group.children])walk(c);
 for(const b of batches.values()){const g=new T.BufferGeometry();for(const name of ['position','normal','uv']){const n=name==='uv'?2:3,len=b.parts.reduce((a,p)=>a+p.attributes.position.count*n,0),out=new Float32Array(len);let offset=0;for(const p of b.parts){const data=p.attributes[name]?.array||new Float32Array(p.attributes.position.count*n);out.set(data,offset);offset+=data.length;}g.setAttribute(name,new T.BufferAttribute(out,n));}for(const o of b.old){o.removeFromParent();o.geometry.dispose();}for(const g of b.parts)g.dispose();mesh(g,b.mat,group);}
}
export function limbJoint(start,end,upper,lower,bend){
 const delta=end.clone().sub(start),distance=delta.length(),d=Math.max(.0001,Math.min(upper+lower-.0001,Math.max(Math.abs(upper-lower)+.0001,distance)));
 const axis=delta.normalize(),cos=(upper*upper+d*d-lower*lower)/(2*upper*d),h=upper*Math.sqrt(Math.max(0,1-cos*cos));
 let pole=bend.clone().sub(axis.clone().multiplyScalar(bend.dot(axis)));if(pole.lengthSq()<.00001)pole=v(0,0,1).cross(axis);pole.normalize();
 return {joint:start.clone().addScaledVector(axis,upper*cos).addScaledVector(pole,h),end:start.clone().addScaledVector(axis,d),error:Math.abs(distance-d)};
}
