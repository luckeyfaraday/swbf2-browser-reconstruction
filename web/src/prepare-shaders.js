import * as THREE from 'three';

// Submit the spawn view's programs together while the deployment UI remains
// responsive. These temporary objects share immutable geometry and materials;
// no live objects are removed, reparented or hidden.
export async function prepareVisibleShaders(renderer,scene,camera,exposure) {
  scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);
  const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
  const subset=new THREE.Group();let meshes=0;
  scene.traverseVisible(object=>{
    if(!object.isMesh||!object.layers.test(camera.layers))return;
    if(object.frustumCulled&&!frustum.intersectsObject(object))return;
    subset.add(object.clone(false));meshes++;
  });
  const started=performance.now();
  if(exposure)await exposure.prepare(scene,camera,subset);
  else await renderer.compileAsync(subset,camera,scene);
  subset.clear();
  return {meshes,milliseconds:Math.round(performance.now()-started),parallel:renderer.extensions.has('KHR_parallel_shader_compile')};
}

// Every program the map can use: all meshes regardless of view plus every native
// LOD alternative. A program compiled on first use blocks the page, for seconds
// each on ANGLE/D3D11, so unseen areas otherwise freeze the game mid-round.
// Returns the materials whose programs failed to link (for example over the
// fragment sampler limit) so callers can report or repair them.
export async function prepareAllShaders(renderer,scene,camera,exposure,{variants=[]}={}) {
  scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);
  const subset=new THREE.Group();let meshes=0;
  scene.traverse(object=>{if(object.isMesh&&object.visible){subset.add(object.clone(false));meshes++;}});
  for(const {mesh,geometry,material} of variants){const copy=mesh.clone(false);copy.geometry=geometry;copy.material=material;subset.add(copy);meshes++;}
  const started=performance.now();
  if(exposure)await exposure.prepare(scene,camera,subset);
  else await renderer.compileAsync(subset,camera,scene);
  const failed=new Map();let programs=0;
  subset.traverse(object=>{
    if(!object.isMesh)return;
    for(const material of [].concat(object.material)) {
      for(const program of renderer.properties.get(material).programs?.values()??[]) {
        programs++;program.getUniforms();
        if(program.diagnostics&&program.diagnostics.runnable===false)failed.set(material,program.diagnostics.programLog?.trim()??'link failed');
      }
    }
  });
  subset.clear();
  return {meshes,milliseconds:Math.round(performance.now()-started),programs:renderer.info.programs.length,
    failed:[...failed].map(([material,log])=>({material,name:material.name,log}))};
}

// Every texture the scene (and its LOD alternatives) can sample, uploaded during
// loading. Textures otherwise upload when an area is first seen, which stalled a
// single frame for over a second when a player reached the far side of the map.
export function prepareAllTextures(renderer,scene,{variants=[]}={}) {
  const started=performance.now(),seen=new Set();
  const visit=material=>{
    if(!material)return;
    for(const value of Object.values(material))if(value?.isTexture)seen.add(value);
    for(const uniform of Object.values(material.uniforms??{})){const value=uniform?.value;if(value?.isTexture)seen.add(value);else if(Array.isArray(value))for(const item of value)if(item?.isTexture)seen.add(item);}
  };
  scene.traverse(object=>{for(const material of [].concat(object.material??[]))visit(material);});
  for(const {material} of variants)for(const item of [].concat(material??[]))visit(item);
  let uploaded=0;
  for(const texture of seen){if(texture.isRenderTargetTexture||texture.isDepthTexture)continue;renderer.initTexture(texture);uploaded++;}
  return {textures:uploaded,milliseconds:Math.round(performance.now()-started)};
}
