// Watches adaptive resolution settle on the actual map: scale and FPS over time.
// Usage: node test/perf-adaptive-check.mjs [--gpu=igpu|dgpu]
import {createServer} from 'vite';
import {chromium} from 'playwright';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),port=7756;
const gpu=process.argv.find(a=>a.startsWith('--gpu='))?.slice(6)??'igpu';
const server=await createServer({root,server:{host:'127.0.0.1',port,strictPort:true,watch:null,hmr:false},logLevel:'error'});await server.listen();
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-webgl','--ignore-gpu-blocklist','--disable-background-timer-throttling','--js-flags=--max-old-space-size=8192',...(gpu==='dgpu'?['--force_high_performance_gpu']:[])]});
try{
  const page=await browser.newPage({viewport:{width:1280,height:720}});
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/?agent&adaptive=1&seed=42&batchCell=48`);
  await page.waitForFunction(()=>window.battlefront?.status==='ready',{},{timeout:300000});
  await page.evaluate(()=>window.vibe.step(1));
  for(let i=0;i<8;i++){
    const perf=await page.evaluate(()=>window.vibe.perf(2500));
    const a=await page.evaluate(()=>window.battlefront.adaptiveResolution());
    console.log(JSON.stringify({t:(i+1)*2.5,fps:perf.fps,scale:+a.scale.toFixed(3),changes:a.changes,avgFrame:+(a.lastWindow?.avgFrame??0).toFixed(1),avgWork:+(a.lastWindow?.avgWork??0).toFixed(1),gpuBound:a.lastWindow?.gpuBound}));
  }
  console.log(JSON.stringify({errors}));
} finally{await browser.close();await server.close();}
