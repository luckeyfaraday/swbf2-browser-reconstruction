// Original PS52d055444c, t2=NAM, t3=ten-layer detail array, t4=CS.
struct Array2UvSurface {
  vec3 color;
  float smoothness;
  vec3 tangentNormal;
  float metalness;
};
Array2UvSurface sampleArray2Uv(vec2 normalDetailUv, vec2 surfaceUv, vec4 cb[2],
    sampler2D normalArrayMetal, highp sampler2DArray detailArray, sampler2D colorSmoothness) {
  vec4 namSurface = texture2D(normalArrayMetal, surfaceUv);
  vec3 detail = texture(detailArray, vec3(normalDetailUv * cb[0].xy, namSurface.b * 10.0)).rgb;
  vec4 base = texture2D(colorSmoothness, surfaceUv);
  float boundedWeight = clamp(cb[1].x, 0.0, 1.0);
  vec2 normalXY = 2.0 * texture2D(normalArrayMetal, clamp(normalDetailUv, 0.0, 1.0)).rg - 1.0;
  float normalZ = sqrt(max(1.0 - dot(normalXY, normalXY), 0.0));
  Array2UvSurface surface;
  surface.color = mix(base.rgb, 2.0 * base.rgb * detail.b, boundedWeight);
  surface.smoothness = mix(base.a, 2.0 * base.a * detail.b, boundedWeight);
  // The original weight is UNSATURATED here; wreckage selects3 or5.
  surface.tangentNormal = normalize(vec3(normalXY + (2.0 * detail.rg - 1.0) * cb[1].x, normalZ));
  surface.metalness = namSurface.a;
  return surface;
}
