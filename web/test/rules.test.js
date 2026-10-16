import test from 'node:test';
import assert from 'node:assert/strict';
import { createRound, advanceRound, recordKill, resetLife, damageActor, damageAtDistance, tickWeapon, tryFire, resolveGameplay, PROVISIONAL } from '../src/rules.js';

test('TDM scores one enemy kill once, ends on limit, and rejects later scoring',()=>{
  const r=createRound({...PROVISIONAL.round,scoreLimit:2}),a={id:'a',team:0},b={id:'b',team:1};
  assert.equal(recordKill(r,a,b),true);assert.deepEqual(r.scores,[1,0]);
  assert.equal(recordKill(r,a,b),false);assert.deepEqual(r.scores,[1,0]);
  resetLife(b,150);recordKill(r,a,b);assert.equal(r.phase,'ended');assert.equal(r.winner,0);
  assert.equal(recordKill(r,{id:'c',team:1},{id:'d',team:0}),false);assert.deepEqual(r.scores,[2,0]);
});
test('TDM suicides, environment deaths, and friendly kills never add team points',()=>{
  const r=createRound(PROVISIONAL.round),a={id:'a',team:0};
  recordKill(r,a,a);recordKill(r,a,{id:'b',team:0});recordKill(r,null,{id:'c',team:1});
  assert.deepEqual(r.scores,[0,0]);assert.deepEqual(r.deaths,{a:1,b:1,c:1});
});
test('FFA scores individual kills even when faction labels match; timeout supports ties',()=>{
  const r=createRound({...PROVISIONAL.round,duration:2},'ffa');
  recordKill(r,{id:'a',team:0},{id:'b',team:0});recordKill(r,{id:'b',team:0},{id:'a',team:0});
  advanceRound(r,2);assert.equal(r.phase,'ended');assert.equal(r.reason,'time');assert.equal(r.winner,null);
});
test('death is terminal until respawn and respawn resets heat/death bookkeeping',()=>{
  const a={id:'a'};resetLife(a,150);assert.equal(damageActor(a,120,4),false);assert.equal(damageActor(a,40,5),true);assert.equal(a.health,0);
  assert.equal(damageActor(a,40,6),false);a.scoredDeath=true;a.heat=1;resetLife(a,150);
  assert.equal(a.alive,true);assert.equal(a.scoredDeath,false);assert.equal(a.heat,0);assert.equal(a.health,150);
});
test('heat and cadence prevent continuous fire during lockout and recover by time',()=>{
  const a={id:'a'},w={...PROVISIONAL.weapon,heatPerShot:.5};resetLife(a,150);
  assert.equal(tryFire(a,w,0),true);assert.equal(tryFire(a,w,0),false);
  tickWeapon(a,w,.2,.2);assert.equal(tryFire(a,w,.2),true);assert.equal(a.heat,1);assert.ok(a.overheat>0);
  tickWeapon(a,w,.2,.4);assert.equal(tryFire(a,w,.4),false);
  tickWeapon(a,w,3,3.4);assert.equal(tryFire(a,w,3.4),true);
});
test('sustained fire preserves a configured cadence that is not a multiple of the fixed tick',()=>{
  const actor={id:'a'},weapon={...PROVISIONAL.weapon,roundsPerMinute:700,heatPerShot:0};resetLife(actor,150);
  const shots=[];
  for(let frame=0;frame<600;frame++) {
    const time=frame/60;
    if(frame)tickWeapon(actor,weapon,1/60,time);
    if(tryFire(actor,weapon,time))shots.push(time);
  }
  assert.equal(shots.length,117,'700 rpm over ten seconds must not be rounded down to 600 rpm');
  for(let index=0;index<shots.length;index++)assert.ok(Math.abs(shots[index]-index*60/700)<1/60+1e-8);
  tickWeapon(actor,weapon,10,20);tickWeapon(actor,weapon,1/60,20+1/60);
  assert.equal(tryFire(actor,weapon,20+1/60),true);
  assert.equal(tryFire(actor,weapon,20+1/60),false,'idle time cannot bank shots for an instantaneous burst');
});
test('extracted parameters and provisional defaults remain identifiable',()=>{
  const resolved=resolveGameplay({parameters:{player:{health:200}},provenance:{evidence:'fixture'}});
  assert.equal(resolved.parameters.player.health,200);assert.deepEqual(resolved.provenance.sourceDerived,['player.health']);
  assert.ok(resolved.provenance.provisional.includes('player.moveSpeed'));assert.equal(resolved.provenance.supplied.evidence,'fixture');
  assert.throws(()=>resolveGameplay({parameters:{weapon:{projectileSpeed:0}}}),/must be positive/);
});
test('rifle damage obeys recovered endpoints and the explicitly inferred linear falloff',()=>{
  const weapon={...PROVISIONAL.weapon,damage:36,endDamage:19,damageFalloffStart:20,damageFalloffEnd:40};
  assert.equal(damageAtDistance(weapon,0),36);
  assert.equal(damageAtDistance(weapon,20),36);
  assert.equal(damageAtDistance(weapon,30),27.5);
  assert.equal(damageAtDistance(weapon,40),19);
  assert.equal(damageAtDistance(weapon,1000),19);
  assert.equal(damageAtDistance({...weapon,damageFalloffEnd:0},1000),36);
  assert.throws(()=>resolveGameplay({parameters:{weapon:{damageFalloffStart:40,damageFalloffEnd:20}}}),/reversed/);
  assert.throws(()=>resolveGameplay({parameters:{weapon:{projectileLifetime:-1}}}),/nonnegative/);
});
