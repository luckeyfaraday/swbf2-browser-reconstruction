import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {DataUtils,Texture} from 'three';
import {createSourceTangentWitness,sourceVertexFrame} from '../src/source-tangent-frame.js';

const root=new URL('../../',import.meta.url),directory='exports/materials/native-tangent32/';
const read=p=>fs.readFileSync(new URL(p,root)),json=p=>JSON.parse(read(p));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),buffer=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
const routing=json(directory+'shader-routing.json'),evidence=json(directory+'evidence.json'),doc=json(directory+'native-tangent-witness.json'),payload=read(directory+'native-tangent-witness.bin');

test('native32-byte input layout is directly paired with the recovered ordinary and atlas Master1UV pixel shaders',()=>{
  const index=json('exports/materials/rvm/block-index.json').blocks,raw=read('exports/materials/rvm/0.res');
  assert.equal(sha(raw),routing.sourceRvmSha256);assert.equal(sha(read(directory+'shader-routing.json')),evidence.shaderRoutingSha256);
  const block=key=>raw.subarray(index[key].offset,index[key].offset+index[key].size);
  assert.deepEqual(routing.shaders.map(s=>[s.vertex,s.pixel,s.parameterBlock]),[
    ['282854795b','6d0dd89b35','5801d6e1eb'],['69a5d07239','965fbe264b','fcb3b64cb2']]);
  for(const shader of routing.shaders){
    assert.equal(sha(read(`exports/materials/master1uv-shader/${shader.vertex}.dxbc`)),shader.vertexSha256);
    assert.equal(shader.inputLayoutBlock,'ad2dd1141c');assert.equal(sha(block(shader.inputLayoutBlock)),shader.inputLayoutSha256);
    assert.deepEqual(shader.inputLayout.map(x=>[x.index,x.dxgiFormat,x.offset,x.inputSlot,x.classification,x.step]),[
      [0,10,0,0,0,0],[1,10,8,0,0,0],[2,10,16,0,0,0],[3,10,24,0,0,0]]);
    for(const path of Object.values(shader.paths))for(const edge of path){
      const encoded=block(edge.from).readBigUInt64LE(edge.offset);assert.equal(encoded,BigInt(edge.encoded));
      assert.equal((encoded&0xffffffffffn).toString(16).padStart(10,'0'),edge.to);
    }
  }
});

test('all75 exact source32-byte candidates preserve GLTF geometry/material identity and independently stored BinormalSign',async()=>{
  assert.equal(doc.records.length,75);assert.equal(payload.byteLength,1800288);assert.equal(sha(payload),doc.sha256);
  assert.deepEqual(evidence.stats.sectionsByLod,{'0':62,'1':7,'2':6});assert.equal(evidence.stats.baseSectionInstances,1270);
  const extraction=json(directory+'manifest.json');assert.equal(sha(read(directory+'manifest.json')),evidence.extractionSha256);
  assert.equal(extraction.records.filter(r=>r.exactPreparedLayout&&r.rigidSource).length,75);
  const published=json('web/public/assets/native-tangent-witness.json'),publishedPayload=read('web/public'+published.url);
  const part=published.sourceCoverage.find(p=>p.evidenceId===evidence.evidenceId);
  assert.equal(sha(publishedPayload),published.sha256);assert.deepEqual(publishedPayload.subarray(part.byteOffset,part.byteOffset+part.byteLength),payload);
  assert.equal(part.documentSha256,sha(read(directory+'native-tangent-witness.json')));assert.equal(part.evidenceSha256,sha(read(directory+'evidence.json')));
  const publishedRecords=published.records.filter(r=>r.sourceCoverageEvidenceId===evidence.evidenceId);assert.equal(publishedRecords.length,75);
  for(let i=0;i<doc.records.length;i++)for(const [key,value]of Object.entries(doc.records[i]))assert.deepEqual(publishedRecords[i][key],key==='tangentOffset'?value+part.byteOffset:value);
  const loader=new GLTFLoader(),adapter=createSourceTangentWitness(published,buffer(publishedPayload));
  assert.ok(adapter.provenance.coverageEvidenceIds.includes(evidence.evidenceId));
  loader.register(()=>({name:'source-tangent32-test-images',loadTexture:async()=>new Texture()}));
  for(const rows of Map.groupBy(doc.records,r=>`${r.assetId}/${r.sourceLod}`).values()){
    const row=rows[0],raw=read(row.glbPath);assert.equal(sha(raw),row.glbSha256);
    const gltf=await loader.parseAsync(buffer(raw),''),before=new Map();
    gltf.scene.traverse(mesh=>{if(mesh.isMesh)before.set(mesh,[mesh.geometry,mesh.material,mesh.geometry.attributes.position,mesh.geometry.attributes.normal,mesh.geometry.attributes.uv,mesh.geometry.index]);});
    adapter.applyGeometry(gltf,{id:row.assetId},row.sourceLod);adapter.applyGeometry(gltf,{id:row.assetId},row.sourceLod);
    for(const [mesh,original]of before){
      assert.deepEqual([mesh.geometry,mesh.material,mesh.geometry.attributes.position,mesh.geometry.attributes.normal,mesh.geometry.attributes.uv,mesh.geometry.index],original);
      assert.equal(!!mesh.geometry.attributes.bf2SourceTangent,published.records.some(r=>r.assetId===rows[0].assetId&&r.sourceLod===rows[0].sourceLod&&r.primitiveIndex===gltf.parser.associations.get(mesh)?.primitives));
    }
  }
  const groups=new Set(doc.records.map(r=>`${r.assetId}/${r.sourceLod}`));
  assert.equal(adapter.geometries,published.records.filter(r=>groups.has(`${r.assetId}/${r.sourceLod}`)).length);
  for(const row of doc.records){
    const raw=read(directory+row.vertexFile);assert.equal(sha(raw),row.vertexSha256);assert.equal(sha(read(directory+row.indexFile)),row.indexSha256);
    assert.equal(row.sourceInputLayout,'ad2dd1141c');assert.equal(row.sourceVertexStride,32);
    assert.deepEqual(row.fields.map(f=>[f.format,f.declaredOffset,f.traversedOffset,f.stream,f.stride]),[
      ['Half3',0,0,0,32],['Half',6,6,0,32],['Half4',8,8,0,32],['Half4',16,16,0,32],['Half2',24,24,0,32],['Half2',28,28,0,32]]);
    for(let i=0;i<row.vertexCount;i++)for(let lane=0;lane<4;lane++)assert.equal(payload.readFloatLE(row.tangentOffset+i*16+lane*4),DataUtils.fromHalfFloat(raw.readUInt16LE(i*32+(lane===3?6:16+lane*2))));
  }
});

test('original32-byte VS WARP outputs match the frame helper and preserve distinct UV/radiosity input routing',()=>{
  const execution=json(directory+'warp-execution.json'),input=read(directory+'vertex-input.bin'),fixture=evidence.inputFixture;
  assert.equal(sha(input),fixture.sha256);assert.equal(fixture.vertices,4575);assert.equal(fixture.stride,32);
  assert.equal(new Set(fixture.samples.map(s=>s.recordIndex)).size,75);
  const rawCache=new Map(doc.records.map(r=>[r.vertexFile,read(directory+r.vertexFile)]));
  const vertices=fixture.samples.map(sample=>{
    const row=doc.records[sample.recordIndex],raw=rawCache.get(row.vertexFile),at=sample.sourceVertex*32;
    return {normal:[0,1,2].map(n=>DataUtils.fromHalfFloat(raw.readUInt16LE(at+8+n*2))),
      tangent:[0,1,2,3].map(n=>payload.readFloatLE(row.tangentOffset+sample.sourceVertex*16+n*4)),
      uvY:DataUtils.fromHalfFloat(raw.readUInt16LE(at+26)),radiosityY:DataUtils.fromHalfFloat(raw.readUInt16LE(at+30))};
  });
  let comparisons=0,maxError=0,uvComparisons=0;const outputs=[];
  for(const report of execution.reports){
    const bytes=read(directory+report.shader+'.warp.bin');outputs.push(bytes);
    assert.equal(sha(bytes),report.outputSha256);assert.equal(sha(input),report.inputSha256);
    assert.equal(sha(read(`exports/materials/${report.family}-shader/${report.shader}.dxbc`)),report.shaderSha256);
    assert.equal(report.vertices,fixture.vertices);assert.equal(report.cases,12);
    for(let c=0;c<report.cases;c++)for(let i=0;i<vertices.length;i++){
      const v=vertices[i],frame=sourceVertexFrame(v.normal,v.tangent,fixture.cases[c].matrix),at=(c*vertices.length+i)*64;
      assert.equal(bytes.readFloatLE(at+12),report.atlas?v.radiosityY:v.uvY);uvComparisons++;
      for(let axis=0;axis<3;axis++){
        const values=[[frame.N[axis],bytes.readFloatLE(at+axis*4)],...['T','B','N'].map((key,column)=>[frame[key][axis],bytes.readFloatLE(at+16+axis*16+column*4)])];
        for(const [expected,actual]of values){assert.ok(Number.isFinite(actual));const error=Math.abs(actual-expected);maxError=Math.max(error,maxError);assert.ok(error<5e-7,`${report.shader}/${c}/${i}: ${error}`);comparisons++;}
      }
    }
  }
  assert.equal(comparisons,1317600);assert.equal(uvComparisons,109800);
  for(let i=0;i<outputs[0].length/4;i++)if(i%4!==3)assert.equal(outputs[0].readFloatLE(i*4),outputs[1].readFloatLE(i*4));
  console.log(JSON.stringify({nativeTangent32Comparisons:comparisons,maxError,uvComparisons,sections:75,vertices:4575}));
});
