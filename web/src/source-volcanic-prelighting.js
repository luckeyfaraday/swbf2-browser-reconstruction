// Original PS750135c350, verified as unchanged DXBC on D3D11 CPU WARP.
export const VOLCANIC_PRELIGHTING_POLICY=Object.freeze({
  evidenceId:'BF2-VOLCANIC-OBJECT-PS-WARP-CHECK-001',
  normal:'Preserve individually normalized mapped-normal sum for SH and broadened specular; normalize only the final surface normal.',
  gate:'Source cb1[3].x > 0 enables and scales broadened SH specular before the final zero clamp.',
  limitations:'Original sampling, native live dispatch and source-to-browser probe selection are separate. Positive-scale zero dominant direction/opposing half-vector retains native undefined normalization.'
});
export const VOLCANIC_PRELIGHTING_GLSL="// Original PS 750135c350: raw source-world normal and surface-to-camera view.\n// Exact original float32 literal values, no source frame exposure applied here.\nstruct VolcanicObjectPrelighting {\n  vec3 rgb;\n  float skyVisibility;\n};\nVolcanicObjectPrelighting volcanicObjectPrelighting(vec4 c[9], vec3 n, vec3 view,\n    float sourceSmoothness, float broadenedSpecularScale) {\n  vec3 value = c[0].rgb + n.x * c[1].rgb + n.y * c[2].rgb + n.z * c[3].rgb;\n  value += (3.0 * n.y * n.y - 1.0) * c[4].rgb + n.x * n.y * c[5].rgb;\n  value += n.y * n.z * c[6].rgb + n.x * n.z * c[7].rgb + (n.x * n.x - n.z * n.z) * c[8].rgb;\n  if (broadenedSpecularScale > 0.0) {\n    vec3 sums = vec3(c[1].r+c[1].g+c[1].b, c[2].r+c[2].g+c[2].b, c[3].r+c[3].g+c[3].b);\n    float average = (c[0].r+c[0].g+c[0].b) * 0.3333333432674408;\n    vec3 dominant = sums * 0.23333333432674408 / max(average, 9.999999747378752e-6);\n    float strength = length(dominant);\n    // Native positive-scale path has no special zero-direction/half-vector guard.\n    vec3 light = dominant / strength;\n    vec3 halfVector = normalize(view + light);\n    float nv = abs(dot(n, view)) + 9.999999747378752e-6;\n    float nl = clamp(dot(n, light), 0.0, 1.0);\n    float nh = clamp(dot(n, halfVector), 0.0, 1.0);\n    float lh = clamp(dot(light, halfVector), 0.0, 1.0);\n    float s = clamp(sourceSmoothness, 0.0, 1.0);\n    float broadening = 1.0 - sqrt(s) * strength;\n    float alpha = max(broadening * broadening, 0.0020000000949949026);\n    float alpha2 = alpha * alpha;\n    float visibility = 0.5 / (nl * sqrt(nv * nv * (1.0-alpha2) + alpha2) + nv * sqrt(nl * nl * (1.0-alpha2) + alpha2));\n    float denominator = 1.0 + nh * nh * (alpha2 - 1.0);\n    float distribution = alpha2 / (denominator * denominator);\n    float f = 1.0-lh, f2 = f*f;\n    float fresnel = 0.25 + 0.75*f2*f2*f;\n    float fade = max((0.9375-s)*1.0666667222976685,0.0);\n    float specular = distribution*visibility*fresnel*fade*fade*(3.0-2.0*fade)*min(4.0*nl,1.0);\n    value += broadenedSpecularScale * 2.200000047683716 * c[0].rgb * specular;\n  }\n  VolcanicObjectPrelighting result;\n  result.rgb = max(value, vec3(0.0));\n  result.skyVisibility = max(dot(vec4(n, 1.0), vec4(c[1].w,c[2].w,c[3].w,c[0].w)),0.0);\n  return result;\n}\n";
const dot=(a,b)=>a.reduce((sum,x,i)=>sum+x*b[i],0);
const unit=v=>{const length=Math.hypot(...v);return v.map(x=>x/length);};
const sat=x=>Math.max(0,Math.min(1,x));

export function evaluateVolcanicMaterial({base,normal,metalDetail,fabricDetail,frame,constants}){
  const detailAlpha=fabricDetail[3]+base[3]*(metalDetail[3]-fabricDetail[3]);
  const mapped=texture=>unit(frame.map(row=>dot(row,texture.slice(0,3).map(x=>2*x-1))));
  const baseWorld=mapped(normal),metalWorld=mapped(metalDetail),fabricWorld=mapped(fabricDetail);
  const prelightingNormal=baseWorld.map((x,i)=>x+fabricWorld[i]+base[3]*(metalWorld[i]-fabricWorld[i]));
  return {color:base.slice(0,3).map(x=>2*x*constants[2][0]*detailAlpha),smoothness:2*normal[3]*detailAlpha,
    metalness:2*base[3]*detailAlpha,prelightingNormal,normal:unit(prelightingNormal),broadenedSpecularScale:constants[3][0]};
}

export function evaluateVolcanicPrelighting(coefficients,n,view,sourceSmoothness,broadenedSpecularScale){
  const c=Array.from({length:9},(_,i)=>Array.from(coefficients.slice(i*4,i*4+4)));
  const [x,y,z]=n,basis=[1,x,y,z,3*y*y-1,x*y,y*z,x*z,x*x-z*z];
  let value=[0,1,2].map(channel=>basis.reduce((sum,weight,band)=>sum+weight*c[band][channel],0));
  if(broadenedSpecularScale>0){
    const average=(c[0][0]+c[0][1]+c[0][2])*0.3333333432674408;
    const dominant=[1,2,3].map(band=>(c[band][0]+c[band][1]+c[band][2])*0.23333333432674408/Math.max(average,9.999999747378752e-6));
    const strength=Math.hypot(...dominant),light=dominant.map(v=>v/strength),half=unit(view.map((v,i)=>v+light[i]));
    const nv=Math.abs(dot(n,view))+9.999999747378752e-6,nl=sat(dot(n,light)),nh=sat(dot(n,half)),lh=sat(dot(light,half));
    const s=sat(sourceSmoothness),broadening=1-Math.sqrt(s)*strength,alpha=Math.max(broadening*broadening,0.0020000000949949026),alpha2=alpha*alpha;
    const visibility=.5/(nl*Math.sqrt(nv*nv*(1-alpha2)+alpha2)+nv*Math.sqrt(nl*nl*(1-alpha2)+alpha2));
    const denominator=1+nh*nh*(alpha2-1),distribution=alpha2/(denominator*denominator);
    const f=1-lh,f2=f*f,fresnel=.25+.75*f2*f2*f,fade=Math.max((.9375-s)*1.0666667222976685,0);
    const specular=distribution*visibility*fresnel*fade*fade*(3-2*fade)*Math.min(4*nl,1);
    value=value.map((v,i)=>v+broadenedSpecularScale*2.200000047683716*c[0][i]*specular);
  }
  return {rgb:value.map(v=>Math.max(0,v)),skyVisibility:Math.max(0,c[0][3]+n.reduce((sum,v,i)=>sum+v*c[i+1][3],0))};
}
