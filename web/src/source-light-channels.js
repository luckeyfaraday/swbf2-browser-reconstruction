import * as THREE from 'three';
import {isSourceOrdinaryMaterial} from './source-direct-adapter.js';
import {createPackedVectorUniform} from './packed-uniforms.js';

// Source AffectDiffuse/AffectSpecular flags gate the corresponding Three
// direct-light terms. Proven ordinary materials use the recovered punctual BRDF;
// other materials retain Three's direct response with the same source switches.
// Pools currently contain unshadowed lights without projected maps, so Three's
// stable light sort retains each pool's insertion order. A shadow/map adapter
// must supply uniforms in its resulting renderer order before changing that.
// three textually unrolls each light loop (#pragma unroll_loop_start) so that
// shadow-map and spot-light-map samplers are indexed by constants. Every recovered
// native punctual iteration is large, and ANGLE's D3D11 backend (FXC) compiles the
// 15 inlined copies per program very slowly. Without shadow maps or spot light maps
// the index-dependent blocks are dead code, so a plain loop computes the same terms;
// the unrolled original is kept for the shadowed case.
export function withDynamicLightLoops(chunk) {
  const begin='#pragma unroll_loop_start',end='#pragma unroll_loop_end';
  for(const [type,condition] of [['point','!defined( USE_SHADOWMAP )'],['spot','!defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_MAPS == 0']]) {
    const declaration=chunk.indexOf(`${type[0].toUpperCase()+type.slice(1)}Light ${type}Light;`);
    const start=chunk.indexOf(begin,declaration),stop=chunk.indexOf(end,start);
    if(declaration<0||start<0||stop<0)throw new Error('Source light loops do not match this Three shader revision');
    const unrolled=chunk.slice(start,stop+end.length);
    const dynamic=stripIndexDependentBlocks(unrolled.slice(begin.length,unrolled.length-end.length));
    chunk=`${chunk.slice(0,start)}#if ${condition}\n${dynamic}\n#else\n${unrolled}\n#endif${chunk.slice(stop+end.length)}`;
  }
  return chunk;
}

function stripIndexDependentBlocks(text) {
  const kept=[];let skipping=0;
  for(const line of text.split('\n')) {
    const directive=line.trim();
    if(skipping){if(/^#\s*if/.test(directive))skipping++;else if(/^#\s*endif/.test(directive))skipping--;continue;}
    if(/^#\s*if/.test(directive)&&/UNROLLED_LOOP_INDEX|SPOT_LIGHT_MAP_INDEX/.test(directive)){skipping=1;continue;}
    if(/^#\s*undef\s+SPOT_LIGHT_MAP_INDEX/.test(directive))continue;
    kept.push(line);
  }
  const result=kept.join('\n');
  if(/UNROLLED_LOOP_INDEX|SPOT_LIGHT_MAP_INDEX/.test(result))throw new Error('Index-dependent light block survived loop conversion');
  return result;
}

// Fragment texture units a program will bind. Samplers that decorators declare in
// the shader text count directly (arrays by their size). Three's own samplers live
// in chunks that are expanded later, so they are counted from the parameters
// three compiles with (passed to onBeforeCompile): map flags, an environment map
// resolved from the material or the scene unless a decorator #undefs USE_ENVMAP,
// the always-declared dfgLUT unless a decorator replaced it, and rect-light LTCs.
// Without parameters (unit fixtures) the material's maps stand in. Programs over
// MAX_TEXTURE_IMAGE_UNITS fail to link and draw nothing.
const THREE_MAP_SAMPLERS=['map','alphaMap','aoMap','lightMap','emissiveMap','bumpMap','normalMap','roughnessMap','metalnessMap',
  'clearcoatMap','clearcoatNormalMap','clearcoatRoughnessMap','iridescenceMap','iridescenceThicknessMap','sheenColorMap','sheenRoughnessMap',
  'specularMap','specularColorMap','specularIntensityMap','anisotropyMap','transmissionMap','thicknessMap','matcap','gradientMap'];
const THREE_BUILTIN_SAMPLERS=new Set([...THREE_MAP_SAMPLERS,'envMap','dfgLUT','ltc_1','ltc_2','transmissionSamplerMap','spotLightMap',
  'directionalShadowMap','spotShadowMap','pointShadowMap','sunShadowMap']);
export function fragmentSamplerUnits(fragmentShader,material,parameters=null) {
  const units=new Map();
  for(const match of fragmentShader.matchAll(/uniform\s+(?:(?:highp|mediump|lowp)\s+)?(?:sampler\w+|isampler\w+|usampler\w+)\s+(\w+)\s*(?:\[\s*(\d+)\s*\])?/g))
    if(!THREE_BUILTIN_SAMPLERS.has(match[1]))units.set(match[1],Math.max(units.get(match[1])??0,Number(match[2]??1)));
  if(parameters&&'shaderID' in parameters) {
    for(const key of THREE_MAP_SAMPLERS)if(parameters[key])units.set(key,1);
    if(parameters.envMap&&!/^\s*#undef\s+USE_ENVMAP/m.test(fragmentShader))units.set('envMap',1);
    if(parameters.uniforms?.dfgLUT)units.set('dfgLUT',1);
    if(parameters.numRectAreaLights>0){units.set('ltc_1',1);units.set('ltc_2',1);}
    if(parameters.transmission)units.set('transmissionSamplerMap',1);
  } else {
    for(const key of [...THREE_MAP_SAMPLERS,'envMap'])if(material[key])units.set(key,1);
  }
  return units;
}
export const fragmentSamplerNames=(fragmentShader,material,parameters=null)=>new Set(fragmentSamplerUnits(fragmentShader,material,parameters).keys());
export const fragmentSamplerCount=(fragmentShader,material,parameters=null)=>[...fragmentSamplerUnits(fragmentShader,material,parameters).values()].reduce((sum,count)=>sum+count,0);
const SPOT_LIGHT_INFO='getSpotLightInfo( spotLight, geometryPosition, directLight );';
const SPOT_SHADOW_CALL='\n{float bf2_shadow=bf2_spotShadow(i,geometryPosition,geometryNormal,spotLight.position);directLight.color*=bf2_shadow;spotLight.color*=bf2_shadow;}';

export function createSourceLightChannels(pointCount, spotCount, {nativeDirect=null,nativeShadows=null}={}) {
  const packed = {
    point: createPackedVectorUniform(THREE.Vector2,2,()=>new THREE.Vector2(1,1)),
    spot: createPackedVectorUniform(THREE.Vector2,2,()=>new THREE.Vector2(1,1)),
  };
  packed.point.ensure(pointCount);packed.spot.ensure(spotCount);
  const values = {point:packed.point.vectors,spot:packed.spot.vectors};
  const uniforms = {
    bf2_pointChannels:packed.point.uniform,
    bf2_spotChannels:packed.spot.uniform,
  };
  const decorated = new WeakSet();
  let materials=0, compiled=0;
  return {
    set(type,index,descriptor) {
      nativeDirect?.set(type,index,descriptor);
      values[type][index].set(descriptor&&descriptor.affectDiffuse!==false?1:0,
        descriptor&&descriptor.affectSpecular!==false?1:0);
      packed[type].write(index);
    },
    decorate(root) {
      // The scene also contains effects such as the player's muzzle flash.
      // They follow the fixed source pools and keep both default contributions.
      const counts={point:0,spot:0};
      root.traverse(object=>{if(object.isPointLight)counts.point++;if(object.isSpotLight)counts.spot++;});
      for(const type of ['point','spot'])packed[type].ensure(counts[type]);
      nativeDirect?.ensureCounts(counts);
      nativeShadows?.ensureCounts(counts.spot);
      root.traverse(object=>{
        for(const material of [object.material,...(object.sourceLodMaterials??[])].flat().filter(Boolean)) {
          if(!material.isMeshStandardMaterial||decorated.has(material))continue;
          decorated.add(material);materials++;
          const prior=material.onBeforeCompile,priorKey=material.customProgramCacheKey.bind(material);
          const ordinary=!!nativeDirect&&isSourceOrdinaryMaterial(material);
          material.onBeforeCompile=(shader,renderer)=>{
            prior.call(material,shader,renderer);
            if(ordinary)nativeDirect.decorateShader(shader);
            const marker='#include <lights_fragment_begin>';
            if(!shader.fragmentShader.includes(marker))throw new Error('Source light channels require the Three direct-light chunk');
            let chunk=THREE.ShaderChunk.lights_fragment_begin;
            const call='RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
            for(const [type,name] of [['point','Point'],['spot','Spot']]) {
              const start=chunk.indexOf(`${name}Light ${type}Light;`);
              const at=chunk.indexOf(call,start);
              if(start<0||at<0)throw new Error('Source light channels do not match this Three shader revision');
              const gated=`{\nvec3 bf2_diffuseBefore=reflectedLight.directDiffuse;\nvec3 bf2_specularBefore=reflectedLight.directSpecular;\n${ordinary?nativeDirect.directCall(type,call):call}\nreflectedLight.directDiffuse=mix(bf2_diffuseBefore,reflectedLight.directDiffuse,bf2_${type}Channels[i].x);\nreflectedLight.directSpecular=mix(bf2_specularBefore,reflectedLight.directSpecular,bf2_${type}Channels[i].y);\n}`;
              chunk=chunk.slice(0,at)+gated+chunk.slice(at+call.length);
            }
            chunk=withDynamicLightLoops(chunk);
            shader.fragmentShader=`#if NUM_POINT_LIGHTS > 0\nuniform vec2 bf2_pointChannels[NUM_POINT_LIGHTS];\n#endif\n#if NUM_SPOT_LIGHTS > 0\nuniform vec2 bf2_spotChannels[NUM_SPOT_LIGHTS];\n#endif\n`+shader.fragmentShader.replace(marker,chunk);
            if(ordinary)nativeDirect.finalizeShader?.(shader);
            if(nativeShadows) {
              // Native spot shadows scale the light before either the native or Three response.
              // bf2NoShadowReceiver is set when a program still failed to link (see
              // prepareAllShaders); the material then recompiles without the atlas.
              const samplerNames=fragmentSamplerNames(shader.fragmentShader,material,shader),units=fragmentSamplerCount(shader.fragmentShader,material,shader);
              const accepted=!material.userData.bf2NoShadowReceiver&&units+1<=nativeShadows.maxTextureUnits;
              nativeShadows.noteReceiver(material,accepted,[...samplerNames]);
              if(accepted) {
                if(!shader.fragmentShader.includes(SPOT_LIGHT_INFO))throw new Error('Native spot shadows do not match this Three shader revision');
                shader.fragmentShader=nativeShadows.glsl+shader.fragmentShader.split(SPOT_LIGHT_INFO).join(SPOT_LIGHT_INFO+SPOT_SHADOW_CALL);
                Object.assign(shader.uniforms,nativeShadows.uniforms);
              }
            }
            Object.assign(shader.uniforms,uniforms);compiled++;
          };
          material.customProgramCacheKey=()=>`${priorKey()}|bf2-source-direct-light-channels-v2|dynamic-loops${ordinary?'|'+nativeDirect.programKey:''}${nativeShadows?'|'+nativeShadows.programKey+(material.userData.bf2NoShadowReceiver?'|no-receiver':''):''}`;
          material.needsUpdate=true;
        }
      });
    },
    snapshot:()=>({materials,compiled,point:values.point.map(value=>value.toArray()),spot:values.spot.map(value=>value.toArray()),policy:nativeDirect?'Source diffuse/specular switches; recovered punctual BRDF, attenuation, cone and IES for proven ordinary materials. Other material responses, area shapes and shadowing remain incomplete.':'Source diffuse/specular switches applied to Three direct terms; native direct-light adapter inactive.'}),
  };
}
