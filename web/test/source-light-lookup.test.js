import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {createSourceDfgTexture, packSourceIesIntoDfg, sampleSourceDfg, SOURCE_DFG_GLSL} from '../src/source-dfg.js';
import {createSourceIesTexture} from '../src/source-ies.js';
import {createSourceDirectAdapter} from '../src/source-direct-adapter.js';

const file = p => new URL(`../public${p}`, import.meta.url);
const read = p => fs.readFileSync(file(p));
const dfgDocument = JSON.parse(read('/assets/source-dfg.json'));
const iesDocument = JSON.parse(read('/assets/lighting/source-ies.json'));
const rawDfg = read(dfgDocument.url), rawIes = read(iesDocument.url);
const arrayBuffer = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const sha = b => createHash('sha256').update(b).digest('hex');
function textures() {
  return {dfg: createSourceDfgTexture(dfgDocument, arrayBuffer(rawDfg)),
    ies: createSourceIesTexture(iesDocument, arrayBuffer(rawIes))};
}

test('packed lookup copies every original DFG RGB and IES half word without mutating either source', () => {
  assert.equal(sha(rawDfg), dfgDocument.sha256);
  assert.equal(sha(rawIes), iesDocument.payloadSha256);
  const {dfg, ies} = textures(), original = dfg.image.data, sourceIes = ies.image.data;
  const beforeDfg = original.slice(), beforeIes = sourceIes.slice();
  assert.equal(packSourceIesIntoDfg(dfg, ies), dfg);
  assert.notEqual(dfg.image.data.buffer, original.buffer);
  assert.notEqual(dfg.image.data.buffer, sourceIes.buffer);
  assert.deepEqual(original, beforeDfg); assert.deepEqual(sourceIes, beforeIes);
  for (let pixel = 0; pixel < 128 * 128; pixel++) {
    for (let channel = 0; channel < 3; channel++) assert.equal(dfg.image.data[pixel * 4 + channel], rawDfg.readUInt16LE((pixel * 4 + channel) * 2));
    assert.equal(dfg.image.data[pixel * 4 + 3], rawIes.readUInt16LE(pixel * 2));
    assert.equal(original[pixel * 4 + 3], 0);
  }
  assert.equal(dfg.wrapS, THREE.RepeatWrapping); assert.equal(dfg.wrapT, THREE.ClampToEdgeWrapping);
  assert.equal(dfg.minFilter, THREE.LinearFilter); assert.equal(dfg.magFilter, THREE.LinearFilter);
  assert.equal(dfg.flipY, false); assert.equal(dfg.generateMipmaps, false); assert.equal(dfg.colorSpace, THREE.NoColorSpace);
  assert.equal(dfg.image.width, 128); assert.equal(dfg.image.height, 128);
  dfg.dispose(); ies.dispose();
});

test('DFG squared-roughness CPU lookup remains unchanged after packing, including clamped boundaries', () => {
  const {dfg, ies} = textures(), inputs = [];
  let state = 0x715eaba1;
  const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (const nv of [-2, 0, .5 / 128, .5, 127.5 / 128, 1, 2]) for (const r of [-2, 0, Math.sqrt(.5 / 128), .5, Math.sqrt(127.5 / 128), 1, 2]) inputs.push([nv, r]);
  for (let i = 0; i < 1024; i++) inputs.push([random() * 3 - 1, random() * 3 - 1]);
  const expected = inputs.map(([nv, r]) => sampleSourceDfg(dfg, nv, r));
  packSourceIesIntoDfg(dfg, ies);
  inputs.forEach(([nv, r], i) => assert.deepEqual(sampleSourceDfg(dfg, nv, r), expected[i]));
  dfg.dispose(); ies.dispose();
});

test('direct and DFG shader hooks share exactly one source sampler, with existing DFG declarations or without', () => {
  const {dfg, ies} = textures(); packSourceIesIntoDfg(dfg, ies);
  const adapter = createSourceDirectAdapter({texture: ies, combinedDfgTexture: dfg}, 1, 1);
  for (const priorDfg of [false, true]) {
    const shader = {fragmentShader: `${priorDfg ? SOURCE_DFG_GLSL : ''}\n#include <common>\nvoid main(){}`, uniforms: priorDfg ? {bf2_sourceDFG: {value: dfg}} : {}};
    adapter.decorateShader(shader);
    assert.equal((shader.fragmentShader.match(/uniform sampler2D bf2_sourceDFG;/g) ?? []).length, 1);
    assert.ok(!shader.fragmentShader.includes('bf2_sourceIes'));
    assert.equal(shader.uniforms.bf2_sourceDFG.value, dfg);
    assert.ok(!('bf2_sourceIes' in shader.uniforms));
    assert.match(shader.fragmentShader, /bf2_sampleSourceIes\(bf2_iesUv\(localDirection\)\)/);
  }
  const other = createSourceDfgTexture(dfgDocument, arrayBuffer(rawDfg));
  assert.throws(() => adapter.decorateShader({fragmentShader: '#include <common>', uniforms: {bf2_sourceDFG: {value: other}}}), /share/);
  other.dispose(); dfg.dispose(); ies.dispose();
});
