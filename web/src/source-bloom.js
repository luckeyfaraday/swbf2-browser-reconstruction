import * as THREE from 'three';
import {FullScreenQuad} from 'three/addons/postprocessing/Pass.js';

// Original GaussianSimple bloom (evidence BF2-NATIVE-BLOOM-001, shaders
// BF2-NATIVE-BLOOM-SHADERS-001). The scene colour gets a Gaussian mip pyramid
// (GaussianPyramidCs, sigma 2 source texels), which is accumulated from the
// smallest level upwards with sharpness-derived weights (141561810):
//   up[L-1] = w[L-1]*mip(L);  up[i] = w[i]*mip(i+1) + bilinear(up[i+1])
// into R11G11B10_FLOAT targets. The tonemap adds BloomScale*up[0] to the scene
// before exposure and vignette (see source-colorgrading-renderer.js).
export const NATIVE_BLOOM_POLICY=Object.freeze({
  evidenceId:'BF2-NATIVE-BLOOM-001',
  shaderEvidenceId:'BF2-NATIVE-BLOOM-SHADERS-001',
  observed:'Interior TonemapComponentData selects BloomMethod_GaussianSimple, BloomDirection_None, BloomSoftClip 0 and GaussianSharpness 0.5; PostProcess defaults enable bloom and the HDR/fast-HDR blur pyramid from level 0. Level layout, weight generator, upsample blend, pyramid kernel and tonemap combine are bound to native functions and unchanged bytecode.',
  inferred:[
    'Pyramid mips are built from the composited HDR scene used for metering; native producer ordering relative to transparency is untraced.',
    'tonemapBloomTexture is sampled bilinear/clamp like the other postprocess inputs; its sampler descriptor is untraced.',
    'Scene-colour mips are stored in half float (native storage format untraced); the upsample chain emulates R11G11B10_FLOAT truncation.',
    'Taps are clamped to the image edge (non-robust permutations). The robustEdge permutation, selected for levels at or beyond an untraced threshold (pyramid data +0xc8), treats borders differently and is not reproduced.'],
  limitations:['Directional and FFT bloom are not reconstructed; this map selects neither.','No native frame capture: parity is per pass against unchanged bytecode on WARP.'],
});

export const NATIVE_BLOOM_DEFAULTS=Object.freeze({
  method:'BloomMethod_GaussianSimple',direction:'BloomDirection_None',softClip:0,sharpness:.5,
  bloomEnable:true,blurPyramidEnable:true,quarterDownsampling:false,upsampleFormat:'R11G11B10_FLOAT',maxLevels:15,
});

const f=Math.fround;

/** 141561810: GaussianSimple level weights (float32 steps, 15 entries). */
export function gaussianSimpleWeights(levels,sharpness=NATIVE_BLOOM_DEFAULTS.sharpness) {
  if(!Number.isInteger(levels)||levels<0||levels>15)throw new RangeError('Bloom level count must be 0..15');
  const out=new Array(15).fill(0);
  if(levels===0)return out;
  const n=f(levels),step=f(1/n),inverse=f(1/f(Math.pow(2,n)));
  let spread=f(1-f(sharpness));if(spread<=f(.01))spread=f(.01);
  let total=f(0);
  for(let level=0;level<levels;level++) {
    const low=f(f(Math.pow(2,f(f(f(level)*step)*n)))*inverse),high=f(f(Math.pow(2,f(f(f(level+1)*step)*n)))*inverse);
    let sum=f(0);
    for(let sample=0;sample<10;sample++) {
      const t=f(f(f(f(sample)*f(high-low))*f(.1))+low);
      sum=f(sum+f(f(f(Math.pow(f(1-t),2))*f(Math.pow(f(spread*2),f(t*20))))*f(.1)));
    }
    out[level]=sum;total=f(total+sum);
  }
  if(total>0){const normalize=f(1/total);for(let level=0;level<levels;level++)out[level]=f(normalize*out[level]);}
  return out;
}

/** 141569670: levels used for a W x H scene (0x1e - lzcnt(H) clamp, max 15). */
export function bloomLevelCount(width,height) {
  const largest=Math.max(width>>1,height>>1),fromSize=largest?32-Math.clz32(largest):0;
  return Math.max(0,Math.min(fromSize,30-Math.clz32(height),15));
}

/** Level i matches pyramid mip i+1: repeated halving, clamped at one texel. */
export function bloomLevelSizes(width,height,levels=bloomLevelCount(width,height)) {
  const sizes=[];let w=width,h=height;
  for(let level=0;level<levels;level++){w=Math.max(1,w>>1);h=Math.max(1,h>>1);sizes.push([w,h]);}
  return sizes;
}

/** CPU reference of D3D float32 -> unsigned small float (6-bit R/G, 5-bit B mantissa).
 * The conversion truncates toward zero (observed on WARP against R11G11B10 targets). */
export function quantizeSmallFloat(value,mantissaBits) {
  const max=mantissaBits===6?65024:64512;
  const v=value>0?Math.min(f(value),max):0;
  const bits=new Uint32Array(new Float32Array([v]).buffer)[0],exponent=(bits>>>23)&255;
  if(exponent<113){const step=2**(-14-mantissaBits);return Math.floor(v/step)*step;}
  const shift=23-mantissaBits;
  return new Float32Array(new Uint32Array([(bits&~((1<<shift)-1))>>>0]).buffer)[0];
}

export const SMALL_FLOAT_GLSL=`
float bf2SmallFloat(float value,uint mantissaBits){
  float v=value>0.0?min(value,mantissaBits==6u?65024.0:64512.0):0.0;
  uint bits=floatBitsToUint(v);
  if(((bits>>23)&255u)<113u){float step=exp2(-14.0-float(mantissaBits));return floor(v/step)*step;}
  return uintBitsToFloat(bits&~((1u<<(23u-mantissaBits))-1u));
}
vec3 bf2R11G11B10(vec3 c){return vec3(bf2SmallFloat(c.r,6u),bf2SmallFloat(c.g,6u),bf2SmallFloat(c.b,5u));}`;

// GaussianPyramidCs: exp2(-d^2*0.180337) = exp(-d^2/8), 12 taps from 2*dst-5,
// centre (dst+0.5)*src/dst, normalized. Native horizontal taps are six bilinear
// pairs (hardware filter weights), vertical taps are discrete groupshared rows;
// the same structure reproduces the unchanged shaders on WARP to ~2e-6.
export const PYRAMID_FRAGMENT_GLSL=`
precision highp float;
uniform sampler2D source;
uniform ivec2 sourceSize;
uniform vec2 ratio;
uniform ivec2 axis;
out vec4 outputColor;
float bf2PyramidWeight(int index,float centre){float d=float(index)+0.5-centre;return exp2(-d*d*0.180337);}
void main(){
  ivec2 dst=ivec2(gl_FragCoord.xy);
  vec3 sum=vec3(0.0);float total=0.0;
  if(axis.x==1){
    float centre=(float(dst.x)+0.5)*ratio.x,row=(float(dst.y)+0.5)/float(sourceSize.y);
    for(int pair=0;pair<6;pair++){
      int first=2*dst.x-5+2*pair;
      float a=bf2PyramidWeight(first,centre),b=bf2PyramidWeight(first+1,centre),weight=a+b;
      sum+=textureLod(source,vec2((float(first)+0.5+b/weight)/float(sourceSize.x),row),0.0).rgb*weight;total+=weight;
    }
  } else {
    float centre=(float(dst.y)+0.5)*ratio.y;
    for(int tap=0;tap<12;tap++){
      int index=2*dst.y-5+tap;float weight=bf2PyramidWeight(index,centre);
      sum+=texelFetch(source,ivec2(dst.x,clamp(index,0,sourceSize.y-1)),0).rgb*weight;total+=weight;
    }
  }
  outputColor=vec4(sum/total,1.0);
}`;

// Texture2dBlend (Tex2d) for the smallest level and GaussianBloom (Tex2dDouble):
// mip(i+1)*w + previous*1, written to an R11G11B10_FLOAT target.
export const UPSAMPLE_FRAGMENT_GLSL=`
precision highp float;
uniform sampler2D pyramid;
uniform sampler2D previous;
uniform bool hasPrevious;
uniform float weight;
uniform vec2 targetSize;
uniform bool quantize;
out vec4 outputColor;
${SMALL_FLOAT_GLSL}
void main(){
  vec3 color=texelFetch(pyramid,ivec2(gl_FragCoord.xy),0).rgb*weight;
  if(hasPrevious)color+=texture(previous,gl_FragCoord.xy/targetSize).rgb;
  outputColor=vec4(quantize?bf2R11G11B10(color):color,1.0);
}`;

const VERTEX='precision highp float;in vec3 position;void main(){gl_Position=vec4(position.xy,0.0,1.0);}';

/** Map-selected settings from the recovered environment document. */
export function nativeBloomSettings(environment) {
  const overrides=environment?.rawTonemapOverrides??{};
  const scale=overrides.BloomScale?[overrides.BloomScale.x,overrides.BloomScale.y,overrides.BloomScale.z]:null;
  const direction=overrides.BloomDirection?.value??0;
  const sharpness=Number.isFinite(overrides.GaussianSharpness)?overrides.GaussianSharpness:NATIVE_BLOOM_DEFAULTS.sharpness;
  const enabled=!!scale&&direction===0&&scale.some(v=>v>0)&&NATIVE_BLOOM_DEFAULTS.bloomEnable&&NATIVE_BLOOM_DEFAULTS.blurPyramidEnable;
  return {enabled,scale:scale??[0,0,0],sharpness,direction,method:NATIVE_BLOOM_DEFAULTS.method,softClip:NATIVE_BLOOM_DEFAULTS.softClip};
}

export function createNativeBloom(renderer,{sharpness=NATIVE_BLOOM_DEFAULTS.sharpness,type=THREE.HalfFloatType,quantize=true}={}) {
  const target=(name,filter)=>{const t=new THREE.WebGLRenderTarget(1,1,{type,depthBuffer:false,minFilter:filter,magFilter:filter,generateMipmaps:false});t.texture.name=name;return t;};
  const pyramidMaterial=new THREE.RawShaderMaterial({name:'Native bloom Gaussian pyramid',glslVersion:THREE.GLSL3,depthTest:false,depthWrite:false,blending:THREE.NoBlending,
    uniforms:{source:{value:null},sourceSize:{value:new THREE.Vector2()},ratio:{value:new THREE.Vector2(2,2)},axis:{value:new THREE.Vector2(1,0)}},vertexShader:VERTEX,fragmentShader:PYRAMID_FRAGMENT_GLSL});
  const upsampleMaterial=new THREE.RawShaderMaterial({name:'Native bloom upsample',glslVersion:THREE.GLSL3,depthTest:false,depthWrite:false,blending:THREE.NoBlending,
    uniforms:{pyramid:{value:null},previous:{value:null},hasPrevious:{value:false},weight:{value:0},targetSize:{value:new THREE.Vector2()},quantize:{value:quantize}},vertexShader:VERTEX,fragmentShader:UPSAMPLE_FRAGMENT_GLSL});
  // sourceSize/axis are integer uniforms in GLSL; three uploads Vector2 as ivec2 for int types.
  const quad=new FullScreenQuad(pyramidMaterial);
  const horizontal=[],mips=[],levels=[];
  let width=0,height=0,count=0,weights=gaussianSimpleWeights(0,sharpness),frames=0,disposed=false;
  const draw=(material,output)=>{quad.material=material;renderer.setRenderTarget(output);quad.render(renderer);};
  function layout(w,h) {
    if(w===width&&h===height)return;
    width=w;height=h;count=bloomLevelCount(w,h);weights=gaussianSimpleWeights(count,sharpness);
    const sizes=bloomLevelSizes(w,h,count);
    while(mips.length<count){horizontal.push(target(`Native bloom pyramid H${mips.length+1}`,THREE.NearestFilter));mips.push(target(`Native bloom pyramid mip ${mips.length+1}`,THREE.LinearFilter));levels.push(target(`Native bloom UpsamplePyramid ${levels.length}`,THREE.LinearFilter));}
    let sourceHeight=h;
    sizes.forEach(([lw,lh],level)=>{horizontal[level].setSize(lw,sourceHeight);mips[level].setSize(lw,lh);levels[level].setSize(lw,lh);sourceHeight=lh;});
  }
  return {
    render(source,w,h) {
      if(disposed)return null;
      layout(w,h);if(!count)return null;
      const sizes=bloomLevelSizes(w,h,count),u=pyramidMaterial.uniforms;
      let input=source,sw=w,sh=h;
      for(let level=0;level<count;level++) {
        const [dw,dh]=sizes[level];
        u.source.value=input;u.sourceSize.value.set(sw,sh);u.ratio.value.set(sw/dw,sh/dh);u.axis.value.set(1,0);draw(pyramidMaterial,horizontal[level]);
        u.source.value=horizontal[level].texture;u.sourceSize.value.set(dw,sh);u.axis.value.set(0,1);draw(pyramidMaterial,mips[level]);
        input=mips[level].texture;sw=dw;sh=dh;
      }
      const v=upsampleMaterial.uniforms;
      for(let level=count-1;level>=0;level--) {
        v.pyramid.value=mips[level].texture;v.weight.value=weights[level];v.targetSize.value.set(...sizes[level]);
        v.hasPrevious.value=level<count-1;v.previous.value=level<count-1?levels[level+1].texture:null;
        draw(upsampleMaterial,levels[level]);
      }
      frames++;return levels[0].texture;
    },
    get texture(){return count?levels[0].texture:null;},
    debugTargets:()=>({mips:mips.slice(0,count),levels:levels.slice(0,count)}),
    snapshot:()=>({evidenceId:NATIVE_BLOOM_POLICY.evidenceId,levels:count,size:[width,height],levelSizes:bloomLevelSizes(width,height,count),weights:weights.slice(0,count),sharpness,quantize,frames,passes:count*3}),
    dispose(){disposed=true;for(const t of [...horizontal,...mips,...levels])t.dispose();pyramidMaterial.dispose();upsampleMaterial.dispose();quad.dispose();},
  };
}
