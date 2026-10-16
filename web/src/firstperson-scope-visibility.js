// Native model visibility masks. The accepted browser aim -> native indices bridge is explicit reconstruction.
const EVIDENCE = 'BF2-FIRSTPERSON-SCOPE-VISIBILITY-NATIVE-001';
const finite = (value, label) => { if (!Number.isFinite(value)) throw new TypeError(`Invalid ${label}`); return value; };

export function resolveSourceFirstpersonVisibility(document, weaponId, {sourceGuid} = {}) {
  if (document?.schemaVersion !== 1 || document.provenance?.evidenceId !== EVIDENCE) return null;
  const weapon = document.weapons?.find(row => row.weaponId === weaponId);
  if (!weapon || (sourceGuid !== undefined && weapon.source.guid !== sourceGuid)) return null;
  if (weapon.zoomLevels.length !== 2 || document.aimingZoomLevels.length !== 2) throw new RangeError('Unsupported zoom levels');
  for (const level of weapon.zoomLevels) for (const factor of level.ZoomInOutMeshTransitionFactors) finite(factor, 'mesh transition factor');
  const duration = finite(document.ZoomTransitionTime, 'zoom time');
  if (duration < 0) throw new RangeError('Negative zoom time');
  return {...weapon, aimingZoomLevels: document.aimingZoomLevels, duration, provenance: document.provenance};
}

// 0x141683340, local actor branch. cameraZoomIndex is the boolean output of 0x141671e30.
// weaponAimingIndex comes independently from weapon aiming simulation +0x318.
export function evaluateSourceFirstpersonVisibility(source, {
  cameraZoomIndex = 0, weaponAimingIndex = cameraZoomIndex, zoomFraction = cameraZoomIndex,
  active = true, bodyVisible = true, local = true,
} = {}) {
  for (const index of [cameraZoomIndex, weaponAimingIndex]) if (index !== 0 && index !== 1) throw new RangeError('Unsupported zoom index');
  finite(zoomFraction, 'zoom fraction');
  const entry = source.zoomLevels[cameraZoomIndex];
  const factors = entry?.ZoomInOutMeshTransitionFactors ?? [];
  const overridePresent = factors.length > 0;
  const threshold = factors.length === 1 ? factors[0] : factors.length > 1 ? factors[Number(cameraZoomIndex === 0)] : source.ZoomMeshTransitionFactor;
  const currentUse = source.aimingZoomLevels[weaponAimingIndex]?.UseWeaponMeshZoom1p === true;
  const cameraUse = source.aimingZoomLevels[cameraZoomIndex]?.UseWeaponMeshZoom1p === true;
  let zoomMeshSelected = false;
  if (active && source.hasZoomModel) {
    zoomMeshSelected = local
      ? (zoomFraction >= threshold && currentUse) || (zoomFraction < threshold && cameraZoomIndex !== 0 && Boolean(entry) && cameraUse)
      : cameraZoomIndex !== 0 && currentUse;
  }
  const firstpersonMask = !(zoomMeshSelected && overridePresent);
  return {cameraZoomIndex, weaponAimingIndex, zoomFraction, threshold, overridePresent, zoomMeshSelected,
    normalModelVisible: Boolean(active && source.hasNormalModel && !zoomMeshSelected && firstpersonMask),
    zoomModelVisible: Boolean(active && source.hasZoomModel && zoomMeshSelected && firstpersonMask),
    bodyVisible: Boolean(bodyVisible && firstpersonMask), firstpersonMask};
}

export function nativeZoomFraction(remaining, duration, cameraZoomIndex) {
  finite(remaining, 'remaining zoom time'); finite(duration, 'zoom duration');
  if (remaining < 0 || duration < 0 || (remaining > 0 && duration === 0)) throw new RangeError('Invalid zoom timer');
  if (cameraZoomIndex !== 0 && cameraZoomIndex !== 1) throw new RangeError('Unsupported zoom index');
  return remaining === 0 ? cameraZoomIndex : cameraZoomIndex !== 0 ? 1 - remaining / duration : remaining / duration;
}

export function createSourceFirstpersonVisibility(document, weaponId, options = {}) {
  const source = resolveSourceFirstpersonVisibility(document, weaponId, options);
  if (!source) return null;
  let index = 0, remaining = 0, alive = true;
  const snapshot = () => ({...evaluateSourceFirstpersonVisibility(source, {
    cameraZoomIndex: index, weaponAimingIndex: index,
    zoomFraction: nativeZoomFraction(remaining, source.duration, index), active: alive, bodyVisible: alive,
  }), remaining, duration: source.duration, weaponId, provenance: source.provenance});
  return {
    update(dt, {aiming = Boolean(index), alive: nextAlive = true} = {}) {
      finite(dt, 'dt'); if (dt < 0) throw new RangeError('Negative dt');
      if (typeof aiming !== 'boolean' || typeof nextAlive !== 'boolean') throw new TypeError('Invalid visibility flags');
      alive = nextAlive;
      const next = alive && aiming ? 1 : 0;
      if (next !== index) {
        // Selected 0<->1 branch of 0x1416a38b0: reversal preserves the current fraction.
        remaining = remaining > 0 ? (1 - remaining / source.duration) * source.duration : source.duration;
        index = next;
      }
      remaining = alive ? Math.max(0, remaining - dt) : 0;
      return snapshot();
    },
    reset({aiming = false, alive: nextAlive = true} = {}) {
      if (typeof aiming !== 'boolean' || typeof nextAlive !== 'boolean') throw new TypeError('Invalid visibility flags');
      alive = nextAlive; index = alive && aiming ? 1 : 0; remaining = 0; return snapshot();
    },
    snapshot,
  };
}
