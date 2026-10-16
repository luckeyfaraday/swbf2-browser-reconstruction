import * as THREE from 'three';
import {FullScreenQuad} from 'three/addons/postprocessing/Pass.js';
import {NATIVE_METER_BASELINE, NATIVE_METER_FRAGMENT_GLSL, nativeMeterPassPlan,
  nativeMeterSpotRectangle, decodeNativeMeterPixel} from './source-exposure-meter.js';

// Fixed, small RGBA16F targets preserve every native reduction and its rounding.
// The source scene is raw HDR; native first-pass inverse pre-exposure is therefore 1.
export function createNativeExposureMeter(renderer) {
  const passes = nativeMeterPassPlan(2, true);
  const targets = passes.map(({width,height},i) => {
    const target = new THREE.WebGLRenderTarget(width,height,{type:THREE.HalfFloatType,
      depthBuffer:false,stencilBuffer:false,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter});
    target.texture.name = `Source exposure reduction ${i}: ${width}x${height}`;
    target.texture.generateMipmaps = false;
    return target;
  });
  const material = new THREE.ShaderMaterial({depthTest:false,depthWrite:false,
    toneMapped:false,blending:THREE.NoBlending,
    uniforms:{source:{value:null},inverseDestinationSize:{value:new THREE.Vector2()},
      meterRectangle:{value:new THREE.Vector4()},meterScale:{value:1},
      maxClampColor:{value:new THREE.Vector3(65504,65504,65504)},logarithmic:{value:true},fastPath:{value:true}},
    vertexShader:'varying vec2 screenUv;void main(){screenUv=position.xy*.5+.5;gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader:NATIVE_METER_FRAGMENT_GLSL});
  const quad = new FullScreenQuad(material);
  let pending=null,disposed=false,measurements=0,lastRectangle=null,lastPasses=0;
  return {
    measure(texture,width,height,{spotScale=1,spotOffset=NATIVE_METER_BASELINE.spotOffset,
      rectangle=null}={}) {
      if(disposed)return Promise.resolve(null);
      if(pending)return pending;
      // HDR scene targets already use bilinear/clamp; do not alter a shared texture.
      if(texture.minFilter!==THREE.LinearFilter||texture.magFilter!==THREE.LinearFilter||
        texture.wrapS!==THREE.ClampToEdgeWrapping||texture.wrapT!==THREE.ClampToEdgeWrapping) {
        return Promise.reject(new Error('Native exposure fast path requires a bilinear/clamp source texture'));
      }
      const plan=nativeMeterPassPlan(width,true),previous=renderer.getRenderTarget();
      lastRectangle=rectangle??nativeMeterSpotRectangle(width,height,spotScale,spotOffset);
      lastPasses=plan.length;
      let source=texture,result;
      try {
        for(let i=0;i<plan.length;i++) {
          const pass=plan[i],target=targets[targets.length-plan.length+i];
          material.uniforms.source.value=source;
          material.uniforms.inverseDestinationSize.value.set(1/pass.width,1/pass.height);
          material.uniforms.meterRectangle.value.fromArray(pass.logarithmic?lastRectangle:[0,0,1,1]);
          material.uniforms.logarithmic.value=pass.logarithmic;
          renderer.setRenderTarget(target);quad.render(renderer);
          source=target.texture;result=target;
        }
        const pixel=new Uint16Array(4);
        // readPixels submits before awaiting the fence, so resize/disposal cannot
        // replace the queued read. The completion guard suppresses stale updates.
        pending=renderer.readRenderTargetPixelsAsync(result,0,0,1,1,pixel).then(()=>{
          if(disposed)return null;
          const rgba=Array.from(pixel,THREE.DataUtils.fromHalfFloat);
          const luminance=decodeNativeMeterPixel(rgba,true);
          if(!Number.isFinite(luminance)||luminance<=0)throw new Error('Invalid native exposure meter readback');
          measurements++;
          return {luminance,rgba,half:Array.from(pixel),rectangle:lastRectangle.slice(),passes:lastPasses};
        }).finally(()=>{pending=null;});
        return pending;
      } finally {renderer.setRenderTarget(previous);}
    },
    snapshot:()=>({measurements,pending:!!pending,disposed,rectangle:lastRectangle,passes:lastPasses,
      intermediateType:'RGBA16F',allocatedBytes:targets.reduce((n,t)=>n+t.width*t.height*8,0),baseline:NATIVE_METER_BASELINE}),
    dispose(){if(disposed)return;disposed=true;targets.forEach(t=>t.dispose());material.dispose();quad.dispose();},
  };
}
