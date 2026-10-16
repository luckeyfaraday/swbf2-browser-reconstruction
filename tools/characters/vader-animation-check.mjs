// Sanity checks for vader-animations.glb and hm-hero-reactions.glb (read-only).
//   node tools/characters/vader-animation-check.mjs
// Structural: skeleton names/hierarchy/rest pose identical to stormtrooper.glb skin 0, every
// animated node exists in stormtrooper.glb (and in vader.glb when present), times monotonic,
// finite samples, unit quaternions, extras windows inside the clip.
// Anatomical (independent CPU forward kinematics): body bone lengths stable, foot heights
// plausible over time for grounded clips, hips/head heights plausible.
// Loader: three.js GLTFLoader parses both files; clips bind by bone name on stormtrooper.glb
// (and vader.glb) and an AnimationMixer moves the bones.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const assets=path.join(root,'web/public/assets/characters');
const THREE=await import(pathToFileURL(path.join(root,'web/node_modules/three/build/three.module.js')).href);
const {GLTFLoader}=await import(pathToFileURL(path.join(root,'web/node_modules/three/examples/jsm/loaders/GLTFLoader.js')).href);

function readGlb(file) {
  const bytes=fs.readFileSync(file),jl=bytes.readUInt32LE(12),doc=JSON.parse(bytes.subarray(20,20+jl).toString());
  const binStart=20+jl+8,bin=bytes.subarray(binStart,binStart+bytes.readUInt32LE(20+jl));
  return {doc,bin,bytes};
}
function accessorData({doc,bin},index) {
  const a=doc.accessors[index],v=doc.bufferViews[a.bufferView],size={SCALAR:1,VEC3:3,VEC4:4}[a.type];
  const f=new Float32Array(bin.buffer,bin.byteOffset+(v.byteOffset??0)+(a.byteOffset??0),a.count*size);
  const rows=[];for(let i=0;i<a.count;i++)rows.push(Array.from(f.subarray(i*size,i*size+size)));
  return rows;
}
const failures=[],warnings=[];
const fail=(m)=>failures.push(m),warn=(m)=>warnings.push(m);

// ---- reference skeleton ----------------------------------------------------
const trooper=readGlb(path.join(assets,'stormtrooper.glb'));
const tj=trooper.doc.skins[0].joints,tparent={};
trooper.doc.nodes.forEach((n,i)=>(n.children??[]).forEach(c=>tparent[c]=i));
const trooperBones=new Map(tj.map(i=>[trooper.doc.nodes[i].name,{node:trooper.doc.nodes[i],parent:tparent[i]!==undefined?trooper.doc.nodes[tparent[i]].name:null}]));
let vaderNames=null;
const vaderPath=path.join(assets,'vader.glb');
if(fs.existsSync(vaderPath)){const v=readGlb(vaderPath);vaderNames=new Set(v.doc.nodes.map(n=>n.name));}

// ---- math ---------------------------------------------------------------------
const qmul=(a,b)=>[a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
const qrot=(q,v)=>{const p=qmul(qmul(q,[v[0],v[1],v[2],0]),[-q[0],-q[1],-q[2],q[3]]);return [p[0],p[1],p[2]];};
const norm=q=>{const n=Math.hypot(...q);return q.map(x=>x/n);};
function slerp(a,b,t){let d=a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3];if(d<0){b=b.map(x=>-x);d=-d;}if(d>.9995)return norm(a.map((x,i)=>x+(b[i]-x)*t));const th=Math.acos(Math.min(1,d)),s=Math.sin(th);return a.map((x,i)=>(Math.sin((1-t)*th)*x+Math.sin(t*th)*b[i])/s);}
function sampleTrack(times,values,t,rot){
  if(t<=times[0])return values[0];if(t>=times.at(-1))return values.at(-1);
  let i=1;while(times[i]<t)i++;const a=(t-times[i-1])/(times[i]-times[i-1]);
  return rot?slerp(values[i-1],values[i],a):values[i-1].map((x,k)=>x+(values[i][k]-x)*a);
}

// ---- per file -----------------------------------------------------------------
const GROUND_EXEMPT=/^(jump|in-air|death|air-attack|intro|emote|choke|saber-death|push-death|blaster-death|run-death|melee-death|stagger|block-stagger|add-|rage|catch|throw|dodge|closer|strike|attack-blocked|turn|antispam)/;
const summary={};
for(const file of ['vader-animations.glb','hm-hero-reactions.glb']) {
  const glb=readGlb(path.join(assets,file)),{doc}=glb;
  const names=doc.nodes.map(n=>n.name),parent={};
  doc.nodes.forEach((n,i)=>(n.children??[]).forEach(c=>parent[c]=i));
  // Skeleton identity.
  if(names.length!==trooperBones.size)fail(`${file}: ${names.length} nodes vs ${trooperBones.size} trooper joints`);
  let restError=0;
  doc.nodes.forEach((n,i)=>{
    const ref=trooperBones.get(n.name);if(!ref){fail(`${file}: node ${n.name} not in stormtrooper.glb`);return;}
    const p=parent[i]!==undefined?names[parent[i]]:null;if(p!==ref.parent)fail(`${file}: ${n.name} parent ${p} != ${ref.parent}`);
    for(const k of ['translation','rotation','scale'])(ref.node[k]??[]).forEach((x,j)=>{restError=Math.max(restError,Math.abs(x-(n[k]?.[j]??x)));});
  });
  if(restError>1e-6)fail(`${file}: rest TRS differs by ${restError}`);
  // Rest world positions.
  const order=[];const visit=i=>{order.push(i);for(const c of doc.nodes[i].children??[])visit(c);};visit(names.indexOf('Reference'));
  function fk(local){ // local: index -> {t,r}
    const wpos=new Array(names.length),wrot=new Array(names.length);
    for(const i of order){const {t,r}=local[i],p=parent[i];
      if(p===undefined){wpos[i]=t;wrot[i]=r;}else{const rp=qrot(wrot[p],t);wpos[i]=[wpos[p][0]+rp[0],wpos[p][1]+rp[1],wpos[p][2]+rp[2]];wrot[i]=qmul(wrot[p],r);}}
    return wpos;
  }
  const restLocal=doc.nodes.map(n=>({t:n.translation??[0,0,0],r:n.rotation??[0,0,0,1]}));
  const restPos=fk(restLocal);
  const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
  const idx=Object.fromEntries(names.map((n,i)=>[n,i]));
  const hipsDesc=new Set();(function mark(i){hipsDesc.add(i);for(const c of doc.nodes[i].children??[])mark(c);})(idx.Hips);
  const bodyBones=[...hipsDesc].filter(i=>i!==idx.Hips&&!/^(Wep|IK_|FACIAL)|_Phys|Attach|Bulge|Armpit|Bend|Roll|Heel_Trans|KneeLow|KneeUp|Ankle$|Toe$|End$|Collar|Backpack/.test(names[i]));
  const rows=[];
  let maxNorm=0,maxBone=0,maxBoneName='';
  for(const anim of doc.animations) {
    const ex=anim.extras??{};
    const tracks=anim.channels.map(ch=>{const s=anim.samplers[ch.sampler];return {node:ch.target.node,path:ch.target.path,times:accessorData(glb,s.input).map(r=>r[0]),values:accessorData(glb,s.output)};});
    for(const tr of tracks) {
      const nm=names[tr.node];
      if(!trooperBones.has(nm))fail(`${file}/${anim.name}: animated node ${nm} missing from stormtrooper.glb`);
      if(tr.times[0]!==0)fail(`${file}/${anim.name}: ${nm} starts at ${tr.times[0]}`);
      if(Math.abs(tr.times.at(-1)-ex.duration)>1e-5)fail(`${file}/${anim.name}: ${nm} ends at ${tr.times.at(-1)} not ${ex.duration}`);
      for(let i=1;i<tr.times.length;i++)if(!(tr.times[i]>tr.times[i-1]))fail(`${file}/${anim.name}: non-increasing time`);
      for(const v of tr.values){if(v.some(x=>!Number.isFinite(x)))fail(`${file}/${anim.name}: nonfinite`);if(tr.path==='rotation')maxNorm=Math.max(maxNorm,Math.abs(Math.hypot(...v)-1));}
      if(tr.path==='rotation')for(let i=1;i<tr.values.length;i++){const a=tr.values[i-1],b=tr.values[i];if(a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3]<0)fail(`${file}/${anim.name}: hemisphere flip on ${nm}`);}
      if(nm==='AITrajectory'&&tr.path==='translation')fail(`${file}/${anim.name}: root translation not removed`);
    }
    for(const w of ex.hitWindows??[])if(!(w[0]>=0&&w[1]<=ex.duration+1e-6&&w[1]>w[0]))fail(`${file}/${anim.name}: hit window ${w} outside clip`);
    const animatedNames=new Set(tracks.map(t=>names[t.node]));
    const vaderMissing=vaderNames?[...animatedNames].filter(n=>!vaderNames.has(n)):null;
    if(ex.additive){rows.push({clip:anim.name,additive:true,tracks:tracks.length,vaderMissing});continue;}
    // FK over every key time (capped).
    const allTimes=[...new Set(tracks.flatMap(t=>t.times))].sort((a,b)=>a-b);
    const step=Math.max(1,Math.ceil(allTimes.length/240)),sampleTimes=allTimes.filter((_,i)=>i%step===0);
    let minFoot=Infinity,maxLowFoot=-Infinity,hips0=null,head0=null,boneDev=0,boneDevName='';
    // Root motion is re-applied from extras so heights are judged in the source world frame.
    const origin=ex.rootMotion?.origin??[0,0,0];
    const rm=ex.rootMotion?.t?{times:ex.rootMotion.t,values:ex.rootMotion.p.map(p=>p.map((x,k)=>x+origin[k]))}:{times:[0],values:[origin]};
    for(const t of sampleTimes) {
      const local=restLocal.map(x=>({t:x.t,r:x.r}));
      for(const tr of tracks){const v=sampleTrack(tr.times,tr.values,t,tr.path==='rotation');local[tr.node]={...local[tr.node],[tr.path==='rotation'?'r':'t']:v};}
      local[idx.AITrajectory]={...local[idx.AITrajectory],t:sampleTrack(rm.times,rm.values,t,false)};
      const pos=fk(local);
      for(const i of bodyBones){const d=Math.abs(dist(pos[i],pos[parent[i]])-dist(restPos[i],restPos[parent[i]]));if(d>boneDev){boneDev=d;boneDevName=names[i];}}
      const feet=['LeftToeBase','RightToeBase','LeftFoot','RightFoot'].map(n=>pos[idx[n]][1]);
      const low=Math.min(...feet);minFoot=Math.min(minFoot,low);maxLowFoot=Math.max(maxLowFoot,low);
      if(hips0===null){hips0=pos[idx.Hips][1];head0=pos[idx.Head][1];}
    }
    if(boneDev>maxBone){maxBone=boneDev;maxBoneName=`${anim.name}:${boneDevName}`;}
    const row={clip:anim.name,samples:sampleTimes.length,hips0:+hips0.toFixed(3),head0:+head0.toFixed(3),minFoot:+minFoot.toFixed(3),maxLowestFoot:+maxLowFoot.toFixed(3),boneDev:+boneDev.toFixed(4),boneDevBone:boneDevName,vaderMissing};
    rows.push(row);
    if(boneDev>0.02)(/^(intro|emote)/.test(anim.name)?warn:fail)(`${file}/${anim.name}: body bone length changes ${boneDev.toFixed(4)} m (${boneDevName})`);
    if(!GROUND_EXEMPT.test(anim.name)) {
      if(minFoot<-0.08||minFoot>0.15)fail(`${file}/${anim.name}: lowest foot ${minFoot.toFixed(3)} m implausible`);
      if(maxLowFoot>0.3)fail(`${file}/${anim.name}: both feet off ground (${maxLowFoot.toFixed(3)} m)`);
      if(hips0<0.6||hips0>1.15)fail(`${file}/${anim.name}: hips height ${hips0}`);
      if(head0<hips0+0.4)fail(`${file}/${anim.name}: head not above hips`);
    } else if(minFoot<-0.25)warn(`${file}/${anim.name}: foot ${minFoot.toFixed(3)} m below ground plane (exempt clip)`);
  }
  if(maxNorm>1e-5)fail(`${file}: quaternion norm error ${maxNorm}`);
  summary[file]={animations:doc.animations.length,bytes:glb.bytes.length,maxQuaternionNormError:maxNorm,maxBodyBoneLengthChange:{metres:+maxBone.toFixed(5),where:maxBoneName},rows};
}

// ---- three.js load + bind ---------------------------------------------------
const loader=new GLTFLoader();
// Node has no image decoding: parse a copy whose JSON chunk drops images/textures/materials.
function stripped(bytes) {
  const jl=bytes.readUInt32LE(12),doc=JSON.parse(bytes.subarray(20,20+jl).toString());
  delete doc.images;delete doc.textures;delete doc.samplers;delete doc.materials;
  for(const mesh of doc.meshes??[])for(const p of mesh.primitives)delete p.material;
  if(doc.extensionsUsed)doc.extensionsUsed=doc.extensionsUsed.filter(e=>!/texture/i.test(e));
  let json=Buffer.from(JSON.stringify(doc));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);
  const rest=bytes.subarray(20+jl),head=Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67,0);head.writeUInt32LE(2,4);head.writeUInt32LE(20+json.length+rest.length,8);head.writeUInt32LE(json.length,12);head.writeUInt32LE(0x4e4f534a,16);
  const out=Buffer.concat([head,json,rest]);return out.buffer.slice(out.byteOffset,out.byteOffset+out.length);
}
globalThis.self??=globalThis;
const parse=file=>new Promise((resolve,reject)=>{loader.parse(stripped(fs.readFileSync(path.join(assets,file))),'',resolve,reject);});
const bind={};
for(const [modelFile,label] of [['stormtrooper.glb','trooper'],['vader.glb','vader']]) {
  if(!fs.existsSync(path.join(assets,modelFile)))continue;
  let model;try{model=await parse(modelFile);}catch(e){warn(`three could not parse ${modelFile}: ${e.message}`);continue;}
  const nodeNames=new Set();model.scene.traverse(n=>nodeNames.add(n.name));
  for(const file of ['vader-animations.glb','hm-hero-reactions.glb']) {
    const gltf=await parse(file);
    let total=0,bound=0,moved=0,checked=0;
    for(const clip of gltf.animations) {
      for(const track of clip.tracks){total++;if(nodeNames.has(THREE.PropertyBinding.parseTrackName(track.name).nodeName))bound++;}
      if(clip.userData?.source===undefined)fail(`${file}/${clip.name}: extras not exposed as userData`);
    }
    for(const name of ['idle','strike1','choke-loop','saber-death-fwd','run-fwd']) {
      const clip=gltf.animations.find(c=>c.name===name);if(!clip)continue;
      const tracks=clip.tracks.filter(t=>nodeNames.has(THREE.PropertyBinding.parseTrackName(t.name).nodeName));
      const mixer=new THREE.AnimationMixer(model.scene),hips=model.scene.getObjectByName('LeftForeArm');
      const before=hips.quaternion.clone();mixer.clipAction(new THREE.AnimationClip(clip.name,clip.duration,tracks)).play();mixer.update(clip.duration*0.4);
      checked++;if(hips.quaternion.angleTo(before)>1e-4)moved++;mixer.stopAllAction();hips.quaternion.copy(before);
    }
    bind[`${label}:${file}`]={tracks:total,bound,fraction:+(bound/total).toFixed(4),mixerMovedBone:`${moved}/${checked}`};
    if(label==='trooper'&&bound!==total)fail(`${file}: ${total-bound} tracks do not bind on stormtrooper.glb`);
    if(moved!==checked)fail(`${file}: mixer did not move LeftForeArm on ${label}`);
  }
}

const result={ok:failures.length===0,failures,warnings,bind,summary};
const outFile=path.join(root,'exports/characters/vader-animation/sanity-report.json');
fs.writeFileSync(outFile,JSON.stringify(result,null,1));
console.log(JSON.stringify({ok:result.ok,failures:failures.slice(0,40),warnings:warnings.slice(0,40),bind,
  files:Object.fromEntries(Object.entries(summary).map(([k,v])=>[k,{animations:v.animations,bytes:v.bytes,maxQuaternionNormError:v.maxQuaternionNormError,maxBodyBoneLengthChange:v.maxBodyBoneLengthChange}]))},null,1));
console.log('report:',outFile);
process.exitCode=failures.length?1:0;
