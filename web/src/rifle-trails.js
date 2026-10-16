import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {prepareRecoveredBlasterBoltPixel,BLASTER_BOLT_GLSL} from './blaster-bolt-material.js';
import {BLASTER_BOLT_VERTEX_GLSL} from './blaster-bolt-vertex.js';
import {createRifleParticleGpu} from './rifle-particle-gpu.js';

export const BLASTER_BOLT_BUFFER_GLSL=`
uniform highp usampler2D boltEmitters;
uniform highp usampler2D boltParticles;
uint bf2EmitterWord(uint element,uint word) {
 if(element>=uint(textureSize(boltEmitters,0).y)||word>=228u)return 0u;
 return texelFetch(boltEmitters,ivec2(int(word/4u),int(element)),0)[word%4u];
}
uint bf2ParticleWord(uint word) {
 uint element=word/22u,localWord=word%22u;
 if(element>=uint(textureSize(boltParticles,0).y))return 0u;
 return texelFetch(boltParticles,ivec2(int(localWord/4u),int(element)),0)[localWord%4u];
}
uvec4 bf2BoltEmitter(uint element,uint offset) {
 uint w=offset/4u;return uvec4(bf2EmitterWord(element,w),bf2EmitterWord(element,w+1u),bf2EmitterWord(element,w+2u),bf2EmitterWord(element,w+3u));
}
uvec4 bf2BoltParticle(uint offset) {
 uint w=offset/4u;return uvec4(bf2ParticleWord(w),bf2ParticleWord(w+1u),bf2ParticleWord(w+2u),bf2ParticleWord(w+3u));
}
uvec4 bf2BoltDrawIndex(uint element,uint offset) {return uvec4(0u);}
`;

export async function prepareRifleTrails(materialDocument,emitterDocument,manager) {
 if(emitterDocument.particleCount!==1||emitterDocument.particleStride!==88||emitterDocument.depthTest!==false)throw new Error('Unsupported recovered rifle emitter');
 const [pixel,gltf]=await Promise.all([prepareRecoveredBlasterBoltPixel(materialDocument,manager),new GLTFLoader(manager).loadAsync(materialDocument.sourceMesh.url)]);
 let geometry;gltf.scene.traverse(object=>{if(object.isMesh&&!geometry)geometry=object.geometry;});
 if(!geometry||geometry.attributes.position.count!==363||geometry.index.count!==1350)throw new Error('Original blaster geometry is incomplete');
 return {pixel,geometry,document:emitterDocument};
}

export function createRifleTrails(renderer,prepared) {
 const {pixel,geometry,document}=prepared,capacity=document.effectLimit;
 const kernel=createRifleParticleGpu(renderer,capacity),scene=new THREE.Scene(),records=Array(capacity).fill(null);
 const cameraConstants=new Float32Array(152),viewProjection=new THREE.Matrix4(),cameraRotation=new THREE.Matrix4();
 const cameraPosition=new THREE.Vector3(),right=new THREE.Vector3(),forward=new THREE.Vector3(),worldUp=new THREE.Vector3(0,1,0);
 const shared={boltEmitters:{value:kernel.emitters},boltParticles:{value:kernel.texture},boltCB2:{value:cameraConstants},
   boltViewport:{value:new THREE.Vector2(1,1)},boltSceneDepth:{value:null},boltCameraPosition:{value:cameraPosition},boltGlobal40:{value:new THREE.Vector4(0,0,1,1)},...pixel.uniforms};
 const varyings=Array.from({length:8},(_,i)=>`vec4 boltV${i+1};`);
 const vertexShader=`precision highp float;precision highp int;
   in vec3 position;in vec2 uv;uniform vec4 boltCB1[3];uniform vec4 boltCB2[38];
   ${varyings.map(v=>'out '+v).join('\n')}
   ${BLASTER_BOLT_VERTEX_GLSL}\n${BLASTER_BOLT_BUFFER_GLSL}
   void main(){BlasterBoltVertex result=evaluateBlasterBoltVertex(position,uv,0u,boltCB1,boltCB2);
     gl_Position=result.clip;${Array.from({length:8},(_,i)=>`boltV${i+1}=result.v${i+1};`).join('')}}`;
 const fragmentShader=`precision highp float;precision highp int;
   ${varyings.map(v=>'in '+v).join('\n')}
   uniform vec2 boltViewport;uniform sampler2D boltSceneDepth;uniform vec3 boltCameraPosition;uniform vec4 boltGlobal40;
   uniform vec3 bf2_bolt_multiplier;uniform sampler2D bf2_bolt_side;uniform sampler2D bf2_bolt_top;
   uniform sampler2D bf2_bolt_iris;uniform sampler2D bf2_bolt_screenFlare;
   layout(location=0) out vec4 boltColor;
   ${BLASTER_BOLT_GLSL.replaceAll('texture2D(', 'texture(')}
   void main(){
     BlasterBoltVaryings v=BlasterBoltVaryings(boltV1,boltV2,boltV3,boltV4,boltV5,boltV7,boltV6.xyz,boltV8.xy);
     vec3 nativeScreen=vec3(gl_FragCoord.x,boltViewport.y-gl_FragCoord.y,1.0-gl_FragCoord.z);
     BlasterBoltPixel result=sampleBlasterBolt(v,nativeScreen,1.0/boltViewport,boltCameraPosition,bf2_bolt_multiplier,
       boltGlobal40,1.0,bf2_bolt_side,bf2_bolt_top,bf2_bolt_iris,bf2_bolt_screenFlare);
     // The source emits separate MRT2 depth/coverage with fixed-function Z off.
     // Its later compositor is not yet recovered. Resolve that depth explicitly
     // against opaque depth here; the original radiance/coverage math stays intact.
     float opaqueReversed=1.0-texelFetch(boltSceneDepth,ivec2(gl_FragCoord.xy),0).r;
     if(result.depthCoverage.x<opaqueReversed)discard;
     boltColor=vec4(result.radiance,0.0);
   }`;
 const materials=Array.from({length:capacity},(_,slot)=>{
   const cb1=new Float32Array(12);cb1[9]=slot;
   return new THREE.RawShaderMaterial({glslVersion:THREE.GLSL3,uniforms:{...shared,boltCB1:{value:cb1}},vertexShader,fragmentShader,
     depthTest:document.depthTest,depthWrite:false,transparent:true,side:THREE.DoubleSide,forceSinglePass:true,blending:THREE.CustomBlending,
     blendEquation:THREE.AddEquation,blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor,toneMapped:false});
 });
 let time=0,serial=0,spawned=0,evicted=0,presentations=0;
 const writeEmitter=record=>{
   const {projectile,bytes}=record,floats=new Float32Array(bytes),uints=new Uint32Array(bytes);
   const direction=projectile.direction,position=projectile.position;
   right.crossVectors(direction,worldUp);if(right.lengthSq()<1e-8)right.set(1,0,0);right.normalize();
   forward.crossVectors(right,direction).normalize();
   for(const offset of [0,16,32]) {
     floats.set([right.x,direction.x,forward.x,position.x,right.y,direction.y,forward.y,position.y,right.z,direction.z,forward.z,position.z,0,0,0,1],offset);
   }
   floats[48]=projectile.age;floats[49]=0;floats[50]=0;floats[51]=document.particleLife;
   uints[52]=0;uints[53]=1;uints[54]=1;uints[62]=record.slot*88;uints[63]=88;
   floats[196]=projectile.weapon.projectileSpeed;floats.set([1,1,1,0],200);floats.set([...record.origin,0],204);
 };
 const remove=record=>{record.mesh.removeFromParent();records[record.slot]=null;kernel.deactivate(record.slot);};
 const clean=()=>{for(const record of records)if(record&&record.mesh.parent!==scene)remove(record);};
 return {
   scene,
   async prepare(camera){const preview=new THREE.Scene();preview.add(new THREE.Mesh(geometry,materials[0]));await renderer.compileAsync(preview,camera);await kernel.prepare?.(camera);},
   create(projectile,{time:createdTime=0}={}) {
     clean();let slot=records.indexOf(null);
     if(slot<0){const oldest=records.reduce((a,b)=>a.serial<b.serial?a:b);slot=oldest.slot;remove(oldest);evicted++;}
     const mesh=new THREE.Mesh(geometry,materials[slot]);mesh.frustumCulled=false;mesh.userData.recoveredRifleTrail=true;scene.add(mesh);
     const bytes=new ArrayBuffer(912),floats=new Float32Array(bytes);document.graphParams.forEach((p,i)=>floats.set(p,68+i*4));
     const record={slot,serial:serial++,projectile,mesh,bytes,origin:projectile.position.clone(),createdTime,lastTime:createdTime,pending:true};
     records[slot]=record;spawned++;return mesh;
   },
   setTime(value){time=value;},
   render(camera,depth,width,height) {
     clean();if(!records.some(Boolean))return;
     camera.updateMatrixWorld();camera.getWorldPosition(cameraPosition);
     viewProjection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
     const hasNew=records.some(record=>record?.pending);
     if(hasNew) {
       for(const record of records)if(record) {
         writeEmitter(record);
         // The gameplay tick has already advanced the projectile before its
         // first presentation, even when createdTime equals the current clock.
         // Spawn at its attached emitter endpoint; retain launch origin only
         // as the explicit muzzle input. This avoids a backwards startup jump.
         kernel.set(record.slot,record.bytes,{time:record.createdTime,dt:record.pending?record.projectile.age:0,spawn:record.pending,hold:!record.pending});
       }
       kernel.step({depth,viewProjection,convention:'webgl-normal'});
     }
     for(const record of records)if(record) {
       writeEmitter(record);
       kernel.set(record.slot,record.bytes,{time,dt:record.pending?record.projectile.age:Math.max(0,time-record.lastTime)});record.lastTime=time;record.pending=false;
     }
     kernel.step({depth,viewProjection,convention:'webgl-normal'});shared.boltParticles.value=kernel.texture;
     cameraConstants.fill(0);cameraConstants[0]=time;
     const world=camera.matrixWorld.elements;
     for(let axis=0;axis<3;axis++)cameraConstants.set(world.slice(axis*4,axis*4+3),(2+axis)*4);
     cameraRotation.extractRotation(camera.matrixWorld).transpose();viewProjection.multiplyMatrices(camera.projectionMatrix,cameraRotation);
     const matrix=viewProjection.elements;
     for(let row=0;row<4;row++)cameraConstants.set([matrix[row],matrix[row+4],matrix[row+8],matrix[row+12]],(14+row)*4);
     cameraConstants.set(cameraPosition.toArray(),37*4);shared.boltViewport.value.set(width,height);shared.boltSceneDepth.value=depth;
     const autoClear=renderer.autoClear;renderer.autoClear=false;
     try{renderer.render(scene,camera);}finally{renderer.autoClear=autoClear;}presentations++;
   },
   reset(){for(const record of records)if(record)remove(record);},
   readParticles:()=>kernel.read(),
   snapshot:()=>({active:records.filter(Boolean).length,spawned,evicted,presentations,capacity,kernel:kernel.snapshot(),provenance:document}),
   dispose(){this.reset();kernel.dispose();for(const material of materials)material.dispose();},
 };
}
