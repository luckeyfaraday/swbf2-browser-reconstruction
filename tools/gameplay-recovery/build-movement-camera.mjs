// Installed character/weapon configuration with selected controller routing.
// This report deliberately does not overwrite the shared gameplay asset.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {root,workspace,readExports,getDocument,getObject,observation,checkReference,writeJson} from './ebx-evidence.mjs';

export async function recoverMovementCamera() {
  const documents=await readExports(['core','detail','state','e11-root']);
  const get=name=>getDocument(documents,name);
  const kit=get('Gameplay/Kits/MP/Assault/Kit_D_Assault_Orig_DS');
  const soldier=get('Gameplay/Characters/StormTrooperShared');
  const physics=get('Gameplay/Characters/DefaultSoldierPhysics');
  const state=get('Gameplay/SoldierStateMachine/DefaultSoldierStateMachine');
  const weapon=get('Gameplay/Equipment/Rifles/E11/W_BlasterRifle_E11');
  const unlock=get('Gameplay/Equipment/Rifles/E11/U_BlasterRifle_E11');
  const aim=get('Gameplay/Equipment/Shared/AimingControllers/AimingController_Default_Short_ZoomOverlay');
  const zoom0=get('Gameplay/Equipment/Shared/ZoomLevels/ZoomLevel_0_Default');
  const zoom1=get('Gameplay/Equipment/Shared/ZoomLevels/ZoomLevel_1_Default_Short_UseZoomMesh');
  const rid=d=>d.asset.objects[0].$id;
  const ids=new Map(state.asset.objects.map(o=>[o.$id,o]));
  const evidence=[],chain=[],config={};
  const observe=(label,d,id,fields)=>{const item={label,...observation(d,id,fields)};evidence.push(item);return item.value;};
  const link=(d,id,fields,to,target)=>{const item=checkReference(d,id,fields,to,target);chain.push(item);return item.value;};
  const internal=(d,id,fields,target)=>{const item=observation(d,id,fields);if(item.value?.$ref!==target)throw new Error(`Unexpected internal route ${id}/${fields.join('/')}`);getObject(d,target);chain.push(item);};
  const channelValue='5426ddbe-c180-4b76-84f1-67196e587b0b';
  const heroChannel='2b58cad7-fd4d-4c69-a871-5459c6eef674';
  const mapping='976482f8-5ed1-402b-8926-f043585f8ff0';
  const pose='63d60e9f-7ca4-48d2-9b0e-417c2ca87139';
  const drive='25223a6c-b5ae-45fa-8679-b763b77e94c3';
  const jump='68217a68-00d5-4816-82c3-097276c9bd33';
  const fall='ca081590-f220-4301-bcd9-e97b37c285e7';
  const standPose='f2ed546b-0134-4930-a353-2643fc7ad048';
  const crouchPose='0f5b9a86-0bcf-46e5-aeb2-9c4ca906672d';
  const standInfo='0ee764c3-0a32-4930-8909-cc36a41bf323';
  const crouchInfo='c9395fc2-bd1d-4212-826b-8182b9697736';
  link(kit,rid(kit),['Blueprint'],soldier,rid(soldier));
  internal(kit,rid(kit),['CharacterStateChannelValues',0],channelValue);
  const selectedIndex=observe('assaultCharacterSelectorIndex',kit,channelValue,['Value']);
  if(selectedIndex!==47)throw new Error('Unexpected Assault selector index');
  const publicChannel=observe('kitPublicCharacterChannel',kit,channelValue,['Channel']);
  const mappedPublic=observe('statePublicCharacterChannel',state,mapping,['PublicChannel']);
  if(publicChannel.$external!==mappedPublic.$external||publicChannel.classGuid!==mappedPublic.classGuid)throw new Error('Public character channel mismatch');
  internal(state,mapping,['Channel'],heroChannel);
  const publicMappings=state.asset.objects[0].PublicChannelMapping.IntChannelMappings;
  const mappingIndex=publicMappings.findIndex(o=>o?.$ref===mapping);
  if(mappingIndex<0)throw new Error('Selected public mapping is not registered');
  internal(state,rid(state),['PublicChannelMapping','IntChannelMappings',mappingIndex],mapping);
  internal(soldier,rid(soldier),['Object'],'80dd86eb-a8a4-b005-01b7-2601a46b4756');
  internal(soldier,'SoldierEntityData',['Components',0],'internal:53');
  internal(soldier,'internal:53',['Components',1],'internal:46');
  internal(soldier,'internal:46',['Components',0],'internal:19');
  if(observe('useGameDefinedStateMachine',soldier,'internal:19',['UseGameDefinedStateMachine'])!==true)throw new Error('Game-defined state machine disabled');
  link(soldier,'internal:19',['LocoAnimatable'],state,rid(state));
  link(soldier,'SoldierEntityData',['CharacterPhysics'],physics,rid(physics));
  for(const [label,selector,target] of [
    ['ground','3285acf8-63a0-9227-8dca-143668d0f516',drive],
    ['pose','6584b43d-dd05-3878-3f17-2140a519b13f',pose],
    ['jump','8aea5028-d6be-fb80-9c6f-2d482a21507f',jump],
    ['fall','d6293e11-0404-ffd2-09d3-45a308707582',fall],
  ]) {
    internal(state,selector,['IndexChannel'],heroChannel);
    internal(state,selector,['Subjects',selectedIndex],target);
    config[`${label}Controller`]={objectId:target,name:ids.get(target).Name,selectorObjectId:selector,selectedIndex};
  }
  internal(state,pose,['Poses',0],standPose);
  internal(state,pose,['Poses',1],crouchPose);
  internal(state,pose,['PoseInfos',0],standInfo);
  internal(state,pose,['PoseInfos',1],crouchInfo);
  internal(state,pose,['MaxSpeed'],'beb509cf-278e-428d-ae19-2fb8ab24453f');
  internal(state,drive,['SpeedInput'],'beb509cf-278e-428d-ae19-2fb8ab24453f');
  internal(state,pose,['LocalEyePositionChannel'],'d5df366f-0e55-4bfa-9ab5-62d4e3ab642b');
  link(soldier,'internal:19',['OldPhysicsEmulator','EyePositionChannel'],state,'d5df366f-0e55-4bfa-9ab5-62d4e3ab642b');
  link(soldier,'internal:19',['WeaponMoveSpeedMultiplier'],state,'61a5fa1a-e901-4f39-9a0a-7ad3081b3785');
  internal(state,drive,['TopSpeedModifications',0,'ModificationChannel'],'61a5fa1a-e901-4f39-9a0a-7ad3081b3785');
  config.physicalRadius=observe('physicalRadius',physics,rid(physics),['PhysicalRadius']);
  config.maxAscendAngle=observe('maxAscendAngle',physics,rid(physics),['MaxAscendAngle']);
  config.pose={};
  for(const [name,poseId,infoId] of [['stand',standPose,standInfo],['crouch',crouchPose,crouchInfo]]) {
    const entry=config.pose[name]={};
    for(const field of ['PoseType','CollisionType','Height','EyePosition','StepHeight','TransitionTimes'])entry[field]=observe(`${name}.${field}`,state,poseId,[field]);
    for(const field of ['Velocity','SprintMultiplier','SprintGain','AccelerationGain','DecelerationGain','SpeedModifier'])entry[field]=observe(`${name}.${field}`,state,infoId,[field]);
  }
  config.drive={};
  for(const field of ['Velocity','InputScaling','Gain','StopGain','SprintGain','SprintTopSpeedMultiplier','SprintStrafeInputScale','StrafeInputScaleModifications','TopSpeedModifications'])config.drive[field]=observe(`drive.${field}`,state,drive,[field]);
  config.channelDefaults={};
  for(const id of ['beb509cf-278e-428d-ae19-2fb8ab24453f','61a5fa1a-e901-4f39-9a0a-7ad3081b3785','a0fcce40-0a37-4a84-a973-2c1c24c60f4b','3fda492a-2640-4873-b781-9a6019bc4cf6','b96229ed-1191-419f-a119-87ec6ce693ab','32e25317-8b47-4298-81fa-6abc1b96249c'])config.channelDefaults[ids.get(id).Name]=observe(`channelDefault.${ids.get(id).Name}`,state,id,['DefaultValue']);
  config.jump={};for(const field of ['TargetVelocity','Weights'])config.jump[field]=observe(`jump.${field}`,state,jump,[field]);
  config.fall={};for(const field of ['Gravity','Drag','DragXZCoefficient','DragXZStartSpeed'])config.fall[field]=observe(`fall.${field}`,state,fall,[field]);

  internal(kit,rid(kit),['WeaponTable'],'283be36e-d024-3d39-f348-2102de56dd2a');
  internal(kit,'283be36e-d024-3d39-f348-2102de56dd2a',['UnlockParts',0],'f5e806c1-635f-ca4f-6d96-f0498807a2e1');
  if(observe('defaultWeaponSelection',kit,'f5e806c1-635f-ca4f-6d96-f0498807a2e1',['DefaultSelectionIndex'])!==0)throw new Error('Default weapon selection changed');
  link(kit,'f5e806c1-635f-ca4f-6d96-f0498807a2e1',['SelectableUnlocks',0],unlock,rid(unlock));
  link(unlock,rid(unlock),['NonStreamedBlueprint'],weapon,rid(weapon));
  link(weapon,'SoldierWeaponData',['AimingController'],aim,'47ce0253-0985-2356-6e06-1db5471f2135');
  link(aim,'SoldierAimingSimulationData',['ZoomLevels',0],zoom0,'27dbe243-af15-4e52-983d-713ba0f62890');
  link(aim,'SoldierAimingSimulationData',['ZoomLevels',1],zoom1,'0aaf9d35-22b2-6641-cd87-6e0da6cd8191');
  config.camera={};
  for(const [label,d,id] of [['hip',zoom0,'27dbe243-af15-4e52-983d-713ba0f62890'],['aim',zoom1,'0aaf9d35-22b2-6641-cd87-6e0da6cd8191']]) {
    const entry=config.camera[label]={};
    for(const field of ['FieldOfView','AllowFieldOfViewScaling','MoveSpeedMultiplier','LookSpeedMultiplier','LookSpeedSensitivityProfileOption'])entry[field]=observe(`${label}.${field}`,d,id,[field]);
  }
  for(const field of ['StandPose','CrouchPose','FovTransitionTime','ZoomTransitionTime','UpdateCameraFOV','Force1pOnZoom'])config.camera[field]=observe(`camera.${field}`,aim,'SoldierAimingSimulationData',[field]);
  config.camera.authoritativeEyePosition=observe('authoritativeEyePosition',soldier,'SoldierCameraComponentData',['AuthoritativeEyePosition']);

  // Traverse only hierarchy and state-transition edges. AllControllerDatas is an
  // inventory, so its membership cannot be used as proof of an execution route.
  const edges=new Map();
  for(const object of state.asset.objects) {
    const result=[];
    for(const [index,subject] of (object.Subjects??[]).entries())if(subject?.$ref&&(object.IndexChannel?.$ref!==heroChannel||index===selectedIndex))result.push({fields:['Subjects',index],target:subject.$ref});
    function transitionEdges(conditions,parts) {
      for(const [index,condition] of conditions.entries()) {
        if(condition.Target?.$ref)result.push({fields:[...parts,index,'Target'],target:condition.Target.$ref,condition:condition});
        transitionEdges(condition.ChildConditions??[],[...parts,index,'ChildConditions']);
      }
    }
    transitionEdges(object.Transitions??[],['Transitions']);edges.set(object.$id,result);
  }
  const treeRoot=state.asset.objects[0].RootController.$ref,previous=new Map([[treeRoot,null]]),queue=[treeRoot];
  for(let i=0;i<queue.length;i++)for(const edge of edges.get(queue[i])??[])if(!previous.has(edge.target)){previous.set(edge.target,{from:queue[i],...edge});queue.push(edge.target);}
  const reachability=[];
  for(const target of [drive,pose,jump,fall]) {
    if(!previous.has(target))throw new Error(`No hierarchy/transition route to ${target}`);
    let id=target;const route=[];
    while(previous.get(id)){const edge=previous.get(id);route.push({name:ids.get(edge.from).Name,...observation(state,edge.from,edge.fields)});id=edge.from;}
    reachability.push({target,name:ids.get(target).Name,route:route.reverse(),limitation:'Structural path includes conditional branches; it does not prove all runtime guards or controller evaluation order.'});
  }
  const parameters={player:{radius:config.physicalRadius,height:config.pose.stand.Height,eyeHeight:config.pose.stand.EyePosition.y,crouchEyeHeight:config.pose.crouch.EyePosition.y,stepHeight:config.pose.stand.StepHeight,gravity:-config.fall.Gravity,jumpVelocity:config.jump.TargetVelocity.y,aimMoveMultiplier:config.camera.aim.MoveSpeedMultiplier},camera:{aimLookMultiplier:config.camera.aim.LookSpeedMultiplier}};
  const mappings=[
    ['player.radius',physics,rid(physics),['PhysicalRadius']],
    ['player.height',state,standPose,['Height']],
    ['player.eyeHeight',state,standPose,['EyePosition','y']],
    ['player.crouchEyeHeight',state,crouchPose,['EyePosition','y']],
    ['player.stepHeight',state,standPose,['StepHeight']],
    ['player.gravity',state,fall,['Gravity'],'negate'],
    ['player.jumpVelocity',state,jump,['TargetVelocity','y']],
    ['player.aimMoveMultiplier',zoom1,'0aaf9d35-22b2-6641-cd87-6e0da6cd8191',['MoveSpeedMultiplier']],
    ['camera.aimLookMultiplier',zoom1,'0aaf9d35-22b2-6641-cd87-6e0da6cd8191',['LookSpeedMultiplier']],
  ].map(([parameter,d,id,fields,conversion='identity'])=>{
    const source=observation(d,id,fields);
    return {parameter,...source,sourceValue:source.value,value:conversion==='negate'?-source.value:source.value,conversion};
  });
  return {
    evidenceId:'EV-MOVEMENT-CAMERA-20261015-01',installedProfile:'starwarsbattlefrontii; patched head 1930263',runtimeObserved:false,
    scope:'Imperial Assault original-era kit with its selected E-11 aiming controller. Source-backed configuration; native execution and dynamic overrides remain unmeasured.',
    selection:{kit:{name:kit.entry.name,guid:kit.entry.guid},weapon:{name:weapon.entry.name,guid:weapon.entry.guid},characterSelectorIndex:selectedIndex},
    parameters,configuration:config,mappings,referenceChain:chain,observations:evidence,structuralReachability:reachability,
    integrationNotes:[
      'parameters is a conservative integration subset. jumpVelocity, aimMoveMultiplier and aimLookMultiplier require explicit browser/controller handling; current rules resolver ignores unknown keys.',
      'Apply aimMoveMultiplier to selected movement speed. Scaling both raw digital axes before PlayerController clamps vector length produces unequal forward/diagonal slowdowns.',
      'Use jumpVelocity directly for the upward launch impulse. Converting to jumpHeight = v^2/(2g) produces 0.625 only for the browser constant-gravity model and omits source drag.',
      'EyePosition has nonzero x=-0.1 and z=0.077. The scalar eye-height subset intentionally does not claim the original complete camera transform.',
    ],
    inferences:[
      'Source length/velocity/gravity fields are interpreted in world metres, metres per second and metres per second squared, consistent with the retained map transform scale. Native timing has not been measured.',
      'The positive browser gravity magnitude is the sign conversion of selected source Gravity=-20.',
      'Mapping source physical radius and pose heights into the browser capsule is a geometry approximation: the selected native pose collision type is Pencil, not Capsule.',
    ],
    unresolved:[
      {parameters:['player.moveSpeed','player.sprintSpeed','player.crouchSpeed'],reason:'The selected pose controller writes MaxSpeed from standing Velocity3.8/crouching2.3; the selected Assault drive reads that channel but also stores Velocity5. Native SpeedInput/Velocity precedence and controller evaluation order are not decompiled. If SpeedInput replaces the fallback, expected full-forward speeds are3.8/6.46/2.3; those final speeds remain inference.'},
      {parameters:['player.groundAcceleration','player.airAcceleration','movement.drag'],reason:'Gain0.3, StopGain0.4, SprintGain0.25 and Fall.Drag0.1 are observed. Their native discretization and formulas are unknown; do not map Gain into metres/second squared or reuse it as a browser exponential coefficient without evidence.'},
      {parameters:['player.crouchHeight','collision'],reason:'Native crouch pose Height remains1.8 and uses Pencil collision; browser crouch capsule reduction is a reconstruction choice. Eye height1.15 is independently selected.'},
      {parameters:['camera.fov','camera.aimFov','camera.pitchLimits','camera.distance'],reason:'Selected FOV55/23.9, stand/crouch pitch85/-70 and zoom transition0.2 are observed. FOV axis/aspect/user scaling, pitch sign convention, interpolation and third-person transform layers remain unresolved.'},
      {parameters:['camera.aimLookMultiplier'],reason:'The selected factor0.2738 is observed, but the linked user ZoomedSensitivity profile option multiplies or otherwise changes native sensitivity. Applying the factor alone models the default factor, not all user settings.'},
      {parameters:['jump','roll','sprintGuards'],reason:'Structural routing identifies jump/fall controllers, but jump state duration, accumulated drag, sprint guards, roll curves, animation warping and whole-graph runtime ordering are not reconstructed.'},
    ],
  };
}

export function movementCameraRuntimeDocument(report) {
  return {
    selection:report.selection,parameters:report.parameters,configuration:report.configuration,
    provenance:{evidenceId:report.evidenceId,evidenceFile:'tools/gameplay-recovery/movement-camera-evidence.json',
      evidenceType:'decoded-installed-EBX-configuration-with-selected-controller-routing',runtimeObserved:false,
      scope:report.scope,mappings:report.mappings,integrationNotes:report.integrationNotes,inferences:report.inferences,unresolved:report.unresolved},
  };
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const report=await recoverMovementCamera();
  await writeJson(path.join(root,'movement-camera-evidence.json'),report);
  await writeJson(path.join(workspace,'web/public/assets/movement-camera.json'),movementCameraRuntimeDocument(report));
  console.log(JSON.stringify({evidenceId:report.evidenceId,observations:report.observations.length,links:report.referenceChain.length,parameters:report.parameters,output:'tools/gameplay-recovery/movement-camera-evidence.json'}));
}
