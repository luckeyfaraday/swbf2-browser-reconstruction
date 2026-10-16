# Nonmetal emissive Death Star wall

The selected shader is `Objects/Architecture/_GalacticEmpire/_Shaders/SS_DSI_Master_1UV_Emissive_NonMetal_01`, EBX fileGUID `9bb448ea-10e9-4c76-bed2-df6e56179fc9`, RVM surfaceGUID `783ccbd8-0153-e8fe-0aed-24dd49b7d7a6`. One exact material section on `dsi_wall_02_384_c_mesh` appears in202placements. The retained visibility audit counts195328LOD0triangles across109frustum-visible instances; that is not occluded pixel coverage.

Reproduce from the repository root:

```powershell
python tools/materials/extract-rvm-shader.py --name-hash 2996852712 --out exports/materials/master1uv-emissive-nonmetal-shader
python tools/materials/master1uv-emissive-nonmetal-analyze.py
python tools/materials/master1uv-emissive-nonmetal-test.py
python tools/materials/master1uv-emissive-nonmetal-prepare.py
node --test web/test/master1uv-emissive-nonmetal-material.test.js
```

DeferredPS17069bc692 and pairedVS282854795b are byte-hashed original DXBC. The executable direct-input chain ends at key table5a1c079e63, distinct from the function hash/filter key table476a928728. The exact ten texture slots, thirteen pixel constants, and separate vertex/pixel assembly output slots63/64 are retained. Original sampler s0 uses input26 and retained sampler block5993a514cd. Selected conditional parameters are empty, variation0. All ten texture decodes already exist and are reused unchanged with DDS transfer functions and original native-mip hashes.

This variant shares layered color, grunge, normal and smoothness arithmetic with emissive Master1UV, inserts an emission multiplier at cb1[3], and writes ordinary materialID0, metalness0 and dielectric reflectance.5. Emission is thresholded normalEmission.blue times original white emissiveColor, intensity15000 and multiplier1. The alpha channel is unused; there is no AO multiply. Geometric normal interpolation is preserved for grunge; the final normal is normalized for prelighting. Browser tangent basis remains derivative-reconstructed.

The generated equations retain exact float32 literals; independent text-DXBC comparison uses the six-decimal disassembly literals on both sides.3000varied UV/material cases,21channel edges and128nonunit interpolated-normal cases agree within7.28e-12. This is arithmetic validation, not native runtime execution. Two Node tests retain source identities/bytes and exercise actual GLTF material routing with native probe/DFG hook composition.

Runtime integrates through assets.js, ordinary native direct-light selection and source probe/DFG/reflection hooks. Full native broad-specular prelighting, camera lightmap pre-exposure, packed tangents, material variation overrides and renderer pass scheduling remain outside this material translation. Actual-map shader success is recorded separately; a failure in the simultaneously added Master2UV family exposed the16sampler hardware limit and prompted lossless shared lighting-lookup packing.

The subsequent [original atlas and emission-stage recovery](master1uv-emissive-nonmetal-static-atlas-notes.md) proves the atlas kernel and emission composition for ordinary and atlas variants. The current adapter zeros separate Three emission; source-probes adds recovered emission to atlas or SH prelighting before DFG/albedo response, including fallback geometry without atlas coverage. Its prepared metadata includes the source recipe hash. This update preserves zero metalness and raw smoothness.
