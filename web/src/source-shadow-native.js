// Recovered native shadow arithmetic; source-shadow-atlas.js activates it in the browser.
// Evidence: BF2-NATIVE-LOCAL-SHADOW-PRODUCER-001.
export const SOURCE_SHADOW_NATIVE_POLICY = Object.freeze({
  evidenceId: 'BF2-NATIVE-LOCAL-SHADOW-PRODUCER-001',
  status: 'Source producer subset; browser activation lives in source-shadow-atlas.js (BF2-NATIVE-LOCAL-SHADOW-ACTIVATION-001).',
  borderPixels: 4,
  limitations: [
    'Default settings are constructor values, not a captured original runtime configuration.',
    'Depth-bias groups, floor RVM state and comparison sampler are proven; cross-API bias and cache scheduling remain unwired.',
    'The native quality-1 nine-gather comparison filter is not replaced with a generic PCF filter.',
  ],
});

export const NATIVE_SHADOW_DEFAULTS = Object.freeze({
  enabled: true,
  prefer16Bit: true,
  cacheEnabled: false,
  filterQuality: 1,
  resolutionByQuality: Object.freeze([256, 512, 1024, 2048]),
  atlasSlotCount: 32,
  atlasSlotResolution: 512,
  maxShadowCount: 32,
  punctualShadowLevel: 0,
});

const f = Math.fround;
const epsilonAngle = f(0.001);
const halfDegrees = (angle) => f(f(f(angle * f(0.5)) * f(Math.PI)) * f(1 / 180));
const radians = (angle) => f(f(angle * f(Math.PI)) * f(1 / 180));

// 140db0fb0 format switch + original tables 14409a530/14409a580.
// These are native values, not WebGL polygonOffset units. The selected group
// reaches all floor RVM builders; cross-API conversion still needs proof.
export function nativeShadowBiasForFormat(nativeFormat) {
  const group = ({ 120: 12, 121: 12, 122: 13, 123: 11, 124: 12, 125: 13 })[nativeFormat];
  if (group === undefined) throw new RangeError('A recovered native shadow depth format is required.');
  return {
    group,
    name: `ShaderDepthBiasGroup_Shadow${group === 11 ? 16 : group === 12 ? 24 : 32}Bit`,
    depthBias: group === 11 ? -10 : -1000,
    depthBiasClamp: 0,
    slopeScaledDepthBias: -4,
  };
}

// 140f74fb0: square atlas from a ceil(sqrt(N)) by ceil(N/columns) grid.
export function nativeShadowAtlasSize(slotCount, slotResolution) {
  if (!Number.isInteger(slotCount) || slotCount < 1 || !Number.isInteger(slotResolution) || slotResolution < 1) {
    throw new RangeError('Positive integer source atlas dimensions are required.');
  }
  const columns = Math.ceil(Math.sqrt(f(slotCount)));
  const rows = Math.ceil(slotCount / columns);
  return Math.max(columns, rows) * (slotResolution + 8);
}

// 140f90b80: actual allocator rectangle includes four pixels on each side.
export function nativeShadowAtlasParam({ x, y, width, height }, atlasSize) {
  if (![x, y, width, height, atlasSize].every(Number.isFinite) || atlasSize <= 0 || width <= 8 || height <= 8) {
    throw new RangeError('A source rectangle including its eight border pixels is required.');
  }
  const inverseSize = f(1 / atlasSize);
  return [f((x + 4) * inverseSize), f((y + 4) * inverseSize),
    f((width - 8) * inverseSize), f((height - 8) * inverseSize)];
}

// The caster projection expands, while the lighting matrix keeps the original FOV.
export function nativeShadowBorderFov(fovRadians, interiorResolution) {
  if (!(fovRadians > 0 && fovRadians < Math.PI) || !(interiorResolution > 0)) {
    throw new RangeError('A perspective FOV and positive source interior resolution are required.');
  }
  const halfSize = f(f(interiorResolution + 8) * f(0.5));
  const scale = f(halfSize / f(halfSize - 4));
  return f(2 * f(Math.atan(f(scale * f(Math.tan(f(fovRadians * f(0.5))))))));
}

// 140f873a0 writes A,B so native depth(distance)=A/distance+B.
// Explicit reverseDepth is mandatory: this helper does not assume view flags.
export function nativeShadowDepthFactors(near, far, reverseDepth) {
  if (!(near > 0 && far > near) || typeof reverseDepth !== 'boolean') {
    throw new RangeError('Valid near/far and an explicit native depth direction are required.');
  }
  const n = f(reverseDepth ? far : near), z = f(reverseDepth ? near : far);
  const b = f(z / f(z - n));
  return [f(-f(b * n)), b];
}

// 140d879e0 + 140d9d100: punctual source spots only (DiscRadius exactly zero).
// Dynamic property overrides and per-view eligibility are caller responsibilities.
export function nativePunctualSpotShadowParameters(properties, settings = NATIVE_SHADOW_DEFAULTS) {
  if (!properties?.$type?.endsWith('PbrSpotLightEntityData') || properties.DiscRadius !== 0) {
    throw new TypeError('This source producer subset requires a punctual PbrSpotLightEntityData.');
  }
  const near = Math.max(f(properties.ShadowNearRadius), f(0.005));
  const radius = f(properties.AttenuationRadius), requestedFar = f(properties.ShadowFarRadius);
  const far = Math.max(f(near + f(0.01)), requestedFar > 0 && requestedFar <= radius ? requestedFar : radius);
  const outer = Math.min(179, Math.max(1, f(properties.OuterAngle)));
  const maximum = Math.min(150, f(properties.ShadowMaxAngle));
  const fade = Math.max(epsilonAngle, f(properties.ShadowFadeOutRange));
  const start = Math.min(outer, f(maximum - fade));
  const end = Math.min(maximum, Math.max(outer, f(start + epsilonAngle)));
  const cosStart = f(Math.cos(halfDegrees(start))), cosEnd = f(Math.cos(halfDegrees(end)));
  // Native has no epsilon on this division; do not silently substitute one.
  const angleScale = f(1 / f(cosStart - cosEnd));
  const angleOffset = f(-f(cosEnd * angleScale));
  const quality = properties.ShadowResolution.value;
  const requestedResolution = settings.resolutionByQuality[quality];
  const castLevel = properties.CastShadows.value;
  return {
    enabledBySourceLevel: settings.enabled && properties.CastShadowsEnable && castLevel !== 5
      && castLevel <= settings.punctualShadowLevel,
    near, far, shadowStartDegrees: start, shadowEndDegrees: end,
    originalFovRadians: radians(end), angleScale, angleOffset,
    requestedResolution, filterQuality: settings.filterQuality,
    sourceShadowDimmer: properties.ShadowDimmer,
    cacheEnabledBySource: properties.ShadowCacheEnable,
  };
}
