// Original unchanged DXBC on CPU WARP versus real Three/WebGL, including FP16 reduction/readback.
import {createServer} from 'vite';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {DataUtils} from 'three';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.resolve(root,'../exports/lighting/native-exposure-warp');
const report={evidenceId:'BF2-NATIVE-EXPOSURE-BROWSER-GPU-001',nativeGameCapture:false,errors:[]};
let server,browser;
const read=name=>fs.readFile(path.join(source,name));
async function values(name,half=false){const b=await read(name);return Array.from({length:b.length/(half?2:4)},(_,i)=>half?b.readUInt16LE(i*2):b.readFloatLE(i*4));}
try {
  const manifest=JSON.parse(await read('manifest.json')),graphs=JSON.parse(await read('graphs.json'));
  const cases=await Promise.all(manifest.cases.map(async c=>({...c,input:await values(`case${c.index}-input.rgba32f.bin`),expected:await values(`case${c.index}-native.rgba32f.bin`)})));
  const graph=graphs.graphs.find(g=>g.fast);
  const graphFixture={...graph,input:await values(graph.input),passes:await Promise.all(graph.passes.map(async p=>({...p,expected:await values(p.file,true)})))};
  server=await createServer({root,server:{host:'127.0.0.1',port:7748,strictPort:true,watch:null,hmr:false},logLevel:'warn'});await server.listen();
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-webgl','--ignore-gpu-blocklist']});
  const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  await page.route('**/exposure-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'}));
  await page.goto('http://127.0.0.1:7748/exposure-fixture');
  report.result=await page.evaluate(async({cases,graph})=>{
    const THREE=await import('/node_modules/three/build/three.module.js');
    const {FullScreenQuad}=await import('/node_modules/three/examples/jsm/postprocessing/Pass.js');
    const {NATIVE_METER_FRAGMENT_GLSL}=await import('/src/source-exposure-meter.js');
    const {createNativeExposureMeter}=await import('/src/source-exposure-meter-renderer.js');
    const renderer=new THREE.WebGLRenderer();renderer.setSize(32,16);renderer.toneMapping=THREE.NoToneMapping;
    const gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');
    const hardware=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
    const makeTexture=(input,width,height,fast)=>{
      const texture=new THREE.DataTexture(new Float32Array(input),width,height,THREE.RGBAFormat,THREE.FloatType);
      texture.minFilter=texture.magFilter=fast?THREE.LinearFilter:THREE.NearestFilter;
      texture.generateMipmaps=false;texture.needsUpdate=true;return texture;
    };
    const material=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,blending:THREE.NoBlending,
      uniforms:{source:{value:null},inverseDestinationSize:{value:new THREE.Vector2()},meterRectangle:{value:new THREE.Vector4()},
        meterScale:{value:1},maxClampColor:{value:new THREE.Vector3(65504,65504,65504)},logarithmic:{value:true},fastPath:{value:true}},
      vertexShader:'varying vec2 screenUv;void main(){screenUv=position.xy*.5+.5;gl_Position=vec4(position.xy,0.0,1.0);}',fragmentShader:NATIVE_METER_FRAGMENT_GLSL});
    const quad=new FullScreenQuad(material),rows=[];
    for(const c of cases){
      const texture=makeTexture(c.input,c.sourceWidth,c.sourceHeight,c.fast);
      const target=new THREE.WebGLRenderTarget(c.width,c.height,{type:THREE.FloatType,depthBuffer:false});
      material.uniforms.source.value=texture;material.uniforms.inverseDestinationSize.value.set(1/c.width,1/c.height);
      material.uniforms.meterRectangle.value.fromArray(c.rectangle);material.uniforms.meterScale.value=c.scale;
      material.uniforms.logarithmic.value=c.program.startsWith('grayscale-log');material.uniforms.fastPath.value=c.fast;
      renderer.setRenderTarget(target);quad.render(renderer);
      const actual=new Float32Array(c.width*c.height*4);await renderer.readRenderTargetPixelsAsync(target,0,0,c.width,c.height,actual);
      let maxNormalized=0,maxAbsolute=0;
      actual.forEach((v,i)=>{const d=Math.abs(v-c.expected[i]);maxAbsolute=Math.max(maxAbsolute,d);maxNormalized=Math.max(maxNormalized,d/Math.max(1,Math.abs(c.expected[i])));});
      rows.push({index:c.index,program:c.program,pixels:c.width*c.height,maxNormalized,maxAbsolute});texture.dispose();target.dispose();
    }
    const input=makeTexture(graph.input,graph.sourceWidth,graph.sourceHeight,true),targets=[],graphRows=[];
    let texture=input;
    material.uniforms.meterScale.value=1;material.uniforms.fastPath.value=true;
    for(const pass of graph.passes){
      const target=new THREE.WebGLRenderTarget(pass.width,pass.height,{type:THREE.HalfFloatType,depthBuffer:false,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter});targets.push(target);
      material.uniforms.source.value=texture;material.uniforms.inverseDestinationSize.value.set(1/pass.width,1/pass.height);material.uniforms.meterRectangle.value.fromArray(pass.rectangle);material.uniforms.logarithmic.value=pass.index===0;
      renderer.setRenderTarget(target);quad.render(renderer);
      const actual=new Uint16Array(pass.width*pass.height*4);await renderer.readRenderTargetPixelsAsync(target,0,0,pass.width,pass.height,actual);
      let maxNormalized=0,maxHalfSteps=0,exact=0;
      actual.forEach((bits,i)=>{
        const value=THREE.DataUtils.fromHalfFloat(bits),expected=THREE.DataUtils.fromHalfFloat(pass.expected[i]);
        maxNormalized=Math.max(maxNormalized,Math.abs(value-expected)/Math.max(1,Math.abs(expected)));
        maxHalfSteps=Math.max(maxHalfSteps,Math.abs(bits-pass.expected[i]));if(bits===pass.expected[i])exact++;
      });
      graphRows.push({index:pass.index,pixels:pass.width*pass.height,maxNormalized,maxHalfSteps,exact,half:pass.width===1?Array.from(actual):undefined});texture=target.texture;
    }
    renderer.setRenderTarget(null);
    const meter=createNativeExposureMeter(renderer),restoreTarget=new THREE.WebGLRenderTarget(1,1);
    renderer.setRenderTarget(restoreTarget);
    const result=await meter.measure(input,graph.sourceWidth,graph.sourceHeight,{rectangle:graph.passes[0].rectangle});
    const restored=renderer.getRenderTarget()===restoreTarget;
    // Same fixed targets must accept a different source size/crop, then suppress a disposed read.
    const constant=makeTexture(new Array(16*8).fill([128,128,128,1]).flat(),16,8,true);
    const resized=await meter.measure(constant,16,8,{spotScale:.797});
    const single=makeTexture([256,256,256,1],1,1,true),onePixel=await meter.measure(single,1,1);
    const meterSnapshot=meter.snapshot();
    const pending=meter.measure(constant,16,8);meter.dispose();const disposedRead=await pending;
    const lifecycle={restored,resized,onePixel,disposedRead,snapshot:meterSnapshot};
    const glError=gl.getError(),programs=renderer.info.programs.map(p=>gl.getProgramParameter(p.program,gl.LINK_STATUS));
    renderer.setRenderTarget(null);restoreTarget.dispose();targets.forEach(t=>t.dispose());input.dispose();constant.dispose();single.dispose();material.dispose();quad.dispose();renderer.dispose();
    return {hardware,cases:rows,graph:graphRows,meter:result,lifecycle,glError,programs};
  },{cases,graph:graphFixture});
  const result=report.result;
  for(const c of result.cases)assert.ok(c.maxNormalized<2e-6,`shader case ${c.index}: ${c.maxNormalized}`);
  assert.equal(result.cases.reduce((n,c)=>n+c.pixels,0),402);
  // Each FP16 write introduces at most one half-ULP relative to the other backend.
  // Record accumulated error separately; this is not a shader equation tolerance.
  for(const p of result.graph)assert.ok(p.maxHalfSteps<=p.index+1,`half graph pass ${p.index}: ${p.maxHalfSteps}`);
  assert.deepEqual(result.meter.half,result.graph.at(-1).half);
  const nativeHalf=graphFixture.passes.at(-1).expected,nativeLog=DataUtils.fromHalfFloat(nativeHalf[3]);
  report.finalNativeEV=Math.log2(Math.exp(nativeLog)*8);
  report.finalBrowserEV=Math.log2(result.meter.luminance*8);
  report.finalEVResidual=Math.abs(report.finalNativeEV-report.finalBrowserEV);
  assert.ok(report.finalEVResidual<10/1024*Math.LOG2E);
  assert.equal(result.lifecycle.restored,true);assert.equal(result.lifecycle.disposedRead,null);
  assert.ok(Math.abs(result.lifecycle.resized.luminance-128)/128<1/256);
  assert.ok(Math.abs(result.lifecycle.onePixel.luminance-256)/256<1/256);
  assert.equal(result.lifecycle.onePixel.passes,1);assert.equal(result.lifecycle.snapshot.allocatedBytes,349536);
  assert.equal(result.glError,0);assert.ok(result.programs.every(Boolean));assert.deepEqual(report.errors,[]);report.pass=true;
} catch(error){report.pass=false;report.errors.push(String(error.stack??error));process.exitCode=1;}
finally {
  await browser?.close();await server?.close();await fs.mkdir(path.join(root,'test-results'),{recursive:true});
  await fs.writeFile(path.join(root,'test-results/source-exposure-gpu-check.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({pass:report.pass,hardware:report.result?.hardware,shaderCases:report.result?.cases,graph:report.result?.graph,finalEVResidual:report.finalEVResidual,errors:report.errors},null,2));
}
