# Catwalk2 original vertex frames

Exact source frames are active for381 Catwalk2 section instances across35 records:29 base sections and all six currently published lower-LOD alternatives. The source-only investigation additionally inspected the three remaining cluster instances and excluded them because their original layout is28 bytes, without radiosity UV. No28-byte input or conversion behavior is inferred from32-byte data.

| Evidence | Records | Source vertices | Base section instances | Sampled vertices | Sidecar bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| `BF2-NATIVE-TANGENT-CATWALK232-001` | 34 | 81,544 | 378 | 2,200 | 1,304,704 |
| `BF2-NATIVE-TANGENT-CATWALK236-001` | 1 | 9,488 | 3 | 65 | 151,808 |

Each original position, normal, UV0 and index matches the current GLB bytes exactly. Every source tangent XYZ and independent BinormalSign is expanded from Half to Float32 without modification. Lower-LOD material correspondence and shared parameter roots remain explicit. Source declarations must match format, stream, declared offset and traversed offset; nonmatching layouts produce metadata only.

Original RVM parameter routes pair ordinary PS `2b6d233517` and atlas PS `b1dedf865d` with these exact vertex shaders:

| Layout / pass | Original VS | Parameter block | Input layout |
| --- | --- | --- | --- |
| Signed32 ordinary | `dfb8f760fb` | `9b9c45359f` | `ad2dd1141c` |
| Signed32 atlas | `13f25cb3dd` | `f09c66302f` | `ad2dd1141c` |
| Signed36 ordinary | `ea0522bd70` | `2ded4290be` | `07a62c2c96` |
| Signed36 atlas | `6fee6b97a3` | `f24f8d915f` | `07a62c2c96` |

The32-byte shader bytecodes are identical to the independently proven Ceiling32 permutations; the family-specific parameter pairing is independently checked against raw RVM pointers. The36-byte variants have their own original signatures and input layout. Both layouts use the forward instance frame: normalized `M*N`, normalized `M*(-T)`, normalized `M*(-cross(N,T)*BinormalSign)`.

These shaders emit only three frame rows: ordinary o2/o3/o4 and atlas o3/o4/o5, without a separate N output. The CPU WARP reproducer captures exactly three vec4 rows,48 bytes per vertex. All four unchanged original shaders executed for2,265 distributed source vertices under twelve source/synthetic transforms. The runtime helper agrees on489,240 frame scalar comparisons with maximum error `1.3175541047072414e-7`. Full source/GLB correspondence covers all91,032 vertices. Live native dispatch, conversion factory execution and an original running frame remain uncaptured.

Both pixel shaders normalize the tangent-space material normal before multiplying by the interpolated TBN frame, then normalize the final world normal. Existing Catwalk material equations already preserve the first normalization. The native hook preserves the second using source frame columns. WorldXZ grunge, the sole source constant vector, three per-material texture bindings, zero emission/AO behavior and ordinary material model remain unchanged.

The adapter/template provide all three interpolated T/B/N columns only for proven geometry. The generic helper reuses the native geometric-N varying and adds T/B; derivative fallback retains its existing inputs. No sampler is added. Program keys and original/probe material variants use the existing frame-kind cache. All six actual lower-LOD transitions preserve material identity and source normals. The real unsupported cluster `598ff0ed-cbdc-ad63-5f92-6cd963816bba` is loaded by the test and remains derivative.

The194-record checkpoint contains319,474 source vertices and4,167 section instances, including4,124 signed-cross and43 explicit-binormal. Its5,408,528-byte payload SHA-256 is `30f6184ef9c4edcfc53bf226c2aecad896fc53a874edeaad80abb23d5cbdd6f4`. All41 lower-LOD alternatives of the covered base sections are retained. Independent source parts and their hashes remain under `exports/materials/native-tangent-catwalk232` and `native-tangent-catwalk236`; publication rebases offsets without changing original part bytes.

Fifty-five focused tangent/LOD/material tests pass. `web/test/source-tangent-catwalk2.test.js` covers original routing, all source vectors/GLTF correspondence, every WARP output, public payload composition, every native LOD and material/probe hook, and the real28-byte fallback. The runtime integration step covers subsequent actual-map GPU validation.

Reproduce from the repository root:

```powershell
python tools/materials/native-tangent-catwalk2-select.py
powershell -NoProfile -ExecutionPolicy Bypass -File tools/materials/native-tangent-catwalk2.ps1
python tools/materials/native-tangent-catwalk2-prepare.py
powershell -NoProfile -ExecutionPolicy Bypass -File tools/materials/native-tangent-catwalk2-warp.ps1
python tools/materials/native-tangent-merge.py --publish
node --test web/test/source-tangent-catwalk2.test.js web/test/catwalk2-material.test.js
```

Extraction/preparation is bounded to the selected source sections. These tools do not run hardware GPU, edit collision or activate unrelated source families.
