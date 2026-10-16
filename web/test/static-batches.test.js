import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createStaticBatches} from '../src/static-batches.js';
import {CollisionWorld} from '../vendor/vibe-engine/kits/fps/collision-world.js';

test('spatial batches preserve source transforms and isolate distant geometry for culling',()=>{
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(2,2,2),new THREE.MeshBasicMaterial());mesh.position.set(1,2,0);mesh.updateMatrixWorld(true);
  const instances=[0,5,100,105].map(x=>({matrix:new THREE.Matrix4().makeTranslation(x,0,0).toArray()}));
  const batches=createStaticBatches(mesh,instances,{id:'source',collision:true});
  assert.equal(batches.length,2);assert.ok(batches.every(batch=>batch.isInstancedMesh&&batch.count===2));
  assert.ok(batches.every(batch=>batch.boundingBox.max.x-batch.boundingBox.min.x<10));
  const positions=[];for(const batch of batches)for(let index=0;index<batch.count;index++){const matrix=new THREE.Matrix4();batch.getMatrixAt(index,matrix);positions.push(new THREE.Vector3().setFromMatrixPosition(matrix).toArray());}
  assert.deepEqual(positions,[[1,2,0],[6,2,0],[101,2,0],[106,2,0]]);
});

test('source no-physics instances retain visible geometry but are excluded from capsule/ray collision',()=>{
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(1,3,3));mesh.updateMatrixWorld(true);
  const instances=[{matrix:new THREE.Matrix4().makeTranslation(3,1.5,0).toArray(),collision:false},{matrix:new THREE.Matrix4().makeTranslation(8,1.5,0).toArray(),collision:true}];
  const batches=createStaticBatches(mesh,instances,{id:'mixed-source-physics',collision:true});
  assert.equal(batches.length,2);assert.ok(batches.every(batch=>batch.visible));
  const group=new THREE.Group();group.add(...batches);
  const world=CollisionWorld.fromObject3D(group,{filter:object=>object.userData.mapCollision});
  const hit=world.rayIntersect(new THREE.Ray(new THREE.Vector3(0,1.5,0),new THREE.Vector3(1,0,0)),0,20);
  assert.ok(hit);assert.equal(hit.distance,7.5);world.dispose();
});

test('mirrored source placements remain ordinary meshes with their exact negative matrix',()=>{
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(1,1,1));mesh.updateMatrixWorld(true);
  const matrix=new THREE.Matrix4().makeScale(-1,1,1);matrix.setPosition(4,5,6);
  const [batch]=createStaticBatches(mesh,[{matrix:matrix.toArray()}],{id:'mirrored',collision:true});
  assert.equal(batch.isInstancedMesh,undefined);assert.deepEqual(batch.matrix.toArray(),matrix.toArray());
});
