// Performance profile of the actual extracted map. Measures where frame time goes:
// main-thread JS per frame, sensitivity to resolution/MSAA/HDR, and a CPU profile.
// Usage: node test/perf-profile.mjs [--gpu=dgpu|igpu] [--width=1280 --height=720] [--label=x] [--cpu-profile]
import {createServer} from 'vite';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),output=path.join(root,'test-results');
const arg=(name,fallback)=>{const hit=process.argv.find(a=>a.startsWith(`--${name}=`));return hit?hit.slice(name.length+3):(process.argv.includes(`--${name}`)?true:fallback);};
const gpu=arg('gpu','dgpu'),width=Number(arg('width',1280)),height=Number(arg('height',720)),dpr=Number(arg('dpr',1)),label=arg('label',`${gpu}-${width}x${height}`);
const port=Number(process.env.BF2_PERF_PORT??7749),query=arg('query','');
const report={kind:'actual-map-performance-profile',label,gpu,viewport:{width,height,deviceScaleFactor:dpr},startedAtUtc:new Date().toISOString(),samples:[],errors:[]};
let server,browser;
try {
  await fs.mkdir(output,{recursive:true});
  server=await createServer({root,server:{host:'127.0.0.1',port,strictPort:true,watch:null,hmr:false},logLevel:'warn'});await server.listen();
  const args=['--enable-webgl','--ignore-gpu-blocklist','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--js-flags=--max-old-space-size=8192'];
  if(gpu==='dgpu')args.push('--force_high_performance_gpu');
  browser=await chromium.launch({headless:true,executablePath:process.env.BF2_BROWSER_EXECUTABLE??'C:/Program Files/Google/Chrome/Application/chrome.exe',args});
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:dpr});page.setDefaultTimeout(60000);
  page.on('pageerror',error=>report.errors.push(String(error)));
  page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
  // Per-frame main-thread cost: time spent inside each rAF callback.
  await page.addInitScript(()=>{
    const native=window.requestAnimationFrame.bind(window);window.__frameCpu=[];window.__frameAt=[];
    window.requestAnimationFrame=callback=>native(time=>{const start=performance.now();try{callback(time);}finally{const end=performance.now();if(window.__frameCpu.length<20000){window.__frameCpu.push(end-start);window.__frameAt.push(start);}}});
  });
  const loadStart=Date.now();
  await page.goto(`http://127.0.0.1:${port}/?agent&seed=42&batchCell=48${query?`&${query}`:''}`,{timeout:60000});
  await page.waitForFunction(()=>window.battlefront?.status==='ready'||window.battlefront?.status==='unavailable',{},{timeout:300000});
  if(await page.evaluate(()=>window.battlefront.status)!=='ready')throw new Error(await page.evaluate(()=>window.battlefront.error));
  report.loadMilliseconds=Date.now()-loadStart;
  report.loadTimings=await page.evaluate(()=>window.battlefront.loadTimings);
  report.renderer=await page.evaluate(()=>{const c=document.querySelector('canvas'),gl=c.getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return {gpu:gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),drawingBuffer:[gl.drawingBufferWidth,gl.drawingBufferHeight],devicePixelRatio};});
  console.log(JSON.stringify({stage:'loaded',ms:report.loadMilliseconds,gpu:report.renderer.gpu}));
  await page.evaluate(()=>window.vibe.step(1));
  await page.waitForTimeout(2500);
  async function sample(name,setup=null,ms=4000){
    if(setup)await page.evaluate(setup);
    await page.waitForTimeout(1200);
    await page.evaluate(()=>{window.__frameCpu.length=0;window.__frameAt.length=0;});
    const perf=await page.evaluate(ms=>window.vibe.perf(ms),ms);
    const frames=await page.evaluate(()=>({cpu:window.__frameCpu.slice(),at:window.__frameAt.slice()}));
    const sorted=frames.cpu.slice().sort((a,b)=>a-b),pick=q=>sorted.length?+sorted[Math.min(sorted.length-1,Math.floor(q*sorted.length))].toFixed(2):null;
    const intervals=frames.at.slice(1).map((t,i)=>t-frames.at[i]).sort((a,b)=>a-b),ipick=q=>intervals.length?+intervals[Math.min(intervals.length-1,Math.floor(q*intervals.length))].toFixed(2):null;
    const row={name,fps:perf.fps,calls:perf.calls,triangles:perf.triangles,textures:perf.memory?.textures,geometries:perf.memory?.geometries,jsMsAvg:+(frames.cpu.reduce((s,x)=>s+x,0)/Math.max(1,frames.cpu.length)).toFixed(2),jsMsP50:pick(.5),jsMsP95:pick(.95),frameMsP50:ipick(.5),frameMsP95:ipick(.95)};
    report.samples.push(row);console.log(JSON.stringify(row));return row;
  }
  const base=await sample('spawn-baseline');
  await sample('resolution-0.5',()=>window.battlefront.renderOptions({resolutionScale:.5}));
  await sample('msaa-off',()=>window.battlefront.renderOptions({resolutionScale:1,samples:0}));
  await sample('hdr-bypass',()=>window.battlefront.renderOptions({samples:4,enabled:false}));
  await page.evaluate(()=>window.battlefront.renderOptions({enabled:true,samples:4,resolutionScale:1}));
  // Look around: a turn exercises culling/LOD on other sight lines.
  for(const [i,turn] of [[1,90],[2,90],[3,90]]) await sample(`turn-${i}`,t=>window.vibe.act({turn:t}),turn);
  if(arg('cpu-profile',false)){
    const cdp=await page.context().newCDPSession(page);
    await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:200});await cdp.send('Profiler.start');
    await page.waitForTimeout(5000);
    const {profile}=await cdp.send('Profiler.stop');
    const byId=new Map(profile.nodes.map(n=>[n.id,n])),self=new Map(),dt=profile.timeDeltas,counts=new Map();
    profile.samples.forEach((id,i)=>counts.set(id,(counts.get(id)??0)+(dt[i]??0)));
    for(const [id,us] of counts){const n=byId.get(id),f=n.callFrame,key=`${f.functionName||'(anon)'} ${f.url.split('/').pop()}:${f.lineNumber+1}`;self.set(key,(self.get(key)??0)+us);}
    const total=[...self.values()].reduce((s,x)=>s+x,0);
    report.cpuProfileTop=[...self.entries()].sort((a,b)=>b[1]-a[1]).slice(0,40).map(([k,us])=>({fn:k,ms:+(us/1000).toFixed(1),pct:+(us/total*100).toFixed(1)}));
    await fs.writeFile(path.join(output,`perf-${label}.cpuprofile`),JSON.stringify(profile));
    console.log(JSON.stringify(report.cpuProfileTop.slice(0,25),null,1));
  }
  report.programs=await page.evaluate(()=>window.battlefront.rendererDiagnostics().programs);
  report.baseline=base;
} catch(error) {report.fatal=String(error.stack??error);console.error(error);process.exitCode=1;}
finally {
  report.finishedAtUtc=new Date().toISOString();
  await fs.writeFile(path.join(output,`perf-${label}.json`),JSON.stringify(report,null,2));
  await browser?.close();await server?.close();
}
