// Original CatwalkSystem_Preset_01 PS d260c7f82c / atlas PS 3b42a4bca7.
struct Catwalk1Surface {
  vec3 color;
  vec3 tangentNormal;
  float smoothness;
};
Catwalk1Surface sampleCatwalk1(vec2 uv, vec3 worldPosition, vec4 cb[1],
  sampler2D baseMap, sampler2D normalMap, sampler2D detailMap, sampler2D grungeMap) {
  vec4 cs = texture2D(baseMap, uv);
  vec4 grunge = texture2D(grungeMap, worldPosition.xz * 0.1);
  vec3 detail = texture2D(detailMap, uv * cb[0].xy).rgb;
  // Native NW sampler clamps U/V; CS, NS and grunge samplers wrap U/V.
  vec2 nw = texture2D(normalMap, uv).rg;
  vec2 detailXY = detail.rg * 2.0 - 1.0;
  float detailZ = sqrt(max(1.0 - dot(detailXY, detailXY), 0.0));
  Catwalk1Surface result;
  result.color = cs.rgb * grunge.rgb;
  result.smoothness = cs.a * grunge.a * detail.b;
  result.tangentNormal = normalize(vec3(detailXY + nw * 2.0 - 1.0, detailZ));
  return result;
}
