// Selected source camera FOV. Weapon render FOV, recoil and transforms remain separate.
const EVIDENCE='BF2-CAMERA-FOV-NATIVE-001';
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
function finite(value,label){if(!Number.isFinite(value))throw new TypeError(`Invalid ${label}`);return value;}

export function nativeFovTransitionWeight(fraction,transition){
  finite(fraction,'transition fraction');
  const {Shape:shape,StartDelay:start,StartJump:jump,EndEarly:end,Invert:invert}=transition;
  for(const [key,value]of Object.entries({shape,start,jump,end}))finite(value,key);
  if(shape<=0||start<0||end<0||start+end>=1||jump<0||jump>1)throw new RangeError('Unsupported FOV curve');
  if(fraction<start)return 0;
  if(fraction>1-end)return 1;
  const t=clamp((fraction-start)/(1-end-start),0,1);
  if(transition.TransitionType?.value===0)return 1-(1-jump)*(1-t);
  if(transition.TransitionType?.value!==1)throw new RangeError('Unsupported FOV transition type');
  const x=invert?1-t:t;
  const shaped=clamp((shape+1)*Math.pow(x,shape)-shape*Math.pow(x,shape+1),0,1);
  return invert?1-shaped*(1-jump):1-(1-shaped)*(1-jump);
}

export function resolveSourceCameraFov(document,weaponId,{sourceGuid}={}){
  if(document?.schemaVersion!==1||document.provenance?.evidenceId!==EVIDENCE)return null;
  const weapon=document.weapons?.find(row=>row.weaponId===weaponId);
  if(!weapon||(sourceGuid!==undefined&&weapon.source.guid!==sourceGuid))return null;
  if(document.axis!=='vertical'||document.angleUnit!=='degrees'||document.zoomLevels?.length!==2||document.timing?.UpdateCameraFOV!==true)throw new RangeError('Unsupported source FOV configuration');
  for(const level of document.zoomLevels)if(!Number.isFinite(level.FieldOfView)||level.FieldOfView<=0||level.FieldOfView>=180)throw new RangeError('Invalid source FOV');
  return {weaponId,sourceGuid:weapon.source.guid,axis:'vertical',
    fov:document.zoomLevels[0].FieldOfView,aimFov:document.zoomLevels[1].FieldOfView,
    transitionTime:document.timing.FovTransitionTime,transition:document.transition,
    levels:document.zoomLevels,userScale:document.userScale,weaponRenderFov:weapon.weaponRenderFov.slice(),provenance:document.provenance};
}

export function sourceFovTarget(source,{aiming=false,userScale=1,scaleADS=true}={}){
  if(typeof aiming!=='boolean'||typeof scaleADS!=='boolean')throw new TypeError('FOV input flags must be boolean');
  const scale=clamp(finite(userScale,'user scale'),source.userScale.min,source.userScale.max);
  const level=source.levels[Number(aiming)];
  return level.FieldOfView*(level.AllowFieldOfViewScaling&&(!aiming||scaleADS)?(aiming?Math.max(1,scale):scale):1);
}

export function createSourceCameraFov(document,weaponId,{initialAiming=false,userScale=1,scaleADS=true,sourceGuid}={}){
  const source=resolveSourceCameraFov(document,weaponId,{sourceGuid});if(!source)return null;
  const duration=finite(source.transitionTime,'transition time');if(duration<0)throw new RangeError('Invalid transition time');
  let aiming=initialAiming,target=sourceFovTarget(source,{aiming,userScale,scaleADS}),current=target,start=current,elapsed=duration;
  const snapshot=()=>({fov:current,axis:source.axis,aiming,target,start,elapsed,duration,
    weaponRenderFov:source.weaponRenderFov[Number(aiming)],provenance:source.provenance});
  return {
    update(dt,input={}){
      finite(dt,'dt');if(dt<0)throw new RangeError('dt must be nonnegative');
      aiming=input.aiming??aiming;userScale=input.userScale??userScale;scaleADS=input.scaleADS??scaleADS;
      const next=sourceFovTarget(source,{aiming,userScale,scaleADS});
      if(next!==target){start=current;target=next;elapsed=0;}
      // Native samples the previous elapsed value, then advances its timer.
      const weight=duration===0?1:nativeFovTransitionWeight(elapsed/duration,source.transition);
      current=start*(1-weight)+target*weight;elapsed=Math.min(duration,elapsed+dt);
      return snapshot();
    },
    reset(input={}){
      aiming=input.aiming??initialAiming;userScale=input.userScale??userScale;scaleADS=input.scaleADS??scaleADS;
      current=target=sourceFovTarget(source,{aiming,userScale,scaleADS});start=current;elapsed=duration;return snapshot();
    },
    snapshot,
  };
}
