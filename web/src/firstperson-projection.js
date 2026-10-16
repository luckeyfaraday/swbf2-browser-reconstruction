import * as THREE from 'three';

export function resolveFirstPersonProjection(document,weaponId,{sourceGuid}={}) {
  const weapon=document?.weapons?.find(row=>row.weaponId===weaponId);
  if(!weapon||(sourceGuid&&weapon.source?.guid!==sourceGuid))return null;
  if(document.angleUnit!=='degrees'||document.browserPolicy?.axis!=='vertical')throw new TypeError('Unsupported recovered viewmodel projection');
  if(weapon.renderFov?.length!==2||weapon.renderFov.some(value=>!Number.isFinite(value)||value<=0||value>=180))throw new TypeError('Invalid recovered render FOV');
  return {weaponId,sourceGuid:weapon.source.guid,renderFov:[...weapon.renderFov],provenance:document.provenance,browserPolicy:document.browserPolicy};
}

/** Independent per-model projection, retaining one world render/exposure pass.
 * Native ModelDynamicState carries RenderFovDeg. Its final GPU/depth composition
 * is unresolved: this shader correction is an explicit browser reconstruction.
 */
export function createFirstPersonProjection(document,weaponId,options={}) {
  const source=resolveFirstPersonProjection(document,weaponId,options);
  if(!source)throw new TypeError('Selected source viewmodel projection is missing');
  const camera=new THREE.PerspectiveCamera(source.renderFov[0],1,.06,1500);
  const scale={value:new THREE.Vector2(1,1)},bindings=[];
  let worldFov=null,zoomIndex=0;
  const snapshot=()=>({weaponId,sourceGuid:source.sourceGuid,worldFov,renderFov:camera.fov,zoomIndex,
    scale:scale.value.toArray(),boundMeshes:bindings.length,provenance:source.provenance,browserPolicy:source.browserPolicy});
  return {
    camera,
    bind(root) {
      if(bindings.length)throw new Error('A projection instance already has a viewmodel');
      root.traverse(mesh=>{
        if(!mesh.isMesh)return;
        const original=mesh.material,frustumCulled=mesh.frustumCulled;
        const clone=material=>{
          const copy=material.clone(),before=material.onBeforeCompile,key=material.customProgramCacheKey.call(material);
          copy.onBeforeCompile=function(shader,renderer) {
            before.call(this,shader,renderer);
            if(!shader.vertexShader.includes('#include <project_vertex>'))throw new Error('Viewmodel material has no supported projection chunk');
            shader.uniforms.bf2FirstPersonProjectionScale=scale;
            shader.vertexShader='uniform vec2 bf2FirstPersonProjectionScale;\n'+shader.vertexShader.replace(
              '#include <project_vertex>','#include <project_vertex>\ngl_Position.xy *= bf2FirstPersonProjectionScale;');
          };
          copy.customProgramCacheKey=()=>`${key}|bf2-firstperson-projection-v1`;
          return copy;
        };
        mesh.material=Array.isArray(original)?original.map(clone):clone(original);
        // Renderer culling uses the world camera before this shader correction.
        // A source viewmodel outside ADS23.9 can still be inside RenderFov55.
        mesh.frustumCulled=false;
        bindings.push({mesh,original,frustumCulled,clones:Array.isArray(mesh.material)?mesh.material:[mesh.material]});
      });
      return snapshot();
    },
    update(worldCamera,{aiming=false}={}) {
      if(!worldCamera?.isPerspectiveCamera)throw new TypeError('Perspective world camera required');
      zoomIndex=aiming?1:0;worldFov=worldCamera.fov;
      camera.fov=source.renderFov[zoomIndex];camera.aspect=worldCamera.aspect;
      camera.near=worldCamera.near;camera.far=worldCamera.far;
      camera.updateProjectionMatrix();
      const world=worldCamera.projectionMatrix.elements,weapon=camera.projectionMatrix.elements;
      if(!Number.isFinite(world[0])||!Number.isFinite(world[5])||world[0]===0||world[5]===0)throw new TypeError('Finite world projection required');
      if(world[8]!==0||world[9]!==0)throw new TypeError('Off-axis viewmodel projection is not recovered');
      scale.value.set(weapon[0]/world[0],weapon[5]/world[5]);
      worldCamera.updateWorldMatrix(true,false);
      camera.matrixWorld.copy(worldCamera.matrixWorld);camera.matrixWorldInverse.copy(worldCamera.matrixWorldInverse);
      return snapshot();
    },
    snapshot,
    dispose() {
      for(const {mesh,original,frustumCulled,clones} of bindings){mesh.material=original;mesh.frustumCulled=frustumCulled;clones.forEach(material=>material.dispose());}
      bindings.length=0;
    },
  };
}
