import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseVariant} from '../src/audio.js';

test('source random shot selection avoids the recovered last-three history without exhausting small banks',()=>{
  const history=[],sequence=[];
  for(let index=0;index<100;index++){const selected=chooseVariant(9,history,()=>.4,3);assert.ok(!sequence.slice(-3).includes(selected));sequence.push(selected);}
  const small=[];assert.equal(chooseVariant(1,small,()=>.5,3),0);assert.equal(chooseVariant(1,small,()=>.5,3),0);
  assert.equal(chooseVariant(0,[],()=>.5),-1);
});
