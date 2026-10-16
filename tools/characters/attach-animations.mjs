import fs from 'node:fs';

// Converts source raw ANT tracks to glTF animation tracks, preserving every
// existing scene/skin/material. Use after merging textured components.
const [input,sourcePath,output=input]=process.argv.slice(2);
const bytes=fs.readFileSync(input),jl=bytes.readUInt32LE(12),doc=JSON.parse(bytes.subarray(20,20+jl)),begin=28+jl;
const original=bytes.subarray(begin,begin+bytes.readUInt32LE(begin-8));
const raw=JSON.parse(fs.readFileSync(sourcePath));
if(doc.animations?.length)throw new Error('Animation already attached; regenerate from textured components before rerunning.');
const blocks=[original];let length=original.length;
function accessor(values,size){
 const padding=(4-length%4)%4;if(padding){blocks.push(Buffer.alloc(padding));length+=padding;}
 const floats=new Float32Array(values),data=Buffer.from(floats.buffer),view=doc.bufferViews.length;
 doc.bufferViews.push({buffer:0,byteOffset:length,byteLength:data.length});blocks.push(data);length+=data.length;
 const idx=doc.accessors.length,acc={bufferView:view,componentType:5126,count:values.length/size,type:size===1?'SCALAR':`VEC${size}`};
 if(size===1){acc.min=[Math.min(...values)];acc.max=[Math.max(...values)];}doc.accessors.push(acc);return idx;
}
const bones=new Map();doc.nodes.forEach((node,i)=>{if(node.extras?.sourceBoneIndex!==undefined){if(!bones.has(node.name))bones.set(node.name,[]);bones.get(node.name).push(i);}});
const report={input,sourceEvidence:raw.evidenceId,clips:[]};doc.animations=[];
for(const clip of raw.clips){
 if(clip.additive)continue; // The source additive ordering/graph still needs evidence.
 const animation={name:clip.name,samplers:[],channels:[],extras:{source:clip.sourceName,sourceKey:clip.sourceAnimationKey,controller:clip.controller,rootMotionRemoved:true}};
 const retained=new Map(),skipped=[],duplicates=[];
 for(const track of clip.tracks){
  const key=track.bone+'.'+track.property;
  if(track.property==='scalar'||!bones.has(track.bone)||(track.bone==='AITrajectory'&&track.property==='translation')){skipped.push(key);continue;}
  if(retained.has(key)){
   const other=retained.get(key);if(other.values.length!==track.values.length||other.values.some((v,i)=>v.some((x,j)=>Math.abs(x-track.values[i][j])>0.000001)))throw new Error(`Conflicting source DOFs: ${key}`);
   duplicates.push(key);continue;
  }retained.set(key,track);
 }
 for(const track of retained.values()){
  const times=track.constant?[0,Math.max(clip.duration,1)]:clip.times;
  const values=track.constant?[...track.values[0],...track.values[0]]:track.values.flat();
  // Keep quaternion hemispheres continuous for interpolation. This does not
  // change any source orientation; q and -q represent the same rotation.
  if(track.property==='rotation')for(let i=4;i<values.length;i+=4){let dot=0;for(let n=0;n<4;n++)dot+=values[i+n]*values[i-4+n];if(dot<0)for(let n=0;n<4;n++)values[i+n]*=-1;}
  const sampler=animation.samplers.length;animation.samplers.push({input:accessor(times,1),output:accessor(values,track.property==='rotation'?4:3),interpolation:'LINEAR'});
  for(const node of bones.get(track.bone))animation.channels.push({sampler,target:{node,path:track.property}});
 }
 animation.extras.skippedChannels=skipped;animation.extras.deduplicatedIdenticalChannels=duplicates;
 doc.animations.push(animation);report.clips.push({name:animation.name,source:clip.sourceName,tracks:retained.size,nodeChannels:animation.channels.length,skipped,duplicates});
}
doc.extras={...doc.extras,animationEvidence:raw.evidenceId,animationsRecovered:['rifle-stand','rifle-run'],animationLimitations:['Raw source samples bound to matching skeletal bones. Source AI trajectory translation removed for in-place runtime control.','Controller TimeScale and gameplay blend graph are unverified; emitted time uses keyTicks/FPS.','Procedural rig features/IK, additive idle, fire and death are not yet applied.']};
const padding=(4-length%4)%4;if(padding){blocks.push(Buffer.alloc(padding));length+=padding;}
doc.buffers[0].byteLength=length;const json=Buffer.from(JSON.stringify(doc)),jp=Buffer.alloc((json.length+3)&~3,32);json.copy(jp);
const head=Buffer.alloc(20);head.writeUInt32LE(0x46546c67);head.writeUInt32LE(2,4);head.writeUInt32LE(28+jp.length+length,8);head.writeUInt32LE(jp.length,12);head.writeUInt32LE(0x4e4f534a,16);
const bh=Buffer.alloc(8);bh.writeUInt32LE(length);bh.writeUInt32LE(0x004e4942,4);fs.writeFileSync(output,Buffer.concat([head,jp,bh,...blocks]));
fs.writeFileSync(output+'.animation.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
