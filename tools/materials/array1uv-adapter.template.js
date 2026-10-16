import * as THREE from 'three';
import {configureSourceTangentMaterial,injectSourceTangentFrame,sourceTangentProgramKey} from './source-tangent-frame.js';

// Generated from tools/materials/array1uv-*: one original UV0 for all samples.
export const ARRAY1UV_GLSL = __ARRAY1UV_GLSL__;
const ROLES = ['normalArrayMetal', 'detailArray', 'colorSmoothness'];
export async function prepareRecoveredArray1UvMaterials(document, manager) {
  if (!document?.materials?.length) return { apply() {}, applied: 0, provenance: null };
  const loader = new THREE.TextureLoader(manager), binary = new THREE.FileLoader(manager).setResponseType('arraybuffer');
  const textures = new Map(), sources = new Map(Object.values(document.sourceTextures).map(row => [row.url, row]));
  const urls = [...new Set(document.materials.flatMap(row => Object.values(row.textures)))];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, urls.length) }, async () => {
    while (next < urls.length) {
      const url = urls[next++], source = sources.get(url);
      if (!source) throw new Error(`Missing Array1UV texture provenance: ${url}`);
      let texture;
      if (source.format === 'rgba8-array') {
        const data = await binary.loadAsync(url);
        if (data.byteLength !== source.width * source.height * source.layers * 4 || source.layers !== 10 || source.colorSpace !== 'linear') throw new Error('Invalid original Array1UV layers');
        texture = new THREE.DataArrayTexture(new Uint8Array(data), source.width, source.height, source.layers);
        texture.format = THREE.RGBAFormat;
        texture.type = THREE.UnsignedByteType;
        texture.generateMipmaps = true;
      } else texture = await loader.loadAsync(url);
      texture.colorSpace = source.colorSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.flipY = false;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      // Source t2 uses s1: packed address bytes U1/V3/W1.
      if (document.materials.some(row => row.textures.normalArrayMetal === url)) texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.needsUpdate = true;
      textures.set(url, texture);
    }
  }));
  const recipes = new Map(document.materials.map(row => [`${row.assetId}/${row.materialId}`, row]));
  let applied = 0;
  return {
    provenance: { evidenceId: document.evidenceId, sections: recipes.size, textures: textures.size, runtimeMapping: document.runtimeMapping, limitations: document.limitations },
    get applied() { return applied; },
    apply(gltf, asset) {
      gltf.scene.traverse(mesh => {
        if (!mesh.isMesh) return;
        for (const material of [].concat(mesh.material)) {
          if (material.userData.recoveredArray1UvShader) continue;
          const recipe = recipes.get(`${asset.id}/${material.userData.sourceMaterialId}`);
          if (!recipe) continue;
          if (!mesh.geometry.getAttribute('uv')) throw new Error('Original Array1UV coordinates missing');
          material.color.setRGB(1, 1, 1);
          material.roughness = 1;
          material.metalness = 0;
          material.map = material.normalMap = material.roughnessMap = material.metalnessMap = material.aoMap = material.emissiveMap = null;
          material.emissive?.setRGB(0, 0, 0);
          material.userData.recoveredArray1UvShader = { evidenceId: document.evidenceId, sourceShader: recipe.sourceShader, runtimeMapping: document.runtimeMapping, nativeLightingInputs: document.nativeLightingInputs, uvRouting: document.uvRouting };
          material.userData.placeholder = false;
          material.userData.neutralColorApproximation = false;
          configureSourceTangentMaterial(material,mesh.geometry);
          material.onBeforeCompile = function(shader) {
            for (const role of ROLES) shader.uniforms[`bf2_array1uv_${role}`] = { value: textures.get(recipe.textures[role]) };
            shader.uniforms.bf2_array1uv_cb = { value: recipe.constants.map(v => new THREE.Vector4(...v)) };
            shader.vertexShader = `varying vec2 bf2_array1uv_uv;
            ` + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
              bf2_array1uv_uv = uv;
            `);
            shader.fragmentShader = `varying vec2 bf2_array1uv_uv;
              uniform vec4 bf2_array1uv_cb[2];
              uniform sampler2D bf2_array1uv_normalArrayMetal;
              uniform highp sampler2DArray bf2_array1uv_detailArray;
              uniform sampler2D bf2_array1uv_colorSmoothness;
              ${ARRAY1UV_GLSL}
              mat3 bf2_array1uv_tbn(vec3 position, vec3 n, vec2 uvValue) {
                vec3 q0 = dFdx(position), q1 = dFdy(position);
                vec2 st0 = dFdx(uvValue), st1 = dFdy(uvValue);
                vec3 q1perp = cross(q1, n), q0perp = cross(n, q0);
                vec3 tangent = q1perp * st0.x + q0perp * st1.x;
                vec3 bitangent = q1perp * st0.y + q0perp * st1.y;
                float invmax = inversesqrt(max(max(dot(tangent, tangent), dot(bitangent, bitangent)), 1e-16));
                return mat3(tangent * invmax, bitangent * invmax, n);
              }
            ` + shader.fragmentShader;
            shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
              Array1UvSurface bf2_array1uv_surface = sampleArray1Uv(bf2_array1uv_uv,
                bf2_array1uv_cb, ${ROLES.map(role => `bf2_array1uv_${role}`).join(', ')});
              diffuseColor.rgb = bf2_array1uv_surface.color;
            `);
            shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
              roughnessFactor = 1.0 - clamp(bf2_array1uv_surface.smoothness, 0.0, 1.0);
            `);
            shader.fragmentShader = shader.fragmentShader.replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
              metalnessFactor = bf2_array1uv_surface.metalness;
            `);
            shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
              mat3 bf2_array1uv_frame = bf2_array1uv_tbn(-vViewPosition, normal, bf2_array1uv_uv);
              normal = normalize(bf2_array1uv_frame * bf2_array1uv_surface.tangentNormal);
            `);
            if(this.userData.sourceTangentFrame?.enabled){
              shader.vertexShader='varying vec3 bf2_array1uv_geometricNormal;\n'+shader.vertexShader.replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
                bf2_array1uv_geometricNormal = inverseTransformDirection(transformedNormal, viewMatrix);
              `);
              shader.fragmentShader='varying vec3 bf2_array1uv_geometricNormal;\n'+shader.fragmentShader;
              injectSourceTangentFrame(shader,this,'array1uv');
            }
          };
          material.customProgramCacheKey = function(){return 'bf2-source-SS_PropsMetallicPreset_1UV_TextureArray_01-dfa7a16109-v2|' + sourceTangentProgramKey(this);};
          material.needsUpdate = true;
          applied++;
        }
      });
    },
  };
}
