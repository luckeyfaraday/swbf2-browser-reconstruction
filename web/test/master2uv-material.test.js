import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MASTER2UV_GLSL,prepareRecoveredMaster2UvMaterials} from '../src/master2uv-material.js';
import {createSourceProbeLighting} from '../src/source-probes.js';
const root=new URL('../../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root)),json=p=>JSON.parse(read(p));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),buffer=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
const doc=json('web/public/assets/recovered-master2uv-materials.json'),evidence=json('exports/materials/master2uv-shader/material-analysis.json');
async function withLoaders(fn){
 const imagePrior=THREE.TextureLoader.prototype.loadAsync,filePrior=THREE.FileLoader.prototype.loadAsync,textures=[];
 THREE.TextureLoader.prototype.loadAsync=async function(url){const t=new THREE.Texture();t.name=url;textures.push(t);return t;};
 THREE.FileLoader.prototype.loadAsync=async function(url){return buffer(read(`web/public${url}`));};
 try{return await fn(textures);}finally{THREE.TextureLoader.prototype.loadAsync=imagePrior;THREE.FileLoader.prototype.loadAsync=filePrior;for(const t of textures)t.dispose();}
}
function loader(){const l=new GLTFLoader();l.register(()=>({name:'Master2UvNodeImageStub',loadTexture(){return Promise.resolve(new THREE.Texture());}}));return l;}
const primitive=(gltf,index)=>{let result;gltf.scene.traverse(mesh=>{if(mesh.isMesh&&gltf.parser.associations.get(mesh)?.primitives===index)result=mesh;});return result;};

test('Master2UV exact shader path and eleven input slots retain all eight source section overrides',()=>{
 assert.equal(doc.shaderNameHash,2187313360);assert.equal(doc.shaderGuid,'779b5cbe-1506-41b0-857d-1fe6587182e3');
 const rvm=read('exports/materials/rvm/0.res'),index=json('exports/materials/rvm/block-index.json').blocks;
 assert.equal(sha(rvm),doc.sourceRvmSha256);
 assert.deepEqual(doc.samplerMapping.packedFilterAddressBytes,[85,1,1,1]);
 const sampler=index[doc.samplerMapping.samplerBlock];assert.equal(rvm.subarray(sampler.offset,sampler.offset+sampler.size).toString('hex'),doc.samplerMapping.rawHex);
 assert.deepEqual(doc.pairedVertexSelection.chain,['8cb85e216d','ed3a777f20','a15e19476b','894409a19e']);
 const graph=json('exports/materials/master2uv-shader/graph.json');
 for(let i=1;i<evidence.selectionChain.length;i++)assert.ok(graph.edges.some(e=>e.from===evidence.selectionChain[i-1].block&&e.to===evidence.selectionChain[i].block));
 for(const [key,digest]of [['pixelShader','pixelShaderSha256'],['pairedVertexShader','pairedVertexShaderSha256']])assert.equal(sha(read(`exports/materials/master2uv-shader/${doc[key]}.dxbc`)),doc[digest]);
 assert.deepEqual(doc.textureMapping.map(r=>r.parameterHash),[561808527,3886168014,1840368952,4264966676,2517056835,3273948515,2351883907,594790500,3052299456,613096030,1793132757]);
 assert.deepEqual(doc.constantMapping.map(r=>r.inputSlot),[21,26,14,49,24,40,45,0,31]);
 assert.equal(doc.materials.length,8);assert.equal(doc.placedSectionCount,680);let overrides=0;
 const split=json('exports/materials/final-map-blocks.json').blocks;
 for(const row of doc.materials){
  assert.equal(row.sourceShader.$external,doc.shaderGuid);assert.equal(row.variationHash,0);
  const original=evidence.materials.find(r=>r.assetId===row.assetId&&r.materialId===row.materialId);
  assert.deepEqual(row.constants,original.constants);assert.deepEqual(row.bindings,original.bindings);
  for(const [role,binding]of Object.entries(row.bindings))assert.equal(row.textures[role],doc.sourceTextures[binding.texture.fileGuid].url);
  row.constantEvidence.forEach((e,i)=>{
   let bytes;
   if(e.kind==='exact-section-override'){
    const block=split.find(b=>b.source.rid===e.sourceBlock);assert.equal(block.sha256,e.sourceBlockSha256);
    assert.ok(block.parameters.some(p=>p.offset===e.offset&&p.rawHex===e.rawHex));bytes=Buffer.from(e.rawHex,'hex');overrides++;
   }else{const source=index[e.sourceBlock];bytes=rvm.subarray(source.offset,source.offset+16);}
   assert.deepEqual(row.constants[i],[0,4,8,12].map(at=>bytes.readFloatLE(at)));
  });
 }
 assert.ok(overrides>15);assert.match(doc.uvRouting.sourceAttributeAssociation,/inferred/);
});

test('all fifteen native textures retain compressed mip bytes with twelve published payloads reused',()=>{
 const textures=Object.values(doc.sourceTextures);assert.equal(textures.length,15);assert.equal(textures.filter(t=>t.reusedFrom).length,12);
 for(const t of textures){
  const source=read(t.sourceDdsPath),selected=read(t.selectedDdsPath),png=read(`web/public${t.url}`);
  assert.equal(sha(source),t.sourceDdsSha256);assert.equal(sha(selected),t.selectedDdsSha256);assert.equal(sha(png),t.sha256);
  assert.deepEqual(selected.subarray(148),source.subarray(t.sourceDataOffset,t.sourceDataOffset+t.retainedDataBytes));
  assert.deepEqual([png.readUInt32BE(16),png.readUInt32BE(20)],[t.width,t.height]);assert.ok(t.width<=1024&&t.height<=1024);
  assert.equal(t.colorSpace,[29,72,78,99].includes(t.dxgiFormat)?'srgb':'linear');
 }
});

test('Master2UV source math distinguishes both normal maps and normalized native SH input',()=>{
 assert.equal(MASTER2UV_GLSL,read('tools/materials/master2uv-equations.glsl').toString());
 const validation=json('exports/materials/master2uv-shader/equation-validation.json');assert.equal(validation.cases,2400);assert.ok(validation.maxAbsoluteError<1e-10);
 const shader=read(`exports/materials/master2uv-shader/${doc.pixelShader}.asm`).toString(),vs=read(`exports/materials/master2uv-shader/${doc.pairedVertexShader}.asm`).toString();
 for(const op of [...doc.nativeMaterialModel.producerOperations,...doc.nativeLightingInputs.normalInstructions,...doc.nativeLightingInputs.grungeInstructions])assert.ok(shader.includes(op));
 for(const op of doc.uvRouting.vertexOperations)assert.ok(vs.includes(op));
 assert.equal(doc.nativeMaterialModel.materialId,0);assert.equal(doc.nativeMaterialModel.reflectance,.5);assert.equal(doc.nativeLightingInputs.shNormal,'normalized-source-world-normal');
 for(const c of doc.nativeMaterialModel.consumers)assert.equal(sha(read(`exports/lighting/dfg-gbuffer/${c.file}.dxbc`)),c.sha256);
 assert.match(MASTER2UV_GLSL,/texture2D\(baseNormalMap, baseUv\).rg/);
 assert.match(MASTER2UV_GLSL,/normalize\(vec3\(baseXY \+ \(2.0 \* base.rg - 1.0\) \+ detail, baseZ\)\)/);
 assert.match(MASTER2UV_GLSL,/result.ao = base.a/);
});

test('fourteen source UV1 sidecars match actual GLBs while other primitives and existing geometry remain intact',async()=>withLoaders(async()=>{
 const adapter=await prepareRecoveredMaster2UvMaterials(doc),l=loader(),payload=read(`web/public${doc.uv1.url}`);
 assert.equal(sha(payload),doc.uv1.sha256);assert.equal(payload.length,65600);assert.equal(doc.uv1.records.length,14);
 const paths=new Map(doc.uv1.records.map(r=>[r.glbPath,r]));let matched=0,unrelated=0;
 for(const [path,entry]of paths){
  const raw=read(path);assert.equal(sha(raw),entry.glbSha256);const gltf=await l.parseAsync(buffer(raw),'');const original=new Map();
  gltf.scene.traverse(m=>{if(m.isMesh)original.set(m,[m.geometry,m.geometry.attributes.position,m.geometry.index,m.geometry.attributes.uv,m.geometry.attributes.normal]);});
  adapter.applyGeometry(gltf,{id:entry.assetId},entry.sourceLod);adapter.applyGeometry(gltf,{id:entry.assetId},entry.sourceLod);
  for(const [mesh,retained]of original){
   assert.deepEqual([mesh.geometry,mesh.geometry.attributes.position,mesh.geometry.index,mesh.geometry.attributes.uv,mesh.geometry.attributes.normal],retained);
   const row=doc.uv1.records.find(r=>r.assetId===entry.assetId&&r.sourceLod===entry.sourceLod&&r.primitiveIndex===gltf.parser.associations.get(mesh)?.primitives);
   if(!row){assert.equal(mesh.geometry.attributes.bf2Master2Uv1,undefined);unrelated++;continue;}
   const a=mesh.geometry.attributes.bf2Master2Uv1.array;assert.equal(sha(new Uint8Array(a.buffer,a.byteOffset,a.byteLength)),row.uv1Sha256);matched++;
  }
 }
 assert.equal(matched,14);assert.equal(adapter.geometries,14);assert.ok(unrelated>0);
}));

test('actual source material routing changes exactly eight sections and rejects topology mismatches',async()=>withLoaders(async textures=>{
 const adapter=await prepareRecoveredMaster2UvMaterials(doc),l=loader(),scene=json('web/public/assets/map.scene.json');let changed=0;
 for(const id of new Set(doc.materials.map(r=>r.assetId))){
  const asset=scene.assets.find(a=>a.id===id),gltf=await l.parseAsync(buffer(read(`web/public/assets/${asset.url}`)),'');
  adapter.apply(gltf,{id:'unrelated'});adapter.apply(gltf,asset);adapter.apply(gltf,asset);
  gltf.scene.traverse(mesh=>{if(!mesh.isMesh)return;for(const m of [].concat(mesh.material)){
   const recipe=doc.materials.find(r=>r.assetId===id&&r.materialId===m.userData.sourceMaterialId);assert.equal(!!m.userData.recoveredMaster2UvShader,!!recipe);
   if(recipe){changed++;assert.equal(m.map,null);assert.equal(m.normalMap,null);assert.equal(m.userData.placeholder,false);}
  }});
  const row=doc.uv1.records.find(r=>r.assetId===id&&r.sourceLod===0),mesh=primitive(gltf,row.primitiveIndex);
  mesh.geometry.attributes.uv.array[0]+=.1;assert.throws(()=>adapter.applyGeometry(gltf,asset),/correspondence mismatch/);
 }
 assert.equal(changed,8);assert.equal(adapter.applied,8);assert.equal(textures.length,15);
 for(const t of textures){assert.equal(t.wrapS,THREE.RepeatWrapping);assert.equal(t.flipY,false);}
}));

test('instanced Master2UV preserves source UV1 and exact material uniforms through probe decoration',async()=>withLoaders(async()=>{
 const adapter=await prepareRecoveredMaster2UvMaterials(doc),recipe=doc.materials[0],row=doc.uv1.records.find(r=>r.assetId===recipe.assetId&&r.sourceLod===0&&r.sourceMaterialId===recipe.materialId);
 const gltf=await loader().parseAsync(buffer(read(row.glbPath)),'');adapter.apply(gltf,{id:recipe.assetId});const original=primitive(gltf,row.primitiveIndex);
 const mesh=new THREE.InstancedMesh(original.geometry,original.material,2);mesh.setMatrixAt(0,new THREE.Matrix4().makeTranslation(-919.68,587.52,-319.9382));mesh.setMatrixAt(1,new THREE.Matrix4().makeTranslation(-918.68,587.52,-319.9382));
 const raw=read('web/public/assets/source-probes.bin'),lighting=createSourceProbeLighting(json('web/public/assets/source-probes.json'),new Float32Array(raw.buffer,raw.byteOffset,raw.byteLength/4));lighting.add(mesh);
 const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};mesh.material.onBeforeCompile(shader,{});
 assert.deepEqual(shader.uniforms.bf2_master2uv_cb.value.map(v=>v.toArray()),recipe.constants);
 for(const [role,url]of Object.entries(recipe.textures))assert.equal(shader.uniforms[`bf2_master2uv_${role}`].value.name,url);
 assert.match(shader.vertexShader,/vec4\(uv, bf2Master2Uv1\)/);assert.match(shader.fragmentShader,/sampleMaster2UV\(bf2_master2uv_uv.xy, bf2_master2uv_uv.zw/);
 assert.match(shader.fragmentShader,/bf2_master2uv_world,\s*bf2_master2uv_geometricNormal, bf2_master2uv_cb/);
 assert.doesNotMatch(shader.fragmentShader,/normalize\(bf2_master2uv_geometricNormal\)/);
 assert.deepEqual(mesh.material.userData.recoveredMaster2UvShader.nativeLightingInputs,doc.nativeLightingInputs);
 assert.match(shader.fragmentShader,/bf2_master2uv_tbn\(-vViewPosition, normal, bf2_master2uv_uv.xy\)/);
 assert.match(shader.fragmentShader,/reflectedLight.indirectDiffuse \*= bf2_master2uv_surface.ao/);
 assert.equal(mesh.geometry.attributes.position,original.geometry.attributes.position);assert.equal(mesh.geometry.attributes.bf2Master2Uv1,original.geometry.attributes.bf2Master2Uv1);
 assert.deepEqual([...mesh.geometry.attributes.bf2_probeOffset.array],[0,9]);assert.match(mesh.material.customProgramCacheKey(),/SS_DSI_Master_2UV-2304f89b0d/);lighting.dispose();
}));
