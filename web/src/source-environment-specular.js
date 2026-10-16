import {ShaderChunk} from 'three';
import {SOURCE_DFG_GLSL} from './source-dfg.js';

export const SOURCE_ENVIRONMENT_SPECULAR_POLICY = Object.freeze({
  evidenceId: 'BF2-NATIVE-GBUFFER-001',
  material: 'Ordinary native materialID0: GBuffer2.y metalness; GBuffer2.z reflectance.',
  response: 'F0=mix(0.16*reflectance^2,baseColor,metalness); F90=saturate(50*dot(F0,vec3(0.33))); response=F0*DFG.r+F90*DFG.g.',
  coordinates: 'DFG at normalized NdotV and original source perceptual roughness squared.',
  limitations: 'Specular BRDF response only. Radiance is supplied separately by native-mip or explicit PMREM-only shader permutations. Native volume projection/blending, capture exposure and selected deferred permutation are not captured. No skin, clearcoat, sheen, anisotropy or iridescence support.',
});

// These are decoded GBuffer values. The native consumer does not clamp them
// again; any render-target quantization/clamping happens before this decoder.
export function decodeSourceOrdinaryMaterial(baseColor, metalness, reflectance = .5) {
  const dielectric = .16 * reflectance * reflectance;
  const f0 = baseColor.map(value => dielectric + metalness * (value - dielectric));
  return {f0, f90: Math.max(0, Math.min(1, 50 * .33 * (f0[0] + f0[1] + f0[2]))),
    diffuse: baseColor.map(value => value * (1 - metalness))};
}

export function sourceEnvironmentResponse(baseColor, metalness, reflectance, dfg) {
  const {f0, f90} = decodeSourceOrdinaryMaterial(baseColor, metalness, reflectance);
  return f0.map(value => value * dfg[0] + f90 * dfg[1]);
}

export const SOURCE_ENVIRONMENT_SPECULAR_GLSL = /* glsl */`
vec3 bf2_sampleSourceDFG(float dotNV, float perceptualRoughness);
vec3 bf2_sourceEnvironmentResponse(vec3 baseColor, float metalness, float reflectance,
                                   float dotNV, float sourceRoughness) {
  float dielectric = 0.16 * reflectance * reflectance;
  vec3 f0 = mix(vec3(dielectric), baseColor, metalness);
  float f90 = clamp(50.0 * dot(f0, vec3(0.33)), 0.0, 1.0);
  vec3 dfg = bf2_sampleSourceDFG(dotNV, sourceRoughness);
  return f0 * dfg.r + vec3(f90 * dfg.g);
}
`;

/** Compose after an existing onBeforeCompile hook for a PROVEN ordinary source
 * material. The caller owns material/program-cache lifecycle and source scope.
 * This function only edits the supplied shader; it does not clone materials,
 * replace Three's dfgLUT, mutate geometry, or affect direct lighting.
 */
export function injectSourceEnvironmentSpecular(shader, {texture, reflectance = .5, materialId = 0} = {}) {
  if (materialId !== 0 || !Number.isFinite(reflectance) || !(texture?.isDataTexture || texture?.isDataArrayTexture)) {
    throw new Error('Native environment response requires ordinary materialID0 and its source DFG texture');
  }
  const end = '#include <lights_fragment_end>';
  const call = 'RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
  if (!shader.fragmentShader.includes(end) || !ShaderChunk.lights_fragment_end.includes(call) ||
      shader.fragmentShader.includes('vec3 bf2_sourceEnvironmentResponse(')) {
    throw new Error('Native environment response shader integration point missing or already patched');
  }
  if (shader.uniforms.bf2_sourceDFG && shader.uniforms.bf2_sourceDFG.value !== texture) {
    throw new Error('Native environment response must share the existing source DFG texture');
  }
  const nativeEnd = ShaderChunk.lights_fragment_end.replace(call, /* glsl */`
    // Ordinary native IBL consumer: one split-sum specular response. The
    // source probe hook owns diffuse prelighting; no extra IBL diffuse or
    // Three multiscattering term is accumulated by this specular branch.
    reflectedLight.indirectSpecular += radiance * bf2_sourceEnvironmentResponse(
      diffuseColor.rgb, metalnessFactor, ${reflectance.toFixed(10)},
      dot(geometryNormal, geometryViewDir), roughnessFactor);
  `);
  const lookup = shader.fragmentShader.includes('vec3 bf2_sampleSourceDFG(') ? '' : SOURCE_DFG_GLSL;
  shader.uniforms.bf2_sourceDFG = {value: texture};
  shader.fragmentShader = lookup + SOURCE_ENVIRONMENT_SPECULAR_GLSL +
    shader.fragmentShader.replace(end, nativeEnd);
  return SOURCE_ENVIRONMENT_SPECULAR_POLICY;
}
