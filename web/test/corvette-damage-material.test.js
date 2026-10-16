import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {CORVETTE_DAMAGE_GLSL,prepareRecoveredCorvetteDamageMaterials} from '../src/corvette-damage-material.js';
import {createSourceProbeLighting} from '../src/source-probes.js';
const root=new URL('../../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root)),json=p=>JSON.parse(read(p)),sha=b=>crypto.createHash('sha256').update(b).digest('hex'),buffer=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
const doc=json('web/public/assets/recovered-corvette-damage-materials.json'),evidence=json('exports/materials/corvette-damage-shader/material-analysis.json');
async function withLoaders(fn){const originalImage=THREE.TextureLoader.prototype.loadAsync,originalFile=THREE.FileLoader.prototype.loadAsync,textures=[];THREE.TextureLoader.prototype.loadAsync=async function(url){const t=new THREE.Texture();t.name=url;textures.push(t);return t;};THREE.FileLoader.prototype.loadAsync=async function(url){return buffer(read(`web/public${url}`));};try{return await fn(textures);}finally{THREE.TextureLoader.prototype.loadAsync=originalImage;THREE.FileLoader.prototype.loadAsync=originalFile;for(const t of textures)t.dispose();}}
function loader(){const l=new GLTFLoader();l.register(()=>({name:'CorvetteImageStub',loadTexture(){return Promise.resolve(new THREE.Texture());}}));return l;}
async function parseRecord(r){return loader().parseAsync(buffer(read(r.glbPath)),'');}

test('Corvette Damage original shader/input-slot routing and section defaults are preserved',()=>{
 assert.equal(doc.shaderNameHash,2730669534);assert.equal(sha(read('exports/materials/rvm/0.res')),doc.sourceRvmSha256);
 for(const [k,h]of [['pixelShader','pixelShaderSha256'],['pairedVertexShader','pairedVertexShaderSha256']])assert.equal(sha(read(`exports/materials/corvette-damage-shader/${doc[k]}.dxbc`)),doc[h]);
 const g=json('exports/materials/corvette-damage-shader/graph.json');for(let i=1;i<evidence.selectionChain.length;i++)assert.ok(g.edges.some(e=>e.from===evidence.selectionChain[i-1].block&&e.to===evidence.selectionChain[i].block));
 assert.equal(evidence.inputKeyTable,'15a2163e05');assert.deepEqual(doc.textureMapping.map(m=>m.inputSlot),[34,31,10,27,6]);assert.deepEqual(doc.textureMapping.map(m=>m.parameterHash),[3782095298,3965303427,3965303438,3914995556,2065814368]);assert.equal(doc.materials.length,6);assert.equal(doc.placedSectionCount,49);
 const raw=read('exports/materials/rvm/0.res'),c=doc.constantMapping;assert.equal(raw.subarray(doc.samplerMapping.sourceOffset,doc.samplerMapping.sourceOffset+64).toString('hex'),doc.samplerMapping.rawHex);assert.deepEqual(doc.samplerMapping.packedFilterAddressBytes,[85,1,1,1]);assert.equal(raw.subarray(c.defaultSourceOffset,c.defaultSourceOffset+128).toString('hex'),c.rawHex);
 for(const m of doc.materials){const ebx=json(m.sourceMaterialEbx).asset.objects.find(o=>o.$id===m.materialClassGuid);assert.deepEqual(ebx.Shader.ConditionalParameters,[]);assert.deepEqual(ebx.Shader.VectorArrayParameters,[]);assert.equal(m.constantEvidence.sectionOverrideAbsent,true);assert.deepEqual(m.constants,c.default);assert.ok(m.constants.every(v=>v[0]===0));assert.equal(m.bindings.detailArray.texture.rootInstanceGuid,'b9948b43-0b9b-4f16-9f63-77c67ca4b164');}
});

test('Corvette Damage original BC1/BC7 mip payloads and two-layer array bytes remain unchanged',()=>{
 assert.equal(Object.keys(doc.sourceTextures).length,5);let total=0;
 for(const t of Object.values(doc.sourceTextures)){const original=read(t.sourceDdsPath),published=read(`web/public${t.url}`);assert.equal(sha(original),t.sourceDdsSha256);assert.equal(sha(published),t.sha256);total+=published.length;for(const s of t.slices){const selected=read(s.selectedDdsPath);assert.equal(sha(selected),s.selectedDdsSha256);assert.deepEqual(selected.subarray(148),original.subarray(s.sourceDataOffset,s.sourceDataOffset+s.retainedDataBytes));if(t.layers>1)assert.equal(sha(published.subarray(s.decodedByteOffset,s.decodedByteOffset+s.decodedBytes)),s.decodedRgbaSha256);}if(t.layers>1){assert.equal(t.layers,2);assert.equal(t.sourceMip,1);assert.equal(t.width,512);}}
 assert.equal(total,6706514);
});

test('Corvette Damage equation fixtures preserve unsaturated damage and normalized native SH inputs',()=>{
 assert.equal(CORVETTE_DAMAGE_GLSL,read('tools/materials/corvette-damage-equations.glsl').toString());assert.equal(sha(Buffer.from(CORVETTE_DAMAGE_GLSL)),doc.sourceEquationSha256);const v=json('exports/materials/corvette-damage-shader/equation-validation.json');assert.equal(v.cases,3600);assert.ok(v.maxAbsoluteError<1e-10);assert.ok(v.unsaturatedDamageCases>1000);assert.deepEqual(v.arrayLayersTested,[0,1]);
 const dxbc=read('exports/materials/corvette-damage-shader/d92fda6613.dxbc'),asm=read('exports/materials/corvette-damage-shader/d92fda6613.asm').toString();for(const l of doc.sourceLiterals){for(const at of l.dxbcOffsets)assert.equal(dxbc.readFloatLE(at),l.float32);assert.ok(CORVETTE_DAMAGE_GLSL.includes(String(l.float32)));}for(const op of [...doc.nativeMaterialModel.producerOperations,...doc.nativeLightingInputs.normalInstructions])assert.ok(asm.includes(op));assert.equal(doc.nativeMaterialModel.materialId,0);assert.equal(doc.nativeMaterialModel.reflectance,.5);assert.equal(doc.nativeLightingInputs.shNormal,'normalized-source-world-normal');assert.match(CORVETTE_DAMAGE_GLSL,/float damage = vertexDamage \* \(1.0 \+ wreck.a\)/);assert.ok(!CORVETTE_DAMAGE_GLSL.includes('clamp(damage'));
});

test('Corvette Damage sidecar preserves original UV1, vertex color and submaterial values at every vertex',()=>{
 const packed=read(`web/public${doc.vertexInputs.url}`);assert.equal(sha(packed),doc.vertexInputs.sha256);assert.equal(packed.length,1437312);assert.equal(doc.vertexInputs.records.length,10);
 for(const r of doc.vertexInputs.records){assert.equal(sha(read(r.glbPath)),r.glbSha256);const range=packed.subarray(r.byteOffset,r.byteOffset+r.byteLength);assert.equal(sha(range),r.packedSha256);const attributes=Object.fromEntries(r.extraAttributes.map(a=>[a.usage,a]));const sources={};for(const name of ['TexCoord1','Color0','SubMaterialIndex']){const a=attributes[name],b=read(`exports/materials/corvette-damage-vertex/${a.file}`);assert.equal(sha(b),a.sha256);sources[name]=b;}for(let i=0;i<r.vertexCount;i++){assert.equal(range.readFloatLE(i*16),sources.TexCoord1.readFloatLE(i*8));assert.equal(range.readFloatLE(i*16+4),sources.TexCoord1.readFloatLE(i*8+4));assert.equal(range.readFloatLE(i*16+8),sources.Color0.readFloatLE(i*16));assert.equal(range.readFloatLE(i*16+12),sources.SubMaterialIndex.readFloatLE(i*16));}}
});

test('real GLTFLoader preserves original and native LOD geometry while attaching ten source records',async()=>withLoaders(async()=>{
 const recovered=await prepareRecoveredCorvetteDamageMaterials(doc);let matched=0;const seen=new Set();
 for(const r of doc.vertexInputs.records){const key=`${r.assetId}/${r.sourceLod}`;if(seen.has(key))continue;seen.add(key);const gltf=await parseRecord(r),original=new Map();gltf.scene.traverse(m=>{if(m.isMesh)original.set(m,{geometry:m.geometry,position:m.geometry.attributes.position,index:m.geometry.index});});recovered.applyGeometry(gltf,{assetId:r.assetId},r.sourceLod);recovered.applyGeometry(gltf,{assetId:r.assetId},r.sourceLod);if(r.sourceLod===0)recovered.apply(gltf,{id:r.assetId});gltf.scene.traverse(m=>{if(!m.isMesh)return;const o=original.get(m);assert.equal(m.geometry,o.geometry);assert.equal(m.geometry.attributes.position,o.position);assert.equal(m.geometry.index,o.index);const wanted=doc.vertexInputs.records.some(s=>s.assetId===r.assetId&&s.sourceLod===r.sourceLod&&s.primitiveIndex===gltf.parser.associations.get(m).primitives);assert.equal(!!m.geometry.attributes.bf2CorvetteDamage,wanted);if(r.sourceLod===0&&m.material.userData.recoveredCorvetteDamageShader)matched++;});}
 assert.equal(recovered.geometries,10);assert.equal(recovered.applied,6);assert.equal(matched,6);
 const r=doc.vertexInputs.records[0],bad=await parseRecord(r);bad.scene.traverse(m=>{if(m.isMesh)m.geometry.attributes.uv.array[0]+=.25;});assert.throws(()=>recovered.applyGeometry(bad,{id:r.assetId}),/correspondence mismatch/);
}));

test('Corvette Damage actual GLTF instancing keeps flat array index and source probe attributes',async()=>withLoaders(async()=>{
 const recovered=await prepareRecoveredCorvetteDamageMaterials(doc),r=doc.vertexInputs.records[0],gltf=await parseRecord(r);recovered.apply(gltf,{id:r.assetId});let source;gltf.scene.traverse(m=>{if(m.isMesh&&m.material.userData.recoveredCorvetteDamageShader)source=m;});const mesh=new THREE.InstancedMesh(source.geometry,source.material,2);mesh.setMatrixAt(0,new THREE.Matrix4().makeTranslation(-919.68,587.52,-319.9382));mesh.setMatrixAt(1,new THREE.Matrix4().makeTranslation(-918.68,587.52,-319.9382));
 const bytes=read('web/public/assets/source-probes.bin'),lighting=createSourceProbeLighting(json('web/public/assets/source-probes.json'),new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4));lighting.add(mesh);const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};mesh.material.onBeforeCompile(shader,{});
 assert.match(shader.vertexShader,/attribute vec4 bf2CorvetteDamage/);assert.match(shader.fragmentShader,/flat varying float bf2_corvette_damage_index/);assert.match(shader.fragmentShader,/bf2_corvette_damage_cb\[int\(bf2_corvette_damage_index\)\].x/);assert.match(shader.fragmentShader,/bf2_corvette_damage_damage,/);assert.equal(shader.uniforms.bf2_corvette_damage_detailArray.value.image.depth,2);assert.equal(shader.uniforms.bf2_corvette_damage_cb.value.length,8);assert.equal(mesh.geometry.attributes.bf2CorvetteDamage,source.geometry.attributes.bf2CorvetteDamage);assert.deepEqual([...mesh.geometry.attributes.bf2_probeOffset.array],[0,9]);assert.ok(mesh.material.customProgramCacheKey().includes('Damage_01-d92fda6613'));lighting.dispose();
}));
