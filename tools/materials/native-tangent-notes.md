# Original wall tangent-frame witness

Evidence IDs: `BF2-NATIVE-TANGENT-WITNESS-001` and `BF2-NATIVE-TANGENT-VS-WARP-001`.

The selected wall is `objects/architecture/_galacticempire/deathstar_interior/dsi_wall_01_w256_h128_a_mesh`, asset `2dfb9f9d-44b0-2147-6a29-d0b0a878ae53`, LOD0. Its 115 placed instances contain a 160-vertex Master1UV section and a 336-vertex Master2UV section. Source material IDs are 0 and 1 respectively. Both sections already use the exact prepared layout consumed by the original vertex shaders:

| Byte offset | Original mesh field | DX11 shader input |
| --- | --- | --- |
| 0 | Half3 position | TEXCOORD0.xyz, R16G16B16A16_FLOAT |
| 6 | Half BinormalSign | TEXCOORD0.w |
| 8 | Half4 normal | TEXCOORD1, R16G16B16A16_FLOAT |
| 16 | Half4 tangent | TEXCOORD2, R16G16B16A16_FLOAT |
| 24 | Half2 TexCoord0 | TEXCOORD3.xy, R16G16B16A16_FLOAT |
| 28 | Half2 TexCoord1 | TEXCOORD3.zw |
| 32 | Half2 RadiosityTexCoord | TEXCOORD4, R16G16_FLOAT |

Stride is 36 bytes, input slot 0, per-vertex classification. RVM input-layout block `07a62c2c96` occurs at resource byte offset 3,064,928. It is referenced by all four paired vertex-shader objects. The source mesh declaration offsets equal the existing extractor's traversed offsets. The original normal and tangent W lanes are 1; **handedness comes from the separate BinormalSign field**, not tangent W. Section0 has four negative signs and 156 positive signs. Section1 has 336 positive signs.

Current GLB positions, normals, UV0 and indices are byte-identical to the decoded source data for both sections. No reconstructed triangle normal or coordinate conversion is involved in these witnesses. The shader input association also establishes original UV0/UV1/radiosity routing for this exact layout; it is not generalized to other layouts.

The separate older wall `5dde6982-a8e4-899a-0b11-55c5ef8bcf5e` was inspected too. It uses a 44-byte Float3-position/explicit-Binormal layout. Its native preparation into the 36-byte shader stream remains unresolved. It is excluded from the published sidecar; no sign is inferred from a cross product or its constant W lanes.

## Native equations and validation

Let `n` and `t` be the original source normal/tangent XYZ, `s` the original BinormalSign and `M` the native instance matrix's upper3x3:

```text
N = normalize(M * n)
T = normalize(M * -t)
B = normalize(M * (-cross(n,t) * s))
mappedWorldNormal = normalize(Tvarying*normalTS.x + Bvarying*normalTS.y + Nvarying*normalTS.z)
```

The vertex shader normalizes each transformed column. The pixel shader interpolates those columns and normalizes only the final mapped normal; it does not normalize the three columns separately or orthogonalize the frame. The transform is the forward instance3x3 for all columns, including N. It is not an inverse-transpose normal transform. The original source normal varies slightly from unit length after half-float quantization; the cross product uses those original components before transformation and normalization.

Original shaders retained and executed unchanged:

| Family/pass | VS | Normal output | Frame-row outputs |
| --- | --- | --- | --- |
| Master1UV ordinary | `3eba974d4e` | o2.xyz | o3/o4/o5.xyz |
| Master2UV ordinary | `894409a19e` | o2.xyz | o3/o4/o5.xyz |
| Master1UV atlas | `007bb70865` | o3.xyz | o4/o5/o6.xyz |
| Master2UV atlas | `15a512d31f` | o3.xyz | o4/o5/o6.xyz |

Each frame row contains `(Taxis,Baxis,Naxis)`. Full shader hashes, input-layout bytes, source chunk hashes, raw fields and decoded field hashes are in `exports/materials/native-tangent-witness/evidence.json` and `manifest.json`.

CPU WARP executed all four original DXBC files using their original input layout and the retained original wall vertex bytes. A driver-generated stream-output passthrough captures results before rasterization. Twelve instance transforms cover identity, nonuniform positive scale, mirror, shear and eight source placements. All four shaders produce bit-identical frame XYZ. The independent compact CPU equations match 285,696 normal/frame scalar outputs with maximum absolute error 1.1077321293573306e-7. A wrong tangent-sign negative control is detected in 38,592 comparisons.

An isolated hardware transform-feedback test ran the actual standalone GLSL helper on AMD Radeon0x1636 through ANGLE/D3D11. Its 53,568 frame scalars differ from original WARP by at most 1.1920928955078125e-7; 48,152 are bit-identical. No compile, console or GL errors. Report: `web/test-results/source-tangent-frame-gpu-check.json`. This is a vertex-stage check, not a native game capture or a final material/lighting image comparison.

## Runtime integration

The original two-section witness is retained independently as `exports/materials/native-tangent-witness/document.json` and `tangent-output.bin`: 7,936 bytes, a float32 vec4 for each of 496 vertices, with original tangent XYZ and the separately decoded BinormalSign. The Half-to-float conversion is exact. Original normals already exist unchanged in the GLBs and are not duplicated. The public payload now includes the separately verified expansion described in [native-tangent-coverage.md](native-tangent-coverage.md).

`web/src/source-tangent-frame.js` exports:

- `createSourceTangentWitness(document, arrayBuffer)` or asynchronous `prepareSourceTangentWitness(document, {fetch})`. The fetch path verifies the complete payload SHA-256 against the recovered manifest before attaching attributes.
- `applyGeometry(gltf, asset, sourceLod=0)` on the returned adapter. It attaches `bf2SourceTangent` only after checking exact original asset/LOD/primitive/material identity, counts, and position/normal/UV/index fingerprints. It uses the real GLTFLoader primitive associations, preserves existing geometry attributes/materials/collision, and is idempotent.
- `SOURCE_TANGENT_VERTEX_GLSL` / `SOURCE_TANGENT_FRAGMENT_GLSL`, and CPU counterparts `sourceVertexFrame` / `sourceMappedNormal`.
- `configureSourceTangentMaterial`, `sourceTangentProgramKey`, and `injectSourceTangentFrame`, used by the exact Master1UV/Master2UV adapters and their generation templates.
- `hasSourceTangentFrame` and `sourceTangentDiagnostics`, used by probe/material routing and diagnostics.

`assets.js` loads and verifies the selected public payload, then attaches the attribute before material preparation and static batching. Existing source normals remain the helper's normal input. Both Master adapters select the source frame only when the exact sidecar is present. Their source shader formulas and texture assignments remain unchanged. The initial two-section runtime checkpoint passed the actual-map GPU check with 26 native draws, 230 section instances, two native linked programs, 15/16 samplers and zero material/geometry mismatches in both LOD modes. Report: `web/test-results/actual-map-original-static-arrays-native-tangents.json`.

The vertex hook builds the forward world3x3 as `mat3(modelMatrix) * mat3(instanceMatrix)` for instanced draws, with the instance factor omitted for ordinary meshes. It calls the validated helper with the original normal/tangent/sign. T/B use two additional vec3 smooth varyings; N reuses the existing geometric-normal varying. Grunge receives the interpolated N without fragment renormalization. The pixel hook normalizes the mapped world normal and converts it to the renderer's view basis for existing direct/probe/reflection consumers. It does not use Three's inverse-transpose matrix or duplicate the source normal attribute. Each proven geometry adds one vec4 vertex attribute and no samplers.

`source-probes.js` caches distinct covered/uncovered material permutations even when objects share the same original source material. `source-lods.js` switches geometry and its corresponding material together, retains conservative bounds and original probe rows, and exposes all candidate materials through `mesh.sourceLodMaterials` so native direct-light decorators prepare dormant alternatives before use. Render switches leave the original baked collision geometry/BVH unchanged. Diagnostic modes retain the active LOD and select a matching material. Unsupported geometries retain the derivative frame path.

The currently published native-LOD selection does not include this wall asset. Therefore all 115 wall placements (230 material-section instances) use the proven LOD0 tangent frame with render LOD selection both enabled and disabled. The CPU transition test supplies an explicitly synthetic uncovered alternative of identical topology to test future coverage changes; it is not published as a recovered source LOD.

Runtime diagnostics are `assetStats.sourceTangentGeometries` (2 for the original checkpoint, 19 for the verified expansion), `assetStats.sourceTangentProvenance`, and `sourceProbes.snapshot().sourceTangents`. The latter reports active proven/native draws and instances, mismatches (must remain 0), selected/native material counts and native compile-hook executions. The vertex marker `BF2_SOURCE_TANGENT_FRAME` identifies linked native permutations without adding uniforms or samplers.

Focused CPU checks cover both real GLTF sections through real material, batching and probe hooks; source transforms and nonuniform scale; interpolation retained for grunge; covered/uncovered source-material sharing; dormant direct-light decoration and cache identity; LOD/diagnostic round trips; original collision BVH and ray-hit preservation; and finite same-size payload corruption rejected by SHA-256. The original equation/WARP checks remain unchanged and read the retained narrow witness independently of runtime coverage. The standalone hardware frame test does not substitute for integrated actual-map validation.

The native vertex-buffer conversion factory and live native pass selection were not executed. The chosen source layout matches the original prepared layout byte-for-byte; original shader execution validates that direct witness. It does not validate the excluded Float3/explicit-binormal conversion or broader mesh families.

## Reproduction

From the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/materials/native-tangent-witness.ps1
python tools/materials/native-tangent-prepare.py
powershell -NoProfile -ExecutionPolicy Bypass -File tools/materials/native-tangent-warp.ps1
node --test web/test/source-tangent-frame.test.js web/test/source-tangent-integration.test.js web/test/source-lods.test.js
```

The extraction is limited to two named meshes at LOD0. `native-tangent-prepare.py` retains this narrow witness in exports and does not overwrite the published expansion. WARP uses CPU rendering only. The optional hardware test is `node test/source-tangent-frame-gpu-check.mjs` from `web`, with GPU ownership coordinated separately.
