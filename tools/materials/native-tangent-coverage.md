# Proven original tangent-frame coverage

Evidence: `BF2-NATIVE-TANGENT-COVERAGE-001`, continuing `BF2-NATIVE-TANGENT-WITNESS-001` and the four original VS executions in `BF2-NATIVE-TANGENT-VS-WARP-001`.

This independently retained coverage contains 19 exact source sections across nine rigid mesh assets: 13 LOD0 sections and three sections each at LOD1 and LOD2. All 26,621 vertices retain original half-float tangent XYZ and the separately stored BinormalSign. Its float32 sidecar is 425,936 bytes, SHA-256 `22bf205678771acb26c5a0ac00b6b4136f493bbef83aa761b5b76610ac77c00f`. The selected LOD0 sections occur in 801 placed material sections across 519 mesh placements. The current runtime combines this part with the [separately proven 32-byte permutation](native-tangent32.md), for 94 total records.

| Original mesh suffix | Placements | Proven material IDs at LOD0 | Proven lower LODs |
| --- | ---: | --- | --- |
| hangarsystemfloor_01_s1024_1024x640x1024_04_mesh | 1 | 1 (Master1UV) | None published |
| dsi_wall_01_cnr_w256xh128_a_mesh | 86 | 0, 1 (Master2UV) | Both IDs at LOD1/2 |
| dsi_wall_01_w1024_h128_a_mesh | 157 | 0 (Master2UV) | ID0 at LOD1/2 |
| dsi_wall_01_w128_h128_b_mesh | 80 | 0, 1 (Master2UV) | None published |
| dsi_wall_01_w256_h128_a_mesh | 115 | 0 (Master1UV), 1 (Master2UV) | None published |
| dsi_wall_01_w512_h128_a_mesh | 75 | 1 (Master2UV) | None published |
| hangarsystemwalldoor_01_s1024_1024x384x64_01_nodoor_01_mesh | 1 | 1 (Master1UV) | None published |
| hangarsystemwalldoor_01_s1024_1024x512x64_01_mesh | 3 | 1 (Master1UV) | None published |
| elevatordeathstar_01_mesh | 1 | 0 (Master1UV), 3 (Master2UV) | None published |

Every currently published lower-LOD alternative of these covered material sections is included: six section records, corresponding to three base sections on two assets. Thus the runtime should report 801 active native/proven section instances with source LOD selection enabled or disabled. The original geometry/material transition policy remains unchanged.

## Bounds and source identity

The selection includes only current Master1UV/Master2UV recipes and their existing source LOD material correspondences: 145 target section/LOD records. Retained atlas extraction already describes 136 declarations. The narrow new source read examines only 19 matching retained declarations and nine missing declarations, across 22 asset/LOD pairs. It emits 1,253,532 raw vertex/index bytes; no texture, mesh or general bundle export is involved. All source reads use the existing pinned SDK/schema hashes and original installed records.

Only this exact rigid source stream is accepted: Half3 position at 0, Half BinormalSign at 6, Half4 normal at 8, Half4 tangent at 16, Half2 UV0 at 24, Half2 UV1 at 28 and Half2 radiosity at 32, stride 36. Both declared offsets and the original extractor's traversed offsets must agree. This matches input-layout block `07a62c2c96` used by all four unchanged ordinary/atlas Master1UV/Master2UV vertex shaders in the original witness.

For every accepted section, original positions, normals, UV0 and indices equal the selected browser GLB byte-for-byte. GLB node transforms are identity, source material IDs and primitive associations match, original indices remain unchanged, source tangent signs are exactly ±1, and all components are finite. All six lower-LOD records retain their previously proven shared source material parameter root and LOD0 material correspondence. No inverse-transpose normal conversion, reconstructed tangent, guessed handedness, normalization of source bytes or GLB mutation is performed.

The other 126 target records remain excluded. They include 32-byte UV0-only streams, different 36-byte color streams, 40-byte bone/extra-UV streams and 44/48/52-byte explicit-binormal streams. Matching some offsets alone does not establish their original prepared stream or conversion. The nine previously unaudited declarations are all outside the accepted layout; none adds runtime coverage.

## Validation and limits

CPU WARP executes the same four unchanged original VS DXBC files with original source bytes. A deterministic sample spans all 19 sections, distributed through each vertex order and including the first occurrence of each handedness: 1,225 vertices and 12 transforms. The compact source equations match 705,600 normal/frame scalar outputs with maximum absolute error 1.3445363034048086e-7. Frame XYZ outputs are bit-identical across all four original shaders. Sampling is explicit: WARP does not execute every one of the 26,621 expanded vertices. Raw field, GLB and payload correspondence checks do cover all of them.

The original 496-vertex complete witness, its original WARP outputs and independent hardware helper test remain retained separately under `exports/materials/native-tangent-witness`. The expanded runtime uses that unchanged validated helper. Native converter execution, a running original game frame and live native shader/pass selection are not captured. Actual-map rendering is validated separately by the parent integration check.

`web/test/source-tangent-coverage.test.js` verifies declaration/source hashes, every tangent/sign lane, source exclusion boundaries, real GLTFLoader associations for all base/native-LOD sections, unchanged existing geometry/material objects, public/candidate correspondence, all six current LOD routes, and all retained WARP sample outputs. `source-tangent-frame.test.js` continues checking the original narrow witness independently. `source-tangent-integration.test.js` selects its original wall by GUID in the expanded public document and retains the material/lighting/LOD/collision regressions.

## Reproduction

From the repository root:

```powershell
python tools/materials/native-tangent-coverage-select.py
powershell -NoProfile -ExecutionPolicy Bypass -File tools/materials/native-tangent-coverage.ps1
python tools/materials/native-tangent-coverage-prepare.py
powershell -NoProfile -ExecutionPolicy Bypass -File tools/materials/native-tangent-coverage-warp.ps1
python tools/materials/native-tangent-merge.py --publish
node --test web/test/source-tangent-frame.test.js web/test/source-tangent-coverage.test.js web/test/source-tangent-integration.test.js web/test/source-lods.test.js
```

The extraction/preparation stages write only `exports/materials/native-tangent-coverage`. The historical `native-tangent-coverage-publish.py` reproduces the earlier 19-record checkpoint only. Use the merger above to preserve all currently proven layouts when publishing `web/public/assets/native-tangent-witness.{json,bin}`. Runtime provenance retains source coverage identities and exact candidate/evidence hashes.
