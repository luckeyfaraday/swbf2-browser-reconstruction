// LOCAL-BLASTER-BOLT-PIXEL-001. Native PS5f93c17d04; register names retained
// until parent particle/vertex-buffer bindings are completely established.
// PSabf28c9265 uses shifted varyings and additional final factor1-v6.w.
struct BlasterBoltVaryings {
  vec4 v1; vec4 v2; vec4 v3; vec4 v4; vec4 v5; vec4 v7;
  vec3 worldPosition;
  vec2 uv;
};
struct BlasterBoltPixel { vec3 radiance; vec4 depthCoverage; };
BlasterBoltPixel sampleBlasterBolt(BlasterBoltVaryings v, vec3 screenPosition,
  vec2 inverseViewport, vec3 cameraPosition, vec3 materialMultiplier,
  vec4 nativeGlobal40, float auxiliaryFade,
  sampler2D sideMap, sampler2D topMap, sampler2D irisMap, sampler2D screenFlareMap) {
  vec2 radial = fract(v.uv) * 2.0 - 1.0;
  float disc = max(1.0 - length(radial), 0.0);
  disc *= disc;
  disc *= texture2D(irisMap, v.uv).r;
  disc *= texture2D(screenFlareMap, screenPosition.xy * inverseViewport).r + 0.1;
  vec2 sideUv = vec2(clamp(v.uv.x, 0.01, 0.99), 0.5 - abs(v.uv.y - 0.5));
  float side = texture2D(sideMap, sideUv).a * 3.0;
  float top = clamp((texture2D(topMap, v.uv).a - 0.01) * 1.01, 0.0, 1.0);
  float shape = mix(top, side, v.v1.x);
  float distanceFade = clamp((length(v.worldPosition - cameraPosition) - 0.2) * 10.0, 0.0, 1.0);
  float segment = clamp((v.v1.z - v.v7.x) * v.v1.y, 0.0, 1.0)
                * clamp((v.v7.x - v.v1.w) * v.v1.y, 0.0, 1.0);
  float core = sqrt(shape) * segment;
  float bodyCoverage = shape * v.v7.y * 0.3 * distanceFade * segment;
  float opacity = bodyCoverage * v.v7.z;
  float flareGate = ceil(clamp(v.v5.w, 0.0, 1.0));
  float coverage = clamp(mix(opacity, disc * 0.9, flareGate), 0.0, 1.0);
  float phase = clamp(opacity + v.v3.w * (1.0 - opacity - clamp(v.v7.x, 0.0, 1.0)), 0.0, 1.0);
  phase = pow(phase, v.v2.w);
  vec3 firstColor = mix(v.v2.rgb, v.v4.rgb, v.v4.w);
  vec3 secondColor = mix(v.v3.rgb, v.v5.rgb, v.v4.w);
  vec3 color = mix(secondColor, firstColor, phase);
  float globalFactor = nativeGlobal40.w + (1.0 - nativeGlobal40.w) * 0.25;
  vec3 coreRadiance = max(core * materialMultiplier * 5.0 * globalFactor * color * v.v7.w, vec3(0.0));
  vec3 flareRadiance = v.v5.w * v.v7.z * (firstColor + secondColor) * globalFactor;
  BlasterBoltPixel result;
  result.radiance = coverage * mix(coreRadiance, flareRadiance, flareGate) * auxiliaryFade * nativeGlobal40.z;
  result.depthCoverage = vec4(screenPosition.z, 1.0, 0.0, coverage);
  // Native render target0 alpha is always0. Render target2 carries coverage.
  return result;
}
