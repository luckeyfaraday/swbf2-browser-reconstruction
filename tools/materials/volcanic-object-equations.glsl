// Original PS 750135c350. Texture channels are used exactly as sampled.
struct VolcanicObjectSurface {
  vec3 color;
  vec3 baseTangentNormal;
  vec3 metalTangentNormal;
  vec3 fabricTangentNormal;
  float detailMix;
  float smoothness;
  float metalness;
  float broadenedSpecularScale;
};
VolcanicObjectSurface sampleVolcanicObject(vec2 uv, vec4 cb[4],
    sampler2D baseMap, sampler2D normalMap, sampler2D metalDetailMap, sampler2D fabricDetailMap) {
  vec4 metalDetail = texture2D(metalDetailMap, uv * cb[0].xy);
  vec4 fabricDetail = texture2D(fabricDetailMap, uv * cb[1].xy);
  vec4 base = texture2D(baseMap, uv);
  vec4 normal = texture2D(normalMap, uv);
  float detailAlpha = fabricDetail.a + base.a * (metalDetail.a - fabricDetail.a);
  VolcanicObjectSurface result;
  result.color = 2.0 * base.rgb * cb[2].x * detailAlpha;
  result.smoothness = 2.0 * normal.a * detailAlpha;
  result.metalness = 2.0 * base.a * detailAlpha;
  result.baseTangentNormal = normal.rgb * 2.0 - 1.0;
  result.metalTangentNormal = metalDetail.rgb * 2.0 - 1.0;
  result.fabricTangentNormal = fabricDetail.rgb * 2.0 - 1.0;
  result.detailMix = base.a;
  result.broadenedSpecularScale = cb[3].x;
  return result;
}
// The native TBN maps each vector BEFORE its individual normalization.
// Keep the sum unnormalized for SH; normalize only the eventual surface normal.
vec3 volcanicObjectPrelightingNormal(mat3 worldFrame, VolcanicObjectSurface surface) {
  vec3 baseWorld = normalize(worldFrame * surface.baseTangentNormal);
  vec3 metalWorld = normalize(worldFrame * surface.metalTangentNormal);
  vec3 fabricWorld = normalize(worldFrame * surface.fabricTangentNormal);
  return baseWorld + fabricWorld + surface.detailMix * (metalWorld - fabricWorld);
}
