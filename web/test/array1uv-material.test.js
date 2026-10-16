import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {ARRAY1UV_GLSL,prepareRecoveredArray1UvMaterials} from '../src/array1uv-material.js';
import {createSourceProbeLighting} from '../src/source-probes.js';
const root=new URL('../../',import.meta.url),read=path=>fs.readFileSync(new URL(path,root)),json=path=>JSON.parse(read(path));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex'),buffer=bytes=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
const doc=json('web/public/assets/recovered-array1uv-materials.json'),evidence=json('exports/materials/array1uv-shader/material-analysis.json');
async function withLoaders(callback){
 const priorImage=THREE.TextureLoader.prototype.loadAsync,priorFile=THREE.FileLoader.prototype.loadAsync,textures=[];
 THREE.TextureLoader.prototype.loadAsync=async function(url){const t=new THREE.Texture();t.name=url;textures.push(t);return t;};
 THREE.FileLoader.prototype.loadAsync=async function(url){return buffer(read(`web/public${url}`));};
 try{return await callback(textures);}finally{THREE.TextureLoader.prototype.loadAsync=priorImage;THREE.FileLoader.prototype.loadAsync=priorFile;for(const t of textures)t.dispose();}
}
function loader(){const value=new GLTFLoader();value.register(()=>({name:'Array1UvNodeImageStub',loadTexture(){return Promise.resolve(new THREE.Texture());}}));return value;}

test('Array1UV exact native shader, three bindings and all13 default/override selections',()=>{
 assert.equal(doc.shaderNameHash,666991456);assert.equal(sha(read('exports/materials/rvm/0.res')),doc.sourceRvmSha256);
 for(const [key,hash]of [['pixelShader','pixelShaderSha256'],['pairedVertexShader','pairedVertexShaderSha256']])assert.equal(sha(read(`exports/materials/array1uv-shader/${doc[key]}.dxbc`)),doc[hash]);
 const graph=json('exports/materials/array1uv-shader/graph.json');for(let n=1;n<evidence.selectionChain.length;n++)assert.ok(graph.edges.some(e=>e.from===evidence.selectionChain[n-1].block&&e.to===evidence.selectionChain[n].block));
 assert.deepEqual(doc.textureMapping.map(x=>x.parameterHash),[3694953547,26739661,193470474]);assert.equal(evidence.pixelConstantTableOutputSlot,39);assert.equal(evidence.vertexConstantTableOutputSlot,38);assert.deepEqual(doc.constantMapping.map(r=>r.inputSlot),[13,1]);assert.equal(doc.materials.length,13);assert.equal(doc.placedSectionCount,314);
 let overrides=0,defaults=0;for(const row of doc.materials){assert.equal(row.bindings.detailArray.texture.rootInstanceGuid,'d72f699d-b7ad-f0da-de8e-7f2741b3ef4c');row.constantEvidence.forEach((e,i)=>{if(e.kind==='exact-section-override'){const bytes=Buffer.from(e.rawHex,'hex');assert.deepEqual(row.constants[i],[0,4,8,12].map(at=>bytes.readFloatLE(at)));overrides++;}else{assert.deepEqual(row.constants[i],doc.constantMapping[i].default);defaults++;}});}
 assert.equal(overrides,10);assert.equal(defaults,16);assert.equal(doc.visibleCoverage.visibleLod0Triangles,359885);
});

test('Array1UV preserves source mip payloads and reuses the exact recovered ten-layer array',()=>{
 assert.equal(Object.keys(doc.sourceTextures).length,27);const shared=json('web/public/assets/recovered-array2uv-materials.json').sourceTextures;let reused=0,newBytes=0;
 for(const [id,t]of Object.entries(doc.sourceTextures)){
  const original=read(t.sourceDdsPath),published=read(`web/public${t.url}`);assert.equal(sha(original),t.sourceDdsSha256);assert.equal(sha(published),t.sha256);
  for(const s of t.slices){const selected=read(s.selectedDdsPath);assert.equal(sha(selected),s.selectedDdsSha256);assert.deepEqual(selected.subarray(148),original.subarray(s.sourceDataOffset,s.sourceDataOffset+s.retainedDataBytes));}
  if(shared[id]){assert.deepEqual(t,shared[id]);assert.equal(t.format,'rgba8-array');assert.equal(t.layers,10);reused++;}else newBytes+=published.length;
 }
 assert.equal(reused,1);assert.equal(newBytes,11674970);
});

test('Array1UV arithmetic, samplers and normalized prelighting agree with native records',()=>{
 assert.equal(ARRAY1UV_GLSL,read('tools/materials/array1uv-equations.glsl').toString());const validation=json('exports/materials/array1uv-shader/equation-validation.json');assert.equal(validation.cases,3900);assert.ok(validation.maxAbsoluteError<1e-10);assert.deepEqual(validation.arrayLayersTested,[0,1,2,3,4,5,6,7,8,9]);
 assert.deepEqual(doc.samplerMapping.map(s=>s.packedFilterAddressBytes),[[85,1,1,1],[85,1,3,1]]);const source=read('exports/materials/rvm/0.res');for(const s of doc.samplerMapping)assert.equal(source.subarray(s.sourceOffset,s.sourceOffset+64).toString('hex'),s.rawHex);
 assert.equal(doc.nativeMaterialModel.materialId,0);assert.equal(doc.nativeMaterialModel.reflectance,.5);assert.equal(doc.nativeLightingInputs.shNormal,'normalized-source-world-normal');const shader=read('exports/materials/array1uv-shader/dfa7a16109.asm').toString();for(const op of [...doc.nativeMaterialModel.producerOperations,...doc.nativeLightingInputs.normalInstructions])assert.ok(shader.includes(op));
 for(const c of doc.nativeMaterialModel.consumers)assert.equal(sha(read(`exports/lighting/dfg-gbuffer/${c.file}.dxbc`)),c.sha256);
 assert.match(ARRAY1UV_GLSL,/surface.color = 2.0 \* base.rgb \* detail.b/);assert.match(ARRAY1UV_GLSL,/detail.rg - 1.0\) \* cb\[1\].x/);
});

test('actual GLTFLoader routes exactly13 one-UV sections and leaves geometry intact',async()=>withLoaders(async textures=>{
 const recovered=await prepareRecoveredArray1UvMaterials(doc),scene=json('web/public/assets/map.scene.json'),gltfLoader=loader();let matching=0;
 for(const id of new Set(doc.materials.map(r=>r.assetId))){
  const asset=scene.assets.find(a=>a.id===id),gltf=await gltfLoader.parseAsync(buffer(read(`web/public/assets/${asset.url}`)),'');const original=new Map();gltf.scene.traverse(m=>{if(m.isMesh)original.set(m,m.geometry);});
  recovered.apply(gltf,{id:'unrelated'});recovered.apply(gltf,asset);recovered.apply(gltf,asset);
  gltf.scene.traverse(mesh=>{if(!mesh.isMesh)return;assert.equal(mesh.geometry,original.get(mesh));for(const material of [].concat(mesh.material)){const recipe=doc.materials.find(r=>r.assetId===id&&r.materialId===material.userData.sourceMaterialId);assert.equal(!!material.userData.recoveredArray1UvShader,!!recipe);if(recipe){matching++;assert.equal(material.map,null);assert.equal(material.normalMap,null);assert.equal(material.userData.placeholder,false);}}});
 }
 assert.equal(matching,13);assert.equal(recovered.applied,13);assert.equal(textures.length,26);
}));

test('Array1UV instanced probe shader preserves UV0, original array and independent sampler addressing',async()=>withLoaders(async()=>{
 const recovered=await prepareRecoveredArray1UvMaterials(doc),recipe=doc.materials[0],geometry=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial(),mesh=new THREE.InstancedMesh(geometry,material,2),scene=new THREE.Group();material.userData.sourceMaterialId=recipe.materialId;scene.add(mesh);
 mesh.setMatrixAt(0,new THREE.Matrix4().makeTranslation(-919.68,587.52,-319.9382));mesh.setMatrixAt(1,new THREE.Matrix4().makeTranslation(-918.68,587.52,-319.9382));recovered.apply({scene},{id:recipe.assetId});
 const raw=read('web/public/assets/source-probes.bin'),lighting=createSourceProbeLighting(json('web/public/assets/source-probes.json'),new Float32Array(raw.buffer,raw.byteOffset,raw.byteLength/4));lighting.add(mesh);const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};mesh.material.onBeforeCompile(shader,{});
 assert.deepEqual(shader.uniforms.bf2_array1uv_cb.value.map(v=>v.toArray()),recipe.constants);const array=shader.uniforms.bf2_array1uv_detailArray.value;assert.equal(array.isDataArrayTexture,true);assert.equal(array.image.depth,10);assert.equal(array.wrapT,THREE.RepeatWrapping);assert.equal(shader.uniforms.bf2_array1uv_normalArrayMetal.value.wrapT,THREE.ClampToEdgeWrapping);assert.equal(shader.uniforms.bf2_array1uv_colorSmoothness.value.wrapT,THREE.RepeatWrapping);
 assert.match(shader.vertexShader,/bf2_array1uv_uv = uv;/);assert.match(shader.fragmentShader,/sampler2DArray bf2_array1uv_detailArray/);assert.match(shader.fragmentShader,/metalnessFactor = bf2_array1uv_surface.metalness/);assert.equal(mesh.geometry.attributes.position,geometry.attributes.position);assert.deepEqual([...mesh.geometry.attributes.bf2_probeOffset.array],[0,9]);assert.ok(mesh.material.customProgramCacheKey().includes('TextureArray_01-dfa7a16109'));
 lighting.dispose();array.dispose();
}));
