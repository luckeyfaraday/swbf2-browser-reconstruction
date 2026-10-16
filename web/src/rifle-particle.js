import {DataUtils} from 'three';

// Algebra recovered from the selected original spawn/simulate compute shaders.
// This is an isolated particle kernel: callers must supply explicit emitter,
// effect parameters, simulation cadence and depth sampling. It does not infer
// those inputs from projectile gameplay or claim native scheduling parity.
const f=Math.fround, sat=x=>Math.max(0,Math.min(1,x));
const add=(a,b)=>a.map((x,i)=>f(x+b[i]));
const sub=(a,b)=>a.map((x,i)=>f(x-b[i]));
const scale=(a,b)=>a.map(x=>f(x*b));
const mad=(a,b,c)=>a.map((x,i)=>f(f(x*b)+c[i]));
const dot=(a,b)=>f(f(f(a[0]*b[0])+f(a[1]*b[1]))+f(a[2]*b[2]));
const length=a=>f(Math.sqrt(dot(a,a)));
const normal=a=>scale(a,f(1/Math.sqrt(dot(a,a))));
const cross=(a,b)=>[f(a[1]*b[2]-a[2]*b[1]),f(a[2]*b[0]-a[0]*b[2]),f(a[0]*b[1]-a[1]*b[0])];
const third=f(1/30);
const half=x=>DataUtils.fromHalfFloat(DataUtils.toHalfFloat(x));
const missing=v=>dot(sub(v,[1,1,1]),sub(v,[1,1,1]))<f(.0001);

export function decodeRifleEmitter(buffer,byteOffset=0) {
  const v=new DataView(buffer,byteOffset,912),read=offset=>v.getFloat32(offset,true);
  const vector=offset=>[read(offset),read(offset+4),read(offset+8)];
  return {axes:[[read(0),read(16),read(32)],[read(4),read(20),read(36)],[read(8),read(24),read(40)]].map(normal),
    position:[read(12),read(28),read(44)],age:read(192),life:read(204),
    length:read(276),lengthScale:read(320),randomMin:read(352),randomMax:read(356),
    defaultSpeed:read(368),mode:read(496),speed:read(784),fallback:vector(800),muzzle:vector(816)};
}

export function decodeRifleParticle(buffer,byteOffset=0) {
  const v=new DataView(buffer,byteOffset,88),read=offset=>v.getFloat32(offset,true);
  return {axes:[0,16,32].map(offset=>[read(offset),read(offset+4),read(offset+8)]),
    translation:[read(12),read(28),read(44)],position:[read(48),read(52),read(56)],life:read(60),
    packed:Array.from({length:12},(_,i)=>DataUtils.fromHalfFloat(v.getUint16(64+i*2,true)))};
}

export function encodeRifleParticle(particle) {
  const buffer=new ArrayBuffer(88),v=new DataView(buffer);
  particle.axes.forEach((axis,i)=>{axis.forEach((value,j)=>v.setFloat32(i*16+j*4,value,true));v.setFloat32(i*16+12,particle.translation[i],true);});
  particle.position.forEach((value,i)=>v.setFloat32(48+i*4,value,true));v.setFloat32(60,particle.life,true);
  particle.packed.forEach((value,i)=>v.setUint16(64+i*2,DataUtils.toHalfFloat(value),true));
  return buffer;
}

function origin(e) {
  let chosen=e.muzzle,fromFallback=false,valid=!missing(chosen);
  if(!valid){chosen=e.fallback;fromFallback=!missing(chosen);valid=fromFallback;if(!valid)chosen=e.position;}
  return {chosen,valid,fromFallback};
}
function speed(e){return Math.abs(f(e.speed-1))<f(.00001)?e.defaultSpeed:Math.abs(e.speed);}
export function rifleParticleRandom(time) {
  let value=(Math.trunc(f(f(time)*100))^0xa3c59ac3)>>>0;
  for(let i=0;i<3;i++){value=Math.imul(value,0x9e3779b9)>>>0;if(i<2)value=(value^(value>>>16))>>>0;}
  return f(f(value)*2.3283064365386963e-10);
}

export function spawnRifleParticle(e,{time,dt}) {
  const o=origin(e),velocity=speed(e),extent=Math.max(f(e.length*e.lengthScale),f(.01));
  const delta=sub(e.position,o.chosen),distanceSquared=dot(delta,delta);
  const direction=!o.fromFallback&&distanceSquared>=f(.1)?normal(delta):e.axes[1];
  const random=rifleParticleRandom(time),weight=sat(f(random*f(e.randomMax-e.randomMin)+e.randomMin));
  let position=mad(direction,f(extent*weight-f(velocity*f(dt))),o.chosen);
  const near=distanceSquared<f(.1);
  if(near)position=mad(direction,-(Math.abs(velocity)<f(.0001)?extent:f(velocity*third)),position);
  if(e.mode>4.5)position=[...e.position];
  return {axes:e.axes.map(axis=>[...axis]),translation:[...position],position,life:e.life,
    packed:[0,0,0,0,near?0:1,0,-1000,-1000,0,0,0,half(random)]};
}

/** depthVisibility(point) returns true when the original depth test says the
 * sample is occluded (projected Z < min four gathered reversed-depth texels).
 * Outside the native screen/depth bounds returns false. */
export function simulateRifleParticle(p,e,{dt,depthVisibility}) {
  if(typeof depthVisibility!=='function')throw new Error('Original rifle simulation needs an explicit depth sampler');
  if(p.life<=0)return {axes:[[0,0,0],[0,0,0],[0,0,0]],translation:[0,0,0],position:[0,0,0],life:0,packed:[...p.packed]};
  const [right,up,forward]=e.axes,scales=p.axes.map(length),o=origin(e);
  // The simulate shader retains the sentinel vector for its explicit mode3
  // override; only the spawn shader replaces missing endpoints with the emitter.
  if(!o.valid)o.chosen=e.muzzle;
  const extent=Math.max(f(e.length*e.lengthScale),f(.01));
  let velocity=speed(e);
  if(e.age<f(.04)) {
    const weight=sat(f(p.packed[11]*f(e.randomMax-e.randomMin)+e.randomMin));
    const ratio=f(f(extent*weight)/Math.max(f(velocity*third),f(.00001)));
    velocity=f(Math.max(f(1-ratio),0)*velocity);
  }
  let direction=up;
  if(!o.fromFallback&&o.valid&&p.packed[4]>.5) {
    const muzzleDirection=normal(sub(e.position,e.muzzle));
    direction=mad(sub(up,muzzleDirection),sat(f(f(e.age-third)*30)),muzzleDirection);
  }
  const candidate=mad(direction,f(velocity*f(dt)),p.translation);
  const signedDistance=dot(sub(candidate,e.position),up);
  const convergence=signedDistance>0?0:sat(f(f(e.age-third)*f(29.999998)));
  // Preserve the exact endpoint when the saturated convergence reaches one.
  // A separately rounded JS subtract/add can leave one ULP ahead of the
  // emitter and incorrectly exclude the zero-distance visibility sample.
  let position=convergence===1?[...e.position]:mad(sub(e.position,candidate),convergence,candidate);
  let lower=dot(sub(position,e.position),up);
  if(lower>0)position=mad(up,lower,e.position);
  let upper=o.valid?dot(sub(position,o.chosen),up):Math.abs(velocity)<f(.001)?-1000:dot(sub(position,candidate),up);
  const motion=sub(position,p.position);
  direction=dot(motion,motion)>f(.01)?normal(motion):up;
  if(o.valid) {
    const mix=sat(f(f(upper-extent)/f(extent*3)));
    const muzzleDirection=normal(sub(position,o.chosen));
    direction=normal(mad(sub(direction,muzzleDirection),mix,muzzleDirection));
  }
  let translation=e.mode<4.5?candidate:[...p.translation],xAxis,zAxis;
  if(Math.abs(e.defaultSpeed)>f(.01)) {
    position=candidate;xAxis=right;direction=up;zAxis=forward;upper=signedDistance;lower=-1000;
  } else {
    xAxis=normal(cross(forward,direction));zAxis=normal(cross(direction,xAxis));
  }
  if((e.age>f(1/3)&&Math.abs(velocity)<f(.00001))||e.mode>.5) {
    position=e.position;xAxis=right;direction=up;zAxis=forward;lower=-1000;upper=1000;
  }
  if(e.mode>1.5)position=candidate;
  if(e.mode>2.5)position=o.chosen;
  if(e.mode>3.5)position=e.fallback;
  if(e.mode>4.5) {
    upper=dot(sub(e.position,translation),up);position=e.position;xAxis=right;direction=up;zAxis=forward;lower=-1000;
  }
  let visibility=1;
  for(let sample=0,offset=0;sample<6;sample++,offset=f(offset-f(.2))) {
    const displacement=f(e.length*offset);
    if(upper<Math.abs(displacement)||Math.abs(displacement)<lower){visibility=f(visibility-f(.3));continue;}
    if(depthVisibility(mad(direction,displacement,position)))visibility=f(visibility-f(1/6));
  }
  visibility=f(Math.max(visibility,0)*sat(f(1-f(lower/e.length))));
  const packed=[...p.packed];packed[3]=half(visibility);packed[6]=half(upper);packed[7]=half(lower);
  return {axes:[scale(xAxis,scales[0]),scale(direction,scales[1]),scale(zAxis,scales[2])],translation:[...translation],position:[...position],life:p.life,packed};
}

export const RIFLE_PARTICLE_POLICY=Object.freeze({evidenceId:'BF2-RIFLE-PARTICLE-WARP-001',
  shaders:['3157d77810d440d184e7b91eb862d890daf6ec4484204698551ebc20b6ac3f27','6ac231cf62540832075917e949f625c79649fbd494b3c70f954c51d39e4bd5ed'],
  observed:'88-byte particle, normalized emitter basis, original sentinel/fallback branches, time hash, muzzle convergence, six depth samples and binary16 auxiliary storage.',
  limitations:'Explicit inputs only. Runtime emitter/effect parameter binding, reversed-depth resource/cadence, effect stops and native game frame remain unverified. JavaScript float32 operation lowering is numerically checked, not bit-exact GPU emulation.'});
