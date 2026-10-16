// Original unmodified D3D11 shaders versus browser GLSL and actual texture filters.
import {createServer} from 'vite';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..'),source=path.resolve(root,'../exports/lighting/native-colorgrading-warp');
const report={evidenceId:'BF2-NATIVE-COLORGRADING-BROWSER-GPU-001',nativeGameCapture:false,errors:[]};
let server,browser;
const hash=b=>createHash('sha256').update(b).digest('hex');
const read=name=>fs.readFile(path.join(source,name));
const floats=b=>Array.from({length:b.length/4},(_,i)=>b.readFloatLE(i*4));
try{
  const manifest=JSON.parse(await read('execution.json')),input=await read('input.rgba32f.bin'),cube=await read('cube.rgba32f.bin');
  assert.equal(hash(input),manifest.inputSha256);assert.equal(hash(cube),manifest.cubeFloatSha256);
  const pq=await fs.readFile(path.resolve(source,'../native-colorgrading/pq-to-linear.r16f.bin'));assert.equal(hash(pq),manifest.pqLookupSha256);
  const reference=manifest.results.find(row=>row.tag==='packed'),graded=await read('packed-graded.rgba32f.bin'),final=await read('packed-final.rgba32f.bin');
  const encoded=await read('encoded.rgba32f.bin');assert.equal(hash(encoded),manifest.encodedSha256);
  assert.equal(hash(graded),reference.gradedSha256);assert.equal(hash(final),reference.finalSha256);
  assert.equal(hash(await read('float-graded.rgba32f.bin')),reference.gradedSha256,'native packed/float cube filters');
  assert.equal(hash(await read('float-final.rgba32f.bin')),reference.finalSha256,'native packed/float final pixels');
  server=await createServer({root,server:{host:'127.0.0.1',port:7748,strictPort:true,watch:null,hmr:false},logLevel:'warn'});await server.listen();
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-webgl','--ignore-gpu-blocklist']});
  const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  await page.route('**/grading-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'}));await page.goto('http://127.0.0.1:7748/grading-fixture');
  report.result=await page.evaluate(async fixture=>{
    const T=await import('/node_modules/three/build/three.module.js');
    const {createNativeGradingTextures,createNativeGradingPass}=await import('/src/source-colorgrading-renderer.js');
    const renderer=new T.WebGLRenderer();renderer.setSize(64,64);renderer.toneMapping=T.NoToneMapping;
    const textures=createNativeGradingTextures(new Float32Array(fixture.cube),new Uint16Array(fixture.pq));
    const pass=createNativeGradingPass(textures),rows=[];
    for(const stage of [0,1,2,3,4]){
      const input=new T.DataTexture(new Float32Array(stage===1?fixture.graded:stage===4?fixture.encoded:fixture.input),64,64,T.RGBAFormat,T.FloatType);input.needsUpdate=true;
      const target=new T.WebGLRenderTarget(64,64,{type:T.FloatType,depthBuffer:false});
      pass.render(renderer,input,1,target,stage);const actual=new Float32Array(64*64*4);await renderer.readRenderTargetPixelsAsync(target,0,0,64,64,actual);
      const expected=stage===0||stage===4?fixture.graded:stage===3?fixture.encoded:fixture.final;let maxAbsolute=0,differing=0,nonfinite=0;let worst=null;
      for(let i=0;i<actual.length;i++){if(stage===3&&i%4===3)continue;const delta=Math.abs(actual[i]-expected[i]);if(delta>maxAbsolute){maxAbsolute=delta;worst={index:i,actual:actual[i],expected:expected[i]};}differing+=actual[i]!==expected[i];nonfinite+=!Number.isFinite(actual[i]);}
      rows.push({stage,pixels:4096,scalars:actual.length,maxAbsolute,differing,nonfinite,worst});input.dispose();target.dispose();
    }
    const gl=renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');const hardware=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
    pass.dispose();textures.dispose();renderer.dispose();return {rows,hardware};
  },{input:floats(input),cube:floats(cube),pq:Array.from({length:1024},(_,i)=>pq.readUInt16LE(i*2)),graded:floats(graded),final:floats(final),encoded:floats(encoded)});
  assert.deepEqual(report.errors,[]);
  // Isolated native coordinates prove the texture conversion/filter separately.
  // Native WARP and AMD exp/log differ; keep an explicit half10-bit-quantum
  // ceiling for composed output instead of claiming bit-identical shader math.
  const limits=[.25/1023,1/32768,.5/1023,1/32768,1e-7];
  report.numericPolicy={limits,interpretation:'Packed and decoded cube filtering is bit-identical on WARP. Browser filtering with native PQ coordinates agrees within1e-7; GPU transcendental arithmetic produces bounded composed residuals. Native render-plane intermediate quantization remains separate.'};
  for(const row of report.result.rows){assert.equal(row.nonfinite,0);assert.ok(row.maxAbsolute<limits[row.stage],JSON.stringify(row));}
  report.pass=true;
}catch(error){report.pass=false;report.errors.push(String(error.stack??error));process.exitCode=1;}
finally{await browser?.close();await server?.close();await fs.writeFile(path.join(root,'test-results/source-colorgrading-gpu-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
