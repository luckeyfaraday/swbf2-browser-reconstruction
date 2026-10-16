import * as THREE from 'three';
import {FullScreenQuad} from 'three/addons/postprocessing/Pass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {nativeExposureAtEV,adaptNativeExposureEV,nativeMeterEV,NATIVE_EXPOSURE_POLICY} from './source-exposure-native.js';
import {createNativeExposureMeter} from './source-exposure-meter-renderer.js';
import {NATIVE_METER_POLICY,NATIVE_METER_BASELINE} from './source-exposure-meter.js';
import {createNativeGradingPass} from './source-colorgrading-renderer.js';
import {createNativeBloom,nativeBloomSettings,NATIVE_BLOOM_POLICY} from './source-bloom.js';

export const EXPOSURE_POLICY=Object.freeze({
  evidence:'BF2-MAP-EXPOSURE-001',
  observed:'Selected linear tonemap, native method-1 logarithmic reduction, bilinear/clamp sampling, square source crop, ten RGBA16F passes, native readback/EV calibration, photographic scale and directional capped dt/time adaptation.',
  inferred:'Native-default method1/logAverage/fast sampling and zero deadband are the browser baseline; original runtime overrides are not captured. Browser retains 200ms scheduling, initial EV midpoint/snap and a view spot-scale limit of1.',
  limitations:'Native readback ring timing, view spot-scale-limit producer and active local environment blending remain incomplete. Grading uses the recovered SDR default baseline, RGB10A2 intermediate precision, authored global vignette and GaussianSimple bloom; per-view grading bulk-copy linkage remains untraced.',
  bloom:NATIVE_BLOOM_POLICY,
  meter:NATIVE_METER_POLICY,baseline:NATIVE_METER_BASELINE,
  native:NATIVE_EXPOSURE_POLICY,
});
export function exposureAtEV(ev,compensation=0) {return nativeExposureAtEV(ev,compensation);}
export function adaptExposureEV(current,target,dt,settings) {
  target=Math.max(settings.minEV,Math.min(settings.maxEV,target));
  return adaptNativeExposureEV(current,target,Math.max(0,dt),settings);
}

// Render the scene once into HDR, then reduce that image with the recovered
// source shaders. Exposure never draws the scene geometry a second time.
export function createSourceExposure(renderer,document,{grading=null}={}) {
  const settings=document.tonemap;
  if(settings.method!=='TonemapMethod_Linear')throw new Error('Unsupported recovered source tonemap');
  const hdr=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,samples:4});
  hdr.texture.name='Source scene HDR';
  const composite=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,depthBuffer:false});
  composite.texture.name='Source scene and foreground effects HDR';
  const copyMaterial=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,blending:THREE.NoBlending,
    uniforms:{source:{value:hdr.texture}},vertexShader:'varying vec2 screenUv;void main(){screenUv=position.xy*0.5+0.5;gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader:'varying vec2 screenUv;uniform sampler2D source;void main(){gl_FragColor=texture2D(source,screenUv);}'});
  const copy=new FullScreenQuad(copyMaterial);
  const meter=createNativeExposureMeter(renderer),output=grading?createNativeGradingPass(grading.textures,{quantizePlane:grading.quantizePlane,vignette:document.vignette}):new OutputPass(),size=new THREE.Vector2();
  // Bloom enters the native Tonemap, so it requires the native grading pass.
  const bloomSettings=nativeBloomSettings(document),bloom=grading&&bloomSettings.enabled?createNativeBloom(renderer,{sharpness:bloomSettings.sharpness}):null;
  let bloomEnabled=!!bloom;
  output.renderToScreen=true;
  let ev=(settings.minEV+settings.maxEV)/2,target=ev,lastMeter=-Infinity,frames=0,reads=0,rawMeterEV=null,pending=false,meterError=null;
  let enabled=true,resolutionScale=1,disposed=false,meterLuminance=null;
  renderer.toneMapping=THREE.LinearToneMapping;renderer.toneMappingExposure=exposureAtEV(ev,settings.exposureCompensation);
  return {
    async prepare(scene,camera,subset=scene) {
      const target=renderer.getRenderTarget();
      try {renderer.setRenderTarget(hdr);await renderer.compileAsync(subset,camera,scene);}
      finally {renderer.setRenderTarget(target);}
    },
    render(scene,camera,dt=0,effects=null) {
      if(disposed)return;
      if(!enabled&&!effects){renderer.setRenderTarget(null);renderer.render(scene,camera);return;}
      if(effects&&!hdr.depthTexture){hdr.depthTexture=new THREE.DepthTexture(hdr.width,hdr.height,THREE.UnsignedIntType);hdr.dispose();}
      renderer.getDrawingBufferSize(size);size.multiplyScalar(resolutionScale).floor();size.set(Math.max(1,size.x),Math.max(1,size.y));if(hdr.width!==size.x||hdr.height!==size.y)hdr.setSize(size.x,size.y);
      const autoReset=renderer.info.autoReset;renderer.info.autoReset=false;renderer.info.reset();
      renderer.setRenderTarget(hdr);renderer.render(scene,camera);
      let outputTarget=hdr;
      if(effects) {
        if(composite.width!==size.x||composite.height!==size.y)composite.setSize(size.x,size.y);
        // Reading a depth texture while drawing into its framebuffer is invalid.
        // The foreground pass writes a separate HDR target after the opaque
        // multisampled color/depth have resolved. The source graph disables Z.
        renderer.setRenderTarget(composite);copy.render(renderer);
        effects.render(camera,hdr.depthTexture,size.x,size.y);outputTarget=composite;
      }
      const now=performance.now();
      if(enabled&&!pending&&now-lastMeter>=200) {
        pending=true;lastMeter=now;
        meter.measure(outputTarget.texture,size.x,size.y,{spotScale:settings.spotMeterScale}).then(result=>{
          if(disposed||!result)return;
          meterLuminance=result.luminance;rawMeterEV=nativeMeterEV(meterLuminance);
          target=THREE.MathUtils.clamp(rawMeterEV,settings.minEV,settings.maxEV);
          if(!reads)ev=target;
          reads++;
        }).catch(error=>{if(!disposed){meterError=String(error);console.error(error);}}).finally(()=>{pending=false;});
      }
      ev=adaptExposureEV(ev,target,dt,settings);
      renderer.toneMappingExposure=exposureAtEV(ev,settings.exposureCompensation);
      if(bloom)output.setBloom(bloomEnabled?bloom.render(outputTarget.texture,size.x,size.y):null,bloomSettings.scale);
      if(grading)output.render(renderer,outputTarget.texture,renderer.toneMappingExposure);
      else output.render(renderer,null,outputTarget);
      renderer.info.autoReset=autoReset;frames++;
    },
    configure(options={}){if(options.enabled!==undefined)enabled=!!options.enabled;if(options.bloom!==undefined)bloomEnabled=!!bloom&&!!options.bloom;if(options.samples!==undefined){const samples=Math.max(0,Math.min(4,Math.floor(options.samples)));if(samples!==hdr.samples){hdr.samples=samples;hdr.dispose();}}if(options.resolutionScale!==undefined)resolutionScale=Math.max(.5,Math.min(1,options.resolutionScale));},
    snapshot:()=>({frames,meterReads:reads,meterError,enabled,samples:hdr.samples,resolutionScale,bloom:bloom?{enabled:bloomEnabled,scale:bloomSettings.scale,method:bloomSettings.method,softClip:bloomSettings.softClip,...bloom.snapshot()}:{enabled:false,reason:grading?'no recovered bloom scale':'native grading inactive'},ev,targetEV:target,rawMeterEV,meterLuminance,meter:meter.snapshot(),grading:grading?.snapshot()??null,vignette:grading?document.vignette??null:null,exposure:renderer.toneMappingExposure,settings,policy:EXPOSURE_POLICY,source:document.provenance??document.evidenceId}),
    dispose(){if(disposed)return;disposed=true;bloom?.dispose();meter.dispose();hdr.dispose();composite.dispose();copyMaterial.dispose();copy.dispose();output.dispose();grading?.dispose();},
  };
}
