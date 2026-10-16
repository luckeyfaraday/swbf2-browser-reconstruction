import * as THREE from 'three';
import {NATIVE_SHADOW_DEFAULTS,nativeShadowAtlasSize,nativeShadowAtlasParam,nativeShadowBorderFov,nativeShadowDepthFactors,nativeShadowBiasForFormat,nativePunctualSpotShadowParameters} from './source-shadow-native.js';
import {SOURCE_SHADOW_SAMPLING_GLSL} from './source-shadow-sampling.js';

// Browser activation of native local spot shadows. Evidence:
// BF2-NATIVE-LOCAL-SHADOW-ACTIVATION-001 (tools/materials/native-shadow-activation.md).
export const SOURCE_SHADOW_ATLAS_POLICY=Object.freeze({
  evidenceId:'BF2-NATIVE-LOCAL-SHADOW-ACTIVATION-001',
  observed:[
    'Eligibility: punctual PbrSpotLightEntityData with CastShadowsEnable, CastShadows Low(0) <= PunctualLightShadowLevel 0 (BF2-NATIVE-LOCAL-SHADOW-PRODUCER-001).',
    'Casters: LOD0 MeshSubsetCategoryFlags_Shadow sections (category 4) with original positions (BF2-NATIVE-SHADOW-CASTER-METADATA-001); positions are byte-identical to the visible GLB local space.',
    'Depth: reverse native depth A/d+B, D16 preference, ShaderDepthBiasGroup_Shadow16Bit (-10, slope -4), comparison reference > stored.',
    'Atlas: native side formula, 4-pixel tile border with expanded caster FOV and unexpanded receiver matrix; quality-1 nine-gather filter and dimmer/angle ramp.',
  ],
  inferred:[
    'Cross-API bias: ANGLE D3D11 maps polygonOffset units/factor to DepthBias/SlopeScaledDepthBias.',
    'Rasterizer culling of the native caster pass is not recovered; casters are drawn double-sided.',
    'Tile allocation order (row-major), light basis roll and the facing-ramp operand (light forward against the surface-to-light direction).',
    'Soldiers and composite meshes cast with their visible browser geometry; door leaves cast their shadow sections at the current translation.',
  ],
  adaptations:[
    'Native LocalLightShadowCacheEnable is false. The browser caches static caster depth per light (32-slot atlas) and composites dynamic casters into a live tile only when they move.',
    'Only lights in the browser spot pool can hold a tile; at most one uncached light renders its static casters per frame.',
  ],
  limitations:[
    'Materials already at the fragment sampler limit (Master2UV, 16 units) cannot bind the atlas and receive no local shadows.',
    'Native per-view caster culling/fade, caster LOD and entity-level caster overrides are not linked.',
    'Simple-quality comparison sampling is not implemented; the native default quality 1 is required.',
  ],
});

const TILE_BORDER=8,OFF=[0,0,0,0];

// Allocator rectangle for slot index in a native square atlas (row-major order inferred).
export function atlasSlotRect(index,slotCount,resolution) {
  const columns=Math.ceil(Math.sqrt(slotCount)),size=resolution+TILE_BORDER;
  if(!(index>=0&&index<slotCount))throw new RangeError('Shadow slot index outside the atlas');
  return {x:(index%columns)*size,y:Math.floor(index/columns)*size,width:size,height:size};
}

// Native spot shadow frame. The receiver rows map world positions to native clip
// space (q.z is native depth); the caster projection writes the same depth into a
// WebGL [-1,1] depth range with an expanded border FOV and a flipped Y, so texel
// rows match the receiver's (0.5,-0.5) atlas addressing.
export function nativeSpotShadowFrame({position,forward,up,shadow},resolution) {
  const z=new THREE.Vector3(...forward).normalize();
  const y=new THREE.Vector3(...up);y.addScaledVector(z,-y.dot(z)).normalize();
  const x=new THREE.Vector3().crossVectors(y,z).normalize();
  const world=new THREE.Matrix4().makeBasis(x,y,z).setPosition(...position),view=world.clone().invert();
  const [a,b]=nativeShadowDepthFactors(shadow.near,shadow.far,true);
  const f=1/Math.tan(shadow.originalFovRadians/2),fe=1/Math.tan(nativeShadowBorderFov(shadow.originalFovRadians,resolution)/2);
  const receiverProjection=new THREE.Matrix4().set(f,0,0,0, 0,f,0,0, 0,0,-b,a, 0,0,-1,0);
  const casterProjection=new THREE.Matrix4().set(fe,0,0,0, 0,-fe,0,0, 0,0,-(2*b-1),2*a, 0,0,-1,0);
  const clip=receiverProjection.multiply(view),e=clip.elements;
  const rows=new Float32Array(16);for(let r=0;r<4;r++)for(let c=0;c<4;c++)rows[r*4+c]=e[c*4+r];
  return {world,view,rows,casterProjection,depthFactors:[a,b],near:shadow.near,far:shadow.far};
}

// Light descriptor eligibility from the source record, or null.
export function sourceSpotShadow(properties,matrix) {
  if(!properties?.$type?.endsWith('PbrSpotLightEntityData')||properties.DiscRadius!==0)return null;
  const shadow=nativePunctualSpotShadowParameters(properties);
  if(!shadow.enabledBySourceLevel)return null;
  return {...shadow,forward:matrix.slice(8,11),up:matrix.slice(4,7)};
}

// Least-recently-used assignment of light ids to cached static atlas slots.
export function createShadowSlotCache(capacity) {
  const slots=new Map(),order=[];let free=Array.from({length:capacity},(_,i)=>i);
  return {
    acquire(id,pinned=new Set()) {
      const touch=()=>{order.splice(order.indexOf(id),1);order.push(id);};
      if(slots.has(id)){touch();return {slot:slots.get(id),fresh:false};}
      let slot=free.shift();
      if(slot===undefined) {
        const victim=order.find(candidate=>!pinned.has(candidate));
        if(victim===undefined)return null;
        slot=slots.get(victim);slots.delete(victim);order.splice(order.indexOf(victim),1);
      }
      slots.set(id,slot);order.push(id);return {slot,fresh:true};
    },
    has:id=>slots.has(id),size:()=>slots.size,
  };
}

const DEPTH_VERTEX=`#include <common>
#include <skinning_pars_vertex>
void main() {
  #include <begin_vertex>
  #include <skinbase_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
}`;

function depthMaterial(bias) {
  return new THREE.ShaderMaterial({name:'bf2NativeShadowCaster',vertexShader:DEPTH_VERTEX,fragmentShader:'void main(){}',
    side:THREE.DoubleSide,colorWrite:false,depthWrite:true,depthTest:true,depthFunc:THREE.GreaterDepth,
    polygonOffset:true,polygonOffsetFactor:bias.slopeScaledDepthBias,polygonOffsetUnits:bias.depthBias,toneMapped:false,fog:false,lights:false});
}

// Shadow-category caster geometry, one BufferGeometry per asset.
export function buildShadowCasterGeometries(catalog,payload) {
  const geometries=new Map();
  for(const asset of catalog.assets) {
    let vertices=0,indices=0;for(const s of asset.sections){vertices+=s.vertexCount;indices+=s.indexCount;}
    const position=new Float32Array(vertices*3),index=new Uint32Array(indices);let v=0,k=0;
    for(const s of asset.sections) {
      position.set(new Float32Array(payload,s.positionsOffset,s.vertexCount*3),v*3);
      const source=new Uint32Array(payload,s.indicesOffset,s.indexCount);
      for(let i=0;i<source.length;i++)index[k+i]=source[i]+v;
      v+=s.vertexCount;k+=s.indexCount;
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(position,3));geometry.setIndex(new THREE.BufferAttribute(index,1));
    geometry.computeBoundingBox();geometry.computeBoundingSphere();geometry.name=`${asset.assetId}/shadow-category`;
    geometries.set(asset.assetId,geometry);
  }
  return geometries;
}

export async function loadShadowCasterCatalog(url='/assets/lighting/native-shadow-casters.json') {
  const response=await fetch(url);if(!response.ok)return null;
  const catalog=await response.json();
  if(catalog.evidenceId!=='BF2-NATIVE-SHADOW-CASTERS-PUBLISH-001')throw new Error('Unexpected shadow caster catalog');
  const payload=await (await fetch(catalog.url)).arrayBuffer();
  if(payload.byteLength!==catalog.byteLength)throw new Error('Shadow caster payload length mismatch');
  return {catalog,payload};
}

// Per-slot shadow data lives in one std140 uniform block, uploaded once per frame.
// As plain uniform arrays three re-uploads them, uncached, on every material
// switch; on a GPU-bound integrated GPU that command volume stalls the main
// thread. GLSL ES 3.00 has no binding qualifier, so the block uses the default
// binding point 0, which this runtime reserves for it (no other UBOs exist).
export const SPOT_SHADOW_BLOCK=Object.freeze({name:'BF2SpotShadows',binding:0,capacity:8});
const BLOCK_FLOATS={rows:0,rect:SPOT_SHADOW_BLOCK.capacity*16,params:SPOT_SHADOW_BLOCK.capacity*20,light:SPOT_SHADOW_BLOCK.capacity*24,forward:SPOT_SHADOW_BLOCK.capacity*28,total:SPOT_SHADOW_BLOCK.capacity*32};

export const SOURCE_SPOT_SHADOW_GLSL=`
#if NUM_SPOT_LIGHTS > 0
#define BF2_SPOT_SHADOW_CAPACITY ${SPOT_SHADOW_BLOCK.capacity}
uniform sampler2D bf2_spotShadowAtlas;
uniform int bf2_spotShadowAtlasSize;
layout(std140) uniform ${SPOT_SHADOW_BLOCK.name} {
  vec4 bf2_spotShadowRows[BF2_SPOT_SHADOW_CAPACITY*4];
  vec4 bf2_spotShadowRect[BF2_SPOT_SHADOW_CAPACITY];
  vec4 bf2_spotShadowParams[BF2_SPOT_SHADOW_CAPACITY];
  vec4 bf2_spotShadowLight[BF2_SPOT_SHADOW_CAPACITY];
  vec4 bf2_spotShadowForward[BF2_SPOT_SHADOW_CAPACITY];
};
${SOURCE_SHADOW_SAMPLING_GLSL}
// params: enabled, source ShadowDimmer, native angleScale, angleOffset.
// Single exit with nested branches: early returns from this function, inlined into
// the dynamic light loop, multiplied FXC compile time. A back-facing light, a pixel
// beyond the shadow ramp or outside the original projection keep 1.0 (no dimming).
// The projection is bf2ProjectNativeSpotShadow inlined.
float bf2_spotShadow(int i, vec3 viewPosition, vec3 viewNormal, vec3 lightViewPosition) {
  float shadow=1.0;
  if(i<BF2_SPOT_SHADOW_CAPACITY) {
    vec4 params=bf2_spotShadowParams[i];
    if(params.x>0.5&&dot(viewNormal,lightViewPosition-viewPosition)>0.0) {
      vec4 p=vec4((vec4(viewPosition,0.0)*viewMatrix).xyz+cameraPosition,1.0);
      float ramp=clamp(dot(bf2_spotShadowForward[i].xyz,normalize(bf2_spotShadowLight[i].xyz-p.xyz))*params.z+params.w,0.0,1.0);
      ramp*=ramp;
      if(ramp>0.0) {
        vec4 clip=vec4(dot(p,bf2_spotShadowRows[i*4]),dot(p,bf2_spotShadowRows[i*4+1]),dot(p,bf2_spotShadowRows[i*4+2]),dot(p,bf2_spotShadowRows[i*4+3]));
        vec3 q=clip.xyz/clip.w;vec4 atlas=bf2_spotShadowRect[i];
        vec2 uv=(q.xy*vec2(0.5,-0.5)+0.5)*atlas.zw+atlas.xy;
        if(max(max(abs(q.x),abs(q.y)),1.0-q.z)<=1.0&&uv.x>=0.0)
          shadow=bf2NativeShadowDimmer(bf2NativeShadowQuality1(bf2_spotShadowAtlas,vec3(uv,q.z),bf2_spotShadowAtlasSize),params.y,ramp);
      }
    }
  }
  return shadow;
}
#endif
`;

export function createSourceShadowAtlas(renderer,{catalog,payload,manifest,doorInstances=new Set(),fallbackBatches=[],poolSlots=6,cellSize=48,settings=NATIVE_SHADOW_DEFAULTS,staticRendersPerFrame=1,diagnostic=null}) {
  if(settings.filterQuality!==1)throw new Error('Only the native default quality-1 shadow filter is implemented');
  const resolution=settings.atlasSlotResolution,bias=nativeShadowBiasForFormat(123);
  const staticSize=nativeShadowAtlasSize(settings.atlasSlotCount,resolution),liveSize=nativeShadowAtlasSize(poolSlots,resolution);
  const atlas=size=>{
    const target=new THREE.WebGLRenderTarget(size,size,{format:THREE.RedFormat,type:THREE.UnsignedByteType,depthBuffer:true,stencilBuffer:false,generateMipmaps:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
    target.depthTexture=new THREE.DepthTexture(size,size,THREE.UnsignedShortType);
    target.depthTexture.minFilter=target.depthTexture.magFilter=THREE.NearestFilter;target.scissorTest=true;return target;
  };
  const staticAtlas=atlas(staticSize),liveAtlas=atlas(liveSize);
  staticAtlas.texture.name='Native shadow static cache atlas';liveAtlas.texture.name='Native shadow live atlas';
  const materials={instanced:depthMaterial(bias),skinned:depthMaterial(bias),plain:depthMaterial(bias)};
  const camera=new THREE.PerspectiveCamera();camera.matrixAutoUpdate=false;camera.matrixWorldAutoUpdate=false;

  // Static casters: shadow-category geometry instanced over every non-door placement,
  // partitioned into spatial cells so each light frustum culls most of the map.
  const staticScene=new THREE.Scene();staticScene.matrixAutoUpdate=false;staticScene.matrixWorldAutoUpdate=false;
  const geometries=buildShadowCasterGeometries(catalog,payload),assets=new Map(manifest.assets.map(asset=>[asset.id,asset]));
  const groups=new Map();let staticInstances=0;
  manifest.instances.forEach((instance,index)=>{
    const geometry=geometries.get(instance.assetId);
    if(!geometry||doorInstances.has(index)||assets.get(instance.assetId)?.visible===false)return;
    const matrix=new THREE.Matrix4().fromArray(instance.matrix),center=geometry.boundingSphere.center.clone().applyMatrix4(matrix);
    const key=`${instance.assetId}|${Math.floor(center.x/cellSize)},${Math.floor(center.y/cellSize)},${Math.floor(center.z/cellSize)}`;
    if(!groups.has(key))groups.set(key,{geometry,matrices:[]});groups.get(key).matrices.push(matrix);staticInstances++;
  });
  const addInstanced=(geometry,matrices,name)=>{
    const mesh=new THREE.InstancedMesh(geometry,materials.instanced,matrices.length);
    matrices.forEach((matrix,i)=>mesh.setMatrixAt(i,matrix));mesh.instanceMatrix.needsUpdate=true;
    mesh.computeBoundingSphere();mesh.matrixAutoUpdate=false;mesh.name=name;staticScene.add(mesh);return mesh;
  };
  for(const [key,{geometry,matrices}] of groups)addInstanced(geometry,matrices,key);
  // Composite meshes without exported shadow sections cast with their visible LOD0 batches.
  let fallbackDraws=0;
  for(const batch of fallbackBatches) {
    if(batch.isInstancedMesh){const mesh=new THREE.InstancedMesh(batch.geometry,materials.instanced,batch.count);mesh.instanceMatrix=batch.instanceMatrix;mesh.computeBoundingSphere();mesh.matrixAutoUpdate=false;staticScene.add(mesh);}
    else{batch.updateWorldMatrix(true,false);addInstanced(batch.geometry,[batch.matrixWorld.clone()],batch.name);}
    fallbackDraws++;
  }

  // Dynamic casters are proxies sharing geometry/skeletons/matrices of live objects.
  const dynamicScene=new THREE.Scene();dynamicScene.matrixAutoUpdate=false;dynamicScene.matrixWorldAutoUpdate=false;
  const proxies=new Map();
  function proxiesFor(key,root,makeProxies) {
    let entry=proxies.get(key);
    if(!entry){entry={root,meshes:makeProxies()};entry.meshes.forEach(row=>dynamicScene.add(row.proxy));proxies.set(key,entry);}
    return entry;
  }
  const actorProxies=root=>{
    const rows=[];
    root.traverse(object=>{
      // Emissive parts (a lightsaber blade) are flagged as non-casters.
      if(!object.isMesh||object.userData.noShadowCaster)return;
      let proxy;
      if(object.isSkinnedMesh){proxy=new THREE.SkinnedMesh(object.geometry,materials.skinned);proxy.bind(object.skeleton,object.bindMatrix);proxy.bindMode=object.bindMode;}
      else proxy=new THREE.Mesh(object.geometry,materials.plain);
      proxy.matrixAutoUpdate=false;proxy.frustumCulled=false;rows.push({source:object,proxy});
    });
    return rows;
  };

  const slotCache=createShadowSlotCache(settings.atlasSlotCount),staticReady=new Set(),frames=new Map();
  const live=Array.from({length:poolSlots},()=>({lightId:null,dynamicKeys:'',hadActors:false,stale:false}));
  if(poolSlots>SPOT_SHADOW_BLOCK.capacity)throw new Error('Spot pool exceeds the native shadow block capacity');
  const gl=renderer.getContext(),block=new Float32Array(BLOCK_FLOATS.total),buffer=gl.createBuffer();let blockDirty=true;
  gl.bindBuffer(gl.UNIFORM_BUFFER,buffer);gl.bufferData(gl.UNIFORM_BUFFER,block.byteLength,gl.DYNAMIC_DRAW);gl.bindBuffer(gl.UNIFORM_BUFFER,null);
  const write=(field,index,values)=>{const at=BLOCK_FLOATS[field]+index*4;for(let k=0;k<4;k++)if(block[at+k]!==values[k]){block[at+k]=values[k];blockDirty=true;}};
  const uniforms={bf2_spotShadowAtlas:{value:liveAtlas.depthTexture},bf2_spotShadowAtlasSize:{value:liveSize}};
  function ensureCounts(spotCount){if(spotCount>SPOT_SHADOW_BLOCK.capacity)console.warn(`Spot lights beyond ${SPOT_SHADOW_BLOCK.capacity} receive no native shadows`);}
  const stats={blockUploads:0,staticRenders:0,liveRefreshes:0,skippedOffscreen:0,staticDraws:0,dynamicDraws:0,activeSlots:0,frames:0,receiverMaterials:0,skippedReceivers:[]};

  const frustum=new THREE.Frustum(),viewFrustum=new THREE.Frustum(),viewProjection=new THREE.Matrix4(),sphere=new THREE.Sphere();
  function useLight(frame) {
    camera.projectionMatrix.copy(frame.casterProjection);camera.projectionMatrixInverse.copy(frame.casterProjection).invert();
    camera.matrixWorld.copy(frame.world);camera.matrixWorldInverse.copy(frame.view);
    frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(frame.casterProjection,frame.view));
  }
  function bindRect(target,rect){target.viewport.set(rect.x,rect.y,rect.width,rect.height);target.scissor.set(rect.x,rect.y,rect.width,rect.height);renderer.setRenderTarget(target);}
  function draw(scene) {
    const autoClear=renderer.autoClear;renderer.autoClear=false;
    renderer.render(scene,camera);renderer.autoClear=autoClear;return renderer.info.render.calls;
  }
  function renderStatic(slot,frame) {
    useLight(frame);bindRect(staticAtlas,atlasSlotRect(slot,settings.atlasSlotCount,resolution));
    const depth=renderer.state.buffers.depth;depth.setClear(0);renderer.clear(false,true,false);depth.setClear(1);
    stats.staticDraws+=draw(staticScene);stats.staticRenders++;
  }
  // Static tile -> live tile depth copy as a draw. A partial depth blitFramebuffer
  // takes a staging path on ANGLE D3D11 and stalls the main thread. D16 texels
  // written through gl_FragDepth re-quantize to the same values.
  const copyOffset=new THREE.Vector2(),copyScene=new THREE.Scene();copyScene.matrixAutoUpdate=false;copyScene.matrixWorldAutoUpdate=false;
  const copyQuad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.ShaderMaterial({name:'bf2NativeShadowTileCopy',
    uniforms:{source:{value:staticAtlas.depthTexture},offset:{value:copyOffset}},
    vertexShader:'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader:'uniform sampler2D source;uniform vec2 offset;void main(){gl_FragDepth=texelFetch(source,ivec2(gl_FragCoord.xy+offset),0).r;}',
    depthTest:true,depthFunc:THREE.AlwaysDepth,depthWrite:true,colorWrite:false,toneMapped:false}));
  copyQuad.frustumCulled=false;copyScene.add(copyQuad);
  let skinnedFrame=0;
  function refreshLive(index,slot,frame,dynamic) {
    useLight(frame);const source=atlasSlotRect(slot,settings.atlasSlotCount,resolution),target=atlasSlotRect(index,poolSlots,resolution);
    bindRect(liveAtlas,target);
    copyOffset.set(source.x-target.x,source.y-target.y);draw(copyScene);
    if(dynamic.length) {
      for(const entry of proxies.values())for(const row of entry.meshes)row.proxy.visible=false;
      // Skin once per frame across all shadow passes; three re-skins per render call.
      const nextRenderFrame=renderer.info.render.frame+1;
      for(const entry of dynamic)for(const row of entry.meshes) {
        row.proxy.visible=row.source.visible;if(!row.proxy.visible)continue;
        row.proxy.matrix.copy(row.source.matrixWorld);row.proxy.matrixWorld.copy(row.source.matrixWorld);
        if(row.proxy.isSkinnedMesh) {
          row.proxy.bindMatrix.copy(row.source.bindMatrix);row.proxy.bindMatrixInverse.copy(row.source.bindMatrixInverse);
          const skeleton=row.proxy.skeleton;if(skeleton.bf2ShadowFrame!==skinnedFrame){skeleton.update();skeleton.bf2ShadowFrame=skinnedFrame;}
          skeleton.frame=nextRenderFrame;
        }
      }
      stats.dynamicDraws+=draw(dynamicScene);
    }
    stats.liveRefreshes++;
  }
  // Bounds of dynamic casters once per frame. Actor roots sit directly under the
  // static scene root, so their position is a world position; full actor matrix
  // updates run only for actors inside some light frustum. Doors recompute only
  // when their translation changes.
  const doorState=new Map();
  function prepareCasters(actors,doors) {
    const preparedActors=[],preparedDoors=[];
    for(const actor of actors) {
      if(!actor.alive||!actor.root.visible)continue;
      const center=actor.root.position.clone();center.y+=.9;
      preparedActors.push({actor,sphere:new THREE.Sphere(center,1.3),updated:false});
    }
    for(const door of doors) {
      const geometry=geometries.get(door.instance.assetId);if(!geometry)continue;
      const key=door.root.position.toArray().join();let state=doorState.get(door.key);
      const moved=!!state&&state.key!==key;
      if(!state||moved) {
        door.root.updateMatrixWorld(true);door.source.matrixWorld.multiplyMatrices(door.root.matrixWorld,door.instanceMatrix);
        state={key,sphere:geometry.boundingSphere.clone().applyMatrix4(door.source.matrixWorld)};doorState.set(door.key,state);
      }
      preparedDoors.push({door,geometry,moved,sphere:state.sphere});
    }
    return {preparedActors,preparedDoors};
  }

  return {
    // Compile every caster program up front (instanced static casters, skinned and
    // plain proxies) with an atlas target bound so program keys match the real
    // passes; a soldier first entering a shadowed light then compiles nothing.
    async prepare(actorRoots=[]) {
      const group=new THREE.Group(),target=renderer.getRenderTarget(),box=new THREE.BoxGeometry();
      const instanced=staticScene.children.find(child=>child.isInstancedMesh);
      if(instanced)group.add(new THREE.InstancedMesh(instanced.geometry,materials.instanced,1));
      for(const root of actorRoots)for(const {proxy} of actorProxies(root))group.add(proxy);
      // Plain proxies: door leaves use normal-less shadow sections, actors' rigid
      // parts (weapons) carry normals; each is a distinct program.
      if(instanced)group.add(new THREE.Mesh(instanced.geometry,materials.plain));
      group.add(new THREE.Mesh(box,materials.plain));
      // The static->live tile copy runs on the first live refresh; compile it against the live atlas too.
      try{renderer.setRenderTarget(staticAtlas);await renderer.compileAsync(group,camera,staticScene);renderer.setRenderTarget(liveAtlas);await renderer.compileAsync(copyScene,camera);}
      finally{renderer.setRenderTarget(target);group.clear();box.dispose();}
    },
    uniforms,ensureCounts,glsl:SOURCE_SPOT_SHADOW_GLSL,programKey:'bf2-native-spot-shadow-atlas-v1',
    maxTextureUnits:diagnostic==='no-receiver-programs'?0:renderer.capabilities.maxTextures,
    noteReceiver(material,accepted,samplers){if(accepted)stats.receiverMaterials++;else stats.skippedReceivers.push({material:material.name,samplers:samplers.length,names:samplers});},
    // slots: current spot pool descriptor per index; casters: {actors:[{id,root,alive}], doors:[{key,root,instance}]}.
    update(slots,{actors=[],doors=[],camera:view=null}={}) {
      stats.frames++;skinnedFrame++;let staticBudget=staticRendersPerFrame,active=0;
      const previousTarget=renderer.getRenderTarget(),pinned=new Set(slots.filter(Boolean).map(light=>light.id));
      if(view){view.updateMatrixWorld();viewFrustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(view.projectionMatrix,view.matrixWorldInverse));}
      let casters=null;
      for(let index=0;index<poolSlots;index++) {
        const light=slots[index],state=live[index];
        if(!light?.shadow){write('params',index,OFF);state.lightId=null;continue;}
        let frame=frames.get(light.id);
        if(!frame){frame=nativeSpotShadowFrame({position:light.position,forward:light.shadow.forward,up:light.shadow.up,shadow:light.shadow},resolution);frames.set(light.id,frame);}
        const cached=slotCache.acquire(light.id,pinned);
        if(!cached){write('params',index,OFF);continue;}
        if(cached.fresh)staticReady.delete(cached.slot);
        let dirty=state.lightId!==light.id||state.stale;
        if(!staticReady.has(cached.slot)) {
          if(staticBudget<=0){write('params',index,OFF);state.lightId=null;continue;}
          renderStatic(cached.slot,frame);staticReady.add(cached.slot);staticBudget--;dirty=true;
        }
        // A light whose range is outside the view keeps its tile and refreshes on re-entry.
        sphere.center.fromArray(light.position);sphere.radius=light.shadow.far;
        if(!view||viewFrustum.intersectsSphere(sphere)) {
          casters??=prepareCasters(actors,doors);useLight(frame);
          const dynamic=[],keys=[];let hasActors=false,doorMoved=false;
          for(const prepared of casters.preparedActors) {
            if(!frustum.intersectsSphere(prepared.sphere))continue;
            if(!prepared.updated){prepared.actor.root.updateMatrixWorld(true);prepared.updated=true;}
            dynamic.push(proxiesFor(`actor:${prepared.actor.id}`,prepared.actor.root,()=>actorProxies(prepared.actor.root)));hasActors=true;
          }
          for(const {door,geometry,moved,sphere:bounds} of casters.preparedDoors) {
            if(!frustum.intersectsSphere(bounds))continue;
            dynamic.push(proxiesFor(`door:${door.key}`,door.root,()=>[{source:door.source,proxy:Object.assign(new THREE.Mesh(geometry,materials.plain),{matrixAutoUpdate:false,frustumCulled:false})}]));
            keys.push(door.key);doorMoved||=moved;
          }
          const dynamicKeys=keys.join('|');
          // Actors animate every frame; doors only while they translate.
          if(dirty||(diagnostic!=='no-refresh'&&(hasActors||state.hadActors||doorMoved||dynamicKeys!==state.dynamicKeys)))refreshLive(index,cached.slot,frame,dynamic);
          state.dynamicKeys=dynamicKeys;state.hadActors=hasActors;state.stale=false;
        } else {state.stale=true;stats.skippedOffscreen++;}
        state.lightId=light.id;
        const shadow=light.shadow;
        for(let r=0;r<4;r++)write('rows',index*4+r,frame.rows.subarray(r*4,r*4+4));
        write('rect',index,nativeShadowAtlasParam(atlasSlotRect(index,poolSlots,resolution),liveSize));
        write('params',index,[diagnostic==='no-receivers'?0:1,shadow.sourceShadowDimmer,shadow.angleScale,shadow.angleOffset]);
        write('light',index,[...light.position,1]);
        const forward=new THREE.Vector3(...shadow.forward).normalize();write('forward',index,[forward.x,forward.y,forward.z,0]);
        active++;
      }
      stats.activeSlots=active;
      renderer.setRenderTarget(previousTarget);
      if(blockDirty){gl.bindBuffer(gl.UNIFORM_BUFFER,buffer);gl.bufferSubData(gl.UNIFORM_BUFFER,0,block);gl.bindBuffer(gl.UNIFORM_BUFFER,null);blockDirty=false;stats.blockUploads++;}
      gl.bindBufferBase(gl.UNIFORM_BUFFER,SPOT_SHADOW_BLOCK.binding,buffer);
    },
    // Diagnostic: copy a live tile's depth into a float target and summarize it.
    debugTile(index,which='live') {
      const source=which==='live'?liveAtlas:staticAtlas,rect=which==='live'?atlasSlotRect(index,poolSlots,resolution):atlasSlotRect(index,settings.atlasSlotCount,resolution),size=64,target=new THREE.WebGLRenderTarget(size,size,{type:THREE.FloatType,format:THREE.RGBAFormat});
      const quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.ShaderMaterial({uniforms:{depth:{value:source.depthTexture},rect:{value:new THREE.Vector4(rect.x,rect.y,rect.width,rect.height)}},
        vertexShader:'varying vec2 v;void main(){v=position.xy*0.5+0.5;gl_Position=vec4(position.xy,0.0,1.0);}',
        fragmentShader:'uniform sampler2D depth;uniform vec4 rect;varying vec2 v;void main(){float d=texelFetch(depth,ivec2(rect.xy+v*rect.zw),0).r;gl_FragColor=vec4(d,0.0,0.0,1.0);}'}));
      quad.frustumCulled=false;const scene=new THREE.Scene();scene.add(quad);const previous=renderer.getRenderTarget();renderer.setRenderTarget(target);renderer.render(scene,camera);
      const pixels=new Float32Array(size*size*4);renderer.readRenderTargetPixels(target,0,0,size,size,pixels);renderer.setRenderTarget(previous);
      let min=Infinity,max=-Infinity,nonzero=0;for(let i=0;i<pixels.length;i+=4){const d=pixels[i];min=Math.min(min,d);max=Math.max(max,d);if(d>0)nonzero++;}
      target.dispose();quad.geometry.dispose();quad.material.dispose();return {index,rect,min,max,nonzeroFraction:nonzero/(size*size),lightId:which==='live'?live[index].lightId:null,which};
    },
    snapshot:()=>({...stats,skippedReceivers:stats.skippedReceivers.slice(0,8),skippedReceiverCount:stats.skippedReceivers.length,cachedLights:slotCache.size(),
      staticInstances,staticDrawObjects:staticScene.children.length,fallbackDraws,dynamicProxies:proxies.size,atlas:{static:staticSize,live:liveSize,resolution,format:'DEPTH_COMPONENT16',bias},
      casters:catalog.summary,policy:SOURCE_SHADOW_ATLAS_POLICY}),
    dispose(){gl.deleteBuffer(buffer);staticAtlas.dispose();liveAtlas.dispose();copyQuad.geometry.dispose();copyQuad.material.dispose();Object.values(materials).forEach(material=>material.dispose());geometries.forEach(geometry=>geometry.dispose());},
  };
}
