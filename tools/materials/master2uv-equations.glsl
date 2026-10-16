// LOCAL-MASTER2UV-SHADER-001. Source material math from deferred PS 2304f89b0d.
// Packed textures must retain all RGBA channels. Input samplers must reproduce
// the source view's transfer function; asset format metadata includes both
// UNORM and SRGB inputs. The runtime adapter retains that source distinction.
// worldPosition and geometricNormal use SOURCE world axes, before browser rebasing.
// cb[0..8] are exact per-section constants from material-analysis.json.
// Source material inputs; BF2-NATIVE-GBUFFER-001 confirms ordinary metalness.
struct Master2UVSurface {
  vec3 color;
  vec3 tangentNormal;
  float smoothness;
  float materialScalar;
  float ao;
};

Master2UVSurface sampleMaster2UV(
  vec2 baseUv, vec2 uv, vec3 worldPosition, vec3 geometricNormal, vec4 cb[9],
  sampler2D baseNormalMap, sampler2D globalWearMap, sampler2D wearMap, sampler2D idMap,
  sampler2D normalAOMap, sampler2D grungeMap, sampler2D anodizedMap,
  sampler2D rubberMap, sampler2D metalCSMap, sampler2D metalNormalMap,
  sampler2D aluminiumMap
) {
  vec2 tiled = uv * cb[1].xy;
  vec4 aluminium = texture2D(aluminiumMap, tiled);
  vec4 anodized = texture2D(anodizedMap, tiled);
  vec4 rubberHalf = texture2D(rubberMap, tiled * 0.5);
  vec4 rubber = texture2D(rubberMap, tiled);
  vec4 metalCS = texture2D(metalCSMap, tiled);
  vec4 metalNormal = texture2D(metalNormalMap, tiled * 2.0);
  vec3 id = texture2D(idMap, uv).rgb;
  vec4 wear = texture2D(wearMap, uv);
  vec4 globalWear = texture2D(globalWearMap, tiled * 3.0);
  vec4 base = texture2D(normalAOMap, uv);
  float scratch = wear.r * (0.48 + 1.04 * globalWear.b);
  float dirt = 2.0 * wear.g * globalWear.a;
  float restore = clamp(2.0 * globalWear.g * wear.a / cb[2].x, 0.0, 1.0);

  float smoothness0 = mix(0.8 * aluminium.a, anodized.a * cb[5].x, id.b);
  smoothness0 = mix(smoothness0, rubberHalf.a * cb[7].x, id.g);
  smoothness0 = mix(smoothness0, 2.0 * pow(metalCS.g, 1.5), id.r);
  float smoothness = mix(smoothness0, 0.042311400175094604, scratch);
  smoothness = mix(smoothness, smoothness0 + 1.0, dirt);
  smoothness = mix(smoothness, 0.007499000057578087, wear.b);
  smoothness = mix(smoothness, 0.8 * aluminium.a, restore);
  float grungeZY = texture2D(grungeMap, worldPosition.zy * 0.1).g;
  float grungeXY = texture2D(grungeMap, worldPosition.xy * 0.1).g;
  float grunge = mix(grungeXY, grungeZY, clamp(2.0 * abs(geometricNormal.x) - 1.0, 0.0, 1.0));
  float grungeWeight = (1.0 - grunge) * (1.0 - abs(geometricNormal.y));
  smoothness = mix(smoothness + 0.2, smoothness, grungeWeight);

  vec3 color = mix(vec3(0.32314321398735046), cb[4].rgb, id.b);
  color = mix(color, cb[6].rgb, id.g);
  color = mix(color, cb[8].rgb, id.r);
  color = mix(color, cb[3].rgb, scratch);
  color = mix(color, vec3(0.17144109308719635), dirt);
  color = mix(color, cb[0].rgb, wear.b);
  color = mix(color, vec3(0.32314321398735046), restore);

  vec2 baseXY = 2.0 * texture2D(baseNormalMap, baseUv).rg - 1.0;
  float baseZ = sqrt(max(1.0 - dot(baseXY, baseXY), 0.0));
  vec2 detail = 2.0 * aluminium.rg - 1.0;
  detail = mix(detail, 2.0 * anodized.rg - 1.0, id.b);
  detail = mix(detail, 2.0 * rubber.rg - 1.0, id.g);
  detail = mix(detail, 2.0 * vec2(metalNormal.r * metalNormal.a, metalNormal.g) - 1.0, id.r);
  detail = mix(detail, 2.0 * aluminium.rg - 1.0, wear.r + wear.g);

  float scalar = mix(0.9 * (1.0 - id.g), 0.5 * metalCS.r, id.r);
  float dirtScalar = clamp(scalar + 0.7, 0.0, 1.0);
  scalar = mix(scalar, 0.15, scratch);
  scalar = mix(scalar, dirtScalar, dirt);
  scalar = mix(scalar, 0.9, restore);

  Master2UVSurface result;
  result.color = color;
  result.tangentNormal = normalize(vec3(baseXY + (2.0 * base.rg - 1.0) + detail, baseZ));
  result.smoothness = smoothness; // Native deferred o0.z is unclamped.
  result.materialScalar = scalar; // Native deferred o2.y is ordinary material metalness.
  result.ao = base.a; // base.b is NOT emissive in this selected shader.
  return result;
}
