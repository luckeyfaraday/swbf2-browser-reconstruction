// Original lookup bytes and actual runtime shader hooks; isolated GPU fixture.
import {createServer} from 'vite';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const report={kind:'source-shared-three-dfg-lookup-gpu',nativeGameCapture:false,errors:[]};
let server,browser;
try {
  server=await createServer({root,server:{host:'127.0.0.1',port:7747,strictPort:true,watch:null,hmr:false},logLevel:'warn'});
  await server.listen();
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-webgl','--ignore-gpu-blocklist']});
  const page=await browser.newPage();
  page.on('pageerror',e=>report.errors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  await page.route('**/source-shared-lookup-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'}));
  await page.goto('http://127.0.0.1:7747/source-shared-lookup-fixture');
  report.result=await page.evaluate(async()=>{
    const THREE=await import('/node_modules/three/build/three.module.js');
    const {getDFGLUT}=await import('/node_modules/three/src/renderers/shaders/DFGLUTData.js');
    const {createSourceDfgTexture,packSourceIesIntoDfg,packThreeDfgIntoSourceLookup,injectSharedThreeDfg,SOURCE_DFG_ARRAY_GLSL,SHARED_THREE_DFG_GLSL}=await import('/src/source-dfg.js');
    const {loadSourceIes}=await import('/src/source-ies.js');
    const {injectSourceEnvironmentSpecular}=await import('/src/source-environment-specular.js');
    const {prepareSourceReflectionSampling,injectSourceReflectionSampling}=await import('/src/source-reflection-sampling.js');
    const dfgDoc=await fetch('/assets/source-dfg.json').then(r=>r.json()),dfgBytes=await fetch(dfgDoc.url).then(r=>r.arrayBuffer());
    const original=createSourceDfgTexture(dfgDoc,dfgBytes.slice(0)),source=createSourceDfgTexture(dfgDoc,dfgBytes.slice(0));
    const ies=await loadSourceIes(),threeDfg=getDFGLUT();
    packSourceIesIntoDfg(source,ies.texture);const packed=packThreeDfgIntoSourceLookup(source,threeDfg);source.dispose();
    const renderer=new THREE.WebGLRenderer();renderer.setSize(256,128);
    renderer.outputColorSpace=THREE.LinearSRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;
    const gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');
    const hardware={renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),maxFragmentTextureUnits:gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)};
    const programs=marker=>renderer.info.programs.filter(p=>!marker||gl.getShaderSource(p.fragmentShader)?.includes(marker)).map(p=>{
      const samplers=[];
      for(let i=0;i<gl.getProgramParameter(p.program,gl.ACTIVE_UNIFORMS);i++){
        const info=gl.getActiveUniform(p.program,i);
        if([gl.SAMPLER_2D,gl.SAMPLER_CUBE,gl.SAMPLER_3D,gl.SAMPLER_2D_ARRAY,gl.INT_SAMPLER_2D,gl.UNSIGNED_INT_SAMPLER_2D].includes(info.type))samplers.push({name:info.name,size:info.size});
      }
      return {linked:gl.getProgramParameter(p.program,gl.LINK_STATUS),samplers,count:samplers.reduce((n,x)=>n+x.size,0)};
    });
    const cases=[],kinds=[];
    const add=(kind,a,b,c,d)=>{kinds.push(kind);cases.push(a,b,c,d);};
    for(let y=0;y<128;y++)for(let x=0;x<128;x++)add('source-center',(x+.5)/128,Math.sqrt((y+.5)/128),(x+.5)/128,(y+.5)/128);
    for(let y=0;y<16;y++)for(let x=0;x<16;x++)add('three-center',(x+.5)/16,(y+.5)/16,(x+.5)/16,(y+.5)/16);
    const bounds=[-10,-1,-1e-7,0,1e-7,.5/128-1e-7,.5/128,.5/128+1e-7,.5/16-1e-7,.5/16,.5/16+1e-7,.5,
      15.5/16-1e-7,15.5/16,15.5/16+1e-7,127.5/128-1e-7,127.5/128,127.5/128+1e-7,1-1e-7,1,1+1e-7,2,10];
    for(const a of bounds)for(const b of bounds)add('boundary',a,b,a,b);
    let seed=0x2df67150;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
    for(let i=0;i<4096;i++)add('random',random()*3-1,random()*3-1,random()*12-6,random()*3-1);
    // Float32 neighbors around both integer and half-integer1/256 weight
    // boundaries, on both axes. No assumed quantization is used by runtime.
    const bits=new Uint32Array(1),floats=new Float32Array(bits.buffer);
    const neighbor=(value,ulp)=>{floats[0]=value;bits[0]+=ulp;return floats[0];};
    for(let cell=0;cell<15;cell++)for(let k=0;k<256;k++)for(const half of [0,.5])for(let ulp=-2;ulp<=2;ulp++){
      const value=neighbor((cell+.5+(k+half)/256)/16,ulp);
      add('three-filter-ulp-x',value,.37109375,value,.413);
      add('three-filter-ulp-y',.37109375,value,.413,value);
    }
    const pairs=[];
    for(let i=0;i<256;i++){
      const u=Math.floor(random()*16384)/16384,v=Math.floor(random()*16384)/16384;
      pairs.push([kinds.length,kinds.length+1]);add('periodicity',.2,.7,u,v);add('periodicity',.2,.7,u+3,v);
    }
    const width=256,height=Math.ceil(kinds.length/width),inputWords=new Float32Array(width*height*4);inputWords.set(cases);
    const inputs=new THREE.DataTexture(inputWords,width,height,THREE.RGBAFormat,THREE.FloatType);inputs.needsUpdate=true;
    const target=new THREE.WebGLRenderTarget(width,height,{type:THREE.FloatType,format:THREE.RGBAFormat});
    const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,10),geometry=new THREE.PlaneGeometry(2,2);
    const quad=new THREE.Mesh(geometry);scene.add(quad);
    const make=(combined,kind)=>new THREE.ShaderMaterial({
      uniforms:{fixtureInputs:{value:inputs},fixtureSize:{value:new THREE.Vector2(width,height)},
        ...(combined?{bf2_sourceDFG:{value:packed}}:{originalDfg:{value:original},originalIes:{value:ies.texture},originalThree:{value:threeDfg}})},
      vertexShader:'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',
      fragmentShader:`${combined?SOURCE_DFG_ARRAY_GLSL+SHARED_THREE_DFG_GLSL:'uniform sampler2D originalDfg,originalIes,originalThree;'}
        uniform sampler2D fixtureInputs;uniform vec2 fixtureSize;
        void main(){vec4 c=texture2D(fixtureInputs,gl_FragCoord.xy/fixtureSize);float r=clamp(c.y,0.0,1.0);
          gl_FragColor=${kind==='native'
            ?(combined?'vec4(bf2_sampleSourceDFG(c.x,c.y),bf2_sampleSourceIes(c.zw))':'vec4(texture2D(originalDfg,vec2(clamp(c.x,0.0,1.0),r*r)).rgb,texture2D(originalIes,c.zw).r)')
            :(combined?'vec4(bf2_sampleThreeDfg(c.xy),0.0,1.0)':'vec4(texture2D(originalThree,c.xy).rg,0.0,1.0)')};}`,
      depthTest:false,depthWrite:false,blending:THREE.NoBlending});
    const result={hardware,cases:kinds.length,counts:{},native:{maxError:[0,0,0,0],bitIdentical:0,total:kinds.length*4,mismatches:[]},
      fallback:{maxError:[0,0],bitIdentical:0,total:kinds.length*2,mismatches:[]},periodicityError:0,threeCenterError:0};
    for(const kind of kinds)result.counts[kind]=(result.counts[kind]??0)+1;
    for(const kind of ['native','fallback']){
      const separate=make(false,kind),shared=make(true,kind),a=new Float32Array(width*height*4),b=new Float32Array(a.length);
      renderer.setRenderTarget(target);quad.material=separate;renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,width,height,a);
      quad.material=shared;renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,width,height,b);
      for(let i=0;i<kinds.length;i++)for(let channel=0;channel<(kind==='native'?4:2);channel++){
        const index=i*4+channel,error=Math.abs(a[index]-b[index]),record=result[kind];
        record.maxError[channel]=Math.max(record.maxError[channel],error);if(Object.is(a[index],b[index]))record.bitIdentical++;
        if((!Number.isFinite(b[index])||!Object.is(a[index],b[index]))&&record.mismatches.length<24)record.mismatches.push({i,kind:kinds[i],channel,input:Array.from(inputWords.subarray(i*4,i*4+4)),separate:a[index],shared:b[index],error});
        if(kind==='fallback'&&kinds[i]==='three-center')result.threeCenterError=Math.max(result.threeCenterError,error);
      }
      if(kind==='native')for(const [aIndex,bIndex] of pairs)result.periodicityError=Math.max(result.periodicityError,Math.abs(b[aIndex*4+3]-b[bIndex*4+3]));
      separate.dispose();shared.dispose();
    }
    // Actual Three direct-light fallback before/after only changing table storage.
    const directScene=new THREE.Scene(),directCamera=new THREE.PerspectiveCamera(50,1,.1,10);
    const directTarget=new THREE.WebGLRenderTarget(16,16,{type:THREE.FloatType,format:THREE.RGBAFormat});
    const light=new THREE.PointLight(0xffffff,20,0,2);light.position.set(1,1,2);directScene.add(light);
    const beforeMaterial=new THREE.MeshStandardMaterial({color:new THREE.Color(.32,.18,.07)}),afterMaterial=beforeMaterial.clone();
    afterMaterial.onBeforeCompile=shader=>injectSharedThreeDfg(shader,packed);
    afterMaterial.customProgramCacheKey=()=> 'shared-lookup-fallback-fixture';
    const surface=new THREE.Mesh(new THREE.PlaneGeometry(4,4));directScene.add(surface);
    const fallbackRendering={cases:0,maxError:0,mismatches:[]};
    for(const metalness of [0,.5,1])for(const roughness of [.05,.3,.7,1])for(const nv of [.2,.5,1]){
      directCamera.position.set(3*Math.sqrt(1-nv*nv),0,3*nv);directCamera.lookAt(0,0,0);
      for(const m of [beforeMaterial,afterMaterial]){m.metalness=metalness;m.roughness=roughness;}
      const a=new Float32Array(4),b=new Float32Array(4);renderer.setRenderTarget(directTarget);
      surface.material=beforeMaterial;renderer.render(directScene,directCamera);renderer.readRenderTargetPixels(directTarget,8,8,1,1,a);
      surface.material=afterMaterial;renderer.render(directScene,directCamera);renderer.readRenderTargetPixels(directTarget,8,8,1,1,b);
      fallbackRendering.cases++;
      for(let c=0;c<3;c++){const error=Math.abs(a[c]-b[c]);fallbackRendering.maxError=Math.max(fallbackRendering.maxError,error);
        if(!Object.is(a[c],b[c])&&fallbackRendering.mismatches.length<16)fallbackRendering.mismatches.push({metalness,roughness,nv,c,separate:a[c],shared:b[c]});}
    }
    result.fallbackRendering=fallbackRendering;
    // Compile both actual reflection hooks with14 active stand-in surface/probe/
    // atlas textures. Their arithmetic is synthetic; the16-unit budget is real.
    const reflectionDoc=await fetch('/assets/source-reflections.json').then(r=>r.json());
    const reflection=await prepareSourceReflectionSampling(reflectionDoc);
    const volume=reflectionDoc.volumes.find(v=>reflectionDoc.payloads.find(p=>p.id===v.payloadId).mipCount===6);
    await reflection.select(volume.id);
    const pmrem=new THREE.PMREMGenerator(renderer),environment=pmrem.fromCubemap(reflection.uniforms.bf2_nativeReflectionCube.value);
    const texture=new THREE.DataTexture(new Uint8Array([128,64,32,255]),1,1,THREE.RGBAFormat);texture.needsUpdate=true;
    const budgetScene=new THREE.Scene();budgetScene.environment=environment.texture;budgetScene.add(new THREE.PointLight(0xffffff,1));
    const budgetCamera=new THREE.PerspectiveCamera(60,1,.1,10);budgetCamera.position.z=3;
    const budgetMesh=new THREE.Mesh(new THREE.PlaneGeometry(2,2));budgetScene.add(budgetMesh);
    result.budget=[];
    for(const mode of ['native','pmrem','none']){
      const material=new THREE.MeshStandardMaterial({roughness:.4});
      material.onBeforeCompile=shader=>{
        injectSourceEnvironmentSpecular(shader,{texture:packed});
        injectSourceReflectionSampling(shader,reflection,{mode});
        injectSharedThreeDfg(shader,packed);
        const names=[...Array.from({length:11},(_,i)=>`budgetMaterial${i}`),'budgetProbe','budgetAtlasIrradiance','budgetAtlasDirections'];
        for(const name of names)shader.uniforms[name]={value:texture};
        shader.fragmentShader=`// BF2_SHARED_LOOKUP_BUDGET_${mode}\n${names.map(n=>`uniform sampler2D ${n};`).join('\n')}\n`+shader.fragmentShader;
        shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>\n diffuseColor.rgb += .000001*(${names.map(n=>`texture2D(${n},vec2(.5)).rgb`).join('+')});`);
      };
      material.customProgramCacheKey=()=>`lookup-budget-${mode}`;budgetMesh.material=material;
      renderer.setRenderTarget(directTarget);renderer.render(budgetScene,budgetCamera);
      result.budget.push({mode,programs:programs(`BF2_SHARED_LOOKUP_BUDGET_${mode}`)});
      material.dispose();
    }
    result.glError=gl.getError();
    reflection.dispose();environment.dispose();pmrem.dispose();texture.dispose();budgetMesh.geometry.dispose();
    beforeMaterial.dispose();afterMaterial.dispose();surface.geometry.dispose();directTarget.dispose();
    target.dispose();geometry.dispose();inputs.dispose();original.dispose();packed.dispose();ies.dispose?.();renderer.dispose();
    return result;
  });
  assert.deepEqual(report.errors,[]);
  assert.deepEqual(report.result.native.mismatches,[]);
  assert.deepEqual(report.result.fallback.mismatches,[]);
  assert.equal(report.result.native.bitIdentical,report.result.native.total);
  assert.equal(report.result.fallback.bitIdentical,report.result.fallback.total);
  assert.deepEqual(report.result.fallbackRendering.mismatches,[]);
  assert.equal(report.result.periodicityError,0);assert.equal(report.result.threeCenterError,0);
  for(const budget of report.result.budget){
    assert.equal(budget.programs.length,1);const program=budget.programs[0];
    assert.equal(program.linked,true);assert.equal(program.count,budget.mode==='none'?15:16);
    const names=program.samplers.map(s=>s.name);
    assert.ok(!names.includes('dfgLUT'));
    assert.equal(names.includes('envMap'),budget.mode==='pmrem');
    assert.equal(names.includes('bf2_nativeReflectionCube'),budget.mode==='native');
  }
  assert.equal(report.result.glError,0);report.pass=true;
}catch(error){report.pass=false;report.failure=String(error.stack??error);process.exitCode=1;}
finally{
  await browser?.close();await server?.close();
  await fs.mkdir(path.join(root,'test-results'),{recursive:true});
  await fs.writeFile(path.join(root,'test-results/source-shared-lookup-gpu-check.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}
