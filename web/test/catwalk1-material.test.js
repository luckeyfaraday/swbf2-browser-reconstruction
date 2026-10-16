import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {CATWALK1_GLSL,prepareRecoveredCatwalk1Materials} from '../src/catwalk1-material.js';
import {createSourceProbeLighting} from '../src/source-probes.js';
import {createSourceDfgTexture} from '../src/source-dfg.js';
import {isSourceOrdinaryMaterial} from '../src/source-direct-adapter.js';

const root=new URL('../../',import.meta.url),read=path=>fs.readFileSync(new URL(path,root)),json=path=>JSON.parse(read(path));
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const buffer=bytes=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
const doc=json('web/public/assets/recovered-catwalk1-materials.json'),evidence=json(doc.routingEvidence),scene=json('web/public/assets/map.scene.json');
const shaderFor=material=>{const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};material.onBeforeCompile(shader,{});return shader;};

async function withMaterials(run){
  const prior=THREE.TextureLoader.prototype.loadAsync,loaded=[];
  THREE.TextureLoader.prototype.loadAsync=async function(url){const texture=new THREE.Texture();texture.name=url;loaded.push(texture);return texture;};
  let prepared;
  try{prepared=await prepareRecoveredCatwalk1Materials(doc);return await run(prepared,loaded);}finally{prepared?.dispose();THREE.TextureLoader.prototype.loadAsync=prior;}
}
async function model(recipe){
  const asset=scene.assets.find(row=>row.id===recipe.assetId),loader=new GLTFLoader();
  loader.register(()=>({name:'CpuOriginalImageStub',loadTexture(){return Promise.resolve(new THREE.Texture());}}));
  const gltf=await loader.parseAsync(buffer(read(`web/public/assets/${asset.url}`)),'');
  return {asset,gltf};
}

test('Catwalk1 retains exact source predicates, texture slots, constants and active LOD material identity',()=>{
  assert.equal(sha(read(doc.routingEvidence)),doc.routingSha256);
  assert.equal(sha(read('exports/materials/rvm/0.res')),doc.sourceRvmSha256);
  assert.equal(doc.materials.length,23);assert.equal(doc.placedSectionCount,312);
  assert.equal(evidence.tree.words,179);assert.equal(evidence.tree.permutations,14);
  for(const [pixel,source]of Object.entries(evidence.pixelShaders)){
    assert.equal(sha(read(`exports/materials/catwalk1-shader/${pixel}.dxbc`)),source.sha256);
    for(const instance of source.instances){
      assert.deepEqual(instance.textureMapping.filter(row=>row.parameterHash).map(row=>row.parameterHash),[5861109,5861212,5861208,2990320127]);
      assert.equal(instance.samplerMapping.at(-1).payloadBlock,'83d4c1d84a');
    }
  }
  for(const recipe of doc.materials){
    const bytes=Buffer.from(recipe.constant.rawHex,'hex');
    assert.deepEqual(recipe.constants[0],[0,4,8,12].map(offset=>bytes.readFloatLE(offset)));
    assert.deepEqual(recipe.constants[0].slice(0,3),[2,2,0]);assert.equal(recipe.variationHash,0);
  }
  assert.equal(doc.activeAlternativeLods.length,5);
  for(const lod of doc.activeAlternativeLods){assert.equal(lod.materialParameterBlocksEqual,true);assert.equal(lod.ordinaryPixelShader,doc.pixelShader);assert.equal(lod.atlasPixelShader,'3b42a4bca7');}
  const recipe=json('exports/materials/catwalk1-shader/integration-recipe.json');
  assert.equal(recipe.eligibleSections.length,22);assert.equal(recipe.excludedSections.length,1);
  assert.equal(recipe.materialAO.value,1);assert.equal(recipe.materialAO.applications,0);
});

test('Catwalk1 packed source DDS and browser payloads preserve exact mips, transfer functions and sampler split',()=>{
  assert.equal(Object.keys(doc.sourceTextures).length,4);
  let reused=0,clamp=0;
  for(const source of Object.values(doc.sourceTextures)){
    const original=read(source.sourceDdsPath),selected=read(source.selectedDdsPath),png=read(`web/public${source.url}`);
    assert.equal(sha(original),source.sourceDdsSha256);assert.equal(sha(selected),source.selectedDdsSha256);assert.equal(sha(png),source.sha256);
    assert.deepEqual(selected.subarray(148),original.subarray(source.sourceDataOffset));
    assert.deepEqual([png.readUInt32BE(16),png.readUInt32BE(20)],[source.width,source.height]);
    assert.equal(source.colorSpace,[29,78,99].includes(source.dxgiFormat)?'srgb':'linear');
    reused+=!!source.reusedSourceDocument;clamp+=source.sampler==='83d4c1d84a';
  }
  assert.equal(reused,2);assert.equal(clamp,1);
});

test('all23 real Catwalk1 GLTF sections route without changing geometry or unrelated materials',async()=>withMaterials(async recovered=>{
  let count=0;
  for(const id of new Set(doc.materials.map(row=>row.assetId))){
    const {asset,gltf}=await model(doc.materials.find(row=>row.assetId===id));
    const original=new Map();gltf.scene.traverse(mesh=>{if(mesh.isMesh)original.set(mesh,[mesh.geometry,mesh.geometry.attributes.position,mesh.geometry.attributes.uv,mesh.geometry.index]);});
    recovered.apply(gltf,{id:'not-selected'});recovered.apply(gltf,asset);recovered.apply(gltf,asset);
    gltf.scene.traverse(mesh=>{
      if(!mesh.isMesh)return;
      assert.deepEqual([mesh.geometry,mesh.geometry.attributes.position,mesh.geometry.attributes.uv,mesh.geometry.index],original.get(mesh));
      for(const material of [].concat(mesh.material)){
        const selected=doc.materials.find(row=>row.assetId===id&&row.materialId===material.userData.sourceMaterialId);
        assert.equal(!!material.userData.recoveredCatwalk1Shader,!!selected);
        if(selected){count++;assert.equal(isSourceOrdinaryMaterial(material),true);assert.equal(material.metalness,0);assert.equal(material.map,null);}
      }
    });
  }
  assert.equal(count,23);assert.equal(recovered.applied,23);
}));

test('Catwalk1 shader binds the independent NW clamp sampler, exact world coordinates and original scale',async()=>withMaterials(async recovered=>{
  const recipe=doc.materials[0],{asset,gltf}=await model(recipe);recovered.apply(gltf,asset);
  let material;gltf.scene.traverse(mesh=>{if(mesh.isMesh&&mesh.material.userData.recoveredCatwalk1Shader)material=mesh.material;});
  const shader=shaderFor(material);
  assert.deepEqual(shader.uniforms.bf2_catwalk1_cb.value.map(value=>value.toArray()),recipe.constants);
  for(const role of ['base','normal','detail','grunge']){
    const texture=shader.uniforms[`bf2_catwalk1_${role}`].value;
    assert.equal(texture.name,recipe.textures[role]);assert.equal(texture.wrapS,role==='normal'?THREE.ClampToEdgeWrapping:THREE.RepeatWrapping);assert.equal(texture.wrapS,texture.wrapT);
  }
  assert.match(shader.vertexShader,/instanceMatrix \* bf2_catwalk1_wp/);assert.match(shader.vertexShader,/modelMatrix \* bf2_catwalk1_wp/);
  assert.match(shader.fragmentShader,/worldPosition.xz \* 0.1/);assert.match(shader.fragmentShader,/totalEmissiveRadiance = vec3\(0.0\)/);
  assert.equal(CATWALK1_GLSL,read('tools/materials/catwalk1-equations.glsl').toString());
}));

test('Catwalk1 ordinary probe composition uses native DFG and no extra AO or emission',async()=>withMaterials(async recovered=>{
  const dfgDoc=json('web/public/assets/source-dfg.json');
  const dfg={texture:createSourceDfgTexture(dfgDoc,buffer(read(`web/public${dfgDoc.url}`))),snapshot:()=>({evidenceId:dfgDoc.evidenceId})};
  for(const native of [false,true]){
    const {asset,gltf}=await model(doc.materials[0]);recovered.apply(gltf,asset);
    const probes=createSourceProbeLighting(json('web/public/assets/source-probes.json'),buffer(read('web/public/assets/source-probes.bin')),{dfg:native?dfg:null});
    gltf.scene.position.set(-919.68,587.52,-319.9382);gltf.scene.updateMatrixWorld(true);probes.add(gltf.scene);
    let material;gltf.scene.traverse(mesh=>{if(mesh.isMesh&&mesh.material.userData.recoveredCatwalk1Shader)material=mesh.material;});
    const shader=shaderFor(material);
    if(native){assert.match(shader.fragmentShader,/reflectedLight.indirectDiffuse\+=bf2_probeDiffuse\([^;]+\)\*diffuseColor.rgb\*\(1.0-metalnessFactor\)\*bf2_nativeDFG.b/);assert.equal(probes.snapshot().environmentDfgCompiled,1);}
    else assert.match(shader.fragmentShader,/irradiance \+= PI \* bf2_probeDiffuse/);
    assert.ok(!shader.fragmentShader.includes('bf2_catwalk1_surface.ao'));assert.ok(!shader.fragmentShader.includes('bf2_catwalk1_surface.emissive'));
    probes.dispose();
  }
  dfg.texture.dispose();
}));

test('Catwalk1 independent original-instruction replay rejects coordinate, clamp, packed-channel shortcuts',()=>{
  const proof=json('exports/materials/catwalk1-shader/equation-validation.json');
  assert.equal(proof.cases,3000);assert.ok(proof.maximumAbsoluteError<1e-10);
  for(const count of Object.values(proof.mutationDetections))assert.ok(count>1000);
  const parity=json('exports/materials/catwalk1-shader/parity-evidence.json');assert.equal(Object.keys(parity.materialExpressions).length,6);assert.equal(parity.commonAtlasKernelExpressions.length,3);
});
