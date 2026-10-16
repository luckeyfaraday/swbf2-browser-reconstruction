// LOCAL-CEILING-SHADER-001. Deferred PS 1fb4d25b38, VS dfb8f760fb.
struct CeilingSurface {
  vec3 color;
  vec3 tangentNormal;
  vec3 emissive;
  float smoothness;
  float nativeScalar;
};
CeilingSurface sampleCeiling(vec2 uv, vec4 cb[5], sampler2D maskMap,
                            sampler2D metalCSMap, sampler2D metalNormalMap) {
  vec2 tiled = uv * cb[0].x;
  vec2 metalCS = texture2D(metalCSMap, tiled).rg;
  vec4 n = texture2D(metalNormalMap, tiled * 2.0);
  vec2 xy = 2.0 * vec2(n.r * n.a, n.g) - 1.0;
  float mask = clamp(texture2D(maskMap, uv).r * 1.1111111640930176 - 0.111111119389534, 0.0, 1.0);
  CeilingSurface result;
  result.color = mix(cb[4].rgb, vec3(1.0), mask);
  result.tangentNormal = vec3(xy, sqrt(max(1.0 - dot(xy, xy), 0.0)));
  result.smoothness = 2.0 * pow(metalCS.g, 1.5);
  result.nativeScalar = 0.5 * metalCS.r;
  result.emissive = mask * cb[1].rgb * (cb[2].x * cb[3].x);
  return result;
}
