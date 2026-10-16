import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {resolveGameplay,damageAtDistance,damageActor,resetLife} from '../src/rules.js';

const workspace=new URL('../../',import.meta.url);
const document=JSON.parse(await fs.readFile(new URL('../public/assets/gameplay.json',import.meta.url),'utf8'));
const readPointer=(value,pointer)=>pointer.slice(1).split('/').reduce((current,key)=>current[key.replaceAll('~1','/').replaceAll('~0','~')],value);

test('every supplied gameplay scalar resolves to its retained installed EBX evidence',async()=>{
  const supplied=Object.entries(document.parameters).flatMap(([section,fields])=>Object.keys(fields).map(key=>`${section}.${key}`));
  assert.deepEqual(supplied.sort(),document.provenance.mappings.map(mapping=>mapping.parameter).sort());
  for(const mapping of document.provenance.mappings) {
    const bytes=await fs.readFile(new URL(mapping.source.file,workspace));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),mapping.source.jsonSha256);
    const ebx=JSON.parse(bytes.toString('utf8'));
    assert.equal(ebx.entry.guid,mapping.source.guid);assert.equal(ebx.entry.sha1,mapping.source.sha1);
    assert.equal(readPointer(ebx,mapping.jsonPointer),mapping.value);
    assert.equal(readPointer(document.parameters,'/'+mapping.parameter.replace('.','/')),mapping.value);
  }
});

test('recovered E-11 body damage eliminates Assault in five near hits or eight far hits',()=>{
  const {parameters}=resolveGameplay(document),actor={};
  resetLife(actor,parameters.player.health);
  for(let hit=0;hit<4;hit++)assert.equal(damageActor(actor,damageAtDistance(parameters.weapon,10),hit),false);
  assert.equal(damageActor(actor,damageAtDistance(parameters.weapon,10),4),true);
  resetLife(actor,parameters.player.health);
  for(let hit=0;hit<7;hit++)assert.equal(damageActor(actor,damageAtDistance(parameters.weapon,50),hit),false);
  assert.equal(damageActor(actor,damageAtDistance(parameters.weapon,50),7),true);
  // Tests reconstructed application of observed endpoints, not native parity.
});

test('conflicting speed and unresolved heat behavior remain explicitly provisional',()=>{
  const resolved=resolveGameplay(document);
  for(const parameter of ['weapon.projectileSpeed','weapon.heatPerShot','weapon.coolingDelay','player.moveSpeed','round.scoreLimit']) {
    assert.ok(resolved.provenance.provisional.includes(parameter));
    assert.ok(document.provenance.unmapped.some(gap=>gap.parameters.includes(parameter)));
  }
  assert.equal(document.provenance.runtimeObserved,false);
});
