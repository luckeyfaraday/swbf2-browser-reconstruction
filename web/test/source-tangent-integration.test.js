import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createSourceTangentWitness} from '../src/source-tangent-frame.js';
import {prepareRecoveredMasterMaterials} from '../src/master1uv-material.js';
import {prepareRecoveredMaster2UvMaterials} from '../src/master2uv-material.js';
import {createSourceProbeLighting} from '../src/source-probes.js';
import {createSourceLodController} from '../src/source-lods.js';
import {createSourceLightChannels} from '../src/source-light-channels.js';
import {createStaticBatches} from '../src/static-batches.js';
import {CollisionWorld} from '../vendor/vibe-engine/kits/fps/collision-world.js';

const root=new URL('../../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root)),json=p=>JSON.parse(read(p));
const buffer=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
const doc=json('web/public/assets/native-tangent-witness.json');
const witness=doc.records.filter(row=>row.assetId==='2dfb9f9d-44b0-2147-6a29-d0b0a878ae53'&&row.sourceLod===0);
const primitive=(gltf,index)=>{let found;gltf.scene.traverse(m=>{if(m.isMesh&&gltf.parser.associations.get(m)?.primitives===index)found=m;});return found;};
const shader=()=>({vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}});

async function fixture(run){
  const textureLoad=THREE.TextureLoader.prototype.loadAsync,fileLoad=THREE.FileLoader.prototype.loadAsync,textures=[];
  THREE.TextureLoader.prototype.loadAsync=async function(){const texture=new THREE.Texture();textures.push(texture);return texture;};
  THREE.FileLoader.prototype.loadAsync=async function(url){return buffer(read('web/public'+url));};
  let probes;
  try{
    const gltf=await new GLTFLoader().parseAsync(buffer(read(witness[0].glbPath)),'');
    const tangents=createSourceTangentWitness(doc,buffer(read('web/public'+doc.url)));tangents.applyGeometry(gltf,{id:witness[0].assetId});
    const [master,master2]=await Promise.all([prepareRecoveredMasterMaterials(json('web/public/assets/recovered-master1uv-materials.json')),prepareRecoveredMaster2UvMaterials(json('web/public/assets/recovered-master2uv-materials.json'))]);
    master.apply(gltf,{id:witness[0].assetId});master2.apply(gltf,{id:witness[0].assetId});gltf.scene.updateMatrixWorld(true);
    probes=createSourceProbeLighting(json('web/public/assets/source-probes.json'),buffer(read('web/public/assets/source-probes.bin')));
    return await run({gltf,tangents,probes});
  }finally{THREE.TextureLoader.prototype.loadAsync=textureLoad;THREE.FileLoader.prototype.loadAsync=fileLoad;probes?.dispose();for(const t of textures)t.dispose();}
}

test('both exact material hooks use native forward frames and retain source geometric-normal interpolation',()=>fixture(({gltf,probes})=>{
  const scene=new THREE.Group();
  for(let i=0;i<2;i++){
    const source=primitive(gltf,i),matrix=new THREE.Matrix4().makeScale(2,.3,1.5);matrix.setPosition(-919.68,587.52,-319.9382);
    const batches=createStaticBatches(source,[{matrix:matrix.toArray()},{matrix:matrix.clone().setPosition(-918.68,587.52,-319.9382).toArray()}],{id:witness[0].assetId});
    assert.equal(batches.length,1);assert.ok(batches[0].isInstancedMesh);scene.add(batches[0]);
  }
  probes.add(scene);
  scene.traverse(mesh=>{if(!mesh.isMesh)return;const compiled=shader();mesh.material.onBeforeCompile(compiled,{});
    const prefix=mesh.material.userData.recoveredMaster1UVShader?'bf2_master':'bf2_master2uv';
    assert.match(compiled.vertexShader,/#define BF2_SOURCE_TANGENT_FRAME 1/);
    assert.match(compiled.vertexShader,/bf2_sourceFrameMatrix = mat3\(modelMatrix\)/);
    assert.match(compiled.vertexShader,/bf2_sourceFrameMatrix \* mat3\(instanceMatrix\)/);
    assert.ok(compiled.vertexShader.includes(`bf2_sourceT, bf2_sourceB, ${prefix}_geometricNormal`));
    assert.ok(!compiled.vertexShader.includes(`${prefix}_geometricNormal = inverseTransformDirection`));
    assert.ok(!compiled.fragmentShader.includes(`normalize(${prefix}_geometricNormal)`));
    assert.ok(!compiled.fragmentShader.includes(`${prefix}_tbn(-vViewPosition`));
    assert.match(compiled.fragmentShader,/normal = \(viewMatrix \* vec4\(bf2_sourceWorldMappedNormal, 0.0\)\).xyz/);
    assert.match(mesh.material.customProgramCacheKey(),/nativeTangent:true/);
    assert.equal(mesh.geometry.attributes.bf2SourceTangent.count,mesh.geometry.attributes.normal.count);
  });
  assert.deepEqual(Object.fromEntries(['nativeDraws','nativeInstances','nativeMaterials','mismatches'].map(k=>[k,probes.snapshot().sourceTangents[k]])),{nativeDraws:2,nativeInstances:4,nativeMaterials:2,mismatches:0});
  assert.equal(probes.snapshot().sourceTangents.nativeCompiled,2);
}));

test('shared source material gets separate uncovered permutation and LOD transitions preserve lighting, probes and collision',()=>fixture(({gltf,probes})=>{
  const source=primitive(gltf,0),high=source.geometry,uncovered=high.clone();
  // BufferGeometry.clone deliberately shares userData; this fixture represents
  // a different source LOD and therefore needs independent provenance.
  uncovered.userData={...uncovered.userData};uncovered.deleteAttribute('bf2SourceTangent');delete uncovered.userData.sourceTangentWitness;
  // Same geometry topology deliberately isolates the shading-coverage change.
  // This is a transition fixture, not a newly recovered native LOD.
  const near=new THREE.Mesh(high,source.material),other=new THREE.Mesh(uncovered,source.material),scene=new THREE.Scene();
  scene.add(near,other,new THREE.PointLight());probes.add(scene);
  const nativeMaterial=near.material,derivativeMaterial=other.material;
  assert.notEqual(nativeMaterial,derivativeMaterial);assert.equal(nativeMaterial.userData.sourceTangentFrame.enabled,true);assert.equal(derivativeMaterial.userData.sourceTangentFrame.enabled,false);
  const collision=CollisionWorld.fromObject3D(near),beforeGeometry=near.geometry,beforeNormal=beforeGeometry.attributes.normal,assignments=probes.snapshot().assignments;
  const collisionGeometry=collision.geometry,collisionBvh=collision.geometry.boundsTree;
  const triangle=new THREE.Triangle(...[0,1,2].map(i=>new THREE.Vector3().fromBufferAttribute(beforeGeometry.attributes.position,beforeGeometry.index.getX(i))));
  const direction=triangle.getNormal(new THREE.Vector3()),ray=new THREE.Ray(triangle.getMidpoint(new THREE.Vector3()).addScaledVector(direction,1),direction.negate());
  const collisionHit=collision.rayIntersect(ray);assert.ok(collisionHit);
  const lods=createSourceLodController([{mesh:near,assetId:witness[0].assetId,levels:[{level:1,distance:10,geometry:uncovered}]}],{
    adaptGeometry:(mesh,geometry)=>probes.adaptGeometry(mesh,geometry),adaptMaterial:(mesh,geometry)=>probes.adaptMaterial(mesh,geometry)});
  const channels=createSourceLightChannels(1,0);channels.decorate(scene);
  assert.deepEqual(new Set(near.sourceLodMaterials),new Set([nativeMaterial,derivativeMaterial]));
  const compiled=shader();derivativeMaterial.onBeforeCompile(compiled,{});assert.match(compiled.fragmentShader,/bf2_pointChannels\[i\]/);assert.ok(!compiled.vertexShader.includes('BF2_SOURCE_TANGENT_FRAME'));
  const decorated=channels.snapshot().materials;channels.decorate(scene);assert.equal(channels.snapshot().materials,decorated);
  const offset=near.geometry.attributes.bf2_probeOffset.getX(0),key=nativeMaterial.customProgramCacheKey();
  lods.update(new THREE.Vector3(50,0,0));assert.equal(near.material,derivativeMaterial);assert.ok(!near.geometry.attributes.bf2SourceTangent);
  assert.equal(near.geometry.attributes.bf2_probeOffset.getX(0),offset);assert.equal(probes.snapshot().assignments,assignments);
  assert.equal(probes.snapshot().sourceTangents.mismatches,0);
  for(const mode of ['original','flat','bypass','smooth']){const geometry=near.geometry;probes.setDiagnosticMode(mode);assert.equal(near.geometry,geometry);assert.equal(near.material.userData.sourceTangentFrame.enabled,false);}
  lods.update(new THREE.Vector3());assert.equal(near.geometry,beforeGeometry);assert.equal(near.material,nativeMaterial);assert.equal(near.geometry.attributes.normal,beforeNormal);
  assert.equal(nativeMaterial.customProgramCacheKey(),key);assert.equal(probes.snapshot().sourceTangents.mismatches,0);
  const again=shader();nativeMaterial.onBeforeCompile(again,{});assert.match(again.vertexShader,/BF2_SOURCE_TANGENT_FRAME/);assert.match(again.fragmentShader,/bf2_pointChannels\[i\]/);
  assert.equal(collision.geometry,collisionGeometry);assert.equal(collision.geometry.boundsTree,collisionBvh);
  assert.deepEqual(collision.rayIntersect(ray),collisionHit); // Render selections cannot change the original collision result.
  collision.dispose();
}));
