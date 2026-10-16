import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {CollisionWorld} from '../vendor/vibe-engine/kits/fps/collision-world.js';
import {AnimatedPlayerController,beginRoll,advanceRoll,createRollState,selectRollDirection} from '../src/roll.js';

const clips=JSON.parse(fs.readFileSync(new URL('../public/assets/roll-clips.json',import.meta.url))).clips;
function world(blocked=false){
  const scene=new THREE.Group(),floor=new THREE.Mesh(new THREE.BoxGeometry(30,1,30));floor.position.y=-.5;scene.add(floor);
  if(blocked){const wall=new THREE.Mesh(new THREE.BoxGeometry(12,4,.15));wall.position.set(0,2,-2);scene.add(wall);}
  const collision=CollisionWorld.fromObject3D(scene),controller=new AnimatedPlayerController(null,collision,{spawn:[0,0,0],radius:.3,fixedTimeStep:1/120});
  for(let i=0;i<30;i++)controller.update(1/60,{move:[0,0]});
  return {collision,controller};
}
test('source roll trajectory passes through capsule sweeps and cannot tunnel through a thin wall',()=>{
  for(const blocked of [false,true]){
    const {collision,controller}=world(blocked),state=createRollState(),input={move:[0,0]};
    assert.equal(beginRoll(state,clips,{move:[0,1]},controller),true);
    for(let i=0;i<60;i++){advanceRoll(state,clips,controller,1/60,input);controller.update(1/60,input);}
    const feet=controller.getFeetPosition();
    assert.equal(state.active,false);assert.equal(controller.grounded,true);
    if(blocked)assert.ok(feet.z>-1.65&&feet.z<-1.4,`wall stop ${feet.z}`);
    else assert.ok(Math.abs(feet.z+4.66916227)<.02,`source distance ${feet.z}`);
    collision.dispose();
  }
});
test('roll respects grounded entry, source movement branch and reconstructed recharge',()=>{
  const {collision,controller}=world(),state=createRollState(),input={move:[1,0]};
  controller.grounded=false;assert.equal(beginRoll(state,clips,input,controller),false);controller.grounded=true;
  assert.equal(beginRoll(state,clips,input,controller),true);assert.equal(state.direction,'right');
  for(let i=0;i<40;i++){advanceRoll(state,clips,controller,1/60,input);controller.update(1/60,{move:[0,0]});}
  assert.equal(state.active,false);assert.ok(state.tick>=52&&state.tick<55);
  assert.equal(beginRoll(state,clips,input,controller),false);
  for(let i=0;i<210;i++)advanceRoll(state,clips,controller,1/60,input);
  assert.equal(beginRoll(state,clips,input,controller),true);
  collision.dispose();
});
test('roll input chooses matching recovered directional clips',()=>{
  assert.deepEqual([[0,0],[0,1],[0,-1],[-1,0],[1,0]].map(selectRollDirection),['back','front','back','left','right']);
});
test('source airborne transition releases control after tick 40 when a roll leaves a tall ledge',()=>{
  const {collision,controller}=world(),state=createRollState();
  assert.equal(beginRoll(state,clips,{move:[0,1]},controller),true);
  state.tick=41;controller.grounded=false;controller.velocity.set(0,-1,-4);
  assert.equal(advanceRoll(state,clips,controller,1/60,{move:[0,0]},{groundDistance:3}),false);
  assert.equal(state.active,false);assert.equal(state.exit,'airborne');
  assert.equal(controller.animationVelocity,null);assert.equal(controller.velocity.z,-4);
  collision.dispose();
});
