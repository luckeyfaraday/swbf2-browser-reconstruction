import test from 'node:test';
import assert from 'node:assert/strict';
import {exposureAtEV,adaptExposureEV} from '../src/source-exposure.js';
test('photographic exposure halves per EV and compensation applies in stops',()=>{
  assert.equal(exposureAtEV(8),exposureAtEV(7)/2);
  assert.equal(exposureAtEV(8,1),exposureAtEV(8)*2);
  assert.ok(Math.abs(exposureAtEV(8,-.5)-.002301779886)<1e-10);
});
test('native frame adaptation receives bounded targets and preserves its capped dt/time behavior',()=>{
  const source={minEV:7,maxEV:9,darkAdaptationTime:.8,lightAdaptationTime:.8};
  let fine=7;for(let tick=0;tick<60;tick++)fine=adaptExposureEV(fine,100,1/60,source);
  const coarse=adaptExposureEV(7,100,1,source);
  assert.equal(coarse,9);
  assert.ok(Math.abs(fine-(9-2*Math.pow(1-(1/60)/.8,60)))<1e-12);
  assert.equal(adaptExposureEV(9,-100,1,source),7);
  assert.equal(adaptExposureEV(8,9,0,source),8);
});
