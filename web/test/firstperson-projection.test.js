import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createFirstPersonViewmodel} from '../src/firstperson.js';
import {createFirstPersonProjection,resolveFirstPersonProjection} from '../src/firstperson-projection.js';

const bytes=path=>fs.readFileSync(new URL(path,import.meta.url));
const json=path=>JSON.parse(bytes(path));
const sha=value=>createHash('sha256').update(value).digest('hex');
const document=json('../public/assets/firstperson-projection.json');
const evidence=json(`../../${document.provenance.evidenceFile}`);
const models=json('../public/assets/firstperson-weapons.json').models;
const near=(a,b,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<tolerance,`${a} differs from ${b}`);

async function loadSource(descriptor) {
  const raw=bytes(`../public/assets/${descriptor.url}`),length=raw.readUInt32LE(12);
  const doc=JSON.parse(raw.subarray(20,20+length));
  // Preserve actual mesh, skins, animation and rig. Texture loading alone needs
  // DOM APIs, so remove those bindings in memory for this CPU-only regression.
  doc.materials=(doc.materials??[]).map(m=>({name:m.name,pbrMetallicRoughness:{baseColorFactor:[1,1,1,1]}}));
  delete doc.images;delete doc.textures;delete doc.samplers;
  const encoded=Buffer.from(JSON.stringify(doc)),padded=Buffer.alloc((encoded.length+3)&~3,32);encoded.copy(padded);
  const header=Buffer.from(raw.subarray(0,20)),tail=raw.subarray(20+length);
  header.writeUInt32LE(20+padded.length+tail.length,8);header.writeUInt32LE(padded.length,12);
  const rebuilt=Buffer.concat([header,padded,tail]);
  return {descriptor,gltf:await new GLTFLoader().parseAsync(rebuilt.buffer.slice(rebuilt.byteOffset,rebuilt.byteOffset+rebuilt.byteLength),'')};
}
const sources=await Promise.all(models.map(loadSource));

test('render FOV evidence retains exact selected source references and native model-state bytes',()=>{
  assert.equal(evidence.runtimeObserved,false);
  assert.equal(sha(bytes(`../../${document.provenance.evidenceFile}`)),document.provenance.evidenceSha256);
  const documents=new Map(evidence.sources.map(source=>{
    assert.equal(sha(bytes(`../../${source.file}`)),source.jsonSha256);
    return [source.guid,json(`../../${source.file}`)];
  }));
  for(const row of evidence.observations){
    const actual=row.jsonPointer.split('/').slice(1).reduce((value,key)=>value[key],documents.get(row.sourceGuid));
    assert.deepEqual(actual,row.value);
  }
  for(const row of evidence.links){
    const objects=documents.get(row.sourceGuid).asset.objects,from=objects.find(o=>o.$id===row.objectId);
    assert.ok(from[row.field].some(ref=>ref.$ref===row.targetObjectId));
    assert.ok(objects.some(o=>o.$id===row.targetObjectId&&o.RenderFov===55));
  }
  for(const fn of evidence.functions)assert.equal(sha(bytes(`../../${fn.file}`)),fn.sha256);
  const target=fs.openSync(evidence.target,'r');
  try{
    for(const row of [...evidence.fields.map(f=>f.record),...evidence.pointers.map(p=>p.record),...evidence.functions.map(f=>f.nativeSpan)]){
      const expected=Buffer.from(row.bytes,'hex'),actual=Buffer.alloc(expected.length);
      assert.equal(fs.readSync(target,actual,0,actual.length,row.fileOffset),actual.length);
      assert.deepEqual(actual,expected,row.address);
    }
  }finally{fs.closeSync(target);}
});

test('source guard distinguishes observed values from inferred renderer composition',()=>{
  for(const id of ['primary','rebel-a280']){
    const resolved=resolveFirstPersonProjection(document,id);
    assert.deepEqual(resolved.renderFov,[55,55]);
    assert.equal(resolved.browserPolicy.axisStatus,'inferred-from-recovered-world-camera-convention');
    assert.equal(resolved.browserPolicy.userScale,1);
    assert.match(resolved.provenance.inferred,/unresolved/);
  }
  assert.equal(resolveFirstPersonProjection(document,'fixture'),null);
  assert.equal(resolveFirstPersonProjection(document,'primary',{sourceGuid:'fixture-guid'}),null);
  assert.throws(()=>createFirstPersonProjection(document,'fixture'));
});

test('actual E11 and A280 skinned vertices retain projected size through world ADS and moving camera parents',()=>{
  for(const found of sources)for(const aspect of [4/3,16/9,21/9]){
    const view=createFirstPersonViewmodel(found),projection=createFirstPersonProjection(document,found.descriptor.weaponId);
    const scene=new THREE.Scene(),parent=new THREE.Group(),world=new THREE.PerspectiveCamera(55,aspect,.06,1500);
    parent.position.set(13,4,-8);parent.rotation.set(.1,.7,-.05);parent.add(world);scene.add(parent);
    world.position.set(1,2,3);world.rotation.set(-.17,.3,0);world.add(view.root);
    projection.bind(view.root);view.update(0,{alive:true});scene.updateMatrixWorld(true);
    projection.update(world);
    const samples=[];
    view.root.traverse(mesh=>{
      if(!mesh.isMesh)return;
      const count=mesh.geometry.attributes.position.count;
      assert.equal(mesh.frustumCulled,false,'world ADS frustum must not cull corrected viewmodels');
      for(let index=0;index<count;index+=Math.max(1,Math.floor(count/127))){
        const point=mesh.getVertexPosition(index,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
        const local=point.clone().applyMatrix4(world.matrixWorldInverse);
        if(local.z<-.06)samples.push({mesh,index,reference:point.clone().project(projection.camera)});
      }
    });
    assert.ok(samples.length>100,'sample original arms and weapon skin geometry');
    const muzzle=view.snapshot().muzzles[0];assert.ok(muzzle.every(Number.isFinite));
    let uncorrectedMoves=0;
    for(const fov of [55,46,33,23.9]){
      world.fov=fov;world.updateProjectionMatrix();
      parent.position.x+=3;parent.rotation.y+=.13;scene.updateMatrixWorld(true);
      const before=[...world.projectionMatrix.elements];projection.update(world,{aiming:fov!==55});
      assert.deepEqual(world.projectionMatrix.elements,before,'world projection is unchanged');
      const correction=projection.snapshot().scale;
      for(const sample of samples){
        const point=sample.mesh.getVertexPosition(sample.index,new THREE.Vector3()).applyMatrix4(sample.mesh.matrixWorld);
        const uncorrected=point.clone().project(world),corrected=uncorrected.clone();
        corrected.x*=correction[0];corrected.y*=correction[1];
        const expected=point.clone().project(projection.camera);
        near(corrected.x,expected.x);near(corrected.y,expected.y);near(corrected.z,expected.z);
        // Source inverse-bind matrices are float32; reparented skin operations
        // introduce small round-off beyond double-only projection arithmetic.
        // Screen positions must remain within 0.2px at 2000px resolution.
        near(corrected.x,sample.reference.x,2e-4);near(corrected.y,sample.reference.y,2e-4);near(corrected.z,sample.reference.z,2e-4);
        if(fov===23.9&&Math.abs(uncorrected.x-corrected.x)>.01)uncorrectedMoves++;
      }
    }
    assert.ok(uncorrectedMoves>20,'test must catch accidental use of world ADS projection');
    projection.dispose();
  }
});

test('only cloned viewmodel materials receive projection, prior hooks survive, and disposal restores shared material',()=>{
  const original=new THREE.MeshStandardMaterial(),worldMesh=new THREE.Mesh(new THREE.BoxGeometry(),original);
  let invoked=0,disposed=0;
  original.onBeforeCompile=shader=>{invoked++;shader.fragmentShader+='\n// retained source material';};
  const root=new THREE.Group(),a=new THREE.Mesh(new THREE.BoxGeometry(),original),b=new THREE.Mesh(new THREE.BoxGeometry(),[original]);
  root.add(a,b);
  const projection=createFirstPersonProjection(document,'primary');projection.bind(root);
  assert.equal(worldMesh.material,original);assert.notEqual(a.material,original);assert.notEqual(b.material[0],original);
  assert.equal(worldMesh.frustumCulled,true);assert.equal(a.frustumCulled,false);assert.equal(b.frustumCulled,false);
  const shaders=[];
  for(const material of [a.material,b.material[0]]){
    material.addEventListener('dispose',()=>disposed++);
    const shader={uniforms:{},vertexShader:'#include <project_vertex>\n#include <logdepthbuf_vertex>',fragmentShader:''};
    material.onBeforeCompile(shader);shaders.push(shader);
    assert.match(shader.vertexShader,/gl_Position.xy \*=/);assert.match(shader.vertexShader,/#include <logdepthbuf_vertex>/);
    assert.match(shader.fragmentShader,/retained source material/);
  }
  assert.equal(invoked,2);assert.equal(shaders[0].uniforms.bf2FirstPersonProjectionScale,shaders[1].uniforms.bf2FirstPersonProjectionScale);
  const camera=new THREE.PerspectiveCamera(23.9,16/9,.06,1500);projection.update(camera,{aiming:true});
  const uniform=shaders[0].uniforms.bf2FirstPersonProjectionScale.value;
  assert.ok(uniform.x<.5&&uniform.y<.5);assert.equal(projection.snapshot().renderFov,55);
  assert.throws(()=>projection.bind(root));assert.throws(()=>projection.update(new THREE.OrthographicCamera()));
  projection.dispose();assert.equal(disposed,2);assert.equal(a.material,original);assert.deepEqual(b.material,[original]);
  assert.equal(a.frustumCulled,true);assert.equal(b.frustumCulled,true);
  assert.equal(projection.snapshot().boundMeshes,0);assert.equal(worldMesh.material,original);
});

test('projection follows viewport resizing and preserves clip depth while gameplay world FOV changes',()=>{
  const projection=createFirstPersonProjection(document,'rebel-a280'),world=new THREE.PerspectiveCamera(23.9,16/9,.06,1500);
  const point=new THREE.Vector3(.2,-.1,-.7),ys=[];
  for(const aspect of [4/3,16/9,21/9]){
    world.aspect=aspect;world.updateProjectionMatrix();projection.update(world,{aiming:true});
    const target=point.clone().project(projection.camera),actual=point.clone().project(world);
    const [x,y]=projection.snapshot().scale;actual.x*=x;actual.y*=y;
    near(actual.x,target.x);near(actual.y,target.y);near(actual.z,target.z);ys.push(actual.y);
  }
  near(ys[0],ys[1]);near(ys[1],ys[2]);
});
