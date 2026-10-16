// Build the exact current runtime collision ahead of deployment. Source GLB
// positions, instance transforms, mirroring and no-physics flags are unchanged.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {CollisionWorld,deserializeCollisionWorld} from '../vendor/vibe-engine/kits/fps/collision-world.js';
import {createStaticBatches} from '../src/static-batches.js';
import {mapCollisionIdentity} from '../src/prepared-collision.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const publicRoot=path.join(root,'public'),assetRoot=path.join(publicRoot,'assets');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const manifestBytes=await fs.readFile(path.join(assetRoot,'map.scene.json'));
const doorsBytes=await fs.readFile(path.join(assetRoot,'source-doors.json'));
const manifest=JSON.parse(manifestBytes),doors=JSON.parse(doorsBytes),exclude=new Set(doors.doors.flatMap(door=>door.leaves.map(leaf=>leaf.sceneMatch.index)));
if(exclude.size!==62)throw new Error('Source door collision exclusions changed');
const group=new THREE.Group();group.name=manifest.metadata.name;
const loader=new GLTFLoader();loader.register(()=>({name:'CollisionGeometryOnly',loadTexture(){return Promise.resolve(new THREE.Texture());}}));
const sources=[],instances=new Map();
for(const [index,instance]of manifest.instances.entries())if(!exclude.has(index)){
  if(!instances.has(instance.assetId))instances.set(instance.assetId,[]);
  instances.get(instance.assetId).push(instance);
}
for(const asset of manifest.assets){
  const rows=instances.get(asset.id)??[];
  if(!rows.some(instance=>instance.collision??!!asset.collision))continue;
  const file=path.resolve(assetRoot,asset.url);
  if(!file.startsWith(assetRoot+path.sep))throw new Error('Unexpected source mesh path');
  const bytes=await fs.readFile(file);sources.push({url:asset.url,sha256:hash(bytes)});
  const gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(mesh=>{if(mesh.isMesh&&!mesh.isSkinnedMesh)for(const batch of createStaticBatches(mesh,rows,asset,{cellSize:48}))if(batch.userData.mapCollision)group.add(batch);});
}
const start=performance.now(),world=CollisionWorld.fromObject3D(group,{filter:mesh=>mesh.userData.mapCollision});
const buildMilliseconds=Math.round(performance.now()-start);
const {metadata,binary}=world.serialize({binary:'static-map.bin',sourceManifestSha256:hash(manifestBytes),sourceDoorsSha256:hash(doorsBytes),excludedDoorInstances:[...exclude].sort((a,b)=>a-b),sources,
  provenance:{kind:'serialized-existing-browser-collision',geometry:'Exact original LOD0 GLBs and the same runtime world transforms/flags, with independently moving door leaves excluded.',limitations:'This caches reconstructed render-derived collision; it does not claim original Frostbite physics geometry.'}});
metadata.binarySha256=hash(binary);
metadata.sourceIdentity=hash(mapCollisionIdentity(manifest,doors));
const restored=deserializeCollisionWorld(metadata,binary);
let samples=0;
// Compare independent rebuilt/restored queries at every source spawn and a
// deterministic grid across occupied bounds, including rays with no hit.
let seed=0xbf2;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const check=ray=>{
  const a=world.rayIntersect(ray,0,2000),b=restored.rayIntersect(ray,0,2000);
  if(!!a!==!!b||a&&(Math.abs(a.distance-b.distance)>1e-6||a.point.distanceTo(b.point)>1e-6))throw new Error('Serialized collision differs');samples++;
};
for(const spawn of manifest.spawns)check(new THREE.Ray(new THREE.Vector3(...spawn.position).add(new THREE.Vector3(0,1,0)),new THREE.Vector3(0,-1,0)));
for(let i=0;i<1000;i++){
  const origin=new THREE.Vector3(...manifest.bounds.min.map((min,axis)=>min+random()*(manifest.bounds.max[axis]-min)));
  check(new THREE.Ray(origin,new THREE.Vector3(random()-.5,random()-.5,random()-.5).normalize()));
}
metadata.validation={queries:samples,maximumAbsoluteDistanceError:0,buildMilliseconds};
const output=path.join(assetRoot,'collision');await fs.mkdir(output,{recursive:true});
await fs.writeFile(path.join(output,'static-map.bin'),binary);
await fs.writeFile(path.join(output,'static-map.json'),JSON.stringify(metadata,null,2));
console.log(JSON.stringify({bytes:binary.byteLength,triangles:metadata.triangles,vertices:metadata.vertices,buildMilliseconds,queries:samples}));
