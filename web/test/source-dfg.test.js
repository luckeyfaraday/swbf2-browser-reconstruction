import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {createSourceDfgTexture, sampleSourceDfg, prepareSourceDfg} from '../src/source-dfg.js';

const document = JSON.parse(fs.readFileSync(new URL('../public/assets/source-dfg.json', import.meta.url)));
const raw = fs.readFileSync(new URL('../public/assets/source-dfg.rgba16f.bin', import.meta.url));
const asBuffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

test('browser DFG is byte-identical to the original shader output from software WARP', () => {
  const source = fs.readFileSync(new URL('../../exports/lighting/dfg-generator/native-fg-128.rgba16f.bin', import.meta.url));
  const execution = JSON.parse(fs.readFileSync(new URL('../../exports/lighting/dfg-generator/warp-execution.json', import.meta.url)));
  assert.equal(raw.length, 128 * 128 * 8);
  assert.deepEqual(raw, source);
  assert.equal(createHash('sha256').update(raw).digest('hex'), '52211351c87d57ea80e198e8740c821686b0758b32661f7156dd41b744a994cb');
  assert.equal(document.sha256, execution.sha256);
  assert.equal(execution.adapter, 'Microsoft Basic Render Driver');
  assert.equal(execution.vendorId, 0x1414);
  assert.equal(execution.sampleCountPerPixel, 4096);
  for (let index = 0; index < raw.length / 2; index++) {
    const word = raw.readUInt16LE(index * 2);
    assert.ok(Number.isFinite(THREE.DataUtils.fromHalfFloat(word)));
    if (index % 4 === 3) assert.equal(word, 0);
  }
});

test('independent numerical integral checks include all corners and agree within half-float scale', () => {
  const validation = JSON.parse(fs.readFileSync(new URL('../../exports/lighting/dfg-generator/validation.json', import.meta.url)));
  assert.equal(validation.independentChecks.length, 81);
  assert.ok(validation.maximumError < .001);
  assert.deepEqual(validation.dx11Dx12InstructionStreamsIdentical, {vs_5_0: true, ps_5_0: true});
  for (const [x, y] of [[0, 0], [127, 0], [0, 127], [127, 127], [64, 64]]) {
    const check = validation.independentChecks.find(row => row.pixel[0] === x && row.pixel[1] === y);
    assert.ok(check);
    for (let channel = 0; channel < 3; channel++) {
      assert.equal(check.nativeWarp[channel], THREE.DataUtils.fromHalfFloat(raw.readUInt16LE(((y * 128 + x) * 4 + channel) * 2)));
      assert.ok(Math.abs(check.nativeWarp[channel] - check.independentIntegral[channel]) < .001);
    }
  }
});

test('DFG texture preserves native coefficient channels, row order and half-float filtering', () => {
  const buffer = asBuffer(raw), texture = createSourceDfgTexture(document, buffer);
  assert.equal(texture.image.data.buffer, buffer);
  assert.ok(texture.image.data instanceof Uint16Array);
  assert.equal(texture.type, THREE.HalfFloatType);
  assert.equal(texture.format, THREE.RGBAFormat);
  assert.equal(texture.colorSpace, THREE.NoColorSpace);
  assert.equal(texture.flipY, false);
  assert.equal(texture.generateMipmaps, false);
  assert.equal(texture.wrapS, THREE.ClampToEdgeWrapping);
  assert.equal(texture.wrapT, THREE.ClampToEdgeWrapping);
  assert.equal(texture.minFilter, THREE.LinearFilter);
  assert.equal(texture.magFilter, THREE.LinearFilter);
  assert.equal(texture.mipmaps.length, 0);
  texture.dispose();
});

test('native lookup uses NdotV horizontally and squared perceptual roughness vertically', () => {
  const texture = createSourceDfgTexture(document, asBuffer(raw));
  const actual = sampleSourceDfg(texture, 64.5 / 128, Math.sqrt(64.5 / 128));
  const expected = [.685546875, .00981903076171875, .7724609375];
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-12));
  assert.deepEqual(sampleSourceDfg(texture, 1, 0), [1, 0, .93701171875]);
  assert.deepEqual(sampleSourceDfg(texture, 0, 1), [.92724609375, .046173095703125, 1.0244140625]);
  assert.deepEqual(sampleSourceDfg(texture, -3, 5), sampleSourceDfg(texture, 0, 1));
  assert.notDeepEqual(sampleSourceDfg(texture, 64.5 / 128, 64.5 / 128), expected);
  texture.dispose();
});

test('DFG bilinear lookup includes neighboring texels without a transpose or gamma transform', () => {
  const texture = createSourceDfgTexture(document, asBuffer(raw));
  const expected = [0, 0, 0];
  for (const [x, y] of [[23, 47], [24, 47], [23, 48], [24, 48]]) {
    for (let channel = 0; channel < 3; channel++) {
      expected[channel] += THREE.DataUtils.fromHalfFloat(raw.readUInt16LE(((y * 128 + x) * 4 + channel) * 2)) / 4;
    }
  }
  const actual = sampleSourceDfg(texture, 24 / 128, Math.sqrt(48 / 128));
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-12));
  texture.dispose();
});

test('DFG preparation exposes a standalone texture and releases it once', async () => {
  const prepared = await prepareSourceDfg(document, {fetch: async url => {
    assert.equal(url, document.url);
    return {ok: true, arrayBuffer: async () => asBuffer(raw)};
  }});
  let disposed = 0;
  prepared.texture.addEventListener('dispose', () => disposed++);
  assert.equal(prepared.snapshot().byteLength, 131072);
  assert.deepEqual(prepared.sample(1, 0), [1, 0, .93701171875]);
  prepared.dispose(); prepared.dispose();
  assert.equal(disposed, 1);
  assert.equal(prepared.snapshot().disposed, true);
  assert.throws(() => prepared.sample(.5, .5), /disposed/);
  await assert.rejects(prepareSourceDfg(document, {fetch: async () => ({ok: false, status: 404})}), /404/);
});

test('malformed and non-finite DFG payloads fail instead of silently changing lighting', () => {
  assert.throws(() => createSourceDfgTexture(document, asBuffer(raw.subarray(2))), /Invalid/);
  assert.throws(() => createSourceDfgTexture({...document, width: 64}, asBuffer(raw)), /Invalid/);
  const nonFinite = asBuffer(raw);
  new DataView(nonFinite).setUint16(0, 0x7c00, true);
  assert.throws(() => createSourceDfgTexture(document, nonFinite), /coefficient/);
  const wrongAlpha = asBuffer(raw);
  new DataView(wrongAlpha).setUint16(6, 0x3c00, true);
  assert.throws(() => createSourceDfgTexture(document, wrongAlpha), /coefficient/);
});
