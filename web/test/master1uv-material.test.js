import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import { MASTER1UV_GLSL, prepareRecoveredMasterMaterials } from '../src/master1uv-material.js';
import { createStaticBatches } from '../src/static-batches.js';
import { createSourceProbeLighting } from '../src/source-probes.js';

const root = new URL('../../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root));
const doc = JSON.parse(read('web/public/assets/recovered-master1uv-materials.json'));
const evidence = JSON.parse(read('exports/materials/master1uv-shader/material-analysis.json'));
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

test('Master1UV source identity and all 114 exact default section bindings remain intact', () => {
  assert.equal(doc.shaderNameHash, 2187307923);
  assert.equal(digest(read('exports/materials/rvm/0.res')), doc.sourceRvmSha256);
  assert.equal(digest(read('exports/materials/master1uv-shader/6d0dd89b35.dxbc')), doc.pixelShaderSha256);
  assert.equal(doc.materials.length, 114);
  assert.equal(new Set(doc.materials.map(row => `${row.assetId}/${row.materialId}`)).size, 114);
  assert.deepEqual(doc.textureMapping.map(row => row.parameterHash), [3886168014,1840368952,4264966676,2517056835,3273948515,2351883907,594790500,3052299456,613096030,1793132757]);
  assert.deepEqual(doc.constantMapping, evidence.constantMapping);
  for (const row of doc.materials) {
    const source = evidence.materials.find(r => r.assetId === row.assetId && r.materialId === row.materialId);
    assert.equal(row.variationHash, 0);
    assert.deepEqual(row.constants, source.constants);
    assert.deepEqual(row.constantEvidence, source.constantEvidence);
    assert.deepEqual(row.bindings, source.bindings);
    for (const [role, binding] of Object.entries(row.bindings)) {
      assert.equal(row.textures[role], doc.sourceTextures[binding.texture.fileGuid].url);
      assert.equal(binding.sourceEntry, row.sourceEntry);
      assert.equal(binding.sourceSection, row.sourceSection);
    }
  }
  assert.deepEqual(doc.materials[0].constants[1], [4,4,0,0]);
});

test('all 52 bounded textures preserve native DDS mip payloads and decoded PNG bytes', () => {
  assert.equal(Object.keys(doc.sourceTextures).length, 52);
  let bytes = 0;
  for (const row of Object.values(doc.sourceTextures)) {
    const source = read(row.sourceDdsPath), selected = read(row.selectedDdsPath);
    assert.equal(digest(source), row.sourceDdsSha256);
    assert.equal(digest(selected), row.selectedDdsSha256);
    assert.deepEqual(selected.subarray(148), source.subarray(row.sourceDataOffset));
    assert.ok(row.width <= 1024 && row.height <= 1024);
    assert.equal(selected.readUInt32LE(16), row.width);
    assert.equal(selected.readUInt32LE(12), row.height);
    assert.equal(row.colorSpace, row.sourceMetadata.pixelFormat.endsWith('_SRGB') ? 'srgb' : 'linear');
    const png = read(`web/public${row.url}`);
    assert.equal(digest(png), row.sha256);
    assert.equal(png.readUInt32BE(16), row.width);
    assert.equal(png.readUInt32BE(20), row.height);
    bytes += png.length;
  }
  assert.ok(bytes < 45 * 1024 * 1024);
});

test('browser algebra matches the validated recipe and documents remaining renderer mappings', () => {
  assert.equal(MASTER1UV_GLSL, read('tools/materials/master1uv-equations.glsl').toString());
  const validation = JSON.parse(read('exports/materials/master1uv-shader/equation-validation.json'));
  assert.equal(validation.cases, 2280);
  assert.equal(validation.fragmentNormalizationMutation.detectedCases, 1140);
  assert.ok(validation.fragmentNormalizationMutation.maximumSmoothnessError > .15);
  assert.ok(validation.maxAbsoluteError < 1e-10);
  assert.match(doc.runtimeMapping.metalness, /BF2-NATIVE-GBUFFER-001/);
  assert.match(doc.runtimeMapping.metalness, /o2.y as metalness/);
  assert.match(doc.runtimeMapping.metalness, /quantization remains unresolved/);
  assert.match(doc.runtimeMapping.normal, /unproven/);
  assert.match(doc.runtimeMapping.colorSpace, /unresolved/);
});

test('Master1UV survives static batching and probe decoration while retaining exact uniforms', async () => {
  const originalLoad = THREE.TextureLoader.prototype.loadAsync;
  const loaded = [];
  THREE.TextureLoader.prototype.loadAsync = async function (url) {
    const texture = new THREE.Texture();
    texture.name = url; loaded.push(texture); return texture;
  };
  try {
    const recovered = await prepareRecoveredMasterMaterials(doc);
    assert.equal(loaded.length, 52);
    const recipe = doc.materials[0], geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial();
    material.userData.sourceMaterialId = recipe.materialId;
    const mesh = new THREE.Mesh(geometry, material), scene = new THREE.Group(); scene.add(mesh);
    recovered.apply({scene}, {id: 'unrelated-asset'});
    assert.equal(recovered.applied, 0);
    recovered.apply({scene}, {id: recipe.assetId});
    recovered.apply({scene}, {id: recipe.assetId});
    assert.equal(recovered.applied, 1);
    assert.equal(material.userData.placeholder, false);
    assert.equal(material.normalMap, null);
    const transforms = [0, 1].map(x => ({matrix: new THREE.Matrix4().makeTranslation(-919.68+x,587.52,-319.9382).toArray()}));
    const [batch] = createStaticBatches(mesh, transforms, {id: recipe.assetId});
    assert.ok(batch.isInstancedMesh);
    assert.equal(batch.material, material);
    const probes = JSON.parse(read('web/public/assets/source-probes.json'));
    const probeBytes = read('web/public/assets/source-probes.bin');
    const probeValues = new Float32Array(probeBytes.buffer, probeBytes.byteOffset, probeBytes.byteLength/4);
    const lighting = createSourceProbeLighting(probes, probeValues);
    lighting.add(batch);
    const shader = {vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {}};
    batch.material.onBeforeCompile(shader, {});
    assert.deepEqual(shader.uniforms.bf2_master_cb.value.map(v => v.toArray()), recipe.constants);
    for (const [role, url] of Object.entries(recipe.textures)) {
      const texture = shader.uniforms[`bf2_master_${role}`].value;
      assert.equal(texture.name, url);
      const source = Object.values(doc.sourceTextures).find(row => row.url === url);
      assert.equal(texture.colorSpace, source.colorSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace);
      assert.equal(texture.flipY, false);
    }
    assert.ok(shader.fragmentShader.includes('Master1UVSurface bf2_master_surface'));
    assert.ok(shader.fragmentShader.includes('irradiance += PI * bf2_probeDiffuse'));
    assert.ok(shader.fragmentShader.includes('reflectedLight.indirectDiffuse *= bf2_master_surface.ao'));
    assert.ok(shader.vertexShader.includes('instanceMatrix * bf2_master_wp'));
    assert.ok(batch.material.customProgramCacheKey().includes(material.customProgramCacheKey()));
    lighting.dispose();geometry.dispose();material.dispose();
    for (const texture of loaded) texture.dispose();
  } finally {
    THREE.TextureLoader.prototype.loadAsync = originalLoad;
  }
});
