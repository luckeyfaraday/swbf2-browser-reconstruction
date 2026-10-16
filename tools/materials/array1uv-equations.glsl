// Original PSdfa7a16109: t2 NAM at s1, t3 array and t4 CS at s0.
struct Array1UvSurface {
  vec3 color;
  float smoothness;
  vec3 tangentNormal;
  float metalness;
};
Array1UvSurface sampleArray1Uv(vec2 uvValue, vec4 cb[2], sampler2D normalArrayMetal,
    highp sampler2DArray detailArray, sampler2D colorSmoothness) {
  vec4 nam = texture2D(normalArrayMetal, uvValue);
  vec3 detail = texture(detailArray, vec3(uvValue * cb[0].xy, nam.b * 10.0)).rgb;
  vec4 base = texture2D(colorSmoothness, uvValue);
  vec2 xy = 2.0 * nam.rg - 1.0;
  float z = sqrt(max(1.0 - dot(xy, xy), 0.0));
  Array1UvSurface surface;
  surface.color = 2.0 * base.rgb * detail.b;
  surface.smoothness = 2.0 * base.a * detail.b;
  // Unlike the 2UV variant, detail weight affects ONLY normal detail.
  surface.tangentNormal = normalize(vec3(xy + (2.0 * detail.rg - 1.0) * cb[1].x, z));
  surface.metalness = nam.a;
  return surface;
}
