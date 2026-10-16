import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {createSourceProbeSampler,createSourceProbeLighting,evaluateSourceSH,setSourceProbeDiagnosticMode} from '../src/source-probes.js';
import {createSourceDfgTexture} from '../src/source-dfg.js';

const document=JSON.parse(fs.readFileSync(new URL('../public/assets/source-probes.json',import.meta.url)));
const raw=fs.readFileSync(new URL('../public/assets/source-probes.bin',import.meta.url));
const values=new Float32Array(raw.buffer,raw.byteOffset,raw.byteLength/4);

test('all native probe ranges account for the complete paired source payload',()=>{
  assert.equal(values.length,29632*36);
  assert.equal(document.volumes.length,194);
  let count=0;
  for(const volume of document.volumes) {
    assert.equal(volume.probeStart,count);
    assert.equal(volume.probeCount,volume.resolution.reduce((a,b)=>a*b,1));
    count+=volume.probeCount;
  }
  assert.equal(count,document.probeCount);
});

test('native SH basis keeps Y-up quadratic and X/Z signs from the DXBC',()=>{
  const coefficients=new Float32Array(36);
  [10,2,3,4,1,5,6,7,8].forEach((value,band)=>coefficients.set([value,value*2,value*3,0],band*4));
  assert.deepEqual(evaluateSourceSH(coefficients,[0,1,0]),[15,30,45]);
  assert.deepEqual(evaluateSourceSH(coefficients,[1,0,0]),[19,38,57]);
  assert.deepEqual(evaluateSourceSH(coefficients,[0,0,-1]),[0,0,0]);
  assert.deepEqual(evaluateSourceSH(coefficients,[0,0,1]),[5,10,15]);
});

test('actual source probe positions recover their matching coefficients without axis swaps',()=>{
  // An independently decoded native volume: 12x1x8, centered at the corridor.
  const volume=document.volumes[33];
  const onlyThisVolume={...document,volumes:[volume]};
  const sampler=createSourceProbeSampler(onlyThisVolume,values);
  const matrix=new THREE.Matrix4().fromArray(volume.matrix);matrix.elements[15]=1;
  for(const [x,y,z] of [[0,0,0],[11,0,7],[4,0,3]]) {
    const point=new THREE.Vector3(...[x,y,z].map((v,i)=>(v+.5)/volume.resolution[i]-.5)).applyMatrix4(matrix);
    const result=sampler.sample(point.toArray());
    assert.equal(result.volume,33);
    const start=(volume.probeStart+x+12*(y+z))*36;
    for(let channel=0;channel<36;channel++) {
      assert.ok(Math.abs(result.coefficients[channel]-values[start+channel])<.05,
        `source cell ${x}/${y}/${z}, component ${channel}: ${result.coefficients[channel]} vs ${values[start+channel]}`);
    }
  }
});

test('source probes cover all source team spawn coordinates',()=>{
  const manifest=JSON.parse(fs.readFileSync(new URL('../public/assets/map.scene.json',import.meta.url)));
  const sampler=createSourceProbeSampler(document,values);
  for(const spawn of manifest.spawns) {
    const result=sampler.sample(spawn.position);
    assert.notEqual(result.volume,null);
    assert.ok(result.coefficients[0]>0);
  }
});

test('probe instrumentation preserves the preceding shader hook and instancing offsets',()=>{
  const material=new THREE.MeshStandardMaterial();
  let priorCalls=0;
  material.onBeforeCompile=shader=>{priorCalls++;shader.fragmentShader='// preserved floor hook\n'+shader.fragmentShader;};
  material.customProgramCacheKey=()=> 'source-floor-test';
  const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(),material,2);
  mesh.setMatrixAt(0,new THREE.Matrix4().makeTranslation(-919.68,587.52,-319.9382));
  mesh.setMatrixAt(1,new THREE.Matrix4().makeTranslation(-922.0978,583.68,-265.921783));
  const lighting=createSourceProbeLighting(document,values);
  assert.equal(lighting.add(mesh),2);
  const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};
  mesh.material.onBeforeCompile(shader,{});
  assert.equal(priorCalls,1);
  assert.ok(shader.fragmentShader.includes('// preserved floor hook'));
  assert.ok(shader.fragmentShader.includes('irradiance += PI * bf2_probeDiffuse'));
  assert.ok(shader.vertexShader.includes('bf2_probeIndex=bf2_probeOffset'));
  assert.equal(shader.uniforms.bf2_probeBase,undefined);
  assert.deepEqual([...mesh.geometry.attributes.bf2_probeOffset.array],[0,9]);
  assert.equal(shader.uniforms.bf2_probeScale.value,1);
  assert.equal(lighting.snapshot().assignments,2);
  assert.equal(lighting.snapshot().missed,0);
  assert.equal(material.onBeforeCompile.toString().includes('bf2_probe'),false);
  lighting.dispose();mesh.geometry.dispose();material.dispose();
});

test('probe draw offsets share original geometry buffers and decorated materials',()=>{
  const geometry=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial(),group=new THREE.Group();
  const a=new THREE.Mesh(geometry,material),b=new THREE.Mesh(geometry,material),c=new THREE.InstancedMesh(geometry,material,2);
  group.position.set(-919.68,587.52,-319.9382);group.add(a,b,c);
  const lighting=createSourceProbeLighting(document,values);lighting.add(group);
  // Plain meshes share one decorated material; the instanced mesh gets its own so
  // three never flips one material between instanced and plain programs per draw.
  assert.equal(a.material,b.material);assert.notEqual(a.material,c.material);
  assert.equal(a.material.customProgramCacheKey().replace('instanced',''),c.material.customProgramCacheKey().replace('instanced',''));
  assert.notEqual(a.geometry,b.geometry);assert.notEqual(a.geometry,geometry);
  for(const mesh of [a,b,c]) {
    assert.equal(mesh.geometry.attributes.position,geometry.attributes.position);
    assert.equal(mesh.geometry.attributes.normal,geometry.attributes.normal);
    assert.equal(mesh.geometry.index,geometry.index);
  }
  assert.ok(a.geometry.attributes.bf2_probeOffset.array.every(value=>value===0));
  assert.ok(b.geometry.attributes.bf2_probeOffset.array.every(value=>value===9));
  assert.deepEqual([...c.geometry.attributes.bf2_probeOffset.array],[18,27]);
  assert.equal(c.geometry.attributes.bf2_probeOffset.isInstancedBufferAttribute,true);
  assert.equal(geometry.attributes.bf2_probeOffset,undefined);
  assert.equal(lighting.snapshot().decoratedMaterials,2);
  assert.equal(lighting.snapshot().geometryWrappers,3);
  assert.ok(lighting.snapshot().maxAttributeSlots<=16);
  lighting.dispose();geometry.dispose();material.dispose();
});

test('smooth index preserves full fragment SH and diagnostic modes retain every source triangle',()=>{
  const original=new THREE.MeshStandardMaterial(),geometry=new THREE.BoxGeometry(),mesh=new THREE.InstancedMesh(geometry,original,2);
  const lighting=createSourceProbeLighting(document,values);lighting.add(mesh);
  const wrapped=mesh.geometry,decorated=mesh.material;
  assert.equal(lighting.snapshot().diagnosticMode,'smooth');
  const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};
  mesh.material.onBeforeCompile(shader,{});
  assert.ok(!shader.vertexShader.includes('flat varying'));
  assert.ok(!shader.fragmentShader.includes('flat varying'));
  assert.ok(shader.fragmentShader.includes('int(bf2_probeIndex+0.5)+band'));
  for(let band=0;band<9;band++)assert.ok(shader.fragmentShader.includes(`bf2_probeRead(${band})`));
  assert.ok(shader.fragmentShader.includes('bf2_probeRead(4)*(3.0*n.y*n.y-1.0)'));
  assert.ok(shader.fragmentShader.includes('inverseTransformDirection(geometryNormal,viewMatrix)'));
  setSourceProbeDiagnosticMode('flat');
  const flat={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};
  mesh.material.onBeforeCompile(flat,{});
  assert.equal(flat.vertexShader.replace('flat varying','varying'),shader.vertexShader);
  assert.equal(flat.fragmentShader.replace('flat varying','varying'),shader.fragmentShader);
  setSourceProbeDiagnosticMode('bypass');
  assert.equal(mesh.geometry,wrapped);assert.equal(mesh.material,decorated);
  const bypass={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};
  mesh.material.onBeforeCompile(bypass,{});assert.ok(!bypass.fragmentShader.includes('bf2_probeDiffuse'));
  setSourceProbeDiagnosticMode('original');assert.equal(mesh.geometry,geometry);assert.equal(mesh.material,original);
  setSourceProbeDiagnosticMode('smooth');assert.equal(mesh.geometry,wrapped);assert.equal(mesh.material,decorated);
  lighting.dispose();geometry.dispose();original.dispose();
});

test('proven floor indirect uses native DFG outside Three diffuse energy attenuation',()=>{
  const dfgDocument=JSON.parse(fs.readFileSync(new URL('../public/assets/source-dfg.json',import.meta.url)));
  const bytes=fs.readFileSync(new URL('../public/assets/source-dfg.rgba16f.bin',import.meta.url));
  const texture=createSourceDfgTexture(dfgDocument,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const floor=new THREE.MeshStandardMaterial();floor.userData.recoveredFloorShader={};
  const group=new THREE.Group();group.add(new THREE.Mesh(new THREE.BoxGeometry(),floor),new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial()));
  for(const flag of ['recoveredMaster1UVShader','recoveredMetalOnlyShader','recoveredCeilingShader']){
    const material=new THREE.MeshStandardMaterial();material.userData[flag]={};group.add(new THREE.Mesh(new THREE.BoxGeometry(),material));
  }
  const lighting=createSourceProbeLighting(document,values,{dfg:{texture,snapshot:()=>({evidenceId:dfgDocument.evidenceId})}});lighting.add(group);
  const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};
  group.children[0].material.onBeforeCompile(shader,{});
  assert.equal(shader.uniforms.bf2_sourceDFG.value,texture);
  assert.ok(!shader.fragmentShader.includes('irradiance += PI * bf2_probeDiffuse'));
  assert.ok(shader.fragmentShader.indexOf('reflectedLight.indirectDiffuse+=bf2_probeDiffuse')>shader.fragmentShader.indexOf('reflectedLight.indirectSpecular += radiance'));
  assert.ok(!shader.fragmentShader.includes('RE_IndirectSpecular( radiance,'));
  assert.match(shader.fragmentShader,/bf2_sampleSourceDFG\(dot\(geometryNormal,geometryViewDir\),roughnessFactor\)/);
  const generic={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};
  group.children[1].material.onBeforeCompile(generic,{});
  assert.equal(generic.uniforms.bf2_sourceDFG,undefined);assert.ok(generic.fragmentShader.includes('irradiance += PI * bf2_probeDiffuse'));
  for(const [index,mesh]of group.children.entries()){
    if(index<2)continue;
    const compiled={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};
    mesh.material.onBeforeCompile(compiled,{});
    assert.ok(compiled.uniforms.bf2_sourceDFG?.value===texture,'independently classified ordinary materials use the original DFG');
    assert.ok(compiled.fragmentShader.includes('reflectedLight.indirectSpecular += radiance'));
    if(index===4)assert.ok(compiled.fragmentShader.includes('+bf2_ceiling_surface.emissive)*diffuseColor.rgb*(1.0-metalnessFactor)*bf2_nativeDFG.b'));
  }
  assert.equal(lighting.snapshot().environmentDfgCompiled,4);
  lighting.dispose();texture.dispose();
});
