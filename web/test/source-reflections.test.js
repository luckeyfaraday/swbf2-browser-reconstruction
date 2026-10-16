import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {createSourceReflectionCube, createSourceReflectionSelector, prepareSourceReflections} from '../src/source-reflections.js';

const document = JSON.parse(fs.readFileSync(new URL('../public/assets/source-reflections.json', import.meta.url)));
const evidence = JSON.parse(fs.readFileSync(new URL('../../exports/lighting/dfg-reflection-recovery.json', import.meta.url)));
const smallId = '14339d41-d798-4568-a4a9-2eeb15dc8730';
const largeId = 'f5feeb41-7a4a-45e5-a2cf-f840aaee24ae';
const twoDocument = {...document, payloads: document.payloads.filter(value => [smallId, largeId].includes(value.id))};
const readPayload = payload => fs.readFileSync(new URL(`../public${payload.url}`, import.meta.url));
const asArrayBuffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const spawn = [-919.68, 587.52, -319.9382];

test('published reflection volumes preserve active source references and every matrix basis', () => {
  assert.equal(document.volumes.length, 88);
  assert.equal(document.payloads.length, 88);
  assert.equal(new Set(document.payloads.map(value => value.sha256)).size, 88);
  assert.equal(document.payloads.reduce((sum, payload) => sum + payload.byteLength, 0), 91990272);
  assert.equal(document.layerRoot.instanceGuid, evidence.layerRoot.instanceGuid);
  assert.equal(document.levelReference.blueprint.$external, evidence.layerRoot.fileGuid);
  for (const volume of document.volumes) {
    const source = evidence.volumes.find(value => value.$id === volume.id);
    assert.deepEqual(volume.bakedTexture, source.BakedTexture);
    assert.equal(volume.enabled, source.Enabled);
    assert.equal(volume.visible, source.IsVisible);
    assert.equal(volume.mode, source.Mode.name);
    assert.deepEqual(volume.matrix, ['right', 'up', 'forward', 'trans'].flatMap(key =>
      ['x', 'y', 'z'].map(axis => source.Transform[key][axis]).concat(key === 'trans' ? 1 : 0)));
    if (volume.payloadId) {
      const payload = document.payloads.find(value => value.id === volume.payloadId);
      const binding = payload.textureBindings.find(value => value.volumeId === volume.id);
      assert.equal(volume.bakedTexture.$external, binding.textureFileGuid);
      assert.equal(volume.bakedTexture.classGuid, binding.textureInstanceGuid);
    }
  }
});

test('every native reflection mip remains byte-identical to its associated source chunk', () => {
  for (const payload of document.payloads) {
    const bytes = readPayload(payload);
    const recovered = evidence.extractedPayloads.find(value => value.volumeId === payload.id);
    assert.equal(bytes.length, payload.mipCount === 6 ? 1048320 : 786432);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), recovered.sourceChunkSha256);
    assert.equal(payload.sha256, recovered.sourceChunkSha256);
    assert.deepEqual(bytes, fs.readFileSync(new URL(`../../${recovered.sourceChunkPath}`, import.meta.url)));
    assert.deepEqual(payload.subresources, recovered.subresources);
    const cube = createSourceReflectionCube(payload, asArrayBuffer(bytes));
    assert.equal(cube.type, THREE.HalfFloatType);
    assert.equal(cube.colorSpace, THREE.LinearSRGBColorSpace);
    assert.equal(cube.minFilter, THREE.LinearFilter);
    assert.equal(cube.generateMipmaps, false);
    assert.equal(cube.flipY, false);
    assert.equal(cube.isRenderTargetTexture, true);
    assert.equal(cube.mipmaps.length, 0); // PMREM consumes original mip zero only.
    let peak = 0;
    for (let face = 0; face < 6; face++) {
      const texture = cube.images[face], slice = payload.subresources[face];
      assert.ok(texture.image.data instanceof Uint16Array);
      assert.equal(texture.image.width, 128);
      assert.equal(texture.type, THREE.HalfFloatType);
      assert.deepEqual(Buffer.from(texture.image.data.buffer, texture.image.data.byteOffset, texture.image.data.byteLength),
        bytes.subarray(slice.offset, slice.offset + slice.bytes));
      for (let index = 0; index < texture.image.data.length; index++) {
        const value = THREE.DataUtils.fromHalfFloat(texture.image.data[index]);
        assert.ok(Number.isFinite(value));
        if (index % 4 !== 3) peak = Math.max(peak, value);
      }
      texture.dispose();
    }
    assert.equal(peak, Math.max(...payload.subresources.slice(0, 6).flatMap(slice => slice.channelMax.slice(0, 3))));
    if (payload.id === smallId) assert.equal(peak, 14296);
    if (payload.id === largeId) assert.equal(peak, 12216);
    cube.dispose();
  }
});

test('reflection selection uses actual source coordinates and never invents distant coverage', () => {
  const selector = createSourceReflectionSelector(twoDocument);
  assert.equal(selector.activeVolumeCount, 88);
  assert.equal(selector.availableVolumeCount, 2);
  assert.equal(selector.select(spawn).id, largeId);
  assert.equal(selector.select(new THREE.Vector3(-919.4801, 590.9489, -334.153137)).id, smallId);
  assert.equal(selector.select([0, 0, 0]), null);
  const disabled = structuredClone(twoDocument);
  disabled.volumes.find(value => value.id === smallId).enabled = false;
  assert.equal(createSourceReflectionSelector(disabled).select([-919.4801, 590.9489, -334.153137]), null);
  disabled.layerRoot.enabled = false;
  assert.equal(createSourceReflectionSelector(disabled).select(spawn), null);
});

test('all 38 retained team and neutral spawns have a recovered active reflection volume', () => {
  const scene = JSON.parse(fs.readFileSync(new URL('../public/assets/map.scene.json', import.meta.url)));
  const selector = createSourceReflectionSelector(document);
  const spawns = [...scene.spawns, ...scene.neutralSpawns];
  assert.equal(selector.availableVolumeCount, 88);
  assert.equal(spawns.length, 38);
  for (const sourceSpawn of spawns) assert.ok(selector.select(sourceSpawn.position), JSON.stringify(sourceSpawn.position));
  const singleMip = document.payloads.filter(value => value.mipCount === 1);
  assert.deepEqual(singleMip.map(value => value.id), ['f7ea4e16-c9a0-413f-99ba-a90c272a2c28']);
  assert.equal(singleMip[0].subresources.length, 6);
});

test('selection transforms rotated volumes and the source layer, with sphere/box distinction', () => {
  const fixture = structuredClone(document);
  const matrix = new THREE.Matrix4().compose(new THREE.Vector3(10, 20, 30),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2), new THREE.Vector3(2, 3, 4));
  fixture.levelReference.matrix = new THREE.Matrix4().makeTranslation(100, 200, 300).toArray();
  fixture.volumes = [{...fixture.volumes.find(value => value.id === smallId), matrix: matrix.toArray()}];
  const worldMatrix = new THREE.Matrix4().fromArray(fixture.levelReference.matrix).multiply(matrix);
  const point = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(worldMatrix);
  assert.equal(createSourceReflectionSelector(fixture).select(point(.9, .9, 0)).id, smallId);
  assert.equal(createSourceReflectionSelector(fixture).select(point(1.01, 0, 0)), null);
  fixture.volumes[0].shape = 'sphere';
  assert.equal(createSourceReflectionSelector(fixture).select(point(.9, .9, 0)), null);
  assert.equal(createSourceReflectionSelector(fixture).select(point(.5, .5, .5)).id, smallId);
  fixture.volumes[0].visible = false;
  assert.equal(createSourceReflectionSelector(fixture).select(point(0, 0, 0)), null);
  fixture.volumes[0].visible = true;
  fixture.volumes[0].mode = 'LocalIBLMode_Dynamic';
  assert.equal(createSourceReflectionSelector(fixture).select(point(0, 0, 0)), null);
});

test('invalid mip layout, non-finite half floats and singular transforms are rejected', () => {
  const payload = document.payloads[0], raw = asArrayBuffer(readPayload(payload));
  const wrongLayout = structuredClone(payload);
  wrongLayout.subresources[7].offset += 8;
  assert.throws(() => createSourceReflectionCube(wrongLayout, raw), /face\/mip range/);
  assert.throws(() => createSourceReflectionCube(payload, raw.slice(8)), /half-float payload/);
  new DataView(raw).setUint16(0, 0x7c00, true);
  assert.throws(() => createSourceReflectionCube(payload, raw), /Non-finite/);
  const singular = structuredClone(document);
  singular.volumes.find(value => value.payloadId).matrix[0] = 0;
  assert.throws(() => createSourceReflectionSelector(singular), /Singular/);
  assert.throws(() => createSourceReflectionSelector(document).select([NaN, 0, 0]), /sample position/);
});

function fakePreparation(failIndex = -1) {
  const resources = {cubes: [], facesDisposed: 0, cubesDisposed: 0, targets: [], generatorDisposed: 0};
  return {
    resources,
    options: {
      fetch: async url => ({ok: true, arrayBuffer: async () =>
        asArrayBuffer(readPayload(document.payloads.find(payload => payload.url === url)))}),
      createPMREM: () => ({
        fromCubemap(cube) {
          resources.cubes.push(cube);
          cube.addEventListener('dispose', () => resources.cubesDisposed++);
          for (const face of cube.images) face.addEventListener('dispose', () => resources.facesDisposed++);
          if (resources.cubes.length - 1 === failIndex) throw new Error('Simulated GPU preprocessing failure');
          const target = {texture: new THREE.Texture(), disposed: 0, dispose() { this.disposed++; }};
          resources.targets.push(target);
          return target;
        },
        dispose() { resources.generatorDisposed++; },
      }),
    },
  };
}

test('prepared reflections mutate only scene environment, keep it when leaving coverage and restore it on disposal', async () => {
  const {resources, options} = fakePreparation();
  const reflections = await prepareSourceReflections({}, twoDocument, options);
  assert.equal(resources.cubesDisposed, 2);
  assert.equal(resources.facesDisposed, 12);
  assert.equal(resources.generatorDisposed, 1);
  assert.ok(resources.targets.every(value => value.disposed === 0));
  const scene = new THREE.Scene(), original = new THREE.Texture(), background = new THREE.Texture();
  scene.environment = original;
  scene.background = background;
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);
  assert.equal(reflections.update(spawn, scene), largeId);
  assert.equal(scene.environment, resources.targets[twoDocument.payloads.findIndex(value => value.id === largeId)].texture);
  assert.equal(mesh.geometry, geometry);
  assert.equal(mesh.material, material);
  assert.equal(scene.background, background);
  assert.equal(scene.environmentIntensity, 1);
  const switches = reflections.snapshot().switches;
  reflections.update(spawn, scene);
  assert.equal(reflections.snapshot().switches, switches);
  assert.equal(reflections.snapshot().sourcePayloadBytes, 2096640);
  // Leaving coverage keeps the last capture: clearing the environment would
  // change every standard material's program and recompile them mid-game.
  const covered = scene.environment;
  reflections.update([0, 0, 0], scene);
  assert.equal(scene.environment, covered);
  assert.equal(reflections.snapshot().covered, false);
  reflections.update(spawn, scene);
  reflections.dispose();
  reflections.dispose();
  assert.equal(scene.environment, original);
  assert.ok(resources.targets.every(value => value.disposed === 1));
  assert.throws(() => reflections.update(spawn, scene), /disposed/);
  geometry.dispose(); material.dispose(); original.dispose(); background.dispose();
});

test('reflection cleanup respects external environment changes and partial preparation failures', async () => {
  const {options} = fakePreparation();
  const reflections = await prepareSourceReflections({}, twoDocument, options);
  const scene = new THREE.Scene(), external = new THREE.Texture();
  reflections.update(spawn, scene);
  scene.environment = external;
  reflections.dispose();
  assert.equal(scene.environment, external);
  external.dispose();
  const failed = fakePreparation(1);
  await assert.rejects(prepareSourceReflections({}, twoDocument, failed.options), /Simulated GPU/);
  assert.equal(failed.resources.targets[0].disposed, 1);
  assert.equal(failed.resources.cubesDisposed, 2);
  assert.equal(failed.resources.facesDisposed, 12);
  assert.equal(failed.resources.generatorDisposed, 1);
});
