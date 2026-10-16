import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {prepareSourceDoors} from '../src/source-doors.js';

const root=new URL('../../',import.meta.url),bytes=file=>fs.readFileSync(new URL(file,root)),json=file=>JSON.parse(bytes(file));
const document=json('web/public/assets/source-doors.json'),manifest=json('web/public/assets/map.scene.json');
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
async function models() {
  const loader=new GLTFLoader();loader.register(()=>({name:'DoorNodeTextureStub',loadTexture(){return Promise.resolve(new THREE.Texture());}}));
  const result=new Map();
  for(const id of new Set(document.doors.flatMap(door=>door.leaves.map(leaf=>leaf.meshGuid)))) {
    const asset=manifest.assets.find(asset=>asset.id===id),raw=bytes(`web/public/assets/${asset.url}`);
    result.set(id,await loader.parseAsync(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),''));
  }
  return result;
}

test('selected source doors retain exact map placements, wrappers, axes and trigger boxes',()=>{
  assert.equal(sha(bytes(document.provenance.evidenceFile)),document.provenance.evidenceSha256);
  const evidence=json(document.provenance.evidenceFile);
  for(const source of [evidence.mapSource,...evidence.modelSources,...evidence.graphs.map(graph=>graph.source)])assert.equal(sha(bytes(source.file)),source.jsonSha256);
  assert.equal(document.doors.length,17);assert.equal(document.doors.flatMap(door=>door.leaves).length,62);
  assert.equal(evidence.placements.length,18);
  assert.equal(evidence.placements.flatMap(door=>door.leaves).filter(leaf=>!leaf.sceneMatch).length,1);
  const indices=new Set();
  for(const door of document.doors) {
    assert.ok(door.trigger.halfExtents.every(value=>value>0));
    for(const leaf of door.leaves) {
      const instance=manifest.instances[leaf.sceneMatch.index];assert.equal(instance.assetId,leaf.meshGuid);
      assert.ok(instance.matrix.every((value,i)=>Math.abs(value-leaf.matrix[i])<.0001));
      assert.equal(indices.has(leaf.sceneMatch.index),false);indices.add(leaf.sceneMatch.index);
      assert.equal(leaf.opening.duration,.75);
      assert.ok([0,1].includes(leaf.opening.axis));
      for(let i=0;i<3;i++)assert.equal(leaf.opening.worldOffset[i],leaf.matrix[leaf.opening.axis*4+i]*leaf.opening.distance);
    }
  }
});

test('original door geometry and swept ray collision move together, then reset closed',async()=>{
  const doors=prepareSourceDoors(document,manifest,await models());
  try {
    const {collision,movementCollision}=doors.attachCollision(null);
    assert.equal(doors.instances.size,62);assert.ok(doors.drawMeshes>=62);
    const single=document.doors.find(door=>door.leaves.length===1),leaf=single.leaves[0];
    const root=doors.group.children.find(child=>child.name.startsWith(single.id));
    root.updateMatrixWorld(true);
    const center=new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3());
    const normal=new THREE.Vector3(...leaf.matrix.slice(8,11)).normalize();
    const ray=new THREE.Ray(center.clone().addScaledVector(normal,-2),normal);
    assert.ok(collision.rayIntersect(ray,0,4),'closed source door blocks the ray');
    assert.ok(movementCollision.rayIntersect(ray,0,4));
    const occupant=new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(single.trigger.matrix));
    doors.update(.375,[occupant]);
    let state=doors.snapshot().states.find(row=>row.id===single.id);
    assert.ok(Math.abs(state.amount-Math.SQRT1_2)<1e-12);
    doors.update(.375,[occupant]);
    state=doors.snapshot().states.find(row=>row.id===single.id);
    assert.equal(state.amount,1);assert.deepEqual(root.position.toArray(),leaf.opening.worldOffset);
    assert.equal(collision.rayIntersect(ray,0,4),false,'original door and its collision clear the same opening');
    assert.equal(movementCollision.rayIntersect(ray,0,4),false);
    doors.update(.75,[]);assert.ok(collision.rayIntersect(ray,0,4),'unoccupied original door closes');
    doors.update(.75,[occupant]);doors.reset();assert.ok(collision.rayIntersect(ray,0,4));
    assert.equal(doors.snapshot().open,0);
  } finally {doors.dispose();}
});

test('source OBB occupancy rotates with the map and transitions remain continuous on reversal',async()=>{
  const doors=prepareSourceDoors(document,manifest,await models());
  try {
    const source=document.doors.find(door=>door.leaves.length===4),transform=new THREE.Matrix4().fromArray(source.trigger.matrix);
    const inside=new THREE.Vector3().applyMatrix4(transform),outside=new THREE.Vector3(source.trigger.halfExtents[0]+.01,0,0).applyMatrix4(transform);
    doors.update(.2,[outside]);assert.equal(doors.snapshot().states.find(row=>row.id===source.id).amount,0);
    doors.update(.2,[inside]);const before=doors.snapshot().states.find(row=>row.id===source.id).amount;
    doors.update(0,[]);assert.equal(doors.snapshot().states.find(row=>row.id===source.id).amount,before);
    doors.update(.75,[]);assert.equal(doors.snapshot().states.find(row=>row.id===source.id).amount,0);
    assert.throws(()=>doors.update(-1,[]),/elapsed/);
  } finally {doors.dispose();}
});
