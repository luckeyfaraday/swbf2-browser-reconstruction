// Original unchanged DXBC/WARP outputs versus the browser GPU kernel. This
// compares synthetic explicit inputs; it does not claim a native game capture.
import {createServer} from 'vite';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {decodeRifleParticle} from '../src/rifle-particle.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=path.join(root,'../exports/rifle-trail/particle-warp');
let browser,server;
const report={kind:'original-rifle-particle-gpu',errors:[],differences:[],boundaryDifferences:[]};
try {
 const input=await fs.readFile(path.join(directory,'input.bin')),reference=await fs.readFile(path.join(directory,'output.bin'));
 server=await createServer({root,server:{host:'127.0.0.1',port:7747,strictPort:true,watch:null,hmr:false},logLevel:'warn'});await server.listen();
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-webgl','--ignore-gpu-blocklist']});
 const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 await page.route('**/rifle-gpu-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'}));
 await page.route('**/rifle-input.bin',r=>r.fulfill({contentType:'application/octet-stream',body:input}));
 await page.goto('http://127.0.0.1:7747/rifle-gpu-fixture');
 const actual=await page.evaluate(async()=>{
   const THREE=await import('/node_modules/three/build/three.module.js');
   const {createRifleParticleGpu}=await import('/src/rifle-particle-gpu.js');
   const bytes=await (await fetch('/rifle-input.bin')).arrayBuffer(),view=new DataView(bytes);
   const count=view.getUint32(4,true),steps=view.getUint32(8,true),recordSize=4+912+128+steps*(912+624);
   const renderer=new THREE.WebGLRenderer();renderer.setSize(1,1);renderer.debug.checkShaderErrors=true;
   const kernel=createRifleParticleGpu(renderer,count),projection=new THREE.Matrix4();
   const depthValues=new Float32Array(16),depth=new THREE.DataTexture(depthValues,4,4,THREE.RedFormat,THREE.FloatType);
   const result=new Uint32Array(count*(steps+1)*22);
   for(const depthValue of [0,1]) {
     depthValues.fill(depthValue);depth.needsUpdate=true;
     for(let step=0;step<=steps;step++) {
       for(let c=0;c<count;c++) {
         const begin=16+c*recordSize,active=view.getFloat32(begin,true)===depthValue;
         const emitterOffset=begin+4+(step?912+128+(step-1)*(912+624):0),cbOffset=emitterOffset+912;
         kernel.set(c,new Uint8Array(bytes,emitterOffset,912),{time:view.getFloat32(cbOffset+(step?0:8),true),dt:view.getFloat32(cbOffset+(step?4:12),true),spawn:step===0,active});
       }
       kernel.step({depth,viewProjection:projection});const packed=kernel.read();
       for(let c=0;c<count;c++)if(view.getFloat32(16+c*recordSize,true)===depthValue)result.set(packed.subarray(c*24,c*24+22),(c*(steps+1)+step)*22);
     }
   }
   const gl=renderer.getContext(),programs=renderer.info.programs.map(p=>({linked:gl.getProgramParameter(p.program,gl.LINK_STATUS)}));
   const diagnostics=kernel.snapshot();kernel.dispose();depth.dispose();renderer.dispose();
   return {count,steps,packed:Array.from(result),programs,diagnostics};
 });
 const buffer=new Uint32Array(actual.packed).buffer,referenceBuffer=reference.buffer.slice(reference.byteOffset,reference.byteOffset+reference.byteLength);
 report.cases=actual.count;report.steps=actual.steps;report.samples=actual.count*(actual.steps+1);report.maxFloat=0;report.maxHalf=0;report.programs=actual.programs;report.diagnostics=actual.diagnostics;
 const flatten=p=>[...p.axes.flat(),...p.translation,...p.position,p.life,...p.packed];
 for(let c=0;c<actual.count;c++)for(let step=0;step<=actual.steps;step++) {
   const offset=(c*(actual.steps+1)+step)*88,a=decodeRifleParticle(buffer,offset),b=decodeRifleParticle(referenceBuffer,offset),got=flatten(a),want=flatten(b);
   for(let channel=0;channel<got.length;channel++) {
     const error=Math.abs(got[channel]-want[channel]);
     if(channel<16)report.maxFloat=Math.max(report.maxFloat,error);else report.maxHalf=Math.max(report.maxHalf,error);
     if(!Number.isFinite(got[channel])||error>(channel<16?.0001:Math.max(.0001,Math.abs(want[channel])*.001))) {
       const row={case:c,step,channel,got:got[channel],want:want[channel],error,clip:a.packed.slice(6,8),referenceClip:b.packed.slice(6,8)};
       const atPlane=Math.abs(a.packed[7])<.0001&&Math.abs(b.packed[7])<.0001;
       const boundary=channel===19&&atPlane&&Math.abs(error-.30029296875)<.00001;
       (boundary?report.boundaryDifferences:report.differences).push(row);
     }
   }
 }
 assert.ok(report.programs.every(p=>p.linked));assert.deepEqual(report.errors,[]);assert.deepEqual(report.differences,[]);report.pass=true;
}catch(error){report.pass=false;report.errors.push(String(error.stack??error));process.exitCode=1;}
finally {
 await browser?.close();await server?.close();await fs.mkdir(path.join(root,'test-results'),{recursive:true});
 await fs.writeFile(path.join(root,'test-results/rifle-particle-gpu-check.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({...report,programs:report.programs?.length,differences:report.differences.slice(0,12),boundaryDifferences:report.boundaryDifferences.length,errors:report.errors.map(e=>e.slice(0,2000))},null,2));
}
