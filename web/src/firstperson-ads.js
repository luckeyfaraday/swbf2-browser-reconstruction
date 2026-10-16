import * as THREE from 'three';

export const FIRSTPERSON_ADS_POLICY = Object.freeze({
  evidenceId: 'BF2-FIRSTPERSON-ADS-001', nativeExecutionObserved: false,
  timing: 'Clips use normalized source phase [0,1] after the source trim range. Caller chooses playback seconds; native clock is unresolved.',
  conversion: 'Normalize source quaternions, preserve hemisphere continuity, interpolate rotations with Three slerp and translations linearly.',
  mask: 'The source master layer retains idle Wep_Bipod1/2/3 rotation and translation channels.',
  camera: 'Preserve the assembled source camera conversion; no added weapon offset or camera transform.',
});

function normalizedValues(source) {
  const rotation = source.property === 'rotation';
  if (!rotation && source.property !== 'translation') throw new TypeError('Unsupported ADS property');
  const values = []; let previous = null;
  for (const row of source.values ?? []) {
    if (row.length !== (rotation ? 4 : 3) || !row.every(Number.isFinite)) throw new TypeError('Invalid ADS sample');
    if (!rotation) { values.push(...row); continue; }
    const q = new THREE.Quaternion().fromArray(row);
    if (q.lengthSq() < 1e-12) throw new TypeError('Zero ADS quaternion');
    q.normalize();
    if (previous && q.dot(previous) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
    values.push(...q.toArray()); previous = q;
  }
  return values;
}

/** Build exact local pose tracks; action duration is PHASE, not native seconds. */
export function createFirstPersonAimClips(root, document, weaponId) {
  const weapon = Object.values(document?.weapons ?? {}).find(w => w.weaponId === weaponId);
  if (!weapon) throw new TypeError('Recovered ADS weapon is missing');
  const bones = new Map();
  root.traverse(node => {
    if (node.userData?.sourceBoneIndex === undefined) return;
    const canonical = node.userData.name ?? node.name;
    if (!bones.has(canonical)) bones.set(canonical, []);
    bones.get(canonical).push(node);
  });
  const overrides = new Map((weapon.idleOverrideTracks ?? []).map(t => [`${t.bone}.${t.property}`, t]));
  const result = {policy: FIRSTPERSON_ADS_POLICY, weaponId, specificWeaponEnum: weapon.specificWeaponEnum};
  for (const role of ['pose', 'enter', 'exit']) {
    const source = weapon.clips[role];
    if (!source || source.additive) throw new TypeError('ADS requires non-additive source clips');
    const constant = source.sourceKind === 'FrameAnimationAsset';
    const ticks = constant ? [0] : source.sourceKeyTimes;
    if (!ticks?.length || ticks.some((t, i) => !Number.isFinite(t) || (i > 0 && t <= ticks[i - 1]))) throw new TypeError('Invalid ADS key times');
    const start = constant ? 0 : source.animationBase.TrimOffset;
    const span = constant ? 1 : source.animationBase.TrimmedDuration;
    if (!(span > 0) || !Number.isFinite(start) || start < ticks[0] || (!constant && start + span > ticks.at(-1))) throw new TypeError('Invalid ADS source trim');
    const sourceTimes = constant ? [0, 1] : [start, ...ticks.filter(t => t > start && t < start + span), start + span];
    const phaseTimes = constant ? [0, 1] : sourceTimes.map(t => (t - start) / span);
    const tracks = [], seen = new Set(), missing = [];
    for (const original of source.tracks) {
      const key = `${original.bone}.${original.property}`;
      if (seen.has(key)) throw new TypeError(`Duplicate ADS channel ${key}`);
      seen.add(key);
      if (original.values.length !== ticks.length) throw new TypeError(`Wrong ADS sample count ${key}`);
      const effective = overrides.get(key) ?? original;
      const rotation = effective.property === 'rotation';
      const Track = rotation ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
      const values = normalizedValues(effective);
      let sampled;
      if (constant || effective !== original) sampled = sourceTimes.flatMap(() => values);
      else {
        const interpolant = new Track('source', ticks, values).createInterpolant();
        sampled = sourceTimes.flatMap(t => Array.from(interpolant.evaluate(t)));
      }
      if (!bones.has(original.bone)) { missing.push(key); continue; }
      for (const node of bones.get(original.bone)) {
        // Match GLTFLoader's unique track names, including duplicated weapon
        // joints, so base and additive actions share one PropertyMixer.
        tracks.push(new Track(`${node.name || node.uuid}.${rotation ? 'quaternion' : 'position'}`, phaseTimes, sampled));
      }
    }
    if (!tracks.length) throw new TypeError('ADS tracks do not match the source rig');
    const clip = new THREE.AnimationClip(`source-ads-${weaponId}-${role}`, 1, tracks, THREE.NormalAnimationBlendMode);
    result[role] = {clip, sourceName: source.sourceName, sourceAnimationKey: source.sourceAnimationKey,
      sourceTrim: {start, span}, sourceTiming: {fps: source.controller.FPS, timeScale: source.controller.TimeScale},
      constant, boundTracks: tracks.length, missing};
  }
  return result;
}
