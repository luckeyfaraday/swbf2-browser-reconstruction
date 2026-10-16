import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const project = new URL('../../', import.meta.url);
const read = relative => fs.readFileSync(new URL(relative, project));
const json = relative => JSON.parse(read(relative));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const evidence = json('tools/gameplay-recovery/faction-weapons-evidence.json');
const runtime = json('web/public/assets/faction-weapons.json');

test('faction chain observations retain exact source fields and hashes', () => {
  assert.equal(evidence.runtimeObserved, false);
  for (const source of evidence.sources) assert.equal(sha256(read(source.file)), source.jsonSha256);
  for (const observation of evidence.observations) {
    const value = observation.jsonPointer.split('/').slice(1).reduce((object, key) => object[key], json(observation.file));
    assert.deepEqual(value, observation.value, observation.jsonPointer);
  }
  const modifierSource = evidence.sources.find(source => source.name.endsWith('/DefaultWeapon_L_Assault_Orig'));
  const abilitySource = evidence.sources.find(source => source.name.endsWith('/Ability_BlasterRifle_Assault_Default'));
  const modifier = json(modifierSource.file).asset.objects[0], ability = json(abilitySource.file).asset.objects[0];
  assert.equal(modifier.PlayerAbilityIdentifier, ability.Identifier);
  assert.equal(modifier.UnlockToCreate.$external, runtime.weapons[0].sourceUnlockGuid);
  assert.notEqual(modifier.UnlockToCreate.$external, ability.Unlock.$external);
});

test('Rebel and Imperial actor assignments preserve distinct source weapon routes', () => {
  assert.deepEqual(runtime.teams, [{team: 0, weaponId: 'rebel-a280'}, {team: 1, weaponId: 'primary'}]);
  assert.equal(runtime.weapons[0].sourceWeaponGuid, '40432272-2578-4c77-9bf0-9bfd2094988f');
  assert.deepEqual(runtime.weapons[0].parameters, evidence.parameters);
  assert.equal(runtime.weapons[0].parameters.roundsPerMinute, 300);
  assert.equal(runtime.provenance.runtimeObserved, false);
});

test('recovered A280 GLB retains source skinned geometry and local textures', () => {
  const bytes = read(`web/public/assets/${runtime.weapons[0].url}`);
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
  assert.equal(gltf.skins[0].joints.length, 44);
  const vertexCount = gltf.meshes.flatMap(mesh => mesh.primitives).reduce((sum, primitive) => sum + gltf.accessors[primitive.attributes.POSITION].count, 0);
  assert.equal(vertexCount, 9649);
  for (const primitive of gltf.meshes.flatMap(mesh => mesh.primitives)) {
    assert.notEqual(primitive.attributes.JOINTS_0, undefined);
    assert.notEqual(primitive.attributes.WEIGHTS_0, undefined);
  }
  for (const image of gltf.images) assert.ok(fs.existsSync(new URL(image.uri, new URL(`web/public/assets/${runtime.weapons[0].url}`, project))));
  assert.equal(json('exports/faction-a280-validation.json').issues.numErrors, 0);
});

test('all nine original A280 audio variants have verified PCM and stable artifacts', () => {
  const audio = json('web/public/assets/faction-a280/audio/faction-a280.source.json');
  assert.equal(audio.variations.length, 9); assert.equal(audio.chunks.length, 4);
  for (const chunk of audio.chunks) assert.equal(sha256(read(chunk.file)), chunk.sha256);
  for (const variant of audio.variations) {
    const bytes = read(`web/public/assets/faction-a280/audio/${variant.file}`);
    assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
    assert.equal(sha256(bytes), variant.sha256);
    assert.equal(variant.independentPcmMatches, true);
    assert.equal(variant.channels, 2); assert.equal(variant.sampleRate, 48000);
  }
  for (const artifact of evidence.runtimeAssets) assert.equal(sha256(read(artifact.file)), artifact.sha256, artifact.file);
});
