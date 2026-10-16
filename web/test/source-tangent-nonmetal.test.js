import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createSourceTangentWitness,sourceVertexFrame} from '../src/source-tangent-frame.js';
import {prepareRecoveredMaster1UvEmissiveNonmetalMaterials} from '../src/master1uv-emissive-nonmetal-material.js';
import {createSourceProbeLighting} from '../src/source-probes.js';
import {createSourceLodController} from '../src/source-lods.js';

const root=new URL('../../',import.meta.url),directory='exports/materials/native-tangent-nonmetal/';
const read=p=>fs.readFileSync(new URL(p,root)),json=p=>JSON.parse(read(p));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),buffer=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
const evidence=json(directory+'evidence.json'),routing=json(directory+'shader-routing.json'),doc=json(directory+'native-tangent-witness.json');
const payload=read(directory+'native-tangent-witness.bin'),published=json('web/public/assets/native-tangent-witness.json');

test('nonmetal original parameter routes and every source tangent/sign lane prove both wall LODs',()=>{
  assert.equal(doc.records.length,2);assert.deepEqual(doc.records.map(r=>r.vertexCount),[968,42]);
  assert.equal(payload.byteLength,16160);assert.equal(sha(payload),doc.sha256);assert.equal(evidence.stats.baseSectionInstances,202);
  const raw=read('exports/materials/rvm/0.res'),index=json('exports/materials/rvm/block-index.json').blocks;
  assert.equal(sha(raw),routing.sourceRvmSha256);assert.equal(sha(read(directory+'shader-routing.json')),evidence.shaderRoutingSha256);
  const block=key=>raw.subarray(index[key].offset,index[key].offset+index[key].size);
  assert.deepEqual(routing.shaders.map(s=>[s.vertex,s.pixel]),[['282854795b','17069bc692'],['69a5d07239','90de297532']]);
  for(const shader of routing.shaders){
    assert.equal(shader.inputLayoutBlock,'ad2dd1141c');assert.equal(sha(block(shader.inputLayoutBlock)),shader.inputLayoutSha256);
    assert.equal(sha(read(`exports/materials/master1uv-emissive-nonmetal-shader/${shader.vertex}.dxbc`)),shader.vertexSha256);
    assert.equal(sha(read(`exports/materials/master1uv-emissive-nonmetal-shader/${shader.pixel}.dxbc`)),shader.pixelSha256);
    for(const path of Object.values(shader.paths))for(const edge of path){const value=block(edge.from).readBigUInt64LE(edge.offset);assert.equal(value,BigInt(edge.encoded));assert.equal((value&0xffffffffffn).toString(16).padStart(10,'0'),edge.to);}
  }
  for(const row of doc.records){
    const bytes=read(directory+row.vertexFile);assert.equal(sha(bytes),row.vertexSha256);assert.equal(row.sourceVertexStride,32);
    for(let i=0;i<row.vertexCount;i++)for(let lane=0;lane<4;lane++)assert.equal(payload.readFloatLE(row.tangentOffset+i*16+lane*4),THREE.DataUtils.fromHalfFloat(bytes.readUInt16LE(i*32+(lane===3?6:16+lane*2))));
  }
  const ordinary=read('exports/materials/master1uv-emissive-nonmetal-shader/17069bc692.asm').toString();
  assert.ok(ordinary.includes('dp3 r2.x, r9.xyzx, v3.xyzx\r\ndp3 r2.y, r9.xyzx, v4.xyzx\r\ndp3 r2.z, r9.xyzx, v5.xyzx\r\ndp3 r2.w, r2.xyzx, r2.xyzx\r\nrsq r2.w, r2.w\r\nmul r2.xyz, r2.wwww, r2.xyzx'));
  const atlas=read('exports/materials/master1uv-emissive-nonmetal-shader/90de297532.asm').toString();
  assert.ok(atlas.includes('dp3 r3.x, r8.xyzx, v4.xyzx\r\ndp3 r3.y, r8.xyzx, v5.xyzx\r\ndp3 r3.z, r8.xyzx, v6.xyzx\r\ndp3 r2.x, r3.xyzx, r3.xyzx\r\nrsq r2.x, r2.x\r\nmul r3.xyz, r2.xxxx, r3.xyzx'));
});

test('nonmetal sampled original VS executions match exact frame equations before material-hook activation',()=>{
  const execution=json(directory+'warp-execution.json'),fixture=evidence.inputFixture,input=read(directory+'vertex-input.bin');
  assert.equal(sha(input),fixture.sha256);assert.equal(fixture.vertices,107);assert.equal(fixture.stride,32);
  const sources=doc.records.map(r=>read(directory+r.vertexFile));let count=0,maxError=0;
  for(const report of execution.reports){
    const output=read(directory+report.shader+'.warp.bin');assert.equal(sha(output),report.outputSha256);assert.equal(report.inputSha256,sha(input));
    for(let c=0;c<12;c++)for(let i=0;i<fixture.samples.length;i++){
      const sample=fixture.samples[i],row=doc.records[sample.recordIndex],raw=sources[sample.recordIndex],at=sample.sourceVertex*32;
      const normal=[0,1,2].map(n=>THREE.DataUtils.fromHalfFloat(raw.readUInt16LE(at+8+n*2)));
      const tangent=[0,1,2,3].map(n=>payload.readFloatLE(row.tangentOffset+sample.sourceVertex*16+n*4));
      const frame=sourceVertexFrame(normal,tangent,fixture.cases[c].matrix),offset=(c*fixture.vertices+i)*64;
      for(let axis=0;axis<3;axis++)for(const [expected,actual]of [[frame.N[axis],output.readFloatLE(offset+axis*4)],...['T','B','N'].map((key,column)=>[frame[key][axis],output.readFloatLE(offset+16+axis*16+column*4)])]){
        const error=Math.abs(actual-expected);assert.ok(Number.isFinite(actual)&&error<5e-7);maxError=Math.max(error,maxError);count++;
      }
    }
  }
  assert.equal(count,30816);console.log(JSON.stringify({nonmetalTangentComparisons:count,maxError}));
});

test('published nonmetal frames survive actual material/probe hooks and native LOD switches without changing emission',async()=>{
  const rawPublished=read('web/public'+published.url),part=published.sourceCoverage.find(p=>p.evidenceId===evidence.evidenceId);
  assert.deepEqual(rawPublished.subarray(part.byteOffset,part.byteOffset+part.byteLength),payload);
  assert.equal(part.documentSha256,sha(read(directory+'native-tangent-witness.json')));assert.equal(part.evidenceSha256,sha(read(directory+'evidence.json')));
  const loader=new GLTFLoader();loader.register(()=>({name:'nonmetal-source-image-stub',loadTexture:async()=>new THREE.Texture()}));
  const adapter=createSourceTangentWitness(published,buffer(rawPublished)),scenes=[];
  for(const row of doc.records){const bytes=read(row.glbPath);assert.equal(sha(bytes),row.glbSha256);const gltf=await loader.parseAsync(buffer(bytes),'');adapter.applyGeometry(gltf,{id:row.assetId},row.sourceLod);scenes.push(gltf);}
  assert.equal(adapter.geometries,2);
  const oldLoad=THREE.TextureLoader.prototype.loadAsync;THREE.TextureLoader.prototype.loadAsync=async()=>new THREE.Texture();
  let probes;const dfgTexture=new THREE.DataTexture(new Uint16Array(128*128*4),128,128,THREE.RGBAFormat,THREE.HalfFloatType);
  try{
    const material=await prepareRecoveredMaster1UvEmissiveNonmetalMaterials(json('web/public/assets/recovered-master1uv-emissive-nonmetal-materials.json'));
    material.apply(scenes[0],{id:doc.records[0].assetId});
    const find=g=>{let result;g.scene.traverse(m=>{if(m.isMesh&&g.parser.associations.get(m)?.primitives===0)result=m;});return result;};
    const mesh=find(scenes[0]),low=find(scenes[1]);const originalNormal=mesh.geometry.attributes.normal;
    probes=createSourceProbeLighting(json('web/public/assets/source-probes.json'),buffer(read('web/public/assets/source-probes.bin')),{dfg:{texture:dfgTexture,snapshot:()=>({evidenceId:'BF2-NATIVE-FG-WARP-001'})}});
    probes.add(scenes[0].scene);const originalMaterial=mesh.material;
    const lods=createSourceLodController([{mesh,assetId:doc.records[0].assetId,levels:[{level:1,distance:10,geometry:low.geometry}]}],{
      adaptGeometry:(m,g)=>probes.adaptGeometry(m,g),adaptMaterial:(m,g)=>probes.adaptMaterial(m,g)});
    for(const position of [new THREE.Vector3(),new THREE.Vector3(50,0,0),new THREE.Vector3()]){
      lods.update(position);assert.equal(mesh.material,originalMaterial);assert.equal(probes.snapshot().sourceTangents.mismatches,0);
      const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};mesh.material.onBeforeCompile(shader,{});
      assert.match(shader.vertexShader,/#define BF2_SOURCE_TANGENT_FRAME 1/);
      assert.match(shader.vertexShader,/bf2_sourceT, bf2_sourceB, bf2_master1uv_emissive_nonmetal_geometricNormal/);
      assert.ok(!shader.fragmentShader.includes('normalize(bf2_master1uv_emissive_nonmetal_geometricNormal)'));
      assert.ok(!shader.fragmentShader.includes('bf2_master1uv_emissive_nonmetal_tbn(-vViewPosition'));
      assert.match(shader.fragmentShader,/totalEmissiveRadiance = vec3\(0.0\)/);
      assert.match(shader.fragmentShader,/bf2_master1uv_emissive_nonmetal_surface.emissive/);
      assert.equal(shader.uniforms.bf2_master1uv_emissive_nonmetal_cb.value.length,13);
    }
    assert.equal(mesh.geometry.attributes.normal,originalNormal);assert.equal(probes.snapshot().sourceTangents.nativeInstances,1);
  }finally{THREE.TextureLoader.prototype.loadAsync=oldLoad;probes?.dispose();dfgTexture.dispose();}
});
