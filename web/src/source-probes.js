import * as THREE from 'three';
import {SOURCE_DFG_GLSL} from './source-dfg.js';
import {injectSourceEnvironmentSpecular,SOURCE_ENVIRONMENT_SPECULAR_POLICY} from './source-environment-specular.js';
import {injectSourceReflectionSampling} from './source-reflection-sampling.js';
import {VOLCANIC_PRELIGHTING_GLSL} from './source-volcanic-prelighting.js';
import {hasSourceTangentFrame,sourceTangentFrameKind,configureSourceTangentMaterial,sourceTangentDiagnostics} from './source-tangent-frame.js';

const activeLighting=new Set();
const STATIC_ATLAS_MATERIALS={
  floor:{marker:'recoveredFloorShader',normal:'bf2_normal',smoothness:'1.0-roughnessFactor'},
  master1uv:{marker:'recoveredMaster1UVShader',normal:'inverseTransformDirection(geometryNormal,viewMatrix)',smoothness:'bf2_master_surface.smoothness'},
  master2uv:{marker:'recoveredMaster2UvShader',normal:'inverseTransformDirection(geometryNormal,viewMatrix)',smoothness:'bf2_master2uv_surface.smoothness'},
  metalonly:{marker:'recoveredMetalOnlyShader',normal:'inverseTransformDirection(geometryNormal,viewMatrix)',smoothness:'bf2_metalonly_surface.smoothness'},
  catwalk1:{marker:'recoveredCatwalk1Shader',normal:'inverseTransformDirection(geometryNormal,viewMatrix)',smoothness:'bf2_catwalk1_surface.smoothness'},
  catwalk2:{marker:'recoveredCatwalk2Shader',normal:'inverseTransformDirection(geometryNormal,viewMatrix)',smoothness:'bf2_catwalk2_surface.smoothness'},
  array2uv:{marker:'recoveredArray2UvShader',normal:'inverseTransformDirection(geometryNormal,viewMatrix)',smoothness:'bf2_array2uv_surface.smoothness'},
  array1uv:{marker:'recoveredArray1UvShader',normal:'inverseTransformDirection(geometryNormal,viewMatrix)',smoothness:'bf2_array1uv_surface.smoothness'},
  propspreset:{marker:'recoveredPropsPresetShader',normal:'inverseTransformDirection(geometryNormal,viewMatrix)',smoothness:'bf2_props_surface.smoothness'},
  ceiling:{marker:'recoveredCeilingShader',normal:'inverseTransformDirection(geometryNormal,viewMatrix)',smoothness:'bf2_ceiling_surface.smoothness'},
  'master1uv-emissive-nonmetal':{marker:'recoveredMaster1UvEmissiveNonmetalShader',normal:'inverseTransformDirection(geometryNormal,viewMatrix)',smoothness:'bf2_master1uv_emissive_nonmetal_surface.smoothness'},
  'master1uv-emissive':{marker:'recoveredMaster1UvEmissiveShader',normal:'inverseTransformDirection(geometryNormal,viewMatrix)',smoothness:'bf2_master1uv_emissive_surface.smoothness'},
  'exterior-noscale':{marker:'recoveredExteriorNoScaleShader',normal:'inverseTransformDirection(geometryNormal,viewMatrix)',smoothness:'bf2_exterior_surface.smoothness'},
  'corvette-damage':{marker:'recoveredCorvetteDamageShader',normal:'inverseTransformDirection(geometryNormal,viewMatrix)',smoothness:'bf2_corvette_damage_surface.smoothness'},
};
const SOURCE_PRELIGHTING_EMISSION={
  recoveredCeilingShader:'bf2_ceiling_surface.emissive',
  recoveredMaster1UvEmissiveNonmetalShader:'bf2_master1uv_emissive_nonmetal_surface.emissive',
  recoveredMaster1UvEmissiveShader:'bf2_master1uv_emissive_surface.emissive',
  recoveredPropsPresetShader:'bf2_props_surface.emissive',
};
// Controlled renderer profiling: all modes retain every source mesh/triangle.
export function setSourceProbeDiagnosticMode(mode='smooth') {
  if(!['smooth','flat','constant','bypass','original'].includes(mode))throw new Error('Unknown native probe diagnostic mode');
  for(const lighting of activeLighting)lighting.setDiagnosticMode(mode);
}

// BF2-NATIVE-PROBES-001. Source storage and GPU polynomial are recovered;
// volume selection and per-mesh sample positions remain reconstruction choices.
export const SOURCE_PROBE_POLICY = Object.freeze({
  selection: 'highest source priority, then smallest containing regular volume',
  interpolation: 'trilinear between source cell-centered probes, clamped at volume edges',
  position: 'geometry bounds center per instance; moving meshes resample after 0.25 m',
  transport: 'one constant instance index interpolated and rounded; all nine native coefficients evaluated per fragment, including normal maps',
  indirectDiffuse: 'Proven ordinary materials use native prelighting * baseColor * (1-metalness) * native DFG.b, with source AO applied once where present. Independently bound static charts supply directional and broadened-specular atlas prelighting; unmatched/moving and other scoped families retain SH. Ceiling and both emissive Master families add source emission to prelighting before the ordinary combine. Other families retain the Three Lambert adapter.',
  limitations: 'Native DFG is scoped to proven ordinary material families; other materials, overlap blending, CPU-to-GPU packing, reflection filtering and exposure remain incomplete.',
});

function transformPoint(matrix, point) {
  return [0,1,2].map(axis=>matrix[axis]*point[0]+matrix[4+axis]*point[1]+matrix[8+axis]*point[2]+matrix[12+axis]);
}

export function evaluateSourceSH(coefficients, normal, target = [0,0,0]) {
  const [x,y,z]=normal,basis=[1,x,y,z,3*y*y-1,x*y,y*z,x*z,x*x-z*z];
  for(let channel=0;channel<3;channel++) {
    let value=0;
    for(let band=0;band<9;band++)value+=coefficients[band*4+channel]*basis[band];
    target[channel]=Math.max(0,value);
  }
  return target;
}

export function createSourceProbeSampler(document, data) {
  const values=data instanceof Float32Array?data:new Float32Array(data);
  if(document?.format?.componentsPerProbe!==36 || values.length!==document.probeCount*36)throw new Error('Native probe coefficient length mismatch');
  const volumes=document.volumes.filter(volume=>volume.regular).map(volume=>({
    ...volume,
    volume:Math.abs(new THREE.Matrix4().fromArray(volume.matrix.map((v,i)=>i===15?1:v)).determinant()),
  })).sort((a,b)=>b.priority-a.priority||a.volume-b.volume||a.index-b.index);
  let sampled=0,missed=0;
  return {
    document,values,volumes,
    sample(position,target=new Float32Array(36)) {
      target.fill(0);sampled++;
      for(const volume of volumes) {
        const local=transformPoint(volume.inverse,position);
        if(local.some(v=>v<-.50001||v>.50001))continue;
        const lo=[],hi=[],fraction=[];
        for(let axis=0;axis<3;axis++) {
          const size=volume.resolution[axis],coordinate=Math.max(0,Math.min(size-1,(local[axis]+.5)*size-.5));
          lo[axis]=Math.floor(coordinate);hi[axis]=Math.min(size-1,lo[axis]+1);fraction[axis]=coordinate-lo[axis];
        }
        const [nx,ny]=volume.resolution;
        for(let corner=0;corner<8;corner++) {
          const index=[],weights=[];
          for(let axis=0;axis<3;axis++) {const upper=!!(corner&(1<<axis));index[axis]=upper?hi[axis]:lo[axis];weights[axis]=upper?fraction[axis]:1-fraction[axis];}
          const weight=weights[0]*weights[1]*weights[2];if(!weight)continue;
          const offset=(volume.probeStart+index[0]+nx*(index[1]+ny*index[2]))*36;
          for(let component=0;component<36;component++)target[component]+=values[offset+component]*weight;
        }
        return {coefficients:target,volume:volume.index,priority:volume.priority};
      }
      missed++;return {coefficients:target,volume:null,priority:null};
    },
    snapshot:()=>({sampled,missed,regularVolumes:volumes.length,sourceProbes:document.probeCount}),
  };
}

const FRAGMENT = `
uniform highp sampler2D bf2_probeTexture;
uniform int bf2_probeWidth;
uniform float bf2_probeScale;
uniform mat3 bf2_probeNormalToSource;
varying float bf2_probeIndex;
vec3 bf2_probeRead(int band) {
  int index=int(bf2_probeIndex+0.5)+band;
  return texelFetch(bf2_probeTexture,ivec2(index%bf2_probeWidth,index/bf2_probeWidth),0).rgb;
}
vec3 bf2_probeDiffuse(vec3 n) {
  vec3 value=bf2_probeRead(0)+bf2_probeRead(1)*n.x+bf2_probeRead(2)*n.y+bf2_probeRead(3)*n.z;
  value+=bf2_probeRead(4)*(3.0*n.y*n.y-1.0);
  value+=bf2_probeRead(5)*n.x*n.y+bf2_probeRead(6)*n.y*n.z;
  value+=bf2_probeRead(7)*n.x*n.z+bf2_probeRead(8)*(n.x*n.x-n.z*n.z);
  return max(value,vec3(0.0))*bf2_probeScale;
}
`;

// Original PS750135c350 preserves its raw three-normal sum and source gate.
// Independently executed PS1e3d99cec3 uses the same kernel at scale1 with its
// normalized final normal. Other families retain their separately scoped math.
const VOLCANIC_PROBE_FRAGMENT = VOLCANIC_PRELIGHTING_GLSL + `
vec3 bf2_probeVolcanic(vec3 n, vec3 view, float smoothness, float specularScale) {
  vec4 coefficients[9];
  for (int band=0;band<9;band++) {
    int index=int(bf2_probeIndex+0.5)+band;
    coefficients[band]=texelFetch(bf2_probeTexture,ivec2(index%bf2_probeWidth,index/bf2_probeWidth),0);
  }
  return volcanicObjectPrelighting(coefficients,n,view,smoothness,specularScale).rgb*bf2_probeScale;
}
`;

/** Instrument original map batches after construction, preserving existing hooks.
 * Native coordinates currently equal browser world coordinates. Pass an explicit
 * browser-world-to-source Matrix4 if that changes; no guessed origin/Z flip.
 * One atlas stores nine float4 texels per rendered instance (144 bytes), with
 * one varying index and one offset attribute. Geometry wrappers reuse all
 * original attribute/index buffers. Decorated materials are shared per original
 * material to preserve renderer uniform caching between adjacent draw objects.
 */
export function createSourceProbeLighting(document, data, {irradianceScale=1,worldToSource=new THREE.Matrix4(),dfg=null,staticAtlas=null}={}) {
  const sampler=createSourceProbeSampler(document,data),assignments=[],dynamic=[],materials=[],geometries=[],draws=[],materialCache=new WeakMap(),width=512;
  const materialAdapters=new WeakMap(),originalTangentVariants=new WeakMap(),originalTangentClones=[];
  const textureUniform={value:null},scaleUniform={value:irradianceScale};
  const normalToSource=new THREE.Matrix3().getNormalMatrix(worldToSource);
  let texture=null,atlas=new Float32Array(0),compiled=0,floorDfgCompiled=0,diffuseDfgCompiled=0,environmentDfgCompiled=0,reflectionSampling=null,unsubscribeReflectionMode=null,nativeReflectionCompiled=0,offsetBytes=0,maxAttributeSlots=0,diagnosticMode='smooth';
  const coefficients=new Float32Array(36),matrix=new THREE.Matrix4(),point=new THREE.Vector3();

  function sampleAssignment(assignment,force=false) {
    const {mesh,instance,center,lastPosition,row}=assignment;
    point.copy(center);
    if(instance!==null) {mesh.getMatrixAt(instance,matrix);point.applyMatrix4(matrix);}
    point.applyMatrix4(mesh.matrixWorld).applyMatrix4(worldToSource);
    if(!force&&point.distanceToSquared(lastPosition)<.25*.25)return false;
    lastPosition.copy(point);
    const result=sampler.sample(point.toArray(),coefficients);
    atlas.set(coefficients,row*36);assignment.volume=result.volume;
    return true;
  }

  function rebuildAtlas() {
    const next=new Float32Array(width*Math.max(1,Math.ceil(assignments.length*9/width))*4);
    next.set(atlas.subarray(0,Math.min(atlas.length,next.length)));atlas=next;
    texture?.dispose();texture=new THREE.DataTexture(atlas,width,atlas.length/(width*4),THREE.RGBAFormat,THREE.FloatType);
    texture.minFilter=texture.magFilter=THREE.NearestFilter;texture.generateMipmaps=false;texture.flipY=false;
    texture.needsUpdate=true;textureUniform.value=texture;
  }

  function wrapGeometry(mesh,source,base) {
    const geometry=new THREE.BufferGeometry();
    geometry.name=source.name;geometry.index=source.index;
    geometry.attributes={...source.attributes};geometry.morphAttributes=source.morphAttributes;
    geometry.morphTargetsRelative=source.morphTargetsRelative;
    geometry.groups=source.groups.map(group=>({...group}));geometry.drawRange={...source.drawRange};
    geometry.boundingBox=source.boundingBox;geometry.boundingSphere=source.boundingSphere;
    geometry.userData={...source.userData};
    const offsets=new Float32Array(mesh.isInstancedMesh?mesh.count:source.attributes.position.count);
    if(mesh.isInstancedMesh)for(let i=0;i<offsets.length;i++)offsets[i]=(base+i)*9;
    else offsets.fill(base*9);
    geometry.setAttribute('bf2_probeOffset',mesh.isInstancedMesh?new THREE.InstancedBufferAttribute(offsets,1):new THREE.BufferAttribute(offsets,1));
    staticAtlas?.decorateGeometry(mesh,geometry);
    offsetBytes+=offsets.byteLength;
    const slots=Object.values(geometry.attributes).reduce((sum,attribute)=>sum+Math.ceil(attribute.itemSize/4),0)+(mesh.isInstancedMesh?4:0)+(mesh.instanceColor?1:0);
    maxAttributeSlots=Math.max(maxAttributeSlots,slots);
    if(slots>16)throw new Error(`Native probe attributes exceed WebGL2 minimum: ${slots}`);
    geometries.push(geometry);return geometry;
  }

  function instrument(mesh,base) {
    const source=mesh.geometry,geometry=wrapGeometry(mesh,source,base);
    mesh.geometry=geometry;
    const convert=(original,targetGeometry=geometry)=>{
      if(!original.isMeshStandardMaterial&&!original.isMeshPhysicalMaterial)return original;
      const nativeFloorDfg=!!dfg&&!!original.userData.recoveredFloorShader;
      const nativeVolcanic=!!original.userData.recoveredVolcanicObjectShader;
      const nativePropsNonmetal=!!original.userData.recoveredPropsNonmetalShader;
      const nativeBroadenedSH=nativeVolcanic||nativePropsNonmetal;
      const atlasFamily=mesh.userData.sourceStaticAtlas?.family;
      const atlasMaterial=STATIC_ATLAS_MATERIALS[atlasFamily];
      const nativeStaticAtlas=!!dfg&&!!atlasMaterial&&!!original.userData[atlasMaterial.marker];
      // Static and moving copies may share an original material. They require
      // separate shader permutations and vertex attributes.
      const nativeTangent=!!original.userData.sourceTangentFrame&&hasSourceTangentFrame(targetGeometry);
      const tangentKind=nativeTangent?sourceTangentFrameKind(targetGeometry):null;
      // Instanced and plain meshes need different programs. Sharing one material
      // object between them makes three re-resolve the program on every switch.
      const permutation=(nativeStaticAtlas?atlasFamily:'probe')+`|tangent:${tangentKind??'derivative'}|instanced:${!!mesh.isInstancedMesh}`;
      let cached=materialCache.get(original);
      if(cached?.has(permutation))return cached.get(permutation);
      if(!cached){cached=new Map();materialCache.set(original,cached);}
      const material=original.clone(),priorCompile=original.onBeforeCompile,priorKey=original.customProgramCacheKey();
      if(original.userData.sourceTangentFrame)configureSourceTangentMaterial(material,targetGeometry);
      const nativeEnvironmentDfg=!!dfg&&!!(original.userData.recoveredFloorShader||original.userData.recoveredMaster1UVShader||original.userData.recoveredMaster2UvShader||original.userData.recoveredMetalOnlyShader||original.userData.recoveredCatwalk1Shader||original.userData.recoveredCatwalk2Shader||original.userData.recoveredExteriorNoScaleShader||original.userData.recoveredArray2UvShader||original.userData.recoveredArray1UvShader||original.userData.recoveredCeilingShader||original.userData.recoveredMaster1UvEmissiveShader||original.userData.recoveredMaster1UvEmissiveNonmetalShader||original.userData.recoveredCorvetteDamageShader||original.userData.recoveredPropsPresetShader||nativeBroadenedSH);
      material.userData.sourceProbes={evidenceId:document.evidenceId,policy:SOURCE_PROBE_POLICY};
      material.onBeforeCompile=(shader,renderer)=>{
        priorCompile.call(material,shader,renderer);
        if(diagnosticMode==='bypass')return;
        if(nativeStaticAtlas)staticAtlas.decorateShader(shader);
        shader.uniforms.bf2_probeTexture=textureUniform;
        shader.uniforms.bf2_probeWidth={value:width};shader.uniforms.bf2_probeScale=scaleUniform;
        shader.uniforms.bf2_probeNormalToSource={value:normalToSource};
        // Every vertex in an instance has the same index. Ordinary interpolation
        // plus nearest-integer rounding retains that index and avoids ANGLE's
        // costly D3D11 geometry stage for last-provoking-vertex flat varyings.
        shader.vertexShader='attribute float bf2_probeOffset;\nvarying float bf2_probeIndex;\n'+shader.vertexShader;
        shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
          bf2_probeIndex=bf2_probeOffset;
        `);
        shader.fragmentShader=(diagnosticMode==='constant'?FRAGMENT.replace(/vec3 bf2_probeDiffuse\(vec3 n\) \{[\s\S]*?\n\}/,'vec3 bf2_probeDiffuse(vec3 n) { return max(bf2_probeRead(0),vec3(0.0))*bf2_probeScale; }'):FRAGMENT)+(nativeBroadenedSH?VOLCANIC_PROBE_FRAGMENT:'')+shader.fragmentShader;
        if(diagnosticMode==='flat'||diagnosticMode==='constant') {
          shader.vertexShader=shader.vertexShader.replace('varying float bf2_probeIndex;','flat varying float bf2_probeIndex;');
          shader.fragmentShader=shader.fragmentShader.replace('varying float bf2_probeIndex;','flat varying float bf2_probeIndex;');
        }
        // Exact recovered floor prelighting uses the intermediate unnormalized
        // normal; its final normalized world normal is only the G-buffer normal.
        const normal=original.userData.recoveredFloorShader?
          'vec3(bf2_base.x+bf2_detail.x,sqrt(max(1.0-dot(bf2_base,bf2_base),0.0)),-bf2_base.y-bf2_detail.y)':
          original.userData.recoveredExteriorNoScaleShader?'bf2_exterior_prelightingNormal':
          nativeVolcanic?'bf2_probeNormalToSource * bf2_volcanic_object_prelightingNormal':
          'normalize(bf2_probeNormalToSource * inverseTransformDirection(geometryNormal,viewMatrix))';
        const bakedOrProbe=nativeStaticAtlas?`bf2_staticAtlasOrProbe(${normal},${atlasMaterial.normal},inverseTransformDirection(geometryViewDir,viewMatrix),${atlasMaterial.smoothness})`:
          nativeBroadenedSH&&diagnosticMode!=='constant'?`bf2_probeVolcanic(${normal},normalize(bf2_probeNormalToSource * inverseTransformDirection(geometryViewDir,viewMatrix)),${nativeVolcanic?'bf2_volcanic_object_surface.smoothness,bf2_volcanic_object_surface.broadenedSpecularScale':'bf2_propsnonmetal_surface.smoothness,1.0'})`:`bf2_probeDiffuse(${normal})`;
        // Proven emissive PS adds emission to GBuffer3 prelighting, before the ordinary
        // combine applies DFG, albedo and nonmetal fraction. Preserve this for
        // both original charts and unmatched dynamic-probe fallback sections.
        const sourceEmission=Object.entries(SOURCE_PRELIGHTING_EMISSION).find(([marker])=>original.userData[marker])?.[1];
        const prelighting=sourceEmission?`(${bakedOrProbe}+${sourceEmission})`:bakedOrProbe;
        const marker='#include <lights_fragment_maps>';
        if(!shader.fragmentShader.includes(marker))throw new Error('Native probe injection point missing');
        shader.fragmentShader=shader.fragmentShader.replace(marker,`${marker}
          #if defined(RE_IndirectSpecular) && defined(USE_ENVMAP)
            // Keep original probe diffuse. The reconstructed reflection
            // environment contributes specular, not a second diffuse fill.
            iblIrradiance = vec3(0.0);
          #endif
          ${nativeEnvironmentDfg?'':`#if defined(RE_IndirectDiffuse)
            // Source PS d825be064c multiplies indirect prelighting by albedo
            // without 1/pi. Cancel only Three's Lambert normalization here.
            irradiance += PI * ${prelighting};
          #endif`}
        `);
        if(nativeEnvironmentDfg) {
          const end='#include <lights_fragment_end>';
          if(!shader.fragmentShader.includes(end))throw new Error('Native diffuse DFG integration point missing');
          shader.uniforms.bf2_sourceDFG={value:dfg.texture};
          shader.fragmentShader=SOURCE_DFG_GLSL+shader.fragmentShader.replace(end,`${end}
            // Native ordinary combine-IBL: prelighting * (1-metalness) *
            // baseColor * DFG.b. Material hooks apply packed AO once later.
            vec3 bf2_nativeDFG=bf2_sampleSourceDFG(dot(geometryNormal,geometryViewDir),roughnessFactor);
            reflectedLight.indirectDiffuse+=${prelighting}*diffuseColor.rgb*(1.0-metalnessFactor)*bf2_nativeDFG.b;
          `);
          diffuseDfgCompiled++;if(nativeFloorDfg)floorDfgCompiled++;
        }
        if(nativeEnvironmentDfg){injectSourceEnvironmentSpecular(shader,{texture:dfg.texture,reflectance:.5,materialId:0});environmentDfgCompiled++;}
        if(nativeEnvironmentDfg&&reflectionSampling){injectSourceReflectionSampling(shader,reflectionSampling);nativeReflectionCompiled++;}
        compiled++;
      };
      material.customProgramCacheKey=()=>`${priorKey}|bf2-native-probes-v7|${diagnosticMode}|nativeFloorDfg:${nativeFloorDfg}|nativeStaticAtlas:${nativeStaticAtlas}|atlasFamily:${atlasFamily??'none'}|nativeTangent:${nativeTangent}|tangentKind:${tangentKind}|nativeEnvironmentDfg:${nativeEnvironmentDfg}|nativeReflection:${!!reflectionSampling}:${reflectionSampling?.shaderMode??'legacy'}`;
      material.needsUpdate=true;materials.push(material);cached.set(permutation,material);return material;
    };
    const originalMaterial=mesh.material;
    function originalForGeometry(original,targetGeometry) {
      const kind=sourceTangentFrameKind(targetGeometry);
      if(!original.userData.sourceTangentFrame||(original.userData.sourceTangentFrame.frameKind??(original.userData.sourceTangentFrame.enabled?'signed-cross':null))===kind)return original;
      let variants=originalTangentVariants.get(original);
      if(!variants){variants=new Map();originalTangentVariants.set(original,variants);}
      let clone=variants.get(kind);
      if(!clone){clone=original.clone();clone.onBeforeCompile=original.onBeforeCompile;clone.customProgramCacheKey=original.customProgramCacheKey;
        configureSourceTangentMaterial(clone,targetGeometry);variants.set(kind,clone);originalTangentClones.push(clone);}
      return clone;
    }
    const materialForGeometry=targetGeometry=>{
      const choose=original=>diagnosticMode==='original'?originalForGeometry(original,targetGeometry):convert(original,targetGeometry);
      return Array.isArray(originalMaterial)?originalMaterial.map(choose):choose(originalMaterial);
    };
    mesh.material=materialForGeometry(geometry);
    const draw={mesh,originalMaterial,originalGeometry:source,material:mesh.material,geometry,materialForGeometry};
    draws.push(draw);materialAdapters.set(mesh,draw);
  }

  const lighting={
    setReflectionSampling(sampling){
      unsubscribeReflectionMode?.();reflectionSampling=sampling;
      const invalidate=()=>{for(const material of materials)material.needsUpdate=true;};
      unsubscribeReflectionMode=sampling?.subscribeModeChange?.(invalidate)??null;
      invalidate();
    },
    sampler,provenance:{evidenceId:document.evidenceId,source:document.source,policy:SOURCE_PROBE_POLICY,limitations:document.limitations},
    adaptGeometry(mesh,geometry) {
      const assignment=mesh.userData.sourceProbeAssignment;
      return assignment?wrapGeometry(mesh,geometry,assignment.first):geometry;
    },
    adaptMaterial(mesh,geometry) {return materialAdapters.get(mesh)?.materialForGeometry(geometry)??mesh.material;},
    add(root,{moving=false}={}) {
      root.updateMatrixWorld(true);const first=assignments.length;
      root.traverse(mesh=>{
        if(!mesh.isMesh||mesh.userData.sourceProbeAssignment)return;
        if(![].concat(mesh.material).some(m=>m.isMeshStandardMaterial||m.isMeshPhysicalMaterial))return;
        if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();
        const center=mesh.geometry.boundingBox.getCenter(new THREE.Vector3()),base=assignments.length;
        for(let i=0;i<(mesh.isInstancedMesh?mesh.count:1);i++) {
          const assignment={mesh,instance:mesh.isInstancedMesh?i:null,center,row:assignments.length,lastPosition:new THREE.Vector3(Infinity,Infinity,Infinity)};
          assignments.push(assignment);if(moving)dynamic.push(assignment);
        }
        mesh.userData.sourceProbeAssignment={first:base,count:assignments.length-base};instrument(mesh,base);
      });
      rebuildAtlas();
      for(let i=first;i<assignments.length;i++)sampleAssignment(assignments[i],true);
      texture.needsUpdate=true;return assignments.length-first;
    },
    update() {
      let changed=false;
      for(const assignment of dynamic) {assignment.mesh.updateWorldMatrix(true,false);changed=sampleAssignment(assignment)||changed;}
      if(changed)texture.needsUpdate=true;
    },
    setScale(value) {if(!Number.isFinite(value)||value<0)throw new Error('Invalid native probe scale');scaleUniform.value=value;},
    setDiagnosticMode(mode) {
      diagnosticMode=mode;
      for(const draw of draws){if(!draw.mesh.userData.sourceLodControlled)draw.mesh.geometry=mode==='original'?draw.originalGeometry:draw.geometry;draw.mesh.material=draw.materialForGeometry(draw.mesh.geometry);}
      for(const material of materials)material.needsUpdate=true;
    },
    snapshot:()=>({...sampler.snapshot(),sourceTangents:sourceTangentDiagnostics(draws.map(draw=>draw.mesh)),staticAtlas:staticAtlas?.snapshot()??null,assignments:assignments.length,moving:dynamic.length,compiled,floorDfgCompiled,diffuseDfgCompiled,environmentDfgCompiled,nativeReflectionCompiled,nativeEnvironmentDfg:dfg?SOURCE_ENVIRONMENT_SPECULAR_POLICY:null,decoratedMaterials:materials.length,geometryWrappers:geometries.length,maxAttributeSlots,offsetBytes,atlasBytes:atlas.byteLength,irradianceScale:scaleUniform.value,diagnosticMode,policy:SOURCE_PROBE_POLICY,nativeDiffuseDfg:dfg?{evidence:dfg.snapshot().evidenceId,policy:'Independently classified ordinary materials use source prelighting * baseColor * (1-metalness) * DFG.b. Proven static charts replace SH. Ceiling emission enters prelighting before the combine. Floor and Exterior preserve their unnormalized prelighting normal where scoped. Other material families remain incomplete.'}:null}),
    dispose(){activeLighting.delete(lighting);unsubscribeReflectionMode?.();texture?.dispose();staticAtlas?.dispose();for(const material of [...materials,...originalTangentClones])material.dispose();for(const geometry of geometries)geometry.dispose();},
  };
  activeLighting.add(lighting);return lighting;
}
