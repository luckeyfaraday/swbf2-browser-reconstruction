import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import {createSoldierHitboxes} from './hitboxes.js';
import {trimUnusedBones,retargetClipToCopies} from './skeleton-trim.js';

// Third-person hero actor: the source Vader mesh on the shared human rig, the
// source hilt on the rig's weapon bone, and the decoded source clips driven by a
// small browser state machine. The native animation graph (blend trees, sync
// groups, IK, additive layers) is not reconstructed; clips crossfade.

// Runtime clip roles -> clip names in vader-animations.glb. The first name found
// wins, so alternate spellings from the decoder are accepted.
export const HERO_CLIP_ROLES=Object.freeze({
  idle:['idle','stand-idle'],
  walk:{fwd:['walk-fwd'],fwdleft:['walk-fwdleft','walk-fwd-left'],fwdright:['walk-fwdright','walk-fwd-right'],left:['walk-left1','walk-left'],right:['walk-right1','walk-right'],bwd:['walk-bwd'],bwdleft:['walk-bwdleft','walk-bwd-left'],bwdright:['walk-bwdright','walk-bwd-right']},
  run:{fwd:['run-fwd'],fwdleft:['run-fwdleft','run-fwd-left'],fwdright:['run-fwdright','run-fwd-right'],left:['run-left1','run-left'],right:['run-right1','run-right'],bwd:['run-bwd'],bwdleft:['run-bwdleft','run-bwd-left'],bwdright:['run-bwdright','run-bwd-right']},
  sprint:['sprint','sprint-fwd'],
  blockIdle:['block-idle'],
  blockWalk:{fwd:['block-walk-fwd'],fwdleft:['block-walk-fwdleft','block-walk-fwd-left'],fwdright:['block-walk-fwdright','block-walk-fwd-right'],left:['block-walk-left1','block-walk-left'],right:['block-walk-right1','block-walk-right'],bwd:['block-walk-bwd'],bwdleft:['block-walk-bwdleft','block-walk-bwd-left'],bwdright:['block-walk-bwdright','block-walk-bwd-right']},
  inAir:['in-air','inair-low','jump-loop'],
  jump:['jump','jump-fwd'],
  death:['death','defeated'],
});

const DIRECTIONS=['fwd','fwdright','right','bwdright','bwd','bwdleft','left','fwdleft'];
export function moveDirection(localX,localZ) {
  // localZ forward +, localX right +. Eight sectors centred on the cardinal axes.
  const angle=Math.atan2(localX,localZ),sector=Math.round(angle/(Math.PI/4));
  return DIRECTIONS[(sector+8)%8];
}

function firstClip(byName,names) {for(const name of names??[])if(byName.has(name))return byName.get(name);return null;}

export function createHeroBody(hero,{hitboxDocument=null,scale=1,rotationY=Math.PI}={}) {
  const root=new THREE.Group(),model=cloneSkeleton(hero.model.gltf.scene);
  model.scale.setScalar(scale);model.rotation.y=rotationY;
  model.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});root.add(model);
  const attach=hero.saber.attach??{};
  const socket=model.getObjectByName(attach.bone??'Wep_Root');
  if(!socket)throw new Error(`Hero saber socket bone missing: ${attach.bone??'Wep_Root'}`);
  const saber=new THREE.Group();saber.name='hero-saber';
  const hilt=cloneSkeleton(hero.saber.gltf.scene);
  // Nested attachment nodes must never shadow actor bone names for track binding.
  hilt.traverse(node=>{node.name=`attachment_${node.uuid}_${node.name}`;});
  saber.add(hilt);
  if(attach.position)saber.position.fromArray(attach.position);
  if(attach.quaternion)saber.quaternion.fromArray(attach.quaternion);
  socket.add(saber);
  const blade=createBlade(hero.saber.blade);blade.root.position.fromArray(hero.saber.blade.origin);
  blade.root.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3().fromArray(hero.saber.blade.axis).normalize());
  saber.add(blade.root);
  const hitboxes=createSoldierHitboxes(model,hitboxDocument);
  const boneTrim=trimUnusedBones(model,hitboxes?.capsules.map(capsule=>capsule.bone)??[]);

  const mixer=new THREE.AnimationMixer(model),byName=new Map();
  // Body and cape each carry a skeleton copy; every copy follows the decoded clip.
  for(const clip of hero.animations.gltf.animations)byName.set(clip.name,retargetClipToCopies(clip,hero.animations.gltf.scene,model));
  const actions=new Map();
  const action=clip=>{
    if(!clip)return null;
    let found=actions.get(clip);
    if(!found){found=mixer.clipAction(clip);actions.set(clip,found);}
    return found;
  };
  const roles={};
  for(const [role,names]of Object.entries(HERO_CLIP_ROLES))
    roles[role]=Array.isArray(names)?firstClip(byName,names):Object.fromEntries(Object.entries(names).map(([dir,list])=>[dir,firstClip(byName,list)]));

  let current=null,currentKey=null,oneShot=null;
  const tipLocal=new THREE.Vector3(0,hero.saber.blade.length,0),baseLocal=new THREE.Vector3();
  const play=(clip,{loop=true,fade=.18,timeScale=1,restart=false,key=clip?.name}={})=>{
    const next=action(clip);if(!next)return null;
    if(next===current&&!restart&&key===currentKey){next.timeScale=timeScale;return next;}
    next.reset();next.setLoop(loop?THREE.LoopRepeat:THREE.LoopOnce,loop?Infinity:1);next.clampWhenFinished=!loop;next.timeScale=timeScale;
    if(current&&current!==next){current.fadeOut(fade);next.fadeIn(fade);}else if(current===next){next.setEffectiveWeight(1);}
    next.play();current=next;currentKey=key;return next;
  };

  const locomotion=state=>{
    const {localVelocity,grounded,blocking,sprinting}=state;
    const speed=Math.hypot(localVelocity.x,localVelocity.z),dir=moveDirection(localVelocity.x,localVelocity.z);
    if(!grounded&&roles.inAir)return {clip:roles.inAir};
    if(blocking)return {clip:speed>.4?(roles.blockWalk[dir]??roles.blockWalk.fwd??roles.blockIdle):roles.blockIdle??roles.idle};
    if(speed<.4)return {clip:roles.idle};
    if(sprinting&&dir==='fwd'&&roles.sprint)return {clip:roles.sprint};
    const set=speed>state.runThreshold?roles.run:roles.walk;
    return {clip:set[dir]??set.fwd??roles.idle};
  };

  return {
    root,model,hitboxes,boneTrim,rotationY,scale,placeholder:false,hero:true,saber,blade,clips:byName,roles,
    /** Starts a one-shot clip (strike, ability, dodge, reaction). */
    playOnce(name,{fade=.1,timeScale=1,hold=false}={}) {
      const clip=typeof name==='string'?byName.get(name):name;
      if(!clip)return null;
      oneShot={clip,hold,timeScale,started:false,token:Symbol(name)};
      return {duration:clip.duration/timeScale,clip};
    },
    playLoop(name,{fade=.15,timeScale=1}={}) {
      const clip=byName.get(name);if(!clip)return null;
      oneShot={clip,hold:true,loop:true,timeScale,started:false,token:Symbol(name)};return {duration:clip.duration,clip};
    },
    clearOneShot(){oneShot=null;},
    oneShotTime(){return oneShot&&current?current.time:0;},
    has:name=>byName.has(name),
    duration:name=>byName.get(name)?.duration??0,
    clipExtras:name=>byName.get(name)?.userData??null,
    saberVisible(visible){saber.visible=visible;},
    bladeSegment(base=new THREE.Vector3(),tip=new THREE.Vector3()) {
      blade.root.updateWorldMatrix(true,false);
      base.copy(baseLocal).applyMatrix4(blade.root.matrixWorld);tip.copy(tipLocal).applyMatrix4(blade.root.matrixWorld);
      return {base,tip};
    },
    update(dt,state) {
      if(!state.alive) {
        if(roles.death)play(roles.death,{loop:false,fade:.12});
      } else if(oneShot) {
        const next=play(oneShot.clip,{loop:!!oneShot.loop,fade:oneShot.started?.18:.1,timeScale:oneShot.timeScale,restart:!oneShot.started,key:oneShot.token});
        oneShot.started=true;
        if(!oneShot.loop&&!oneShot.hold&&next&&next.time>=oneShot.clip.duration-1e-3)oneShot=null;
      }
      if(state.alive&&!oneShot){const loco=locomotion(state);if(loco.clip)play(loco.clip,{loop:true,fade:.2,timeScale:loco.timeScale??1});}
      blade.update(dt,state);
      mixer.update(dt);
      hitboxes?.update();
    },
  };
}

// Blade presentation. Shape, colour and intensity come from the recovered FX
// parameters when present; the additive core/glow construction is a browser
// rendering of the native mesh-particle blade, not its shader.
export function createBlade(source={}) {
  const length=source.length??1.05,radius=source.radius??.018,color=new THREE.Color().fromArray(source.color??[1,.05,.03]);
  const root=new THREE.Group();root.name='hero-blade';
  const coreGeometry=new THREE.CylinderGeometry(radius*.55,radius*.55,length,10,1,false);coreGeometry.translate(0,length/2,0);
  const glowGeometry=new THREE.CapsuleGeometry(radius*2.1,length,4,12);glowGeometry.translate(0,length/2,0);
  const core=new THREE.Mesh(coreGeometry,new THREE.MeshBasicMaterial({color:0xffffff,toneMapped:false}));
  const glow=new THREE.Mesh(glowGeometry,new THREE.MeshBasicMaterial({color,toneMapped:false,transparent:true,opacity:.55,blending:THREE.AdditiveBlending,depthWrite:false}));
  core.castShadow=glow.castShadow=false;core.userData.noShadowCaster=glow.userData.noShadowCaster=true;core.receiveShadow=glow.receiveShadow=false;core.renderOrder=glow.renderOrder=2;
  root.add(glow,core);
  let extended=1;
  return {
    root,length,color,core,glow,
    get extended(){return extended;},
    setExtended(value){extended=THREE.MathUtils.clamp(value,0,1);root.scale.set(1,Math.max(1e-3,extended),1);root.visible=extended>1e-3;},
    setExposure(exposure,intensity=source.intensity??4) {
      const scale=1/Math.max(exposure,1e-6);
      core.material.color.copy(color).lerp(new THREE.Color(1,1,1),.65).multiplyScalar(intensity*scale);
      glow.material.color.copy(color).multiplyScalar(intensity*.9*scale);
    },
    update(dt,state){if(state.bladeTarget!==undefined&&state.bladeTarget!==extended)this.setExtended(extended+Math.sign(state.bladeTarget-extended)*Math.min(Math.abs(state.bladeTarget-extended),dt*6));},
  };
}
