import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {nativeMeterSpotRectangle, nativeMeterPassPlan, nativeMeterFourSamples, nativeMeterSample,
  decodeNativeMeterPixel} from '../src/source-exposure-meter.js';

test('native spot meter keeps a square in pixel coordinates and bounds offsets', () => {
  assert.deepEqual(nativeMeterSpotRectangle(1920, 1080, 1), [0,0,1,1]);
  const r = nativeMeterSpotRectangle(1920,1080,.797);
  assert.ok(Math.abs((r[2]-r[0])*1920-(r[3]-r[1])*1080)<1e-9);
  const moved=nativeMeterSpotRectangle(1920,1080,.5,[10,-10]);
  assert.equal(moved[2],1); assert.equal(moved[1],0);
  assert.deepEqual(nativeMeterSpotRectangle(1920,1080,-1),nativeMeterSpotRectangle(1920,1080,Math.fround(.02)));
});

test('native reduction preserves the fixed pyramid and final 1x1 pass', () => {
  const plan=nativeMeterPassPlan(1920,true);
  assert.deepEqual(plan.map(p=>[p.width,p.height]),[[256,128],[128,64],[64,32],[32,16],[16,8],[8,4],[4,2],[2,1],[1,1],[1,1]]);
  assert.equal(plan.filter(p=>p.logarithmic).length,1);
  assert.deepEqual(nativeMeterPassPlan(1,true),[{width:1,height:1,logarithmic:true}]);
  assert.ok(nativeMeterPassPlan(1920,false).every(p=>!p.logarithmic));
});

test('meter equations match unchanged native VS/PS CPU-WARP pixels', () => {
  const folder=new URL('../../exports/lighting/native-exposure-warp/',import.meta.url);
  const manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',folder)));
  const floats=name=>{const b=fs.readFileSync(new URL(name,folder));return Array.from({length:b.length/4},(_,i)=>b.readFloatLE(i*4));};
  let pixels=0,maxResidual=0;
  for(const c of manifest.cases){
    const input=floats(`case${c.index}-input.rgba32f.bin`),native=floats(`case${c.index}-native.rgba32f.bin`);
    const sample=(u,v,linear=false)=>{
      if(linear){
        const px=u*c.sourceWidth-.5,py=v*c.sourceHeight-.5,x=Math.floor(px),y=Math.floor(py),fx=px-x,fy=py-y;
        const taps=[[0,0],[1,0],[0,1],[1,1]].map(([sx,sy])=>sample((x+sx+.5)/c.sourceWidth,(y+sy+.5)/c.sourceHeight));
        return Array.from({length:4},(_,n)=>(taps[0][n]*(1-fx)+taps[1][n]*fx)*(1-fy)+(taps[2][n]*(1-fx)+taps[3][n]*fx)*fy);
      }
      const x=Math.min(c.sourceWidth-1,Math.max(0,Math.floor(u*c.sourceWidth)));
      const y=Math.min(c.sourceHeight-1,Math.max(0,Math.floor(v*c.sourceHeight)));
      return input.slice((y*c.sourceWidth+x)*4,(y*c.sourceWidth+x)*4+4);
    };
    for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
      const u=c.rectangle[0]+(x+.5)/c.width*(c.rectangle[2]-c.rectangle[0]);
      const v=c.rectangle[1]+(y+.5)/c.height*(c.rectangle[3]-c.rectangle[1]);
      const taps=[[-1,-1],[-1,1],[1,1],[1,-1]].map(([sx,sy])=>sample(u+sx*.5/c.width,v+sy*.5/c.height));
      const options={logarithmic:c.program.startsWith('grayscale-log'),scale:c.scale,maxClamp:c.maxClamp};
      const expected=c.fast?nativeMeterSample(sample(u,v,true),options):nativeMeterFourSamples(taps,options);
      for(let n=0;n<4;n++){const actual=native[(y*c.width+x)*4+n];maxResidual=Math.max(maxResidual,Math.abs(expected[n]-actual)/Math.max(1,Math.abs(expected[n]),Math.abs(actual)));}
      pixels++;
    }
  }
  assert.equal(pixels,402); assert.ok(maxResidual<1e-6,`${maxResidual}`);
});

test('source readback decodes log alpha or RGB with method-specific pre-exposure',()=>{
  assert.ok(Math.abs(decodeNativeMeterPixel([1,2,3,Math.log(100)],true)-100)<1e-12);
  const l=.3*10+.59*20+.11*30;
  assert.ok(Math.abs(decodeNativeMeterPixel([10,20,30,99],false)-l)<1e-6);
  assert.ok(Math.abs(decodeNativeMeterPixel([10,20,30,99],false,2,.25)-l*.25)<1e-6);
});
