import * as THREE from 'three';

// A single InstancedMesh spanning the whole level is never culled while any
// portion of its bound is visible. Partition by world-space geometry center,
// retaining every original transform and separating collision participation.
export function createStaticBatches(mesh,instances,asset,{cellSize=32,instanceIndices=null}={}) {
  if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();
  const localCenter=mesh.geometry.boundingBox.getCenter(new THREE.Vector3()),groups=new Map(),singles=[];
  for(const instance of instances) {
    const matrix=new THREE.Matrix4().multiplyMatrices(new THREE.Matrix4().fromArray(instance.matrix),mesh.matrixWorld);
    const collision=instance.collision??!!asset.collision;
    const sourceIndex=instanceIndices?.get(instance)??null;
    if(matrix.determinant()<0||mesh.morphTargetInfluences?.length) {singles.push({matrix,collision,sourceIndex});continue;}
    const center=localCenter.clone().applyMatrix4(matrix);
    const key=`${Math.floor(center.x/cellSize)},${Math.floor(center.y/cellSize)},${Math.floor(center.z/cellSize)}/${collision}`;
    if(!groups.has(key))groups.set(key,{matrices:[],sourceIndices:[],collision,key});
    groups.get(key).matrices.push(matrix);
    groups.get(key).sourceIndices.push(sourceIndex);
  }
  const batches=[];
  const decorate=(batch,collision,cell=null,sourceIndices=[])=>{
    batch.name=`${asset.id}/${mesh.name}`;batch.castShadow=asset.castShadow??true;batch.receiveShadow=true;
    batch.visible=asset.visible??true;batch.userData.mapCollision=collision;batch.userData.assetId=asset.id;batch.userData.spatialCell=cell;
    batch.userData.sourceMaterialId=mesh.userData.sourceMaterialId??mesh.material.userData?.sourceMaterialId;
    if(instanceIndices)batch.userData.sourceInstanceIndices=sourceIndices;
    batches.push(batch);
  };
  for(const {matrices,sourceIndices,collision,key}of groups.values()) {
    if(matrices.length===1){singles.push({matrix:matrices[0],collision,cell:key,sourceIndex:sourceIndices[0]});continue;}
    const batch=new THREE.InstancedMesh(mesh.geometry,mesh.material,matrices.length);
    matrices.forEach((matrix,index)=>batch.setMatrixAt(index,matrix));
    batch.instanceMatrix.needsUpdate=true;batch.computeBoundingBox();batch.computeBoundingSphere();decorate(batch,collision,key,sourceIndices);
  }
  for(const {matrix,collision,cell,sourceIndex}of singles){const batch=new THREE.Mesh(mesh.geometry,mesh.material);batch.matrix.copy(matrix);batch.matrixAutoUpdate=false;decorate(batch,collision,cell,[sourceIndex]);}
  return batches;
}
