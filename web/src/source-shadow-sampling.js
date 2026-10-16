// Unchanged native type3 CS consumer, independently checked on CPU WARP.
// This module does not allocate an atlas, render casters or modify materials.
export const SOURCE_SHADOW_SAMPLING_POLICY = Object.freeze({
  evidenceId: 'BF2-NATIVE-SHADOW-CONSUMER-VALIDATION-001',
  samplerEvidenceId: 'BF2-NATIVE-SHADOW-SAMPLER-001',
  comparison: 'reference > stored depth; equality fails',
  address: 'Clamp U/V/W',
  quality1: 'Exact nine-gather arithmetic expressed as 36 raw depth comparisons.',
  otherQuality: 'Native hardware SampleCmpLevelZero, linear comparisons and point mip selection.',
  limitations: [
    'Matrices and positions must already share the source coordinate convention; no browser camera conversion is inferred.',
    'Native raster depth generation, cross-API bias, atlas allocation order and caster selection remain separate.',
    'CPU bilinear comparison is ideal arithmetic; the WARP sampler truncates fractions to 8 bits in the retained fixture.',
    'The GLSL simple-quality helper requires a depth comparison sampler configured GREATER and LINEAR.',
  ],
});

export const NATIVE_SHADOW_KERNEL = Object.freeze([
  1, 2, 2, 2, 1,
  2, 3, 4, 3, 2,
  2, 4, 5, 4, 2,
  2, 3, 4, 3, 2,
  1, 2, 2, 2, 1,
]);
// Original DXBC immediate 0x3c864b8a, exactly once in the unchanged shader.
const normalization = 0.016393441706895828;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const kernel = (x, y) => x >= 0 && x < 5 && y >= 0 && y < 5 ? NATIVE_SHADOW_KERNEL[y * 5 + x] : 0;

// Source rows are explicit row-major dp4 operands, not a Three column-major array.
export function projectNativeSpotShadow(position, rows, atlas) {
  const p = [position[0], position[1], position[2], 1];
  const clip = Array.from({ length: 4 }, (_, i) => p.reduce((sum, v, j) => sum + rows[i * 4 + j] * v, 0));
  const q = clip.slice(0, 3).map((v) => v / clip[3]);
  const uv = [(q[0] * 0.5 + 0.5) * atlas[2] + atlas[0], (-q[1] * 0.5 + 0.5) * atlas[3] + atlas[1]];
  // Preserve the original test. It does not add a depth<=1 or positive-w gate.
  const inside = Math.max(Math.abs(q[0]), Math.abs(q[1]), 1 - q[2]) <= 1 && uv[0] >= 0;
  return { uv, depth: q[2], inside };
}

// readDepth receives clamped integer texel coordinates and must return raw depth.
export function sampleNativeShadowQuality1(uv, reference, size, readDepth) {
  const sx = uv[0] * size + 0.5, sy = uv[1] * size + 0.5;
  const bx = Math.floor(sx), by = Math.floor(sy), fx = sx - bx, fy = sy - by;
  let sum = 0;
  for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) {
    const weight = (1 - fy) * ((1 - fx) * kernel(x, y) + fx * kernel(x - 1, y))
      + fy * ((1 - fx) * kernel(x, y - 1) + fx * kernel(x - 1, y - 1));
    const depth = readDepth(Math.max(0, Math.min(size - 1, bx - 3 + x)), Math.max(0, Math.min(size - 1, by - 3 + y)));
    sum += weight * Number(reference > depth);
  }
  return clamp01(sum * normalization);
}

// Ideal bilinear comparison for CPU inspection. Do not emulate the observed
// WARP fractional truncation in production; the native path delegates to D3D.
export function sampleNativeShadowSimpleIdeal(uv, reference, size, readDepth) {
  if (reference >= 1) return 1;
  const sx = uv[0] * size - 0.5, sy = uv[1] * size - 0.5;
  const bx = Math.floor(sx), by = Math.floor(sy), fx = sx - bx, fy = sy - by;
  let result = 0;
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
    const depth = readDepth(Math.max(0, Math.min(size - 1, bx + x)), Math.max(0, Math.min(size - 1, by + y)));
    result += Number(reference > depth) * (x ? fx : 1 - fx) * (y ? fy : 1 - fy);
  }
  return result;
}

// shadowAngleAttenuation is the already squared saturated source facing ramp.
export function nativeShadowDimmer(sample, shadowDimmer, shadowAngleAttenuation) {
  return 1 + shadowDimmer * shadowAngleAttenuation * (sample - 1);
}

export const SOURCE_SHADOW_SAMPLING_GLSL = /* glsl */ `
vec3 bf2ProjectNativeSpotShadow(vec3 position, vec4 row0, vec4 row1, vec4 row2, vec4 row3, vec4 atlas, out bool inside) {
  vec4 p = vec4(position, 1.0);
  vec4 clip = vec4(dot(p,row0),dot(p,row1),dot(p,row2),dot(p,row3));
  vec3 q = clip.xyz / clip.w;
  vec2 uv = (q.xy * vec2(0.5,-0.5) + 0.5) * atlas.zw + atlas.xy;
  inside = max(max(abs(q.x),abs(q.y)),1.0-q.z) <= 1.0 && uv.x >= 0.0;
  return vec3(uv,q.z);
}
// The native 5x5 kernel by symmetry class (zero outside), equal to NATIVE_SHADOW_KERNEL.
float bf2NativeShadowKernel(int u, int v) {
  if (u < 0 || v < 0 || u > 4 || v > 4) return 0.0;
  int a = abs(u - 2), b = abs(v - 2), high = max(a, b), low = min(a, b);
  return high == 0 ? 5.0 : high == 1 ? (low == 0 ? 4.0 : 3.0) : (low == 2 ? 1.0 : 2.0);
}
// Rolled loops: the trip count depends on atlasSize, so FXC cannot unroll the 36
// fetches. Unrolled, they inflate register allocation, and therefore cost occupancy,
// in every receiving shader even where the filter never runs. Same weights and
// summation order as the 6x6 bilinear-shifted kernel.
float bf2NativeShadowQuality1(sampler2D rawAtlas, vec3 coordinate, int atlasSize) {
  vec2 p = coordinate.xy * float(atlasSize) + 0.5;
  ivec2 base = ivec2(floor(p)), limit = ivec2(atlasSize - 1);
  vec2 f = fract(p);
  float b00 = (1.0 - f.x) * (1.0 - f.y), b10 = f.x * (1.0 - f.y), b01 = (1.0 - f.x) * f.y, b11 = f.x * f.y, result = 0.0;
  int rows = 6 + min(atlasSize, 0);
  for (int y = 0; y < rows; y++) for (int x = 0; x < rows; x++) {
    float weight = b00 * bf2NativeShadowKernel(x, y) + b10 * bf2NativeShadowKernel(x - 1, y)
      + b01 * bf2NativeShadowKernel(x, y - 1) + b11 * bf2NativeShadowKernel(x - 1, y - 1);
    result += weight * (coordinate.z > texelFetch(rawAtlas, clamp(base + ivec2(x, y) - 3, ivec2(0), limit), 0).r ? 1.0 : 0.0);
  }
  return clamp(result * 0.016393441706895828, 0.0, 1.0);
}
float bf2NativeShadowSimple(sampler2DShadow comparisonAtlas, vec3 coordinate) {
  return coordinate.z < 1.0 ? texture(comparisonAtlas,coordinate) : 1.0;
}
float bf2NativeShadowDimmer(float shadowSample, float shadowDimmer, float shadowAngleAttenuation) {
  return 1.0 + shadowDimmer * shadowAngleAttenuation * (shadowSample - 1.0);
}
`;
