import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {sourceVertexFrame,sourceExplicitVertexFrame,createSourceTangentWitness,sourceTangentFrameKind} from '../src/source-tangent-frame.js';
import {createSourceProbeLighting} from '../src/source-probes.js';
import {createSourceLodController} from '../src/source-lods.js';
import {prepareRecoveredExteriorNoScaleMaterials} from '../src/exterior-noscale-material.js';
const root=new URL('../../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root)),json=p=>JSON.parse(read(p));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),buffer=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
const parts=[32].map(stride=>{const path=`exports/materials/native-tangent-exterior${stride}/`,stem=stride===44?'native-tangent-explicit':'native-tangent-witness';return {stride,path,doc:json(path+stem+'.json'),payload:read(path+stem+'.bin'),evidence:json(path+'evidence.json'),routing:json(path+'shader-routing.json')};});

test('Exterior original RVM pairs the exact ordinary/atlas PS with exact signed32 input layout',()=>{
  const bytes=read('exports/materials/rvm/0.res'),index=json('exports/materials/rvm/block-index.json').blocks,block=k=>bytes.subarray(index[k].offset,index[k].offset+index[k].size);
  assert.deepEqual(parts.map(p=>[p.stride,p.doc.records.length,p.evidence.stats.baseSectionInstances]),[[32,5,82]]);
  for(const p of parts){
    assert.equal(sha(bytes),p.routing.sourceRvmSha256);assert.equal(sha(read(p.path+'shader-routing.json')),p.evidence.shaderRoutingSha256);
    assert.equal(sha(read(p.path+'selection.json')),p.evidence.selectionSha256);assert.equal(sha(read(p.path+'manifest.json')),p.evidence.extractionSha256);
    for(const [i,s]of p.routing.shaders.entries()){
      assert.equal(s.pixel,i?'b584a44bc0':'87f18d3646');assert.equal(sha(block(s.inputLayoutBlock)),s.inputLayoutSha256);
      assert.equal(sha(read(`exports/materials/exterior-noscale-shader/${s.vertex}.dxbc`)),s.vertexSha256);assert.equal(sha(read(`exports/materials/exterior-noscale-shader/${s.pixel}.dxbc`)),s.pixelSha256);
      assert.deepEqual(s.inputLayout.map(r=>[r.semanticIndex,r.dxgiFormat,r.offset]),p.stride===44?[[0,6,0],[1,10,12],[2,10,20],[3,10,28],[4,10,36]]:p.stride===36?[[0,10,0],[1,10,8],[2,10,16],[3,10,24],[4,34,32]]:[[0,10,0],[1,10,8],[2,10,16],[3,10,24]]);
      for(const path of Object.values(s.paths))for(const edge of path){const n=block(edge.from).readBigUInt64LE(edge.offset);assert.equal(n,BigInt(edge.encoded));assert.equal((n&0xffffffffffn).toString(16).padStart(10,'0'),edge.to);}
      const asm=read(`exports/materials/exterior-noscale-shader/${s.pixel}.asm`).toString(),input=i?3:2;
      for(let axis=0;axis<3;axis++)assert.match(asm,new RegExp(`dp3 r\\d+\\.${'xyz'[axis]}, r\\d+\\.(?:xyzx|xywx|xzwx), v${input+axis}\\.xyzx`));
      assert.match(asm,/dp3 r[23]\.x, r6\.xyzx, r6\.xyzx\r?\nrsq/);
      assert.ok(asm.includes('l(1.000000, 1.000000, 0.000000, 0.000000)')); 
    }
  }
});

test('Exterior5 original section/LOD records retain every source T/B/sign and match real GLTF attributes exactly',async()=>{
  const loader=new GLTFLoader();loader.register(()=>({name:'exterior-frame-image-stub',loadTexture:async()=>new THREE.Texture()}));let count=0,vertices=0,baseInstances=0;
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
  assert.equal(count,5);assert.equal(vertices,18513);assert.equal(baseInstances,82);
  const rows=parts.flatMap(p=>p.doc.records),base=new Set(rows.filter(r=>r.sourceLod===0).map(r=>`${r.assetId}/${r.sourceMaterialId}`));
  const expected=json('web/public/assets/source-lods.json').assets.flatMap(a=>a.lods.flatMap(l=>l.sections.filter(s=>base.has(`${a.assetId}/${s.lod0MaterialId}`)).map(s=>`${a.assetId}/${l.level}/${s.sourceMaterialId}`)));
  assert.equal(expected.length,2);assert.deepEqual(new Set(expected),new Set(rows.filter(r=>r.sourceLod>0).map(r=>`${r.assetId}/${r.sourceLod}/${r.sourceMaterialId}`)));
});

test('both original Exterior VS permutations match source frame helper against unchanged CPU WARP output',()=>{
  let comparisons=0,maxError=0;
  for(const p of parts){
    const fixture=p.evidence.inputFixture,input=read(p.path+'vertex-input.bin'),sources=p.doc.records.map(r=>read(p.path+r.vertexFile));assert.equal(sha(input),fixture.sha256);
    for(const report of json(p.path+'warp-execution.json').reports){
      const out=read(p.path+report.shader+'.warp.bin');assert.equal(sha(out),report.outputSha256);assert.equal(sha(input),report.inputSha256);assert.equal(report.shaderSha256,p.routing.shaders.find(s=>s.vertex===report.shader).vertexSha256);
      for(let c=0;c<12;c++)for(let i=0;i<fixture.samples.length;i++){
        const s=fixture.samples[i],raw=sources[s.recordIndex],offset=(c*fixture.vertices+i)*48,values=at=>[0,1,2].map(a=>THREE.DataUtils.fromHalfFloat(raw.readUInt16LE(s.sourceVertex*p.stride+at+a*2)));
        const frame=p.stride===44?sourceExplicitVertexFrame(values(20),values(28),values(12),fixture.cases[c].matrix):sourceVertexFrame(values(8),[...values(16),THREE.DataUtils.fromHalfFloat(raw.readUInt16LE(s.sourceVertex*p.stride+6))],fixture.cases[c].matrix);
        for(let axis=0;axis<3;axis++)for(const [expected,actual]of ['T','B','N'].map((key,col)=>[frame[key][axis],out.readFloatLE(offset+axis*16+col*4)])){const error=Math.abs(expected-actual);assert.ok(Number.isFinite(actual)&&error<5e-7);maxError=Math.max(error,maxError);comparisons++;}
      }
    }
  }
  assert.equal(comparisons,70200);console.log(JSON.stringify({exteriorTangentComparisons:comparisons,maxError,sourceRecords:5,sourceSectionInstances:82}));
});

test('Exterior native frame preserves separate mapped normals and raw world-XY prelighting through both original lower LODs',async()=>{
  const published=json('web/public/assets/native-tangent-witness.json'),data=read('web/public'+published.url),adapter=createSourceTangentWitness(published,buffer(data));
  const part=published.sourceCoverage.find(r=>r.evidenceId===parts[0].doc.coverageEvidenceId);assert.equal(part.records,5);assert.deepEqual(data.subarray(part.byteOffset,part.byteOffset+part.byteLength),parts[0].payload);
  assert.equal(published.publication.preparedSections,273);assert.equal(published.publication.baseSectionInstances,5558);
  const oldLoad=THREE.TextureLoader.prototype.loadAsync,allProbes=[];THREE.TextureLoader.prototype.loadAsync=async()=>new THREE.Texture();
  const loader=new GLTFLoader();loader.register(()=>({name:'exterior-frame-images',loadTexture:async()=>new THREE.Texture()}));
  try{
    const recovered=await prepareRecoveredExteriorNoScaleMaterials(json('web/public/assets/recovered-exterior-noscale-materials.json'));let lowerCount=0;
    for(const rows of Map.groupBy(parts[0].doc.records,r=>r.assetId).values()){
      rows.sort((a,b)=>a.sourceLod-b.sourceLod);const meshes=[];
      for(const row of rows){
        const gltf=await loader.parseAsync(buffer(read(row.glbPath)),'');adapter.applyGeometry(gltf,{id:row.assetId},row.sourceLod);if(row.sourceLod===0)recovered.apply(gltf,{id:row.assetId});
        let mesh;gltf.scene.traverse(m=>{if(m.isMesh&&gltf.parser.associations.get(m)?.primitives===row.primitiveIndex)mesh=m;});meshes.push(mesh);
      }
      const source=meshes[0],mesh=new THREE.InstancedMesh(source.geometry,source.material,2),scene=new THREE.Scene();scene.add(mesh);
      mesh.setMatrixAt(0,new THREE.Matrix4().makeScale(2,.7,1.2));mesh.setMatrixAt(1,new THREE.Matrix4().makeTranslation(2,0,0));
      const probes=createSourceProbeLighting(json('web/public/assets/source-probes.json'),buffer(read('web/public/assets/source-probes.bin')));allProbes.push(probes);probes.add(scene);
      const original=[mesh.geometry,mesh.geometry.attributes.normal,mesh.geometry.index,mesh.material],offset=mesh.geometry.attributes.bf2_probeOffset.getX(0);
      const controller=createSourceLodController([{mesh,assetId:rows[0].assetId,levels:meshes.slice(1).map((m,i)=>({level:rows[i+1].sourceLod,distance:10*(i+1),geometry:m.geometry}))}],{adaptGeometry:(m,g)=>probes.adaptGeometry(m,g),adaptMaterial:(m,g)=>probes.adaptMaterial(m,g)});
      for(const [distance,level]of [...rows.map((r,i)=>[i?10*i+5:0,r.sourceLod]),[0,0]]){
        controller.update(new THREE.Vector3(distance,0,0),true);assert.equal(sourceTangentFrameKind(mesh.geometry),'signed-cross');assert.equal(mesh.geometry.userData.sourceTangentWitness.sourceLod,level);
        const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};mesh.material.onBeforeCompile(shader,{});
        assert.match(shader.vertexShader,/bf2_sourceVertexFrame\(normal, bf2SourceTangent/);assert.match(shader.vertexShader,/bf2_sourceFrameMatrix \* mat3\(instanceMatrix\)/);
        assert.match(shader.fragmentShader,/mat3 bf2_exterior_frame = mat3\(bf2_sourceT, bf2_sourceB, bf2_exterior_geometricNormal\)/);
        for(const name of ['base','detail'])assert.ok(shader.fragmentShader.includes(`vec3 bf2_exterior_${name}World = normalize(bf2_exterior_frame * bf2_exterior_surface.${name}TangentNormal);`));
        assert.match(shader.fragmentShader,/bf2_probeDiffuse\(bf2_exterior_prelightingNormal\)/);
        assert.match(shader.fragmentShader,/normal = transformDirection\(bf2_exterior_prelightingNormal, viewMatrix\)/);
        assert.ok(!shader.fragmentShader.includes('normalize(bf2_exterior_geometricNormal)'));assert.ok(!shader.fragmentShader.includes('bf2_exterior_tbn(-vViewPosition'));
        assert.ok(!shader.fragmentShader.includes('bf2_sourceMappedNormal(\n'));assert.equal(shader.uniforms.bf2_exterior_cb.value.length,5);
        assert.equal(mesh.geometry.attributes.bf2_probeOffset.getX(0),offset);assert.equal(probes.snapshot().sourceTangents.mismatches,0);assert.equal(mesh.material,original[3]);
      }
      assert.deepEqual([mesh.geometry,mesh.geometry.attributes.normal,mesh.geometry.index,mesh.material],original);assert.equal(probes.snapshot().maxAttributeSlots,9);lowerCount+=rows.length-1;
    }
    assert.equal(lowerCount,2);
    const silo='d7326c9d-327b-0f46-769c-785703c8c0ad',asset=json('web/public/assets/map.scene.json').assets.find(r=>r.id===silo),gltf=await loader.parseAsync(buffer(read('web/public/assets/'+asset.url)),'');adapter.applyGeometry(gltf,asset);recovered.apply(gltf,asset);
    gltf.scene.traverse(mesh=>{if(!mesh.isMesh)return;assert.equal(sourceTangentFrameKind(mesh.geometry),null);assert.equal(mesh.material.userData.sourceTangentFrame.enabled,false);
      const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};mesh.material.onBeforeCompile(shader,{});assert.ok(!shader.vertexShader.includes('BF2_SOURCE_TANGENT_FRAME'));assert.ok(shader.fragmentShader.includes('bf2_exterior_tbn(-vViewPosition'));});
  }finally{THREE.TextureLoader.prototype.loadAsync=oldLoad;for(const p of allProbes)p.dispose();}
});

