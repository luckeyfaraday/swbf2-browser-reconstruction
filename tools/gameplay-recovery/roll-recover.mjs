// Scoped roll graph/ability recovery. Does not invent the native graph clock.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {root,workspace,readExports,getDocument,getObject,observation,checkReference,writeJson} from './ebx-evidence.mjs';

export const rollDirections=[
  ['front','5c9e4568-c08b-ddac-e4b5-9e6890e85149','b8296d1b-e6b2-d55b-ffd0-7db0f891e727'],
  ['left','5b98b9c7-0120-73ad-cfeb-fc566152f056','c0183139-00e8-3fba-b465-0847b0be1a53'],
  ['right','220fb0ce-1a06-21a8-3342-964e6279a922','ac9271ba-3451-c20d-1627-bb52a53f18d4'],
  ['back','29519a3c-07cf-c5a7-343f-2c1e8b74ec2b','39541cc4-52b5-183d-e0eb-a88e3c1cdc0f'],
];
export const antKey=guid=>{const [a,b,c]=guid.split('-');return c+b+a;};
const vec=v=>[v.x,v.y,v.z];

export async function recoverRoll() {
  const docs=await readExports(['core','detail','state','e11-root','roll-ability']);
  const state=getDocument(docs,'Gameplay/SoldierStateMachine/DefaultSoldierStateMachine');
  const kit=getDocument(docs,'Gameplay/Kits/MP/Assault/Kit_D_Assault_Orig_DS');
  const gp=getDocument(docs,'Gameplay/Kits/MP/Assault/GP_Assault');
  const ability=getDocument(docs,'Gameplay/Kits/MP/Assault/Ability_Assault_CombatRoll_CharacterState');
  const weapon=getDocument(docs,'Gameplay/Equipment/Rifles/E11/W_BlasterRifle_E11');
  const soldier=getDocument(docs,'Gameplay/Characters/StormTrooperShared');
  const ids=new Map(state.asset.objects.map(o=>[o.$id,o]));
  const oid=d=>d.asset.objects[0].$id, observations=[],routing=[];
  const obs=(label,d,id,fields)=>{const item={label,...observation(d,id,fields)};observations.push(item);return item.value;};
  const inside=(id,fields,target)=>{const item=observation(state,id,fields);if(item.value?.$ref!==target)throw Error(`Wrong roll route ${id}/${fields}`);getObject(state,target);routing.push(item);};
  const external=(d,id,fields,to,target)=>routing.push(checkReference(d,id,fields,to,target));
  const node='30423da0-c1ed-c026-fec0-799fe52484f6',layer='d587f7c2-b394-1fc0-bd94-ab56016c3355';
  const character='ee3e64a9-22d5-aacb-002d-af04a9f9f43b',weaponSelector='dc42d1f6-5436-d919-cfeb-9defe1c22084';
  const input='83863c45-0afa-4a9f-acf3-280e332ba46f';
  const selectedIndex=obs('characterIndex',kit,'5426ddbe-c180-4b76-84f1-67196e587b0b',['Value']);
  if(selectedIndex!==47)throw Error('Assault character slot changed');
  inside(oid(state),['RootController'],'e46d0de8-40b3-4e2c-854d-354520c173d2');
  inside('e46d0de8-40b3-4e2c-854d-354520c173d2',['Subjects',0],'fdd6ee0b-7876-fc94-97d1-2da03000952a');
  inside('fdd6ee0b-7876-fc94-97d1-2da03000952a',['Subjects',2],'4504f15e-dfe8-7932-bb71-fe142c8d3722');
  inside('4504f15e-dfe8-7932-bb71-fe142c8d3722',['Subjects',0],'21ee9f21-f6cf-aa75-6b61-ba6eb996ee2d');
  inside('21ee9f21-f6cf-aa75-6b61-ba6eb996ee2d',['Transitions',0,'Target'],node);
  obs('entryTransition',state,'21ee9f21-f6cf-aa75-6b61-ba6eb996ee2d',['Transitions',0]);
  inside(node,['Subjects',0],layer);
  inside(layer,['Subjects',0],character);
  inside(character,['IndexChannel'],'2b58cad7-fd4d-4c69-a871-5459c6eef674');
  inside(character,['Subjects',selectedIndex],weaponSelector);
  inside(weaponSelector,['IndexChannel'],'0b7b3f98-5f93-4808-b3e0-14c63f657612');
  external(soldier,'internal:19',['WeaponTypeChannel'],state,'0b7b3f98-5f93-4808-b3e0-14c63f657612');
  const weaponType=obs('E11AnimBaseSet',weapon,'SoldierWeaponData',['AnimBaseSet']);
  if(weaponType.name!=='wabsRif'||weaponType.value!==0)throw Error('E11 weapon type changed');
  inside(weaponSelector,['Subjects',weaponType.value],input);
  external(kit,oid(kit),['Gameplay'],gp,oid(gp));
  const gpAbilities=obs('gameplayAbilities',gp,oid(gp),['Abilities']);
  external(gp,gpAbilities.$ref,['DefaultAbilities',6],ability,oid(ability));

  const resolve=value=>{
    if(Array.isArray(value))return value.map(resolve);
    if(!value||typeof value!=='object')return value;
    if(value.$ref){const target=ids.get(value.$ref);return {...value,name:target?.Name??target?.__Id??null};}
    return Object.fromEntries(Object.entries(value).filter(([k])=>!['$type','__Id','__InstanceGuid'].includes(k)).map(([k,v])=>[k,resolve(v)]));
  };
  const tags=(controllerId,label)=>{
    const output=[],parent=ids.get(controllerId);
    for(const type of ['Bool','Float','Int','Vec3']) {
      const pointer=parent[`${type}ChannelController`];if(!pointer)continue;
      inside(controllerId,[`${type}ChannelController`],pointer.$ref);
      const c=ids.get(pointer.$ref);if(c.Channels.length!==c.Tracks.length)throw Error('Tag channel count mismatch');
      c.Channels.forEach((ref,index)=>{
        inside(pointer.$ref,['Channels',index],ref.$ref);
        const track=obs(`${label}.${type}.${index}`,state,pointer.$ref,['Tracks',index]);
        const channel=ids.get(ref.$ref);
        output.push({type,channelId:ref.$ref,channelName:channel.Name,defaultValue:obs(`${label}.channelDefault.${index}`,state,ref.$ref,['DefaultValue']),track:resolve(track)});
      });
    }
    return output;
  };
  const configuration={};
  for(const field of ['AdjustDirection','AngleInfluenceMultiplier','EndPositionInfluenceMultiplier','DesiredLocalTargetIfNoInputOrVelocity','ProjectedDistance','SteerAnimatableFactor','DisplaySubjectPose','DriveAcceleration','Weights','ZeroYTargetVelocityInCompensation'])configuration[field]=obs(`clipFromInput.${field}`,state,input,[field]);
  const ground='ccd666f8-f2f6-4469-9bc7-f249a7b8987d';
  inside(layer,['Subjects',1],ground);
  configuration.followGround={};
  for(const field of ['FallWithGravityDistanceFromGround','GravityWhenFalling','TargetOffset','CharacterSpringScaleFirstFrame','CharacterSpringScaleMovingOverTerrain','CharacterSpringScaleMovingUnderTerrain','CharacterSpringScaleStill'])configuration.followGround[field]=obs(`ground.${field}`,state,ground,[field]);
  const abilityConfig={};
  for(const field of ['Category','Identifier','RechargeTime','TriggerCost','RechargeOnRetriggerCountZero','RetriggerCount','ActiveTime','ActivationTime','CharacterStateDrivesActiveTime','ActivateWhenButtonIsDown','SupportsInputQueue','StopOnCharacterStateInactive','ApplyBlockPlayerAbilitiesDuringActivation','ApplyBlockPlayerAbilitiesDuringActive','BlockedPlayerAbilityIds','InputModifiers']) {
    if(getObject(ability,oid(ability)).object[field]!==undefined)abilityConfig[field]=obs(`ability.${field}`,ability,oid(ability),[field]);
  }
  abilityConfig.channelOperations=[];
  for(const field of ['RequiredForActive','SetChannelValuesOnTryActivate','SetChannelValuesOnActiveTimeFinished']) {
    const refs=obs(`ability.${field}`,ability,oid(ability),[field]);
    for(const ref of refs) {
      const value=obs(`ability.${field}.operation`,ability,ref.$ref,[]);
      const map=state.asset.objects.find(o=>o.PublicChannel?.$external===value.Channel?.$external&&o.PublicChannel?.classGuid===value.Channel?.classGuid);
      if(!map)throw Error('Unknown roll ability channel');
      obs(`ability.${field}.publicMap`,state,map.$id,['PublicChannel']);
      inside(map.$id,['Channel'],map.Channel.$ref);
      const operation={...value};delete operation.__InstanceGuid;delete operation.__Id;
      abilityConfig.channelOperations.push({phase:field,channelName:ids.get(map.Channel.$ref).Name,channelId:map.Channel.$ref,source:operation});
    }
  }
  const clips=rollDirections.map(([direction,clipId,trajectoryId],index)=>{
    inside(input,['Subjects',index],clipId);inside(input,['ChildControllerExtractedInfo',index],trajectoryId);
    const clip=ids.get(clipId),info=obs(`${direction}.clipInfo`,state,clipId,['ClipInfos',0]);
    const length=obs(`${direction}.length`,state,clipId,['Length']);
    inside(trajectoryId,['Channels',0],'a770aa26-edf0-4d80-a8cd-2a0b548f952b');
    const keys=obs(`${direction}.trajectory`,state,trajectoryId,['Tracks',0,'Keyframes']);
    if(keys.length!==length+1||keys.some((k,i)=>k.Time!==i||k.On!==true))throw Error('Unexpected trajectory clock');
    inside(clipId,['ChannelController'],clip.ChannelController.$ref);
    const overrides=obs(`${direction}.overrides`,state,clipId,['OverrideSubjects']);
    const rigVariants=overrides.map((variant,variantIndex)=>{
      inside(clipId,['OverrideSubjects',variantIndex,'Controller'],variant.Controller.$ref);
      const variantInfo=obs(`${direction}.rigVariant.${variant.EnumValue}`,state,variant.Controller.$ref,['ClipInfos',0]);
      if(variant.EnumValue===2&&variantInfo.Controller.AssetGuid!==info.Controller.AssetGuid)throw Error('AI roll no longer shares body animation');
      return {enumValue:variant.EnumValue,controllerId:variant.Controller.$ref,controllerKey:antKey(variantInfo.Controller.AssetGuid)};
    });
    return {direction,clipId,trajectoryId,controllerKey:antKey(info.Controller.AssetGuid),sourceClipInfo:info,lengthTicks:length,
      overrides,rigVariants,
      trajectory:{coordinateSpace:'source-local',unit:'source-world-unit',times:keys.map(k=>k.Time),translations:keys.map(k=>vec(k.Value.trans)),right:keys.map(k=>vec(k.Value.right)),up:keys.map(k=>vec(k.Value.up)),forward:keys.map(k=>vec(k.Value.forward))},
      channelTags:tags(clip.ChannelController.$ref,direction)};
  });
  const nodeTags=ids.get(node).ChannelControllers[0].$ref;inside(node,['ChannelControllers',0],nodeTags);
  const graph={evidenceId:'EV-ROLL-GRAPH-20261015-01',selection:{kit:kit.entry.name,weapon:weapon.entry.name,characterIndex:selectedIndex,weaponType:weaponType.value,controllerId:input},
    configuration,ability:abilityConfig,nodeTags:tags(nodeTags,'node'),transitions:resolve(obs('rollTransitions',state,node,['Transitions'])),clips,
    clock:{unit:'source-graph-tick',ticksPerSecond:null},
    limitations:[
      'Installed asset graph fields are static evidence; native execution was not observed.',
      'Character slot 47 and rifle slot 0 are source-bound. Native WeaponType channel assignment from AnimBaseSet remains an inferred bridge, supported by the named wabsRif enum and controller component wiring.',
      'No graph ticks-to-seconds conversion is established. ANT FPS and TimeScale must not silently become the graph tick rate.',
      'Root displacement curves are authored source trajectories. Native clip selection, direction adjustment, steering compensation, collision response and transition evaluation are not recreated by this data alone.',
      'Unstaggerable is a source channel name; it does not prove damage invulnerability.',
      'RechargeTime 4 and TriggerCost 0.5 are source fields. Charge-count and recharge timing formulas are not established.',
    ]};
  return {evidenceId:graph.evidenceId,evidenceType:'decoded-installed-asset-graph',runtimeObserved:false,routing,observations,graph};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const report=await recoverRoll();
  await writeJson(path.join(root,'roll-evidence.json'),report);
  await writeJson(path.join(workspace,'web/public/assets/roll-graph.json'),report.graph);
  console.log(JSON.stringify({evidenceId:report.evidenceId,routes:report.routing.length,observations:report.observations.length,clips:report.graph.clips.map(c=>({direction:c.direction,ticks:c.lengthTicks,keys:c.trajectory.times.length}))}));
}
