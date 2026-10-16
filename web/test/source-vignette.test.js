import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {nativeVignette,nativeVignetteParameters} from '../src/source-vignette.js';
const folder=new URL('../../exports/lighting/native-vignette-warp/',import.meta.url);
const read=name=>fs.readFileSync(new URL(name,folder));
const floats=bytes=>new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

test('original vignette equations preserve center, opacity clamp, inverse exponent and color blend',()=>{
  const p={scale:[2,2],exponent:2,color:[.1,.2,.3],opacity:.46};
  const settings={...p,evidenceId:'BF2-NATIVE-VIGNETTE-001',enabled:true};
  assert.deepEqual(nativeVignetteParameters(settings),{enabled:true,params:[2,2,.5],color:[.1,.2,.3,.46]});
  assert.throws(()=>nativeVignetteParameters({...settings,exponent:0}),/settings/);
  assert.throws(()=>nativeVignetteParameters({...settings,scale:[NaN,2]}),/settings/);
  assert.deepEqual(nativeVignette([1,2,3],[.5,.5],p),[1,2,3]);
  assert.deepEqual(nativeVignette([1,2,3],[0,0],{...p,opacity:1}),p.color);
  assert.deepEqual(nativeVignette([1,2,3],[0,0],{...p,opacity:-1}),[1,2,3]);
  const edge=nativeVignette([1,1,1],[0,.5],{...p,color:[0,0,0]});
  assert.ok(Math.abs(edge[0]-Math.sqrt(.54))<1e-8);
});

test('vignette matches 6144 pixels from unchanged original Tonemap with varied authored parameters',()=>{
  const doc=JSON.parse(read('execution.json')),inputBytes=read('input.rgba32f.bin');
  assert.equal(sha(inputBytes),doc.inputSha256);
  assert.equal(doc.shaderSha256,'b2fa39fcd1a70f7a0a45820ad72bb28fc267d0d8efc57549016d7971a7ac84e0');
  const input=floats(inputBytes);let maximum=0,checked=0;
  for(const row of doc.cases){
    const bytes=read(row.output),output=floats(bytes);assert.equal(sha(bytes),row.sha256);
    assert.equal(sha(read(`case-${row.index}.cb.bin`)),row.constantSha256);
    for(let i=0;i<doc.width*doc.height;i++){
      const color=[0,1,2].map(c=>input[i*4+c]*row.colorScale[c]);
      const linear=nativeVignette(color,[(i%doc.width+.5)/doc.width,(Math.floor(i/doc.width)+.5)/doc.height],row);
      const expected=linear.map(v=>v<=.0031308?v*12.92:1.055*Math.abs(v)**Math.fround(1/2.4)-.055);
      expected.push(expected[0]*.212671+expected[1]*.715160+expected[2]*.072169);
      for(let c=0;c<4;c++){const actual=output[i*4+c];assert.ok(Number.isFinite(actual));maximum=Math.max(maximum,Math.abs(actual-expected[c])/Math.max(1,Math.abs(expected[c])));checked++;}
    }
  }
  assert.equal(checked,24576);assert.ok(maximum<1/32768,`native unit-floor relative residual ${maximum}`);
});
