import * as THREE from 'three';
import {SOURCE_DIRECT_LIGHT_GLSL,SOURCE_DIRECT_LIGHT_POLICY} from './source-direct-light.js';
import {SOURCE_DFG_GLSL,injectSharedThreeDfg} from './source-dfg.js';
import {createPackedVectorUniform} from './packed-uniforms.js';

const MARKERS=['recoveredFloorShader','recoveredMaster1UVShader','recoveredMaster2UvShader','recoveredMetalOnlyShader',
  'recoveredCatwalk1Shader','recoveredCatwalk2Shader','recoveredExteriorNoScaleShader','recoveredArray2UvShader','recoveredVolcanicObjectShader','recoveredPropsNonmetalShader',
  'recoveredArray1UvShader','recoveredCeilingShader','recoveredMaster1UvEmissiveShader','recoveredMaster1UvEmissiveNonmetalShader','recoveredCorvetteDamageShader','recoveredPropsPresetShader'];
export const isSourceOrdinaryMaterial=material=>MARKERS.some(key=>material.userData[key]);

/** Native punctual terms for the existing stable, unshadowed light pools.
 * Effect lights and unresolved source descriptors retain the ordinary Three
 * path. Source channel gates are applied by the enclosing channel adapter. */
export function createSourceDirectAdapter(sourceIes,pointCount,spotCount) {
  const combined=sourceIes.combinedDfgTexture??null;
  const uniforms=combined?{bf2_sourceDFG:{value:combined}}:{bf2_sourceIes:{value:sourceIes.texture}},records={point:[],spot:[]},packed={};
  let compiled=0;
  function ensureCounts(counts) {
    for(const type of ['point','spot']) {
      for(const [field,Type,size] of [['Parameters',THREE.Vector4,4],['Cone',THREE.Vector2,2],['Left',THREE.Vector3,3],['Up',THREE.Vector3,3],['Forward',THREE.Vector3,3]]) {
        const key=`bf2_${type}Native${field}`;
        packed[key]??=createPackedVectorUniform(Type,size);uniforms[key]=packed[key].uniform;
        packed[key].ensure(counts[type]);
      }
      while(records[type].length<counts[type])records[type].push(null);
    }
  }
  ensureCounts({point:pointCount,spot:spotCount});
  function set(type,index,descriptor) {
    const record=descriptor?.nativeDirect??null;records[type][index]=record;
    const vector=field=>packed[`bf2_${type}Native${field}`].vectors[index];
    vector('Parameters').set(record?1:0,record?.inverseRadiusSquared??0,record?.attenuationOffset??0,record?.ies?1:0);
    vector('Cone').set(record?.cone.scale??1,record?.cone.offset??2);
    for(const [field,key] of [['Left','matrixLeft'],['Up','matrixUp'],['Forward','matrixForward']])vector(field).fromArray(record?.[key]??[0,0,0]);
    for(const field of ['Parameters','Cone','Left','Up','Forward'])packed[`bf2_${type}Native${field}`].write(index);
  }
  const declarations=['point','spot'].map(type=>{
    const count=`NUM_${type.toUpperCase()}_LIGHTS`;
    return `#if ${count} > 0
      uniform vec4 bf2_${type}NativeParameters[${count}];
      uniform vec2 bf2_${type}NativeCone[${count}];
      uniform vec3 bf2_${type}NativeLeft[${count}], bf2_${type}NativeUp[${count}], bf2_${type}NativeForward[${count}];
    #endif`;
  }).join('\n');
  const helpers=`${declarations}
    ${combined?'':'uniform sampler2D bf2_sourceIes;'}
    ${SOURCE_DIRECT_LIGHT_GLSL}
    void bf2_nativePunctual(vec3 lightPosition,vec3 lightColor,vec3 surfacePosition,
      vec3 normal,vec3 viewDirection,vec3 baseColor,float metalness,float roughness,
      vec4 parameters,vec2 cone,vec3 sourceLeft,vec3 sourceUp,vec3 sourceForward,
      inout ReflectedLight reflectedLight) {
      vec3 delta=lightPosition-surfacePosition;
      float distanceSquared=dot(delta,delta);
      vec3 L=normalize(delta), worldL=inverseTransformDirection(L,viewMatrix);
      float nl=clamp(dot(normal,L),0.0,1.0);
      float attenuation=bf2_punctualDistanceAttenuation(distanceSquared,parameters.y,parameters.z)
        * bf2_punctualAngleAttenuation(dot(sourceForward,worldL),cone.x,cone.y);
      // Original type2/type3 DXBC gates the half-vector and BRDF on the
      // strict positive distance*cone*NdotL weight. Preserve that boundary:
      // a back-facing light must not evaluate an undefined opposing H.
      if(!(attenuation*nl>0.0))return;
      vec3 H=normalize(L+viewDirection);
      if(parameters.w>0.5) {
        vec3 localDirection=-vec3(dot(sourceLeft,worldL),dot(sourceUp,worldL),dot(sourceForward,worldL));
        attenuation*=${combined?'bf2_sampleSourceIes(bf2_iesUv(localDirection))':'texture2D(bf2_sourceIes,bf2_iesUv(localDirection)).r'};
      }
      vec3 diffuse,specular;
      bf2_punctualBrdf(baseColor,metalness,0.5,roughness,dot(normal,viewDirection),nl,dot(normal,H),dot(L,H),diffuse,specular);
      vec3 irradiance=lightColor*(attenuation*nl);
      reflectedLight.directDiffuse+=irradiance*diffuse;
      reflectedLight.directSpecular+=irradiance*specular;
    }
  `;
  return {
    programKey:combined?.userData.sharedThreeDfgPacking?'native-punctual-array-dfg-ies-three-v4':combined?'native-punctual-packed-dfg-ies-v2':'native-punctual-separate-ies-v2',
    ensureCounts,set,
    decorateShader(shader) {
      // ReflectedLight and direction helpers come from <common>; insert after
      // that include so Three's declarations precede the native function.
      const marker='#include <common>';
      if(!shader.fragmentShader.includes(marker))throw new Error('Native direct adapter needs the Three common chunk');
      if(combined) {
        if(shader.uniforms.bf2_sourceDFG&&shader.uniforms.bf2_sourceDFG.value!==combined)throw new Error('DFG and IES must share the same packed lookup');
        if(!shader.fragmentShader.includes('uniform sampler2D bf2_sourceDFG;'))shader.fragmentShader=SOURCE_DFG_GLSL+shader.fragmentShader;
      }
      shader.fragmentShader=shader.fragmentShader.replace(marker,`${marker}\n${helpers}`);
      Object.assign(shader.uniforms,uniforms);compiled++;
    },
    finalizeShader(shader) {
      if(combined?.userData.sharedThreeDfgPacking)injectSharedThreeDfg(shader,combined);
    },
    directCall(type,fallback) {
      return `if(bf2_${type}NativeParameters[i].x>0.5) {
        bf2_nativePunctual(${type}Light.position,${type}Light.color,geometryPosition,geometryNormal,geometryViewDir,
          diffuseColor.rgb,metalnessFactor,roughnessFactor,bf2_${type}NativeParameters[i],bf2_${type}NativeCone[i],
          bf2_${type}NativeLeft[i],bf2_${type}NativeUp[i],bf2_${type}NativeForward[i],reflectedLight);
      } else { ${fallback} }`;
    },
    snapshot:()=>({compiled,combinedLookup:!!combined,point:records.point.map(record=>record?.id??null),spot:records.spot.map(record=>record?.id??null),policy:SOURCE_DIRECT_LIGHT_POLICY}),
  };
}
