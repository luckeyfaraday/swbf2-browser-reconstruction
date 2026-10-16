# Original texture-array material frames

The first bounded array addition publishes17 exact source section/LOD records and210 base section instances. It preserves the existing textures, sampler policies, constant selections, detail-normal equations and UV attributes.

| Family | Exact source declarations | Records | Base section instances | Original ordinary / atlas VS |
| --- | --- | --- | --- | --- |
| Array2UV | Rigid36, `07a62c2c96` |10:6 base +4 native LODs |132 | `2c2902aa87` / `60f0891496` |
| Array1UV | Rigid32, `ad2dd1141c` |7:5 base +2 native LODs |78 | `dfb8f760fb` / `13f25cb3dd` |

Array2UV source parameter blocks `fbef04bfce` and `65c919799c` pair these vertex programs with original PS `52d055444c` and `b398fb7ed2`. Array1UV blocks `46c8869fba` and `6504c0300b` pair its programs with PS `dfa7a16109` and `15826ff02a`. Original RVM pointer bytes, shader bytecode and input declarations are retained in each `shader-routing.json` and hash-checked by focused tests.

All42,428 added source vertices match existing GLB positions, normals, UV0 and indices exactly. Sidecars preserve tangent XYZ and the separate source BinormalSign; original normals and collision geometry are not rewritten. Native frames use the same previously proven forward instance transform and interpolated N/T/B equations. Both native pixel shaders normalize their tangent normal before frame multiplication and normalize the resulting world normal afterward. Neither normalizes the interpolated columns individually.

Array2UV CPU WARP executes both unchanged vertex programs for650 sampled vertices across12 transforms:140,400 frame comparisons, maximum error1.4043e-7. Its expanded64-byte stream-output fixture also captures both source UV pairs:62,400 scalar UV comparisons agree exactly. This proves normal/detail=UV0 and surface=UV1 for these10 rigid36 source records. Composite and colored layouts retain their earlier explicit UV/conversion boundary; no family-wide inference is promoted.

Array1UV CPU WARP covers448 sampled vertices across12 transforms:96,768 frame comparisons, maximum error1.4257e-7. Its two added native LODs preserve the exact source material roots. The raw source/payload/GLB checks cover every vertex; WARP covers only the stated samples. These fixtures execute original shaders on CPU WARP with synthetic/source placement matrices, not a running original-game frame or native converter invocation.

The two adapters select native permutations only for exact sidecar geometry and preserve a separate derivative program for unsupported geometry. Their templates use dynamic `this` and cache keys, and all six new native LOD transitions retain material/probe identity. Array2UV retains its original `bf2ArrayUv1` attribute. No sampler is added; maximum signed instanced attribute usage is11 for Array1UV and12 for Array2UV with its additional UV pair.

The published merge at this checkpoint is230 records,4,753 base section instances,392,953 vertices and6,584,192 bytes; frameKinds are4,710 signed-cross /43 explicit-binormal in either native-LOD mode. SHA-256: `4a5c83769b81f256151cb4b108e2c4770733343aa676725889df3f82d609cd0b`. All71 focused tangent/LOD/Props/array material checks pass. Actual-map GPU verification remains parent-owned.

Evidence directories: `exports/materials/native-tangent-array2uv36` and `native-tangent-array1uv32`. Each family has `tools/materials/native-tangent-<family>-{select.py,prepare.py,warp.ps1}` plus its bounded extraction `.ps1`; run selection, extraction, preparation, original WARP, then `native-tangent-merge.py --publish`. Candidate builders themselves do not publish.

The source-only follow-up inventory found further Array1UV rigid28 declarations (168 base instances) and a32-byte UV1/non-radiosity declaration (52 instances). Those are excluded from this checkpoint pending their own exact layout proof. Composite declarations require source PartTransform correspondence because the existing GLB export applies those transforms to positions and normals.
