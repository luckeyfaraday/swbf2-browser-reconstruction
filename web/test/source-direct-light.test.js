import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {sourcePunctualDistanceAttenuation as distance, sourcePunctualConeParameters as cone,
  sourcePunctualAngleAttenuation as angle, sourcePunctualBrdf as brdf, sourceIesUv,
  SOURCE_DIRECT_LIGHT_GLSL, SOURCE_DIRECT_LIGHT_POLICY} from '../src/source-direct-light.js';

const near = (a,b,e=2e-12) => assert.ok(Math.abs(a-b)<=e*Math.max(1,Math.abs(a),Math.abs(b)),`${a} vs ${b}`);
let seed=0x417548;
const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);

test('distance attenuation retains cutoff, source offset and native close-range clamp',()=>{
  near(distance(0,1/100,0),1/Math.fround(.0001));
  near(distance(0,1/100,160),1/160);
  near(distance(25,1/100,40),.9375**2/65);
  assert.equal(distance(100,1/100,0),0);
  assert.equal(distance(200,1/100,0),0);
  assert.equal(distance(4,0,0),.25);
  // At one metre, the map's largest source offset reduces intensity 161x.
  near(distance(1,0,0)/distance(1,0,160),161);
});

test('native cosine ramp differs from smoothstep and handles reversed angles',()=>{
  const c=cone(0,90),middle=(1+Math.cos(Math.PI/4))/2;
  near(angle(1,c.scale,c.offset),1);
  near(angle(Math.cos(Math.PI/4),c.scale,c.offset),0);
  near(angle(middle,c.scale,c.offset),.25);
  const reversed=cone(76.466,52.276);
  near(reversed.scale,1/Math.fround(.001));
  assert.equal(angle(1,reversed.scale,reversed.offset),1);
  near(angle(Math.cos(52.276*Math.PI/360),reversed.scale,reversed.offset),0);
});

// Independent scalar register transcription of native type2 DXBC's ordinary
// BRDF block, using the disassembly's variable reuse and operation order.
function opcodeBrdf(p) {
  const clamp=x=>Math.min(1,Math.max(0,x));
  const r3x=p.roughness, r3yzw=p.baseColor.map(v=>(1-p.metalness)*v);
  let r1w=p.reflectance*p.reflectance;
  const r4xyz=p.baseColor.map(v=>p.metalness*(v-r1w*.16)+r1w*.16);
  let r1z=clamp(r4xyz.reduce((s,v)=>s+v*.33,0)*50);
  r1w=r3x*r3x;
  const r5w=Math.abs(p.dotNV)+Math.fround(.00001),r7xyz=r4xyz.map(v=>r1z-v);
  r1z=Math.max(r1w,Math.fround(.002));r1z*=r1z;
  r1w=-r5w*r1z+r5w;r1w=r1w*r5w+r1z;r1w=Math.sqrt(r1w);
  const r6w=r3x*Math.fround(-.33774834871292114)+1;
  let r7w=1-r5w,r8x=r7w*r7w;r8x*=r8x;r7w*=r8x;
  const r11x=clamp(p.dotNL);
  let r10x=clamp(p.dotLH),r10y=clamp(p.dotNH),r10z=1-r10x;
  let r11y=r10z*r10z;r11y*=r11y;r10z*=r11y;
  let r11yzw=r4xyz.map((v,i)=>r7xyz[i]*r10z+v);
  r10z=-r11x*r1z+r11x;r10z=r10z*r11x+r1z;r10z=Math.sqrt(r10z);
  r10z*=r5w;r10z=r11x*r1w+r10z;r10z=.5/r10z;
  let r12x=r10y*r1z-r10y;r10y=r12x*r10y+1;r10y*=r10y;
  r10y=r1z/r10y;r10y*=r10z;r11yzw=r11yzw.map(v=>v*r10y);
  r10x*=r10x;r10x=r10x*r3x+r10x*r3x;r10x=r3x*.5+r10x;
  r10y=1-r11x;r10z=r10y*r10y;r10z*=r10z;r10y*=r10z;
  r10x-=1;r10y=r10x*r10y+1;r10x=r10x*r7w+1;r10x*=r10y;r10x*=r6w;
  return {diffuse:r3yzw.map(v=>v*r10x*Math.fround(1/Math.PI)),
    specular:r11yzw.map(v=>v*Math.fround(1/Math.PI))};
}

test('native BRDF algebra matches independent scalar opcode order over 2000 cases',()=>{
  for(let n=0;n<2000;n++) {
    const p={baseColor:[random(),random(),random()],metalness:random(),reflectance:random(),
      roughness:random(),dotNV:2*random()-1,dotNL:random(),dotNH:random(),dotLH:random()};
    const a=brdf(p),b=opcodeBrdf(p);
    for(const k of ['diffuse','specular'])a[k].forEach((v,i)=>near(v,b[k][i],3e-10));
  }
});

test('BRDF preserves metallic diffuse zero and finite alpha at zero roughness',()=>{
  const p={baseColor:[.3,.4,.5],metalness:1,reflectance:.5,roughness:0,dotNV:0,dotNL:0,dotNH:1,dotLH:1};
  const result=brdf(p);assert.deepEqual(result.diffuse,[0,0,0]);
  assert.ok(result.specular.every(Number.isFinite));
});

test('IES coordinates use native quadrant approximation and equal-area latitude',()=>{
  for(let i=0;i<1000;i++) {
    const theta=(random()*2-1)*Math.PI,z=random()*2-1,s=Math.sqrt(1-z*z);
    const [u,v]=sourceIesUv([Math.cos(theta)*s,Math.sin(theta)*s,z]);
    near(u,theta/(2*Math.PI),2e-6);near(v,(z+1)/2);
  }
  assert.deepEqual(sourceIesUv([0,0,1]),[0,1]);
  assert.deepEqual(sourceIesUv([0,0,-1]),[0,0]);
});

test('selected map exact IES identity and payload remain source backed',()=>{
  const lights=JSON.parse(fs.readFileSync(new URL('../public/assets/source-lights.json',import.meta.url))).lights;
  const used=lights.filter(v=>v.properties.IESProfile);
  assert.equal(used.length,53);
  assert.ok(used.every(v=>v.properties.IESProfile.$external==='6ebdd766-34cc-11e7-ae3d-ae12865b6fab'));
  const ebx=JSON.parse(fs.readFileSync(new URL('../../exports/lighting/direct-ies/ebx/Lighting_Textures_T_Lamp_01__6ebdd766-34cc-11e7-ae3d-ae12865b6fab.json',import.meta.url)));
  assert.equal(ebx.asset.objects[0].SourceResource.$resource,'12614494969977180257');
  assert.equal(ebx.entry.type,'IesProfileAsset');
  const payload=fs.readFileSync(new URL('../../exports/lighting/direct-ies/raw/12614494969977180257.res',import.meta.url));
  assert.equal(payload.length,32804);assert.equal(payload.readUInt32LE(0),128);
  assert.equal(payload.readBigUInt64LE(12),32n);assert.equal(payload.readUInt32LE(32800),12);
  for(let y=0;y<128;y++)for(let x=1;x<128;x++)assert.equal(payload.readUInt16LE(32+2*(y*128+x)),payload.readUInt16LE(32+2*y*128));
});

test('helper identifies its separate recovered producer and remaining runtime limits',()=>{
  assert.equal(SOURCE_DIRECT_LIGHT_POLICY.producerEvidenceId,'BF2-NATIVE-DIRECT-PRODUCER-002');
  assert.match(SOURCE_DIRECT_LIGHT_POLICY.limitations,/per-view fades/);
  assert.match(SOURCE_DIRECT_LIGHT_GLSL,/bf2_punctualBrdf/);
  assert.match(SOURCE_DIRECT_LIGHT_GLSL,/bf2_iesUv/);
});
