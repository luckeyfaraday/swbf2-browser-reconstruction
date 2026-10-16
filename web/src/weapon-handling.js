// Named configuration snapshots and bounded native spread reconstruction.
// Camera/recoil composition remains independent from this spread-only adapter.
const poses={stand:'Stand',crouch:'Crouch',prone:'Prone'};
const motions={base:'BaseValue',moving:'Moving',jumping:'Jumping',sprinting:'Sprinting'};
const poseIndices={stand:0,crouch:1,prone:2};
const motionIndices={base:0,moving:1,jumping:2,sprinting:3};
const DEGREE=Math.PI/180;

export const nativeSpreadProvenance=Object.freeze({
  evidenceId:'BF2-WEAPON-HANDLING-NATIVE-001',
  evidenceFile:'tools/gameplay-recovery/weapon-handling-native-evidence.json',
  runtimeObserved:false,
  recovered:'Selected GunSway native array indexing, degree conversion, polar power sampling, shot increment, conditional linear recovery, threshold selection and clamping.',
  reconstructed:'Browser input states, held-trigger to recovery-suppression flag, supplied random stream, simulation scheduling and attachment to the browser firing ray.',
  excluded:'Native pose-transition blending, suppression and conditional unlock modifiers, camera/recoil composition and random seeding.',
});

function finite(value,label) {
  if(typeof value!=='number'||!Number.isFinite(value))throw new TypeError(`Invalid ${label}`);
  return value;
}
function unit(value,label) {
  finite(value,label);if(value<0||value>1)throw new RangeError(`${label} must be in [0,1]`);return value;
}
function sourceWeapon(document,weaponId) {
  if(document?.schemaVersion!==1)return null;
  const weapon=document.weapons?.find(row=>row.weaponId===weaponId),configuration=document.configuration;
  if(!weapon||configuration?.swaySource?.guid!==weapon.swaySourceGuid||configuration?.aimingSource?.guid!==weapon.aimingSourceGuid)return null;
  return {weapon,configuration};
}

// Native resolver 0x141659ab0 reads flattened arrays, including Crouch/Prone
// jump/sprint entries omitted by the named SDK structures. For movement it
// blends all six fields from BaseValue by clamp(speed/recordedMaxSpeed,0,1).
export function resolveNativeDispersion(document,weaponId,{pose='stand',aiming=false,movement='base',movementFraction=1}={}) {
  const source=sourceWeapon(document,weaponId);if(!source)return null;
  if(!Object.hasOwn(poseIndices,pose)||!Object.hasOwn(motionIndices,movement)||typeof aiming!=='boolean')throw new RangeError('Unsupported weapon spread state');
  const fraction=unit(movementFraction,'movementFraction');
  const baseIndex=(poseIndices[pose]*2+Number(aiming))*4,index=baseIndex+motionIndices[movement];
  const base=source.configuration.sway.Dispersion[baseIndex],selected=source.configuration.sway.Dispersion[index];
  if(!base||!selected)return null;
  const result={};
  for(const field of ['MinAngle','MaxAngle','IncreasePerShot','DecreasePerSecond','NoFireDecreasePerSecond','NoFireTimeThreshold']) {
    const value=finite(selected[field],field);
    result[field]=(movement==='moving'||movement==='sprinting')?base[field]*(1-fraction)+value*fraction:value;
  }
  if(result.MinAngle<0||result.MaxAngle<result.MinAngle||result.IncreasePerShot<0||result.DecreasePerSecond<0||result.NoFireDecreasePerSecond<0||result.NoFireTimeThreshold<0)throw new RangeError('Invalid source dispersion bounds');
  return {index,baseIndex,...result};
}

// Native shot handler 0x14165bc40: theta=lerp(-pi,pi,U),
// radius=pow(V,PowerOfDispersionRandom)*currentDispersion*pi/180.
// The resulting two angles feed Rx(pitch)*Ry(yaw) in 0x14165ab30.
// Random seed/stream is supplied by the caller and is not claimed native.
export function sampleNativeSpread(dispersionDegrees,power,azimuth01,radial01) {
  finite(dispersionDegrees,'dispersionDegrees');finite(power,'power');
  if(dispersionDegrees<0||power<=0)throw new RangeError('Invalid native spread parameters');
  const azimuth=(unit(azimuth01,'azimuth01')*2-1)*Math.PI;
  const radius=Math.pow(unit(radial01,'radial01'),power)*dispersionDegrees*DEGREE;
  const pitch=Math.sin(azimuth)*radius,yaw=Math.cos(azimuth)*radius;
  return {pitch,yaw,radiusRadians:radius,
    // Native source-local +Z forward transformed by the recovered matrix.
    localDirection:[Math.sin(yaw),-Math.sin(pitch)*Math.cos(yaw),Math.cos(pitch)*Math.cos(yaw)]};
}

export function createWeaponSpread(document,weaponId,{random=Math.random}={}) {
  const source=sourceWeapon(document,weaponId);if(!source)return null;
  if(typeof random!=='function')throw new TypeError('random must be callable');
  const sway=source.configuration.sway;
  let state={pose:'stand',aiming:false,movement:'base',movementFraction:1,firing:false};
  let config=resolveNativeDispersion(document,weaponId,state),current=config.MinAngle,elapsed=0,pendingShot=false,firstShot=false;
  let shots=0,lastSample=null;
  const clamp=()=>{current=Math.max(config.MinAngle,Math.min(config.MaxAngle,current));};
  return {
    update(dt,input={}) {
      finite(dt,'dt');if(dt<0)throw new RangeError('dt must not be negative');
      if(dt===0)return this.snapshot();
      state={...state,...input};
      if(typeof state.firing!=='boolean')throw new TypeError('firing must be boolean');
      config=resolveNativeDispersion(document,weaponId,state);
      // Native current=clamp(current + shotIncrement - permittedRecovery*dt).
      // Its accepted-shot boolean is consumed once by a frame update.
      if(pendingShot) {
        const multiplier=firstShot?sway[state.aiming?'FirstShotZoomDispersionMultiplier':'FirstShotNoZoomDispersionMultiplier']:1;
        current+=config.IncreasePerShot*multiplier;
      }
      // Native flag at GunSway+0x1d4 suppresses this branch. Mapping the browser
      // held trigger to that flag is an explicit adapter inference.
      if(!state.firing)current-=(elapsed>=config.NoFireTimeThreshold?config.NoFireDecreasePerSecond:config.DecreasePerSecond)*dt;
      clamp();elapsed+=dt;pendingShot=false;firstShot=false;
      return this.snapshot();
    },
    fire({isFirstShot=false}={}) {
      if(typeof isFirstShot!=='boolean')throw new TypeError('isFirstShot must be boolean');
      // Sample before the later frame update applies this accepted-shot pulse.
      lastSample=sampleNativeSpread(current,sway.PowerOfDispersionRandom,random(),random());
      elapsed=0;pendingShot=true;firstShot=isFirstShot;shots++;
      return {...lastSample,localDirection:[...lastSample.localDirection],dispersionDegrees:current};
    },
    reset(input={}) {
      state={pose:'stand',aiming:false,movement:'base',movementFraction:1,firing:false,...input};
      config=resolveNativeDispersion(document,weaponId,state);current=config.MinAngle;
      elapsed=0;pendingShot=false;firstShot=false;shots=0;lastSample=null;
    },
    snapshot() {
      return {weaponId,dispersionDegrees:current,minDegrees:config.MinAngle,maxDegrees:config.MaxAngle,
        elapsedSinceShot:elapsed,pendingShot,shots,state:{...state},sourceArrayIndex:config.index,
        provenance:nativeSpreadProvenance};
    },
  };
}

export function selectWeaponHandling(document,weaponId,{pose='stand',aiming=false,movement='base'}={}) {
  if(document?.schemaVersion!==1)return null;
  const weapon=document.weapons?.find(row=>row.weaponId===weaponId);
  if(!weapon)return null;
  if(!Object.hasOwn(poses,pose)||!Object.hasOwn(motions,movement)||typeof aiming!=='boolean')throw new RangeError('Unsupported weapon handling state');
  const configuration=document.configuration;
  if(configuration?.swaySource?.guid!==weapon.swaySourceGuid||configuration?.aimingSource?.guid!==weapon.aimingSourceGuid)return null;
  const poseName=poses[pose],zoomName=aiming?'Zoom':'NoZoom',motionName=motions[movement];
  const state=configuration.sway?.[poseName]?.[zoomName],zoomIndex=aiming?1:0;
  // Prone raw arrays contain jump/sprint entries but named Prone data does not.
  // Do not invent missing source-state selection or silently substitute Stand.
  if(!state?.[motionName]||!state.Recoil)return null;
  return structuredClone({
    weaponId,sourceWeaponGuid:weapon.source.guid,
    sourceStatePath:[poseName,zoomName,motionName],
    dispersion:state[motionName],recoil:state.Recoil,
    firstShotDispersionMultiplier:configuration.sway[aiming?'FirstShotZoomDispersionMultiplier':'FirstShotNoZoomDispersionMultiplier'],
    firstShotRecoilMultiplier:configuration.sway.FirstShotRecoilMultiplier,
    powerOfDispersionRandom:configuration.sway.PowerOfDispersionRandom,
    shootingRecoilDecreaseScale:configuration.sway.ShootingRecoilDecreaseScale,
    camera:{gameplayZoom:configuration.gameplayZoomLevels[zoomIndex],
      weaponZoom:weapon.weaponZoomLevels[zoomIndex],firstPerson:configuration.firstPersonCamera,
      recoil:configuration.cameraRecoil,recoilWhenZoomed:configuration.sway.CameraRecoilWhenZoomed,
      fovTransition:configuration.fovTransition,aiming:configuration.aiming,
      zoomSensitivityProfile:configuration.zoomSensitivityProfile},
    conditionalModifier:configuration.conditionalModifier,
    provenance:document.provenance,
  });
}
