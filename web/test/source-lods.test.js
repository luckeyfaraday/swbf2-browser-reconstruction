import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {createSourceLodController} from '../src/source-lods.js';
import {createSourceProbeLighting} from '../src/source-probes.js';
import {CollisionWorld} from '../vendor/vibe-engine/kits/fps/collision-world.js';

test('native LOD selection preserves near batch instances and restores original geometry with hysteresis',()=>{
  const high=new THREE.BoxGeometry(1,1,1,4,4,4),low=new THREE.BoxGeometry(),lowest=new THREE.PlaneGeometry();
  const mesh=new THREE.InstancedMesh(high,new THREE.MeshStandardMaterial(),2);
  mesh.setMatrixAt(0,new THREE.Matrix4());mesh.setMatrixAt(1,new THREE.Matrix4().makeTranslation(20,0,0));
  const lods=createSourceLodController([{mesh,assetId:'fixture',levels:[{level:1,distance:10,geometry:low},{level:2,distance:30,geometry:lowest}]}]);
  lods.update(new THREE.Vector3());assert.equal(mesh.geometry,high);
  lods.update(new THREE.Vector3(50,0,0));assert.equal(mesh.geometry,lowest);
  lods.update(new THREE.Vector3(49,0,0));assert.equal(mesh.geometry,lowest,'inward deadband prevents repeated swaps');
  lods.update(new THREE.Vector3(46,0,0));assert.equal(mesh.geometry,low);
  lods.configure({enabled:false});lods.update(new THREE.Vector3(80,0,0));assert.equal(mesh.geometry,high);
  lods.configure({enabled:true});lods.update(new THREE.Vector3(80,0,0));assert.equal(mesh.geometry,lowest);
  assert.equal(lods.snapshot().assets,1);assert.ok(lods.snapshot().triangles<lods.snapshot().lod0Triangles);
});

test('render LOD swaps leave baked collision and material identities unchanged',()=>{
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(10,.2,10),new THREE.MeshStandardMaterial());
  const material=mesh.material,collision=CollisionWorld.fromObject3D(mesh),ray=new THREE.Ray(new THREE.Vector3(4,3,4),new THREE.Vector3(0,-1,0));
  const before=collision.rayIntersect(ray,0,5),low=new THREE.PlaneGeometry(.1,.1);
  const lods=createSourceLodController([{mesh,assetId:'fixture',levels:[{level:1,distance:5,geometry:low}]}]);
  lods.update(new THREE.Vector3(20,0,0));
  assert.equal(mesh.geometry,low);assert.equal(mesh.material,material);
  const after=collision.rayIntersect(ray,0,5);assert.equal(after.distance,before.distance);assert.ok(Math.abs(after.distance-2.9)<1e-6);
  collision.dispose();
});

test('lower native geometry reuses source probe rows and sampling assignments without duplicate shader decoration',()=>{
  const document=JSON.parse(fs.readFileSync(new URL('../public/assets/source-probes.json',import.meta.url)));
  const data=fs.readFileSync(new URL('../public/assets/source-probes.bin',import.meta.url));
  const lighting=createSourceProbeLighting(document,new Float32Array(data.buffer,data.byteOffset,data.byteLength/4));
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(1,1,1,4,4,4),new THREE.MeshStandardMaterial());
  mesh.position.set(-919.68,587.52,-319.9382);lighting.add(mesh);
  const old=lighting.snapshot(),material=mesh.material,offset=mesh.geometry.attributes.bf2_probeOffset.getX(0),low=new THREE.BoxGeometry();
  const lods=createSourceLodController([{mesh,assetId:'fixture',levels:[{level:1,distance:5,geometry:low}]}],{adaptGeometry:(mesh,geometry)=>lighting.adaptGeometry(mesh,geometry)});
  lods.update(new THREE.Vector3());
  assert.equal(mesh.geometry.attributes.position,low.attributes.position);
  assert.equal(mesh.geometry.attributes.bf2_probeOffset.count,low.attributes.position.count);
  assert.ok([...mesh.geometry.attributes.bf2_probeOffset.array].every(value=>value===offset));
  assert.equal(mesh.material,material);assert.equal(lighting.snapshot().assignments,old.assignments);
  assert.equal(lighting.snapshot().decoratedMaterials,old.decoratedMaterials);assert.equal(lighting.snapshot().sampled,old.sampled);
  const selected=mesh.geometry;
  for(const mode of ['original','flat','bypass','smooth']){lighting.setDiagnosticMode(mode);assert.equal(mesh.geometry,selected,'probe diagnostics must retain the selected source LOD');}
  assert.equal(mesh.material,material);
  lighting.dispose();
});
