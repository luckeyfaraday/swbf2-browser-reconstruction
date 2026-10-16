// Original CPU functions 141561710 / 141561260. This module does not choose a
// metering method or activate rendering. See native-exposure-analysis.md.
export const NATIVE_EXPOSURE_POLICY = Object.freeze({
  evidenceId: 'BF2-NATIVE-EXPOSURE-001',
  observed: 'Luminance-to-EV calibration, photographic exposure, target deadband and capped linear adaptation.',
  limitations: 'JavaScript arithmetic is double precision; native scalar operations/libm are float32. Meter selection, readback timing and active environment blending are separate inputs.',
});

export const NATIVE_EXPOSURE_CONSTANTS = Object.freeze({
  saturation: Math.fround(1.2),
  inverseCalibration: Math.fround(.08),
  log2e: Math.fround(1.4426950216293335),
  adaptationThreshold: Math.fround(.01),
});

export function nativeExposureAtEV(ev, compensation = 0) {
  return 1 / (NATIVE_EXPOSURE_CONSTANTS.saturation * Math.pow(2, ev - compensation));
}

export function nativeMeterEV(reducedLuminance) {
  // 141561745..141561762: logf(L * 100 * float32(.08)) * float32(log2(e)).
  return Math.log(reducedLuminance * 100 * NATIVE_EXPOSURE_CONSTANTS.inverseCalibration)
    * NATIVE_EXPOSURE_CONSTANTS.log2e;
}

export function adaptNativeExposureEV(current, target, deltaTime, settings) {
  // The caller resolves/clamps the target first. No inferred bounds or time floor.
  const seconds = target > current ? settings.lightAdaptationTime : settings.darkAdaptationTime;
  const weight = Math.min(deltaTime / seconds, 1);
  return (1 - weight) * current + weight * target;
}

export function resolveNativeExposureTargets({currentEV, automatic, readbackValid,
  luminance, manualEV, minEV, maxEV, higherThreshold, lowerThreshold, overrideEV = null}) {
  let raw = automatic ? (readbackValid ? nativeMeterEV(luminance) : currentEV) : manualEV;
  let clamped = raw, target = raw;
  if (automatic) {
    clamped = Math.min(Math.max(raw, minEV), maxEV);
    target = clamped;
    if (currentEV - lowerThreshold <= clamped && clamped <= currentEV + higherThreshold) {
      target = currentEV;
      raw = currentEV;
    }
  }
  if (overrideEV !== null) target = overrideEV;
  return {targetEV: target, secondaryEV: raw, clampedEV: clamped};
}

export function stepNativeExposure({currentEV, currentSecondaryEV, currentCompensation,
  targetEV, targetSecondaryEV, targetCompensation, deltaTime,
  darkAdaptationTime, lightAdaptationTime, adaptationEnabled, reset,
  automatic, higherThreshold, lowerThreshold}) {
  const adapt = adaptationEnabled && !reset &&
    (darkAdaptationTime > NATIVE_EXPOSURE_CONSTANTS.adaptationThreshold ||
     lightAdaptationTime > NATIVE_EXPOSURE_CONSTANTS.adaptationThreshold);
  let ev = targetEV, secondaryEV = targetSecondaryEV, compensation = targetCompensation;
  if (targetEV !== currentEV && adapt) {
    const seconds = targetEV > currentEV ? lightAdaptationTime : darkAdaptationTime;
    const weight = Math.min(deltaTime / seconds, 1);
    const shifted = automatic ? targetEV + (targetEV <= currentEV ? lowerThreshold : -higherThreshold) : targetEV;
    ev = (1 - weight) * currentEV + weight * shifted;
    secondaryEV = (1 - weight) * currentSecondaryEV + weight * targetSecondaryEV;
  }
  if (targetCompensation !== currentCompensation && adapt) {
    compensation = adaptNativeExposureEV(currentCompensation, targetCompensation,
      deltaTime, {darkAdaptationTime, lightAdaptationTime});
  }
  return {ev, secondaryEV, compensation,
    exposure: nativeExposureAtEV(ev, compensation),
    secondaryExposure: nativeExposureAtEV(secondaryEV, compensation)};
}
