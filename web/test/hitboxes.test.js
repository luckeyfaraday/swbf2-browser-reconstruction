import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import * as THREE from 'three';
import {rayCapsuleDistance,createSoldierHitboxes} from '../src/hitboxes.js';

const v=(...xyz)=>new THREE.Vector3(...xyz);
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-6,`${actual} != ${expected}`);
test('capsule rays cover sides, end caps, parallel, tangent, inside and finite projectile segments',()=>{
  const a=v(0,0,0),b=v(0,2,0),radius=.25;
  near(rayCapsuleDistance(new THREE.Ray(v(0,1,3),v(0,0,-1)),a,b,radius),2.75);
  near(rayCapsuleDistance(new THREE.Ray(v(0,4,0),v(0,-1,0)),a,b,radius),1.75);
  near(rayCapsuleDistance(new THREE.Ray(v(.25,1,3),v(0,0,-1)),a,b,radius),3);
  assert.equal(rayCapsuleDistance(new THREE.Ray(v(.26,1,3),v(0,0,-1)),a,b,radius),null);
  assert.equal(rayCapsuleDistance(new THREE.Ray(v(0,1,3),v(0,0,-1)),a,b,radius,2.74),null);
  assert.equal(rayCapsuleDistance(new THREE.Ray(v(.1,1,0),v(1,0,0)),a,b,radius),0);
  near(rayCapsuleDistance(new THREE.Ray(v(0,0,3),v(0,0,-1)),a,a,radius),2.75);
});

test('source hit capsules follow bone motion and rotated character placement, with explicit wall deactivation',()=>{
  const model=new THREE.Group(),bone=new THREE.Bone();bone.name='Head';bone.position.set(0,1.5,0);model.add(bone);
  const hitboxes=createSoldierHitboxes(model,{capsules:[{bone:'Head',axis:0,length:.1,radius:.16,offset:[0,.1,0],head:true,deactivateIfBehindWall:true}]});
  model.position.set(5,0,4);model.rotation.y=Math.PI/2;hitboxes.update();
  near(hitboxes.capsules[0].start.y,1.6);near(hitboxes.capsules[0].end.z,3.9);
  let ray=new THREE.Ray(v(5,1.6,10),v(0,0,-1));
  assert.equal(hitboxes.intersect(ray,10).head,true);assert.equal(hitboxes.intersect(ray,10,()=>false),null);
  bone.position.y+=2;hitboxes.update();assert.equal(hitboxes.intersect(ray,10),null);
  ray=new THREE.Ray(v(5,3.6,10),v(0,0,-1));assert.equal(hitboxes.intersect(ray,10).bone,'Head');
});

test('every translated hit capsule comes from the selected installed source object',async()=>{
  const document=JSON.parse(await fs.readFile(new URL('../public/assets/soldier-hitboxes.json',import.meta.url),'utf8'));
  const bytes=await fs.readFile(new URL('../../'+document.provenance.source.file,import.meta.url));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),document.provenance.source.jsonSha256);
  const source=JSON.parse(bytes),pointer=(doc,p)=>p.slice(1).split('/').reduce((value,key)=>value[key],doc);
  assert.equal(document.capsules.length,11);
  for(const capsule of document.capsules){const bone=pointer(source,capsule.sourcePointer);assert.equal(bone.ValidInHiLod,true);assert.equal(capsule.radius,bone.CapsuleRadius);assert.equal(capsule.length,bone.CapsuleLength);assert.equal(capsule.bone,bone.BoneName);}
  assert.equal(document.provenance.runtimeObserved,false);
  assert.ok(document.provenance.inferences.length>0);
});
