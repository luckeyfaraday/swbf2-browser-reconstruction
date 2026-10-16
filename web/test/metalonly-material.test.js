import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { METALONLY_GLSL, prepareRecoveredMetalOnlyMaterials } from '../src/metalonly-material.js';
import { createSourceProbeLighting } from '../src/source-probes.js';

const root = new URL('../../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root));
const json = path => JSON.parse(read(path));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const doc = json('web/public/assets/recovered-metalonly-materials.json');
const evidence = json('exports/materials/metalonly-shader/material-analysis.json');

test('MetalOnly exact shader routing, source float32 overrides and 950 placed sections are retained', () => {
  assert.equal(doc.shaderNameHash, 1443790615);
  assert.equal(sha(read('exports/materials/rvm/0.res')), doc.sourceRvmSha256);
  assert.equal(sha(read('exports/materials/metalonly-shader/85476b5805.dxbc')), doc.pixelShaderSha256);
  assert.equal(sha(read('exports/materials/metalonly-shader/282854795b.dxbc')), doc.pairedVertexShaderSha256);
  assert.deepEqual(doc.textureMapping.map(x => x.parameterHash), [3886168014,1840368952,2517056835,3273948515,3052299456,613096030,1793132757]);
  const graph = json('exports/materials/metalonly-shader/graph.json');
  for (let n = 1; n < evidence.selectionChain.length; n++) {
    assert.ok(graph.edges.some(e => e.from === evidence.selectionChain[n-1].block && e.to === evidence.selectionChain[n].block));
  }
  const scene = json('web/public/assets/map.scene.json');
  assert.equal(doc.materials.length, 17);
  assert.equal(new Set(doc.materials.map(r => `${r.assetId}/${r.materialId}`)).size, 17);
  assert.equal(doc.placedSectionCount, 950);
  assert.equal(doc.materials.reduce((n,r)=>n+r.placementCount,0), 950);
  let overrideCount = 0;
  for (const recipe of doc.materials) {
    const source = evidence.materials.find(r => r.assetId === recipe.assetId && r.materialId === recipe.materialId);
    assert.equal(recipe.variationHash, 0);
    assert.equal(recipe.placementCount, scene.instances.filter(i => i.assetId === recipe.assetId).length);
    assert.deepEqual(recipe.bindings, source.bindings);
    assert.deepEqual(recipe.constantEvidence, source.constantEvidence);
    assert.deepEqual(recipe.constants, source.constants);
    recipe.constantEvidence.forEach((entry,index) => {
      if(entry.kind === 'exact-section-override') {
        const bytes = Buffer.from(entry.rawHex,'hex');
        assert.deepEqual(recipe.constants[index], [0,4,8,12].map(at => bytes.readFloatLE(at)));
        overrideCount++;
      } else assert.deepEqual(recipe.constants[index], doc.constantMapping[index].default);
    });
  }
  assert.equal(overrideCount,31);
});

test('MetalOnly reuses ten exact native mip payloads and PNGs without texture edits', () => {
  const master = json('web/public/assets/recovered-master1uv-materials.json');
  assert.equal(Object.keys(doc.sourceTextures).length,10);
  for (const [guid,texture] of Object.entries(doc.sourceTextures)) {
    assert.deepEqual(texture,master.sourceTextures[guid]);
    const original=read(texture.sourceDdsPath), selected=read(texture.selectedDdsPath);
    assert.equal(sha(original),texture.sourceDdsSha256);
    assert.equal(sha(selected),texture.selectedDdsSha256);
    assert.deepEqual(selected.subarray(148),original.subarray(texture.sourceDataOffset));
    const png=read(`web/public${texture.url}`);
    assert.equal(sha(png),texture.sha256);
    assert.ok(png.readUInt32BE(16)<=1024 && png.readUInt32BE(20)<=1024);
    assert.ok(texture.url.startsWith('/assets/textures/master1uv/'));
  }
});

test('MetalOnly source math retains saturated detail wear and proven native metalness interpretation', () => {
  assert.equal(METALONLY_GLSL,read('tools/materials/metalonly-equations.glsl').toString());
  assert.equal(sha(Buffer.from(METALONLY_GLSL)),doc.sourceEquationSha256);
  const validation=json('exports/materials/metalonly-shader/equation-validation.json');
  assert.equal(validation.cases,3400);
  assert.ok(validation.normalBlendClampCases>1000);
  assert.ok(validation.maxAbsoluteError<1e-10);
  assert.match(METALONLY_GLSL,/clamp\(wear.r \+ wear.g, 0.0, 1.0\)/);
  assert.match(doc.runtimeMapping.metalness,/Two native gbLayout=0 consumers/);
  assert.equal(doc.nativeMaterialModel.materialId,0);
  assert.equal(doc.nativeMaterialModel.reflectance,.5);
  assert.equal(doc.nativeMaterialModel.dielectricF0,.04);
  assert.equal(doc.nativeMaterialModel.consumers.length,2);
  const producer=read('exports/materials/metalonly-shader/85476b5805.asm').toString();
  for(const op of doc.nativeMaterialModel.producerOperations)assert.ok(producer.includes(op));
  for(const consumer of doc.nativeMaterialModel.consumers) {
    assert.equal(sha(read(`exports/lighting/dfg-gbuffer/${consumer.file}.dxbc`)),consumer.sha256);
    const assembly=read(`exports/lighting/dfg-gbuffer/${consumer.file}.asm`).toString();
    for(const op of consumer.operations)assert.ok(assembly.includes(op));
  }
  assert.match(doc.runtimeMapping.emissive,/None/);
  assert.match(doc.runtimeMapping.normal,/26 matched rigid32\/36\/44-byte/);
  assert.match(doc.runtimeMapping.normal,/unsupported48-byte records retain derivative/);
  const forward=evidence.forwardRoughnessEvidence;
  assert.equal(sha(read(`exports/materials/metalonly-shader/${forward.shader}.dxbc`)),forward.sha256);
  const assembly=read(`exports/materials/metalonly-shader/${forward.shader}.asm`).toString();
  for(const instruction of forward.operations)assert.ok(assembly.includes(instruction));
});

test('real GLTFLoader material extras route all 17 original sections without affecting unrelated sections', async () => {
  const prior=THREE.TextureLoader.prototype.loadAsync, loaded=[];
  THREE.TextureLoader.prototype.loadAsync=async function(url){const texture=new THREE.Texture();texture.name=url;loaded.push(texture);return texture;};
  try {
    const recovered=await prepareRecoveredMetalOnlyMaterials(doc), loader=new GLTFLoader();
    // This test exercises the real geometry/material parser. Image pixel bytes
    // are independently verified above; unrelated section images need no DOM.
    loader.register(() => ({name:'MetalOnlyNodeImageStub',loadTexture(){return Promise.resolve(new THREE.Texture());}}));
    const assets=new Map(json('web/public/assets/map.scene.json').assets.map(a=>[a.id,a]));
    let matched=0, other=0;
    for(const id of new Set(doc.materials.map(r=>r.assetId))) {
      const asset=assets.get(id), bytes=read(`web/public/assets/${asset.url}`);
      const gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
      recovered.apply(gltf,{id:'unrelated'});
      recovered.apply(gltf,asset);
      recovered.apply(gltf,asset);
      gltf.scene.traverse(mesh=>{
        if(!mesh.isMesh)return;
        for(const material of [].concat(mesh.material)) {
          const recipe=doc.materials.find(r=>r.assetId===id&&r.materialId===material.userData.sourceMaterialId);
          assert.equal(!!material.userData.recoveredMetalOnlyShader,!!recipe);
          if(recipe){matched++;assert.ok(mesh.geometry.getAttribute('uv'));assert.equal(material.metalness,0);}
          else other++;
          material.dispose();
        }
        mesh.geometry.dispose();
      });
    }
    assert.equal(recovered.applied,17);
    assert.equal(matched,17);
    assert.ok(other>0);
    assert.equal(loaded.length,10);
    for(const texture of loaded)texture.dispose();
  } finally {THREE.TextureLoader.prototype.loadAsync=prior;}
});

test('MetalOnly shader hooks preserve world coordinates and native probe decoration on instanced batches', async () => {
  const prior=THREE.TextureLoader.prototype.loadAsync,loaded=[];
  THREE.TextureLoader.prototype.loadAsync=async function(url){const texture=new THREE.Texture();texture.name=url;loaded.push(texture);return texture;};
  try {
    const recovered=await prepareRecoveredMetalOnlyMaterials(doc), recipe=doc.materials[0];
    const geometry=new THREE.BoxGeometry(), material=new THREE.MeshStandardMaterial({metalness:.7,emissive:0xff0000});
    material.userData.sourceMaterialId=recipe.materialId;
    const mesh=new THREE.InstancedMesh(geometry,material,2), scene=new THREE.Group();
    mesh.setMatrixAt(0,new THREE.Matrix4().makeTranslation(-919.68,587.52,-319.9382));
    mesh.setMatrixAt(1,new THREE.Matrix4().makeTranslation(-918.68,587.52,-319.9382));
    scene.add(mesh);
    recovered.apply({scene},{id:recipe.assetId});
    const probes=json('web/public/assets/source-probes.json'), bytes=read('web/public/assets/source-probes.bin');
    const lighting=createSourceProbeLighting(probes,new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4));
    lighting.add(mesh);
    const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};
    mesh.material.onBeforeCompile(shader,{});
    assert.equal(material.metalness,0);
    assert.equal(material.emissive.getHex(),0);
    assert.deepEqual(shader.uniforms.bf2_metalonly_cb.value.map(v=>v.toArray()),recipe.constants);
    for(const role of doc.textureMapping.map(x=>x.role))assert.equal(shader.uniforms[`bf2_metalonly_${role}`].value.name,recipe.textures[role]);
    assert.match(shader.vertexShader,/instanceMatrix \* bf2_metalonly_wp/);
    assert.match(shader.vertexShader,/modelMatrix \* bf2_metalonly_wp/);
    assert.ok(!shader.fragmentShader.includes('normalize(bf2_metalonly_geometricNormal)'));
    assert.ok(shader.fragmentShader.includes('irradiance += PI * bf2_probeDiffuse'));
    assert.ok(shader.fragmentShader.includes('reflectedLight.indirectDiffuse *= bf2_metalonly_surface.ao'));
    assert.ok(shader.fragmentShader.includes('metalnessFactor = clamp(bf2_metalonly_surface.materialScalar, 0.0, 1.0)'));
    assert.ok(mesh.material.customProgramCacheKey().includes('SS_DSI_Master_1UV_MetalOnly_01'));
    lighting.dispose();geometry.dispose();material.dispose();for(const texture of loaded)texture.dispose();
  } finally {THREE.TextureLoader.prototype.loadAsync=prior;}
});
