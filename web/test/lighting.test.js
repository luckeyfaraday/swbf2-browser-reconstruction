import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {convertSourceLights,createLighting,selectNearbyLights} from '../src/lighting.js';

test('moving between rooms selects nearby lights beyond the first24 source entries',()=>{
  const lights=Array.from({length:40},(_,index)=>({id:String(index),type:'point',position:[index*10,3,0],range:12,intensity:10}));
  assert.ok(selectNearbyLights(lights,[390,1,0],4).some(light=>light.id==='39'));
  assert.ok(selectNearbyLights(lights,[0,1,0],4).every(light=>Number(light.id)<4));
  const scene=new THREE.Scene(),lighting=createLighting(scene,{lights},null,{pointBudget:4});
  lighting.update(new THREE.Vector3(0,1,0));const count=scene.children.length;
  lighting.update(new THREE.Vector3(390,1,0));
  assert.ok(lighting.snapshot().selected.some(light=>light.id==='39'));
  assert.equal(scene.children.length,count,'pool does not create one GPU light per source light');
  lighting.dispose();assert.equal(scene.children.length,0);
});

test('source light conversion retains XYZ and RGB ratios and records unsupported source behavior',()=>{
  const source={matrix:new THREE.Matrix4().makeTranslation(15,8,-20).toArray(),fileGuid:'fixture',classGuid:'test',route:'fixture',properties:{$type:'FrostySdk.Ebx.PbrSpotLightEntityData',Color:{x:16,y:32,z:8},Intensity:Math.PI*100,Dimmer:1,OuterAngle:60,InnerAngle:30,AttenuationRadius:12,LightUnit:{name:'LightUnitType_LuminousPower'}}};
  const output=convertSourceLights({lights:[source,{...source,properties:{...source.properties,AffectDiffuse:false}}]});
  assert.equal(output.lights.length,2);const light=output.lights[0];
  assert.deepEqual(light.position,[15,8,-20]);assert.deepEqual(light.color,[.5,1,.25]);
  assert.deepEqual(light.target,[15,8,-21]);assert.equal(light.intensity,100);
  assert.equal(light.angle,Math.PI/6);assert.equal(light.penumbra,.5);
  assert.equal(output.lights[1].affectDiffuse,false);assert.equal(output.lights[1].affectSpecular,true);
  assert.match(output.provenance.assumptions.note,/uncalibrated/);
});
