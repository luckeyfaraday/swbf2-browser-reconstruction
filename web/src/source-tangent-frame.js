import * as THREE from 'three';

// BF2-NATIVE-TANGENT-WITNESS-001. Only exact routed geometry carrying the
// source sidecar may select the native material permutation.
export const SOURCE_TANGENT_VERTEX_GLSL = /* glsl */`
void bf2_sourceVertexFrame(vec3 sourceNormal, vec4 sourceTangent,
                          mat3 sourceToWorld,
                          out vec3 T, out vec3 B, out vec3 N) {
  N = normalize(sourceToWorld * sourceNormal);
  T = normalize(sourceToWorld * (-sourceTangent.xyz));
  B = normalize(sourceToWorld * (-cross(sourceNormal, sourceTangent.xyz) * sourceTangent.w));
}
`;

export const SOURCE_EXPLICIT_TANGENT_VERTEX_GLSL = /* glsl */`
void bf2_sourceExplicitVertexFrame(vec3 sourceNormal, vec3 sourceTangent, vec3 sourceBinormal,
                                 mat3 sourceToWorld, out vec3 T, out vec3 B, out vec3 N) {
  N=normalize(sourceToWorld*sourceNormal);
  T=normalize(sourceToWorld*(-sourceTangent));
  B=normalize(sourceToWorld*sourceBinormal);
}
`;

export const SOURCE_TANGENT_FRAGMENT_GLSL = /* glsl */`
vec3 bf2_sourceMappedNormal(vec3 T, vec3 B, vec3 N, vec3 tangentNormal) {
  // The source PS does not normalize the interpolated columns separately.
  return normalize(mat3(T, B, N) * tangentNormal);
}
`;

const normalize=v=>{const length=Math.hypot(...v);if(!(length>0))throw new Error('Degenerate source tangent frame');return v.map(x=>x/length);};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];

/** Algebraic CPU counterpart, not a native float32/FMA emulator. Matrix uses
 * Three/glTF column-major storage; translation does not affect the frame. */
export function sourceVertexFrame(normal,tangent,matrix) {
  const m=matrix?.elements??matrix;
  if(normal.length!==3||tangent.length!==4||m?.length!==16||![...normal,...tangent,...m].every(Number.isFinite)||Math.abs(tangent[3])!==1)throw new Error('Invalid source tangent inputs');
  const transform=v=>[0,1,2].map(row=>m[row]*v[0]+m[4+row]*v[1]+m[8+row]*v[2]);
  return {N:normalize(transform(normal)),T:normalize(transform(tangent.slice(0,3).map(x=>-x))),
    B:normalize(transform(cross(normal,tangent).map(x=>-x*tangent[3])))};
}

export function sourceMappedNormal({T,B,N},tangentNormal) {
  return normalize([0,1,2].map(i=>T[i]*tangentNormal[0]+B[i]*tangentNormal[1]+N[i]*tangentNormal[2]));
}

/** The original44-byte layout stores an independent B, not a handedness bit. */
export function sourceExplicitVertexFrame(normal,tangent,binormal,matrix) {
  const m=matrix?.elements??matrix;
  if([normal,tangent,binormal].some(v=>v.length!==3)||m?.length!==16||![...normal,...tangent,...binormal,...m].every(Number.isFinite))throw new Error('Invalid original explicit frame inputs');
  const transform=v=>[0,1,2].map(row=>m[row]*v[0]+m[4+row]*v[1]+m[8+row]*v[2]);
  return {N:normalize(transform(normal)),T:normalize(transform(tangent.map(x=>-x))),B:normalize(transform(binormal))};
}

export function sourceTangentFrameKind(geometry) {
  const source=geometry?.userData.sourceTangentWitness;
  if(source?.evidenceId!=='BF2-NATIVE-TANGENT-WITNESS-001')return null;
  const kind=source.frameKind??'signed-cross',attributes=geometry.attributes;
  if(kind==='signed-cross'&&attributes.bf2SourceTangent?.itemSize===4)return kind;
  if(kind==='signed-cross-source-normal'&&attributes.bf2SourceTangent?.itemSize===4&&attributes.bf2SourceNormal?.itemSize===3)return kind;
  if(kind==='explicit-binormal'&&attributes.bf2SourceTangent?.itemSize===3&&attributes.bf2SourceBinormal?.itemSize===3)return kind;
  return null;
}

export function hasSourceTangentFrame(geometry) {
  return sourceTangentFrameKind(geometry)!==null;
}

export function configureSourceTangentMaterial(material,geometry) {
  const frameKind=sourceTangentFrameKind(geometry),enabled=frameKind!==null;
  material.userData.sourceTangentFrame={evidenceId:'BF2-NATIVE-TANGENT-WITNESS-001',enabled,frameKind,
    sourceSha256:enabled?geometry.userData.sourceTangentWitness.sha256:null,compiled:0,
    policy:frameKind==='signed-cross-source-normal'?'Original raw half-float normal/tangent/sign from identity composite parts; exported GLB normal remains immutable. Static rest-pose visibility only.':frameKind==='explicit-binormal'?'Original independent half-float tangent/binormal XYZ; native forward vertex frame and interpolated columns.':enabled?'Original half-float tangent XYZ and separate BinormalSign; native forward vertex frame and interpolated columns.':'Derivative frame retained for geometry without an exact source sidecar.'};
  return enabled;
}

export const sourceTangentProgramKey=material=>`source-tangent:${material.userData.sourceTangentFrame?.enabled?'native-v2-'+(material.userData.sourceTangentFrame.frameKind??'signed-cross'):'derivative'}`;

/** Compose inside the material hook, before probes/lighting decorators. The
 * geometric normal varying already carries N, so only T/B varyings are added. */
export function injectSourceTangentFrame(shader,material,family) {
  if(!material.userData.sourceTangentFrame?.enabled)return;
  const prefix={master1uv:'bf2_master',master2uv:'bf2_master2uv',metalonly:'bf2_metalonly',ceiling:'bf2_ceiling',catwalk2:'bf2_catwalk2',catwalk1:'bf2_catwalk1',propspreset:'bf2_props',array1uv:'bf2_array1uv',array2uv:'bf2_array2uv','exterior-noscale':'bf2_exterior','corvette-damage':'bf2_corvette_damage','master1uv-emissive-nonmetal':'bf2_master1uv_emissive_nonmetal','master1uv-emissive':'bf2_master1uv_emissive'}[family];
  if(!prefix)throw new Error('Unproven source tangent material family');
  const explicit=material.userData.sourceTangentFrame.frameKind==='explicit-binormal';
  const sourceNormal=material.userData.sourceTangentFrame.frameKind==='signed-cross-source-normal';
  if(sourceNormal&&family!=='array2uv')throw new Error('Unproven source-normal composite material family');
  if(explicit&&!['master1uv-emissive','metalonly','ceiling'].includes(family))throw new Error('Unproven explicit-binormal material family');
  const separateNormals=family==='exterior-noscale';
  const geometric=`${prefix}_geometricNormal = inverseTransformDirection(transformedNormal, viewMatrix);`;
  const derivative=new RegExp(`mat3 ${prefix}_frame = ${prefix}_tbn\\([^;]+;`+(separateNormals?'':`\\s*normal = normalize\\(${prefix}_frame \\* ${prefix}_surface.tangentNormal\\);`));
  if(!shader.vertexShader.includes(geometric)||!derivative.test(shader.fragmentShader)||shader.vertexShader.includes('BF2_SOURCE_TANGENT_FRAME'))throw new Error('Source tangent material integration point changed');
  if(separateNormals)for(const name of ['base','detail'])if(!shader.fragmentShader.includes(`inverseTransformDirection(${prefix}_frame * ${prefix}_surface.${name}TangentNormal, viewMatrix)`))throw new Error('Source separate-normal composition point changed');
  shader.vertexShader=`#define BF2_SOURCE_TANGENT_FRAME 1\n${explicit?'#define BF2_SOURCE_EXPLICIT_BINORMAL 1\nattribute vec3 bf2SourceTangent, bf2SourceBinormal;':'attribute vec4 bf2SourceTangent;'}\n${sourceNormal?'#define BF2_SOURCE_RAW_COMPOSITE_NORMAL 1\nattribute vec3 bf2SourceNormal;':''}\nvarying vec3 bf2_sourceT, bf2_sourceB;\n${explicit?SOURCE_EXPLICIT_TANGENT_VERTEX_GLSL:SOURCE_TANGENT_VERTEX_GLSL}\n`+shader.vertexShader.replace(geometric,`
    mat3 bf2_sourceFrameMatrix = mat3(modelMatrix);
    #ifdef USE_INSTANCING
      bf2_sourceFrameMatrix = bf2_sourceFrameMatrix * mat3(instanceMatrix);
    #endif
    ${explicit?'bf2_sourceExplicitVertexFrame(normal, bf2SourceTangent, bf2SourceBinormal':`bf2_sourceVertexFrame(${sourceNormal?'bf2SourceNormal':'normal'}, bf2SourceTangent`}, bf2_sourceFrameMatrix,
      bf2_sourceT, bf2_sourceB, ${prefix}_geometricNormal);
  `);
  shader.fragmentShader=`#define BF2_SOURCE_TANGENT_FRAME 1\nvarying vec3 bf2_sourceT, bf2_sourceB;\n${SOURCE_TANGENT_FRAGMENT_GLSL}\n`+shader.fragmentShader.replace(derivative,separateNormals?`mat3 ${prefix}_frame = mat3(bf2_sourceT, bf2_sourceB, ${prefix}_geometricNormal);`:`
    vec3 bf2_sourceWorldMappedNormal = bf2_sourceMappedNormal(
      bf2_sourceT, bf2_sourceB, ${prefix}_geometricNormal, ${prefix}_surface.tangentNormal);
    normal = (viewMatrix * vec4(bf2_sourceWorldMappedNormal, 0.0)).xyz;
  `);
  // Exterior's original PS normalizes the two mapped normals separately,
  // then keeps their authored world-XY sum unnormalized for prelighting.
  if(separateNormals)for(const name of ['base','detail'])shader.fragmentShader=shader.fragmentShader.replace(
    `inverseTransformDirection(${prefix}_frame * ${prefix}_surface.${name}TangentNormal, viewMatrix)`,
    `normalize(${prefix}_frame * ${prefix}_surface.${name}TangentNormal)`);
  material.userData.sourceTangentFrame.compiled++;
}

export function sourceTangentDiagnostics(meshes) {
  let provenDraws=0,provenInstances=0,nativeDraws=0,nativeInstances=0,derivativeDraws=0,mismatches=0;
  const selectedMaterials=new Set(),nativeMaterials=new Set(),frameKinds={};
  for(const mesh of meshes) {
    const materials=[].concat(mesh.material),routed=materials.some(m=>m.userData.sourceTangentFrame);
    if(!routed)continue;
    const geometryKind=sourceTangentFrameKind(mesh.geometry),geometryNative=geometryKind!==null,instances=mesh.isInstancedMesh?mesh.count:1;
    const materialNative=materials.some(m=>m.userData.sourceTangentFrame?.enabled);
    for(const material of materials){selectedMaterials.add(material);if(material.userData.sourceTangentFrame?.enabled)nativeMaterials.add(material);}
    if(geometryNative){provenDraws++;provenInstances+=instances;frameKinds[geometryKind]=(frameKinds[geometryKind]??0)+instances;}
    if(materialNative){nativeDraws++;nativeInstances+=instances;}else derivativeDraws++;
    if(geometryNative!==materialNative||(geometryNative&&materials.some(m=>m.userData.sourceTangentFrame?.enabled&&(m.userData.sourceTangentFrame.frameKind??'signed-cross')!==geometryKind)))mismatches++;
  }
  return {evidenceId:'BF2-NATIVE-TANGENT-WITNESS-001',provenDraws,provenInstances,nativeDraws,nativeInstances,
    derivativeDraws,mismatches,frameKinds,selectedMaterials:selectedMaterials.size,nativeMaterials:nativeMaterials.size,
    nativeCompiled:[...nativeMaterials].reduce((n,m)=>n+(m.userData.sourceTangentFrame.compiled??0),0)};
}

function fingerprint(array) {
  const bytes=new Uint8Array(array.buffer,array.byteOffset,array.byteLength);let hash=2166136261;
  for(const byte of bytes)hash=Math.imul(hash^byte,16777619)>>>0;
  return hash;
}

export function createSourceTangentWitness(document,buffer) {
  if(document?.version!==1||!(buffer instanceof ArrayBuffer)||buffer.byteLength!==document.byteLength)throw new Error('Invalid original tangent witness payload');
  const rows=new Map();
  for(const row of document.records) {
    const kind=row.frameKind??'signed-cross';if(!['signed-cross','explicit-binormal','signed-cross-source-normal'].includes(kind))throw new Error('Unknown original tangent frame kind');
    const size=kind==='explicit-binormal'?3:4;
    if(row.tangentOffset%4||row.tangentOffset<0||row.tangentBytes!==row.vertexCount*size*4||row.tangentOffset+row.tangentBytes>buffer.byteLength)throw new Error('Invalid original tangent witness range');
    const values=new Float32Array(buffer,row.tangentOffset,row.vertexCount*size);
    for(let i=0;i<values.length;i++)if(!Number.isFinite(values[i])||(size===4&&i%4===3&&Math.abs(values[i])!==1))throw new Error('Invalid original tangent component');
    if(kind==='signed-cross-source-normal'){
      if(row.family!=='array2uv'||!Number.isInteger(row.normalOffset)||row.normalOffset%4||row.normalOffset<0||row.normalBytes!==row.vertexCount*12||row.normalOffset+row.normalBytes>buffer.byteLength||
        !(row.normalOffset+row.normalBytes<=row.tangentOffset||row.normalOffset>=row.tangentOffset+row.tangentBytes))throw new Error('Invalid original raw-normal witness range');
      const normals=new Float32Array(buffer,row.normalOffset,row.vertexCount*3);
      for(let i=0;i<row.vertexCount;i++){
        const normal=normals.subarray(i*3,i*3+3),tangent=values.subarray(i*4,i*4+3);
        if(![...normal].every(Number.isFinite)||Math.hypot(...normal)===0||Math.hypot(...cross(normal,tangent))===0)throw new Error('Invalid original raw-normal frame component');
      }
    }
    if(kind==='explicit-binormal'){
      if(!Number.isInteger(row.binormalOffset)||row.binormalOffset%4||row.binormalOffset<0||row.binormalBytes!==row.vertexCount*12||row.binormalOffset+row.binormalBytes>buffer.byteLength||
        !(row.binormalOffset+row.binormalBytes<=row.tangentOffset||row.binormalOffset>=row.tangentOffset+row.tangentBytes))throw new Error('Invalid original binormal witness range');
      const binormals=new Float32Array(buffer,row.binormalOffset,row.vertexCount*3);
      for(let i=0;i<binormals.length;i+=3)if(![...binormals.subarray(i,i+3)].every(Number.isFinite)||Math.hypot(...binormals.subarray(i,i+3))===0||Math.hypot(...values.subarray(i,i+3))===0)throw new Error('Invalid original explicit frame component');
    }
    const key=`${row.assetId}/${row.sourceLod}`,list=rows.get(key)??[];list.push(row);rows.set(key,list);
  }
  let geometries=0;
  return {
    provenance:{evidenceId:document.evidenceId,coverageEvidenceId:document.coverageEvidenceId??null,coverageEvidenceIds:document.coverageEvidenceIds??[],sourceCoverage:document.sourceCoverage??[],sha256:document.sha256,frameEquation:document.frameEquation,frameEquations:document.frameEquations??{'signed-cross':document.frameEquation},limitations:document.limitations,publication:document.publication??null},
    get geometries(){return geometries;},
    applyGeometry(gltf,asset,sourceLod=0) {
      const selected=rows.get(`${asset.id??asset.assetId}/${sourceLod}`);if(!selected)return;
      const primitives=new Map();gltf.scene.traverse(mesh=>{if(mesh.isMesh)primitives.set(gltf.parser.associations.get(mesh)?.primitives,mesh);});
      for(const row of selected) {
        const mesh=primitives.get(row.primitiveIndex),geometry=mesh?.geometry;
        if(!geometry||geometry.attributes.position.count!==row.vertexCount||geometry.index?.count!==row.indexCount||
          fingerprint(geometry.index.array)!==row.indexFingerprint||
          ![['position','POSITION'],['normal','NORMAL'],['uv','TEXCOORD_0']].every(([name,label])=>
            geometry.attributes[name]&&fingerprint(geometry.attributes[name].array)===row.attributes[label].fingerprint)||
          ![].concat(mesh.material).some(m=>m.userData.sourceMaterialId===row.sourceMaterialId))throw new Error(`Original tangent correspondence mismatch: ${row.assetId}/${sourceLod}/${row.primitiveIndex}`);
        if(geometry.userData.sourceTangentWitness?.sha256===document.sha256)continue;
        const frameKind=row.frameKind??'signed-cross',size=frameKind==='explicit-binormal'?3:4;
        geometry.setAttribute('bf2SourceTangent',new THREE.BufferAttribute(new Float32Array(buffer,row.tangentOffset,row.vertexCount*size),size));
        if(frameKind==='explicit-binormal')geometry.setAttribute('bf2SourceBinormal',new THREE.BufferAttribute(new Float32Array(buffer,row.binormalOffset,row.vertexCount*3),3));
        else geometry.deleteAttribute('bf2SourceBinormal');
        if(frameKind==='signed-cross-source-normal')geometry.setAttribute('bf2SourceNormal',new THREE.BufferAttribute(new Float32Array(buffer,row.normalOffset,row.vertexCount*3),3));
        else geometry.deleteAttribute('bf2SourceNormal');
        geometry.userData.sourceTangentWitness={evidenceId:document.evidenceId,sha256:document.sha256,sourceLod,sourceMaterialId:row.sourceMaterialId,primitiveIndex:row.primitiveIndex,frameKind};
        geometries++;
      }
    },
  };
}

export async function prepareSourceTangentWitness(document,{fetch:fetchPayload=globalThis.fetch}={}) {
  const response=await fetchPayload(document.url);if(!response.ok)throw new Error(`Source tangent payload HTTP ${response.status}`);
  const buffer=await response.arrayBuffer();
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),byte=>byte.toString(16).padStart(2,'0')).join('');
  if(digest!==document.sha256)throw new Error('Source tangent payload SHA-256 mismatch');
  return createSourceTangentWitness(document,buffer);
}
