import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {CollisionWorld} from '../vendor/vibe-engine/kits/fps/collision-world.js';
import {BattleRuntime} from '../src/game.js';
import {createRound,resolveGameplay} from '../src/rules.js';
import {resolveProjectileLaunch,initializeProjectileVelocity,selectedProjectileVelocity} from '../src/projectile-launch.js';

const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const bytes=file=>fs.readFileSync(path.join(workspace,file));
const read=file=>JSON.parse(bytes(file));
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
const config=read('web/public/assets/projectile-launch.json');
const trailConfig=read('web/public/assets/rifle-trail.json');
const evidence=read('tools/gameplay-recovery/projectile-evidence.json');
const native=read('tools/gameplay-recovery/projectile-native-evidence.json');
const sourceDocs=new Map(config.provenance.sources.map(source=>[source.guid,read(source.file)]));
const pointer=(object,p)=>p.split('/').slice(1).reduce((value,key)=>value[key],object);
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);

test('selected projectile source chain and native evidence retain their original bytes',()=>{
  assert.equal(native.runtimeObserved,false);
  assert.equal(hash(bytes(config.provenance.nativeEvidenceFile)),config.provenance.nativeEvidenceSha256);
  for(const source of config.provenance.sources)assert.equal(hash(bytes(source.file)),source.jsonSha256);
  for(const observation of evidence.observations)assert.deepEqual(pointer(sourceDocs.get(observation.sourceGuid),observation.jsonPointer),observation.value);
  for(const link of evidence.links){
    const from=sourceDocs.get(link.fromSource).asset.objects.find(o=>o.$id===link.fromObject);
    const to=sourceDocs.get(link.toSource).asset.objects.find(o=>o.$id===link.toObject);
    const reference=link.field.split('/').reduce((value,key)=>value[key],from);
    assert.ok(to);
    if(link.fromSource===link.toSource)assert.equal(reference.$ref,to.$id);
    else {assert.equal(reference.$external,link.toSource);assert.equal(reference.classGuid,to.$id);}
  }
  for(const fn of native.functions)assert.equal(hash(bytes(fn.file)),fn.sha256,fn.entry);
  // Validate only bounded recorded regions; no native execution or large PE load.
  const descriptor=fs.openSync(native.target,'r');
  try {
    const records=[...native.fields.map(row=>row.record),...native.pointers.map(row=>row.record),...native.functions.map(row=>row.nativeSpan)];
    for(const record of records){
      const expected=Buffer.from(record.bytes,'hex'),actual=Buffer.alloc(expected.length);
      assert.equal(fs.readSync(descriptor,actual,0,actual.length,record.fileOffset),actual.length);
      assert.deepEqual(actual,expected,record.address);
    }
  }finally{fs.closeSync(descriptor);}
});

test('selected source shots use 700, three seconds, and a derived 2100 lifetime bound',()=>{
  for(const row of config.weapons){
    const launch=resolveProjectileLaunch(config,row.weaponId,{sourceGuid:row.source.guid});
    assert.deepEqual(launch.parameters,{projectileSpeed:700,projectileLifetime:3,range:2100});
    assert.equal(launch.fallbackInitialSpeed,350);
    assert.equal(row.applyPowerToSpeed,false);
    assert.equal(row.sourceShot.InheritWeaponSpeedAmount,0);
    assert.deepEqual(row.baselineModifierTypes,['FrostySdk.Ebx.WeaponFiringEffectsModifier']);
    for(const forward of [[0,0,1],[0,0,-1],[1,0,0],[3,-4,5]]){
      const velocity=selectedProjectileVelocity(launch,forward);
      near(Math.hypot(...velocity),700);
      const cross=new THREE.Vector3(...velocity).cross(new THREE.Vector3(...forward));near(cross.length(),0);
    }
  }
});

test('the entity scalar is a missing-record fallback, never a multiplier or a zero-velocity override',()=>{
  assert.deepEqual(initializeProjectileVelocity({suppliedVelocity:[0,0,700],fallbackInitialSpeed:350}),[0,0,700]);
  assert.deepEqual(initializeProjectileVelocity({suppliedVelocity:[0,0,0],fallbackInitialSpeed:350}),[0,0,0]);
  assert.deepEqual(initializeProjectileVelocity({suppliedVelocity:[120,-30,60],fallbackInitialSpeed:350}),[120,-30,60]);
  assert.deepEqual(initializeProjectileVelocity({fallbackInitialSpeed:350,forward:[1,0,0]}),[350,0,0]);
  assert.throws(()=>initializeProjectileVelocity({suppliedVelocity:[0,Infinity,0],fallbackInitialSpeed:350}));
});

test('unknown weapons and independently supplied source identities receive no projectile overrides',()=>{
  assert.equal(resolveProjectileLaunch(config,'fixture'),null);
  assert.equal(resolveProjectileLaunch(config,'primary',{sourceGuid:'fixture-source'}),null);
  assert.equal(resolveProjectileLaunch(null,'primary'),null);
  const invalid=structuredClone(config);invalid.weapons[0].sourceProjectile.Gravity=-9.81;
  assert.throws(()=>resolveProjectileLaunch(invalid,'primary'),/Unsupported/);
  assert.throws(()=>selectedProjectileVelocity(resolveProjectileLaunch(config,'primary'),[0,0,0]),/nonzero/);
});

function projectileArena({wallZ=null,sourceVisuals=false}={}){
  const scene=new THREE.Scene(),surfaces=new THREE.Group();
  if(wallZ!==null){const wall=new THREE.Mesh(new THREE.BoxGeometry(10,10,.02));wall.position.z=wallZ;surfaces.add(wall);}
  // A distant floor keeps an empty scene from producing an invalid collider.
  const floor=new THREE.Mesh(new THREE.BoxGeometry(5000,1,5000));floor.position.y=-100;surfaces.add(floor);
  const collision=CollisionWorld.fromObject3D(surfaces),gameplay=resolveGameplay({parameters:{}});
  const selected=resolveProjectileLaunch(config,'primary');Object.assign(gameplay.parameters.weapon,selected.parameters);
  gameplay.parameters.weapon.id='primary';
  const assets={collision,gameplay,weapons:new Map(),projectileVisualDocument:sourceVisuals?trailConfig:null,manifest:{bounds:{min:[-2500,-101,-2500],max:[2500,10,2500]}}};
  const runtime=new BattleRuntime({assets,scene,camera:new THREE.PerspectiveCamera(),renderer:{},ui:{}});
  runtime.player={id:'observer',sprinting:false,alive:true};runtime.round=createRound(gameplay.parameters.round);
  const mesh=new THREE.Object3D();scene.add(mesh);
  const projectile={owner:{id:'source-shot',team:0},weapon:gameplay.parameters.weapon,position:new THREE.Vector3(),
    direction:new THREE.Vector3(0,0,1),age:0,travel:0,mesh};
  runtime.projectiles.push(projectile);
  const ctx={input:{pressed:{}},time:0};runtime.ctx=ctx;
  return {runtime,projectile,scene,step(dt){ctx.time+=dt;runtime.simulate(ctx,dt);},dispose(){collision.dispose();}};
}

test('production swept collision stops a 700-speed shot at a two-centimetre wall within one tick',()=>{
  const game=projectileArena({wallZ:5});
  try {
    game.step(1/60);
    assert.equal(game.runtime.projectiles.length,0,'11.67-unit step must collide with the wall five units away');
    assert.equal(game.scene.children.includes(game.projectile.mesh),false);
  }finally{game.dispose();}
});

test('production projectiles cross the former 150 cutoff and clip the final segment at TTL',()=>{
  const game=projectileArena();
  try {
    game.step(.3);assert.equal(game.runtime.projectiles.length,1);near(game.projectile.travel,210);
    game.step(2.65);assert.equal(game.runtime.projectiles.length,1);near(game.projectile.travel,2065);
    game.step(.1);assert.equal(game.runtime.projectiles.length,0);near(game.projectile.travel,2100);
    near(game.projectile.position.z,2100);near(game.projectile.age,3);
  }finally{game.dispose();}
});

test('the source trail delays visual retirement without delaying a wall hit or rendering through it',()=>{
  const game=projectileArena({wallZ:5,sourceVisuals:true});
  try {
    game.step(1/60);
    assert.equal(game.runtime.projectiles.length,0);
    assert.ok(game.scene.children.includes(game.projectile.mesh));
    assert.ok(Math.abs(game.projectile.position.z-4.99)<1e-6);
    near(game.projectile.mesh.position.z+.45*game.projectile.mesh.scale.z,game.projectile.position.z);
    const position=game.projectile.position.clone();
    game.step(.5);
    assert.deepEqual(game.projectile.position,position,'retired physics must never move again');
    assert.equal(game.runtime.projectileVisuals.snapshot().retired,1);
    game.runtime.projectileVisuals.afterPresent();
    assert.ok(game.scene.children.includes(game.projectile.mesh),'visible for its second presented frame');
    game.runtime.projectileVisuals.afterPresent();
    assert.equal(game.scene.children.includes(game.projectile.mesh),false);
    assert.equal(game.runtime.projectileVisuals.snapshot().retired,0);
  }finally{game.dispose();}
});

test('source visual retirement remains bounded while simulation advances without rendering, and clears on reset',()=>{
  const game=projectileArena({sourceVisuals:true});
  try {
    const meshes=Array.from({length:100},()=>new THREE.Object3D());
    for(const mesh of meshes){game.scene.add(mesh);game.runtime.projectileVisuals.retire(mesh,'primary');}
    assert.equal(game.runtime.projectileVisuals.snapshot().retired,30);
    assert.equal(meshes.filter(mesh=>mesh.parent).length,30);
    game.runtime.projectileVisuals.reset();
    assert.equal(meshes.filter(mesh=>mesh.parent).length,0);
    assert.equal(game.runtime.projectileVisuals.snapshot().retired,0);
    for(const source of trailConfig.provenance.sources)assert.equal(hash(bytes(source.file)),source.sha256);
    const bullet=read(trailConfig.provenance.sources[0].file).asset.objects.find(o=>o.$type.endsWith('WSBulletEntityData'));
    assert.equal(bullet.StopTrailEffectOnUnspawnFrameDelay,trailConfig.stopDelayFrames);
    assert.equal(bullet.StopTrailEffectOnUnspawn,trailConfig.stopOnUnspawn);
  }finally{game.dispose();}
});
