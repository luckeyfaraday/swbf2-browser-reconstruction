import * as THREE from 'three';
import {FullScreenQuad} from 'three/addons/postprocessing/Pass.js';
import {NATIVE_VIGNETTE_GLSL,nativeVignetteParameters} from './source-vignette.js';

// Original linear HDR Tonemap followed by SDR MergeRenderPlanes. The source
// shoulder and authored grade are already baked by unchanged native compute DXBC.
// Float32 cube texels retain every source RGB10 value; hardware filtering has a
// separate packed-original versus float witness. Native vignette precedes PQ;
// GaussianSimple bloom (source-bloom.js) is added before exposure.
export const NATIVE_GRADING_FRAGMENT_GLSL=`
precision highp float;
precision highp sampler3D;
uniform sampler2D source;
uniform sampler3D gradingCube;
uniform sampler2D pqToLinear;
uniform float exposure;
uniform int stage;
uniform bool quantizePlane;
uniform bool vignetteEnabled;
uniform vec3 vignetteParams;
uniform vec4 vignetteColor;
uniform bool bloomEnabled;
uniform sampler2D bloomTexture;
uniform vec3 bloomScale;
in vec2 screenUv;
out vec4 gradedOutput;
${NATIVE_VIGNETTE_GLSL}
vec3 nativePQ(vec3 linearColor) {
  vec3 p = exp2(log2(linearColor * 0.01) * 0.1593017578125);
  return exp2(log2((p * 18.8515625 + 0.8359375) / (p * 18.6875 + 1.0)) * 78.84375);
}
vec3 nativeGrade(vec3 color) {
  return texture(gradingCube, nativePQ(color) * 0.9696969985961914 + 0.01515151560306549).rgb;
}
vec3 nativeSdrMerge(vec3 pq) {
  vec3 color = vec3(texture(pqToLinear, vec2(pq.x, 0.5)).r,
                    texture(pqToLinear, vec2(pq.y, 0.5)).r,
                    texture(pqToLinear, vec2(pq.z, 0.5)).r);
  color = clamp(color, 0.0, 1.0);
  vec3 low = color * 12.92;
  vec3 high = exp2(log2(color) * 0.4166666567325592) * 1.055 - 0.055;
  return mix(high, low, lessThanEqual(color, vec3(0.0031308)));
}
vec4 nativeRenderPlane(vec3 grade) {
  vec4 rgba=vec4(grade,dot(grade,vec3(0.212671,0.715160,0.072169)));
  vec4 scale=vec4(1023.0,1023.0,1023.0,3.0);
  return roundEven(clamp(rgba,0.0,1.0)*scale)/scale;
}
void main() {
  vec3 inputColor = texture(source, screenUv).rgb;
  // Native Tonemap: main + bloomScale*tonemapBloomTexture precedes colorScale and vignette.
  if(bloomEnabled)inputColor += bloomScale * texture(bloomTexture, screenUv).rgb;
  vec3 exposed=inputColor*exposure;
  if(vignetteEnabled)exposed=nativeVignette(exposed,screenUv,vignetteParams,vignetteColor);
  if(stage == 3){gradedOutput=vec4(nativePQ(exposed),1.0);return;}
  vec3 grade = stage == 1 || stage == 5 || stage == 7 ? inputColor : stage == 4 ? texture(gradingCube,inputColor*0.9696969985961914+0.01515151560306549).rgb : nativeGrade(exposed);
  if(stage == 5 || stage == 9){gradedOutput=nativeRenderPlane(grade);return;}
  if(stage == 6 || stage == 7 || (stage == 2 && quantizePlane))grade=nativeRenderPlane(grade).rgb;
  gradedOutput = stage == 0 || stage == 4 ? vec4(grade, dot(grade, vec3(0.212671, 0.715160, 0.072169)))
                           : vec4(nativeSdrMerge(grade), 1.0);
}`;

export function createNativeGradingTextures(cubeValues,pqWords) {
  if(!(cubeValues instanceof Float32Array)||cubeValues.length!==33**3*4)throw new Error('Expected original33-cubed grading values');
  if(!(pqWords instanceof Uint16Array)||pqWords.length!==1024)throw new Error('Expected native1024-entry half-float PQ lookup');
  const cube=new THREE.Data3DTexture(cubeValues,33,33,33);
  cube.name='Original indoor grade and native SDR shoulder';cube.format=THREE.RGBAFormat;cube.type=THREE.FloatType;
  const pq=new THREE.DataTexture(pqWords,1024,1,THREE.RedFormat,THREE.HalfFloatType);
  pq.name='Native SDR PQ to linear lookup';
  for(const texture of [cube,pq]){
    texture.minFilter=texture.magFilter=THREE.LinearFilter;
    texture.wrapS=texture.wrapT=texture.wrapR=THREE.ClampToEdgeWrapping;
    texture.generateMipmaps=false;texture.colorSpace=THREE.NoColorSpace;texture.unpackAlignment=1;texture.needsUpdate=true;
  }
  return {cube,pq,dispose(){cube.dispose();pq.dispose();}};
}

export async function prepareNativeGrading(document,{fetch:fetchPayload=globalThis.fetch}={}) {
  if(document?.version!==1||document.evidenceId!=='BF2-NATIVE-COLORGRADING-BASELINE-001'||
     document.authoredCube?.size!==33||document.baseline?.outputConversion!==1||
     document.baseline?.postGradeExposure?.[0]!==.5||document.baseline?.postGradeExposure?.[1]!==1)throw new Error('Unsupported original SDR grading baseline');
  if(document.renderPlane?.format!=='R10G10B10A2_UNORM'||document.renderPlane?.nativeFormat!==27||
     document.renderPlane?.dxgiFormat!==24||document.renderPlane?.mergeTextureSlot!==0||
     document.renderPlane?.displayMode!==0)throw new Error('Unsupported original SDR render plane');
  const payloads=await Promise.all([document.cube,document.pq].map(async row=>{
    const response=await fetchPayload(row.url);if(!response.ok)throw new Error(`Original grading payload HTTP ${response.status}`);
    const bytes=await response.arrayBuffer();if(bytes.byteLength!==row.byteLength)throw new Error('Original grading payload size mismatch');
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
    if(hash!==row.sha256)throw new Error('Original grading payload hash mismatch');return bytes;
  }));
  const textures=createNativeGradingTextures(new Float32Array(payloads[0]),new Uint16Array(payloads[1]));
  return {textures,quantizePlane:true,snapshot:()=>({evidenceId:document.evidenceId,authoredCube:document.authoredCube.name,
    size:33,lookupWidth:1024,bytes:payloads.reduce((sum,b)=>sum+b.byteLength,0),baseline:document.baseline,
    renderPlane:{...document.renderPlane,quantizationApplied:true},
    limits:document.limitations,numericPolicy:document.validation.numericPolicy}),dispose:()=>textures.dispose()};
}

export function createNativeGradingPass(textures,{quantizePlane=false,vignette=null}={}) {
  const nativeVignette=nativeVignetteParameters(vignette);
  const material=new THREE.RawShaderMaterial({name:'Original HDR grade and SDR merge',glslVersion:THREE.GLSL3,
    depthTest:false,depthWrite:false,toneMapped:false,blending:THREE.NoBlending,
    uniforms:{source:{value:null},gradingCube:{value:textures.cube},pqToLinear:{value:textures.pq},exposure:{value:1},stage:{value:2},quantizePlane:{value:quantizePlane},
      vignetteEnabled:{value:nativeVignette.enabled},vignetteParams:{value:new THREE.Vector3(...nativeVignette.params)},vignetteColor:{value:new THREE.Vector4(...nativeVignette.color)},
      bloomEnabled:{value:false},bloomTexture:{value:null},bloomScale:{value:new THREE.Vector3()}},
    vertexShader:'precision highp float;in vec3 position;out vec2 screenUv;void main(){screenUv=position.xy*.5+.5;gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader:NATIVE_GRADING_FRAGMENT_GLSL});
  const quad=new FullScreenQuad(material);
  return {material,
    setBloom(texture,scale=[0,0,0]){material.uniforms.bloomEnabled.value=!!texture;material.uniforms.bloomTexture.value=texture??null;material.uniforms.bloomScale.value.fromArray(scale);},
    render(renderer,source,exposure=1,target=null,stage=2){
    material.uniforms.source.value=source;material.uniforms.exposure.value=exposure;material.uniforms.stage.value=stage;
    renderer.setRenderTarget(target);quad.render(renderer);
  },dispose(){material.dispose();quad.dispose();}};
}
