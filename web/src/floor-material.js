import * as THREE from 'three';

// Exact default SS_DSI_Floor_01 material equations recovered from installed
// PS 13ddb144d2 / VS 606a379e52. Lighting remains the browser renderer's mapping.
export async function prepareRecoveredFloorMaterials(document, manager) {
  if (!document?.materials?.length) return { apply() {}, provenance: null };
  const loader = new THREE.TextureLoader(manager), textures = new Map();
  for (const url of new Set(document.materials.flatMap(row => Object.values(row.textures)))) {
    const texture = await loader.loadAsync(url);
    texture.colorSpace = THREE.NoColorSpace;
    texture.flipY = false;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    textures.set(url, texture);
  }
  const recipes = new Map(document.materials.map(row => [`${row.assetId}/${row.materialId}`, row]));
  let applied = 0;
  return {
    provenance: { evidenceId: document.evidenceId, sections: recipes.size, limitations: document.limitations },
    get applied() { return applied; },
    apply(gltf, asset) {
      gltf.scene.traverse(mesh => {
        if (!mesh.isMesh) return;
        for (const material of [].concat(mesh.material)) {
          if (material.userData.recoveredFloorShader) continue;
          const recipe = recipes.get(`${asset.id}/${material.userData.sourceMaterialId}`);
          if (!recipe) continue;
          material.color.setRGB(1, 1, 1);
          material.roughness = 1;
          material.metalness = 0;
          material.map = material.normalMap = material.roughnessMap = material.metalnessMap = null;
          material.userData.recoveredFloorShader = { evidenceId: document.evidenceId, sourceShader: recipe.sourceShader, limitations: document.limitations };
          material.userData.placeholder = false;
          material.userData.neutralColorApproximation = false;
          material.onBeforeCompile = shader => {
            for (const role of ['floor', 'grunge', 'primaryNormal', 'detailNormal']) shader.uniforms[`bf2_${role}`] = { value: textures.get(recipe.textures[role]) };
            shader.vertexShader = 'varying vec3 bf2_world;\n' + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
              vec4 bf2_wp = vec4(transformed, 1.0);
              #ifdef USE_INSTANCING
                bf2_wp = instanceMatrix * bf2_wp;
              #endif
              bf2_world = (modelMatrix * bf2_wp).xyz;
            `);
            shader.fragmentShader = `varying vec3 bf2_world;
              uniform sampler2D bf2_floor;
              uniform sampler2D bf2_grunge;
              uniform sampler2D bf2_primaryNormal;
              uniform sampler2D bf2_detailNormal;
            ` + shader.fragmentShader;
            shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
              vec2 bf2_uv = bf2_world.xz * 0.3;
              vec4 bf2_f = texture2D(bf2_floor, bf2_uv);
              vec4 bf2_g = texture2D(bf2_grunge, bf2_world.xz * 0.2);
              float bf2_mix = bf2_g.g + 0.1;
              diffuseColor.rgb = mix(vec3(pow(bf2_f.b, 2.2)), vec3(0.06480330228805542, 0.05360649898648262, 0.04294449836015701), bf2_g.a);
            `);
            shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
              float bf2_a = 1.6 * bf2_f.a;
              float bf2_h = 1.0 + 0.307 * (bf2_a - 1.0);
              // Forward DXBC d825be064c explicitly complements this packed
              // smoothness before its diffuse BRDF/LUT lookup.
              roughnessFactor = 1.0 - clamp(mix(bf2_h, bf2_a, bf2_mix), 0.0, 1.0);
            `);
            shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
              vec4 bf2_n = texture2D(bf2_primaryNormal, bf2_uv);
              vec4 bf2_dn = texture2D(bf2_detailNormal, bf2_uv);
              vec2 bf2_base = 2.0 * vec2(bf2_n.r * bf2_n.a, bf2_n.g) - 1.0;
              vec2 bf2_detail = mix(2.0 * vec2(bf2_dn.r * bf2_dn.a, bf2_dn.g) - 1.0, 2.0 * texture2D(bf2_floor, bf2_world.xz * 0.5).rg - 1.0, bf2_mix);
              vec3 bf2_normal = normalize(vec3(bf2_base.x + bf2_detail.x, sqrt(max(1.0 - dot(bf2_base, bf2_base), 0.0)), -bf2_base.y - bf2_detail.y));
              normal = normalize(mat3(viewMatrix) * bf2_normal);
            `);
          };
          material.customProgramCacheKey = () => 'bf2-source-SS_DSI_Floor_01-13ddb144d2-v1';
          material.needsUpdate = true;
          applied++;
        }
      });
    },
  };
}
