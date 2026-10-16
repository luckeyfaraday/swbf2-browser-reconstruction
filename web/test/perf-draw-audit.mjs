// Breaks visible draws down by kind (instanced/plain, LOD-controlled, door, actor)
// and counts plain static meshes that share a material within a spatial cell
// (candidates for merging into one draw).
import {createServer} from 'vite';
import {chromium} from 'playwright';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),port=7755;
const server=await createServer({root,server:{host:'127.0.0.1',port,strictPort:true,watch:null,hmr:false},logLevel:'error'});await server.listen();
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-webgl','--ignore-gpu-blocklist','--force_high_performance_gpu','--js-flags=--max-old-space-size=8192']});
try{
  const page=await browser.newPage({viewport:{width:1280,height:720}});
  await page.goto(`http://127.0.0.1:${port}/?agent&seed=42&batchCell=48`);
  await page.waitForFunction(()=>window.battlefront?.status==='ready',{},{timeout:300000});
  await page.evaluate(()=>window.vibe.step(1));await page.waitForTimeout(1000);
  console.log(JSON.stringify(await page.evaluate(()=>{
    const {THREE,scene,camera,assets}=window.battlefront.debug;
    camera.updateMatrixWorld();const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    const kinds={},groups=new Map();let visible=0,all=0;
    const doors=new Set();assets.sourceDoors.group.traverse(o=>doors.add(o));
    const inMap=new Set();assets.group.traverse(o=>inMap.add(o));
    scene.traverseVisible(o=>{
      if(!o.isMesh)return;all++;
      const shown=!o.frustumCulled||frustum.intersectsObject(o);if(!shown)return;visible+=[].concat(o.material).length;
      const kind=doors.has(o)?'door':!inMap.has(o)?'non-map':o.isInstancedMesh?(o.userData.sourceLodControlled?'instanced-lod':'instanced'):(o.userData.sourceLodControlled?'plain-lod':'plain');
      kinds[kind]=(kinds[kind]??0)+1;
      if(kind==='plain'){const k=`${[].concat(o.material).map(m=>m.uuid).join()}|${o.userData.spatialCell}`;groups.set(k,(groups.get(k)??0)+1);}
    });
    const shared=[...groups.values()].filter(n=>n>1);
    return {meshesTotal:all,visibleDraws:visible,kinds,plainGroups:groups.size,plainInSharedGroups:shared.reduce((a,b)=>a+b,0),drawsSavedByMergingPlain:shared.reduce((a,b)=>a+b-1,0),largestGroups:shared.sort((a,b)=>b-a).slice(0,10)};
  }),null,1));
} finally{await browser.close();await server.close();}
