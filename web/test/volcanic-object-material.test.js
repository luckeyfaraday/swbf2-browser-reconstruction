import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {VOLCANIC_OBJECT_GLSL,prepareRecoveredVolcanicObjectMaterials} from '../src/volcanic-object-material.js';
import {VOLCANIC_PRELIGHTING_GLSL,evaluateVolcanicMaterial,evaluateVolcanicPrelighting} from '../src/source-volcanic-prelighting.js';
import {createSourceProbeLighting,createSourceProbeSampler,evaluateSourceSH} from '../src/source-probes.js';
import {createSourceDfgTexture} from '../src/source-dfg.js';
import {isSourceOrdinaryMaterial} from '../src/source-direct-adapter.js';

const root=new URL('../../',import.meta.url),read=path=>fs.readFileSync(new URL(path,root)),json=path=>JSON.parse(read(path));
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const buffer=bytes=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
const doc=json('web/public/assets/recovered-volcanic-object-materials.json'),evidence=json(doc.routingEvidence),scene=json('web/public/assets/map.scene.json');
const shaderFor=material=>{const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};material.onBeforeCompile(shader,{});return shader;};
const unit=v=>{const length=Math.hypot(...v);return v.map(x=>x/length);};
async function withMaterials(run){
  const prior=THREE.TextureLoader.prototype.loadAsync;
  THREE.TextureLoader.prototype.loadAsync=async function(url){const texture=new THREE.Texture();texture.name=url;return texture;};
  let prepared;
  try{prepared=await prepareRecoveredVolcanicObjectMaterials(doc);return await run(prepared);}finally{prepared?.dispose();THREE.TextureLoader.prototype.loadAsync=prior;}
}
async function model(recipe,url){
  const asset=scene.assets.find(row=>row.id===recipe.assetId),loader=new GLTFLoader();
  loader.register(()=>({name:'CpuOriginalImageStub',loadTexture(){return Promise.resolve(new THREE.Texture());}}));
  const gltf=await loader.parseAsync(buffer(read(url?`web/public${url}`:`web/public/assets/${asset.url}`)),'');
  return {asset,gltf};
}

test('Volcanic exact source tree has ten selected sections, native gate constants and no atlas route',()=>{
  assert.equal(sha(read(doc.routingEvidence)),doc.routingSha256);
  assert.equal(sha(read('exports/materials/rvm/0.res')),doc.sourceRvmSha256);
  assert.equal(sha(read('exports/materials/volcanic-object-shader/750135c350.dxbc')),doc.pixelShaderSha256);
  assert.equal(doc.materials.length,10);assert.equal(doc.placedSectionCount,164);
  assert.equal(evidence.tree.words,54);assert.equal(evidence.tree.permutations,4);
  assert.equal(evidence.atlasClassification.selectedFiveAtlasRoute,false);
  assert.deepEqual(evidence.ordinaryFunction.textureMapping.map(row=>row.parameterHash),[882957197,2852436613,2644336517,2644336518]);
  assert.equal(evidence.ordinaryFunction.samplerMapping[0].payloadBlock,'5993a514cd');
  for(const recipe of doc.materials){
    assert.equal(recipe.atlasPixelShader,null);assert.equal(recipe.variationHash,0);
    assert.deepEqual(recipe.candidatePixelShaders,['750135c350','c190a27b27']);
    for(let i=0;i<4;i++){
      const bytes=Buffer.from(recipe.constantEvidence[i].rawHex,'hex');
      assert.deepEqual(recipe.constants[i],[0,4,8,12].map(offset=>bytes.readFloatLE(offset)));
    }
  }
  assert.equal(doc.materials.filter(row=>row.constants[3][0]===0).length,8);
  assert.equal(doc.materials.filter(row=>row.constants[3][0]===1).length,2);
  assert.equal(doc.activeAlternativeLods.length,2);
  for(const lod of doc.activeAlternativeLods){assert.equal(lod.materialParameterBlocksEqual,true);assert.equal(lod.ordinaryPixelShader,doc.pixelShader);assert.equal(lod.atlasPixelShader,null);}
});

test('Volcanic twelve packed textures preserve native mip bytes and source transfer functions',()=>{
  assert.equal(Object.keys(doc.sourceTextures).length,12);
  for(const source of Object.values(doc.sourceTextures)){
    const original=read(source.sourceDdsPath),selected=read(source.selectedDdsPath),png=read(`web/public${source.url}`);
    assert.equal(sha(original),source.sourceDdsSha256);assert.equal(sha(selected),source.selectedDdsSha256);assert.equal(sha(png),source.sha256);
    assert.deepEqual(selected.subarray(148),original.subarray(source.sourceDataOffset));
    assert.deepEqual([png.readUInt32BE(16),png.readUInt32BE(20)],[source.width,source.height]);
    assert.equal(source.colorSpace,[29,72,78,99].includes(source.dxgiFormat)?'srgb':'linear');
  }
});

test('Volcanic compact browser math reproduces all1536 unchanged original PS WARP output scalars',()=>{
  const inputs=read('exports/materials/volcanic-object-shader/warp-input.bin'),outputs=read('exports/materials/volcanic-object-shader/warp-output.bin');
  const proof=json('exports/materials/volcanic-object-shader/warp-execution.json');
  assert.equal(sha(inputs),proof.inputSha256);assert.equal(sha(outputs),proof.outputSha256);assert.equal(proof.pixelShaderSha256,doc.pixelShaderSha256);
  assert.equal(inputs.readUInt32LE(0),0x314f5650);assert.equal(inputs.readUInt32LE(8),82);assert.equal(inputs.readUInt32LE(4),96);
  let maximum=0,earlyNormalMutations=0,gateMutations=0;
  for(let index=0;index<96;index++){
    const v=Array.from({length:82},(_,i)=>inputs.readFloatLE(12+(index*82+i)*4));
    const surface=evaluateVolcanicMaterial({frame:[v.slice(0,3),v.slice(3,6),v.slice(6,9)],constants:Array.from({length:4},(_,i)=>v.slice(14+i*4,18+i*4)),base:v.slice(30,34),normal:v.slice(34,38),metalDetail:v.slice(38,42),fabricDetail:v.slice(42,46)});
    const coefficients=v.slice(46),view=unit([7,3,2].map((x,i)=>x-v[9+i]));
    const lighting=evaluateVolcanicPrelighting(coefficients,surface.prelightingNormal,view,surface.smoothness,surface.broadenedSpecularScale);
    const [x,y,z]=surface.normal;let face,u,w;
    if(Math.abs(z)>=Math.abs(x)&&Math.abs(z)>=Math.abs(y)){face=z<0?5:4;u=z<0?-x:x;w=-y;}
    else if(Math.abs(y)>=Math.abs(x)){face=y<0?3:2;u=x;w=y<0?-z:z;}
    else{face=x<0?1:0;u=x<0?z:-z;w=-y;}
    const target=[u*.5+.5,w*.5+.5,surface.smoothness,0,...surface.color,face*Math.fround(1/6),0,surface.metalness,.5,lighting.skyVisibility,...lighting.rgb,0];
    for(let lane=0;lane<16;lane++){
      const native=outputs.readFloatLE((index*16+lane)*4),error=Math.abs(native-target[lane]);
      assert.ok(Number.isFinite(target[lane]));assert.ok(error<5e-4+5e-5*Math.abs(target[lane]),`case${index} lane${lane}: ${native} vs ${target[lane]}`);maximum=Math.max(maximum,error);
    }
    const early=evaluateVolcanicPrelighting(coefficients,surface.normal,view,surface.smoothness,surface.broadenedSpecularScale);
    earlyNormalMutations+=Math.max(...early.rgb.map((x,i)=>Math.abs(x-lighting.rgb[i])))>1e-3;
    const always=evaluateVolcanicPrelighting(coefficients,surface.prelightingNormal,view,surface.smoothness,1);
    gateMutations+=surface.broadenedSpecularScale===0&&Math.max(...always.rgb.map((x,i)=>Math.abs(x-lighting.rgb[i])))>1e-5;
  }
  assert.ok(maximum<5e-5);assert.ok(earlyNormalMutations>90);assert.ok(gateMutations>2);
});

test('Volcanic zero and negative gate bypass undefined dominant direction while raw-normal SH stays intact',()=>{
  const coefficients=[5,8,12,1,...Array(32).fill(0)],normal=[.8,1.6,-.4],view=unit([1,2,3]);
  for(const gate of [0,-1])assert.deepEqual(evaluateVolcanicPrelighting(coefficients,normal,view,.7,gate),{rgb:[5,8,12],skyVisibility:1});
  assert.ok(evaluateVolcanicPrelighting(coefficients,normal,view,.7,1).rgb.some(x=>!Number.isFinite(x)));
  coefficients[4]=.5;coefficients[8]=1;coefficients[12]=-.3;coefficients[16]=.4;
  assert.deepEqual(evaluateVolcanicPrelighting(coefficients,normal,view,.7,0).rgb,evaluateSourceSH(coefficients,normal));
  const zero=evaluateVolcanicPrelighting(coefficients,normal,view,.7,0),one=evaluateVolcanicPrelighting(coefficients,normal,view,.7,1),two=evaluateVolcanicPrelighting(coefficients,normal,view,.7,2);
  assert.ok(one.rgb[0]>zero.rgb[0]);for(let i=0;i<3;i++)assert.ok(Math.abs((two.rgb[i]-zero.rgb[i])-2*(one.rgb[i]-zero.rgb[i]))<1e-10);
});

test('all ten actual Volcanic GLTF sections and both native LODs route without changing geometry',async()=>withMaterials(async recovered=>{
  let count=0;
  for(const id of new Set(doc.materials.map(row=>row.assetId))){
    const {asset,gltf}=await model(doc.materials.find(row=>row.assetId===id));
    const original=new Map();gltf.scene.traverse(mesh=>{if(mesh.isMesh)original.set(mesh,[mesh.geometry,mesh.geometry.attributes.position,mesh.geometry.attributes.uv,mesh.geometry.index]);});
    recovered.apply(gltf,{id:'unselected'});recovered.apply(gltf,asset);recovered.apply(gltf,asset);
    gltf.scene.traverse(mesh=>{if(!mesh.isMesh)return;assert.deepEqual([mesh.geometry,mesh.geometry.attributes.position,mesh.geometry.attributes.uv,mesh.geometry.index],original.get(mesh));for(const material of [].concat(mesh.material)){
      const selected=doc.materials.find(row=>row.assetId===id&&row.materialId===material.userData.sourceMaterialId);
      assert.equal(!!material.userData.recoveredVolcanicObjectShader,!!selected);
      if(selected){count++;assert.equal(material.map,null);const shader=shaderFor(material);assert.deepEqual(shader.uniforms.bf2_volcanic_object_cb.value.map(v=>v.toArray()),selected.constants);for(const role of ['base','normal','metalDetail','fabricDetail']){const texture=shader.uniforms[`bf2_volcanic_object_${role}`].value;assert.equal(texture.name,selected.textures[role]);assert.equal(texture.wrapS,THREE.RepeatWrapping);}}
    }});
  }
  assert.equal(count,10);assert.equal(recovered.applied,10);
  const lods=json('web/public/assets/source-lods.json');
  for(const row of doc.activeAlternativeLods){const source=lods.assets.find(a=>a.assetId===row.assetId).lods.find(l=>l.level===row.sourceLod);const {asset,gltf}=await model(row,source.url);recovered.apply(gltf,asset);let n=0;gltf.scene.traverse(mesh=>{if(mesh.isMesh&&mesh.material.userData.recoveredVolcanicObjectShader)n++;});assert.equal(n,1);}
  assert.equal(recovered.applied,12);
  assert.equal(VOLCANIC_OBJECT_GLSL,read('tools/materials/volcanic-object-equations.glsl').toString());
  assert.equal(VOLCANIC_PRELIGHTING_GLSL,read('tools/materials/volcanic-object-prelighting.glsl').toString());
}));

test('Volcanic scoped probe hook preserves raw sum and gated SH with and without native DFG',async()=>withMaterials(async recovered=>{
  const dfgDoc=json('web/public/assets/source-dfg.json'),dfg={texture:createSourceDfgTexture(dfgDoc,buffer(read(`web/public${dfgDoc.url}`))),snapshot:()=>({evidenceId:dfgDoc.evidenceId})};
  for(const native of [false,true]){
    const {asset,gltf}=await model(doc.materials[0]);recovered.apply(gltf,asset);
    const probes=createSourceProbeLighting(json('web/public/assets/source-probes.json'),buffer(read('web/public/assets/source-probes.bin')),{dfg:native?dfg:null});
    gltf.scene.position.set(-919.68,587.52,-319.9382);gltf.scene.updateMatrixWorld(true);probes.add(gltf.scene);
    let material;gltf.scene.traverse(mesh=>{if(mesh.isMesh&&mesh.material.userData.recoveredVolcanicObjectShader)material=mesh.material;});
    assert.equal(isSourceOrdinaryMaterial(material),true);const shader=shaderFor(material);
    assert.match(shader.fragmentShader,/bf2_probeVolcanic\(bf2_probeNormalToSource \* bf2_volcanic_object_prelightingNormal,/);
    assert.match(shader.fragmentShader,/if \(broadenedSpecularScale > 0.0\)/);
    assert.ok(!shader.fragmentShader.includes('normalize(bf2_probeNormalToSource * bf2_volcanic_object_prelightingNormal)'));
    assert.match(shader.fragmentShader,/normal = transformDirection\(bf2_volcanic_object_prelightingNormal, viewMatrix\)/);
    assert.match(shader.fragmentShader,/totalEmissiveRadiance = vec3\(0.0\)/);
    assert.ok(!shader.fragmentShader.includes('bf2_staticAtlasOrProbe'));assert.ok(!shader.fragmentShader.includes('bf2_volcanic_object_surface.ao'));
    if(native){assert.match(shader.fragmentShader,/reflectedLight.indirectDiffuse\+=bf2_probeVolcanic\([^;]+\)\*diffuseColor.rgb\*\(1.0-metalnessFactor\)\*bf2_nativeDFG.b/);assert.equal(probes.snapshot().environmentDfgCompiled,1);}
    else assert.match(shader.fragmentShader,/irradiance \+= PI \* bf2_probeVolcanic/);
    probes.dispose();
  }
  dfg.texture.dispose();
}));

test('actual Volcanic positive-gate placements have covered nonzero source probe directions',async()=>{
  const sampler=createSourceProbeSampler(json('web/public/assets/source-probes.json'),buffer(read('web/public/assets/source-probes.bin')));
  let tested=0;
  for(const recipe of doc.materials.filter(row=>row.constants[3][0]>0)){
    const {gltf}=await model(recipe);gltf.scene.updateMatrixWorld(true);
    const meshes=[];gltf.scene.traverse(mesh=>{if(mesh.isMesh&&mesh.material.userData.sourceMaterialId===recipe.materialId)meshes.push(mesh);});
    for(const instance of scene.instances.filter(row=>row.assetId===recipe.assetId))for(const mesh of meshes){
      mesh.geometry.computeBoundingBox();const center=mesh.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(mesh.matrixWorld).applyMatrix4(new THREE.Matrix4().fromArray(instance.matrix));
      const sampled=sampler.sample(center.toArray());assert.notEqual(sampled.volume,null,`${recipe.meshName} ${center.toArray()}`);
      const c=sampled.coefficients,sums=[1,2,3].map(band=>c[band*4]+c[band*4+1]+c[band*4+2]);assert.ok(Math.hypot(...sums)>1e-5);
      // Several nonunit normal/view directions exercise the raw sum without
      // choosing the native undefined view=-dominant half-vector singularity.
      for(const normal of [[.2,1.8,.3],[1.2,.8,-.4],[-.2,.5,1.5]])for(const view of [[1,0,0],[0,0,1],[0,1,0]]){
        const lighting=evaluateVolcanicPrelighting(c,normal,view,.6,recipe.constants[3][0]);assert.ok(lighting.rgb.every(Number.isFinite));
      }
      tested++;
    }
  }
  assert.equal(tested,doc.materials.filter(row=>row.constants[3][0]>0).reduce((sum,row)=>sum+row.placementCount,0));
});
