import * as THREE from 'three';
import {createSourceLightChannels} from './source-light-channels.js';
import {createSourceDirectAdapter} from './source-direct-adapter.js';
import {prepareSourcePunctualLights} from './source-direct-light-config.js';
import {sourceSpotShadow} from './source-shadow-atlas.js';

const TYPES=/Pbr(Sphere|Spot|Rectangular)LightEntityData$/;
const vector=value=>[value?.x??1,value?.y??1,value?.z??1];
export const SOURCE_LIGHT_ASSUMPTIONS=Object.freeze({
  colorScale:1/32,
  note:'Source XYZ and RGB ratios are retained. Source RGB is treated as linear with provisional scale1/32. This is uncalibrated against native rendering.',
  units:'LuminousPower is converted from lumens to Three intensity (sphere4pi, spotpi); other units retain their scalar pending verification.',
  cone:'OuterAngle is interpreted as a full cone in degrees; Three uses a half cone. The direction is negative transformed Z. Both conventions remain inferred.',
  limitations:['Rectangular source lights use point approximations; shape, texture projection and IES profiles are not reconstructed.','Source diffuse/specular switches gate Three direct-light terms; native BRDF remains different.','A low provisional hemisphere fill substitutes for missing baked indirect lighting.','Dynamic source shadows, volumetrics and native exposure adaptation are pending.'],
});

export function convertSourceLights(document,{colorScale=SOURCE_LIGHT_ASSUMPTIONS.colorScale}={}) {
  const candidates=Array.isArray(document)?document:document?.lights??document?.lightCandidates??document?.descriptors??[];
  const skipped={},lights=[];
  const skip=reason=>skipped[reason]=(skipped[reason]??0)+1;
  for(const source of candidates) {
    const p=source.properties??{},type=TYPES.exec(p.$type??'');
    if(!type){skip('transient-or-unsupported-type');continue;}
    if(p.Enabled===false){skip('disabled');continue;}
    if(p.AffectDiffuse===false&&p.AffectSpecular===false){skip('no-direct-contribution');continue;}
    if(!Array.isArray(source.matrix)||source.matrix.length!==16||!source.matrix.every(Number.isFinite)){skip('invalid-transform');continue;}
    const spot=type[1]==='Spot',position=source.matrix.slice(12,15),direction=new THREE.Vector3(-source.matrix[8],-source.matrix[9],-source.matrix[10]).normalize();
    const power=(p.Intensity??0)*(p.Dimmer??1),luminousPower=p.LightUnit?.name==='LightUnitType_LuminousPower';
    if(!(power>0)){skip('zero-intensity');continue;}
    const outer=THREE.MathUtils.degToRad(Math.min(178,Math.max(1,p.OuterAngle??60))*.5);
    lights.push({
      id:`${source.fileGuid}/${source.classGuid}/${source.route}`,type:spot?'spot':'point',position,
      color:vector(p.Color).map(channel=>channel*colorScale),
      intensity:luminousPower?power/(spot?Math.PI:4*Math.PI):power,
      affectDiffuse:p.AffectDiffuse!==false,affectSpecular:p.AffectSpecular!==false,
      range:Math.max(0,p.AttenuationRadius??0),target:position.map((v,index)=>v+direction.toArray()[index]),
      angle:outer,penumbra:1-Math.min(1,Math.max(0,(p.InnerAngle??0)/(p.OuterAngle||60))),
      source:{asset:source.asset,fileGuid:source.fileGuid,classGuid:source.classGuid,route:source.route,type:p.$type},
      approximation:type[1]==='Rectangular'?'rectangular-as-point':null,
      // Native local shadow parameters for eligible punctual spots (BF2-NATIVE-LOCAL-SHADOW-PRODUCER-001).
      shadow:spot?sourceSpotShadow(p,source.matrix):null,
    });
  }
  return {lights,provenance:{kind:'source-lights-with-explicit-renderer-mapping',candidateCount:candidates.length,convertedCount:lights.length,skipped,assumptions:{...SOURCE_LIGHT_ASSUMPTIONS,colorScale,note:colorScale===1?'Original linear source RGB retained without arbitrary gain; exposure is applied by the camera. Native photometric mapping remains unverified.':SOURCE_LIGHT_ASSUMPTIONS.note},source:document?.provenance??document?.evidence??null}};
}

export function selectNearbyLights(descriptors,position,limit,previous=new Set()) {
  const p=Array.isArray(position)?position:position.toArray();
  return descriptors.map((light,index)=>{
    const distance=Math.hypot(...light.position.map((v,axis)=>v-p[axis]));
    // Include a visible room's nearby lights before the player enters their
    // attenuation radius. Stable hysteresis avoids swapping at a tied boundary.
    const relevant=distance<(light.range||30)+18;
    return {light,index,relevant,score:distance*(previous.has(light.id)? .85:1)};
  }).filter(item=>item.relevant).sort((a,b)=>a.score-b.score||a.index-b.index).slice(0,limit).map(item=>item.light);
}

export function createLighting(scene,manifest,sourceDocument=null,{pointBudget=8,spotBudget=6,indirectProbes=false,sourceIes=null,nativeShadows=null}={}) {
  const converted=sourceDocument?convertSourceLights(sourceDocument,{colorScale:indirectProbes?1:SOURCE_LIGHT_ASSUMPTIONS.colorScale}):null;
  const punctual=sourceIes&&converted?prepareSourcePunctualLights(sourceDocument,sourceIes.document):null;
  if(punctual) {
    const nativeById=new Map(punctual.lights.map(record=>[record.id,record]));
    for(const light of converted.lights) {
      const record=nativeById.get(light.id);if(!record)continue;
      light.nativeDirect=record;light.color=record.color;light.intensity=1;
      if(light.type==='spot')light.angle=THREE.MathUtils.degToRad(record.cone.outerDegrees*.5);
    }
    converted.provenance.nativePunctual={count:punctual.lights.length,ies:punctual.lights.filter(record=>record.ies).length,
      excluded:punctual.excluded.reduce((counts,row)=>(counts[row.reason]=(counts[row.reason]??0)+1,counts),{}),policy:punctual.policy};
  }
  if(indirectProbes&&converted){
    converted.provenance.assumptions.limitations=['Unproved source descriptors retain Three lighting; rectangular lights use point approximations and shadow-enabled lights remain unshadowed.',
      'Original baked probes and independently bound static charts supply indirect lighting. Material adapters report their recovered DFG and reflection scope separately.',
      'Native light selection, shadows, volumetrics and local reflection blending remain incomplete. Exposure provenance is reported by the HDR pipeline.'];
  }
  if(punctual&&converted){
    Object.assign(converted.provenance.assumptions,{
      colorScale:'Native producer color for independently proven punctual lights; fallback scale '+(indirectProbes?1:SOURCE_LIGHT_ASSUMPTIONS.colorScale),
      note:'Proven punctual lights use native photometric color and original IES data. Other descriptors retain the explicit Three fallback mapping.',
      units:'Native source luminous-power and IES conversion for the proven subset; fallback sphere4pi/spotpi mapping otherwise.',
      cone:'Native cosine ramp and source basis for proven punctual lights; inferred Three cone mapping otherwise.',
    });
  }
  const descriptors=manifest.lights?.length?manifest.lights:converted?.lights??[];
  const owned=[],pools=[],lastPosition=new THREE.Vector3(Infinity,Infinity,Infinity);
  let selected=[],updates=0;
  const add=object=>{scene.add(object);owned.push(object);return object;};
  const color=value=>Array.isArray(value)?new THREE.Color(...value):new THREE.Color(value??0xffffff);
  const globals=descriptors.filter(light=>['ambient','hemisphere','directional'].includes(light.type));
  const locals=descriptors.filter(light=>['point','spot'].includes(light.type??'point'));
  for(const descriptor of globals) {
    let light;
    if(descriptor.type==='ambient')light=new THREE.AmbientLight(color(descriptor.color),descriptor.intensity??1);
    else if(descriptor.type==='hemisphere')light=new THREE.HemisphereLight(color(descriptor.color),color(descriptor.groundColor??0x333333),descriptor.intensity??1);
    else light=new THREE.DirectionalLight(color(descriptor.color),descriptor.intensity??2);
    if(descriptor.position)light.position.fromArray(descriptor.position);
    if(light.target&&descriptor.target){light.target.position.fromArray(descriptor.target);add(light.target);}
    add(light);
  }
  if(!descriptors.length) {
    add(new THREE.HemisphereLight(0xbad9ff,0x424044,1.8));
    const sun=add(new THREE.DirectionalLight(0xffefdc,2.5));sun.position.set(30,60,20);
  } else if(converted&&!globals.length&&!indirectProbes) add(new THREE.HemisphereLight(0xc4d4e4,0x424044,.2));
  for(const [type,budget]of [['point',pointBudget],['spot',spotBudget]]) {
    const candidates=locals.filter(light=>(light.type??'point')===type).map((light,index)=>({...light,id:light.id??`${type}:${index}`}));
    const slots=Array.from({length:Math.min(budget,candidates.length)},()=>{
      const light=type==='spot'?new THREE.SpotLight(0xffffff,0):new THREE.PointLight(0xffffff,0);
      light.decay=2;add(light);if(light.target)add(light.target);
      return light;
    });
    pools.push({type,candidates,slots,selected:new Set(),current:[]});
  }
  const provenance=manifest.lights?.length?{kind:'manifest-lights'}:converted?.provenance??{kind:'provisional-fallback-lighting'};
  const pointCount=pools.find(pool=>pool.type==='point').slots.length,spotCount=pools.find(pool=>pool.type==='spot').slots.length;
  const nativeDirect=sourceIes?createSourceDirectAdapter(sourceIes,pointCount,spotCount):null;
  const channels=createSourceLightChannels(pointCount,spotCount,{nativeDirect,nativeShadows});
  return {
    provenance,
    decorate:root=>channels.decorate(root),
    // Current descriptor per spot pool slot; slot order equals Three's spot uniform order.
    spotSlots:()=>{const pool=pools.find(row=>row.type==='spot');return pool.slots.map((_,index)=>pool.current[index]??null);},
    update(position,force=false) {
      if(!force&&lastPosition.distanceToSquared(position)<1)return;
      lastPosition.copy(position);updates++;selected=[];
      for(const pool of pools) {
        const chosen=selectNearbyLights(pool.candidates,position,pool.slots.length,pool.selected);
        pool.selected=new Set(chosen.map(light=>light.id));pool.current=chosen;selected.push(...chosen);
        pool.slots.forEach((light,index)=>{
          const descriptor=chosen[index];
          channels.set(pool.type,index,descriptor);
          // Keep a constant light count in shaders; dormant slots use intensity0.
          if(!descriptor){light.intensity=0;return;}
          light.color.copy(color(descriptor.color));light.intensity=descriptor.intensity??20;
          light.distance=descriptor.range??20;light.position.fromArray(descriptor.position);
          if(light.isSpotLight){light.angle=descriptor.angle??Math.PI/4;light.penumbra=descriptor.penumbra??.2;light.target.position.fromArray(descriptor.target??[descriptor.position[0],descriptor.position[1]-1,descriptor.position[2]]);}
        });
      }
    },
    snapshot:()=>({provenance,candidates:locals.length,active:selected.length,updates,channels:channels.snapshot(),nativeDirect:nativeDirect?.snapshot()??null,shadows:nativeShadows?.snapshot()??null,selected:selected.map(light=>({id:light.id,type:light.type,position:light.position,intensity:light.intensity,affectDiffuse:light.affectDiffuse,affectSpecular:light.affectSpecular,source:light.source,nativePunctual:!!light.nativeDirect,ies:!!light.nativeDirect?.ies})),budgets:{point:pointBudget,spot:spotBudget}}),
    dispose(){for(const object of owned){scene.remove(object);object.dispose?.();}sourceIes?.dispose();},
  };
}
