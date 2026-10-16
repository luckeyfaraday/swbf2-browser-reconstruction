import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createSourceTangentWitness,prepareSourceTangentWitness,sourceVertexFrame,sourceMappedNormal} from '../src/source-tangent-frame.js';
const root=new URL('../../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root)),json=p=>JSON.parse(read(p));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),buffer=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
const directory='exports/materials/native-tangent-witness/',evidence=json(directory+'evidence.json'),doc=json(directory+'document.json');

test('source wall raw Half streams match the exact original RVM input layout for both material families',()=>{
  assert.equal(doc.records.length,2);assert.deepEqual(doc.records.map(r=>r.family),['master1uv','master2uv']);
  const raw=read('exports/materials/rvm/0.res');assert.equal(sha(raw),evidence.sourceRvmSha256);
  assert.deepEqual(doc.records[0].signCounts,{'-1':4,'1':156});
  for(const shader of evidence.shaders){
    assert.equal(sha(read(`exports/materials/${shader.family}-shader/${shader.vertex}.dxbc`)),shader.vertexSha256);
    assert.equal(sha(raw.subarray(shader.inputLayoutOffset,shader.inputLayoutOffset+160)),shader.inputLayoutSha256);
    assert.deepEqual(shader.inputLayout.map(x=>[x.dxgiFormat,x.offset]),[[10,0],[10,8],[10,16],[10,24],[34,32]]);
  }
  const payload=read(directory+'tangent-output.bin');assert.equal(sha(payload),doc.sha256);assert.equal(payload.length,7936);
  for(const row of doc.records){
    for(const f of row.fields){assert.equal(f.declaredOffset,f.traversedOffset);assert.equal(f.stride,36);assert.equal(sha(read(directory+f.rawFile)),f.rawSha256);}
    const tangent=read(directory+row.fields.find(f=>f.usage==='Tangent').floatFile),sign=read(directory+row.fields.find(f=>f.usage==='BinormalSign').floatFile);
    for(let i=0;i<row.vertexCount;i++){
      assert.deepEqual(payload.subarray(row.tangentOffset+i*16,row.tangentOffset+i*16+12),tangent.subarray(i*16,i*16+12));
      assert.deepEqual(payload.subarray(row.tangentOffset+i*16+12,row.tangentOffset+i*16+16),sign.subarray(i*4,i*4+4));
    }
  }
  assert.match(evidence.records.find(r=>!('tangentOffset'in r)).status,/unresolved native stream conversion/);
});

test('compact frame equations match unchanged ordinary and atlas VS WARP outputs for all496vertices and12transforms',()=>{
  const execution=json(directory+'warp-execution.json'),input=read(directory+'vertex-input.bin');
  assert.equal(execution.backend,'D3D11 WARP CPU stream output');assert.equal(execution.reports.length,4);
  const tangents=read(directory+'tangent-output.bin'),vertices=[];
  for(const row of doc.records){
    const normals=read(directory+row.fields.find(f=>f.usage==='Normal').floatFile);
    for(let index=0;index<row.vertexCount;index++)vertices.push({normal:[0,1,2].map(n=>normals.readFloatLE(index*16+n*4)),
      tangent:[0,1,2,3].map(n=>tangents.readFloatLE(row.tangentOffset+index*16+n*4))});
  }
  let maxError=0,comparisons=0,wrongSignDetected=0;const outputs=[];
  for(const report of execution.reports){
    const bytes=read(directory+report.shader+'.warp.bin');assert.equal(sha(bytes),report.outputSha256);assert.equal(sha(input),report.inputSha256);
    assert.equal(report.vertices,496);assert.equal(report.cases,12);outputs.push(bytes);
    for(let c=0;c<report.cases;c++)for(let i=0;i<report.vertices;i++){
      const {normal,tangent}=vertices[i];
      const frame=sourceVertexFrame(normal,tangent,evidence.inputFixture.cases[c].matrix),at=(c*report.vertices+i)*64;
      for(let axis=0;axis<3;axis++){
        const values=[[frame.N[axis],bytes.readFloatLE(at+axis*4)],...['T','B','N'].map((key,column)=>[frame[key][axis],bytes.readFloatLE(at+16+axis*16+column*4)])];
        for(const [expected,actual]of values){assert.ok(Number.isFinite(actual));const error=Math.abs(actual-expected);maxError=Math.max(error,maxError);assert.ok(error<5e-7,`${report.shader}/${c}/${i}: ${error}`);comparisons++;}
        if(Math.abs(frame.T[axis]+bytes.readFloatLE(at+16+axis*16))>.5)wrongSignDetected++;
      }
    }
  }
  assert.equal(comparisons,4*12*496*12);assert.ok(wrongSignDetected>10000);
  // Ignore UV/unused W lanes; normal and frame XYZ are identical across all4VS.
  for(let i=0;i<outputs[0].length/4;i++)if(i%4!==3)for(let s=1;s<outputs.length;s++)assert.equal(outputs[s].readFloatLE(i*4),outputs[0].readFloatLE(i*4));
  console.log(JSON.stringify({nativeTangentComparisons:comparisons,maxError,wrongSignDetected}));
});

test('fragment frame preserves interpolated column lengths and handedness before final normalization',()=>{
  const frame={T:[.3,.1,0],B:[0,.8,.2],N:[.1,0,.7]},sample=[.6,.4,.7];
  const result=sourceMappedNormal(frame,sample),raw=[.25,.38,.57],length=Math.hypot(...raw);
  result.forEach((v,i)=>assert.ok(Math.abs(v-raw[i]/length)<1e-14));
  const normalize=v=>v.map(x=>x/Math.hypot(...v));assert.notDeepEqual(result,sourceMappedNormal(Object.fromEntries(Object.entries(frame).map(([k,v])=>[k,normalize(v)])),sample));
  const positive=sourceVertexFrame([0,0,1],[1,0,0,1],[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
  const negative=sourceVertexFrame([0,0,1],[1,0,0,-1],[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
  positive.B.forEach((v,i)=>assert.equal(v,-negative.B[i]));
});

test('actual GLTF associations attach only source tangent data and reject altered source normals or topology',async()=>{
  const adapter=createSourceTangentWitness(doc,buffer(read(directory+'tangent-output.bin'))),loader=new GLTFLoader();
  const raw=read(doc.records[0].glbPath);assert.equal(sha(raw),doc.records[0].glbSha256);const gltf=await loader.parseAsync(buffer(raw),'');
  const before=new Map();gltf.scene.traverse(m=>{if(m.isMesh)before.set(m,[m.geometry,m.geometry.attributes.position,m.geometry.attributes.normal,m.geometry.attributes.uv,m.geometry.index,m.material]);});
  adapter.applyGeometry(gltf,{id:doc.records[0].assetId},1);assert.equal(adapter.geometries,0);
  adapter.applyGeometry(gltf,{id:doc.records[0].assetId});adapter.applyGeometry(gltf,{id:doc.records[0].assetId});assert.equal(adapter.geometries,2);
  for(const [m,values]of before){assert.deepEqual([m.geometry,m.geometry.attributes.position,m.geometry.attributes.normal,m.geometry.attributes.uv,m.geometry.index,m.material],values);assert.equal(m.geometry.attributes.bf2SourceTangent.itemSize,4);}
  const mesh=before.keys().next().value,normal=mesh.geometry.attributes.normal.array;normal[0]+=.01;
  assert.throws(()=>adapter.applyGeometry(gltf,{id:doc.records[0].assetId}),/correspondence mismatch/);
});

test('fetched tangent data rejects finite same-size corruption by source SHA256',async()=>{
  const original=buffer(read(directory+'tangent-output.bin'));
  const valid=await prepareSourceTangentWitness(doc,{fetch:async()=>({ok:true,arrayBuffer:async()=>original})});assert.equal(valid.provenance.sha256,doc.sha256);
  const altered=original.slice(0);new Float32Array(altered)[0]+=.125;
  await assert.rejects(prepareSourceTangentWitness(doc,{fetch:async()=>({ok:true,arrayBuffer:async()=>altered})}),/SHA-256 mismatch/);
});
