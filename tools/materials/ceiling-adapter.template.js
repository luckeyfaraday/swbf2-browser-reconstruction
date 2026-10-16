import * as THREE from 'three';
import {configureSourceTangentMaterial,injectSourceTangentFrame,sourceTangentProgramKey} from './source-tangent-frame.js';

// Generated from tools/materials/ceiling-adapter.template.js and ceiling-equations.glsl.
export const CEILING_GLSL = __CEILING_GLSL__;
const ROLES = ['mask', 'metalCS', 'metalNormal'];

export async function prepareRecoveredCeilingMaterials(document, manager) {
  if (!document?.materials?.length) return { apply() {}, applied: 0, provenance: null };
  const loader = new THREE.TextureLoader(manager), textures = new Map();
  for (const source of Object.values(document.sourceTextures)) {
    const texture = await loader.loadAsync(source.url);
    texture.colorSpace = source.colorSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.flipY = false;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    textures.set(source.url, texture);
  }
  const recipes = new Map(document.materials.map(row => [`${row.assetId}/${row.materialId}`, row]));
  let applied = 0;
  return {
    provenance: { evidenceId: document.evidenceId, sections: recipes.size, runtimeMapping: document.runtimeMapping, limitations: document.limitations },
    get applied() { return applied; },
    apply(gltf, asset) {
      gltf.scene.traverse(mesh => {
        if (!mesh.isMesh) return;
        for (const material of [].concat(mesh.material)) {
          if (material.userData.recoveredCeilingShader) continue;
          const recipe = recipes.get(`${asset.id}/${material.userData.sourceMaterialId}`);
          if (!recipe) continue;
          if (!mesh.geometry.getAttribute('uv')) throw new Error(`Source ceiling has no UV0: ${asset.id}/${recipe.materialId}`);
          material.color.setRGB(1, 1, 1);
          material.roughness = 1;
          // The source ID0 deferred consumer reads GBuffer2.y as metalness;
          // its texture-driven value is assigned in the fragment hook below.
          material.metalness = 0;
          material.map = material.normalMap = material.roughnessMap = material.metalnessMap = material.aoMap = material.emissiveMap = null;
          material.emissive?.setRGB(0, 0, 0);
          material.userData.recoveredCeilingShader = { evidenceId: document.evidenceId, sourceShader: recipe.sourceShader, runtimeMapping: document.runtimeMapping, nativeLightingInputs: document.nativeLightingInputs };
          material.userData.placeholder = false;
          material.userData.neutralColorApproximation = false;
          configureSourceTangentMaterial(material,mesh.geometry);
          material.onBeforeCompile = function(shader) {
            for (const role of ROLES) shader.uniforms[`bf2_ceiling_${role}`] = { value: textures.get(recipe.textures[role]) };
            shader.uniforms.bf2_ceiling_cb = { value: recipe.constants.map(v => new THREE.Vector4(...v)) };
            shader.vertexShader = 'varying vec2 bf2_ceiling_uv;\n' + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n bf2_ceiling_uv = uv;');
            shader.fragmentShader = `varying vec2 bf2_ceiling_uv;
              uniform vec4 bf2_ceiling_cb[5];
              ${ROLES.map(role => `uniform sampler2D bf2_ceiling_${role};`).join('\n')}
              ${CEILING_GLSL}
              mat3 bf2_ceiling_tbn(vec3 position, vec3 n, vec2 uvValue) {
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
              CeilingSurface bf2_ceiling_surface = sampleCeiling(bf2_ceiling_uv, bf2_ceiling_cb,
                bf2_ceiling_mask, bf2_ceiling_metalCS, bf2_ceiling_metalNormal);
              diffuseColor.rgb = bf2_ceiling_surface.color;
            `);
            shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
              roughnessFactor = 1.0 - clamp(bf2_ceiling_surface.smoothness, 0.0, 1.0);
            `);
            shader.fragmentShader = shader.fragmentShader.replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
              metalnessFactor = bf2_ceiling_surface.nativeScalar;
            `);
            shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
              mat3 bf2_ceiling_frame = bf2_ceiling_tbn(-vViewPosition, normal, bf2_ceiling_uv);
              normal = normalize(bf2_ceiling_frame * bf2_ceiling_surface.tangentNormal);
            `);
            shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
              // Native material emission joins atlas/SH prelighting before
              // the common DFG/albedo/metalness response in source-probes.
              totalEmissiveRadiance = vec3(0.0);
            `);
            if(this.userData.sourceTangentFrame?.enabled){
              // This source VS emits only T/B/N rows. Ceiling has no preexisting
              // geometric-normal varying, so provide all three frame columns.
              shader.vertexShader='varying vec3 bf2_ceiling_geometricNormal;\n'+shader.vertexShader.replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
                bf2_ceiling_geometricNormal = inverseTransformDirection(transformedNormal, viewMatrix);
              `);
              shader.fragmentShader='varying vec3 bf2_ceiling_geometricNormal;\n'+shader.fragmentShader;
              injectSourceTangentFrame(shader,this,'ceiling');
            }
          };
          material.customProgramCacheKey = function(){return 'bf2-source-SS_DSI_Ceiling_01-1fb4d25b38-native-combine-v3|' + sourceTangentProgramKey(this);};
          material.needsUpdate = true;
          applied++;
        }
      });
    },
  };
}
