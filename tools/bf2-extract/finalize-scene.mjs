import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {refreshMaterialProvenance} from '../materials/refresh-manifest.mjs';

const read = file => JSON.parse(fs.readFileSync(file,'utf8'));
const save = (file,value) => fs.writeFileSync(file,JSON.stringify(value,null,2));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const emptyBounds = () => ({min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]});
function include(bounds,point) {for(let i=0;i<3;i++){bounds.min[i]=Math.min(bounds.min[i],point[i]);bounds.max[i]=Math.max(bounds.max[i],point[i]);}return bounds;}

// The converter emits a single identity node. Refuse other layouts rather than
// silently forgetting a GLTF node transform when calculating region coverage.
export function glbBounds(file) {
  const bytes=fs.readFileSync(file);
  if(bytes.readUInt32LE(0)!==0x46546c67||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length)throw new Error('Invalid GLB '+file);
  if(bytes.readUInt32LE(16)!==0x4e4f534a)throw new Error('GLB JSON missing '+file);
  const doc=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
  if(doc.nodes.some(n=>n.matrix||n.translation||n.rotation||n.scale))throw new Error('Expected converter identity GLTF nodes '+file);
  const bounds=emptyBounds();let triangles=0;
  for(const mesh of doc.meshes)for(const prim of mesh.primitives) {
    const position=doc.accessors[prim.attributes.POSITION];
    if(position.type!=='VEC3'||!position.min||!position.max||position.min.concat(position.max).some(v=>!Number.isFinite(v)))throw new Error('Missing finite position extrema '+file);
    include(bounds,position.min);include(bounds,position.max);
    if(prim.mode!==undefined&&prim.mode!==4)throw new Error('Expected triangle list '+file);
    triangles+=(prim.indices===undefined?position.count:doc.accessors[prim.indices].count)/3;
  }
  return {...bounds,triangles};
}

export function transformedBounds(bounds,matrix) {
  const out=emptyBounds();
  if(matrix.length!==16||matrix.some(v=>!Number.isFinite(v)))throw new Error('Invalid placement matrix');
  for(let corner=0;corner<8;corner++) {
    const point=[0,1,2].map(i=>(corner&(1<<i))?bounds.max[i]:bounds.min[i]);
    include(out,[0,1,2].map(i=>matrix[i]*point[0]+matrix[4+i]*point[1]+matrix[8+i]*point[2]+matrix[12+i]));
  }
  return out;
}

export const intersects=(a,b)=>a.min.every((v,i)=>v<=b.max[i]&&a.max[i]>=b.min[i]);

export function finalize({planFile,regionFile,meshDirs,output,margin=8}) {
  const plan=read(planFile),region=read(regionFile),meshRows=new Map();
  const selectionBounds={
    min:[region.combatArea.extents.min[0]-margin,region.spawnExtents.min[1]-24,region.combatArea.extents.min[2]-margin],
    max:[region.combatArea.extents.max[0]+margin,region.spawnExtents.max[1]+48,region.combatArea.extents.max[2]+margin]
  };
  for(const directory of meshDirs)for(const row of read(path.join(directory,'mesh.manifest.json')).results)meshRows.set(row.guid,{...row,sourceFile:path.join(directory,row.file)});
  const assets=new Map(),instances=[],rejected=[],missing=new Map(),geometryBounds=emptyBounds();let triangles=0;
  const assetNames=new Map(plan.assets.map(a=>[a.id,a]));
  const cachedBounds=new Map();
  for(const instance of plan.instances) {
    const source=assetNames.get(instance.assetId),row=meshRows.get(instance.assetId);
    // Enlighten proxy meshes and volumetric cones are light integration helpers,
    // not opaque architecture. Their shader/effect behavior remains unported.
    if(/^(fx\/meshes\/lighting|lighting\/mesh\/)/i.test(source.name)) {rejected.push({assetId:source.id,reason:'lighting proxy or volumetric effect shader omitted',route:instance.route});continue;}
    if(!row){missing.set(source.id,source);continue;}
    if(!cachedBounds.has(source.id))cachedBounds.set(source.id,glbBounds(row.sourceFile));
    const local=cachedBounds.get(source.id),world=transformedBounds(local,instance.matrix);
    if(!intersects(world,selectionBounds))continue;
    if(!assets.has(source.id))assets.set(source.id,{
      id:source.id,url:'meshes/'+source.id+'.glb',name:source.name,collision:false,
      source:{ebxSha1:source.sourceSha1,resourceId:row.metadata.resourceId,chunkGuid:row.metadata.chunkGuid,meshType:row.metadata.meshType,lod:row.metadata.lod,convertedFile:row.sourceFile,convertedSha256:hash(row.sourceFile)},
      localBounds:local,castShadow:true
    });
    const collision=instance.sourcePhysics?.partCount!==0&&!/^characters\//i.test(source.name);
    assets.get(source.id).collision ||= collision;
    instances.push({assetId:source.id,matrix:instance.matrix,variation:instance.variation,collision,source:{fileGuid:instance.fileGuid,classGuid:instance.classGuid,route:instance.route,physics:instance.sourcePhysics}});
    include(geometryBounds,world.min);include(geometryBounds,world.max);triangles+=local.triangles;
  }
  const spawns=region.spawns.filter(s=>s.enabled&&[1,2].includes(s.sourceTeam.value)).map(s=>({
    position:s.position,team:s.sourceTeam.value-1,yaw:Math.atan2(-s.forward[0],-s.forward[2]),
    source:{objectId:s.objectId,team:s.sourceTeam,evidenceId:region.evidenceId}
  }));
  const neutralSpawns=region.spawns.filter(s=>s.enabled&&s.sourceTeam.value===0).map(s=>({position:s.position,yaw:Math.atan2(-s.forward[0],-s.forward[2]),source:{objectId:s.objectId,team:s.sourceTeam,evidenceId:region.evidenceId}}));
  if(!instances.length||!spawns.length||!assets.size)throw new Error('Cannot emit empty scene');
  const manifest={
    metadata:{mapId:'DeathStar02_01/TeamDeathmatch',name:'Death Star II — Command Sector North',source:{installation:process.env.BF2_GAME_DIR??'C:\\Games\\Star Wars - Battlefront 2',mapAsset:'Levels/MP/DeathStar02_01/DeathStar02_01',mapGuid:'7a85dea0-9a44-4e0d-8986-b08ae8d31dd8',modeAsset:'Levels/MP/DeathStar02_01/TeamDeathmatch',regionEvidenceId:region.evidenceId,groupTransformEvidenceIds:['BF2-GROUP-TRANSFORMS-7a85dea0','BF2-GROUP-TRANSFORMS-fdcf6de1'],scenePlan:planFile},units:'meters',up:'Y',coordinateConversion:'None. Original XYZ and column-major transforms preserved; source positive-forward converted to Three.js camera yaw.',fidelity:{geometry:'original LOD0 rigid and composite meshes',placement:'original EBX transforms and cross-checked paired 32/64-bit Havok grouped transforms',materials:'neutral converter materials until source texture binding is applied',collision:'render triangles used as approximate collision; native collision shapes not yet decoded',lighting:'source descriptors exported separately; runtime conversion remains unverified',dynamicEntities:'destruction, dynamic doors and ambient droid animation are not yet reconstructed',runtimeObserved:false}},
    assets:[...assets.values()],instances,spawns,neutralSpawns,bounds:selectionBounds,
    combatArea:{points:region.combatArea.points,evidenceId:region.evidenceId,sourceHeight:region.combatArea.height,projection:'XZ',verticalSemantics:'unresolved'},
    geometryBounds,
    limitations:['Geometry cropped by transformed mesh AABB intersection with padded source combat-area extents; the 65-point polygon is preserved for runtime use.','TeamNeutral spawn eligibility is unresolved; these original points are retained separately as neutralSpawns.','Missing external scene graph references remain in assembly report.','Local source assets only; no external publication.']
  };
  fs.mkdirSync(path.join(output,'meshes'),{recursive:true});
  for(const asset of assets.values()) {
    const target=path.join(output,asset.url);
    // Material bindings may already have rewritten a prior copy. Preserve it;
    // extraction output is immutable and the provenance still identifies input.
    if(!fs.existsSync(target))fs.copyFileSync(meshRows.get(asset.id).sourceFile,target);
  }
  refreshMaterialProvenance(manifest,output);
  save(path.join(output,'map.scene.json'),manifest);
  const lights=plan.lightCandidates.filter(light=>{
    if(!/Pbr(Sphere|Spot|Rectangular)LightEntityData$/.test(light.properties.$type)||light.properties.Enabled===false)return false;
    const p=light.matrix.slice(12,15),radius=light.properties.AttenuationRadius??0;
    return intersects({min:p.map(v=>v-radius),max:p.map(v=>v+radius)},selectionBounds);
  });
  save(path.join(output,'source-lights.json'),{evidenceId:'BF2-SOURCE-LIGHTS-001',sourcePlan:planFile,coordinateConversion:'none',runtimeObserved:false,lights,limitations:['Intensity, linear color, IES, area shape, exposure and baked illumination require an explicit browser mapping.']});
  const report={evidenceId:'BF2-SCENE-ASSEMBLY-001',createdAtUtc:new Date().toISOString(),planFile,planSha256:hash(planFile),regionFile,regionSha256:hash(regionFile),output,selectionBounds,geometryBounds,assets:assets.size,instances:instances.length,spawns:spawns.length,neutralSpawns:neutralSpawns.length,sourceLights:lights.length,instancedTriangles:triangles,unconvertedAssets:[...missing.values()],omittedEffects:rejected,unresolvedGraphReferences:plan.unresolved.length,complete:false,next:'Bind actual materials, inspect browser scene, compare original collision and runtime behavior.'};
  save(path.join(output,'scene-assembly-report.json'),report);
  return report;
}

function main(args) {
  const options={meshDirs:[]};
  for(let i=0;i<args.length;i++) {
    const key=args[i],value=args[++i];
    if(key==='--plan')options.planFile=value;
    else if(key==='--region')options.regionFile=value;
    else if(key==='--meshes')options.meshDirs.push(value);
    else if(key==='--out')options.output=value;
    else if(key==='--margin')options.margin=Number(value);
    else throw new Error('Unknown option '+key);
  }
  if(!options.planFile||!options.regionFile||!options.output||!options.meshDirs.length)throw new Error('Usage: node finalize-scene.mjs --plan JSON --region JSON --meshes DIRECTORY [--meshes DIRECTORY] --out DIRECTORY');
  const result=finalize(options);console.log(JSON.stringify({...result,unconvertedAssets:result.unconvertedAssets.length,omittedEffects:result.omittedEffects.length}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main(process.argv.slice(2));
