import * as THREE from 'three';

// Source pixel equations only. Original vertex/particle and render-target
// compositing policies remain separate; this loader never invents them.
export const BLASTER_BOLT_GLSL = "// LOCAL-BLASTER-BOLT-PIXEL-001. Native PS5f93c17d04; register names retained\n// until parent particle/vertex-buffer bindings are completely established.\n// PSabf28c9265 uses shifted varyings and additional final factor1-v6.w.\nstruct BlasterBoltVaryings {\n  vec4 v1; vec4 v2; vec4 v3; vec4 v4; vec4 v5; vec4 v7;\n  vec3 worldPosition;\n  vec2 uv;\n};\nstruct BlasterBoltPixel { vec3 radiance; vec4 depthCoverage; };\nBlasterBoltPixel sampleBlasterBolt(BlasterBoltVaryings v, vec3 screenPosition,\n  vec2 inverseViewport, vec3 cameraPosition, vec3 materialMultiplier,\n  vec4 nativeGlobal40, float auxiliaryFade,\n  sampler2D sideMap, sampler2D topMap, sampler2D irisMap, sampler2D screenFlareMap) {\n  vec2 radial = fract(v.uv) * 2.0 - 1.0;\n  float disc = max(1.0 - length(radial), 0.0);\n  disc *= disc;\n  disc *= texture2D(irisMap, v.uv).r;\n  disc *= texture2D(screenFlareMap, screenPosition.xy * inverseViewport).r + 0.1;\n  vec2 sideUv = vec2(clamp(v.uv.x, 0.01, 0.99), 0.5 - abs(v.uv.y - 0.5));\n  float side = texture2D(sideMap, sideUv).a * 3.0;\n  float top = clamp((texture2D(topMap, v.uv).a - 0.01) * 1.01, 0.0, 1.0);\n  float shape = mix(top, side, v.v1.x);\n  float distanceFade = clamp((length(v.worldPosition - cameraPosition) - 0.2) * 10.0, 0.0, 1.0);\n  float segment = clamp((v.v1.z - v.v7.x) * v.v1.y, 0.0, 1.0)\n                * clamp((v.v7.x - v.v1.w) * v.v1.y, 0.0, 1.0);\n  float core = sqrt(shape) * segment;\n  float bodyCoverage = shape * v.v7.y * 0.3 * distanceFade * segment;\n  float opacity = bodyCoverage * v.v7.z;\n  float flareGate = ceil(clamp(v.v5.w, 0.0, 1.0));\n  float coverage = clamp(mix(opacity, disc * 0.9, flareGate), 0.0, 1.0);\n  float phase = clamp(opacity + v.v3.w * (1.0 - opacity - clamp(v.v7.x, 0.0, 1.0)), 0.0, 1.0);\n  phase = pow(phase, v.v2.w);\n  vec3 firstColor = mix(v.v2.rgb, v.v4.rgb, v.v4.w);\n  vec3 secondColor = mix(v.v3.rgb, v.v5.rgb, v.v4.w);\n  vec3 color = mix(secondColor, firstColor, phase);\n  float globalFactor = nativeGlobal40.w + (1.0 - nativeGlobal40.w) * 0.25;\n  vec3 coreRadiance = max(core * materialMultiplier * 5.0 * globalFactor * color * v.v7.w, vec3(0.0));\n  vec3 flareRadiance = v.v5.w * v.v7.z * (firstColor + secondColor) * globalFactor;\n  BlasterBoltPixel result;\n  result.radiance = coverage * mix(coreRadiance, flareRadiance, flareGate) * auxiliaryFade * nativeGlobal40.z;\n  result.depthCoverage = vec4(screenPosition.z, 1.0, 0.0, coverage);\n  // Native render target0 alpha is always0. Render target2 carries coverage.\n  return result;\n}\n";
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
