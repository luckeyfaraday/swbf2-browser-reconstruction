// Replays retained source camera and exact native geometry on CPU. This ranks
// batching tradeoffs; it does not claim GPU frame-time or occlusion savings.
import fs from 'node:fs';
import * as THREE from '../../web/node_modules/three/build/three.module.js';
import {GLTFLoader} from '../../web/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import {createStaticBatches} from '../../web/src/static-batches.js';
import {prepareSourceLods} from '../../web/src/source-lods.js';
import {resolveGameplay} from '../../web/src/rules.js';
const root=new URL('../../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root)),json=p=>JSON.parse(read(p));
const scene=json('web/public/assets/map.scene.json'),lodDocument=json('web/public/assets/source-lods.json');
const report=json('web/test-results/actual-map-expanded-lods-catwalk.json'),reference=report.spawnGeometry;
const parameters=resolveGameplay(json('web/public/assets/gameplay.json')).parameters;
for(const [section,values]of Object.entries(json('web/public/assets/movement-camera.json').parameters))Object.assign(parameters[section],values);
const cameraWorld=new THREE.Matrix4().fromArray(reference.camera.world),eyePosition=new THREE.Vector3(...reference.camera.position);
if(report.trace[0].state.camera==='third-person')eyePosition.sub(new THREE.Vector3(parameters.camera.shoulder,parameters.camera.height,parameters.camera.distance).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(cameraWorld)));
const loader=new GLTFLoader();loader.register(()=>({name:'CpuImageStub',loadTexture(){return Promise.resolve(new THREE.Texture());}}));
async function model(path){const bytes=read(path);return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');}
loader.loadAsync=url=>model(`web/public${url}`);
const models=new Map(),bounds=new Map(),placed=new Map();
for(const instance of scene.instances){if(!placed.has(instance.assetId))placed.set(instance.assetId,[]);placed.get(instance.assetId).push(instance);}
for(const asset of scene.assets){const gltf=await model(`web/public/assets/${asset.url}`);gltf.scene.updateMatrixWorld(true);gltf.scene.traverse(mesh=>{if(mesh.isMesh){mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();bounds.set(mesh.geometry,{box:mesh.geometry.boundingBox.clone(),sphere:mesh.geometry.boundingSphere.clone()});}});models.set(asset.id,gltf);}
const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().fromArray(reference.camera.projection).multiply(new THREE.Matrix4().fromArray(reference.camera.world).invert()));
const measurements=[];
for(const cellSize of [16,24,32,48,64,96]){
  for(const [geometry,bound]of bounds){geometry.boundingBox=bound.box.clone();geometry.boundingSphere=bound.sphere.clone();}
  const group=new THREE.Group();
  for(const asset of scene.assets)models.get(asset.id).scene.traverse(mesh=>{if(mesh.isMesh)group.add(...createStaticBatches(mesh,placed.get(asset.id)??[],asset,{cellSize}));});
  group.updateMatrixWorld(true);const lods=await prepareSourceLods(lodDocument,group,loader);lods.update(eyePosition,true);
  let calls=0,triangles=0,instances=0;
  group.traverseVisible(mesh=>{if(!mesh.isMesh||(mesh.frustumCulled&&!frustum.intersectsObject(mesh)))return;calls++;const count=mesh.isInstancedMesh?mesh.count:1;instances+=count;triangles+=(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3*count;});
  const row={cellSize,calls,triangles,instances,allBatches:group.children.length,lods:lods.snapshot()};measurements.push(row);console.log(JSON.stringify({cellSize,calls,triangles,instances,allBatches:group.children.length}));
}
const referenceCalls=reference.assets.reduce((n,a)=>n+a.batches,0),referenceTriangles=reference.assets.reduce((n,a)=>n+a.triangles,0);
const baseline=measurements.find(row=>row.cellSize===32);
if(baseline.calls!==referenceCalls||baseline.triangles!==referenceTriangles)throw new Error('CPU replay does not match retained source frame');
fs.writeFileSync(new URL('exports/lod-recovery/batch-cost-audit.json',root),JSON.stringify({evidenceId:'BF2-CPU-BATCH-COST-001',reference:'web/test-results/actual-map-expanded-lods-catwalk.json',camera:reference.camera,measurements,limits:'CPU frustum/batch counts only. Retains geometry and matrices; larger batches reduce culling and keep nearer LODs for distant members. No native batching or GPU performance claim.'},null,2));
