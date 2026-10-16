// Checks whether a soldier's per-part skeleton copies can share one skeleton exactly:
// same source bone names, matching inverse bind matrices and bind matrices.
import {createServer} from 'vite';
import {chromium} from 'playwright';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),port=7752;
const server=await createServer({root,server:{host:'127.0.0.1',port,strictPort:true,watch:null,hmr:false},logLevel:'error'});await server.listen();
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-webgl','--ignore-gpu-blocklist','--force_high_performance_gpu','--js-flags=--max-old-space-size=8192']});
try{
  const page=await browser.newPage({viewport:{width:1280,height:720}});
  await page.goto(`http://127.0.0.1:${port}/?agent&seed=42&batchCell=48`);
  await page.waitForFunction(()=>window.battlefront?.status==='ready',{},{timeout:300000});
  if(process.argv.includes('--live')){await page.evaluate(()=>window.vibe.act({start:true}));await page.evaluate(()=>window.vibe.step(4));
    console.log(JSON.stringify(await page.evaluate(()=>{const {runtime,scene,camera}=window.battlefront.debug;scene.updateMatrixWorld(true);const sourceName=b=>b.userData?.name??b.name,out=[];
      const check=(label,root)=>{const parts=[];root.traverse(o=>{if(o.isSkinnedMesh)parts.push(o);});const primary=new Map();for(const part of parts)for(const b of part.skeleton.bones){const n=sourceName(b);if(!primary.has(n))primary.set(n,b);}
        let usedDiff=0,anyDiff=0,worst=null,usedBones=0;for(const part of parts){const si=part.geometry.attributes.skinIndex,sw=part.geometry.attributes.skinWeight,used=new Set();for(let i=0;i<si.count;i++)for(let k=0;k<4;k++)if(sw.getComponent(i,k)>0)used.add(si.getComponent(i,k));usedBones+=used.size;
          part.skeleton.bones.forEach((b,i)=>{const p=primary.get(sourceName(b));const d=b.matrixWorld.elements.reduce((m,v,j)=>Math.max(m,Math.abs(v-p.matrixWorld.elements[j])),0);anyDiff=Math.max(anyDiff,d);if(used.has(i)&&d>usedDiff){usedDiff=d;worst=sourceName(b);}});}
        out.push({label,parts:parts.length,usedBones,maxWorldDiffUsedBones:usedDiff,worstUsedBone:worst,maxWorldDiffAnyBone:anyDiff});};
      for(const a of runtime.actors.slice(0,4))check(a.id,a.body.root);check('first-person',camera);return out;}),null,1));}
  else console.log(JSON.stringify(await page.evaluate(()=>{
    const {runtime,camera}=window.battlefront.debug,out=[];
    const sourceName=b=>b.userData?.name??b.name;
    const maxDiff=(a,b)=>a.elements.reduce((m,v,i)=>Math.max(m,Math.abs(v-b.elements[i])),0);
    const analyse=(label,rootObject)=>{
      const parts=[];rootObject.traverse(o=>{if(o.isSkinnedMesh)parts.push(o);});
      const primary=new Map();let inverseDiff=0,bindDiff=0,missing=0,restDiff=0,partBones=0,uniqueSkeletons=new Set();
      for(const part of parts){uniqueSkeletons.add(part.skeleton);part.skeleton.bones.forEach((bone,i)=>{partBones++;const name=sourceName(bone);if(!primary.has(name)){primary.set(name,{bone,inverse:part.skeleton.boneInverses[i]});return;}const p=primary.get(name);inverseDiff=Math.max(inverseDiff,maxDiff(p.inverse,part.skeleton.boneInverses[i]));restDiff=Math.max(restDiff,p.bone.position.distanceTo(bone.position));});
        bindDiff=Math.max(bindDiff,maxDiff(parts[0].bindMatrix,part.bindMatrix));if(part.bindMode!==parts[0].bindMode)missing++;}
      const firstSkeleton=new Set(parts[0]?.skeleton.bones.map(sourceName));
      const notInFirst=[...primary.keys()].filter(n=>!firstSkeleton.has(n));
      out.push({label,parts:parts.length,uniqueSkeletons:uniqueSkeletons.size,partBones,distinctSourceBones:primary.size,notInFirstSkeleton:notInFirst.length,maxInverseBindDiff:inverseDiff,maxBindMatrixDiff:bindDiff,bindModeMismatch:missing,maxRestPositionDiff:restDiff,bindMode:parts[0]?.bindMode});
    };
    for(const actor of runtime.actors.filter((a,i)=>i<2||a.team!==runtime.actors[0].team).slice(0,3))analyse(actor.id,actor.body.root);
    analyse('first-person',camera);
    return out;
  }),null,1));
} finally{await browser.close();await server.close();}
