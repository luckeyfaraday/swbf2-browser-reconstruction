// Focused actual-map diagnostic. Isolated server disables HMR during sampling.
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'vite';
import assert from 'node:assert/strict';
const output=path.resolve('test-results'),report={started:new Date().toISOString(),samples:[],errors:[]};
await fs.mkdir(output,{recursive:true});
const server=await createServer({root:process.cwd(),server:{host:'127.0.0.1',port:7748,strictPort:true,hmr:false},logLevel:'warn'});await server.listen();
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-webgl','--ignore-gpu-blocklist','--disable-background-timer-throttling','--js-flags=--max-old-space-size=8192']});
try {
  const page=await browser.newPage({viewport:{width:1280,height:720}});
  page.on('pageerror',error=>report.errors.push(String(error)));
  page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
  await page.goto('http://127.0.0.1:7748/?agent&seed=42');
  await page.waitForFunction(()=>window.battlefront?.status==='ready'||window.battlefront?.status==='unavailable',{}, {timeout:180000});
  if(await page.evaluate(()=>window.battlefront.status)!=='ready')throw new Error(await page.evaluate(()=>window.battlefront.error));
  await page.evaluate(()=>window.vibe.step(1));
  await page.evaluate(()=>window.battlefront.renderOptions({enabled:true,samples:0,resolutionScale:1}));
  report.initial=await page.evaluate(()=>({state:window.vibe.observe(),lighting:window.battlefront.lighting()}));
  report.gpu=await page.evaluate(()=>{const gl=document.querySelector('canvas').getContext('webgl2'),extension=gl.getExtension('WEBGL_debug_renderer_info');return {renderer:gl.getParameter(extension?.UNMASKED_RENDERER_WEBGL??gl.RENDERER),varyings:gl.getParameter(gl.MAX_VARYING_VECTORS),attributes:gl.getParameter(gl.MAX_VERTEX_ATTRIBS)};});
  const cdp=await page.context().newCDPSession(page);await cdp.send('Profiler.enable');
  for(const mode of (process.env.BF2_PROBE_PROFILE_MODES??'smooth,flat,bypass,original,smooth').split(',')) {
    await page.evaluate(async mode=>{
      const url=performance.getEntriesByType('resource').find(entry=>new URL(entry.name).pathname==='/src/source-probes.js').name;
      (await import(url)).setSourceProbeDiagnosticMode(mode);
    },mode);
    assert.equal(await page.evaluate(()=>window.battlefront.lighting().probes.diagnosticMode),mode);
    await page.evaluate(()=>window.vibe.perf(1800));
    await cdp.send('Profiler.start');
    const performance=await page.evaluate(()=>window.vibe.perf(3500));
    const {profile}=await cdp.send('Profiler.stop');
    await fs.writeFile(path.join(output,`probe-${mode}.cpuprofile`),JSON.stringify(profile));
    const sample={mode,performance,lighting:await page.evaluate(()=>window.battlefront.lighting()),programs:await page.evaluate(()=>window.battlefront.rendererDiagnostics())};
    await page.screenshot({path:path.join(output,`probe-${mode}.png`)});
    report.samples.push(sample);console.log(JSON.stringify({mode,performance,programCount:sample.programs.programs,probe:sample.lighting.probes}));
  }
  report.final=await page.evaluate(()=>window.vibe.observe());
}finally {await browser.close();await server.close();report.finished=new Date().toISOString();await fs.writeFile(path.join(output,'probe-profile.json'),JSON.stringify(report,null,2));}
