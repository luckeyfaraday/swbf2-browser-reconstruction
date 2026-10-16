// Original PS1e3d99cec3 / five-atlas PS1c6f05ad3a: CS + NW, original UV0.
struct PropsNonmetalSurface {
  vec3 color;
  vec3 tangentNormal;
  float smoothness;
};
PropsNonmetalSurface samplePropsNonmetal(vec2 uv, sampler2D baseMap, sampler2D normalMap) {
  vec4 cs=texture2D(baseMap,uv);
  vec2 xy=texture2D(normalMap,uv).xy*2.0-1.0;
  PropsNonmetalSurface surface;
  surface.color=cs.rgb;
  surface.smoothness=cs.a;
  surface.tangentNormal=vec3(xy,sqrt(max(1.0-dot(xy,xy),0.0)));
  return surface;
}
