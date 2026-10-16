// Reproducible narrow translation of decoded installed fields. This script never
// writes the installed game, starts it, or guesses unresolved native behavior.
import path from 'node:path';
import {root,workspace,readExports,getDocument,getObject,observation,checkReference,hashField,writeJson} from './ebx-evidence.mjs';

const documents=await readExports(),get=name=>getDocument(documents,name);
const rifle='Gameplay/Equipment/Rifles/',assault='Gameplay/Kits/MP/Assault/';
const kit=get(assault+'Kit_D_Assault_Orig_DS'),gp=get(assault+'GP_Assault');
const health=get(assault+'Affector_AssaultHealth'),regen=get(assault+'Affector_AssaultHealthRegen');
const unlock=get(rifle+'E11/U_BlasterRifle_E11'),weapon=get(rifle+'E11/W_BlasterRifle_E11');
const firing=get(rifle+'_DefaultWeapon/WeaponFiring_Default_BlasterRifle');
const projectile=get(rifle+'_DefaultWeapon/BlasterProjectile_Default_Rifle');
const heat=get(rifle+'_DefaultWeapon/OverheatConfig_Default_Rifle');
const score=get('Gameplay/GameModes/TeamDeathmatch/TeamDeathmatchStateManager');
const rootId=document=>document.asset.objects[0].$id;
const referenceChain=[
  checkReference(kit,rootId(kit),['Gameplay'],gp,rootId(gp)),
  checkReference(gp,rootId(gp),['AffectorsAppliedOnSpawn',0],health,rootId(health)),
  checkReference(gp,rootId(gp),['AffectorsAppliedOnSpawn',1],regen,rootId(regen)),
  observation(kit,rootId(kit),['WeaponTable']),
  observation(kit,'283be36e-d024-3d39-f348-2102de56dd2a',['UnlockParts',0]),
  observation(kit,'f5e806c1-635f-ca4f-6d96-f0498807a2e1',['DefaultSelectionIndex']),
  checkReference(kit,'f5e806c1-635f-ca4f-6d96-f0498807a2e1',['SelectableUnlocks',0],unlock,rootId(unlock)),
  checkReference(unlock,rootId(unlock),['NonStreamedBlueprint'],weapon,rootId(weapon)),
  checkReference(weapon,'SoldierWeaponData',['WeaponFiring'],firing,'71795a6f-6aec-4157-87bc-577447b58d46'),
  observation(firing,'WeaponFiringData',['PrimaryFire']),
  checkReference(firing,'FiringFunctionData',['Shot','ProjectileData'],projectile,'1835f15a-3cf1-4f4e-8f91-0aab72659170'),
  checkReference(weapon,'OverheatComponentData',['OverheatConfig'],heat,'3d65ad3e-d4b5-4ac4-899a-0caecfca0f85'),
];
if(referenceChain[3].value.$ref!=='283be36e-d024-3d39-f348-2102de56dd2a'||referenceChain[4].value.$ref!=='f5e806c1-635f-ca4f-6d96-f0498807a2e1'||referenceChain[5].value!==0||referenceChain[9].value.$ref!==getObject(firing,'FiringFunctionData').object.$id)throw new Error('Default E-11 reference chain changed');

const parameters={},mappings=[];
function map(parameter,document,id,fields) {
  const evidence=observation(document,id,fields);
  if(typeof evidence.value!=='number'||!Number.isFinite(evidence.value))throw new Error(`Non-numeric ${parameter}`);
  const [section,key]=parameter.split('.');(parameters[section]??={})[key]=evidence.value;
  mappings.push({parameter,...evidence});
}
map('player.health',health,rootId(health),['MaxHealth']);
map('player.regenDelay',regen,rootId(regen),['RankData',0,'RegenerationDelay']);
map('player.regenRate',regen,rootId(regen),['RankData',0,'RegenerationRate']);
map('weapon.roundsPerMinute',firing,'FiringFunctionData',['FireLogic','RateOfFire']);
for(const [field,parameter]of Object.entries({StartDamage:'damage',EndDamage:'endDamage',DamageFalloffStartDistance:'damageFalloffStart',DamageFalloffEndDistance:'damageFalloffEnd',TimeToLive:'projectileLifetime'}))map(`weapon.${parameter}`,projectile,'WSBulletEntityData',[field]);

const rawObservations=[
  observation(firing,'FiringFunctionData',['Shot','InitialSpeed']),
  observation(projectile,'WSBulletEntityData',['InitialSpeed']),
  observation(projectile,'WSBulletEntityData',['Gravity']),
  observation(projectile,'WSBulletEntityData',['InstantHit']),
  observation(firing,'FiringFunctionData',['FireLogic','FireLogicType']),
  observation(firing,'FiringFunctionData',['FireLogic','ClientFireRateMultiplier']),
  observation(firing,'FiringFunctionData',['OverHeat']),
  observation(regen,rootId(regen),['RankData',0,'MaxRegenerationAmount']),
  ...['HeatPerBullet','HeatDropPerSecond','OverheatDropDelay','OverHeatPenaltyTime','OverHeatThreshold','ExitOverheatDelay','PreventHeatDropWhileFiring','ActiveCooldownSettings'].map(field=>observation(heat,'OverheatConfig',[field])),
  observation(score,'internal:21',['DefaultValue']),
  ...[1,2].map(index=>observation(score,score.asset.objects[index].$id,['MaxKillCount'])),
  ...[0,1].map(index=>observation(score,rootId(score),['PropertyConnections',index])),
];
const provenance={
  evidenceId:'EV-GAMEPLAY-20261015-01',createdAtUtc:new Date().toISOString(),
  installedProfile:'starwarsbattlefrontii; patched head 1930263',
  evidenceType:'decoded-installed-EBX-fields-with-reference-chain',runtimeObserved:false,
  scope:'Imperial Assault default E-11 only. Decoded values do not establish all active overrides or native behavior.',
  mappings,referenceChain,
  inferences:[
    'StartDamage/EndDamage are applied with a linear distance interpolation; the two endpoints and distances are observations, interpolation is a reconstruction inference.',
    'TimeToLive is interpreted as seconds and regeneration fields as seconds/health per second; original execution has not been measured.',
    'Base SoldierHealth MaxHealth100 is superseded for this kit by its applied Assault MaxHealth150 affector.',
  ],
  unmapped:[
    {parameters:['weapon.projectileSpeed','weapon.range'],reason:'Shot.InitialSpeed.z700 conflicts with projectile InitialSpeed350; active precedence and range are not established.'},
    {parameters:['weapon.heatPerShot','weapon.coolingPerSecond','weapon.coolingDelay','weapon.overheatSeconds'],reason:'New OverheatComponent config and legacy FiringFunction.OverHeat differ. Active cooldown/state transitions and timing remain unverified; partial translation could create incorrect continuous fire.'},
    {parameters:['player.moveSpeed','player.sprintSpeed','player.crouchSpeed','player.height','player.eyeHeight','player.gravity','player.jumpHeight'],reason:'Game-defined DefaultSoldierStateMachine supplies pose/velocity/gravity controllers that differ from legacy DefaultSoldierPhysics. Active graph path and speed-channel precedence remain unresolved.'},
    {parameters:['camera.fov','camera.aimFov'],reason:'Zoom FOV55 and23.9 are decoded, but aspect/axis convention and user scaling are unresolved.'},
    {parameters:['weapon.spread','weapon.aimSpread','weapon.headMultiplier'],reason:'Weapon sway state selection, aiming spread, recoil and material/bone damage multipliers still require reconstruction.'},
    {parameters:['round.scoreLimit','round.duration','round.respawnSeconds'],reason:'StateManager Value100 is wired to both MaxKillCount fields (which store50), but higher prefab/interface overrides and round timing have not been fully evaluated.'},
    {parameters:['round.scoring'],reason:'Source counters CountSuicide/CountOOBKills=true with SuicideWeight1; current browser suicide/environment scoring is provisional and differs.'},
    {parameters:['bots.*','abilities','activeCooldown','roll','nativeAnimations','nativeAudio'],reason:'Not reconstructed by this narrow scalar translation.'},
  ],
};
const report={...provenance,parameters,rawObservations,hashEvidence:{algorithm:'EBX DJB2 XOR; FrostySdk/IO/EbxReader.cs',Value:hashField('Value'),MaxKillCount:hashField('MaxKillCount')}};
await writeJson(path.join(root,'gameplay-evidence.json'),report);
await writeJson(path.join(workspace,'web/public/assets/gameplay.json'),{parameters,provenance});
console.log(JSON.stringify({evidenceId:provenance.evidenceId,mapped:mappings.length,parameters,output:'web/public/assets/gameplay.json'}));
