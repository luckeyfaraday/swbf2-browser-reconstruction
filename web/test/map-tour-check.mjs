// Tours the actual map after loading: floor points on a grid over the combat area
// plus every spawn, looking four ways at each, with real frames rendered. Fails if
// any shader program compiles after load (a first-use compile freezes the page),
// if any shader fails, or if a frame stalls past the limit. Teleports here only
// arrange viewpoints; they are not gameplay evidence.
// Usage: node test/map-tour-check.mjs [--gpu=dgpu|igpu] [--spacing=14] [--max-points=160] [--query=...]
import {createServer} from 'vite';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),port=7759;
const arg=(name,fallback)=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const gpu=arg('gpu','dgpu'),spacing=Number(arg('spacing',14)),maxPoints=Number(arg('max-points',160)),query=arg('query',''),stallLimitMs=Number(arg('stall-ms',1500));
const report={kind:'actual-map-tour',gpu,spacing,query,startedAtUtc:new Date().toISOString(),consoleErrors:[],pageErrors:[]};
let server,browser;
try {
  server=await createServer({root,server:{host:'127.0.0.1',port,strictPort:true,watch:null,hmr:false},logLevel:'error'});await server.listen();
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-webgl','--ignore-gpu-blocklist','--disable-background-timer-throttling','--js-flags=--max-old-space-size=8192',...(gpu==='dgpu'?['--force_high_performance_gpu']:[])]});
  const page=await browser.newPage({viewport:{width:1280,height:720}});page.setDefaultTimeout(120000);
  page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text().slice(0,300));});
  page.on('pageerror',e=>report.pageErrors.push(String(e).slice(0,300)));
  await page.goto(`http://127.0.0.1:${port}/?agent&seed=42&batchCell=48${query?'&'+query:''}`);
  await page.waitForFunction(()=>window.battlefront?.status==='ready'||window.battlefront?.status==='unavailable',{},{timeout:300000});
  report.loadTimings=await page.evaluate(()=>window.battlefront.loadTimings.filter(t=>!t.stage.startsWith('assets/')));
  await page.evaluate(()=>window.vibe.step(1));
  report.points=await page.evaluate(({spacing,maxPoints})=>{
    const {runtime,assets}=window.battlefront.debug,nav=runtime.navigation,poly=assets.manifest.combatArea?.points??[];
    const xs=poly.map(p=>p[0]??p.x),zs=poly.map(p=>p[2]??p[1]??p.z),points=[];
    for(const spawn of [...(assets.manifest.spawns??[]),...(assets.manifest.neutralSpawns??[])]){const p=spawn.position??spawn;if(Array.isArray(p))points.push(p);}
    if(nav&&xs.length){
      for(let x=Math.min(...xs);x<=Math.max(...xs);x+=spacing)for(let z=Math.min(...zs);z<=Math.max(...zs);z+=spacing)
        for(const node of nav.column(Math.round(x/nav.spacing),Math.round(z/nav.spacing)))points.push(node.position.toArray());
    }
    const step=Math.max(1,Math.ceil(points.length/maxPoints));return points.filter((_,i)=>i%step===0);
  },{spacing,maxPoints});
  const programList=()=>page.evaluate(()=>window.battlefront.debug.renderer.info.programs.map(p=>({id:p.id,name:p.name,key:p.cacheKey})));
  const initialPrograms=await programList(),before=initialPrograms.length;
  report.stops=[];let worstFrame=0;
  for(const [index,point] of report.points.entries()) {
    const stop=await page.evaluate(async point=>{
      const {runtime,THREE}=window.battlefront.debug,p=runtime.player;
      p.controller.setPosition(new THREE.Vector3(...point));
      const frames=[];let last=performance.now();
      for(const yaw of [0,Math.PI/2,Math.PI,Math.PI*1.5]) {
        p.controller.setLook(yaw,0);
        for(let i=0;i<3;i++){await new Promise(r=>requestAnimationFrame(r));const now=performance.now();frames.push(now-last);last=now;}
      }
      const lighting=window.battlefront.lighting();
      return {worstFrameMs:Math.round(Math.max(...frames.slice(1))),covered:lighting.reflections?.covered??null,volume:lighting.reflections?.selectedVolume??null,
        reflectionMode:lighting.nativeReflections?.shaderMode??null,programs:window.battlefront.debug.renderer.info.programs.length};
    },point);
    worstFrame=Math.max(worstFrame,stop.worstFrameMs);report.stops.push({index,point,...stop});
    if(index%20===0)console.log(JSON.stringify({index,of:report.points.length,...stop}));
  }
  const finalPrograms=await programList(),after=finalPrograms.length,known=new Set(initialPrograms.map(p=>p.id));
  report.newPrograms=finalPrograms.filter(p=>!known.has(p.id));
  report.summary={points:report.points.length,programsAfterLoad:before,programsAfterTour:after,newPrograms:after-before,worstFrameMs:worstFrame,
    uncoveredStops:report.stops.filter(s=>s.covered===false).length,volumesVisited:new Set(report.stops.map(s=>s.volume).filter(Boolean)).size,
    reflectionModes:[...new Set(report.stops.map(s=>s.reflectionMode))],consoleErrors:report.consoleErrors.length,pageErrors:report.pageErrors.length};
  console.log(JSON.stringify(report.summary));
  for(const program of report.newPrograms)console.log(JSON.stringify({compiledAfterLoad:program}));
  assert.equal(report.pageErrors.length,0,report.pageErrors[0]);
  assert.equal(report.consoleErrors.length,0,report.consoleErrors[0]);
  assert.equal(report.summary.newPrograms,0,'a shader program compiled after load; its first use blocks the page');
  assert.ok(worstFrame<stallLimitMs,`worst frame ${worstFrame} ms`);
  report.pass=true;
} catch(error) {report.pass=false;report.error=String(error.stack??error);console.error(error.message??error);process.exitCode=1;}
finally {
  await fs.writeFile(path.join(root,'test-results',`map-tour-${gpu}.json`),JSON.stringify(report,null,2));
  await browser?.close();await server?.close();
}
