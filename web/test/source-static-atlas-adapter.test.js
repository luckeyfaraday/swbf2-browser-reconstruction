import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {prepareSourceStaticAtlas} from '../src/source-static-atlas-adapter.js';
import {createStaticBatches} from '../src/static-batches.js';
import {createSourceProbeLighting} from '../src/source-probes.js';
import {createSourceDfgTexture} from '../src/source-dfg.js';
import {prepareRecoveredMasterMaterials} from '../src/master1uv-material.js';
import {prepareRecoveredMaster2UvMaterials} from '../src/master2uv-material.js';
import {prepareRecoveredMetalOnlyMaterials} from '../src/metalonly-material.js';
import {prepareRecoveredCatwalk1Materials} from '../src/catwalk1-material.js';
import {prepareRecoveredCatwalk2Materials} from '../src/catwalk2-material.js';
import {prepareRecoveredArray2UvMaterials} from '../src/array2uv-material.js';
import {prepareRecoveredArray1UvMaterials} from '../src/array1uv-material.js';
import {prepareRecoveredCeilingMaterials} from '../src/ceiling-material.js';
import {prepareRecoveredMaster1UvEmissiveNonmetalMaterials} from '../src/master1uv-emissive-nonmetal-material.js';
import {prepareRecoveredMaster1UvEmissiveMaterials} from '../src/master1uv-emissive-material.js';
import {prepareRecoveredExteriorNoScaleMaterials} from '../src/exterior-noscale-material.js';
import {prepareRecoveredCorvetteDamageMaterials} from '../src/corvette-damage-material.js';
import {prepareRecoveredPropsPresetMaterials} from '../src/propspreset-material.js';
import {isSourceOrdinaryMaterial} from '../src/source-direct-adapter.js';
const root = new URL('../../', import.meta.url), read = name => fs.readFileSync(new URL(name, root));
const json = name => JSON.parse(read(name)), sha = bytes => createHash('sha256').update(bytes).digest('hex');
const buffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const document = json('web/public/assets/lighting/static-atlas-native.json');
const scene = json('web/public/assets/map.scene.json');
const adapter = await prepareSourceStaticAtlas(document, {lightMapPreExposure: 1,
  fetch: async url => ({ok: true, arrayBuffer: async () => buffer(read('web/public' + url))})});
const loader = new GLTFLoader(); loader.register(() => ({name: 'StaticAtlasTestTextures', loadTexture: async () => new THREE.Texture()}));
const models = new Map();
for (const row of document.uv.records) {
  if (!models.has(row.glbPath)) models.set(row.glbPath, await loader.parseAsync(buffer(read(row.glbPath)), ''));
}

test('native atlas payload preserves all five compressed source chunks, source dimensions and sampler addressing', () => {
  assert.equal(sha(read('web/public/assets/map.scene.json')), document.sourceSceneSha256);
  const irradiance = read('web/public' + document.irradiance.url), directions = read('web/public' + document.directions.url);
  assert.equal(sha(irradiance), document.sourceTextures[0].sourceChunkSha256);
  const length = 5232 * 4908;
  for (let i = 0; i < 4; i++) assert.equal(sha(directions.subarray(i * length, (i + 1) * length)), document.sourceTextures[i + 1].sourceChunkSha256);
  assert.deepEqual(document.sampler.packedBytes16to19, [21, 3, 3, 1]);
  assert.equal(adapter.uniforms.bf2_staticIrradiance.value.format, THREE.RGB_BPTC_UNSIGNED_Format);
  assert.equal(adapter.uniforms.bf2_staticDirections.value.format, THREE.RGBA_BPTC_Format);
  for (const texture of [adapter.uniforms.bf2_staticIrradiance.value, adapter.uniforms.bf2_staticDirections.value]) {
    assert.equal(texture.image.width, 5232); assert.equal(texture.image.height, 4908);
    assert.equal(texture.wrapS, THREE.ClampToEdgeWrapping); assert.equal(texture.wrapT, THREE.ClampToEdgeWrapping);
    assert.equal(texture.minFilter, THREE.LinearFilter); assert.equal(texture.magFilter, THREE.LinearFilter);
    assert.equal(texture.generateMipmaps, false); assert.equal(texture.colorSpace, THREE.NoColorSpace);
  }
});

test('published static families retain original shader evidence and exclude moving source door placements', () => {
  const master = document.familyEvidence.master1uv;
  assert.equal(sha(read('exports/materials/master1uv-static-atlas/integration-recipe.json')), master.sha256);
  assert.equal(master.recipe.pixelShaderSha256, '1208fb56068293cdf09b3a42342f31a5b4372d51da1c3fd2202b4b9d02792f3f');
  assert.equal(master.recipe.materialAO.applications, 1);
  assert.equal(master.recipe.materialAO.doNotMultiplyInsideAtlasHelper, true);
  const moving = new Set(json('web/public/assets/source-doors.json').doors.flatMap(door => door.leaves.map(leaf => leaf.sceneMatch.index)));
  const matches = new Map(json('exports/lighting/static-atlas-instance-matches.json').matched.map(row => [row.instanceIndex, row]));
  for (const row of document.instances) {
    assert.equal(moving.has(row.instanceIndex), false);
    const source = matches.get(row.instanceIndex);
    assert.equal(row.assetId, source.assetId); assert.equal(row.key, source.key);
    assert.deepEqual(row.values, source.values);
  }
  const master2 = document.familyEvidence.master2uv;
  assert.equal(sha(read('exports/materials/master2uv-static-atlas/integration-recipe.json')), master2.sha256);
  assert.equal(master2.recipe.pixelShaderSha256, '07c68d05030e56614d9219f3aaeb304a34db4dccb778dfcfa3d2f4911021887a');
  const metal = document.familyEvidence.metalonly;
  assert.equal(sha(read('exports/materials/metalonly-static-atlas/integration-recipe.json')), metal.sha256);
  assert.equal(metal.recipe.pixelShaderSha256, 'cafebb1efa7d5b55f1a6069152d219961ba6a8fb780c590d52d7e350c54b9356');
  const catwalk = document.familyEvidence.catwalk2;
  assert.equal(sha(read('exports/materials/catwalk2-static-atlas/integration-recipe.json')), catwalk.sha256);
  assert.equal(catwalk.recipe.pixelShaderSha256, 'c7c725880ea94ee6bf14c7d462c49129364bacd32c227d90f11c3d42a7a7876d');
  assert.equal(catwalk.recipe.materialAO.applications, 0);
  const array2 = document.familyEvidence.array2uv;
  assert.equal(sha(read('exports/materials/array2uv-static-atlas/integration-recipe.json')), array2.sha256);
  assert.equal(array2.recipe.pixelShaderSha256, 'f98220d078930fb93d0064fd60110dba4d32d7c5f9707d5ff01c36f1dd4bc399');
  assert.equal(array2.recipe.materialAO.applications, 0);
  const array1 = document.familyEvidence.array1uv;
  assert.equal(sha(read('exports/materials/array1uv-static-atlas/integration-recipe.json')), array1.sha256);
  assert.equal(array1.recipe.pixelShaderSha256, '12f1e3331cd66b9a2d05880b614c739b6debfdf430e42c1db089415cc739cefb');
  assert.equal(array1.recipe.materialAO.applications, 0);
  const ceiling = document.familyEvidence.ceiling;
  assert.equal(sha(read('exports/materials/ceiling-static-atlas/integration-recipe.json')), ceiling.sha256);
  assert.equal(ceiling.recipe.pixelShaderSha256, 'a6a6076dde1a666b0a8c758431285bf26677d339fda0f66b0d540aeeb64586e1');
  assert.equal(ceiling.recipe.materialAO.applications, 0);
  assert.equal(ceiling.recipe.emissive.separateThreeEmission, false);
  assert.equal(ceiling.recipe.commonAtlasKernel.domainRestriction.outputDomain, '[0,2]');
  const nonmetal = document.familyEvidence['master1uv-emissive-nonmetal'];
  assert.equal(sha(read('exports/materials/master1uv-emissive-nonmetal-static-atlas/integration-recipe.json')), nonmetal.sha256);
  assert.equal(nonmetal.recipe.pixelShaderSha256, 'de292f97cf4c51cade12a64570bde77add496c39243bf5aac4c0c6fc971a91ce');
  assert.equal(nonmetal.recipe.materialAO.applications, 0);
  assert.equal(nonmetal.recipe.emissive.separateThreeEmission, false);
  const emissive = document.familyEvidence['master1uv-emissive'];
  assert.equal(sha(read('exports/materials/master1uv-emissive-static-atlas/integration-recipe.json')), emissive.sha256);
  assert.equal(emissive.recipe.pixelShaderSha256, 'd2ae0b60ec6522838af780e21400898df3d8b52b80d637dbdb931030da9a9639');
  assert.equal(emissive.recipe.materialAO.applications, 0);
  assert.equal(emissive.recipe.emissive.separateThreeEmission, false);
  const exterior = document.familyEvidence['exterior-noscale'];
  assert.equal(sha(read('exports/materials/exterior-noscale-static-atlas/integration-recipe.json')), exterior.sha256);
  assert.equal(exterior.recipe.pixelShaderSha256, '5c21e56591999e8aa836f2c81d604b887e5ac9973e4bb20025d0187ac7cd003a');
  assert.equal(exterior.recipe.materialAO.applications, 1);
  assert.equal(exterior.recipe.normal.normalized, true);
  assert.equal(exterior.recipe.normal.fallbackSHNormalized, false);
  const corvette = document.familyEvidence['corvette-damage'];
  assert.equal(sha(read('exports/materials/corvette-damage-static-atlas/integration-recipe.json')), corvette.sha256);
  assert.equal(corvette.recipe.pixelShaderSha256, '3601962b8f738b1888a345755506aeac27fb35857534a1e90166cc51e4554e77');
  assert.equal(corvette.recipe.materialAO.applications, 0);
  assert.equal(corvette.recipe.damage.saturate, false);
  assert.equal(corvette.recipe.arrayLayer.mustPreserveDynamicSelection, true);
  const props=document.familyEvidence.propspreset;
  assert.equal(sha(read('exports/materials/propspreset-routing/integration-recipe.json')),props.sha256);
  const eligible=new Map(props.recipe.eligibleSections.map(row=>[`${row.assetId}/${row.materialId}`,row.pixelShader]));
  const excluded=new Set(props.recipe.excludedSections.map(row=>`${row.assetId}/${row.materialId}`));
  const published=document.materials.filter(row=>row.family==='propspreset');
  assert.equal(published.length,22);
  for(const row of published){const key=`${row.assetId}/${row.materialId}`;assert.ok(eligible.has(key));assert.equal(excluded.has(key),false);}
  assert.equal(document.instances.length, 4779);
  assert.deepEqual(document.families.propspreset,{materials:22,sourceGeometries:22,placements:391,sectionPlacements:391});
  const catwalk1=document.familyEvidence.catwalk1;
  assert.equal(sha(read('exports/materials/catwalk1-shader/integration-recipe.json')),catwalk1.sha256);
  assert.equal(catwalk1.recipe.pixelShaderSha256,'a32635c2ba0b7935f30aa73c6702c4184b0ce7def37ba4aa0e1933aa0d3a65e8');
  const catwalkKeys=new Set(catwalk1.recipe.eligibleSections.map(row=>`${row.assetId}/${row.materialId}`));
  const excludedCatwalkKeys=new Set(catwalk1.recipe.excludedSections.map(row=>`${row.assetId}/${row.materialId}`));
  const catwalkRows=document.materials.filter(row=>row.family==='catwalk1');
  assert.equal(catwalkRows.length,22);
  for(const row of catwalkRows){const key=`${row.assetId}/${row.materialId}`;assert.ok(catwalkKeys.has(key));assert.equal(excludedCatwalkKeys.has(key),false);}
  assert.deepEqual(document.families.catwalk1,{materials:22,sourceGeometries:27,placements:309,sectionPlacements:309});
  assert.deepEqual(document.families['corvette-damage'], {materials: 2, sourceGeometries: 2, placements: 4, sectionPlacements: 4});
  assert.deepEqual(document.families['exterior-noscale'], {materials: 4, sourceGeometries: 6, placements: 87, sectionPlacements: 87});
  assert.deepEqual(document.families['master1uv-emissive'], {materials: 15, sourceGeometries: 18, placements: 126, sectionPlacements: 126});
  assert.deepEqual(document.families.master1uv, {materials: 103, sourceGeometries: 120, placements: 1452, sectionPlacements: 1534});
  assert.deepEqual(document.families.master2uv, {materials: 8, sourceGeometries: 14, placements: 514, sectionPlacements: 680});
  assert.deepEqual(document.families.metalonly, {materials: 17, sourceGeometries: 30, placements: 950, sectionPlacements: 950});
  assert.deepEqual(document.families.catwalk2, {materials: 29, sourceGeometries: 35, placements: 381, sectionPlacements: 381});
  assert.deepEqual(document.families.array2uv, {materials: 13, sourceGeometries: 21, placements: 394, sectionPlacements: 394});
  assert.deepEqual(document.families.array1uv, {materials: 7, sourceGeometries: 9, placements: 61, sectionPlacements: 83});
  assert.deepEqual(document.families.ceiling, {materials: 20, sourceGeometries: 21, placements: 249, sectionPlacements: 493});
  assert.deepEqual(document.families['master1uv-emissive-nonmetal'], {materials: 1, sourceGeometries: 2, placements: 202, sectionPlacements: 202});
});

test('all selected original radiosity streams attach to actual GLTF topology without changing positions or indices', () => {
  for (const row of document.uv.records) {
    const model = models.get(row.glbPath);
    let selected; model.scene.traverse(mesh => {if (model.parser.associations.get(mesh)?.primitives === row.primitiveIndex) selected = mesh;});
    const geometry = selected.geometry, positions = geometry.attributes.position, indices = geometry.index;
    adapter.applyGeometry(model, {id: row.assetId}, row.sourceLod);
    assert.equal(geometry.attributes.position, positions); assert.equal(geometry.index, indices);
    const attribute = geometry.attributes.bf2RadiosityUv;
    assert.equal(attribute.count, row.vertexCount); assert.equal(attribute.itemSize, 2);
    assert.equal(sha(new Uint8Array(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength)), row.sourceSha256);
  }
  assert.equal(adapter.snapshot().sourceGeometries, document.uv.records.length);
});

test('original instance indices survive batch grouping and LOD wrapping; matched charts replace SH and unmatched instances retain it', () => {
  const floorKeys = new Set(document.materials.filter(row => !row.family || row.family === 'floor').map(row => `${row.assetId}/${row.materialId}`));
  const row = document.uv.records.find(row => row.sourceLod === 0 && floorKeys.has(`${row.assetId}/${row.sourceMaterialId}`)), model = models.get(row.glbPath);
  let source; model.scene.traverse(mesh => {if (model.parser.associations.get(mesh)?.primitives === row.primitiveIndex) source = mesh;});
  source.material = new THREE.MeshStandardMaterial(); source.material.userData.recoveredFloorShader = {evidenceId: 'fixture-material-marker'};
  source.material.userData.sourceMaterialId = row.sourceMaterialId;
  const selected = document.instances.filter(instance => instance.assetId === row.assetId).slice(0, 2);
  const placements = selected.map(instance => scene.instances[instance.instanceIndex]);
  const unknown = {...placements[0], matrix: placements[0].matrix.slice()}; placements.push(unknown);
  const index = new WeakMap(placements.map((instance, i) => [instance, i < selected.length ? selected[i].instanceIndex : -1]));
  source.updateMatrixWorld(true);
  const batches = createStaticBatches(source, placements, {id: row.assetId, collision: true}, {cellSize: 128, instanceIndices: index});
  const group = new THREE.Group(); group.add(...batches);
  const probeDoc = json('web/public/assets/source-probes.json'), dfgDoc = json('web/public/assets/source-dfg.json');
  const dfg = {texture: createSourceDfgTexture(dfgDoc, buffer(read('web/public' + dfgDoc.url))), snapshot: () => ({evidenceId: dfgDoc.evidenceId})};
  const probes = createSourceProbeLighting(probeDoc, buffer(read('web/public/assets/source-probes.bin')), {dfg, staticAtlas: adapter});
  probes.add(group);
  let matched = 0, fallback = 0;
  for (const mesh of batches) {
    matched += mesh.userData.sourceStaticAtlas.matched; fallback += mesh.userData.sourceStaticAtlas.fallback;
    const transform = mesh.geometry.attributes.bf2StaticAtlasTransform;
    for (let i = 0; i < mesh.userData.sourceInstanceIndices.length; i++) {
      const original = document.instances.find(record => record.instanceIndex === mesh.userData.sourceInstanceIndices[i]);
      const actual = Array.from(transform.array.subarray(i * 4, i * 4 + 4));
      assert.deepEqual(actual, original ? [original.values[0], original.values[3], original.values[4], original.values[5]] : [0, 0, 0, 0]);
    }
    const wrapped = probes.adaptGeometry(mesh, source.geometry);
    assert.equal(wrapped.attributes.bf2RadiosityUv, source.geometry.attributes.bf2RadiosityUv);
    assert.deepEqual(wrapped.attributes.bf2StaticAtlasTransform.array, transform.array);
    const shader = {vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {}};
    mesh.material.onBeforeCompile(shader, {});
    assert.match(shader.fragmentShader, /reflectedLight.indirectDiffuse\+=bf2_staticAtlasOrProbe/);
    assert.match(shader.fragmentShader, /if\(bf2_staticAtlasUv.z<=0.0\)return bf2_probeDiffuse/);
    assert.match(shader.fragmentShader, /bf2_normal,inverseTransformDirection\(geometryViewDir,viewMatrix\),1.0-roughnessFactor/);
    assert.equal(shader.uniforms.bf2_staticPreExposure.value, 1);
    assert.ok(mesh.material.customProgramCacheKey().includes('nativeStaticAtlas:true'));
  }
  assert.equal(matched, selected.length); assert.equal(fallback, 1);
  probes.dispose(); dfg.texture.dispose();
});

const familyCases=[
  ['master1uv',prepareRecoveredMasterMaterials,'recoveredMaster1UVShader','bf2_master_surface',true,false],
  ['master2uv',prepareRecoveredMaster2UvMaterials,'recoveredMaster2UvShader','bf2_master2uv_surface',true,false],
  ['metalonly',prepareRecoveredMetalOnlyMaterials,'recoveredMetalOnlyShader','bf2_metalonly_surface',true,false],
  ['catwalk1',prepareRecoveredCatwalk1Materials,'recoveredCatwalk1Shader','bf2_catwalk1_surface',false,false],
  ['catwalk2',prepareRecoveredCatwalk2Materials,'recoveredCatwalk2Shader','bf2_catwalk2_surface',false,false],
  ['array2uv',prepareRecoveredArray2UvMaterials,'recoveredArray2UvShader','bf2_array2uv_surface',false,false],
  ['array1uv',prepareRecoveredArray1UvMaterials,'recoveredArray1UvShader','bf2_array1uv_surface',false,false],
  ['ceiling',prepareRecoveredCeilingMaterials,'recoveredCeilingShader','bf2_ceiling_surface',false,true],
  ['master1uv-emissive-nonmetal',prepareRecoveredMaster1UvEmissiveNonmetalMaterials,'recoveredMaster1UvEmissiveNonmetalShader','bf2_master1uv_emissive_nonmetal_surface',false,true],
  ['master1uv-emissive',prepareRecoveredMaster1UvEmissiveMaterials,'recoveredMaster1UvEmissiveShader','bf2_master1uv_emissive_surface',false,true],
  ['exterior-noscale',prepareRecoveredExteriorNoScaleMaterials,'recoveredExteriorNoScaleShader','bf2_exterior_surface',true,false],
  ['corvette-damage',prepareRecoveredCorvetteDamageMaterials,'recoveredCorvetteDamageShader','bf2_corvette_damage_surface',false,false],
  ['propspreset',prepareRecoveredPropsPresetMaterials,'recoveredPropsPresetShader','bf2_props_surface',false,true],
];
for (const [family,prepare,marker,surface,hasAo,hasEmission] of familyCases) test(`static ${family} and moving doors sharing a source material get distinct shaders with native composition`, async () => {
  const materials = document.materials.filter(row => row.family === family);
  assert.ok(materials.length > 0, 'Native atlas family evidence must be published');
  const keys = new Set(materials.map(row => `${row.assetId}/${row.materialId}`));
  const row = document.uv.records.find(row => row.sourceLod === 0 && keys.has(`${row.assetId}/${row.sourceMaterialId}`));
  const model = models.get(row.glbPath);
  let source; model.scene.traverse(mesh => {if (model.parser.associations.get(mesh)?.primitives === row.primitiveIndex) source = mesh;});
  source.material = new THREE.MeshStandardMaterial(); source.material.userData.sourceMaterialId = row.sourceMaterialId;
  const originalLoad = THREE.TextureLoader.prototype.loadAsync, originalBinary = THREE.FileLoader.prototype.loadAsync;
  let recovered;
  try {
    THREE.TextureLoader.prototype.loadAsync = async () => new THREE.Texture();
    THREE.FileLoader.prototype.loadAsync = async url => buffer(read('web/public' + url));
    recovered = await prepare(json(`web/public/assets/recovered-${family}-materials.json`));
  } finally { THREE.TextureLoader.prototype.loadAsync = originalLoad; THREE.FileLoader.prototype.loadAsync = originalBinary; }
  recovered.apply(model, {id: row.assetId});
  assert.ok(source.material.userData[marker]);
  assert.equal(isSourceOrdinaryMaterial(source.material),true,'native GBuffer classification must select the native direct-light adapter');
  const instance = document.instances.find(instance => instance.assetId === row.assetId);
  const fixed = new THREE.Mesh(source.geometry, source.material), moving = new THREE.Mesh(source.geometry, source.material);
  for (const mesh of [fixed, moving]) {
    mesh.userData.assetId = row.assetId; mesh.userData.sourceMaterialId = row.sourceMaterialId;
    mesh.matrix.fromArray(scene.instances[instance.instanceIndex].matrix); mesh.matrixAutoUpdate = false;
  }
  fixed.userData.sourceInstanceIndices = [instance.instanceIndex]; moving.userData.sourceDoor = 'moving-door-regression';
  const group = new THREE.Group(); group.add(fixed, moving);
  const probeDoc = json('web/public/assets/source-probes.json'), dfgDoc = json('web/public/assets/source-dfg.json');
  const dfg = {texture: createSourceDfgTexture(dfgDoc, buffer(read('web/public' + dfgDoc.url))), snapshot: () => ({evidenceId: dfgDoc.evidenceId})};
  const probes = createSourceProbeLighting(probeDoc, buffer(read('web/public/assets/source-probes.bin')), {dfg, staticAtlas: adapter});
  probes.add(group);
  assert.notEqual(fixed.material, moving.material);
  assert.ok(fixed.geometry.attributes.bf2StaticAtlasTransform);
  assert.equal(moving.geometry.attributes.bf2StaticAtlasTransform, undefined);
  const shaderFor = mesh => {
    const shader = {vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {}};
    mesh.material.onBeforeCompile(shader, {}); return shader.fragmentShader;
  };
  const baked = shaderFor(fixed), dynamic = shaderFor(moving);
  assert.ok(baked.includes(`inverseTransformDirection(geometryNormal,viewMatrix),inverseTransformDirection(geometryViewDir,viewMatrix),${surface}.smoothness`));
  const ao = `reflectedLight.indirectDiffuse *= ${surface}.ao`;
  assert.equal(baked.split(ao).length - 1, hasAo ? 1 : 0);
  if (hasAo) assert.ok(baked.indexOf(ao) > baked.indexOf('reflectedLight.indirectDiffuse+=bf2_staticAtlasOrProbe'));
  if (family === 'master2uv') assert.ok(fixed.geometry.attributes.bf2Master2Uv1, 'original surfaceUV remains independent from original radiosityUV');
  if (family === 'array2uv') assert.ok(fixed.geometry.attributes.bf2ArrayUv1, 'original array material UV1 remains independent from original radiosityUV');
  if (family === 'exterior-noscale') {
    assert.ok(baked.includes('bf2_staticAtlasOrProbe(bf2_exterior_prelightingNormal,inverseTransformDirection(geometryNormal,viewMatrix)'));
    assert.ok(dynamic.includes('bf2_probeDiffuse(bf2_exterior_prelightingNormal)'));
  }
  assert.doesNotMatch(dynamic, /bf2_staticAtlasOrProbe|bf2_staticIrradiance/);
  assert.match(dynamic, /reflectedLight.indirectDiffuse\+=\(?bf2_probeDiffuse/);
  if(hasEmission) {
    for(const fragment of [baked,dynamic]) {
      assert.ok(fragment.includes(`+${surface}.emissive)*diffuseColor.rgb*(1.0-metalnessFactor)*bf2_nativeDFG.b`));
      assert.equal(fragment.split(`+${surface}.emissive)`).length-1,1,'source emission contributes once before the ordinary combine');
      assert.equal(fragment.includes(`totalEmissiveRadiance = ${surface}.emissive`),false);
    }
  }
  assert.notEqual(fixed.material.customProgramCacheKey(), moving.material.customProgramCacheKey());
  probes.dispose(); dfg.texture.dispose();
});
