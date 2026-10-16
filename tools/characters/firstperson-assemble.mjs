import fs from 'node:fs';
import path from 'node:path';
import { Matrix4, Quaternion, Vector3 } from '../../web/node_modules/three/build/three.module.js';
import { mergeCharacter } from './merge-character.mjs';

// Preserve separate source inverse bind matrices. Attach the weapon's Wep_Root
// to the same parent as the first-person human Wep_Root, then apply the exact
// shared ANT channels. No hand-authored grip or wrist transform is introduced.
const [weapon='E11'] = process.argv.slice(2);
if (!['E11', 'A280'].includes(weapon)) throw Error('Selected source weapon required');
const folder='web/public/assets/firstperson';
const target=path.join(folder, `firstperson-${weapon.toLowerCase()}.glb`);
const arms=weapon==='E11' ? ['firstperson-imperial-arms'] : ['firstperson-rebel-arms', 'firstperson-rebel-hands'];
const gun=weapon==='E11' ? 'web/public/assets/characters/e11.glb' : `${folder}/meshes/firstperson-a280.glb`;
mergeCharacter(target, [...arms.map(name=>`${folder}/meshes/${name}.glb`), gun]);
const bytes=fs.readFileSync(target), size=bytes.readUInt32LE(12);
const doc=JSON.parse(bytes.subarray(20,20+size));
const original=bytes.subarray(28+size,28+size+bytes.readUInt32LE(20+size));
const source=JSON.parse(fs.readFileSync('exports/firstperson-animation/poses.json'));
const clips=source.clips.filter(c=>c.name.includes(`_${weapon}_`));
const bones=new Map();
doc.nodes.forEach((n,i)=>{if(n.extras?.sourceBoneIndex!==undefined){if(!bones.has(n.name))bones.set(n.name,[]);bones.get(n.name).push(i);}});
const parentOf=id=>doc.nodes.findIndex(n=>n.children?.includes(id));
const weaponRoot=bones.get('Wep_Root').at(-1), humanRoot=bones.get('Wep_Root')[0];
const oldParent=parentOf(weaponRoot), sourceParent=parentOf(humanRoot);
if(doc.nodes[sourceParent].name!=='SpineX' || doc.nodes[oldParent].name!=='AITrajectory')throw Error('Unexpected source root hierarchy');
doc.nodes[oldParent].children=doc.nodes[oldParent].children.filter(i=>i!==weaponRoot);
doc.nodes[sourceParent].children.push(weaponRoot);
const report={evidenceId:'BF2-FIRSTPERSON-POSE-001',weapon,output:target,sourceRig:source.sourceRig,sourceBankSha256:source.sourceSha256,
  weaponAttachment:{weaponRoot,parentName:doc.nodes[sourceParent].name,firstpersonHumanRoot:humanRoot,
  basis:'Observed human first-person skeleton Wep_Root parent and matching source ANT DOFs; cross-mesh attachment is inferred from this exact shared hierarchy.'},clips:[]};
const blocks=[original];let byteLength=original.length;
function accessor(values,dim){
 const pad=(4-byteLength%4)%4;if(pad){blocks.push(Buffer.alloc(pad));byteLength+=pad;}
 const data=Buffer.from(new Float32Array(values).buffer),view=doc.bufferViews.length;
 doc.bufferViews.push({buffer:0,byteOffset:byteLength,byteLength:data.length});blocks.push(data);byteLength+=data.length;
 const index=doc.accessors.length;doc.accessors.push({bufferView:view,componentType:5126,count:values.length/dim,type:dim===1?'SCALAR':`VEC${dim}`,...(dim===1?{min:[Math.min(...values)],max:[Math.max(...values)]}:{})});return index;
}
doc.animations=[];
for(const [clipIndex,clip] of clips.entries()){
 const animation={name:clip.name.endsWith('_IdlePose')?'idle':'sprint',samplers:[],channels:[],extras:{sourceName:clip.sourceName,sourceKey:clip.sourceAnimationKey,sourceKind:'FrameAnimationAsset',constantSourcePose:true}};
 const retained=new Map(),skipped=[],duplicates=[];
 for(const track of clip.tracks){
  const key=`${track.bone}.${track.property}`;
  if(track.property==='scalar'||!bones.has(track.bone)){skipped.push(key);continue;}
  if(retained.has(key)){
   if(retained.get(key).values[0].some((v,i)=>Math.abs(v-track.values[0][i])>1e-6))throw Error(`Conflicting DOF ${key}`);
   duplicates.push(key);continue;
  }
  retained.set(key,track);
 }
 for(const track of retained.values()){
  const value=track.values[0],sampler=animation.samplers.length;
  animation.samplers.push({input:accessor([0,1],1),output:accessor([...value,...value],value.length),interpolation:'STEP'});
  for(const node of bones.get(track.bone)){
   animation.channels.push({sampler,target:{node,path:track.property}});
   if(clipIndex===0)doc.nodes[node][track.property]=value.slice();
  }
 }
 doc.animations.push(animation);
 report.clips.push({name:animation.name,sourceName:clip.sourceName,channels:animation.channels.length,matchedNamedTracks:retained.size,skipped,duplicates});
}
function world(id){
 const n=doc.nodes[id],local=n.matrix?new Matrix4().fromArray(n.matrix):new Matrix4().compose(new Vector3().fromArray(n.translation??[0,0,0]),new Quaternion().fromArray(n.rotation??[0,0,0,1]),new Vector3().fromArray(n.scale??[1,1,1]));
 const parent=parentOf(id);return parent<0?local:world(parent).multiply(local);
}
const camera=world(bones.get('CameraJoint')[0]);
const conversion=new Matrix4().makeRotationY(Math.PI).multiply(camera.clone().invert());
const sourceNodes=doc.scenes[0].nodes.slice(),root=doc.nodes.length;
const meshRoots=sourceNodes.filter(i=>doc.nodes[i].mesh!==undefined);
doc.nodes.push({name:'SourceFirstPersonCameraToThreeCamera',matrix:conversion.toArray(),children:sourceNodes.filter(i=>doc.nodes[i].mesh===undefined),
 extras:{basis:'Inverse recovered idle CameraJoint transform followed by +Z-source to -Z-glTF camera rotation; native camera evaluation not observed.'}});
// Skin matrices carry the camera conversion. Keep skinned mesh nodes at scene
// root as glTF requires; their parent transforms do not drive skinning.
doc.scenes[0].nodes=[...meshRoots,root];
// Reparenting Wep_Root puts the weapon joints under the common assembled root;
// glTF's declared skeleton root must contain every joint of this skin.
doc.skins.at(-1).skeleton=root;
report.camera={sourceIdleMatrix:camera.toArray(),sourceToThreeCamera:conversion.toArray(),basis:'Observed CameraBase and CameraJoint frame pose with source rig hierarchy. +Z forward conversion is a renderer convention inference.'};
report.idleCameraSpaceBones={};
for(const name of ['LeftHand','RightHand','Wep_Root','Wep_Muzzle']){
 const ids=bones.get(name);report.idleCameraSpaceBones[name]=ids.map(id=>({node:id,position:new Vector3().setFromMatrixPosition(world(id)).toArray()}));
}
doc.extras={...doc.extras,animationsRecovered:['idle','sprint'],firstpersonEvidence:source.evidenceId,assembly:report,
 limitations:['Original first-person meshes, skin and single-frame poses; moving firing/deploy/zoom clips and native blend/procedural graph remain unresolved.',
 'Weapon root attached using matching source Wep_Root DOFs and first-person parent hierarchy. Exact native mesh-binding execution not observed.',
 'Camera placement uses inverse source idle CameraJoint. DefaultFirstPersonCamera offset exists separately; its native composition is unresolved.',
 'Source shader conversion is partial PBR. Top four skin weights retained; complete eight influences preserved in extraction evidence.']};
const pad=(4-byteLength%4)%4;if(pad){blocks.push(Buffer.alloc(pad));byteLength+=pad;}
doc.buffers[0].byteLength=byteLength;
const raw=Buffer.from(JSON.stringify(doc)),json=Buffer.alloc((raw.length+3)&~3,32);raw.copy(json);
const head=Buffer.alloc(20);head.writeUInt32LE(0x46546c67);head.writeUInt32LE(2,4);head.writeUInt32LE(28+json.length+byteLength,8);head.writeUInt32LE(json.length,12);head.writeUInt32LE(0x4e4f534a,16);
const bh=Buffer.alloc(8);bh.writeUInt32LE(byteLength);bh.writeUInt32LE(0x004e4942,4);
fs.writeFileSync(target,Buffer.concat([head,json,bh,...blocks]));
fs.writeFileSync(`exports/firstperson-animation/${weapon.toLowerCase()}-assembly.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
