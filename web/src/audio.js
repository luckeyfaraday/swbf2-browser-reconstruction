export function chooseVariant(count,history,random=Math.random,historyCount=3) {
  if(!count)return -1;
  const recent=Math.min(historyCount,count-1),excluded=new Set(recent?history.slice(-recent):[]);
  const candidates=Array.from({length:count},(_,index)=>index).filter(index=>!excluded.has(index));
  const selected=candidates[Math.min(candidates.length-1,Math.floor(random()*candidates.length))];
  history.push(selected);if(history.length>historyCount)history.shift();return selected;
}

export async function loadGameAudio(document,{muted=false,baseUrl='/assets/audio.json'}={}) {
  const descriptors=document?.primaryShot;
  if(!descriptors?.variants?.length)return null;
  const decoder=new OfflineAudioContext(2,1,48000),buffers=[];
  for(const variant of descriptors.variants) {
    const url=new URL(variant,new URL(baseUrl,location.href));
    const response=await fetch(url);if(!response.ok)throw new Error(`Source firing audio HTTP${response.status}: ${url}`);
    buffers.push(await decoder.decodeAudioData(await response.arrayBuffer()));
  }
  let context=null,master=null,shots=0;const history=[],voices=new Set();
  const provenance={source:document.provenance,sourceAmplitude:descriptors.sourceAmplitude,sourcePitch:descriptors.sourcePitch,historyCount:descriptors.historyCount,
    limitations:['Only the source close-shot layer is rendered; native reflections, distant layers and mixer processing remain missing.','Browser HRTF and inverse-distance attenuation are provisional; the native attenuation curve is not reconstructed.','Master gain0.35 is a browser playback choice, not a recovered source mix.']};
  return {
    async resume() {
      if(muted)return;
      if(!context){context=new AudioContext();master=context.createGain();master.gain.value=.35;master.connect(context.destination);}
      await context.resume();
    },
    listener(position,forward) {
      if(!context)return;const listener=context.listener;
      listener.positionX.value=position.x;listener.positionY.value=position.y;listener.positionZ.value=position.z;
      listener.forwardX.value=forward.x;listener.forwardY.value=forward.y;listener.forwardZ.value=forward.z;
      listener.upX.value=0;listener.upY.value=1;listener.upZ.value=0;
    },
    shot(position,random=Math.random) {
      shots++;if(muted||context?.state!=='running')return;
      if(voices.size>=24)voices.values().next().value.stop();
      const index=chooseVariant(buffers.length,history,random,descriptors.historyCount??3),source=context.createBufferSource(),gain=context.createGain(),panner=context.createPanner();
      source.buffer=buffers[index];source.playbackRate.value=descriptors.sourcePitch??1;gain.gain.value=descriptors.sourceAmplitude??1;
      panner.panningModel='HRTF';panner.distanceModel='inverse';panner.refDistance=2;panner.maxDistance=90;panner.rolloffFactor=1;
      panner.positionX.value=position.x;panner.positionY.value=position.y;panner.positionZ.value=position.z;
      source.connect(gain);gain.connect(panner);panner.connect(master);voices.add(source);
      source.onended=()=>{voices.delete(source);source.disconnect();gain.disconnect();panner.disconnect();};source.start();
    },
    snapshot:()=>({loaded:buffers.length,muted,contextState:context?.state??'not-started',shots,voices:voices.size,buffers:buffers.map(buffer=>({duration:buffer.duration,sampleRate:buffer.sampleRate,channels:buffer.numberOfChannels})),provenance}),
  };
}

export async function loadWeaponAudio(document,weapons,{muted=false,primaryId='primary'}={}) {
  const banks=new Map(),fallback=await loadGameAudio(document,{muted});
  if(fallback)banks.set('primary',fallback);
  for(const [id,weapon]of weapons)if(weapon.audioDocument) {
    const bank=await loadGameAudio(weapon.audioDocument,{muted,baseUrl:weapon.audioUrl});if(bank)banks.set(id,bank);
  }
  if(!banks.size)return null;
  return {
    resume:()=>Promise.all([...banks.values()].map(bank=>bank.resume())),
    listener(position,forward){for(const bank of banks.values())bank.listener(position,forward);},
    shot(position,random,id=primaryId){(banks.get(id)??fallback)?.shot(position,random);},
    snapshot:()=>({...((banks.get(primaryId)??fallback)?.snapshot()??{}),primaryId,weapons:Object.fromEntries([...banks].map(([id,bank])=>[id,bank.snapshot()]))}),
  };
}
