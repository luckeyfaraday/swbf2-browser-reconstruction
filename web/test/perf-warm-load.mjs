// Cold vs warm load with one persistent browser profile, so Chrome's GPU shader disk
// cache behaves as in a real browser (Playwright's default profile is always cold).
import {createServer} from 'vite';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),port=7753;
const gpu=process.argv.find(a=>a.startsWith('--gpu='))?.slice(6)??'dgpu',runs=Number(process.argv.find(a=>a.startsWith('--runs='))?.slice(7)??2);
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'bf2-warm-'));
const server=await createServer({root,server:{host:'127.0.0.1',port,strictPort:true,watch:null,hmr:false},logLevel:'error'});await server.listen();
const cacheKb=process.argv.find(a=>a.startsWith('--cache-kb='))?.slice(11);
const args=['--enable-webgl','--ignore-gpu-blocklist','--js-flags=--max-old-space-size=8192',...(gpu==='dgpu'?['--force_high_performance_gpu']:[]),...(cacheKb?[`--gpu-program-cache-size-kb=${cacheKb}`]:[])];
try{
  for(let run=1;run<=runs;run++){
    const context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args,viewport:{width:1280,height:720}});
    const page=context.pages()[0]??await context.newPage();
    const started=Date.now();
    await page.goto(`http://127.0.0.1:${port}/?agent&seed=42&batchCell=48${process.argv.find(a=>a.startsWith('--query='))?'&'+process.argv.find(a=>a.startsWith('--query=')).slice(8):''}`);
    await page.waitForFunction(()=>window.battlefront?.status==='ready'||window.battlefront?.status==='unavailable',{},{timeout:300000});
    const timings=await page.evaluate(()=>window.battlefront.loadTimings);
    console.log(JSON.stringify({run,totalMs:Date.now()-started,stages:Object.fromEntries(timings.filter(t=>!t.stage.startsWith('assets/')).map(t=>[t.stage,t.milliseconds]))}));
    await context.close();
  }
} finally{await server.close();await fs.rm(profile,{recursive:true,force:true});}
