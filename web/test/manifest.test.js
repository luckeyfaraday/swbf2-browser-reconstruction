import test from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest } from '../src/assets.js';
const valid=()=>({metadata:{mapId:'test',name:'TEST FIXTURE',source:'synthetic test only',units:'meters',up:'Y'},assets:[{id:'box',url:'box.glb',collision:true}],instances:[{assetId:'box',matrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}],spawns:[{position:[0,0,0],team:0,yaw:0}],bounds:{min:[-5,-1,-5],max:[5,5,5]}});
test('manifest rejects absent source provenance, units mismatch, and missing geometry references',()=>{
  assert.doesNotThrow(()=>validateManifest(valid()));
  const noSource=valid();delete noSource.metadata.source;assert.throws(()=>validateManifest(noSource),/source/);
  const badUnits=valid();badUnits.metadata.units='inches';assert.throws(()=>validateManifest(badUnits),/meters/);
  const broken=valid();broken.instances[0].assetId='missing';assert.throws(()=>validateManifest(broken),/reference/);
  const noCollision=valid();noCollision.assets[0].collision=false;assert.throws(()=>validateManifest(noCollision),/collision/);
});
