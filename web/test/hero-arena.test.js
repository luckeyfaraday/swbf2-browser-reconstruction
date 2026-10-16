import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {CollisionWorld} from '../vendor/vibe-engine/kits/fps/collision-world.js';
import {BattleRuntime} from '../src/game.js';
import {resolveGameplay} from '../src/rules.js';
import {compactSkinnedSkeletons} from '../src/skeleton-trim.js';

// Recovered Darth Vader (mesh, rig, decoded source clips) against an unchanged
// recovered trooper bot in a flat arena, through the production runtime. Only the
// player's input and aim are arranged; strikes, blade sweeps, deflection, choke,
// throw, damage and deaths all run through the shipped code paths.
const asset=name=>new URL(`../public/assets/${name}`,import.meta.url);
const readJson=name=>JSON.parse(fs.readFileSync(asset(name),'utf8'));
const heroesDoc=readJson('heroes.json');
const available=fs.existsSync(asset(heroesDoc.heroes[0].animations))&&fs.existsSync(asset(heroesDoc.heroes[0].model))&&fs.existsSync(asset(heroesDoc.reactions));
const characters=readJson('characters.json'),factions=readJson('faction-weapons.json');
const capsules=readJson('soldier-hitboxes.json'),heat=readJson('weapon-heat.json'),movement=readJson('movement-camera.json'),handling=readJson('weapon-handling.json');

async function readGlb(url) {
  const bytes=fs.readFileSync(asset(url)),length=bytes.readUInt32LE(12);
  const doc=JSON.parse(bytes.subarray(20,20+length));
  // Image bindings are dropped in memory only (Node has no image decoder).
  doc.materials=(doc.materials??[]).map(m=>({name:m.name,pbrMetallicRoughness:{baseColorFactor:[1,1,1,1]}}));
  delete doc.images;delete doc.textures;delete doc.samplers;
  const raw=Buffer.from(JSON.stringify(doc)),padded=Buffer.alloc((raw.length+3)&~3,32);raw.copy(padded);
  const header=Buffer.from(bytes.subarray(0,20)),remaining=bytes.subarray(20+length);
  header.writeUInt32LE(20+padded.length+remaining.length,8);header.writeUInt32LE(padded.length,12);
  const glb=Buffer.concat([header,padded,remaining]);
  return new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset,glb.byteOffset+glb.byteLength),'');
}


// Every component (body, cape, head, hands...) carries its own skeleton copy; all
// copies of a source bone must sit together or parts detach from the body.
// Procedural bones are per-component (PROC_0 hangs off Hips in one mesh, Head in another).
function copySpread(model) {
  const groups=new Map(),position=new THREE.Vector3();
  model.updateMatrixWorld(true);
  model.traverse(node=>{const index=node.userData?.sourceBoneIndex;if(index===undefined||node.userData.procedural||node.name.startsWith('attachment_'))return;if(!groups.has(index))groups.set(index,[]);groups.get(index).push(node.getWorldPosition(position.clone()));});
  let worst=0,copies=0;
  for(const points of groups.values()){if(points.length<2)continue;copies=Math.max(copies,points.length);for(const p of points)worst=Math.max(worst,p.distanceTo(points[0]));}
  return {worst,copies};
}

let loaded=null;
async function load() {
  if(loaded)return loaded;
  const sourceCharacters=await Promise.all(characters.characters.map(async descriptor=>({descriptor,gltf:await readGlb(descriptor.url)})));
  const sourceWeapons=await Promise.all([...characters.weapons,...factions.weapons].map(async descriptor=>({descriptor,gltf:await readGlb(descriptor.url)})));
  const descriptor=heroesDoc.heroes[0];
  const [model,saber,animations,reactions]=await Promise.all([readGlb(descriptor.model),readGlb(descriptor.saber.url),readGlb(descriptor.animations),readGlb(heroesDoc.reactions)]);
  compactSkinnedSkeletons(model.scene);
  const gameplayDocument=fs.existsSync(asset(descriptor.gameplay))?readJson(descriptor.gameplay):null;
  const hero={descriptor,model:{gltf:model},saber:{gltf:saber,attach:descriptor.saber.attach,blade:descriptor.saber.blade},animations:{gltf:animations},gameplayDocument,audioDocument:null};
  loaded={sourceCharacters,sourceWeapons,heroes:{heroes:new Map([[descriptor.id,hero]]),reactions:new Map(reactions.animations.map(c=>[c.name,c])),reactionsRoot:reactions.scene}};
  return loaded;
}

async function arena({distance=9,respawnSeconds=30,scoreLimit=5}={}) {
  const {sourceCharacters,sourceWeapons,heroes}=await load();
  const scene=new THREE.Scene(),floor=new THREE.Mesh(new THREE.BoxGeometry(100,1,100));
  floor.position.y=-.5;const collision=CollisionWorld.fromObject3D(floor);
  const gameplay=resolveGameplay(readJson('gameplay.json'));
  for(const [section,values]of Object.entries(movement.parameters))Object.assign(gameplay.parameters[section],values);
  gameplay.parameters.weapon.sourceHeat=heat.config;
  Object.assign(gameplay.parameters.round,{botCount:1,scoreLimit,duration:120,respawnSeconds});
  const assets={collision,gameplay,stats:{},hitboxDocument:capsules,handlingDocument:handling,heroes,reactions:heroes.reactions,reactionsRoot:heroes.reactionsRoot,
    characters:new Map(sourceCharacters.map(v=>[v.descriptor.id,v])),weapons:new Map(sourceWeapons.map(v=>[v.descriptor.id,v])),
    teamWeapons:new Map(factions.teams.map(row=>[row.team,row.weaponId])),
    manifest:{metadata:{name:'Synthetic hero arena'},bounds:{min:[-50,-1,-50],max:[50,10,50]},
      spawns:[{position:[0,0,distance/2],team:0,yaw:0},{position:[0,0,-distance/2],team:1,yaw:Math.PI}]}};
  let seed=0x5eed;const events=[];
  const ctx={phase:'play',time:0,rand(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;},
    log(type,data){events.push({type,time:this.time,...data});},inputDevice:{agentApply(){}},
    input:{pressed:{},moveX:0,moveY:0,lookX:0,lookY:0},setPaused(){},endMatch(result){this.phase='over';this.result=result;}};
  const runtime=new BattleRuntime({assets,scene,camera:new THREE.PerspectiveCamera(),renderer:{toneMappingExposure:1},ui:{end(){}}});
  runtime.setHero('darthvader');
  runtime.init(ctx);
  const vader=runtime.player,bot=runtime.actors[1];
  // Aim like a player: put the crosshair (the shoulder camera's ray) on the trooper's torso.
  const face=()=>{
    const d=bot.controller.getFeetPosition().sub(vader.controller.getFeetPosition());vader.controller.setLook(Math.atan2(-d.x,-d.z),0);
    for(let i=0;i<3;i++){const camera=runtime.cameraPose(vader).position,torso=runtime.aimPoint(bot).sub(camera);vader.controller.setLook(Math.atan2(-torso.x,-torso.z),Math.atan2(torso.y,Math.hypot(torso.x,torso.z)));}
  };
  function step(seconds,input={},{aim=true,until=null}={}) {
    for(let frame=0;frame<Math.round(seconds*60)&&runtime.round.phase==='playing';frame++) {
      if(aim&&bot.alive)face();
      ctx.input={pressed:{},moveX:0,moveY:0,lookX:0,lookY:0,...(typeof input==='function'?input(frame):input)};
      ctx.time+=1/60;runtime.simulate(ctx,1/60);
      if(until?.())break;
    }
  }
  const gap=()=>vader.controller.getFeetPosition().distanceTo(bot.controller.getFeetPosition());
  return {runtime,ctx,events,vader,bot,step,gap,dispose:()=>collision.dispose()};
}

test('recovered Vader joins the Imperial side with source rig, clips and hit capsules',{skip:!available},async()=>{
  const game=await arena();
  try {
    const {vader,bot,runtime}=game;
    assert.equal(vader.team,1);assert.equal(bot.team,0);
    assert.ok(vader.hero);assert.equal(vader.body.hero,true);
    assert.equal(vader.health,vader.hero.parameters.health);
    assert.equal(vader.body.hitboxes.capsules.length,11,'Vader uses the shared human-male hit capsules');
    for(const role of ['idle','sprint','blockIdle','inAir','death'])assert.ok(vader.body.roles[role],`missing clip role ${role}`);
    for(const dir of ['fwd','bwd','left','right','fwdleft','bwdright'])assert.ok(vader.body.roles.run[dir]&&vader.body.roles.walk[dir]&&vader.body.roles.blockWalk[dir],`missing ${dir} locomotion`);
    for(let i=1;i<=6;i++)assert.ok(vader.body.has(`strike${i}`)&&vader.body.has(`strike${i}-end`));
    assert.ok(bot.body.reactions.includes('choke-loop')&&bot.body.reactions.some(n=>n.startsWith('saber-death')));
    // The saber hangs from the source weapon bone; the blade starts in the right hand.
    game.step(.5,{},{aim:false});
    const {base,tip}=vader.body.bladeSegment(new THREE.Vector3(),new THREE.Vector3());
    const hand=new THREE.Vector3();vader.body.model.getObjectByName('RightHand').getWorldPosition(hand);
    assert.ok(base.distanceTo(hand)<.25,`blade base ${base.distanceTo(hand).toFixed(3)} m from the right hand`);
    assert.ok(Math.abs(tip.distanceTo(base)-heroesDoc.heroes[0].saber.blade.length*heroesDoc.heroes[0].scale)<.02,`blade length ${tip.distanceTo(base).toFixed(3)}`);
    assert.equal(runtime.observe().hero.id,'darthvader');
  } finally {game.dispose();}
});

test('saber strikes hit through the source damage volume and kill',{skip:!available},async()=>{
  const game=await arena({distance:14,scoreLimit:1});
  try {
    const {vader,bot,events}=game;
    game.step(8,()=>game.gap()>1.7?{moveY:1}:{fire:true});
    const strikes=events.filter(e=>e.type==='hero-strike'),hits=events.filter(e=>e.type==='hero-hit');
    assert.ok(strikes.length>=1,'no strikes');
    assert.ok(hits.length>=1,`no blade contact in ${strikes.length} strikes`);
    assert.ok(events.some(e=>e.type==='kill'&&e.victim===bot.id&&e.killer===vader.id),'saber did not eliminate the trooper');
    assert.equal(bot.deathCause,'saber');
    assert.match(bot.body.reaction(),/saber-death/);
    // The corpse's head/hands/headgear fall with the body through the death clip.
    game.step(.6,{},{aim:false});
    const corpse=copySpread(bot.body.model);
    assert.ok(corpse.copies>=2&&corpse.worst<.002,`trooper parts detached by ${corpse.worst.toFixed(3)} m during the saber death`);
    const cape=copySpread(vader.body.model);
    assert.ok(cape.copies>=2&&cape.worst<.002,`Vader's cape skeleton is ${cape.worst.toFixed(3)} m off his body`);
  } finally {game.dispose();}
});

test('blocking deflects incoming bolts and spends stamina instead of health',{skip:!available},async()=>{
  const game=await arena({distance:16});
  try {
    const {vader,events}=game;
    game.step(6,{aim:true});
    const deflects=events.filter(e=>e.type==='deflect'&&e.actor===vader.id);
    assert.ok(deflects.length>=2,`only ${deflects.length} deflections`);
    assert.ok(vader.hero.state.deflects>=2);
    const unblocked=events.filter(e=>e.type==='damage'&&e.actor===vader.id&&e.time<deflects[0].time+.5);
    assert.equal(unblocked.length,0,'bolts hit Vader while his block held');
  } finally {game.dispose();}
});

test('Force choke grabs after the source wind-up, holds the trooper and deals the source damage',{skip:!available},async()=>{
  const game=await arena({distance:7});
  try {
    const {bot,events,vader}=game;
    game.step(.6);
    const before=bot.health,p=vader.hero.parameters.choke;
    game.step(1/60,{pressed:{KeyF:true}});
    assert.ok(events.some(e=>e.type==='hero-choke'),'choke did not start');
    game.step(p.windup+.05);
    const grab=events.find(e=>e.type==='hero-choke-grab');
    assert.ok(grab?.targets.includes(bot.id),'choke grabbed no target');
    assert.equal(bot.chokedBy,vader);
    const start=game.ctx.time;game.step(.8);
    assert.match(bot.body.reaction(),/^choke-(enter|loop)$/);
    assert.ok(bot.body.model.position.y>.3,`victim lift ${bot.body.model.position.y.toFixed(2)} m`);
    const held=copySpread(bot.body.model);
    assert.ok(held.copies>=2&&held.worst<.002,`choked trooper parts detached by ${held.worst.toFixed(3)} m`);
    game.step(p.duration);
    assert.ok(!bot.chokedBy,'hold must end');
    assert.ok(!events.some(e=>e.type==='shot'&&e.actor===bot.id&&e.time>start&&e.time<start+.7),'choked trooper kept firing');
    // Source damage: initial + perSecond*interval per interval over the hold (about 130).
    const expected=p.initialDamage+p.damagePerSecond*p.duration;
    assert.ok(Math.abs((before-bot.health)-expected)<1.5||!bot.alive,`choke dealt ${before-bot.health}, expected ${expected}`);
  } finally {game.dispose();}
});

test('saber throw flies out, hits and returns to the hand',{skip:!available},async()=>{
  const game=await arena({distance:9});
  try {
    const {vader,bot,events}=game;
    game.step(.4);
    game.step(1/60,{pressed:{KeyQ:true}});
    assert.ok(events.some(e=>e.type==='hero-throw'));
    game.step(4);
    assert.ok(events.some(e=>e.type==='hero-throw-hit'&&e.target===bot.id),'thrown saber missed');
    assert.equal(vader.hero.state.saberInHand,true);assert.equal(vader.hero.state.thrown,null);
  } finally {game.dispose();}
});

test('strikes lunge by their source root motion and chain at the recovered windows',{skip:!available},async()=>{
  const game=await arena({distance:40});
  try {
    const {vader,events}=game;
    game.step(.3);
    const start=vader.controller.getFeetPosition(),forward=game.runtime.forward(vader).setY(0).normalize();
    game.step(1/60,{pressed:{fire:true}},{aim:false});
    game.step(1.2,{},{aim:false});
    const lunge=vader.controller.getFeetPosition().sub(start).dot(forward);
    // strike1 AITrajectory: 1.80 m to its end, -0.17 m in BackToIdle, x1.1 rig scale.
    assert.ok(lunge>1.4&&lunge<2.3,`strike1 lunge ${lunge.toFixed(2)} m`);
    game.step(.6,{},{aim:false});
    events.length=0;
    game.step(2.4,{fire:true},{aim:false});
    const strikes=events.filter(e=>e.type==='hero-strike');
    assert.deepEqual(strikes.slice(0,3).map(e=>e.clip),['strike1','strike2','strike3']);
    for(let i=1;i<strikes.length;i++)assert.ok(strikes[i].time-strikes[i-1].time>=.48-1e-6,'chained before the source window opened');
  } finally {game.dispose();}
});

test('dodge follows the source evade trajectory',{skip:!available},async()=>{
  const game=await arena({distance:40});
  try {
    const {vader}=game;
    game.step(.3);
    const start=vader.controller.getFeetPosition(),yaw=vader.controller.yaw,right=new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw));
    game.step(1/60,{moveX:-1,pressed:{AltLeft:true}},{aim:false});
    game.step(.9,{},{aim:false});
    const left=-vader.controller.getFeetPosition().sub(start).dot(right);
    assert.ok(left>3.2&&left<5,`dodge-left moved ${left.toFixed(2)} m`);
  } finally {game.dispose();}
});

test('deaths play the source clip for the side hit and the body stays on the floor until respawn',{skip:!available},async()=>{
  const game=await arena({distance:12,respawnSeconds:6});
  try {
    const {runtime,bot}=game;
    game.step(1);
    const facing=new THREE.Vector3(-Math.sin(bot.controller.yaw),0,-Math.cos(bot.controller.yaw));
    const right=new THREE.Vector3().crossVectors(facing,new THREE.Vector3(0,1,0));
    const cases=[[facing.clone().negate(),'front'],[facing.clone(),'back'],[right.clone(),'left'],[right.clone().negate(),'right']];
    for(const [direction,side] of cases) {
      bot.deathCause='blaster';bot.deathDirection=direction;bot.moving=false;
      assert.match(runtime.deathReaction(bot),new RegExp(`^blaster-death-${side}(-\\d+)?$`),`bolt arriving on the ${side}`);
      bot.deathCause='saber';
      assert.match(runtime.deathReaction(bot),new RegExp(`^saber-death-${{front:'fwd',back:'bwd',left:'left',right:'right'}[side]}(-\\d+)?$`));
    }
    bot.deathCause='choke';assert.match(runtime.deathReaction(bot),/^choke-death/);
    // A real kill through the production damage path.
    assert.ok(runtime.applyDamage(bot,1000,game.vader,{cause:'blaster',direction:facing.clone().negate()}));
    assert.match(bot.body.reaction(),/^blaster-death-front/);
    game.step(2.5,{},{aim:false});runtime.updateView(1/60);
    assert.equal(bot.alive,false);assert.equal(bot.body.root.visible,true,'the corpse must stay visible until respawn');
    const head=new THREE.Vector3();bot.body.model.getObjectByName('Head').getWorldPosition(head);
    assert.ok(head.y-bot.controller.getFeetPosition().y<.5,`corpse head ${head.y.toFixed(2)} m, not on the floor`);
    const parts=copySpread(bot.body.model);assert.ok(parts.worst<.002,`corpse parts ${parts.worst.toFixed(3)} m apart`);
    game.step(4,{},{aim:false});runtime.updateView(1/60);
    assert.equal(bot.alive,true,'bot respawns');assert.equal(bot.body.reaction(),null);
  } finally {game.dispose();}
});
