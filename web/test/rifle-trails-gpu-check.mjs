import {createServer} from 'vite';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let browser,server;
const report={kind:'recovered-rifle-trail-render-integration',errors:[]};
try {
 server=await createServer({root,server:{host:'127.0.0.1',port:7747,strictPort:true,watch:null,hmr:false},logLevel:'warn'});await server.listen();
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-webgl','--ignore-gpu-blocklist']});
 const page=await browser.newPage({viewport:{width:640,height:360}});page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 await page.route('**/rifle-trail-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html><body style="margin:0"></body></html>'}));
 await page.goto('http://127.0.0.1:7747/rifle-trail-fixture');
 report.result=await page.evaluate(async()=>{
   const THREE=await import('/node_modules/three/build/three.module.js');
   const {prepareRifleTrails,createRifleTrails}=await import('/src/rifle-trails.js');
   const {decodeRifleParticle}=await import('/src/rifle-particle.js');
   const {createProjectileVisuals}=await import('/src/projectile-visuals.js');
   const {createSourceExposure}=await import('/src/source-exposure.js');
   const [material,emitter,environment,lifecycle]=await Promise.all(['recovered-blaster-bolt-material.json','rifle-emitter.json','source-environment.json','rifle-trail.json'].map(async n=>(await fetch(`/assets/${n}`)).json()));
   const renderer=new THREE.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(640,360);document.body.append(renderer.domElement);
   const prepared=await prepareRifleTrails(material,emitter),effects=createRifleTrails(renderer,prepared),exposure=createSourceExposure(renderer,environment);
   const scene=new THREE.Scene();scene.background=new THREE.Color(.03,.03,.03);
   const wall=new THREE.Mesh(new THREE.PlaneGeometry(30,30),new THREE.MeshBasicMaterial({color:new THREE.Color(.03,.03,.03)}));wall.position.z=-10;scene.add(wall);
   const camera=new THREE.PerspectiveCamera(55,640/360,.05,100);scene.add(camera);
   const projectiles=[-5,-12].map((z,i)=>({position:new THREE.Vector3(-6,i?-.6:.6,z),direction:new THREE.Vector3(1,0,0),weapon:{projectileSpeed:60},age:0}));
   const meshes=projectiles.map(p=>effects.create(p,{time:0}));
   for(let step=1;step<=6;step++) {
     for(const p of projectiles){p.age=step/60;p.position.x=-6+p.age*60;}
     effects.setTime(step/60);exposure.render(scene,camera,1/60,effects);
   }
   const words=effects.readParticles(),states=projectiles.map((_,i)=>decodeRifleParticle(words.buffer,i*96));
   const gl=renderer.getContext(),programs=renderer.info.programs.map(p=>({linked:gl.getProgramParameter(p.program,gl.LINK_STATUS)})),error=gl.getError();
   const visible=states[0].packed[3],occluded=states[1].packed[3],pixels=new Uint8Array(640*360*4);gl.readPixels(0,0,640,360,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
   let redPixels=0,occludedRedPixels=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]>pixels[i+1]*1.5&&pixels[i]>30){redPixels++;if(Math.floor(i/4/640)<180)occludedRedPixels++;}
   const snapshot=effects.snapshot(),capture=renderer.domElement.toDataURL();
   // A stopped mesh must release its GPU slot; pool reuse must spawn cleanly.
   meshes[0].removeFromParent();effects.setTime(7/60);exposure.render(scene,camera,1/60,effects);
   const afterRemoval=effects.snapshot();
   const closeHits=[];
   for(const distance of [1,5,10]) {
     effects.reset();const retirement=createProjectileVisuals(lifecycle);
     const p={position:new THREE.Vector3(-distance/2,0,-8),direction:new THREE.Vector3(1,0,0),weapon:{projectileSpeed:700},age:0};
     p.mesh=effects.create(p,{time:10});p.position.x+=distance;p.age=1/60;
     retirement.retire(p.mesh,'primary');const frames=[];
     for(let frame=0;frame<2;frame++) {
       effects.setTime(10+frame/60);exposure.render(scene,camera,1/60,effects);
       const bytes=effects.readParticles(),particle=decodeRifleParticle(bytes.buffer,0);
       gl.readPixels(0,0,640,360,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
       let red=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]>pixels[i+1]*1.5&&pixels[i]>30)red++;
       frames.push({redPixels:red,position:particle.position,visibility:particle.packed[3]});retirement.afterPresent();
     }
     effects.setTime(10+2/60);exposure.render(scene,camera,1/60,effects);
     closeHits.push({distance,frames,activeAfterTwo:effects.snapshot().active});
   }
   window.fixture={renderer,effects,exposure,scene,camera};
   return {visible,occluded,redPixels,occludedRedPixels,error,programs,states,snapshot,afterRemoval,closeHits,capture};
 });
 await fs.writeFile(path.join(root,'test-results/rifle-trails-gpu.png'),Buffer.from(report.result.capture.split(',')[1],'base64'));delete report.result.capture;
 assert.deepEqual(report.errors,[]);assert.equal(report.result.error,0);assert.ok(report.result.programs.every(p=>p.linked));
 assert.ok(report.result.visible>.99);assert.ok(report.result.occluded<.01);assert.ok(report.result.redPixels>10);
 assert.equal(report.result.occludedRedPixels,0,'Recovered body must be occluded by the opaque wall');
 for(const hit of report.result.closeHits){assert.ok(hit.frames[0].redPixels>0,`${hit.distance}m same-tick hit must have a visible first presentation`);assert.equal(hit.activeAfterTwo,0);}
 assert.equal(report.result.afterRemoval.active,1);report.pass=true;
}catch(error){report.pass=false;report.errors.push(String(error.stack??error));process.exitCode=1;}
finally{await browser?.close();await server?.close();await fs.mkdir(path.join(root,'test-results'),{recursive:true});await fs.writeFile(path.join(root,'test-results/rifle-trails-gpu-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,result:report.result?{visible:report.result.visible,occluded:report.result.occluded,redPixels:report.result.redPixels,error:report.result.error,programs:report.result.programs,active:report.result.snapshot.active,afterRemoval:report.result.afterRemoval.active,closeHits:report.result.closeHits}:null},null,2));}
