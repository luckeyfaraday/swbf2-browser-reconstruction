// Audits the live actual-map scene for per-frame CPU overhead sources: object counts,
// matrix auto-update, material sharing across mesh kinds (program thrash), array
// uniforms (flatten/upload cost) and materials whose version changes every frame.
// Usage: node test/perf-scene-audit.mjs [--gpu=dgpu|igpu]
import {createServer} from 'vite';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),output=path.join(root,'test-results');
const gpu=process.argv.find(a=>a.startsWith('--gpu='))?.slice(6)??'dgpu',port=Number(process.env.BF2_PERF_PORT??7750);
let server,browser;
try {
  server=await createServer({root,server:{host:'127.0.0.1',port,strictPort:true,watch:null,hmr:false},logLevel:'error'});await server.listen();
  const args=['--enable-webgl','--ignore-gpu-blocklist','--disable-background-timer-throttling','--js-flags=--max-old-space-size=8192'];
  if(gpu==='dgpu')args.push('--force_high_performance_gpu');
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args});
  const page=await browser.newPage({viewport:{width:1280,height:720}});page.setDefaultTimeout(60000);
  await page.goto(`http://127.0.0.1:${port}/?agent&seed=42&batchCell=48`);
  await page.waitForFunction(()=>window.battlefront?.status==='ready'||window.battlefront?.status==='unavailable',{},{timeout:300000});
  await page.evaluate(()=>window.vibe.step(1));await page.waitForTimeout(2000);
  const audit=await page.evaluate(async()=>{
    const {renderer,scene}=window.battlefront.debug,props=renderer.properties;
    const counts={objects:0,meshes:0,instanced:0,instances:0,skinned:0,autoMatrix:0,autoMatrixWorld:0,groups:0,visibleMeshes:0,frustumCulledOff:0};
    const signatures=new Map(),materials=new Map();
    scene.traverse(o=>{counts.objects++;if(o.matrixAutoUpdate)counts.autoMatrix++;if(o.matrixWorldAutoUpdate)counts.autoMatrixWorld++;if(o.isGroup)counts.groups++;
      if(!o.isMesh)return;counts.meshes++;if(o.visible)counts.visibleMeshes++;if(!o.frustumCulled)counts.frustumCulledOff++;
      if(o.isInstancedMesh){counts.instanced++;counts.instances+=o.count;}if(o.isSkinnedMesh)counts.skinned++;
      for(const m of [].concat(o.material)){
        const g=o.geometry,sig=[o.isInstancedMesh?'inst':'mesh',o.isSkinnedMesh?'skin':'',o.isBatchedMesh?'batch':'',g.attributes.tangent&&m.normalMap?'tan':'',m.vertexColors&&g.attributes.color?.itemSize===4?'va':'',g.morphAttributes?.position?'morph':''].join('|');
        if(!signatures.has(m.uuid))signatures.set(m.uuid,new Set());signatures.get(m.uuid).add(sig);materials.set(m.uuid,m);
      }
    });
    const mixed=[...signatures].filter(([,s])=>s.size>1).map(([id,s])=>({name:materials.get(id).name,type:materials.get(id).type,signatures:[...s]}));
    const before=new Map([...materials].map(([id,m])=>[id,{v:m.version,light:props.get(m).lightsStateVersion,prog:props.get(m).currentProgram?.id}]));
    await new Promise(r=>setTimeout(r,1500));
    const versionBumps=[],programFlips=[],lightFlips=[];
    for(const [id,m] of materials){const b=before.get(id),p=props.get(m);if(m.version!==b.v)versionBumps.push({name:m.name,from:b.v,to:m.version});if(p.currentProgram?.id!==b.prog)programFlips.push(m.name);if(p.lightsStateVersion!==b.light)lightFlips.push(m.name);}
    // Array uniforms: element count across all materials' compiled uniforms.
    const arrays=new Map();
    for(const m of materials.values()){const u=props.get(m).uniforms;if(!u)continue;for(const [name,entry] of Object.entries(u)){const v=entry?.value;if(Array.isArray(v)&&v.length&&typeof v[0]==='object'&&v[0]!==null&&('x' in v[0]||'elements' in v[0]||'r' in v[0])){const row=arrays.get(name)??{name,length:v.length,kind:v[0].constructor.name,materials:0};row.materials++;arrays.set(name,row);}}}
    const programs=renderer.info.programs.map(p=>({name:p.name,usedTimes:p.usedTimes,cacheKey:p.cacheKey.length}));
    return {counts,materials:materials.size,mixedSignatureMaterials:mixed.length,mixedExamples:mixed.slice(0,15),versionBumps:versionBumps.length,versionBumpExamples:versionBumps.slice(0,15),programFlips:programFlips.length,programFlipExamples:programFlips.slice(0,10),lightStateFlips:lightFlips.length,arrayUniforms:[...arrays.values()].sort((a,b)=>b.length*b.materials-a.length*a.materials).slice(0,25),programs:programs.length,info:renderer.info.render};
  });
  console.log(JSON.stringify(audit,null,1));
  await fs.writeFile(path.join(output,`perf-scene-audit-${gpu}.json`),JSON.stringify(audit,null,2));
} catch(error){console.error(error);process.exitCode=1;}
finally{await browser?.close();await server?.close();}
