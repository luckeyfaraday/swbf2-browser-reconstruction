import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {sourceDirectEmitter, sourceDirectCone, sourceDirectRadiometry,
  sourceDirectLightId, sourcePunctualLightConfig, prepareSourcePunctualLights} from '../src/source-direct-light-config.js';

const json = path => JSON.parse(fs.readFileSync(new URL(path, import.meta.url)));
const document = json('../public/assets/source-lights.json');
const ies = json('../public/assets/lighting/source-ies.json');
const evidence = json('../../exports/lighting/direct-producer-evidence.json');
const near = (a,b,tolerance=2e-6) => assert.ok(Math.abs(a-b) <= tolerance*Math.max(1,Math.abs(b)), `${a} != ${b}`);
const clone = value => structuredClone(value);

test('selected map eligibility matches independently extracted native evidence and preserves identities', () => {
  const bytes = fs.readFileSync(new URL('../public/assets/source-lights.json', import.meta.url));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), evidence.sourceLightsSha256);
  const result = prepareSourcePunctualLights(document, ies);
  assert.equal(result.lights.length, 217);
  assert.equal(result.lights.filter(x=>x.type==='point').length, 177);
  assert.equal(result.lights.filter(x=>x.type==='spot').length, 40);
  assert.equal(result.lights.filter(x=>x.ies).length, 53);
  assert.deepEqual(result.lights.map(x=>x.id), evidence.eligibleIdentities);
  assert.equal(new Set([...result.lights,...result.excluded].map(x=>x.id)).size, document.lights.length);
  assert.equal(prepareSourcePunctualLights(document, ies, {allowPropertyOverrides:true}).lights.length, 266);
  assert.deepEqual(Object.fromEntries(Object.entries(evidence.classificationCounts).filter(([k])=>k!=='supported')),
    result.excluded.reduce((counts,x)=>(counts[x.reason]=(counts[x.reason]??0)+1,counts),{}));
});

test('source field bindings retain raw matrix columns, offset, radius and channel switches', () => {
  const result=prepareSourcePunctualLights(document,ies), byId=new Map(document.lights.map(x=>[sourceDirectLightId(x),x]));
  for(const config of result.lights) {
    const source=byId.get(config.id),p=source.properties,m=source.matrix;
    assert.deepEqual(config.position,m.slice(12,15));
    assert.deepEqual(config.matrixLeft,m.slice(0,3));assert.deepEqual(config.matrixUp,m.slice(4,7));assert.deepEqual(config.matrixForward,m.slice(8,11));
    assert.equal(config.attenuationOffset,Math.fround(p.AttenuationOffset));
    near(config.inverseRadiusSquared,1/p.AttenuationRadius**2);
    assert.equal(config.affectDiffuse,p.AffectDiffuse);assert.equal(config.affectSpecular,p.AffectSpecular);
    assert.equal(config.intensity,1);
  }
  assert.ok(result.lights.some(x=>x.attenuationOffset===160));
});

test('all217 radiometric colors agree with independent original RES header and source unit equations', () => {
  const resource=fs.readFileSync(new URL('../../exports/lighting/direct-ies/raw/12614494969977180257.res',import.meta.url));
  const header4=resource.readFloatLE(4),header8=resource.readFloatLE(8);
  assert.equal(header4,ies.sourceHeaderScalars.offset4);assert.equal(header8,ies.sourceHeaderScalars.offset8);
  for(const light of document.lights) {
    const config=sourcePunctualLightConfig(light,ies);if(!config.supported)continue;
    const p=light.properties;
    const scalar=p.IESProfile?header4*p.IESMultiplier:p.Intensity/(config.type==='point'?4*Math.PI:Math.PI);
    for(const [i,axis]of ['x','y','z'].entries())near(config.color[i],p.Color[axis]*scalar*p.Dimmer);
  }
});

test('native radius/unit classification precedes IES and keeps finite emitters out of punctual shading', () => {
  const base=clone(document.lights.find(x=>x.properties.IESProfile).properties);
  assert.equal(sourceDirectEmitter(base).punctual,true);
  base.LightUnit={value:1};let emitter=sourceDirectEmitter(base);
  assert.equal(emitter.punctual,false);assert.equal(emitter.radius,Math.fround(.01));
  near(emitter.area,4*Math.PI*.01**2);
  const disc={...base,$type:'FrostySdk.Ebx.PbrSpotLightEntityData',DiscRadius:2.379,LightUnit:{value:0}};
  emitter=sourceDirectEmitter(disc);assert.equal(emitter.punctual,false);near(emitter.area,Math.PI*2.379**2);
  const radiometry=sourceDirectRadiometry(disc,emitter);near(radiometry.scalar,disc.Intensity/(Math.PI**2*2.379**2));
  const areas=document.lights.filter(x=>x.properties.DiscRadius>0);
  assert.equal(areas.length,4);
  for(const source of areas)assert.equal(sourcePunctualLightConfig(source,ies).reason,'finite-area-emitter');
});

test('IES non-mask ignores ordinary intensity but native visibility gate still precedes IES conversion', () => {
  const light=clone(document.lights.find(x=>x.properties.IESProfile)),p=light.properties;
  const original=sourcePunctualLightConfig(light,ies);p.Intensity*=17;
  assert.deepEqual(sourcePunctualLightConfig(light,ies).color,original.color);
  p.Intensity=0;assert.equal(sourcePunctualLightConfig(light,ies).reason,'native-intensity-gate');
  p.Intensity=1200;p.UseIESProfileAsMask=true;
  const a=sourceDirectRadiometry(p,sourceDirectEmitter(p),ies.sourceHeaderScalars);
  near(a.scalar,1200*ies.sourceHeaderScalars.offset4/ies.sourceHeaderScalars.offset8);
  p.IESMultiplier*=3;assert.deepEqual(sourceDirectRadiometry(p,sourceDirectEmitter(p),ies.sourceHeaderScalars),a);
});

test('IES association rejects a different file/class/resource header rather than accepting a matching name', () => {
  const light=document.lights.find(x=>x.properties.IESProfile);
  assert.equal(sourcePunctualLightConfig(light,null).reason,'ies-resource-not-associated');
  for(const path of ['file','class','header']) {
    const bad=clone(ies);
    if(path==='file')bad.sourceAsset.guid='different';
    if(path==='class')bad.sourceClassGuid='different';
    if(path==='header')bad.sourceHeaderScalars.offset8=0;
    assert.equal(sourcePunctualLightConfig(light,bad).reason,'ies-resource-not-associated');
  }
});

test('spot producer clamps outer and original inner separately before cosine ramp', () => {
  const cases=[[30,60],[100,50],[200,250],[-2,0],[5,5]];
  for(const [inner,outer]of cases) {
    const got=sourceDirectCone(inner,outer),i=Math.min(inner,outer-Math.fround(.001)),o=Math.min(179,Math.max(1,outer));
    near(got.innerDegrees,i);assert.equal(got.outerDegrees,o);
    const co=Math.cos(o*Math.PI/360),scale=1/Math.max(Math.cos(i*Math.PI/360)-co,Math.fround(.001));
    near(got.scale,scale,2e-5);near(got.offset,-co*scale,2e-5);
  }
  assert.ok(sourceDirectCone(200,250).innerDegrees>sourceDirectCone(200,250).outerDegrees);
});

test('unsupported records preserve explicit fallback reasons without changing source inputs', () => {
  const original=JSON.stringify(document);prepareSourcePunctualLights(document,ies);
  assert.equal(JSON.stringify(document),original);
  const base=clone(document.lights.find(x=>sourcePunctualLightConfig(x,ies).supported));
  const cases=[['Enabled',false,'disabled-or-unresolved-activation'],['ExposureCompensation',1,'exposure-compensation-unresolved'],
    ['OnlyHempishere',true,'hemisphere-only-emitter'],['AttenuationRadius',0,'invalid-photometric-fields']];
  for(const [field,value,reason]of cases){const x=clone(base);x.properties[field]=value;assert.equal(sourcePunctualLightConfig(x,ies).reason,reason);}
});
