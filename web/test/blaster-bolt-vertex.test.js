import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {BLASTER_BOLT_VERTEX_GLSL,evaluateBlasterBoltVertex} from '../src/blaster-bolt-vertex.js';
import {compareBlasterBoltVertexReference} from '../tools/check-blaster-bolt-vertex.mjs';
const root=new URL('../../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root)),json=p=>JSON.parse(read(p)),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const doc=json('web/public/assets/recovered-blaster-bolt-vertex.json');

test('bolt vertex source, exact-immediate translation and independent native captures stay hash-bound',()=>{
 assert.equal(sha(read(doc.shaderPath)),doc.shaderSha256);assert.equal(sha(read('web/src/blaster-bolt-vertex.js')),doc.generatedJsSha256);
 assert.equal(sha(read('exports/rifle-trail/render-shaders/render-material-vs-hex.asm')),doc.hexDisassemblySha256);
 assert.equal(BLASTER_BOLT_VERTEX_GLSL,read('tools/materials/blaster-bolt-vertex-equations.glsl').toString());assert.equal(sha(Buffer.from(BLASTER_BOLT_VERTEX_GLSL)),doc.glslSha256);
 assert.equal(doc.instructions,343);assert.equal(doc.outputStride,144);assert.deepEqual(doc.buffers.t26.uintHeader,{ringStart:208,ringCapacity:216,particleBaseBytes:248,particleStrideBytes:252});
 assert.match(BLASTER_BOLT_VERTEX_GLSL,/uvec4 r0=uvec4\(0u\)/);assert.match(BLASTER_BOLT_VERTEX_GLSL,/unpackHalf2x16\(r0\.z\)/);assert.doesNotMatch(BLASTER_BOLT_VERTEX_GLSL,/vec4 r0=vec4/);
 assert.match(BLASTER_BOLT_VERTEX_GLSL,/2\.3283064365386963e-10/);
 for(const name of ['vertex-warp','render-trig-warp']){
  const e=json(`exports/rifle-trail/${name}/execution.json`);
  for(const field of ['input','output'])assert.equal(sha(read(`exports/rifle-trail/${name}/${field}.bin`)),e[`${field}Sha256`]);
  if(name==='vertex-warp'){assert.equal(e.shaderSha256,doc.shaderSha256);assert.equal(e.cases,205);assert.equal(e.vertices,363);}
  else {assert.equal(sha(read(`exports/rifle-trail/${name}/probe.dxbc`)),e.shaderSha256);assert.match(e.source,/Separately compiled/);assert.notEqual(e.shaderSha256,doc.shaderSha256);}
 }
});

test('all original bolt VS outputs match with native trigonometry and expose platform noise sensitivity',()=>{
 const original=compareBlasterBoltVertexReference({nativeTrig:true});
 assert.equal(original.outputs,74415);assert.equal(original.scalarComparisons,2678940);assert.equal(original.flare,200);
 assert.deepEqual(original.differences,[]);assert.deepEqual(original.visibilityDifferences,[]);assert.equal(original.nonfinite,0);assert.ok(original.maxAbsolute<.00002);assert.ok(original.channelMax[30]<1e-7);
 const mathematical=compareBlasterBoltVertexReference();assert.equal(mathematical.nonfinite,0);assert.ok(mathematical.bodyMax<.00002);assert.ok(mathematical.flareGeometryMax<3e-7);
 assert.equal(mathematical.visibilityDifferences.length,12);assert.deepEqual([...new Set(mathematical.visibilityDifferences.map(r=>r.case))],[51,67,187]);
 assert.ok(mathematical.differences.every(r=>r.vertex>=359));
});

test('native emitter index, ring wrap, draw base, sorted indirection and unaligned particle base preserve selection',()=>{
 const input=read('exports/rifle-trail/vertex-warp/input.bin'),start=16+363*20,stride=1656;
 const source=Array.from({length:5},(_,i)=>input.readFloatLE(16+i*4)),emitter=Buffer.from(input.subarray(start,start+912));
 const cb1=new Float32Array(12),cb2=Float32Array.from({length:152},(_,i)=>input.readFloatLE(start+1048+i*4));
 const particles=[0,1,2].map(c=>input.subarray(start+c*stride+912,start+c*stride+1000));
 const inputs={position:source.slice(0,3),uv:source.slice(3),cb1,cb2,emitters:emitter,drawIndices:new Uint32Array([0])};
 const expected=particles.map(p=>evaluateBlasterBoltVertex({...inputs,particles:p}).flatMap(v=>[...v]));
 const full=Buffer.concat([Buffer.alloc(16),...particles]);emitter.writeUInt32LE(2,208);emitter.writeUInt32LE(3,216);emitter.writeUInt32LE(16,248);emitter.writeUInt32LE(88,252);
 const emitters=Buffer.concat([Buffer.alloc(912),emitter]);cb1[2]=1;cb1[9]=1;
 const run=(instanceId,sorted)=>{cb1[8]=sorted;return evaluateBlasterBoltVertex({...inputs,emitters,particles:full,drawIndices:new Uint32Array([0,2,0]),instanceId}).flatMap(v=>[...v]);};
 assert.deepEqual(run(0,0),expected[0]);assert.deepEqual(run(1,0),expected[1]);assert.deepEqual(run(0,1),expected[1]);assert.deepEqual(run(1,1),expected[2]);
});
