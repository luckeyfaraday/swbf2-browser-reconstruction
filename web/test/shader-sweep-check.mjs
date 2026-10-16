// Compiles every program the actual map can use (all meshes and native LOD
// variants, as prepareAllShaders does) and fails on any program that does not
// link. Catches materials that only break in areas the spawn view never shows.
// Usage: node test/shader-sweep-check.mjs [--gpu=dgpu|igpu] [--query=shadows=0]
import {createServer} from 'vite';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),port=7758;
const arg=name=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
const gpu=arg('gpu')??'dgpu',query=arg('query')??'';
const server=await createServer({root,server:{host:'127.0.0.1',port,strictPort:true,watch:null,hmr:false},logLevel:'error'});await server.listen();
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-webgl','--ignore-gpu-blocklist','--js-flags=--max-old-space-size=8192',...(gpu==='dgpu'?['--force_high_performance_gpu']:[])]});
const report={kind:'actual-map-shader-sweep',gpu,query,consoleErrors:[]};
try{
  const page=await browser.newPage({viewport:{width:1280,height:720}});
  page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text().slice(0,400));});
  await page.goto(`http://127.0.0.1:${port}/?agent&seed=42&batchCell=48${query?'&'+query:''}`);
  await page.waitForFunction(()=>window.battlefront?.status==='ready'||window.battlefront?.status==='unavailable',{},{timeout:300000});
  report.loadTimings=await page.evaluate(()=>window.battlefront.loadTimings.filter(t=>!t.stage.startsWith('assets/')));
  report.sweep=await page.evaluate(async()=>{
    const {prepareAllShaders}=await import('/src/prepare-shaders.js');
    const {renderer,scene,camera,assets}=window.battlefront.debug,exposure=window.battlefront.debug.exposure??null;
    const before=renderer.info.programs.length;
    const result=await prepareAllShaders(renderer,scene,camera,exposure,{variants:assets.lods.variants?.()??[]});
    return {...result,programsBefore:before,failed:result.failed.map(f=>({name:f.name,type:f.material.type,log:f.log.slice(0,200),samplers:Object.entries(f.material.userData).filter(([k])=>/recovered|source/.test(k)).map(([k])=>k)}))};
  });
  console.log(JSON.stringify({programsBefore:report.sweep.programsBefore,programsAfter:report.sweep.programs,milliseconds:report.sweep.milliseconds,meshes:report.sweep.meshes,failed:report.sweep.failed.length}));
  for(const f of report.sweep.failed)console.log(JSON.stringify(f));
  if(report.sweep.failed.length)process.exitCode=1;
} finally{await fs.writeFile(path.join(root,'test-results',`shader-sweep-${gpu}${query?'-'+query.replace(/\W+/g,'_'):''}.json`),JSON.stringify(report,null,2));await browser.close();await server.close();}
