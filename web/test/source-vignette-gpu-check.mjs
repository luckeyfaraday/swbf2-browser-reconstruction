import {createServer} from 'vite';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..'),folder=path.resolve(root,'../exports/lighting/native-vignette-warp');
const sha=b=>createHash('sha256').update(b).digest('hex');
const floats=b=>Array.from({length:b.length/4},(_,i)=>b.readFloatLE(i*4));
const report={evidenceId:'BF2-NATIVE-VIGNETTE-GPU-001',nativeGameCapture:false,errors:[]};
let server,browser;
try{
  const doc=JSON.parse(await fs.readFile(path.join(folder,'execution.json'),'utf8'));
  const input=await fs.readFile(path.join(folder,'input.rgba32f.bin'));assert.equal(sha(input),doc.inputSha256);
  const cases=[];
  for(const row of doc.cases){const bytes=await fs.readFile(path.join(folder,row.output));assert.equal(sha(bytes),row.sha256);cases.push({...row,expected:floats(bytes)});}
  server=await createServer({root,server:{host:'127.0.0.1',port:7748,strictPort:true,watch:null,hmr:false},logLevel:'warn'});await server.listen();
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-webgl','--ignore-gpu-blocklist']});
  const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  await page.route('**/vignette-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'}));await page.goto('http://127.0.0.1:7748/vignette-fixture');
  report.result=await page.evaluate(async fixture=>{
    const T=await import('/node_modules/three/build/three.module.js'),{FullScreenQuad}=await import('/node_modules/three/examples/jsm/postprocessing/Pass.js');
    const {NATIVE_VIGNETTE_GLSL}=await import('/src/source-vignette.js');
    const renderer=new T.WebGLRenderer();renderer.setSize(fixture.width,fixture.height);renderer.toneMapping=T.NoToneMapping;
    const input=new T.DataTexture(new Float32Array(fixture.input),fixture.width,fixture.height,T.RGBAFormat,T.FloatType);input.needsUpdate=true;
    const material=new T.RawShaderMaterial({glslVersion:T.GLSL3,depthTest:false,depthWrite:false,toneMapped:false,
      uniforms:{source:{value:input},params:{value:new T.Vector3()},vignetteColor:{value:new T.Vector4()},colorScale:{value:new T.Vector3()}},
      vertexShader:'precision highp float;in vec3 position;out vec2 uv;void main(){uv=position.xy*.5+.5;gl_Position=vec4(position.xy,0,1);}',
      fragmentShader:`precision highp float;uniform sampler2D source;uniform vec3 params,colorScale;uniform vec4 vignetteColor;in vec2 uv;out vec4 result;
        ${NATIVE_VIGNETTE_GLSL}
        void main(){vec3 c=nativeVignette(texture(source,uv).rgb*colorScale,uv,params,vignetteColor);
        c=mix(exp2(log2(abs(c))*0.4166666567325592)*1.055-.055,c*12.92,lessThanEqual(c,vec3(.0031308)));
        result=vec4(c,dot(c,vec3(.212671,.715160,.072169)));}`});
    const quad=new FullScreenQuad(material),target=new T.WebGLRenderTarget(fixture.width,fixture.height,{type:T.FloatType,depthBuffer:false}),rows=[];
    for(const row of fixture.cases){
      material.uniforms.params.value.set(...row.scale,Math.fround(1/row.exponent));material.uniforms.vignetteColor.value.set(...row.color,row.opacity);material.uniforms.colorScale.value.fromArray(row.colorScale);
      renderer.setRenderTarget(target);quad.render(renderer);const pixels=new Float32Array(fixture.width*fixture.height*4);await renderer.readRenderTargetPixelsAsync(target,0,0,fixture.width,fixture.height,pixels);
      let maxAbsolute=0,maxUnitFloorRelative=0,nonfinite=0;
      for(let i=0;i<pixels.length;i++){const delta=Math.abs(pixels[i]-row.expected[i]);maxAbsolute=Math.max(maxAbsolute,delta);maxUnitFloorRelative=Math.max(maxUnitFloorRelative,delta/Math.max(1,Math.abs(row.expected[i])));nonfinite+=!Number.isFinite(pixels[i]);}
      rows.push({index:row.index,scalars:pixels.length,maxAbsolute,maxUnitFloorRelative,nonfinite});
    }
    const gl=renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info'),hardware=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
    quad.dispose();material.dispose();target.dispose();input.dispose();renderer.dispose();return {hardware,rows};
  },{width:doc.width,height:doc.height,input:floats(input),cases});
  assert.deepEqual(report.errors,[]);for(const row of report.result.rows){assert.equal(row.nonfinite,0);assert.ok(row.maxUnitFloorRelative<1/32768,JSON.stringify(row));}
  report.policy={unitFloorRelativeLimit:1/32768,explanation:'Original WARP and AMD shader transcendental arithmetic; no bit-identical frame claim.'};report.pass=true;
}catch(error){report.pass=false;report.errors.push(String(error.stack??error));process.exitCode=1;}
finally{await browser?.close();await server?.close();await fs.writeFile(path.join(root,'test-results/source-vignette-gpu-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
