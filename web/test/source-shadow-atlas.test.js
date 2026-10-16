import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {atlasSlotRect,nativeSpotShadowFrame,sourceSpotShadow,createShadowSlotCache,buildShadowCasterGeometries,SOURCE_SPOT_SHADOW_GLSL} from '../src/source-shadow-atlas.js';
import {nativeShadowAtlasSize,nativeShadowAtlasParam,NATIVE_SHADOW_DEFAULTS} from '../src/source-shadow-native.js';
import {projectNativeSpotShadow} from '../src/source-shadow-sampling.js';
import {fragmentSamplerCount} from '../src/source-light-channels.js';

const lights=JSON.parse(fs.readFileSync(new URL('../public/assets/source-lights.json',import.meta.url),'utf8'));

test('source eligibility selects exactly the 52 punctual CastShadows-Low spots',()=>{
  const eligible=lights.lights.filter(light=>sourceSpotShadow(light.properties,light.matrix));
  assert.equal(eligible.length,52);
  for(const light of eligible){assert.equal(light.properties.CastShadows.value,0);assert.equal(light.properties.DiscRadius,0);}
  const shadow=sourceSpotShadow(eligible[0].properties,eligible[0].matrix);
  assert.deepEqual(shadow.forward,eligible[0].matrix.slice(8,11));assert.equal(shadow.requestedResolution,512);
});

test('slot rectangles follow the native atlas side and never overlap',()=>{
  for(const [count,resolution] of [[32,512],[6,512]]) {
    const size=nativeShadowAtlasSize(count,resolution),rects=Array.from({length:count},(_,i)=>atlasSlotRect(i,count,resolution));
    for(const rect of rects){assert.equal(rect.width,resolution+8);assert.ok(rect.x+rect.width<=size&&rect.y+rect.height<=size);}
    for(let a=0;a<count;a++)for(let b=a+1;b<count;b++){const p=rects[a],q=rects[b];assert.ok(p.x+p.width<=q.x||q.x+q.width<=p.x||p.y+p.height<=q.y||q.y+q.height<=p.y);}
  }
  assert.equal(nativeShadowAtlasSize(6,512),1560);assert.throws(()=>atlasSlotRect(6,6,512),RangeError);
});

test('receiver rows and caster projection agree on native depth, border and texel rows',()=>{
  const light=lights.lights.find(row=>sourceSpotShadow(row.properties,row.matrix));
  const shadow=sourceSpotShadow(light.properties,light.matrix),position=light.matrix.slice(12,15);
  const frame=nativeSpotShadowFrame({position,forward:shadow.forward,up:shadow.up,shadow},512);
  const forward=new THREE.Vector3(...shadow.forward).normalize(),emission=forward.clone().negate();
  const rect=atlasSlotRect(1,6,512),atlas=nativeShadowAtlasParam(rect,1560);
  // Points on the emission axis: native depth 1 at near, 0 at far (reverse depth).
  for(const [distance,depth] of [[shadow.near,1],[shadow.far,0]]) {
    const p=new THREE.Vector3(...position).addScaledVector(emission,distance);
    assert.ok(Math.abs(projectNativeSpotShadow(p.toArray(),Array.from(frame.rows),atlas).depth-depth)<1e-5);
  }
  const caster=new THREE.Matrix4().multiplyMatrices(frame.casterProjection,frame.view);
  const basis=new THREE.Matrix4().extractRotation(frame.world),x=new THREE.Vector3().setFromMatrixColumn(basis,0),y=new THREE.Vector3().setFromMatrixColumn(basis,1);
  const tanHalf=Math.tan(shadow.originalFovRadians/2);
  for(const [sx,sy,d] of [[0,0,2],[.5,-.25,3],[1,0,4],[0,1,5],[-1,-1,1.5]]) {
    const p=new THREE.Vector3(...position).addScaledVector(emission,d).addScaledVector(x,sx*d*tanHalf).addScaledVector(y,sy*d*tanHalf);
    const native=projectNativeSpotShadow(p.toArray(),Array.from(frame.rows),atlas);
    const clip=new THREE.Vector4(p.x,p.y,p.z,1).applyMatrix4(caster),ndc=[clip.x/clip.w,clip.y/clip.w,clip.z/clip.w];
    // WebGL window depth equals native depth.
    assert.ok(Math.abs((ndc[2]+1)/2-native.depth)<2e-6);
    // Caster pixel in the 520 tile equals the receiver's atlas texel (border 4, flipped Y rows).
    const pixel=[rect.x+(ndc[0]*.5+.5)*rect.width,rect.y+(ndc[1]*.5+.5)*rect.height];
    // Float32 rows carry world translations near -1400: cancellation stays below 1/50 texel.
    assert.ok(Math.abs(pixel[0]-native.uv[0]*1560)<.02&&Math.abs(pixel[1]-native.uv[1]*1560)<.02,JSON.stringify({pixel,uv:native.uv}));
    if(Math.max(Math.abs(sx),Math.abs(sy))===1)assert.ok([pixel[0]-rect.x,pixel[1]-rect.y].some(v=>Math.abs(v-4)<.02||Math.abs(v-516)<.02));
  }
});

test('the slot cache reuses cached lights and evicts the least recently used unpinned light',()=>{
  const cache=createShadowSlotCache(2);
  assert.deepEqual(cache.acquire('a'),{slot:0,fresh:true});assert.deepEqual(cache.acquire('b'),{slot:1,fresh:true});
  assert.deepEqual(cache.acquire('a'),{slot:0,fresh:false});
  assert.deepEqual(cache.acquire('c',new Set(['a','c'])),{slot:1,fresh:true},'b is least recent and unpinned');
  assert.equal(cache.acquire('d',new Set(['a','c','d'])),null,'all slots pinned');
  assert.equal(NATIVE_SHADOW_DEFAULTS.atlasSlotCount,32);
});

test('published shadow-category casters rebuild with exact counts',{skip:!fs.existsSync(new URL('../public/assets/lighting/native-shadow-casters.json',import.meta.url))},()=>{
  const catalog=JSON.parse(fs.readFileSync(new URL('../public/assets/lighting/native-shadow-casters.json',import.meta.url),'utf8'));
  const bytes=fs.readFileSync(new URL('../public/assets/lighting/native-shadow-casters.bin',import.meta.url)),payload=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
  assert.equal(catalog.evidenceId,'BF2-NATIVE-SHADOW-CASTERS-PUBLISH-001');assert.equal(payload.byteLength,catalog.byteLength);
  const geometries=buildShadowCasterGeometries(catalog,payload);
  assert.equal(geometries.size,catalog.summary.castingAssets);
  let vertices=0,triangles=0;
  for(const geometry of geometries.values()){vertices+=geometry.attributes.position.count;triangles+=geometry.index.count/3;assert.ok(geometry.index.array.every(i=>i<geometry.attributes.position.count));}
  assert.equal(vertices,catalog.summary.vertices);assert.equal(triangles,catalog.summary.triangles);
});

test('receiver GLSL keeps the native filter, dimmer and projection, and the sampler budget counts decorator samplers',()=>{
  for(const token of ['bf2NativeShadowQuality1','bf2NativeShadowDimmer','bf2ProjectNativeSpotShadow','uniform sampler2D bf2_spotShadowAtlas'])assert.ok(SOURCE_SPOT_SHADOW_GLSL.includes(token));
  const material=new THREE.MeshStandardMaterial({map:new THREE.Texture()});
  const fragment='uniform sampler2D bf2_a;\nuniform sampler2DArray bf2_b;\nuniform samplerCube bf2_a;\n#ifdef USE_SHEEN_COLORMAP\nuniform sampler2D sheenColorMap;\n#endif\n';
  assert.equal(fragmentSamplerCount(fragment,material),3,'bf2_a, bf2_b and the enabled map');
});

test('spot receivers gain the shadow term in both loop variants, unless the sampler budget is full',async()=>{
  const {createSourceLightChannels}=await import('../src/source-light-channels.js');
  for(const [units,expected] of [[16,true],[0,false]]) {
    const noted=[],nativeShadows={glsl:'/*shadow glsl*/',uniforms:{bf2_spotShadowAtlas:{value:null}},programKey:'shadow-key',maxTextureUnits:units,ensureCounts(){},noteReceiver:(material,accepted,samplers)=>noted.push({accepted,samplers})};
    const scene=new THREE.Scene(),material=new THREE.MeshStandardMaterial();scene.add(new THREE.Mesh(new THREE.BoxGeometry(),material),new THREE.SpotLight());
    createSourceLightChannels(0,1,{nativeShadows}).decorate(scene);
    const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};
    material.onBeforeCompile(shader,{});
    const calls=(shader.fragmentShader.match(/bf2_spotShadow\(i,geometryPosition,geometryNormal,spotLight\.position\)/g)??[]).length;
    assert.equal(calls,expected?2:0,'dynamic and unrolled spot loops');
    assert.equal(shader.fragmentShader.startsWith('/*shadow glsl*/'),expected);assert.equal('bf2_spotShadowAtlas' in shader.uniforms,expected);
    assert.deepEqual(noted.map(row=>row.accepted),[expected]);assert.match(material.customProgramCacheKey(),/shadow-key/);
  }
});

test('sampler budget counts three units from compile parameters: scene environment, dfgLUT and arrays',async()=>{
  const {fragmentSamplerCount}=await import('../src/source-light-channels.js');
  const material=new THREE.MeshStandardMaterial();
  const parameters=(extra={})=>({shaderID:'physical',map:true,normalMap:false,envMap:true,numRectAreaLights:0,uniforms:{dfgLUT:{value:null}},...extra});
  const text='uniform sampler2D bf2_a;\nuniform highp sampler2DArray bf2_b[3];\n';
  // bf2_a + bf2_b[3] + map + envMap (from scene.environment, not material.envMap) + dfgLUT
  assert.equal(fragmentSamplerCount(text,material,parameters()),7);
  // A decorator that undefines USE_ENVMAP drops the environment sampler.
  assert.equal(fragmentSamplerCount('#undef USE_ENVMAP\n'+text,material,parameters()),6);
  // A decorator that replaced dfgLUT removed its uniform.
  assert.equal(fragmentSamplerCount(text,material,parameters({uniforms:{}})),6);
  assert.equal(fragmentSamplerCount(text,material,parameters({numRectAreaLights:1})),9);
});
