import * as THREE from 'three';

// Analytic finite ray / capsule intersection. No mesh tessellation is involved;
// near-parallel rays and origins inside the capsule retain their nearest hit.
export function rayCapsuleDistance(ray,start,end,radius,maxDistance=Infinity) {
  const axis=end.clone().sub(start),length=axis.length();
  const offset=ray.origin.clone().sub(start);
  const projection=length?Math.max(0,Math.min(1,offset.dot(axis)/(length*length))):0;
  if(offset.clone().addScaledVector(axis,-projection).lengthSq()<=radius*radius)return 0;
  let nearest=Infinity;
  const sphere=center=>{
    const delta=ray.origin.clone().sub(center),b=delta.dot(ray.direction),c=delta.lengthSq()-radius*radius;
    const discriminant=b*b-c;if(discriminant<0)return;
    const t=-b-Math.sqrt(discriminant);if(t>=0)nearest=Math.min(nearest,t);
  };
  sphere(start);if(length>1e-10) {
    sphere(end);axis.multiplyScalar(1/length);
    const along=ray.direction.dot(axis),originAlong=offset.dot(axis);
    const a=1-along*along,b=offset.dot(ray.direction)-originAlong*along;
    const c=offset.lengthSq()-originAlong*originAlong-radius*radius,discriminant=b*b-a*c;
    if(a>1e-12&&discriminant>=0) {
      for(const t of [(-b-Math.sqrt(discriminant))/a,(-b+Math.sqrt(discriminant))/a]) {
        const y=originAlong+t*along;
        if(t>=0&&y>=0&&y<=length)nearest=Math.min(nearest,t);
      }
    }
  }
  return Number.isFinite(nearest)&&nearest<=maxDistance?nearest:null;
}

export function createSoldierHitboxes(model,document) {
  if(!document?.capsules?.length)return null;
  const capsules=document.capsules.map(source=>{
    const bone=model.getObjectByName(source.bone);
    if(!bone?.isBone)throw new Error(`Source collision bone is missing: ${source.bone}`);
    return {source,bone,start:new THREE.Vector3(),end:new THREE.Vector3(),radius:source.radius};
  });
  const scale=new THREE.Vector3(),rotation=new THREE.Quaternion(),offset=new THREE.Vector3();
  return {
    capsules,
    update() {
      // Only the capsule bones' ancestor chains are refreshed. Updating the whole
      // rig (every bone of every component skeleton copy) on each tick for each
      // soldier dominated frame time; capsule results are identical either way.
      model.getWorldScale(scale);model.getWorldQuaternion(rotation);
      for(const capsule of capsules) {
        const {bone,source,start,end}=capsule;
        bone.updateWorldMatrix(true,false);
        start.setFromMatrixPosition(bone.matrixWorld);
        end.set(0,0,0).setComponent(source.axis,source.length).applyMatrix4(bone.matrixWorld);
        offset.fromArray(source.offset).multiply(scale).applyQuaternion(rotation);
        start.add(offset);end.add(offset);capsule.radius=source.radius*Math.max(Math.abs(scale.x),Math.abs(scale.y),Math.abs(scale.z));
      }
    },
    intersect(ray,maxDistance,visible=null) {
      let hit=null;
      for(const capsule of capsules) {
        const distance=rayCapsuleDistance(ray,capsule.start,capsule.end,capsule.radius,hit?.distance??maxDistance);
        if(distance===null)continue;
        if(capsule.source.deactivateIfBehindWall&&visible&&!visible(capsule.start.clone().add(capsule.end).multiplyScalar(.5)))continue;
        if(!hit||distance<hit.distance)hit={distance,head:capsule.source.head,bone:capsule.source.bone};
      }
      return hit;
    },
  };
}
