import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gaussianSimpleWeights,bloomLevelCount,bloomLevelSizes,quantizeSmallFloat,nativeBloomSettings,NATIVE_BLOOM_POLICY,NATIVE_BLOOM_DEFAULTS,PYRAMID_FRAGMENT_GLSL,UPSAMPLE_FRAGMENT_GLSL} from '../src/source-bloom.js';

// Native 141561810 output computed with the original CRT powf import
// (tools/materials/native-bloom-evidence.py, BF2-NATIVE-BLOOM-001).
const NATIVE_WEIGHTS={"0.5": {"1": [1.0], "2": [0.8104615211486816, 0.18953844904899597], "5": [0.31234806776046753, 0.2834870219230652, 0.23015207052230835, 0.14103072881698608, 0.032982129603624344], "8": [0.16930896043777466, 0.1673862487077713, 0.16357502341270447, 0.1560896337032318, 0.14166690409183502, 0.11501384526491165, 0.07047725468873978, 0.016482152044773102], "9": [0.14549972116947174, 0.14467455446720123, 0.14303159713745117, 0.13977490365505219, 0.13337862491607666, 0.12105440348386765, 0.09827936440706253, 0.06022283434867859, 0.014084003865718842], "10": [0.12733356654644012, 0.1269727349281311, 0.12625263631343842, 0.12481887638568878, 0.12197687476873398, 0.11639506369829178, 0.10564012825489044, 0.08576510846614838, 0.052554450929164886, 0.01229063794016838], "15": [0.07794502377510071, 0.07793811708688736, 0.07792431861162186, 0.07789673656225204, 0.07784157991409302, 0.07773131132125854, 0.07751104235649109, 0.07707145810127258, 0.07619621604681015, 0.07446130365133286, 0.07105386257171631, 0.06448845565319061, 0.052355654537677765, 0.03208205848932266, 0.007502861320972443]}, "0.25": {"8": [0.027797896414995193, 0.028775740414857864, 0.030833709985017776, 0.035390570759773254, 0.046549033373594284, 0.07974695414304733, 0.2167053520679474, 0.5342007279396057]}, "0.9": {"8": [0.36626651883125305, 0.30242154002189636, 0.20704779028892517, 0.09867362678050995, 0.023864835500717163, 0.001711896969936788, 1.3716638932237402e-05, 1.3557437394950966e-09]}};

test('GaussianSimple weights reproduce the native float32 generator',()=>{
  for(const [sharpness,tables] of Object.entries(NATIVE_WEIGHTS))
    for(const [levels,expected] of Object.entries(tables)) {
      const actual=gaussianSimpleWeights(Number(levels),Number(sharpness));
      assert.equal(actual.length,15);
      expected.forEach((value,i)=>assert.ok(Math.abs(actual[i]-value)<=Math.max(2e-7,Math.abs(value)*2e-6),`L${levels} s${sharpness} w${i}: ${actual[i]} vs ${value}`));
      for(let i=Number(levels);i<15;i++)assert.equal(actual[i],0);
      assert.ok(Math.abs(actual.reduce((a,b)=>a+b,0)-1)<1e-5);
    }
  assert.deepEqual(gaussianSimpleWeights(0),new Array(15).fill(0));
  assert.throws(()=>gaussianSimpleWeights(16),RangeError);
});

test('level layout follows the native pyramid description and height clamp',()=>{
  assert.equal(bloomLevelCount(1280,720),8);
  assert.equal(bloomLevelCount(1920,1080),9);
  assert.equal(bloomLevelCount(2560,1440),9);
  assert.equal(bloomLevelCount(160,90),5);
  assert.equal(bloomLevelCount(4,4),1);
  assert.equal(bloomLevelCount(2,2),0);
  assert.deepEqual(bloomLevelSizes(1280,720),[[640,360],[320,180],[160,90],[80,45],[40,22],[20,11],[10,5],[5,2]]);
  assert.deepEqual(bloomLevelSizes(160,90),[[80,45],[40,22],[20,11],[10,5],[5,2]]);
  assert.deepEqual(bloomLevelSizes(3,1,2),[[1,1],[1,1]]);
});

test('R11G11B10 reference truncates mantissas toward zero and clamps the unsigned range',()=>{
  assert.equal(quantizeSmallFloat(1,6),1);
  assert.equal(quantizeSmallFloat(1+1/128,6),1);
  assert.equal(quantizeSmallFloat(1+3/128,6),1+1/64);
  assert.equal(quantizeSmallFloat(1+1/64-1e-6,6),1);
  assert.equal(quantizeSmallFloat(1+1/32-1e-6,5),1);         // 5-bit blue: step 1/32
  assert.equal(quantizeSmallFloat(0.35092299,6),0.34765625);  // native WARP upsample witness value
  assert.equal(quantizeSmallFloat(0.0350028,6),0.03466796875);
  assert.equal(quantizeSmallFloat(70000,6),65024);
  assert.equal(quantizeSmallFloat(70000,5),64512);
  assert.equal(quantizeSmallFloat(-2,6),0);
  assert.equal(quantizeSmallFloat(NaN,6),0);
  // Denormals: float11 step is 2^-20 below 2^-14.
  assert.equal(quantizeSmallFloat(2**-20*3.9,6),2**-20*3);
  for(const v of [0.1,0.33,7.77,1234.5,2**-16]){const q=quantizeSmallFloat(v,6);assert.ok(q<=v&&v-q<q/64+1e-12);}
});

test('map settings come from the selected interior tonemap overrides',()=>{
  const environment=JSON.parse(fs.readFileSync(new URL('../public/assets/source-environment.json',import.meta.url),'utf8'));
  const settings=nativeBloomSettings(environment);
  assert.equal(settings.enabled,true);
  assert.deepEqual(settings.scale,[0.075,0.11,0.115]);
  assert.equal(settings.sharpness,0.5);assert.equal(settings.direction,0);
  assert.equal(settings.method,'BloomMethod_GaussianSimple');assert.equal(settings.softClip,0);
  assert.equal(nativeBloomSettings({}).enabled,false);
  assert.equal(nativeBloomSettings({rawTonemapOverrides:{BloomScale:{x:1,y:1,z:1},BloomDirection:{value:1}}}).enabled,false,'directional bloom is not reconstructed');
  assert.equal(NATIVE_BLOOM_POLICY.evidenceId,'BF2-NATIVE-BLOOM-001');
  assert.equal(NATIVE_BLOOM_DEFAULTS.upsampleFormat,'R11G11B10_FLOAT');
});

test('shaders carry the native kernel constants and blend structure',()=>{
  assert.match(PYRAMID_FRAGMENT_GLSL,/exp2\(-d\*d\*0\.180337\)/);
  assert.match(PYRAMID_FRAGMENT_GLSL,/pair<6/);assert.match(PYRAMID_FRAGMENT_GLSL,/2\*dst\.x-5\+2\*pair/);
  assert.match(PYRAMID_FRAGMENT_GLSL,/tap<12/);assert.match(PYRAMID_FRAGMENT_GLSL,/2\*dst\.y-5\+tap/);
  assert.match(UPSAMPLE_FRAGMENT_GLSL,/texelFetch\(pyramid,ivec2\(gl_FragCoord\.xy\),0\)\.rgb\*weight/);
  assert.match(UPSAMPLE_FRAGMENT_GLSL,/texture\(previous,gl_FragCoord\.xy\/targetSize\)/);
  assert.match(UPSAMPLE_FRAGMENT_GLSL,/bf2R11G11B10/);assert.match(UPSAMPLE_FRAGMENT_GLSL,/floor\(v\/step\)/);
});
