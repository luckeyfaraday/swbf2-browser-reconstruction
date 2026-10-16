import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {trimUnusedBones,clipForModel} from '../src/skeleton-trim.js';

// Two component meshes, each with its own three-bone chain (Hips/Spine/Hand and
// Hips_1/Spine_1/Hand_1). Only some bones carry weight.
function rig() {
  const model=new THREE.Group(),parts=[];
  for(const suffix of ['','_1']) {
    const hips=new THREE.Bone(),spine=new THREE.Bone(),hand=new THREE.Bone(),tip=new THREE.Bone();
    hips.name=`Hips${suffix}`;spine.name=`Spine${suffix}`;hand.name=`Hand${suffix}`;tip.name=`Tip${suffix}`;
    hips.add(spine);spine.add(hand);hand.add(tip);spine.position.y=1;hand.position.x=.5;tip.position.x=.1;
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,0,1,0,.5,1,0],3));
    // Component '' weights Spine only; component '_1' weights Hand_1 only.
    const index=suffix?[2,0,0,0, 2,0,0,0, 2,0,0,0]:[1,0,0,0, 1,0,0,0, 1,0,0,0];
    geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(index,4));
    geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute([1,0,0,0, 1,0,0,0, 1,0,0,0],4));
    const mesh=new THREE.SkinnedMesh(geometry,new THREE.MeshBasicMaterial());
    model.add(hips,mesh);mesh.bind(new THREE.Skeleton([hips,spine,hand,tip]));parts.push(mesh);
  }
  return {model,parts};
}

test('unweighted bones are detached while weighted bones, their ancestors and kept bones remain',()=>{
  const {model,parts}=rig(),attachment=new THREE.Group();
  model.getObjectByName('Tip_1').add(attachment);
  const kept=model.getObjectByName('Hand');
  const report=trimUnusedBones(model,[kept]);
  const names=[];model.traverse(node=>{if(node.isBone)names.push(node.name);});
  // Hips/Spine (weighted) + Hand (kept); Hips_1/Spine_1/Hand_1 (weighted) + Tip_1 (parents an attachment).
  assert.deepEqual(names.sort(),['Hand','Hand_1','Hips','Hips_1','Spine','Spine_1','Tip_1'].sort());
  assert.equal(report.removedBones,1);
  // Skinned results are unchanged: weighted bones still drive both parts.
  model.updateMatrixWorld(true);
  for(const part of parts){part.skeleton.update();assert.ok(part.skeleton.boneMatrices.every(Number.isFinite));}
  const before=new THREE.Vector3(),after=new THREE.Vector3();
  parts[1].getVertexPosition(2,before);
  model.getObjectByName('Hand_1').rotation.z=.3;model.updateMatrixWorld(true);parts[1].getVertexPosition(2,after);
  assert.ok(before.distanceTo(after)>1e-3,'weighted bone still deforms its component');
});

test('clips lose only tracks whose nodes were detached',()=>{
  const {model}=rig();
  const clip=new THREE.AnimationClip('idle',1,[
    new THREE.QuaternionKeyframeTrack('Spine.quaternion',[0,1],[0,0,0,1,0,0,0,1]),
    new THREE.QuaternionKeyframeTrack('Tip.quaternion',[0,1],[0,0,0,1,0,0,0,1]),
  ]);
  assert.equal(clipForModel(clip,model),clip,'unchanged clip is reused');
  trimUnusedBones(model);
  const trimmed=clipForModel(clip,model);
  assert.deepEqual(trimmed.tracks.map(track=>track.name),['Spine.quaternion']);
  assert.equal(trimmed.name,'idle');assert.equal(trimmed.duration,1);
});

test('compacted component skeletons skin every vertex exactly as before',async()=>{
  const {compactSkinnedSkeletons}=await import('../src/skeleton-trim.js');
  const {model,parts}=rig();
  // Pose bones, then record skinned positions before compaction.
  model.getObjectByName('Spine').rotation.x=.4;model.getObjectByName('Hand_1').rotation.z=-.7;model.getObjectByName('Hips_1').position.set(.2,0,.1);
  model.updateMatrixWorld(true);
  const sample=()=>parts.flatMap(part=>[0,1,2].map(i=>part.getVertexPosition(i,new THREE.Vector3()).toArray()));
  const expected=sample();
  const report=compactSkinnedSkeletons(model);
  assert.deepEqual(report,{bonesBefore:8,bonesAfter:2});
  assert.deepEqual(parts.map(part=>part.skeleton.bones.map(bone=>bone.name)),[['Spine'],['Hand_1']]);
  const actual=sample();
  actual.flat().forEach((value,i)=>assert.ok(Math.abs(value-expected.flat()[i])<1e-6));
  assert.deepEqual(compactSkinnedSkeletons(model),{bonesBefore:0,bonesAfter:0},'second run is a no-op');
});
