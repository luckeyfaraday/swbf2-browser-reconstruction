import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {movementCameraRuntimeDocument} from '../../tools/gameplay-recovery/build-movement-camera.mjs';

const workspace=new URL('../../',import.meta.url);
const report=JSON.parse(fs.readFileSync(new URL('tools/gameplay-recovery/movement-camera-evidence.json',workspace)));
const runtime=JSON.parse(fs.readFileSync(new URL('../public/assets/movement-camera.json',import.meta.url)));
const pointer=(v,p)=>p.slice(1).split('/').reduce((value,key)=>value[key.replaceAll('~1','/').replaceAll('~0','~')],v);
const sources=new Map();
function sourceDocument(source) {
  if(!sources.has(source.file)) {
    const bytes=fs.readFileSync(new URL(source.file,workspace)),document=JSON.parse(bytes);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),source.jsonSha256);
    assert.equal(document.entry.guid,source.guid);assert.equal(document.entry.sha1,source.sha1);
    sources.set(source.file,document);
  }
  return sources.get(source.file);
}

test('movement and camera mappings resolve to original fields including the gravity sign conversion',()=>{
  const names=Object.entries(runtime.parameters).flatMap(([section,values])=>Object.keys(values).map(key=>`${section}.${key}`));
  assert.deepEqual(names.sort(),report.mappings.map(m=>m.parameter).sort());
  for(const mapping of report.mappings) {
    const source=sourceDocument(mapping.source),raw=pointer(source,mapping.jsonPointer);
    assert.equal(raw,mapping.sourceValue);
    assert.equal(mapping.value,mapping.conversion==='negate'?-raw:raw);
    assert.equal(pointer(runtime.parameters,`/${mapping.parameter.replace('.','/')}`),mapping.value);
    assert.equal(mapping.runtimeObserved,false);
  }
  for(const item of [...report.observations,...report.referenceChain,...report.structuralReachability.flatMap(path=>path.route)]) {
    assert.deepEqual(pointer(sourceDocument(item.source),item.jsonPointer),item.value);
  }
});

test('Assault selector 47 reaches its movement, pose, jump and fall controllers',()=>{
  assert.equal(runtime.selection.characterSelectorIndex,47);
  const index=report.observations.find(item=>item.label==='assaultCharacterSelectorIndex');
  assert.equal(index.value,47);
  const publicKit=report.observations.find(item=>item.label==='kitPublicCharacterChannel').value;
  const publicState=report.observations.find(item=>item.label==='statePublicCharacterChannel').value;
  assert.equal(publicKit.$external,publicState.$external);assert.equal(publicKit.classGuid,publicState.classGuid);
  for(const key of ['ground','pose','jump','fall']) {
    const selected=runtime.configuration[`${key}Controller`];
    const edge=report.referenceChain.find(item=>item.objectId===selected.selectorObjectId&&item.jsonPointer.endsWith('/Subjects/47'));
    assert.equal(edge.value.$ref,selected.objectId);
    const route=report.structuralReachability.find(item=>item.target===selected.objectId);
    assert.ok(route.route.length>0);
    assert.ok(route.route.some(item=>item.jsonPointer.endsWith('/Subjects/47')));
    assert.ok(route.route.every(item=>!item.jsonPointer.includes('AllControllerDatas')));
  }
  assert.equal(report.observations.find(item=>item.label==='useGameDefinedStateMachine').value,true);
});

test('conflicting native speed inputs and unresolved camera conventions are not promoted to runtime overrides',()=>{
  assert.equal(runtime.configuration.drive.Velocity,5);
  assert.equal(runtime.configuration.pose.stand.Velocity,3.8);
  assert.equal(runtime.configuration.pose.crouch.Velocity,2.3);
  assert.equal(runtime.configuration.camera.hip.FieldOfView,55);
  assert.equal(runtime.configuration.camera.aim.FieldOfView,23.9);
  assert.equal(runtime.configuration.camera.StandPose.MaximumPitch,85);
  assert.equal(runtime.configuration.camera.StandPose.MinimumPitch,-70);
  for(const key of ['moveSpeed','sprintSpeed','crouchSpeed','groundAcceleration','airAcceleration','crouchHeight'])assert.equal(runtime.parameters.player[key],undefined);
  for(const key of ['fov','aimFov','pitchLimits','distance'])assert.equal(runtime.parameters.camera[key],undefined);
  assert.ok(runtime.provenance.unresolved.some(item=>item.parameters.includes('player.moveSpeed')));
  assert.ok(runtime.provenance.unresolved.some(item=>item.parameters.includes('camera.pitchLimits')));
  assert.equal(runtime.provenance.runtimeObserved,false);
});

test('the browser movement document is reproduced from the retained report with inference labels intact',()=>{
  assert.deepEqual(runtime,movementCameraRuntimeDocument(report));
  assert.equal(runtime.selection.kit.guid,'b2b1aca5-cd79-4733-ab97-8073671d211b');
  assert.equal(runtime.selection.weapon.guid,'68f9d096-0221-11e6-ba00-c572adcfb1b9');
  assert.ok(runtime.provenance.inferences.some(text=>text.includes('Pencil')));
  assert.equal(runtime.parameters.player.jumpVelocity,5);
  assert.equal(runtime.parameters.player.aimMoveMultiplier,.6);
  assert.equal(runtime.parameters.camera.aimLookMultiplier,.2738);
});
