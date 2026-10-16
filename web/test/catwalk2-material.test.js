import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {CATWALK2_GLSL,prepareRecoveredCatwalk2Materials} from '../src/catwalk2-material.js';
import {createSourceProbeLighting} from '../src/source-probes.js';
const root=new URL('../../',import.meta.url),read=path=>fs.readFileSync(new URL(path,root)),json=path=>JSON.parse(read(path));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const doc=json('web/public/assets/recovered-catwalk2-materials.json');
const evidence=json('exports/materials/catwalk2-shader/material-analysis.json');

test('Catwalk2 shader routing and all30 source scale selections retain exact bytes',()=>{
  assert.equal(doc.shaderNameHash,2105226254);
  assert.equal(sha(read('exports/materials/rvm/0.res')),doc.sourceRvmSha256);
  for(const [key,hash]of [['pixelShader','pixelShaderSha256'],['pairedVertexShader','pairedVertexShaderSha256'],['forwardShader','forwardShaderSha256']])assert.equal(sha(read(`exports/materials/catwalk2-shader/${doc[key]}.dxbc`)),doc[hash]);
  const graph=json('exports/materials/catwalk2-shader/graph.json');
  for(let n=1;n<evidence.selectionChain.length;n++)assert.ok(graph.edges.some(e=>e.from===evidence.selectionChain[n-1].block&&e.to===evidence.selectionChain[n].block));
  assert.deepEqual(doc.textureMapping.map(x=>x.parameterHash),[378117618,5861208,2990320127]);
  assert.equal(evidence.pixelConstantTableOutputSlot,34);assert.equal(evidence.vertexConstantTableOutputSlot,35);
  assert.equal(doc.constantMapping[0].inputSlot,24);
  assert.equal(doc.materials.length,30);assert.equal(doc.placedSectionCount,384);
  let defaults=0,overrides=0;
  for(const row of doc.materials){
    const source=evidence.materials.find(r=>r.assetId===row.assetId&&r.materialId===row.materialId);
    assert.deepEqual(row.bindings,source.bindings);assert.deepEqual(row.constants,source.constants);
    assert.equal(row.variationHash,0);
    if(row.constantEvidence[0].kind==='exact-section-override'){
      const bytes=Buffer.from(row.constantEvidence[0].rawHex,'hex');
      assert.deepEqual(row.constants[0],[0,4,8,12].map(at=>bytes.readFloatLE(at)));
      assert.deepEqual(row.constants[0],[3,3,0,1]);overrides++;
    }else{assert.deepEqual(row.constants[0],[1,1,0,0]);defaults++;}
  }
  assert.equal(overrides,27);assert.equal(defaults,3);
  assert.equal(doc.visibleCoverage.visibleSections,29);assert.equal(doc.visibleCoverage.visibleLod0Triangles,636677);
});

test('Catwalk2 preserves all four native packed texture payloads and their transfer functions',()=>{
  assert.equal(Object.keys(doc.sourceTextures).length,4);let srgb=0,pngBytes=0;
  for(const texture of Object.values(doc.sourceTextures)){
    const original=read(texture.sourceDdsPath),selected=read(texture.selectedDdsPath),png=read(`web/public${texture.url}`);
    assert.equal(sha(original),texture.sourceDdsSha256);assert.equal(sha(selected),texture.selectedDdsSha256);assert.equal(sha(png),texture.sha256);
    assert.deepEqual(selected.subarray(148),original.subarray(texture.sourceDataOffset));
    assert.equal(texture.sourceMip,0);assert.equal(texture.sourceDataOffset,148);
    assert.deepEqual([png.readUInt32BE(16),png.readUInt32BE(20)],[texture.width,texture.height]);
    assert.ok(texture.width===1024||texture.width===16);
    assert.equal(texture.colorSpace,texture.dxgiFormat===99?'srgb':'linear');
    srgb+=texture.colorSpace==='srgb'?1:0;pngBytes+=png.length;
  }
  assert.equal(srgb,1);assert.equal(pngBytes,2821784);
});

test('Catwalk2 math and normalized SH inputs agree with the native shader and ordinary material consumer',()=>{
  assert.equal(CATWALK2_GLSL,read('tools/materials/catwalk2-equations.glsl').toString());
  const validation=json('exports/materials/catwalk2-shader/equation-validation.json');
  assert.equal(validation.cases,3000);assert.ok(validation.maxAbsoluteError<1e-10);
  assert.equal(doc.nativeMaterialModel.materialId,0);assert.equal(doc.nativeMaterialModel.metalness,0);assert.equal(doc.nativeMaterialModel.reflectance,.5);
  assert.equal(doc.nativeLightingInputs.shNormal,'normalized-final-world-normal');
  const shader=read('exports/materials/catwalk2-shader/2b6d233517.asm').toString();
  for(const op of [...doc.nativeMaterialModel.producerOperations,...doc.nativeLightingInputs.normalInstructions])assert.ok(shader.includes(op));
  for(const consumer of doc.nativeMaterialModel.consumers)assert.equal(sha(read(`exports/lighting/dfg-gbuffer/${consumer.file}.dxbc`)),consumer.sha256);
  assert.match(CATWALK2_GLSL,/base.b \* grunge.rgb/);assert.match(CATWALK2_GLSL,/worldPosition.xz \* 0.1/);
  assert.match(doc.runtimeMapping.ao,/No separate AO/);assert.match(doc.runtimeMapping.emissive,/None/);
});

test('actual GLTFLoader material extras route all30 catwalk sections and preserve mesh geometry',async()=>{
  const prior=THREE.TextureLoader.prototype.loadAsync,textures=[];
  THREE.TextureLoader.prototype.loadAsync=async function(url){const t=new THREE.Texture();t.name=url;textures.push(t);return t;};
  try{
    const recovered=await prepareRecoveredCatwalk2Materials(doc),loader=new GLTFLoader();
    loader.register(()=>({name:'CatwalkNodeImageStub',loadTexture(){return Promise.resolve(new THREE.Texture());}}));
    const scene=json('web/public/assets/map.scene.json');let matching=0;
    for(const id of new Set(doc.materials.map(r=>r.assetId))){
      const asset=scene.assets.find(a=>a.id===id),bytes=read(`web/public/assets/${asset.url}`);
      const gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
      const geometries=new Map();gltf.scene.traverse(m=>{if(m.isMesh)geometries.set(m,m.geometry);});
      recovered.apply(gltf,{id:'unrelated'});recovered.apply(gltf,asset);recovered.apply(gltf,asset);
      gltf.scene.traverse(mesh=>{
        if(!mesh.isMesh)return;assert.equal(mesh.geometry,geometries.get(mesh));
        for(const material of [].concat(mesh.material)){
          const recipe=doc.materials.find(r=>r.assetId===id&&r.materialId===material.userData.sourceMaterialId);
          assert.equal(!!material.userData.recoveredCatwalk2Shader,!!recipe);
          if(recipe){matching++;assert.equal(material.metalness,0);assert.equal(material.normalMap,null);assert.equal(material.map,null);assert.equal(material.userData.placeholder,false);}
          material.dispose();
        }
        mesh.geometry.dispose();
      });
    }
    assert.equal(matching,30);assert.equal(recovered.applied,30);assert.equal(textures.length,4);
    for(const t of textures)t.dispose();
  }finally{THREE.TextureLoader.prototype.loadAsync=prior;}
});

test('Catwalk2 shader hooks preserve source worldXZ coordinates and instanced probe composition',async()=>{
  const prior=THREE.TextureLoader.prototype.loadAsync,textures=[];
  THREE.TextureLoader.prototype.loadAsync=async function(url){const t=new THREE.Texture();t.name=url;textures.push(t);return t;};
  try{
    const recovered=await prepareRecoveredCatwalk2Materials(doc),recipe=doc.materials[0];
    const geometry=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial(),mesh=new THREE.InstancedMesh(geometry,material,2),scene=new THREE.Group();
    material.userData.sourceMaterialId=recipe.materialId;
    mesh.setMatrixAt(0,new THREE.Matrix4().makeTranslation(-919.68,587.52,-319.9382));mesh.setMatrixAt(1,new THREE.Matrix4().makeTranslation(-918.68,587.52,-319.9382));scene.add(mesh);
    recovered.apply({scene},{id:recipe.assetId});
    assert.deepEqual(material.userData.recoveredCatwalk2Shader.nativeLightingInputs,doc.nativeLightingInputs);
    const raw=read('web/public/assets/source-probes.bin');
    const lighting=createSourceProbeLighting(json('web/public/assets/source-probes.json'),new Float32Array(raw.buffer,raw.byteOffset,raw.byteLength/4));lighting.add(mesh);
    const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};
    mesh.material.onBeforeCompile(shader,{});
    assert.deepEqual(shader.uniforms.bf2_catwalk2_cb.value.map(v=>v.toArray()),recipe.constants);
    for(const role of ['base','detail','grunge'])assert.equal(shader.uniforms[`bf2_catwalk2_${role}`].value.name,recipe.textures[role]);
    assert.match(shader.vertexShader,/instanceMatrix \* bf2_catwalk2_wp/);assert.match(shader.vertexShader,/modelMatrix \* bf2_catwalk2_wp/);
    assert.ok(shader.fragmentShader.includes('irradiance += PI * bf2_probeDiffuse'));
    assert.ok(mesh.material.customProgramCacheKey().includes('SS_CatwalkSystem_Preset_02-2b6d233517'));
    assert.equal(mesh.geometry.attributes.position,geometry.attributes.position);assert.deepEqual([...mesh.geometry.attributes.bf2_probeOffset.array],[0,9]);
    lighting.dispose();geometry.dispose();material.dispose();for(const t of textures)t.dispose();
  }finally{THREE.TextureLoader.prototype.loadAsync=prior;}
});
