// LOCAL-CATWALK2-SHADER-001. Deferred PS 2b6d233517, paired VS ea0522bd70.
// Source absolute world XZ drives grunge; source UV0 drives authored normals.
struct Catwalk2Surface {
  vec3 color;
  vec3 tangentNormal;
  float smoothness;
};
Catwalk2Surface sampleCatwalk2(vec2 uv, vec3 worldPosition, vec4 cb[1],
  sampler2D baseMap, sampler2D detailMap, sampler2D grungeMap) {
  vec4 base = texture2D(baseMap, uv);
  vec4 grunge = texture2D(grungeMap, worldPosition.xz * 0.1);
  vec3 detail = texture2D(detailMap, uv * cb[0].xy).rgb;
  vec2 detailXY = detail.rg * 2.0 - 1.0;
  float detailZ = sqrt(max(1.0 - dot(detailXY, detailXY), 0.0));
  Catwalk2Surface result;
  result.color = base.b * grunge.rgb;
  result.smoothness = base.a * grunge.a * detail.b;
  result.tangentNormal = normalize(vec3(detailXY + base.rg * 2.0 - 1.0, detailZ));
  // Native ordinary material ID0: metalness0, reflectance0.5 (dielectric F0=.04).
  // No AO, emissive, opacity or metalness is encoded in these packed inputs.
  return result;
}
