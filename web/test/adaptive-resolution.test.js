import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdaptiveResolution,ADAPTIVE_RESOLUTION_POLICY as P} from '../src/adaptive-resolution.js';

function run(controller,clock,{frameMs,workMs,seconds}) {
  for(let elapsed=0;elapsed<seconds*1000;elapsed+=frameMs){clock.t+=frameMs;controller.frame(workMs);}
}

test('a GPU-bound frame rate lowers the render scale in steps down to the floor',()=>{
  const clock={t:0},applied=[];
  const c=createAdaptiveResolution(scale=>applied.push(scale),{now:()=>clock.t});
  run(c,clock,{frameMs:36,workMs:17,seconds:30});
  assert.equal(applied[0],1);
  assert.ok(applied.length>3);
  for(let i=1;i<applied.length;i++)assert.ok(applied[i]<applied[i-1]);
  assert.equal(c.snapshot().scale,P.minScale);
});

test('a CPU-bound frame rate never lowers the scale',()=>{
  const clock={t:0},applied=[];
  const c=createAdaptiveResolution(scale=>applied.push(scale),{now:()=>clock.t});
  run(c,clock,{frameMs:30,workMs:29,seconds:20});
  assert.deepEqual(applied,[1]);
});

test('a vsync-capped fast GPU is never downscaled',()=>{
  const clock={t:0},applied=[];
  const c=createAdaptiveResolution(scale=>applied.push(scale),{now:()=>clock.t});
  run(c,clock,{frameMs:1000/60,workMs:6,seconds:20});
  assert.deepEqual(applied,[1]);
});

test('headroom restores the scale after the cooldown',()=>{
  const clock={t:0},applied=[];
  const c=createAdaptiveResolution(scale=>applied.push(scale),{now:()=>clock.t,initialScale:.6});
  run(c,clock,{frameMs:10,workMs:5,seconds:20});
  assert.equal(c.snapshot().scale,1);
  for(let i=1;i<applied.length;i++)assert.ok(applied[i]>applied[i-1]);
});

test('a long pause is a discontinuity, not a GPU-bound frame',()=>{
  const clock={t:0},applied=[];
  const c=createAdaptiveResolution(scale=>applied.push(scale),{now:()=>clock.t});
  for(let pause=0;pause<6;pause++){run(c,clock,{frameMs:16,workMs:8,seconds:.5});clock.t+=5000;}
  assert.deepEqual(applied,[1]);
});
