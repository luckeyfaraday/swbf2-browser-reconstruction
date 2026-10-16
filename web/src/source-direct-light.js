// Exact punctual shader equations. This module does not select lights, convert
// EBX luminous units, approximate finite area lights, or mutate any material.
export const SOURCE_DIRECT_LIGHT_POLICY = Object.freeze({
  evidenceId: 'BF2-NATIVE-DIRECT-LIGHT-001',
  shaders: ['c924f450f0e9384a5df6617d404b304dac4ffc0b0fd72ff47cbed3f2815f69b8',
    'a61cab9738c12e1b993c32ff96dddc0f96c7942a6b4716aa4ef83e491c8c25b9'],
  scope: 'Punctual lightType2/3, ordinary materialID0, native GPU light inputs.',
  producerEvidenceId: 'BF2-NATIVE-DIRECT-PRODUCER-002',
  limitations: 'Source field/intensity/IES conversion and punctual predicate are recovered separately in source-direct-light-config.js. Native property connections, per-view fades/order, finite-area BRDF, shadow atlas and selected native frame remain unresolved. IES longitude poles are undefined by the source atan approximation; this helper chooses zero there.',
});

const sat = x => Math.max(0, Math.min(1, x));
const pow5 = x => x * x * x * x * x;
const INV_PI = 0.31830987334251404;
const NV_EPS = 9.999999747378752e-6;

/** Input is squared surface-to-light distance and native BaseLightInfo fields.
 * Unlike Three, a zero inverse radius means no finite radial cutoff. */
export function sourcePunctualDistanceAttenuation(distanceSquared, inverseRadiusSquared, attenuationOffset) {
  const q = distanceSquared * inverseRadiusSquared;
  const window = Math.max(1 - q * q, 0);
  return window * window / Math.max(distanceSquared + attenuationOffset, 9.999999747378752e-5);
}

/** Native runtime spot angles, in degrees. The builder uses cosf(fullAngle/2).
 * For serialized entity angles, sourceDirectCone also applies the CPU clamps. */
export function sourcePunctualConeParameters(innerDegrees, outerDegrees) {
  const inner = Math.cos(innerDegrees * Math.PI / 360);
  const outer = Math.cos(outerDegrees * Math.PI / 360);
  const scale = 1 / Math.max(inner - outer, 0.0010000000474974513);
  return {scale, offset: -outer * scale};
}

export function sourcePunctualAngleAttenuation(cosine, scale, offset) {
  const ramp = sat(cosine * scale + offset);
  return ramp * ramp;
}

/** HLSL atan2 lowering from the IES consumer, preserving its coefficients.
 * Axis/pole zero pair is indeterminate in the native min/max divide; zero is
 * a stated browser convention. The selected source IES is longitude invariant. */
export function sourceIesLongitude(localLeft, localUp) {
  const ax = Math.abs(localLeft), ay = Math.abs(localUp);
  if (Math.max(ax, ay) === 0) return 0;
  const q = Math.min(ax, ay) / Math.max(ax, ay), s = q * q;
  const p = ((((0.02083509974181652 * s - 0.08513300120830536) * s
    + 0.18014100193977356) * s - 0.3302994966506958) * s + 0.9998660087585449) * q;
  let a = ax < ay ? 1.5707963705062866 - p : p;
  if (localLeft < 0) a -= 3.1415927410125732;
  if (Math.min(localLeft, localUp) < 0 && Math.max(localLeft, localUp) >= 0) a = -a;
  return a * 0.15915493667125702;
}

/** lightToSurface is already normalized and transformed to source light axes:
 * [dot(matrixLeft,D), dot(matrixUp,D), dot(matrixForward,D)]. No V flip. */
export function sourceIesUv(lightToSurface) {
  return [sourceIesLongitude(lightToSurface[0], lightToSurface[1]),
    lightToSurface[2] * .5 + .5];
}

/** Source ordinary punctual BRDF, excluding NdotL, light color, attenuation,
 * per-channel switches, IES/shadows, exposure and framebuffer saturation.
 * NdotV is signed; all other dot inputs are saturated by the source shader. */
export function sourcePunctualBrdf({baseColor, metalness, reflectance = .5,
  roughness, dotNV, dotNL, dotNH, dotLH}) {
  const nv = Math.abs(dotNV) + NV_EPS, nl = sat(dotNL), nh = sat(dotNH), lh = sat(dotLH);
  const alpha = Math.max(roughness * roughness, 0.0020000000949949026);
  const a2 = alpha * alpha;
  const visibility = .5 / (nv * Math.sqrt(a2 + nl * nl * (1 - a2))
    + nl * Math.sqrt(a2 + nv * nv * (1 - a2)));
  const denominator = 1 + nh * nh * (a2 - 1);
  const distribution = a2 / (denominator * denominator);
  const f0 = baseColor.map(c => .16 * reflectance * reflectance * (1 - metalness) + c * metalness);
  const f90 = sat(50 * .33 * (f0[0] + f0[1] + f0[2]));
  const fresnelPower = pow5(1 - lh);
  const specular = f0.map(c => (c + (f90 - c) * fresnelPower) * distribution * visibility * INV_PI);
  const fd90 = roughness * (.5 + 2 * lh * lh);
  const diffuseFactor = (1 - 0.33774834871292114 * roughness)
    * (1 + (fd90 - 1) * pow5(1 - nl)) * (1 + (fd90 - 1) * pow5(1 - nv)) * INV_PI;
  return {diffuse: baseColor.map(c => c * (1 - metalness) * diffuseFactor), specular};
}

export const SOURCE_DIRECT_LIGHT_GLSL = /* glsl */`
float bf2_punctualDistanceAttenuation(float distanceSquared, float inverseRadiusSquared, float attenuationOffset) {
  float q = distanceSquared * inverseRadiusSquared;
  float w = max(1.0 - q * q, 0.0);
  return w * w / max(distanceSquared + attenuationOffset, 0.0001);
}
float bf2_punctualAngleAttenuation(float cosine, float scale, float offset) {
  float w = clamp(cosine * scale + offset, 0.0, 1.0);
  return w * w;
}
float bf2_iesLongitude(vec2 axes) {
  vec2 a = abs(axes);
  if (max(a.x, a.y) == 0.0) return 0.0;
  float q = min(a.x, a.y) / max(a.x, a.y), s = q * q;
  float p = ((((0.02083509974181652 * s - 0.08513300120830536) * s
    + 0.18014100193977356) * s - 0.3302994966506958) * s + 0.9998660087585449) * q;
  float angle = a.x < a.y ? 1.5707963705062866 - p : p;
  if (axes.x < 0.0) angle -= 3.1415927410125732;
  if (min(axes.x, axes.y) < 0.0 && max(axes.x, axes.y) >= 0.0) angle = -angle;
  return angle * 0.15915493667125702;
}
vec2 bf2_iesUv(vec3 lightToSurfaceInSourceAxes) {
  return vec2(bf2_iesLongitude(lightToSurfaceInSourceAxes.xy), lightToSurfaceInSourceAxes.z * 0.5 + 0.5);
}
void bf2_punctualBrdf(vec3 baseColor, float metalness, float reflectance, float roughness,
  float dotNV, float dotNL, float dotNH, float dotLH, out vec3 diffuse, out vec3 specular) {
  float nv = abs(dotNV) + 0.00001;
  float nl = clamp(dotNL, 0.0, 1.0), nh = clamp(dotNH, 0.0, 1.0), lh = clamp(dotLH, 0.0, 1.0);
  float alpha = max(roughness * roughness, 0.002), a2 = alpha * alpha;
  float visibility = 0.5 / (nv * sqrt(a2 + nl * nl * (1.0 - a2)) + nl * sqrt(a2 + nv * nv * (1.0 - a2)));
  float denominator = 1.0 + nh * nh * (a2 - 1.0);
  vec3 f0 = mix(vec3(0.16 * reflectance * reflectance), baseColor, metalness);
  float f90 = clamp(50.0 * dot(f0, vec3(0.33)), 0.0, 1.0);
  float f = 1.0 - lh, f2 = f * f;
  specular = (f0 + (vec3(f90) - f0) * (f2 * f2 * f)) * (a2 / (denominator * denominator)) * visibility * 0.31830987334251404;
  float fd90 = roughness * (0.5 + 2.0 * lh * lh);
  float l = 1.0 - nl, v = 1.0 - nv, l2 = l * l, v2 = v * v;
  float fd = (1.0 - 0.33774834871292114 * roughness) * (1.0 + (fd90 - 1.0) * l2 * l2 * l) * (1.0 + (fd90 - 1.0) * v2 * v2 * v);
  diffuse = baseColor * (1.0 - metalness) * fd * 0.31830987334251404;
}
`;
