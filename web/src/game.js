import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { CollisionNavigation } from './navigation.js';
import {AnimatedPlayerController as PlayerController,createRollState,beginRoll,advanceRoll} from './roll.js';
import { makeCharacter,weaponForTeam } from './assets.js';
import { advanceRound, createRound, damageActor, damageAtDistance, recordKill, resetLife, tickWeapon, tryFire } from './rules.js';
import {createHeatState,startVenting,attemptActiveCooldown} from './weapon-heat.js';
import {createFirstPersonViewmodel} from './firstperson.js';
import {createWeaponSpread} from './weapon-handling.js';
import {createSourceCameraFov} from './camera-fov.js';
import {createSourceFirstpersonVisibility} from './firstperson-scope-visibility.js';
import {createScopeHudState} from './scope-hud.js';
import {createProjectileVisuals,positionProjectileVisual} from './projectile-visuals.js';
import {createFirstPersonProjection} from './firstperson-projection.js';
import {createRifleTrails} from './rifle-trails.js';
import {createCameraRecoil,consumeBrowserRecoil,CAMERA_RECOIL_RUNTIME_POLICY} from './camera-recoil.js';
import {createHeroBody} from './hero-body.js';
import {HeroCombat,resolveHeroParameters} from './hero-combat.js';
import {loadHeroAudio} from './hero-audio.js';
import {createHeroHud} from './hero-hud.js';

const up = new THREE.Vector3(0,1,0);
const round3 = v => v.toArray().map(n => Math.round(n*1000)/1000);
const angleDifference = (to,from) => Math.atan2(Math.sin(to-from),Math.cos(to-from));

export class BattleRuntime {
  constructor({assets,scene,camera,renderer,ui,audio=null,exposure=null}) {
    Object.assign(this,{assets,scene,camera,renderer,ui,audio,exposure});
    this.config = assets.gameplay.parameters;
    this.actors=[]; this.projectiles=[]; this.feed=[]; this.viewThirdPerson=this.config.camera.thirdPerson;
    this.recoilViewThirdPerson=this.viewThirdPerson;
    this.projectileVisuals=createProjectileVisuals(assets.projectileVisualDocument);
    this.rifleTrails=assets.recoveredRifleTrails&&exposure?createRifleTrails(renderer,assets.recoveredRifleTrails):null;
    this.ray = new THREE.Ray(); this.damageFlash=0; this.hitFlash=0; this.lastPhase='menu';
    this.boltGeometry = new THREE.CylinderGeometry(.018,.018,.9,5); this.boltGeometry.rotateX(Math.PI/2);
    this.boltMaterials=[0,1].map(() => new THREE.MeshBasicMaterial({color:this.config.weapon.color,toneMapped:false}));
    this.weaponRoot = new THREE.Group(); this.camera.add(this.weaponRoot);
    const primary=weaponForTeam(assets,0);
    this.sourceCameraFov=createSourceCameraFov(assets.cameraFovDocument,primary?.descriptor.id,{sourceGuid:primary?.descriptor.sourceWeaponGuid});
    if(assets.cameraFovDocument&&!this.sourceCameraFov)throw new Error('Missing selected source camera FOV');
    this.firstPersonVisibility=createSourceFirstpersonVisibility(assets.firstPersonVisibilityDocument,primary?.descriptor.id,{sourceGuid:primary?.descriptor.sourceWeaponGuid});
    if(assets.firstPersonVisibilityDocument&&!this.firstPersonVisibility)throw new Error('Missing selected source first-person visibility');
    this.scopeHud=assets.scopeArtworkDocument?createScopeHudState(assets.scopeArtworkDocument):null;
    const viewmodel=assets.firstPersonModels?.get(primary?.descriptor.id??'primary');
    if(viewmodel){
      this.firstPerson=createFirstPersonViewmodel(viewmodel,{fireDocument:assets.firstPersonFire,aimDocument:assets.firstPersonAim,weaponId:primary?.descriptor.id??'primary'});
      this.weaponRoot.add(this.firstPerson.root);
    }else if(primary) {
      const weapon=cloneSkeleton(primary.gltf.scene), pose=primary.descriptor.firstPerson ?? {};
      weapon.position.fromArray(pose.position ?? [.22,-.22,-.4]); weapon.rotation.fromArray([...(pose.rotation ?? [0,0,0]),'XYZ']); weapon.scale.setScalar(pose.scale ?? primary.descriptor.scale ?? 1);
      this.weaponRoot.add(weapon);
    }
    if(assets.firstPersonProjectionDocument&&primary) {
      this.firstPersonProjection=createFirstPersonProjection(assets.firstPersonProjectionDocument,primary.descriptor.id,{sourceGuid:primary.descriptor.sourceWeaponGuid});
      this.firstPersonProjection.bind(this.weaponRoot);
    }
    this.flash = new THREE.PointLight(0xff6644,0,5,2); this.scene.add(this.flash);
    this.movementCollision=assets.movementCollision??assets.collision;
    this.heroHud=createHeroHud();this.heroAudio=null;this.heroSelection=null;this.heroDefinitions=new Map();
    for(const [id,hero]of assets.heroes?.heroes??[])this.heroDefinitions.set(id,{hero,...resolveHeroParameters(hero.gameplayDocument)});
    this.navigation=assets.manifest.combatArea?.points?new CollisionNavigation(assets.navigationCollision??this.movementCollision,assets.manifest,this.config.player):null;
  }

  init(ctx) {
    this.ctx=ctx; ctx.renderer=this.renderer;
    const count=1+this.config.round.botCount;
    for(let i=0;i<count;i++) {
      const team=i%2, body=makeCharacter(this.assets,team);
      const controller=new PlayerController(null,this.movementCollision,{
        ...this.config.player, jumpSpeed:this.config.player.jumpVelocity,lookSensitivity:1, fixedTimeStep:1/120,
        fallResetY:-1e9, moveSpeed:i ? this.config.bots.moveSpeed : this.config.player.moveSpeed,
      });
      const actor={id:i ? `bot-${i}`:'player',name:i ? `Trooper ${i}`:'You',team,controller,body,thinking:0,stuck:0,lastFeet:new THREE.Vector3(),lookError:[0,0],targetId:null,moving:false,firing:false};
      actor.baseSpeeds={move:controller.moveSpeed,sprint:controller.sprintSpeed,crouch:controller.crouchSpeed};
      const selected=weaponForTeam(this.assets,team)?.descriptor;
      actor.weapon={...this.config.weapon,...selected?.parameters,id:selected?.id??'primary',name:selected?.name??this.config.weapon.name,sourceHeat:selected?.heatConfig??this.config.weapon.sourceHeat};
      actor.projectileLaunch=selected?.projectileLaunch??null;
      if(actor.weapon.sourceHeat)actor.weaponHeat=createHeatState();
      actor.weaponSpread=createWeaponSpread(this.assets.handlingDocument,actor.weapon.id,{random:()=>ctx.rand()});
      if(this.assets.handlingDocument&&!actor.weaponSpread)throw new Error(`Missing native spread configuration for ${actor.weapon.id}`);
      actor.cameraRecoil=i===0?createCameraRecoil(this.assets.cameraRecoilDocument,actor.weapon.id,{sourceGuid:selected?.sourceWeaponGuid,random:()=>ctx.rand()}):null;
      if(i===0&&this.assets.cameraRecoilDocument&&!actor.cameraRecoil)throw new Error(`Missing selected source camera recoil for ${actor.weapon.id}`);
      actor.recoilCompensation={yaw:0,pitch:0};
      actor.roll=createRollState();
      actor.bodies={[team]:body};actor.trooperSpeeds=actor.baseSpeeds;actor.trooperWeapon=actor.weapon;
      resetLife(actor,this.config.player.health); this.actors.push(actor); this.scene.add(body.root);
    }
    // Hero bodies join the scene at boot (hidden) so their materials are compiled
    // with the map instead of hitching on first appearance.
    this.heroBodies=new Map();
    for(const [id,definition]of this.heroDefinitions) {
      const body=createHeroBody(definition.hero,{hitboxDocument:this.assets.hitboxDocument,scale:definition.hero.descriptor.scale??1,rotationY:definition.hero.descriptor.rotationY??Math.PI});
      body.root.visible=false;this.scene.add(body.root);this.assets.sourceProbes?.add(body.root,{moving:true});this.heroBodies.set(id,body);
      const audioDocument=definition.hero.audioDocument;
      if(audioDocument&&!this.heroAudioLoading)this.heroAudioLoading=loadHeroAudio(audioDocument,{baseUrl:definition.hero.audioUrl}).then(audio=>{this.heroAudio=audio;}).catch(error=>{this.ctx.log('hero-audio-error',{message:String(error?.message??error)});});
    }
    const choice=globalThis.document?.getElementById('hero');
    if(choice&&this.heroBodies.size) {
      for(const [id,definition]of this.heroDefinitions)if(![...choice.options].some(o=>o.value===id))choice.add(new Option(definition.hero.descriptor.name??id,id));
      const params=new URLSearchParams(globalThis.location?.search??'');
      if(params.has('hero')&&this.heroDefinitions.has(params.get('hero')))choice.value=params.get('hero');
      globalThis.document.getElementById('hero-choice').hidden=false;
    }
    this.player=this.actors[0]; this.resetRound(this.config.round.mode,false);
    for(const actor of this.actors)this.assets.sourceProbes?.add(actor.body.root,{moving:true});
    this.assets.sourceProbes?.add(this.weaponRoot,{moving:true});
  }

  chooseSpawn(actor) {
    let candidates=this.assets.manifest.spawns.filter(s => this.round.mode==='ffa'||s.team===actor.team);
    if(!candidates.length) candidates=this.assets.manifest.spawns;
    const enemies=this.actors.filter(a => a.alive && a.id!==actor.id && (this.round.mode==='ffa'||a.team!==actor.team));
    const ranked=candidates.map(s => ({spawn:s,safety:Math.min(250,...enemies.map(a => a.controller.getFeetPosition().distanceTo(new THREE.Vector3(...s.position))))+this.ctx.rand()*3}));
    ranked.sort((a,b) => b.safety-a.safety);
    return ranked[0].spawn;
  }

  spawn(actor) {
    resetLife(actor,actor.hero?actor.hero.parameters.health:this.config.player.health);
    actor.hero?.reset();actor.chokedBy=null;actor.chokeTime=0;actor.deathCause=null;actor.diedAt=null;actor.reactionClear=0;
    actor.body.react?.(null);actor.body.setLift?.(0);
    if(actor.hero&&actor===this.player&&this.ctx.phase==='play'){const at=this.eye(actor);this.heroAudio?.stopLoop('saber-hum');this.heroAudio?.play('saber-ignite',at,{random:this.ctx.rand});this.heroAudio?.loop('saber-hum',at);if(this.ctx.rand()<.5)this.heroAudio?.play('vo-intro',at,{random:this.ctx.rand});}
    actor.weaponSpread?.reset();
    actor.cameraRecoil?.reset();actor.recoilCompensation={yaw:0,pitch:0};
    actor.roll=createRollState();actor.aiming=false;actor.moving=false;actor.sprinting=false;actor.controller.animationVelocity=null;
    if(actor===this.player){this.firstPersonVisibility?.reset();this.scopeHud?.reset();this.sourceCameraFov?.reset({aiming:false});this.firstPerson?.update(0,{alive:false});this.firstPerson?.update(0,{alive:true});}
    const spawn=this.chooseSpawn(actor);
    actor.controller.reset(spawn.position,{eye:false,yaw:spawn.yaw??0,pitch:0}); actor.thinking=.2; actor.stuck=0;
    actor.lastFeet.copy(actor.controller.getFeetPosition()); actor.spawnProtection=.8; actor.targetId=null;actor.navPath=[];actor.navIndex=0;actor.navNext=0;actor.unreachableTarget=null;actor.unreachableUntil=0;
    this.updateBody(actor,0);
    this.ctx.log('spawn',{actor:actor.id,position:spawn.position});
  }

  resetRound(mode=this.round?.mode??this.config.round.mode,start=true) {
    for(const p of this.projectiles) p.mesh.removeFromParent(); this.projectiles=[];
    this.projectileVisuals.reset();
    this.rifleTrails?.reset();
    this.round=createRound(this.config.round,mode); this.feed=[]; this.ctx.inputDevice.agentApply({stop:true});
    this.assets.sourceDoors?.reset();
    for(const actor of this.actors) {actor.alive=false;actor.hero?.releaseChoke(false);}
    this.heroAudio?.stopAll();
    this.applyHeroSelection(this.selectedHero());
    for(const actor of this.actors) this.spawn(actor);
    this.damageFlash=0; this.hitFlash=0; this.lastPhase='playing';
    if(start) {this.ctx.phase='play';this.ctx.setPaused(false);this.ctx.result=null;this.ctx.log('round-start',{mode});}
  }

  // --- Hero selection -------------------------------------------------------
  /** Menu choice (#hero select) unless a test pinned one with setHero(). */
  selectedHero() {
    const id=this.heroSelection??globalThis.document?.getElementById('hero')?.value??'';
    return this.heroDefinitions.has(id)?id:null;
  }
  setHero(id){this.heroSelection=id??'';return this.selectedHero();}
  bodyForTeam(actor,team) {
    if(!actor.bodies[team]){const body=makeCharacter(this.assets,team);body.root.visible=false;this.scene.add(body.root);this.assets.sourceProbes?.add(body.root,{moving:true});actor.bodies[team]=body;}
    return actor.bodies[team];
  }
  setActorBody(actor,body) {
    if(actor.body===body)return;
    actor.body.root.visible=false;actor.body=body;
  }
  /** Puts the player on the hero's faction as that hero; bots refill both teams. */
  applyHeroSelection(id) {
    const definition=id?this.heroDefinitions.get(id):null,heroTeam=definition?.hero.descriptor.team??1;
    const playerTeam=definition?heroTeam:0;
    this.actors.forEach((actor,index)=>{
      const team=index===0?playerTeam:(index+playerTeam)%2;
      actor.team=team;
      if(index===0&&definition) {
        if(actor.hero?.heroId!==id){actor.hero=new HeroCombat(this,actor,definition.parameters);actor.hero.heroId=id;}
        this.setActorBody(actor,this.heroBodies.get(id));
        const m=definition.parameters.movement;
        actor.baseSpeeds={move:m.moveSpeed,sprint:m.sprintSpeed,crouch:m.walkSpeed};
        actor.trooperJumpSpeed??=actor.controller.jumpSpeed;actor.controller.jumpSpeed=m.jumpSpeed;
        actor.name=definition.hero.descriptor.name??'Hero';actor.weapon={...actor.trooperWeapon,id:'lightsaber',name:definition.hero.descriptor.weaponName??'LIGHTSABER'};
        return;
      }
      if(index===0){actor.hero=null;actor.name='You';if(actor.trooperJumpSpeed)actor.controller.jumpSpeed=actor.trooperJumpSpeed;}
      actor.baseSpeeds=actor.trooperSpeeds;actor.weapon=actor.trooperWeapon;
      this.setActorBody(actor,this.bodyForTeam(actor,team));
      const selected=weaponForTeam(this.assets,team)?.descriptor;
      if(selected&&actor.weapon.id!==selected.id){actor.weapon={...this.config.weapon,...selected.parameters,id:selected.id,name:selected.name,sourceHeat:selected.heatConfig??this.config.weapon.sourceHeat};actor.trooperWeapon=actor.weapon;actor.projectileLaunch=selected.projectileLaunch??null;actor.weaponHeat=actor.weapon.sourceHeat?createHeatState():null;actor.weaponSpread=createWeaponSpread(this.assets.handlingDocument,actor.weapon.id,{random:()=>this.ctx.rand()});}
    });
    this.heroActive=!!definition;
    if(!definition)this.flash.color.set(0xff6644);
  }
  /** Every actor body the round can show, for up-front shadow caster compilation. */
  shadowRoots(){return [...new Set([...this.actors.flatMap(actor=>Object.values(actor.bodies??{[actor.team]:actor.body})),...this.heroBodies.values()].map(body=>body.root))];}
  maxHealth(actor){return actor.hero?actor.hero.parameters.health:this.config.player.health;}
  crosshairRay(actor=this.player) {
    const pose=this.cameraPose(actor);
    return new THREE.Ray(pose.position,new THREE.Vector3(0,0,-1).applyQuaternion(pose.rotation));
  }
  crosshairDirection(actor,from) {
    const ray=this.crosshairRay(actor),range=this.config.weapon.range;
    const wall=this.assets.collision.rayIntersect(ray,0,range),target=this.hitActor({owner:actor},ray,wall?.distance??range);
    return ray.at(target?.distance??wall?.distance??range,new THREE.Vector3()).sub(from).normalize();
  }
  createThrownSaber(actor) {
    const saber=actor.body.saber;if(!saber)return null;
    const copy=saber.clone(true);copy.visible=true;copy.traverse(node=>{node.visible=true;});
    this.scene.add(copy);return copy;
  }
  /** Damage from any source; heroes apply their own mitigation. */
  applyDamage(target,amount,source,{cause='blaster',direction=null}={}) {
    if(!target.alive||target.spawnProtection>0)return false;
    const final=target.hero?target.hero.damageTaken(amount,{cause}):amount;
    if(target===this.player)this.damageFlash=Math.min(1,this.damageFlash+.35);
    if(source===this.player&&cause!=='choke')this.hitFlash=.12;
    const killed=damageActor(target,final,this.ctx.time);
    if(killed){target.deathCause=cause;target.deathDirection=direction;this.kill(target,source);}
    return killed;
  }
  spawnProjectile(owner,weapon,origin,direction,extra={}) {
    const projectile={owner,weapon,position:origin.clone(),direction:direction.clone().normalize(),travel:0,age:0,...extra};
    if(this.rifleTrails)projectile.mesh=this.rifleTrails.create(projectile,{time:this.ctx.time});
    else {
      const mesh=new THREE.Mesh(this.boltGeometry,this.boltMaterials[owner.team%2]);
      mesh.position.copy(origin);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),projectile.direction);this.scene.add(mesh);projectile.mesh=mesh;
    }
    this.projectiles.push(projectile);
    return projectile;
  }

  eye(actor) { const feet=actor.controller.getFeetPosition(); return feet.add(new THREE.Vector3(0,actor.controller.eyeHeight,0)); }
  aimPoint(actor) {
    // The source rifle stance leans away from the controller's vertical axis.
    // Reconstructed bots aim at the actual animated torso, not empty space
    // above the feet. This does not change player aiming or hit volumes.
    const torso=actor.body.hitboxes?.capsules.find(capsule=>capsule.source.bone==='Spine');
    return torso?torso.start.clone().add(torso.end).multiplyScalar(.5):this.eye(actor);
  }
  probeSpawn(position) {
    // A separate diagnostic capsule. Never relocates or modifies live actors.
    const controller=new PlayerController(null,this.movementCollision,{...this.config.player,jumpSpeed:this.config.player.jumpVelocity,spawn:position,fixedTimeStep:1/120,fallResetY:-1e9});
    for(let frame=0;frame<60;frame++)controller.update(1/60,{move:[0,0]});
    return {arrangement:true,liveControlEvidence:false,position:round3(controller.getFeetPosition()),grounded:controller.grounded};
  }
  probeRoute(from,to,options={}) {
    // Independent diagnostic capsule; never relocates or modifies live actors.
    const player={...this.config.player,...options},controller=new PlayerController(null,this.movementCollision,{...player,jumpSpeed:player.jumpVelocity,spawn:from,fixedTimeStep:1/120,fallResetY:-1e9});
    for(let i=0;i<60;i++)controller.update(1/60,{move:[0,0]});
    const navigation=new CollisionNavigation(this.movementCollision,this.assets.manifest,player),path=navigation.findPath(controller.getFeetPosition(),new THREE.Vector3(...to));
    let index=0,stuck=0,last=controller.getFeetPosition().clone(),frames=0;
    const samples=[];
    for(;frames<3600&&index<path.length;frames++){
      const feet=controller.getFeetPosition();
      while(index<path.length&&feet.distanceTo(path[index])<(options.waypointRadius??.8))index++;
      if(index>=path.length)break;
      const delta=path[index].clone().sub(feet);
      controller.update(1/60,{move:[0,1],yaw:Math.atan2(-delta.x,-delta.z),jumpPressed:options.jump&&stuck>1.2});
      const moved=controller.getFeetPosition().distanceTo(last);last=controller.getFeetPosition().clone();
      stuck=moved<.005?stuck+1/60:0;
      if(frames%120===0)samples.push({frame:frames,index,position:round3(last),next:round3(path[index]),stuck});
      if(stuck>3)break;
    }
    return {arrangement:true,liveControlEvidence:false,options,frames,index,completed:index>=path.length&&path.length>0,position:round3(controller.getFeetPosition()),path:path.map(round3),samples,navigation:navigation.snapshot()};
  }
  forward(actor) { return new THREE.Vector3(0,0,-1).applyEuler(new THREE.Euler(actor.controller.pitch,actor.controller.yaw,0,'YXZ')); }
  enemy(a,b) { return a.id!==b.id && (this.round.mode==='ffa'||a.team!==b.team); }

  updateBody(actor,dt) {
    actor.body.root.position.copy(actor.controller.getFeetPosition());actor.body.root.rotation.y=actor.hero?actor.hero.facingYaw():actor.roll?.active?actor.roll.yaw:actor.controller.yaw;
    if(actor.hero) {
      const c=actor.controller,yaw=c.yaw,v=c.velocity;
      // Velocity in the hero's frame: x right, z forward.
      const local={x:v.x*Math.cos(yaw)-v.z*Math.sin(yaw),z:-v.x*Math.sin(yaw)-v.z*Math.cos(yaw)};
      const s=actor.hero.state;
      actor.body.update(dt,{alive:actor.alive,localVelocity:local,grounded:c.grounded,blocking:s.blocking,sprinting:actor.sprinting,runThreshold:actor.hero.parameters.movement.runThreshold,bladeTarget:s.saberInHand?1:0});
      return;
    }
    actor.body.update(dt,actor.moving,actor.firing,actor.alive,actor.roll);
  }

  cameraPose(actor=this.player) {
    const eye=this.eye(actor),rotation=new THREE.Quaternion().setFromEuler(new THREE.Euler(actor.controller.pitch,actor.controller.yaw,0,'YXZ'));
    const position=eye.clone();
    if(actor===this.player&&actor.alive&&!this.viewThirdPerson&&this.recoilViewThirdPerson===this.viewThirdPerson&&actor.cameraRecoil) {
      rotation.multiply(new THREE.Quaternion().fromArray(actor.cameraRecoil.snapshot().cameraLocalQuaternion)).normalize();
    }
    const heroCamera=actor.hero?.parameters.camera;
    if(heroCamera||this.viewThirdPerson||!actor.alive) {
      const camera=heroCamera??this.config.camera;
      const offset=new THREE.Vector3(camera.shoulder,camera.height,camera.distance).applyQuaternion(rotation);
      const ray=new THREE.Ray(eye,offset.clone().normalize()),hit=this.assets.collision.rayIntersect(ray,0,offset.length());
      position.addScaledVector(ray.direction,hit?Math.max(.08,hit.distance-.18):offset.length());
    }
    return {position,rotation};
  }

  botInput(actor,dt) {
    const feet=actor.controller.getFeetPosition(), eye=this.eye(actor);
    actor.thinking-=dt;
    let target=this.actors.find(a => a.id===actor.targetId && a.alive && this.enemy(actor,a));
    if(actor.thinking<=0) {
      const previousTarget=actor.targetId;
      const enemies=this.actors.filter(a => a.alive && this.enemy(actor,a)&&(a.id!==actor.unreachableTarget||this.ctx.time>=actor.unreachableUntil));
      const ranked=enemies.map(enemy=>{const delta=this.aimPoint(enemy).sub(eye),distance=delta.length();this.ray.set(eye,delta.normalize());const obstruction=this.assets.collision.rayIntersect(this.ray,0,distance);return {enemy,distance,visible:!obstruction||obstruction.distance>=distance-.4};});
      ranked.sort((a,b)=>Number(b.visible)-Number(a.visible)||a.distance-b.distance);
      target=ranked[0]?.enemy;actor.targetId=target?.id;actor.thinking=this.config.bots.reactionTime*(.8+this.ctx.rand()*.5);
      if(actor.targetId!==previousTarget){actor.navNext=0;actor.navPath=[];actor.navIndex=0;}
      actor.lookError=[(this.ctx.rand()-.5)*this.config.bots.aimError,(this.ctx.rand()-.5)*this.config.bots.aimError];
    }
    if(!target) return {move:[0,0]};
    const delta=this.aimPoint(target).sub(eye),distance=delta.length(),direction=delta.normalize();
    this.ray.set(eye,direction);
    const hit=this.assets.collision.rayIntersect(this.ray,0,distance);
    const visible=!hit || hit.distance>=distance-.4;
    let travelDirection=direction;
    if(this.navigation&&(!visible||distance>16)) {
      if(this.ctx.time>=actor.navNext) {
        actor.navPath=this.navigation.findPath(feet,target.controller.getFeetPosition());actor.navIndex=0;
        actor.navNext=this.ctx.time+(actor.navPath.length?3:12);
        if(!actor.navPath.length&&!visible){actor.unreachableTarget=target.id;actor.unreachableUntil=this.ctx.time+8;actor.thinking=0;}
      }
      while(actor.navIndex<actor.navPath.length-1&&feet.distanceTo(actor.navPath[actor.navIndex])<.8)actor.navIndex++;
      const next=actor.navPath[actor.navIndex];
      if(next)travelDirection=next.clone().sub(feet).normalize();
    }
    const targetYaw=Math.atan2(-travelDirection.x,-travelDirection.z)+(visible&&distance<16?actor.lookError[0]:0);
    const targetPitch=Math.asin(THREE.MathUtils.clamp(direction.y,-1,1))+actor.lookError[1];
    const turn=THREE.MathUtils.clamp(angleDifference(targetYaw,actor.controller.yaw),-this.config.bots.aimSpeed*dt,this.config.bots.aimSpeed*dt);
    const aligned=Math.abs(angleDifference(targetYaw,actor.controller.yaw))<.16;
    const moved=feet.distanceTo(actor.lastFeet); actor.lastFeet.copy(feet);
    if(actor.moving&&moved<.005) actor.stuck+=dt; else actor.stuck=Math.max(0,actor.stuck-dt);
    const detour=actor.stuck>.5 ? Math.sin(this.ctx.time*.9+Number(actor.id.split('-')[1]))*.9 : 0;
    const movingTowardPath=actor.navPath?.length&&(!visible||distance>16);
    const move=distance>12||!visible ? [detour,Math.abs(angleDifference(targetYaw,actor.controller.yaw))<.65?1:.1] : distance<6 ? [0,-.5] : [Math.sin(this.ctx.time*.4+actor.team)*.5,0];
    if(actor.stuck>2&&movingTowardPath){actor.navNext=this.ctx.time+1;actor.navIndex=Math.min(actor.navIndex+1,actor.navPath.length-1);}
    return {move,yaw:actor.controller.yaw+turn,pitch:THREE.MathUtils.lerp(actor.controller.pitch,targetPitch,Math.min(1,dt*5)),jumpPressed:actor.stuck>1.2,fire:visible&&aligned&&distance<this.config.bots.fireDistance};
  }

  fire(actor) {
    const weapon=actor.weapon;
    if(!tryFire(actor,weapon,this.ctx.time)) return;
    let direction=this.forward(actor),origin=this.eye(actor);
    if(actor===this.player) {
      // Reconstructed final-shot policy: converge through the rendered crosshair
      // from the shooter's eye. ForceSpawnToCamera's final native recoil/camera
      // correction precedence remains unresolved; do not append raw recoil again.
      const pose=this.cameraPose(actor),aimRay=new THREE.Ray(pose.position,new THREE.Vector3(0,0,-1).applyQuaternion(pose.rotation));
      const wall=this.assets.collision.rayIntersect(aimRay,0,weapon.range);
      const target=this.hitActor({owner:actor},aimRay,wall?.distance??weapon.range);
      const aimPoint=aimRay.at(target?.distance??wall?.distance??weapon.range,new THREE.Vector3());
      direction=aimPoint.clone().sub(origin).normalize();
    }
    if(actor.weaponSpread) {
      const sample=actor.weaponSpread.fire();
      // The native +Z local result is attached to the browser firing ray.
      // This basis/composition is reconstructed; native camera recoil is separate.
      const right=new THREE.Vector3().crossVectors(direction,up);
      if(right.lengthSq()<1e-8)right.set(Math.cos(actor.controller.yaw),0,-Math.sin(actor.controller.yaw));
      right.normalize();
      const localUp=new THREE.Vector3().crossVectors(right,direction).normalize();
      direction.multiplyScalar(sample.localDirection[2]).addScaledVector(right,sample.localDirection[0]).addScaledVector(localUp,sample.localDirection[1]).normalize();
    } else {
      const spread=actor.aiming ? weapon.aimSpread : weapon.spread;
      direction.add(new THREE.Vector3((this.ctx.rand()-.5)*spread,(this.ctx.rand()-.5)*spread,(this.ctx.rand()-.5)*spread)).normalize();
    }
    this.spawnProjectile(actor,weapon,origin,direction);
    this.audio?.shot(origin,this.ctx.lookRand??Math.random,weapon.id);
    actor.firing=true;
    if(actor===this.player&&!this.viewThirdPerson)actor.cameraRecoil?.fire();
    if(actor===this.player) {this.firstPerson?.fire();this.flash.position.copy(origin).addScaledVector(direction,.5);this.flash.intensity=2.5;}
    this.ctx.log('shot',{actor:actor.id,origin:round3(origin),direction:round3(direction)});
  }

  hitActor(projectile, ray, maxDistance) {
    let closest=null;
    for(const target of this.actors) {
      if(!target.alive||target.id===projectile.owner.id||target.spawnProtection>0) continue;
      if(!this.config.round.friendlyFire&&!this.enemy(projectile.owner,target)) continue;
      if(target.body.hitboxes) {
        const hit=target.body.hitboxes.intersect(ray,closest?.distance??maxDistance,center=>{
          const origin=this.eye(target),delta=center.sub(origin),distance=delta.length();
          if(distance<1e-6)return true;
          const obstruction=this.assets.collision.rayIntersect(new THREE.Ray(origin,delta.multiplyScalar(1/distance)),0,distance);
          return !obstruction||obstruction.distance>=distance-.02;
        });
        if(hit&&(!closest||hit.distance<closest.distance))closest={target,...hit};
        continue;
      }
      const feet=target.controller.getFeetPosition();
      const eyeHeight=target.controller.eyeHeight;
      for(const [height,radius,head] of [[eyeHeight*.36,.36,false],[eyeHeight*.7,.35,false],[eyeHeight,.21,true]]) {
        const point=ray.intersectSphere(new THREE.Sphere(feet.clone().add(new THREE.Vector3(0,height,0)),radius),new THREE.Vector3());
        if(!point)continue;
        const distance=point.distanceTo(ray.origin);
        if(distance<=maxDistance && (!closest||distance<closest.distance)) closest={target,distance,head};
      }
    }
    return closest;
  }

  /** Side of the victim a blow arrived on, from its travel direction. */
  hitSide(victim,direction) {
    if(!direction)return 'front';
    const facing=new THREE.Vector3(-Math.sin(victim.controller.yaw),0,-Math.cos(victim.controller.yaw));
    const right=new THREE.Vector3().crossVectors(facing,up),along=direction.dot(facing),across=direction.dot(right);
    // A blow travelling against the facing arrived on the front; one travelling to
    // the victim's right came from its left.
    return Math.abs(along)>=Math.abs(across)?(along<0?'front':'back'):(across>0?'left':'right');
  }
  /** Source death clip for how the actor died. Clip names give the side that was
   *  hit (blaster-death-front falls backwards); variants are chosen at random. */
  deathReaction(victim) {
    const names=victim.body.reactions??[],cause=victim.deathCause;
    const pick=pattern=>{const list=names.filter(n=>pattern.test(n));return list.length?list[Math.floor(this.ctx.rand()*list.length)]:null;};
    if(cause==='choke')return pick(/^choke-death(-\d+)?$/);
    if(!cause)return null;
    const side=this.hitSide(victim,victim.deathDirection);
    if(cause==='saber'||cause==='saber-throw')return pick(new RegExp(`^saber-death-${{front:'fwd',back:'bwd',left:'left',right:'right'}[side]}(-\\d+)?$`))??pick(/^saber-death/);
    const c=victim.controller,speed=Math.hypot(c.velocity.x,c.velocity.z);
    if(speed>3.5&&victim.moving)return pick(/^run-death-fwd(-\d+)?$/)??pick(/^blaster-death/);
    return pick(new RegExp(`^blaster-death-${side}(-\\d+)?$`))??pick(/^blaster-death/);
  }

  kill(victim,killer) {
    victim.alive=false;victim.respawnIn=this.config.round.respawnSeconds;victim.diedAt=this.ctx.time;
    if(victim.chokedBy){const choker=victim.chokedBy;victim.chokedBy=null;if(choker.hero?.state.action?.target===victim)choker.hero.releaseChoke(true);}
    victim.hero?.releaseChoke(true);
    victim.body.react?.(this.deathReaction(victim));
    if(victim===this.player&&victim.hero){const at=this.eye(victim);this.heroAudio?.stopLoop('saber-hum');this.heroAudio?.play('saber-retract',at,{random:this.ctx.rand});this.heroAudio?.play('death',at,{random:this.ctx.rand});}
    victim.cameraRecoil?.reset({alive:false});victim.recoilCompensation={yaw:0,pitch:0};
    if(victim===this.player)this.firstPerson?.update(0,{alive:false});
    recordKill(this.round,killer,victim);
    this.feed.unshift({text:`${killer?.name??'Environment'}  ▸  ${victim.name}`,time:this.ctx.time});this.feed=this.feed.slice(0,5);
    this.ctx.log('kill',{killer:killer?.id??null,victim:victim.id});
  }

  simulate(ctx,dt) {
    if(this.round.phase!=='playing'||!(dt>0)) return;
    advanceRound(this.round,dt);
    if(this.round.phase==='ended') {this.finishRound();return;}
    if(ctx.input.pressed.KeyV&&!this.player.hero) this.viewThirdPerson=!this.viewThirdPerson;
    if(this.recoilViewThirdPerson!==this.viewThirdPerson){this.player.cameraRecoil?.reset({alive:this.player.alive});this.player.recoilCompensation={yaw:0,pitch:0};this.recoilViewThirdPerson=this.viewThirdPerson;}
    this.damageFlash=Math.max(0,this.damageFlash-dt*1.5);this.hitFlash=Math.max(0,this.hitFlash-dt);
    this.flash.intensity=Math.max(0,this.flash.intensity-dt*35);
    this.assets.sourceDoors?.update(dt,this.actors.filter(actor=>actor.alive).map(actor=>actor.controller.collider.start.clone().add(actor.controller.collider.end).multiplyScalar(.5)));
    for(const actor of this.actors) {
      actor.firing=false;actor.pendingFire=false;actor.spawnProtection=Math.max(0,actor.spawnProtection-dt);
      actor.recoilCompensation={yaw:0,pitch:0};
      if(!actor.alive) {actor.respawnIn-=dt;if(actor.respawnIn<=0)this.spawn(actor);continue;}
      let input;
      if(actor===this.player&&actor.hero) {
        // Hero: saber strikes on fire, block on aim, abilities on Q/E/F, dodge on Alt.
        const raw={move:[ctx.input.moveX,ctx.input.moveY],look:[ctx.input.lookX,-ctx.input.lookY],jumpPressed:ctx.input.pressed.jump,jump:ctx.input.jump,sprint:ctx.input.sprint,crouch:false,fire:ctx.input.fire,aim:ctx.input.aim};
        const pressed={...ctx.input.pressed,dodge:ctx.input.pressed.AltLeft||ctx.input.pressed.AltRight};
        input=actor.hero.update(dt,raw,pressed);actor.aiming=false;
        const speeds=actor.hero.movementSpeeds();
        actor.controller.moveSpeed=speeds.move;actor.controller.sprintSpeed=speeds.sprint;actor.controller.crouchSpeed=speeds.crouch;
        actor.moving=Math.hypot(...input.move)>.05&&speeds.move>0;actor.sprinting=!!input.sprint&&actor.moving;
        actor.controller.update(dt,input);
        if(actor.controller.getFeetPosition().y<this.assets.manifest.bounds.min[1]-10) {this.kill(actor,null);continue;}
        continue;
      }
      if(actor.chokedBy) {
        // Held by Force choke: no movement or firing. The source enter clip lifts the
        // victim (its AITrajectory), then the hold loop keeps it in the air.
        actor.moving=false;actor.sprinting=false;actor.controller.update(dt,{move:[0,0]});
        const enter=actor.body.reactionDuration?.('choke-enter')??0,want=actor.chokeTime<enter?'choke-enter':'choke-loop';
        if(actor.body.reaction?.()!==want)actor.body.react?.(want);
        continue;
      }
      if(actor.reactionClear&&ctx.time>=actor.reactionClear){actor.body.react?.(null);actor.reactionClear=0;}
      if(actor===this.player) {
        input={move:[ctx.input.moveX,ctx.input.moveY],look:[ctx.input.lookX,-ctx.input.lookY],jumpPressed:ctx.input.pressed.jump,jump:ctx.input.jump,sprint:ctx.input.sprint,crouch:ctx.input.crouch,fire:ctx.input.fire};
        actor.aiming=ctx.input.aim;
        if(actor.aiming){input.look=input.look.map(value=>value*(this.config.camera.aimLookMultiplier??1));input.sprint=false;}
        if(ctx.input.pressed.reload) {
          if(actor.weaponHeat) {
            const result=actor.weaponHeat.phase==='ready'?startVenting(actor.weaponHeat,actor.weapon.sourceHeat):attemptActiveCooldown(actor.weaponHeat,actor.weapon.sourceHeat);
            if(result)this.ctx.log('cooling',{actor:actor.id,result});
          } else if(actor.heat>.15){actor.overheat=Math.max(actor.overheat,.8);actor.heat=Math.max(0,actor.heat-.55);}
        }
      } else input=this.botInput(actor,dt);
      const clips=this.assets.rollDocument?.clips??[];
      if(actor===this.player&&(ctx.input.pressed.AltLeft||ctx.input.pressed.AltRight)&&beginRoll(actor.roll,clips,input,actor.controller,{recharge:this.assets.rollGraph?.ability.RechargeTime??4}))this.ctx.log('roll',{actor:actor.id,direction:actor.roll.direction});
      let groundDistance=null;
      if(actor.roll.active&&actor.roll.tick>=40&&!actor.controller.grounded){
        const origin=actor.controller.getFeetPosition().add(new THREE.Vector3(0,.05,0));
        groundDistance=(this.movementCollision.rayIntersect(new THREE.Ray(origin,new THREE.Vector3(0,-1,0)),0,1.75)?.distance??Infinity)-.05;
      }
      const rolling=advanceRoll(actor.roll,clips,actor.controller,dt,input,{rotationY:actor.body.rotationY??Math.PI,groundDistance});
      if(rolling){input={...input,move:[0,0],jump:false,jumpPressed:false,sprint:false,crouch:false,fire:false};actor.aiming=false;}
      actor.moving=Math.hypot(...input.move)>.05;
      actor.sprinting=!!input.sprint&&actor.moving;
      const aimSpeed=actor.aiming?(this.config.player.aimMoveMultiplier??1):1;
      actor.controller.moveSpeed=actor.baseSpeeds.move*aimSpeed;actor.controller.sprintSpeed=actor.baseSpeeds.sprint*aimSpeed;actor.controller.crouchSpeed=actor.baseSpeeds.crouch*aimSpeed;
      if(actor===this.player&&actor.cameraRecoil&&!this.viewThirdPerson) {
        const controller=actor.controller,yaw=controller.yaw,pitch=controller.pitch;
        // setInput solves/clamps look once using the actual controller. Consume
        // recoil before its movement step, without applying mouse input twice.
        controller.setInput(input);
        const solved=consumeBrowserRecoil(actor.cameraRecoil.snapshot().nativeRadians,{yaw:angleDifference(controller.yaw,yaw),pitch:controller.pitch-pitch});
        controller.setLook(yaw+solved.baseMovement.yaw,pitch+solved.baseMovement.pitch);
        actor.recoilCompensation=solved.compensation;
        controller.update(dt);
      } else actor.controller.update(dt,input);
      if(actor.controller.getFeetPosition().y<this.assets.manifest.bounds.min[1]-10) {this.kill(actor,null);continue;}
      tickWeapon(actor,actor.weapon,dt,ctx.time);
      if(ctx.time-actor.lastDamage>this.config.player.regenDelay) actor.health=Math.min(this.config.player.health,actor.health+this.config.player.regenRate*dt);
      actor.pendingFire=input.fire&&!input.sprint;
      const controller=actor.controller,speed=Math.hypot(controller.velocity.x,controller.velocity.z);
      const maxSpeed=controller.crouched?controller.crouchSpeed:actor.sprinting?controller.sprintSpeed:controller.moveSpeed;
      actor.weaponSpread?.update(dt,{
        pose:controller.crouched?'crouch':'stand',aiming:!!actor.aiming,
        movement:!controller.grounded?'jumping':actor.sprinting?'sprinting':speed>.05?'moving':'base',
        movementFraction:THREE.MathUtils.clamp(speed/Math.max(maxSpeed,1e-6),0,1),firing:!!actor.pendingFire,
      });
    }
    // Advance the source rig on simulation ticks, so hit volumes and visual
    // poses stay in step even when rendering pauses or uses a different FPS.
    for(const actor of this.actors)this.updateBody(actor,dt);
    // The native curve advances on the browser's simulation clock; the native
    // camera tick frequency and interrupted-transition shortening are unresolved.
    this.sourceCameraFov?.update(dt,{aiming:!!this.player.aiming&&this.player.alive});
    const aimWeight=this.sourceCameraFov?THREE.MathUtils.clamp((this.config.camera.fov-this.sourceCameraFov.snapshot().fov)/(this.config.camera.fov-this.config.camera.aimFov),0,1):Number(!!this.player.aiming);
    this.firstPerson?.update(dt,{sprinting:this.player.sprinting,alive:this.player.alive,aiming:!!this.player.aiming,aimWeight});
    this.firstPersonVisibility?.update(dt,{alive:this.player.alive,aiming:!!this.player.aiming});
    this.scopeHud?.update(dt,{alive:this.player.alive,aiming:!!this.player.aiming,dispersionDegrees:this.player.weaponSpread?.snapshot().dispersionDegrees??0});
    for(const actor of this.actors)if(actor.alive&&actor.pendingFire)this.fire(actor);
    // One spring update per simulation tick, after this tick's accepted shot.
    // Native render/simulation scheduling is not claimed; presentation is read-only.
    this.player.cameraRecoil?.update(dt,{pose:this.player.controller.crouched?'crouch':'stand',aiming:!!this.player.aiming,firing:!!this.player.pendingFire,alive:this.player.alive,recoilCompensation:this.player.recoilCompensation});
    for(let i=this.projectiles.length-1;i>=0;i--) {
      const p=this.projectiles[i],weapon=p.weapon??p.owner.weapon??this.config.weapon;
      const aliveTime=weapon.projectileLifetime>0?Math.min(dt,Math.max(0,weapon.projectileLifetime-(p.age??0))):dt;
      const distance=Math.max(0,Math.min(weapon.projectileSpeed*aliveTime,weapon.range-p.travel));
      this.ray.set(p.position,p.direction);
      const wall=this.assets.collision.rayIntersect(this.ray,0,distance), hit=this.hitActor(p,this.ray,wall?Math.min(distance,wall.distance):distance);
      const deflection=hit?.target.hero?hit.target.hero.interceptBolt(p):null;
      if(deflection) {
        // Retire the incoming bolt at the blade and launch the deflected one from it.
        const at=this.ray.at(hit.distance,new THREE.Vector3());
        this.spawnProjectile(hit.target,deflection.weapon??weapon,deflection.origin??at,deflection.direction,{deflected:true,travel:0});
        this.ctx.log('deflect',{actor:hit.target.id,from:p.owner.id});
      } else if(hit) {
        if(hit.target===this.player)this.damageFlash=1;
        if(p.owner===this.player)this.hitFlash=.12;
        const amount=damageAtDistance(weapon,p.travel+hit.distance)*(hit.head&&!hit.target.hero?weapon.headMultiplier:1);
        const killed=damageActor(hit.target,hit.target.hero?hit.target.hero.damageTaken(amount):amount,ctx.time);
        this.ctx.log('damage',{actor:hit.target.id,from:p.owner.id,health:hit.target.health,head:hit.head,bone:hit.bone??null});
        if(killed){hit.target.deathCause='blaster';hit.target.deathDirection=p.direction.clone();this.kill(hit.target,p.owner);}
      }
      const traveled=hit?.distance??wall?.distance??distance;
      p.position.addScaledVector(p.direction,traveled);p.travel+=traveled;p.age=(p.age??0)+aliveTime;
      positionProjectileVisual(p);
      if(wall||hit||p.travel>=weapon.range||(weapon.projectileLifetime>0&&p.age>=weapon.projectileLifetime)) {this.projectileVisuals.retire(p.mesh,weapon.id);this.projectiles.splice(i,1);}
      if(this.round.phase==='ended') break;
    }
    if(this.round.phase==='ended')this.finishRound();
  }

  finishRound() {
    if(this.ctx.phase==='over')return;
    this.ctx.inputDevice.agentApply({stop:true});
    this.ctx.endMatch({winner:this.round.winner,scores:this.round.scores,reason:this.round.reason});
    this.ui.end(this.round,this.player);
  }

  updateView(dt) {
    if(!this.player)return;
    const player=this.player,pose=this.cameraPose(player);
    this.camera.quaternion.copy(pose.rotation);this.camera.position.copy(pose.position);
    this.audio?.listener(this.camera.position,this.camera.getWorldDirection(new THREE.Vector3()));
    const third=this.viewThirdPerson||!player.alive||!!player.hero;
    const fov=player.aiming?this.config.camera.aimFov:this.config.camera.fov;
    if(player.hero)this.camera.fov=THREE.MathUtils.lerp(this.camera.fov,player.hero.parameters.camera.fov,Math.min(1,dt*10));
    else this.camera.fov=this.sourceCameraFov?.snapshot().fov??THREE.MathUtils.lerp(this.camera.fov,fov,Math.min(1,dt*15));
    this.camera.updateProjectionMatrix();
    this.firstPersonProjection?.update(this.camera,{aiming:!!player.aiming});
    this.weaponRoot.visible=!third&&player.alive&&(this.firstPersonVisibility?.snapshot().bodyVisible??true);
    for(const actor of this.actors) {
      // The fallen body stays where it dropped (its source death clip ends on the
      // floor) until that actor respawns.
      const corpse=!actor.alive&&(actor.body.reaction?.()||actor.hero);
      actor.body.root.visible=(actor.alive||!!corpse)&&(actor!==player||third);
    }
    this.assets.sourceProbes?.update();
  }

  present(ctx,dt) {
    if(!this.player)return;
    this.updateView(dt);
    this.presentHero(dt);
    // Tracer display energy is still provisional. Preserve its unlit display
    // color while the source scene is metered in physical HDR units.
    if(this.exposure&&!this.rifleTrails)for(const material of this.boltMaterials)material.color.set(this.config.weapon.color).multiplyScalar(1/this.renderer.toneMappingExposure);
    this.rifleTrails?.setTime(ctx.time);
    if(this.exposure)this.exposure.render(this.scene,this.camera,dt,this.rifleTrails);else this.renderer.render(this.scene,this.camera);
    this.projectileVisuals.afterPresent();
    this.ui.update(this);
  }

  presentHero(dt) {
    const player=this.player,hero=player.hero;
    this.heroHud?.update(this);
    if(!hero)return;
    const blade=player.body.blade,exposure=this.renderer.toneMappingExposure;
    blade?.setExposure(exposure);
    // The existing muzzle light doubles as the blade's glow; no light is added,
    // so no scene program is recompiled.
    if(player.alive&&blade?.root.visible) {
      const segment=player.body.bladeSegment(new THREE.Vector3(),new THREE.Vector3());
      this.flash.position.copy(hero.state.thrown?hero.state.thrown.position:segment.base.add(segment.tip).multiplyScalar(.5));
      this.flash.color.copy(blade.color);this.flash.intensity=Math.max(this.flash.intensity,.9);
    }
    if(this.heroAudio) {
      this.heroAudio.listener(this.camera.position,this.camera.getWorldDirection(new THREE.Vector3()));
      const target=hero.state.action?.type==='choke'?hero.state.action.target:null;
      if(target){this.heroAudio.moveLoop('choke-loop',this.eye(target));this.heroAudio.moveLoop('choke-bonecrack',this.eye(target));}
      if(player.alive&&hero.state.saberInHand){const segment=player.body.bladeSegment(new THREE.Vector3(),new THREE.Vector3());this.heroAudio.moveLoop('saber-hum',segment.base.add(segment.tip).multiplyScalar(.5));if(!this.heroAudio.snapshot().loops.includes('saber-hum')&&this.ctx.phase==='play')this.heroAudio.loop('saber-hum',segment.base);}
      if(hero.state.rage>0)this.heroAudio.moveLoop('rage-loop',this.eye(player));
    }
  }

  observe() {
    return {map:this.assets.manifest.metadata,round:structuredClone(this.round),hero:this.player.hero?{id:this.player.hero.heroId,team:this.player.team,health:Math.round(this.player.health),...this.player.hero.snapshot(),audio:this.heroAudio?.snapshot()??null,provisional:this.heroDefinitions.get(this.player.hero.heroId)?.provenance.provisional??[]}:null,heroesAvailable:[...this.heroDefinitions.keys()],camera:this.viewThirdPerson?'third-person':'first-person',cameraRecoil:this.player.cameraRecoil?{...this.player.cameraRecoil.snapshot(),compensation:{...this.player.recoilCompensation},runtimePolicy:CAMERA_RECOIL_RUNTIME_POLICY}:null,firstPersonVisibility:this.firstPersonVisibility?.snapshot()??null,scopeHud:this.scopeHud?.snapshot()??null,firstPersonProjection:this.firstPersonProjection?.snapshot()??null,cameraFov:this.sourceCameraFov?.snapshot()??{fov:this.camera.fov,provisional:true},actors:this.actors.map(a=>({id:a.id,team:a.team,alive:a.alive,weapon:a.weapon.id,projectileLaunch:a.projectileLaunch,health:Math.round(a.health),heat:+a.heat.toFixed(3),weaponHeat:a.weaponHeat?structuredClone(a.weaponHeat):null,weaponSpread:a.weaponSpread?.snapshot()??null,roll:structuredClone(a.roll),position:round3(a.controller.getFeetPosition()),yaw:a.controller.yaw,pitch:a.controller.pitch,grounded:a.controller.grounded,respawnIn:a.respawnIn,targetId:a.targetId,stuckSeconds:+a.stuck.toFixed(2),pathRemaining:Math.max(0,(a.navPath?.length??0)-(a.navIndex??0))})),projectiles:this.projectiles.length,projectileVisuals:this.projectileVisuals.snapshot(),rifleTrails:this.rifleTrails?.snapshot()??null,assetStats:this.assets.stats,navigation:this.navigation?.snapshot()??null,nativeMovementOverrides:this.assets.movementOverrides?.length??0,missingCharacterAssets:[...this.assets.characters.keys()].length===0};
  }

  digest() { return {round:this.round,actors:this.actors.map(a=>({id:a.id,health:a.health,alive:a.alive,heat:a.heat,weaponHeat:a.weaponHeat,weaponSpread:a.weaponSpread?.snapshot()??null,cameraRecoil:a.cameraRecoil?.snapshot()??null,recoilCompensation:a.recoilCompensation,roll:a.roll,controller:a.controller.getSnapshot()})),projectiles:this.projectiles.map(p=>({owner:p.owner.id,position:p.position.toArray(),travel:p.travel,age:p.age}))}; }
}
