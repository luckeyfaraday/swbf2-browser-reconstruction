import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {BLASTER_BOLT_GLSL,prepareRecoveredBlasterBoltPixel} from '../src/blaster-bolt-material.js';
const root=new URL('../../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root)),json=p=>JSON.parse(read(p)),sha=b=>crypto.createHash('sha256').update(b).digest('hex'),arrayBuffer=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
const doc=json('web/public/assets/recovered-blaster-bolt-material.json');

test('original blaster shader and four texture slots route through the retained shared-weapons RVM',()=>{
 assert.equal(doc.shaderNameHash,4035194024);assert.equal(sha(read(doc.sourceRvmPath)),doc.sourceRvmSha256);
 const graph=json('exports/rifle-trail/render-shaders/graph.json');
 for(let i=1;i<doc.selectionChain.length;i++)assert.ok(graph.edges.some(e=>e.from===doc.selectionChain[i-1].block&&e.to===doc.selectionChain[i].block));
 for(const name of ['pixelShader','alternatePixelShader','pairedVertexShader'])assert.equal(sha(read(`exports/rifle-trail/render-shaders/${doc[name]}.dxbc`)),doc[`${name}Sha256`]);
 assert.deepEqual(doc.textureMapping.map(t=>t.register),['t2','t3','t4','t5']);
 assert.deepEqual(doc.textureMapping.map(t=>t.inputSlot),[22,44,12,46]);
 assert.deepEqual(doc.textureMapping.map(t=>t.channel),['a','a','r','r']);
 assert.deepEqual(doc.constantMapping.default,[1,1,1,1]);assert.equal(doc.constantMapping.sectionOverrideAbsent,true);
 const rvm=read(doc.sourceRvmPath),sampler=doc.samplerMapping,constant=doc.constantMapping;
 assert.equal(rvm.subarray(sampler.sourceOffset,sampler.sourceOffset+64).toString('hex'),sampler.rawHex);
 assert.equal(rvm.subarray(constant.defaultSourceOffset,constant.defaultSourceOffset+16).toString('hex'),constant.rawHex);
});

test('four original BC7 SRGB textures preserve compressed mip payload and published PNG bytes',()=>{
 let bytes=0;assert.equal(Object.keys(doc.sourceTextures).length,4);
 for(const t of Object.values(doc.sourceTextures)){
  const source=read(t.sourceDdsPath),selected=read(t.selectedDdsPath),png=read(`web/public${t.url}`);
  assert.equal(sha(source),t.sourceDdsSha256);assert.equal(sha(selected),t.selectedDdsSha256);assert.equal(sha(png),t.sha256);
  assert.deepEqual(selected.subarray(148),source.subarray(t.sourceDataOffset));assert.equal(t.dxgiFormat,99);assert.equal(t.sourceMip,0);
  assert.equal(png.readUInt32BE(16),t.width);assert.equal(png.readUInt32BE(20),t.height);bytes+=png.length;
 }
 assert.equal(bytes,602401);
});

test('original pixel equations retain separate native radiance and coverage targets',()=>{
 assert.equal(BLASTER_BOLT_GLSL,read('tools/materials/blaster-bolt-equations.glsl').toString());assert.equal(sha(Buffer.from(BLASTER_BOLT_GLSL)),doc.sourceEquationSha256);
 const report=json('exports/rifle-trail/render-shaders/render-material-equation-validation.json');
 assert.equal(report.shaderEvaluations,8000);assert.ok(report.maxAbsoluteError<1e-10);
 assert.match(BLASTER_BOLT_GLSL,/result\.depthCoverage = vec4\(screenPosition.z, 1.0, 0.0, coverage\)/);
 assert.match(BLASTER_BOLT_GLSL,/nativeGlobal40\.w \+ \(1\.0 - nativeGlobal40\.w\) \* 0\.25/);
 assert.match(doc.outputs.target0,/radiance,0/);assert.ok(doc.limitations.some(s=>s.includes('blend-state')));
});

test('real GLTFLoader preserves original 363-vertex bolt mesh and UVs with no shape approximation',async()=>{
 assert.equal(sha(read(`web/public${doc.sourceMesh.url}`)),doc.sourceMesh.glbSha256);
 const loader=new GLTFLoader();loader.register(()=>({name:'BoltTextureStub',loadTexture(){return Promise.resolve(new THREE.Texture());}}));
 const gltf=await loader.parseAsync(arrayBuffer(read(`web/public${doc.sourceMesh.url}`)),''),meshes=[];gltf.scene.traverse(m=>{if(m.isMesh)meshes.push(m);});
 assert.equal(meshes.length,1);const geometry=meshes[0].geometry,record=doc.sourceMesh.vertexEvidence;
 assert.equal(geometry.attributes.position.count,363);assert.equal(geometry.index.count,1350);
 for(const [usage,name]of [['Pos','position'],['TexCoord0','uv']]){
  const a=record.extraAttributes.find(a=>a.usage===usage),raw=read(`exports/rifle-trail/render-material-vertex/${a.file}`);assert.equal(sha(raw),a.sha256);
  const attribute=geometry.attributes[name];for(let i=0;i<attribute.count*attribute.itemSize;i++)assert.equal(attribute.array[i],raw.readFloatLE(i*4));
 }
 assert.equal(sha(Buffer.from(geometry.index.array.buffer,geometry.index.array.byteOffset,geometry.index.array.byteLength)),record.indexSha256);
});

test('pixel texture loader preserves source color spaces, UV direction and explicit multiplier',async()=>{
 const original=THREE.TextureLoader.prototype.loadAsync,loaded=[];THREE.TextureLoader.prototype.loadAsync=async function(url){const t=new THREE.Texture();t.name=url;loaded.push(t);return t;};
 try{
  const recovered=await prepareRecoveredBlasterBoltPixel(doc);assert.equal(loaded.length,4);
  for(const [role,t]of Object.entries(recovered.textures)){assert.equal(t.name,doc.textures[role]);assert.equal(t.flipY,false);assert.equal(t.colorSpace,THREE.SRGBColorSpace);assert.equal(t.wrapS,THREE.RepeatWrapping);assert.equal(t.wrapT,THREE.RepeatWrapping);assert.equal(recovered.uniforms[`bf2_bolt_${role}`].value,t);}
  assert.deepEqual(recovered.uniforms.bf2_bolt_multiplier.value.toArray(),[1,1,1]);assert.equal(recovered.sourceMesh.url,doc.sourceMesh.url);assert.equal(recovered.glsl,BLASTER_BOLT_GLSL);recovered.dispose();
 }finally{THREE.TextureLoader.prototype.loadAsync=original;}
});
