import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {resolveSourceCameraFov,sourceFovTarget,nativeFovTransitionWeight,createSourceCameraFov} from '../src/camera-fov.js';

const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const bytes=file=>fs.readFileSync(path.join(workspace,file));
const read=file=>JSON.parse(bytes(file));
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
const config=read('web/public/assets/camera-fov.json'),evidence=read(config.provenance.evidenceFile);
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);

test('source camera FOV evidence retains verified EBX links, native metadata, imports and consumer code',()=>{
  assert.equal(evidence.runtimeObserved,false);
  assert.equal(sha(bytes(config.provenance.evidenceFile)),config.provenance.evidenceSha256);
  const documents=new Map(evidence.sources.map(source=>{assert.equal(sha(bytes(source.file)),source.jsonSha256);return [source.guid,read(source.file)];}));
  for(const row of evidence.observations){
    const actual=row.jsonPointer.split('/').slice(1).reduce((value,key)=>value[key],documents.get(row.sourceGuid));
    assert.deepEqual(actual,row.value);
  }
  for(const link of evidence.links){
    const from=documents.get(link.sourceGuid).asset.objects.find(o=>o.$id===link.objectId);
    const to=documents.get(link.targetSourceGuid).asset.objects.find(o=>o.$id===link.targetObjectId);
    assert.equal(from[link.field].$external,link.targetSourceGuid);assert.equal(from[link.field].classGuid,to.$id);
  }
  for(const fn of evidence.functions)assert.equal(sha(bytes(fn.file)),fn.sha256,fn.entry);
  const descriptor=fs.openSync(evidence.target,'r');
  try {
    const records=[...evidence.fields.map(r=>r.record),...evidence.pointers.map(r=>r.record),...evidence.constants.map(r=>r.record),
      ...evidence.imports.flatMap(r=>[r.thunk,r.slot,r.hintName]),...evidence.functions.map(r=>r.nativeSpan)];
    for(const row of records){const expected=Buffer.from(row.bytes,'hex'),actual=Buffer.alloc(expected.length);
      assert.equal(fs.readSync(descriptor,actual,0,actual.length,row.fileOffset),actual.length);assert.deepEqual(actual,expected,row.address);}
  }finally{fs.closeSync(descriptor);}
});

test('selected gameplay zoom remains separate from the fixed 55-degree weapon render layer',()=>{
  for(const id of ['primary','rebel-a280']){
    const source=resolveSourceCameraFov(config,id);
    assert.equal(source.fov,55);assert.equal(source.aimFov,23.9);assert.equal(source.axis,'vertical');
    assert.deepEqual(source.weaponRenderFov,[55,55]);
    assert.equal(sourceFovTarget(source),55);assert.equal(sourceFovTarget(source,{aiming:true}),23.9);
  }
  assert.equal(resolveSourceCameraFov(config,'fixture'),null);
  assert.equal(resolveSourceCameraFov(config,'primary',{sourceGuid:'fixture-source'}),null);
});

test('vertical FOV preserves vertical camera bounds across aspect ratios while horizontal coverage widens',()=>{
  const source=resolveSourceCameraFov(config,'primary'),widths=[];
  for(const aspect of [4/3,16/9,21/9]){
    const camera=new THREE.PerspectiveCamera(source.fov,aspect,.1,100);
    const top=new THREE.Vector3(0,1,.5).unproject(camera).normalize();
    const bottom=new THREE.Vector3(0,-1,.5).unproject(camera).normalize();
    near(THREE.MathUtils.radToDeg(top.angleTo(bottom)),55);
    const left=new THREE.Vector3(-1,0,.5).unproject(camera).normalize();
    const right=new THREE.Vector3(1,0,.5).unproject(camera).normalize();
    widths.push(left.angleTo(right));
  }
  assert.ok(widths[0]<widths[1]&&widths[1]<widths[2]);
});

test('native Shape2 Smooth curve uses the recovered quarter, midpoint and endpoint weights',()=>{
  for(const [t,weight]of [[-.1,0],[0,0],[.25,.15625],[.5,.5],[.75,.84375],[1,1],[1.1,1]])
    near(nativeFovTransitionWeight(t,config.transition),weight);
});

test('source camera transition samples old elapsed, completes in source duration and reverses continuously',()=>{
  const camera=createSourceCameraFov(config,'primary');
  assert.equal(camera.snapshot().fov,55);
  near(camera.update(.05,{aiming:true}).fov,55);
  near(camera.update(.05).fov,50.140625);
  near(camera.update(.05).fov,39.45);
  near(camera.update(.05).fov,28.759375);
  near(camera.update(.05).fov,23.9);
  camera.reset();camera.update(.05,{aiming:true});camera.update(.05);
  const mid=camera.snapshot().fov;
  near(camera.update(.05,{aiming:false}).fov,mid);
  camera.update(.2);near(camera.update(0).fov,55);
  assert.equal(camera.snapshot().weaponRenderFov,55);
  assert.throws(()=>camera.update(-.1));
});

test('user FOV scaling and its ADS gate use native bounds without altering weapon render FOV',()=>{
  const source=resolveSourceCameraFov(config,'primary');
  near(sourceFovTarget(source,{userScale:.2}),44);
  near(sourceFovTarget(source,{userScale:5}),110);
  near(sourceFovTarget(source,{aiming:true,userScale:.8}),23.9);
  near(sourceFovTarget(source,{aiming:true,userScale:1.5}),35.85);
  near(sourceFovTarget(source,{aiming:true,userScale:1.5,scaleADS:false}),23.9);
  const camera=createSourceCameraFov(config,'primary',{userScale:1.5,initialAiming:true});
  near(camera.snapshot().fov,35.85);near(camera.snapshot().weaponRenderFov,55);
});
