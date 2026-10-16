import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {evaluateNativeColorCubeTexel,originalGradingVoxel,nativeHdrGradingCoordinates} from '../src/source-colorgrading.js';
const root=path.resolve(import.meta.dirname,'../..');
const read=name=>fs.readFileSync(path.join(root,name));
const words=bytes=>new Uint32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
const floats=bytes=>new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const output='exports/lighting/native-colorcube-warp/';
const report=JSON.parse(read(output+'execution.json'));
const sourceFiles=fs.readdirSync(path.join(root,'exports/lighting/indoor-color-grading'),{recursive:true});
const sourceFile=sourceFiles.find(file=>file.includes('f7f7ed97-693f-c8c5-8af1-050bdae520df')&&fs.statSync(path.join(root,'exports/lighting/indoor-color-grading',file)).isFile()&&fs.statSync(path.join(root,'exports/lighting/indoor-color-grading',file)).size===143748);
const source=read(path.join('exports/lighting/indoor-color-grading',sourceFile)),sourceWords=words(source);

test('original HDR cube computation preserves every source10-bit RGB value at neutral settings after native Y flip',()=>{
  assert.equal(sha(source),report.sourceCubeSha256);
  assert.equal(sha(read('exports/lighting/native-postprocess-shaders/cube-hdr-one-none.dxbc')),report.shaderSha256);
  const actual=words(read(output+'neutral.rgb10a2.bin'));
  for(let z=0;z<33;z++)for(let y=0;y<33;y++)for(let x=0;x<33;x++){
    const src=sourceWords[(z*33+32-y)*33+x],pixel=actual[(z*33+y)*33+x];
    assert.equal(pixel&0x3fffffff,src&0x3fffffff);
    assert.equal(pixel>>>30,3);
  }
});

test('native color-cube arithmetic agrees with all original WARP voxels across three explicit exposure fixtures',()=>{
  let scalarCount=0,differingQuantizedScalars=0,max10BitDelta=0;
  for(const row of report.results){
    const pixels=read(output+row.tag+'.rgb10a2.bin'),cb=read(output+row.tag+'.cb.bin');
    assert.equal(sha(pixels),row.sha256);assert.equal(sha(cb),row.constantSha256);
    const actual=words(pixels),constants=floats(cb);
    for(let z=0;z<33;z++)for(let y=0;y<33;y++)for(let x=0;x<33;x++){
      const expected=evaluateNativeColorCubeTexel(originalGradingVoxel(sourceWords,x,y,z),constants),packed=actual[(z*33+y)*33+x];
      for(let channel=0;channel<3;channel++){
        const quantized=Math.round(Math.max(0,Math.min(1,expected[channel]))*1023);
        const delta=Math.abs(quantized-((packed>>>(10*channel))&1023));
        max10BitDelta=Math.max(max10BitDelta,delta);differingQuantizedScalars+=delta!==0;scalarCount++;
        assert.ok(delta<=1,`Native WARP10-bit difference ${delta} at ${row.tag}/${x}/${y}/${z}/${channel}`);
      }
    }
  }
  assert.equal(scalarCount,323433);
  console.log(JSON.stringify({kind:'native-colorcube-arithmetic',scalarCount,differingQuantizedScalars,max10BitDelta}));
});

test('HDR tonemap grading coordinates address the33-cubed interior centers and reject invalid source extents',()=>{
  const black=nativeHdrGradingCoordinates([0,0,0]),white=nativeHdrGradingCoordinates([100,100,100]);
  assert.ok(black.every(value=>value>=.5/33&&value<.5/33+.000001));
  assert.ok(white.every(value=>Math.abs(value-32.5/33)<1e-6));
  assert.throws(()=>originalGradingVoxel(new Uint32Array(1),0,0,0),/33-cubed/);
  assert.throws(()=>originalGradingVoxel(sourceWords,0,33,0),/coordinate/);
});
