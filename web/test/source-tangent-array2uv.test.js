import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {sourceVertexFrame,sourceExplicitVertexFrame,createSourceTangentWitness,sourceTangentFrameKind} from '../src/source-tangent-frame.js';
import {createSourceProbeLighting} from '../src/source-probes.js';
import {createSourceLodController} from '../src/source-lods.js';
const root=new URL('../../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root)),json=p=>JSON.parse(read(p));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),buffer=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
const parts=[36].map(stride=>{const path=`exports/materials/native-tangent-array2uv${stride}/`,stem=stride===44?'native-tangent-explicit':'native-tangent-witness';return {stride,path,doc:json(path+stem+'.json'),payload:read(path+stem+'.bin'),evidence:json(path+'evidence.json'),routing:json(path+'shader-routing.json')};});

test('Array2UV original RVM pairs the exact ordinary/atlas PS with signed32/36 input layouts',()=>{
  const bytes=read('exports/materials/rvm/0.res'),index=json('exports/materials/rvm/block-index.json').blocks,block=k=>bytes.subarray(index[k].offset,index[k].offset+index[k].size);
  assert.deepEqual(parts.map(p=>[p.stride,p.doc.records.length,p.evidence.stats.baseSectionInstances]),[[36,10,132]]);
  for(const p of parts){
    assert.equal(sha(bytes),p.routing.sourceRvmSha256);assert.equal(sha(read(p.path+'shader-routing.json')),p.evidence.shaderRoutingSha256);
    assert.equal(sha(read(p.path+'selection.json')),p.evidence.selectionSha256);assert.equal(sha(read(p.path+'manifest.json')),p.evidence.extractionSha256);
    for(const [i,s]of p.routing.shaders.entries()){
      assert.equal(s.pixel,i?'b398fb7ed2':'52d055444c');assert.equal(sha(block(s.inputLayoutBlock)),s.inputLayoutSha256);
      assert.equal(sha(read(`exports/materials/array2uv-shader/${s.vertex}.dxbc`)),s.vertexSha256);assert.equal(sha(read(`exports/materials/array2uv-shader/${s.pixel}.dxbc`)),s.pixelSha256);
      assert.deepEqual(s.inputLayout.map(r=>[r.index,r.dxgiFormat,r.offset]),p.stride===44?[[0,6,0],[1,10,12],[2,10,20],[3,10,28],[4,10,36]]:p.stride===36?[[0,10,0],[1,10,8],[2,10,16],[3,10,24],[4,34,32]]:[[0,10,0],[1,10,8],[2,10,16],[3,10,24]]);
      for(const path of Object.values(s.paths))for(const edge of path){const n=block(edge.from).readBigUInt64LE(edge.offset);assert.equal(n,BigInt(edge.encoded));assert.equal((n&0xffffffffffn).toString(16).padStart(10,'0'),edge.to);}
      const asm=read(`exports/materials/array2uv-shader/${s.pixel}.asm`).toString(),input=i?3:2;
      for(let axis=0;axis<3;axis++)assert.match(asm,new RegExp(`dp3 r\\d+\\.${'xyz'[axis]}, r\\d+\\.(?:xyzx|xywx|xzwx), v${input+axis}\\.xyzx`));
      assert.match(asm,/dp3 r2\.x, r5\.xyzx, r5\.xyzx\r?\nrsq r2\.x, r2\.x/);
    }
  }
});

test('Array2UV10 original section/LOD records retain every source T/B/sign and match real GLTF attributes exactly',async()=>{
  const loader=new GLTFLoader();loader.register(()=>({name:'array2uv-frame-image-stub',loadTexture:async()=>new THREE.Texture()}));let count=0,vertices=0,baseInstances=0;
  for(const p of parts){
    assert.equal(sha(p.payload),p.doc.sha256);
    for(const row of p.doc.records){
      const bytes=read(p.path+row.vertexFile),indices=read(p.path+row.indexFile),glb=read(row.glbPath);
      assert.equal(sha(bytes),row.vertexSha256);assert.equal(sha(indices),row.indexSha256);assert.equal(sha(glb),row.glbSha256);
      const gltf=await loader.parseAsync(buffer(glb),'');let mesh;gltf.scene.traverse(m=>{if(m.isMesh&&gltf.parser.associations.get(m)?.primitives===row.primitiveIndex)mesh=m;});
      assert.equal(mesh.material.userData.sourceMaterialId,row.sourceMaterialId);assert.equal(sha(Buffer.from(mesh.geometry.index.array.buffer)),row.indexSha256);
      const position=p.stride===44?0:0,normal=p.stride===44?20:8,tangent=p.stride===44?28:16,uv=p.stride===44?36:24,itemSize=p.stride===44?3:4;
      for(let i=0;i<row.vertexCount;i++){
        for(let axis=0;axis<3;axis++){
          const half=at=>THREE.DataUtils.fromHalfFloat(bytes.readUInt16LE(i*p.stride+at));
          assert.equal(mesh.geometry.attributes.position.array[i*3+axis],p.stride===44?bytes.readFloatLE(i*p.stride+position+axis*4):half(axis*2));
          assert.equal(mesh.geometry.attributes.normal.array[i*3+axis],half(normal+axis*2));
          assert.equal(p.payload.readFloatLE(row.tangentOffset+(i*itemSize+axis)*4),half(tangent+axis*2));
          if(p.stride===44)assert.equal(p.payload.readFloatLE(row.binormalOffset+(i*3+axis)*4),half(12+axis*2));
        }
        if(itemSize===4)assert.equal(p.payload.readFloatLE(row.tangentOffset+i*16+12),THREE.DataUtils.fromHalfFloat(bytes.readUInt16LE(i*p.stride+6)));
        for(let axis=0;axis<2;axis++)assert.equal(mesh.geometry.attributes.uv.array[i*2+axis],THREE.DataUtils.fromHalfFloat(bytes.readUInt16LE(i*p.stride+uv+axis*2)));
      }
      if(row.sourceLod){assert.equal(row.lodSourceMaterial.materialParametersEqualLod0,true);assert.ok(row.lodSourceMaterial.sharedParameterRoot);}else baseInstances+=row.placementCount;
      count++;vertices+=row.vertexCount;
    }
  }
  assert.equal(count,10);assert.equal(vertices,34511);assert.equal(baseInstances,132);
  const rows=parts.flatMap(p=>p.doc.records),base=new Set(rows.filter(r=>r.sourceLod===0).map(r=>`${r.assetId}/${r.sourceMaterialId}`));
  const expected=json('web/public/assets/source-lods.json').assets.flatMap(a=>a.lods.flatMap(l=>l.sections.filter(s=>base.has(`${a.assetId}/${s.lod0MaterialId}`)).map(s=>`${a.assetId}/${l.level}/${s.sourceMaterialId}`)));
  assert.equal(expected.length,4);assert.deepEqual(new Set(expected),new Set(rows.filter(r=>r.sourceLod>0).map(r=>`${r.assetId}/${r.sourceLod}/${r.sourceMaterialId}`)));
});

test('both original Array2UV VS permutations match source frame helper against unchanged CPU WARP output',()=>{
  let comparisons=0,maxError=0,uvComparisons=0;
  for(const p of parts){
    const fixture=p.evidence.inputFixture,input=read(p.path+'vertex-input.bin'),sources=p.doc.records.map(r=>read(p.path+r.vertexFile));assert.equal(sha(input),fixture.sha256);
    for(const report of json(p.path+'warp-execution.json').reports){
      const out=read(p.path+report.shader+'.warp.bin');assert.equal(sha(out),report.outputSha256);assert.equal(sha(input),report.inputSha256);assert.equal(report.shaderSha256,p.routing.shaders.find(s=>s.vertex===report.shader).vertexSha256);
      for(let c=0;c<12;c++)for(let i=0;i<fixture.samples.length;i++){
        const s=fixture.samples[i],raw=sources[s.recordIndex],offset=(c*fixture.vertices+i)*64,values=at=>[0,1,2].map(a=>THREE.DataUtils.fromHalfFloat(raw.readUInt16LE(s.sourceVertex*p.stride+at+a*2)));
        const frame=p.stride===44?sourceExplicitVertexFrame(values(20),values(28),values(12),fixture.cases[c].matrix):sourceVertexFrame(values(8),[...values(16),THREE.DataUtils.fromHalfFloat(raw.readUInt16LE(s.sourceVertex*p.stride+6))],fixture.cases[c].matrix);
        for(let axis=0;axis<3;axis++)for(const [expected,actual]of ['T','B','N'].map((key,col)=>[frame[key][axis],out.readFloatLE(offset+16+axis*16+col*4)])){const error=Math.abs(expected-actual);assert.ok(Number.isFinite(actual)&&error<5e-7);maxError=Math.max(error,maxError);comparisons++;}
        const half=at=>THREE.DataUtils.fromHalfFloat(raw.readUInt16LE(s.sourceVertex*p.stride+at));
        const sourceUV=[24,26,28,30].map(half),actualUV=report.atlas?[0,4,8,12].map(at=>out.readFloatLE(offset+at)):[44,60,12,28].map(at=>out.readFloatLE(offset+at));
        assert.deepEqual(actualUV,sourceUV);uvComparisons+=4;
      }
    }
  }
  assert.equal(comparisons,140400);assert.equal(uvComparisons,62400);console.log(JSON.stringify({array2uvTangentComparisons:comparisons,maxError,uvComparisons,sourceRecords:10,sourceSectionInstances:132}));
});

