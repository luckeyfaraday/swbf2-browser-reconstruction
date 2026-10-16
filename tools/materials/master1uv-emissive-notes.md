# Master1UV emissive source recovery

`LOCAL-MASTER1UV-EMISSIVE-SHADER-001` binds the original source family
`Objects/Architecture/_GalacticEmpire/_Shaders/SS_DSI_Master_1UV_Emissive`
(lowercase DJB2Xor hash `292172631`) to deferred PS `5ffbbd02c2` and paired VS
`282854795b`. All 15 selected MeshMaterial declarations have empty conditional
parameter arrays. The retained analysis includes the complete RVM selection
chain, exact texture conversion/register mapping, 12 PS constants and every
section override/default. These cover 126 placed material sections and 301,944
frozen-view original LOD0 triangles in the retained visibility audit.

The packed material is the original layered Master math plus source emission.
Texture t5 supplies RG normal and B emission; A is unused. Emission mask is
`clamp(B * 1.1111111640930176 - 0.111111119389534, 0, 1)`; the exact float32
immediates occur at DXBC offsets 6680 and 6688. Base color blends toward the
source emissive base color by this mask. Linear emission is mask multiplied by
source emissive RGB and source intensity. Intensities are 15,000, 3,000 and 100,
preserved without normalization. The selected producer has no AO multiplier.

The native producer normalizes its world normal before SH prelighting. Ordinary
material ID 0 and reflectance 0.5 agree with `BF2-NATIVE-GBUFFER-001`; its source
o2.y is metalness. The adapter marker `recoveredMaster1UvEmissiveShader` can join
the ordinary native DFG and reflection scope.

Integration: import `prepareRecoveredMaster1UvEmissiveMaterials` from
`web/src/master1uv-emissive-material.js`, load
`/assets/recovered-master1uv-emissive-materials.json`, then call the returned
`apply(gltf, asset)` before source-probe decoration. API exposes `applied` and
`provenance`; material matching uses asset ID plus original sourceMaterialId.
No geometry mutations or separate native LOD hooks are required. Original LOD
material sharing follows the existing proven parameter-root correspondence.

Build and verification:

```text
python tools/materials/master1uv-emissive-analyze.py
python tools/materials/master1uv-emissive-test.py
python tools/materials/master1uv-emissive-prepare.py
node --test web/test/master1uv-emissive-material.test.js
```

Results: 4,500 independent text-DXBC arithmetic fixtures across every source
constant set, maximum error 8.88e-16, plus 21 blue/alpha/colored-emission edge
fixtures; all five Node tests pass. Tests verify source hashes, shader routing,
float32 overrides, complete native mip payload preservation, original GLTFLoader
section routing, immutable geometry and instanced source-probe shader hooks.
14 verified texture records/URLs are reused; two new native mip PNGs total
697,872 bytes. No live GPU test was run for this step.

Limits: native runtime pass selection remains unobserved; derivative tangent
parity and native sampler/resource-view details remain incomplete. The numeric
interpreter uses six-decimal disassembler literals, while production GLSL uses
recovered float32 literals; this is algebra verification, not bit-exact FMA
emulation. Browser lower PNG mip generation and roughness/metalness clamping
remain explicit mappings. Full native radiometric presentation is separate.
