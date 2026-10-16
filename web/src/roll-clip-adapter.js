import * as THREE from 'three';

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

function interval(times,time) {
  let low=0,high=times.length-1;
  while(low<high){const mid=(low+high)>>>1;if(times[mid]<time)low=mid+1;else high=mid;}
  const upper=low,lower=Math.max(0,upper-1);
  const alpha=upper===lower?0:clamp((time-times[lower])/(times[upper]-times[lower]),0,1);
  return {lower,upper,alpha};
}

function sampleTrack(track,frames,frame) {
  if(track.constant)return track.values[0].slice();
  const {lower,upper,alpha}=interval(frames,frame),a=track.values[lower],b=track.values[upper];
  if(track.property==='rotation')return new THREE.Quaternion().fromArray(a).normalize().slerp(new THREE.Quaternion().fromArray(b).normalize(),alpha).toArray();
  return a.map((value,index)=>value+(b[index]-value)*alpha);
}

/** Source-local displacement only. Callers must transform axes and collide movement. */
export function sampleRollTrajectory(clip,graphTick) {
  if(!Number.isFinite(graphTick))throw new TypeError('graphTick must be finite');
  const {times,translations}=clip.trajectory;
  const {lower,upper,alpha}=interval(times,clamp(graphTick,times[0],times.at(-1)));
  return translations[lower].map((value,index)=>value+(translations[upper][index]-value)*alpha);
}

/**
 * Bind recovered body tracks to every matching source bone in a merged actor.
 * A tick rate is required: the recovered source does not establish seconds.
 * The trim/TimeScale mapping is a documented inference in roll-clips.json.
 */
export function createRollAnimationClip(model,source,{graphTicksPerSecond}={}) {
  if(!Number.isFinite(graphTicksPerSecond)||graphTicksPerSecond<=0)throw new TypeError('An explicit positive graphTicksPerSecond is required');
  const duration=source.lengthTicks/graphTicksPerSecond,bones=new Map();
  model.traverse(node=>{
    if(node.userData?.sourceBoneIndex===undefined)return;
    // Mounted weapon bones sit in their own rig under a non-bone wrapper, itself
    // attached to an actor bone. Reference/index 0 is not always a rig ancestor.
    // Applying humanoid samples there would animate the attachment twice.
    let leftSourceRig=false;
    for(let parent=node.parent;parent&&parent!==model;parent=parent.parent) {
      if(parent.userData?.sourceBoneIndex===undefined)leftSourceRig=true;
      else if(leftSourceRig)return;
    }
    // GLTFLoader uniquifies component bones (Hips_1, Hips_2, ...), while
    // preserving the original source name in userData.name.
    const sourceName=node.userData.name??node.name;
    if(!bones.has(sourceName))bones.set(sourceName,[]);
    bones.get(sourceName).push(node);
  });
  const {trimOffset,timeScale}=source.sourceTimeMapping;
  const first=trimOffset,last=trimOffset+source.lengthTicks*timeScale;
  const frames=[first,...source.sampleFrames.filter(frame=>frame>first&&frame<last),last];
  const times=frames.map(frame=>(frame-first)/timeScale/graphTicksPerSecond);
  const tracks=[],retained=new Map(),skipped=[],duplicates=[];
  for(const track of source.tracks) {
    const key=`${track.bone}.${track.property}`;
    if(track.property==='scalar'||!bones.has(track.bone)||(track.bone==='AITrajectory'&&track.property==='translation')){skipped.push(key);continue;}
    const previous=retained.get(key);
    if(previous) {
      if(previous.values.length!==track.values.length||previous.values.some((row,i)=>row.some((value,j)=>Math.abs(value-track.values[i][j])>1e-6)))throw Error(`Conflicting source bone DOFs: ${key}`);
      duplicates.push(key);continue;
    }
    retained.set(key,track);
    const values=frames.flatMap(frame=>sampleTrack(track,source.sampleFrames,frame));
    if(track.property==='rotation')for(let i=4;i<values.length;i+=4) {
      let dot=0;for(let n=0;n<4;n++)dot+=values[i+n]*values[i-4+n];
      if(dot<0)for(let n=0;n<4;n++)values[i+n]*=-1;
    }
    for(const bone of bones.get(track.bone)) {
      const rotation=track.property==='rotation';
      const Track=rotation?THREE.QuaternionKeyframeTrack:THREE.VectorKeyframeTrack;
      // Match GLTFLoader's track paths, so idle/run/roll share PropertyMixers
      // and crossfades blend rather than independently overwrite a property.
      tracks.push(new Track(`${bone.name||bone.uuid}.${rotation?'quaternion':'position'}`,times,values));
    }
  }
  const clip=new THREE.AnimationClip(source.name,duration,tracks);
  const report={sourceAnimationKey:source.sourceAnimationKey,sourceClipId:source.sourceClipId,graphTicksPerSecond,
    timingEvidence:'caller-selected tick rate; source trim/scale mapping inferred',rootTranslationRemoved:true,
    sourceTracks:retained.size,boundTracks:tracks.length,skipped,duplicates};
  return {clip,report};
}
