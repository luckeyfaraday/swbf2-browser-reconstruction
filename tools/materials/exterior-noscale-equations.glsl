// LOCAL-EXTERIOR-NOSCALE-SHADER-001; native deferred PS87f18d3646.
struct ExteriorNoScaleSurface {
  vec3 color;
  vec3 baseTangentNormal;
  vec3 detailTangentNormal;
  float smoothness;
  float metalness;
  float ao;
};
ExteriorNoScaleSurface sampleExteriorNoScale(vec2 uv, vec4 cb[5], sampler2D baseMap, sampler2D detailMap) {
  vec4 base = texture2D(baseMap, uv);
  vec4 detail = texture2D(detailMap, uv * cb[0].xy);
  vec2 baseXY = base.rg * 2.0 - 1.0;
  float baseZ = sqrt(max(1.0 - dot(baseXY, baseXY), 0.0));
  float response = 2.0 * (1.0 - base.a) * detail.a;
  ExteriorNoScaleSurface result;
  result.color = 2.0 * detail.a * mix(cb[1].rgb, cb[2].rgb, base.a);
  result.baseTangentNormal = vec3(baseXY, baseZ);
  result.detailTangentNormal = detail.rgb * 2.0 - 1.0;
  result.smoothness = response * cb[3].x;
  result.metalness = response * cb[4].x;
  result.ao = base.b;
  // Transform and normalize the two normals separately before the WORLD-axis
  // blend. The unnormalized sum drives SH; its normalization is G-buffer only.
  return result;
}
vec3 exteriorNoScalePrelightingNormal(vec3 baseWorld, vec3 detailWorld) {
  return normalize(baseWorld) + normalize(detailWorld) * vec3(1.0, 1.0, 0.0);
}
