import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import {trimUnusedBones,clipForModel,compactSkinnedSkeletons,retargetClipToCopies} from './skeleton-trim.js';
import {sampleMotion} from './hero-combat.js';
import { CollisionWorld, CompositeCollision } from '../vendor/vibe-engine/kits/fps/collision-world.js';
import { resolveGameplay } from './rules.js';
import { createStaticBatches } from './static-batches.js';
import { prepareRecoveredFloorMaterials } from './floor-material.js';
import {prepareRecoveredMasterMaterials} from './master1uv-material.js';
import {prepareRecoveredMaster2UvMaterials} from './master2uv-material.js';
import {prepareRecoveredCeilingMaterials} from './ceiling-material.js';
import {prepareRecoveredMetalOnlyMaterials} from './metalonly-material.js';
import {prepareRecoveredCatwalk2Materials} from './catwalk2-material.js';
import {prepareRecoveredCatwalk1Materials} from './catwalk1-material.js';
import {prepareRecoveredVolcanicObjectMaterials} from './volcanic-object-material.js';
import {prepareRecoveredPropsNonmetalMaterials} from './propsnonmetal-material.js';
import {prepareRecoveredExteriorNoScaleMaterials} from './exterior-noscale-material.js';
import {prepareRecoveredArray2UvMaterials} from './array2uv-material.js';
import {prepareRecoveredArray1UvMaterials} from './array1uv-material.js';
import {prepareRecoveredPropsPresetMaterials} from './propspreset-material.js';
import {prepareRecoveredMaster1UvEmissiveMaterials} from './master1uv-emissive-material.js';
import {prepareRecoveredMaster1UvEmissiveNonmetalMaterials} from './master1uv-emissive-nonmetal-material.js';
import {prepareRecoveredCorvetteDamageMaterials} from './corvette-damage-material.js';
import {prepareSourceLods} from './source-lods.js';
import {prepareSourceDfg} from './source-dfg.js';
import {prepareSourceStaticAtlas} from './source-static-atlas-adapter.js';
import {prepareSourceTangentWitness} from './source-tangent-frame.js';
import { createSoldierHitboxes } from './hitboxes.js';
import { createSourceProbeLighting } from './source-probes.js';
import {createRollAnimationClip} from './roll-clip-adapter.js';
import {ROLL_POLICY} from './roll.js';
import {nativeSpreadProvenance} from './weapon-handling.js';
import {resolveProjectileLaunch} from './projectile-launch.js';
import {prepareSourceDoors} from './source-doors.js';
import {CAMERA_RECOIL_RUNTIME_POLICY} from './camera-recoil.js';
import {loadPreparedMapCollision} from './prepared-collision.js';
import {prepareRifleTrails} from './rifle-trails.js';

const finiteVector = (v, length) => Array.isArray(v) && v.length === length && v.every(Number.isFinite);

export function validateManifest(manifest) {
  if (!manifest?.metadata?.mapId || !manifest.metadata.name || !manifest.metadata.source) throw new Error('Map metadata requires mapId, name, and source provenance.');
  if (manifest.metadata.units !== 'meters' || manifest.metadata.up !== 'Y') throw new Error('Map must be converted to meters with Y up.');
  if (!Array.isArray(manifest.assets) || !manifest.assets.length) throw new Error('No extracted map assets are available yet.');
  if (!Array.isArray(manifest.instances) || !manifest.instances.length) throw new Error('Map instance placements are unavailable.');
  const ids = new Set();
  for (const asset of manifest.assets) {
    if (!asset.id || ids.has(asset.id) || typeof asset.url !== 'string') throw new Error('Map contains an invalid or duplicate asset ID.');
    ids.add(asset.id);
  }
  for (const instance of manifest.instances) if (!ids.has(instance.assetId) || !finiteVector(instance.matrix, 16)) throw new Error(`Invalid transform or asset reference: ${instance.assetId}`);
  if (!manifest.spawns?.length || manifest.spawns.some(s => !finiteVector(s.position,3) || ![0,1].includes(s.team) || !Number.isFinite(s.yaw ?? 0))) throw new Error('At least one valid, source-positioned spawn is required.');
  if (!finiteVector(manifest.bounds?.min,3) || !finiteVector(manifest.bounds?.max,3) || manifest.bounds.min.some((v,i) => v >= manifest.bounds.max[i])) throw new Error('Map bounds are invalid.');
  if (!manifest.assets.some(a => a.collision)) throw new Error('Map has no collision geometry.');
  return manifest;
}

async function json(url, optional = false) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (optional && response.status === 404) return null;
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('json')) {
    if (optional && type.includes('text/html')) return null;
    throw new Error(`${url} is unavailable; extracted JSON is required.`);
  }
  return response.json();
}

function assetUrl(path, base) { return new URL(path, new URL(base, location.href)).href; }

async function pool(items, concurrency, task) {
  let index = 0;
  await Promise.all(Array.from({length:Math.min(concurrency, items.length)},async () => {
    while (index < items.length) { const item = items[index++]; await task(item); }
  }));
}

export async function loadAssets(onProgress, options = {}) {
  const loadTimings=[];let stageStarted=performance.now();
  const timed=stage=>{const now=performance.now();loadTimings.push({stage,milliseconds:Math.round(now-stageStarted)});stageStarted=now;};
  const url = options.manifestUrl ?? '/assets/map.scene.json';
  const batchCellSize=options.batchCellSize??48;
  if(!Number.isFinite(batchCellSize)||batchCellSize<8||batchCellSize>128)throw new Error('Invalid static batching cell size');
  onProgress({ fraction: 0, message: 'Reading map manifest' });
  const manifest = validateManifest(await json(url));
  const [gameplayDoc, charactersDoc, sourceLights, collisionOverrides, audioDocument, floorDocument] = await Promise.all([json('/assets/gameplay.json',true),json('/assets/characters.json',true),json('/assets/source-lights.json',true),json('/assets/collision-overrides.json',true),json('/assets/audio.json',true),json('/assets/recovered-floor-materials.json',true)]);
  const gameplay = resolveGameplay(gameplayDoc ?? {});
  if(manifest.metadata.mapId==='DeathStar02_01/TeamDeathmatch') {
    const roundDocument=await json('/assets/round-rules.json');
    if(roundDocument.runtimeOverrides?.scoreLimit!==100)throw new Error('Selected source Blast score limit is unavailable');
    gameplay.parameters.round.scoreLimit=roundDocument.runtimeOverrides.scoreLimit;
    gameplay.provenance.provisional=gameplay.provenance.provisional.filter(key=>key!=='round.scoreLimit');
    if(!gameplay.provenance.sourceDerived.includes('round.scoreLimit'))gameplay.provenance.sourceDerived.push('round.scoreLimit');
    gameplay.provenance.round=roundDocument.provenance;
  }
  const hitboxDocument=charactersDoc?.characters?.length?await json('/assets/soldier-hitboxes.json',true):null;
  const heatDocument=charactersDoc?.weapons?.some(weapon=>weapon.name==='E-11')?await json('/assets/weapon-heat.json',true):null;
  if(heatDocument?.config){gameplay.parameters.weapon.sourceHeat=heatDocument.config;gameplay.provenance.heat=heatDocument.provenance;}
  const movementDocument=charactersDoc?.characters?.length?await json('/assets/movement-camera.json',true):null;
  const factionDocument=charactersDoc?.weapons?.length?await json('/assets/faction-weapons.json',true):null;
  const handlingDocument=factionDocument?await json('/assets/weapon-handling.json'):null;
  const projectileDocument=factionDocument?await json('/assets/projectile-launch.json'):null;
  const cameraFovDocument=factionDocument?await json('/assets/camera-fov.json'):null;
  const [cameraRecoilDocument,cameraAimingDocument]=factionDocument?await Promise.all([json('/assets/camera-recoil.json'),json('/assets/camera-aiming.json')]):[null,null];
  const firstPersonProjectionDocument=factionDocument?await json('/assets/firstperson-projection.json'):null;
  const [firstPersonVisibilityDocument,scopeArtworkDocument]=factionDocument?await Promise.all([json('/assets/firstperson-scope-visibility.json'),json('/assets/scope-artwork.json')]):[null,null];
  const projectileVisualDocument=factionDocument?await json('/assets/rifle-trail.json'):null;
  if(handlingDocument)gameplay.provenance.weaponSpread=nativeSpreadProvenance;
  const [rollDocument,rollGraph]=charactersDoc?.characters?.length?await Promise.all([json('/assets/roll-clips.json',true),json('/assets/roll-graph.json',true)]):[null,null];
  const firstPersonDocument=charactersDoc?.characters?.length?await json('/assets/firstperson-weapons.json',true):null;
  const firstPersonFire=firstPersonDocument?await json('/assets/firstperson-fire.json',true):null;
  const firstPersonAim=firstPersonDocument?await json('/assets/firstperson-ads.json'):null;
  if(rollDocument)gameplay.provenance.roll=ROLL_POLICY;
  if(firstPersonDocument)gameplay.provenance.firstPerson=firstPersonDocument.provenance;
  if(firstPersonFire)gameplay.provenance.firstPersonFiring=firstPersonFire.provenance;
  if(firstPersonAim)gameplay.provenance.firstPersonAim={evidenceId:firstPersonAim.evidenceId,limitations:firstPersonAim.limitations};
  if(movementDocument?.parameters) {
    for(const [section,values]of Object.entries(movementDocument.parameters))Object.assign(gameplay.parameters[section],values);
    gameplay.provenance.movement=movementDocument.provenance;
  }
  const probeDocument=manifest.metadata.mapId==='DeathStar02_01/TeamDeathmatch'?await json('/assets/source-probes.json',true):null;
  const masterDocument=manifest.metadata.mapId==='DeathStar02_01/TeamDeathmatch'?await json('/assets/recovered-master1uv-materials.json',true):null;
  const master2UvDocument=manifest.metadata.mapId==='DeathStar02_01/TeamDeathmatch'?await json('/assets/recovered-master2uv-materials.json'):null;
  const ceilingDocument=manifest.metadata.mapId==='DeathStar02_01/TeamDeathmatch'?await json('/assets/recovered-ceiling-materials.json',true):null;
  const metalOnlyDocument=manifest.metadata.mapId==='DeathStar02_01/TeamDeathmatch'?await json('/assets/recovered-metalonly-materials.json'):null;
  const catwalk1Document=manifest.metadata.mapId==='DeathStar02_01/TeamDeathmatch'?await json('/assets/recovered-catwalk1-materials.json'):null;
  const volcanicObjectDocument=manifest.metadata.mapId==='DeathStar02_01/TeamDeathmatch'?await json('/assets/recovered-volcanic-object-materials.json'):null;
  const propsNonmetalDocument=manifest.metadata.mapId==='DeathStar02_01/TeamDeathmatch'?await json('/assets/recovered-propsnonmetal-materials.json'):null;
  const catwalk2Document=manifest.metadata.mapId==='DeathStar02_01/TeamDeathmatch'?await json('/assets/recovered-catwalk2-materials.json'):null;
  const exteriorDocument=manifest.metadata.mapId==='DeathStar02_01/TeamDeathmatch'?await json('/assets/recovered-exterior-noscale-materials.json'):null;
  const array2UvDocument=manifest.metadata.mapId==='DeathStar02_01/TeamDeathmatch'?await json('/assets/recovered-array2uv-materials.json'):null;
  const array1UvDocument=manifest.metadata.mapId==='DeathStar02_01/TeamDeathmatch'?await json('/assets/recovered-array1uv-materials.json'):null;
  const propsPresetDocument=manifest.metadata.mapId==='DeathStar02_01/TeamDeathmatch'?await json('/assets/recovered-propspreset-materials.json'):null;
  const masterEmissiveDocument=manifest.metadata.mapId==='DeathStar02_01/TeamDeathmatch'?await json('/assets/recovered-master1uv-emissive-materials.json'):null;
  const masterEmissiveNonmetalDocument=manifest.metadata.mapId==='DeathStar02_01/TeamDeathmatch'?await json('/assets/recovered-master1uv-emissive-nonmetal-materials.json'):null;
  const corvetteDamageDocument=manifest.metadata.mapId==='DeathStar02_01/TeamDeathmatch'?await json('/assets/recovered-corvette-damage-materials.json'):null;
  const doorDocument=manifest.metadata.mapId==='DeathStar02_01/TeamDeathmatch'?await json('/assets/source-doors.json'):null;
  const lodDocument=manifest.metadata.mapId==='DeathStar02_01/TeamDeathmatch'?await json('/assets/source-lods.json',true):null;
  const dfgDocument=manifest.metadata.mapId==='DeathStar02_01/TeamDeathmatch'?await json('/assets/source-dfg.json'):null;
  const sourceDfg=dfgDocument?await prepareSourceDfg(dfgDocument):null;
  const sourceTangents=dfgDocument?await prepareSourceTangentWitness(await json('/assets/native-tangent-witness.json')):null;
  const [staticAtlasDocument,staticAtlasExposure]=dfgDocument?await Promise.all([json('/assets/lighting/static-atlas-native.json'),json('/assets/lighting/static-atlas-preexposure.json')]):[null,null];
  if(staticAtlasExposure&&(staticAtlasExposure.schemaVersion!==1||staticAtlasExposure.value!==1))throw new Error('Selected native static-atlas scale changed');
  const sourceStaticAtlas=staticAtlasDocument?await prepareSourceStaticAtlas(staticAtlasDocument,{lightMapPreExposure:staticAtlasExposure.value}):null;
  const [blasterMaterialDocument,rifleEmitterDocument]=dfgDocument?await Promise.all([json('/assets/recovered-blaster-bolt-material.json'),json('/assets/rifle-emitter.json')]):[null,null];
  let sourceProbes=null;
  if(probeDocument){const response=await fetch(assetUrl(probeDocument.coefficientUrl,'/assets/source-probes.json'));if(!response.ok)throw new Error('Source light probe coefficients are unavailable');sourceProbes=createSourceProbeLighting(probeDocument,await response.arrayBuffer(),{dfg:sourceDfg,staticAtlas:sourceStaticAtlas});}
  const manager = new THREE.LoadingManager();
  const failed = [];
  manager.onError = item => failed.push(item);
  const loader = new GLTFLoader(manager);
  timed('source-configuration');
  const [recoveredFloors,recoveredMasters,recoveredCeilings,recoveredMetalOnly,recoveredCatwalk1,recoveredVolcanicObject,recoveredPropsNonmetal,recoveredCatwalk2,recoveredExterior,recoveredArray2Uv,recoveredArray1Uv,recoveredMasterEmissive,recoveredCorvetteDamage,recoveredMasterEmissiveNonmetal,recoveredMaster2Uv,recoveredPropsPreset] = await Promise.all([prepareRecoveredFloorMaterials(floorDocument,manager),prepareRecoveredMasterMaterials(masterDocument,manager),prepareRecoveredCeilingMaterials(ceilingDocument,manager),prepareRecoveredMetalOnlyMaterials(metalOnlyDocument,manager),prepareRecoveredCatwalk1Materials(catwalk1Document,manager),prepareRecoveredVolcanicObjectMaterials(volcanicObjectDocument,manager),prepareRecoveredPropsNonmetalMaterials(propsNonmetalDocument,manager),prepareRecoveredCatwalk2Materials(catwalk2Document,manager),prepareRecoveredExteriorNoScaleMaterials(exteriorDocument,manager),prepareRecoveredArray2UvMaterials(array2UvDocument,manager),prepareRecoveredArray1UvMaterials(array1UvDocument,manager),prepareRecoveredMaster1UvEmissiveMaterials(masterEmissiveDocument,manager),prepareRecoveredCorvetteDamageMaterials(corvetteDamageDocument,manager),prepareRecoveredMaster1UvEmissiveNonmetalMaterials(masterEmissiveNonmetalDocument,manager),prepareRecoveredMaster2UvMaterials(master2UvDocument,manager),prepareRecoveredPropsPresetMaterials(propsPresetDocument,manager)]);
  const recoveredRifleTrails=blasterMaterialDocument?await prepareRifleTrails(blasterMaterialDocument,rifleEmitterDocument,manager):null;
  const source = new Map();
  timed('source-material-textures');
  let completed = 0;
  await pool(manifest.assets,4,async asset => {
    onProgress({ fraction: completed / manifest.assets.length * .8, message: `Loading map (${completed + 1}/${manifest.assets.length})` });
    const gltf = await loader.loadAsync(assetUrl(asset.url,url),event => {
      if (event.total) onProgress({ fraction:(completed+event.loaded/event.total)/manifest.assets.length*.8,message:`Loading map · ${completed + 1}/${manifest.assets.length} · ${Math.round(event.loaded/1024)} / ${Math.round(event.total/1024)} KiB` });
    });
    recoveredFloors.apply(gltf,asset);
    sourceStaticAtlas?.applyGeometry(gltf,asset);
    sourceTangents?.applyGeometry(gltf,asset);
    recoveredMasters.apply(gltf,asset);
    recoveredMaster2Uv.apply(gltf,asset);
    recoveredCeilings.apply(gltf,asset);
    recoveredMetalOnly.apply(gltf,asset);
    recoveredCatwalk1.apply(gltf,asset);
    recoveredVolcanicObject.apply(gltf,asset);
    recoveredPropsNonmetal.apply(gltf,asset);
    recoveredCatwalk2.apply(gltf,asset);
    recoveredExterior.apply(gltf,asset);
    recoveredArray2Uv.apply(gltf,asset);
    recoveredArray1Uv.apply(gltf,asset);
    recoveredPropsPreset.apply(gltf,asset);
    recoveredMasterEmissive.apply(gltf,asset);
    recoveredMasterEmissiveNonmetal.apply(gltf,asset);
    recoveredCorvetteDamage.apply(gltf,asset);
    source.set(asset.id,gltf); completed++;
  });
  if (failed.length) throw new Error(`Missing model or texture resources: ${failed.join(', ')}`);
  timed('original-map-models');

  const sourceDoors=prepareSourceDoors(doorDocument,manifest,source);
  const group = new THREE.Group(); group.name = manifest.metadata.name;
  const matrices = new Map(),instanceIndices=new WeakMap(manifest.instances.map((instance,index)=>[instance,index]));
  for (const [index,instance] of manifest.instances.entries()) {
    if(sourceDoors.instances.has(index))continue;
    if (!matrices.has(instance.assetId)) matrices.set(instance.assetId,[]);
    matrices.get(instance.assetId).push(instance);
  }
  let drawMeshes = sourceDoors.drawMeshes;
  for (const asset of manifest.assets) {
    const gltf = source.get(asset.id), transforms = matrices.get(asset.id) ?? [];
    if (!transforms.length) continue;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(mesh => {
      if (!mesh.isMesh) return;
      if (mesh.isSkinnedMesh) throw new Error(`Static map asset ${asset.id} contains a skinned mesh; export a static model.`);
      const batches = createStaticBatches(mesh,transforms,asset,{cellSize:batchCellSize,instanceIndices});
      for (const batch of batches) {
        for (const material of [].concat(batch.material)) { if (material.map) material.map.colorSpace = THREE.SRGBColorSpace; if (material.emissiveMap) material.emissiveMap.colorSpace = THREE.SRGBColorSpace; }
        group.add(batch); drawMeshes++;
      }
    });
  }
  onProgress({ fraction:.85, message:'Preparing map collision' });
  timed('map-batches-and-doors');
  await new Promise(resolve => setTimeout(resolve,0));
  let collision=doorDocument&&batchCellSize===48?await loadPreparedMapCollision(manifest,doorDocument,{onProgress}):null;
  const preparedCollision=collision?{loaded:true,...collision.stats}:null;
  collision??=CollisionWorld.fromObject3D(group,{filter:mesh => mesh.userData.mapCollision});
  let movementCollision=collision;
  const movementOverrides=[];
  for(const descriptor of collisionOverrides?.overrides??[]) {
    if(descriptor.usage!=='capsule-movement')continue;
    const instances=manifest.instances.filter(instance=>instance.assetId===descriptor.assetId&&instance.collision!==false);
    if(!instances.length)continue;
    const gltf=await loader.loadAsync(assetUrl(descriptor.url,'/assets/collision-overrides.json')),collisionGroup=new THREE.Group();
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(mesh=>{if(mesh.isMesh)collisionGroup.add(...createStaticBatches(mesh,instances,{id:descriptor.assetId,collision:true,visible:false}));});
    if(movementCollision===collision)movementCollision=new CompositeCollision(collision);
    movementCollision.add(descriptor.assetId,CollisionWorld.fromObject3D(collisionGroup,{filter:mesh=>mesh.userData.mapCollision}));
    movementOverrides.push({assetId:descriptor.assetId,instances:instances.length,source:descriptor});
  }
  // Doorways remain traversable in the reconstructed navigation graph; actual
  // actor movement and projectiles test the independently moving leaf BVHs.
  const navigationCollision=movementCollision;
  ({collision,movementCollision}=sourceDoors.attachCollision(collision,movementCollision));
  sourceProbes?.add(sourceDoors.group,{moving:true});
  group.add(sourceDoors.group);
  timed('map-collision');
  const characters = new Map(), weapons = new Map(),firstPersonModels=new Map();
  for (const descriptor of charactersDoc?.characters ?? []) {
    const gltf = await loader.loadAsync(assetUrl(descriptor.url,'/assets/characters.json'));
    compactSkinnedSkeletons(gltf.scene);
    characters.set(descriptor.id ?? `team-${descriptor.team}`,{descriptor,gltf});
  }
  for (const descriptor of [...(charactersDoc?.weapons??[]),...(factionDocument?.weapons??[])]) {
    if(projectileDocument) {
      const launch=resolveProjectileLaunch(projectileDocument,descriptor.id,{sourceGuid:descriptor.sourceWeaponGuid});
      if(!launch)throw new Error(`Missing selected source projectile launch: ${descriptor.id}`);
      descriptor.parameters={...descriptor.parameters,...launch.parameters};
      descriptor.projectileLaunch={...launch.parameters,evidenceId:launch.provenance.nativeEvidenceId};
    }
    const gltf = await loader.loadAsync(assetUrl(descriptor.url,'/assets/characters.json'));
    const audioUrl=descriptor.audioUrl?assetUrl(descriptor.audioUrl,'/assets/faction-weapons.json'):null;
    const audioDocument=audioUrl?await json(audioUrl):null;
    compactSkinnedSkeletons(gltf.scene);
    weapons.set(descriptor.id ?? 'primary',{descriptor,gltf,audioDocument,audioUrl});
  }
  for(const descriptor of firstPersonDocument?.models??[]){
    const gltf=await loader.loadAsync(assetUrl(descriptor.url,'/assets/firstperson-weapons.json'));
    compactSkinnedSkeletons(gltf.scene);
    firstPersonModels.set(descriptor.weaponId,{descriptor,gltf});
  }
  const heroes=await loadHeroes(loader);
  if (failed.length) throw new Error(`Missing texture resources: ${failed.join(', ')}`);
  timed('soldiers-and-weapons');
  sourceProbes?.add(group);
  timed('source-probe-geometry');
  const lods=await prepareSourceLods(lodDocument,group,loader,{prepareGeometry:(gltf,asset,level)=>{sourceStaticAtlas?.applyGeometry(gltf,asset,level);sourceTangents?.applyGeometry(gltf,asset,level);recoveredArray2Uv.applyGeometry(gltf,asset,level);recoveredCorvetteDamage.applyGeometry(gltf,asset,level);recoveredMaster2Uv.applyGeometry(gltf,asset,level);recoveredPropsPreset.applyGeometry(gltf,asset,level);},adaptGeometry:sourceProbes?(mesh,geometry)=>sourceProbes.adaptGeometry(mesh,geometry):undefined,adaptMaterial:sourceProbes?(mesh,geometry)=>sourceProbes.adaptMaterial(mesh,geometry):undefined});
  const teamWeapons=new Map(factionDocument?.teams?.map(row=>[row.team,row.weaponId])??[]);
  timed('original-map-lods');
  for(const id of teamWeapons.values())if(!weapons.has(id))throw new Error(`Missing selected faction weapon: ${id}`);
  gameplay.provenance.factionWeapons=factionDocument?.provenance??null;
  if(doorDocument)gameplay.provenance.doors=doorDocument.provenance;
  if(projectileVisualDocument)gameplay.provenance.projectileVisuals=projectileVisualDocument.provenance;
  if(rifleEmitterDocument)gameplay.provenance.rifleTrailRenderer=rifleEmitterDocument;
  if(cameraRecoilDocument)gameplay.provenance.cameraRecoil={...cameraRecoilDocument.provenance,aimingBoundary:cameraAimingDocument.provenance,runtime:CAMERA_RECOIL_RUNTIME_POLICY};
  if(cameraFovDocument) {
    gameplay.parameters.camera.fov=cameraFovDocument.zoomLevels[0].FieldOfView;
    gameplay.parameters.camera.aimFov=cameraFovDocument.zoomLevels[1].FieldOfView;
    gameplay.provenance.cameraFov=cameraFovDocument.provenance;
    gameplay.provenance.provisional=gameplay.provenance.provisional.filter(key=>!['camera.fov','camera.aimFov'].includes(key));
    gameplay.provenance.sourceDerived=[...new Set([...gameplay.provenance.sourceDerived,'camera.fov','camera.aimFov'])];
  }
  if(projectileDocument) {
    gameplay.provenance.projectileLaunch=projectileDocument.provenance;
    const resolved=[...projectileDocument.provenance.sourceDerived,...projectileDocument.provenance.derived];
    gameplay.provenance.provisional=gameplay.provenance.provisional.filter(key=>!resolved.includes(key));
    gameplay.provenance.sourceDerived=[...new Set([...gameplay.provenance.sourceDerived,...projectileDocument.provenance.sourceDerived])];
    gameplay.provenance.derived=[...projectileDocument.provenance.derived];
  }
  freezeStaticTransforms(group,[sourceDoors.group]);
  onProgress({fraction:1,message:'Map loaded'});
  return { manifest, gameplay, heroes, reactions:heroes?.reactions??null, reactionsRoot:heroes?.reactionsRoot??null, recoveredRifleTrails, group, collision, movementCollision, navigationCollision,sourceDoors,movementOverrides, characters, weapons, teamWeapons, firstPersonModels,firstPersonFire,firstPersonAim,firstPersonVisibilityDocument,scopeArtworkDocument,source, sourceLights, sourceProbes,sourceDfg,sourceTangents,lods, audioDocument, hitboxDocument, handlingDocument,cameraFovDocument,cameraRecoilDocument,cameraAimingDocument,firstPersonProjectionDocument,projectileVisualDocument, rollDocument,rollGraph,loadTimings,stats:{sourceTangentGeometries:sourceTangents?.geometries??0,sourceTangentProvenance:sourceTangents?.provenance??null,batchCellSize,preparedCollision,assets:manifest.assets.length,instances:manifest.instances.length,drawMeshes,recoveredFloors:recoveredFloors.applied??0,recoveredFloorProvenance:recoveredFloors.provenance,recoveredMaster2Uv:recoveredMaster2Uv.applied??0,recoveredMaster2UvGeometries:recoveredMaster2Uv.geometries??0,recoveredMaster2UvProvenance:recoveredMaster2Uv.provenance,recoveredMasters:recoveredMasters.applied??0,recoveredMasterProvenance:recoveredMasters.provenance,recoveredCeilings:recoveredCeilings.applied??0,recoveredCeilingProvenance:recoveredCeilings.provenance,recoveredMetalOnly:recoveredMetalOnly.applied??0,recoveredMetalOnlyProvenance:recoveredMetalOnly.provenance,recoveredPropsNonmetal:recoveredPropsNonmetal.applied??0,recoveredPropsNonmetalProvenance:recoveredPropsNonmetal.provenance,recoveredVolcanicObject:recoveredVolcanicObject.applied??0,recoveredVolcanicObjectProvenance:recoveredVolcanicObject.provenance,recoveredCatwalk1:recoveredCatwalk1.applied??0,recoveredCatwalk1Provenance:recoveredCatwalk1.provenance,recoveredCatwalk2:recoveredCatwalk2.applied??0,recoveredCatwalk2Provenance:recoveredCatwalk2.provenance,recoveredExterior:recoveredExterior.applied??0,recoveredExteriorProvenance:recoveredExterior.provenance,recoveredCorvetteDamage:recoveredCorvetteDamage.applied??0,recoveredCorvetteDamageGeometries:recoveredCorvetteDamage.geometries??0,recoveredCorvetteDamageProvenance:recoveredCorvetteDamage.provenance,recoveredMasterEmissiveNonmetal:recoveredMasterEmissiveNonmetal.applied??0,recoveredMasterEmissiveNonmetalProvenance:recoveredMasterEmissiveNonmetal.provenance,recoveredMasterEmissive:recoveredMasterEmissive.applied??0,recoveredMasterEmissiveProvenance:recoveredMasterEmissive.provenance,recoveredPropsPreset:recoveredPropsPreset.applied??0,recoveredPropsPresetGeometries:recoveredPropsPreset.geometries??0,recoveredPropsPresetProvenance:recoveredPropsPreset.provenance,recoveredArray1Uv:recoveredArray1Uv.applied??0,recoveredArray1UvProvenance:recoveredArray1Uv.provenance,recoveredArray2Uv:recoveredArray2Uv.applied??0,recoveredArray2UvGeometries:recoveredArray2Uv.geometries??0,recoveredArray2UvProvenance:recoveredArray2Uv.provenance,sourceHitCapsules:hitboxDocument?.capsules?.length??0}, characterProvenance:charactersDoc?.provenance ?? null };
}

// The extracted map never moves after loading, apart from door leaves. three r186
// recomposes and multiplies every matrix in the tree each frame unless
// matrixAutoUpdate is off along the whole ancestor chain (main.js also stops the
// Scene node). Static branches get their world matrices once, here.
export function freezeStaticTransforms(group,dynamicBranches=[]) {
  group.updateMatrixWorld(true);group.matrixAutoUpdate=false;
  for(const child of group.children)if(!dynamicBranches.includes(child))child.traverse(node=>{node.matrixAutoUpdate=false;});
}

// Playable heroes (assets/heroes.json). Optional: without the descriptor or its
// files the game runs with troopers only. Reaction clips (choke, saber deaths)
// retarget by bone name onto the trooper rigs.
async function loadHeroes(loader) {
  const document=await json('/assets/heroes.json',true);
  if(!document?.heroes?.length)return null;
  const base='/assets/heroes.json',heroes=new Map();
  const glb=url=>loader.loadAsync(assetUrl(url,base));
  const failures=[];
  for(const descriptor of document.heroes) {
    // A hero whose files are missing is left out; the rest of the game still loads.
    try {
      const [model,saber,animations,gameplayDocument,audioDocument]=await Promise.all([glb(descriptor.model),glb(descriptor.saber.url),glb(descriptor.animations),descriptor.gameplay?json(assetUrl(descriptor.gameplay,base),true):null,descriptor.audio?json(assetUrl(descriptor.audio,base),true):null]);
      compactSkinnedSkeletons(model.scene);
      heroes.set(descriptor.id,{descriptor,model:{gltf:model},saber:{gltf:saber,attach:descriptor.saber.attach,blade:descriptor.saber.blade},animations:{gltf:animations},gameplayDocument,audioDocument,audioUrl:descriptor.audio?assetUrl(descriptor.audio,base):null});
    } catch(error){failures.push({hero:descriptor.id,message:String(error?.message??error)});console.warn(`Hero ${descriptor.id} unavailable`,error);}
  }
  let reactionsGltf=null;
  try{reactionsGltf=document.reactions?await glb(document.reactions):null;}catch(error){failures.push({reactions:document.reactions,message:String(error?.message??error)});}
  const reactions=reactionsGltf?new Map(reactionsGltf.animations.map(clip=>[clip.name,clip])):null;
  return {document,heroes,reactions,reactionsRoot:reactionsGltf?.scene??null,failures,provenance:document.provenance??null};
}

export function weaponForTeam(assets,team) {return assets.weapons.get(assets.teamWeapons?.get(team))??[...assets.weapons.values()][0];}

export function makeCharacter(assets, team) {
  const found = [...assets.characters.values()].find(c => c.descriptor.team === team) ?? [...assets.characters.values()][0];
  const root = new THREE.Group();
  if (!found) {
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(.28,1.12,4,8),new THREE.MeshStandardMaterial({color:team ? 0xa64a41 : 0x668caf,roughness:.8}));
    mesh.position.y = .84; mesh.castShadow = true; root.add(mesh);
    return { root, placeholder:true, update(){} };
  }
  const model = cloneSkeleton(found.gltf.scene);
  model.scale.setScalar(found.descriptor.scale ?? 1); model.rotation.y = found.descriptor.rotationY ?? 0;
  model.traverse(o => {if(o.isMesh) {o.castShadow=true;o.receiveShadow=true;}}); root.add(model);
  const weaponBone=model.getObjectByName('Wep_Root'),primary=weaponForTeam(assets,team);
  if(weaponBone&&primary) {
    // Source rifle animations drive the source weapon bone; no invented grip
    // transform is applied to the third-person attachment.
    const weapon=cloneSkeleton(primary.gltf.scene);
    // Actor tracks resolve by unique loaded node names. A nested weapon rig
    // contains names such as Connect too and must not shadow the actor bones.
    weapon.traverse(node=>{node.name=`attachment_${node.uuid}_${node.name}`;});
    weaponBone.add(weapon);
  }
  const hitboxes=createSoldierHitboxes(model,assets.hitboxDocument);
  // Capsule bones are resolved first so trimming keeps those exact nodes.
  const boneTrim=trimUnusedBones(model,hitboxes?.capsules.map(capsule=>capsule.bone)??[]);
  const mixer = new THREE.AnimationMixer(model), actions = {};
  for (const clip of found.gltf.animations) actions[clip.name] = mixer.clipAction(clipForModel(clip,model));
  const rollActions={};
  for(const source of assets.rollDocument?.clips??[]){
    const {clip}=createRollAnimationClip(model,source,{graphTicksPerSecond:ROLL_POLICY.graphTicksPerSecond});
    const action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;rollActions[source.direction]=action;
  }
  // Hero-inflicted reactions (Force choke hold, saber/choke deaths) from the
  // decoded human-male source clips; one-shot deaths clamp on their last pose.
  // Their decoded AITrajectory (choke lift, death falls) is applied to the model
  // offset, since the victim's gameplay capsule does not move.
  const reactionActions={},reactionMotion={},modelRest=model.position.clone(),offset=new THREE.Vector3(),yAxis=new THREE.Vector3(0,1,0);
  for(const [name,clip] of assets.reactions??[]){const action=mixer.clipAction(assets.reactionsRoot?retargetClipToCopies(clip,assets.reactionsRoot,model):clipForModel(clip,model));if(!/loop/i.test(name)){action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;}reactionActions[name]=action;reactionMotion[name]=clip.userData?.rootMotion?.t?clip.userData.rootMotion:null;}
  let current = null,reaction=null,lift=0;
  return {root, model, hitboxes, boneTrim, rotationY:model.rotation.y,placeholder:false,reactions:Object.keys(reactionActions),
    /** Holds a reaction clip until cleared (null); `death` reactions also play after death. */
    react(name){reaction=name&&reactionActions[name]?name:null;},
    reactionDuration:name=>reactionActions[name]?.getClip().duration??0,
    reaction:()=>reaction,
    setLift(value){lift=value;model.position.y=lift;},
    update(dt,moving,firing,alive,roll=null) {
    const animation = found.descriptor.animations ?? {};
    const name = !alive ? animation.death : firing && animation.fire ? animation.fire : moving ? animation.run : animation.idle;
    const next = reaction?reactionActions[reaction]:alive&&roll?.active?rollActions[roll.direction]:(actions[name] ?? Object.values(actions)[0]);
    if (next && next !== current) { current?.fadeOut(.15); next.reset().fadeIn(.15).play(); current=next; }
    if(!reaction&&alive&&roll?.active&&next){next.paused=true;next.time=roll.tick/ROLL_POLICY.graphTicksPerSecond;}
    else if(next)next.paused=false;
    const motion=reaction&&reactionMotion[reaction];
    if(motion) {
      const p=sampleMotion(motion,reactionActions[reaction].time),o=motion.origin??[0,0,0];
      offset.set(o[0]+p[0],o[1]+p[1],o[2]+p[2]).multiplyScalar(model.scale.x).applyAxisAngle(yAxis,model.rotation.y);
      model.position.copy(modelRest).add(offset);
    } else model.position.set(modelRest.x,modelRest.y+lift,modelRest.z);
    mixer.update(dt);
    hitboxes?.update();
  }};
}
