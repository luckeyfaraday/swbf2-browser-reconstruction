import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {HalfFloatType,RedFormat,RepeatWrapping,ClampToEdgeWrapping,DataUtils} from 'three';
import {createSourceIesTexture,loadSourceIes} from '../src/source-ies.js';

const doc=JSON.parse(fs.readFileSync(new URL('../public/assets/lighting/source-ies.json',import.meta.url)));
const bytes=fs.readFileSync(new URL('../public/assets/lighting/source-ies-lamp-01.r16f.bin',import.meta.url));
const buffer=()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);

test('all native IES texel words match the recovered resource and manifest hash',()=>{
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),doc.payloadSha256);
  const source=fs.readFileSync(new URL('../../exports/lighting/direct-ies/raw/12614494969977180257.res',import.meta.url));
  assert.deepEqual(bytes,source.subarray(32,32800));
  const texture=createSourceIesTexture(doc,buffer());
  for(let i=0;i<16384;i++)assert.equal(texture.image.data[i],source.readUInt16LE(32+i*2));
  const values=Array.from(texture.image.data,DataUtils.fromHalfFloat);
  assert.equal(Math.min(...values),doc.minimum);assert.equal(Math.max(...values),doc.maximum);
  assert.equal(texture.type,HalfFloatType);assert.equal(texture.format,RedFormat);
  assert.equal(texture.wrapS,RepeatWrapping);assert.equal(texture.wrapT,ClampToEdgeWrapping);
  assert.equal(texture.flipY,false);assert.equal(texture.generateMipmaps,false);
  texture.dispose();
});

test('loader retains raw texels and header values for the separate native color producer',async()=>{
  const paths=[];
  const result=await loadSourceIes({fetchImpl:async url=>{
    paths.push(url);return {ok:true,json:async()=>doc,arrayBuffer:async()=>buffer()};
  }});
  assert.deepEqual(paths,['/assets/lighting/source-ies.json',doc.url]);
  assert.equal(result.document.sourceHeaderScalars.offset4,6.749266147613525);
  assert.equal(result.document.sourceHeaderScalars.offset8,19.0513916015625);
  assert.equal(result.texture.image.data[0],bytes.readUInt16LE(0));
  let disposed=false;result.texture.addEventListener('dispose',()=>{disposed=true;});
  result.dispose();assert.ok(disposed);
});

test('invalid texture shape/format and incomplete fetches are rejected',async()=>{
  assert.throws(()=>createSourceIesTexture({...doc,width:64},buffer()),/128x128/);
  assert.throws(()=>createSourceIesTexture(doc,new ArrayBuffer(12)),/128x128/);
  await assert.rejects(loadSourceIes({fetchImpl:async()=>({ok:false,status:404})}),/404/);
});
