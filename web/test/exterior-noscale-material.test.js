import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {EXTERIOR_NOSCALE_GLSL,prepareRecoveredExteriorNoScaleMaterials} from '../src/exterior-noscale-material.js';
import {createSourceProbeLighting} from '../src/source-probes.js';
const root=new URL('../../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root)),json=p=>JSON.parse(read(p));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const doc=json('web/public/assets/recovered-exterior-noscale-materials.json');
const evidence=json('exports/materials/exterior-noscale-shader/material-analysis.json');

test('exterior source shader routing and twenty exact float32 overrides are preserved',()=>{
  assert.equal(doc.shaderNameHash,1764561980);assert.equal(sha(read('exports/materials/rvm/0.res')),doc.sourceRvmSha256);
  assert.equal(sha(read('exports/materials/exterior-noscale-shader/87f18d3646.dxbc')),doc.pixelShaderSha256);
  assert.equal(sha(read('exports/materials/exterior-noscale-shader/971c1855d6.dxbc')),doc.pairedVertexShaderSha256);
  const graph=json('exports/materials/exterior-noscale-shader/graph.json');
  for(let n=1;n<evidence.selectionChain.length;n++)assert.ok(graph.edges.some(e=>e.from===evidence.selectionChain[n-1].block&&e.to===evidence.selectionChain[n].block));
  assert.deepEqual(doc.textureMapping.map(x=>x.parameterHash),[3316801555,3904205079]);
  assert.equal(evidence.pixelConstantTableOutputSlot,39);assert.equal(evidence.vertexConstantTableOutputSlot,40);
  assert.deepEqual(doc.constantMapping.map(x=>x.inputSlot),[7,26,12,4,11]);
  assert.equal(doc.materials.length,4);assert.equal(doc.placedSectionCount,87);let overrides=0;
  for(const row of doc.materials){
    const source=evidence.materials.find(r=>r.assetId===row.assetId&&r.materialId===row.materialId);
    assert.deepEqual(row.bindings,source.bindings);assert.deepEqual(row.constants,source.constants);assert.equal(row.variationHash,0);
    for(const [n,entry]of row.constantEvidence.entries()){
      assert.equal(entry.kind,'exact-section-override');const bytes=Buffer.from(entry.rawHex,'hex');
      assert.deepEqual(row.constants[n],[0,4,8,12].map(at=>bytes.readFloatLE(at)));overrides++;
    }
  }
  assert.equal(overrides,20);assert.equal(doc.visibleCoverage.visibleLod0Triangles,458278);
  assert.deepEqual(doc.materials.map(r=>r.constants[4][0]),[.5,0,0,0]);
});

test('exterior packed DDS source mip ranges and all linear channels are unchanged',()=>{
  let bytes=0;const mips=[];assert.equal(Object.keys(doc.sourceTextures).length,3);
  for(const t of Object.values(doc.sourceTextures)){
    const source=read(t.sourceDdsPath),selected=read(t.selectedDdsPath),png=read(`web/public${t.url}`);
    assert.equal(sha(source),t.sourceDdsSha256);assert.equal(sha(selected),t.selectedDdsSha256);assert.equal(sha(png),t.sha256);
    assert.deepEqual(selected.subarray(148),source.subarray(t.sourceDataOffset));
    assert.deepEqual([png.readUInt32BE(16),png.readUInt32BE(20)],[1024,1024]);
    assert.equal(t.dxgiFormat,98);assert.equal(t.colorSpace,'linear');bytes+=png.length;mips.push(t.sourceMip);
  }
  assert.equal(bytes,4646423);assert.deepEqual(mips.sort(),[0,1,1]);
});

test('exterior independent DXBC checks exercise world-axis normal blending and unnormalized SH',()=>{
  assert.equal(EXTERIOR_NOSCALE_GLSL,read('tools/materials/exterior-noscale-equations.glsl').toString());
  const validation=json('exports/materials/exterior-noscale-shader/equation-validation.json');
  assert.equal(validation.cases,3200);assert.ok(validation.maxAbsoluteError<1e-10);assert.ok(validation.nonunitPrelightingCases>3000);
  assert.equal(doc.nativeLightingInputs.shNormal,'unnormalized-world-normal-sum');
  assert.equal(doc.nativeLightingInputs.normalExpression,'bf2_exterior_prelightingNormal');
  assert.equal(doc.nativeMaterialModel.materialId,0);assert.equal(doc.nativeMaterialModel.reflectance,.5);
  const asm=read('exports/materials/exterior-noscale-shader/87f18d3646.asm').toString();
  for(const op of [...doc.nativeLightingInputs.normalInstructions,...doc.nativeMaterialModel.producerOperations])assert.ok(asm.includes(op));
  for(const c of doc.nativeMaterialModel.consumers)assert.equal(sha(read(`exports/lighting/dfg-gbuffer/${c.file}.dxbc`)),c.sha256);
  assert.match(EXTERIOR_NOSCALE_GLSL,/normalize\(baseWorld\) \+ normalize\(detailWorld\) \* vec3\(1.0, 1.0, 0.0\)/);
});

test('actual GLTFLoader routes the four source exterior sections without changing geometry',async()=>{
  const prior=THREE.TextureLoader.prototype.loadAsync,textures=[];
  THREE.TextureLoader.prototype.loadAsync=async function(url){const t=new THREE.Texture();t.name=url;textures.push(t);return t;};
  try{
    const recovered=await prepareRecoveredExteriorNoScaleMaterials(doc),loader=new GLTFLoader();
    loader.register(()=>({name:'ExteriorNodeImageStub',loadTexture(){return Promise.resolve(new THREE.Texture());}}));
    const scene=json('web/public/assets/map.scene.json');let count=0;
    for(const recipe of doc.materials){
      const asset=scene.assets.find(a=>a.id===recipe.assetId),bytes=read(`web/public/assets/${asset.url}`);
      const gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
      const geometries=new Map();gltf.scene.traverse(m=>{if(m.isMesh)geometries.set(m,m.geometry);});
      recovered.apply(gltf,{id:'unrelated'});recovered.apply(gltf,asset);recovered.apply(gltf,asset);
      gltf.scene.traverse(mesh=>{
        if(!mesh.isMesh)return;assert.equal(mesh.geometry,geometries.get(mesh));
        for(const mat of [].concat(mesh.material)){
          const selected=mat.userData.sourceMaterialId===recipe.materialId;assert.equal(!!mat.userData.recoveredExteriorNoScaleShader,selected);
          if(selected){count++;assert.equal(mat.map,null);assert.equal(mat.normalMap,null);assert.equal(mat.userData.placeholder,false);}
          mat.dispose();
        }
        mesh.geometry.dispose();
      });
    }
    assert.equal(count,4);assert.equal(recovered.applied,4);assert.equal(textures.length,3);for(const t of textures)t.dispose();
  }finally{THREE.TextureLoader.prototype.loadAsync=prior;}
});

test('exterior hook exposes native unnormalized world normal before probe lighting and preserves source uniforms',async()=>{
  const prior=THREE.TextureLoader.prototype.loadAsync,textures=[];
  THREE.TextureLoader.prototype.loadAsync=async function(url){const t=new THREE.Texture();t.name=url;textures.push(t);return t;};
  try{
    const recovered=await prepareRecoveredExteriorNoScaleMaterials(doc),recipe=doc.materials[0];
    const geometry=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial(),mesh=new THREE.InstancedMesh(geometry,material,2),scene=new THREE.Group();
    material.userData.sourceMaterialId=recipe.materialId;
    mesh.setMatrixAt(0,new THREE.Matrix4().makeRotationY(.8).setPosition(-919.68,587.52,-319.9382));
    mesh.setMatrixAt(1,new THREE.Matrix4().makeRotationX(.4).setPosition(-918.68,587.52,-319.9382));scene.add(mesh);
    recovered.apply({scene},{id:recipe.assetId});
    assert.deepEqual(material.userData.recoveredExteriorNoScaleShader.nativeLightingInputs,doc.nativeLightingInputs);
    const raw=read('web/public/assets/source-probes.bin');const lighting=createSourceProbeLighting(json('web/public/assets/source-probes.json'),new Float32Array(raw.buffer,raw.byteOffset,raw.byteLength/4));lighting.add(mesh);
    const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};mesh.material.onBeforeCompile(shader,{});
    assert.deepEqual(shader.uniforms.bf2_exterior_cb.value.map(v=>v.toArray()),recipe.constants);
    for(const role of ['base','detail'])assert.equal(shader.uniforms[`bf2_exterior_${role}`].value.name,recipe.textures[role]);
    assert.match(shader.fragmentShader,/inverseTransformDirection\(bf2_exterior_frame \* bf2_exterior_surface.baseTangentNormal, viewMatrix\)/);
    assert.match(shader.fragmentShader,/inverseTransformDirection\(bf2_exterior_frame \* bf2_exterior_surface.detailTangentNormal, viewMatrix\)/);
    assert.ok(shader.fragmentShader.indexOf('vec3 bf2_exterior_prelightingNormal =')<shader.fragmentShader.indexOf('#include <lights_fragment_begin>'));
    assert.match(shader.fragmentShader,/normal = transformDirection\(bf2_exterior_prelightingNormal, viewMatrix\)/);
    assert.match(shader.fragmentShader,/metalnessFactor = clamp\(bf2_exterior_surface.metalness/);
    assert.match(shader.fragmentShader,/reflectedLight.indirectDiffuse \*= bf2_exterior_surface.ao/);
    assert.ok(mesh.material.customProgramCacheKey().includes('SS_DeathStar_Props_Exterior_01_NoObjectScale_01-87f18d3646'));
    assert.equal(mesh.geometry.attributes.position,geometry.attributes.position);assert.deepEqual([...mesh.geometry.attributes.bf2_probeOffset.array],[0,9]);
    lighting.dispose();geometry.dispose();material.dispose();for(const t of textures)t.dispose();
  }finally{THREE.TextureLoader.prototype.loadAsync=prior;}
});
