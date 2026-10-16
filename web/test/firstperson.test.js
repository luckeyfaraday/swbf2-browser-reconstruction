import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createFirstPersonViewmodel, FIRSTPERSON_FIRE_POLICY } from '../src/firstperson.js';

const file=p=>new URL(p,import.meta.url);
const json=p=>JSON.parse(fs.readFileSync(file(p),'utf8'));
const manifest=json('../public/assets/firstperson-weapons.json');
const fireDocument=json('../public/assets/firstperson-fire.json');
const aimDocument=json('../public/assets/firstperson-ads.json');

// Load the actual recovered geometry, skins, hierarchy and animations. Remove
// only texture bindings in memory so these playback tests need no DOM/Image API.
async function loadSource(descriptor) {
  const bytes=fs.readFileSync(file(`../public/assets/${descriptor.url}`));
  const length=bytes.readUInt32LE(12),doc=JSON.parse(bytes.subarray(20,20+length));
  doc.materials=(doc.materials??[]).map(m=>({name:m.name,pbrMetallicRoughness:{baseColorFactor:m.pbrMetallicRoughness?.baseColorFactor??[1,1,1,1]}}));
  delete doc.images;delete doc.textures;delete doc.samplers;
  const raw=Buffer.from(JSON.stringify(doc)),padded=Buffer.alloc((raw.length+3)&~3,32);raw.copy(padded);
  const header=Buffer.from(bytes.subarray(0,20)),remaining=bytes.subarray(20+length);
  header.writeUInt32LE(20+padded.length+remaining.length,8);header.writeUInt32LE(padded.length,12);
  const rebuilt=Buffer.concat([header,padded,remaining]);
  const gltf=await new GLTFLoader().parseAsync(rebuilt.buffer.slice(rebuilt.byteOffset,rebuilt.byteOffset+rebuilt.byteLength),'');
  return {descriptor,gltf};
}
const sources=await Promise.all(manifest.models.map(loadSource));
const sourceBone=(root,name)=>{let found;root.traverse(n=>{if(!found&&(n.userData?.name??n.name)===name)found=n;});return found;};
const bones=(root,name)=>{const found=[];root.traverse(n=>{if((n.userData?.name??n.name)===name)found.push(n);});return found;};
const closeVector=(a,b,epsilon=1e-6)=>assert.ok(new Vector3().fromArray(a).distanceTo(new Vector3().fromArray(b))<epsilon,`${a} differs from ${b}`);

test('fire payload retains exact recovered samples and declares inferred playback',()=>{
  const rawBytes=fs.readFileSync(file('../../exports/characters/firstperson-dct/decoded-clips.json'));
  const raw=JSON.parse(rawBytes);
  assert.equal(createHash('sha256').update(rawBytes).digest('hex'),fireDocument.provenance.decodedDocumentSha256);
  assert.equal(FIRSTPERSON_FIRE_POLICY.nativeExecutionObserved,false);
  for(const weapon of fireDocument.weapons)for(const clip of weapon.clips) {
    const source=raw.clips.find(c=>c.sourceAnimationKey===clip.id);
    assert.ok(source);assert.equal(clip.additive,true);assert.equal(clip.durationSeconds,.5);
    assert.deepEqual(clip.sourceKeyTimes,source.sourceKeyTimes);
    for(const track of clip.tracks) {
      const original=source.tracks.find(t=>t.sourceDofId===track.sourceDofId);
      assert.deepEqual(track.values,original.rawVec4.map(v=>v.slice(0,track.property==='rotation'?4:3)));
    }
  }
});

test('actual faction viewmodels preserve cloned skins and idle camera-relative sockets',()=>{
  for(const found of sources) {
    const before=sourceBone(found.gltf.scene,'Wep_Root').position.clone();
    const view=createFirstPersonViewmodel(found,{fireDocument});
    assert.notEqual(view.root,found.gltf.scene);
    const cloneNodes=new Set();view.root.traverse(n=>cloneNodes.add(n));
    view.root.traverse(n=>{if(n.isSkinnedMesh)for(const bone of n.skeleton.bones)assert.ok(cloneNodes.has(bone));});
    view.update(0,{alive:true,sprinting:false});
    for(const muzzle of view.snapshot().muzzles)closeVector(muzzle,found.descriptor.idleCameraSpaceMuzzle,2e-6);
    assert.equal(view.snapshot().pose,'idle');assert.equal(view.snapshot().firing,false);
    assert.ok(sourceBone(found.gltf.scene,'Wep_Root').position.equals(before));
    assert.notEqual(sourceBone(view.root,'Wep_Root'),sourceBone(found.gltf.scene,'Wep_Root'));
  }
});

test('idle, sprint and firing share PropertyMixers and apply one base plus one delta',()=>{
  for(const found of sources) {
    const view=createFirstPersonViewmodel(found,{fireDocument});
    const expectedBindings=new Set(found.gltf.animations.flatMap(c=>c.tracks.map(t=>t.name))).size;
    assert.equal(view.snapshot().mixerBindings,expectedBindings,'base and additive tracks must share binding names');
    const bone=sourceBone(view.root,'Wep_Root'),basePosition=bone.position.clone(),baseQuaternion=bone.quaternion.clone();
    const source=fireDocument.weapons.find(w=>w.weaponId===found.descriptor.weaponId).clips[0];
    const index=3,dt=source.sourceKeyTimes[index]/source.sourceTiming.fps*source.sourceTiming.timeScale;
    assert.equal(view.fire(),true);view.update(dt,{alive:true});
    const deltaPosition=source.tracks.find(t=>t.bone==='Wep_Root'&&t.property==='translation').values[index];
    closeVector(bone.position.toArray(),basePosition.add(new Vector3().fromArray(deltaPosition)).toArray());
    const deltaRotation=source.tracks.find(t=>t.bone==='Wep_Root'&&t.property==='rotation').values[index];
    const expected=baseQuaternion.multiply(new Quaternion().fromArray(deltaRotation).normalize()).normalize();
    assert.ok(bone.quaternion.clone().normalize().angleTo(expected)<2e-6,'Three base * normalized delta composition');
    assert.equal(view.snapshot().mixerBindings,expectedBindings);
    const muzzle=view.snapshot().muzzles;for(const p of muzzle)closeVector(p,muzzle[0]);
    view.update(0,{alive:true,sprinting:true});
    assert.equal(view.snapshot().pose,'sprint');assert.equal(view.snapshot().firing,true);
    const rootBones=bones(view.root,'Wep_Root');
    for(const b of rootBones)closeVector(b.position.toArray(),rootBones[0].position.toArray());
  }
});

test('shots retrigger, deterministic variants cycle, and completion/death restore base poses',()=>{
  for(const found of sources) {
    const view=createFirstPersonViewmodel(found,{fireDocument}),initial=view.snapshot().muzzles;
    const variants=fireDocument.weapons.find(w=>w.weaponId===found.descriptor.weaponId).clips;
    view.fire();view.update(.1,{alive:true});assert.ok(view.snapshot().fireTime>.09);
    view.fire();assert.equal(view.snapshot().fireTime,0);assert.equal(view.snapshot().shots,2);
    assert.equal(view.snapshot().lastFire,variants[1%variants.length].sourceName);
    view.update(.51,{alive:true});assert.equal(view.snapshot().firing,false);
    view.snapshot().muzzles.forEach((m,i)=>closeVector(m,initial[i]));
    view.fire();view.update(.08,{alive:true});view.update(0,{alive:false});
    assert.equal(view.root.visible,false);assert.equal(view.snapshot().firing,false);assert.equal(view.fire(),false);
    view.update(0,{alive:true});assert.equal(view.root.visible,true);
    view.snapshot().muzzles.forEach((m,i)=>closeVector(m,initial[i]));
    assert.equal(view.snapshot().shots,3);
  }
});

test('separate viewmodels stay independent and repeated firing remains finite',()=>{
  const found=sources[1],active=createFirstPersonViewmodel(found,{fireDocument}),idle=createFirstPersonViewmodel(found,{fireDocument});
  const initial=idle.snapshot().muzzles;
  for(let i=0;i<40;i++) {
    if(i%4===0)active.fire();
    active.update(.025,{alive:true,sprinting:i%9===0});
    active.root.traverse(n=>{assert.ok([...n.position.toArray(),...n.quaternion.toArray(),...n.scale.toArray()].every(Number.isFinite));});
    const muzzles=active.snapshot().muzzles;for(const m of muzzles)closeVector(m,muzzles[0]);
  }
  assert.equal(active.snapshot().shots,10);assert.equal(idle.snapshot().shots,0);
  idle.snapshot().muzzles.forEach((m,i)=>closeVector(m,initial[i]));
  assert.throws(()=>active.update(NaN),RangeError);assert.throws(()=>active.update(-1),RangeError);
});

test('pose-only fallback and invalid source data are explicit',()=>{
  const view=createFirstPersonViewmodel(sources[0]);assert.equal(view.fire(),false);
  view.update(.1,{sprinting:true,alive:true});assert.equal(view.snapshot().pose,'sprint');
  assert.throws(()=>createFirstPersonViewmodel(sources[0],{fireDocument,weaponId:'rebel-a280'}),/disagree/);
  const broken=structuredClone(fireDocument);broken.weapons[0].clips[0].tracks[0].values[0]=[0,0,0,0];
  assert.throws(()=>createFirstPersonViewmodel(sources[0],{fireDocument:broken}),/Zero firing quaternion/);
});

test('source aim blends through shared bindings, keeps additive firing and resets on death',()=>{
  for(const found of sources) {
    const view=createFirstPersonViewmodel(found,{fireDocument,aimDocument});
    const root=sourceBone(view.root,'Wep_Root'),idlePosition=root.position.clone(),idleRotation=root.quaternion.clone();
    const bindings=view.snapshot().mixerBindings;
    view.update(0,{aiming:true,aimWeight:1});
    const aimPosition=root.position.clone(),aimRotation=root.quaternion.clone();
    assert.equal(view.snapshot().aim.weight,1);assert.equal(view.snapshot().aim.missing.length,0);
    assert.ok(Math.abs(view.snapshot().muzzles[0][0])<1e-6,'original aim muzzle reaches source centerline');
    assert.ok(aimPosition.distanceTo(idlePosition)>.01);
    view.update(0,{aiming:true,aimWeight:.4,sprinting:true});
    assert.equal(view.snapshot().pose,'idle','aim exits sprint');
    closeVector(root.position.toArray(),idlePosition.clone().lerp(aimPosition,.4).toArray());
    assert.ok(root.quaternion.clone().normalize().angleTo(idleRotation.clone().normalize().slerp(aimRotation.clone().normalize(),.4))<2e-6);
    view.update(0,{aiming:false,aimWeight:.2});
    closeVector(root.position.toArray(),idlePosition.clone().lerp(aimPosition,.2).toArray());
    view.update(0,{aiming:true,aimWeight:1});
    const clip=fireDocument.weapons.find(w=>w.weaponId===found.descriptor.weaponId).clips[0];
    const index=3,dt=clip.sourceKeyTimes[index]/clip.sourceTiming.fps*clip.sourceTiming.timeScale;
    view.fire();view.update(dt,{aiming:true,aimWeight:1});
    const delta=clip.tracks.find(t=>t.bone==='Wep_Root'&&t.property==='translation').values[index];
    closeVector(root.position.toArray(),aimPosition.clone().add(new Vector3().fromArray(delta)).toArray());
    assert.equal(view.snapshot().mixerBindings,bindings);
    view.update(0,{alive:false,aiming:true,aimWeight:1});
    assert.equal(view.snapshot().aim.weight,0);assert.equal(view.snapshot().firing,false);
    view.update(0,{alive:true});
    closeVector(root.position.toArray(),idlePosition.toArray());
    assert.throws(()=>view.update(0,{aimWeight:NaN}),RangeError);
    assert.throws(()=>view.update(0,{aimWeight:1.1}),RangeError);
  }
});
