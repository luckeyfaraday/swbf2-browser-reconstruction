// Original Tonemap PS prefix. 14158b6b0 uploads 1/authoredExponent.
export function nativeVignetteParameters(settings) {
  if(!settings)return {enabled:false,params:[2,2,1],color:[0,0,0,0]};
  if(settings.evidenceId!=='BF2-NATIVE-VIGNETTE-001'||typeof settings.enabled!=='boolean'||
     !Array.isArray(settings.scale)||settings.scale.length!==2||!Array.isArray(settings.color)||settings.color.length!==3||
     ![...settings.scale,...settings.color,settings.exponent,settings.opacity].every(Number.isFinite)||settings.exponent<=0)
    throw new Error('Unsupported original vignette settings');
  return {enabled:settings.enabled,params:[...settings.scale,Math.fround(1/settings.exponent)],color:[...settings.color,settings.opacity]};
}
export function nativeVignette(color,uv,{scale,exponent,color:vignetteColor,opacity}) {
  const x=(uv[0]-.5)*scale[0],y=(uv[1]-.5)*scale[1];
  const weight=Math.max(0,Math.min(1,1-(x*x+y*y)*opacity))**Math.fround(1/exponent);
  return color.map((value,i)=>(value-vignetteColor[i])*weight+vignetteColor[i]);
}
export const NATIVE_VIGNETTE_GLSL=`
vec3 nativeVignette(vec3 color,vec2 uv,vec3 params,vec4 vignetteColor) {
  vec2 distance=(uv-0.5)*params.xy;
  float base=clamp(1.0-dot(distance,distance)*vignetteColor.a,0.0,1.0);
  float weight=pow(base,params.z);
  return (color-vignetteColor.rgb)*weight+vignetteColor.rgb;
}`;
