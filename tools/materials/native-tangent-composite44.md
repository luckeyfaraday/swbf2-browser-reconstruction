# Original Array2UV identity-composite frames

`BF2-NATIVE-TANGENT-ARRAY2UV-COMPOSITE44-001` covers five section/LOD records from three original assets: 243 base placements and 16,777 vertices. `exports/materials/native-tangent-array2uv-composite44` retains the exact source streams, selected section routes, input fixture and unchanged native VS WARP outputs. This is a bounded static-rest-pose reconstruction; native destruction and changing per-part visibility are not implemented.

The original Array2UV permutation tree is rooted at `910d6c3e8a`. Its full compressed storage is decoded using the previously recovered native tree format. Two exact compiled section inputs narrow all three assets to the same ten pass leaves. Unknown pass inputs remain free. Among those leaves the ordinary PS `52d055444c` has exactly one paired VS, `5da46730cb`; the five-atlas PS `b398fb7ed2` has exactly one paired VS, `cbfdbad68f`. Every retained pointer edge is checked against the original RVM bytes. This supersedes the family-exemplar ambiguity for these sections only: the older colored48-byte VS `91e68dabef` is not their selected vertex route.

Both shaders bind original input layout `9aa9d715d7` directly:

| Byte offset | Source field | Native input |
| --- | --- | --- |
| 0, 6 | position Half3, separate BinormalSign Half | TEXCOORD0 half4 |
| 8 | BoneIndices UShort4 | TEXCOORD1 uint4 |
| 16 | Normal Half4 | TEXCOORD2 half4 |
| 24 | Tangent Half4 | TEXCOORD3 half4 |
| 32, 36 | UV0 Half2, UV1 Half2 | TEXCOORD4 half4 |
| 40 | RadiosityTexCoord Half2 | TEXCOORD5 half2 |

All source PartTransforms are identity, including both lower LODs of Box_M_06. The current exporter nevertheless applies its identity-part inverse-transpose arithmetic and normalizes normals. The preparation script reproduces those float32 operations and signed-zero behavior, then checks every GLB position, normal, UV0, index and source material association. The raw source normal is preserved separately; no approximate equality or normalized-normal substitution is accepted.

The original VS forms `N=normalize(M*Nsource)`, `T=normalize(M*(-Tsource))`, and `B=normalize(M*(-cross(Nsource,Tsource)*sign))`. The ordinary path reads instance rows9–11; the atlas path reads rows2–4. Neither applies a part matrix in this selected route. BoneIndices.x low15 bits selects a structured visibility row, while its high bit chooses roots.x or roots.z; nonpositive visibility zeros the outputs.

Two unchanged original DXBC programs were executed on CPU WARP through driver-generated stream output. The fixture contains 341 distributed original vertices, all source parts and handedness values, twelve source/synthetic transforms, and five visibility cases per transform. Baseline cases retain the original vertex bytes; explicitly tagged high-bit cases modify only that bit to test the alternate root. Results: 182,736 frame scalars with maximum absolute error `1.340650948034039e-7`, 81,216 exact UV scalar outputs, and 329,856 exact zero-output scalars. Native live draw dispatch and dynamic destruction are not captured.

Runtime uses frame kind `signed-cross-source-normal`: the existing tangent/sign attribute plus `bf2SourceNormal` vec3. The GLB normal, position, UV and index attributes remain unchanged. The original geometric-normal varying carries the native N; no duplicate N varying is added. Source-probe/material cache keys already include frame kind. Instancing plus native UV1, probe rows and both atlas attributes requires thirteen of the sixteen guaranteed vertex attribute slots. Sampler count is unchanged. Unsupported geometry keeps derivative frames.

The published merged checkpoint contains 268 records, 5,476 base section instances and 419,154 vertices. Its payload is 7,204,732 bytes, SHA-256 `3589000a197e40ad54773497e97bc9b6de2671e682c0f8a9e96e36547e2afeb9`. Expected diagnostic frame kinds in either LOD mode are signed-cross5,190, explicit-binormal43, and signed-cross-source-normal243. Every selected lower LOD alternative is covered. Seventy-eight focused tangent, LOD and array-material tests pass, including real GLTFLoader associations, corrupt raw-normal rejection, exact lower LOD transitions and distinct composite/rigid/derivative material permutations. Root owns actual-map GPU validation.

Reproduce in the repository root:

```powershell
python tools/materials/native-tangent-array2uv-composite44-select.py
powershell -NoProfile -ExecutionPolicy Bypass -File tools/materials/native-tangent-array2uv-composite44.ps1
python tools/materials/native-tangent-array2uv-composite44-prepare.py
powershell -NoProfile -ExecutionPolicy Bypass -File tools/materials/native-tangent-array2uv-composite44-warp.ps1
python tools/materials/native-tangent-merge.py --publish
python tools/materials/array2uv-prepare.py
```

The extractor and candidate builder write only their bounded evidence directory. Publication is explicit in the merger. The source texture slices, GLBs, collision geometry and lighting equations are not rewritten.
