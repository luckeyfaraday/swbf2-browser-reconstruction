import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {ShaderLib} from 'three';
import {createSourceDfgTexture, sampleSourceDfg, SOURCE_DFG_GLSL} from '../src/source-dfg.js';
import {decodeSourceOrdinaryMaterial, sourceEnvironmentResponse,
  injectSourceEnvironmentSpecular, SOURCE_ENVIRONMENT_SPECULAR_POLICY} from '../src/source-environment-specular.js';

const root = new URL('../../', import.meta.url);
const evidence = JSON.parse(fs.readFileSync(new URL('exports/lighting/dfg-gbuffer/manifest.json', root)));
const document = JSON.parse(fs.readFileSync(new URL('../public/assets/source-dfg.json', import.meta.url)));
const raw = fs.readFileSync(new URL('../public/assets/source-dfg.rgba16f.bin', import.meta.url));
const texture = () => createSourceDfgTexture(document, raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
const close = (actual, expected) => actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-12));

test('native deferred consumers retain exact bytecode identity and independent decoder checks', () => {
  assert.equal(evidence.evidenceId, SOURCE_ENVIRONMENT_SPECULAR_POLICY.evidenceId);
  assert.equal(evidence.validation.cases, 1000);
  assert.ok(evidence.validation.maximumAbsoluteError < 1e-12);
  for (const consumer of evidence.consumers) {
    const bytes = fs.readFileSync(new URL(`exports/lighting/dfg-gbuffer/${consumer.file}.dxbc`, root));
    assert.equal(bytes.length, consumer.bytecodeBytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), consumer.sha256);
  }
  const native = evidence.validation.examples.find(row => row.materialId === 0);
  const decoded = decodeSourceOrdinaryMaterial(native.baseColor, native.metalness, native.reflectance);
  close(decoded.f0, native.f0);
  assert.equal(decoded.f90, native.f90);
});

test('ordinary metalness controls diffuse and F0 independently of dielectric reflectance', () => {
  const color = [.2, .5, .8];
  const floor = decodeSourceOrdinaryMaterial(color, 0, .5);
  close(floor.f0, [.04, .04, .04]); close(floor.diffuse, color); assert.equal(floor.f90, 1);
  const metal = decodeSourceOrdinaryMaterial(color, 1, .5);
  close(metal.f0, color); close(metal.diffuse, [0, 0, 0]);
  const blend = decodeSourceOrdinaryMaterial(color, .25, .25);
  close(blend.f0, [.0575, .1325, .2075]); close(blend.diffuse, [.15, .375, .6]);
});

test('native F90 uses exact .33 channel weight and preserves low-reflectance falloff', () => {
  const black = decodeSourceOrdinaryMaterial([0, 0, 0], 1, .5);
  assert.equal(black.f90, 0);
  const weak = decodeSourceOrdinaryMaterial([.01, .01, .01], 1, .5);
  assert.ok(Math.abs(weak.f90 - .495) < 1e-12);
  close(sourceEnvironmentResponse([.01, .01, .01], 1, .5, [.6, .2, 500]), [.105, .105, .105]);
});

test('original LUT texel produces native F0 scale plus F90 bias without extra energy terms', () => {
  const lut = texture();
  const dfg = sampleSourceDfg(lut, 64.5 / 128, Math.sqrt(64.5 / 128));
  close(sourceEnvironmentResponse([.2, .4, .6], 0, .5, dfg), [.03724090576171875, .03724090576171875, .03724090576171875]);
  close(sourceEnvironmentResponse([.2, .4, .6], 1, .5, dfg), [.14692840576171876, .2840377807617188, .42114715576171874]);
  lut.dispose();
});

test('Three shader helper preserves existing floor hook, direct lighting and indirect diffuse call', () => {
  const lut = texture();
  const marker = 'reflectedLight.indirectDiffuse += vec3(0.123);';
  const shader = {uniforms: {bf2_sourceDFG: {value: lut}}, fragmentShader: SOURCE_DFG_GLSL +
    ShaderLib.standard.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${marker}`)};
  injectSourceEnvironmentSpecular(shader, {texture: lut});
  assert.equal(shader.uniforms.bf2_sourceDFG.value, lut);
  assert.equal(shader.fragmentShader.match(/uniform sampler2D bf2_sourceDFG/g).length, 1);
  assert.ok(shader.fragmentShader.includes(marker));
  assert.ok(shader.fragmentShader.includes('#include <lights_fragment_begin>'));
  assert.ok(shader.fragmentShader.includes('RE_IndirectDiffuse( irradiance,'));
  assert.ok(!shader.fragmentShader.includes('RE_IndirectSpecular( radiance,'));
  assert.ok(shader.fragmentShader.includes('diffuseColor.rgb, metalnessFactor, 0.5000000000'));
  assert.ok(shader.fragmentShader.includes('dot(geometryNormal, geometryViewDir), roughnessFactor'));
  assert.throws(() => injectSourceEnvironmentSpecular(shader, {texture: lut}), /already patched/);
  lut.dispose();
});

test('helper adds its LUT declaration once and rejects unknown material modes or hook conflicts', () => {
  const lut = texture(), other = texture();
  const shader = () => ({uniforms: {}, fragmentShader: ShaderLib.standard.fragmentShader});
  const ordinary = shader();
  injectSourceEnvironmentSpecular(ordinary, {texture: lut});
  assert.equal(ordinary.fragmentShader.match(/uniform sampler2D bf2_sourceDFG/g).length, 1);
  assert.throws(() => injectSourceEnvironmentSpecular(shader(), {texture: lut, materialId: 2}), /ordinary/);
  assert.throws(() => injectSourceEnvironmentSpecular({uniforms: {}, fragmentShader: ''}, {texture: lut}), /integration point/);
  const conflict = shader(); conflict.uniforms.bf2_sourceDFG = {value: other};
  assert.throws(() => injectSourceEnvironmentSpecular(conflict, {texture: lut}), /share/);
  lut.dispose(); other.dispose();
});
