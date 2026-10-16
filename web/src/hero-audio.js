import {chooseVariant} from './audio.js';

// Source hero sounds (decoded SoundWave assets listed in assets/audio/vader.json).
// Gains and pitches are the source amplitudes/pitches where recovered; the
// native sound graph (layers, distance crossfades, mixers, ducking) is not
// reconstructed. Spatialisation and the master gain are browser choices.

// Runtime event -> manifest ids, first present wins.
export const HERO_SOUND_EVENTS=Object.freeze({
  'saber-ignite':['saber-ignite'],'saber-retract':['saber-retract'],
  'saber-hum':['saber-hum'],'saber-hum-intense':['saber-hum-intense','saber-hum'],
  'saber-swing':['saber-swing'],'saber-swing-fast':['saber-swing-fast','saber-swing'],
  'saber-hit':['saber-hit'],'saber-clash':['saber-clash'],deflect:['deflect'],
  breath:['breath-normal'],'breath-fast':['breath-fast','breath-normal'],'breath-lowhealth':['breath-lowhealth','breath-normal'],
  'effort-attack':['effort-attack'],'effort-hit':['effort-hit'],'effort-landing':['effort-landing'],
  'choke-start':['choke-start'],'choke-loop':['choke-loop'],'choke-bonecrack':['choke-bonecrack'],'choke-end':['choke-end'],
  'rage-start':['rage-start'],'rage-loop':['rage-loop'],'rage-end':['rage-end','choke-end'],
  throw:['throw'],'throw-spin':['throw-spin'],'throw-return':['throw-return'],catch:['catch'],
  death:['death'],'vo-intro':['vo-intro'],'vo-ability1':['vo-ability1'],'vo-ability2':['vo-ability2'],'vo-ability3':['vo-ability3'],
});
// Sources without a recovered amplitude (foley, efforts, VO) play at this level.
const UNRESOLVED_GAIN=.5;

function urlsOf(entry) {
  if(Array.isArray(entry.variations)&&entry.variations.length)return entry.variations.map(v=>typeof v==='string'?v:v.url).filter(Boolean);
  return entry.url?[entry.url]:[];
}

export async function loadHeroAudio(document,{baseUrl='/assets/audio/vader.json',muted=false}={}) {
  const entries=document?.sounds??document?.ids??document;
  if(!entries||typeof entries!=='object')return null;
  const decoder=new OfflineAudioContext(2,1,48000),banks=new Map(),failures=[];
  const wanted=new Set(Object.values(HERO_SOUND_EVENTS).flat());
  await Promise.all(Object.entries(entries).map(async([id,entry])=>{
    if(!entry||typeof entry!=='object'||!wanted.has(id))return;
    const buffers=[];
    for(const url of urlsOf(entry)) {
      try{const response=await fetch(new URL(url,new URL(baseUrl,location.href)));if(!response.ok)throw new Error(`HTTP ${response.status}`);buffers.push(await decoder.decodeAudioData(await response.arrayBuffer()));}
      catch(error){failures.push(`${id}: ${error.message}`);}
    }
    if(buffers.length)banks.set(id,{buffers,gain:entry.gain??entry.amplitude??UNRESOLVED_GAIN,pitch:entry.pitch??1,loop:!!entry.loop,history:[]});
  }));
  const resolve=event=>{for(const id of HERO_SOUND_EVENTS[event]??[event])if(banks.has(id))return banks.get(id);return null;};
  let context=null,master=null,plays=0;const loops=new Map(),voices=new Set();
  const ensure=()=>{
    if(muted)return null;
    if(!context){context=new AudioContext();master=context.createGain();master.gain.value=.4;master.connect(context.destination);}
    if(context.state==='suspended')context.resume();
    return context.state==='running'?context:null;
  };
  const voice=(bank,position,{random=Math.random,loop=false,gain=1}={})=>{
    const ctx=ensure();if(!ctx)return null;
    if(voices.size>=20){const oldest=voices.values().next().value;try{oldest.source.stop();}catch{}}
    const index=chooseVariant(bank.buffers.length,bank.history,random,Math.min(3,bank.buffers.length-1));
    const source=ctx.createBufferSource(),amp=ctx.createGain(),panner=ctx.createPanner();
    source.buffer=bank.buffers[Math.max(0,index)];source.loop=loop;source.playbackRate.value=bank.pitch;amp.gain.value=bank.gain*gain;
    panner.panningModel='HRTF';panner.distanceModel='inverse';panner.refDistance=2;panner.maxDistance=60;panner.rolloffFactor=1;
    if(position){panner.positionX.value=position.x;panner.positionY.value=position.y;panner.positionZ.value=position.z;}
    source.connect(amp);amp.connect(panner);panner.connect(master);
    const entry={source,amp,panner};voices.add(entry);
    source.onended=()=>{voices.delete(entry);source.disconnect();amp.disconnect();panner.disconnect();};
    source.start();plays++;return entry;
  };
  return {
    resume:()=>ensure(),
    has:event=>!!resolve(event),
    listener(position,forward) {
      if(!context)return;const l=context.listener;
      l.positionX.value=position.x;l.positionY.value=position.y;l.positionZ.value=position.z;
      l.forwardX.value=forward.x;l.forwardY.value=forward.y;l.forwardZ.value=forward.z;l.upX.value=0;l.upY.value=1;l.upZ.value=0;
    },
    play(event,position,options={}){const bank=resolve(event);return bank?voice(bank,position,options):null;},
    loop(event,position,options={}) {
      if(loops.has(event))return loops.get(event);
      const bank=resolve(event);if(!bank)return null;
      const entry=voice(bank,position,{...options,loop:true});if(entry)loops.set(event,entry);return entry;
    },
    moveLoop(event,position){const entry=loops.get(event);if(entry&&position){entry.panner.positionX.value=position.x;entry.panner.positionY.value=position.y;entry.panner.positionZ.value=position.z;}},
    stopLoop(event){const entry=loops.get(event);if(entry){try{entry.source.stop();}catch{}loops.delete(event);}},
    stopAll(){for(const event of [...loops.keys()])this.stopLoop(event);},
    snapshot:()=>({banks:[...banks.keys()],failures,plays,loops:[...loops.keys()],contextState:context?.state??'not-started',voices:voices.size}),
  };
}
