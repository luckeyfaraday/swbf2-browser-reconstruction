import * as THREE from 'three';

// Hero (lightsaber) combat. Tunables come from resolveHeroParameters(): values
// recovered from the installed game (assets/gameplay/hero-vader.json, see
// tools/gameplay-recovery/vader-evidence.md) where present, otherwise the
// labelled browser defaults below. Strike chaining, hit windows and root motion
// follow the decoded state graph and clips (tools/characters/VADER-ANIMATION.md).
// The native character-state graph itself (blend trees, warping, server
// arbitration) is not reconstructed; the state machine here is a browser one.

export const HERO_DEFAULTS=Object.freeze({
  health:1000,
  regen:{delay:Infinity,rate:0,maxAmount:Infinity},
  movement:{moveSpeed:4.4,sprintSpeed:6.2,walkSpeed:2.2,blockSpeed:2.4,chokeSpeed:0,jumpSpeed:7,runThreshold:3,backward:1,strafe:1},
  saber:{damage:90,backBonus:0,rageBonus:0,comboLength:6,comboWindow:[.35,1],activeWindow:[.15,.75],
    hitRadius:3,hitForward:1.5,hitUp:1,hitConeDegrees:35,hitConeMinDistance:1,
    lockRadius:8,lockRadiusNoStamina:2,lockConeDegrees:60,lockMinDistance:1.8,lungeThreshold:4,alignTurnRate:12},
  block:{stamina:100,swingRate:60,deflectRate:8,deflectPulse:.25,meleeRate:15,regenDelay:1,regenRate:35,angleDegrees:80,breakSeconds:1.1,rageCostMultiplier:1,
    deflect:'aim',deflectSpread:0,deflectSpeed:150,deflectDamage:36,deflectEndDamage:30,deflectFalloffStart:20,deflectFalloffEnd:40,deflectLifetime:3},
  choke:{range:10,coneDegrees:18,windup:.5,duration:2.5,damagePerSecond:70,initialDamage:0,interval:0,cooldown:15,selfDamageMultiplier:1},
  throw:{speed:22,range:16,damage:150,cooldown:12,releaseTime:.25,radius:.6,catchDistance:.6,homing:false},
  rage:{duration:8,cooldown:25,damageBonus:0,staminaCostMultiplier:1,shield:0,shieldDepletionDelay:Infinity,shieldDepletionRate:0,damageReduction:.5},
  dodge:{cooldown:1,charges:1,speed:7,duration:.45,protection:0},
  camera:{distance:3.7,shoulder:.55,height:.45,fov:75},
  abilities:{choke:'KeyF',throw:'KeyQ',rage:'KeyE'},
});

// Runtime parameter -> path in the recovered hero document (with an optional
// conversion). Paths whose value is marked inferred there are recorded as such.
const SOURCE_FIELDS={
  'health':'health.max',
  'regen.delay':'health.regen.delay','regen.rate':'health.regen.rate','regen.maxAmount':'health.regen.maxRegenerationAmount',
  'movement.moveSpeed':'movement.runSpeed','movement.sprintSpeed':'movement.sprintSpeed','movement.blockSpeed':'movement.whileBlocking.speed',
  'movement.chokeSpeed':'movement.whileForceChoking.speed','movement.jumpSpeed':'movement.jump.targetVerticalVelocity',
  'movement.backward':'movement.directionScaling.backward','movement.strafe':'movement.directionScaling.right',
  'saber.damage':'lightsaber.damagePerHit','saber.backBonus':'lightsaber.fromBehindBonus','saber.rageBonus':'lightsaber.focusedRageBonus',
  'saber.hitRadius':'lightsaber.hitVolume.serverSphereRadius','saber.hitForward':['lightsaber.hitVolume.sphereCenterLocalZ',v=>-v],
  'saber.hitUp':'lightsaber.hitVolume.sphereCenterUp','saber.hitConeDegrees':'lightsaber.hitVolume.hitConeHalfAngleFromCentre',
  'saber.hitConeMinDistance':'lightsaber.hitVolume.hitConeMinDistance','saber.lockRadius':'lightsaber.targetAcquisition.radius',
  'saber.lockRadiusNoStamina':'lightsaber.targetAcquisition.radiusWhenRestricted','saber.lockConeDegrees':'lightsaber.targetAcquisition.coneHalfAngle',
  'saber.lockMinDistance':'lightsaber.targetAcquisition.minDistance','saber.lungeThreshold':'lightsaber.comboGraph.lungeThreshold',
  'block.stamina':'block.stamina.max','block.swingRate':'block.stamina.meleeSwingRate','block.deflectRate':'block.stamina.blasterDeflectRate',
  'block.deflectPulse':'block.stamina.blasterDeflectPulse','block.meleeRate':'block.stamina.meleeBlockRate','block.regenRate':'block.stamina.regenRate',
  'block.regenDelay':'block.stamina.regenDelay','block.rageCostMultiplier':'block.stamina.focusedRageCostMultiplier',
  'block.angleDegrees':['block.shield.arcAngle',v=>v/2],'block.deflectSpread':'block.deflectedBolt.spread','block.deflectSpeed':'block.deflectedBolt.speed',
  'block.deflectDamage':'block.deflectedBolt.startDamage','block.deflectEndDamage':'block.deflectedBolt.endDamage',
  'block.deflectFalloffStart':'block.deflectedBolt.falloffStart','block.deflectFalloffEnd':'block.deflectedBolt.falloffEnd','block.deflectLifetime':'block.deflectedBolt.timeToLive',
  'choke.range':'forceChoke.range','choke.coneDegrees':['forceChoke.coneAngle',v=>v/2],'choke.windup':'forceChoke.activationTime',
  'choke.duration':'forceChoke.holdDuration','choke.damagePerSecond':'forceChoke.damage.perSecond','choke.initialDamage':'forceChoke.damage.initial',
  'choke.interval':'forceChoke.damage.interval','choke.cooldown':'forceChoke.cooldown',
  'choke.selfDamageMultiplier':'health.damageReceivedModifiers.whileForceChoking.damageMultiplier',
  'throw.speed':'saberThrow.projectile.maxSpeed','throw.range':'saberThrow.outboundDistance','throw.damage':'saberThrow.damage','throw.cooldown':'saberThrow.cooldown',
  'throw.radius':'saberThrow.projectile.hitSphereRadius','throw.catchDistance':'saberThrow.returnCatchDistance','throw.homing':'saberThrow.projectile.homing',
  'rage.duration':'focusedRage.duration','rage.cooldown':'focusedRage.cooldown','rage.damageBonus':'lightsaber.focusedRageBonus',
  'rage.staminaCostMultiplier':'block.stamina.focusedRageCostMultiplier','rage.shield':'focusedRage.damageShield.value',
  'rage.shieldDepletionDelay':'focusedRage.damageShield.depletionStartsAfter',
  'rage.shieldDepletionRate':[['focusedRage.damageShield.depleteStep','focusedRage.damageShield.depleteStepDelay'],(step,delay)=>step/delay],
  'dodge.cooldown':'movement.dodge.rechargeTime','dodge.charges':'movement.dodge.retriggerCount','dodge.protection':'movement.dodge.activeTime',
  'camera.distance':'camera.thirdPerson.antGameStateDistance','camera.shoulder':'camera.thirdPerson.antGameState_0x9ba1eb3c','camera.height':'camera.thirdPerson.antGameState_0x4b69dbd6','camera.fov':'camera.fov',
};
// Values that are interpretations of recovered data rather than direct fields.
const INTERPRETED={
  'rage.damageReduction':{value:0,reason:'focusedRage.damageReduction: none without a star card'},
  'regen.maxAmount':{reason:'MaxRegenerationAmount applied per damage-free regeneration period'},
  'block.angleDegrees':{reason:'shield arc 90 treated as a full arc'},
  'choke.coneDegrees':{reason:'choke cone 35 treated as a full angle'},
  'camera.shoulder':{reason:'0.45 camera game state taken as the lateral shoulder offset (axis unresolved)'},
  'camera.height':{reason:'0.17 camera game state taken as the vertical offset (axis unresolved)'},
};

const readPath=(document,path)=>path.split('.').reduce((node,key)=>node?.[key],document);
const fieldValue=node=>node&&typeof node==='object'&&!Array.isArray(node)&&'value'in node?node:null;

export function resolveHeroParameters(document=null) {
  const parameters=structuredClone(HERO_DEFAULTS),sourced=[],inferred=[],provisional=[];
  const assign=(path,value)=>{const keys=path.split('.'),last=keys.pop();keys.reduce((node,key)=>node[key],parameters)[last]=value;};
  const values=document?.runtime??null;
  for(const [path,spec] of Object.entries(SOURCE_FIELDS)) {
    if(!document)break;
    const [paths,convert]=Array.isArray(spec)?spec:[spec,null],list=[].concat(paths);
    const fields=list.map(p=>fieldValue(readPath(document,p)));
    if(fields.some(f=>!f||(typeof f.value!=='number'&&typeof f.value!=='boolean')))continue;
    const raw=fields.map(f=>f.value),value=convert?convert(...raw):raw[0];
    assign(path,value);
    (fields.some(f=>f.inferred)||INTERPRETED[path]?inferred:sourced).push(path);
  }
  if(document&&!values)for(const [path,row]of Object.entries(INTERPRETED))if('value'in row){assign(path,row.value);if(!inferred.includes(path))inferred.push(path);}
  // A plain {runtime:{...}} override document (tests, experiments).
  const plain=v=>v&&typeof v==='object'&&!Array.isArray(v)?('value'in v?v.value:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,plain(x)]))):v;
  const walkOverride=(node,prefix)=>{for(const [key,value]of Object.entries(node)){const path=prefix?`${prefix}.${key}`:key;if(value&&typeof value==='object'&&!Array.isArray(value)&&!('value'in value))walkOverride(value,path);else{assign(path,plain(value));sourced.push(path);}}};
  if(values)walkOverride(values,'');
  const leaves=(node,prefix)=>Object.entries(node).flatMap(([k,v])=>v&&typeof v==='object'&&!Array.isArray(v)?leaves(v,`${prefix}${k}.`):[`${prefix}${k}`]);
  for(const path of leaves(HERO_DEFAULTS,''))if(!sourced.includes(path)&&!inferred.includes(path))provisional.push(path);
  return {parameters,provenance:{sourced,inferred,provisional,interpretations:INTERPRETED,evidence:document?.evidenceId??null,unresolved:document?.unresolved??[]}};
}

const tmpA=new THREE.Vector3(),tmpB=new THREE.Vector3(),tmpC=new THREE.Vector3(),tmpD=new THREE.Vector3();
// Closest distance between segments p1q1 and p2q2 (Ericson, Real-Time Collision Detection 5.1.9).
export function segmentDistance(p1,q1,p2,q2) {
  const d1=tmpA.subVectors(q1,p1),d2=tmpB.subVectors(q2,p2),r=tmpC.subVectors(p1,p2);
  const a=d1.dot(d1),e=d2.dot(d2),f=d2.dot(r);let s,t;
  if(a<=1e-12&&e<=1e-12)return r.length();
  if(a<=1e-12){s=0;t=THREE.MathUtils.clamp(f/e,0,1);}
  else{const c=d1.dot(r);if(e<=1e-12){t=0;s=THREE.MathUtils.clamp(-c/a,0,1);}else{const b=d1.dot(d2),denom=a*e-b*b;s=denom!==0?THREE.MathUtils.clamp((b*f-c*e)/denom,0,1):0;t=(b*s+f)/e;if(t<0){t=0;s=THREE.MathUtils.clamp(-c/a,0,1);}else if(t>1){t=1;s=THREE.MathUtils.clamp((b-c)/a,0,1);}}}
  const c1=tmpD.copy(p1).addScaledVector(d1,s),c2=p2.clone().addScaledVector(d2,t);
  return c1.distanceTo(c2);
}

export function sampleMotion(motion,time) {
  const t=motion.t,p=motion.p;if(time<=t[0])return p[0];if(time>=t[t.length-1])return p[p.length-1];
  let i=1;while(t[i]<time)i++;
  const f=(time-t[i-1])/(t[i]-t[i-1]),a=p[i-1],b=p[i];return [a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f,a[2]+(b[2]-a[2])*f];
}
const angleDifference=(to,from)=>Math.atan2(Math.sin(to-from),Math.cos(to-from));
const yawTo=(from,to)=>{const d=to.clone().sub(from);return Math.atan2(-d.x,-d.z);};
const forwardOf=yaw=>new THREE.Vector3(-Math.sin(yaw),0,-Math.cos(yaw));

export function createHeroState(parameters) {
  return {
    parameters,action:null,stamina:parameters.block.stamina,staminaDelay:0,blockBroken:0,blocking:false,deflectPulse:0,
    cooldowns:{choke:0,throw:0,rage:0,dodge:0},dodgeCharges:parameters.dodge.charges,rage:0,rageShield:0,rageElapsed:0,thrown:null,saberInHand:true,
    alignYaw:null,lockTarget:null,attackBuffer:0,abilityBuffer:null,regenerated:0,
    strikes:0,hits:0,deflects:0,chokes:0,choked:0,throws:0,breath:2,wasRage:false,
  };
}

/** Per-hero combat controller. `runtime` is the BattleRuntime. */
export class HeroCombat {
  constructor(runtime,actor,parameters) {
    Object.assign(this,{runtime,actor,parameters});
    this.state=createHeroState(parameters);
    this.base=new THREE.Vector3();this.tip=new THREE.Vector3();
  }
  get body(){return this.actor.body;}
  reset() {
    this.releaseChoke(false);
    if(this.state.thrown?.mesh)this.state.thrown.mesh.removeFromParent();
    for(const loop of ['throw-spin','rage-loop','choke-loop','choke-bonecrack'])this.audio()?.stopLoop(loop);
    this.state=createHeroState(this.parameters);
    this.body.clearOneShot?.();this.body.saberVisible?.(true);
  }
  snapshot() {
    const s=this.state,a=s.action;
    return {action:a?{type:a.type,clip:a.clip??null,t:+a.t.toFixed(3),duration:+(a.duration??0).toFixed(3),targets:a.targets?.map(t=>t.id)}:null,
      stamina:+s.stamina.toFixed(1),blocking:s.blocking,blockBroken:+s.blockBroken.toFixed(2),rage:+s.rage.toFixed(2),rageShield:Math.round(s.rageShield),
      cooldowns:Object.fromEntries(Object.entries(s.cooldowns).map(([k,v])=>[k,+v.toFixed(2)])),dodgeCharges:s.dodgeCharges,lockTarget:s.lockTarget?.id??null,
      saberInHand:s.saberInHand,thrown:s.thrown?{phase:s.thrown.phase,position:s.thrown.position.toArray().map(v=>+v.toFixed(2))}:null,
      strikes:s.strikes,hits:s.hits,deflects:s.deflects,chokes:s.chokes,choked:s.choked,throws:s.throws};
  }
  /** Body facing: strikes align to the locked target; otherwise the camera yaw. */
  facingYaw(){return this.state.alignYaw??this.actor.controller.yaw;}
  audio(){return this.runtime.heroAudio;}
  sound(event,position){return this.audio()?.play(event,position,{random:this.runtime.ctx.rand});}
  endAction(){this.state.action=null;this.state.alignYaw=null;this.state.lockTarget=null;this.body.clearOneShot?.();}
  staminaCost(rate,seconds){return rate*seconds*(this.state.rage>0?this.parameters.rage.staminaCostMultiplier:1);}
  spendStamina(amount){const s=this.state;s.stamina=Math.max(0,s.stamina-amount);s.staminaDelay=this.parameters.block.regenDelay;}

  /** Consumes the tick's input; returns the movement input the controller should use. */
  update(dt,input,pressed={}) {
    const s=this.state,p=this.parameters,actor=this.actor,time=this.runtime.ctx.time;
    for(const key of ['choke','throw','rage'])s.cooldowns[key]=Math.max(0,s.cooldowns[key]-dt);
    if(s.dodgeCharges<p.dodge.charges){s.cooldowns.dodge=Math.max(0,s.cooldowns.dodge-dt);if(s.cooldowns.dodge<=0){s.dodgeCharges++;if(s.dodgeCharges<p.dodge.charges)s.cooldowns.dodge=p.dodge.cooldown;}}
    s.blockBroken=Math.max(0,s.blockBroken-dt);s.deflectPulse=Math.max(0,s.deflectPulse-dt);
    if(s.rage>0) {
      s.rage=Math.max(0,s.rage-dt);s.rageElapsed+=dt;
      if(s.rageElapsed>=p.rage.shieldDepletionDelay)s.rageShield=Math.max(0,s.rageShield-p.rage.shieldDepletionRate*dt);
      if(s.rage<=0)s.rageShield=0;
    }
    s.staminaDelay=Math.max(0,s.staminaDelay-dt);
    if(s.staminaDelay<=0&&!s.blocking)s.stamina=Math.min(p.block.stamina,s.stamina+p.block.regenRate*dt);
    this.updateThrown(dt);
    if(s.wasRage&&s.rage<=0){this.audio()?.stopLoop('rage-loop');this.sound('rage-end',this.runtime.eye(actor));}
    s.wasRage=s.rage>0;
    if(!actor.alive){s.action=null;s.blocking=false;s.alignYaw=null;actor.controller.animationVelocity=null;return {...input,move:[0,0],fire:false};}
    // Health regeneration: after the source delay, at the source rate, up to the
    // source amount per damage-free period (interpretation of MaxRegenerationAmount).
    if(time-actor.lastDamage<p.regen.delay)s.regenerated=0;
    else if(s.regenerated<p.regen.maxAmount&&actor.health<p.health){const gain=Math.min(p.regen.rate*dt,p.health-actor.health,p.regen.maxAmount-s.regenerated);actor.health+=gain;s.regenerated+=gain;}
    this.breathe(dt);
    // Source per-direction speed scaling applied to the stick.
    let move=[input.move[0]*p.movement.strafe,input.move[1]*(input.move[1]<0?p.movement.backward:1)];
    s.attackBuffer=pressed.fire?.35:Math.max(0,s.attackBuffer-dt);
    for(const ability of ['choke','throw','rage'])if(pressed[p.abilities[ability]])s.abilityBuffer={ability,until:time+.35};
    if(pressed.dodge)s.abilityBuffer={ability:'dodge',until:time+.2};
    if(s.abilityBuffer&&time>s.abilityBuffer.until)s.abilityBuffer=null;
    const a=s.action;
    if(a) {
      a.t+=dt;
      if(a.type==='strike')this.updateStrike(a,input,dt);
      else if(a.type==='strike-end')this.updateStrikeEnd(a,input);
      else if(a.type==='choke')this.updateChoke(a,dt);
      else if(a.type==='throw')this.updateThrow(a);
      else if(a.t>=a.duration)this.endAction();
    }
    if(!s.action||this.canBranch('Ability')) {
      const wanted=s.abilityBuffer?.ability;
      const started=wanted==='choke'?this.beginChoke():wanted==='throw'?this.beginThrow():wanted==='rage'?this.beginRage():wanted==='dodge'&&(!s.action||this.canBranch('Evade'))?this.beginDodge(input):false;
      if(started)s.abilityBuffer=null;
    }
    if(!s.action&&this.wantsAttack(input))this.beginStrike(this.openingStrike(input));
    actor.controller.animationVelocity=this.rootMotion(dt);
    s.blocking=!s.action&&!!input.aim&&s.blockBroken<=0&&s.saberInHand&&s.stamina>=1;
    if(s.blocking)s.staminaDelay=Math.max(s.staminaDelay,dt*2);
    const busy=s.action&&s.action.type!=='strike-end'&&s.action.type!=='choke';
    if(busy)move=[0,0];
    return {...input,move,fire:false,sprint:!!input.sprint&&!s.blocking&&!s.action,jumpPressed:busy?false:input.jumpPressed,jump:busy?false:input.jump,crouch:false};
  }

  /** Controller speeds for the current state (source values; strikes are root motion). */
  movementSpeeds() {
    const m=this.parameters.movement,s=this.state;
    if(s.action?.type==='choke'){const v=s.action.t>=this.parameters.choke.windup?m.chokeSpeed:0;return {move:v,sprint:v,crouch:v};}
    if(s.blocking)return {move:m.blockSpeed,sprint:m.blockSpeed,crouch:m.blockSpeed};
    return {move:m.moveSpeed,sprint:m.sprintSpeed,crouch:m.walkSpeed};
  }

  canBranch(name) {
    const a=this.state.action;if(!a?.clip)return a?.type==='strike-end';
    const window=this.body.clipExtras?.(a.clip)?.branchWindows?.[name];
    return a.type==='strike-end'||!!window&&a.t>=window[0]&&a.t<=window[1];
  }
  breathe(dt) {
    const s=this.state,actor=this.actor;s.breath-=dt;if(s.breath>0)return;
    // Breathing cadence is a browser schedule; the native breathing graph is not recovered.
    const low=actor.health<this.parameters.health*.3,busy=s.action&&s.action.type!=='strike-end';
    const event=low?'breath-lowhealth':busy||s.rage>0||actor.sprinting?'breath-fast':'breath';
    this.sound(event,this.runtime.eye(actor));s.breath=low?2.8:event==='breath-fast'?1.6:3+this.runtime.ctx.rand()*1.5;
  }

  // --- Root motion ----------------------------------------------------------
  // The decoded AITrajectory of the playing clip (source model space: +Z forward,
  // +X the character's left) becomes controller velocity along the body facing,
  // so lunges and dodges keep their authored distance and timing and collide.
  rootMotion(dt) {
    const a=this.state.action;if(!a||!(dt>0))return null;
    const motion=a.clip&&this.body.clipExtras?.(a.clip)?.rootMotion;
    if(!motion?.t?.length)return a.fallbackVelocity??null;
    const from=sampleMotion(motion,Math.max(0,a.t-dt)),to=sampleMotion(motion,a.t),scale=this.body.scale??1;
    const dz=(to[2]-from[2])*scale,dx=(to[0]-from[0])*scale,yaw=this.facingYaw();
    const velocity=new THREE.Vector3((-Math.sin(yaw)*dz-Math.cos(yaw)*dx)/dt,0,(-Math.cos(yaw)*dz+Math.sin(yaw)*dx)/dt);
    if(a.type==='strike')this.stopAtContact(velocity);
    return velocity;
  }
  /** Native strikes warp to their target (Connect alignment, not recovered); the
   *  browser stops the lunge at contact distance instead of passing through. */
  stopAtContact(velocity) {
    if(velocity.lengthSq()<1e-8)return;
    const feet=this.actor.controller.getFeetPosition();
    for(const target of this.runtime.actors) {
      if(!target.alive||target===this.actor||!this.runtime.enemy(this.actor,target))continue;
      const delta=target.controller.getFeetPosition().sub(feet);delta.y=0;
      const distance=delta.length();if(distance>1.15||distance<1e-4)continue;
      delta.multiplyScalar(1/distance);
      const along=velocity.dot(delta);
      if(along>0)velocity.addScaledVector(delta,-along);
    }
  }

  // --- Target acquisition -----------------------------------------------------
  /** Source lock-on: one enemy within the acquisition radius and cone of the camera. */
  acquireTarget() {
    const p=this.parameters.saber,feet=this.actor.controller.getFeetPosition(),aim=forwardOf(this.actor.controller.yaw);
    const radius=this.state.stamina<1?p.lockRadiusNoStamina:p.lockRadius;let best=null;
    for(const target of this.runtime.actors) {
      if(!target.alive||!this.runtime.enemy(this.actor,target))continue;
      const delta=target.controller.getFeetPosition().sub(feet);delta.y=0;const distance=delta.length();
      if(distance>radius)continue;
      const angle=distance>1e-4?delta.normalize().angleTo(aim):0;
      if(angle>THREE.MathUtils.degToRad(p.lockConeDegrees))continue;
      const score=angle+distance/radius*.5;
      if(!best||score<best.score)best={target,distance,score};
    }
    return best;
  }

  // --- Lightsaber strikes -----------------------------------------------------
  // Chaining follows the recovered state graph: each strike opens transitions
  // (AttackType 2 -> next strike, 1 -> lunging closer) at the source window
  // start; without a chain the graph enters the strike's BackToIdle clip at its
  // source sequence time. Source rule for the lunge: a locked target beyond
  // lungeThreshold, or sprinting without a target.
  wantsAttack(input){return this.state.attackBuffer>0||(!!input.fire&&!input.aim);}
  wantsCloser(input,lock) {
    const p=this.parameters.saber;
    return lock?lock.distance>p.lungeThreshold:!!input.sprint&&Math.hypot(...input.move)>.5;
  }
  openingStrike(input) {
    const lock=this.acquireTarget();
    return this.wantsCloser(input,lock)&&this.body.has?.('closer1')?'closer1':'strike1';
  }
  clipFor(target) {
    const m=/(Strike|Closer)_?(\d)(?:_V2)?/i.exec(target??'');if(!m)return null;
    const v2=/_V2$/i.test(target),name=m[1].toLowerCase()==='closer'?`closer${m[2]}`:`strike${m[2]}${v2?'-v2':''}`;
    return this.body.has?.(name)?name:null;
  }
  nextStrike(name,closer) {
    const transitions=this.body.clipExtras?.(name)?.transitions??[];
    const row=transitions.find(t=>t.value===(closer?1:2))??transitions.find(t=>t.value===2);
    const random=transitions.filter(t=>t.condition&&/Random/i.test(JSON.stringify(t.condition)));
    const pick=!closer&&random.length?random[Math.floor(this.runtime.ctx.rand()*random.length)]:row;
    const fallback=()=>{const m=/strike(\d)(-v2)?/.exec(name);if(!m)return 'strike1';const n=Number(m[1])%this.parameters.saber.comboLength+1;return `strike${n}${m[2]&&n!==1?'-v2':''}`;};
    const duration=this.body.duration?.(name)||1;
    return {clip:this.clipFor(pick?.target)??fallback(),window:pick?.window??[this.parameters.saber.comboWindow[0]*duration,Infinity]};
  }
  beginStrike(name) {
    const s=this.state;if(!s.saberInHand)return false;
    const lock=this.acquireTarget();s.lockTarget=lock?.target??null;
    if(s.lockTarget)s.alignYaw=s.alignYaw??this.actor.controller.yaw;
    const played=this.body.playOnce?.(name,{hold:true});
    const extras=this.body.clipExtras?.(name),duration=played?.duration??.55;
    const backToIdle=extras?.sequence?.find(row=>/BackToIdle/.test(row.ant))?.startSec??duration;
    s.action={type:'strike',clip:name,t:0,duration,backToIdle,hitIds:new Set()};
    s.attackBuffer=0;s.strikes++;
    this.sound(/closer|6/.test(name)?'saber-swing-fast':'saber-swing',this.bladeCenter());
    if(this.runtime.ctx.rand()<.35)this.sound('effort-attack',this.runtime.eye(this.actor));
    this.runtime.ctx.log('hero-strike',{actor:this.actor.id,clip:name,index:Number(/\d/.exec(name)?.[0]??1),lock:s.lockTarget?.id??null});
    return true;
  }
  updateStrike(a,input,dt) {
    const s=this.state,p=this.parameters;
    // Attack alignment: turn the body toward the locked target during the swing.
    if(s.lockTarget?.alive) {
      const want=yawTo(this.actor.controller.getFeetPosition(),s.lockTarget.controller.getFeetPosition());
      const turn=THREE.MathUtils.clamp(angleDifference(want,s.alignYaw),-p.saber.alignTurnRate*dt,p.saber.alignTurnRate*dt);s.alignYaw+=turn;
    }
    const window=this.body.clipExtras?.(a.clip)?.hitWindow??[p.saber.activeWindow[0]*a.duration,p.saber.activeWindow[1]*a.duration];
    const inWindow=a.t>=window[0]&&a.t-dt<window[1];
    if(inWindow){this.spendStamina(this.staminaCost(p.block.swingRate,Math.min(dt,window[1]-Math.max(window[0],a.t-dt))));this.applyHitVolume(a);}
    const next=this.nextStrike(a.clip,this.wantsCloser(input,s.lockTarget?{distance:this.distanceTo(s.lockTarget)}:null));
    if(a.t>=next.window[0]&&a.t<=next.window[1]&&this.wantsAttack(input)){this.beginStrike(next.clip);return;}
    if(a.t>=a.backToIdle||a.t>=a.duration) {
      const end=`${a.clip}-end`,played=this.body.has?.(end)&&this.body.playOnce(end);
      // The chain stays open through BackToIdle until the source window closes.
      s.action=played?{type:'strike-end',clip:end,t:0,duration:played.duration,next,elapsed:a.t}:null;
      if(!played)this.endAction();
    }
  }
  updateStrikeEnd(a,input) {
    const since=a.elapsed+a.t;
    if(this.wantsAttack(input)){this.beginStrike(since<=a.next.window[1]?a.next.clip:this.openingStrike(input));return;}
    if(a.t>=a.duration||Math.hypot(...input.move)>.2||input.aim)this.endAction();
  }
  distanceTo(target){const d=target.controller.getFeetPosition().sub(this.actor.controller.getFeetPosition());d.y=0;return d.length();}
  /** Source damage volume: a sphere ahead of the hero intersected with a facing cone. */
  applyHitVolume(a) {
    const p=this.parameters.saber,feet=this.actor.controller.getFeetPosition(),facing=forwardOf(this.facingYaw());
    const center=feet.clone().addScaledVector(facing,p.hitForward*(this.body.scale??1)).add(new THREE.Vector3(0,p.hitUp,0));
    for(const target of this.runtime.actors) {
      if(!target.alive||a.hitIds.has(target.id)||!this.runtime.enemy(this.actor,target)||target.spawnProtection>0)continue;
      const point=this.runtime.aimPoint(target);
      if(point.distanceTo(center)>p.hitRadius)continue;
      const flat=target.controller.getFeetPosition().sub(feet);flat.y=0;const distance=flat.length();
      if(distance>=p.hitConeMinDistance&&flat.normalize().angleTo(facing)>THREE.MathUtils.degToRad(p.hitConeDegrees))continue;
      const eye=this.runtime.eye(this.actor),toTarget=point.clone().sub(eye),length=toTarget.length();
      const wall=length>1e-4?this.runtime.assets.collision.rayIntersect(new THREE.Ray(eye,toTarget.multiplyScalar(1/length)),0,length):null;
      if(wall&&wall.distance<length-.3)continue;
      a.hitIds.add(target.id);this.applySaberHit(target);
    }
  }
  bladeCenter(){if(!this.body.bladeSegment)return this.runtime.eye(this.actor);this.body.bladeSegment(this.base,this.tip);return this.base.clone().add(this.tip).multiplyScalar(.5);}
  applySaberHit(target) {
    const p=this.parameters,s=this.state;
    const facing=forwardOf(target.controller.yaw);
    const toTarget=target.controller.getFeetPosition().sub(this.actor.controller.getFeetPosition());toTarget.y=0;toTarget.normalize();
    // From behind: the victim faces away from the attacker (source facing rule 70 deg).
    const fromBehind=facing.dot(toTarget)>Math.cos(THREE.MathUtils.degToRad(70));
    const damage=p.saber.damage+(fromBehind?p.saber.backBonus:0)+(s.rage>0?p.saber.rageBonus:0);
    s.hits++;
    this.runtime.applyDamage(target,damage,this.actor,{cause:'saber',direction:toTarget});
    this.sound('saber-hit',this.bladeCenter());
    this.runtime.ctx.log('hero-hit',{actor:this.actor.id,target:target.id,damage,fromBehind,health:Math.round(target.health)});
  }

  // --- Block / deflect ------------------------------------------------------
  /** Called for each blaster bolt that reaches the hero. Returns a deflection or null. */
  interceptBolt(projectile) {
    const s=this.state,p=this.parameters.block;
    if(!s.blocking||s.stamina<1)return null;
    const incoming=projectile.direction.clone().negate();incoming.y=0;incoming.normalize();
    const facing=forwardOf(this.facingYaw());
    if(incoming.dot(facing)<Math.cos(THREE.MathUtils.degToRad(p.angleDegrees)))return null;
    // Stamina drains at the source deflect rate over each deflect pulse.
    if(s.deflectPulse<=0){this.spendStamina(this.staminaCost(p.deflectRate,p.deflectPulse));s.deflectPulse=p.deflectPulse;}
    s.deflects++;
    if(s.stamina<1)this.breakBlock();
    const origin=this.bladeCenter();
    let direction=p.deflect==='aim'&&this.actor===this.runtime.player?this.runtime.crosshairDirection(this.actor,origin):projectile.direction.clone().negate();
    if(p.deflectSpread>0) {
      const r=this.runtime.ctx.rand,offset=new THREE.Vector3(r()-.5,r()-.5,r()-.5).multiplyScalar(p.deflectSpread);
      direction=direction.add(offset).normalize();
    }
    this.sound('deflect',origin);
    const weapon={...projectile.weapon,id:'saber-deflect',damage:p.deflectDamage,endDamage:p.deflectEndDamage,damageFalloffStart:p.deflectFalloffStart,damageFalloffEnd:p.deflectFalloffEnd,projectileSpeed:p.deflectSpeed,projectileLifetime:p.deflectLifetime,headMultiplier:1};
    return {origin,direction,weapon};
  }
  breakBlock() {
    const s=this.state;s.blockBroken=this.parameters.block.breakSeconds;s.blocking=false;
    const name=['block-stagger-1','block-stagger-2','block-stagger-3'].find(n=>this.body.has?.(n));
    const played=name&&this.body.playOnce(name);
    s.action={type:'stagger',clip:played?name:null,t:0,duration:played?.duration??this.parameters.block.breakSeconds};
  }
  /** Incoming damage: the Focused Rage shield absorbs first; choking takes the source reduced share. */
  damageTaken(amount,{cause='blaster'}={}) {
    const s=this.state,p=this.parameters;
    if(s.action?.type==='dodge'&&s.action.t<p.dodge.protection&&cause!=='blaster')return 0;
    let remaining=amount*(s.action?.type==='choke'?p.choke.selfDamageMultiplier:1)*(s.rage>0?1-p.rage.damageReduction:1);
    if(s.rageShield>0){const absorbed=Math.min(s.rageShield,remaining);s.rageShield-=absorbed;remaining-=absorbed;}
    return remaining;
  }

  // --- Force choke ----------------------------------------------------------
  /** Every enemy in the source cone and range with line of sight (one with the narrowest angle first). */
  findChokeTargets() {
    const p=this.parameters.choke,eye=this.runtime.eye(this.actor),aim=this.runtime.crosshairRay(this.actor),targets=[];
    for(const target of this.runtime.actors) {
      if(!target.alive||!this.runtime.enemy(this.actor,target)||target.chokedBy||target.spawnProtection>0)continue;
      if(target.hero?.state.blocking)continue;
      const point=this.runtime.aimPoint(target),delta=point.clone().sub(eye),distance=delta.length();
      if(distance>p.range)continue;
      const toPoint=point.clone().sub(aim.origin).normalize(),angle=toPoint.angleTo(aim.direction);
      if(angle>THREE.MathUtils.degToRad(p.coneDegrees))continue;
      const wall=this.runtime.assets.collision.rayIntersect(new THREE.Ray(eye,delta.normalize()),0,distance);
      if(wall&&wall.distance<distance-.4)continue;
      targets.push({target,angle});
    }
    return targets.sort((a,b)=>a.angle-b.angle).map(row=>row.target);
  }
  beginChoke() {
    const s=this.state,p=this.parameters.choke;
    if(s.cooldowns.choke>0)return false;
    const enter=this.body.has?.('choke-enter');
    if(this.state.action)this.endAction();
    if(enter)this.body.playOnce('choke-enter',{hold:true});
    s.cooldowns.choke=p.cooldown;s.chokes++;
    s.action={type:'choke',t:0,duration:p.windup+p.duration,targets:[],grabbed:false,nextTick:0,enterDuration:enter?this.body.duration('choke-enter'):0,looping:false,clip:enter?'choke-enter':null};
    this.sound('choke-start',this.runtime.eye(this.actor));
    this.runtime.ctx.log('hero-choke',{actor:this.actor.id});
    return true;
  }
  updateChoke(a,dt) {
    const p=this.parameters.choke,s=this.state;
    if(!a.looping&&a.t>=a.enterDuration&&this.body.has?.('choke-loop')){this.body.playLoop('choke-loop');a.looping=true;a.clip=null;}
    // The grab lands when the source wind-up (ability activation time) completes.
    if(!a.grabbed&&a.t>=p.windup) {
      // Damage ticks run on the nominal schedule from the grab (initial, then every interval through the hold).
      a.grabbed=true;a.targets=this.findChokeTargets();a.grabbedAt=p.windup;a.nextTick=p.windup+(p.interval||0);
      for(const target of a.targets){target.chokedBy=this.actor;target.chokeTime=0;target.body.react?.('choke-enter');s.choked++;this.runtime.applyDamage(target,p.initialDamage,this.actor,{cause:'choke'});}
      if(a.targets.length){const at=this.runtime.eye(a.targets[0]);this.audio()?.loop('choke-loop',at);this.audio()?.loop('choke-bonecrack',at);}
      this.runtime.ctx.log('hero-choke-grab',{actor:this.actor.id,targets:a.targets.map(t=>t.id)});
    }
    if(a.grabbed) {
      const live=a.targets.filter(t=>t.alive&&t.chokedBy===this.actor);
      for(const target of live)target.chokeTime=a.t-a.grabbedAt;
      if(live.length) {
        // Vader keeps facing the first victim while the hold lasts.
        s.alignYaw=yawTo(this.actor.controller.getFeetPosition(),live[0].controller.getFeetPosition());
        if(p.interval>0){while(a.t>=a.nextTick-1e-9&&a.nextTick<=a.duration+1e-6){for(const target of live)if(target.alive)this.runtime.applyDamage(target,p.damagePerSecond*p.interval,this.actor,{cause:'choke'});a.nextTick+=p.interval;}}
        else for(const target of live)this.runtime.applyDamage(target,p.damagePerSecond*dt,this.actor,{cause:'choke'});
      }
      if(!live.length||a.t>=a.duration)this.releaseChoke(true);
    } else if(a.t>=a.duration)this.releaseChoke(true);
  }
  releaseChoke(end=true) {
    const a=this.state.action;if(a?.type!=='choke')return;
    for(const target of a.targets??[]) {
      if(target.chokedBy!==this.actor)continue;
      target.chokedBy=null;target.chokeTime=0;
      // A surviving victim plays the source release clip before resuming.
      if(target.alive){const exit=target.body.reactionDuration?.('choke-exit-alive');target.body.react?.(exit?'choke-exit-alive':null);target.reactionClear=exit?this.runtime.ctx.time+exit:0;}
    }
    if(this.audio()?.snapshot().loops.includes('choke-loop'))this.sound('choke-end',a.targets?.[0]?this.runtime.eye(a.targets[0]):null);
    this.audio()?.stopLoop('choke-loop');this.audio()?.stopLoop('choke-bonecrack');
    if(end)this.endAction();
  }

  // --- Saber throw ----------------------------------------------------------
  beginThrow() {
    const s=this.state,p=this.parameters.throw;
    if(s.cooldowns.throw>0||!s.saberInHand)return false;
    if(s.action)this.endAction();
    s.cooldowns.throw=p.cooldown;s.throws++;
    const name=['throw-fwd','throw'].find(n=>this.body.has?.(n)),played=name&&this.body.playOnce(name,{hold:true});
    // Release on the clip's ability trigger (TriggerAffectorEnum 6) when recovered.
    const trigger=played?this.body.clipExtras(name)?.triggerAffectorEnum?.find?.(row=>row.value===6)?.window?.[0]:null;
    s.action={type:'throw',t:0,duration:played?.duration??.7,released:false,clip:played?name:null,release:trigger??p.releaseTime,lock:this.acquireTarget()?.target??null};
    this.runtime.ctx.log('hero-throw',{actor:this.actor.id});
    return true;
  }
  updateThrow(a) {
    const s=this.state,p=this.parameters.throw;
    if(!a.released&&a.t>=a.release) {
      a.released=true;s.saberInHand=false;this.body.saberVisible?.(false);
      // Thrown toward whatever the crosshair is on (actor, wall or the far point).
      const origin=this.bladeCenter(),direction=this.runtime.crosshairDirection(this.actor,origin);
      const mesh=this.runtime.createThrownSaber?.(this.actor)??null;
      s.thrown={phase:'out',position:origin.clone(),direction,travel:0,range:p.range,mesh,hitOut:new Set(),hitBack:new Set(),spin:0,homing:p.homing?a.lock:null};
      this.sound('throw',origin);this.audio()?.stopLoop('saber-hum');this.audio()?.loop('throw-spin',origin);
    }
    if(a.t>=a.duration)this.endAction();
  }
  updateThrown(dt) {
    const s=this.state,t=s.thrown,p=this.parameters.throw;if(!t)return;
    const hand=this.bladeCenter(),previous=t.position.clone();
    if(t.phase==='out') {
      // Source projectile homes on the locked target (steering strength not recovered).
      if(t.homing?.alive){const want=this.runtime.aimPoint(t.homing).sub(t.position);if(want.length()>.5)t.direction.lerp(want.normalize(),Math.min(1,dt*6)).normalize();}
      const step=Math.min(p.speed*dt,t.range-t.travel);
      const wall=this.runtime.assets.collision.rayIntersect(new THREE.Ray(t.position.clone(),t.direction),0,step+.1);
      t.position.addScaledVector(t.direction,wall?Math.max(0,wall.distance-.1):step);t.travel+=step;
      if(wall||t.travel>=t.range-1e-4){t.phase='back';this.sound('throw-return',t.position);}
    } else {
      const delta=hand.clone().sub(t.position),distance=delta.length();
      // Source catch radius is 3.5 m; the browser flies the saber into the hand visibly.
      if(distance<Math.min(.6,p.catchDistance)||!this.actor.alive) {
        t.mesh?.removeFromParent();s.thrown=null;s.saberInHand=true;this.body.saberVisible?.(true);
        if(this.actor.alive&&!s.action){const played=this.body.has?.('catch')&&this.body.playOnce('catch');if(played)s.action={type:'catch',clip:'catch',t:0,duration:Math.min(played.duration,.6)};}
        this.audio()?.stopLoop('throw-spin');this.sound('catch',hand);
        if(this.actor.alive)this.audio()?.loop('saber-hum',hand);
        return;
      }
      t.position.addScaledVector(delta.normalize(),Math.min(distance,p.speed*dt));
    }
    t.spin+=dt*28;this.audio()?.moveLoop('throw-spin',t.position);
    if(t.mesh){t.mesh.position.copy(t.position);t.mesh.rotation.set(0,Math.atan2(-t.direction.x,-t.direction.z),0);t.mesh.rotateX(Math.PI/2);t.mesh.rotateY(t.spin);}
    const hits=t.phase==='out'?t.hitOut:t.hitBack;
    for(const target of this.runtime.actors) {
      if(!target.alive||hits.has(target.id)||!this.runtime.enemy(this.actor,target)||target.spawnProtection>0)continue;
      const capsules=target.body.hitboxes?.capsules;let close=false;
      // Swept between ticks: the saber covers ~0.6 m per 60 Hz tick at source speed.
      if(capsules){for(const c of capsules)if(segmentDistance(previous,t.position,c.start,c.end)<=c.radius+p.radius){close=true;break;}}
      else close=this.runtime.aimPoint(target).distanceTo(t.position)<p.radius+.4;
      if(!close)continue;
      hits.add(target.id);s.hits++;
      this.runtime.applyDamage(target,p.damage,this.actor,{cause:'saber-throw',direction:t.position.clone().sub(previous).setY(0).normalize()});
      this.sound('saber-hit',t.position);
      this.runtime.ctx.log('hero-throw-hit',{actor:this.actor.id,target:target.id,phase:t.phase,health:Math.round(target.health)});
    }
  }

  // --- Focused rage ---------------------------------------------------------
  beginRage() {
    const s=this.state,p=this.parameters.rage;
    if(s.cooldowns.rage>0)return false;
    if(s.action)this.endAction();
    s.cooldowns.rage=p.cooldown;s.rage=p.duration;s.rageElapsed=0;s.rageShield=p.shield;
    const played=this.body.has?.('rage')&&this.body.playOnce('rage');
    s.action={type:'rage',t:0,duration:played?.duration??.8,clip:played?'rage':null};
    this.sound('rage-start',this.runtime.eye(this.actor));this.audio()?.loop('rage-loop',this.runtime.eye(this.actor));
    this.runtime.ctx.log('hero-rage',{actor:this.actor.id});
    return true;
  }

  // --- Dodge ----------------------------------------------------------------
  beginDodge(input) {
    const s=this.state,p=this.parameters.dodge;
    if(s.dodgeCharges<1||!this.actor.controller.grounded)return false;
    if(s.action)this.endAction();
    const [x,y]=Math.hypot(...input.move)>.05?input.move:[0,-1];
    const dir=Math.abs(x)>Math.abs(y)?(x>0?'right':'left'):(y>0?'front':'back');
    const name=`dodge-${dir}`,played=this.body.has?.(name)&&this.body.playOnce(name);
    // The source dodge covers ~3.8-4 m, 90% of it by ~0.65 s; control returns at
    // the clip's Movement branch window.
    const movementBranch=played?this.body.clipExtras(name)?.branchWindows?.Movement:null;
    const duration=played?Math.min(played.duration,movementBranch?.[0]??p.duration*1.75):p.duration;
    const local=new THREE.Vector3(dir==='right'?1:dir==='left'?-1:0,0,dir==='front'?-1:dir==='back'?1:0);
    local.applyAxisAngle(new THREE.Vector3(0,1,0),this.actor.controller.yaw).multiplyScalar(p.speed);
    if(s.dodgeCharges===p.charges)s.cooldowns.dodge=p.cooldown;
    s.dodgeCharges--;
    s.action={type:'dodge',t:0,duration,dir,clip:played?name:null,fallbackVelocity:played?null:local};
    this.runtime.ctx.log('hero-dodge',{actor:this.actor.id,dir});
    return true;
  }
}
