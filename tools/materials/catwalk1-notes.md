# CatwalkSystem_Preset_01 recovery

This family covers 23 active original GLB sections / 312 placed section instances. It is distinct from `SS_CatwalkSystem_Preset_02`. The exact native source name is `Objects/Props/ObjectSets/_Generic/CatwalkSystem_01/SS_CatwalkSystem_Preset_01`, name hash 2105226253, authored shader file `fd267942-bc02-485d-b2bd-60fca1b2344f`, root `4875a41f-a820-408f-bc6e-c3e7e994a7d5`, and RVM surface `ff38456a-6531-144d-edb0-bf00ad70b8dd`.

`catwalk1-analyze.py` decodes the complete 179-word compressed tree using the previously recovered native deserializer format. All 14 permutation leaves remain enumerated with unknown native pass inputs free; only exact compiled section inputs are applied. Every selected section has one ordinary deferred material PS, `d260c7f82c`. Twenty-two sections allow the five-atlas PS `3b42a4bca7`; one rigid section without source radiosity UV does not. The recipe explicitly lists both sets. Five active source LOD1 alternatives independently resolve to the same material parameter blocks and ordinary material PS; each also permits the atlas PS. No shader-family-wide atlas assumption is needed.

## Original material behavior

The ordinary RVM maps t2/t3/t4/t5 to CS/NW/NS/grunge-CS, respectively. Atlas RVM maps t2–t6 to native selectors 18–22, then t7–t10 to those four material textures. CS, NS and grunge use original wrap sampler `5993a514cd`; NW uses clamp sampler `83d4c1d84a`. The atlas sampler is `9216198462`. These are distinct sampler bindings, not guessed texture roles.

UV0 samples CS and NW, and UV0 times source `cb1[0].xy` samples NS. Grunge uses original absolute world XZ times 0.1; the paired VS writes transformed world position before camera subtraction. Color is `CS.rgb * grunge.rgb`. Raw smoothness is `CS.a * grunge.a * NS.b`. Tangent XY is `(NS.rg*2-1) + (NW.rg*2-1)`, while tangent Z is `sqrt(max(0,1-dot(NS.rg*2-1,NS.rg*2-1)))`. The tangent normal is normalized before TBN, and the resulting world normal is normalized again.

All 23 selected source scale values are `(2,2,0,0)` or `(2,2,0,1)`; the exact source bytes are preserved. The ordinary material writes ID zero, metalness zero, reflectance 0.5, no emission and no material AO multiplier. SH prelighting has its original final zero clamp; the atlas route has no corresponding final clamp. Atlas sky visibility is t6.r written directly to o2.w.

## Proof and browser output

`catwalk1-parity.py` independently compares six material outputs between the ordinary and atlas DXBC shaders and proves exact symbolic common lighting expressions against floor PS `f789fdaafa`. It preserves original float32 literal words and distinct native sampler identities; 426 symbolic nodes are used. `catwalk1-equations.py` compares compact equations against original disassembled instructions over 3,000 cases, including real and adversarial constants, nonunit/nonorthogonal frames and out-of-range UVs. Maximum residual is `1.1934897514720433e-15`. Deliberate wrong NW wrapping, world-grunge UVs, normal Z and smoothness factors are detected in 2,954 / 2,999 / 2,315 / 2,859 cases, respectively. This CPU double-precision replay is not a native hardware/FMA/filtering claim.

The publisher reuses the exact existing Catwalk2 detail and grunge textures, and adds 1,337,636 PNG bytes for source CS and NW. Original DDS hashes, selected compressed suffixes, texture identities, transfer functions and sampler roles are recorded in `web/public/assets/recovered-catwalk1-materials.json`.

The browser adapter is `web/src/catwalk1-material.js`; its marker is `recoveredCatwalk1Shader`, surface is `bf2_catwalk1_surface`, and raw lighting smoothness is `bf2_catwalk1_surface.smoothness`. Assets, source probes and native direct lighting recognize this ordinary material. Three emission remains zero. Native tangent-frame publication remains independent; at initial handoff this family retains the derivative fallback. Native pass activation, runtime overrides, resource-view overrides and anisotropic sampler conversion are not claimed observed.

The six new tests in `web/test/catwalk1-material.test.js` pass, including all 23 real GLTF sections, unaffected geometry and unrelated sections, exact texture and constant bytes, five alternative LOD identities, sampler separation and native DFG/no-DFG composition. The root owns the combined full-suite/build/live checkpoint and atlas publication. Its initial atlas publication matches 309 placed sections with 27 UV records; this is a chart match count, distinct from material coverage.

Reproduce from repository root:

```powershell
python tools/materials/extract-rvm-shader.py --name-hash 2105226253 --out exports/materials/catwalk1-shader
python tools/materials/catwalk1-analyze.py
python tools/materials/catwalk1-parity.py
python tools/materials/catwalk1-equations.py
python tools/materials/catwalk1-prepare.py
```

Then from `web`, run `node --test test/catwalk1-material.test.js`.
