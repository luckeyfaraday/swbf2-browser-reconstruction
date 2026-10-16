import * as THREE from 'three';
import {PlayerController} from '../vendor/vibe-engine/kits/fps/player-controller.js';
import {sampleRollTrajectory} from './roll-clip-adapter.js';

export const ROLL_POLICY=Object.freeze({
  evidence:['EV-ROLL-GRAPH-20261015-01','EV-ROLL-ANIM-20261015-01'],
  graphTicksPerSecond:90,
  observed:'Original body clips, trajectory samples, airborne branch at 40 with ground distance at least 1.7m, movement branch at 52, grounded idle return at 78, recharge field 4 seconds.',
  inferred:'Browser clock 90 ticks/s; one available roll with full recharge after activation; closest cardinal input/velocity direction; grounded entry/exit and feet ray for air exit; body trajectory uses source model rotation.',
  limitations:'Native clock, charge accounting, trajectory steering/warping, CloseToGround2, camera offsets and first-person roll clips are unresolved. No damage immunity is granted.',
});

/** Uses the existing swept capsule/step/gravity path for animated movement. */
export class AnimatedPlayerController extends PlayerController {
  _updateHorizontalVelocity(dt) {
    if(!this.animationVelocity)return super._updateHorizontalVelocity(dt);
    this.velocity.x=this.animationVelocity.x;this.velocity.z=this.animationVelocity.z;
  }
}

export function createRollState(){return {active:false,direction:null,tick:0,cooldown:0,yaw:0};}
export function selectRollDirection([x,y]){
  return Math.abs(x)>Math.abs(y)?x>0?'right':'left':y<=0?'back':'front';
}
export function beginRoll(state,clips,input,controller,{recharge=4}={}){
  if(state.active||state.cooldown>1e-6||!controller.grounded)return false;
  let move=input.move;
  if(Math.hypot(...move)<.05){
    const {x,z}=controller.velocity,yaw=controller.yaw;
    move=[x*Math.cos(yaw)-z*Math.sin(yaw),-x*Math.sin(yaw)-z*Math.cos(yaw)];
    if(Math.hypot(...move)<.05)move=[0,0];
  }
  const direction=selectRollDirection(move);
  if(!clips.some(clip=>clip.direction===direction))return false;
  Object.assign(state,{active:true,direction,tick:0,cooldown:recharge,yaw:controller.yaw});
  controller.velocity.x=0;controller.velocity.z=0;
  return true;
}

/** The next displacement is converted to velocity, never applied as a teleport. */
export function advanceRoll(state,clips,controller,dt,input,{rotationY=Math.PI,groundDistance=null}={}){
  state.cooldown=Math.max(0,state.cooldown-dt);
  controller.animationVelocity=null;
  if(!state.active)return false;
  const airborne=state.tick>=40&&!controller.grounded&&groundDistance!==null&&groundDistance>=1.7;
  if(airborne||((state.tick>=78||(state.tick>=52&&Math.hypot(...input.move)>.05))&&controller.grounded)){
    state.active=false;state.exit=airborne?'airborne':'grounded';
    if(!airborne){controller.velocity.x=0;controller.velocity.z=0;}return false;
  }
  const clip=clips.find(clip=>clip.direction===state.direction),nextTick=state.tick+dt*ROLL_POLICY.graphTicksPerSecond;
  const from=sampleRollTrajectory(clip,state.tick),to=sampleRollTrajectory(clip,nextTick);
  const displacement=new THREE.Vector3(to[0]-from[0],0,to[2]-from[2]);
  displacement.applyAxisAngle(new THREE.Vector3(0,1,0),state.yaw+rotationY);
  controller.animationVelocity=displacement.multiplyScalar(1/dt);
  state.tick=nextTick;
  return true;
}
