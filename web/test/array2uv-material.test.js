import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {ARRAY2UV_GLSL,prepareRecoveredArray2UvMaterials} from '../src/array2uv-material.js';
import {createSourceProbeLighting} from '../src/source-probes.js';
const root=new URL('../../',import.meta.url),read=path=>fs.readFileSync(new URL(path,root)),json=path=>JSON.parse(read(path));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const doc=json('web/public/assets/recovered-array2uv-materials.json'),evidence=json('exports/materials/array2uv-shader/material-analysis.json');
const buffer=bytes=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
async function withLoaders(callback){
 const imagePrior=THREE.TextureLoader.prototype.loadAsync,filePrior=THREE.FileLoader.prototype.loadAsync,textures=[];
 THREE.TextureLoader.prototype.loadAsync=async function(url){const t=new THREE.Texture();t.name=url;textures.push(t);return t;};
 THREE.FileLoader.prototype.loadAsync=async function(url){return buffer(read(`web/public${url}`));};
 try{return await callback(textures);}finally{THREE.TextureLoader.prototype.loadAsync=imagePrior;THREE.FileLoader.prototype.loadAsync=filePrior;for(const t of textures)t.dispose();}
}
function createLoader(){const loader=new GLTFLoader();loader.register(()=>({name:'Array2UvNodeImageStub',loadTexture(){return Promise.resolve(new THREE.Texture());}}));return loader;}

test('Array2UV exact native selection, texture-array identity and all14 override/default routes',()=>{
 assert.equal(doc.shaderNameHash,2612997987);assert.equal(sha(read('exports/materials/rvm/0.res')),doc.sourceRvmSha256);
 for(const [key,hash]of [['pixelShader','pixelShaderSha256'],['pairedVertexShader','pairedVertexShaderSha256']])assert.equal(sha(read(`exports/materials/array2uv-shader/${doc[key]}.dxbc`)),doc[hash]);
 const graph=json('exports/materials/array2uv-shader/graph.json');for(let i=1;i<evidence.selectionChain.length;i++)assert.ok(graph.edges.some(e=>e.from===evidence.selectionChain[i-1].block&&e.to===evidence.selectionChain[i].block));
 assert.deepEqual(doc.textureMapping.map(r=>r.parameterHash),[3694953547,26739661,193470474]);assert.equal(evidence.pixelConstantTableOutputSlot,38);assert.equal(evidence.vertexConstantTableOutputSlot,37);
 assert.deepEqual(doc.constantMapping.map(r=>r.inputSlot),[12,29]);assert.equal(doc.materials.length,14);assert.equal(doc.placedSectionCount,395);
 let overrides=0,defaults=0;
 for(const row of doc.materials){
  assert.equal(row.bindings.detailArray.texture.rootInstanceGuid,'d72f699d-b7ad-f0da-de8e-7f2741b3ef4c');
  const identity=row.bindings.detailArray.texture;assert.equal(sha(read(identity.sourceEbxPath)),identity.sourceEbxSha256);assert.equal(json(identity.sourceEbxPath).asset.rootInstanceGuid,identity.rootInstanceGuid);
  row.constantEvidence.forEach((e,i)=>{if(e.kind==='exact-section-override'){const b=Buffer.from(e.rawHex,'hex');assert.deepEqual(row.constants[i],[0,4,8,12].map(at=>b.readFloatLE(at)));overrides++;}else{assert.deepEqual(row.constants[i],doc.constantMapping[i].default);defaults++;}});
 }
 assert.equal(overrides,11);assert.equal(defaults,17);assert.ok(doc.materials.some(r=>r.constants[1][0]===5));
 assert.match(doc.uvRouting.sourceAttributeAssociation,/inferred/);assert.match(doc.limitations.join(' '),/explicit inference/);
});

test('Array2UV native mip payloads, ten-layer order and transfer functions remain unchanged',()=>{
 assert.equal(Object.keys(doc.sourceTextures).length,23);
 for(const t of Object.values(doc.sourceTextures)){
  const source=read(t.sourceDdsPath),published=read(`web/public${t.url}`);assert.equal(sha(source),t.sourceDdsSha256);assert.equal(sha(published),t.sha256);assert.equal(published.length,t.bytes);
  for(const slice of t.slices){
   const selected=read(slice.selectedDdsPath);assert.equal(sha(selected),slice.selectedDdsSha256);
   assert.deepEqual(selected.subarray(148),source.subarray(slice.sourceDataOffset,slice.sourceDataOffset+slice.retainedDataBytes));assert.equal(sha(read(slice.pngPath)),slice.pngSha256);
   if(t.format==='rgba8-array')assert.equal(sha(published.subarray(slice.decodedByteOffset,slice.decodedByteOffset+slice.decodedBytes)),slice.decodedRgbaSha256);
  }
  assert.equal(t.colorSpace,[29,78,99].includes(t.dxgiFormat)?'srgb':'linear');
  if(t.format==='rgba8-array'){assert.equal(t.layers,10);assert.equal(t.sourceMip,1);assert.deepEqual([t.width,t.height],[512,512]);assert.equal(t.bytes,10485760);}
 }
});

test('Array2UV equations preserve two UV pairs, array layers, weight saturation and native material semantics',()=>{
 assert.equal(ARRAY2UV_GLSL,read('tools/materials/array2uv-equations.glsl').toString());const validation=json('exports/materials/array2uv-shader/equation-validation.json');
 assert.equal(validation.cases,4200);assert.ok(validation.maxAbsoluteError<1e-10);assert.deepEqual(validation.arrayLayersTested,[0,1,2,3,4,5,6,7,8,9]);
 assert.equal(doc.nativeMaterialModel.materialId,0);assert.equal(doc.nativeMaterialModel.reflectance,.5);assert.equal(doc.nativeLightingInputs.shNormal,'normalized-source-world-normal');
 const shader=read('exports/materials/array2uv-shader/52d055444c.asm').toString();for(const op of [...doc.nativeMaterialModel.producerOperations,...doc.nativeLightingInputs.normalInstructions])assert.ok(shader.includes(op));
 for(const c of doc.nativeMaterialModel.consumers)assert.equal(sha(read(`exports/lighting/dfg-gbuffer/${c.file}.dxbc`)),c.sha256);
 assert.match(ARRAY2UV_GLSL,/namSurface.b \* 10.0/);assert.match(ARRAY2UV_GLSL,/clamp\(normalDetailUv, 0.0, 1.0\)/);assert.match(ARRAY2UV_GLSL,/detail.rg - 1.0\) \* cb\[1\].x/);
});

test('original UV1 sidecars hash-match all28 actual LOD0/native-LOD primitives without geometry changes',async()=>withLoaders(async()=>{
 const recovered=await prepareRecoveredArray2UvMaterials(doc),loader=createLoader(),bytes=read(`web/public${doc.uv1.url}`);assert.equal(sha(bytes),doc.uv1.sha256);assert.equal(doc.uv1.records.length,28);
 const paths=new Map(doc.uv1.records.map(r=>[r.glbPath,r]));let matched=0;
 for(const [path,entry]of paths){
  const raw=read(path);assert.equal(sha(raw),entry.glbSha256);const gltf=await loader.parseAsync(buffer(raw),'');const original=new Map();gltf.scene.traverse(m=>{if(m.isMesh)original.set(m,[m.geometry,m.geometry.attributes.position,m.geometry.index,m.geometry.attributes.uv]);});
  recovered.applyGeometry(gltf,{id:entry.assetId},entry.sourceLod);recovered.applyGeometry(gltf,{id:entry.assetId},entry.sourceLod);
  gltf.scene.traverse(mesh=>{if(!mesh.isMesh)return;const row=doc.uv1.records.find(r=>r.assetId===entry.assetId&&r.sourceLod===entry.sourceLod&&r.primitiveIndex===gltf.parser.associations.get(mesh)?.primitives);assert.ok(row);matched++;
   assert.deepEqual([mesh.geometry,mesh.geometry.attributes.position,mesh.geometry.index,mesh.geometry.attributes.uv],original.get(mesh));
   const data=mesh.geometry.attributes.bf2ArrayUv1.array;assert.equal(sha(new Uint8Array(data.buffer,data.byteOffset,data.byteLength)),row.uv1Sha256);assert.equal(mesh.geometry.userData.recoveredArray2Uv.sourceLod,row.sourceLod);
  });
 }
 assert.equal(matched,28);assert.equal(recovered.geometries,28);
}));

test('actual GLTF material routing applies exactly14 sections and rejects incorrect source topology',async()=>withLoaders(async textures=>{
 const recovered=await prepareRecoveredArray2UvMaterials(doc),loader=createLoader(),scene=json('web/public/assets/map.scene.json');let matching=0;
 for(const id of new Set(doc.materials.map(r=>r.assetId))){
  const asset=scene.assets.find(a=>a.id===id),gltf=await loader.parseAsync(buffer(read(`web/public/assets/${asset.url}`)),'');recovered.apply(gltf,{id:'unrelated'});recovered.apply(gltf,asset);recovered.apply(gltf,asset);
  gltf.scene.traverse(mesh=>{if(!mesh.isMesh)return;for(const m of [].concat(mesh.material)){const recipe=doc.materials.find(r=>r.assetId===id&&r.materialId===m.userData.sourceMaterialId);assert.equal(!!m.userData.recoveredArray2UvShader,!!recipe);if(recipe){matching++;assert.equal(m.map,null);assert.equal(m.normalMap,null);assert.equal(m.userData.placeholder,false);}}});
  if(id===doc.materials[0].assetId){const mesh=gltf.scene.children[0];mesh.geometry.attributes.uv.array[0]+=.1;assert.throws(()=>recovered.applyGeometry(gltf,asset),/correspondence mismatch/);}
 }
 assert.equal(matching,14);assert.equal(recovered.applied,14);assert.equal(textures.length,22);
}));

test('Array2UV instanced material and native probe geometry retain original UV1 and layer texture',async()=>withLoaders(async()=>{
 const recovered=await prepareRecoveredArray2UvMaterials(doc),recipe=doc.materials[0],row=doc.uv1.records.find(r=>r.assetId===recipe.assetId&&r.sourceLod===0);
 const gltf=await createLoader().parseAsync(buffer(read(row.glbPath)),'');recovered.apply(gltf,{id:recipe.assetId});const original=gltf.scene.children[0];
 const mesh=new THREE.InstancedMesh(original.geometry,original.material,2);mesh.setMatrixAt(0,new THREE.Matrix4().makeTranslation(-919.68,587.52,-319.9382));mesh.setMatrixAt(1,new THREE.Matrix4().makeTranslation(-918.68,587.52,-319.9382));
 const raw=read('web/public/assets/source-probes.bin'),lighting=createSourceProbeLighting(json('web/public/assets/source-probes.json'),new Float32Array(raw.buffer,raw.byteOffset,raw.byteLength/4));lighting.add(mesh);
 const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};mesh.material.onBeforeCompile(shader,{});
 assert.deepEqual(shader.uniforms.bf2_array2uv_cb.value.map(v=>v.toArray()),recipe.constants);const array=shader.uniforms.bf2_array2uv_detailArray.value;assert.equal(array.isDataArrayTexture,true);assert.equal(array.image.depth,10);assert.equal(array.generateMipmaps,true);
 assert.match(shader.vertexShader,/vec4\(uv, bf2ArrayUv1\)/);assert.match(shader.fragmentShader,/sampler2DArray bf2_array2uv_detailArray/);assert.match(shader.fragmentShader,/metalnessFactor = bf2_array2uv_surface.metalness/);
 assert.equal(mesh.geometry.attributes.position,original.geometry.attributes.position);assert.equal(mesh.geometry.attributes.bf2ArrayUv1,original.geometry.attributes.bf2ArrayUv1);assert.deepEqual([...mesh.geometry.attributes.bf2_probeOffset.array],[0,9]);assert.ok(mesh.material.customProgramCacheKey().includes('TextureArray_01-52d055444c'));
 lighting.dispose();array.dispose();
}));
