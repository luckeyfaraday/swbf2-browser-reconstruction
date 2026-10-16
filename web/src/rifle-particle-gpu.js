import * as THREE from 'three';
import {FullScreenQuad} from 'three/addons/postprocessing/Pass.js';

// The original 912-byte emitter and 88-byte particle remain byte-addressable.
// Integer textures preserve packed halves, including NaN/subnormal bit patterns.
// A particle occupies six RGBA32UI texels (the last eight bytes are padding).
export const RIFLE_PARTICLE_GPU_GLSL = `
precision highp float;
precision highp int;
precision highp usampler2D;
uniform usampler2D emitterData;
uniform usampler2D previousParticles;
uniform sampler2D timingData;
uniform sampler2D sceneDepth;
uniform mat4 depthViewProjection;
uniform int depthConvention;
layout(location=0) out uvec4 particleOutput;
int slot;
vec4 property(int offset) {return uintBitsToFloat(texelFetch(emitterData,ivec2(offset/16,slot),0));}
float scalar(int offset) {return property(offset)[(offset%16)/4];}
uvec4 previous(int column) {return texelFetch(previousParticles,ivec2(column,slot),0);}
float sat(float x) {return clamp(x,0.0,1.0);}
bool missing(vec3 p) {vec3 d=p-1.0;return dot(d,d)<0.0001;}
// DXBC f32tof16 uses round-to-zero. GLSL packHalf2x16 uses round-to-nearest.
uint halfRTZ(float value) {
 uint bits=floatBitsToUint(value),sign=(bits>>16u)&0x8000u;
 uint exponent=(bits>>23u)&255u,mantissa=bits&0x7fffffu;
 if(exponent==255u)return sign|0x7c00u|(mantissa==0u?0u:0x200u);
 if(exponent>142u)return sign|0x7c00u;
 if(exponent<103u)return sign;
 if(exponent<113u)return sign|((mantissa|0x800000u)>>(126u-exponent));
 return sign|((exponent-112u)<<10u)|(mantissa>>13u);
}
uint halves(vec2 value) {return halfRTZ(value.x)|(halfRTZ(value.y)<<16u);}
bool occluded(vec3 point) {
 vec4 projected=depthViewProjection*vec4(point,1.0);
 vec3 ndc=projected.xyz/projected.w;
 vec2 uv=ndc.xy*0.5+0.5;
 float reversedZ=ndc.z;
 if(depthConvention==0)uv.y=1.0-uv.y;
 else reversedZ=0.5-ndc.z*0.5;
 // The original shader rejects z>1 but deliberately has no z<0 test.
 if(any(lessThan(uv,vec2(0.0)))||any(greaterThan(uv,vec2(1.0)))||reversedZ>1.0)return false;
 ivec2 size=textureSize(sceneDepth,0),base=ivec2(floor(uv*vec2(size)-0.5));
 float minimum=1.0;
 for(int y=0;y<2;y++)for(int x=0;x<2;x++) {
   float sampleDepth=texelFetch(sceneDepth,clamp(base+ivec2(x,y),ivec2(0),size-1),0).r;
   if(depthConvention!=0)sampleDepth=1.0-sampleDepth;
   minimum=min(minimum,sampleDepth);
 }
 return reversedZ<minimum;
}
void main() {
 slot=int(gl_FragCoord.y);int column=int(gl_FragCoord.x);
 vec4 timing=texelFetch(timingData,ivec2(0,slot),0);
 if(timing.w<0.5){particleOutput=uvec4(0u);return;}
 if(timing.z< -0.5){particleOutput=previous(column);return;}
 vec4 row0=property(0),row1=property(16),row2=property(32);
 vec3 right=normalize(vec3(row0.x,row1.x,row2.x));
 vec3 up=normalize(vec3(row0.y,row1.y,row2.y));
 vec3 forward=normalize(vec3(row0.z,row1.z,row2.z));
 vec3 emitterPosition=vec3(row0.w,row1.w,row2.w);
 float age=scalar(192),particleLife=scalar(204),segmentLength=scalar(276);
 float extent=max(segmentLength*scalar(320),0.01),defaultSpeed=scalar(368),mode=scalar(496);
 float inputSpeed=scalar(784),speed=abs(inputSpeed-1.0)<0.00001?defaultSpeed:abs(inputSpeed);
 vec3 fallback=property(800).xyz,muzzle=property(816).xyz,origin=muzzle;
 bool valid=!missing(origin),fromFallback=false;
 if(!valid){origin=fallback;fromFallback=!missing(origin);valid=fromFallback;}
 vec3 xAxis,yAxis,zAxis,translation,position;float life;
 vec2 h0,h1,h2,h3,h4,h5;
 if(timing.z>0.5) {
   if(!valid)origin=emitterPosition;
   vec3 delta=emitterPosition-origin;float distanceSquared=dot(delta,delta);
   vec3 direction=!fromFallback&&distanceSquared>=0.1?normalize(delta):up;
   uint hash=uint(timing.x*100.0)^0xa3c59ac3u;
   hash*=0x9e3779b9u;hash^=hash>>16u;hash*=0x9e3779b9u;hash^=hash>>16u;hash*=0x9e3779b9u;
   float random=float(hash)*2.3283064365386963e-10;
   float weight=sat(random*(scalar(356)-scalar(352))+scalar(352));
   position=direction*(extent*weight-speed*timing.y)+origin;
   bool near=distanceSquared<0.1;
   if(near)position+=direction*-(abs(speed)<0.0001?extent:speed*0.03333333507180214);
   if(mode>4.5)position=emitterPosition;
   xAxis=right;yAxis=up;zAxis=forward;translation=position;life=particleLife;
   h0=vec2(0.0);h1=vec2(0.0);h2=vec2(near?0.0:1.0,0.0);
   h3=vec2(-1000.0);h4=vec2(0.0);h5=vec2(0.0,random);
 } else {
   vec4 a=uintBitsToFloat(previous(0)),b=uintBitsToFloat(previous(1)),c=uintBitsToFloat(previous(2)),d=uintBitsToFloat(previous(3));
   uvec4 e=previous(4),g=previous(5);
   xAxis=a.xyz;yAxis=b.xyz;zAxis=c.xyz;translation=vec3(a.w,b.w,c.w);position=d.xyz;life=d.w;
   h0=unpackHalf2x16(e.x);h1=unpackHalf2x16(e.y);h2=unpackHalf2x16(e.z);
   h3=unpackHalf2x16(e.w);h4=unpackHalf2x16(g.x);h5=unpackHalf2x16(g.y);
   if(life<=0.0){xAxis=vec3(0.0);yAxis=vec3(0.0);zAxis=vec3(0.0);translation=vec3(0.0);position=vec3(0.0);life=0.0;}
   else {
     vec3 scales=vec3(length(xAxis),length(yAxis),length(zAxis));
     if(!valid)origin=muzzle;
     if(age<0.04) {
       float weight=sat(h5.y*(scalar(356)-scalar(352))+scalar(352));
       float ratio=extent*weight/max(speed*0.03333333507180214,0.00001);
       speed=max(1.0-ratio,0.0)*speed;
     }
     vec3 direction=up;
     if(!fromFallback&&valid&&h2.x>0.5){vec3 muzzleDirection=normalize(emitterPosition-muzzle);direction=(up-muzzleDirection)*sat((age-0.03333333507180214)*30.0)+muzzleDirection;}
     vec3 candidate=direction*(speed*timing.y)+translation;
     float signedDistance=dot(candidate-emitterPosition,up);
     float convergence=signedDistance>0.0?0.0:sat((age-0.03333333507180214)*29.999998092651367);
     vec3 nextPosition=convergence==1.0?emitterPosition:(emitterPosition-candidate)*convergence+candidate;
     float lower=dot(nextPosition-emitterPosition,up);
     if(lower>0.0)nextPosition=up*lower+emitterPosition;
     float upper=valid?dot(nextPosition-origin,up):abs(speed)<0.001?-1000.0:dot(nextPosition-candidate,up);
     vec3 motion=nextPosition-position;direction=dot(motion,motion)>0.01?normalize(motion):up;
     if(valid){float weight=sat((upper-extent)/(extent*3.0));vec3 muzzleDirection=normalize(nextPosition-origin);direction=normalize((direction-muzzleDirection)*weight+muzzleDirection);}
     if(mode<4.5)translation=candidate;
     if(abs(defaultSpeed)>0.01){nextPosition=candidate;xAxis=right;direction=up;zAxis=forward;upper=signedDistance;lower=-1000.0;}
     else {xAxis=normalize(cross(forward,direction));zAxis=normalize(cross(direction,xAxis));}
     if((age>0.3333333432674408&&abs(speed)<0.00001)||mode>0.5){nextPosition=emitterPosition;xAxis=right;direction=up;zAxis=forward;lower=-1000.0;upper=1000.0;}
     if(mode>1.5)nextPosition=candidate;
     if(mode>2.5)nextPosition=origin;
     if(mode>3.5)nextPosition=fallback;
     if(mode>4.5){upper=dot(emitterPosition-translation,up);nextPosition=emitterPosition;xAxis=right;direction=up;zAxis=forward;lower=-1000.0;}
     float visibility=1.0,offset=0.0;
     for(int sampleIndex=0;sampleIndex<6;sampleIndex++) {
       float displacement=segmentLength*offset;
       if(upper<abs(displacement)||abs(displacement)<lower)visibility-=0.3;
       else if(occluded(direction*displacement+nextPosition))visibility-=0.1666666716337204;
       offset-=0.2;
     }
     h1.y=max(visibility,0.0)*sat(1.0-lower/segmentLength);h3=vec2(upper,lower);
     xAxis*=scales.x;yAxis=direction*scales.y;zAxis*=scales.z;position=nextPosition;
   }
 }
 if(column==0)particleOutput=floatBitsToUint(vec4(xAxis,translation.x));
 else if(column==1)particleOutput=floatBitsToUint(vec4(yAxis,translation.y));
 else if(column==2)particleOutput=floatBitsToUint(vec4(zAxis,translation.z));
 else if(column==3)particleOutput=floatBitsToUint(vec4(position,life));
 else if(column==4)particleOutput=uvec4(halves(h0),halves(h1),halves(h2),halves(h3));
 else particleOutput=uvec4(halves(h4),halves(h5),0u,0u);
}`;

export function createRifleParticleGpu(renderer,capacity=30) {
 if(!Number.isInteger(capacity)||capacity<1)throw new Error('Invalid rifle particle capacity');
 const emitterBytes=new Uint32Array(228*capacity),timings=new Float32Array(4*capacity);
 const emitters=new THREE.DataTexture(emitterBytes,57,capacity,THREE.RGBAIntegerFormat,THREE.UnsignedIntType);
 emitters.internalFormat='RGBA32UI';emitters.needsUpdate=true;
 const timingTexture=new THREE.DataTexture(timings,1,capacity,THREE.RGBAFormat,THREE.FloatType);timingTexture.needsUpdate=true;
 const blank=new THREE.DataTexture(new Uint32Array(24*capacity),6,capacity,THREE.RGBAIntegerFormat,THREE.UnsignedIntType);
 blank.internalFormat='RGBA32UI';blank.needsUpdate=true;
 const targets=Array.from({length:2},()=>new THREE.WebGLRenderTarget(6,capacity,{format:THREE.RGBAIntegerFormat,type:THREE.UnsignedIntType,internalFormat:'RGBA32UI',depthBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter}));
 const uniforms={emitterData:{value:emitters},previousParticles:{value:blank},timingData:{value:timingTexture},sceneDepth:{value:null},depthViewProjection:{value:new THREE.Matrix4()},depthConvention:{value:0}};
 const material=new THREE.RawShaderMaterial({glslVersion:THREE.GLSL3,uniforms,depthTest:false,depthWrite:false,blending:THREE.NoBlending,
   vertexShader:'precision highp float;in vec3 position;void main(){gl_Position=vec4(position.xy,0.0,1.0);}',fragmentShader:RIFLE_PARTICLE_GPU_GLSL});
 const quad=new FullScreenQuad(material);let current=null,frames=0;
 return {
   emitters,capacity,
   get texture(){return current?.texture??blank;},
   // Compiles the kernel program at load; the first shot otherwise compiles it mid-round.
   async prepare(camera){const scene=new THREE.Scene(),geometry=new THREE.PlaneGeometry(2,2);scene.add(new THREE.Mesh(geometry,material));try{await renderer.compileAsync(scene,camera);}finally{geometry.dispose();}},
   set(slot,bytes,{time,dt,spawn=false,hold=false,active=true}) {
     if(!Number.isInteger(slot)||slot<0||slot>=capacity||bytes.byteLength!==912)throw new Error('Invalid native emitter record');
     const source=bytes instanceof ArrayBuffer?new Uint8Array(bytes):new Uint8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength);
     new Uint8Array(emitterBytes.buffer,slot*912,912).set(source);
     timings.set([time,dt,spawn?1:hold?-1:0,active?1:0],slot*4);
   },
   deactivate(slot){timings[slot*4+3]=0;},
   step({depth,viewProjection,convention='native-reversed'}) {
     if(!depth||!viewProjection)throw new Error('Particle depth and projection must be explicit');
     if(!['native-reversed','webgl-normal'].includes(convention))throw new Error('Unknown depth convention');
     emitters.needsUpdate=true;timingTexture.needsUpdate=true;
     uniforms.previousParticles.value=current?.texture??blank;uniforms.sceneDepth.value=depth;
     uniforms.depthViewProjection.value.copy(viewProjection);uniforms.depthConvention.value=convention==='native-reversed'?0:1;
     const next=targets[current===targets[0]?1:0],saved=renderer.getRenderTarget(),autoClear=renderer.autoClear;
     try {renderer.autoClear=false;renderer.setRenderTarget(next);quad.render(renderer);current=next;frames++;}
     finally {renderer.setRenderTarget(saved);renderer.autoClear=autoClear;}
   },
   read(){const data=new Uint32Array(24*capacity);if(current)renderer.readRenderTargetPixels(current,0,0,6,capacity,data);return data;},
   snapshot:()=>({frames,capacity,format:'RGBA32UI',particleStride:88,storageStride:96,evidenceId:'BF2-RIFLE-PARTICLE-WARP-001',limitations:'Original kernel algebra; runtime parameter producers and scheduling remain explicit reconstruction choices. Hardware float lowering can differ at strict clip boundaries.'}),
   dispose(){emitters.dispose();timingTexture.dispose();blank.dispose();for(const target of targets)target.dispose();material.dispose();quad.dispose();},
 };
}
