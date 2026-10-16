import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import {createFirstPersonAimClips} from './firstperson-ads.js';

export const FIRSTPERSON_AIM_RUNTIME_POLICY = Object.freeze({
  evidenceId:'BF2-FIRSTPERSON-ADS-RUNTIME-001',nativeExecutionObserved:false,
  pose:'Original non-additive ZoomPose with the original idle bipod channel mask; no corrective offsets.',
  blend:'Idle and ZoomPose weights follow the current source world-FOV fraction. This coupling and interrupted blending are reconstructed.',
  transitions:'Original enter/exit clips retained separately; native transition clock and state blending remain unresolved.',
  firing:'Existing recovered additive firing overlays the same shared base-pose mixer.',
});

export const FIRSTPERSON_FIRE_POLICY = Object.freeze({
  evidenceId:'BF2-FIRSTPERSON-FIRE-PLAYBACK-001',nativeExecutionObserved:false,
  timing:'seconds=(sourceTick-firstTick)/sourceFPS*sourceTimeScale; duration-multiplier interpretation is reconstructed.',
  composition:'Three additive local translation base+delta and quaternion base*normalizedDelta; native composition is unresolved.',
  variation:'Deterministic source-order cycling; native selection is unresolved.',
  retrigger:'Stop previous firing action and restart the selected source clip at zero.',
  basePose:'Immediate source idle/sprint static-pose selection; native transitions are unresolved.',
});

function vector(value,length,label) {
  if(!Array.isArray(value)||value.length!==length||value.some(v=>!Number.isFinite(v)))throw new TypeError(`${label} must contain ${length} finite values`);
  return value;
}

function firingClip(root,source) {
  if(!source.additive)throw new TypeError('Recovered first-person firing must be additive');
  const {fps,timeScale}=source.sourceTiming??{};
  if(!Number.isFinite(fps)||fps<=0||!Number.isFinite(timeScale)||timeScale<=0)throw new TypeError('Source firing FPS and TimeScale must be positive');
  const ticks=source.sourceKeyTimes;
  if(!Array.isArray(ticks)||ticks.length<2||ticks.some((v,i)=>!Number.isFinite(v)||(i&&v<=ticks[i-1])))throw new TypeError('Source firing key ticks must increase');
  const times=ticks.map(tick=>(tick-ticks[0])/fps*timeScale),duration=times.at(-1);
  if(!Number.isFinite(duration)||duration<=0)throw new TypeError('Invalid reconstructed firing duration');
  const bones=new Map();
  root.traverse(node=>{
    if(node.userData?.sourceBoneIndex===undefined)return;
    const name=node.userData.name??node.name;
    if(!bones.has(name))bones.set(name,[]);
    bones.get(name).push(node);
  });
  const tracks=[],seen=new Set(),missing=[];
  for(const track of source.tracks??[]) {
    const rotation=track.property==='rotation',translation=track.property==='translation';
    if(!rotation&&!translation)throw new TypeError(`Unsupported firing property ${track.property}`);
    const key=`${track.bone}.${track.property}`;
    if(seen.has(key))throw new TypeError(`Duplicate firing channel ${key}`);
    seen.add(key);
    if(track.values?.length!==times.length)throw new TypeError(`Wrong sample count for ${key}`);
    const values=[];let previous=null;
    for(const row of track.values) {
      vector(row,rotation?4:3,key);
      if(rotation) {
        const q=new THREE.Quaternion().fromArray(row);
        if(q.lengthSq()<1e-12)throw new TypeError(`Zero firing quaternion ${key}`);
        q.normalize();
        if(previous&&q.dot(previous)<0)q.set(-q.x,-q.y,-q.z,-q.w);
        values.push(...q.toArray());previous=q;
      } else values.push(...row);
    }
    if(!bones.has(track.bone)){missing.push(key);continue;}
    for(const bone of bones.get(track.bone)) {
      const Track=rotation?THREE.QuaternionKeyframeTrack:THREE.VectorKeyframeTrack;
      // GLTFLoader's idle/sprint tracks use unique node names. Using UUIDs here
      // would create separate PropertyMixers and overwrite the base pose.
      tracks.push(new Track(`${bone.name||bone.uuid}.${rotation?'quaternion':'position'}`,times,values));
    }
  }
  if(!tracks.length)throw new TypeError('No recovered firing tracks match the viewmodel');
  const clip=new THREE.AnimationClip(`source-fire-${source.id}`,duration,tracks,THREE.AdditiveAnimationBlendMode);
  return {clip,sourceName:source.sourceName,sourceId:source.id,missing,boundTracks:tracks.length};
}

/** Clone recovered 1p arms + gun, preserving their camera-relative source rig. */
export function createFirstPersonViewmodel(found,{fireDocument=null,aimDocument=null,weaponId=found?.descriptor?.weaponId}={}) {
  if(!found?.gltf?.scene)throw new TypeError('A recovered first-person GLTF scene is required');
  const descriptor=found.descriptor??{};
  if(descriptor.weaponId&&descriptor.weaponId!==weaponId)throw new TypeError('First-person weapon and descriptor disagree');
  const root=cloneSkeleton(found.gltf.scene);
  root.name=`firstperson-${weaponId??'source'}`;
  root.position.fromArray(vector(descriptor.position??[0,0,0],3,'viewmodel position'));
  root.rotation.set(...vector(descriptor.rotation??[0,0,0],3,'viewmodel rotation'));
  const scale=descriptor.scale??1;
  if(!Number.isFinite(scale)||scale<=0)throw new TypeError('Viewmodel scale must be positive');
  root.scale.setScalar(scale);
  root.traverse(node=>{if(node.isMesh){node.frustumCulled=false;node.castShadow=false;node.receiveShadow=false;}});
  const mixer=new THREE.AnimationMixer(root),baseActions={};
  for(const pose of ['idle','sprint']) {
    const clip=found.gltf.animations?.find(c=>c.name===(descriptor.clips?.[pose]??pose));
    if(clip)baseActions[pose]=mixer.clipAction(clip);
  }
  if(!baseActions.idle)throw new TypeError('Recovered first-person idle pose is missing');
  const aimClips=aimDocument?createFirstPersonAimClips(root,aimDocument,weaponId):null;
  const aimAction=aimClips?mixer.clipAction(aimClips.pose.clip):null;
  if(aimAction)aimAction.setEffectiveWeight(0).play();
  const selected=fireDocument?.weapons?.find(w=>w.weaponId===weaponId);
  const fireActions=(selected?.clips??[]).map(source=>{
    const recovered=firingClip(root,source),action=mixer.clipAction(recovered.clip);
    action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=false;
    return {...recovered,action};
  });
  let pose='idle',alive=true,currentFire=null,shots=0,lastFire=null,aiming=false,aimWeight=0;
  baseActions.idle.play();mixer.update(0);root.updateMatrixWorld(true);
  function selectPose(next) {
    if(!baseActions[next])next='idle';
    if(next===pose)return;
    baseActions[pose]?.stop();pose=next;baseActions[pose].reset().play();
  }
  function stopFire() {
    currentFire?.action.stop();currentFire=null;
  }
  return {
    root,
    update(dt,{sprinting=false,alive:nextAlive=true,aiming:nextAiming=false,aimWeight:nextAimWeight=nextAiming?1:0}={}) {
      if(!Number.isFinite(dt)||dt<0)throw new RangeError('Viewmodel dt must be finite and nonnegative');
      if(!Number.isFinite(nextAimWeight)||nextAimWeight<0||nextAimWeight>1)throw new RangeError('Viewmodel aim weight must be within0..1');
      alive=Boolean(nextAlive);root.visible=alive;
      if(!alive)stopFire();
      aiming=alive&&Boolean(nextAiming);aimWeight=alive&&aimAction?nextAimWeight:0;
      selectPose(alive&&sprinting&&!aiming&&aimWeight===0?'sprint':'idle');
      baseActions[pose].setEffectiveWeight(1-aimWeight);
      aimAction?.setEffectiveWeight(aimWeight);
      mixer.update(dt);
      if(currentFire&&!currentFire.action.isRunning()) {stopFire();mixer.update(0);}
      // No forced world-matrix refresh here: this runs every simulation tick, the
      // renderer refreshes the rig under the camera each frame, and snapshot()
      // refreshes it itself before reading muzzle positions.
    },
    fire() {
      if(!alive||!fireActions.length)return false;
      stopFire();currentFire=fireActions[shots%fireActions.length];shots++;
      lastFire=currentFire.sourceName;
      currentFire.action.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play();
      // Evaluate frame zero immediately, including on repeated shots within an
      // update. The next update advances this same shared mixer once.
      mixer.update(0);root.updateMatrixWorld(true);
      return true;
    },
    snapshot() {
      const muzzles=[];root.updateWorldMatrix(true,true);
      const inverse=new THREE.Matrix4().copy(root.matrixWorld).invert();
      root.traverse(node=>{
        if((node.userData?.name??node.name)==='Wep_Muzzle')muzzles.push(new THREE.Vector3().setFromMatrixPosition(node.matrixWorld).applyMatrix4(inverse).toArray());
      });
      return {weaponId,alive,pose,shots,firing:Boolean(currentFire),lastFire,
        aim:aimClips?{aiming,weight:aimWeight,sourceName:aimClips.pose.sourceName,boundTracks:aimClips.pose.boundTracks,missing:aimClips.pose.missing,policy:FIRSTPERSON_AIM_RUNTIME_POLICY,sourcePolicy:aimClips.policy}:null,
        fireTime:currentFire?.action.time??0,fireDuration:currentFire?.clip.duration??0,
        fireClips:fireActions.map(c=>({sourceName:c.sourceName,duration:c.clip.duration,boundTracks:c.boundTracks,missing:c.missing})),
        mixerBindings:mixer.stats.bindings.total,muzzles,policy:FIRSTPERSON_FIRE_POLICY};
    },
  };
}
