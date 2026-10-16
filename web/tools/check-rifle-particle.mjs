import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodeRifleEmitter,decodeRifleParticle,spawnRifleParticle,simulateRifleParticle} from '../src/rifle-particle.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const dir=path.join(root,'exports/rifle-trail/particle-warp');
export function compareRifleParticleReference() {
const raw=fs.readFileSync(path.join(dir,'input.bin')),out=fs.readFileSync(path.join(dir,'output.bin'));
const ab=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.length),input=ab(raw),output=ab(out);
const flatten=p=>[...p.axes.flat(),...p.translation,...p.position,p.life,...p.packed];
let offset=16,maxFloat=0,maxHalf=0,differences=[],boundaryDifferences=[];
const cases=raw.readInt32LE(4),steps=raw.readInt32LE(8);
for(let c=0;c<cases;c++){
 const depth=raw.readFloatLE(offset);offset+=4;let emitter=decodeRifleEmitter(input,offset);offset+=912;
 let particle=spawnRifleParticle(emitter,{time:raw.readFloatLE(offset+8),dt:raw.readFloatLE(offset+12)});offset+=128;
 for(let step=0;step<=steps;step++){
  if(step){
   emitter=decodeRifleEmitter(input,offset);offset+=912;const dt=raw.readFloatLE(offset+4);offset+=624;
   particle=simulateRifleParticle(particle,emitter,{dt,depthVisibility:p=>p[0]>=-1&&p[0]<=1&&p[1]>=-1&&p[1]<=1&&p[2]<=1&&p[2]<depth});
  }
  const reference=decodeRifleParticle(output,(c*(steps+1)+step)*88),a=flatten(particle),b=flatten(reference);
  a.forEach((v,i)=>{
   if(!Number.isFinite(v))throw new Error(`Nonfinite case${c} step${step} channel${i}`);
   const error=Math.abs(v-b[i]);if(i<16)maxFloat=Math.max(maxFloat,error);else maxHalf=Math.max(maxHalf,error);
   if(error>(i<16?.0001:Math.max(.0001,Math.abs(b[i])*.001))) {
    const result={case:c,step,channel:i,got:v,want:b[i],error,clip:[particle.packed[6],particle.packed[7]],referenceClip:reference.packed.slice(6,8)};
    // The native test is strict: one positive float ULP at the emitter plane
    // excludes the zero-distance sample and subtracts exactly0.3. Binary16 can
    // erase that positive clip value. Report this discontinuity separately;
    // never describe these visibility results as bit-exact WARP agreement.
    const atEmitter=Math.hypot(...reference.position.map((x,j)=>x-emitter.position[j]))<.0001;
    const boundary=i===19&&atEmitter&&Math.abs(reference.packed[7])<.0001&&Math.abs(particle.packed[7])<.0001&&Math.abs(error-.30029296875)<.00001;
    (boundary?boundaryDifferences:differences).push(result);
   }
  });
 }
}
return {evidenceId:'BF2-RIFLE-PARTICLE-WARP-001',cases,steps,samples:cases*(steps+1),maxFloat,maxHalf,boundaryDifferences,differences};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
const report=compareRifleParticleReference();
fs.writeFileSync(path.join(dir,'browser-comparison.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,differences:report.differences.slice(0,20)},null,2));

if(report.differences.length)process.exitCode=1;
}
