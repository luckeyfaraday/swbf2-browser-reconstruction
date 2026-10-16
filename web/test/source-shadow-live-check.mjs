// Live native spot shadow check on the actual map: activation, receivers, errors,
// and the rendered difference against ?shadows=0 from the same view.
// Usage (GPU lock): ../tools/gpu-lock.sh node test/source-shadow-live-check.mjs [--gpu=dgpu|igpu]
import {createServer} from 'vite';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),output=path.join(root,'test-results'),port=7761;
const gpu=process.argv.find(a=>a.startsWith('--gpu='))?.slice(6)??'dgpu';
const server=await createServer({root,server:{host:'127.0.0.1',port,strictPort:true,watch:null,hmr:false},logLevel:'error'});await server.listen();
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-webgl','--ignore-gpu-blocklist','--disable-background-timer-throttling','--js-flags=--max-old-space-size=8192',...(gpu==='dgpu'?['--force_high_performance_gpu']:[])]});
const report={kind:'native-spot-shadow-live-check',gpu,runs:[]};
try{
  await fs.mkdir(output,{recursive:true});
  for(const shadows of ['1','0']) {
    const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];
    page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto(`http://127.0.0.1:${port}/?agent&seed=42&batchCell=48&shadows=${shadows}`);
    await page.waitForFunction(()=>window.battlefront?.status==='ready'||window.battlefront?.status==='unavailable',{},{timeout:300000});
    await page.evaluate(()=>window.vibe.step(1));
    // Face the floor under the first source-shadowed spot in the pool (fixed seed spawn).
    const aim=await page.evaluate(()=>{const {camera,lighting}=window.battlefront.debug,light=lighting.spotSlots().find(l=>l?.shadow);if(!light)return null;
      const forward=camera.getWorldDirection(new window.battlefront.debug.THREE.Vector3()),dx=light.position[0]-camera.position.x,dz=light.position[2]-camera.position.z;
      const turn=(Math.atan2(-dx,-dz)-Math.atan2(-forward.x,-forward.z))*180/Math.PI;return {turn,light:light.id};});
    if(aim){await page.evaluate(turn=>window.vibe.act({turn}),aim.turn);await page.evaluate(()=>window.vibe.act({look:[0,-35]}));await page.evaluate(()=>window.vibe.step(.2));}
    const lighting=await page.evaluate(()=>window.battlefront.lighting());
    const perf=await page.evaluate(()=>window.vibe.perf(2000));
    const screenshot=await page.screenshot({path:path.join(output,`source-shadow-live-${shadows==='1'?'on':'off'}.png`)});
    const pixels=await page.evaluate(async base64=>{const image=new Image();image.src=`data:image/png;base64,${base64}`;await image.decode();
      const t=document.createElement('canvas');t.width=image.width;t.height=image.height;const x=t.getContext('2d');x.drawImage(image,0,0);return Array.from(x.getImageData(0,0,t.width,t.height).data);},screenshot.toString('base64'));
    const spotSlots=await page.evaluate(()=>window.battlefront.debug.lighting.spotSlots().map(l=>l?{id:l.id.slice(-30),shadow:!!l.shadow}:null));
    report.runs.push({shadows,aim,errors,shadowsSnapshot:lighting.shadows&&{...lighting.shadows,policy:undefined},spotSlots,perf,pixels});
    await page.close();
  }
  const [on,off]=report.runs;let changed=0,maxDelta=0;
  for(let i=0;i<on.pixels.length;i+=4){const d=Math.max(...[0,1,2].map(k=>Math.abs(on.pixels[i+k]-off.pixels[i+k])));if(d>3)changed++;maxDelta=Math.max(maxDelta,d);}
  report.difference={changedPixels:changed,maxDelta,fraction:changed/(on.pixels.length/4)};
  for(const run of report.runs)delete run.pixels;
  console.log(JSON.stringify(report,null,1));
  await fs.writeFile(path.join(output,'source-shadow-live-check.json'),JSON.stringify(report,null,2));
} finally{await browser.close();await server.close();}
