import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MASTER1UV_EMISSIVE_GLSL,prepareRecoveredMaster1UvEmissiveMaterials} from '../src/master1uv-emissive-material.js';
import {createSourceProbeLighting} from '../src/source-probes.js';
const root=new URL('../../',import.meta.url),read=path=>fs.readFileSync(new URL(path,root)),json=path=>JSON.parse(read(path));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex'),buffer=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
const doc=json('web/public/assets/recovered-master1uv-emissive-materials.json'),evidence=json('exports/materials/master1uv-emissive-shader/material-analysis.json');
async function withTextures(callback){const original=THREE.TextureLoader.prototype.loadAsync,textures=[];THREE.TextureLoader.prototype.loadAsync=async function(url){const t=new THREE.Texture();t.name=url;textures.push(t);return t;};try{return await callback(textures);}finally{THREE.TextureLoader.prototype.loadAsync=original;for(const t of textures)t.dispose();}}

test('Emissive Master exact native shader chain and all15 source section selections',()=>{
 assert.equal(doc.shaderNameHash,292172631);assert.equal(sha(read('exports/materials/rvm/0.res')),doc.sourceRvmSha256);
 for(const [key,hash]of [['pixelShader','pixelShaderSha256'],['pairedVertexShader','pairedVertexShaderSha256']])assert.equal(sha(read(`exports/materials/master1uv-emissive-shader/${doc[key]}.dxbc`)),doc[hash]);
 const graph=json('exports/materials/master1uv-emissive-shader/graph.json');for(let n=1;n<evidence.selectionChain.length;n++)assert.ok(graph.edges.some(e=>e.from===evidence.selectionChain[n-1].block&&e.to===evidence.selectionChain[n].block));
 assert.deepEqual(doc.textureMapping.map(x=>x.parameterHash),[3886168014,1840368952,4264966676,2517056835,3273948515,2351883907,594790500,3052299456,613096030,1793132757]);
 assert.equal(evidence.pixelConstantTableOutputSlot,62);assert.equal(evidence.vertexConstantTableOutputSlot,63);assert.equal(doc.materials.length,15);assert.equal(doc.placedSectionCount,126);
 const scene=json('web/public/assets/map.scene.json');let overrides=0,defaults=0;
 for(const row of doc.materials){
  assert.equal(row.variationHash,0);assert.deepEqual(row.conditionalParameters,[]);assert.equal(row.placementCount,scene.instances.filter(i=>i.assetId===row.assetId).length);
  const ebx=json(row.sourceMaterialEbx),source=ebx.asset.objects.find(o=>o.$id===row.materialClassGuid);
  assert.deepEqual(source.Shader.ConditionalParameters,[]);
  row.constantEvidence.forEach((e,i)=>{if(e.kind==='exact-section-override'){const bytes=Buffer.from(e.rawHex,'hex');assert.deepEqual(row.constants[i],[0,4,8,12].map(at=>bytes.readFloatLE(at)));overrides++;}else{assert.deepEqual(row.constants[i],doc.constantMapping[i].default);defaults++;}});
 }
 assert.equal(overrides,12);assert.equal(defaults,168);assert.equal(doc.visibleCoverage.visibleLod0Triangles,301944);
 assert.deepEqual([...new Set(doc.materials.map(m=>m.constants[0][0]))].sort((a,b)=>a-b),[100,3000,15000]);
});

test('Emissive Master reuses14 original textures and publishes only2 unchanged native mip decodes',()=>{
 const master=json('web/public/assets/recovered-master1uv-materials.json');let reused=0,added=0,bytes=0;assert.equal(Object.keys(doc.sourceTextures).length,16);
 for(const [id,t]of Object.entries(doc.sourceTextures)){
  const original=read(t.sourceDdsPath),selected=read(t.selectedDdsPath),png=read(`web/public${t.url}`);
  assert.equal(sha(original),t.sourceDdsSha256);assert.equal(sha(selected),t.selectedDdsSha256);assert.equal(sha(png),t.sha256);assert.deepEqual(selected.subarray(148),original.subarray(t.sourceDataOffset));
  assert.equal(png.readUInt32BE(16),t.width);assert.equal(png.readUInt32BE(20),t.height);assert.ok(Math.max(t.width,t.height)<=1024);
  if(master.sourceTextures[id]){assert.deepEqual(t,master.sourceTextures[id]);reused++;}else{added++;bytes+=png.length;}
 }
 assert.equal(reused,14);assert.equal(added,2);assert.equal(bytes,697872);
});

test('Emissive Master equations preserve native threshold bytes, ordinary material model and no AO',()=>{
 assert.equal(MASTER1UV_EMISSIVE_GLSL,read('tools/materials/master1uv-emissive-equations.glsl').toString());assert.equal(sha(Buffer.from(MASTER1UV_EMISSIVE_GLSL)),doc.sourceEquationSha256);
 const result=json('exports/materials/master1uv-emissive-shader/equation-validation.json');assert.equal(result.cases,4500);assert.equal(result.channelEdgeCases,21);assert.ok(result.maxAbsoluteError<1e-10);assert.ok(result.zeroEmissionCases>300&&result.highEmissionCases>300);
 const dxbc=read(`exports/materials/master1uv-emissive-shader/${doc.pixelShader}.dxbc`),assembly=read(`exports/materials/master1uv-emissive-shader/${doc.pixelShader}.asm`).toString();
 for(const literal of doc.sourceEmissionLiterals)for(const at of literal.dxbcOffsets){assert.equal(dxbc.readFloatLE(at),literal.float32);assert.equal(dxbc.subarray(at,at+4).toString('hex'),literal.rawHex);assert.ok(MASTER1UV_EMISSIVE_GLSL.includes(String(Math.abs(literal.float32))));}
 for(const op of [...doc.nativeMaterialModel.producerOperations,...doc.nativeLightingInputs.normalInstructions,...doc.nativeLightingInputs.emissionInstructions])assert.ok(assembly.includes(op));
 assert.equal(doc.nativeMaterialModel.materialId,0);assert.equal(doc.nativeMaterialModel.reflectance,.5);assert.equal(doc.nativeLightingInputs.ao,1);assert.equal(doc.nativeLightingInputs.shNormal,'normalized-source-world-normal');
 assert.equal(doc.nativeLightingInputs.separateThreeEmission,false);assert.equal(doc.nativeLightingInputs.emissiveExpression,'bf2_master1uv_emissive_surface.emissive');
 assert.equal(sha(read(doc.nativeLightingInputs.sourceAtlasRecipe)),doc.nativeLightingInputs.sourceAtlasRecipeSha256);
 const parity=json('exports/materials/master1uv-emissive-static-atlas/parity-evidence.json');assert.equal(parity.runtimeObserved,false);assert.ok(parity.materialExpressionsEqual.exposedPrelightingPlusEmission.length===3);
 for(const c of doc.nativeMaterialModel.consumers)assert.equal(sha(read(`exports/lighting/dfg-gbuffer/${c.file}.dxbc`)),c.sha256);
 assert.match(MASTER1UV_EMISSIVE_GLSL,/result.color = mix\(color, cb\[2\].rgb, emissionMask\)/);assert.match(MASTER1UV_EMISSIVE_GLSL,/result.emissive = emissionMask \* cb\[1\].rgb \* cb\[0\].x/);assert.ok(!MASTER1UV_EMISSIVE_GLSL.includes('base.a'));
});

test('real GLTFLoader routes all15 emissive sections and preserves geometry and unrelated materials',async()=>withTextures(async textures=>{
 const recovered=await prepareRecoveredMaster1UvEmissiveMaterials(doc),loader=new GLTFLoader();loader.register(()=>({name:'EmissiveMasterImageStub',loadTexture(){return Promise.resolve(new THREE.Texture());}}));const scene=json('web/public/assets/map.scene.json');let matched=0,other=0;
 for(const id of new Set(doc.materials.map(r=>r.assetId))){
  const asset=scene.assets.find(a=>a.id===id),gltf=await loader.parseAsync(buffer(read(`web/public/assets/${asset.url}`)),'');const original=new Map();gltf.scene.traverse(mesh=>{if(mesh.isMesh)original.set(mesh,mesh.geometry);});
  recovered.apply(gltf,{id:'unrelated'});recovered.apply(gltf,asset);recovered.apply(gltf,asset);
  gltf.scene.traverse(mesh=>{if(!mesh.isMesh)return;assert.equal(mesh.geometry,original.get(mesh));for(const m of [].concat(mesh.material)){const recipe=doc.materials.find(r=>r.assetId===id&&r.materialId===m.userData.sourceMaterialId);assert.equal(!!m.userData.recoveredMaster1UvEmissiveShader,!!recipe);if(recipe){matched++;assert.equal(m.map,null);assert.equal(m.emissiveMap,null);assert.equal(m.userData.placeholder,false);}else other++;}});
 }
 assert.equal(matched,15);assert.equal(recovered.applied,15);assert.equal(textures.length,16);assert.ok(other>0);
}));

test('Emissive Master instanced source-probe hooks retain original constants and linear emission',async()=>withTextures(async()=>{
 const recovered=await prepareRecoveredMaster1UvEmissiveMaterials(doc),recipe=doc.materials[0],geometry=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial({emissive:0xff0000}),mesh=new THREE.InstancedMesh(geometry,material,2),scene=new THREE.Group();material.userData.sourceMaterialId=recipe.materialId;scene.add(mesh);mesh.setMatrixAt(0,new THREE.Matrix4().makeTranslation(-919.68,587.52,-319.9382));mesh.setMatrixAt(1,new THREE.Matrix4().makeTranslation(-918.68,587.52,-319.9382));recovered.apply({scene},{id:recipe.assetId});
 const raw=read('web/public/assets/source-probes.bin'),lighting=createSourceProbeLighting(json('web/public/assets/source-probes.json'),new Float32Array(raw.buffer,raw.byteOffset,raw.byteLength/4));lighting.add(mesh);const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};mesh.material.onBeforeCompile(shader,{});
 assert.deepEqual(shader.uniforms.bf2_master1uv_emissive_cb.value.map(v=>v.toArray()),recipe.constants);for(const role of doc.textureMapping.map(t=>t.role))assert.equal(shader.uniforms[`bf2_master1uv_emissive_${role}`].value.name,recipe.textures[role]);
 assert.match(shader.vertexShader,/instanceMatrix \* bf2_master1uv_emissive_wp/);assert.match(shader.vertexShader,/modelMatrix \* bf2_master1uv_emissive_wp/);assert.match(shader.fragmentShader,/totalEmissiveRadiance = vec3\(0.0\)/);assert.ok(!shader.fragmentShader.includes('totalEmissiveRadiance = bf2_master1uv_emissive_surface.emissive'));assert.ok(!shader.fragmentShader.includes('bf2_master1uv_emissive_surface.ao'));assert.ok(!shader.fragmentShader.includes('normalize(bf2_master1uv_emissive_geometricNormal)'));assert.equal(material.emissive.getHex(),0);assert.deepEqual([...mesh.geometry.attributes.bf2_probeOffset.array],[0,9]);assert.ok(mesh.material.customProgramCacheKey().includes('SS_DSI_Master_1UV_Emissive-5ffbbd02c2'));
 assert.equal((shader.fragmentShader.match(/\+bf2_master1uv_emissive_surface\.emissive/g)??[]).length,1);
 assert.match(shader.fragmentShader,/irradiance \+= PI \* \(bf2_probeDiffuse\([^;]+\)\+bf2_master1uv_emissive_surface\.emissive\)/);
 lighting.dispose();
}));
