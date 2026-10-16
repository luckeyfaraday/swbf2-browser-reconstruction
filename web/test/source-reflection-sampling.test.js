import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {createSourceDfgTexture} from '../src/source-dfg.js';
import {injectSourceEnvironmentSpecular} from '../src/source-environment-specular.js';
import {nativeReflectionMipmapBias, nativeReflectionMipRoughness, sourceReflectionDirection, sourceReflectionLod,
  sourceBoxReflectionProjection, createSourceReflectionMipCube, prepareSourceReflectionSampling,
  injectSourceReflectionSampling} from '../src/source-reflection-sampling.js';

const root = new URL('../../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root));
const document = JSON.parse(read('web/public/assets/source-reflections.json'));
const validation = JSON.parse(read('exports/lighting/dfg-reflection-shaders/equation-validation.json'));
const buffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const payloadBytes = payload => read(`web/public${payload.url}`);
const payloadFor = volume => document.payloads.find(payload => payload.id === volume.payloadId);
const six = document.volumes.filter(volume => payloadFor(volume).mipCount === 6);
const one = document.volumes.find(volume => payloadFor(volume).mipCount === 1);
const fetchOriginal = async url => ({ok: true, arrayBuffer: async () => buffer(read(`web/public${url}`))});
const near = (actual, expected) => actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-12));

test('native sampling evidence checks 1000 source instruction cases and all six cube orientations', () => {
  assert.equal(validation.cases, 1000);
  assert.ok(validation.maximumAbsoluteError < 1e-11);
  assert.equal(validation.faceCases, 96);
  assert.equal(validation.faceMaximumAbsoluteError, 0);
  assert.equal(nativeReflectionMipmapBias(128), 32);
  assert.equal(nativeReflectionMipmapBias(256), 64);
  assert.equal(sourceReflectionLod(1, 128, 5), 5);
  assert.equal(sourceReflectionLod(1, 128, 0), 0);
  assert.ok(Math.abs(sourceReflectionLod(.25, 128) - Math.log2(9)) < 1e-12);
});

test('native filter roughness table and shader LOD are exact inverse mappings at normal incidence', () => {
  const native = JSON.parse(read('exports/lighting/dfg-reflection-shaders/native-executable.json'));
  assert.equal(native.powfThunk.name, 'powf');
  assert.equal(native.programHash, '0x455c9474');
  for (const row of native.source128MipLevels) {
    const roughness = nativeReflectionMipRoughness(row.mip, 6);
    assert.equal(roughness, row.perceptualRoughness);
    const cone = sourceReflectionDirection([0,1,0],[0,1,0],roughness).angularRoughness;
    assert.ok(Math.abs(sourceReflectionLod(cone,128,5)-row.mip) < 1e-12);
  }
  assert.throws(() => nativeReflectionMipRoughness(6,6), /Invalid/);
});

test('dominant direction and view-dependent cone preserve smooth and rough endpoints', () => {
  const normal = [0, 1, 0], view = [.6, .8, 0];
  near(sourceReflectionDirection(normal, view, 0).direction, [-.6, .8, 0]);
  near(sourceReflectionDirection(normal, view, 1).direction, normal);
  assert.equal(sourceReflectionDirection(normal, view, 0).angularRoughness, 0);
  assert.equal(sourceReflectionDirection(normal, view, 1).angularRoughness, 1);
  assert.equal(sourceReflectionDirection(normal, [1, 0, 0], .5).angularRoughness, .125);
  assert.equal(sourceReflectionDirection(normal, normal, .5).angularRoughness, .25);
});

test('box helper takes explicit native local fields and blends projection out at roughness one', () => {
  const sharp = sourceBoxReflectionProjection([1,0,0], [0,0,1], [2,2,2], [0,0,0], 0, .25);
  near(sharp.direction, [1,0,2]);
  assert.equal(sharp.exitDistance, 2);
  assert.ok(Math.abs(sharp.angularRoughness - .5 / Math.sqrt(5)) < 1e-12);
  const rough = sourceBoxReflectionProjection([1,0,0], [0,0,1], [2,2,2], [0,0,0], 1, 1);
  near(rough.direction, [0,0,1]); assert.equal(rough.angularRoughness, 1);
  const skip = sourceBoxReflectionProjection([1,0,0], [0,0,1], [2,2,2], [0,0,0], .4, .12, 1);
  near(skip.direction, [0,0,1]); assert.equal(skip.angularRoughness, .12);
  assert.equal(sourceBoxReflectionProjection([3,0,0], [0,0,1], [2,2,2], [0,0,0], 0, .1), null);
});

test('native cube uploader preserves every byte and six original mips without duplicating mip zero', () => {
  const payload = payloadFor(six[0]), raw = payloadBytes(payload), owned = buffer(raw);
  const cube = createSourceReflectionMipCube(payload, owned);
  assert.equal(cube.mipmaps.length, 5);
  assert.equal(cube.type, THREE.HalfFloatType);
  assert.equal(cube.colorSpace, THREE.LinearSRGBColorSpace);
  assert.equal(cube.minFilter, THREE.LinearMipmapLinearFilter);
  assert.equal(cube.generateMipmaps, false); assert.equal(cube.flipY, false);
  for (const slice of payload.subresources) {
    const face = slice.mip === 0 ? cube.images[slice.face] : cube.mipmaps[slice.mip - 1].image[slice.face];
    assert.ok(face.isDataTexture);
    assert.equal(face.image.width, slice.width); assert.equal(face.image.height, slice.height);
    assert.equal(face.image.data.buffer, owned);
    assert.equal(face.image.data.byteOffset, slice.offset);
    assert.deepEqual(Buffer.from(face.image.data.buffer, face.image.data.byteOffset, face.image.data.byteLength), raw.subarray(slice.offset, slice.offset + slice.bytes));
  }
  assert.equal(cube.userData.sourceReflection.uploadedMipCount, 6);
  assert.equal(cube.userData.sourceReflection.orientationIsInferred, false);
  cube.dispose();
});

test('single-mip capture gets generated mips and samples through the native permutation', async () => {
  const payload = payloadFor(one), raw = payloadBytes(payload);
  const cube = createSourceReflectionMipCube(payload, buffer(raw));
  assert.equal(cube.mipmaps.length, 0);
  assert.equal(cube.generateMipmaps, true);
  assert.equal(cube.minFilter, THREE.LinearMipmapLinearFilter);
  assert.equal(cube.userData.sourceReflection.uploadedMipCount, 1);
  assert.equal(cube.userData.sourceReflection.generatedMips, true);
  const sampler = await prepareSourceReflectionSampling(document, {fetch: fetchOriginal});
  await sampler.select(one.id);
  assert.equal(sampler.snapshot().ready, true);
  assert.equal(sampler.snapshot().shaderMode, 'native');
  assert.equal(sampler.snapshot().uploadedMipCount, 1);
  assert.equal(sampler.uniforms.bf2_nativeReflectionMaxLod.value, Math.log2(payload.width / 4));
  sampler.dispose(); cube.dispose();
});

test('two-cube cache reuses source payloads, evicts least recently used and shares shader uniforms', async () => {
  const sampler = await prepareSourceReflectionSampling(document, {fetch: fetchOriginal, cacheSize: 2});
  const a = await sampler.select(six[0].id), b = await sampler.select(six[1].id);
  let evicted = 0; b.addEventListener('dispose', () => evicted++);
  assert.equal(await sampler.select(six[0].id), a);
  await sampler.select(six[2].id);
  assert.equal(evicted, 1);
  assert.equal(sampler.snapshot().cachedPayloads, 2);
  assert.equal(sampler.snapshot().downloads, 3);
  assert.equal(sampler.snapshot().sourceBytes, 2 * 1048320);
  assert.equal(sampler.uniforms.bf2_nativeReflectionMipBias.value, 32);
  assert.equal(sampler.snapshot().ready, true);
  await sampler.select(null);
  assert.equal(sampler.snapshot().ready, false);
  assert.equal(sampler.snapshot().selectedVolume, null);
  sampler.dispose(); sampler.dispose();
  assert.equal(sampler.snapshot().cachedPayloads, 0);
  await assert.rejects(sampler.select(six[0].id), /disposed/);
});

test('stale downloads cannot replace a newer selection or reanimate a disposed cache', async () => {
  const releases = [], signals = [];
  const sampler = await prepareSourceReflectionSampling(document, {fetch: async (url, options) => {
    signals.push(options.signal);
    return new Promise(resolve => releases.push(() => resolve({ok: true, arrayBuffer: async () => buffer(read(`web/public${url}`))})));
  }});
  const first = sampler.select(six[0].id), duplicate = sampler.select(six[0].id);
  assert.equal(first, duplicate);
  const second = sampler.select(six[1].id);
  assert.equal(signals[0].aborted, true);
  releases[1](); await second;
  releases[0](); assert.equal(await first, null);
  assert.equal(sampler.snapshot().selectedVolume, six[1].id);
  assert.equal(sampler.snapshot().cachedPayloads, 1);
  const third = sampler.select(six[2].id); sampler.dispose();
  releases[2](); assert.equal(await third, null);
  assert.equal(sampler.snapshot().cachedPayloads, 0);
});

test('shader hook composes with native DFG and only replaces radiance while raw cube is ready', async () => {
  const sampler = await prepareSourceReflectionSampling(document, {fetch: fetchOriginal});
  await sampler.select(six[0].id);
  const dfgDoc = JSON.parse(read('web/public/assets/source-dfg.json'));
  const dfg = createSourceDfgTexture(dfgDoc, buffer(read('web/public/assets/source-dfg.rgba16f.bin')));
  const shader = {uniforms: {}, fragmentShader: THREE.ShaderLib.standard.fragmentShader};
  injectSourceEnvironmentSpecular(shader, {texture: dfg});
  injectSourceReflectionSampling(shader, sampler);
  assert.equal(shader.uniforms.bf2_nativeReflectionCube, sampler.uniforms.bf2_nativeReflectionCube);
  assert.ok(shader.fragmentShader.includes('if (bf2_nativeReflectionReady > 0.5)'));
  assert.ok(shader.fragmentShader.includes('textureCubeLodEXT(bf2_nativeReflectionCube'));
  assert.ok(shader.fragmentShader.includes('radiance * bf2_sourceEnvironmentResponse('));
  assert.ok(shader.fragmentShader.includes('#include <lights_fragment_maps>'));
  assert.ok(shader.fragmentShader.startsWith('#undef USE_ENVMAP'));
  assert.throws(() => injectSourceReflectionSampling(shader, sampler), /already patched/);
  sampler.dispose(); dfg.dispose();
});

test('replacement loads preserve the entire active tuple, including its direction basis on failure', async () => {
  let fail=false;
  const releases=[];
  const sampler=await prepareSourceReflectionSampling(document,{fetch:async(url)=>{
    if(url===payloadFor(six[0]).url)return fetchOriginal(url);
    return new Promise(resolve=>releases.push(()=>resolve(fail?{ok:false,status:500}:{ok:true,arrayBuffer:async()=>buffer(read(`web/public${url}`))})));
  }});
  const firstBasis=new THREE.Matrix3().set(0,0,1,0,1,0,-1,0,0);
  const nextBasis=new THREE.Matrix3().set(-1,0,0,0,1,0,0,0,-1);
  const first=await sampler.select(six[0].id,firstBasis);
  const pending=sampler.select(six[1].id,nextBasis);
  assert.equal(sampler.uniforms.bf2_nativeReflectionCube.value,first);
  assert.equal(sampler.uniforms.bf2_nativeReflectionReady.value,1);
  assert.deepEqual(sampler.uniforms.bf2_nativeReflectionDirectionMatrix.value.elements,firstBasis.elements);
  assert.equal(sampler.snapshot().retainingActiveWhilePending,true);
  nextBasis.identity(); // caller mutation must not alter the pending snapshot
  releases.shift()();await pending;
  assert.deepEqual(sampler.uniforms.bf2_nativeReflectionDirectionMatrix.value.elements,[-1,0,0,0,1,0,0,0,-1]);
  const active=sampler.uniforms.bf2_nativeReflectionCube.value;
  const priorMatrix=sampler.uniforms.bf2_nativeReflectionDirectionMatrix.value.clone();
  fail=true;
  const failing=sampler.select(six[2].id,new THREE.Matrix3());releases.shift()();
  await assert.rejects(failing,/HTTP 500/);
  assert.equal(sampler.uniforms.bf2_nativeReflectionCube.value,active);
  assert.equal(sampler.uniforms.bf2_nativeReflectionReady.value,1);
  assert.deepEqual(sampler.uniforms.bf2_nativeReflectionDirectionMatrix.value.elements,priorMatrix.elements);
  assert.equal(sampler.snapshot().selectedVolume,six[1].id);
  assert.equal(sampler.shaderMode,'native');
  sampler.dispose();
});

test('coverage changes never switch shader permutations; coverage is a uniform', async () => {
  // Switching permutations recompiles every decorated material and freezes the page.
  const sampler=await prepareSourceReflectionSampling(document,{fetch:fetchOriginal});
  const modes=[];const unsubscribe=sampler.subscribeModeChange(mode=>modes.push(mode));
  const decorated=()=>{const shader={uniforms:{},fragmentShader:THREE.ShaderLib.standard.fragmentShader};injectSourceReflectionSampling(shader,sampler);return shader.fragmentShader;};
  assert.equal(sampler.shaderMode,'native');
  const native=decorated();
  assert.match(native,/#undef USE_ENVMAP/);
  assert.match(native,/uniform samplerCube bf2_nativeReflectionCube;/);
  for(const id of [six[0].id,six[1].id,one.id,null,six[0].id]) {
    await sampler.select(id);
    assert.equal(sampler.shaderMode,'native');
    assert.equal(decorated(),native);
    assert.equal(sampler.uniforms.bf2_nativeReflectionReady.value,id===null?0:1);
  }
  assert.deepEqual(modes,[]);
  unsubscribe();sampler.dispose();
});

test('bad responses and native payloads leave the fallback enabled', async () => {
  const sampler = await prepareSourceReflectionSampling(document, {fetch: async () => ({ok: false, status: 404})});
  await assert.rejects(sampler.select(six[0].id), /HTTP 404/);
  assert.equal(sampler.snapshot().ready, false);
  assert.equal(sampler.snapshot().cachedPayloads, 0);
  await assert.rejects(sampler.select('unknown'), /Unknown/);
  const payload = payloadFor(six[0]), raw = payloadBytes(payload);
  assert.throws(() => createSourceReflectionMipCube(payload, buffer(raw.subarray(2))), /Invalid/);
  sampler.dispose();
});
