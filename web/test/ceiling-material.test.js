import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import { CEILING_GLSL, prepareRecoveredCeilingMaterials } from '../src/ceiling-material.js';
import { createSourceProbeLighting } from '../src/source-probes.js';

const root = new URL('../../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root));
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const doc = JSON.parse(read('web/public/assets/recovered-ceiling-materials.json'));
const evidence = JSON.parse(read('exports/materials/ceiling-shader/material-analysis.json'));

test('ceiling source shader and all 20 default bindings retain exact section overrides', () => {
  assert.equal(doc.shaderNameHash, 1075960127);
  assert.equal(digest(read('exports/materials/rvm/0.res')), doc.sourceRvmSha256);
  assert.equal(digest(read('exports/materials/ceiling-shader/1fb4d25b38.dxbc')), doc.pixelShaderSha256);
  assert.equal(doc.materials.length, 20);
  assert.deepEqual(doc.textureMapping.map(x => x.parameterHash), [3908851759,3052299456,613096030]);
  assert.deepEqual(doc.constantMapping, evidence.constantMapping);
  const strengths = new Map();
  for (const row of doc.materials) {
    const source = evidence.materials.find(r => r.assetId === row.assetId && r.materialId === row.materialId);
    assert.equal(row.variationHash, 0);
    assert.deepEqual(row.constants, source.constants);
    assert.deepEqual(row.constantEvidence, source.constantEvidence);
    assert.deepEqual(row.bindings, source.bindings);
    assert.deepEqual(row.constants[0], [.5,0,0,0]);
    const strength = row.constants[2][0];
    strengths.set(strength, (strengths.get(strength) ?? 0) + 1);
  }
  assert.deepEqual([...strengths].sort((a,b)=>a[0]-b[0]), [[0,4],[3000,1],[5000,9],[15000,6]]);
  const firstAsset = doc.materials.filter(row => row.assetId === doc.materials[0].assetId);
  assert.deepEqual(firstAsset.map(row => row.constants[2][0]), [5000,0]);
});

test('ceiling packed texture bytes use native mip ranges and reuse verified metal inputs', () => {
  assert.equal(Object.keys(doc.sourceTextures).length, 3);
  let reused = 0, added = 0;
  for (const source of Object.values(doc.sourceTextures)) {
    const original = read(source.sourceDdsPath), selected = read(source.selectedDdsPath);
    assert.equal(digest(original), source.sourceDdsSha256);
    assert.equal(digest(selected), source.selectedDdsSha256);
    assert.deepEqual(selected.subarray(148), original.subarray(source.sourceDataOffset));
    const png = read(`web/public${source.url}`);
    assert.equal(digest(png), source.sha256);
    assert.ok(png.readUInt32BE(16) <= 1024 && png.readUInt32BE(20) <= 1024);
    if (source.url.startsWith('/assets/textures/master1uv/')) reused++;
    else added += png.length;
  }
  assert.equal(reused, 2);
  assert.equal(added, 2090);
});

test('ceiling source emission and metallic channel follow the ordinary GBuffer consumers', () => {
  assert.equal(CEILING_GLSL, read('tools/materials/ceiling-equations.glsl').toString());
  const validation = JSON.parse(read('exports/materials/ceiling-shader/equation-validation.json'));
  assert.equal(validation.cases, 2000);
  assert.ok(validation.maxAbsoluteError < 1e-10);
  assert.match(validation.coverage, /emission added to random prelighting/);
  assert.match(doc.runtimeMapping.emissive, /no per-material normalization/);
  assert.match(doc.runtimeMapping.metalness, /materialID0/);
  assert.equal(doc.nativeMaterialModel.materialId, 0);
  assert.equal(doc.nativeMaterialModel.reflectance, .5);
  assert.equal(doc.nativeMaterialModel.metalness, '0.5*metalCS.r');
  assert.equal(digest(read(doc.nativeMaterialModel.sourceAtlasRecipe)), doc.nativeMaterialModel.sourceAtlasRecipeSha256);
  assert.equal(doc.nativeLightingInputs.separateThreeEmission, false);
  assert.equal(doc.nativeLightingInputs.rawSmoothness, 'bf2_ceiling_surface.smoothness');
  const atlasProof = JSON.parse(read('exports/materials/ceiling-static-atlas/parity-evidence.json'));
  assert.equal(atlasProof.classification.decoderValidation.cases, 1000);
  assert.ok(atlasProof.classification.decoderValidation.maximumAbsoluteError < 1e-12);
  assert.equal(atlasProof.sourceDomainAtlasKernelEqual, true);
  assert.equal(atlasProof.unrestrictedAtlasKernelEqual, false);
  assert.match(doc.runtimeMapping.normal, /all21 selected section\/LOD records and493/);
  assert.match(doc.runtimeMapping.normal, /unbound geometry retains the derivative fallback/);
});

test('ceiling material hooks retain separate lit/unlit uniforms after source probe decoration', async () => {
  const priorLoad = THREE.TextureLoader.prototype.loadAsync, loaded = [];
  THREE.TextureLoader.prototype.loadAsync = async function (url) {
    const texture = new THREE.Texture(); texture.name = url; loaded.push(texture); return texture;
  };
  try {
    const recovered = await prepareRecoveredCeilingMaterials(doc);
    assert.equal(loaded.length, 3);
    const assetId = doc.materials[0].assetId, scene = new THREE.Group(), geometry = new THREE.BoxGeometry();
    const recipes = doc.materials.filter(row => row.assetId === assetId);
    for (const recipe of recipes) {
      const material = new THREE.MeshStandardMaterial({metalness: .7, emissive: 0xff0000});
      material.userData.sourceMaterialId = recipe.materialId;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(-919.68,587.52,-319.9382);scene.add(mesh);
    }
    recovered.apply({scene}, {id:'unrelated-asset'});
    assert.equal(recovered.applied, 0);
    recovered.apply({scene}, {id:assetId});
    recovered.apply({scene}, {id:assetId});
    assert.equal(recovered.applied, 2);
    const probes = JSON.parse(read('web/public/assets/source-probes.json'));
    const bytes = read('web/public/assets/source-probes.bin');
    const lighting = createSourceProbeLighting(probes, new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4));
    for (const [index, mesh] of scene.children.entries()) {
      assert.equal(mesh.material.metalness, 0);
      assert.equal(mesh.material.emissive.getHex(), 0);
      assert.equal(mesh.material.userData.placeholder, false);
      lighting.add(mesh);
      const shader = {vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};
      mesh.material.onBeforeCompile(shader, {});
      assert.deepEqual(shader.uniforms.bf2_ceiling_cb.value.map(v=>v.toArray()), recipes[index].constants);
      assert.equal(shader.uniforms.bf2_ceiling_mask.value.name, recipes[index].textures.mask);
      assert.ok(shader.fragmentShader.includes('metalnessFactor = bf2_ceiling_surface.nativeScalar'));
      assert.ok(shader.fragmentShader.includes('totalEmissiveRadiance = vec3(0.0)'));
      assert.ok(!shader.fragmentShader.includes('totalEmissiveRadiance = bf2_ceiling_surface.emissive'));
      assert.match(shader.fragmentShader, /irradiance \+= PI \* \(bf2_probeDiffuse\([^;]+\)\+bf2_ceiling_surface\.emissive\)/);
      assert.equal((shader.fragmentShader.match(/\+bf2_ceiling_surface\.emissive/g) ?? []).length, 1);
      assert.equal(mesh.material.userData.recoveredCeilingShader.nativeLightingInputs.separateThreeEmission, false);
      assert.ok(shader.vertexShader.includes('bf2_ceiling_uv = uv'));
      assert.ok(mesh.material.customProgramCacheKey().includes('SS_DSI_Ceiling_01'));
    }
    lighting.dispose();geometry.dispose();for (const texture of loaded)texture.dispose();
  } finally { THREE.TextureLoader.prototype.loadAsync = priorLoad; }
});
