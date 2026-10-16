import path from 'node:path';
import {workspace,root,readExports,getDocument,getObject,observation,checkReference,writeJson} from './ebx-evidence.mjs';

const documents=await readExports();
const shared=getDocument(documents,'Gameplay/Characters/StormTrooperShared');
const collision=getDocument(documents,'Gameplay/Characters/DefaultSoldierBoneCollision');
const {object}=getObject(collision,'SkeletonCollisionData');
const selection=checkReference(shared,'BoneCollisionComponentData',['SkeletonCollisionData'],collision,object.$id);
const source=observation(collision,object.$id,['BoneCollisionData']);
const capsules=source.value.flatMap((bone,index)=>bone.ValidInHiLod&&bone.CapsuleRadius>0?[{
  bone:bone.BoneName,axis:bone.BoneAxis,length:bone.CapsuleLength,radius:bone.CapsuleRadius,
  offset:['x','y','z'].map(key=>bone.CapsuleOffset[key]),head:bone.AnimationHitReactionType.name==='HRT_Head',
  material:bone.MaterialPair.Packed,deactivateIfBehindWall:bone.DeactivateIfBehindWall,
  sourcePointer:`${source.jsonPointer}/${index}`,
}]:[]);
if(capsules.length!==11||capsules.some(c=>c.axis!==0))throw new Error('Unexpected source collision layout');
const provenance={evidenceId:'BF2-SOLDIER-CAPSULES-001',runtimeObserved:false,source:source.source,selection,
  skeleton:observation(collision,object.$id,['SkeletonAsset']),
  observations:['Eleven positive-radius high-detail capsules are explicitly selected by the shared soldier component.','Source bone names, radii, lengths, offsets, material IDs and head classification are preserved.'],
  inferences:['BoneAxis 0 is positive bone-local X; source limb child translations corroborate full capsule segment lengths, not half lengths.','CapsuleOffset is applied in character model axes. In particular Spine offset Y .24 raises the torso capsule above its pelvis-adjacent joint; native code semantics remain unverified.'],
  limitations:['High-detail capsules are used at all browser distances; native collision LOD selection is not recovered.','Wall deactivation uses a reconstructed actor-to-capsule-center visibility test.','Animation blending, crouch/aim poses and ragdolls are incomplete, so animated hit-volume parity is not established.','Packed material damage response remains unresolved; existing head multiplier remains provisional.']};
await writeJson(path.join(workspace,'web/public/assets/soldier-hitboxes.json'),{schemaVersion:1,capsules,provenance});
await writeJson(path.join(root,'hitbox-evidence.json'),{provenance,fields:source,capsules});
console.log(JSON.stringify({capsules:capsules.length,evidence:provenance.evidenceId}));
