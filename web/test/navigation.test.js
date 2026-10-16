import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {CollisionWorld,CompositeCollision} from '../vendor/vibe-engine/kits/fps/collision-world.js';
import {PlayerController} from '../vendor/vibe-engine/kits/fps/player-controller.js';
import {CollisionNavigation,insidePolygon} from '../src/navigation.js';
import {PROVISIONAL} from '../src/rules.js';

test('collision-derived navigation walks around a blocking wall through real controller movement',()=>{
  const group=new THREE.Group();
  const floor=new THREE.Mesh(new THREE.BoxGeometry(40,1,40));floor.position.y=-.5;group.add(floor);
  const wall=new THREE.Mesh(new THREE.BoxGeometry(1,4,20));wall.position.y=2;group.add(wall);
  const collision=CollisionWorld.fromObject3D(group),polygon=[[-19,0,-19],[19,0,-19],[19,0,19],[-19,0,19]];
  const navigation=new CollisionNavigation(collision,{spawns:[{position:[-7,0,0]},{position:[7,0,0]}],combatArea:{points:polygon}},PROVISIONAL.player);
  const path=navigation.findPath(new THREE.Vector3(-7,0,0),new THREE.Vector3(7,0,0));
  assert.ok(path.length>10);assert.ok(path.some(point=>Math.abs(point.z)>10.5),'route must go around the wall');
  const player=new PlayerController(null,collision,{...PROVISIONAL.player,spawn:[-7,0,0],fixedTimeStep:1/120});let index=0;
  for(let frame=0;frame<900&&index<path.length;frame++) {
    const position=player.getFeetPosition();
    if(position.distanceTo(path[index])<.5){index++;if(index===path.length)break;}
    const delta=path[index].clone().sub(position);
    player.update(1/60,{move:[0,1],yaw:Math.atan2(-delta.x,-delta.z)});
  }
  assert.ok(player.getFeetPosition().distanceTo(new THREE.Vector3(7,0,0))<1);
  assert.ok(insidePolygon(player.getFeetPosition().x,player.getFeetPosition().z,polygon));
  collision.dispose();
});

test('one-way ledge descent is not reused as an impossible upward step, including native collision parts',()=>{
  const floor=new THREE.Mesh(new THREE.BoxGeometry(12,1,12));floor.position.y=-.5;
  const base=CollisionWorld.fromObject3D(floor),platform=new THREE.Mesh(new THREE.BoxGeometry(5,.65,8));platform.position.set(-2.5,.325,0);
  const nativePart=CollisionWorld.fromObject3D(platform),world=new CompositeCollision(base);world.add('native-hull',nativePart);
  const nav=new CollisionNavigation(world,{spawns:[{position:[-.7,.65,0]},{position:[.7,0,0]}]},PROVISIONAL.player);
  const upper={id:'upper',position:new THREE.Vector3(-.7,.65,0)},lower={id:'lower',position:new THREE.Vector3(.7,0,0)};
  assert.equal(nav.connected(upper,lower),true,'a safe ledge descent should be traversable');
  assert.equal(nav.connected(lower,upper),false,'the .65m ledge exceeds the .45m standing step height');
  base.dispose();nativePart.dispose();
});
test('an endpoint next to a thin wall attaches to a reachable cell rather than the nearer cell across it',()=>{
  const group=new THREE.Group(),floor=new THREE.Mesh(new THREE.BoxGeometry(24,1,24));floor.position.y=-.5;group.add(floor);
  const wall=new THREE.Mesh(new THREE.BoxGeometry(.15,4,8));wall.position.set(.45,2,0);group.add(wall);
  const collision=CollisionWorld.fromObject3D(group),player={...PROVISIONAL.player,radius:.3,stepHeight:.3};
  const navigation=new CollisionNavigation(collision,{spawns:[{position:[.9,0,0]},{position:[-1.4,0,0]}]},player);
  const from=new THREE.Vector3(.9,0,0),to=new THREE.Vector3(-1.4,0,0),path=navigation.findPath(from,to);
  assert.ok(path.length>6);assert.ok(path[0].x>.45,'first cell must remain on the starting side');
  assert.ok(path.some(point=>Math.abs(point.z)>4),'path must go around the finite wall');
  const controller=new PlayerController(null,collision,{...player,spawn:from,fixedTimeStep:1/120});let index=0;
  for(let frame=0;frame<900&&index<path.length;frame++){
    const feet=controller.getFeetPosition();if(feet.distanceTo(path[index])<.3){index++;if(index===path.length)break;}
    const delta=path[index].clone().sub(feet);controller.update(1/60,{move:[0,1],yaw:Math.atan2(-delta.x,-delta.z)});
  }
  assert.ok(controller.getFeetPosition().distanceTo(to)<.4);collision.dispose();
});
