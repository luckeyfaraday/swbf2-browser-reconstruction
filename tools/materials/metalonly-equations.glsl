// LOCAL-METALONLY-SHADER-001; deferred PS 85476b5805, paired VS 282854795b.
// World position and geometric normal retain native world axes. The geometric
// normal is normalized at each vertex, then interpolated, as in the native VS.
// All packed RGBA channels and cb[0..4] source float32 constants are preserved.
struct MetalOnlySurface {
  vec3 color;
  vec3 tangentNormal;
  float smoothness;
  float materialScalar;
  float ao;
};

MetalOnlySurface sampleMetalOnly(
  vec2 uv, vec3 worldPosition, vec3 geometricNormal, vec4 cb[5],
  sampler2D globalWearMap, sampler2D wearMap, sampler2D normalAOMap,
  sampler2D grungeMap, sampler2D metalCSMap, sampler2D metalNormalMap,
  sampler2D aluminiumMap
) {
  vec2 tiled = uv * cb[1].xy;
  vec4 aluminium = texture2D(aluminiumMap, tiled);
  vec4 metalCS = texture2D(metalCSMap, tiled);
  vec4 metalNormal = texture2D(metalNormalMap, tiled * 2.0);
  vec4 wear = texture2D(wearMap, uv);
  vec4 globalWear = texture2D(globalWearMap, tiled * 3.0);
  vec4 base = texture2D(normalAOMap, uv);
  float scratch = wear.r * (0.48 + 1.04 * globalWear.b);
  float dirt = 2.0 * wear.g * globalWear.a;
  float restore = clamp(2.0 * globalWear.g * wear.a / cb[2].x, 0.0, 1.0);

  float smoothness0 = 2.0 * pow(metalCS.g, 1.5);
  float smoothness = mix(smoothness0, 0.042311400175094604, scratch);
  smoothness = mix(smoothness, smoothness0 + 1.0, dirt);
  smoothness = mix(smoothness, 0.007499000057578087, wear.b);
  smoothness = mix(smoothness, 0.8 * aluminium.a, restore);
  float grungeZY = texture2D(grungeMap, worldPosition.zy * 0.1).g;
  float grungeXY = texture2D(grungeMap, worldPosition.xy * 0.1).g;
  float grunge = mix(grungeXY, grungeZY, clamp(2.0 * abs(geometricNormal.x) - 1.0, 0.0, 1.0));
  float grungeWeight = (1.0 - grunge) * (1.0 - abs(geometricNormal.y));
  smoothness = mix(smoothness + 0.2, smoothness, grungeWeight);

  vec3 color = mix(cb[4].rgb, cb[3].rgb, scratch);
  color = mix(color, vec3(0.17144109308719635), dirt);
  color = mix(color, cb[0].rgb, wear.b);
  color = mix(color, vec3(0.32314321398735046), restore);

  vec2 baseXY = 2.0 * base.rg - 1.0;
  float baseZ = sqrt(max(1.0 - dot(baseXY, baseXY), 0.0));
  vec2 detail = 2.0 * vec2(metalNormal.r * metalNormal.a, metalNormal.g) - 1.0;
  // Native add_sat: this differs from the general Master1UV shader.
  detail = mix(detail, 2.0 * aluminium.rg - 1.0, clamp(wear.r + wear.g, 0.0, 1.0));

  float scalar = 0.5 * metalCS.r;
  float dirtScalar = clamp(scalar + 0.7, 0.0, 1.0);
  scalar = mix(scalar, 0.15, scratch);
  scalar = mix(scalar, dirtScalar, dirt);
  scalar = mix(scalar, 0.9, restore);

  MetalOnlySurface result;
  result.color = color;
  result.tangentNormal = vec3(baseXY + detail, baseZ);
  result.smoothness = smoothness; // Native o0.z is unclamped.
  result.materialScalar = scalar; // Native ID0 o2.y metalness; o2.z reflectance=.5.
  result.ao = base.a; // Source base.b is unused; no emissive term is present.
  return result;
}
