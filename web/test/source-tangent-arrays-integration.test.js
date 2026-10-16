import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createSourceTangentWitness,sourceTangentFrameKind} from '../src/source-tangent-frame.js';
import {prepareRecoveredArray1UvMaterials} from '../src/array1uv-material.js';
import {prepareRecoveredArray2UvMaterials} from '../src/array2uv-material.js';
import {createSourceProbeLighting} from '../src/source-probes.js';
import {createSourceLodController} from '../src/source-lods.js';
const root=new URL('../../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root)),json=p=>JSON.parse(read(p));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),buffer=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);

for(const [family,stride,prepare,expectedRecords,expectedInstances,expectedLods]of [
  ['array1uv',32,prepareRecoveredArray1UvMaterials,7,78,2],
  ['array1uv',28,prepareRecoveredArray1UvMaterials,5,168,2],
  ['array2uv',36,prepareRecoveredArray2UvMaterials,10,132,4],
  ['array2uv','-composite44',prepareRecoveredArray2UvMaterials,5,243,2],
])test(`${family} source${stride} published exact frames preserve source material/UVs through every native LOD and isolate unsupported geometry`,async()=>{
  const frameKind=stride==='-composite44'?'signed-cross-source-normal':'signed-cross';
  const prefix='bf2_'+family,published=json('web/public/assets/native-tangent-witness.json'),payload=read('web/public'+published.url),adapter=createSourceTangentWitness(published,buffer(payload));
  assert.equal(sha(payload),published.sha256);assert.equal(published.publication.preparedSections,273);assert.equal(published.publication.baseSectionInstances,5558);
  const path=`exports/materials/native-tangent-${family}${stride}/`,doc=json(path+'native-tangent-witness.json'),evidence=json(path+'evidence.json'),coverage=published.sourceCoverage.find(s=>s.evidenceId===doc.coverageEvidenceId);
  assert.equal(doc.records.length,expectedRecords);assert.equal(evidence.stats.baseSectionInstances,expectedInstances);assert.equal(coverage.evidenceSha256,sha(read(path+'evidence.json')));assert.deepEqual(payload.subarray(coverage.byteOffset,coverage.byteOffset+coverage.byteLength),read(path+'native-tangent-witness.bin'));
  const document=json(`web/public/assets/recovered-${family}-materials.json`),loader=new GLTFLoader();loader.register(()=>({name:'ArrayNativeFrameImageStub',loadTexture:async()=>new THREE.Texture()}));
  const previousImage=THREE.TextureLoader.prototype.loadAsync,previousFile=THREE.FileLoader.prototype.loadAsync,instances=[];let recovered,lowerCount=0;
  THREE.TextureLoader.prototype.loadAsync=async()=>new THREE.Texture();THREE.FileLoader.prototype.loadAsync=async url=>buffer(read('web/public'+url));
  try{
    recovered=await prepare(document);
    const meshFor=async row=>{const gltf=await loader.parseAsync(buffer(read(row.glbPath)),'');adapter.applyGeometry(gltf,{id:row.assetId},row.sourceLod);recovered.applyGeometry?.(gltf,{id:row.assetId},row.sourceLod);if(row.sourceLod===0)recovered.apply(gltf,{id:row.assetId});let mesh;gltf.scene.traverse(m=>{if(m.isMesh&&gltf.parser.associations.get(m)?.primitives===row.primitiveIndex)mesh=m;});return mesh;};
    for(const group of Map.groupBy(doc.records,r=>`${r.assetId}/${r.lod0MaterialId}`).values()){
      group.sort((a,b)=>a.sourceLod-b.sourceLod);const meshes=[];for(const row of group)meshes.push(await meshFor(row));
      const mesh=meshes[0],scene=new THREE.Scene();scene.add(mesh);
      const probes=createSourceProbeLighting(json('web/public/assets/source-probes.json'),buffer(read('web/public/assets/source-probes.bin')));instances.push(probes);probes.add(scene);
      const original=[mesh.geometry,mesh.geometry.attributes.normal,mesh.geometry.attributes.uv,mesh.geometry.index];
      const material=mesh.material,controller=createSourceLodController([{mesh,assetId:group[0].assetId,levels:meshes.slice(1).map((m,i)=>({level:group[i+1].sourceLod,distance:10*(i+1),geometry:m.geometry}))}],{adaptGeometry:(m,g)=>probes.adaptGeometry(m,g),adaptMaterial:(m,g)=>probes.adaptMaterial(m,g)});
      for(const [distance,level]of [...group.map((r,i)=>[i?10*i+1:0,r.sourceLod]),[0,0]]){
        controller.update(new THREE.Vector3(distance,0,0),true);assert.equal(mesh.material,material);assert.equal(sourceTangentFrameKind(mesh.geometry),frameKind);assert.equal(mesh.geometry.userData.sourceTangentWitness.sourceLod,level);
        const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};mesh.material.onBeforeCompile(shader,{});
        if(frameKind==='signed-cross-source-normal'){assert.match(shader.vertexShader,/bf2_sourceVertexFrame\(bf2SourceNormal, bf2SourceTangent/);assert.equal(mesh.geometry.attributes.bf2SourceNormal.itemSize,3);}
        assert.match(shader.vertexShader,/#define BF2_SOURCE_TANGENT_FRAME 1/);assert.ok(!shader.fragmentShader.includes(prefix+'_tbn(-vViewPosition'));assert.ok(!shader.fragmentShader.includes('normalize('+prefix+'_geometricNormal)'));
        assert.equal(shader.uniforms[prefix+'_cb'].value.length,2);assert.equal(shader.uniforms[prefix+'_detailArray'].value.image.depth,10);assert.ok(!shader.fragmentShader.includes(prefix+'_surface.emissive'));assert.ok(!shader.fragmentShader.includes(prefix+'_surface.ao'));
        assert.match(mesh.material.customProgramCacheKey(),/native-v2-signed-cross/);assert.equal(probes.snapshot().sourceTangents.mismatches,0);
        if(family==='array2uv')assert.equal(mesh.geometry.attributes.bf2ArrayUv1.itemSize,2);
      }
      assert.deepEqual([mesh.geometry,mesh.geometry.attributes.normal,mesh.geometry.attributes.uv,mesh.geometry.index],original);lowerCount+=group.length-1;
    }
    assert.equal(lowerCount,expectedLods);
    const base=new Set(published.records.filter(r=>r.family===family).map(r=>`${r.assetId}/${r.lod0MaterialId}`)),sceneDoc=json('web/public/assets/map.scene.json');let fallbackCount=0;
    for(const recipe of document.materials.filter(r=>!base.has(`${r.assetId}/${r.materialId}`))){
      const asset=sceneDoc.assets.find(a=>a.id===recipe.assetId),gltf=await loader.parseAsync(buffer(read('web/public/assets/'+asset.url)),'');adapter.applyGeometry(gltf,asset,0);recovered.apply(gltf,asset);let mesh;gltf.scene.traverse(m=>{if(m.isMesh&&m.material.userData.sourceMaterialId===recipe.materialId)mesh=m;});
      assert.equal(sourceTangentFrameKind(mesh.geometry),null);assert.equal(mesh.material.userData.sourceTangentFrame.enabled,false);
      const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};mesh.material.onBeforeCompile(shader,{});assert.ok(!shader.vertexShader.includes('BF2_SOURCE_TANGENT_FRAME'));assert.ok(shader.fragmentShader.includes(prefix+'_tbn(-vViewPosition'));fallbackCount++;
    }
    assert.equal(fallbackCount,5);
  }finally{for(const p of instances)p.dispose();THREE.TextureLoader.prototype.loadAsync=previousImage;THREE.FileLoader.prototype.loadAsync=previousFile;}
});
