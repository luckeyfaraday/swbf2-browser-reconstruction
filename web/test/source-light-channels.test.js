import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {convertSourceLights} from '../src/lighting.js';
import {createSourceLightChannels} from '../src/source-light-channels.js';
import {unpackVectors} from '../src/packed-uniforms.js';

test('source light channel switches preserve every enabled direct contributor',()=>{
  const source=JSON.parse(fs.readFileSync(new URL('../public/assets/source-lights.json',import.meta.url)));
  const {lights}=convertSourceLights(source,{colorScale:1});
  for(const input of source.lights.filter(input=>input.properties.Enabled!==false)) {
    const p=input.properties,light=lights.find(light=>light.id===`${input.fileGuid}/${input.classGuid}/${input.route}`);
    if((p.Intensity??0)*(p.Dimmer??1)<=0||p.AffectDiffuse===false&&p.AffectSpecular===false)continue;
    assert.ok(light,`missing direct contribution ${input.route}`);
    assert.equal(light.affectDiffuse,p.AffectDiffuse!==false);
    assert.equal(light.affectSpecular,p.AffectSpecular!==false);
  }
  assert.ok(lights.some(light=>!light.affectDiffuse&&light.affectSpecular));
  assert.ok(lights.some(light=>light.affectDiffuse&&!light.affectSpecular));
});

test('channel updates retain shared uniforms and preceding source shader hooks',()=>{
  const channels=createSourceLightChannels(2,1),scene=new THREE.Scene();
  const material=new THREE.MeshStandardMaterial();
  material.onBeforeCompile=shader=>{shader.uniforms.sourceFloor={value:42};};
  let reflectionMode='native';
  material.customProgramCacheKey=()=> `source-floor-${reflectionMode}`;
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(),material));
  scene.add(new THREE.PointLight(),new THREE.PointLight(),new THREE.PointLight());
  channels.decorate(scene);channels.decorate(scene);
  const shader={uniforms:{},fragmentShader:'#include <lights_fragment_begin>'};
  material.onBeforeCompile(shader);
  channels.set('point',0,{affectDiffuse:false,affectSpecular:true});
  channels.set('point',1,null);
  channels.set('spot',0,{affectSpecular:false});
  assert.equal(shader.uniforms.sourceFloor.value,42);
  assert.deepEqual(unpackVectors(shader.uniforms.bf2_pointChannels.value,2),[[0,1],[0,0],[1,1]]);
  assert.deepEqual(unpackVectors(shader.uniforms.bf2_spotChannels.value,2),[[1,0]]);
  assert.match(material.customProgramCacheKey(),/^source-floor-native\|/);
  reflectionMode='pmrem';
  assert.match(material.customProgramCacheKey(),/^source-floor-pmrem\|/,'outer direct hook must retain dynamic reflection permutation keys');
  assert.equal(channels.snapshot().materials,1);
});

test('inactive LOD material variants receive native lighting once before their first switch',()=>{
  const scene=new THREE.Scene(),active=new THREE.MeshStandardMaterial(),distant=new THREE.MeshStandardMaterial();
  active.userData.recoveredMaster1UVShader={};distant.userData.recoveredMaster1UVShader={};
  const hooks=[];
  for(const [label,material] of [['active',active],['distant',distant]]) {
    material.onBeforeCompile=shader=>{hooks.push(label);shader.uniforms.originalSource={value:label};};
    material.customProgramCacheKey=()=>label;
  }
  const nativeDirect={programKey:'native-lod-test',ensureCounts(){},set(){},
    decorateShader(shader){shader.uniforms.nativeSource={value:true};},
    directCall(type,call){return `/* original-${type} */ ${call}`;},
    finalizeShader(shader){shader.uniforms.finalized={value:true};}};
  const channels=createSourceLightChannels(1,1,{nativeDirect});
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(),active);
  mesh.sourceLodMaterials=[active,distant,distant];scene.add(mesh);
  channels.decorate(scene);channels.decorate(scene);
  mesh.material=distant;channels.decorate(scene);
  const shader={uniforms:{},fragmentShader:'#include <lights_fragment_begin>'};
  mesh.material.onBeforeCompile(shader);
  assert.deepEqual(hooks,['distant']);
  assert.equal(channels.snapshot().materials,2);
  assert.equal(shader.uniforms.originalSource.value,'distant');
  assert.equal(shader.uniforms.nativeSource.value,true);
  assert.equal(shader.uniforms.finalized.value,true);
  assert.match(shader.fragmentShader,/original-point/);
  channels.set('point',0,{affectDiffuse:false,affectSpecular:true});
  assert.deepEqual(unpackVectors(shader.uniforms.bf2_pointChannels.value,2)[0],[0,1]);
  assert.match(distant.customProgramCacheKey(),/^distant\|.*native-lod-test$/);
});

test('point and spot loops run unrolled only when shadow or light maps need constant indices',async()=>{
  const {withDynamicLightLoops}=await import('../src/source-light-channels.js');
  const original=THREE.ShaderChunk.lights_fragment_begin,chunk=withDynamicLightLoops(original);
  for(const [type,condition] of [['point','#if !defined( USE_SHADOWMAP )\n'],['spot','#if !defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_MAPS == 0\n']]) {
    const at=chunk.indexOf(condition,chunk.indexOf(`Light ${type}Light;`));assert.ok(at>0,`${type} guard`);
    const dynamic=chunk.slice(at,chunk.indexOf('#else',at));
    assert.ok(!dynamic.includes('#pragma unroll_loop'));assert.ok(!/UNROLLED_LOOP_INDEX|SPOT_LIGHT_MAP_INDEX/.test(dynamic));
    assert.ok(dynamic.includes(`for ( int i = 0; i < NUM_${type.toUpperCase()}_LIGHTS; i ++ )`));
    assert.ok(dynamic.includes(`${type}Light = ${type}Lights[ i ];`));
    assert.equal(dynamic.match(/RE_Direct\(/g).length,1);
  }
  // The original unrolled loops survive verbatim for shadowed lights.
  const unrolled=original.match(/#pragma unroll_loop_start[\s\S]*?#pragma unroll_loop_end/g).slice(0,2);
  for(const block of unrolled)assert.ok(chunk.includes(`#else\n${block}\n#endif`));
  // Directional/sun/rect loops are untouched.
  assert.equal(chunk.match(/#pragma unroll_loop_start/g).length,original.match(/#pragma unroll_loop_start/g).length);
});
