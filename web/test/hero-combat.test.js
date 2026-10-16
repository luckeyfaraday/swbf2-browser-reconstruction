import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {segmentDistance,resolveHeroParameters,HERO_DEFAULTS} from '../src/hero-combat.js';
import {moveDirection} from '../src/hero-body.js';

const v=(x,y,z)=>new THREE.Vector3(x,y,z);

test('segment distance covers crossing, parallel, skew and degenerate segments', () => {
  assert.equal(segmentDistance(v(-1,0,0),v(1,0,0),v(0,-1,0),v(0,1,0)),0);
  assert.ok(Math.abs(segmentDistance(v(0,0,0),v(1,0,0),v(0,1,0),v(1,1,0))-1)<1e-12);
  assert.ok(Math.abs(segmentDistance(v(-1,0,0),v(1,0,0),v(0,-1,2),v(0,1,2))-2)<1e-12);
  // Closest points clamp to segment ends.
  assert.ok(Math.abs(segmentDistance(v(0,0,0),v(1,0,0),v(3,0,0),v(4,0,0))-2)<1e-12);
  assert.ok(Math.abs(segmentDistance(v(0,0,0),v(0,0,0),v(3,4,0),v(3,4,0))-5)<1e-12);
  assert.ok(Math.abs(segmentDistance(v(0,2,0),v(0,2,0),v(-1,0,0),v(1,0,0))-2)<1e-12);
});

test('hero parameters take source values and keep labelled defaults for the rest', () => {
  const resolved=resolveHeroParameters({runtime:{health:{value:550,unit:'hp',source:{asset:'A'}},choke:{range:{value:12,inferred:true}}},provenance:{evidence:'x'}});
  assert.equal(resolved.parameters.health,550);
  assert.equal(resolved.parameters.choke.range,12);
  assert.equal(resolved.parameters.choke.duration,HERO_DEFAULTS.choke.duration);
  assert.ok(resolved.provenance.sourced.includes('health'));
  assert.ok(resolved.provenance.sourced.includes('choke.range'));
  assert.ok(resolved.provenance.provisional.includes('choke.duration'));
  const none=resolveHeroParameters(null);
  assert.deepEqual(none.parameters,structuredClone(HERO_DEFAULTS));
  assert.equal(none.provenance.sourced.length,0);
});

test('locomotion direction sectors follow the hero frame', () => {
  assert.equal(moveDirection(0,1),'fwd');assert.equal(moveDirection(0,-1),'bwd');
  assert.equal(moveDirection(1,0),'right');assert.equal(moveDirection(-1,0),'left');
  assert.equal(moveDirection(1,1),'fwdright');assert.equal(moveDirection(-1,-1),'bwdleft');
});
