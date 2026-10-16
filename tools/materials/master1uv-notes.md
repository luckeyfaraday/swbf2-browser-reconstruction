# SS_DSI_Master_1UV recovery

Evidence `LOCAL-MASTER1UV-SHADER-001` is static retained-source decoding, not native execution. The source shader name's lowercase DJB2-XOR hash is `2187307923`; the floor name cross-check is `1716682052`. Runtime shader GUID is `5e1974a3-868c-fba9-59f3-03bd5341aeb1`.

`master1uv-analyze.py` follows the recovered instruction slots, serialized parameter-key hashes and exact default split-shader section graph. It emits `exports/materials/master1uv-shader/material-analysis.json`: 114 material sections, 52 unique exact textures, ten texture registers and nine constant vectors. It preserves source offsets, hashes and section overrides; no color/tiling values come from visual guesses.

The selected deferred PS is `6d0dd89b35`, paired VS `3eba974d4e`. The shortest root path is:

```
f17b7af5ec RvmPermutationSet
a99782c336 RvmPermutationRef
ab104b5c30 RvmPermutation
4ff625ee71 RvmFunctionInstanceRef
abdc8ff04f RvmFunctionInstance
ed0b96a0d8 CombinedSerializedParameterBlock
10f373dcae SerializedParameterBlockRef
02435d2526 SerializedParameterBlock
541889478c DefaultValueRef
25a5038886 ValueRef
e402e6d01c Dx11PsShader
6d0dd89b35 Dx11ByteCodeElement
```

`master1uv-equations.glsl` implements the recovered material equations. `master1uv-test.py` independently interprets the relevant disassembly instructions and compares the compact equations for all 114 constant sets: 1,140 unit-normal cases plus 1,140 interpolated nonunit-normal cases, maximum error `4.44e-16`. This checks algebra and routing, not float32/FMA bit identity or native GPU sampler behavior. Source literal floats and bytecode offsets are in the report.

The geometric normal for grunge is normalized in the vertex shader, then interpolated without pixel-stage renormalization. Ordinary PS `6d0dd89b35` uses `v2.xy` directly in `sat(n)+sat(-n)`; atlas PS `965fbe264b` uses `v3.xy` in the equivalent calculation. The browser template and generated adapter now preserve that varying. The numeric regression detects the previous extra normalization in all 1,140 nonunit cases (maximum smoothness difference `0.15676265`). This geometric normal is distinct from the final normalized TBN shading normal used by atlas lighting; derivative tangent-frame parity remains unresolved.

`master1uv-prepare.py` strips only larger DDS mip levels, retaining exact source compressed bytes, then decodes the existing native mip with the historical DDS exporter. No PNG resize/channel processing occurs. Browser textures are at most 1024 pixels, 41.1 MB combined. Source DDS SRGB/UNORM distinctions are retained. All selected DDS ranges and PNGs are hashed.

The generated browser module is `web/src/master1uv-material.js`. Call `prepareRecoveredMasterMaterials(document, manager)` once, then `apply(gltf, asset)` immediately after each GLTF load, alongside floor reconstruction and before static batching/probe instrumentation. Load document `/assets/recovered-master1uv-materials.json`. The return value exposes `applied` and `provenance`. It changes only exact asset/material identities. Shared source material math is one shader program; source constant overrides remain uniforms. Its test verifies compatibility with static batching and the existing source-probe wrapper.

The material's source outputs are distinct from the renderer adapter:

- Color: ID-map layers, source linear colors, wear/dirt/restore interpolation. Source masks can exceed unit weights; do not clamp them globally.
- Smoothness: source metal green is `2*pow(g,1.5)`; dirt blends toward the pre-scratch smoothness plus one. World-space grunge uses source XY/ZY positions. Deferred output is unclamped. The companion forward shader `ee8b9ac30d` clamps it then explicitly complements it (`add r5.xy, -r1.wwww, l(1.000000, 0.937500,...)`); Three receives `1-clamp(S,0,1)`.
- Normal: packed base RG plus layered RG detail; metal normal X multiplies R by A. Blue of the base normal/emissive/AO texture is unused by this selected non-emissive shader. Source alpha is AO on prelighting.
- Native `o2.y` is metalness for this shader's ordinary materialID0 (`o0.w=0`). **BF2-NATIVE-GBUFFER-001** independently follows two deferred consumers: `diffuse=(1-metalness)*baseColor`, `F0=mix(0.16*reflectance²,baseColor,metalness)`. This producer writes `o2.z=0.5`, so dielectric F0 is0.04. Browser saturation remains an adapter for the uncaptured native GBuffer format/quantization. See the native decoder evidence (`exports/lighting/dfg-gbuffer/manifest.json`, generated) and [analysis](native-dfg-analysis.md).
- Native VS negates transformed tangent and cross-product bitangent. Source packed tangent decoding was not recovered by the mesh export; the browser uses derivative UV tangents and records that parity remains unproven.
- Native SRV format overrides, streaming selection, filtering, full lighting, indirect specular and tone mapping are not established by this material-only recovery. The browser uses source asset pixel-format color space and a bounded source mip.

Run `python tools/materials/master1uv-analyze.py`, `python tools/materials/master1uv-test.py`, `python tools/materials/master1uv-prepare.py`, then `node --test test/master1uv-material.test.js` from `web`. Preparation regenerates the module from `master1uv-adapter.template.js` and the GLSL source; edit those generator inputs when changing it.
