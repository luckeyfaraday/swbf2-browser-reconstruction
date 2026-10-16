import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {createFirstPersonAimClips, FIRSTPERSON_ADS_POLICY} from '../src/firstperson-ads.js';
import {loadAdsSource, sourceBones, adsSnapshot} from '../../tools/characters/ads-pose-check.mjs';

const read = p => fs.readFileSync(new URL(p, import.meta.url));
const hash = b => createHash('sha256').update(b).digest('hex');
const document = JSON.parse(read('../public/assets/firstperson-ads.json'));
const evidenceBytes = read('../../exports/firstperson-ads/evidence.json');
const evidence = JSON.parse(evidenceBytes);

test('ADS graph, enum routes and every retained source byte range remain verified', () => {
  assert.equal(hash(evidenceBytes), document.evidenceSha256);
  const bank = read('../../exports/characters/ant-common-bank/0.res');
  assert.equal(hash(bank), document.source.sha256);
  for (const range of evidence.source.ranges) assert.equal(hash(bank.subarray(range.offset, range.offset + range.bytes)), range.sha256, range.name);
  for (const [name, weapon] of Object.entries(document.weapons)) {
    assert.equal(weapon.specificWeaponEnum, name === 'e11' ? 17 : 28);
    for (const role of ['pose', 'enter', 'exit']) {
      assert.equal(evidence.graph.selectors[role].arrays.ChoiceAssetList[weapon.specificWeaponEnum], weapon.clips[role].controller.__key);
      assert.equal(evidence.graph.nodes[role].values.SubjectController, evidence.graph.layers[role].values.__key);
      assert.equal(evidence.graph.nodes[role].values.StateFlowController, evidence.graph.stateFlow.values.__key);
      assert.equal(weapon.clips[role].additive, false);
    }
  }
  assert.equal(FIRSTPERSON_ADS_POLICY.nativeExecutionObserved, false);
  assert.match(FIRSTPERSON_ADS_POLICY.timing, /Caller chooses playback seconds/);
});

test('all DCT ADS samples match independent upstream decoder bytes', () => {
  for (const weapon of Object.values(document.weapons)) for (const role of ['enter', 'exit']) {
    const c = weapon.clips[role], python = read(`../../exports/firstperson-ads/${c.sourceName}.python.f32`);
    assert.deepEqual(python, read(`../../exports/firstperson-ads/${c.sourceName}.reference.f32`));
    assert.equal(hash(python), c.validation.decodedSha256);
    assert.equal(python.length / 4, c.validation.floatCount);
    for (const track of c.tracks) track.values.forEach((row, frame) => row.forEach((v, i) => {
      assert.equal(v, python.readFloatLE(((frame * (c.sourceCounts[0] + c.sourceCounts[1]) + track.sourceChannelIndex) * 4 + i) * 4));
    }));
  }
});

test('original phase graph retains deep tag fields and explicit zero/nonzero blend choices', () => {
  const phases = JSON.parse(read('../../exports/firstperson-ads/phases.json'));
  const bank = read('../../exports/characters/ant-common-bank/0.res');
  assert.equal(phases.sourceBankSha256, hash(bank));
  for (const record of Object.values(phases.records)) {
    const range = record.sourceRange;
    assert.equal(hash(bank.subarray(range.offset, range.offset + range.bytes)), range.sha256);
    for (let level = record; level; level = level.base) {
      assert.ok(level.headerOffset >= range.offset && level.dataOffset < range.offset + range.bytes);
      for (const [name, values] of Object.entries(level.arrays)) {
        const descriptor = level.values[name];
        assert.equal(values.length, descriptor.count);
        if (descriptor.elementType === 'Float') values.forEach((v, i) => assert.equal(v, bank.readFloatLE(descriptor.arrayOffset + 4 * i)));
      }
    }
  }
  for (const name of ['e11', 'a280']) {
    const branch = phases.clipTags[name].enter.find(t => t.fields.BranchTypeAssetName === 'Extra.1P.Branch');
    assert.equal(branch.fields.StartLinkOffset, 28);
    assert.equal(branch.fields.EndLinkOffset, 2);
    assert.equal(branch.fields.LinkFlags, 32);
  }
  const enter = phases.transitions.find(t => t.key === 'ccdeb7eeeaf82707');
  assert.equal(enter.blend.fields.BlendTime, 4);
  assert.equal(enter.blend.samples.length, 20);
  assert.equal(phases.transitions.find(t => t.key === '270b807c39029f9f').blend.fields.BlendTime, 0);
  const reverse = phases.transitions.filter(t => t.role === 'exit' && t.fields.To === '4980525082f6f0ec');
  assert.equal(reverse.length, 2);
  assert.ok(reverse.every(t => t.fields.BranchInPhase === 2));
  assert.deepEqual(reverse.map(t => t.fields.DestinationPhase), [Math.fround(.9), Math.fround(.2)]);
  const spine = phases.nodeTags.enter.find(t => t.fields.ValueAssetName === 'EnableSpineX.Float');
  assert.deepEqual(spine.arrays.Spline, Array.from({length: 11}, (_, i) => Math.fround(i / 10)));
});

test('actual GLTF aim changes source weapon pose, preserves camera and duplicate bone bindings', async () => {
  for (const weapon of Object.values(document.weapons)) {
    const {gltf} = await loadAdsSource(weapon.weaponId), root = gltf.scene;
    const recovered = createFirstPersonAimClips(root, document, weapon.weaponId);
    const mixer = new THREE.AnimationMixer(root), idle = mixer.clipAction(gltf.animations.find(c => c.name === 'idle')).play(); mixer.update(0);
    const before = adsSnapshot(root), expectedNames = new Set(gltf.animations.flatMap(c => c.tracks.map(t => t.name)));
    idle.stop();
    const action = mixer.clipAction(recovered.pose.clip).play(); mixer.update(0);
    const after = adsSnapshot(root);
    assert.ok(new THREE.Vector3().fromArray(before.Wep_Muzzle[0].position).distanceTo(new THREE.Vector3().fromArray(after.Wep_Muzzle[0].position)) > .05);
    assert.ok(new THREE.Vector3().fromArray(after.CameraJoint[0].position).distanceTo(new THREE.Vector3().fromArray(before.CameraJoint[0].position)) < 1e-12);
    // A280 source idle/zoom camera quaternions differ by 1.38e-6 radians.
    assert.ok(new THREE.Quaternion().fromArray(after.CameraJoint[0].rotation).normalize().angleTo(new THREE.Quaternion().fromArray(before.CameraJoint[0].rotation).normalize()) < 2e-6);
    for (const name of ['Wep_Root', 'Wep_Muzzle']) for (const bone of after[name]) {
      assert.ok(new THREE.Vector3().fromArray(bone.position).distanceTo(new THREE.Vector3().fromArray(after[name][0].position)) < 1e-6);
    }
    for (const role of ['pose', 'enter', 'exit']) {
      assert.equal(recovered[role].clip.duration, 1, 'phase unit, not a native duration');
      assert.equal(recovered[role].missing.length, 0);
      for (const track of recovered[role].clip.tracks) assert.ok(expectedNames.has(track.name), `share PropertyMixer ${track.name}`);
    }
    action.stop();
  }
});

test('transition phases preserve trim and exact normalized source samples with original idle mask', async () => {
  for (const weapon of Object.values(document.weapons)) {
    const {gltf} = await loadAdsSource(weapon.weaponId), recovered = createFirstPersonAimClips(gltf.scene, document, weapon.weaponId);
    for (const role of ['enter', 'exit']) {
      const source = weapon.clips[role], built = recovered[role];
      assert.equal(built.sourceTrim.start, source.animationBase.TrimOffset);
      assert.equal(built.sourceTrim.span, source.animationBase.TrimmedDuration);
      for (const boneName of ['Wep_Root', 'CameraJoint']) for (const property of ['rotation', 'translation']) {
        const track = source.tracks.find(t => t.bone === boneName && t.property === property);
        const node = sourceBones(gltf.scene, boneName)[0];
        const emitted = built.clip.tracks.find(t => t.name === `${node.name}.${property === 'rotation' ? 'quaternion' : 'position'}`);
        const interp = emitted.createInterpolant();
        source.sourceKeyTimes.forEach((tick, i) => {
          if (tick < built.sourceTrim.start) return;
          const actual = Array.from(interp.evaluate((tick - built.sourceTrim.start) / built.sourceTrim.span));
          if (property === 'rotation') assert.ok(new THREE.Quaternion().fromArray(actual).normalize().angleTo(new THREE.Quaternion().fromArray(track.values[i]).normalize()) < 2e-6);
          else assert.ok(new THREE.Vector3().fromArray(actual).distanceTo(new THREE.Vector3().fromArray(track.values[i])) < 2e-6);
        });
      }
      for (const override of weapon.idleOverrideTracks) {
        const node = sourceBones(gltf.scene, override.bone)[0], rotation = override.property === 'rotation';
        const emitted = built.clip.tracks.find(t => t.name === `${node.name}.${rotation ? 'quaternion' : 'position'}`);
        const interp = emitted.createInterpolant(), first = Array.from(interp.evaluate(0));
        assert.deepEqual(Array.from(interp.evaluate(.5)), first);
        assert.deepEqual(Array.from(interp.evaluate(1)), first);
      }
    }
  }
});
