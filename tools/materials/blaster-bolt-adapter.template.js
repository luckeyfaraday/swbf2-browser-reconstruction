import * as THREE from 'three';

// Source pixel equations only. Original vertex/particle and render-target
// compositing policies remain separate; this loader never invents them.
export const BLASTER_BOLT_GLSL = __BLASTER_BOLT_GLSL__;
export async function prepareRecoveredBlasterBoltPixel(document, manager) {
  const loader = new THREE.TextureLoader(manager), textures = {}, uniforms = {};
  const sources = new Map(Object.values(document.sourceTextures).map(t => [t.url, t]));
  await Promise.all(Object.entries(document.textures).map(async ([role, url]) => {
    const source = sources.get(url);
    if (!source) throw new Error(`Missing native blaster texture provenance: ${role}`);
    const texture = await loader.loadAsync(url);
    texture.colorSpace = source.colorSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.flipY = false;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    textures[role] = texture;
    uniforms[`bf2_bolt_${role}`] = { value: texture };
  }));
  uniforms.bf2_bolt_multiplier = { value: new THREE.Vector3(...document.constantMapping.default.slice(0, 3)) };
  return { glsl: BLASTER_BOLT_GLSL, textures, uniforms, sourceMesh: document.sourceMesh,
    provenance: { evidenceId: document.evidenceId, outputs: document.outputs, limitations: document.limitations },
    dispose() { for (const texture of Object.values(textures)) texture.dispose(); },
  };
}
