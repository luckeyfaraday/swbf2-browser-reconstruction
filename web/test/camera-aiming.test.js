import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {createCameraRecoil,consumeNativeRecoil,consumeBrowserRecoil,nativeRecoilCameraQuaternion} from '../src/camera-recoil.js';

const bytes=file=>fs.readFileSync(new URL(file,import.meta.url));
const read=file=>JSON.parse(bytes(file));
const sha=data=>createHash('sha256').update(data).digest('hex');
const document=read('../public/assets/camera-aiming.json');
const evidence=read(`../../${document.provenance.evidenceFile}`);
const recoilDocument=read('../public/assets/camera-recoil.json');
const close=(a,b,tolerance=1e-11)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
const closeArray=(a,b)=>a.forEach((v,i)=>close(v,b[i]));

test('native aiming boundary retains exact PE fields, dispatch, source overrides and complete critical spans',()=>{
  assert.equal(evidence.runtimeObserved,false);
  assert.equal(sha(bytes(`../../${document.provenance.evidenceFile}`)),document.provenance.evidenceSha256);
  assert.equal(evidence.functions.length,21);
  const fd=fs.openSync(evidence.target,'r');
  try{
    for(const row of [...evidence.fields.map(r=>r.record),...evidence.pointers.map(r=>r.record),...evidence.functions.map(r=>r.nativeSpan)]){
      const expected=Buffer.from(row.bytes,'hex'),actual=Buffer.alloc(expected.length);
      assert.equal(fs.readSync(fd,actual,0,actual.length,row.fileOffset),actual.length);
      assert.deepEqual(actual,expected,row.address);
    }
  }finally{fs.closeSync(fd);}
  for(const row of evidence.functions)assert.equal(sha(bytes(`../../${row.file}`)),row.sha256,row.entry);
  for(const row of evidence.selectedShots){
    const raw=bytes(`../../${row.source.file}`);assert.equal(sha(raw),row.source.jsonSha256);
    const shot=row.jsonPointer.split('/').slice(1).reduce((v,k)=>v[k],JSON.parse(raw));
    assert.deepEqual(shot,row.value);
    assert.equal(shot.ForceSpawnToCamera,true);assert.equal(shot.ActiveForceSpawnToCamera,true);
    assert.equal(shot.RelativeTargetAiming,false);
  }
  assert.equal(document.projectile.finalRecoilPrecedence,'unresolved');
});

test('native recoil consumption handles partial, full and opposite movement independently on both axes',()=>{
  const input={yaw:.08,pitch:-.12};
  assert.deepEqual(consumeNativeRecoil(input,{yaw:.03,pitch:-.02}),{
    remaining:{yaw:.05,pitch:-.09999999999999999},compensation:{yaw:.03,pitch:-.02},baseMovement:{yaw:0,pitch:0},
  });
  const full=consumeNativeRecoil(input,{yaw:.1,pitch:-.2});
  closeArray(Object.values(full.remaining),[0,0]);closeArray(Object.values(full.compensation),[.08,-.12]);
  closeArray(Object.values(full.baseMovement),[.02,-.08]);
  const opposite=consumeNativeRecoil(input,{yaw:-.03,pitch:.02});
  assert.deepEqual(opposite.remaining,input);assert.deepEqual(opposite.compensation,{yaw:0,pitch:0});
  assert.deepEqual(opposite.baseMovement,{yaw:-.03,pitch:.02});
  assert.deepEqual(input,{yaw:.08,pitch:-.12},'caller state stays immutable');
});

test('yaw wrap does not consume recoil in the opposite physical direction at the zero boundary',()=>{
  const crossed=consumeNativeRecoil({yaw:.2,pitch:0},{yaw:-2*Math.PI+.05,pitch:0});
  close(crossed.compensation.yaw,.05);close(crossed.remaining.yaw,.15);close(crossed.baseMovement.yaw,0);
  const opposite=consumeNativeRecoil({yaw:.2,pitch:0},{yaw:2*Math.PI-.05,pitch:0});
  close(opposite.compensation.yaw,0);close(opposite.baseMovement.yaw,-.05);
  assert.throws(()=>consumeNativeRecoil({yaw:0,pitch:NaN},{yaw:0,pitch:0}),/finite/);
});

// Literal native 14165ab30 column vectors, independent of the quaternion helper.
function sourceRotation({yaw,pitch}){
  const sy=Math.sin(yaw),cy=Math.cos(yaw),sp=Math.sin(pitch),cp=Math.cos(pitch);
  return new THREE.Matrix4().set(cy,0,sy,0,sp*sy,cp,-sp*cy,0,-cp*sy,sp,cp*cy,0,0,0,0,1);
}

test('local quaternion matches native matrix composition and its explicit camera basis flip',()=>{
  const flip=new THREE.Matrix4().makeScale(-1,1,-1);
  for(const native of [{yaw:.08,pitch:-.12},{yaw:-.04,pitch:-.2},{yaw:.13,pitch:.07},{yaw:0,pitch:0}]){
    const q=new THREE.Quaternion().fromArray(nativeRecoilCameraQuaternion(native));close(q.length(),1);
    const expected=flip.clone().multiply(sourceRotation(native)).multiply(flip);
    closeArray(new THREE.Matrix4().makeRotationFromQuaternion(q).elements,expected.elements);
    for(const base of [new THREE.Euler(.3,.8,0,'YXZ'),new THREE.Euler(-.8,-2.9,0,'YXZ')]){
      const cameraBase=new THREE.Matrix4().makeRotationFromEuler(base);
      const nativeBase=cameraBase.clone().multiply(flip);
      const nativeView=nativeBase.multiply(sourceRotation(native)).multiply(flip);
      const browserView=cameraBase.clone().multiply(new THREE.Matrix4().makeRotationFromQuaternion(q));
      closeArray(browserView.elements,nativeView.elements);
      closeArray(new THREE.Vector3(0,0,-1).transformDirection(browserView).toArray(),
        new THREE.Vector3(0,0,-1).transformDirection(nativeView).toArray());
    }
  }
  const raised=new THREE.Vector3(0,0,-1).applyQuaternion(new THREE.Quaternion().fromArray(nativeRecoilCameraQuaternion({yaw:0,pitch:-.1})));
  assert.ok(raised.y>0);
  const positiveYaw=new THREE.Vector3(0,0,-1).applyQuaternion(new THREE.Quaternion().fromArray(nativeRecoilCameraQuaternion({yaw:.1,pitch:0})));
  assert.ok(positiveYaw.x<0,'recovered right/forward flip preserves positive local camera yaw');
});

test('browser input compensation consumes downward correction but preserves excess movement',()=>{
  const down=consumeBrowserRecoil({yaw:.01,pitch:-.03},{yaw:-.004,pitch:-.01});
  closeArray(Object.values(down.compensation),[.004,-.01]);
  closeArray(Object.values(down.baseMovement),[0,0]);
  const beyond=consumeBrowserRecoil({yaw:.01,pitch:-.03},{yaw:-.02,pitch:-.05});
  closeArray(Object.values(beyond.baseMovement),[-.01,-.02]);
  const away=consumeBrowserRecoil({yaw:.01,pitch:-.03},{yaw:.02,pitch:.05});
  closeArray(Object.values(away.compensation),[0,0]);
  closeArray(Object.values(away.baseMovement),[.02,.05]);
});

test('selected source spring and raw target remain distinct and feedback uses consumed recoil only',()=>{
  for(const id of ['primary','rebel-a280']){
    const baseline=createCameraRecoil(recoilDocument,id,{random:()=>.5});
    const corrected=createCameraRecoil(recoilDocument,id,{random:()=>.5});
    baseline.fire();corrected.fire();baseline.update(1/60);const initial=corrected.update(1/60);
    const raw=new THREE.Quaternion().fromArray(nativeRecoilCameraQuaternion(initial.targetRadians));
    const camera=new THREE.Quaternion().fromArray(initial.cameraLocalQuaternion);
    close(raw.angleTo(camera),.7*Math.PI/180*2/3,1e-10);
    const consumed=consumeBrowserRecoil(initial.nativeRadians,{yaw:0,pitch:-.001});
    close(consumed.compensation.pitch,-.001);close(consumed.baseMovement.pitch,0);
    const next=corrected.update(1/60,{recoilCompensation:consumed.compensation});
    const plain=baseline.update(1/60);
    close(next.targetRadians.pitch-plain.targetRadians.pitch,.001);
    assert.ok(next.nativeRadians.pitch>plain.nativeRadians.pitch);
    closeArray(next.cameraLocalQuaternion,nativeRecoilCameraQuaternion(next.nativeRadians));
    assert.ok(next.cameraLocalQuaternion.every(Number.isFinite));
  }
});
