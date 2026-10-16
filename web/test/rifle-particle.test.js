import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {compareRifleParticleReference} from '../tools/check-rifle-particle.mjs';
import {decodeRifleParticle,encodeRifleParticle,RIFLE_PARTICLE_POLICY} from '../src/rifle-particle.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const dir=path.join(root,'exports/rifle-trail/particle-warp');
const sha=b=>createHash('sha256').update(b).digest('hex');

test('rifle particle reference retains unchanged installed DXBC, source bindings and CPU WARP input/output',()=>{
 const execution=JSON.parse(fs.readFileSync(path.join(dir,'execution.json'),'utf8'));
 const source=JSON.parse(fs.readFileSync(path.join(dir,'inputs.json'),'utf8'));
 assert.equal(execution.backend,'D3D11 WARP CPU');
 for(const [name,field] of [['spawn','spawnSha256'],['simulate','simulateSha256']]){
  const actual=sha(fs.readFileSync(path.join(root,`exports/rifle-trail/shaders/${name}.dxbc`)));
  assert.equal(actual,execution[field]);assert.ok(RIFLE_PARTICLE_POLICY.shaders.includes(actual));
 }
 for(const [name,field] of [['input','inputSha256'],['output','outputSha256']])assert.equal(sha(fs.readFileSync(path.join(dir,`${name}.bin`))),execution[field]);
 for(const row of source.sources)assert.equal(sha(fs.readFileSync(path.join(root,row.file))),row.sha256);
 assert.equal(execution.cases,150);assert.equal(execution.steps,16);
});

test('rifle particle port follows2550 original compute outputs and identifies six float-sensitive clipping boundaries',()=>{
 const report=compareRifleParticleReference();
 assert.equal(report.samples,2550);assert.deepEqual(report.differences,[]);
 assert.ok(report.maxFloat<.00004);
 assert.equal(report.boundaryDifferences.length,6);
 assert.ok(report.boundaryDifferences.every(row=>row.channel===19&&row.error===.30029296875));
});

test('original88-byte particle records survive decoding and re-encoding without channel or half-word changes',()=>{
 const data=fs.readFileSync(path.join(dir,'output.bin'));
 const buffer=data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);
 for(let offset=0;offset<data.length;offset+=88){
  const actual=Buffer.from(encodeRifleParticle(decodeRifleParticle(buffer,offset)));
  assert.deepEqual(actual,data.subarray(offset,offset+88));
 }
});
