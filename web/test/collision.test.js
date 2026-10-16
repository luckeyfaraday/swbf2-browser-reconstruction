import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld } from '../vendor/vibe-engine/kits/fps/collision-world.js';
import { PlayerController } from '../vendor/vibe-engine/kits/fps/player-controller.js';

function world() {
  const group=new THREE.Group(),material=new THREE.MeshBasicMaterial();
  const floor=new THREE.Mesh(new THREE.BoxGeometry(40,1,40),material);floor.position.y=-.5;group.add(floor);
  const wall=new THREE.Mesh(new THREE.BoxGeometry(12,4,.2),material);wall.position.set(0,2,-4);group.add(wall);
  return CollisionWorld.fromObject3D(group);
}
test('capsule rests on floor and cannot tunnel through a thin wall while sprinting',()=>{
  const collision=world(),p=new PlayerController(null,collision,{spawn:[0,.1,0],fixedTimeStep:1/120});
  for(let i=0;i<180;i++)p.update(1/60,{move:[0,1],sprint:true});
  const feet=p.getFeetPosition();assert.ok(feet.y>-.02&&feet.y<.05,`floor y=${feet.y}`);assert.ok(feet.z>-3.57,`wall z=${feet.z}`);assert.ok(feet.z<-3.3);
  collision.dispose();
});
test('jump rises, lands, and replaying fixed input yields an identical snapshot',()=>{
  const collision=world();
  const run=()=>{const p=new PlayerController(null,collision,{spawn:[-8,0,5],fixedTimeStep:1/120});let apex=0;for(let i=0;i<150;i++){p.update(1/60,{move:[.3,.3],jumpPressed:i===10});apex=Math.max(apex,p.getFeetPosition().y);}return {snapshot:p.getSnapshot(),apex,feet:p.getFeetPosition()};};
  const a=run(),b=run();assert.deepEqual(a.snapshot,b.snapshot);assert.ok(a.apex>.7,`jump apex=${a.apex}`);assert.ok(Math.abs(a.feet.y)<.05);collision.dispose();
});
test('BVH ray collision correctly occludes a projectile before a target behind a wall',()=>{
  const collision=world(),ray=new THREE.Ray(new THREE.Vector3(0,1.6,0),new THREE.Vector3(0,0,-1));
  const hit=collision.rayIntersect(ray,0,20);assert.ok(hit);assert.ok(hit.distance>3.8&&hit.distance<4.1);collision.dispose();
});
