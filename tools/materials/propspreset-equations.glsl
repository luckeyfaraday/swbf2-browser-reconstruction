// Original c13680b516 / 93681d7ffd / 3352783e34 / 34120bd05e.
// BF2_PROPS_FAMILY: 0 clampAll, 1 clampVertical, 2 emissiveTwoUV, 3 lodSimple.
struct PropsPresetSurface {
  vec3 color;
  vec3 tangentNormal;
  vec3 emissive;
  float smoothness;
  float metalness;
};

PropsPresetSurface samplePropsPreset(vec2 uv0, vec2 uv1, vec4 cb[5],
    sampler2D colorSmoothness, sampler2D normalPacked
    #if BF2_PROPS_FAMILY != 3
      , highp sampler2DArray detailArray
    #endif
) {
  PropsPresetSurface surface;
  #if BF2_PROPS_FAMILY == 2
    vec2 baseUv = uv1;
  #else
    vec2 baseUv = uv0;
  #endif
  vec4 cs = texture(colorSmoothness, baseUv);
  vec4 packedTexel = texture(normalPacked, baseUv);
  #if BF2_PROPS_FAMILY == 0 || BF2_PROPS_FAMILY == 2
    vec2 normalUv = clamp(uv0, 0.0, 1.0);
  #else
    vec2 normalUv = vec2(uv0.x, clamp(uv0.y, 0.0, 1.0));
  #endif
  vec2 baseNormal = texture(normalPacked, normalUv).rg * 2.0 - 1.0;
  float normalZ = sqrt(max(0.0, 1.0 - dot(baseNormal, baseNormal)));
  #if BF2_PROPS_FAMILY == 3
    surface.color = 2.0 * cs.rgb * cb[0].rgb;
    surface.smoothness = cs.a;
    surface.tangentNormal = vec3(baseNormal, normalZ);
  #else
    #if BF2_PROPS_FAMILY == 2
      vec2 detailScale = cb[3].xy;
      vec3 tint = cb[4].rgb;
    #else
      vec2 detailScale = cb[0].xy;
      vec3 tint = cb[1].rgb;
    #endif
    vec3 detail = texture(detailArray, vec3(uv0 * detailScale, packedTexel.b * 10.0)).rgb;
    surface.color = 4.0 * cs.rgb * detail.b * tint;
    surface.smoothness = 2.0 * cs.a * detail.b;
    surface.tangentNormal = vec3(baseNormal + (2.0 * detail.rg - 1.0), normalZ);
  #endif
  #if BF2_PROPS_FAMILY == 2
    surface.metalness = cb[2].x;
    surface.emissive = packedTexel.a * cb[0].rgb * cb[1].x;
  #else
    surface.metalness = packedTexel.a;
    surface.emissive = vec3(0.0);
  #endif
  return surface;
}
