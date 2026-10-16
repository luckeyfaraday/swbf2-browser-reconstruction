import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {CollisionWorld} from '../vendor/vibe-engine/kits/fps/collision-world.js';
import {BattleRuntime} from '../src/game.js';
import {resolveGameplay} from '../src/rules.js';

const asset=name=>new URL(`../public/assets/${name}`,import.meta.url);
const document=name=>JSON.parse(fs.readFileSync(asset(name),'utf8'));
const characters=document('characters.json'),factions=document('faction-weapons.json');
const capsules=document('soldier-hitboxes.json'),heat=document('weapon-heat.json');
const movement=document('movement-camera.json');
const handling=document('weapon-handling.json');

async function readSourceModel(descriptor) {
  const bytes=fs.readFileSync(asset(descriptor.url)),length=bytes.readUInt32LE(12);
  const doc=JSON.parse(bytes.subarray(20,20+length));
  // Only remove image bindings in memory. Actual MeshSet geometry, source rig,
  // skin bindings, local transforms and recovered animation buffers are kept.
  doc.materials=(doc.materials??[]).map(m=>({name:m.name,pbrMetallicRoughness:{baseColorFactor:[1,1,1,1]}}));
  delete doc.images;delete doc.textures;delete doc.samplers;
  const raw=Buffer.from(JSON.stringify(doc)),padded=Buffer.alloc((raw.length+3)&~3,32);raw.copy(padded);
  const header=Buffer.from(bytes.subarray(0,20)),remaining=bytes.subarray(20+length);
  header.writeUInt32LE(20+padded.length+remaining.length,8);header.writeUInt32LE(padded.length,12);
  const glb=Buffer.concat([header,padded,remaining]);
  const gltf=await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset,glb.byteOffset+glb.byteLength),'');
  return {descriptor,gltf};
}
const sourceCharacters=await Promise.all(characters.characters.map(readSourceModel));
const sourceWeapons=await Promise.all([...characters.weapons,...factions.weapons].map(readSourceModel));

function arena({health=null,scoreLimit=1,automateBoth=true}={}) {
  const scene=new THREE.Scene(),floor=new THREE.Mesh(new THREE.BoxGeometry(100,1,100));
  floor.position.y=-.5;const collision=CollisionWorld.fromObject3D(floor);
  const gameplay=resolveGameplay(document('gameplay.json'));
  for(const [section,values]of Object.entries(movement.parameters))Object.assign(gameplay.parameters[section],values);
  gameplay.parameters.weapon.sourceHeat=heat.config;
  Object.assign(gameplay.parameters.round,{botCount:1,scoreLimit,duration:30,respawnSeconds:30});
  if(health!==null)gameplay.parameters.player.health=health;
  const assets={
    collision,gameplay,stats:{},hitboxDocument:capsules,handlingDocument:handling,
    characters:new Map(sourceCharacters.map(value=>[value.descriptor.id,value])),
    weapons:new Map(sourceWeapons.map(value=>[value.descriptor.id,value])),
    teamWeapons:new Map(factions.teams.map(row=>[row.team,row.weaponId])),
    manifest:{metadata:{name:'Synthetic flat arena with recovered BF2 combatants'},
      bounds:{min:[-50,-1,-50],max:[50,10,50]},
      spawns:[{position:[0,0,9],team:0,yaw:0},{position:[0,0,-9],team:1,yaw:Math.PI}]},
  };
  let seed=0x64abc;const events=[];
  const ctx={phase:'play',time:0,
    rand(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;},
    log(type,data){events.push({type,time:this.time,...data});},
    inputDevice:{agentApply(){}},input:{pressed:{},moveX:0,moveY:0,lookX:0,lookY:0},
    setPaused(){},endMatch(result){this.phase='over';this.result=result;},
  };
  const runtime=new BattleRuntime({assets,scene,camera:new THREE.PerspectiveCamera(),renderer:{},ui:{end(){}}});
  runtime.init(ctx);
  // Arrangement only: an off-arena spectator makes both real combatants use
  // the unchanged production botInput branch. Neither aiming, shots, damage,
  // body update nor hit testing is stubbed or invoked as a shortcut.
  if(automateBoth){runtime.actors[0].id='bot-0';runtime.actors[0].name='Rebel';}
  runtime.actors[1].name='Imperial';
  if(automateBoth)runtime.player={id:'spectator',team:-1,alive:true,sprinting:false};
  const observations=runtime.actors.map(actor=>({id:actor.id,phases:new Set(),moved:false,animated:false,
    initialFeet:actor.controller.getFeetPosition(),initialHand:actor.body.root.getObjectByName('RightHand').quaternion.clone(),
    firstOverheat:null,shotAfterOverheat:false}));
  function step(seconds) {
    for(let frame=0;frame<Math.round(seconds*60)&&runtime.round.phase==='playing';frame++) {
      ctx.time+=1/60;runtime.simulate(ctx,1/60);
      for(const [index,actor]of runtime.actors.entries()) {
        const row=observations[index];row.phases.add(actor.weaponHeat.phase);
        row.moved||=actor.controller.getFeetPosition().distanceTo(row.initialFeet)>.25;
        row.animated||=actor.body.root.getObjectByName('RightHand').quaternion.angleTo(row.initialHand)>.01;
        if(actor.weaponHeat.phase==='overheated'&&row.firstOverheat===null)row.firstOverheat=ctx.time;
        if(row.firstOverheat!==null&&actor.lastShot>row.firstOverheat+.5)row.shotAfterOverheat=true;
      }
    }
  }
  return {runtime,ctx,events,observations,step,dispose:()=>collision.dispose()};
}

test('opposed recovered rigs acquire targets, move, shoot and eliminate through production combat',()=>{
  const game=arena();
  try {
    assert.equal(game.runtime.botInput,BattleRuntime.prototype.botInput);
    for(const source of sourceCharacters) {
      assert.ok(source.gltf.animations.some(c=>c.name==='rifle-stand'));
      assert.ok(source.gltf.animations.some(c=>c.name==='rifle-run'&&c.tracks.some(t=>t.times.length>2)));
    }
    for(const actor of game.runtime.actors) {
      assert.equal(actor.body.placeholder,false);
      assert.equal(actor.body.hitboxes.capsules.length,11);
      assert.ok(actor.body.hitboxes.capsules.every(c=>c.bone.isBone));
      assert.equal(actor.weapon.roundsPerMinute,300);
      assert.equal(actor.weaponSpread.snapshot().provenance.evidenceId,'BF2-WEAPON-HANDLING-NATIVE-001');
    }
    game.step(12);
    for(const actor of game.runtime.actors)assert.ok(game.events.some(e=>e.type==='shot'&&e.actor===actor.id),`${actor.id} never fired`);
    assert.ok(game.events.some(e=>e.type==='damage'&&typeof e.bone==='string'),'damage must intersect original animated capsules');
    const kills=game.events.filter(e=>e.type==='kill');assert.equal(kills.length,1,'source health must permit an elimination');
    assert.equal(game.runtime.round.phase,'ended');assert.equal(game.runtime.round.reason,'score');
    assert.equal(game.runtime.round.scores.reduce((a,b)=>a+b,0),1);
    assert.ok(game.observations.every(o=>o.moved&&o.animated),'source run motion and controller movement must both execute');
    for(const actor of game.runtime.actors)assert.ok(actor.controller.getFeetPosition().y>-.05,'actors remain on the navigable floor');
  }finally{game.dispose();}
});

test('source spread follows accepted player shots, aim/crouch input, recovery and respawn',()=>{
  const game=arena({health:5000,scoreLimit:100,automateBoth:false});
  try {
    const actor=game.runtime.player,spread=actor.weaponSpread;
    game.step(.5); // settle the actual controller before choosing grounded states
    game.runtime.viewThirdPerson=false;
    Object.assign(game.ctx.input,{aim:true,fire:false});game.step(.2);
    game.ctx.input.fire=true;
    game.step(1);
    const shots=game.events.filter(e=>e.type==='shot'&&e.actor==='player');
    assert.ok(shots.length>=4);
    assert.equal(spread.snapshot().shots,shots.length,'cadence-rejected attempts cannot add spread pulses');
    assert.equal(spread.snapshot().state.aiming,true);
    assert.equal(spread.snapshot().sourceArrayIndex,4);
    assert.ok(spread.snapshot().dispersionDegrees>.1,'accepted aimed shots build source dispersion');
    const first=shots[0].direction,expected=game.runtime.forward(actor);
    assert.ok(new THREE.Vector3(...first).distanceTo(expected)<.002,'zero minimum aimed spread preserves the firing ray');
    Object.assign(game.ctx.input,{fire:false,crouch:true});game.step(1);
    assert.equal(spread.snapshot().sourceArrayIndex,12,'grounded crouch/zoom selects its native array');
    assert.equal(spread.snapshot().dispersionDegrees,spread.snapshot().minDegrees);
    game.runtime.kill(actor,null);game.runtime.spawn(actor);
    assert.equal(spread.snapshot().shots,0);
    assert.equal(spread.snapshot().pendingShot,false);
    assert.equal(spread.snapshot().state.aiming,false);
    assert.equal(spread.snapshot().dispersionDegrees,spread.snapshot().minDegrees);
  }finally{game.dispose();}
});

test('bot aim reaches the animated source torso rather than the controller vertical axis',()=>{
  const game=arena();
  try {
    for(const actor of game.runtime.actors){actor.moving=false;game.runtime.updateBody(actor,.3);}
    const [shooter,target]=game.runtime.actors,point=game.runtime.aimPoint(target);
    const torso=target.body.hitboxes.capsules.find(c=>c.source.bone==='Spine');
    const center=torso.start.clone().add(torso.end).multiplyScalar(.5);
    assert.ok(point.distanceTo(center)<1e-8);
    assert.ok(point.distanceTo(game.runtime.eye(target))>.15,'actual source torso differs from an upright controller eye');
    const origin=game.runtime.eye(shooter),ray=new THREE.Ray(origin,point.clone().sub(origin).normalize());
    const hit=target.body.hitboxes.intersect(ray,origin.distanceTo(point)+.5);
    assert.ok(hit&&!hit.head,'torso aiming must enter a source body capsule');
  }finally{game.dispose();}
});

test('continuous bot combat with unchanged source weapons resumes firing after overheat',()=>{
  // Larger health is solely a stress arrangement so both actors survive long
  // enough to test a complete heat cycle; source weapon/heat values stay intact.
  const game=arena({health:5000,scoreLimit:100});
  try {
    game.step(14);
    for(const row of game.observations) {
      assert.ok(row.phases.has('overheated'),`${row.id} must reach source full heat`);
      assert.ok(row.phases.has('exiting'),`${row.id} must finish cooling`);
      assert.ok(row.shotAfterOverheat,`${row.id} must fire again after its heat cycle`);
      const shots=game.events.filter(e=>e.type==='shot'&&e.actor===row.id);
      assert.ok(shots.length>25,`${row.id} fired only ${shots.length} shots`);
      for(let i=1;i<shots.length;i++)assert.ok(shots[i].time-shots[i-1].time>=.2-1/60-1e-7,'accepted shots respect source 300 RPM');
    }
    assert.ok(game.events.filter(e=>e.type==='damage').length>20,'continued shots must continue reaching source capsules');
    assert.ok(game.runtime.actors.every(a=>Number.isFinite(a.health)&&a.alive));
  }finally{game.dispose();}
});
