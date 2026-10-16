import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {prepareNativeGrading,createNativeGradingPass} from '../src/source-colorgrading-renderer.js';
const root=new URL('../../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root));
const doc=JSON.parse(read('web/public/assets/lighting/indoor-colorgrading.json'));
const buffer=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
const fetch=async url=>({ok:true,arrayBuffer:async()=>buffer(read('web/public'+url))});
const hash=b=>createHash('sha256').update(b).digest('hex');

test('published indoor grade preserves every original compute output channel and native half lookup byte',async()=>{
  const original=read('exports/lighting/native-colorcube-warp-sdr/half.rgb10a2.bin');
  const bytes=read('web/public'+doc.cube.url),floats=new Float32Array(buffer(bytes));
  assert.equal(hash(original),doc.computation.packedResultSha256);
  assert.equal(hash(bytes),doc.cube.sha256);
  for(let i=0;i<33**3;i++){
    const packed=original.readUInt32LE(i*4);
    for(let c=0;c<3;c++)assert.equal(floats[i*4+c],Math.fround(((packed>>>(10*c))&1023)/1023));
    assert.equal(floats[i*4+3],(packed>>>30)/3);
  }
  assert.equal(hash(read('web/public'+doc.pq.url)),hash(read('exports/lighting/native-colorgrading/pq-to-linear.r16f.bin')));
  assert.equal(doc.validation.packedVsFloatWarp,'bit-identical');
  const grading=await prepareNativeGrading(doc,{fetch});
  assert.equal(grading.snapshot().bytes,577040);
  for(const t of [grading.textures.cube,grading.textures.pq]){
    assert.equal(t.minFilter,THREE.LinearFilter);assert.equal(t.magFilter,THREE.LinearFilter);
    assert.equal(t.wrapS,THREE.ClampToEdgeWrapping);assert.equal(t.wrapT,THREE.ClampToEdgeWrapping);
    assert.equal(t.colorSpace,THREE.NoColorSpace);assert.equal(t.generateMipmaps,false);
  }
  assert.equal(grading.snapshot().renderPlane.format,'R10G10B10A2_UNORM');
  assert.equal(grading.snapshot().renderPlane.quantizationApplied,true);
  const environment=JSON.parse(read('web/public/assets/source-environment.json'));
  const pass=createNativeGradingPass(grading.textures,{quantizePlane:grading.quantizePlane,vignette:environment.vignette});
  assert.equal(pass.material.uniforms.gradingCube.value===grading.textures.cube,true);
  assert.equal(pass.material.uniforms.pqToLinear.value===grading.textures.pq,true);
  assert.equal(pass.material.toneMapped,false);assert.equal(pass.material.uniforms.stage.value,2);
  assert.equal(pass.material.uniforms.quantizePlane.value,true);
  assert.equal(pass.material.uniforms.vignetteEnabled.value,true);
  assert.deepEqual(pass.material.uniforms.vignetteParams.value.toArray(),[2,2,1]);
  assert.deepEqual(pass.material.uniforms.vignetteColor.value.toArray(),[0,0,0,.46]);
  pass.dispose();grading.dispose();
});

test('grading rejects changed native baseline and corrupted payload before texture allocation',async()=>{
  await assert.rejects(()=>prepareNativeGrading({...doc,baseline:{...doc.baseline,outputConversion:0}},{fetch}),/baseline/);
  await assert.rejects(()=>prepareNativeGrading({...doc,renderPlane:{...doc.renderPlane,nativeFormat:18}},{fetch}),/render plane/);
  await assert.rejects(()=>prepareNativeGrading(doc,{fetch:async()=>({ok:false,status:404})}),/HTTP 404/);
  await assert.rejects(()=>prepareNativeGrading(doc,{fetch:async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(4)})}),/size mismatch/);
  await assert.rejects(()=>prepareNativeGrading(doc,{fetch:async url=>{
    const response=await fetch(url),bytes=new Uint8Array(await response.arrayBuffer());bytes[0]^=1;
    return {ok:true,arrayBuffer:async()=>bytes.buffer};
  }}),/hash mismatch/);
});
