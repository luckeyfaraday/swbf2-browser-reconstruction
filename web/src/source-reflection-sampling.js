import * as THREE from 'three';
import {createSourceReflectionCube} from './source-reflections.js';

export const SOURCE_REFLECTION_SAMPLING_POLICY = Object.freeze({
  evidenceId: 'BF2-NATIVE-REFLECTION-SAMPLING-001',
  filtering: 'Original RGBA16F mip chain; native dominant direction and angular roughness with log2(1+bias*roughness) LOD. No PMREM addressing.',
  orientation: 'Native convolution proves +X,-X,+Y,-Y,+Z,-Z face order and retained row orientation. The runtime capture-direction basis is supplied separately.',
  selection: 'Caller selects a volume; current camera-volume selection remains inferred. Native ordered overlap, influence masks and cube alpha composition are not implemented.',
  projection: 'Main shader adapter uses skipProxyReprojection=1. Exact box projection math is separately exposed, but native per-volume field construction is unresolved.',
  radiometry: 'Original source scale1; native g_invLrvExposureMultiplier is a separate unrecovered runtime input.',
  singleMip: 'One-mip source asset is retained unchanged; default runtime fallback uses existing PMREM because native reconvolution for the missing levels has not been reproduced.',
  shaderPermutation: 'Proven ordinary materials compile either original-mip cube sampling or the existing PMREM path, never both active samplers. Native material response remains separate.',
  loading: 'Keep the complete active cube/mip/direction tuple during replacement loads and failures. Commit successful latest selections atomically; null clears coverage. This is explicit browser loading policy.',
});

export function nativeReflectionMipmapBias(resolution) {
  if (!Number.isInteger(resolution) || resolution < 4) throw new Error('Invalid native cube resolution');
  return 2 ** (Math.floor(Math.log2(resolution)) - 2);
}

export function nativeReflectionMipRoughness(mip, mipCount) {
  if (!Number.isInteger(mipCount) || mipCount < 1 || !Number.isInteger(mip) || mip < 0 || mip >= mipCount) {
    throw new Error('Invalid native reflection mip index');
  }
  return Math.sqrt((2 ** mip - 1) / 2 ** (mipCount - 1));
}

export function sourceReflectionDirection(normal, viewDirection, roughness) {
  const r = Math.max(0, Math.min(1, roughness)), alpha = r * r;
  const dot = normal.reduce((sum, value, i) => sum + value * viewDirection[i], 0);
  const dotNV = Math.max(0, Math.min(1, dot));
  const reflected = normal.map((value, i) => 2 * dot * value - viewDirection[i]);
  const factor = (1 - alpha) * (alpha + Math.sqrt(1 - alpha));
  return {direction: normal.map((value, i) => value + factor * (reflected[i] - value)),
    angularRoughness: alpha * (Math.min(2 * dotNV, 1) * (1 - r) + r), dotNV};
}

export function sourceReflectionLod(angularRoughness, resolution, maximumLod = Infinity) {
  return Math.max(0, Math.min(maximumLod, Math.log2(1 + nativeReflectionMipmapBias(resolution) * angularRoughness)));
}

// All coordinates here must be the actual native LocalIBLLightInfo local frame.
// This function does not reinterpret a source entity matrix as that frame.
export function sourceBoxReflectionProjection(position, direction, extent, localOffset,
  roughness, angularRoughness, skipProxyReprojection = 0) {
  let enter = -Infinity, exit = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    if (direction[axis] === 0) {
      if (Math.abs(position[axis]) > extent[axis] && !skipProxyReprojection) return null;
      continue;
    }
    const a = (-extent[axis] - position[axis]) / direction[axis];
    const b = (extent[axis] - position[axis]) / direction[axis];
    enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
  }
  if (skipProxyReprojection > 0) { enter = 0; exit = 1; }
  if (enter >= exit || !Number.isFinite(exit)) return null;
  const hit = position.map((value, i) => value + exit * direction[i] - localOffset[i]);
  const distance = Math.hypot(...hit);
  if (distance === 0) return null;
  const value = Math.max(0, Math.min(1, Math.max(roughness * roughness, skipProxyReprojection)));
  const blend = value * value * (3 - 2 * value);
  const projected = angularRoughness * exit / distance;
  return {direction: hit.map((value, i) => value + blend * (direction[i] - value)),
    angularRoughness: projected + blend * (angularRoughness - projected), exitDistance: exit, blend};
}

export function createSourceReflectionMipCube(payload, buffer) {
  // Reuse the original range/format/finite-half validation and mip0 upload.
  const cube = createSourceReflectionCube(payload, buffer);
  const words = new Uint16Array(cube.images[0].image.data.buffer);
  cube.mipmaps = [];
  for (let mip = 1; mip < payload.mipCount; mip++) {
    // Three WebGLTextures.uploadCubeTexture requires additional uncompressed
    // cube mips as {image:[DataTexture,...]}, excluding base level0.
    const image = payload.subresources.slice(mip * 6, mip * 6 + 6).map(slice => {
      const face = new THREE.DataTexture(words.subarray(slice.offset / 2, (slice.offset + slice.bytes) / 2),
        slice.width, slice.height, THREE.RGBAFormat, THREE.HalfFloatType);
      face.colorSpace = THREE.LinearSRGBColorSpace;
      face.flipY = false; face.generateMipmaps = false;
      return face;
    });
    cube.mipmaps.push({image});
  }
  // One capture of 88 ships a single mip. Its native roughness response is not
  // recovered; GPU-generated mips let it use the same shader permutation as the
  // other 87 instead of a separate PMREM program set that recompiled every
  // material on entry. Box-filtered mips are an explicit approximation.
  cube.generateMipmaps = payload.mipCount === 1;
  cube.minFilter = THREE.LinearMipmapLinearFilter;
  cube.magFilter = THREE.LinearFilter;
  cube.name = `BF2 original reflection mips ${payload.id}`;
  cube.userData.sourceReflection = {...cube.userData.sourceReflection,
    samplingEvidenceId: SOURCE_REFLECTION_SAMPLING_POLICY.evidenceId,
    uploadedMipCount: payload.mipCount, generatedMips: payload.mipCount === 1, orientationIsInferred: false,
    captureDirectionBasisIsUnresolved: true, nativeMipmapBias: nativeReflectionMipmapBias(payload.width)};
  cube.needsUpdate = true;
  return cube;
}

function disposeCube(cube) {
  for (const face of cube.images) face.dispose();
  for (const mip of cube.mipmaps) for (const face of mip.image) face.dispose();
  cube.dispose();
}

export const SOURCE_REFLECTION_SAMPLING_GLSL = /* glsl */`
uniform samplerCube bf2_nativeReflectionCube;
uniform float bf2_nativeReflectionReady;
uniform float bf2_nativeReflectionMipBias;
uniform float bf2_nativeReflectionMaxLod;
uniform mat3 bf2_nativeReflectionDirectionMatrix;
vec3 bf2_sourceDominantReflection(vec3 normal, vec3 viewDirection, float roughness) {
  float alpha = roughness * roughness;
  float factor = (1.0 - alpha) * (alpha + sqrt(max(1.0 - alpha, 0.0)));
  return mix(normal, reflect(-viewDirection, normal), factor);
}
float bf2_sourceReflectionAngularRoughness(float dotNV, float roughness) {
  return roughness * roughness * mix(min(2.0 * clamp(dotNV, 0.0, 1.0), 1.0), 1.0, roughness);
}
vec4 bf2_sampleNativeReflection(vec3 worldNormal, vec3 worldViewDirection, float sourceRoughness) {
  float roughness = clamp(sourceRoughness, 0.0, 1.0);
  vec3 ray = bf2_sourceDominantReflection(worldNormal, worldViewDirection, roughness);
  float cone = bf2_sourceReflectionAngularRoughness(dot(worldNormal, worldViewDirection), roughness);
  float lod = clamp(log2(1.0 + bf2_nativeReflectionMipBias * cone), 0.0, bf2_nativeReflectionMaxLod);
  // Deliberate skipProxyReprojection=1 path; native frame construction and
  // volume overlap remain unresolved. DirectionMatrix is caller supplied.
  return textureCubeLodEXT(bf2_nativeReflectionCube, bf2_nativeReflectionDirectionMatrix * ray, lod);
}
`;

// This composes with source probes/DFG because their hooks retain maps include.
// Uniform objects are shared and updated by select(); program recompiles are
// unnecessary when the selected raw cube or its mip count changes.
export function injectSourceReflectionSampling(shader, sampling, {mode = sampling.shaderMode ?? 'native'} = {}) {
  const maps = '#include <lights_fragment_maps>';
  if (!['native','pmrem','none'].includes(mode)) throw new Error('Unknown source reflection shader mode');
  if (!shader.fragmentShader.includes(maps) || shader.bf2ReflectionSamplingMode || shader.fragmentShader.includes('vec4 bf2_sampleNativeReflection(')) {
    throw new Error('Native reflection maps integration point missing or already patched');
  }
  shader.bf2ReflectionSamplingMode=mode;
  // The original one-mip exception keeps the existing Three PMREM equations;
  // no raw cube helper/uniform is emitted in that permutation.
  if (mode === 'pmrem') return;
  if (mode === 'none') {
    shader.fragmentShader='#undef USE_ENVMAP\n'+shader.fragmentShader;
    return;
  }
  Object.assign(shader.uniforms, sampling.uniforms);
  // Three's generated feature prefix precedes the user fragment source. Undef
  // only this proven material's env branch, leaving source cube response intact.
  shader.fragmentShader = '#undef USE_ENVMAP\n'+SOURCE_REFLECTION_SAMPLING_GLSL + shader.fragmentShader.replace(maps, `${maps}
    #if defined(RE_IndirectSpecular)
      if (bf2_nativeReflectionReady > 0.5) {
        vec3 bf2_nativeWorldNormal = inverseTransformDirection(geometryNormal, viewMatrix);
        vec3 bf2_nativeWorldView = inverseTransformDirection(geometryViewDir, viewMatrix);
        radiance = bf2_sampleNativeReflection(bf2_nativeWorldNormal, bf2_nativeWorldView, roughnessFactor).rgb;
      }
    #endif
  `);
}

export async function prepareSourceReflectionSampling(document, {
  fetch: fetchPayload = globalThis.fetch, cacheSize = 2,
} = {}) {
  if (document?.version !== 1 || !Array.isArray(document.payloads) || !Array.isArray(document.volumes) ||
      !Number.isInteger(cacheSize) || cacheSize < 1 || cacheSize > 8) throw new Error('Invalid native reflection cache configuration');
  const payloads = new Map(document.payloads.map(payload => [payload.id, payload]));
  const activeLayer = document.layerRoot?.enabled === true && document.levelReference?.excluded === false;
  const volumes = new Map(document.volumes.filter(volume => activeLayer && volume.enabled && volume.visible &&
    volume.mode === 'LocalIBLMode_Baked').map(volume => [volume.id, volume]));
  const cache = new Map();
  const uniforms = {
    bf2_nativeReflectionCube: {value: null}, bf2_nativeReflectionReady: {value: 0},
    bf2_nativeReflectionMipBias: {value: 32}, bf2_nativeReflectionMaxLod: {value: 0},
    bf2_nativeReflectionDirectionMatrix: {value: new THREE.Matrix3()},
  };
  let disposed = false, requested = null, selected = null, selectedUploadedMips = 0, pending = null, generation = 0, error = null;
  // Shader permutations are expensive to switch: every decorated material
  // recompiles, blocking the page for seconds on ANGLE/D3D11. Uncovered areas and
  // the single-mip capture therefore stay in the native permutation; coverage is
  // a uniform (ready 0 adds no environment radiance, exactly like 'none').
  let downloads = 0, evictions = 0, shaderMode='native';
  const modeListeners=new Set();
  function setMode(mode) {
    if(shaderMode===mode)return;
    shaderMode=mode;
    for(const listener of modeListeners)listener(mode);
  }
  function activate(volume, entry, directionMatrix) {
    cache.delete(entry.payload.id); cache.set(entry.payload.id, entry);
    while (cache.size > cacheSize) {
      const oldest = cache.keys().next().value;
      disposeCube(cache.get(oldest).cube); cache.delete(oldest); evictions++;
    }
    selected = volume.id; selectedUploadedMips = entry.payload.mipCount;
    uniforms.bf2_nativeReflectionCube.value = entry.cube;
    uniforms.bf2_nativeReflectionMipBias.value = nativeReflectionMipmapBias(entry.payload.width);
    // Generated mips span the same 128->4 chain as the multi-mip captures.
    uniforms.bf2_nativeReflectionMaxLod.value = entry.payload.mipCount > 1 ? entry.payload.mipCount - 1 : Math.max(0, Math.log2(entry.payload.width / 4));
    uniforms.bf2_nativeReflectionDirectionMatrix.value.copy(directionMatrix);
    uniforms.bf2_nativeReflectionReady.value = 1;
    setMode('native');
    return entry.cube;
  }
  return {
    uniforms,
    get shaderMode(){return shaderMode;},
    subscribeModeChange(listener) {
      if(typeof listener!=='function')throw new TypeError('Reflection mode listener must be a function');
      modeListeners.add(listener);
      return ()=>modeListeners.delete(listener);
    },
    select(volumeId, directionMatrix = null) {
      if (disposed) return Promise.reject(new Error('Native reflection sampling has been disposed'));
      const volume = volumes.get(volumeId), payload = payloads.get(volume?.payloadId);
      if (volumeId !== null && (!volume || !payload)) return Promise.reject(new Error('Unknown active native reflection volume'));
      if(directionMatrix!==null&&!directionMatrix.isMatrix3)return Promise.reject(new TypeError('Reflection direction must be a Matrix3'));
      const matrix=directionMatrix?directionMatrix.clone():new THREE.Matrix3();
      if (volumeId === requested && pending) {
        // Same outstanding volume: last requested basis commits with that cube.
        pending.directionMatrix.copy(matrix);
        return pending.promise;
      }
      requested = volumeId; error = null;
      if (pending) { pending.controller.abort(); pending = null; }
      const currentGeneration = ++generation;
      if (!volume) {
        selected = null;
        uniforms.bf2_nativeReflectionReady.value=0;
        uniforms.bf2_nativeReflectionCube.value=null;
        uniforms.bf2_nativeReflectionMaxLod.value=0;
        uniforms.bf2_nativeReflectionDirectionMatrix.value.identity();
        return Promise.resolve(null);
      }
      if (cache.has(payload.id)) return Promise.resolve(activate(volume, cache.get(payload.id),matrix));
      const controller = new AbortController();
      const promise = (async () => {
        try {
          downloads++;
          const response = await fetchPayload(payload.url, {signal: controller.signal});
          if (!response.ok) throw new Error(`Native reflection payload HTTP ${response.status}: ${payload.url}`);
          const buffer = await response.arrayBuffer();
          if (disposed || currentGeneration !== generation) return null;
          const cube = createSourceReflectionMipCube(payload, buffer);
          return activate(volume, {cube, payload},pending?.generation===currentGeneration?pending.directionMatrix:matrix);
        } catch (caught) {
          if (disposed || currentGeneration !== generation || caught?.name === 'AbortError') return null;
          error = String(caught.message ?? caught); throw caught;
        } finally {
          if (pending?.generation === currentGeneration) pending = null;
        }
      })();
      pending = {generation: currentGeneration, controller, promise, directionMatrix:matrix};
      return promise;
    },
    snapshot: () => ({evidenceId: SOURCE_REFLECTION_SAMPLING_POLICY.evidenceId,
      requestedVolume: requested, selectedVolume: selected, ready: uniforms.bf2_nativeReflectionReady.value === 1,
      shaderMode, retainingActiveWhilePending:!!pending&&selected!==null,
      pending: !!pending, cacheSize, cachedPayloads: cache.size,
      sourceBytes: [...cache.values()].reduce((sum, entry) => sum + entry.payload.byteLength, 0),
      uploadedMipCount: selected ? selectedUploadedMips : 0, samplingMipCount: selected ? uniforms.bf2_nativeReflectionMaxLod.value + 1 : 0,
      mipBias: uniforms.bf2_nativeReflectionMipBias.value, downloads, evictions, error, disposed,
      directionBasis: 'Caller supplied; identity default retains the prior browser world-axis convention.',
      policy: SOURCE_REFLECTION_SAMPLING_POLICY}),
    dispose() {
      if (disposed) return;
      disposed = true; generation++; pending?.controller.abort(); pending = null;
      uniforms.bf2_nativeReflectionReady.value = 0; uniforms.bf2_nativeReflectionCube.value = null;
      for (const {cube} of cache.values()) disposeCube(cube);
      cache.clear(); selected = requested = null;
      setMode('none');modeListeners.clear();
    },
  };
}
