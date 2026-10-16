// Isolated GPU integration check against the independently validated source
// punctual equations and original IES bytes. This is not a native frame capture.
import {createServer} from 'vite';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let server,browser;
const report={kind:'source-native-punctual-integration-gpu',errors:[]};
try {
 server=await createServer({root,server:{host:'127.0.0.1',port:7747,strictPort:true,watch:null,hmr:false},logLevel:'warn'});await server.listen();
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-webgl','--ignore-gpu-blocklist']});
 const page=await browser.newPage();
 page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 await page.route('**/native-direct-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'}));
 await page.goto('http://127.0.0.1:7747/native-direct-fixture');
 report.samples=await page.evaluate(async()=>{
  const THREE=await import('/node_modules/three/build/three.module.js');
  const {createSourceDirectAdapter}=await import('/src/source-direct-adapter.js');
  const {createSourceLightChannels}=await import('/src/source-light-channels.js');
  const {loadSourceIes}=await import('/src/source-ies.js');
  const {sourcePunctualDistanceAttenuation,sourcePunctualAngleAttenuation,sourcePunctualBrdf,sourceIesUv,sourcePunctualConeParameters}=await import('/src/source-direct-light.js');
  const ies=await loadSourceIes(),renderer=new THREE.WebGLRenderer();renderer.setSize(1,1);
  renderer.outputColorSpace=THREE.LinearSRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;
  const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,20);camera.position.z=5;
  const base=[.3,.25,.2],color=[.5,.7,.9],position=[.4,.6,3];
  const material=new THREE.MeshStandardMaterial({color:new THREE.Color(...base),roughness:.4,metalness:0});
  material.userData.recoveredMaster1UVShader={};scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),material));
  const point=new THREE.PointLight(new THREE.Color(...color),1);point.position.fromArray(position);scene.add(point);
  const spot=new THREE.SpotLight(new THREE.Color(...color),1);spot.position.fromArray(position);scene.add(spot,spot.target);
  const direct=createSourceDirectAdapter(ies,1,1),channels=createSourceLightChannels(1,1,{nativeDirect:direct});channels.decorate(scene);
  const target=new THREE.WebGLRenderTarget(1,1,{type:THREE.FloatType});renderer.setRenderTarget(target);
  const bilinear=uv=>{
    const data=ies.texture.image.data,x=(uv[0]-Math.floor(uv[0]))*128-.5,y=uv[1]*128-.5,ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
    const at=(a,b)=>THREE.DataUtils.fromHalfFloat(data[Math.max(0,Math.min(127,b))*128+((a%128)+128)%128]);
    return (at(ix,iy)*(1-fx)+at(ix+1,iy)*fx)*(1-fy)+(at(ix,iy+1)*(1-fx)+at(ix+1,iy+1)*fx)*fy;
  };
  const rows=[];
  for(const cameraPosition of [[0,0,5],[3,2,5],[-2,3,4]])for(const type of ['point','spot'])for(const useIes of [false,true])for(const roughness of [.05,.4,.9])for(const metalness of [0,.6,1])for(const flags of [[true,true],[true,false],[false,true],[false,false]]) {
    camera.position.fromArray(cameraPosition);camera.lookAt(0,0,0);camera.updateMatrixWorld();
    point.intensity=type==='point'?1:0;spot.intensity=type==='spot'?1:0;
    material.roughness=roughness;material.metalness=metalness;
    const angle=.4,forward=[Math.sin(angle),0,Math.cos(angle)],left=[Math.cos(angle),0,-Math.sin(angle)],up=[0,1,0];
    const cone=type==='point'?{scale:1,offset:2}:sourcePunctualConeParameters(20,60);
    const record={id:'fixture',inverseRadiusSquared:.01,attenuationOffset:1,cone,matrixLeft:left,matrixUp:up,matrixForward:forward,ies:useIes?{}:null};
    channels.set(type,0,{nativeDirect:record,affectDiffuse:flags[0],affectSpecular:flags[1]});
    channels.set(type==='point'?'spot':'point',0,null);
    renderer.render(scene,camera);const pixels=new Float32Array(4);renderer.readRenderTargetPixels(target,0,0,1,1,pixels);
    const L=new THREE.Vector3(...position).normalize(),V=new THREE.Vector3(...cameraPosition).normalize(),H=L.clone().add(V).normalize(),N=new THREE.Vector3(0,0,1);
    const response=sourcePunctualBrdf({baseColor:base,metalness,roughness,dotNV:N.dot(V),dotNL:N.dot(L),dotNH:N.dot(H),dotLH:L.dot(H)});
    let attenuation=sourcePunctualDistanceAttenuation(position.reduce((sum,v)=>sum+v*v,0),.01,1)*sourcePunctualAngleAttenuation(new THREE.Vector3(...forward).dot(L),cone.scale,cone.offset);
    if(useIes)attenuation*=bilinear(sourceIesUv([left,up,forward].map(axis=>-new THREE.Vector3(...axis).dot(L))));
    const expected=color.map((c,i)=>c*attenuation*N.dot(L)*(response.diffuse[i]*(flags[0]?1:0)+response.specular[i]*(flags[1]?1:0)));
    rows.push({cameraPosition,type,useIes,roughness,metalness,flags,cpu:expected,gpu:[...pixels].slice(0,3)});
  }
  // Original type2/type3 strict-positive weight branch precedes half-vector
  // normalization. Cover all three zero-weight causes, including L=-V.
  const zeroWeights=[];
  camera.position.set(0,0,5);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  point.intensity=1;spot.intensity=0;material.metalness=.6;material.roughness=.05;
  channels.set('spot',0,null);
  for(const fixture of [
    {name:'opposing-half-vector',position:[0,0,-3],inverseRadiusSquared:.01,cone:{scale:1,offset:2}},
    {name:'grazing-NdotL',position:[3,0,0],inverseRadiusSquared:.01,cone:{scale:1,offset:2}},
    {name:'radial-cutoff',position:[0,0,4],inverseRadiusSquared:.0625,cone:{scale:1,offset:2}},
    {name:'outside-radius',position:[0,0,5],inverseRadiusSquared:.0625,cone:{scale:1,offset:2}},
    {name:'outside-cone',position:[0,0,3],inverseRadiusSquared:.01,cone:{scale:1,offset:-1}},
  ])for(const useIes of [false,true]) {
    point.position.fromArray(fixture.position);
    channels.set('point',0,{nativeDirect:{id:fixture.name,inverseRadiusSquared:fixture.inverseRadiusSquared,
      attenuationOffset:1,cone:fixture.cone,matrixLeft:[1,0,0],matrixUp:[0,1,0],matrixForward:[0,0,1],ies:useIes?{}:null},
      affectDiffuse:true,affectSpecular:true});
    renderer.render(scene,camera);const pixels=new Float32Array(4);renderer.readRenderTargetPixels(target,0,0,1,1,pixels);
    zeroWeights.push({name:fixture.name,useIes,gpu:[...pixels].slice(0,3)});
  }
  const gl=renderer.getContext(),programs=renderer.info.programs.map(p=>({linked:gl.getProgramParameter(p.program,gl.LINK_STATUS)}));
  target.dispose();material.dispose();ies.dispose();renderer.dispose();return {rows,zeroWeights,programs,diagnostics:direct.snapshot()};
 });
 report.maxError=0;
 for(const row of report.samples.rows)for(let i=0;i<3;i++){
  const error=Math.abs(row.cpu[i]-row.gpu[i]);report.maxError=Math.max(report.maxError,error);
  assert.ok(Number.isFinite(row.gpu[i])&&error<.00003,`Native direct mismatch ${JSON.stringify(row)} channel${i}`);
 }
 for(const row of report.samples.zeroWeights)assert.ok(row.gpu.every(value=>Number.isFinite(value)&&value===0),`Native zero-weight branch ${JSON.stringify(row)}`);
 assert.ok(report.samples.programs.every(p=>p.linked));assert.deepEqual(report.errors,[]);report.pass=true;
}catch(e){report.pass=false;report.errors.push(String(e.stack??e));process.exitCode=1;}
finally{await browser?.close();await server?.close();await fs.mkdir(path.join(root,'test-results'),{recursive:true});await fs.writeFile(path.join(root,'test-results/native-direct-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,samples:report.samples?.rows.length,maxError:report.maxError,errors:report.errors},null,2));}
