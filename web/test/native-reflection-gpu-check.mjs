// Actual retained native mip bytes through WebGL; no native-game parity claim.
import {createServer} from 'vite';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let server,browser;
const report={kind:'native-original-reflection-mips-gpu-check',errors:[]};
try {
  server=await createServer({root,server:{host:'127.0.0.1',port:7747,strictPort:true,watch:null,hmr:false},logLevel:'warn'});await server.listen();
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-webgl','--ignore-gpu-blocklist']});
  const page=await browser.newPage();page.on('pageerror',error=>report.errors.push(String(error)));
  page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
  await page.route('**/native-cube-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'}));
  await page.goto('http://127.0.0.1:7747/native-cube-fixture');
  report.result=await page.evaluate(async()=>{
    const THREE=await import('/node_modules/three/build/three.module.js');
    const {prepareSourceReflectionSampling,SOURCE_REFLECTION_SAMPLING_GLSL,sourceReflectionLod}=await import('/src/source-reflection-sampling.js');
    const document=await fetch('/assets/source-reflections.json').then(response=>response.json());
    const volume=document.volumes.find(volume=>document.payloads.find(payload=>payload.id===volume.payloadId)?.mipCount===6);
    const sampling=await prepareSourceReflectionSampling(document),cube=await sampling.select(volume.id);
    const renderer=new THREE.WebGLRenderer();renderer.setSize(4,4);renderer.toneMapping=THREE.NoToneMapping;renderer.outputColorSpace=THREE.LinearSRGBColorSpace;
    const target=new THREE.WebGLRenderTarget(4,4,{type:THREE.FloatType,format:THREE.RGBAFormat});renderer.setRenderTarget(target);
    const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,10);
    const material=new THREE.ShaderMaterial({uniforms:{...sampling.uniforms,direction:{value:new THREE.Vector3(1,0,0)},level:{value:0},roughness:{value:0},nativeMode:{value:0}},
      vertexShader:'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',
      fragmentShader:SOURCE_REFLECTION_SAMPLING_GLSL+'\nuniform vec3 direction;uniform float level;uniform float roughness;uniform float nativeMode;void main(){if(nativeMode>1.5){float cone=bf2_sourceReflectionAngularRoughness(1.0,roughness);gl_FragColor=vec4(log2(1.0+bf2_nativeReflectionMipBias*cone),roughness,cone,1.0);}else gl_FragColor=nativeMode>.5?bf2_sampleNativeReflection(direction,direction,roughness):textureCubeLodEXT(bf2_nativeReflectionCube,direction,level);}'});
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),material));
    function cpuCenter(face,level){const image=(level===0?cube.images[face]:cube.mipmaps[level-1].image[face]).image;const sum=[0,0,0,0];for(const y of [image.height/2-1,image.height/2])for(const x of [image.width/2-1,image.width/2])for(let c=0;c<4;c++)sum[c]+=THREE.DataUtils.fromHalfFloat(image.data[(y*image.width+x)*4+c])*.25;return sum;}
    const directions=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]],samples=[];
    function pixel(){renderer.render(scene,camera);const values=new Float32Array(4);renderer.readRenderTargetPixels(target,2,2,1,1,values);return [...values];}
    for(let face=0;face<6;face++){
      material.uniforms.direction.value.fromArray(directions[face]);material.uniforms.nativeMode.value=0;
      for(let level=0;level<6;level++){material.uniforms.level.value=level;samples.push({face,level,kind:'direct-native-mip',cpu:cpuCenter(face,level),gpu:pixel()});}
      material.uniforms.nativeMode.value=1;
      for(const roughness of [.1,.5,.95]){
        material.uniforms.roughness.value=roughness;const lod=sourceReflectionLod(roughness*roughness,128,5),low=Math.floor(lod),high=Math.ceil(lod),a=cpuCenter(face,low),b=cpuCenter(face,high);
        material.uniforms.nativeMode.value=1;const gpu=pixel();
        material.uniforms.nativeMode.value=2;const shaderValues=pixel();
        material.uniforms.nativeMode.value=0;material.uniforms.level.value=lod;const explicitLodGpu=pixel();
        samples.push({face,roughness,lod,kind:'native-direction-and-lod',cpu:a.map((v,i)=>v+(b[i]-v)*(lod-low)),gpu,shaderValues,explicitLodGpu});
      }
    }
    const diagnostics=sampling.snapshot(),glError=renderer.getContext().getError();sampling.dispose();target.dispose();material.dispose();renderer.dispose();return {samples,diagnostics,glError};
  });
  assert.equal(report.result.glError,0);assert.equal(report.result.samples.length,54);
  for(const sample of report.result.samples) {
    if(sample.kind==='native-direction-and-lod') {
      assert.ok(Math.abs(sample.shaderValues[0]-sample.lod)<.00001,'GLSL native LOD must match independent CPU equation');
      assert.ok(Math.abs(sample.shaderValues[2]-sample.roughness**2)<.00001,'face-center angular roughness');
      sample.cpuIdealResidual=sample.gpu.map((value,index)=>value-sample.cpu[index]);
    }
    // Integer mips compare directly against source bytes. Fractional filtering
    // compares to the same GPU's explicit LOD sampler after checking the scalar
    // equation independently; retain ideal CPU interpolation residuals because
    // this driver does not produce ideal fractional cube-mip weights.
    const expected=sample.explicitLodGpu??sample.cpu;
    for(let channel=0;channel<4;channel++)assert.ok(Number.isFinite(sample.gpu[channel])&&Math.abs(sample.gpu[channel]-expected[channel])<=Math.max(.02,Math.abs(expected[channel])/512),`${sample.kind}: face${sample.face}, lod${sample.level??sample.lod}, channel${channel}`);
  }
  assert.deepEqual(report.errors,[]);report.pass=true;
}catch(error){report.pass=false;report.errors.push(String(error.stack??error));process.exitCode=1;}
finally{await browser?.close();await server?.close();await fs.mkdir(path.join(root,'test-results'),{recursive:true});await fs.writeFile(path.join(root,'test-results/native-reflection-gpu-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,errors:report.errors,samples:report.result?.samples.length,diagnostics:report.result?.diagnostics},null,2));}
