import * as THREE from 'three';
import {getDFGLUT} from 'three/src/renderers/shaders/DFGLUTData.js';

// BF2-NATIVE-FG-WARP-001. Original installed PS/VS generated this LUT on CPU
// WARP. It is separate from Three's DFG LUT and does not replace its BRDF.
export const SOURCE_DFG_GLSL = /* glsl */`
uniform sampler2D bf2_sourceDFG;
vec3 bf2_sampleSourceDFG(float dotNV, float perceptualRoughness) {
  float roughness = clamp(perceptualRoughness, 0.0, 1.0);
  // Clamp at texel centers, preserving the original clamp-to-edge response
  // when the same texture's unused alpha stores an azimuth-wrapping IES map.
  vec2 uv = clamp(vec2(dotNV, roughness * roughness), vec2(0.5 / 128.0), vec2(127.5 / 128.0));
  return texture2D(bf2_sourceDFG, uv).rgb;
}
float bf2_sampleSourceIes(vec2 uv) {
  // Azimuth still uses the texture's original RepeatS addressing. Clamp the
  // native 128-row elevation domain.
  uv.y = clamp(uv.y, 0.5 / 128.0, 127.5 / 128.0);
  return texture2D(bf2_sourceDFG, uv).a;
}
`;

// Layer0 has exactly the original dimensions/coordinates. Array layers do not
// interpolate into each other. This avoids the rejected 2D-atlas Y offset,
// which lost float32 low bits at hardware bilinear weight boundaries.
export const SOURCE_DFG_ARRAY_GLSL = SOURCE_DFG_GLSL
  .replace('uniform sampler2D bf2_sourceDFG;', 'uniform highp sampler2DArray bf2_sourceDFG;')
  .replaceAll('texture2D(bf2_sourceDFG, uv)', 'texture(bf2_sourceDFG, vec3(uv, 0.0))');

export const SHARED_THREE_DFG_GLSL = /* glsl */`
vec2 bf2_sampleThreeDfg(vec2 uv) {
  uv = clamp(uv, vec2(0.5 / 16.0), vec2(15.5 / 16.0));
  return texture(bf2_sourceDFG, vec3(uv / 8.0, 1.0)).rg;
}
`;

function sourceWords(document, buffer) {
  if (document?.version !== 1 || document.width !== 128 || document.height !== 128 ||
      document.format !== 'R16G16B16A16_FLOAT' || document.byteLength !== 128 * 128 * 8 ||
      !(buffer instanceof ArrayBuffer) || buffer.byteLength !== document.byteLength) {
    throw new Error('Invalid source DFG document or half-float payload');
  }
  const words = new Uint16Array(buffer);
  if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) {
    const view = new DataView(buffer);
    for (let i = 0; i < words.length; i++) words[i] = view.getUint16(i * 2, true);
  }
  for (let index = 0; index < words.length; index++) {
    if ((words[index] & 0x7c00) === 0x7c00 || (index % 4 === 3 && words[index] !== 0)) {
      throw new Error('Invalid source DFG coefficient');
    }
  }
  return words;
}

export function createSourceDfgTexture(document, buffer) {
  const words = sourceWords(document, buffer);
  const texture = new THREE.DataTexture(words, 128, 128, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.name = 'BF2 original FG generator (D3D11 WARP)';
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.generateMipmaps = false;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.userData.sourceDfg = {evidenceId: document.evidenceId, sha256: document.sha256,
    coordinates: 'NdotV, perceptualRoughnessSquared', channels: 'specularScale, specularBias, diffuseFactor, zero'};
  texture.needsUpdate = true;
  return texture;
}

/** Browser packing only: preserve all source RGB words and use the original
 * zero alpha lane for the equally sized half-float IES profile. Source payload
 * buffers remain unchanged. DFG clamps coordinates; IES wraps azimuth. */
export function packSourceIesIntoDfg(texture, ies) {
  if(!texture?.isDataTexture||!ies?.isDataTexture||texture.type!==THREE.HalfFloatType||ies.type!==THREE.HalfFloatType||
    texture.format!==THREE.RGBAFormat||ies.format!==THREE.RedFormat||
    texture.image.width!==128||texture.image.height!==128||ies.image.width!==128||ies.image.height!==128||
    !(texture.image.data instanceof Uint16Array)||!(ies.image.data instanceof Uint16Array)||
    texture.image.data.length!==128*128*4||ies.image.data.length!==128*128)throw new TypeError('Combined source lighting lookup requires original128x128 half-float DFG and IES');
  if(texture.userData.sourceIesPacking)throw new Error('Source IES is already packed');
  const words=texture.image.data.slice();
  for(let i=0;i<ies.image.data.length;i++) {
    if(words[i*4+3]!==0)throw new Error('Source DFG alpha must be unused');
    words[i*4+3]=ies.image.data[i];
  }
  texture.image.data=words;
  texture.wrapS=THREE.RepeatWrapping;texture.wrapT=THREE.ClampToEdgeWrapping;
  texture.userData.sourceIesPacking={evidenceId:'BF2-SOURCE-LIGHT-LOOKUP-PACKING-001',
    policy:'Browser lossless channel packing: original DFG RGB and IES alpha. DFG half-texel clamp preserves original clamp-to-edge; IES retains repeatU/clampV.',
    ies:ies.userData.source??null};
  texture.needsUpdate=true;
  return texture;
}

/** Keep Three's existing fallback BRDF table byte-for-byte, in an independent
 * layer of the same browser lookup. No source/material BRDF is substituted.
 * Returns a new texture without changing or disposing the source texture. */
export function packThreeDfgIntoSourceLookup(texture, fallback = getDFGLUT()) {
  if (!texture?.isDataTexture || texture.type !== THREE.HalfFloatType || texture.format !== THREE.RGBAFormat ||
      texture.image.width !== 128 || texture.image.height !== 128 ||
      !(texture.image.data instanceof Uint16Array) || texture.image.data.length !== 128*128*4 ||
      !texture.userData.sourceIesPacking || !fallback?.isDataTexture ||
      fallback.type !== THREE.HalfFloatType || fallback.format !== THREE.RGFormat ||
      fallback.image.width !== 16 || fallback.image.height !== 16 ||
      !(fallback.image.data instanceof Uint16Array) || fallback.image.data.length !== 16*16*2 ||
      fallback.minFilter !== THREE.LinearFilter || fallback.magFilter !== THREE.LinearFilter ||
      fallback.wrapS !== THREE.ClampToEdgeWrapping || fallback.wrapT !== THREE.ClampToEdgeWrapping) {
    throw new TypeError('Shared lookup requires packed source128x128 RGBA16F and unchanged Three16x16 RG16F');
  }
  if (texture.userData.sharedThreeDfgPacking) throw new Error('Three DFG is already packed');
  const words = new Uint16Array(128*128*2*4);
  words.set(texture.image.data);
  for (let y=0;y<16;y++) for (let x=0;x<16;x++) {
    const source=(y*16+x)*2, target=((128+y)*128+x)*4;
    words[target]=fallback.image.data[source]; words[target+1]=fallback.image.data[source+1];
  }
  const array = new THREE.DataArrayTexture(words,128,128,2);
  array.name='BF2 source DFG/IES and unchanged Three fallback DFG';
  array.type=THREE.HalfFloatType;array.format=THREE.RGBAFormat;
  array.colorSpace=THREE.NoColorSpace;array.flipY=false;array.generateMipmaps=false;
  array.wrapS=THREE.RepeatWrapping;array.wrapT=THREE.ClampToEdgeWrapping;
  array.minFilter=array.magFilter=THREE.LinearFilter;
  array.userData={...texture.userData,sharedThreeDfgPacking:{evidenceId:'BF2-SHARED-LIGHT-LOOKUP-002',
    sourceRegion:{layer:0,x:0,y:0,width:128,height:128}, threeRegion:{layer:1,x:0,y:0,width:16,height:16},
    source:'Three pinned runtime getDFGLUT()16x16 RG16F; browser fallback data, not a recovered BF2 table',
    policy:'Lossless half-word placement in128x128x2 RGBA16F. Native coordinates are unchanged; Three coordinates divide by8 without a translation. Shared hardware linear filtering preserves independent original clamp/repeat domains. Existing fallback direct-light equations remain unchanged.',
    rejectedAlternative:'128x256 2D rebasing caused GPU filter-weight differences; retained rejected report source-shared-lookup-rejected-2d-rebase.json'}};
  array.needsUpdate=true;
  return array;
}

/** Run AFTER all direct-light chunk decorators. Expanding the chunk earlier
 * would prevent source-light-channels from installing source switches/calls. */
export function injectSharedThreeDfg(shader, texture) {
  if (!texture?.isDataArrayTexture || !texture.userData.sharedThreeDfgPacking || texture.image.width !== 128 || texture.image.height !== 128 || texture.image.depth !== 2) {
    throw new Error('Shared Three DFG requires the complete128x128x2 array lookup');
  }
  if (shader.fragmentShader.includes('vec2 bf2_sampleThreeDfg(')) throw new Error('Shared Three DFG is already injected');
  if (shader.uniforms.bf2_sourceDFG && shader.uniforms.bf2_sourceDFG.value !== texture) throw new Error('Source and Three DFG must share one texture');
  let source=shader.fragmentShader;
  for (const chunk of ['lights_fragment_begin','lights_physical_pars_fragment']) {
    source=source.replace(`#include <${chunk}>`,THREE.ShaderChunk[chunk]);
  }
  const reads=[
    ['texture2D( dfgLUT, vec2( material.roughness, dotNVms ) ).rg','bf2_sampleThreeDfg(vec2(material.roughness,dotNVms))'],
    ['texture2D( dfgLUT, vec2( roughness, dotNV ) ).rg','bf2_sampleThreeDfg(vec2(roughness,dotNV))'],
  ];
  for (const [before,after] of reads) {
    if (source.split(before).length !== 2) throw new Error('Shared Three DFG shader revision mismatch');
    source=source.replace(before,after);
  }
  source=source.replace('uniform sampler2D dfgLUT;','');
  if (/\bdfgLUT\b/.test(source)) throw new Error('Unexpected remaining Three DFG shader use');
  if (source.includes(SOURCE_DFG_GLSL)) source=source.replace(SOURCE_DFG_GLSL,SOURCE_DFG_ARRAY_GLSL);
  else if (!source.includes(SOURCE_DFG_ARRAY_GLSL)) {
    if (/uniform\s+\w+\s+bf2_sourceDFG;/.test(source)) throw new Error('Unexpected source lookup declaration');
    source=SOURCE_DFG_ARRAY_GLSL+source;
  }
  shader.fragmentShader=source.replace('uniform highp sampler2DArray bf2_sourceDFG;',
    'uniform highp sampler2DArray bf2_sourceDFG;\n'+SHARED_THREE_DFG_GLSL);
  shader.uniforms.bf2_sourceDFG={value:texture};
  delete shader.uniforms.dfgLUT;
  return texture.userData.sharedThreeDfgPacking;
}

export function sampleSourceDfg(texture, dotNV, perceptualRoughness, result = [0, 0, 0]) {
  if (!(texture?.isDataTexture || (texture?.isDataArrayTexture && texture.image.depth === 2 && texture.userData.sharedThreeDfgPacking)) || texture.image.width !== 128 || texture.image.height !== 128 ||
      texture.type !== THREE.HalfFloatType || !Number.isFinite(dotNV) || !Number.isFinite(perceptualRoughness)) {
    throw new Error('Invalid source DFG sample');
  }
  const clamp = value => Math.max(0, Math.min(1, value));
  const roughness = clamp(perceptualRoughness);
  const x = clamp(dotNV) * 128 - .5, y = roughness * roughness * 128 - .5;
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  result.fill(0);
  for (let corner = 0; corner < 4; corner++) {
    const right = corner & 1, upper = corner & 2;
    const px = Math.max(0, Math.min(127, ix + (right ? 1 : 0)));
    const py = Math.max(0, Math.min(127, iy + (upper ? 1 : 0)));
    const weight = (right ? fx : 1 - fx) * (upper ? fy : 1 - fy);
    for (let channel = 0; channel < 3; channel++) {
      result[channel] += weight * THREE.DataUtils.fromHalfFloat(texture.image.data[(py * 128 + px) * 4 + channel]);
    }
  }
  return result;
}

export async function prepareSourceDfg(document, {fetch: fetchPayload = globalThis.fetch} = {}) {
  const response = await fetchPayload(document.url);
  if (!response.ok) throw new Error(`Source DFG payload HTTP ${response.status}`);
  let texture = createSourceDfgTexture(document, await response.arrayBuffer());
  let disposed = false;
  return {
    get texture() { return texture; },
    replaceLookupTexture(replacement) {
      if (disposed) throw new Error('Source DFG has been disposed');
      if (!replacement?.isDataArrayTexture || !replacement.userData.sharedThreeDfgPacking ||
          replacement.image.width !== 128 || replacement.image.height !== 128 || replacement.image.depth !== 2 ||
          replacement.type !== THREE.HalfFloatType || replacement.format !== THREE.RGBAFormat ||
          !(replacement.image.data instanceof Uint16Array) || replacement.image.data.length !== 128*128*2*4 ||
          replacement.userData.sourceDfg?.sha256 !== document.sha256) throw new Error('Invalid replacement source lookup');
      if (replacement !== texture) { const previous=texture; texture=replacement; previous.dispose(); }
      return texture;
    },
    sample: (dotNV, roughness, result) => {
      if (disposed) throw new Error('Source DFG has been disposed');
      return sampleSourceDfg(texture, dotNV, roughness, result);
    },
    snapshot: () => ({evidenceId: document.evidenceId, sha256: document.sha256, width: 128, height: 128,
      runtimeLookupSize:[texture.image.width,texture.image.height,...(texture.isDataArrayTexture?[texture.image.depth]:[])], sharedThreeDfgPacking:texture.userData.sharedThreeDfgPacking??null,
      byteLength: document.byteLength, coordinates: document.coordinates, channels: document.channels,
      derivation: document.derivation, limitations: document.limitations, disposed}),
    dispose() { if (!disposed) { texture.dispose(); disposed = true; } },
  };
}
