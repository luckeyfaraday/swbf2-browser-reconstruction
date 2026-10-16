import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {PROPSNONMETAL_GLSL,evaluatePropsNonmetalSurface,prepareRecoveredPropsNonmetalMaterials} from '../src/propsnonmetal-material.js';
import {evaluateVolcanicPrelighting} from '../src/source-volcanic-prelighting.js';
import {createSourceProbeSampler,createSourceProbeLighting} from '../src/source-probes.js';
import {createSourceDfgTexture} from '../src/source-dfg.js';
import {isSourceOrdinaryMaterial} from '../src/source-direct-adapter.js';

const root=new URL('../../',import.meta.url),read=path=>fs.readFileSync(new URL(path,root)),json=path=>JSON.parse(read(path));
const sha=value=>crypto.createHash('sha256').update(value).digest('hex'),buffer=bytes=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
const doc=json('web/public/assets/recovered-propsnonmetal-materials.json'),evidence=json(doc.routingEvidence),scene=json('web/public/assets/map.scene.json');
const unit=v=>{const length=Math.hypot(...v);return v.map(x=>x/length);};
const shaderFor=material=>{const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};material.onBeforeCompile(shader,{});return shader;};
async function withMaterials(run){
  const prior=THREE.TextureLoader.prototype.loadAsync;
  THREE.TextureLoader.prototype.loadAsync=async function(url){const texture=new THREE.Texture();texture.name=url;return texture;};
  let prepared;
  try{prepared=await prepareRecoveredPropsNonmetalMaterials(doc);return await run(prepared);}finally{prepared?.dispose();THREE.TextureLoader.prototype.loadAsync=prior;}
}
async function model(recipe){
  const asset=scene.assets.find(row=>row.id===recipe.assetId),loader=new GLTFLoader();loader.register(()=>({name:'CpuOriginalImageStub',loadTexture(){return Promise.resolve(new THREE.Texture());}}));
  return {asset,gltf:await loader.parseAsync(buffer(read(`web/public/assets/${asset.url}`)),'')};
}

test('PropsNonmetal exact source routing proves nineteen atlas sections and excludes three ordinary-only sections',()=>{
  assert.equal(sha(read(doc.routingEvidence)),doc.routingSha256);assert.equal(sha(read('exports/materials/rvm/0.res')),doc.sourceRvmSha256);
  assert.equal(sha(read('exports/materials/propsnonmetal-shader/1e3d99cec3.dxbc')),doc.pixelShaderSha256);
  assert.equal(doc.materials.length,22);assert.equal(doc.placedSectionCount,122);assert.equal(doc.activeAlternativeLods.length,0);
  assert.equal(evidence.tree.words,267);assert.equal(evidence.tree.permutations,46);
  const recipe=json('exports/materials/propsnonmetal-shader/integration-recipe.json'),parity=json(recipe.parityEvidence);
  assert.equal(recipe.eligibleSections.length,19);assert.equal(recipe.excludedSections.length,3);
  assert.equal(sha(read('exports/materials/propsnonmetal-shader/1c6f05ad3a.dxbc')),recipe.pixelShaderSha256);
  assert.equal(Object.keys(parity.materialExpressions).length,6);assert.equal(parity.commonAtlasKernelExpressions.length,3);
  assert.equal(recipe.materialAO.applications,0);assert.equal(recipe.materialAO.doNotMultiplyInsideAtlasHelper,true);
  for(const row of doc.materials){
    assert.equal(row.ordinaryPixelShader,doc.pixelShader);assert.deepEqual(Object.keys(row.bindings),Object.keys(row.textures));
    assert.deepEqual(Object.values(row.bindings).map(b=>b.parameterHash).sort(),[5861109,5861212]);
    assert.equal(row.unboundSourceTextures.length,1);assert.equal(row.unboundSourceTextures[0].parameterHash,1348375853);
  }
});

test('PropsNonmetal source textures preserve packed mips, exact payload hashes and transfer functions',()=>{
  assert.equal(Object.keys(doc.sourceTextures).length,12);
  for(const source of Object.values(doc.sourceTextures)){
    const original=read(source.sourceDdsPath),selected=read(source.selectedDdsPath),png=read(`web/public${source.url}`);
    assert.equal(sha(original),source.sourceDdsSha256);assert.equal(sha(selected),source.selectedDdsSha256);assert.equal(sha(png),source.sha256);
    assert.deepEqual(selected.subarray(148),original.subarray(source.sourceDataOffset));
    assert.deepEqual([png.readUInt32BE(16),png.readUInt32BE(20)],[source.width,source.height]);assert.equal(source.colorSpace,[29,72,78,99].includes(source.dxgiFormat)?'srgb':'linear');
  }
});

test('PropsNonmetal browser equations and shared SH helper reproduce all original WARP MRT outputs',()=>{
  const inputs=read('exports/materials/propsnonmetal-shader/warp-input.bin'),outputs=read('exports/materials/propsnonmetal-shader/warp-output.bin'),proof=json('exports/materials/propsnonmetal-shader/warp-execution.json');
  assert.equal(sha(inputs),proof.inputSha256);assert.equal(sha(outputs),proof.outputSha256);assert.equal(proof.pixelShaderSha256,doc.pixelShaderSha256);
  assert.equal(inputs.readUInt32LE(4),96);assert.equal(outputs.length,96*16*4);
  let max=0,noSpecularMutation=0;
  for(let index=0;index<96;index++){
    const v=Array.from({length:82},(_,i)=>inputs.readFloatLE(12+(index*82+i)*4));
    const surface=evaluatePropsNonmetalSurface(v.slice(30,34),v.slice(34,38),[v.slice(0,3),v.slice(3,6),v.slice(6,9)]),view=unit([7,3,2].map((x,i)=>x-v[9+i]));
    const lighting=evaluateVolcanicPrelighting(v.slice(46),surface.normal,view,surface.smoothness,1),noSpecular=evaluateVolcanicPrelighting(v.slice(46),surface.normal,view,surface.smoothness,0);
    noSpecularMutation+=Math.max(...lighting.rgb.map((x,i)=>Math.abs(x-noSpecular.rgb[i])))>1e-5;
    const [x,y,z]=surface.normal;let face,u,w;
    if(Math.abs(z)>=Math.abs(x)&&Math.abs(z)>=Math.abs(y)){face=z<0?5:4;u=z<0?-x:x;w=-y;}
    else if(Math.abs(y)>=Math.abs(x)){face=y<0?3:2;u=x;w=y<0?-z:z;}
    else{face=x<0?1:0;u=x<0?z:-z;w=-y;}
    const target=[u*.5+.5,w*.5+.5,surface.smoothness,0,...surface.color,face*Math.fround(1/6),0,0,.5,lighting.skyVisibility,...lighting.rgb,0];
    for(let lane=0;lane<16;lane++){const actual=outputs.readFloatLE((index*16+lane)*4),error=Math.abs(actual-target[lane]);assert.ok(Number.isFinite(target[lane]));assert.ok(error<5e-4+5e-5*Math.abs(target[lane]),`case${index} lane${lane}`);max=Math.max(max,error);}
  }
  assert.ok(max<5e-5);assert.ok(noSpecularMutation>20);
  const replay=json('exports/materials/propsnonmetal-shader/equation-validation.json');assert.equal(replay.cases,2000);assert.ok(replay.maximumAbsoluteError<1e-8);
  assert.equal(replay.mutationDetections.normalBlue,2000);assert.equal(replay.mutationDetections.wrongSmoothness,2000);assert.ok(replay.mutationDetections.noBroadenedSpecular>800);
});

test('all twenty-two actual PropsNonmetal GLTF sections bind only source CS/NW and preserve unrelated geometry',async()=>withMaterials(async recovered=>{
  let count=0;
  for(const id of new Set(doc.materials.map(row=>row.assetId))){
    const {asset,gltf}=await model(doc.materials.find(row=>row.assetId===id));const original=new Map();
    gltf.scene.traverse(mesh=>{if(mesh.isMesh)original.set(mesh,[mesh.geometry,mesh.geometry.attributes.position,mesh.geometry.attributes.uv,mesh.geometry.index]);});
    recovered.apply(gltf,{id:'unselected'});recovered.apply(gltf,asset);recovered.apply(gltf,asset);
    gltf.scene.traverse(mesh=>{if(!mesh.isMesh)return;assert.deepEqual([mesh.geometry,mesh.geometry.attributes.position,mesh.geometry.attributes.uv,mesh.geometry.index],original.get(mesh));for(const material of [].concat(mesh.material)){
      const selected=doc.materials.find(row=>row.assetId===id&&row.materialId===material.userData.sourceMaterialId);assert.equal(!!material.userData.recoveredPropsNonmetalShader,!!selected);
      if(selected){count++;assert.equal(material.metalness,0);assert.equal(material.map,null);const shader=shaderFor(material);for(const role of ['base','normal']){const texture=shader.uniforms[`bf2_propsnonmetal_${role}`].value;assert.equal(texture.name,selected.textures[role]);assert.equal(texture.wrapS,THREE.RepeatWrapping);}assert.match(shader.fragmentShader,/normal=normalize\(bf2_propsnonmetal_frame\*bf2_propsnonmetal_surface.tangentNormal\)/);}
    }});
  }
  assert.equal(count,22);assert.equal(recovered.applied,22);assert.equal(PROPSNONMETAL_GLSL,read('tools/materials/propsnonmetal-equations.glsl').toString());
}));

test('PropsNonmetal actual section centers have covered nonzero SH directions for ordinary fallback',async()=>{
  const sampler=createSourceProbeSampler(json('web/public/assets/source-probes.json'),buffer(read('web/public/assets/source-probes.bin')));let tested=0;
  for(const recipe of doc.materials){
    const {gltf}=await model(recipe);gltf.scene.updateMatrixWorld(true);const meshes=[];
    gltf.scene.traverse(mesh=>{if(mesh.isMesh&&[].concat(mesh.material).some(m=>m.userData.sourceMaterialId===recipe.materialId))meshes.push(mesh);});
    for(const instance of scene.instances.filter(row=>row.assetId===recipe.assetId))for(const mesh of meshes){
      mesh.geometry.computeBoundingBox();const center=mesh.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(mesh.matrixWorld).applyMatrix4(new THREE.Matrix4().fromArray(instance.matrix));
      const sampled=sampler.sample(center.toArray());assert.notEqual(sampled.volume,null,`${recipe.meshName} ${center.toArray()}`);
      const c=sampled.coefficients;assert.ok(Math.hypot(...[1,2,3].map(b=>c[b*4]+c[b*4+1]+c[b*4+2]))>1e-5);
      for(const normal of [[1,0,0],[0,1,0],[0,0,1]])assert.ok(evaluateVolcanicPrelighting(c,normal,unit([1,2,3]),.6,1).rgb.every(Number.isFinite));tested++;
    }
  }
  assert.equal(tested,122);
});

test('PropsNonmetal ordinary lighting retains always-on broadened SH with native DFG and direct classification',async()=>withMaterials(async recovered=>{
  const dfgDoc=json('web/public/assets/source-dfg.json'),dfg={texture:createSourceDfgTexture(dfgDoc,buffer(read(`web/public${dfgDoc.url}`))),snapshot:()=>({evidenceId:dfgDoc.evidenceId})};
  for(const native of [false,true]){
    const {asset,gltf}=await model(doc.materials[0]);recovered.apply(gltf,asset);const probes=createSourceProbeLighting(json('web/public/assets/source-probes.json'),buffer(read('web/public/assets/source-probes.bin')),{dfg:native?dfg:null});
    gltf.scene.position.set(-919.68,587.52,-319.9382);gltf.scene.updateMatrixWorld(true);probes.add(gltf.scene);
    let material;gltf.scene.traverse(mesh=>{if(mesh.isMesh&&mesh.material.userData.recoveredPropsNonmetalShader)material=mesh.material;});assert.equal(isSourceOrdinaryMaterial(material),true);
    const shader=shaderFor(material);assert.match(shader.fragmentShader,/bf2_probeVolcanic\(normalize\(bf2_probeNormalToSource \* inverseTransformDirection\(geometryNormal,viewMatrix\)\),[^;]+bf2_propsnonmetal_surface.smoothness,1.0\)/);
    assert.match(shader.fragmentShader,/totalEmissiveRadiance=vec3\(0.0\)/);
    // metalnessFactor is declared by the metalnessmap chunk; assigning it earlier fails GLSL compilation.
    const metalDeclared=shader.fragmentShader.indexOf('#include <metalnessmap_fragment>'),metalAssigned=shader.fragmentShader.indexOf('metalnessFactor=0.0;');assert.ok(metalDeclared>=0&&metalAssigned>metalDeclared);assert.ok(!shader.fragmentShader.includes('bf2_propsnonmetal_surface.ao'));
    if(native){assert.match(shader.fragmentShader,/reflectedLight.indirectDiffuse\+=bf2_probeVolcanic\([^;]+\)\*diffuseColor.rgb\*\(1.0-metalnessFactor\)\*bf2_nativeDFG.b/);assert.equal(probes.snapshot().environmentDfgCompiled,1);}
    else assert.match(shader.fragmentShader,/irradiance \+= PI \* bf2_probeVolcanic/);
    probes.dispose();
  }
  dfg.texture.dispose();
}));
