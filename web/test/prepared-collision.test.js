import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {mapCollisionIdentity,collisionDigest,loadPreparedMapCollision} from '../src/prepared-collision.js';
const assets=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../public/assets');
const read=file=>JSON.parse(fs.readFileSync(path.join(assets,file)));
const manifest=read('map.scene.json'),doors=read('source-doors.json'),metadata=read('collision/static-map.json');
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');

test('prepared map collision matches current original meshes, placements and every moving door exclusion',async()=>{
  assert.equal(await collisionDigest(mapCollisionIdentity(manifest,doors)),metadata.sourceIdentity);
  assert.equal(metadata.sourceManifestSha256,sha(fs.readFileSync(path.join(assets,'map.scene.json'))));
  assert.equal(metadata.sourceDoorsSha256,sha(fs.readFileSync(path.join(assets,'source-doors.json'))));
  for(const source of metadata.sources)assert.equal(sha(fs.readFileSync(path.resolve(assets,source.url))),source.sha256,source.url);
  assert.equal(metadata.excludedDoorInstances.length,62);
  assert.equal(metadata.validation.queries,1021);
  assert.equal(metadata.validation.maximumAbsoluteDistanceError,0);
  assert.equal(fs.statSync(path.join(assets,'collision/static-map.bin')).size,metadata.byteLength);
  const digest=crypto.createHash('sha256');
  for await(const chunk of fs.createReadStream(path.join(assets,'collision/static-map.bin')))digest.update(chunk);
  assert.equal(digest.digest('hex'),metadata.binarySha256);
});

test('changed collision placements or no-physics flags reject the cache before downloading it',async()=>{
  for(const change of [value=>value.instances[0].matrix[12]+=1,value=>value.instances[0].collision=!value.instances[0].collision]){
    const changed=structuredClone(manifest);change(changed);let calls=0;
    const world=await loadPreparedMapCollision(changed,doors,{fetch:async()=>{calls++;return {ok:true,json:async()=>metadata};}});
    assert.equal(world,null);assert.equal(calls,1);
  }
});
