import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {DataUtils,Texture} from 'three';
import {createSourceTangentWitness,sourceVertexFrame} from '../src/source-tangent-frame.js';

const root=new URL('../../',import.meta.url),directory='exports/materials/native-tangent-coverage/';
const read=p=>fs.readFileSync(new URL(p,root)),json=p=>JSON.parse(read(p));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),buffer=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
const evidence=json(directory+'evidence.json'),document=json(directory+'native-tangent-witness.json'),payload=read(directory+'native-tangent-witness.bin');

test('expanded source frames retain exact rigid input declarations, source signs and all nineteen section identities',()=>{
  assert.equal(document.records.length,19);assert.equal(payload.byteLength,425936);assert.equal(sha(payload),document.sha256);
  assert.deepEqual(evidence.stats.sectionsByLod,{'0':13,'1':3,'2':3});assert.equal(evidence.stats.baseSectionInstances,801);
  const extraction=json(directory+'manifest.json'),known=new Map(extraction.records.map(r=>[`${r.assetId}/${r.sourceLod}/${r.sourceMaterialId}`,r]));
  assert.equal(sha(read(directory+'manifest.json')),evidence.extractionSha256);
  assert.equal(sha(read(directory+'selection.json')),evidence.selectionSha256);
  assert.equal(sha(read(evidence.baseEvidencePath)),evidence.baseEvidenceSha256);
  for(const row of document.records){
    const source=known.get(`${row.assetId}/${row.sourceLod}/${row.sourceMaterialId}`),bytes=read(directory+row.vertexFile);
    assert.equal(source.rigidSource,true);assert.equal(source.exactPreparedLayout,true);
    assert.equal(sha(bytes),row.vertexSha256);assert.equal(sha(read(directory+row.indexFile)),row.indexSha256);
    assert.deepEqual(row.fields.map(f=>[f.format,f.declaredOffset,f.traversedOffset,f.stream,f.stride]),[
      ['Half3',0,0,0,36],['Half',6,6,0,36],['Half4',8,8,0,36],['Half4',16,16,0,36],
      ['Half2',24,24,0,36],['Half2',28,28,0,36],['Half2',32,32,0,36]]);
    for(let i=0;i<row.vertexCount;i++)for(let lane=0;lane<4;lane++){
      const source=DataUtils.fromHalfFloat(bytes.readUInt16LE(i*36+(lane===3?6:16+lane*2)));
      assert.equal(payload.readFloatLE(row.tangentOffset+i*16+lane*4),source);
    }
    if(row.sourceLod){assert.equal(row.lodSourceMaterial.materialParametersEqualLod0,true);assert.ok(row.lodSourceMaterial.sharedParameterRoot);}
  }
  assert.equal(evidence.nativeRejected.length,9);assert.equal(evidence.excluded.length,126);
  for(const rejected of evidence.nativeRejected)assert.ok(!document.records.some(r=>r.assetId===rejected.assetId&&r.sourceLod===rejected.sourceLod&&r.sourceMaterialId===rejected.sourceMaterialId));
  const published=json('web/public/assets/native-tangent-witness.json');
  const publishedPayload=read('web/public'+published.url),part=published.sourceCoverage.find(p=>p.evidenceId===evidence.evidenceId);
  assert.equal(sha(publishedPayload),published.sha256);assert.deepEqual(publishedPayload.subarray(part.byteOffset,part.byteOffset+part.byteLength),payload);
  assert.equal(part.documentSha256,sha(read(directory+'native-tangent-witness.json')));assert.equal(part.evidenceSha256,sha(read(directory+'evidence.json')));
  assert.equal(published.publication.preparedSections,273);assert.equal(published.publication.baseSectionInstances,5558);
  const publishedRecords=published.records.filter(r=>r.sourceCoverageEvidenceId===evidence.evidenceId);assert.equal(publishedRecords.length,19);
  for(let i=0;i<document.records.length;i++)for(const [key,value]of Object.entries(document.records[i]))assert.deepEqual(publishedRecords[i][key],key==='tangentOffset'?value+part.byteOffset:value);
  const base=new Set(document.records.filter(r=>r.sourceLod===0).map(r=>`${r.assetId}/${r.sourceMaterialId}`));
  const lower=json('web/public/assets/source-lods.json').assets.flatMap(a=>a.lods.flatMap(l=>l.sections
    .filter(s=>base.has(`${a.assetId}/${s.lod0MaterialId}`)).map(s=>`${a.assetId}/${l.level}/${s.sourceMaterialId}`)));
  assert.equal(lower.length,6);assert.deepEqual(new Set(lower),new Set(document.records.filter(r=>r.sourceLod>0).map(r=>`${r.assetId}/${r.sourceLod}/${r.sourceMaterialId}`)));
});

test('expanded real GLTF base/native-LOD associations attach only exact source frames without replacing other geometry',async()=>{
  const published=json('web/public/assets/native-tangent-witness.json');
  const adapter=createSourceTangentWitness(published,buffer(read('web/public'+published.url))),loader=new GLTFLoader(),groups=Map.groupBy(document.records,r=>`${r.assetId}/${r.sourceLod}`);
  assert.ok(adapter.provenance.coverageEvidenceIds.includes(evidence.evidenceId));
  // This CPU fixture checks the actual mesh/accessor/material associations;
  // decoding unrelated embedded image pixels requires a browser DOM.
  loader.register(()=>({name:'source-tangent-test-images',loadTexture:async()=>new Texture()}));
  for(const records of groups.values()){
    const row=records[0],bytes=read(row.glbPath);assert.equal(sha(bytes),row.glbSha256);
    const gltf=await loader.parseAsync(buffer(bytes),'');const before=new Map();
    gltf.scene.traverse(mesh=>{if(mesh.isMesh)before.set(mesh,[mesh.geometry,mesh.material,mesh.geometry.attributes.position,mesh.geometry.attributes.normal,mesh.geometry.attributes.uv,mesh.geometry.index]);});
    adapter.applyGeometry(gltf,{id:row.assetId},row.sourceLod);adapter.applyGeometry(gltf,{id:row.assetId},row.sourceLod);
    for(const [mesh,original]of before){
      assert.deepEqual([mesh.geometry,mesh.material,mesh.geometry.attributes.position,mesh.geometry.attributes.normal,mesh.geometry.attributes.uv,mesh.geometry.index],original);
      const selected=published.records.find(r=>r.assetId===row.assetId&&r.sourceLod===row.sourceLod&&r.primitiveIndex===gltf.parser.associations.get(mesh)?.primitives);
      assert.equal(!!mesh.geometry.attributes.bf2SourceTangent,!!selected);
      if(selected){assert.equal(mesh.geometry.attributes.bf2SourceTangent.count,selected.vertexCount);assert.equal(mesh.geometry.userData.sourceTangentWitness.sourceLod,row.sourceLod);}
    }
  }
  assert.equal(adapter.geometries,published.records.filter(r=>groups.has(`${r.assetId}/${r.sourceLod}`)).length);
});

test('all expanded sections match four unchanged original ordinary/atlas VS executions on CPU WARP',()=>{
  const execution=json(directory+'warp-execution.json'),input=read(directory+'vertex-input.bin'),fixture=evidence.inputFixture;
  assert.equal(sha(input),fixture.sha256);assert.equal(fixture.vertices,1225);assert.equal(new Set(fixture.samples.map(s=>s.recordIndex)).size,19);
  const vertices=fixture.samples.map(sample=>{
    const row=document.records[sample.recordIndex],source=read(directory+row.vertexFile),at=sample.sourceVertex*36;
    return {normal:[0,1,2].map(n=>DataUtils.fromHalfFloat(source.readUInt16LE(at+8+n*2))),
      tangent:[0,1,2,3].map(n=>payload.readFloatLE(row.tangentOffset+sample.sourceVertex*16+n*4))};
  });
  const outputs=[];let comparisons=0,maxError=0;
  for(const report of execution.reports){
    const bytes=read(directory+report.shader+'.warp.bin');outputs.push(bytes);
    assert.equal(sha(bytes),report.outputSha256);assert.equal(sha(input),report.inputSha256);
    assert.equal(sha(read(`exports/materials/${report.family}-shader/${report.shader}.dxbc`)),report.shaderSha256);
    assert.equal(report.vertices,fixture.vertices);assert.equal(report.cases,12);
    for(let c=0;c<report.cases;c++)for(let i=0;i<vertices.length;i++){
      const v=vertices[i],frame=sourceVertexFrame(v.normal,v.tangent,fixture.cases[c].matrix),at=(c*vertices.length+i)*64;
      for(let axis=0;axis<3;axis++){
        const values=[[frame.N[axis],bytes.readFloatLE(at+axis*4)],...['T','B','N'].map((key,column)=>[frame[key][axis],bytes.readFloatLE(at+16+axis*16+column*4)])];
        for(const [expected,actual]of values){assert.ok(Number.isFinite(actual));const error=Math.abs(actual-expected);maxError=Math.max(error,maxError);assert.ok(error<5e-7,`${report.shader}/${c}/${i}: ${error}`);comparisons++;}
      }
    }
  }
  assert.equal(comparisons,705600);
  for(let i=0;i<outputs[0].length/4;i++)if(i%4!==3)for(let s=1;s<outputs.length;s++)assert.equal(outputs[s].readFloatLE(i*4),outputs[0].readFloatLE(i*4));
  console.log(JSON.stringify({expandedSourceTangentComparisons:comparisons,maxError,sections:19,vertices:1225}));
});
