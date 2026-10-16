// Original PS 750135c350: raw source-world normal and surface-to-camera view.
// Exact original float32 literal values, no source frame exposure applied here.
struct VolcanicObjectPrelighting {
  vec3 rgb;
  float skyVisibility;
};
VolcanicObjectPrelighting volcanicObjectPrelighting(vec4 c[9], vec3 n, vec3 view,
    float sourceSmoothness, float broadenedSpecularScale) {
  vec3 value = c[0].rgb + n.x * c[1].rgb + n.y * c[2].rgb + n.z * c[3].rgb;
  value += (3.0 * n.y * n.y - 1.0) * c[4].rgb + n.x * n.y * c[5].rgb;
  value += n.y * n.z * c[6].rgb + n.x * n.z * c[7].rgb + (n.x * n.x - n.z * n.z) * c[8].rgb;
  if (broadenedSpecularScale > 0.0) {
    vec3 sums = vec3(c[1].r+c[1].g+c[1].b, c[2].r+c[2].g+c[2].b, c[3].r+c[3].g+c[3].b);
    float average = (c[0].r+c[0].g+c[0].b) * 0.3333333432674408;
    vec3 dominant = sums * 0.23333333432674408 / max(average, 9.999999747378752e-6);
    float strength = length(dominant);
    // Native positive-scale path has no special zero-direction/half-vector guard.
    vec3 light = dominant / strength;
    vec3 halfVector = normalize(view + light);
    float nv = abs(dot(n, view)) + 9.999999747378752e-6;
    float nl = clamp(dot(n, light), 0.0, 1.0);
    float nh = clamp(dot(n, halfVector), 0.0, 1.0);
    float lh = clamp(dot(light, halfVector), 0.0, 1.0);
    float s = clamp(sourceSmoothness, 0.0, 1.0);
    float broadening = 1.0 - sqrt(s) * strength;
    float alpha = max(broadening * broadening, 0.0020000000949949026);
    float alpha2 = alpha * alpha;
    float visibility = 0.5 / (nl * sqrt(nv * nv * (1.0-alpha2) + alpha2) + nv * sqrt(nl * nl * (1.0-alpha2) + alpha2));
    float denominator = 1.0 + nh * nh * (alpha2 - 1.0);
    float distribution = alpha2 / (denominator * denominator);
    float f = 1.0-lh, f2 = f*f;
    float fresnel = 0.25 + 0.75*f2*f2*f;
    float fade = max((0.9375-s)*1.0666667222976685,0.0);
    float specular = distribution*visibility*fresnel*fade*fade*(3.0-2.0*fade)*min(4.0*nl,1.0);
    value += broadenedSpecularScale * 2.200000047683716 * c[0].rgb * specular;
  }
  VolcanicObjectPrelighting result;
  result.rgb = max(value, vec3(0.0));
  result.skyVisibility = max(dot(vec4(n, 1.0), vec4(c[1].w,c[2].w,c[3].w,c[0].w)),0.0);
  return result;
}
