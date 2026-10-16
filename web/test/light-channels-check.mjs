// GPU isolation of the source contribution switches. Synthetic shader fixture,
// not a screenshot/parity claim about the original map or native renderer.
import {createServer} from 'vite';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let server,browser;
const report={kind:'synthetic-source-light-channel-gpu-regression',errors:[]};
try {
  server=await createServer({root,server:{host:'127.0.0.1',port:7747,strictPort:true,watch:null,hmr:false},logLevel:'warn'});await server.listen();
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-webgl','--ignore-gpu-blocklist']});
  const page=await browser.newPage();
  page.on('pageerror',error=>report.errors.push(String(error)));
  page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
  await page.route('**/light-channel-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'}));
  await page.goto('http://127.0.0.1:7747/light-channel-fixture');
  report.samples=await page.evaluate(async()=>{
    const THREE=await import('/node_modules/three/build/three.module.js');
    const {createSourceLightChannels}=await import('/src/source-light-channels.js');
    const renderer=new THREE.WebGLRenderer(),scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(45,1,.1,20);
    renderer.setSize(32,32);renderer.outputColorSpace=THREE.LinearSRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;
    camera.position.z=5;
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(8,8),new THREE.MeshStandardMaterial({color:new THREE.Color(.3,.25,.2),roughness:.6,metalness:.2})));
    scene.add(new THREE.AmbientLight(0xffffff,.2));
    const point=new THREE.PointLight(0xffffff,4);point.position.set(0,0,3);scene.add(point);
    const spot=new THREE.SpotLight(0xffffff,4);spot.position.set(0,0,3);scene.add(spot);scene.add(spot.target);
    const flash=new THREE.PointLight(0xff6644,0);flash.position.set(0,0,2);scene.add(flash);
    const channels=createSourceLightChannels(1,1);channels.decorate(scene);
    const target=new THREE.WebGLRenderTarget(32,32);renderer.setRenderTarget(target);
    const sample=()=>{renderer.render(scene,camera);const pixel=new Uint8Array(4);renderer.readRenderTargetPixels(target,16,16,1,1,pixel);return [...pixel];};
    const values={};
    for(const type of ['point','spot']) {
      point.intensity=type==='point'?4:0;spot.intensity=type==='spot'?4:0;
      for(const [name,diffuse,specular] of [['both',true,true],['diffuse',true,false],['specular',false,true],['neither',false,false]]) {
        channels.set(type,0,{affectDiffuse:diffuse,affectSpecular:specular});
        values[`${type}-${name}`]=sample();
      }
    }
    flash.intensity=2;point.intensity=spot.intensity=0;values.flash=sample();
    const {prepareSourceDfg,SOURCE_DFG_GLSL}=await import('/src/source-dfg.js');
    const dfg=await prepareSourceDfg(await fetch('/assets/source-dfg.json').then(response=>response.json()));
    const lutScene=new THREE.Scene(),lutMaterial=new THREE.ShaderMaterial({uniforms:{bf2_sourceDFG:{value:dfg.texture},coordinates:{value:new THREE.Vector2()}},
      vertexShader:'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',
      fragmentShader:SOURCE_DFG_GLSL+'\nuniform vec2 coordinates;void main(){gl_FragColor=vec4(bf2_sampleSourceDFG(coordinates.x,coordinates.y)/2.0,1.0);}'});
    lutScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),lutMaterial));values.dfg=[];
    for(const dotNV of [.01,.4,.99])for(const roughness of [.01,.4,.99]) {
      lutMaterial.uniforms.coordinates.value.set(dotNV,roughness);renderer.render(lutScene,camera);
      const pixel=new Uint8Array(4);renderer.readRenderTargetPixels(target,16,16,1,1,pixel);
      values.dfg.push({dotNV,roughness,cpu:dfg.sample(dotNV,roughness),gpu:[...pixel].slice(0,3).map(value=>value/255*2)});
    }
    // Exercise the real combined material/probe hooks with known constant SH
    // and reflection radiance. This tests the full native diffuse/specular
    // composition without uncertainty from cubemap filtering or volume choice.
    const {createSourceProbeLighting}=await import('/src/source-probes.js');
    const {sourceEnvironmentResponse}=await import('/src/source-environment-specular.js');
    const identity=new THREE.Matrix4().toArray(),coefficients=new Float32Array(36);coefficients.set([.1,.12,.15,0]);
    const probeDocument={format:{componentsPerProbe:36},probeCount:1,volumes:[{index:0,regular:true,priority:0,matrix:identity,inverse:identity,resolution:[1,1,1],probeStart:0}]};
    const nativeScene=new THREE.Scene(),nativeCamera=new THREE.OrthographicCamera(-1,1,1,-1,.1,10);nativeCamera.position.z=3;
    const nativeMaterial=new THREE.MeshStandardMaterial({color:new THREE.Color(.2,.4,.6),roughness:.4,metalness:0});
    nativeMaterial.userData.recoveredMaster1UVShader={};
    nativeMaterial.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_maps>','#include <lights_fragment_maps>\nradiance=vec3(0.3,0.2,0.1);');};
    const nativeMesh=new THREE.Mesh(new THREE.PlaneGeometry(2,2),nativeMaterial);nativeScene.add(nativeMesh);
    const probes=createSourceProbeLighting(probeDocument,coefficients,{dfg});probes.add(nativeScene);values.nativeResponse=[];
    for(const metalness of [0,.5,1])for(const roughness of [.02,.4,.99]) {
      nativeMesh.material.metalness=metalness;nativeMesh.material.roughness=roughness;
      renderer.render(nativeScene,nativeCamera);const pixel=new Uint8Array(4);renderer.readRenderTargetPixels(target,16,16,1,1,pixel);
      const factors=dfg.sample(1,roughness),specular=sourceEnvironmentResponse([.2,.4,.6],metalness,.5,factors);
      const expected=[.1,.12,.15].map((sh,i)=>sh*[.2,.4,.6][i]*(1-metalness)*factors[2]+[.3,.2,.1][i]*specular[i]);
      values.nativeResponse.push({metalness,roughness,cpu:expected,gpu:[...pixel].slice(0,3).map(value=>value/255)});
    }
    values.nativeResponseDiagnostics=probes.snapshot();probes.dispose();nativeMaterial.dispose();nativeMesh.geometry.dispose();
    dfg.dispose();lutMaterial.dispose();
    values.diagnostics=channels.snapshot();target.dispose();renderer.dispose();return values;
  });
  for(const type of ['point','spot']) {
    const samples=report.samples;
    for(let channel=0;channel<3;channel++) {
      const ambient=samples[`${type}-neither`][channel],diffuse=samples[`${type}-diffuse`][channel],specular=samples[`${type}-specular`][channel],both=samples[`${type}-both`][channel];
      assert.ok(ambient>0,'indirect diffuse must survive disabled direct channels');
      assert.ok(diffuse>ambient&&specular>ambient,'both direct terms must be independently visible');
      assert.ok(both<250,'fixture must remain unsaturated');
      assert.ok(Math.abs(both-(diffuse+specular-ambient))<=2,`${type} RGB channel ${channel} must add independent direct contributions`);
    }
  }
  assert.ok(report.samples.flash[0]>report.samples['point-neither'][0],'unpooled muzzle flash must retain its contribution');
  for(const sample of report.samples.dfg)for(let channel=0;channel<3;channel++)assert.ok(Math.abs(sample.cpu[channel]-sample.gpu[channel])<.009,'native DFG GPU coordinates/channels must match the independently validated sampler');
  for(const sample of report.samples.nativeResponse)for(let channel=0;channel<3;channel++)assert.ok(Math.abs(sample.cpu[channel]-sample.gpu[channel])<.004,`native diffuse/specular response must preserve source energy at metalness=${sample.metalness}, roughness=${sample.roughness}`);
  assert.deepEqual(report.errors,[]);report.pass=true;
} catch(error) {report.pass=false;report.errors.push(String(error.stack??error));process.exitCode=1;}
finally {await browser?.close();await server?.close();await fs.mkdir(path.join(root,'test-results'),{recursive:true});await fs.writeFile(path.join(root,'test-results/light-channels-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
