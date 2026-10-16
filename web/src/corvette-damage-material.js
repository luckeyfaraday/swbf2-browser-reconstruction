import * as THREE from 'three';

// Generated from tools/materials/corvette_damage-*; native register-to-UV association
// remains an explicit inference in document.uvRouting, not an exactness claim.
export const CORVETTE_DAMAGE_GLSL = "// LOCAL-CORVETTE-DAMAGE-SHADER-001; original deferred PS d92fda6613.\nstruct CorvetteDamageSurface { vec3 color; vec3 tangentNormal; float smoothness; float metalness; };\nCorvetteDamageSurface sampleCorvetteDamage(vec2 baseUv, vec2 tiledUv, float vertexDamage, float arrayLayer,\n  sampler2D dirtMap, sampler2D normalMetalMap, sampler2D colorMap,\n  highp sampler2DArray detailArrayMap, sampler2D wreckMap) {\n  vec3 dirt = texture2D(dirtMap, tiledUv * 6.0).rgb;\n  vec3 detail = texture(detailArrayMap, vec3(tiledUv * 3.0, arrayLayer)).rgb;\n  vec4 wreck = texture2D(wreckMap, tiledUv * 2.0);\n  vec3 base = texture2D(colorMap, baseUv).rgb;\n  vec3 normalMetal = texture2D(normalMetalMap, baseUv).rgb;\n  float damage = vertexDamage * (1.0 + wreck.a); // Original unsaturated weight.\n  float smoothA = mix(1.2 * dirt.r, base.r, 0.5289999842643738);\n  float smoothB = mix(dirt.r, detail.b, 0.5270000100135803);\n  float smoothness = mix(2.0 * smoothA * smoothB, 0.8, 0.7670000195503235);\n  smoothness = mix(smoothness, 1.4 * wreck.b, damage);\n  vec2 baseNormalXY = 2.0 * mix(normalMetal.rg, wreck.rg, damage) - 1.0;\n  float normalZ = sqrt(max(1.0 - dot(baseNormalXY, baseNormalXY), 0.0));\n  vec3 baseColor = base * mix(dirt, base, 0.5730000138282776);\n  CorvetteDamageSurface result;\n  result.color = mix(baseColor, vec3(wreck.a), damage);\n  result.tangentNormal = vec3(baseNormalXY + 2.0 * detail.rg - 1.0, normalZ);\n  result.smoothness = smoothness;\n  result.metalness = normalMetal.b;\n  return result;\n}\n";
const ROLES = ['dirt', 'normalMetal', 'color', 'detailArray', 'wreck'];
function fingerprint(array) {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  let hash = 2166136261;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  return hash;
}

export async function prepareRecoveredCorvetteDamageMaterials(document, manager) {
  if (!document?.materials?.length) return { apply() {}, applyGeometry() {}, applied: 0, provenance: null };
  const loader = new THREE.TextureLoader(manager), binary = new THREE.FileLoader(manager).setResponseType('arraybuffer');
  const textures = new Map(), sources = new Map(Object.values(document.sourceTextures).map(row => [row.url, row]));
  const urls = [...new Set(document.materials.flatMap(row => Object.values(row.textures)))];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, urls.length) }, async () => {
    while (next < urls.length) {
      const url = urls[next++], source = sources.get(url);
      if (!source) throw new Error(`Missing CorvetteDamage texture provenance: ${url}`);
      let texture;
      if (source.format === 'rgba8-array') {
        const data = await binary.loadAsync(url);
        if (data.byteLength !== source.width * source.height * source.layers * 4 || source.layers !== 2 || source.colorSpace !== 'linear') throw new Error('Invalid original CorvetteDamage layers');
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
  const uvBytes = await binary.loadAsync(document.vertexInputs.url);
  if (uvBytes.byteLength !== document.vertexInputs.byteLength) throw new Error('Invalid original CorvetteDamage UV1 payload');
  const records = new Map();
  for (const row of document.vertexInputs.records) {
    if (row.byteLength !== row.vertexCount * 16 || row.byteOffset < 0 || row.byteOffset + row.byteLength > uvBytes.byteLength) throw new Error('Invalid CorvetteDamage UV1 record');
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
        throw new Error(`Original CorvetteDamage primitive correspondence mismatch: ${row.assetId}/LOD${sourceLod}/${row.primitiveIndex}`);
      }
      if (geometry.userData.recoveredCorvetteDamage?.sourceVertexSha256 === row.packedSha256) continue;
      const attribute = new THREE.BufferAttribute(new Float32Array(uvBytes, row.byteOffset, row.vertexCount * 4), 4);
      geometry.setAttribute('bf2CorvetteDamage', attribute);
      geometry.userData.recoveredCorvetteDamage = { evidenceId: document.vertexInputs.evidenceId, sourceVertexSha256: row.packedSha256, sourceLod, primitiveIndex: row.primitiveIndex };
      geometries++;
    }
  }
  return {
    provenance: { evidenceId: document.evidenceId, sections: recipes.size, textures: textures.size, uvRecords: document.vertexInputs.records.length, runtimeMapping: document.runtimeMapping, limitations: document.limitations },
    get applied() { return applied; },
    get geometries() { return geometries; },
    applyGeometry,
    apply(gltf, asset) {
      applyGeometry(gltf, asset, 0);
      gltf.scene.traverse(mesh => {
        if (!mesh.isMesh) return;
        for (const material of [].concat(mesh.material)) {
          if (material.userData.recoveredCorvetteDamageShader) continue;
          const recipe = recipes.get(`${asset.id}/${material.userData.sourceMaterialId}`);
          if (!recipe) continue;
          if (!mesh.geometry.getAttribute('uv') || !mesh.geometry.getAttribute('bf2CorvetteDamage')) throw new Error('Original CorvetteDamage coordinates missing');
          material.color.setRGB(1, 1, 1);
          material.roughness = 1;
          material.metalness = 0;
          material.map = material.normalMap = material.roughnessMap = material.metalnessMap = material.aoMap = material.emissiveMap = null;
          material.emissive?.setRGB(0, 0, 0);
          material.userData.recoveredCorvetteDamageShader = { evidenceId: document.evidenceId, sourceShader: recipe.sourceShader, runtimeMapping: document.runtimeMapping, nativeLightingInputs: document.nativeLightingInputs, uvRouting: document.uvRouting };
          material.userData.placeholder = false;
          material.userData.neutralColorApproximation = false;
          material.onBeforeCompile = shader => {
            for (const role of ROLES) shader.uniforms[`bf2_corvette_damage_${role}`] = { value: textures.get(recipe.textures[role]) };
            shader.uniforms.bf2_corvette_damage_cb = { value: recipe.constants.map(v => new THREE.Vector4(...v)) };
            shader.vertexShader = `attribute vec4 bf2CorvetteDamage;
              varying float bf2_corvette_damage_damage;
              flat varying float bf2_corvette_damage_index;
              varying vec4 bf2_corvette_damage_uv;
            ` + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
              bf2_corvette_damage_uv = vec4(uv, bf2CorvetteDamage.xy);
              bf2_corvette_damage_damage = bf2CorvetteDamage.z;
              bf2_corvette_damage_index = bf2CorvetteDamage.w;
            `);
            shader.fragmentShader = `varying vec4 bf2_corvette_damage_uv;
              varying float bf2_corvette_damage_damage;
              flat varying float bf2_corvette_damage_index;
              uniform vec4 bf2_corvette_damage_cb[8];
              uniform sampler2D bf2_corvette_damage_dirt;
              uniform sampler2D bf2_corvette_damage_normalMetal;
              uniform sampler2D bf2_corvette_damage_wreck;
              uniform highp sampler2DArray bf2_corvette_damage_detailArray;
              uniform sampler2D bf2_corvette_damage_color;
              ${CORVETTE_DAMAGE_GLSL}
              mat3 bf2_corvette_damage_tbn(vec3 position, vec3 n, vec2 uvValue) {
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
              CorvetteDamageSurface bf2_corvette_damage_surface = sampleCorvetteDamage(bf2_corvette_damage_uv.xy, bf2_corvette_damage_uv.zw,
                bf2_corvette_damage_damage, bf2_corvette_damage_cb[int(bf2_corvette_damage_index)].x, ${ROLES.map(role => `bf2_corvette_damage_${role}`).join(', ')});
              diffuseColor.rgb = bf2_corvette_damage_surface.color;
            `);
            shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
              roughnessFactor = 1.0 - clamp(bf2_corvette_damage_surface.smoothness, 0.0, 1.0);
            `);
            shader.fragmentShader = shader.fragmentShader.replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
              metalnessFactor = bf2_corvette_damage_surface.metalness;
            `);
            shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
              mat3 bf2_corvette_damage_frame = bf2_corvette_damage_tbn(-vViewPosition, normal, bf2_corvette_damage_uv.xy);
              normal = normalize(bf2_corvette_damage_frame * bf2_corvette_damage_surface.tangentNormal);
            `);
          };
          material.customProgramCacheKey = () => 'bf2-source-SS_CovetteCR90_Interior_01_Damage_01-d92fda6613-v1';
          material.needsUpdate = true;
          applied++;
        }
      });
    },
  };
}
