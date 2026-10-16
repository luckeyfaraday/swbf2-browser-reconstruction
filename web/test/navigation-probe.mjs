import {createServer} from 'vite';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
const server=await createServer({root:process.cwd(),server:{host:'127.0.0.1',port:7747,strictPort:true,watch:null,hmr:false},logLevel:'warn'});
let browser;const report={kind:'independent-source-map-capsule-route-probes',liveActorsModified:false,cases:[]};
try{
 await server.listen();browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-webgl','--ignore-gpu-blocklist','--js-flags=--max-old-space-size=8192']});
 const page=await browser.newPage({viewport:{width:960,height:540}});page.setDefaultTimeout(180000);
 await page.goto('http://127.0.0.1:7747/?agent&seed=42');await page.waitForFunction(()=>window.battlefront?.status==='ready');
 for(const options of [{},{waypointRadius:.3},{stepHeight:.45},{radius:.35},{radius:.35,stepHeight:.45}]){
  const result=await page.evaluate(options=>window.battlefront.probeRoute([-1014.30731,585.120056,-360.258148],[-953.344,587.682,-350.005],options),options);
  report.cases.push(result);console.log(JSON.stringify({options,completed:result.completed,index:result.index,path:result.path.length,position:result.position,samples:result.samples.slice(-3)}));
  await fs.writeFile('test-results/navigation-probe.json',JSON.stringify(report,null,2));
 }
}finally{await browser?.close();await server.close();}
