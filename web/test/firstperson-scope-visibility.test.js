import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  createSourceFirstpersonVisibility, evaluateSourceFirstpersonVisibility,
  nativeZoomFraction, resolveSourceFirstpersonVisibility,
} from '../src/firstperson-scope-visibility.js';

const document = JSON.parse(fs.readFileSync(new URL('../public/assets/firstperson-scope-visibility.json', import.meta.url)));
const evidence = JSON.parse(fs.readFileSync(new URL('../../exports/firstperson-scope-native/visibility-evidence.json', import.meta.url)));
const source = id => resolveSourceFirstpersonVisibility(document, id);

test('selected source rifles require opaque mesh replacement, including identical zoom mesh', () => {
  assert.deepEqual(document.aimingZoomLevels.map(level => level.UseWeaponMeshZoom1p), [true, true]);
  assert.deepEqual(source('primary').zoomLevels.map(level => level.ZoomInOutMeshTransitionFactors), [[.5], [.5]]);
  assert.deepEqual(source('rebel-a280').zoomLevels.map(level => level.ZoomInOutMeshTransitionFactors), [[.1], [.2]]);
  for (const id of ['primary', 'rebel-a280']) {
    const config = source(id);
    assert.equal(config.mesh.$external, config.meshZoom.$external);
    const hip = evaluateSourceFirstpersonVisibility(config);
    assert.equal(hip.normalModelVisible, true); assert.equal(hip.bodyVisible, true);
    const ads = evaluateSourceFirstpersonVisibility(config, {cameraZoomIndex: 1, zoomFraction: 1});
    assert.equal(ads.normalModelVisible, false); assert.equal(ads.zoomModelVisible, false);
    assert.equal(ads.bodyVisible, false); assert.equal(ads.zoomMeshSelected, true);
  }
  assert.equal(resolveSourceFirstpersonVisibility(document, 'invented'), null);
  assert.equal(resolveSourceFirstpersonVisibility(document, 'primary', {sourceGuid: 'wrong'}), null);
});

test('native machine instructions gate both models with the same output body mask', () => {
  const native = evidence.functions.find(row => row.address === '0x141683340').nativeSpan;
  const bytes = Buffer.from(native.bytes, 'hex');
  const at = address => address - 0x141683340;
  // TEST R15B,R12B; SETZ BPL; AND output body byte,BPL.
  assert.equal(bytes.subarray(at(0x1416834ed), at(0x1416834f0)).toString('hex'), '4584e7');
  assert.equal(bytes.subarray(at(0x1416834f5), at(0x1416834fc)).toString('hex'), '400f94c5402028');
  // Each model branch tests BPL before passing true to the renderer.
  assert.equal(bytes.subarray(at(0x141683548), at(0x14168354b)).toString('hex'), '4084ed');
  assert.equal(bytes.subarray(at(0x14168357a), at(0x14168357d)).toString('hex'), '4084ed');
  for (const selected of [false, true]) for (const override of [false, true]) {
    const config = structuredClone(source('rebel-a280'));
    config.zoomLevels[1].ZoomInOutMeshTransitionFactors = override ? [.2] : [];
    config.aimingZoomLevels[1].UseWeaponMeshZoom1p = selected;
    const result = evaluateSourceFirstpersonVisibility(config, {cameraZoomIndex: 1, zoomFraction: 1});
    const assemblyBpl = (Number(selected) & Number(override)) === 0;
    assert.equal(result.bodyVisible, assemblyBpl);
    assert.equal(result.normalModelVisible, !selected && assemblyBpl);
    assert.equal(result.zoomModelVisible, selected && assemblyBpl);
  }
});

test('selected source flags remove index ambiguity and preserve directional transition thresholds', () => {
  const config = source('rebel-a280');
  // Camera requested zoom can select the zoom mesh below .2 before weapon state catches up.
  const before = evaluateSourceFirstpersonVisibility(config, {cameraZoomIndex: 1, weaponAimingIndex: 0, zoomFraction: .19});
  const boundary = evaluateSourceFirstpersonVisibility(config, {cameraZoomIndex: 1, weaponAimingIndex: 0, zoomFraction: .2});
  assert.equal(before.bodyVisible, false); assert.equal(boundary.bodyVisible, false);
  for (const weaponAimingIndex of [0, 1]) for (const zoomFraction of [0, .1, .2, .5, .999, 1]) {
    assert.equal(evaluateSourceFirstpersonVisibility(config, {cameraZoomIndex: 1, weaponAimingIndex, zoomFraction}).bodyVisible, false);
    assert.equal(evaluateSourceFirstpersonVisibility(config, {cameraZoomIndex: 0, weaponAimingIndex, zoomFraction}).bodyVisible, zoomFraction < .1);
  }
  // On the opposite transition the source hip threshold .1 selects the current weapon state above it.
  assert.equal(evaluateSourceFirstpersonVisibility(config, {cameraZoomIndex: 0, weaponAimingIndex: 1, zoomFraction: .1}).bodyVisible, false);
  assert.equal(evaluateSourceFirstpersonVisibility(config, {cameraZoomIndex: 0, weaponAimingIndex: 1, zoomFraction: .099}).bodyVisible, true);
  const twoFactors = structuredClone(config);
  twoFactors.zoomLevels[0].ZoomInOutMeshTransitionFactors = [.3, .7];
  twoFactors.zoomLevels[1].ZoomInOutMeshTransitionFactors = [.3, .7];
  assert.equal(evaluateSourceFirstpersonVisibility(twoFactors, {cameraZoomIndex: 0}).threshold, .7);
  assert.equal(evaluateSourceFirstpersonVisibility(twoFactors, {cameraZoomIndex: 1}).threshold, .3);
});

test('native timer reverses continuously and browser lifecycle restores hip visibility', () => {
  const visibility = createSourceFirstpersonVisibility(document, 'rebel-a280');
  const partial = visibility.update(.05, {aiming: true});
  assert.ok(Math.abs(partial.zoomFraction - .25) < 1e-12);
  assert.equal(partial.bodyVisible, false);
  const reversed = visibility.update(0, {aiming: false});
  assert.ok(Math.abs(reversed.zoomFraction - partial.zoomFraction) < 1e-12);
  assert.equal(reversed.normalModelVisible, false);
  assert.equal(visibility.update(1, {aiming: false}).zoomFraction, 0);
  visibility.update(.2, {aiming: true});
  const dead = visibility.update(.016, {aiming: true, alive: false});
  assert.equal(dead.bodyVisible, false); assert.equal(dead.normalModelVisible, false); assert.equal(dead.zoomModelVisible, false);
  assert.equal(visibility.reset().normalModelVisible, true);
  assert.equal(visibility.snapshot().remaining, 0);
  assert.equal(nativeZoomFraction(0, 0, 1), 1);
  assert.throws(() => visibility.update(NaN), /Invalid dt/);
  assert.throws(() => visibility.update(-1), /Negative/);
  assert.throws(() => nativeZoomFraction(.1, 0, 1), /Invalid zoom timer/);
});

test('original A280 lens stays an opaque physical section rather than a transparency workaround', () => {
  const glb = fs.readFileSync(new URL('../public/assets/firstperson/firstperson-a280.glb', import.meta.url));
  assert.equal(glb.toString('ascii', 0, 4), 'glTF');
  const json = JSON.parse(glb.toString('utf8', 20, 20 + glb.readUInt32LE(12)).trim());
  const primitive = json.meshes.flatMap(mesh => mesh.primitives).find(p => json.materials[p.material]?.name === 'scope_mat');
  assert.ok(primitive, 'original scope material remains part of the weapon');
  assert.equal(json.accessors[primitive.attributes.POSITION].count, 17);
  const material = json.materials[primitive.material];
  assert.equal(material.alphaMode ?? 'OPAQUE', 'OPAQUE');
  assert.equal(material.pbrMetallicRoughness.baseColorFactor[3], 1);
});
