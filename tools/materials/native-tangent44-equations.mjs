// BF2-NATIVE-TANGENT44-001, source-only candidate. Both unchanged native VS
// transform the independent source Binormal; neither computes it by cross.
const normalize=v=>{const length=Math.hypot(...v);if(!(length>0))throw new Error('Degenerate source frame');return v.map(x=>x/length);};
export function sourceExplicitVertexFrame(normal,tangent,binormal,matrix){
  const m=matrix?.elements??matrix;
  if([normal,tangent,binormal].some(v=>v.length!==3)||m?.length!==16||![...normal,...tangent,...binormal,...m].every(Number.isFinite))throw new Error('Invalid original explicit frame inputs');
  const transform=v=>[0,1,2].map(row=>m[row]*v[0]+m[4+row]*v[1]+m[8+row]*v[2]);
  return {N:normalize(transform(normal)),T:normalize(transform(tangent.map(x=>-x))),B:normalize(transform(binormal))};
}
export const SOURCE_EXPLICIT_VERTEX_GLSL=`
void bf2_sourceExplicitVertexFrame(vec3 sourceNormal, vec3 sourceTangent, vec3 sourceBinormal,
                                 mat3 sourceToWorld, out vec3 T, out vec3 B, out vec3 N) {
  N=normalize(sourceToWorld*sourceNormal);
  T=normalize(sourceToWorld*(-sourceTangent));
  B=normalize(sourceToWorld*sourceBinormal);
}
`;
