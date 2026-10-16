import * as THREE from 'three';

// BF2-NATIVE-REFLECTION-001: shared volume selector and PMREM fallback.
// Proven ordinary materials separately use source-reflection-sampling.js.
export const SOURCE_REFLECTION_POLICY = Object.freeze({
  selection: 'Active enabled visible baked volumes with recovered payloads; smallest containing inferred unit box or sphere. No nearest-volume fallback.',
  coordinates: 'Source absolute XYZ preserved, including source layer transform.',
  orientation: 'Native convolution proves face order +X,-X,+Y,-Y,+Z,-Z and retained source rows. Capture-direction basis remains unresolved; render-target convention avoids Three external-image X reflection.',
  filtering: 'This fallback uses Three PMREM from native mip 0. Proven ordinary materials override its radiance through the separate native six-mip sampler; one single-mip capture and other material families retain this fallback.',
  radiometry: 'Original linear RGBA binary16 at scale 1; no gamma conversion or 8-bit clamp.',
  limitations: 'All 88 source volumes available. Camera-selected environment without native influence blending or proxy reprojection. Ordinary materials separately apply recovered DFG and suppress duplicate Three diffuse environment irradiance.',
});

function readMatrix(values, label) {
  if (!Array.isArray(values) || values.length !== 16 || !values.every(Number.isFinite) ||
      values[3] !== 0 || values[7] !== 0 || values[11] !== 0 || values[15] !== 1) {
    throw new Error(`Invalid native reflection transform: ${label}`);
  }
  const matrix = new THREE.Matrix4().fromArray(values);
  if (matrix.determinant() === 0) throw new Error(`Singular native reflection transform: ${label}`);
  return matrix;
}

export function createSourceReflectionSelector(document) {
  if (document?.version !== 1 || !Array.isArray(document.volumes) || !Array.isArray(document.payloads)) {
    throw new Error('Invalid native reflection document');
  }
  const payloads = new Set(document.payloads.map(payload => payload.id));
  if (payloads.size !== document.payloads.length) throw new Error('Duplicate native reflection payload ID');
  const layer = readMatrix(document.levelReference.matrix, 'active layer');
  const active = document.layerRoot.enabled === true && document.levelReference.excluded === false;
  const enabled = active ? document.volumes.filter(volume =>
    volume.enabled && volume.visible && volume.mode === 'LocalIBLMode_Baked') : [];
  const volumes = enabled.filter(volume => payloads.has(volume.payloadId)).map(volume => {
    if (!['box', 'sphere'].includes(volume.shape)) throw new Error('Unknown native reflection volume shape');
    const matrix = layer.clone().multiply(readMatrix(volume.matrix, volume.id));
    return {
      ...volume, inverse: matrix.clone().invert(),
      size: Math.abs(matrix.determinant()) * (volume.shape === 'sphere' ? 4 * Math.PI / 3 : 8),
    };
  }).sort((a, b) => a.size - b.size || a.id.localeCompare(b.id));
  const local = new THREE.Vector3();
  return {
    activeVolumeCount: enabled.length,
    availableVolumeCount: volumes.length,
    select(position) {
      const coordinates = Array.isArray(position) ? position : [position?.x, position?.y, position?.z];
      if (coordinates.length !== 3 || !coordinates.every(Number.isFinite)) throw new Error('Invalid reflection sample position');
      for (const volume of volumes) {
        local.fromArray(coordinates).applyMatrix4(volume.inverse);
        const inside = volume.shape === 'sphere' ? local.lengthSq() <= 1 + 1e-6 :
          Math.max(Math.abs(local.x), Math.abs(local.y), Math.abs(local.z)) <= 1 + 1e-6;
        if (inside) return volume;
      }
      return null;
    },
  };
}

export function createSourceReflectionCube(payload, buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== payload.byteLength ||
      payload.pixelFormat !== 'R16G16B16A16_FLOAT' || payload.faceCount !== 6 ||
      !Number.isInteger(payload.width) || payload.width < 16 || payload.width !== payload.height ||
      !Number.isInteger(payload.mipCount) || payload.mipCount < 1 ||
      payload.mipCount > 1 + Math.floor(Math.log2(payload.width)) ||
      payload.subresources?.length !== 6 * payload.mipCount) {
    throw new Error('Invalid native reflection half-float payload');
  }
  let offset = 0;
  for (let mip = 0; mip < payload.mipCount; mip++) {
    const size = Math.max(1, payload.width >> mip), bytes = size * size * 8;
    for (let face = 0; face < 6; face++) {
      const slice = payload.subresources[mip * 6 + face];
      if (slice.mip !== mip || slice.face !== face || slice.width !== size || slice.height !== size ||
          slice.offset !== offset || slice.bytes !== bytes) throw new Error('Invalid native reflection face/mip range');
      offset += bytes;
    }
  }
  if (offset !== buffer.byteLength) throw new Error('Native reflection payload length mismatch');
  const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  const words = new Uint16Array(buffer);
  if (!littleEndian) {
    const view = new DataView(buffer);
    for (let i = 0; i < words.length; i++) words[i] = view.getUint16(i * 2, true);
  }
  for (const word of words) {
    if ((word & 0x7c00) === 0x7c00) throw new Error('Non-finite native reflection half float');
  }
  const faces = payload.subresources.slice(0, 6).map(slice => {
    const face = new THREE.DataTexture(words.subarray(slice.offset / 2, (slice.offset + slice.bytes) / 2),
      slice.width, slice.height, THREE.RGBAFormat, THREE.HalfFloatType);
    face.colorSpace = THREE.LinearSRGBColorSpace;
    face.flipY = false;
    face.generateMipmaps = false;
    face.minFilter = face.magFilter = THREE.LinearFilter;
    return face;
  });
  const cube = new THREE.CubeTexture(faces);
  cube.type = THREE.HalfFloatType;
  cube.format = THREE.RGBAFormat;
  cube.colorSpace = THREE.LinearSRGBColorSpace;
  cube.generateMipmaps = false;
  cube.minFilter = cube.magFilter = THREE.LinearFilter;
  cube.flipY = false;
  // PMREMGenerator._textureToCubeUV uses this convention flag to choose +X
  // instead of its external-image -X. WebGLTextures still uploads these faces.
  // This does not claim the texture was allocated as a GPU render target.
  cube.isRenderTargetTexture = true;
  cube.name = `BF2 native reflection ${payload.id}`;
  cube.userData.sourceReflection = {evidenceId: 'BF2-NATIVE-REFLECTION-001', payloadId: payload.id,
    nativeMipCount: payload.mipCount, uploadedMipCount: 1, orientationIsInferred: true};
  cube.needsUpdate = true;
  return cube;
}

function disposeCube(cube) {
  for (const face of cube.images) face.dispose();
  cube.dispose();
}

export async function prepareSourceReflections(renderer, document, {
  fetch: fetchPayload = globalThis.fetch,
  createPMREM = value => new THREE.PMREMGenerator(value),
} = {}) {
  const selector = createSourceReflectionSelector(document);
  const fetched = await Promise.all(document.payloads.map(async payload => {
    const response = await fetchPayload(payload.url);
    if (!response.ok) throw new Error(`Native reflection payload HTTP ${response.status}: ${payload.url}`);
    return {payload, buffer: await response.arrayBuffer()};
  }));
  const targets = new Map(), sceneStates = new Map();
  const generator = createPMREM(renderer);
  try {
    generator.compileCubemapShader?.();
    for (const {payload, buffer} of fetched) {
      const cube = createSourceReflectionCube(payload, buffer);
      try {
        const target = generator.fromCubemap(cube);
        target.texture.name = `${cube.name} (Three PMREM inference)`;
        targets.set(payload.id, target);
      } finally {
        disposeCube(cube);
      }
    }
  } catch (error) {
    for (const target of targets.values()) target.dispose();
    throw error;
  } finally {
    generator.dispose();
  }
  let disposed = false, updates = 0, switches = 0, selectedVolume = null;
  const restore = (scene, state) => {
    if (scene.environment === state.assigned) scene.environment = state.previous;
  };
  return {
    update(position, scene) {
      if (disposed) throw new Error('Native reflections have been disposed');
      if (!scene?.isScene) throw new Error('Native reflections require a Three scene');
      const volume = selector.select(position), texture = targets.get(volume?.payloadId)?.texture ?? null;
      const state = sceneStates.get(scene);
      selectedVolume = volume?.id ?? null;
      updates++;
      if (!texture) {
        // Keep the last environment when leaving coverage. Clearing it changes the
        // envMap flag of every standard material's program and recompiles them
        // all mid-game; native-sampled materials ignore it (coverage is a
        // uniform), while other materials keep the last capture as a fallback.
        return null;
      }
      if (!state) sceneStates.set(scene, {previous: scene.environment, assigned: texture});
      else state.assigned = texture;
      if (scene.environment !== texture) { scene.environment = texture; switches++; }
      return selectedVolume;
    },
    snapshot: () => ({
      evidenceId: document.evidenceId, activeVolumes: selector.activeVolumeCount,
      availableVolumes: selector.availableVolumeCount, loadedPayloads: targets.size,
      sourcePayloadBytes: document.payloads.reduce((sum, payload) => sum + payload.byteLength, 0),
      selectedVolume, covered: selectedVolume !== null, updates, switches, disposed,
      policy: SOURCE_REFLECTION_POLICY,
    }),
    dispose() {
      if (disposed) return;
      for (const [scene, state] of sceneStates) restore(scene, state);
      for (const target of targets.values()) target.dispose();
      sceneStates.clear(); targets.clear(); selectedVolume = null; disposed = true;
    },
  };
}
