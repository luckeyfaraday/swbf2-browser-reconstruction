import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {getDFGLUT} from 'three/src/renderers/shaders/DFGLUTData.js';
import {createSourceDfgTexture,packSourceIesIntoDfg,packThreeDfgIntoSourceLookup,injectSharedThreeDfg,sampleSourceDfg,prepareSourceDfg} from '../src/source-dfg.js';
import {createSourceIesTexture} from '../src/source-ies.js';
import {createSourceDirectAdapter} from '../src/source-direct-adapter.js';
import {createSourceLightChannels} from '../src/source-light-channels.js';
const read=path=>readFileSync(new URL(`../public${path}`,import.meta.url));
const doc=JSON.parse(read('/assets/source-dfg.json')),iesDoc=JSON.parse(read('/assets/lighting/source-ies.json'));
const buffer=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
function packed(){
  const dfg=createSourceDfgTexture(doc,buffer(read(doc.url))),ies=createSourceIesTexture(iesDoc,buffer(read(iesDoc.url)));
  packSourceIesIntoDfg(dfg,ies);ies.dispose();return dfg;
}

test('shared128x128x2 array preserves every source word and every original Three fallback half without mutation',()=>{
  const source=packed(),original=source.image.data,fallback=getDFGLUT(),before=fallback.image.data.slice();
  const texture=packThreeDfgIntoSourceLookup(source);
  assert.equal(texture.isDataArrayTexture,true);assert.notEqual(texture,source);
  assert.equal(source.image.data,original);assert.equal(source.image.height,128);
  assert.equal(texture.image.height,128);assert.equal(texture.image.width,128);assert.equal(texture.image.depth,2);
  assert.notEqual(texture.image.data.buffer,original.buffer);
  assert.deepEqual(texture.image.data.subarray(0,original.length),original);
  assert.deepEqual(fallback.image.data,before);
  for(let y=0;y<16;y++)for(let x=0;x<16;x++)for(let c=0;c<2;c++)
    assert.equal(texture.image.data[((128+y)*128+x)*4+c],before[(y*16+x)*2+c]);
  for(let y=128;y<256;y++)for(let x=0;x<128;x++)for(let c=0;c<4;c++)
    if(y>=144||x>=16||c>=2)assert.equal(texture.image.data[(y*128+x)*4+c],0);
  assert.equal(texture.wrapS,THREE.RepeatWrapping);assert.equal(texture.wrapT,THREE.ClampToEdgeWrapping);
  assert.equal(texture.minFilter,THREE.LinearFilter);assert.equal(texture.magFilter,THREE.LinearFilter);
  assert.equal(texture.generateMipmaps,false);assert.equal(texture.flipY,false);
  texture.dispose();source.dispose();
});

test('source CPU DFG sampling remains unchanged after adding the independent fallback region',()=>{
  const source=packed(),cases=[];
  for(const x of [-2,0,.5/128,.23,.77,127.5/128,1,2])for(const r of [-2,0,.125,.5,.95,1,2])cases.push([x,r]);
  const before=cases.map(([x,r])=>sampleSourceDfg(source,x,r));
  const texture=packThreeDfgIntoSourceLookup(source);
  cases.forEach(([x,r],i)=>assert.deepEqual(sampleSourceDfg(texture,x,r),before[i]));texture.dispose();source.dispose();
});

test('final shared lookup hook replaces only the two Three table accesses and retains fallback direct response',()=>{
  const source=packed(),texture=packThreeDfgIntoSourceLookup(source);source.dispose();
  const shader={uniforms:THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms),fragmentShader:THREE.ShaderLib.standard.fragmentShader};
  injectSharedThreeDfg(shader,texture);
  assert.ok(!shader.fragmentShader.includes('dfgLUT'));
  assert.equal((shader.fragmentShader.match(/uniform highp sampler2DArray bf2_sourceDFG;/g)||[]).length,1);
  assert.ok(!shader.fragmentShader.includes('texture2D(bf2_sourceDFG'));
  assert.match(shader.fragmentShader,/vec3\(uv \/ 8\.0, 1\.0\)/);
  assert.match(shader.fragmentShader,/material\.dfg = bf2_sampleThreeDfg/);
  assert.match(shader.fragmentShader,/specularBRDF \* material\.multiScatteringCompensation/);
  assert.equal(shader.uniforms.bf2_sourceDFG.value,texture);
  assert.ok(!('dfgLUT' in shader.uniforms));
  assert.throws(()=>injectSharedThreeDfg(shader,texture),/already injected/);
  texture.dispose();
});

test('source light channel finalizer preserves original direct calls and shares lookup after channel expansion',()=>{
  const source=packed(),texture=packThreeDfgIntoSourceLookup(source);source.dispose();
  const adapter=createSourceDirectAdapter({combinedDfgTexture:texture},1,1);
  const material=new THREE.MeshStandardMaterial();material.userData.recoveredMaster2UvShader={};
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(),material),scene=new THREE.Scene();
  scene.add(mesh,new THREE.PointLight(),new THREE.SpotLight());
  createSourceLightChannels(1,1,{nativeDirect:adapter}).decorate(scene);
  const shader={uniforms:THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms),vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
  material.onBeforeCompile(shader,{});
  assert.ok(!shader.fragmentShader.includes('dfgLUT'));
  assert.match(shader.fragmentShader,/bf2_pointChannels\[i\]/);
  assert.match(shader.fragmentShader,/bf2_spotChannels\[i\]/);
  assert.match(shader.fragmentShader,/else \{ RE_Direct/);
  assert.match(shader.fragmentShader,/bf2_sampleSourceIes\(bf2_iesUv/);
  assert.equal(shader.uniforms.bf2_sourceDFG.value,texture);
  material.dispose();mesh.geometry.dispose();texture.dispose();
});

test('prepared source wrapper follows explicit array replacement and owns texture disposal',async()=>{
  const wrapper=await prepareSourceDfg(doc,{fetch:async()=>({ok:true,arrayBuffer:async()=>buffer(read(doc.url))})});
  const source=wrapper.texture,ies=createSourceIesTexture(iesDoc,buffer(read(iesDoc.url)));
  packSourceIesIntoDfg(source,ies);ies.dispose();
  const before=wrapper.sample(.42,.7),array=packThreeDfgIntoSourceLookup(source);
  let oldDisposals=0,newDisposals=0;source.addEventListener('dispose',()=>oldDisposals++);array.addEventListener('dispose',()=>newDisposals++);
  assert.equal(wrapper.replaceLookupTexture(array),array);assert.equal(wrapper.texture,array);assert.equal(oldDisposals,1);
  assert.deepEqual(wrapper.sample(.42,.7),before);assert.deepEqual(wrapper.snapshot().runtimeLookupSize,[128,128,2]);
  wrapper.replaceLookupTexture(array);assert.equal(newDisposals,0);
  wrapper.dispose();wrapper.dispose();assert.equal(newDisposals,1);
  assert.throws(()=>wrapper.replaceLookupTexture(array),/disposed/);assert.throws(()=>wrapper.sample(.4,.7),/disposed/);
});
