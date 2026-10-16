import * as THREE from 'three';
import {configureSourceTangentMaterial,injectSourceTangentFrame,sourceTangentProgramKey} from './source-tangent-frame.js';

// Generated from source-routed PropsPreset predicates and original PS equations.
export const PROPSPRESET_GLSL = __PROPSPRESET_GLSL__;
const FAMILIES = ['clampAll', 'clampVertical', 'emissiveTwoUV', 'lodSimple'];
const ROLES = ['colorSmoothness', 'normalPacked', 'detailArray'];
function fingerprint(array) {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  let hash = 2166136261;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  return hash;
}

export async function prepareRecoveredPropsPresetMaterials(document, manager) {
  if (!document?.materials?.length) return { apply() {}, applyGeometry() {}, applied: 0, geometries: 0, provenance: null };
  if (document.schemaVersion !== 1) throw new Error('Unsupported source PropsPreset document');
  const loader = new THREE.TextureLoader(manager), binary = new THREE.FileLoader(manager).setResponseType('arraybuffer');
  const sources = new Map(Object.values(document.sourceTextures).map(row => [row.url, row]));
  const recipes = new Map();
  for (const row of document.materials) {
    const key = `${row.assetId}/${row.materialId}`;
    if (recipes.has(key) || !FAMILIES.includes(row.family) || row.constants.length < 1 || row.constants.length > 5 ||
        row.constants.some(value => value.length !== 4 || !value.every(Number.isFinite))) throw new Error('Invalid source PropsPreset recipe');
    recipes.set(key, row);
  }
  const textures = new Map(), urls = [...new Set(document.materials.flatMap(row => Object.values(row.textures)))];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, urls.length) }, async () => {
    while (next < urls.length) {
      const url = urls[next++], source = sources.get(url);
      if (!source) throw new Error(`Missing original PropsPreset texture provenance: ${url}`);
      let texture;
      if (source.format === 'rgba8-array') {
        const bytes = await binary.loadAsync(url);
        if (source.layers !== 10 || source.colorSpace !== 'linear' || bytes.byteLength !== source.width * source.height * 40) throw new Error('Invalid PropsPreset original detail array');
        texture = new THREE.DataArrayTexture(new Uint8Array(bytes), source.width, source.height, source.layers);
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
  const uvBytes = await binary.loadAsync(document.uv1.url), records = new Map();
  if (uvBytes.byteLength !== document.uv1.byteLength) throw new Error('Invalid original PropsPreset UV1 payload');
  for (const row of document.uv1.records) {
    if (!Number.isInteger(row.byteOffset) || row.byteOffset % 4 || row.byteOffset < 0 || row.byteLength !== row.vertexCount * 8 || row.byteOffset + row.byteLength > uvBytes.byteLength) throw new Error('Invalid source PropsPreset UV1 record');
    const values = new Float32Array(uvBytes, row.byteOffset, row.vertexCount * 2);
    if (!values.every(Number.isFinite)) throw new Error('Nonfinite original PropsPreset UV1');
    const key = `${row.assetId}/${row.sourceLod}`, selected = records.get(key) ?? [];
    selected.push(row); records.set(key, selected);
  }
  let applied = 0, geometries = 0;
  function applyGeometry(gltf, asset, sourceLod = 0) {
    const selected = records.get(`${asset.id ?? asset.assetId}/${sourceLod}`);
    if (!selected) return;
    const primitives = new Map();
    gltf.scene.traverse(mesh => { if (mesh.isMesh) primitives.set(gltf.parser?.associations.get(mesh)?.primitives, mesh); });
    for (const row of selected) {
      const mesh = primitives.get(row.primitiveIndex), geometry = mesh?.geometry;
      if (!geometry || geometry.attributes.position.count !== row.vertexCount || geometry.index?.count !== row.indexCount ||
          !geometry.attributes.uv || fingerprint(geometry.attributes.uv.array) !== row.uv0Fingerprint || fingerprint(geometry.index.array) !== row.indexFingerprint ||
          ![].concat(mesh.material).some(material => material.userData.sourceMaterialId === row.sourceMaterialId)) throw new Error(`Original PropsPreset primitive correspondence mismatch: ${row.assetId}/LOD${sourceLod}/${row.primitiveIndex}`);
      if (geometry.userData.recoveredPropsPresetUv?.sourceSha256 === row.uv1Sha256) continue;
      geometry.setAttribute('bf2PropsUv1', new THREE.BufferAttribute(new Float32Array(uvBytes, row.byteOffset, row.vertexCount * 2), 2));
      geometry.userData.recoveredPropsPresetUv = { evidenceId: document.uv1.evidenceId, sourceSha256: row.uv1Sha256, sourceLod, primitiveIndex: row.primitiveIndex };
      geometries++;
    }
  }
  return {
    provenance: { evidenceId: document.evidenceId, sections: recipes.size, textures: textures.size, uvRecords: document.uv1.records.length, materialGroups: document.materialGroups, runtimeMapping: document.runtimeMapping, limitations: document.limitations },
    get applied() { return applied; },
    get geometries() { return geometries; },
    applyGeometry,
    apply(gltf, asset) {
      applyGeometry(gltf, asset, 0);
      gltf.scene.traverse(mesh => {
        if (!mesh.isMesh) return;
        for (const material of [].concat(mesh.material)) {
          const recipe = recipes.get(`${asset.id ?? asset.assetId}/${material.userData.sourceMaterialId}`);
          if (!recipe) continue;
          const previous = material.userData.recoveredPropsPresetShader;
          if (previous) {
            if (previous.recipeKey !== `${recipe.assetId}/${recipe.materialId}`) throw new Error('Source PropsPreset material shared across unlike section recipes');
            continue;
          }
          if (!mesh.geometry.attributes.uv || (recipe.family === 'emissiveTwoUV' && !mesh.geometry.attributes.bf2PropsUv1)) throw new Error('Original PropsPreset coordinates missing');
          material.color.setRGB(1, 1, 1);
          material.roughness = 1;
          material.metalness = 0;
          material.map = material.normalMap = material.roughnessMap = material.metalnessMap = material.aoMap = material.emissiveMap = null;
          material.emissive?.setRGB(0, 0, 0);
          material.userData.recoveredPropsPresetShader = { evidenceId: document.evidenceId, recipeKey: `${recipe.assetId}/${recipe.materialId}`, family: recipe.family,
            pixelShader: recipe.pixelShader, atlasPixelShader: recipe.atlasPixelShader, sourceShader: document.shaderName,
            nativeLightingInputs: document.nativeLightingInputs, runtimeMapping: document.runtimeMapping };
          material.userData.placeholder = false;
          material.userData.neutralColorApproximation = false;
          configureSourceTangentMaterial(material,mesh.geometry);
          const family = FAMILIES.indexOf(recipe.family), twoUv = family === 2, lod = family === 3;
          material.onBeforeCompile = function(shader) {
            const roles = lod ? ROLES.slice(0, 2) : ROLES;
            for (const role of roles) shader.uniforms[`bf2_props_${role}`] = { value: textures.get(recipe.textures[role]) };
            const constants = Array.from({ length: 5 }, (_, index) => new THREE.Vector4(...(recipe.constants[index] ?? [0, 0, 0, 0])));
            shader.uniforms.bf2_props_cb = { value: constants };
            shader.vertexShader = `${twoUv ? 'attribute vec2 bf2PropsUv1;\n' : ''}varying vec4 bf2_props_uv;\n` + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n bf2_props_uv = vec4(uv, ${twoUv ? 'bf2PropsUv1' : 'uv'});`);
            shader.fragmentShader = `#define BF2_PROPS_FAMILY ${family}\n varying vec4 bf2_props_uv;
              uniform vec4 bf2_props_cb[5];
              uniform sampler2D bf2_props_colorSmoothness, bf2_props_normalPacked;
              ${lod ? '' : 'uniform highp sampler2DArray bf2_props_detailArray;'}
              ${PROPSPRESET_GLSL}
              mat3 bf2_props_tbn(vec3 position, vec3 n, vec2 uvValue) {
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
              PropsPresetSurface bf2_props_surface = samplePropsPreset(bf2_props_uv.xy, bf2_props_uv.zw, bf2_props_cb,
                bf2_props_colorSmoothness, bf2_props_normalPacked${lod ? '' : ', bf2_props_detailArray'});
              diffuseColor.rgb = bf2_props_surface.color;
            `);
            shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
              roughnessFactor = 1.0 - clamp(bf2_props_surface.smoothness, 0.0, 1.0);
            `);
            shader.fragmentShader = shader.fragmentShader.replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
              metalnessFactor = bf2_props_surface.metalness;
            `);
            shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
              mat3 bf2_props_frame = bf2_props_tbn(-vViewPosition, normal, bf2_props_uv.xy);
              normal = normalize(bf2_props_frame * bf2_props_surface.tangentNormal);
            `);
            shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
              // Source emission enters prelighting through the source-probe decorator.
              totalEmissiveRadiance = vec3(0.0);
            `);
            if(this.userData.sourceTangentFrame?.enabled){
              shader.vertexShader='varying vec3 bf2_props_geometricNormal;\n'+shader.vertexShader.replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
                bf2_props_geometricNormal = inverseTransformDirection(transformedNormal, viewMatrix);
              `);
              shader.fragmentShader='varying vec3 bf2_props_geometricNormal;\n'+shader.fragmentShader;
              injectSourceTangentFrame(shader,this,'propspreset');
            }
          };
          material.customProgramCacheKey = function() { return `bf2-source-PropsPreset-${recipe.family}-${recipe.pixelShader}-v2|`+sourceTangentProgramKey(this); };
          material.needsUpdate = true;
          applied++;
        }
      });
    },
    dispose() { for (const texture of textures.values()) texture.dispose(); },
  };
}
