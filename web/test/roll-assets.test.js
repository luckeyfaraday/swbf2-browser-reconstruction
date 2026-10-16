import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createRollAnimationClip,sampleRollTrajectory} from '../src/roll-clip-adapter.js';

const workspace=new URL('../../',import.meta.url);
const read=relative=>fs.readFileSync(new URL(relative,workspace));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const report=JSON.parse(read('tools/gameplay-recovery/roll-evidence.json'));
const graph=JSON.parse(read('web/public/assets/roll-graph.json'));
const animation=JSON.parse(read('web/public/assets/roll-clips.json'));
const pointer=(value,path)=>path.slice(1).split('/').reduce((v,key)=>v[key.replaceAll('~1','/').replaceAll('~0','~')],value);

test('roll selection, ability channels, trajectory and tags match retained installed fields',()=>{
  const docs=new Map();
  for(const observation of [...report.routing,...report.observations]) {
    const {source}=observation;
    if(!docs.has(source.file)) {
      const bytes=read(source.file),doc=JSON.parse(bytes);
      assert.equal(hash(bytes),source.jsonSha256);assert.equal(doc.entry.guid,source.guid);assert.equal(doc.entry.sha1,source.sha1);
      docs.set(source.file,doc);
    }
    assert.deepEqual(pointer(docs.get(source.file),observation.jsonPointer),observation.value);
  }
  assert.deepEqual(graph,report.graph);
  assert.equal(graph.selection.characterIndex,47);
  assert.equal(graph.selection.weaponType,0);
  assert.equal(graph.ability.RechargeTime,4);
  assert.equal(graph.ability.TriggerCost,.5);
  assert.equal(graph.ability.CharacterStateDrivesActiveTime,true);
  assert.deepEqual(graph.ability.channelOperations.map(op=>[op.phase,op.channelName]),[
    ['RequiredForActive','CurrentAbility'],['SetChannelValuesOnTryActivate','DefensiveMove'],['SetChannelValuesOnActiveTimeFinished','CurrentPose'],
  ]);
  assert.deepEqual(graph.clips.map(c=>c.trajectory.times.length),[89,81,169,107]);
  for(const clip of graph.clips)assert.equal(clip.rigVariants.find(v=>v.enumValue===2).controllerKey,clip.controllerKey);
});

test('roll raw animation provenance matches the actual bank and each bounded object slice',async()=>{
  assert.equal(hash(read(animation.sourceGraph)),animation.sourceGraphSha256);
  assert.equal(hash(read(animation.sourceInventory)),animation.sourceInventorySha256);
  assert.equal(hash(read(animation.decoder.file)),animation.decoder.sha256);
  const sourceFile=new URL(animation.sourceBank,workspace),hasher=crypto.createHash('sha256');
  for await(const chunk of fs.createReadStream(sourceFile))hasher.update(chunk);
  assert.equal(hasher.digest('hex'),animation.sourceSha256);
  const fd=fs.openSync(sourceFile,'r');
  try {
    for(const source of animation.selectedObjectRanges) {
      const bytes=Buffer.alloc(source.length);assert.equal(fs.readSync(fd,bytes,0,bytes.length,source.offset),bytes.length);
      assert.equal(hash(bytes),source.sha256,source.key);
    }
  } finally {fs.closeSync(fd);}
  assert.deepEqual(animation.rigSelection.values.map(v=>[v.name,v.value]).sort(),[['1P',0],['3P',1],['AI',2],['LivingWorld',4],['Mount',3]].sort());
});

test('decoded roll samples match source byte values through source DOF permutations',()=>{
  const inventory=JSON.parse(read(animation.sourceInventory));
  const objects=new Map(inventory.sections.filter(section=>section.object).map(section=>[section.object.values.__key,section.object]));
  const fd=fs.openSync(new URL(animation.sourceBank,workspace),'r');
  const array=descriptor=>{
    const bytes=Buffer.alloc(descriptor.byteLength);assert.equal(fs.readSync(fd,bytes,0,bytes.length,descriptor.arrayOffset),bytes.length);
    const readers={UInt16:['readUInt16LE',2],UInt32:['readUInt32LE',4],Int16:['readInt16LE',2],Float:['readFloatLE',4]};
    const [reader,size]=readers[descriptor.elementType];
    return Array.from({length:descriptor.count},(_,index)=>bytes[reader](index*size));
  };
  try {
    for(const clip of animation.clips) {
      const source=objects.get(clip.sourceAnimationKey),v=source.values;
      assert.equal(source.type,'RawAnimationAsset');assert.deepEqual(clip.unmapped,[]);
      assert.deepEqual(clip.sampleFrames,array(v.KeyTimes));
      const dofs=array(objects.get(source.base.values.ChannelToDofAsset).values.DofIds);
      const reverse=array(v.ChannelIndices),raw=array(v.Data),constant=array(v.ConstData);
      const [q,t,f,cq,ct,cf]=clip.rawCounts,stride=q*4+t*4+f;
      assert.equal(raw.length,stride*clip.sampleFrames.length);assert.equal(constant.length,cq*4+ct*4+cf);
      for(const track of clip.tracks) {
        let index=reverse[dofs.indexOf(track.sourceDofId)],qs=q,ts=t,data=raw;
        if(track.constant){index-=q+t+f;qs=cq;ts=ct;data=constant;}
        const offset=index<qs?index*4:index<qs+ts?qs*4+(index-qs)*4:qs*4+ts*4+(index-qs-ts);
        const frames=track.constant?[0]:[0,Math.floor(clip.sampleFrames.length/2),clip.sampleFrames.length-1];
        for(const frame of frames)assert.deepEqual(track.values[frame],data.slice(offset+frame*stride,offset+frame*stride+track.values[frame].length),`${clip.name}/${track.bone}/${frame}`);
      }
      assert.ok(clip.maxQuaternionNormError<1e-6);
      assert.ok(Math.abs(clip.sourceTimeMapping.trimmedDuration/clip.sourceTimeMapping.timeScale-clip.lengthTicks)<2e-5);
      assert.equal(clip.sourceTimeMapping.graphTicksPerSecond,null);
    }
  } finally {fs.closeSync(fd);}
});

async function sourceSkeleton(file) {
  const bytes=read(file),doc=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));
  // Use the production loader: duplicate source names are intentionally renamed
  // by GLTFLoader. Geometry/texture loading is irrelevant to this binding test.
  const skeleton={asset:doc.asset,scene:doc.scene,scenes:doc.scenes,
    nodes:doc.nodes.map(node=>Object.fromEntries(Object.entries(node).filter(([key])=>['name','children','translation','rotation','scale','matrix','extras'].includes(key))))};
  return (await new GLTFLoader().parseAsync(JSON.stringify(skeleton),'')).scene;
}

test('all four rolls bind loaded component skeletons, share blend bindings and leave attached weapon rigs alone',async()=>{
  for(const name of ['stormtrooper','rebel']) {
    const model=await sourceSkeleton(`web/public/assets/characters/${name}.glb`);
    const weapon=await sourceSkeleton('web/public/assets/characters/e11.glb');
    // Attachment names must not shadow later actor bones in PropertyBinding's
    // depth-first name lookup (the weapon's Connect otherwise wins).
    weapon.traverse(node=>{node.name=`attachment_${node.uuid}_${node.name}`;});
    model.getObjectByName('Wep_Root').add(weapon);
    const weaponPose=[];weapon.traverse(node=>weaponPose.push([node,node.position.clone(),node.quaternion.clone()]));
    const componentHips=[];model.traverse(node=>{if(node.userData.name==='Hips')componentHips.push(node);});
    assert.equal(componentHips.length,name==='stormtrooper'?2:4);
    assert.ok(componentHips.some(node=>node.name!==node.userData.name));
    assert.throws(()=>createRollAnimationClip(model,animation.clips[0]),/explicit positive/);
    for(const source of animation.clips) {
      // Deliberately chosen test rate verifies conversion, not native timing.
      const {clip,report:binding}=createRollAnimationClip(model,source,{graphTicksPerSecond:100});
      assert.ok(binding.sourceTracks>60);assert.ok(binding.boundTracks>binding.sourceTracks);
      for(const node of componentHips)assert.ok(clip.tracks.some(track=>track.name===`${node.name}.quaternion`));
      assert.ok(clip.validate());assert.equal(clip.duration,source.lengthTicks/100);
      const roots=[];model.traverse(node=>{if(node.userData.name==='AITrajectory')roots.push([node,node.position.clone()]);});
      assert.ok(roots.length>=2);
      const mixer=new THREE.AnimationMixer(model),action=mixer.clipAction(clip);
      // Source GLTF animation tracks use the unique loaded node name. Matching
      // that exact path must reuse the same mixer binding for a correct crossfade.
      const hipPath=`${componentHips[0].name}.quaternion`;
      const base=mixer.clipAction(new THREE.AnimationClip('base',1,[new THREE.QuaternionKeyframeTrack(hipPath,[0,1],[0,0,0,1,0,0,0,1])]));
      const rollIndex=clip.tracks.findIndex(track=>track.name===hipPath);
      assert.equal(action._propertyBindings[rollIndex],base._propertyBindings[0]);
      action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
      for(const phase of [.1,.5,.9]) {
        mixer.setTime(clip.duration*phase);
        model.traverse(node=>{assert.ok(node.position.toArray().every(Number.isFinite));assert.ok(node.quaternion.toArray().every(Number.isFinite));});
        for(const [node,position] of roots)assert.ok(node.position.equals(position));
        for(const [node,position,quaternion] of weaponPose){assert.ok(node.position.equals(position),`weapon position ${node.name}`);assert.ok(node.quaternion.equals(quaternion),`weapon rotation ${node.name}`);}
      }
      mixer.stopAllAction();mixer.uncacheRoot(model);
      assert.deepEqual(sampleRollTrajectory(source,-1),source.trajectory.translations[0]);
      assert.deepEqual(sampleRollTrajectory(source,source.lengthTicks+1),source.trajectory.translations.at(-1));
      const mid=source.lengthTicks/2;
      assert.ok(sampleRollTrajectory(source,mid).every(Number.isFinite));
    }
  }
});
