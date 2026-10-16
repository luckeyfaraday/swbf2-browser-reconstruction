// GPU fixture for the native spot shadow activation path: real atlas renderer,
// real receiver injection, a real source light's shadow parameters. A static box
// (shadow-category catalog path) and a dynamic box (actor proxy path) hang over a
// floor under a downward spot. Asymmetric placement catches a mirrored atlas axis.
// Synthetic geometry; not a claim about original frame output.
import {createServer} from 'vite';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),port=7764;
const gpu=process.argv.find(a=>a.startsWith('--gpu='))?.slice(6)??'dgpu';
let server,browser;
const report={kind:'synthetic-native-spot-shadow-activation-gpu-check',evidenceId:'BF2-NATIVE-LOCAL-SHADOW-ACTIVATION-001',gpu,errors:[]};
try {
  server=await createServer({root,server:{host:'127.0.0.1',port,strictPort:true,watch:null,hmr:false},logLevel:'warn'});await server.listen();
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-webgl','--ignore-gpu-blocklist',...(gpu==='dgpu'?['--force_high_performance_gpu']:[])]});
  const page=await browser.newPage();
  page.on('pageerror',error=>report.errors.push(String(error)));
  page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
  await page.route('**/shadow-atlas-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'}));
  await page.goto(`http://127.0.0.1:${port}/shadow-atlas-fixture`);
  Object.assign(report,await page.evaluate(async()=>{
    const THREE=await import('/node_modules/three/build/three.module.js');
    const {createSourceLightChannels}=await import('/src/source-light-channels.js');
    const {createSourceShadowAtlas,sourceSpotShadow}=await import('/src/source-shadow-atlas.js');
    const lights=await fetch('/assets/source-lights.json').then(response=>response.json());
    const source=lights.lights.find(light=>sourceSpotShadow(light.properties,light.matrix));
    // Same source properties; axes replaced so the spot points straight down (emission is -forward).
    const matrix=[1,0,0,0, 0,0,1,0, 0,1,0,0, 0,3,0,1];
    const descriptor={id:'fixture',position:[0,3,0],shadow:sourceSpotShadow(source.properties,matrix)};
    const box=new THREE.BoxGeometry(1,1,1),positions=box.attributes.position.array,indices=Uint32Array.from(box.index.array);
    const payload=new ArrayBuffer(positions.byteLength+indices.byteLength);
    new Float32Array(payload,0,positions.length).set(positions);new Uint32Array(payload,positions.byteLength,indices.length).set(indices);
    const catalog={summary:{},assets:[{assetId:'box',sections:[{positionsOffset:0,vertexCount:positions.length/3,indicesOffset:positions.byteLength,indexCount:indices.length}]}],visibleFallbackAssets:[]};
    const manifest={assets:[{id:'box'}],instances:[{assetId:'box',matrix:new THREE.Matrix4().makeTranslation(.6,1,.4).toArray()}]};
    const renderer=new THREE.WebGLRenderer(),size=128;renderer.setSize(size,size);
    renderer.outputColorSpace=THREE.LinearSRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;
    const atlas=createSourceShadowAtlas(renderer,{catalog,payload,manifest,poolSlots:1});
    const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-4,4,4,-4,.1,10);
    camera.position.set(0,5,0);camera.up.set(0,0,-1);camera.lookAt(0,0,0);camera.updateMatrixWorld();
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(8,8),new THREE.MeshStandardMaterial({color:0xffffff,roughness:1,metalness:0}));
    floor.rotation.x=-Math.PI/2;scene.add(floor);
    const spot=new THREE.SpotLight(0xffffff,30,0,THREE.MathUtils.degToRad(70),0,2);spot.position.set(0,3,0);spot.target.position.set(0,0,0);scene.add(spot,spot.target);
    const channels=createSourceLightChannels(0,1,{nativeShadows:atlas});channels.decorate(scene);channels.set('spot',0,{affectDiffuse:true,affectSpecular:true});
    // Dynamic caster through the actor proxy path; not part of the camera's scene.
    const actorRoot=new THREE.Group(),actorMesh=new THREE.Mesh(box,new THREE.MeshBasicMaterial());actorRoot.position.set(-1,0,-.8);actorMesh.position.set(0,1,0);actorRoot.add(actorMesh);
    const target=new THREE.WebGLRenderTarget(size,size,{type:THREE.FloatType});
    const capture=(withShadows,actors)=>{
      atlas.update([withShadows?descriptor:null],{actors});
      renderer.setRenderTarget(target);renderer.render(scene,camera);
      const pixels=new Float32Array(size*size*4);renderer.readRenderTargetPixels(target,0,0,size,size,pixels);return pixels;
    };
    const actors=[{id:'dynamic',root:actorRoot,alive:true}];
    const on=capture(true,actors),off=capture(false,actors),staticOnly=capture(true,[]);
    const at=(pixels,x,z)=>{const px=Math.floor((x+4)/8*size),py=Math.floor((4-z)/8*size);return pixels[(py*size+px)*4];};
    const ratio=(pixels,x,z)=>at(pixels,x,z)/at(off,x,z);
    const points={
      staticShadow:[.9,.6],staticMirrorX:[-.9,.6],staticMirrorZ:[.9,-.6],staticMirrorXZ:[-.9,-.6],
      dynamicShadow:[-1.2,-.9],litRing:[1.6,-1.2],litRing2:[-1.6,1.3],
    };
    const ratios=Object.fromEntries(Object.entries(points).map(([name,[x,z]])=>[name,{withDynamic:ratio(on,x,z),staticOnly:ratio(staticOnly,x,z)}]));
    let changed=0;for(let i=0;i<on.length;i+=4)if(Math.abs(on[i]-off[i])>1e-4)changed++;
    return {sourceLight:source.route??source.properties.__InstanceGuid?.InternalId??null,shadow:{near:descriptor.shadow.near,far:descriptor.shadow.far,start:descriptor.shadow.shadowStartDegrees,end:descriptor.shadow.shadowEndDegrees},
      ratios,changedFraction:changed/(size*size),snapshot:{...atlas.snapshot(),policy:undefined}};
  }));
  const r=report.ratios;
  assert.equal(report.errors.length,0,report.errors.join('\n'));
  assert.ok(r.staticShadow.staticOnly<.05,'static caster shadows the floor beneath its light-space projection');
  for(const mirror of ['staticMirrorX','staticMirrorZ','staticMirrorXZ'])assert.ok(r[mirror].staticOnly>.98,`${mirror}: no mirrored atlas axis`);
  assert.ok(r.dynamicShadow.withDynamic<.05,'dynamic actor proxy casts into the live tile');
  assert.ok(r.dynamicShadow.staticOnly>.98,'dynamic shadow disappears when the actor leaves');
  for(const lit of ['litRing','litRing2'])assert.ok(r[lit].withDynamic>.98&&r[lit].staticOnly>.98,`${lit}: no self-shadowing acne`);
  report.pass=true;console.log(JSON.stringify(report,null,1));
} catch(error) {report.pass=false;report.failure=String(error.stack??error);console.error(JSON.stringify(report,null,1));process.exitCode=1;}
finally {
  await fs.mkdir(path.join(root,'test-results'),{recursive:true});
  await fs.writeFile(path.join(root,'test-results/source-shadow-atlas-gpu-check.json'),JSON.stringify(report,null,2));
  await browser?.close();await server?.close();
}
