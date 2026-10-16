// Original RGB10A2 render-plane writes and unchanged native SDR merge.
import {createServer} from 'vite';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..'),lighting=path.resolve(root,'../exports/lighting');
const hash=b=>createHash('sha256').update(b).digest('hex');
const floats=b=>Array.from({length:b.length/4},(_,i)=>b.readFloatLE(i*4));
const vignette=process.env.BF2_VIGNETTE==='1',suffix=vignette?'-vignette':'';
const report={evidenceId:'BF2-NATIVE-COLORGRADING-RGB10-PLANE'+(vignette?'-VIGNETTE':'')+'-GPU-001',nativeGameCapture:false,errors:[]};
let server,browser;
try{
  const read=(folder,name)=>fs.readFile(path.join(lighting,folder,name));
  const folder='native-colorgrading-warp-rgb10-plane'+suffix,original='native-colorgrading-warp'+suffix;
  const manifest=JSON.parse(await read(folder,'execution.json'));
  assert.equal(manifest.intermediateFormat,'R10G10B10A2_UNORM');
  const old=JSON.parse(await read(original,'execution.json'));
  const input=await read(folder,'input.rgba32f.bin'),cube=await read(folder,'cube.rgba32f.bin');
  const graded=await read(original,'packed-graded.rgba32f.bin');
  const packed=await read(folder,'packed-graded.rgb10a2.bin'),final=await read(folder,'packed-final.rgba32f.bin');
  const pq=await read('native-colorgrading','pq-to-linear.r16f.bin');
  assert.equal(hash(input),manifest.inputSha256);assert.equal(hash(input),old.inputSha256);
  assert.equal(hash(cube),manifest.cubeFloatSha256);assert.equal(hash(pq),manifest.pqLookupSha256);
  assert.equal(hash(graded),old.results[0].gradedSha256);
  assert.equal(hash(packed),manifest.results[0].gradedSha256);assert.equal(hash(final),manifest.results[0].finalSha256);
  assert.equal(hash(await read(folder,'float-graded.rgb10a2.bin')),hash(packed));
  assert.equal(hash(await read(folder,'float-final.rgba32f.bin')),hash(final));
  const plane=[],low=[],high=[];
  for(let i=0;i<4096;i++){
    const word=packed.readUInt32LE(i*4);
    for(let c=0;c<4;c++){
      const scale=c===3?3:1023,code=(word>>>(c===3?30:10*c))&scale;
      plane.push(Math.fround(code/scale));
      low.push(Math.fround(Math.max(0,code-1)/scale));
      high.push(Math.fround(Math.min(scale,code+1)/scale));
    }
  }
  server=await createServer({root,server:{host:'127.0.0.1',port:7748,strictPort:true,watch:null,hmr:false},logLevel:'warn'});await server.listen();
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-webgl','--ignore-gpu-blocklist']});
  const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  await page.route('**/plane-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'}));await page.goto('http://127.0.0.1:7748/plane-fixture');
  report.result=await page.evaluate(async fixture=>{
    const T=await import('/node_modules/three/build/three.module.js');
    const {createNativeGradingTextures,createNativeGradingPass}=await import('/src/source-colorgrading-renderer.js');
    const renderer=new T.WebGLRenderer();renderer.setSize(64,64);renderer.toneMapping=T.NoToneMapping;
    const textures=createNativeGradingTextures(new Float32Array(fixture.cube),new Uint16Array(fixture.pq)),pass=createNativeGradingPass(textures,{vignette:fixture.vignette});
    const render=async(values,stage)=>{
      const input=new T.DataTexture(new Float32Array(values),64,64,T.RGBAFormat,T.FloatType);input.needsUpdate=true;
      const target=new T.WebGLRenderTarget(64,64,{type:T.FloatType,depthBuffer:false});pass.render(renderer,input,1,target,stage);
      const result=new Float32Array(16384);await renderer.readRenderTargetPixelsAsync(target,0,0,64,64,result);input.dispose();target.dispose();return result;
    };
    const compare=(actual,expected)=>{
      let maxAbsolute=0,differing=0,nonfinite=0,worst=null;
      for(let i=0;i<actual.length;i++){const delta=Math.abs(actual[i]-expected[i]);if(delta>maxAbsolute){maxAbsolute=delta;worst={index:i,actual:actual[i],expected:expected[i]};}differing+=actual[i]!==expected[i];nonfinite+=!Number.isFinite(actual[i]);}
      return {scalars:actual.length,maxAbsolute,differing,nonfinite,worst};
    };
    const isolated=await render(fixture.graded,5),merged=await render(fixture.plane,1),isolatedFinal=await render(fixture.graded,7);
    const composedPlane=await render(fixture.input,9),composedFinal=await render(fixture.input,6);
    const lower=await render(fixture.low,1),upper=await render(fixture.high,1);
    let isolatedCodeDifferences=0,composedCodeDifferences=0,maxCodeDifference=0,envelopeViolations=0;
    for(let i=0;i<isolated.length;i++){
      const scale=i%4===3?3:1023;
      const expected=Math.round(fixture.plane[i]*scale),quantized=Math.round(isolated[i]*scale),actual=Math.round(composedPlane[i]*scale);
      isolatedCodeDifferences+=quantized!==expected;composedCodeDifferences+=actual!==expected;maxCodeDifference=Math.max(maxCodeDifference,Math.abs(actual-expected));
      if(i%4!==3&&(composedFinal[i]<lower[i]-1/32768||composedFinal[i]>upper[i]+1/32768))envelopeViolations++;
    }
    const gl=renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');const hardware=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
    pass.dispose();textures.dispose();renderer.dispose();
    return {hardware,isolatedPlane:compare(isolated,fixture.plane),isolatedMerge:compare(merged,fixture.final),isolatedFinal:compare(isolatedFinal,fixture.final),composedPlane:compare(composedPlane,fixture.plane),composedFinal:compare(composedFinal,fixture.final),isolatedCodeDifferences,composedCodeDifferences,maxCodeDifference,envelopeViolations};
  },{input:floats(input),cube:floats(cube),pq:Array.from({length:1024},(_,i)=>pq.readUInt16LE(i*2)),graded:floats(graded),plane,low,high,final:floats(final),vignette:vignette?{evidenceId:'BF2-NATIVE-VIGNETTE-001',enabled:true,scale:[2,2],exponent:1,color:[0,0,0],opacity:.46}:null});
  assert.deepEqual(report.errors,[]);const r=report.result;
  for(const k of ['isolatedPlane','isolatedMerge','isolatedFinal','composedPlane','composedFinal'])assert.equal(r[k].nonfinite,0,k);
  assert.equal(r.isolatedCodeDifferences,0,'all 16,384 original framebuffer channel codes');
  assert.ok(r.isolatedPlane.maxAbsolute<1e-7);assert.ok(r.isolatedMerge.maxAbsolute<1/32768);assert.ok(r.isolatedFinal.maxAbsolute<1/32768);
  assert.ok(r.maxCodeDifference<=1,'bounded native WARP / browser transcendental differences may cross one quantization boundary');
  assert.equal(r.envelopeViolations,0,'composed output must remain in the native-code ±1 SDR merge envelope');
  report.policy={isolatedCodes:'Exact original RGB10A2 framebuffer codes',mergedResidual:1/32768,composedMaxCodeDifference:1,finalEnvelope:'Original quantized RGB codes ±1, with isolated merge arithmetic residual 1/32768.',nativeFrameParity:false};
  report.pass=true;
}catch(error){report.pass=false;report.errors.push(String(error.stack??error));process.exitCode=1;}
finally{await browser?.close();await server?.close();await fs.writeFile(path.join(root,`test-results/source-colorgrading-plane${suffix}-gpu-check.json`),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
