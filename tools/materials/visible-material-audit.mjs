// CPU replay of the retained camera/frustum and original static batching.
// No browser, GPU, material approximation or new asset extraction is involved.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import * as THREE from '../../web/node_modules/three/build/three.module.js';
import {GLTFLoader} from '../../web/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import {createStaticBatches} from '../../web/src/static-batches.js';
import {prepareSourceLods} from '../../web/src/source-lods.js';
const root=new URL('../../',import.meta.url),read=path=>fs.readFileSync(new URL(path,root)),json=path=>JSON.parse(read(path));
const scene=json('web/public/assets/map.scene.json'),plan=json('exports/materials/final-map-material-plan.json');
const profilePath='web/test-results/actual-map-native-lods.json',profile=json(profilePath);
const reference=profile.lodProfile.find(row=>row.enabled===false).geometry;
const loader=new GLTFLoader();
loader.register(()=>({name:'CpuInventoryImageStub',loadTexture(){return Promise.resolve(new THREE.Texture());}}));
async function parse(path){const bytes=read(path);return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');}
loader.loadAsync=url=>parse(`web/public${url}`);
const placed=new Map(),group=new THREE.Group();
for(const row of scene.instances){if(!placed.has(row.assetId))placed.set(row.assetId,[]);placed.get(row.assetId).push(row);}
for(const asset of scene.assets){
  const gltf=await parse(`web/public/assets/${asset.url}`);gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(mesh=>{if(mesh.isMesh)group.add(...createStaticBatches(mesh,placed.get(asset.id)??[],asset));});
}
group.updateMatrixWorld(true);
const lods=await prepareSourceLods(json('web/public/assets/source-lods.json'),group,loader);
lods.configure({enabled:false});lods.update(new THREE.Vector3(...reference.camera.position),true);
const inverse=new THREE.Matrix4().fromArray(reference.camera.world).invert();
const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().fromArray(reference.camera.projection).multiply(inverse));
const sections=new Map(),assets=new Map();
group.traverseVisible(mesh=>{
  if(!mesh.isMesh||(mesh.frustumCulled&&!frustum.intersectsObject(mesh)))return;
  const count=Math.min(mesh.geometry.drawRange.count,(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)-mesh.geometry.drawRange.start),instances=mesh.isInstancedMesh?mesh.count:1;
  const id=mesh.userData.assetId,materialId=mesh.userData.sourceMaterialId;
  for(const [map,key,base] of [[assets,id,{id}],[sections,`${id}/${materialId}`,{assetId:id,materialId}]]){
    const row=map.get(key)??{...base,batches:0,instances:0,triangles:0};row.batches++;row.instances+=instances;row.triangles+=count/3*instances;map.set(key,row);
  }
});
assert.deepEqual([...assets.values()].sort((a,b)=>a.id.localeCompare(b.id)),reference.assets.toSorted((a,b)=>a.id.localeCompare(b.id)));
const recoveredFamilies=['floor','master1uv','ceiling','metalonly','catwalk2','exterior-noscale','array2uv','array1uv','master1uv-emissive','corvette-damage'];
const recovered=new Set(recoveredFamilies.flatMap(family=>json(`web/public/assets/recovered-${family}-materials.json`).materials.map(row=>`${row.assetId}/${row.materialId}`)));
const families=new Map();
for(const mesh of plan.meshes)for(const material of mesh.materials){
  const key=`${mesh.guid}/${material.index}`,visible=sections.get(key),name=material.shader?.name??'UNKNOWN';
  if(recovered.has(key))continue;
  const row=families.get(name)??{shader:name,sections:0,placements:0,visibleSections:0,visibleBatches:0,visibleSectionInstances:0,visibleLod0Triangles:0,neutralSections:0,members:[]};
  row.sections++;row.placements+=(placed.get(mesh.guid)??[]).length;
  const neutral=!material.chosen?.baseColor;
  row.neutralSections+=neutral?1:0;
  if(visible){row.visibleSections++;row.visibleBatches+=visible.batches;row.visibleSectionInstances+=visible.instances;row.visibleLod0Triangles+=visible.triangles;}
  row.members.push({assetId:mesh.guid,meshName:mesh.name,materialId:material.index,neutral,chosen:material.chosen,visible:visible??null});families.set(name,row);
}
const rows=[...families.values()].sort((a,b)=>b.visibleLod0Triangles-a.visibleLod0Triangles);
const report={evidenceId:'BF2-VISIBLE-MATERIAL-AUDIT-002',recoveredFamilies,kind:'CPU replay validated against retained actual renderer-frustum asset counts',
  profilePath,profileSha256:crypto.createHash('sha256').update(read(profilePath)).digest('hex'),camera:reference.camera,
  matchingAssets:assets.size,recoveredSections:recovered.size,remainingFamilies:rows,
  limits:['Ranks actual frustum-selected original LOD0 triangles, including hidden-by-wall geometry: not screen pixel coverage or occlusion.','Native LOD union culling bounds and original spatial batches match the retained disabled-LOD profile exactly.','Material names and default section bindings come from retained source plan; per-instance variations remain separate.']};
fs.writeFileSync(new URL('exports/materials/visible-material-audit-current.json',root),JSON.stringify(report,null,2));
console.log(JSON.stringify({matchingAssets:assets.size,top:rows.slice(0,12).map(({members,...row})=>row)},null,2));
