# PropsNonMetallicPreset source recovery

The exact selected family is `Shaders/Presets/SS_PropsNonMetallicPreset`, file `9e62baa6-e5c2-45fd-89ce-15819bbd6808`, class `541052fc-d8ca-448b-8062-5467c8940247`, RVM surface `d5f94013-40de-a1b8-3550-9f61931c6d08`. This excludes similarly named emissive, alpha-test, detail-map and color-weathering families.

`propsnonmetal-analyze.py` proves the complete 267-word/46-permutation native tree and applies only exact compiled section inputs, leaving unknown inputs free. All 22 active GLB sections / 122 placed section instances select ordinary PS `1e3d99cec3`. Nineteen sections also reach the five-atlas PS `1c6f05ad3a`; three are excluded (CatwalkSystemPlatformSupport, GasFlask and DroidMouse). Other three-texture/dual-atlas and forward candidates remain separate source routes. There are no currently active lower LOD alternatives for these selected sections.

Ordinary PS SHA256 is `f7cb7662d3740b6c2146e655ffedcddcbd38e217df9eb0e8cf76924698f9bb97`. Exact register binding maps, texture conversion instructions, native selectors, sampler identities and source parameter bytes are retained in `exports/materials/propsnonmetal-shader/material-analysis.json`.

## Exact material and prelighting

Only CS (parameter hash 5861109) and NW (5861212) are bound. Both sample original UV0 with source wrap U/V sampler `5993a514cd`. A third compiled texture parameter 1348375853 is present in each source section but is not bound by these PS functions; the public document retains it as `unboundSourceTextures` and the adapter does not sample it.

Albedo is CS.rgb and raw smoothness is CS.a. NW.rg decodes with `2*x-1`; Z is `sqrt(max(1-dot(xy,xy),0))`. The final source world normal is `normalize(TBN*tangentNormal)`. Neither NW blue nor NW alpha supplies these material outputs. Native material ID is zero, metalness zero, reflectance .5, material AO one, emission zero. There is no material PS constant buffer.

Ordinary prelighting includes the full nine-term SH polynomial **plus always-on broadened SH specular**, then clamps RGB against zero. The normalized final normal and CS.a feed this term. The independently tested Volcanic prelighting helper at scale one reproduces this shader's arithmetic; only the normal stage and scale selection differ. Source sky visibility uses coefficient W channels. Native undefined zero dominant-direction/opposing half-vector normalization is not patched with an invented epsilon. All 122 actual selected section centers sample covered nonzero source probe directions in the existing browser probe selection, and regression normals/views produce finite values.

## Independent evidence

- `propsnonmetal-parity.py` establishes exact lane-level symbolic equality for six ordinary/atlas material outputs using the original DXBC float32 words and resolved sampler identities. The complete directional/broadened atlas kernel matches the original floor kernel; 388 symbolic nodes are involved. The original radiosity affine UV is `(v1.x*v2.w+v6.z, v1.w*v3.w+v6.w)`. Sky t6.r goes directly to o2.w. No extra AO, emission or final RGB clamp is inserted on the atlas path.
- `propsnonmetal-equations.py` independently replays 2,000 original ordinary-shader cases; maximum absolute residual is 1.8758328224066645e-12. Mutations using normal blue, normal alpha for smoothness and omitted broadened specular are rejected in 2000, 2000 and 837 cases respectively.
- `propsnonmetal-warp.cs` executes the unchanged original pixel shader on CPU D3D11 WARP. Ninety-six cases compare all four MRTs / 1,536 scalar outputs; maximum absolute residual is 3.430778093616027e-5 and relative residual with unit floor is 2.3713620701489944e-7. Actual input/output/shader hashes are retained in the execution report and checked. Constant float textures/point sampling isolate arithmetic; the fixture VS and exposure one are explicit test choices. Two unused texture slots and unused cb1 fields remain in the shared 82-float fixture record and are documented as unused by this original shader.
- `web/test/propsnonmetal-material.test.js` directly compares browser material/shared-lighting helpers with retained original WARP outputs, loads all 22 real GLTF sections, checks unrelated geometry preservation, verifies texture hashes/mip bytes, checks all actual probe centers and validates ordinary DFG/direct composition.

## Publication and atlas integration contract

`propsnonmetal-prepare.py` publishes twelve already-retained source texture identities and `/assets/recovered-propsnonmetal-materials.json`. Native mip suffixes are preserved without resampling or recoloring; the resulting PNG total is 5,518,426 bytes. Native DXGI transfer functions are retained; browser lower mip generation and anisotropic filtering remain separate differences.

Material adapter `propsnonmetal-material.js` binds only exact asset/material pairs, preserves geometry and source UV0, and currently uses the documented derivative tangent frame. Its marker is `recoveredPropsNonmetalShader`, surface is `bf2_propsnonmetal_surface`, and raw smoothness is `.smoothness`. Assets/stats/main diagnostics/direct-light classification and ordinary broadened-SH probe hooks are integrated. No grading or exposure module was changed.

The atlas recipe is `exports/materials/propsnonmetal-shader/integration-recipe.json`, SHA256 `5f8ddbc5eb693694fd4a249250f38b4115bbf763e849d7bd9c3373df4dca586e`. It explicitly filters 19 eligible and 3 excluded sections. The runtime integration step covers publisher and static-atlas adapter integration. **Unmatched atlas records must use the same normalized-normal SH plus broadened specular at scale one.** The generic diffuse-only `bf2_probeDiffuse` fallback is insufficient for this family. Non-atlas copies already use the scoped shared helper; static material fallback needs the same treatment.

Source evidence does not establish original live pass activation, native runtime overrides, original tangent-frame correspondence, browser probe volume selection or general environment sky composition. The runtime integration step covers full-suite/build/actual-map validation after handoff. Fifty-three focused material/probe/atlas/direct tests passed before that combined checkpoint.
