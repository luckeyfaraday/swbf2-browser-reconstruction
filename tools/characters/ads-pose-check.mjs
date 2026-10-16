import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import * as THREE from '../../web/node_modules/three/build/three.module.js';
import {GLTFLoader} from '../../web/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import {createFirstPersonAimClips} from '../../web/src/firstperson-ads.js';

export async function loadAdsSource(weaponId) {
  const manifest = JSON.parse(fs.readFileSync(new URL('../../web/public/assets/firstperson-weapons.json', import.meta.url)));
  const descriptor = manifest.models.find(m => m.weaponId === weaponId);
  const bytes = fs.readFileSync(new URL(`../../web/public/assets/${descriptor.url}`, import.meta.url));
  const length = bytes.readUInt32LE(12), doc = JSON.parse(bytes.subarray(20, 20 + length));
  // CPU-only GLTFLoader test: geometry, skins, animation, metadata and hierarchy
  // are unchanged. Texture references alone are removed in memory.
  doc.materials = (doc.materials ?? []).map(m => ({name: m.name, pbrMetallicRoughness: {baseColorFactor: [1, 1, 1, 1]}}));
  delete doc.images; delete doc.textures; delete doc.samplers;
  const raw = Buffer.from(JSON.stringify(doc)), padded = Buffer.alloc((raw.length + 3) & ~3, 32); raw.copy(padded);
  const header = Buffer.from(bytes.subarray(0, 20)), remaining = bytes.subarray(20 + length);
  header.writeUInt32LE(20 + padded.length + remaining.length, 8); header.writeUInt32LE(padded.length, 12);
  const rebuilt = Buffer.concat([header, padded, remaining]);
  const gltf = await new GLTFLoader().parseAsync(rebuilt.buffer.slice(rebuilt.byteOffset, rebuilt.byteOffset + rebuilt.byteLength), '');
  return {gltf, descriptor};
}

export function sourceBones(root, name) {
  const nodes = [];
  root.traverse(n => {if (n.userData?.sourceBoneIndex !== undefined && (n.userData.name ?? n.name) === name) nodes.push(n);});
  return nodes;
}

export function adsSnapshot(root) {
  root.updateMatrixWorld(true);
  const result = {};
  for (const name of ['CameraBase', 'CameraJoint', 'SpineX', 'Wep_Root', 'Wep_Muzzle']) {
    result[name] = sourceBones(root, name).map(n => {
      const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
      n.matrixWorld.decompose(position, rotation, scale);
      return {node: n.name, localPosition: n.position.toArray(), localRotation: n.quaternion.toArray(),
        position: position.toArray(), rotation: rotation.toArray(), forward: new THREE.Vector3(0, 0, 1).applyQuaternion(rotation).toArray()};
    });
  }
  return result;
}

async function main() {
  const document = JSON.parse(fs.readFileSync(new URL('../../web/public/assets/firstperson-ads.json', import.meta.url)));
  const report = {evidenceId: 'BF2-FIRSTPERSON-ADS-CPU-001', nativeExecutionObserved: false,
    basis: 'Actual GLTFLoader meshes/skins/rig; CPU AnimationMixer on source-derived normalized-phase clips. No hardware renderer.', weapons: {}};
  for (const weaponId of ['primary', 'rebel-a280']) {
    const {gltf} = await loadAdsSource(weaponId), root = gltf.scene;
    const recovered = createFirstPersonAimClips(root, document, weaponId), mixer = new THREE.AnimationMixer(root);
    const idle = mixer.clipAction(gltf.animations.find(c => c.name === 'idle')).play(); mixer.update(0);
    const w = {idle: adsSnapshot(root), clips: {}};
    idle.stop();
    for (const role of ['pose', 'enter', 'exit']) {
      const item = recovered[role], action = mixer.clipAction(item.clip);
      action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.reset().play();
      const samples = [];
      for (const phase of [0, .5, 1]) {
        action.time = phase; mixer.update(0);
        samples.push({phase, bones: adsSnapshot(root)});
      }
      action.stop();
      w.clips[role] = {sourceName: item.sourceName, boundTracks: item.boundTracks, missing: item.missing, samples};
    }
    report.weapons[weaponId] = w;
  }
  fs.writeFileSync(new URL('../../exports/firstperson-ads/cpu-pose-check.json', import.meta.url), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(Object.fromEntries(Object.entries(report.weapons).map(([id, w]) => [id, {
    idleMuzzle: w.idle.Wep_Muzzle[0].position,
    zoomMuzzle: w.clips.pose.samples[0].bones.Wep_Muzzle[0].position,
    idleCamera: w.idle.CameraJoint[0].position,
    zoomCamera: w.clips.pose.samples[0].bones.CameraJoint[0].position,
    clips: Object.fromEntries(Object.entries(w.clips).map(([role, c]) => [role, {boundTracks: c.boundTracks, missing: c.missing.length}]))
  }])), null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
