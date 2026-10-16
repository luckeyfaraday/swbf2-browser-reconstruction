import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {sourceExplicitVertexFrame,createSourceTangentWitness,sourceTangentFrameKind} from '../src/source-tangent-frame.js';
import {prepareRecoveredMaster1UvEmissiveMaterials} from '../src/master1uv-emissive-material.js';
import {prepareSourceStaticAtlas} from '../src/source-static-atlas-adapter.js';
import {createSourceProbeLighting} from '../src/source-probes.js';
import {createStaticBatches} from '../src/static-batches.js';
import {createSourceLodController} from '../src/source-lods.js';
const root=new URL('../../',import.meta.url),directory='exports/materials/native-tangent44/';
const read=p=>fs.readFileSync(new URL(p,root)),json=p=>JSON.parse(read(p)),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const buffer=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
const doc=json(directory+'native-tangent-explicit.json'),evidence=json(directory+'evidence.json'),routing=json(directory+'shader-routing.json'),payload=read(directory+'native-tangent-explicit.bin');

test('explicit source Binormal layout is directly paired with both original metallic ordinary/atlas consumers',()=>{
  const raw=read('exports/materials/rvm/0.res'),index=json('exports/materials/rvm/block-index.json').blocks;
  assert.equal(sha(raw),routing.sourceRvmSha256);assert.equal(sha(read(directory+'shader-routing.json')),evidence.shaderRoutingSha256);
  const block=k=>raw.subarray(index[k].offset,index[k].offset+index[k].size);
  assert.deepEqual(routing.shaders.map(s=>[s.vertex,s.pixel,s.parameterBlock]),[['d4f2fe6832','5ffbbd02c2','ffaedac3ce'],['5a2ec69557','d1092739db','a812ad74e3']]);
  for(const s of routing.shaders){
    assert.equal(sha(read(`exports/materials/master1uv-emissive-shader/${s.vertex}.dxbc`)),s.vertexSha256);
    assert.equal(sha(read(`exports/materials/master1uv-emissive-shader/${s.pixel}.dxbc`)),s.pixelSha256);
    assert.equal(s.inputLayoutBlock,'21d0b76a8c');const bytes=block(s.inputLayoutBlock);assert.equal(sha(bytes),s.inputLayoutSha256);
    assert.deepEqual(s.inputLayout.map(r=>[r.index,r.dxgiFormat,r.offset]),[[0,6,0],[1,10,12],[2,10,20],[3,10,28],[4,10,36]]);
    for(let i=0;i<5;i++)assert.deepEqual([8,12,16,20,24,28].map(at=>bytes.readUInt32LE(i*32+at)),[i,i===0?6:10,0,i===0?0:4+i*8,0,0]);
    for(const path of Object.values(s.paths))for(const edge of path){const value=block(edge.from).readBigUInt64LE(edge.offset);assert.equal(value,BigInt(edge.encoded));assert.equal((value&0xffffffffffn).toString(16).padStart(10,'0'),edge.to);}
  }
  assert.equal(sha(read(directory+'selection.json')),evidence.selectionSha256);assert.equal(sha(read(directory+'manifest.json')),evidence.extractionSha256);
});

test('all30375 original explicit tangent/binormal vectors retain exact GLTF geometry, source offsets and independent B',async()=>{
  assert.equal(doc.records.length,3);assert.equal(payload.byteLength,729000);assert.equal(sha(payload),doc.sha256);assert.equal(evidence.stats.baseSectionInstances,15);
  const loader=new GLTFLoader();loader.register(()=>({name:'explicit-frame-image-stub',loadTexture:async()=>new THREE.Texture()}));
  let vertices=0;
  for(const row of doc.records){
    const raw=read(directory+row.vertexFile),indices=read(directory+row.indexFile),glb=read(row.glbPath);
    assert.equal(sha(raw),row.vertexSha256);assert.equal(sha(indices),row.indexSha256);assert.equal(sha(glb),row.glbSha256);
    assert.deepEqual(row.fields.map(f=>[f.usage,f.format,f.declaredOffset,f.traversedOffset,f.stream,f.stride]),[
      ['Pos','Float3',0,0,0,44],['Binormal','Half4',12,12,0,44],['Normal','Half4',20,20,0,44],['Tangent','Half4',28,28,0,44],['TexCoord0','Half2',36,36,0,44],['RadiosityTexCoord','Half2',40,40,0,44]]);
    const gltf=await loader.parseAsync(buffer(glb),'');let mesh;gltf.scene.traverse(m=>{if(m.isMesh&&gltf.parser.associations.get(m)?.primitives===row.primitiveIndex)mesh=m;});
    assert.equal(mesh.material.userData.sourceMaterialId,row.sourceMaterialId);assert.deepEqual(Object.keys(mesh.geometry.attributes).sort(),['normal','position','uv']);
    assert.equal(sha(Buffer.from(mesh.geometry.index.array.buffer)),row.indexSha256);
    for(let i=0;i<row.vertexCount;i++)for(let axis=0;axis<3;axis++){
      assert.equal(payload.readFloatLE(row.tangentOffset+i*12+axis*4),THREE.DataUtils.fromHalfFloat(raw.readUInt16LE(i*44+28+axis*2)));
      assert.equal(payload.readFloatLE(row.binormalOffset+i*12+axis*4),THREE.DataUtils.fromHalfFloat(raw.readUInt16LE(i*44+12+axis*2)));
      assert.equal(mesh.geometry.attributes.position.array[i*3+axis],raw.readFloatLE(i*44+axis*4));
      assert.equal(mesh.geometry.attributes.normal.array[i*3+axis],THREE.DataUtils.fromHalfFloat(raw.readUInt16LE(i*44+20+axis*2)));
    }
    for(let i=0;i<row.vertexCount;i++)for(let axis=0;axis<2;axis++)assert.equal(mesh.geometry.attributes.uv.array[i*2+axis],THREE.DataUtils.fromHalfFloat(raw.readUInt16LE(i*44+36+axis*2)));
    vertices+=row.vertexCount;
  }
  assert.equal(vertices,30375);assert.equal(evidence.stats.signedCrossInexactVertices,9565);assert.ok(evidence.stats.bestSignedCrossMaxError>0.00045);
});

test('explicit original frames agree with both unchanged native VS WARP captures including nonuniform/reflected transforms',()=>{
  const execution=json(directory+'warp-execution.json'),fixture=evidence.inputFixture,input=read(directory+'vertex-input.bin');
  assert.equal(sha(input),fixture.sha256);assert.equal(fixture.vertices,195);assert.equal(fixture.stride,44);assert.equal(new Set(fixture.samples.map(s=>s.recordIndex)).size,3);
  const sources=doc.records.map(r=>read(directory+r.vertexFile));let count=0,maxError=0,uvComparisons=0;
  for(const report of execution.reports){
    const out=read(directory+report.shader+'.warp.bin');assert.equal(sha(out),report.outputSha256);assert.equal(sha(input),report.inputSha256);
    assert.equal(report.shaderSha256,routing.shaders.find(s=>s.vertex===report.shader).vertexSha256);
    for(let c=0;c<12;c++)for(let i=0;i<fixture.samples.length;i++){
      const s=fixture.samples[i],raw=sources[s.recordIndex],at=s.sourceVertex*44;
      const values=offset=>[0,1,2].map(n=>THREE.DataUtils.fromHalfFloat(raw.readUInt16LE(at+offset+n*2)));
      const frame=sourceExplicitVertexFrame(values(20),values(28),values(12),fixture.cases[c].matrix),offset=(c*fixture.vertices+i)*64;
      for(let axis=0;axis<3;axis++)for(const [expected,actual]of [[frame.N[axis],out.readFloatLE(offset+axis*4)],...['T','B','N'].map((key,col)=>[frame[key][axis],out.readFloatLE(offset+16+axis*16+col*4)])]){
        const error=Math.abs(expected-actual);assert.ok(Number.isFinite(actual)&&error<5e-7);maxError=Math.max(error,maxError);count++;
      }
      assert.equal(out.readFloatLE(offset+12),THREE.DataUtils.fromHalfFloat(raw.readUInt16LE(at+(report.atlas?42:38))));uvComparisons++;
    }
  }
  assert.equal(count,56160);assert.equal(uvComparisons,4680);console.log(JSON.stringify({explicitTangentComparisons:count,maxError,uvComparisons}));
});

test('published explicit vectors validate independent ranges and reject missing or degenerate B',()=>{
  const published=json('web/public/assets/native-tangent-witness.json'),bytes=read('web/public'+published.url),part=published.sourceCoverage.find(p=>p.evidenceId===evidence.evidenceId);
  assert.equal(sha(bytes),published.sha256);assert.deepEqual(bytes.subarray(part.byteOffset,part.byteOffset+part.byteLength),payload);
  assert.equal(part.documentSha256,sha(read(directory+'native-tangent-explicit.json')));assert.equal(part.evidenceSha256,sha(read(directory+'evidence.json')));
  assert.equal(published.publication.preparedSections,273);assert.equal(published.publication.baseSectionInstances,5558);
  const selected=published.records.filter(r=>r.sourceCoverageEvidenceId===evidence.evidenceId);assert.equal(selected.length,3);
  for(const edit of [r=>delete r.binormalOffset,r=>r.binormalOffset=r.tangentOffset,r=>r.binormalBytes-=4,r=>r.frameKind='guessed']){
    const changed=structuredClone(published);edit(changed.records.find(r=>r.frameKind==='explicit-binormal'));assert.throws(()=>createSourceTangentWitness(changed,buffer(bytes)),/Invalid|Unknown/);
  }
  const corrupt=Buffer.from(bytes);corrupt.fill(0,selected[0].binormalOffset,selected[0].binormalOffset+12);
  assert.throws(()=>createSourceTangentWitness(published,buffer(corrupt)),/Invalid original explicit frame component/);
});

test('all15 explicit source placements preserve original atlas/probe/emission hooks within12 instanced attribute slots',async()=>{
  const published=json('web/public/assets/native-tangent-witness.json'),adapter=createSourceTangentWitness(published,buffer(read('web/public'+published.url)));
  const atlas=await prepareSourceStaticAtlas(json('web/public/assets/lighting/static-atlas-native.json'),{lightMapPreExposure:1,fetch:async url=>({ok:true,arrayBuffer:async()=>buffer(read('web/public'+url))})});
  const sceneDoc=json('web/public/assets/map.scene.json'),indices=new Map(sceneDoc.instances.map((row,index)=>[row,index])),scene=new THREE.Scene();
  const loader=new GLTFLoader();loader.register(()=>({name:'explicit-frame-budget-image-stub',loadTexture:async()=>new THREE.Texture()}));
  const oldLoad=THREE.TextureLoader.prototype.loadAsync;THREE.TextureLoader.prototype.loadAsync=async()=>new THREE.Texture();
  let probes;const dfgTexture=new THREE.DataTexture(new Uint16Array(128*128*4),128,128,THREE.RGBAFormat,THREE.HalfFloatType);
  try{
    const material=await prepareRecoveredMaster1UvEmissiveMaterials(json('web/public/assets/recovered-master1uv-emissive-materials.json'));
    for(const row of doc.records){
      const gltf=await loader.parseAsync(buffer(read(row.glbPath)),'');adapter.applyGeometry(gltf,{id:row.assetId},row.sourceLod);atlas.applyGeometry(gltf,{id:row.assetId},row.sourceLod);material.apply(gltf,{id:row.assetId});
      let mesh;gltf.scene.traverse(m=>{if(m.isMesh&&gltf.parser.associations.get(m)?.primitives===row.primitiveIndex)mesh=m;});
      gltf.scene.updateMatrixWorld(true);scene.add(...createStaticBatches(mesh,sceneDoc.instances.filter(i=>i.assetId===row.assetId),{id:row.assetId},{instanceIndices:indices}));
    }
    probes=createSourceProbeLighting(json('web/public/assets/source-probes.json'),buffer(read('web/public/assets/source-probes.bin')),{staticAtlas:atlas,dfg:{texture:dfgTexture,snapshot:()=>({evidenceId:'BF2-NATIVE-FG-WARP-001'})}});probes.add(scene);
    let placements=0,maxSlots=0,instanced=0;
    scene.traverse(mesh=>{if(!mesh.isMesh)return;placements+=mesh.isInstancedMesh?mesh.count:1;instanced+=Number(!!mesh.isInstancedMesh);
      assert.equal(sourceTangentFrameKind(mesh.geometry),'explicit-binormal');assert.equal(mesh.userData.sourceStaticAtlas.family,'master1uv-emissive');
      assert.deepEqual(Object.keys(mesh.geometry.attributes).sort(),['position','normal','uv','bf2SourceTangent','bf2SourceBinormal','bf2RadiosityUv','bf2StaticAtlasTransform','bf2_probeOffset'].sort());
      const slots=Object.values(mesh.geometry.attributes).reduce((n,a)=>n+Math.ceil(a.itemSize/4),0)+(mesh.isInstancedMesh?4:0);maxSlots=Math.max(maxSlots,slots);assert.ok(slots<=12);
      const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};mesh.material.onBeforeCompile(shader,{});
      assert.match(shader.vertexShader,/#define BF2_SOURCE_EXPLICIT_BINORMAL 1/);assert.match(shader.vertexShader,/attribute vec3 bf2SourceTangent, bf2SourceBinormal/);
      assert.match(shader.vertexShader,/B=normalize\(sourceToWorld\*sourceBinormal\)/);assert.ok(!shader.vertexShader.includes('cross(sourceNormal'));
      assert.ok(!shader.fragmentShader.includes('normalize(bf2_master1uv_emissive_geometricNormal)'));assert.match(shader.fragmentShader,/totalEmissiveRadiance = vec3\(0.0\)/);
      assert.equal((shader.fragmentShader.match(/\+bf2_master1uv_emissive_surface\.emissive/g)??[]).length,1);
      assert.match(mesh.material.customProgramCacheKey(),/tangentKind:explicit-binormal/);assert.equal(shader.uniforms.bf2_master1uv_emissive_cb.value.length,12);
    });
    assert.equal(placements,15);assert.ok(instanced>0);assert.equal(maxSlots,12);assert.equal(probes.snapshot().maxAttributeSlots,12);
    assert.deepEqual(probes.snapshot().sourceTangents.frameKinds,{'explicit-binormal':15});assert.equal(probes.snapshot().sourceTangents.mismatches,0);
    console.log(JSON.stringify({explicitAttributeBudget:{baseAttributes:3,tangent:1,binormal:1,radiosityUv:1,atlasTransform:1,probeOffset:1,instanceMatrix:4,total:12},placements,instancedDraws:instanced}));
  }finally{THREE.TextureLoader.prototype.loadAsync=oldLoad;if(probes)probes.dispose();else atlas.dispose();dfgTexture.dispose();}
});

test('shared metallic material and LOD/diagnostic switches keep signed, explicit and derivative cache variants distinct',async()=>{
  const published=json('web/public/assets/native-tangent-witness.json'),adapter=createSourceTangentWitness(published,buffer(read('web/public'+published.url)));
  const signed=json('exports/materials/native-tangent-metallic/native-tangent-witness.json').records[0];
  const excluded=json('exports/materials/native-tangent-metallic/evidence.json').excluded.find(r=>r.sourceStride===48);
  const loader=new GLTFLoader();loader.register(()=>({name:'three-frame-kinds-image-stub',loadTexture:async()=>new THREE.Texture()}));const meshes=[];
  for(const row of [doc.records[0],signed,excluded]){
    const gltf=await loader.parseAsync(buffer(read(row.glbPath)),'');adapter.applyGeometry(gltf,{id:row.assetId},row.sourceLod);
    gltf.scene.traverse(m=>{if(m.isMesh&&m.material.userData.sourceMaterialId===row.sourceMaterialId)meshes.push(m);});
  }
  assert.deepEqual(meshes.map(m=>sourceTangentFrameKind(m.geometry)),['explicit-binormal','signed-cross',null]);
  const oldLoad=THREE.TextureLoader.prototype.loadAsync;THREE.TextureLoader.prototype.loadAsync=async()=>new THREE.Texture();let probes;
  try{
    const recovered=await prepareRecoveredMaster1UvEmissiveMaterials(json('web/public/assets/recovered-master1uv-emissive-materials.json')),scene=new THREE.Scene();scene.add(meshes[0]);recovered.apply({scene},{id:doc.records[0].assetId});
    for(const mesh of meshes.slice(1)){mesh.material=meshes[0].material;scene.add(mesh);}
    probes=createSourceProbeLighting(json('web/public/assets/source-probes.json'),buffer(read('web/public/assets/source-probes.bin')));probes.add(scene);
    const [explicit,sign,derivative]=meshes.map(m=>m.material);assert.equal(new Set([explicit,sign,derivative]).size,3);
    // These actual source geometries intentionally share one material in this
    // transition fixture; no invented LOD is published as a native asset.
    const lods=createSourceLodController([{mesh:meshes[0],levels:[{level:1,distance:10,geometry:meshes[1].geometry},{level:2,distance:20,geometry:meshes[2].geometry}]}],{
      adaptGeometry:(m,g)=>probes.adaptGeometry(m,g),adaptMaterial:(m,g)=>probes.adaptMaterial(m,g)});
    for(const mode of ['smooth','original','bypass','flat','smooth']){
      probes.setDiagnosticMode(mode);
      for(const [distance,kind]of [[0,'explicit-binormal'],[15,'signed-cross'],[50,null],[0,'explicit-binormal']]){
        lods.update(new THREE.Vector3(distance,0,0),true);const mesh=meshes[0];assert.equal(mesh.material.userData.sourceTangentFrame.frameKind,kind);
        assert.equal(sourceTangentFrameKind(mesh.geometry),kind);assert.equal(probes.snapshot().sourceTangents.mismatches,0);
        const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};mesh.material.onBeforeCompile(shader,{});
        assert.equal(shader.vertexShader.includes('BF2_SOURCE_EXPLICIT_BINORMAL'),kind==='explicit-binormal');assert.equal(shader.vertexShader.includes('BF2_SOURCE_TANGENT_FRAME'),kind!==null);
      }
    }
    assert.equal(meshes[0].material,explicit);
  }finally{THREE.TextureLoader.prototype.loadAsync=oldLoad;probes?.dispose();}
});
