import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {PROPSPRESET_GLSL, prepareRecoveredPropsPresetMaterials} from '../src/propspreset-material.js';
import {createSourceProbeLighting} from '../src/source-probes.js';
import {createSourceDfgTexture} from '../src/source-dfg.js';
import {isSourceOrdinaryMaterial} from '../src/source-direct-adapter.js';

const root = new URL('../../', import.meta.url), read = path => fs.readFileSync(new URL(path, root));
const json = path => JSON.parse(read(path)), sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const buffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const doc = json('web/public/assets/recovered-propspreset-materials.json');
const sceneDocument = json('web/public/assets/map.scene.json');
const routing = json('exports/materials/propspreset-routing/routing-evidence.json');
const loader = new GLTFLoader();
loader.register(() => ({name: 'PropsPresetCpuImageStub', loadTexture: async () => new THREE.Texture()}));
async function model(recipe) {
  const asset = sceneDocument.assets.find(row => row.id === recipe.assetId);
  return {asset, gltf: await loader.parseAsync(buffer(read(`web/public/assets/${asset.url}`)), '')};
}
async function withLoaders(callback) {
  const previousImage = THREE.TextureLoader.prototype.loadAsync, previousFile = THREE.FileLoader.prototype.loadAsync;
  THREE.TextureLoader.prototype.loadAsync = async function(url) { const texture = new THREE.Texture(); texture.name = url; return texture; };
  THREE.FileLoader.prototype.loadAsync = async function(url) { return buffer(read(`web/public${url}`)); };
  let recovered;
  try { recovered = await prepareRecoveredPropsPresetMaterials(doc); return await callback(recovered); }
  finally { recovered?.dispose(); THREE.TextureLoader.prototype.loadAsync = previousImage; THREE.FileLoader.prototype.loadAsync = previousFile; }
}
function shaderFor(material) {
  const shader = {vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {}};
  material.onBeforeCompile(shader, {});
  return shader;
}

test('PropsPreset uses exact source conditions and distinct selected material branches', () => {
  assert.equal(doc.materials.length, 27);
  assert.equal(doc.placedSectionCount, 474);
  assert.equal(sha(read(doc.routingEvidence)), doc.routingSha256);
  assert.equal(sha(read('exports/materials/rvm/0.res')), doc.sourceRvmSha256);
  assert.deepEqual(routing.materialGroups.map(row => row.sectionCount), [1, 1, 5, 20]);
  assert.deepEqual(routing.tree, {rootBlock: '5aac7893cf', wordBlock: '1e5b378a94', words: 2471, decodedNodes: 716, backreferences: 371, reachablePermutationLeaves: 172, byteCoverageComplete: true});
  for (const material of doc.materials) {
    const source = routing.sections.find(row => row.assetId === material.assetId && row.materialId === material.materialId);
    assert.equal(material.pixelShader, source.ordinaryPixelShader);
    assert.deepEqual(material.sourcePermutationIndices, source.permutationIndices);
    assert.equal(sha(read(`exports/materials/propspreset-shader/${material.pixelShader}.dxbc`)), material.pixelShaderSha256);
    for (const [index, constant] of material.constantEvidence.entries()) {
      const bytes = Buffer.from(constant.rawHex, 'hex');
      assert.deepEqual(material.constants[index], [0, 4, 8, 12].map(at => bytes.readFloatLE(at)));
    }
    assert.deepEqual(Object.keys(material.textures), material.family === 'lodSimple' ? ['colorSmoothness', 'normalPacked'] : ['colorSmoothness', 'normalPacked', 'detailArray']);
  }
  assert.equal(doc.geometryRouting.activeAlternativeLods.length, 2);
  assert.ok(doc.geometryRouting.activeAlternativeLods.every(row => row.materialParameterBlocksEqual && row.ordinaryPixelShader === 'c13680b516'));
});

test('PropsPreset texture publication preserves source mip suffixes and original array identity', () => {
  assert.equal(Object.keys(doc.sourceTextures).length, 11);
  let arrayCount = 0, newBytes = 0;
  for (const texture of Object.values(doc.sourceTextures)) {
    const original = read(texture.sourceDdsPath);
    assert.equal(sha(original), texture.sourceDdsSha256);
    assert.equal(sha(read(`web/public${texture.url}`)), texture.sha256);
    for (const slice of texture.slices) {
      const selected = read(slice.selectedDdsPath);
      assert.equal(sha(selected), slice.selectedDdsSha256);
      assert.deepEqual(selected.subarray(148), original.subarray(slice.sourceDataOffset, slice.sourceDataOffset + slice.retainedDataBytes));
    }
    if (texture.format === 'rgba8-array') {
      assert.equal(texture.source.rootInstanceGuid, 'd72f699d-b7ad-f0da-de8e-7f2741b3ef4c');
      assert.equal(texture.layers, 10);
      assert.deepEqual(texture, json('web/public/assets/recovered-array2uv-materials.json').sourceTextures[texture.source.fileGuid]);
      arrayCount++;
    } else newBytes += texture.bytes;
  }
  assert.equal(arrayCount, 1);
  assert.equal(newBytes, 6904657);
});

test('all 27 real GLTF sections route idempotently without topology or UV0 changes', async () => withLoaders(async recovered => {
  let matching = 0;
  for (const id of new Set(doc.materials.map(row => row.assetId))) {
    const recipe = doc.materials.find(row => row.assetId === id), {asset, gltf} = await model(recipe), original = new Map();
    gltf.scene.traverse(mesh => { if (mesh.isMesh) original.set(mesh, [mesh.geometry, mesh.geometry.attributes.position, mesh.geometry.attributes.uv, mesh.geometry.index]); });
    recovered.apply(gltf, {id: 'unrelated'});
    recovered.apply(gltf, asset);
    recovered.apply(gltf, asset);
    gltf.scene.traverse(mesh => {
      if (!mesh.isMesh) return;
      assert.deepEqual([mesh.geometry, mesh.geometry.attributes.position, mesh.geometry.attributes.uv, mesh.geometry.index], original.get(mesh));
      for (const material of [].concat(mesh.material)) {
        const selected = doc.materials.find(row => row.assetId === id && row.materialId === material.userData.sourceMaterialId);
        assert.equal(!!material.userData.recoveredPropsPresetShader, !!selected);
        if (selected) { matching++; assert.equal(material.userData.placeholder, false); assert.equal(material.map, null); assert.equal(isSourceOrdinaryMaterial(material), true); }
      }
    });
  }
  assert.equal(matching, 27);
  assert.equal(recovered.applied, 27);
  assert.equal(recovered.geometries, 1);
}));

test('alarm UV1 requires exact original topology and input-layout correspondence', async () => withLoaders(async recovered => {
  const recipe = doc.materials.find(row => row.family === 'emissiveTwoUV'), {asset, gltf} = await model(recipe), record = doc.uv1.records[0];
  const geometry = gltf.scene.children.find(mesh => mesh.isMesh)?.geometry ?? (() => {let result; gltf.scene.traverse(mesh => {if (mesh.isMesh) result = mesh.geometry;}); return result;})();
  recovered.apply(gltf, asset);
  const uv = geometry.attributes.bf2PropsUv1;
  assert.equal(sha(new Uint8Array(uv.array.buffer, uv.array.byteOffset, uv.array.byteLength)), record.uv1Sha256);
  assert.equal(doc.geometryRouting.alarmUv.nativeInputLayout.rows[3].alignedByteOffset, 24);
  assert.equal(doc.geometryRouting.alarmUv.nativeInputLayout.rows[3].dxgiFormat, 10);
  const original = geometry.attributes.uv.array[0]; geometry.attributes.uv.array[0] += .125;
  assert.throws(() => recovered.applyGeometry(gltf, asset), /correspondence mismatch/);
  geometry.attributes.uv.array[0] = original;
}));

test('four shader permutations preserve source constants and consume only their required texture inputs', async () => withLoaders(async recovered => {
  const keys = new Set();
  for (const family of ['clampAll', 'clampVertical', 'emissiveTwoUV', 'lodSimple']) {
    const recipe = doc.materials.find(row => row.family === family), {asset, gltf} = await model(recipe);
    recovered.apply(gltf, asset);
    let material; gltf.scene.traverse(mesh => {if (mesh.isMesh) for (const candidate of [].concat(mesh.material)) if (candidate.userData.recoveredPropsPresetShader) material = candidate;});
    const shader = shaderFor(material); keys.add(material.customProgramCacheKey());
    assert.deepEqual(shader.uniforms.bf2_props_cb.value.slice(0, recipe.constants.length).map(value => value.toArray()), recipe.constants);
    assert.equal(!!shader.uniforms.bf2_props_detailArray, family !== 'lodSimple');
    assert.equal(shader.uniforms.bf2_props_normalPacked.value.wrapT, THREE.RepeatWrapping);
    assert.ok(shader.fragmentShader.includes(`BF2_PROPS_FAMILY ${['clampAll', 'clampVertical', 'emissiveTwoUV', 'lodSimple'].indexOf(family)}`));
    assert.ok(shader.fragmentShader.includes('roughnessFactor = 1.0 - clamp(bf2_props_surface.smoothness'));
    assert.ok(shader.fragmentShader.includes('metalnessFactor = bf2_props_surface.metalness'));
    assert.ok(shader.fragmentShader.includes('totalEmissiveRadiance = vec3(0.0)'));
    assert.equal(shader.vertexShader.includes('vec4(uv, bf2PropsUv1)'), family === 'emissiveTwoUV');
  }
  assert.equal(keys.size, 4);
  assert.equal(PROPSPRESET_GLSL, read('tools/materials/propspreset-equations.glsl').toString());
}));

test('PropsPreset probe composition applies emission once before native DFG or fallback Lambert', async () => withLoaders(async recovered => {
  const recipe = doc.materials.find(row => row.family === 'emissiveTwoUV'), dfgDoc = json('web/public/assets/source-dfg.json');
  const dfg = {texture: createSourceDfgTexture(dfgDoc, buffer(read(`web/public${dfgDoc.url}`))), snapshot: () => ({evidenceId: dfgDoc.evidenceId})};
  for (const native of [false, true]) {
    const {asset, gltf} = await model(recipe); recovered.apply(gltf, asset);
    const probes = createSourceProbeLighting(json('web/public/assets/source-probes.json'), buffer(read('web/public/assets/source-probes.bin')), {dfg: native ? dfg : null});
    gltf.scene.position.set(-919.68, 587.52, -319.9382); gltf.scene.updateMatrixWorld(true); probes.add(gltf.scene);
    let material; gltf.scene.traverse(mesh => {if (mesh.isMesh && mesh.material.userData.recoveredPropsPresetShader) material = mesh.material;});
    const shader = shaderFor(material);
    assert.equal((shader.fragmentShader.match(/\+bf2_props_surface\.emissive/g) ?? []).length, 1);
    if (native) assert.match(shader.fragmentShader, /reflectedLight\.indirectDiffuse\+=\(bf2_probeDiffuse\([^;]+\)\+bf2_props_surface\.emissive\)\*diffuseColor\.rgb\*\(1.0-metalnessFactor\)\*bf2_nativeDFG\.b/);
    else assert.match(shader.fragmentShader, /irradiance \+= PI \* \(bf2_probeDiffuse\([^;]+\)\+bf2_props_surface\.emissive\)/);
    assert.ok(shader.fragmentShader.includes('totalEmissiveRadiance = vec3(0.0)'));
    probes.dispose();
  }
  dfg.texture.dispose();
}));

test('source parity rejects color variation, clamped-normal and collapsed-UV shortcuts', () => {
  const proof = json('exports/materials/propspreset-routing/equation-validation.json');
  assert.equal(proof.cases, 4000); assert.ok(proof.maximumAbsoluteError < 1e-10);
  assert.equal(proof.normalClampMutationsDetected, 895); assert.equal(proof.twoUvCollapsedMutationsDetected, 1000);
  const atlas = json('exports/materials/propspreset-routing/integration-recipe.json');
  assert.equal(atlas.variants.length, 3); assert.equal(atlas.eligibleSections.length, 22); assert.equal(atlas.excludedSections.length, 5);
  assert.equal(atlas.materialAO.value, 1); assert.equal(atlas.materialAO.doNotMultiplyInsideAtlasHelper, true);
});
