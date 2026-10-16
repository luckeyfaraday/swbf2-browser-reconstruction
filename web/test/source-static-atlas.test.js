import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {evaluateSourceStaticAtlas, SOURCE_STATIC_ATLAS_POLICY} from '../src/source-static-atlas.js';

const source = new URL('../../exports/lighting/static-atlas-sample/', import.meta.url);
const bytes = name => fs.readFileSync(new URL(name, source));
const execution = JSON.parse(bytes('native-execution.json'));
const manifest = JSON.parse(bytes('manifest.json'));
const validation = JSON.parse(bytes('math-validation.json'));
const floats = name => {
  const buffer = bytes(name);
  return Array.from({length: buffer.length / 4}, (_, index) => buffer.readFloatLE(index * 4));
};
const textures = ['StaticIrradianceTexture', 'StaticDirectionTexture', 'StaticDirectionTextureG',
  'StaticDirectionTextureB', 'StaticSkyVisibilityTexture'].map(name => floats(`${name}.rgba32f.bin`));
const shader = fs.readFileSync(new URL('../../exports/materials/floor-shader/f789fdaafa.dxbc', import.meta.url));

test('static atlas CPU equations reproduce 2304 unchanged original pixel-shader WARP outputs', () => {
  assert.equal(createHash('sha256').update(shader).digest('hex'), execution.pixelSha256);
  assert.equal(execution.pixelSha256, SOURCE_STATIC_ATLAS_POLICY.pixelShaderSha256);
  assert.deepEqual(execution.exposureMultipliers, {cb2_40_x: 1, cb2_41_y: 1});
  let samples = 0, largest = 0;
  for (const fixture of execution.cases) {
    const nativeBytes = bytes(`native-case${fixture.index}-mrt3.rgba32f.bin`);
    assert.equal(createHash('sha256').update(nativeBytes).digest('hex'), validation.cases[fixture.index].nativePayloadSha256);
    const native = floats(`native-case${fixture.index}-mrt3.rgba32f.bin`);
    const native2 = floats(`native-case${fixture.index}-mrt2.rgba32f.bin`);
    const x = fixture.normalTextureX * 2 - 1, w = fixture.roughnessTextureW;
    const smoothness = Math.max(0, Math.min(1, (1 + .307 * (1.6 * w - 1)) * .9 + (1.6 * w) * .1));
    for (let pixel = 0; pixel < 256; pixel++) {
      const at = pixel * 4;
      const result = evaluateSourceStaticAtlas({irradiance: textures[0].slice(at, at + 3),
        directions: textures.slice(1, 4).map(texture => texture.slice(at, at + 3).map(v => 2 * v - 1)),
        normal: [x, Math.sqrt(1 - x * x), 0], view: [0, Math.SQRT1_2, Math.SQRT1_2], smoothness,
        lightMapPreExposure: execution.exposureMultipliers.cb2_41_y, skyVisibility: textures[4][at]});
      for (let channel = 0; channel < 3; channel++) {
        const expected = result.prelighting[channel], observed = native[at + channel];
        const residual = Math.abs(expected - observed) / Math.max(1, Math.abs(expected));
        assert.ok(Number.isFinite(expected) && residual < 1e-4,
          `case ${fixture.index}, pixel ${pixel}, channel ${channel}: ${expected} versus ${observed}`);
        largest = Math.max(largest, residual);
      }
      assert.equal(result.skyVisibility, native2[at + 3]);
      samples++;
    }
  }
  assert.equal(samples, 2304);
  assert.ok(Math.abs(largest - validation.maximumRelativeError) < 1e-10);
  assert.equal(manifest.textures.length, 5);
});

test('static atlas retains explicit exposure, source smoothness saturation, and zero-lobe native behavior', () => {
  const input = {irradiance: [125.375, 178.625, 242.5], directions: [[0, 0, 0], [.2, .5, .1], [.4, .6, -.2]],
    normal: [0, 1, 0], view: [0, Math.SQRT1_2, Math.SQRT1_2], smoothness: .5, skyVisibility: .72};
  assert.throws(() => evaluateSourceStaticAtlas(input), /explicit.*LightMapPreExposure/);
  const a = evaluateSourceStaticAtlas({...input, lightMapPreExposure: 1});
  const b = evaluateSourceStaticAtlas({...input, lightMapPreExposure: .125});
  assert.equal(a.diffuseWeights[0], 0.2820949852466583);
  assert.deepEqual(b.prelighting, a.prelighting.map(value => value * .125));
  assert.equal(a.skyVisibility, b.skyVisibility);
  for (const [outside, boundary] of [[-1, 0], [2, 1]]) {
    assert.deepEqual(evaluateSourceStaticAtlas({...input, lightMapPreExposure: 1, smoothness: outside}),
      evaluateSourceStaticAtlas({...input, lightMapPreExposure: 1, smoothness: boundary}));
  }
  const zero = evaluateSourceStaticAtlas({...input, lightMapPreExposure: 1, directions: [[0, 0, 0], [0, 0, 0], [0, 0, 0]]});
  assert.ok(zero.prelighting.every(Number.isNaN)); // Do not invent a native degeneracy fallback.
});
