import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { projectNativeSpotShadow, sampleNativeShadowQuality1, sampleNativeShadowSimpleIdeal, nativeShadowDimmer } from '../src/source-shadow-sampling.js';

const evidence = (name) => new URL(`../../exports/lighting/${name}`, import.meta.url);
const execution = JSON.parse(readFileSync(evidence('native-shadow-warp/execution.json')));
const baseline = readFileSync(evidence('native-shadow-warp/baseline.rgba32f.bin'));
const output = readFileSync(evidence('native-shadow-warp/native-cases.rgba32f.bin'));

test('recovered quality-1 projection and filtering match 12,800 unchanged native CS pixels', () => {
  assert.equal(createHash('sha256').update(output).digest('hex'), execution.payloadSha256);
  assert.equal(execution.shaderSha256, 'a61cab9738c12e1b993c32ff96dddc0f96c7942a6b4716aa4ef83e491c8c25b9');
  let maximum = 0, count = 0;
  for (const fixture of execution.cases) {
    if (Math.trunc(fixture.quality) !== 1) continue;
    const depths = execution.patterns[fixture.pattern].depth;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const position = [Math.fround(Math.fround(0.3) * ((x + 0.5) / 4 - 1)), Math.fround(Math.fround(0.3) * (1 - (y + 0.5) / 4)), -2];
      const p = projectNativeSpotShadow(position, fixture.rows, fixture.atlas);
      const shadow = p.inside ? nativeShadowDimmer(sampleNativeShadowQuality1(p.uv, p.depth, 16, (ix, iy) => depths[iy * 16 + ix]), fixture.dimmer, 1) : 1;
      const at = (y * 8 + x) * 16;
      const native = output.readFloatLE(fixture.offset + at) / baseline.readFloatLE(at);
      maximum = Math.max(maximum, Math.abs(native - shadow));
      count++;
    }
  }
  assert.equal(count, 12800);
  assert.ok(maximum < 3e-7, `native CS residual ${maximum}`);
});

test('strict reversed-depth equality and quality-specific near-depth behavior are retained', () => {
  assert.equal(sampleNativeShadowQuality1([0.5, 0.5], 0.5, 16, () => 0.5), 0);
  assert.equal(sampleNativeShadowSimpleIdeal([0.5, 0.5], 0.5, 16, () => 0.5), 0);
  assert.equal(sampleNativeShadowQuality1([0.5, 0.5], 1, 16, () => 1), 0);
  assert.equal(sampleNativeShadowSimpleIdeal([0.5, 0.5], 1, 16, () => 1), 1);
  assert.equal(nativeShadowDimmer(0, 0.7, 0.25), 0.825);
});

test('native comparison sampler and IES wrap association have retained instruction witnesses', () => {
  const source = JSON.parse(readFileSync(evidence('native-shadow-sampler.json')));
  assert.equal(source.programSelector, '0xf5f3bbba');
  assert.equal(source.shadow.slot, 3);
  assert.equal(source.shadow.dx11.filter, 0x94);
  assert.equal(source.shadow.dx11.comparisonFunc, 5);
  assert.deepEqual(source.shadow.dx11.addressUVW, [3, 3, 3]);
  assert.deepEqual(source.ies.dx11.addressUVW, [1, 3, 3]);
  assert.equal(source.ies.dx11.filter, 0x14);
  assert.ok(source.instructionAssertions.some((v) => v.address === '0x140f46eee'));
});
