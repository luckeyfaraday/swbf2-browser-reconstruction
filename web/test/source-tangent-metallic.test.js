import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import * as THREE from 'three';
import {DataUtils,Texture} from 'three';
import {prepareRecoveredMaster1UvEmissiveMaterials} from '../src/master1uv-emissive-material.js';
import {createSourceProbeLighting} from '../src/source-probes.js';
import {createSourceLodController} from '../src/source-lods.js';
import {createSourceTangentWitness,sourceVertexFrame} from '../src/source-tangent-frame.js';

const root=new URL('../../',import.meta.url),directory='exports/materials/native-tangent-metallic/';
const read=p=>fs.readFileSync(new URL(p,root)),json=p=>JSON.parse(read(p));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),buffer=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
const doc=json(directory+'native-tangent-witness.json'),evidence=json(directory+'evidence.json'),routing=json(directory+'shader-routing.json'),payload=read(directory+'native-tangent-witness.bin');

test('metallic emissive32-byte frame consumers are paired by original RVM parameter blocks and exclude other layouts',()=>{
  assert.equal(doc.records.length,13);assert.deepEqual(evidence.stats.sectionsByLod,{'0':10,'1':2,'2':1});
  assert.equal(evidence.stats.baseSectionInstances,104);assert.equal(evidence.excluded.length,5);
  const raw=read('exports/materials/rvm/0.res'),index=json('exports/materials/rvm/block-index.json').blocks;
  assert.equal(sha(raw),routing.sourceRvmSha256);assert.equal(sha(read(directory+'shader-routing.json')),evidence.shaderRoutingSha256);
  const block=k=>raw.subarray(index[k].offset,index[k].offset+index[k].size);
  assert.deepEqual(routing.shaders.map(s=>[s.vertex,s.pixel,s.parameterBlock]),[
    ['282854795b','5ffbbd02c2','e331499a2d'],['69a5d07239','d1092739db','76c9dfc8b2']]);
  for(const shader of routing.shaders){
    assert.equal(shader.inputLayoutBlock,'ad2dd1141c');assert.equal(sha(block(shader.inputLayoutBlock)),shader.inputLayoutSha256);
    assert.equal(sha(read(`exports/materials/master1uv-emissive-shader/${shader.vertex}.dxbc`)),shader.vertexSha256);
    assert.equal(sha(read(`exports/materials/master1uv-emissive-shader/${shader.pixel}.dxbc`)),shader.pixelSha256);
    for(const path of Object.values(shader.paths))for(const edge of path){const n=block(edge.from).readBigUInt64LE(edge.offset);assert.equal(n,BigInt(edge.encoded));assert.equal((n&0xffffffffffn).toString(16).padStart(10,'0'),edge.to);}
  }
  for(const row of evidence.excluded)assert.ok(!doc.records.some(r=>r.assetId===row.assetId&&r.sourceLod===row.sourceLod&&r.sourceMaterialId===row.sourceMaterialId));
});

test('published metallic emissive retains every original tangent/sign and exact real GLTF associations at all current LODs',async()=>{
  assert.equal(payload.byteLength,478928);assert.equal(sha(payload),doc.sha256);
  const published=json('web/public/assets/native-tangent-witness.json'),publishedPayload=read('web/public'+published.url);
  const part=published.sourceCoverage.find(p=>p.evidenceId===evidence.evidenceId);
  assert.deepEqual(publishedPayload.subarray(part.byteOffset,part.byteOffset+part.byteLength),payload);
  assert.equal(part.documentSha256,sha(read(directory+'native-tangent-witness.json')));assert.equal(part.evidenceSha256,sha(read(directory+'evidence.json')));
  const adapter=createSourceTangentWitness(published,buffer(publishedPayload)),loader=new GLTFLoader();
  loader.register(()=>({name:'metallic-tangent-test-image-stub',loadTexture:async()=>new Texture()}));
  for(const rows of Map.groupBy(doc.records,r=>`${r.assetId}/${r.sourceLod}`).values()){
    const first=rows[0],raw=read(first.glbPath);assert.equal(sha(raw),first.glbSha256);const gltf=await loader.parseAsync(buffer(raw),'');
    const before=new Map();gltf.scene.traverse(mesh=>{if(mesh.isMesh)before.set(mesh,[mesh.geometry,mesh.material,mesh.geometry.attributes.position,mesh.geometry.attributes.normal,mesh.geometry.attributes.uv,mesh.geometry.index]);});
    adapter.applyGeometry(gltf,{id:first.assetId},first.sourceLod);
    for(const [mesh,values]of before){assert.deepEqual([mesh.geometry,mesh.material,mesh.geometry.attributes.position,mesh.geometry.attributes.normal,mesh.geometry.attributes.uv,mesh.geometry.index],values);assert.equal(!!mesh.geometry.attributes.bf2SourceTangent,published.records.some(r=>r.assetId===rows[0].assetId&&r.sourceLod===rows[0].sourceLod&&r.primitiveIndex===gltf.parser.associations.get(mesh)?.primitives));}
  }
  const groups=new Set(doc.records.map(r=>`${r.assetId}/${r.sourceLod}`));
  assert.equal(adapter.geometries,published.records.filter(r=>groups.has(`${r.assetId}/${r.sourceLod}`)).length);
  for(const row of doc.records){
    const raw=read(directory+row.vertexFile);assert.equal(sha(raw),row.vertexSha256);assert.equal(sha(read(directory+row.indexFile)),row.indexSha256);assert.equal(row.sourceVertexStride,32);
    for(let i=0;i<row.vertexCount;i++)for(let lane=0;lane<4;lane++)assert.equal(payload.readFloatLE(row.tangentOffset+i*16+lane*4),DataUtils.fromHalfFloat(raw.readUInt16LE(i*32+(lane===3?6:16+lane*2))));
  }
});

test('metallic emissive sampled source frames agree with both unchanged original VS WARP executions',()=>{
  const execution=json(directory+'warp-execution.json'),fixture=evidence.inputFixture,input=read(directory+'vertex-input.bin');
  assert.equal(sha(input),fixture.sha256);assert.equal(fixture.vertices,844);assert.equal(new Set(fixture.samples.map(s=>s.recordIndex)).size,13);
  const source=doc.records.map(r=>read(directory+r.vertexFile));let comparisons=0,maxError=0;
  for(const report of execution.reports){
    const output=read(directory+report.shader+'.warp.bin');assert.equal(sha(output),report.outputSha256);assert.equal(sha(input),report.inputSha256);
    for(let c=0;c<12;c++)for(let i=0;i<fixture.samples.length;i++){
      const s=fixture.samples[i],r=doc.records[s.recordIndex],b=source[s.recordIndex],at=s.sourceVertex*32;
      const normal=[0,1,2].map(n=>DataUtils.fromHalfFloat(b.readUInt16LE(at+8+n*2))),tangent=[0,1,2,3].map(n=>payload.readFloatLE(r.tangentOffset+s.sourceVertex*16+n*4));
      const frame=sourceVertexFrame(normal,tangent,fixture.cases[c].matrix),offset=(c*fixture.vertices+i)*64;
      for(let axis=0;axis<3;axis++)for(const [expected,actual]of [[frame.N[axis],output.readFloatLE(offset+axis*4)],...['T','B','N'].map((key,col)=>[frame[key][axis],output.readFloatLE(offset+16+axis*16+col*4)])]){
        const error=Math.abs(expected-actual);assert.ok(Number.isFinite(actual)&&error<5e-7);maxError=Math.max(error,maxError);comparisons++;
      }
    }
  }
  assert.equal(comparisons,243072);console.log(JSON.stringify({metallicTangentComparisons:comparisons,maxError}));
});

test('metallic native frames retain source emission across all doorframe LODs and isolate unsupported48-byte explicit-binormal geometry',async()=>{
  const published=json('web/public/assets/native-tangent-witness.json'),raw=read('web/public'+published.url);
  const adapter=createSourceTangentWitness(published,buffer(raw)),loader=new GLTFLoader();
  loader.register(()=>({name:'metallic-frame-runtime-image-stub',loadTexture:async()=>new Texture()}));
  const rows=doc.records.filter(r=>r.assetId==='1e37d5f3-c8a5-578f-edb9-999e0479c1a3').sort((a,b)=>a.sourceLod-b.sourceLod),meshes=[];
  assert.deepEqual(rows.map(r=>r.sourceLod),[0,1,2]);
  for(const row of rows){
    const gltf=await loader.parseAsync(buffer(read(row.glbPath)),'');adapter.applyGeometry(gltf,{id:row.assetId},row.sourceLod);
    gltf.scene.traverse(m=>{if(m.isMesh&&gltf.parser.associations.get(m)?.primitives===row.primitiveIndex)meshes.push(m);});
  }
  const excluded=evidence.excluded.find(r=>r.sourceStride===48),unsupportedScene=await loader.parseAsync(buffer(read(excluded.glbPath)),'');
  adapter.applyGeometry(unsupportedScene,{id:excluded.assetId},0);let unsupported;
  unsupportedScene.scene.traverse(m=>{if(m.isMesh&&m.material.userData.sourceMaterialId===excluded.sourceMaterialId)unsupported=m;});
  assert.ok(unsupported&&!unsupported.geometry.attributes.bf2SourceTangent);
  const originalLoad=THREE.TextureLoader.prototype.loadAsync;THREE.TextureLoader.prototype.loadAsync=async()=>new Texture();
  let probes;const dfgTexture=new THREE.DataTexture(new Uint16Array(128*128*4),128,128,THREE.RGBAFormat,THREE.HalfFloatType);
  try{
    const recovered=await prepareRecoveredMaster1UvEmissiveMaterials(json('web/public/assets/recovered-master1uv-emissive-materials.json'));
    const scene=new THREE.Scene(),mesh=meshes[0],originalNormal=mesh.geometry.attributes.normal;scene.add(mesh);
    recovered.apply({scene},{id:rows[0].assetId});
    // Share one real source material across a supported and a real unsupported
    // source geometry to isolate the cache permutation from material identity.
    unsupported.material=mesh.material;scene.add(unsupported);
    probes=createSourceProbeLighting(json('web/public/assets/source-probes.json'),buffer(read('web/public/assets/source-probes.bin')),{dfg:{texture:dfgTexture,snapshot:()=>({evidenceId:'BF2-NATIVE-FG-WARP-001'})}});
    probes.add(scene);const originalMaterial=mesh.material,geometries=meshes.map(m=>m.geometry);
    assert.notEqual(mesh.material,unsupported.material);assert.equal(mesh.material.userData.sourceTangentFrame.enabled,true);assert.equal(unsupported.material.userData.sourceTangentFrame.enabled,false);
    const lods=createSourceLodController([{mesh,assetId:rows[0].assetId,levels:meshes.slice(1).map((m,i)=>({level:i+1,distance:(i+1)*10,geometry:m.geometry}))}],{
      adaptGeometry:(m,g)=>probes.adaptGeometry(m,g),adaptMaterial:(m,g)=>probes.adaptMaterial(m,g)});
    for(const [distance,index]of [[0,0],[15,1],[50,2],[0,0]]){
      lods.update(new THREE.Vector3(distance,0,0));assert.equal(mesh.geometry.attributes.position,geometries[index].attributes.position);assert.equal(mesh.geometry.index,geometries[index].index);assert.equal(mesh.geometry.userData.sourceTangentWitness.sourceLod,index);assert.equal(mesh.material,originalMaterial);
      const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};mesh.material.onBeforeCompile(shader,{});
      assert.match(shader.vertexShader,/#define BF2_SOURCE_TANGENT_FRAME 1/);assert.match(shader.vertexShader,/bf2_sourceT, bf2_sourceB, bf2_master1uv_emissive_geometricNormal/);
      assert.ok(!shader.fragmentShader.includes('normalize(bf2_master1uv_emissive_geometricNormal)'));assert.ok(!shader.fragmentShader.includes('bf2_master1uv_emissive_tbn(-vViewPosition'));
      assert.match(shader.fragmentShader,/totalEmissiveRadiance = vec3\(0.0\)/);assert.match(shader.fragmentShader,/bf2_master1uv_emissive_surface.emissive/);
      assert.equal(shader.uniforms.bf2_master1uv_emissive_cb.value.length,12);assert.equal(probes.snapshot().sourceTangents.mismatches,0);
    }
    const fallback={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};unsupported.material.onBeforeCompile(fallback,{});
    assert.ok(!fallback.vertexShader.includes('BF2_SOURCE_TANGENT_FRAME'));assert.match(fallback.fragmentShader,/bf2_master1uv_emissive_tbn\(-vViewPosition/);
    assert.equal(mesh.geometry.attributes.normal,originalNormal);assert.equal(probes.snapshot().sourceTangents.nativeInstances,1);
  }finally{THREE.TextureLoader.prototype.loadAsync=originalLoad;probes?.dispose();dfgTexture.dispose();}
});
