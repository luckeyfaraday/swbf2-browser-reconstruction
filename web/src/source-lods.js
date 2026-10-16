import * as THREE from 'three';

export const SOURCE_LOD_POLICY=Object.freeze({
  geometry:'Original native LOD geometry and exact shared source material parameter roots; original instance matrices and source probe rows retained.',
  collision:'Render geometry changes only; the original baked LOD0 collision world stays immutable.',
  distances:'Observed MeshLodGroup distances with AutoLod=false. Browser selects by nearest instance origin in each existing spatial batch.',
  inference:'Distance origin, batch-wide selection and 10% inward hysteresis are browser choices. Group/directional precedence, non-unit LodScale arithmetic and quality/FOV scaling are unresolved; no guessed scale is applied.',
});

export function createSourceLodController(entries,{adaptGeometry=(_mesh,geometry)=>geometry,adaptMaterial}={}) {
  let enabled=true,updates=0,switches=0;
  const last=new THREE.Vector3(Infinity,Infinity,Infinity),temporary=new THREE.Matrix4();
  const draws=entries.map(({mesh,levels,assetId,lodScale=1})=>{
    mesh.userData.sourceLodControlled=true;
    mesh.updateWorldMatrix(true,false);
    const origins=[];
    for(let i=0;i<(mesh.isInstancedMesh?mesh.count:1);i++) {
      if(mesh.isInstancedMesh){mesh.getMatrixAt(i,temporary);temporary.premultiply(mesh.matrixWorld);}
      else temporary.copy(mesh.matrixWorld);
      origins.push(new THREE.Vector3().setFromMatrixPosition(temporary));
    }
    const candidates=[{level:0,distance:0,geometry:mesh.geometry},...levels.map(level=>({...level,geometry:adaptGeometry(mesh,level.geometry)}))];
    for(const candidate of candidates)candidate.material=adaptMaterial?.(mesh,candidate.geometry)??mesh.material;
    // Alternative shader permutations must receive the same lighting decorators
    // as the live LOD0 material before any distance-driven swap can select them.
    mesh.sourceLodMaterials=[...new Set(candidates.flatMap(candidate=>[].concat(candidate.material)))];
    candidates.sort((a,b)=>a.level-b.level);
    for(let i=1;i<candidates.length;i++)if(!(candidates[i].distance>candidates[i-1].distance))throw new Error('Native LOD distances must increase');
    // Retain a conservative culling envelope across every native alternative.
    const bounds=new THREE.Box3();
    for(const candidate of candidates){if(!candidate.geometry.boundingBox)candidate.geometry.computeBoundingBox();bounds.union(candidate.geometry.boundingBox);}
    const sphere=bounds.getBoundingSphere(new THREE.Sphere());
    for(const candidate of candidates){candidate.geometry.boundingBox=bounds.clone();candidate.geometry.boundingSphere=sphere.clone();}
    if(mesh.isInstancedMesh){mesh.computeBoundingBox();mesh.computeBoundingSphere();}
    return {mesh,assetId,lodScale,candidates,origins,index:0};
  });
  return {
    update(position,force=false) {
      if(!force&&last.distanceToSquared(position)<.25)return;
      last.copy(position);updates++;
      for(const draw of draws) {
        const distance=Math.sqrt(Math.min(...draw.origins.map(origin=>origin.distanceToSquared(position))));
        let index=0;
        if(enabled)for(let i=1;i<draw.candidates.length;i++) {
          const threshold=draw.candidates[i].distance*(draw.index>=i?.9:1);
          if(distance>=threshold)index=i;
        }
        if(index===draw.index)continue;
        draw.index=index;draw.mesh.geometry=draw.candidates[index].geometry;
        draw.mesh.material=adaptMaterial?.(draw.mesh,draw.mesh.geometry)??draw.candidates[index].material;switches++;
      }
    },
    configure(options={}) {if(typeof options.enabled==='boolean')enabled=options.enabled;last.set(Infinity,Infinity,Infinity);},
    // Every geometry/material pairing a draw can switch to, so all of their shader
    // programs can be prepared before they are first seen.
    variants:()=>draws.flatMap(draw=>draw.candidates.map(candidate=>({mesh:draw.mesh,geometry:candidate.geometry,material:adaptMaterial?.(draw.mesh,candidate.geometry)??candidate.material}))),
    snapshot() {
      const levels={},assets=new Set();let triangles=0,lod0Triangles=0,nonUnitScaleDraws=0;
      for(const draw of draws) {
        const selected=draw.candidates[draw.index],instances=draw.origins.length;
        levels[selected.level]=(levels[selected.level]??0)+1;assets.add(draw.assetId);
        triangles+=(selected.geometry.index?.count??selected.geometry.attributes.position.count)/3*instances;
        lod0Triangles+=(draw.candidates[0].geometry.index?.count??draw.candidates[0].geometry.attributes.position.count)/3*instances;
        if(draw.lodScale!==1)nonUnitScaleDraws++;
      }
      return {enabled,assets:assets.size,draws:draws.length,levels,triangles,lod0Triangles,nonUnitScaleDraws,updates,switches,policy:SOURCE_LOD_POLICY};
    },
  };
}

export async function prepareSourceLods(document,group,loader,{adaptGeometry,adaptMaterial,prepareGeometry}={}) {
  if(!document)return createSourceLodController([]);
  if(!Array.isArray(document.assets)||!document.evidenceId)throw new Error('Invalid native LOD document');
  const alternatives=new Map(),assets=new Map(document.assets.map(asset=>[asset.assetId,asset]));
  const jobs=document.assets.flatMap(asset=>asset.lods.map(lod=>({asset,lod})));let next=0;
  await Promise.all(Array.from({length:Math.min(4,jobs.length)},async()=>{
    while(next<jobs.length) {
      const {asset,lod}=jobs[next++];
      if(asset.sourceLodGroup.autoLod!==false||!lod.identityNodeTransform||!lod.compositePartTransformsEqualLod0)throw new Error('Native LOD requires verified transforms and explicit group distances');
      const gltf=await loader.loadAsync(lod.url),primitives=new Map();
      prepareGeometry?.(gltf,asset,lod.level);
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse(mesh=>{if(mesh.isMesh)primitives.set(gltf.parser.associations.get(mesh)?.primitives,mesh);});
      for(const section of lod.sections) {
        if(!section.materialParametersEqualLod0||!section.sharedParameterRoot)throw new Error('Native LOD material correspondence is unverified');
        const mesh=primitives.get(section.primitiveIndex),geometry=mesh?.geometry;
        if(!geometry||!geometry.attributes.position||!geometry.attributes.normal||!geometry.attributes.uv||
          geometry.index?.count!==section.triangles*3||!mesh.matrixWorld.equals(new THREE.Matrix4()))throw new Error('Native LOD primitive does not match its source record');
        const key=`${asset.assetId}/${section.lod0MaterialId}`,rows=alternatives.get(key)??[];
        if(rows.some(row=>row.level===lod.level))throw new Error('Ambiguous native LOD material correspondence');
        rows.push({level:lod.level,distance:asset.sourceLodGroup.distances[lod.level-1],geometry});alternatives.set(key,rows);
      }
    }
  }));
  const entries=[];
  group.traverse(mesh=>{
    if(!mesh.isMesh)return;
    const assetId=mesh.userData.assetId,levels=alternatives.get(`${assetId}/${mesh.userData.sourceMaterialId}`);
    if(levels)entries.push({mesh,levels,assetId,lodScale:assets.get(assetId).lodScale});
  });
  return createSourceLodController(entries,{adaptGeometry,adaptMaterial});
}
