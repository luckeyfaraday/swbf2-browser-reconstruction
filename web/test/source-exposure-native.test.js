import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeExposureAtEV, nativeMeterEV, adaptNativeExposureEV,
  resolveNativeExposureTargets, stepNativeExposure} from '../src/source-exposure-native.js';

const near = (a, b, tolerance = 1e-12) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const settings = {darkAdaptationTime: .8, lightAdaptationTime: .799999952};

test('native photographic scale and luminance calibration preserve reciprocal exposure', () => {
  for (const ev of [-10, 0, 7, 8, 9, 25]) for (const compensation of [-.5, 0, 2]) {
    near(nativeExposureAtEV(ev, compensation) * Math.fround(1.2) * 2 ** (ev - compensation), 1);
    near(nativeMeterEV(2 ** ev / 8), ev, 6e-7);
  }
});

test('native adaptation is directional, capped linear and not exponential', () => {
  near(adaptNativeExposureEV(8, 6, .4, settings), 7);
  near(adaptNativeExposureEV(8, 10, .4, {darkAdaptationTime: .8, lightAdaptationTime: .4}), 10);
  near(adaptNativeExposureEV(8, 10, 2, settings), 10);
  near(adaptNativeExposureEV(8, 10, 0, settings), 8);
  const native = adaptNativeExposureEV(8, 10, .4, {darkAdaptationTime: .8, lightAdaptationTime: .8});
  near(native, 9);
  assert.ok(Math.abs(native - (8 + 2 * (1 - Math.exp(-.4 / .8)))) > .2);
});

test('target selection preserves bounds, no-readback hold, deadband and override order', () => {
  const input = {currentEV: 8, automatic: true, readbackValid: true, luminance: 1024,
    manualEV: 3, minEV: 7, maxEV: 9, higherThreshold: .2, lowerThreshold: .3};
  let out = resolveNativeExposureTargets(input);
  near(out.targetEV, 9); assert.ok(out.secondaryEV > 12.9); near(out.clampedEV, 9);
  out = resolveNativeExposureTargets({...input, readbackValid: false});
  assert.deepEqual(out, {targetEV: 8, secondaryEV: 8, clampedEV: 8});
  out = resolveNativeExposureTargets({...input, luminance: 2 ** 8.1 / 8});
  near(out.targetEV, 8); near(out.secondaryEV, 8); assert.ok(out.clampedEV > 8);
  out = resolveNativeExposureTargets({...input, automatic: false});
  assert.deepEqual(out, {targetEV: 3, secondaryEV: 3, clampedEV: 3});
  out = resolveNativeExposureTargets({...input, overrideEV: 4});
  near(out.targetEV, 4); near(out.clampedEV, 9); assert.ok(out.secondaryEV > 12.9);
});

test('native frame step adapts compensation independently and respects reset/time gates', () => {
  const input = {currentEV: 8, currentSecondaryEV: 10, currentCompensation: -.5,
    targetEV: 9, targetSecondaryEV: 14, targetCompensation: -1, deltaTime: .2,
    darkAdaptationTime: .8, lightAdaptationTime: .4, adaptationEnabled: true, reset: false,
    automatic: true, higherThreshold: .2, lowerThreshold: .3};
  let out = stepNativeExposure(input);
  near(out.ev, 8.4); near(out.secondaryEV, 12); near(out.compensation, -.625);
  near(out.exposure, nativeExposureAtEV(8.4, -.625));
  out = stepNativeExposure({...input, reset: true});
  near(out.ev, 9); near(out.secondaryEV, 14); near(out.compensation, -1);
  out = stepNativeExposure({...input, darkAdaptationTime: 0, lightAdaptationTime: 0});
  near(out.ev, 9); near(out.compensation, -1);
  out = stepNativeExposure({...input, targetEV: 8});
  near(out.ev, 8); near(out.secondaryEV, 14); near(out.compensation, -.625);
});
