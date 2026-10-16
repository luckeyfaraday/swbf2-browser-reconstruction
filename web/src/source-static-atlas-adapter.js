import * as THREE from 'three';
import {SOURCE_STATIC_ATLAS_GLSL, SOURCE_STATIC_ATLAS_POLICY} from './source-static-atlas.js';

function fingerprint(array) {
  let hash = 2166136261;
  for (const value of new Uint8Array(array.buffer, array.byteOffset, array.byteLength)) hash = Math.imul(hash ^ value, 16777619) >>> 0;
  return hash;
}
async function checkedBytes(row, fetchPayload) {
  const response = await fetchPayload(row.url);
  if (!response.ok) throw new Error(`Original static atlas payload HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== row.byteLength) throw new Error('Original static atlas payload size mismatch');
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
  if (hash !== row.sha256) throw new Error('Original static atlas payload hash mismatch');
  return bytes;
}

/** Original-size native compression avoids the filtering changes observed when
 * decoding BC6H/BC7 to a cropped RGBA32F array. Geometry is independently bound. */
export async function prepareSourceStaticAtlas(document, {lightMapPreExposure, fetch: fetchPayload = globalThis.fetch} = {}) {
  if (document?.version !== 1 || document.width !== 5232 || document.height !== 4908 || document.mipCount !== 1 ||
      document.directions?.layers !== 4 || document.irradiance?.format !== 'BC6U_FLOAT' || document.directions?.format !== 'BC7_UNORM') throw new Error('Unsupported source static atlas');
  if (!Number.isFinite(lightMapPreExposure) || lightMapPreExposure < 0) throw new Error('Original static atlas requires explicit native LightMapPreExposure');
  const [irradianceBytes, directionBytes, uvBytes] = await Promise.all([document.irradiance, document.directions, document.uv].map(row => checkedBytes(row, fetchPayload)));
  const {width, height} = document;
  const irradiance = new THREE.CompressedTexture([{data: new Uint8Array(irradianceBytes), width, height}], width, height, THREE.RGB_BPTC_UNSIGNED_Format);
  const directions = new THREE.CompressedArrayTexture([{data: new Uint8Array(directionBytes), width, height}], width, height, 4, THREE.RGBA_BPTC_Format);
  for (const texture of [irradiance, directions]) {
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.colorSpace = THREE.NoColorSpace; texture.generateMipmaps = false; texture.flipY = false; texture.needsUpdate = true;
  }
  const sourceRecords = new Map(), instances = new Map(document.instances.map(row => [row.instanceIndex, row]));
  const materialIds = new Map(document.materials.map(row => [`${row.assetId}/${row.materialId}`, row]));
  const boundPlacementIndices = new Set(), familyCounts = {};
  let sourceGeometries = 0, boundDraws = 0, boundInstances = 0, fallbackInstances = 0, compiled = 0;
  for (const row of document.uv.records) {
    if (row.byteLength !== row.vertexCount * 8 || row.byteOffset < 0 || row.byteOffset + row.byteLength > uvBytes.byteLength) throw new Error('Invalid original radiosity UV range');
    const key = `${row.assetId}/${row.sourceLod}`, rows = sourceRecords.get(key) ?? [];
    rows.push(row); sourceRecords.set(key, rows);
  }
  const uniforms = {bf2_staticIrradiance: {value: irradiance}, bf2_staticDirections: {value: directions}, bf2_staticPreExposure: {value: lightMapPreExposure}};
  function applyGeometry(gltf, asset, sourceLod = 0) {
    const rows = sourceRecords.get(`${asset.id ?? asset.assetId}/${sourceLod}`);
    if (!rows) return;
    const primitives = new Map();
    gltf.scene.traverse(mesh => {if (mesh.isMesh) primitives.set(gltf.parser.associations.get(mesh)?.primitives, mesh);});
    for (const row of rows) {
      const geometry = primitives.get(row.primitiveIndex)?.geometry;
      if (!geometry || geometry.attributes.position.count !== row.vertexCount || geometry.index?.count !== row.indexCount ||
          fingerprint(geometry.attributes.uv.array) !== row.uv0Fingerprint || fingerprint(geometry.index.array) !== row.indexFingerprint) throw new Error('Original radiosity UV topology mismatch');
      if (geometry.userData.sourceRadiosityUv?.sha256 === row.sourceSha256) continue;
      geometry.setAttribute('bf2RadiosityUv', new THREE.BufferAttribute(new Float32Array(uvBytes, row.byteOffset, row.vertexCount * 2), 2));
      geometry.userData.sourceRadiosityUv = {evidenceId: document.evidenceId, sha256: row.sourceSha256, sourceLod, primitiveIndex: row.primitiveIndex};
      sourceGeometries++;
    }
  }
  function decorateGeometry(mesh, geometry) {
    const material = materialIds.get(`${mesh.userData.assetId}/${mesh.userData.sourceMaterialId}`);
    // Moving doors resample probes. Their authored closed-position chart is not
    // evidence that a moving renderer should consume static prelighting.
    if (mesh.userData.sourceDoor || !geometry.attributes.bf2RadiosityUv || !material) return false;
    const indices = mesh.userData.sourceInstanceIndices;
    if (!Array.isArray(indices) || indices.length !== (mesh.isInstancedMesh ? mesh.count : 1)) throw new Error('Static atlas requires original instance indices');
    const count = mesh.isInstancedMesh ? mesh.count : geometry.attributes.position.count, values = new Float32Array(count * 4);
    let matched = 0;
    for (let i = 0; i < indices.length; i++) {
      const row = instances.get(indices[i]);
      if (!row) continue;
      if (row.assetId !== mesh.userData.assetId) throw new Error('Original atlas instance asset mismatch');
      const transform = [row.values[0], row.values[3], row.values[4], row.values[5]];
      if (mesh.isInstancedMesh) values.set(transform, i * 4);
      else for (let vertex = 0; vertex < count; vertex++) values.set(transform, vertex * 4);
      matched++;
      boundPlacementIndices.add(indices[i]);
    }
    geometry.setAttribute('bf2StaticAtlasTransform', mesh.isInstancedMesh ? new THREE.InstancedBufferAttribute(values, 4) : new THREE.BufferAttribute(values, 4));
    if (!mesh.userData.sourceStaticAtlas) {
      boundDraws++; boundInstances += matched; fallbackInstances += indices.length - matched;
      const family = material.family ?? 'floor';
      const counts = familyCounts[family] ??= {boundDraws: 0, boundInstances: 0, fallbackInstances: 0};
      counts.boundDraws++; counts.boundInstances += matched; counts.fallbackInstances += indices.length - matched;
      mesh.userData.sourceStaticAtlas = {matched, fallback: indices.length - matched, family};
    }
    return true;
  }
  function decorateShader(shader) {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = 'attribute vec2 bf2RadiosityUv;\nattribute vec4 bf2StaticAtlasTransform;\nvarying vec3 bf2_staticAtlasUv;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      bf2_staticAtlasUv=vec3(bf2RadiosityUv*bf2StaticAtlasTransform.xy+bf2StaticAtlasTransform.zw,bf2StaticAtlasTransform.x);
    `);
    shader.fragmentShader = `${SOURCE_STATIC_ATLAS_GLSL}
      uniform sampler2D bf2_staticIrradiance;
      uniform highp sampler2DArray bf2_staticDirections;
      uniform float bf2_staticPreExposure;
      varying vec3 bf2_staticAtlasUv;
      vec3 bf2_probeDiffuse(vec3 n);
      vec3 bf2_staticAtlasOrProbe(vec3 probeNormal,vec3 atlasNormal,vec3 view,float smoothness) {
        if(bf2_staticAtlasUv.z<=0.0)return bf2_probeDiffuse(probeNormal);
        vec2 uv=bf2_staticAtlasUv.xy;
        return bf2_staticAtlasPrelighting(texture2D(bf2_staticIrradiance,uv).rgb,
          texture(bf2_staticDirections,vec3(uv,0.0)).rgb*2.0-1.0,
          texture(bf2_staticDirections,vec3(uv,1.0)).rgb*2.0-1.0,
          texture(bf2_staticDirections,vec3(uv,2.0)).rgb*2.0-1.0,
          atlasNormal,view,smoothness,bf2_staticPreExposure);
      }
    ` + shader.fragmentShader;
    compiled++;
  }
  return {applyGeometry, decorateGeometry, decorateShader, uniforms,
    snapshot: () => ({evidenceId: document.evidenceId, sourceGeometries, boundDraws, boundInstances, fallbackInstances, compiled,
      boundPlacements: boundPlacementIndices.size, families: structuredClone(familyCounts), expected: document.families ?? null,
      lightMapPreExposure, sourceTextureBytes: irradianceBytes.byteLength + directionBytes.byteLength, sourceUvBytes: uvBytes.byteLength,
      policy: document.packingPolicy, arithmetic: SOURCE_STATIC_ATLAS_POLICY,
      limitations: [...document.limitations, 'Sky-visibility texels retained. Selected local-volume source flags disable sky AO and masking; native entity-to-runtime flag construction remains separately scoped.']}),
    dispose() {irradiance.dispose(); directions.dispose();},
  };
}
