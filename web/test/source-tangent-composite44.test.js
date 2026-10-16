import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {sourceVertexFrame,createSourceTangentWitness,sourceTangentFrameKind} from '../src/source-tangent-frame.js';
import {prepareRecoveredArray2UvMaterials} from '../src/array2uv-material.js';
import {createSourceProbeLighting} from '../src/source-probes.js';
import {createSourceLodController} from '../src/source-lods.js';
const root=new URL('../../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root)),json=p=>JSON.parse(read(p));
const path='exports/materials/native-tangent-array2uv-composite44/',doc=json(path+'native-tangent-witness.json'),payload=read(path+'native-tangent-witness.bin'),evidence=json(path+'evidence.json'),routing=json(path+'shader-routing.json');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),buffer=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
const half=(raw,at)=>THREE.DataUtils.fromHalfFloat(raw.readUInt16LE(at));

test('composite44 exact compiled section predicates select both original Array2UV VS input layouts',()=>{
  const raw=read('exports/materials/rvm/0.res'),index=json('exports/materials/rvm/block-index.json').blocks,block=k=>raw.subarray(index[k].offset,index[k].offset+index[k].size);
  assert.equal(sha(raw),routing.sourceRvmSha256);assert.equal(sha(read(path+'shader-routing.json')),evidence.shaderRoutingSha256);
  assert.equal(sha(read(path+'selection.json')),evidence.selectionSha256);assert.equal(sha(read(path+'manifest.json')),evidence.extractionSha256);
  assert.equal(routing.sectionRoutes.length,3);assert.equal(routing.tree.completeByteCoverage,true);
  for(const row of routing.sectionRoutes){
    assert.deepEqual(row.permutationIndices,[11,13,14,16,25,39,53,54,59,71]);assert.equal(Object.keys(row.treeInputs).length,2);
    assert.deepEqual(row.shaders.map(s=>[s.vertex,s.pixel]),[['5da46730cb','52d055444c'],['cbfdbad68f','b398fb7ed2']]);
    for(const s of row.shaders){
      assert.equal(s.inputLayoutBlock,'9aa9d715d7');assert.equal(sha(block(s.inputLayoutBlock)),s.inputLayoutSha256);
      assert.equal(sha(read(`exports/materials/array2uv-shader/${s.vertex}.dxbc`)),s.vertexSha256);
      assert.deepEqual(s.inputLayout.map(r=>[r.semanticIndex,r.dxgiFormat,r.offset]),[[0,10,0],[1,12,8],[2,10,16],[3,10,24],[4,10,32],[5,34,40]]);
      for(const edges of Object.values(s.paths))for(const e of edges){const n=block(e.from).readBigUInt64LE(e.offset);assert.equal(n,BigInt(e.encoded));assert.equal((n&0xffffffffffn).toString(16).padStart(10,'0'),e.to);}
    }
  }
});

test('all16777 source composite vertices match pinned identity-part GLB conversion and retain raw N/T/sign',async()=>{
  assert.equal(doc.records.length,5);assert.equal(evidence.stats.baseSectionInstances,243);assert.equal(evidence.stats.vertices,16777);assert.equal(payload.length,469756);assert.equal(sha(payload),doc.sha256);
  const loader=new GLTFLoader();loader.register(()=>({name:'composite-source-images',loadTexture:async()=>new THREE.Texture()}));
  for(const row of doc.records){
    const raw=read(path+row.vertexFile),glb=read(row.glbPath);assert.equal(sha(raw),row.vertexSha256);assert.equal(sha(glb),row.glbSha256);
    const gltf=await loader.parseAsync(buffer(glb),'');let mesh;gltf.scene.traverse(m=>{if(m.isMesh&&gltf.parser.associations.get(m)?.primitives===row.primitiveIndex)mesh=m;});
    assert.equal(sha(Buffer.from(mesh.geometry.index.array.buffer)),row.indexSha256);
    for(const transform of row.partTransforms)assert.deepEqual(transform,new THREE.Matrix4().elements);
    for(let i=0;i<row.vertexCount;i++){
      const values=at=>[0,1,2].map(a=>half(raw,i*44+at+a*2)),sourceN=values(16),sourceP=values(0),sourceT=values(24),[nx,ny,nz]=sourceN,f=Math.fround;
      const mappedN=[nx+0*ny+0*nz,0*nx+ny+0*nz,0*nx+0*ny+nz],length=f(Math.sqrt(f(f(f(mappedN[0]**2)+f(mappedN[1]**2))+f(mappedN[2]**2))));
      for(let a=0;a<3;a++){
        assert.equal(mesh.geometry.attributes.position.array[i*3+a],sourceP[a]+0);
        assert.equal(mesh.geometry.attributes.normal.array[i*3+a],f(mappedN[a]/length));
        assert.equal(payload.readFloatLE(row.normalOffset+(i*3+a)*4),sourceN[a]);
        assert.equal(payload.readFloatLE(row.tangentOffset+i*16+a*4),sourceT[a]);
      }
      assert.equal(payload.readFloatLE(row.tangentOffset+i*16+12),half(raw,i*44+6));
      for(let a=0;a<2;a++)assert.equal(mesh.geometry.attributes.uv.array[i*2+a],half(raw,i*44+32+a*2));
      const part=raw.readUInt16LE(i*44+8);assert.equal(part,raw.readUInt16LE(i*44+14));assert.ok(part<row.partTransforms.length);
    }
  }
});

test('unchanged composite VS WARP proves original frames, UVs, low/high visibility roots and zero-output branch',()=>{
  const fixture=evidence.inputFixture,input=read(path+'vertex-input.bin'),sources=doc.records.map(r=>read(path+r.vertexFile));assert.equal(sha(input),fixture.sha256);
  assert.equal(fixture.cases.length,60);assert.equal(fixture.vertices,341);
  let comparisons=0,uvComparisons=0,zeroScalars=0,maxError=0;
  for(const report of json(path+'warp-execution.json').reports){
    const out=read(path+report.shader+'.warp.bin');assert.equal(sha(out),report.outputSha256);assert.equal(sha(input),report.inputSha256);assert.equal(report.shaderSha256,routing.shaders.find(s=>s.vertex===report.shader).vertexSha256);
    for(let c=0;c<report.cases;c++)for(let i=0;i<fixture.samples.length;i++){
      const s=fixture.samples[i],raw=sources[s.recordIndex],at=s.sourceVertex*44,offset=(c*fixture.vertices+i)*64,sourceCase=fixture.cases[c],part=raw.readUInt16LE(at+8);
      const visible=sourceCase.partVisibility===2?part%2:sourceCase.partVisibility;
      if(!visible){for(let a=0;a<16;a++){assert.equal(out.readFloatLE(offset+a*4),0);zeroScalars++;}continue;}
      const values=start=>[0,1,2].map(a=>half(raw,at+start+a*2)),frame=sourceVertexFrame(values(16),[...values(24),half(raw,at+6)],sourceCase.matrix);
      for(let axis=0;axis<3;axis++)for(const [col,key]of ['T','B','N'].entries()){
        const actual=out.readFloatLE(offset+16+axis*16+col*4),error=Math.abs(actual-frame[key][axis]);assert.ok(Number.isFinite(actual)&&error<5e-7,`${report.shader}/${c}/${i}/${key}/${axis}: ${error}`);maxError=Math.max(maxError,error);comparisons++;
      }
      const sourceUV=[32,34,36,38].map(x=>half(raw,at+x)),actualUV=(report.atlas?[0,4,8,12]:[44,60,12,28]).map(x=>out.readFloatLE(offset+x));assert.deepEqual(actualUV,sourceUV);uvComparisons+=4;
    }
  }
  assert.ok(comparisons>160000&&zeroScalars>300000);console.log(JSON.stringify({composite44FrameComparisons:comparisons,uvComparisons,zeroScalars,maxError}));
});

test('raw-normal payload rejects missing, overlapping, nonfinite and degenerate source attributes',()=>{
  const altered=mutate=>{const copy=structuredClone(doc);mutate(copy.records[0]);return copy;};
  for(const change of [r=>delete r.normalOffset,r=>r.normalOffset=r.tangentOffset,r=>r.normalOffset=payload.length,r=>r.normalBytes--,r=>r.family='master1uv']){
    assert.throws(()=>createSourceTangentWitness(altered(change),buffer(payload)),/raw-normal witness range/);
  }
  const corrupt=Buffer.from(payload);corrupt.writeFloatLE(NaN,doc.records[0].normalOffset);
  assert.throws(()=>createSourceTangentWitness(doc,buffer(corrupt)),/raw-normal frame component/);
  const degenerate=Buffer.from(payload);degenerate.fill(0,doc.records[0].normalOffset,doc.records[0].normalOffset+12);
  assert.throws(()=>createSourceTangentWitness(doc,buffer(degenerate)),/raw-normal frame component/);
});

test('composite, rigid and derivative permutations remain distinct across probe-wrapped LOD transitions',async()=>{
  const imageLoad=THREE.TextureLoader.prototype.loadAsync,fileLoad=THREE.FileLoader.prototype.loadAsync;
  THREE.TextureLoader.prototype.loadAsync=async()=>new THREE.Texture();THREE.FileLoader.prototype.loadAsync=async url=>buffer(read('web/public'+url));
  let probes;
  try{
    const loader=new GLTFLoader();loader.register(()=>({name:'composite-transition-images',loadTexture:async()=>new THREE.Texture()}));
    const row=doc.records[0],gltf=await loader.parseAsync(buffer(read(row.glbPath)),'');createSourceTangentWitness(doc,buffer(payload)).applyGeometry(gltf,{id:row.assetId});
    const recovered=await prepareRecoveredArray2UvMaterials(json('web/public/assets/recovered-array2uv-materials.json'));recovered.apply(gltf,{id:row.assetId});
    let source;gltf.scene.traverse(m=>{if(m.isMesh&&gltf.parser.associations.get(m)?.primitives===row.primitiveIndex)source=m;});
    const originalNormal=source.geometry.attributes.normal,originalIndex=source.geometry.index,rawNormal=source.geometry.attributes.bf2SourceNormal;
    const native=new THREE.InstancedMesh(source.geometry,source.material,2),scene=new THREE.Scene();native.setMatrixAt(0,new THREE.Matrix4());native.setMatrixAt(1,new THREE.Matrix4().makeTranslation(1,0,0));scene.add(native);
    // Same topology intentionally isolates frame permutation transitions. These
    // two alternatives are synthetic test cases, not newly recovered source LODs.
    const rigid=source.geometry.clone();rigid.userData={...rigid.userData,sourceTangentWitness:{...rigid.userData.sourceTangentWitness,frameKind:'signed-cross'}};rigid.deleteAttribute('bf2SourceNormal');
    const unsupported=source.geometry.clone();unsupported.userData={...unsupported.userData};delete unsupported.userData.sourceTangentWitness;unsupported.deleteAttribute('bf2SourceNormal');unsupported.deleteAttribute('bf2SourceTangent');
    probes=createSourceProbeLighting(json('web/public/assets/source-probes.json'),buffer(read('web/public/assets/source-probes.bin')));probes.add(scene);
    const nearMaterial=native.material,nearGeometry=native.geometry,offset=nearGeometry.attributes.bf2_probeOffset;
    const controller=createSourceLodController([{mesh:native,assetId:row.assetId,levels:[{level:1,distance:10,geometry:rigid},{level:2,distance:20,geometry:unsupported}]}],{adaptGeometry:(m,g)=>probes.adaptGeometry(m,g),adaptMaterial:(m,g)=>probes.adaptMaterial(m,g)});
    const materials=new Set(),keys=new Set();
    for(const [distance,kind]of [[0,'signed-cross-source-normal'],[11,'signed-cross'],[21,null],[0,'signed-cross-source-normal']]){
      controller.update(new THREE.Vector3(distance,0,0),true);assert.equal(sourceTangentFrameKind(native.geometry),kind);assert.equal(probes.snapshot().sourceTangents.mismatches,0);
      materials.add(native.material);keys.add(native.material.customProgramCacheKey());
      const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};native.material.onBeforeCompile(shader,{});
      assert.equal(shader.vertexShader.includes('#define BF2_SOURCE_RAW_COMPOSITE_NORMAL'),kind==='signed-cross-source-normal');assert.equal(shader.vertexShader.includes('#define BF2_SOURCE_TANGENT_FRAME'),kind!==null);
      assert.equal(native.geometry.attributes.bf2_probeOffset.getX(0),offset.getX(0));
    }
    assert.equal(materials.size,3);assert.equal(keys.size,3);assert.equal(native.material,nearMaterial);assert.equal(native.geometry,nearGeometry);
    assert.equal(native.geometry.attributes.normal,originalNormal);assert.equal(native.geometry.index,originalIndex);assert.equal(native.geometry.attributes.bf2SourceNormal,rawNormal);
    // Eleven source/probe/instance slots; the two original static-atlas
    // attributes add two, so the combined proven permutation uses thirteen.
    assert.equal(probes.snapshot().maxAttributeSlots,11);assert.ok(probes.snapshot().maxAttributeSlots+2<=16);
  }finally{probes?.dispose();THREE.TextureLoader.prototype.loadAsync=imageLoad;THREE.FileLoader.prototype.loadAsync=fileLoad;}
});
