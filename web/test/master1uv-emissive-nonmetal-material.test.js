import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MASTER1UV_EMISSIVE_NONMETAL_GLSL,prepareRecoveredMaster1UvEmissiveNonmetalMaterials} from '../src/master1uv-emissive-nonmetal-material.js';
import {createSourceProbeLighting} from '../src/source-probes.js';
import {isSourceOrdinaryMaterial} from '../src/source-direct-adapter.js';
const root=new URL('../../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root)),json=p=>JSON.parse(read(p));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const doc=json('web/public/assets/recovered-master1uv-emissive-nonmetal-materials.json');

test('nonmetal wall retains exact shader selection, constants, source textures and verified equations',()=>{
  const evidence=json('exports/materials/master1uv-emissive-nonmetal-shader/material-analysis.json');
  const graph=json('exports/materials/master1uv-emissive-nonmetal-shader/graph.json');
  assert.equal(doc.shaderNameHash,2996852712);
  assert.equal(sha(read('exports/materials/rvm/0.res')),doc.sourceRvmSha256);
  for(const [key,hash] of [['pixelShader','pixelShaderSha256'],['pairedVertexShader','pairedVertexShaderSha256']])assert.equal(sha(read(`exports/materials/master1uv-emissive-nonmetal-shader/${doc[key]}.dxbc`)),doc[hash]);
  for(let i=1;i<evidence.selectionChain.length;i++)assert.ok(graph.edges.some(e=>e.from===evidence.selectionChain[i-1].block&&e.to===evidence.selectionChain[i].block));
  assert.equal(evidence.pixelConstantTableOutputSlot,64);assert.equal(evidence.vertexConstantTableOutputSlot,63);
  assert.equal(doc.materials.length,1);assert.equal(doc.placedSectionCount,202);
  const row=doc.materials[0];assert.equal(row.constants.length,13);assert.equal(row.constants[0][0],15000);assert.equal(row.constants[3][0],1);
  const source=json(row.sourceMaterialEbx).asset.objects.find(o=>o.$id===row.materialClassGuid);assert.deepEqual(source.Shader.ConditionalParameters,[]);
  row.constantEvidence.forEach((e,i)=>assert.deepEqual(row.constants[i],e.kind==='exact-section-override'?[0,4,8,12].map(at=>Buffer.from(e.rawHex,'hex').readFloatLE(at)):doc.constantMapping[i].default));
  const retained=json('web/public/assets/recovered-master1uv-materials.json');assert.equal(Object.keys(doc.sourceTextures).length,10);
  for(const [id,t]of Object.entries(doc.sourceTextures)) {assert.deepEqual(t,retained.sourceTextures[id]);assert.equal(sha(read(`web/public${t.url}`)),t.sha256);assert.equal(sha(read(t.sourceDdsPath)),t.sourceDdsSha256);}
  assert.equal(MASTER1UV_EMISSIVE_NONMETAL_GLSL,read('tools/materials/master1uv-emissive-nonmetal-equations.glsl').toString());assert.equal(sha(Buffer.from(MASTER1UV_EMISSIVE_NONMETAL_GLSL)),doc.sourceEquationSha256);
  const assembly=read(`exports/materials/master1uv-emissive-nonmetal-shader/${doc.pixelShader}.asm`).toString();
  for(const op of [...doc.nativeMaterialModel.producerOperations,...doc.nativeLightingInputs.normalInstructions,...doc.nativeLightingInputs.emissionInstructions])assert.ok(assembly.includes(op));
  assert.equal(doc.nativeLightingInputs.metalness,0);assert.equal(doc.nativeLightingInputs.ao,1);
  assert.equal(doc.nativeLightingInputs.separateThreeEmission,false);
  assert.equal(sha(read(doc.nativeLightingInputs.sourceAtlasRecipe)),doc.nativeLightingInputs.sourceAtlasRecipeSha256);
  assert.equal(doc.nativeLightingInputs.emissiveExpression,'bf2_master1uv_emissive_nonmetal_surface.emissive');
  const result=json('exports/materials/master1uv-emissive-nonmetal-shader/equation-validation.json');assert.equal(result.cases,3000);assert.equal(result.channelEdgeCases,21);assert.ok(result.maxAbsoluteError<1e-10);
});

test('actual nonmetal wall binds its thirteen constants and native lighting without changing geometry',async()=>{
  const original=THREE.TextureLoader.prototype.loadAsync;
  THREE.TextureLoader.prototype.loadAsync=async url=>{const t=new THREE.Texture();t.name=url;return t;};
  const lightingTextures=[];
  try {
    const recovered=await prepareRecoveredMaster1UvEmissiveNonmetalMaterials(doc),row=doc.materials[0];
    const asset=json('web/public/assets/map.scene.json').assets.find(a=>a.id===row.assetId);
    const loader=new GLTFLoader();loader.register(()=>({name:'NonmetalImageStub',loadTexture(){return Promise.resolve(new THREE.Texture());}}));
    const bytes=read(`web/public/assets/${asset.url}`),gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
    const before=new Map();gltf.scene.traverse(m=>{if(m.isMesh)before.set(m,m.geometry);});
    recovered.apply(gltf,{id:'unrelated'});assert.equal(recovered.applied,0);
    recovered.apply(gltf,asset);recovered.apply(gltf,asset);assert.equal(recovered.applied,1);
    let bound;gltf.scene.traverse(m=>{if(m.isMesh){assert.equal(m.geometry,before.get(m));if(m.material.userData.recoveredMaster1UvEmissiveNonmetalShader)bound=m;}});
    assert.ok(bound);assert.equal(isSourceOrdinaryMaterial(bound.material),true);
    const data=read('web/public/assets/source-probes.bin'),dfg=new THREE.DataTexture(new Uint16Array(128*128*4),128,128,THREE.RGBAFormat,THREE.HalfFloatType);lightingTextures.push(dfg);
    const lighting=createSourceProbeLighting(json('web/public/assets/source-probes.json'),new Float32Array(data.buffer,data.byteOffset,data.byteLength/4),{dfg:{texture:dfg,snapshot:()=>({evidenceId:'BF2-NATIVE-FG-WARP-001'})}});
    lighting.add(gltf.scene);
    const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};bound.material.onBeforeCompile(shader,{});
    assert.deepEqual(shader.uniforms.bf2_master1uv_emissive_nonmetal_cb.value.map(v=>v.toArray()),row.constants);
    for(const role of doc.textureMapping.map(t=>t.role))assert.equal(shader.uniforms[`bf2_master1uv_emissive_nonmetal_${role}`].value.name,row.textures[role]);
    assert.ok(shader.fragmentShader.includes('cb[0].x * cb[3].x'));
    assert.ok(shader.fragmentShader.includes('result.materialScalar = 0.0'));
    assert.ok(shader.fragmentShader.includes('bf2_nativeDFG.b'));
    assert.ok(!shader.fragmentShader.includes('bf2_master1uv_emissive_nonmetal_surface.ao'));
    assert.ok(!shader.fragmentShader.includes('normalize(bf2_master1uv_emissive_nonmetal_geometricNormal)'));
    assert.ok(shader.fragmentShader.includes('totalEmissiveRadiance = vec3(0.0)'));
    assert.ok(!shader.fragmentShader.includes('totalEmissiveRadiance = bf2_master1uv_emissive_nonmetal_surface.emissive'));
    assert.equal((shader.fragmentShader.match(/\+bf2_master1uv_emissive_nonmetal_surface\.emissive/g)??[]).length,1);
    assert.match(shader.fragmentShader,/reflectedLight\.indirectDiffuse\+=\(bf2_probeDiffuse\([^;]+\)\+bf2_master1uv_emissive_nonmetal_surface\.emissive\)\*diffuseColor\.rgb\*\(1\.0-metalnessFactor\)\*bf2_nativeDFG\.b/);
    lighting.dispose();
  } finally {THREE.TextureLoader.prototype.loadAsync=original;for(const t of lightingTextures)t.dispose();}
});
