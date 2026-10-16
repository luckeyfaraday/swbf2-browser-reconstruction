// BF2-NATIVE-STATIC-ATLAS-PS-WARP-001 / BF2-NATIVE-STATIC-ATLAS-MATH-001.
// Original floor PS f789fdaafa, t2..t6. This is the shader arithmetic only:
// atlas selection, filtering, UV transforms, and frame state are separate.
export const SOURCE_STATIC_ATLAS_POLICY = Object.freeze({
  evidenceId: 'BF2-NATIVE-STATIC-ATLAS-MATH-001',
  pixelShaderSha256: 'f7ff1387f56e121bd57abccb6871b2295793935e2cb46d72e4397cca35dac3bf',
  directions: 'Three RGB vectors decoded as 2 * atlas.rgb - 1; source world space.',
  inputs: 'Normalized source world normal and surface-to-camera view; source GBuffer0.z smoothness.',
  output: 'Native GBuffer3 before cb2[40].x frame exposure; replaces the SH diffuse input.',
  composition: 'Deferred combine subsequently applies source DFG.b, (1-metalness), albedo, and diffuse occlusion.',
  limits: 'LightMapPreExposure must be supplied explicitly. A zero average direction or opposing view has native undefined normalization; no invented epsilon. Scene adapters must separately establish source texture/UV/material bindings.',
});

const C0 = 0.2820949852466583, C1 = 0.48860299587249756;
const saturate = value => Math.max(0, Math.min(1, value));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize = vector => {
  const length = Math.hypot(...vector);
  return vector.map(value => value / length);
};

function directionalWeight(direction, normal) {
  const scaled = direction.map(value => value * C1), length = Math.hypot(...scaled);
  if (length === 0) return C0; // Original explicit branch, independently per RGB lobe.
  const cosine = dot(scaled.map(value => value / length), normal);
  const t = (1 + cosine) * .5, t2 = t * t;
  return C0 + 2 * length / (length + C0) * C0 *
    ((2 * t2 * t - t2 * t2) * 3.3333332538604736 - 1);
}

/** Source RGB irradiance and three already-decoded direction vectors. The
 * exposure multiplier is mandatory so fixture value 1 cannot become an
 * accidental native-frame assumption. Sky visibility is the exact t6.r lane. */
export function evaluateSourceStaticAtlas({irradiance, directions, normal, view, smoothness,
  lightMapPreExposure, skyVisibility}) {
  if (!Number.isFinite(lightMapPreExposure) || lightMapPreExposure < 0) {
    throw new TypeError('Source static atlas requires an explicit finite LightMapPreExposure');
  }
  const diffuseWeights = directions.map(direction => directionalWeight(direction, normal));
  const average = [0, 1, 2].map(axis =>
    (directions[0][axis] + directions[1][axis] + directions[2][axis]) * 0.3333333432674408);
  const dominantLength = Math.hypot(...average), light = average.map(value => value / dominantLength);
  const half = normalize(light.map((value, axis) => value + view[axis]));
  const nv = Math.abs(dot(normal, view)) + 9.999999747378752e-6;
  const nl = saturate(dot(normal, light)), nh = saturate(dot(normal, half)), lh = saturate(dot(light, half));
  const s = saturate(smoothness), broadening = 1 - Math.sqrt(s) * dominantLength;
  const alpha = Math.max(broadening * broadening, 0.0020000000949949026), alpha2 = alpha * alpha;
  const visibility = .5 / (nl * Math.sqrt((1 - alpha2) * nv * nv + alpha2) +
    nv * Math.sqrt((1 - alpha2) * nl * nl + alpha2));
  const denominator = ((alpha2 - 1) * nh * nh + 1);
  const distribution = alpha2 / (denominator * denominator);
  const f = 1 - lh, f2 = f * f, fresnel = .25 + .75 * f2 * f2 * f;
  const fade = Math.max((.9375 - s) * 1.0666667222976685, 0);
  const bakedSpecularWeight = distribution * visibility * fresnel *
    fade * fade * (3 - 2 * fade) * Math.min(4 * nl, 1);
  return {
    prelighting: irradiance.map((value, channel) => value * lightMapPreExposure *
      (diffuseWeights[channel] + bakedSpecularWeight)),
    diffuseWeights, bakedSpecularWeight, skyVisibility,
  };
}

// No texture declarations: the material adapter must prove its own source
// atlas/UV binding and can pack these five source samples without extra units.
export const SOURCE_STATIC_ATLAS_GLSL = /* glsl */`
float bf2_staticAtlasDirectionalWeight(vec3 direction, vec3 normal) {
  const float c0 = 0.2820949852466583;
  vec3 scaled = direction * 0.48860299587249756;
  float magnitude = length(scaled);
  if (magnitude == 0.0) return c0;
  float t = (1.0 + dot(scaled / magnitude, normal)) * 0.5;
  float t2 = t * t;
  return c0 + (2.0 * magnitude / (magnitude + c0)) * c0 *
    ((2.0 * t2 * t - t2 * t2) * 3.3333332538604736 - 1.0);
}
vec3 bf2_staticAtlasPrelighting(vec3 irradiance, vec3 directionR, vec3 directionG,
    vec3 directionB, vec3 normal, vec3 view, float sourceSmoothness, float lightMapPreExposure) {
  vec3 weights = vec3(bf2_staticAtlasDirectionalWeight(directionR, normal),
    bf2_staticAtlasDirectionalWeight(directionG, normal), bf2_staticAtlasDirectionalWeight(directionB, normal));
  vec3 average = (directionR + directionG + directionB) * 0.3333333432674408;
  float dominantLength = length(average);
  vec3 light = average / dominantLength;
  vec3 halfVector = normalize(light + view);
  float nv = abs(dot(normal, view)) + 9.999999747378752e-6;
  float nl = clamp(dot(normal, light), 0.0, 1.0);
  float nh = clamp(dot(normal, halfVector), 0.0, 1.0);
  float lh = clamp(dot(light, halfVector), 0.0, 1.0);
  float s = clamp(sourceSmoothness, 0.0, 1.0);
  float broadening = 1.0 - sqrt(s) * dominantLength;
  float alpha = max(broadening * broadening, 0.0020000000949949026);
  float alpha2 = alpha * alpha;
  float visibility = 0.5 / (nl * sqrt((1.0 - alpha2) * nv * nv + alpha2) +
    nv * sqrt((1.0 - alpha2) * nl * nl + alpha2));
  float denominator = (alpha2 - 1.0) * nh * nh + 1.0;
  float distribution = alpha2 / (denominator * denominator);
  float f = 1.0 - lh, f2 = f * f;
  float fresnel = 0.25 + 0.75 * f2 * f2 * f;
  float fade = max((0.9375 - s) * 1.0666667222976685, 0.0);
  float specular = distribution * visibility * fresnel * fade * fade *
    (3.0 - 2.0 * fade) * min(4.0 * nl, 1.0);
  return (irradiance * lightMapPreExposure) * (weights + vec3(specular));
}
`;
