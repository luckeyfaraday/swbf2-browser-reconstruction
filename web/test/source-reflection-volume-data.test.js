import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {decodeNativeReflectionRuntimeRecord, sourceReflectionInverseRows,
  sourceReflectionVolumeSortKey, buildSourceReflectionLightInfo,
  SOURCE_REFLECTION_VOLUME_POLICY} from '../src/source-reflection-volume-data.js';

const identity = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
const record = overrides => ({transform: identity, extent:[2,3,4], localOffset:[.1,.2,.3],
  sideFadePos:[.4,.5,.6], sideFadeNeg:[.7,.8,.9], influenceFadeAnchor:[5,6,7],
  textureIndex:17, type:1, influenceFadeDistance:.5, influenceExpandDistance:1,
  useSkyVisibilityAsAO:false, useSkyVisibilityAsMask:true, useProxyReprojection:true,
  skySharpenInput:2, skyBiasInput:.5, ...overrides});
const near = (actual, expected, tolerance=1e-6) => Array.from(actual).forEach((value,i) =>
  assert.ok(Math.abs(value-expected[i]) <= tolerance, `${i}: ${value} != ${expected[i]}`));

test('decoder follows original runtime byte offsets, including packed booleans and texture index', () => {
  const bytes = new ArrayBuffer(240), view = new DataView(bytes,16,224);
  const floats = (at, values) => values.forEach((value,i) => view.setFloat32(at+i*4,value,true));
  floats(0,identity); floats(0x40,[2,3,4]); floats(0x50,[5,6,7]);
  floats(0x60,[8,9,10]); floats(0x70,[11,12,13]); floats(0x80,[14,15,16]);
  view.setUint16(0x90,321,true); view.setInt32(0x98,1,true);
  view.setUint8(0xa4,1); view.setUint8(0xa5,0); view.setUint8(0xa6,1);
  floats(0xa8,[2,.25]); floats(0xb8,[.5,3]);
  const decoded = decodeNativeReflectionRuntimeRecord(bytes,16);
  assert.deepEqual(decoded.transform,identity); assert.deepEqual(decoded.extent,[2,3,4]);
  assert.deepEqual(decoded.localOffset,[5,6,7]); assert.deepEqual(decoded.sideFadeNeg,[11,12,13]);
  assert.deepEqual(decoded.influenceFadeAnchor,[14,15,16]); assert.equal(decoded.textureIndex,321);
  assert.equal(decoded.skySharpenInput,2); assert.equal(decoded.skyBiasInput,.25);
  assert.equal(decoded.influenceFadeDistance,.5); assert.equal(decoded.influenceExpandDistance,3);
  assert.equal(decoded.useSkyVisibilityAsAO,false); assert.equal(decoded.useSkyVisibilityAsMask,true);
  assert.equal(decoded.useProxyReprojection,true);
  assert.throws(() => decodeNativeReflectionRuntimeRecord(bytes,17), /range/);
});

test('native basis normalization removes scale and handles negative determinant on the right axis', () => {
  const matrix = [-2,0,0,0, 0,3,0,0, 0,0,4,0, 10,20,30,1];
  const rows = sourceReflectionInverseRows(matrix,[1,2,3]);
  near(rows.flat(),[1,0,0,-9, 0,1,0,-18, 0,0,1,-27]);
  // The original code normalizes columns independently; no Gram-Schmidt step.
  const sheared = [...identity]; sheared[4]=1;
  near(sourceReflectionInverseRows(sheared)[1],[Math.SQRT1_2,Math.SQRT1_2,0,0]);
});

test('1000 translated, rotated and scaled native matrices match an independent rigid matrix inverse', () => {
  let seed=88217;
  const random=() => ((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
  for (let i=0;i<1000;i++) {
    const quaternion=new THREE.Quaternion().setFromEuler(new THREE.Euler(random()*6,random()*6,random()*6));
    const position=new THREE.Vector3(random()*200-100,random()*200-100,random()*200-100);
    const camera=new THREE.Vector3(random()*40,random()*40,random()*40);
    const scale=new THREE.Vector3((.1+random()*30)*(i%2?-1:1),.1+random()*30,.1+random()*30);
    const source=new THREE.Matrix4().compose(position,quaternion,scale);
    const reference=new THREE.Matrix4().compose(position.clone().sub(camera),quaternion,new THREE.Vector3(1,1,1)).invert().elements;
    const rows=sourceReflectionInverseRows(source.elements,camera.toArray());
    near(rows.flat(),[reference[0],reference[4],reference[8],reference[12],reference[1],reference[5],reference[9],reference[13],reference[2],reference[6],reference[10],reference[14]],1e-10);
  }
});

test('packed 192-byte shader record preserves every field and inverts use flags only once', () => {
  const packed=buildSourceReflectionLightInfo(record());
  assert.equal(packed.byteLength,192);
  near(packed.slice(16,24),[2,3,4,17, 3,4,5,2]);
  near(packed.slice(24,32),[.4,.5,.6,.5, .7,.8,.9,1]);
  near(packed.slice(32,40),[.1,.2,.3,1, 2,2,2,1]);
  near(packed.slice(40),[2.5,3.5,4.5,0, 21,-10,0,0]);
  assert.ok(Math.abs(packed[3]-(Math.sqrt(50)+Math.fround(.01))**2)<4e-6);
});

test('sphere branch uses radius and unexpanded influence anchor while preserving expanded fields', () => {
  const packed=buildSourceReflectionLightInfo(record({type:0, extent:[3,3,3], influenceFadeDistance:0,
    useProxyReprojection:false, useSkyVisibilityAsAO:true, useSkyVisibilityAsMask:false}));
  near(packed.slice(36,44),[2,3,4,0, 4,4,4,1]);
  assert.equal(packed[23],Math.fround(1/Math.fround(.0001)));
  assert.equal(packed[46],1);
  assert.ok(Math.abs(packed[3]-(4+Math.fround(.01))**2)<2e-6);
});

test('CPU sort keys use positive volume-size bits, without claiming tie or tile-list order', () => {
  const small=sourceReflectionVolumeSortKey(record({extent:[2,3,4]}));
  const large=sourceReflectionVolumeSortKey(record({extent:[3,4,5]}));
  assert.equal(small.volume,192); assert.equal(large.volume,480);
  assert.ok(small.unsignedBits<large.unsignedBits);
  assert.ok(Math.abs(sourceReflectionVolumeSortKey(record({type:0,extent:[3,3,3]})).volume-36*Math.PI)<1e-5);
  assert.match(SOURCE_REFLECTION_VOLUME_POLICY.input,/not established/);
  assert.match(SOURCE_REFLECTION_VOLUME_POLICY.order,/remain unresolved/);
});

test('invalid explicit fields fail instead of silently substituting entity-scale extents', () => {
  assert.throws(() => buildSourceReflectionLightInfo(record({extent:undefined})),/extent/);
  assert.throws(() => buildSourceReflectionLightInfo(record({skyBiasInput:NaN})),/fields/);
  assert.throws(() => sourceReflectionInverseRows(new Array(16).fill(0)),/Degenerate/);
  assert.throws(() => sourceReflectionVolumeSortKey(record({extent:[-1,2,3]})),/Negative/);
});
