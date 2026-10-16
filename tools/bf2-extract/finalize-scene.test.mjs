import test from 'node:test';
import assert from 'node:assert/strict';
import {transformedBounds,intersects,glbBounds} from './finalize-scene.mjs';

test('rotated asymmetric mesh keeps every transformed corner and source translation',()=>{
  const bounds=transformedBounds({min:[-1,-2,-3],max:[4,5,6]},[0,0,-1,0,0,1,0,0,1,0,0,0,100,20,-30,1]);
  assert.deepEqual(bounds,{min:[97,18,-34],max:[106,25,-29]});
});
test('region includes geometry crossing its boundary when its instance origin is outside',()=>{
  const region={min:[0,0,0],max:[5,5,5]};
  const mesh=transformedBounds({min:[-10,0,0],max:[-6,2,2]},[1,0,0,0,0,1,0,0,0,0,1,0,12,1,1,1]);
  assert.equal(intersects(mesh,region),true);
  assert.equal(intersects({min:[5.01,0,0],max:[6,1,1]},region),false);
});
test('actual converter fixture provides finite GLB bounds',()=>{
  const bounds=glbBounds(new URL('./selftest-triangle.glb',import.meta.url));
  assert.deepEqual(bounds.min,[0,0,0]);assert.deepEqual(bounds.max,[1,1,0]);assert.equal(bounds.triangles,1);
});
