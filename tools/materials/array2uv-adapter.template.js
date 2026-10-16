import * as THREE from 'three';
import {configureSourceTangentMaterial,injectSourceTangentFrame,sourceTangentProgramKey} from './source-tangent-frame.js';

// Generated from tools/materials/array2uv-*; native register-to-UV association
// remains an explicit inference in document.uvRouting, not an exactness claim.
export const ARRAY2UV_GLSL = __ARRAY2UV_GLSL__;
const ROLES = ['normalArrayMetal', 'detailArray', 'colorSmoothness'];
function fingerprint(array) {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  let hash = 2166136261;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  return hash;
}

export async function prepareRecoveredArray2UvMaterials(document, manager) {
  if (!document?.materials?.length) return { apply() {}, applyGeometry() {}, applied: 0, provenance: null };
  const loader = new THREE.TextureLoader(manager), binary = new THREE.FileLoader(manager).setResponseType('arraybuffer');
  const textures = new Map(), sources = new Map(Object.values(document.sourceTextures).map(row => [row.url, row]));
  const urls = [...new Set(document.materials.flatMap(row => Object.values(row.textures)))];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, urls.length) }, async () => {
    while (next < urls.length) {
      const url = urls[next++], source = sources.get(url);
      if (!source) throw new Error(`Missing Array2UV texture provenance: ${url}`);
      let texture;
      if (source.format === 'rgba8-array') {
        const data = await binary.loadAsync(url);
        if (data.byteLength !== source.width * source.height * source.layers * 4 || source.layers !== 10 || source.colorSpace !== 'linear') throw new Error('Invalid original Array2UV layers');
        texture = new THREE.DataArrayTexture(new Uint8Array(data), source.width, source.height, source.layers);
        texture.format = THREE.RGBAFormat;
        texture.type = THREE.UnsignedByteType;
        texture.generateMipmaps = true;
      } else texture = await loader.loadAsync(url);
      texture.colorSpace = source.colorSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.flipY = false;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.needsUpdate = true;
      textures.set(url, texture);
    }
  }));
  const uvBytes = await binary.loadAsync(document.uv1.url);
  if (uvBytes.byteLength !== document.uv1.byteLength) throw new Error('Invalid original Array2UV UV1 payload');
  const records = new Map();
  for (const row of document.uv1.records) {
    if (row.byteLength !== row.vertexCount * 8 || row.byteOffset < 0 || row.byteOffset + row.byteLength > uvBytes.byteLength) throw new Error('Invalid Array2UV UV1 record');
    const key = `${row.assetId}/${row.sourceLod}`, list = records.get(key) ?? [];
    list.push(row); records.set(key, list);
  }
  const recipes = new Map(document.materials.map(row => [`${row.assetId}/${row.materialId}`, row]));
  let applied = 0, geometries = 0;
  function applyGeometry(gltf, asset, sourceLod = 0) {
    const rows = records.get(`${asset.id ?? asset.assetId}/${sourceLod}`);
    if (!rows) return;
    const primitives = new Map();
    gltf.scene.traverse(mesh => { if (mesh.isMesh) primitives.set(gltf.parser.associations.get(mesh)?.primitives, mesh); });
    for (const row of rows) {
      const mesh = primitives.get(row.primitiveIndex), geometry = mesh?.geometry;
      if (!geometry || geometry.attributes.position.count !== row.vertexCount || geometry.index?.count !== row.indexCount ||
          fingerprint(geometry.attributes.uv.array) !== row.uv0Fingerprint || fingerprint(geometry.index.array) !== row.indexFingerprint) {
        throw new Error(`Original Array2UV primitive correspondence mismatch: ${row.assetId}/LOD${sourceLod}/${row.primitiveIndex}`);
      }
      if (geometry.userData.recoveredArray2Uv?.sourceUv1Sha256 === row.uv1Sha256) continue;
      const attribute = new THREE.BufferAttribute(new Float32Array(uvBytes, row.byteOffset, row.vertexCount * 2), 2);
      geometry.setAttribute('bf2ArrayUv1', attribute);
      geometry.userData.recoveredArray2Uv = { evidenceId: document.uv1.evidenceId, sourceUv1Sha256: row.uv1Sha256, sourceLod, primitiveIndex: row.primitiveIndex };
      geometries++;
    }
  }
  return {
    provenance: { evidenceId: document.evidenceId, sections: recipes.size, textures: textures.size, uvRecords: document.uv1.records.length, runtimeMapping: document.runtimeMapping, limitations: document.limitations },
    get applied() { return applied; },
    get geometries() { return geometries; },
    applyGeometry,
    apply(gltf, asset) {
      applyGeometry(gltf, asset, 0);
      gltf.scene.traverse(mesh => {
        if (!mesh.isMesh) return;
        for (const material of [].concat(mesh.material)) {
          if (material.userData.recoveredArray2UvShader) continue;
          const recipe = recipes.get(`${asset.id}/${material.userData.sourceMaterialId}`);
          if (!recipe) continue;
          if (!mesh.geometry.getAttribute('uv') || !mesh.geometry.getAttribute('bf2ArrayUv1')) throw new Error('Original Array2UV coordinates missing');
          material.color.setRGB(1, 1, 1);
          material.roughness = 1;
          material.metalness = 0;
          material.map = material.normalMap = material.roughnessMap = material.metalnessMap = material.aoMap = material.emissiveMap = null;
          material.emissive?.setRGB(0, 0, 0);
          material.userData.recoveredArray2UvShader = { evidenceId: document.evidenceId, sourceShader: recipe.sourceShader, runtimeMapping: document.runtimeMapping, nativeLightingInputs: document.nativeLightingInputs, uvRouting: document.uvRouting };
          material.userData.placeholder = false;
          material.userData.neutralColorApproximation = false;
          configureSourceTangentMaterial(material,mesh.geometry);
          material.onBeforeCompile = function(shader) {
            for (const role of ROLES) shader.uniforms[`bf2_array2uv_${role}`] = { value: textures.get(recipe.textures[role]) };
            shader.uniforms.bf2_array2uv_cb = { value: recipe.constants.map(v => new THREE.Vector4(...v)) };
            shader.vertexShader = `attribute vec2 bf2ArrayUv1;
              varying vec4 bf2_array2uv_uv;
            ` + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
              bf2_array2uv_uv = vec4(uv, bf2ArrayUv1);
            `);
            shader.fragmentShader = `varying vec4 bf2_array2uv_uv;
              uniform vec4 bf2_array2uv_cb[2];
              uniform sampler2D bf2_array2uv_normalArrayMetal;
              uniform highp sampler2DArray bf2_array2uv_detailArray;
              uniform sampler2D bf2_array2uv_colorSmoothness;
              ${ARRAY2UV_GLSL}
              mat3 bf2_array2uv_tbn(vec3 position, vec3 n, vec2 uvValue) {
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
              Array2UvSurface bf2_array2uv_surface = sampleArray2Uv(bf2_array2uv_uv.xy, bf2_array2uv_uv.zw,
                bf2_array2uv_cb, ${ROLES.map(role => `bf2_array2uv_${role}`).join(', ')});
              diffuseColor.rgb = bf2_array2uv_surface.color;
            `);
            shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
              roughnessFactor = 1.0 - clamp(bf2_array2uv_surface.smoothness, 0.0, 1.0);
            `);
            shader.fragmentShader = shader.fragmentShader.replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
              metalnessFactor = bf2_array2uv_surface.metalness;
            `);
            shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
              mat3 bf2_array2uv_frame = bf2_array2uv_tbn(-vViewPosition, normal, bf2_array2uv_uv.xy);
              normal = normalize(bf2_array2uv_frame * bf2_array2uv_surface.tangentNormal);
            `);
            if(this.userData.sourceTangentFrame?.enabled){
              shader.vertexShader='varying vec3 bf2_array2uv_geometricNormal;\n'+shader.vertexShader.replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
                bf2_array2uv_geometricNormal = inverseTransformDirection(transformedNormal, viewMatrix);
              `);
              shader.fragmentShader='varying vec3 bf2_array2uv_geometricNormal;\n'+shader.fragmentShader;
              injectSourceTangentFrame(shader,this,'array2uv');
            }
          };
          material.customProgramCacheKey = function(){return 'bf2-source-SS_PropsMetallicPreset_2UV_TextureArray_01-52d055444c-v2|' + sourceTangentProgramKey(this);};
          material.needsUpdate = true;
          applied++;
        }
      });
    },
  };
}
