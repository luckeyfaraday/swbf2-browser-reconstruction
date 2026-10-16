import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import {createWeaponSpread,resolveNativeDispersion,sampleNativeSpread} from '../src/weapon-handling.js';

const root=new URL('../../',import.meta.url);
const read=name=>JSON.parse(fs.readFileSync(new URL(name,root),'utf8'));
const document=read('web/public/assets/weapon-handling.json');
const near=(actual,expected,epsilon=1e-10)=>assert.ok(Math.abs(actual-expected)<=epsilon,`${actual} != ${expected}`);

test('native equations bind to source field offsets, exact constants, maths thunks and retained functions',()=>{
  const evidence=read('tools/gameplay-recovery/weapon-handling-native-evidence.json');
  const fields=Object.fromEntries(evidence.nativeFields.map(row=>[row.name,row.offset]));
  assert.equal(fields.Dispersion,0x18);assert.equal(fields.Recoil,0x20);
  assert.equal(fields.PowerOfDispersionRandom,0x3e8);
  assert.deepEqual(evidence.mathThunks.map(row=>row.name),['powf','cosf','sinf']);
  assert.equal(evidence.constants.find(row=>row.name==='oneOver180').hex,'610bb63b');
  assert.equal(evidence.constants.find(row=>row.name==='pi').hex,'db0f4940');
  for(const item of evidence.functions) {
    const bytes=fs.readFileSync(new URL(item.file,root));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),item.sha256);
  }
  assert.equal(evidence.runtimeObserved,false);
  assert.equal(evidence.vtable.acceptedShotSlot,3);assert.equal(evidence.vtable.frameUpdateSlot,30);
});

test('native flat arrays supply all24 stance/zoom/action states and motion interpolation',()=>{
  for(const weaponId of ['primary','rebel-a280'])for(const [poseIndex,pose] of ['stand','crouch','prone'].entries())for(const aiming of [false,true])for(const [motionIndex,movement] of ['base','moving','jumping','sprinting'].entries()) {
    const selected=resolveNativeDispersion(document,weaponId,{pose,aiming,movement});
    const index=(poseIndex*2+Number(aiming))*4+motionIndex;
    assert.equal(selected.index,index);
    for(const key of ['MinAngle','MaxAngle','IncreasePerShot','DecreasePerSecond'])near(selected[key],document.configuration.sway.Dispersion[index][key]);
  }
  const half=resolveNativeDispersion(document,'primary',{movement:'moving',movementFraction:.5});
  near(half.MinAngle,.075);near(half.MaxAngle,.7);
  const sprint=resolveNativeDispersion(document,'primary',{movement:'sprinting',movementFraction:.5});
  near(sprint.MinAngle,.275);near(sprint.MaxAngle,1.1);
  assert.equal(resolveNativeDispersion(document,'fixture'),null);
});

test('native polar sampling uses degree scale and source rotation, with a uniform area radial distribution at power.5',()=>{
  const maximum=.7*Math.PI/180;
  let radiusSquaredSum=0;
  for(let i=0;i<2000;i++) {
    const sample=sampleNativeSpread(.7,.5,(i*.6180339887498949)%1,(i+.5)/2000);
    assert.ok(sample.radiusRadians<=maximum);
    radiusSquaredSum+=sample.radiusRadians**2;
    const rotated=new THREE.Vector3(0,0,1).applyMatrix4(new THREE.Matrix4().makeRotationY(sample.yaw)).applyMatrix4(new THREE.Matrix4().makeRotationX(sample.pitch));
    near(rotated.distanceTo(new THREE.Vector3(...sample.localDirection)),0);
    near(new THREE.Vector3(...sample.localDirection).length(),1);
  }
  near(radiusSquaredSum/2000,maximum**2/2);
  const quarter=sampleNativeSpread(1,.5,.5,.25);
  near(quarter.pitch,0);near(quarter.yaw,Math.PI/360);
  near(sampleNativeSpread(1,1,.5,.25).yaw,Math.PI/720);
  near(new THREE.Vector3(...sampleNativeSpread(0,.5,.1,.9).localDirection).distanceTo(new THREE.Vector3(0,0,1)),0);
  assert.throws(()=>sampleNativeSpread(1,.5,1.1,0),RangeError);
});

test('accepted shots sample existing dispersion and a later frame advances bloom; source cap and recovery prevent runaway',()=>{
  const spread=createWeaponSpread(document,'primary',{random:()=>.5});
  const first=spread.fire();near(first.dispersionDegrees,.05);
  assert.equal(spread.snapshot().pendingShot,true);
  spread.update(0,{firing:true});assert.equal(spread.snapshot().pendingShot,true,'zero dt does not consume native pulse');
  spread.update(1/60,{firing:true});near(spread.snapshot().dispersionDegrees,.13);
  for(let shot=1;shot<25;shot++){spread.fire();spread.update(.2,{firing:true});}
  near(spread.snapshot().dispersionDegrees,.7);
  spread.update(.2,{firing:false});near(spread.snapshot().dispersionDegrees,.5);
  spread.update(2,{firing:false});near(spread.snapshot().dispersionDegrees,.05);
  assert.equal(spread.snapshot().shots,25);
  spread.reset({aiming:true});assert.equal(spread.snapshot().shots,0);near(spread.snapshot().dispersionDegrees,0);
  assert.equal(spread.snapshot().pendingShot,false);
});

test('source no-fire threshold selects the later recovery rate without applying camera recoil',()=>{
  const fixture=structuredClone(document);
  for(const row of fixture.configuration.sway.Dispersion)Object.assign(row,{IncreasePerShot:.4,DecreasePerSecond:1,NoFireDecreasePerSecond:2,NoFireTimeThreshold:.2});
  const spread=createWeaponSpread(fixture,'rebel-a280',{random:()=>.5});
  spread.fire();spread.update(.1,{firing:true});near(spread.snapshot().dispersionDegrees,.45);
  spread.update(.1,{firing:false});near(spread.snapshot().dispersionDegrees,.35);
  spread.update(.1,{firing:false});near(spread.snapshot().dispersionDegrees,.15);
  const sample=spread.fire();
  assert.deepEqual(Object.keys(sample).sort(),['dispersionDegrees','localDirection','pitch','radiusRadians','yaw'].sort());
  assert.ok(!('recoil' in sample));
});

test('source weapon state is independent, resets cleanly and rejects invalid numeric input',()=>{
  const e11=createWeaponSpread(document,'primary'),a280=createWeaponSpread(document,'rebel-a280');
  e11.fire();e11.update(.2,{firing:true});near(a280.snapshot().dispersionDegrees,.05);
  e11.update(.1,{aiming:true,movement:'moving',movementFraction:.4,firing:true});
  assert.equal(e11.snapshot().sourceArrayIndex,5);
  e11.reset();near(e11.snapshot().dispersionDegrees,.05);
  assert.equal(createWeaponSpread(document,'unknown'),null);
  assert.throws(()=>e11.update(-1),RangeError);
  assert.throws(()=>e11.update(Number.NaN),TypeError);
  assert.throws(()=>resolveNativeDispersion(document,'primary',{movementFraction:2}),RangeError);
  assert.equal(e11.snapshot().provenance.runtimeObserved,false);
});
