import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {createCameraRecoil,resolveCameraRecoil,stepNativeCameraSpring} from '../src/camera-recoil.js';

const bytes=file=>fs.readFileSync(new URL(file,import.meta.url));
const read=file=>JSON.parse(bytes(file));
const sha=value=>createHash('sha256').update(value).digest('hex');
const document=read('../public/assets/camera-recoil.json'),evidence=read(`../../${document.provenance.evidenceFile}`);
const DEGREE=Math.PI/180;
const close=(a,b,tolerance=1e-10)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);

test('camera recoil evidence verifies selected source links, source camera separation and native bytes',()=>{
  assert.equal(evidence.runtimeObserved,false);
  assert.equal(sha(bytes(`../../${document.provenance.evidenceFile}`)),document.provenance.evidenceSha256);
  assert.equal(sha(bytes(`../../${evidence.sourceEvidence.file}`)),evidence.sourceEvidence.sha256);
  const docs=new Map();
  for(const row of [...evidence.observations,...evidence.links]){
    if(!docs.has(row.source.guid)){
      assert.equal(sha(bytes(`../../${row.source.file}`)),row.source.jsonSha256);
      docs.set(row.source.guid,read(`../../${row.source.file}`));
    }
    assert.deepEqual(row.jsonPointer.split('/').slice(1).reduce((v,k)=>v[k],docs.get(row.source.guid)),row.value);
  }
  for(const row of evidence.links)if(row.value.$external){
    const target=docs.get(row.value.$external);
    assert.ok(target.asset.objects.some(o=>o.$id===row.value.classGuid));
  }
  const source=docs.get(document.configuration.source.guid),sway=source.asset.objects.find(o=>o.$type.endsWith('.GunSwayData'));
  for(const [index,record]of document.configuration.recoil.entries())for(const [key,value]of Object.entries(record))assert.equal(sway.Recoil[index][key],value);
  const camera=source.asset.objects.find(o=>o.$id===sway.CameraRecoil.$ref);
  for(const [key,value]of Object.entries(document.configuration.spring))assert.equal(camera[key],value);
  const target=fs.openSync(evidence.target,'r');
  try{
    for(const row of [...evidence.fields.map(r=>r.record),...evidence.pointers.map(r=>r.record),...evidence.constants.map(r=>r.record),
      ...evidence.imports.flatMap(r=>[r.thunk,r.slot,r.hintName]),...evidence.functions.map(r=>r.nativeSpan)]){
      const expected=Buffer.from(row.bytes,'hex'),actual=Buffer.alloc(expected.length);
      assert.equal(fs.readSync(target,actual,0,actual.length,row.fileOffset),actual.length);assert.deepEqual(actual,expected,row.address);
    }
  }finally{fs.closeSync(target);}
  for(const fn of evidence.functions)assert.equal(sha(bytes(`../../${fn.file}`)),fn.sha256,fn.entry);
  const animation=evidence.animationSeparation;
  assert.equal(sha(bytes(`../../${animation.file}`)),animation.sha256);
  const fire=read(`../../${animation.file}`);
  assert.equal(animation.cameraTracks.length,12);
  for(const track of animation.cameraTracks){
    const clip=fire.weapons.find(w=>w.weaponId===track.weaponId).clips.find(c=>c.id===track.clipId);
    const source=clip.tracks.find(t=>t.bone===track.bone&&t.property===track.property);
    for(const value of source.values)assert.deepEqual(value,track.constantValue);
    if(track.property==='rotation')assert.deepEqual(new THREE.Quaternion().fromArray(track.constantValue).normalize().toArray(),[0,0,0,1]);
    else assert.deepEqual(track.constantValue,[0,0,0]);
  }
});

test('native spring uses recovered 30*dt damping and acceleration-before-position ordering',()=>{
  const config=document.configuration.spring;
  // At 1/30, damping=.16, acceleration=3000. First position is .16*3000/900=8/15.
  const tick30=stepNativeCameraSpring({position:0,velocity:0},1,1/30,config);
  close(tick30.velocity,16);close(tick30.position,8/15);
  // At 1/60, sqrt(.16)=.4 and .4*3000/3600=1/3.
  const tick60=stepNativeCameraSpring({position:0,velocity:0},1,1/60,config);
  close(tick60.velocity,20);close(tick60.position,1/3);
  const drag={...config,SpringConstant:0},initial={position:0,velocity:1};
  const once=stepNativeCameraSpring(initial,0,1/30,drag);
  const twice=stepNativeCameraSpring(stepNativeCameraSpring(initial,0,1/60,drag),0,1/60,drag);
  close(once.velocity,.16);close(twice.velocity,.16);
  assert.notEqual(once.position,twice.position,'native integration retains timestep dependence');
  assert.deepEqual(stepNativeCameraSpring(initial,5,0,config),initial);
  assert.throws(()=>stepNativeCameraSpring(initial,0,-1,config));
});

test('accepted shot waits for one nonzero tick and applies separate source spring response',()=>{
  let draws=0;
  const recoil=createCameraRecoil(document,'primary',{random:()=>{draws++;return .5;}});
  assert.equal(recoil.fire(),true);assert.equal(recoil.snapshot().pendingShot,true);
  assert.deepEqual(recoil.update(0).nativeRadians,{yaw:0,pitch:0});assert.equal(draws,0);
  assert.throws(()=>recoil.fire(),'native boolean pulse requires one shot per simulation tick');
  const first=recoil.update(1/60);
  close(first.targetRadians.pitch,-.7*DEGREE);close(first.nativeRadians.pitch,-.7*DEGREE/3);
  close(first.nativeRadians.yaw,0);close(first.presentationRadians.pitch,.7*DEGREE/3);
  assert.equal(first.pendingShot,false);assert.equal(draws,2);assert.equal(first.shots,1);
  const forward=new THREE.Vector3(0,0,-1).applyEuler(new THREE.Euler(first.presentationRadians.pitch,first.presentationRadians.yaw,0,'YXZ'));
  assert.ok(forward.y>0,'declared browser mapping raises the view');
});

test('pose and zoom source arrays select distinct impulses and horizontal bounds',()=>{
  for(const id of ['primary','rebel-a280'])for(const [pose,index]of [['stand',0],['crouch',1],['prone',2]])for(const aiming of [false,true]){
    const recoil=createCameraRecoil(document,id,{random:()=>1}),record=document.configuration.recoil[index*2+Number(aiming)];
    recoil.update(0,{pose,aiming});recoil.fire({isFirstShot:true});const result=recoil.update(1/60);
    close(result.targetRadians.pitch,-record.RecoilAmplitudeIncPerShot*DEGREE);
    close(result.targetRadians.yaw,record.HorizontalRecoilAmplitudeIncPerShotMax*DEGREE);
    assert.equal(result.sourceArrayIndex,index*2+Number(aiming));
  }
  assert.equal(resolveCameraRecoil(document,'fixture'),null);
  assert.equal(resolveCameraRecoil(document,'primary',{sourceGuid:'fixture-guid'}),null);
  assert.equal(createCameraRecoil(document,'fixture'),null);
});

test('recovery increments elapsed before its time-squared decay and never crosses the target origin',()=>{
  const recoil=createCameraRecoil(document,'primary',{random:()=>.5});recoil.fire();recoil.update(1/60);
  const after=recoil.update(.1),rate=document.configuration.nativeConstants.recoveryScale;
  close(after.elapsedSinceShot,.1);close(after.targetRadians.pitch,-.7*DEGREE+.1**2*10*rate*.1);
  const next=recoil.update(.1);close(next.elapsedSinceShot,.2);close(next.targetRadians.pitch,0);
  // The camera spring still carries velocity after its raw target has recovered.
  assert.notEqual(next.nativeRadians.pitch,0);
  for(let i=0;i<180;i++)recoil.update(1/60);
  assert.deepEqual(recoil.snapshot().nativeRadians,{yaw:0,pitch:0});
});

test('sustained source-cadence shots clamp, settle and reset without shared state or animation changes',()=>{
  const before=JSON.stringify(document),active=createCameraRecoil(document,'rebel-a280',{random:()=>1}),idle=createCameraRecoil(document,'rebel-a280');
  for(let tick=0;tick<600;tick++){
    if(tick%6===0)active.fire();
    const state=active.update(1/60,{firing:true,aiming:tick>300});
    assert.ok(Math.abs(state.targetRadians.pitch)<=10*DEGREE+1e-12);
    assert.ok(Math.abs(state.targetRadians.yaw)<=2*DEGREE+1e-12);
    assert.ok([...Object.values(state.nativeRadians),...Object.values(state.springs.pitch),...Object.values(state.springs.yaw)].every(Number.isFinite));
  }
  assert.equal(active.snapshot().shots,100);assert.deepEqual(idle.snapshot().nativeRadians,{yaw:0,pitch:0});
  for(let tick=0;tick<300;tick++)active.update(1/60,{firing:false});
  assert.deepEqual(active.snapshot().nativeRadians,{yaw:0,pitch:0});
  active.fire();active.update(1/60);active.update(0,{alive:false});
  assert.equal(active.fire(),false);assert.deepEqual(active.snapshot().nativeRadians,{yaw:0,pitch:0});
  active.reset();assert.equal(active.snapshot().shots,0);assert.equal(active.snapshot().pendingShot,false);
  assert.equal(JSON.stringify(document),before,'helper must not alter source config or animation assets');
});

test('consumed recoil compensation subtracts before spring and from output with bounded projectile provenance',()=>{
  const recoil=createCameraRecoil(document,'primary',{random:()=>.5});recoil.fire();
  const result=recoil.update(1/60,{aimDelta:{yaw:.002,pitch:-.001}});
  close(result.targetRadians.yaw,-.002);close(result.targetRadians.pitch,-.7*DEGREE+.001);
  close(result.nativeRadians.yaw,-.002/3-.002);
  close(result.nativeRadians.pitch,(-.7*DEGREE+.001)/3+.001);
  assert.match(result.provenance.excluded,/final projectile camera-override precedence/);
  assert.equal(result.provenance.aimingBoundary.evidenceId,'BF2-CAMERA-AIMING-BOUNDARY-001');
});
