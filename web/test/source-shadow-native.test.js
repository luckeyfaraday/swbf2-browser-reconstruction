import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  NATIVE_SHADOW_DEFAULTS, SOURCE_SHADOW_NATIVE_POLICY,
  nativePunctualSpotShadowParameters, nativeShadowAtlasSize, nativeShadowAtlasParam,
  nativeShadowBorderFov, nativeShadowDepthFactors,
  nativeShadowBiasForFormat,
} from '../src/source-shadow-native.js';

const evidence = JSON.parse(await readFile(new URL('../../exports/lighting/native-shadow-producer.json', import.meta.url)));
const lightBytes = await readFile(new URL('../public/assets/source-lights.json', import.meta.url));
const lights = JSON.parse(lightBytes).lights;
const key = (v) => JSON.stringify([v.fileGuid, v.classGuid, v.route]);
const identitySet = new Set(evidence.selectedPunctualShadowSpots.identities.map(key));
const selected = lights.filter((v) => identitySet.has(key(v)));
const close = (a, b, tolerance = 2e-6) => assert.ok(Math.abs(a - b) <= tolerance, `${a} vs ${b}`);

test('native shadow evidence selects exactly the original 52 punctual spot identities', () => {
  assert.equal(createHash('sha256').update(lightBytes).digest('hex'), evidence.sourceLightDocument.sha256);
  assert.equal(SOURCE_SHADOW_NATIVE_POLICY.evidenceId, evidence.evidenceId);
  assert.equal(selected.length, 52);
  assert.equal(identitySet.size, 52);
  assert.equal(selected.filter((l) => l.properties.ShadowCacheEnable).length, 5);
  assert.equal(evidence.nativeConstructorDefaults.LocalLightShadowFilterQuality, NATIVE_SHADOW_DEFAULTS.filterQuality);
  for (const light of selected) {
    const p = light.properties, shadow = nativePunctualSpotShadowParameters(p);
    assert.equal(shadow.enabledBySourceLevel, true);
    assert.equal(shadow.requestedResolution, 512);
    assert.equal(shadow.near, Math.fround(.2));
    assert.equal(shadow.far, Math.fround(p.AttenuationRadius));
    assert.equal(shadow.filterQuality, 1);
    assert.ok(shadow.shadowStartDegrees <= shadow.shadowEndDegrees);
    assert.ok(shadow.shadowEndDegrees <= Math.min(150, p.ShadowMaxAngle));
    assert.ok(Number.isFinite(shadow.angleScale));
    // This verifies the cosine fade endpoints, independent of matrix convention.
    close(Math.cos(shadow.shadowStartDegrees * Math.PI / 360) * shadow.angleScale + shadow.angleOffset, 1, .025);
    close(Math.cos(shadow.shadowEndDegrees * Math.PI / 360) * shadow.angleScale + shadow.angleOffset, 0, .025);
  }
});

test('native atlas border preserves receiver coordinates after caster FOV expansion', () => {
  const size = nativeShadowAtlasSize(32, 512);
  assert.equal(size, 3120);
  for (const [slots, resolution] of [[1, 128], [2, 256], [17, 512], [32, 512], [64, 1024]]) {
    const side = nativeShadowAtlasSize(slots, resolution);
    assert.ok(Math.floor(side / (resolution + 8)) ** 2 >= slots);
    const rectangle = { x: 0, y: 0, width: resolution + 8, height: resolution + 8 };
    const uv = nativeShadowAtlasParam(rectangle, side);
    close(uv[0] * side, 4, .0001);
    close(uv[2] * side, resolution, .0001);
    for (const fov of [.2, .8, 1.5, 2.5]) {
      const expanded = nativeShadowBorderFov(fov, resolution);
      assert.ok(expanded > fov);
      for (const x of [-1, -.7, 0, .3, 1]) {
        // The same world ray projected into the expanded caster tile and the
        // unexpanded receiver interior must address the same atlas location.
        const raySlope = x * Math.tan(fov / 2);
        const casterPixel = (raySlope / Math.tan(expanded / 2) * .5 + .5) * rectangle.width;
        const receiverPixel = (uv[0] + (x * .5 + .5) * uv[2]) * side;
        close(casterPixel, receiverPixel, .0003);
      }
    }
  }
});

test('native explicit depth factors map near/far endpoints and reverse monotonically', () => {
  for (const [near, far] of [[.2, 25], [.005, 1000], [2, 2.1], [1, 2]]) {
    for (const reverse of [false, true]) {
      const [a, b] = nativeShadowDepthFactors(near, far, reverse);
      close(a / near + b, reverse ? 1 : 0, .00001);
      close(a / far + b, reverse ? 0 : 1, .00001);
      const depths = [near, (near + far) / 2, far].map((z) => a / z + b);
      assert.ok(reverse ? depths[0] > depths[1] && depths[1] > depths[2]
        : depths[0] < depths[1] && depths[1] < depths[2]);
    }
  }
  assert.throws(() => nativeShadowDepthFactors(.2, 25), /explicit/);
});

test('native spot clamps and source quality gates do not silently promote unsupported emitters', () => {
  const source = selected[0].properties;
  const p = { ...source, ShadowNearRadius: -1, ShadowFarRadius: 500, OuterAngle: 300, ShadowMaxAngle: 300 };
  const shadow = nativePunctualSpotShadowParameters(p);
  assert.equal(shadow.near, Math.fround(.005));
  assert.equal(shadow.far, Math.fround(p.AttenuationRadius));
  assert.equal(shadow.shadowEndDegrees, 150);
  assert.equal(nativePunctualSpotShadowParameters({ ...p, ShadowFarRadius: 2 }).far, 2);
  assert.equal(nativePunctualSpotShadowParameters({ ...p, CastShadowsEnable: false }).enabledBySourceLevel, false);
  assert.equal(nativePunctualSpotShadowParameters({ ...p, CastShadows: { value: 5 } }).enabledBySourceLevel, false);
  assert.equal(nativePunctualSpotShadowParameters({ ...p, CastShadows: { value: 1 } }).enabledBySourceLevel, false);
  assert.throws(() => nativePunctualSpotShadowParameters({ ...source, DiscRadius: 1 }), /punctual/);
});

test('native bias format selection matches independent executable and material table bytes', async () => {
  const table = evidence.depthBias;
  const handle = await import('node:fs/promises').then((fs) => fs.open(new URL('../../exports/materials/rvm/0.res', import.meta.url)));
  const bytes = Buffer.alloc(table.rvmBytes);
  try {
    assert.equal((await handle.read(bytes, 0, bytes.length, table.rvmOffset)).bytesRead, bytes.length);
  } finally {
    await handle.close();
  }
  assert.equal(createHash('sha256').update(bytes).digest('hex'), table.rvmSha256);
  assert.equal(table.tablesMatchRvmBytes, true);
  for (const [format, group] of Object.entries(table.formatToGroup)) {
    const actual = nativeShadowBiasForFormat(Number(format));
    assert.equal(actual.group, group);
    assert.equal(actual.name, table.groups[group].name);
    assert.equal(actual.depthBias, bytes.readInt32LE(group * 4));
    assert.equal(actual.slopeScaledDepthBias, bytes.readFloatLE(68 + group * 4));
    assert.equal(actual.depthBiasClamp, 0);
  }
  assert.throws(() => nativeShadowBiasForFormat(30), /depth format/);
});
