// LOCAL-CORVETTE-DAMAGE-SHADER-001; original deferred PS d92fda6613.
struct CorvetteDamageSurface { vec3 color; vec3 tangentNormal; float smoothness; float metalness; };
CorvetteDamageSurface sampleCorvetteDamage(vec2 baseUv, vec2 tiledUv, float vertexDamage, float arrayLayer,
  sampler2D dirtMap, sampler2D normalMetalMap, sampler2D colorMap,
  highp sampler2DArray detailArrayMap, sampler2D wreckMap) {
  vec3 dirt = texture2D(dirtMap, tiledUv * 6.0).rgb;
  vec3 detail = texture(detailArrayMap, vec3(tiledUv * 3.0, arrayLayer)).rgb;
  vec4 wreck = texture2D(wreckMap, tiledUv * 2.0);
  vec3 base = texture2D(colorMap, baseUv).rgb;
  vec3 normalMetal = texture2D(normalMetalMap, baseUv).rgb;
  float damage = vertexDamage * (1.0 + wreck.a); // Original unsaturated weight.
  float smoothA = mix(1.2 * dirt.r, base.r, 0.5289999842643738);
  float smoothB = mix(dirt.r, detail.b, 0.5270000100135803);
  float smoothness = mix(2.0 * smoothA * smoothB, 0.8, 0.7670000195503235);
  smoothness = mix(smoothness, 1.4 * wreck.b, damage);
  vec2 baseNormalXY = 2.0 * mix(normalMetal.rg, wreck.rg, damage) - 1.0;
  float normalZ = sqrt(max(1.0 - dot(baseNormalXY, baseNormalXY), 0.0));
  vec3 baseColor = base * mix(dirt, base, 0.5730000138282776);
  CorvetteDamageSurface result;
  result.color = mix(baseColor, vec3(wreck.a), damage);
  result.tangentNormal = vec3(baseNormalXY + 2.0 * detail.rg - 1.0, normalZ);
  result.smoothness = smoothness;
  result.metalness = normalMetal.b;
  return result;
}
