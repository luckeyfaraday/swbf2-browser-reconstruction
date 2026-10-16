import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {CollisionWorld} from '../vendor/vibe-engine/kits/fps/collision-world.js';
import {BattleRuntime} from '../src/game.js';
import {resolveGameplay} from '../src/rules.js';

const read=name=>JSON.parse(fs.readFileSync(new URL(`../public/assets/${name}`,import.meta.url),'utf8'));
const recoilDocument=read('camera-recoil.json'),aimingDocument=read('camera-aiming.json');
const descriptors=[...read('characters.json').weapons,...read('faction-weapons.json').weapons];
const heat=read('weapon-heat.json').config;
const close=(a,b,tolerance=1e-10)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
const angularDifference=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));

function arena({weaponId='rebel-a280',source=true}={}) {
  const floor=new THREE.Mesh(new THREE.BoxGeometry(100,1,100));floor.position.y=-.5;
  const collision=CollisionWorld.fromObject3D(floor),gameplay=resolveGameplay(read('gameplay.json'));
  Object.assign(gameplay.parameters.round,{botCount:0,duration:60});
  Object.assign(gameplay.parameters.camera,{thirdPerson:false,aimLookMultiplier:1});
  // Fixture geometry and zero dispersion isolate the source recoil boundary.
  // Native spring records, heat gate and production controller/fire are retained.
  Object.assign(gameplay.parameters.weapon,{spread:0,aimSpread:0,sourceHeat:heat});
  const descriptor=structuredClone(descriptors.find(d=>d.id===weaponId));
  const assets={collision,gameplay,stats:{},characters:new Map(),
    weapons:new Map([[weaponId,{descriptor,gltf:{scene:new THREE.Group()}}]]),teamWeapons:new Map([[0,weaponId]]),
    cameraRecoilDocument:source?recoilDocument:null,cameraAimingDocument:source?aimingDocument:null,
    manifest:{metadata:{name:'Recoil controller test floor'},bounds:{min:[-50,-1,-50],max:[50,10,50]},spawns:[{team:0,position:[0,0,0],yaw:.8}]}};
  const events=[],ctx={phase:'play',time:0,rand:()=>.75,log(type,data){events.push({type,...data});},
    input:{pressed:{},moveX:0,moveY:0,lookX:0,lookY:0,fire:false,aim:false},inputDevice:{agentApply(){}},setPaused(){},endMatch(){this.phase='over';}};
  const runtime=new BattleRuntime({assets,scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera(),renderer:{},ui:{end(){}}});
  runtime.init(ctx);runtime.player.controller.setLook(.8,.3);
  const frame=()=>{ctx.time+=1/60;runtime.simulate(ctx,1/60);};
  return {runtime,ctx,events,frame,step(count){for(let i=0;i<count;i++)frame();},dispose(){collision.dispose();floor.geometry.dispose();floor.material.dispose();}};
}

for(const weaponId of ['primary','rebel-a280'])test(`${weaponId}: accepted source recoil reaches the local camera once, without altering the controller or weapon attachment`,()=>{
  const game=arena({weaponId});
  try {
    const {runtime,ctx}=game,actor=runtime.player;
    const base=runtime.cameraPose().rotation.clone(),attachment=runtime.weaponRoot.quaternion.clone();
    ctx.input.fire=true;game.frame();
    const snapshot=actor.cameraRecoil.snapshot();
    assert.equal(snapshot.shots,1);assert.equal(snapshot.pendingShot,false);
    assert.ok(snapshot.nativeRadians.pitch<0);assert.ok(snapshot.nativeRadians.yaw>0);
    close(actor.controller.yaw,.8);close(actor.controller.pitch,.3);
    // Independent axis matrices establish local right multiplication at nonzero
    // controller pitch/yaw. A left multiplication produces a different view.
    const expected=new THREE.Matrix4().makeRotationFromQuaternion(base)
      .multiply(new THREE.Matrix4().makeRotationX(-snapshot.nativeRadians.pitch))
      .multiply(new THREE.Matrix4().makeRotationY(snapshot.nativeRadians.yaw));
    const actual=new THREE.Matrix4().makeRotationFromQuaternion(runtime.cameraPose().rotation);
    actual.elements.forEach((v,i)=>close(v,expected.elements[i]));
    assert.ok(runtime.cameraPose().rotation.angleTo(base)>1e-4);
    for(let i=0;i<50;i++)runtime.updateView(1/144);
    assert.deepEqual(actor.cameraRecoil.snapshot(),snapshot,'extra rendering cannot integrate recoil or consume a pulse');
    assert.deepEqual(runtime.weaponRoot.quaternion.toArray(),attachment.toArray(),'no second kick is added to the weapon rig');
    assert.deepEqual(runtime.camera.quaternion.toArray(),runtime.cameraPose().rotation.toArray());
  }finally{game.dispose();}
});

test('cadence and the source heat gate produce exactly one recoil pulse per accepted shot',()=>{
  const game=arena();
  try {
    const {runtime,ctx,events}=game,actor=runtime.player;ctx.input.fire=true;
    game.step(320);
    assert.equal(actor.weaponHeat.phase,'overheated');
    const count=events.filter(e=>e.type==='shot').length;
    assert.equal(count,25,'source .04 heat reaches full heat after 25 accepted shots');
    assert.equal(actor.cameraRecoil.snapshot().shots,count);
    game.step(30);
    assert.equal(events.filter(e=>e.type==='shot').length,count);
    assert.equal(actor.cameraRecoil.snapshot().shots,count,'held trigger during overheat adds no recoil');
    const state=actor.cameraRecoil.snapshot();runtime.simulate(ctx,0);
    assert.deepEqual(actor.cameraRecoil.snapshot(),state,'zero simulation time cannot queue another accepted shot');
    ctx.input.fire=false;game.step(180);
    assert.ok(Math.abs(actor.cameraRecoil.snapshot().nativeRadians.pitch)<1e-6,'source recovery settles after firing stops');
  }finally{game.dispose();}
});

test('solved player correction consumes source recoil before movement and preserves only excess look',()=>{
  const corrected=arena(),plain=arena();
  try {
    for(const game of [corrected,plain]){game.ctx.input.fire=true;game.frame();game.ctx.input.fire=false;}
    const actor=corrected.runtime.player,yaw=actor.controller.yaw,pitch=actor.controller.pitch;
    corrected.ctx.input.lookY=-.001;corrected.frame();plain.frame();
    close(actor.controller.pitch,pitch);
    close(actor.controller.yaw,yaw);
    close(actor.recoilCompensation.pitch,-.001);
    assert.ok(actor.cameraRecoil.snapshot().nativeRadians.pitch>plain.runtime.player.cameraRecoil.snapshot().nativeRadians.pitch);
    const remaining=actor.cameraRecoil.snapshot().nativeRadians.pitch;
    assert.ok(remaining<0);
    corrected.ctx.input.lookY=-.1;corrected.frame();
    close(actor.recoilCompensation.pitch,remaining);
    close(actor.controller.pitch,pitch-.1-remaining);
    // Opposite movement is ordinary look and is not subtracted as recoil.
    corrected.ctx.input.lookY=.02;const before=actor.controller.pitch;corrected.frame();
    close(actor.controller.pitch,before+.02);close(actor.recoilCompensation.pitch,0);
    assert.ok(actor.cameraRecoil.snapshot().cameraLocalQuaternion.every(Number.isFinite));
  }finally{corrected.dispose();plain.dispose();}
});

test('yaw wrapping and clamped look pass through the real controller only once',()=>{
  const game=arena();
  try {
    const actor=game.runtime.player;game.ctx.input.fire=true;game.frame();game.ctx.input.fire=false;
    const remaining=actor.cameraRecoil.snapshot().nativeRadians.yaw;
    actor.controller.setLook(-Math.PI+.005,actor.controller.maxPitch);
    const before=actor.controller.yaw;
    Object.assign(game.ctx.input,{lookX:.02,lookY:.1,moveY:1});game.frame();
    close(angularDifference(actor.controller.yaw,before),-.02+remaining);
    close(actor.recoilCompensation.yaw,remaining);
    close(actor.controller.pitch,actor.controller.maxPitch);
    close(actor.recoilCompensation.pitch,0);
    assert.ok(actor.controller.velocity.length()>0,'movement still advances after look is consumed');
  }finally{game.dispose();}
});

test('death, respawn, round reset and view changes clear recoil including pending feedback',()=>{
  const game=arena();
  try {
    const {runtime,ctx}=game,actor=runtime.player;ctx.input.fire=true;game.frame();
    runtime.kill(actor,null);
    assert.equal(actor.cameraRecoil.snapshot().state.alive,false);
    actor.cameraRecoil.snapshot().cameraLocalQuaternion.forEach((v,i)=>close(v,i===3?1:0));
    game.frame();assert.equal(actor.cameraRecoil.snapshot().shots,0);
    runtime.spawn(actor);ctx.input.fire=false;
    assert.equal(actor.cameraRecoil.snapshot().state.alive,true);
    assert.deepEqual(actor.recoilCompensation,{yaw:0,pitch:0});
    ctx.input.fire=true;game.frame();assert.equal(actor.cameraRecoil.snapshot().shots,1);
    runtime.resetRound('tdm');assert.equal(actor.cameraRecoil.snapshot().shots,0);
    game.frame();assert.equal(actor.cameraRecoil.snapshot().shots,1);
    ctx.input.pressed.KeyV=true;game.frame();ctx.input.pressed={};
    assert.equal(runtime.viewThirdPerson,true);assert.equal(actor.cameraRecoil.snapshot().shots,0);
    game.step(30);assert.equal(actor.cameraRecoil.snapshot().shots,0,'third-person camera is outside the recovered scope');
    ctx.input.fire=false;runtime.viewThirdPerson=false;game.frame();
    actor.cameraRecoil.snapshot().cameraLocalQuaternion.forEach((v,i)=>close(v,i===3?1:0));
  }finally{game.dispose();}
});

test('current spring view guides the explicitly inferred crosshair policy without adding raw recoil twice',()=>{
  const game=arena();
  try {
    const {runtime,ctx}=game;ctx.input.fire=true;game.frame();ctx.input.fire=false;game.step(11);
    const pose=runtime.cameraPose(),expected=new THREE.Vector3(0,0,-1).applyQuaternion(pose.rotation);
    const base=runtime.forward(runtime.player);
    assert.ok(expected.distanceTo(base)>1e-4);
    ctx.input.fire=true;game.frame();
    const projectile=runtime.projectiles.at(-1);
    assert.ok(projectile.direction.distanceTo(expected)<1e-10);
    assert.equal(runtime.observe().cameraRecoil.runtimePolicy.projectile.classification,'inferred');
    assert.equal(runtime.observe().cameraRecoil.runtimePolicy.projectile.nativeFinalRecoilPrecedence,'unresolved');
    assert.deepEqual(runtime.digest().actors[0].cameraRecoil,runtime.player.cameraRecoil.snapshot());
  }finally{game.dispose();}
});

test('fixtures without selected source recoil retain their supplied camera and controller behavior',()=>{
  const game=arena({source:false});
  try {
    const actor=game.runtime.player;assert.equal(actor.cameraRecoil,null);
    Object.assign(game.ctx.input,{fire:true,lookX:.02,lookY:-.03});game.frame();
    close(actor.controller.yaw,.78);close(actor.controller.pitch,.27);
    const expected=new THREE.Quaternion().setFromEuler(new THREE.Euler(.27,.78,0,'YXZ'));
    game.runtime.cameraPose().rotation.toArray().forEach((v,i)=>close(v,expected.toArray()[i]));
    assert.equal(game.runtime.observe().cameraRecoil,null);
  }finally{game.dispose();}
});
