import * as THREE from 'three';

// Generated from unchanged native shader evidence; original frame publication
// remains separate from the material and prelighting equation proof.
export const PROPSNONMETAL_GLSL=__PROPSNONMETAL_GLSL__;
export function evaluatePropsNonmetalSurface(base,normal,frame){
  const xy=normal.slice(0,2).map(v=>2*v-1),tangent=[...xy,Math.sqrt(Math.max(1-xy[0]*xy[0]-xy[1]*xy[1],0))];
  const mapped=frame.map(row=>row.reduce((sum,v,i)=>sum+v*tangent[i],0)),length=Math.hypot(...mapped);
  return {color:base.slice(0,3),smoothness:base[3],tangentNormal:tangent,normal:mapped.map(v=>v/length)};
}

export async function prepareRecoveredPropsNonmetalMaterials(document,manager){
  if(!document?.materials?.length)return {apply(){},applied:0,provenance:null};
  const loader=new THREE.TextureLoader(manager),textures=new Map(),sources=new Map(Object.values(document.sourceTextures).map(row=>[row.url,row]));
  const urls=[...new Set(document.materials.flatMap(row=>Object.values(row.textures)))];
  let next=0;
  await Promise.all(Array.from({length:Math.min(4,urls.length)},async()=>{
    while(next<urls.length){
      const url=urls[next++],source=sources.get(url);if(!source)throw new Error(`Missing PropsNonmetal source texture: ${url}`);
      const texture=await loader.loadAsync(url);texture.colorSpace=source.colorSpace==='srgb'?THREE.SRGBColorSpace:THREE.NoColorSpace;
      texture.flipY=false;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;textures.set(url,texture);
    }
  }));
  const recipes=new Map(document.materials.map(row=>[`${row.assetId}/${row.materialId}`,row]));let applied=0;
  return {
    provenance:{evidenceId:document.evidenceId,sections:recipes.size,textures:textures.size,runtimeMapping:document.runtimeMapping,limitations:document.limitations},
    get applied(){return applied;},dispose(){for(const texture of textures.values())texture.dispose();},
    apply(gltf,asset){
      gltf.scene.traverse(mesh=>{
        if(!mesh.isMesh)return;
        for(const material of [].concat(mesh.material)){
          if(material.userData.recoveredPropsNonmetalShader)continue;
          const recipe=recipes.get(`${asset.id}/${material.userData.sourceMaterialId}`);if(!recipe)continue;
          if(!mesh.geometry.getAttribute('uv'))throw new Error(`Source PropsNonmetal mesh lacks UV0: ${asset.id}/${recipe.materialId}`);
          material.color.setRGB(1,1,1);material.roughness=1;material.metalness=0;
          material.map=material.normalMap=material.roughnessMap=material.metalnessMap=material.aoMap=material.emissiveMap=null;material.emissive?.setRGB(0,0,0);
          material.userData.recoveredPropsNonmetalShader={evidenceId:document.evidenceId,sourceShader:recipe.sourceShader,nativeLightingInputs:document.nativeLightingInputs,runtimeMapping:document.runtimeMapping};
          material.userData.placeholder=false;material.userData.neutralColorApproximation=false;
          material.onBeforeCompile=function(shader){
            shader.uniforms.bf2_propsnonmetal_base={value:textures.get(recipe.textures.base)};shader.uniforms.bf2_propsnonmetal_normal={value:textures.get(recipe.textures.normal)};
            shader.vertexShader='varying vec2 bf2_propsnonmetal_uv;\n'+shader.vertexShader;
            shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nbf2_propsnonmetal_uv=uv;');
            shader.fragmentShader=`varying vec2 bf2_propsnonmetal_uv;
              uniform sampler2D bf2_propsnonmetal_base;
              uniform sampler2D bf2_propsnonmetal_normal;
              ${PROPSNONMETAL_GLSL}
              // Documented derivative-frame boundary pending native frame proof.
              mat3 bf2_propsnonmetal_tbn(vec3 position,vec3 n,vec2 uvValue){
                vec3 q0=dFdx(position),q1=dFdy(position);vec2 st0=dFdx(uvValue),st1=dFdy(uvValue);
                vec3 q1perp=cross(q1,n),q0perp=cross(n,q0);
                vec3 tangent=q1perp*st0.x+q0perp*st1.x,bitangent=q1perp*st0.y+q0perp*st1.y;
                float invmax=inversesqrt(max(max(dot(tangent,tangent),dot(bitangent,bitangent)),1e-16));
                return mat3(tangent*invmax,bitangent*invmax,n);
              }
            `+shader.fragmentShader;
            shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
              PropsNonmetalSurface bf2_propsnonmetal_surface=samplePropsNonmetal(bf2_propsnonmetal_uv,bf2_propsnonmetal_base,bf2_propsnonmetal_normal);
              diffuseColor.rgb=bf2_propsnonmetal_surface.color;
            `);
            shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
              roughnessFactor=1.0-clamp(bf2_propsnonmetal_surface.smoothness,0.0,1.0);
            `);
            shader.fragmentShader=shader.fragmentShader.replace('#include <metalnessmap_fragment>','metalnessFactor=0.0;');
            shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>','totalEmissiveRadiance=vec3(0.0);');
            shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`
              mat3 bf2_propsnonmetal_frame=bf2_propsnonmetal_tbn(-vViewPosition,normal,bf2_propsnonmetal_uv);
              normal=normalize(bf2_propsnonmetal_frame*bf2_propsnonmetal_surface.tangentNormal);
            `);
          };
          material.customProgramCacheKey=function(){return 'bf2-source-SS_PropsNonMetallicPreset-1e3d99cec3-v1|derivative-frame';};
          material.needsUpdate=true;applied++;
        }
      });
    }
  };
}
