import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {sourceVertexFrame,createSourceTangentWitness,sourceTangentFrameKind} from '../src/source-tangent-frame.js';
import {prepareRecoveredPropsPresetMaterials} from '../src/propspreset-material.js';
import {createSourceProbeLighting} from '../src/source-probes.js';
import {createSourceLodController} from '../src/source-lods.js';
const root=new URL('../../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root)),json=p=>JSON.parse(read(p));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),buffer=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
const parts=[32,36].map(stride=>{const path=`exports/materials/native-tangent-propspreset${stride}/`;return {stride,path,doc:json(path+'native-tangent-witness.json'),payload:read(path+'native-tangent-witness.bin'),evidence:json(path+'evidence.json'),routing:json(path+'shader-routing.json')};});

test('PropsPreset exact selected permutations bind each candidate section to its original VS, PS and input layout',()=>{
  const bytes=read('exports/materials/rvm/0.res'),index=json('exports/materials/rvm/block-index.json').blocks,block=k=>bytes.subarray(index[k].offset,index[k].offset+index[k].size);
  assert.deepEqual(parts.map(p=>[p.stride,p.doc.records.length,p.evidence.stats.baseSectionInstances]),[[32,18,328],[36,1,48]]);
  const original=json('exports/materials/propspreset-routing/routing-evidence.json');
  const checkPath=path=>{for(const e of path){const value=block(e.from).readBigUInt64LE(e.offset);assert.equal(value,BigInt(e.encoded));assert.equal((value&0xffffffffffn).toString(16).padStart(10,'0'),e.to);}};
  for(const p of parts){
    assert.equal(sha(bytes),p.routing.sourceRvmSha256);assert.equal(sha(read(p.path+'shader-routing.json')),p.evidence.shaderRoutingSha256);
    assert.equal(sha(read(p.path+'selection.json')),p.evidence.selectionSha256);assert.equal(sha(read(p.path+'manifest.json')),p.evidence.extractionSha256);
    assert.equal(sha(read('exports/materials/propspreset-routing/routing-evidence.json')),p.routing.sourceSectionRoutingSha256);
    assert.equal(p.routing.shaders.length,p.stride===32?4:2);
    for(const s of p.routing.shaders){
      assert.equal(sha(block(s.inputLayoutBlock)),s.inputLayoutSha256);
      for(const label of ['vertex','pixel'])assert.equal(sha(read(`exports/materials/propspreset-shader/${s[label]}.dxbc`)),s[label+'Sha256']);
      assert.deepEqual(s.inputLayout.map(r=>[r.index,r.dxgiFormat,r.offset]),p.stride===36?[[0,10,0],[1,10,8],[2,10,16],[3,10,24],[4,34,32]]:[[0,10,0],[1,10,8],[2,10,16],[3,10,24]]);
      for(const path of Object.values(s.paths))checkPath(path);
      const asm=read(`exports/materials/propspreset-shader/${s.pixel}.asm`).toString(),input=s.atlas?3:2;
      for(let axis=0;axis<3;axis++)assert.match(asm,new RegExp(`dp3 r\\d+\\.${'xyz'[axis]}, r5\\.xyzx, v${input+axis}\\.xyzx`));
      assert.match(asm,/dp3 r\d+\.[xyzw], r\d+\.xyzx, r\d+\.xyzx\r?\nrsq/);
    }
    for(const row of p.doc.records){
      const s=original.sections.find(s=>s.assetId===row.assetId&&s.materialId===row.lod0MaterialId),route=row.selectedShaderRoute;
      assert.deepEqual(route.sourcePermutationBlocks,s.permutationBlocks);assert.deepEqual(route.sourcePermutationIndices,s.permutationIndices);
      assert.equal(route.shaders.length,2);assert.deepEqual(route.shaders.map(s=>s.vertex),p.stride===32?['dfb8f760fb','13f25cb3dd']:['9d03671509','18d0bd9bee']);
      for(const s of route.shaders){assert.ok(route.sourcePermutationBlocks.includes(s.paths.permutation[0].from));for(const path of Object.values(s.paths))checkPath(path);}
    }
  }
});

test('all19 source PropsPreset records preserve raw tangent/sign bytes and match real GLTF normals, positions, UV0 and indices',async()=>{
  const loader=new GLTFLoader();loader.register(()=>({name:'props-frame-image-stub',loadTexture:async()=>new THREE.Texture()}));let records=0,vertices=0,instances=0;
  for(const p of parts){
    assert.equal(sha(p.payload),p.doc.sha256);
    for(const row of p.doc.records){
      const raw=read(p.path+row.vertexFile),indices=read(p.path+row.indexFile),glb=read(row.glbPath);
      assert.equal(sha(raw),row.vertexSha256);assert.equal(sha(indices),row.indexSha256);assert.equal(sha(glb),row.glbSha256);
      const gltf=await loader.parseAsync(buffer(glb),'');let mesh;gltf.scene.traverse(m=>{if(m.isMesh&&gltf.parser.associations.get(m)?.primitives===row.primitiveIndex)mesh=m;});
      assert.equal(mesh.material.userData.sourceMaterialId,row.sourceMaterialId);assert.equal(sha(Buffer.from(mesh.geometry.index.array.buffer)),row.indexSha256);
      for(let i=0;i<row.vertexCount;i++){
        const half=at=>THREE.DataUtils.fromHalfFloat(raw.readUInt16LE(i*p.stride+at));
        for(let axis=0;axis<3;axis++){
          assert.equal(mesh.geometry.attributes.position.array[i*3+axis],half(axis*2));
          assert.equal(mesh.geometry.attributes.normal.array[i*3+axis],half(8+axis*2));
          assert.equal(p.payload.readFloatLE(row.tangentOffset+i*16+axis*4),half(16+axis*2));
        }
        assert.equal(p.payload.readFloatLE(row.tangentOffset+i*16+12),half(6));
        for(let axis=0;axis<2;axis++)assert.equal(mesh.geometry.attributes.uv.array[i*2+axis],half(24+axis*2));
      }
      assert.equal(row.sourceLod,0);records++;vertices+=row.vertexCount;instances+=row.placementCount;
    }
  }
  assert.equal(records,19);assert.equal(vertices,31051);assert.equal(instances,376);
  const base=new Set(parts.flatMap(p=>p.doc.records).map(r=>`${r.assetId}/${r.sourceMaterialId}`));
  const lower=json('web/public/assets/source-lods.json').assets.flatMap(a=>a.lods.flatMap(l=>l.sections.filter(s=>base.has(`${a.assetId}/${s.lod0MaterialId}`))));assert.equal(lower.length,0);
});

test('four unchanged PropsPreset vertex shaders agree with original-frame helper on CPU WARP, including alarm UV routing',()=>{
  let comparisons=0,maxError=0,uvComparisons=0;
  for(const p of parts){
    const fixture=p.evidence.inputFixture,input=read(p.path+'vertex-input.bin'),sources=p.doc.records.map(r=>read(p.path+r.vertexFile));assert.equal(sha(input),fixture.sha256);
    for(const report of json(p.path+'warp-execution.json').reports){
      const out=read(p.path+report.shader+'.warp.bin');assert.equal(sha(out),report.outputSha256);assert.equal(sha(input),report.inputSha256);assert.equal(report.shaderSha256,p.routing.shaders.find(s=>s.vertex===report.shader).vertexSha256);
      for(let c=0;c<12;c++)for(let i=0;i<fixture.samples.length;i++){
        const sample=fixture.samples[i],raw=sources[sample.recordIndex],offset=(c*fixture.vertices+i)*48,half=at=>THREE.DataUtils.fromHalfFloat(raw.readUInt16LE(sample.sourceVertex*p.stride+at)),values=at=>[0,1,2].map(a=>half(at+a*2));
        const frame=sourceVertexFrame(values(8),[...values(16),half(6)],fixture.cases[c].matrix);
        for(let axis=0;axis<3;axis++)for(const [expected,actual]of ['T','B','N'].map((key,col)=>[frame[key][axis],out.readFloatLE(offset+axis*16+col*4)])){const error=Math.abs(expected-actual);assert.ok(Number.isFinite(actual)&&error<5e-7);maxError=Math.max(error,maxError);comparisons++;}
        assert.equal(out.readFloatLE(offset+12),half(report.atlas?(p.stride===36?34:30):26));uvComparisons++;
        if(p.stride===36&&!report.atlas){assert.equal(out.readFloatLE(offset+28),half(28));assert.equal(out.readFloatLE(offset+44),half(30));uvComparisons+=2;}
      }
    }
  }
  assert.equal(comparisons,263520);assert.equal(uvComparisons,30840);console.log(JSON.stringify({propsPresetTangentComparisons:comparisons,maxError,uvComparisons,sourceRecords:19,sourceSectionInstances:376}));
});

test('published PropsPreset frames preserve exact UV, emission and material routing while eight unproven sections and their LODs remain derivative',async()=>{
  const published=json('web/public/assets/native-tangent-witness.json'),payload=read('web/public'+published.url),adapter=createSourceTangentWitness(published,buffer(payload));
  assert.equal(sha(payload),published.sha256);assert.equal(published.publication.preparedSections,273);assert.equal(published.publication.baseSectionInstances,5558);
  for(const p of parts){const coverage=published.sourceCoverage.find(s=>s.evidenceId===p.evidence.evidenceId);assert.equal(coverage.evidenceSha256,sha(read(p.path+'evidence.json')));assert.deepEqual(payload.subarray(coverage.byteOffset,coverage.byteOffset+coverage.byteLength),p.payload);}
  const scene=json('web/public/assets/map.scene.json'),document=json('web/public/assets/recovered-propspreset-materials.json');
  const proven=new Set(parts.flatMap(p=>p.doc.records).map(r=>`${r.assetId}/${r.sourceMaterialId}`));
  const loader=new GLTFLoader();loader.register(()=>({name:'PropsNativeFrameImages',loadTexture:async()=>new THREE.Texture()}));
  const previousImage=THREE.TextureLoader.prototype.loadAsync,previousFile=THREE.FileLoader.prototype.loadAsync,instances=[];
  THREE.TextureLoader.prototype.loadAsync=async()=>new THREE.Texture();THREE.FileLoader.prototype.loadAsync=async url=>buffer(read('web/public'+url));let recovered,native=0,derivative=0,placed=0,lowerCount=0;
  try{
    recovered=await prepareRecoveredPropsPresetMaterials(document);
    for(const recipe of document.materials){
      const asset=scene.assets.find(a=>a.id===recipe.assetId),gltf=await loader.parseAsync(buffer(read('web/public/assets/'+asset.url)),'');adapter.applyGeometry(gltf,asset,0);
      let mesh;gltf.scene.traverse(m=>{if(m.isMesh&&m.material.userData.sourceMaterialId===recipe.materialId)mesh=m;});
      const original=[mesh.geometry,mesh.geometry.attributes.position,mesh.geometry.attributes.normal,mesh.geometry.attributes.uv,mesh.geometry.index];
      recovered.apply(gltf,asset);const expected=proven.has(`${asset.id}/${recipe.materialId}`),material=mesh.material;
      assert.equal(sourceTangentFrameKind(mesh.geometry),expected?'signed-cross':null);assert.equal(material.userData.sourceTangentFrame.enabled,expected);
      assert.deepEqual([mesh.geometry,mesh.geometry.attributes.position,mesh.geometry.attributes.normal,mesh.geometry.attributes.uv,mesh.geometry.index],original);
      const group=new THREE.Scene();group.add(mesh);const probes=createSourceProbeLighting(json('web/public/assets/source-probes.json'),buffer(read('web/public/assets/source-probes.bin')));instances.push(probes);probes.add(group);
      const compile=()=>{const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};mesh.material.onBeforeCompile(shader,{});return shader;};
      const shader=compile();assert.equal(shader.vertexShader.includes('BF2_SOURCE_TANGENT_FRAME'),expected);
      assert.equal(shader.fragmentShader.includes('bf2_props_tbn(-vViewPosition'),!expected);assert.equal(shader.vertexShader.includes('varying vec3 bf2_props_geometricNormal'),expected);
      assert.equal(shader.uniforms.bf2_props_cb.value.length,5);assert.match(shader.fragmentShader,/totalEmissiveRadiance = vec3\(0\.0\)/);assert.ok(!shader.fragmentShader.includes('normalize(bf2_props_surface.tangentNormal)'));
      assert.equal(probes.snapshot().sourceTangents.mismatches,0);assert.match(mesh.material.customProgramCacheKey(),expected?/native-v2-signed-cross/:/derivative/);
      if(recipe.family==='emissiveTwoUV'){assert.equal(mesh.geometry.attributes.bf2PropsUv1.itemSize,2);assert.match(shader.vertexShader,/bf2_props_uv = vec4\(uv, bf2PropsUv1\)/);}
      const nativeLod=json('web/public/assets/source-lods.json').assets.find(a=>a.assetId===asset.id),levels=[];
      for(const lod of nativeLod?.lods??[]){
        const section=lod.sections.find(s=>s.lod0MaterialId===recipe.materialId);if(!section)continue;assert.equal(expected,false);
        const lower=await loader.parseAsync(buffer(read('web/public'+lod.url)),'');adapter.applyGeometry(lower,asset,lod.level);let lowerMesh;lower.scene.traverse(m=>{if(m.isMesh&&m.material.userData.sourceMaterialId===section.sourceMaterialId)lowerMesh=m;});
        levels.push({level:lod.level,distance:10*lod.level,geometry:lowerMesh.geometry});lowerCount++;
      }
      if(levels.length){const controller=createSourceLodController([{mesh,assetId:asset.id,levels}],{adaptGeometry:(m,g)=>probes.adaptGeometry(m,g),adaptMaterial:(m,g)=>probes.adaptMaterial(m,g)});
        for(const distance of [...levels.map(l=>l.distance+1),0]){controller.update(new THREE.Vector3(distance,0,0),true);assert.equal(mesh.material.userData.sourceTangentFrame.enabled,false);assert.ok(!compile().vertexShader.includes('BF2_SOURCE_TANGENT_FRAME'));assert.equal(probes.snapshot().sourceTangents.mismatches,0);}}
      if(expected){native++;placed+=recipe.placementCount;}else derivative++;
    }
    assert.equal(native,19);assert.equal(derivative,8);assert.equal(placed,376);assert.equal(lowerCount,2);
  }finally{recovered?.dispose();for(const p of instances)p.dispose();THREE.TextureLoader.prototype.loadAsync=previousImage;THREE.FileLoader.prototype.loadAsync=previousFile;}
});
