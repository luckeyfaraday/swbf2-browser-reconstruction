const DEGREE=Math.PI/180;
const poseIndices={stand:0,crouch:1,prone:2};

export const CAMERA_RECOIL_RUNTIME_POLICY=Object.freeze({
  evidenceId:'BF2-CAMERA-RECOIL-BROWSER-001',
  sourceScope:'Unanimated first-person procedural camera; no additional weapon/arm animation kick.',
  cameraComposition:'baseCameraQuaternion * sourceCameraLocalQuaternion',
  input:'Use the controller solved, clamped angular movement; consume same-sign native recoil and retain only excess base movement before movement simulation.',
  scheduling:'Reconstructed: one input sample and one recoil update per browser simulation tick. Accepted shots raise the pulse after the current firing ray is selected; spring/compensation advance afterward. Rendering only reads state.',
  viewModes:'Reconstructed: recoil and compensation apply only in first person; changing view clears the spring. Third-person native camera composition is untraced.',
  random:'Reconstructed: accepted player recoil uses the seeded gameplay random stream; native RNG stream parity is not claimed.',
  projectile:Object.freeze({classification:'inferred',rule:'Converge the shooter-eye ray through the current rendered player crosshair, then apply source spread.',nativeFinalRecoilPrecedence:'unresolved',reason:'Selected ForceSpawnToCamera and ActiveForceSpawnToCamera can replace the initial raw-recoil basis with a runtime camera/correction transform.'}),
});

function finite(value,name){if(!Number.isFinite(value))throw new TypeError(`${name} must be finite`);return value;}
const clamp=(value,maximum)=>Math.max(-maximum,Math.min(maximum,value));
const towardZero=(value,amount)=>value<0?Math.min(0,value+amount):Math.max(0,value-amount);

/** 141693a10 / 14169bdd0: consume only solved aim movement with the same
 * sign as remaining recoil. Returned compensation, not raw input, feeds
 * GunSway context +8/+c on the next simulation update. All angles are radians.
 */
export function consumeNativeRecoil(recoil,aimMovement) {
  const remaining={},compensation={},baseMovement={};
  for(const axis of ['yaw','pitch']){
    const value=finite(recoil[axis],`recoil.${axis}`);
    let movement=finite(aimMovement[axis],`aimMovement.${axis}`);
    if(axis==='yaw')movement=movement-Math.floor((movement+Math.PI)/(2*Math.PI))*2*Math.PI;
    const consumed=value*movement>0?Math.sign(value)*Math.min(Math.abs(value),Math.abs(movement)):0;
    remaining[axis]=value-consumed;compensation[axis]=consumed;baseMovement[axis]=movement-consumed;
  }
  return {remaining,compensation,baseMovement};
}

/** Map browser YXZ controller movement to native aiming yaw/pitch. This is
 * angle-space mapping, independent of the local recoil transform below.
 */
export function consumeBrowserRecoil(recoil,browserMovement) {
  const result=consumeNativeRecoil(recoil,{yaw:-browserMovement.yaw,pitch:browserMovement.pitch});
  return {...result,baseMovement:{yaw:-result.baseMovement.yaw,pitch:result.baseMovement.pitch}};
}

/** 14165ab30 builds Rx(nativePitch)*Ry(nativeYaw). 1416aa760 appends
 * diag(-1,1,-1) after ProceduralTransform. Conjugating by that camera basis
 * gives the local Three rotation Rx(-nativePitch)*Ry(nativeYaw), in XYZ
 * order. Multiply this quaternion on the RIGHT of the base camera rotation.
 * The raw target has the same matrix convention, but its final projectile
 * precedence is separate because the selected shot enables camera override.
 */
export function nativeRecoilCameraQuaternion({yaw,pitch}) {
  finite(yaw,'yaw');finite(pitch,'pitch');
  const x=-pitch/2,y=yaw/2,sx=Math.sin(x),cx=Math.cos(x),sy=Math.sin(y),cy=Math.cos(y);
  return [sx*cy,cx*sy,sx*sy,cx*cy];
}

export function resolveCameraRecoil(document,weaponId,{sourceGuid}={}) {
  const weapon=document?.weapons?.find(row=>row.weaponId===weaponId);
  if(!weapon||(sourceGuid&&sourceGuid!==weapon.source?.guid)||weapon.swaySourceGuid!==document.configuration?.source?.guid)return null;
  const configuration=document.configuration;
  if(configuration.recoil?.length!==6)throw new TypeError('Six source pose/zoom recoil records required');
  return {weaponId,sourceGuid:weapon.source.guid,configuration,provenance:document.provenance};
}

// 14165d040: semi-implicit spring with source damping normalized by 30*dt.
// It is not a continuous analytical spring or a per-frame damping multiplier.
export function stepNativeCameraSpring({position,velocity},target,dt,{SpringConstant,SpringDamping},normalization=30) {
  for(const [name,value]of Object.entries({position,velocity,target,dt,SpringConstant,SpringDamping,normalization}))finite(value,name);
  if(dt<0||SpringConstant<0||SpringDamping<0||SpringDamping>1||normalization<=0)throw new RangeError('Invalid native spring parameters');
  if(dt===0)return {position,velocity};
  velocity=(velocity-(position-target)*SpringConstant*dt)*Math.pow(1-SpringDamping,normalization*dt);
  return {position:position+velocity*dt,velocity};
}

/** Source GunSway recoil kernel. No scene, rig, camera or firing-ray mutation.
 * Browser event scheduling, random stream and final presentation are explicit
 * adapter choices. The compensation and camera boundary are recovered in
 * camera-aiming-evidence.json; final projectile override remains separate.
 */
export function createCameraRecoil(document,weaponId,{random=Math.random,sourceGuid}={}) {
  const source=resolveCameraRecoil(document,weaponId,{sourceGuid});
  if(!source)return null;
  if(typeof random!=='function')throw new TypeError('A random callback is required');
  const config=source.configuration,epsilon=config.nativeConstants.settledEpsilon;
  const threshold=config.spring.SpringMinThresholdAngle*DEGREE;
  let state={pose:'stand',aiming:false,firing:false,alive:true},target={yaw:0,pitch:0};
  let springs={yaw:{position:0,velocity:0},pitch:{position:0,velocity:0}},output={yaw:0,pitch:0};
  let elapsed=0,pendingShot=false,firstShot=false,shots=0,lastImpulse=null;
  const snapshot=()=>({weaponId,sourceGuid:source.sourceGuid,state:{...state},sourceArrayIndex:poseIndices[state.pose]*2+Number(state.aiming),
    nativeRadians:{...output},presentationRadians:{yaw:output.yaw,pitch:-output.pitch},presentationRotationOrder:'XYZ',
    cameraLocalQuaternion:nativeRecoilCameraQuaternion(output),targetRadians:{...target},
    springs:{yaw:{...springs.yaw},pitch:{...springs.pitch}},elapsedSinceShot:elapsed,pendingShot,shots,
    lastImpulse:lastImpulse?{...lastImpulse}:null,provenance:source.provenance});
  const reset=(input={})=>{
    state={pose:'stand',aiming:false,firing:false,alive:true,...input};target={yaw:0,pitch:0};
    springs={yaw:{position:0,velocity:0},pitch:{position:0,velocity:0}};output={yaw:0,pitch:0};
    elapsed=0;pendingShot=false;firstShot=false;shots=0;lastImpulse=null;
    return snapshot();
  };
  return {
    fire({isFirstShot=false}={}) {
      if(!state.alive)return false;
      if(typeof isFirstShot!=='boolean')throw new TypeError('isFirstShot must be boolean');
      // The native accepted-shot pulse is a boolean, consumed by the next
      // nonzero update. Browser cadence must not accept two shots per update.
      if(pendingShot)throw new Error('Accepted recoil shot already awaits simulation update');
      pendingShot=true;firstShot=isFirstShot;shots++;return true;
    },
    update(dt,input={}) {
      finite(dt,'dt');if(dt<0)throw new RangeError('dt must not be negative');
      // aimDelta is retained only as a compatibility alias. It always means
      // the consumed RecoilCompensation pair, never a raw mouse/aim delta.
      const {aimDelta:suppliedAimDelta,recoilCompensation,...controls}=input,next={...state,...controls};
      if(suppliedAimDelta&&recoilCompensation)throw new TypeError('Supply recoilCompensation only once');
      if(!Object.hasOwn(poseIndices,next.pose)||['aiming','firing','alive'].some(key=>typeof next[key]!=='boolean'))throw new TypeError('Unsupported recoil state');
      state=next;
      if(!state.alive){reset(state);return snapshot();}
      if(dt===0)return snapshot();
      const aimDelta=recoilCompensation??suppliedAimDelta??{yaw:0,pitch:0};finite(aimDelta.yaw,'recoilCompensation.yaw');finite(aimDelta.pitch,'recoilCompensation.pitch');
      const settled=Object.values(springs).every(axis=>Math.abs(axis.position)<epsilon&&Math.abs(axis.velocity)<epsilon);
      if(!pendingShot&&target.yaw===0&&target.pitch===0&&settled){output={yaw:0,pitch:0};elapsed=0;return snapshot();}
      const selected=config.recoil[poseIndices[state.pose]*2+Number(state.aiming)];
      if(pendingShot){
        const uniform=random();finite(uniform,'random sample');if(uniform<0||uniform>1)throw new RangeError('Random sample must be in [0,1]');
        // Native consumes a second RNG value even though its vertical bounds
        // are equal; preserve draw count without claiming native RNG parity.
        const verticalRandom=random();finite(verticalRandom,'vertical random sample');if(verticalRandom<0||verticalRandom>1)throw new RangeError('Random sample must be in [0,1]');
        lastImpulse={yaw:(selected.HorizontalRecoilAmplitudeIncPerShotMin+
          (selected.HorizontalRecoilAmplitudeIncPerShotMax-selected.HorizontalRecoilAmplitudeIncPerShotMin)*uniform)*DEGREE,
          pitch:-selected.RecoilAmplitudeIncPerShot*DEGREE*(firstShot?config.FirstShotRecoilMultiplier:1)};
        target.yaw=clamp(target.yaw+lastImpulse.yaw,Math.abs(selected.HorizontalRecoilAmplitudeMax)*DEGREE);
        target.pitch=clamp(target.pitch+lastImpulse.pitch,Math.abs(selected.RecoilAmplitudeMax)*DEGREE);
        elapsed=0;
      }else elapsed+=dt;
      const recovery=Math.pow(elapsed,config.nativeConstants.recoveryExponent)*selected.RecoilAmplitudeDecreaseFactor*
        config.nativeConstants.recoveryScale*dt*(state.firing?config.ShootingRecoilDecreaseScale:1);
      for(const axis of ['yaw','pitch']){
        target[axis]=towardZero(target[axis],recovery)-aimDelta[axis];
        const springTarget=Math.abs(target[axis])>threshold?target[axis]:0;
        springs[axis]=stepNativeCameraSpring(springs[axis],springTarget,dt,config.spring,config.nativeConstants.dampingNormalization);
      }
      if(!state.aiming||config.CameraRecoilWhenZoomed){
        for(const axis of ['yaw','pitch']){
          output[axis]=springs[axis].position-aimDelta[axis];
          springs[axis].position=Math.abs(output[axis])>threshold?output[axis]:0;
        }
      }else output={...target};
      pendingShot=false;firstShot=false;
      return snapshot();
    },
    reset,
    snapshot,
  };
}
