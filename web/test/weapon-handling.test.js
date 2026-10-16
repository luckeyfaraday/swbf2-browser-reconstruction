import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {selectWeaponHandling} from '../src/weapon-handling.js';

const root=new URL('../../',import.meta.url);
const read=path=>JSON.parse(fs.readFileSync(new URL(path,root),'utf8'));
const document=read('web/public/assets/weapon-handling.json');
const evidence=read('tools/gameplay-recovery/weapon-handling-evidence.json');
const at=(value,path)=>path.reduce((entry,key)=>entry[key],value);

test('handling evidence resolves every retained source pointer and hashes the selected installed records',()=>{
  const cache=new Map();
  for(const item of evidence.observations) {
    if(!cache.has(item.source.file)) {
      const bytes=fs.readFileSync(new URL(item.source.file,root));
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),item.source.jsonSha256);
      cache.set(item.source.file,JSON.parse(bytes));
    }
    assert.deepEqual(at(cache.get(item.source.file),item.jsonPointer.split('/').slice(1)),item.value);
    assert.equal(item.runtimeObserved,false);
  }
  for(const link of evidence.referenceChain) {
    if(!link.value.$external)continue;
    const target=[...cache.values()].find(doc=>doc.entry.guid===link.value.$external);
    assert.ok(target,`missing target ${link.value.$external}`);
    assert.ok(target.asset.objects.some(obj=>obj.$id===link.value.classGuid),'class GUID must resolve, not only asset name');
  }
  assert.equal(evidence.referenceChain.length,23);
  assert.equal(evidence.sdkEvidence.evidenceType,'retained-tool-SDK-IL-not-native-game-code');
  assert.match(evidence.sdkEvidence.getters.Stand,/::_Stand/);
  assert.match(evidence.sdkEvidence.getters.Dispersion,/::_Dispersion/);
});

test('both actual rifle routes select nonzero sway despite zero legacy firing dispersion',()=>{
  for(const weaponId of ['primary','rebel-a280']) {
    const hip=selectWeaponHandling(document,weaponId);
    assert.deepEqual(hip.sourceStatePath,['Stand','NoZoom','BaseValue']);
    assert.equal(hip.dispersion.MinAngle,.05);assert.equal(hip.dispersion.MaxAngle,.7);
    assert.equal(hip.dispersion.IncreasePerShot,.08);assert.equal(hip.dispersion.NoFireTimeThreshold,.2);
    assert.equal(hip.recoil.RecoilAmplitudeIncPerShot,.7);
    assert.equal(hip.recoil.HorizontalRecoilAmplitudeIncPerShotMin,-.5);
    const moving=selectWeaponHandling(document,weaponId,{movement:'moving'});
    assert.equal(moving.dispersion.MinAngle,.1);
    const aimed=selectWeaponHandling(document,weaponId,{aiming:true});
    assert.equal(aimed.dispersion.MinAngle,0);assert.equal(aimed.dispersion.MaxAngle,.5);
    assert.equal(aimed.recoil.RecoilAmplitudeIncPerShot,.55);
    const legacy=document.weapons.find(w=>w.weaponId===weaponId).legacyWeaponDispersion;
    for(const pose of ['StandDispersion','CrouchDispersion','ProneDispersion']) {
      assert.equal(legacy[pose].MinAngle,0);assert.equal(legacy[pose].MaxAngle,0);assert.equal(legacy[pose].IncreasePerShot,0);
    }
  }
  assert.equal(document.weapons[0].swaySourceGuid,document.weapons[1].swaySourceGuid);
  // Equality is validated without treating separate SDK fields as computed aliases.
  for(const row of evidence.namedArrayEqualities)assert.deepEqual(at(document.configuration.sway,row.namedPath),at(document.configuration.sway,row.arrayPath));
});

test('weapon camera layer preserves source zoom ordering independently from gameplay FOV',()=>{
  for(const weaponId of ['primary','rebel-a280']) {
    const hip=selectWeaponHandling(document,weaponId),aim=selectWeaponHandling(document,weaponId,{aiming:true});
    assert.equal(hip.camera.gameplayZoom.FieldOfView,55);assert.equal(aim.camera.gameplayZoom.FieldOfView,23.9);
    assert.equal(hip.camera.weaponZoom.RenderFov,55);assert.equal(aim.camera.weaponZoom.RenderFov,55);
    assert.equal(aim.camera.gameplayZoom.LookSpeedMultiplier,.2738);
    assert.equal(aim.camera.zoomSensitivityProfile.Value,1);
    assert.equal(aim.camera.fovTransition.TransitionType.name,'FOVTransitionType_Smooth');
    assert.equal(aim.camera.fovTransition.Shape,2);
    assert.equal(aim.camera.recoil.SpringConstant,3000);
    assert.equal(aim.camera.recoil.SpringDamping,.84);
  }
  const hip=selectWeaponHandling(document,'rebel-a280'),aim=selectWeaponHandling(document,'rebel-a280',{aiming:true});
  assert.equal(hip.camera.weaponZoom.sourceObjectId,'internal:18');assert.equal(aim.camera.weaponZoom.sourceObjectId,'internal:17');
  assert.equal(hip.camera.weaponZoom.AnimationSettings.KickbackFactor,.8);
  assert.equal(aim.camera.weaponZoom.AnimationSettings.KickbackFactor,.5);
  assert.deepEqual(['WeaponOffsetX','WeaponOffsetY','WeaponOffsetZ'].map(k=>hip.camera.weaponZoom.AnimationSettings[k]),[.207,.33,-.189]);
  assert.equal(selectWeaponHandling(document,'primary').camera.weaponZoom.AnimationSettings.KickbackFactor,1);
  assert.ok(hip.provenance.unresolved.some(line=>line.includes('double-transform')));
});

test('state selector isolates returned data and rejects unknown weapon, missing states or mismatched sources',()=>{
  assert.equal(selectWeaponHandling(document,'unknown'),null);
  assert.equal(selectWeaponHandling(document,'primary',{pose:'prone',movement:'jumping'}),null);
  assert.equal(selectWeaponHandling(document,'primary',{pose:'crouch',movement:'sprinting'}),null);
  assert.throws(()=>selectWeaponHandling(document,'primary',{pose:'__proto__'}),RangeError);
  assert.throws(()=>selectWeaponHandling(document,'primary',{aiming:1}),RangeError);
  const copy=structuredClone(document);copy.weapons[0].swaySourceGuid='different-asset';
  assert.equal(selectWeaponHandling(copy,'primary'),null);
  const first=selectWeaponHandling(document,'primary');first.dispersion.MinAngle=99;
  assert.equal(selectWeaponHandling(document,'primary').dispersion.MinAngle,.05);
  assert.equal(selectWeaponHandling(document,'primary',{pose:'crouch'}).recoil.RecoilAmplitudeIncPerShot,.4);
  assert.equal(selectWeaponHandling(document,'primary',{pose:'crouch',aiming:true}).recoil.RecoilAmplitudeIncPerShot,.3);
  assert.equal(selectWeaponHandling(document,'primary',{pose:'prone'}).recoil.RecoilAmplitudeIncPerShot,2);
  assert.equal(selectWeaponHandling(document,'primary').provenance.runtimeObserved,false);
});
