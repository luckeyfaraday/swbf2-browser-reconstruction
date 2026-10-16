// Counts scene objects per top-level subtree (what updateMatrixWorld/projectObject walk each frame).
import {createServer} from 'vite';
import {chromium} from 'playwright';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),port=7751;
const server=await createServer({root,server:{host:'127.0.0.1',port,strictPort:true,watch:null,hmr:false},logLevel:'error'});await server.listen();
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-webgl','--ignore-gpu-blocklist','--force_high_performance_gpu','--js-flags=--max-old-space-size=8192']});
try{
  const page=await browser.newPage({viewport:{width:1280,height:720}});
  await page.goto(`http://127.0.0.1:${port}/?agent&seed=42&batchCell=48`);
  await page.waitForFunction(()=>window.battlefront?.status==='ready',{},{timeout:300000});
  await page.evaluate(()=>window.vibe.step(1));
  if(process.argv.includes("--bones"))console.log(JSON.stringify(await page.evaluate(()=>{const {runtime}=window.battlefront.debug,out=[];for(const actor of runtime.actors.slice(0,2)){const skinned=[];actor.body.root.traverse(o=>{if(o.isSkinnedMesh)skinned.push(o);});const skeleton=skinned[0]?.skeleton,bones=skeleton?.bones??[],used=new Set();for(const m of skinned){if(m.skeleton!==skeleton)out.push("distinct skeleton");const si=m.geometry.attributes.skinIndex,sw=m.geometry.attributes.skinWeight;for(let i=0;i<si.count;i++)for(let k=0;k<4;k++)if(sw.getComponent(i,k)>0)used.add(m.skeleton.bones[si.getComponent(i,k)]);}const needed=new Set();const mark=b=>{for(let x=b;x&&x.isBone&&!needed.has(x);x=x.parent)needed.add(x);};used.forEach(mark);const capsuleBones=(actor.body.hitboxes?.capsules??[]).map(c=>c.source.bone);let allBones=0;actor.body.root.traverse(o=>{if(o.isBone)allBones++;});out.push({actor:actor.id,skinnedMeshes:skinned.length,skeletonBones:bones.length,allBoneNodes:allBones,weighted:used.size,weightedPlusAncestors:needed.size,capsuleBones,mixerActions:actor.body.mixer?._actions?.length??null,clipTracks:actor.body.mixer?._actions?.map(a=>a._clip.tracks.length)??null});}return out;}),null,1));
  else console.log(JSON.stringify(await page.evaluate(()=>{
    const {scene,assets}=window.battlefront.debug,rows=[];
    const describe=(o,depth)=>{let n=0,auto=0,meshes=0,bones=0;o.traverse(x=>{n++;if(x.matrixAutoUpdate)auto++;if(x.isMesh)meshes++;if(x.isBone)bones++;});return {name:o.name||o.type,type:o.type,depth,objects:n,auto,meshes,bones};};
    for(const child of scene.children){rows.push(describe(child,0));if(child===assets.group)for(const c of child.children.filter(c=>c.children.length))rows.push(describe(c,1));}
    const agg=new Map();for(const r of rows){const k=`${r.depth}:${r.type}:${r.depth?r.name:r.name.replace(/[0-9]+/g,'#')}`;const a=agg.get(k)??{key:k,count:0,objects:0,auto:0,meshes:0,bones:0};a.count++;a.objects+=r.objects;a.auto+=r.auto;a.meshes+=r.meshes;a.bones+=r.bones;agg.set(k,a);}
    return [...agg.values()].sort((a,b)=>b.objects-a.objects).slice(0,25);
  }),null,0).replace(/\},\{/g,'},\n{'));
} finally{await browser.close();await server.close();}
