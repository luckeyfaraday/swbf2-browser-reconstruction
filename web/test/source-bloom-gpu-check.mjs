// Browser GPU bloom versus the unchanged native GaussianPyramidCs, Tex2d/Tex2dDouble
// and Tonemap bytecode on WARP (tools/materials/native-bloom-warp.ps1).
// Evidence BF2-NATIVE-BLOOM-GPU-001. No native game capture.
import {createServer} from 'vite';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..'),folder=path.resolve(root,'../exports/lighting/native-bloom-warp'),output=path.join(root,'test-results');
const sha=b=>createHash('sha256').update(b).digest('hex');
const floats=b=>Array.from({length:b.length/4},(_,i)=>b.readFloatLE(i*4));
// DXGI R11G11B10_FLOAT: R bits 0-10, G 11-21 (6-bit mantissa, 5-bit exponent), B 22-31 (5-bit mantissa).
const small=(bits,mantissa)=>{const m=bits&((1<<mantissa)-1),e=bits>>mantissa;return e===0?m*2**(-14-mantissa):e===31?(m?NaN:Infinity):(1+m/2**mantissa)*2**(e-15);};
const encode=(value,mantissa)=>{if(!(value>0))return 0;const e=Math.floor(Math.log2(value));if(e<-14)return Math.round(value/2**(-14-mantissa));return ((e+15)<<mantissa)+Math.round((value/2**e-1)*2**mantissa);};
const codeSteps=(a,b,channel)=>{const m=channel===2?5:6;return Math.abs(encode(a,m)-encode(b,m));};
const r11g11b10=b=>Array.from({length:b.length/4},(_,i)=>{const v=b.readUInt32LE(i*4);return [small(v&2047,6),small((v>>>11)&2047,6),small(v>>>22,5)];}).flat();
const report={evidenceId:'BF2-NATIVE-BLOOM-GPU-001',nativeGameCapture:false,errors:[]};
let server,browser;
try{
  const doc=JSON.parse(await fs.readFile(path.join(folder,'execution.json'),'utf8'));
  const input=await fs.readFile(path.join(folder,'input.rgba32f.bin'));assert.equal(sha(input),doc.inputSha256);
  const load=async row=>{const bytes=await fs.readFile(path.join(folder,row.output));assert.equal(sha(bytes),row.sha256);return bytes;};
  const mips=[],levels=[];let pq=null;
  for(const row of doc.cases){
    if(row.kind==='pyramid'&&row.mode==='native')mips[row.level-1]={...row,rgb:floats(await load(row)).filter((_,i)=>i%4!==3)};
    if(row.kind==='upsample')levels[row.level]={...row,rgb:r11g11b10(await load(row))};
    if(row.kind==='tonemap-pq')pq={...row,rgba:floats(await load(row))};
  }
  server=await createServer({root,server:{host:'127.0.0.1',port:7762,strictPort:true,watch:null,hmr:false},logLevel:'warn'});await server.listen();
  const args=['--enable-webgl','--ignore-gpu-blocklist',...(process.env.BF2_GPU==='dgpu'?['--force_high_performance_gpu']:[])];
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args});
  const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  await page.route('**/bloom-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'}));await page.goto('http://127.0.0.1:7762/bloom-fixture');
  const result=await page.evaluate(async fixture=>{
    const T=await import('/node_modules/three/build/three.module.js');
    const {createNativeBloom,gaussianSimpleWeights}=await import('/src/source-bloom.js');
    const {createNativeGradingPass,createNativeGradingTextures}=await import('/src/source-colorgrading-renderer.js');
    const {width:W,height:H}=fixture,renderer=new T.WebGLRenderer();renderer.setSize(W,H);renderer.toneMapping=T.NoToneMapping;
    const gl=renderer.getContext(),info=gl.getExtension('WEBGL_debug_renderer_info');
    const input=new T.DataTexture(new Float32Array(fixture.input),W,H,T.RGBAFormat,T.FloatType);
    input.minFilter=input.magFilter=T.LinearFilter;input.wrapS=input.wrapT=T.ClampToEdgeWrapping;input.needsUpdate=true;
    const read=(target,half=false)=>{const {width,height}=target;const buffer=half?new Uint16Array(width*height*4):new Float32Array(width*height*4);renderer.readRenderTargetPixels(target,0,0,width,height,buffer);
      const rgb=[];for(let i=0;i<width*height;i++)for(let c=0;c<3;c++)rgb.push(half?T.DataUtils.fromHalfFloat(buffer[i*4+c]):buffer[i*4+c]);return rgb;};
    const precise=createNativeBloom(renderer,{type:T.FloatType});precise.render(input,W,H);
    const targets=precise.debugTargets();
    const production=createNativeBloom(renderer);production.render(input,W,H);
    const textures=createNativeGradingTextures(new Float32Array(33**3*4),new Uint16Array(1024));
    const pass=createNativeGradingPass(textures);pass.setBloom(targets.levels[0].texture,fixture.bloomScale);
    const graded=new T.WebGLRenderTarget(W,H,{type:T.FloatType,depthBuffer:false});pass.render(renderer,input,fixture.colorScale,graded,3);
    const pqBuffer=new Float32Array(W*H*4);renderer.readRenderTargetPixels(graded,0,0,W,H,pqBuffer);
    return {gpu:gl.getParameter(info?info.UNMASKED_RENDERER_WEBGL:gl.RENDERER),weights:gaussianSimpleWeights(fixture.levels,.5).slice(0,fixture.levels),
      mips:targets.mips.map(t=>read(t)),levels:targets.levels.map(t=>read(t)),productionLevel0:read(production.debugTargets().levels[0],true),pq:Array.from(pqBuffer)};
  },{width:doc.width,height:doc.height,levels:doc.levels,input:floats(input),bloomScale:[.075,.11,.115],colorScale:.6});
  report.gpu=result.gpu;
  const rel=(a,b)=>{let worst=0;for(let i=0;i<a.length;i++)worst=Math.max(worst,Math.abs(a[i]-b[i])/Math.max(Math.abs(b[i]),1e-3));return worst;};
  report.weights={browser:result.weights,native:doc.weights,maxAbs:Math.max(...result.weights.map((w,i)=>Math.abs(w-doc.weights[i])))};
  report.pyramid=mips.map((row,i)=>({level:row.level,size:[row.width,row.height],nativeShader:row.shader,maxRelative:rel(result.mips[i],row.rgb)}));
  // Each GPU's bilinear rounding can move a value across one truncation boundary:
  // the float32-mip chain is bounded by one R11G11B10 code per channel.
  const compare=(a,b)=>{let exact=0,beyondOne=0,maxSteps=0;for(let i=0;i<b.length;i++){const steps=codeSteps(a[i],b[i],i%3);maxSteps=Math.max(maxSteps,steps);if(a[i]===b[i])exact++;if(steps>1)beyondOne++;}return {maxRelative:rel(a,b),exactCodes:exact,channels:b.length,maxCodeSteps:maxSteps,beyondOneCode:beyondOne};};
  report.upsample=levels.map((row,i)=>({level:i,size:[row.width,row.height],...compare(result.levels[i],row.rgb)}));
  report.productionHalfLevel0=compare(result.productionLevel0,levels[0].rgb);
  let pqWorst=0;for(let i=0;i<pq.rgba.length;i++)if(i%4!==3)pqWorst=Math.max(pqWorst,Math.abs(result.pq[i]-pq.rgba[i]));
  report.tonemapPq={maxAbsolute:pqWorst,note:'PQ-encoded (main + BloomScale*bloom)*colorScale; bloom from the browser level 0.'};
  assert.equal(report.errors.length,0,report.errors.join('\n'));
  assert.ok(report.weights.maxAbs<2e-7,'weights');
  for(const row of report.pyramid)assert.ok(row.maxRelative<2e-4,`pyramid level ${row.level}: ${row.maxRelative}`);
  for(const row of report.upsample)assert.ok(row.beyondOneCode===0&&row.exactCodes/row.channels>=.98,`upsample level ${row.level}: ${JSON.stringify(row)}`);
  // Production stores mips in half float (native scene-colour mip format untraced).
  assert.ok(report.productionHalfLevel0.maxCodeSteps<=2&&report.productionHalfLevel0.exactCodes/report.productionHalfLevel0.channels>=.8,`production half-float chain: ${JSON.stringify(report.productionHalfLevel0)}`);
  assert.ok(report.tonemapPq.maxAbsolute<2e-3,`tonemap PQ ${report.tonemapPq.maxAbsolute}`);
  report.pass=true;
} catch(error){report.pass=false;report.fatal=String(error.stack??error);console.error(error);process.exitCode=1;}
finally{
  await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'source-bloom-gpu-check.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({pass:report.pass,gpu:report.gpu,weights:report.weights?.maxAbs,pyramid:report.pyramid,upsample:report.upsample,production:report.productionHalfLevel0,tonemap:report.tonemapPq,fatal:report.fatal},null,1));
  await browser?.close();await server?.close();
}
