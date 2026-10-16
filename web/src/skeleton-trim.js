import * as THREE from 'three';

// Soldier models are assembled from component meshes that each carry their own copy
// of the source skeleton (GLTFLoader keeps them as Hips, Hips_1, ...). Most copied
// bones carry no skin weight, yet every one costs a matrix update and a traversal
// step each frame and an animation binding each tick. Bones that deform nothing,
// parent nothing that is kept and are not explicitly kept (hit-capsule bones) are
// detached. Skinning is unchanged: a zero-weight influence contributes nothing.
export function trimUnusedBones(model,keep=[]) {
  const needed=new Set();
  const mark=node=>{for(let n=node;n&&n!==model&&!needed.has(n);n=n.parent)needed.add(n);};
  model.traverse(node=>{
    if(node.isSkinnedMesh) {
      const {skinIndex,skinWeight}=node.geometry.attributes,bones=node.skeleton.bones;
      for(let i=0;i<skinIndex.count;i++)for(let k=0;k<skinIndex.itemSize;k++)if(skinWeight.getComponent(i,k)>0)mark(bones[skinIndex.getComponent(i,k)]);
    }
    if(!node.isBone)mark(node);
  });
  for(const node of keep)mark(node);
  const unused=[];
  model.traverse(node=>{if(node.isBone&&!needed.has(node))unused.push(node);});
  const unusedSet=new Set(unused);let detached=0;
  for(const node of unused)if(!unusedSet.has(node.parent)){node.removeFromParent();detached++;}
  return {kept:needed.size,removedBones:unused.length,detachedBranches:detached};
}

// Drop animation tracks whose target node no longer exists, so the mixer neither
// interpolates them nor warns about unbound tracks.
export function clipForModel(clip,model) {
  const names=new Set();model.traverse(node=>names.add(node.name));
  const tracks=clip.tracks.filter(track=>names.has(THREE.PropertyBinding.parseTrackName(track.name).nodeName));
  return tracks.length===clip.tracks.length?clip:new THREE.AnimationClip(clip.name,clip.duration,tracks,clip.blendMode);
}

// Clips decoded onto a single source skeleton (hero and reaction GLBs) name one
// copy of each bone, but every component mesh of an actor (body, cape, head,
// hands...) carries its own copy, which GLTFLoader renames Hips_1, Hips_2, ...
// Each track is duplicated onto every attached copy of the same source bone
// (node extras sourceBoneIndex); otherwise those components stay in their last
// pose and detach from the body. Attached weapons/hilts ("attachment_") are skipped.
export function retargetClipToCopies(clip,sourceRoot,model) {
  const sourceIndex=new Map(),copies=new Map();
  sourceRoot.traverse(node=>{const index=node.userData?.sourceBoneIndex;if(index!==undefined)sourceIndex.set(node.name,index);});
  model.traverse(node=>{
    const index=node.userData?.sourceBoneIndex;
    // Procedural bone indices are per component, never shared skeleton bones.
    if(index===undefined||node.userData.procedural||node.name.startsWith('attachment_'))return;
    if(!copies.has(index))copies.set(index,[]);copies.get(index).push(node.name);
  });
  const tracks=[];
  for(const track of clip.tracks) {
    const {nodeName,propertyName}=THREE.PropertyBinding.parseTrackName(track.name);
    for(const name of copies.get(sourceIndex.get(nodeName))??[]){const copy=track.clone();copy.name=`${name}.${propertyName}`;tracks.push(copy);}
  }
  const result=new THREE.AnimationClip(clip.name,clip.duration,tracks,clip.blendMode);
  result.userData=clip.userData;
  return result;
}

// Each component skeleton lists every source bone (about 250) although the
// component weights only a fraction of them, and three's Skeleton.update
// multiplies every listed bone each frame for each visible component. Components
// are re-bound to the bones they weight, with skin indices remapped. Run once on a
// loaded template before cloning: clones share the remapped geometry.
export function compactSkinnedSkeletons(root) {
  const seen=new WeakSet();let before=0,after=0;
  root.traverse(mesh=>{
    if(!mesh.isSkinnedMesh||mesh.userData.compactSkeleton)return;
    const geometry=mesh.geometry,{skinIndex,skinWeight}=geometry.attributes,skeleton=mesh.skeleton;
    // A geometry shared by two components could not take two remappings.
    if(seen.has(geometry))return;
    seen.add(geometry);
    const used=new Set();
    for(let i=0;i<skinIndex.count;i++)for(let k=0;k<skinIndex.itemSize;k++)if(skinWeight.getComponent(i,k)>0)used.add(skinIndex.getComponent(i,k));
    const order=[...used].sort((a,b)=>a-b),remap=new Map(order.map((old,index)=>[old,index]));
    for(let i=0;i<skinIndex.count;i++)for(let k=0;k<skinIndex.itemSize;k++)
      skinIndex.setComponent(i,k,skinWeight.getComponent(i,k)>0?remap.get(skinIndex.getComponent(i,k)):0);
    skinIndex.needsUpdate=true;
    before+=skeleton.bones.length;after+=order.length;
    mesh.bind(new THREE.Skeleton(order.map(index=>skeleton.bones[index]),order.map(index=>skeleton.boneInverses[index].clone())),mesh.bindMatrix);
    mesh.userData.compactSkeleton=true;
  });
  return {bonesBefore:before,bonesAfter:after};
}
