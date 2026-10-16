// Native launch precedence for the recovered base E11/A280 configuration.
// Browser orientation, origin and scheduling remain caller responsibilities.
const evidenceId='BF2-PROJECTILE-NATIVE-001';

function vector(value,label) {
  if(!Array.isArray(value)||value.length!==3||!value.every(Number.isFinite))throw new TypeError(`Invalid ${label}`);
  return value.slice();
}
function direction(value) {
  const result=vector(value,'direction'),length=Math.hypot(...result);
  if(length===0)throw new RangeError('Direction must be nonzero');
  return result.map(v=>v/length);
}

// Null means this is not one of the source configurations recovered here.
// Supplying sourceGuid protects callers with independently supplied fixtures.
export function resolveProjectileLaunch(document,weaponId,{sourceGuid}={}) {
  if(document?.schemaVersion!==1||document.provenance?.nativeEvidenceId!==evidenceId)return null;
  const row=document.weapons?.find(item=>item.weaponId===weaponId);
  if(!row||!row.source?.guid||(sourceGuid!==undefined&&row.source.guid!==sourceGuid))return null;
  const shot=row.sourceShot,projectile=row.sourceProjectile;
  if(!shot||!projectile||row.applyPowerToSpeed!==false||shot.InheritWeaponSpeedAmount!==0||
      shot.InitialSpeedScaleByPitch?.length!==0||shot.InitialDirectionScaleByPitch?.length!==0||
      projectile.Gravity!==0||projectile.InstantHit!==false||projectile.FirstFrameTravelDistance!==0||
      projectile.DetonationTimeVariation!==0)throw new RangeError('Unsupported projectile source configuration');
  const initial=vector(['x','y','z'].map(axis=>shot.InitialSpeed?.[axis]),'source shot velocity');
  if(initial[0]!==0||initial[1]!==0||initial[2]<=0||!Number.isFinite(projectile.TimeToLive)||projectile.TimeToLive<=0)throw new RangeError('Unsupported projectile direction or lifetime');
  const parameters={projectileSpeed:Math.hypot(...initial),projectileLifetime:projectile.TimeToLive,
    range:Math.hypot(...initial)*projectile.TimeToLive};
  for(const key of Object.keys(parameters))if(row.parameters?.[key]!==parameters[key])throw new Error(`Projectile derivation mismatch: ${key}`);
  return {weaponId,sourceGuid:row.source.guid,parameters,fallbackInitialSpeed:projectile.InitialSpeed,
    sourceInitialSpeed:initial,provenance:document.provenance};
}

// Native 0x1417e97e0: a supplied launch vector wins, including a zero vector.
// Only the missing-record branch transforms local [0,0,entity.InitialSpeed].
export function initializeProjectileVelocity({suppliedVelocity=null,fallbackInitialSpeed,forward=[0,0,1]}) {
  if(suppliedVelocity!==null)return vector(suppliedVelocity,'supplied launch velocity');
  if(!Number.isFinite(fallbackInitialSpeed)||fallbackInitialSpeed<0)throw new RangeError('Invalid fallback speed');
  return direction(forward).map(v=>v*fallbackInitialSpeed);
}

// The selected source has zero speed inheritance and disables power scaling.
// Its local velocity lies entirely on +Z; the caller supplies its rotated ray.
export function selectedProjectileVelocity(launch,forward) {
  if(!launch?.parameters||!Number.isFinite(launch.parameters.projectileSpeed))throw new TypeError('Missing selected launch');
  return initializeProjectileVelocity({
    suppliedVelocity:direction(forward).map(v=>v*launch.parameters.projectileSpeed),
    fallbackInitialSpeed:launch.fallbackInitialSpeed,
  });
}
