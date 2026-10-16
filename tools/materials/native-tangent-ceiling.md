# Ceiling original frame proof

The ceiling family uses authored tangent-space normal textures, so its exact vertex frame is relevant to493 placed sections. The recovered floor producer `13ddb144d2` has no interpolated TBN inputs; this work leaves its fixed source-axis normal and prelighting equations unchanged.

Two bounded evidence packages prove all currently selected ceiling sections and their one native lower-LOD alternative:

| Evidence | Records | Source vertices | Base section instances | Sampled source vertices | Sidecar bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| `BF2-NATIVE-TANGENT-CEILING32-001` | 20 | 4,164 | 492 | 1,010 | 66,624 |
| `BF2-NATIVE-TANGENT-CEILING44-001` | 1 | 1,928 | 1 | 65 | 46,272 |

The signed32 package contains19 base sections and LOD1 material1 of corridor asset `f4a36fa0-3590-b7e2-8118-a5a379c869af`. The explicit44 package is material3 of S-bend asset `56b8d481-45ff-98bd-abf0-782686184cfb`. All original positions, normals, UV0 values and indices match the actual GLB bytes. Source declaration offsets match the retained RVM input layouts exactly, with no native conversion inference.

| Layout / pass | Original VS | Original PS | Parameter block | Input layout |
| --- | --- | --- | --- | --- |
| Signed32 ordinary | `dfb8f760fb` | `1fb4d25b38` | `a260ed0c1c` | `ad2dd1141c` |
| Signed32 atlas | `13f25cb3dd` | `96644c0f9e` | `fddea75a7f` | `ad2dd1141c` |
| Explicit44 ordinary | `5a7e127e3a` | `1fb4d25b38` | `de0e183ea1` | `21d0b76a8c` |
| Explicit44 atlas | `6d142296f0` | `96644c0f9e` | `8dff6d98a5` | `21d0b76a8c` |

Each parameter pairing is unique in the retained ceiling graph. Raw RVM pointer values, input-layout bytes and embedded original DXBC bytes are checked. Signed32 uses original Half tangent XYZ and separate BinormalSign to form `B=normalize(M*(-cross(N,T)*sign))`; explicit44 uses the independently stored `B=normalize(M*B)`. Both use `T=normalize(M*(-T))` and `N=normalize(M*N)` with the forward instance matrix.

These are distinct ceiling vertex shaders, not copies of the Master output register layout. The ordinary VS emits its frame rows in o2/o3/o4; the atlas VS emits them in o3/o4/o5. Neither emits a separate geometric-N vector. The ordinary PS consumes v2/v3/v4 and the atlas PS consumes v3/v4/v5; both normalize only the final mapped world normal. The ceiling WARP reproducer therefore captures three vec4 rows,48 bytes per vertex. It does not reuse the Master's separate-N-plus-frame capture layout.

All four unchanged original VS executions were captured using CPU D3D11 WARP for1,075 original vertices across twelve source/synthetic transforms. The runtime frame algebra agrees on232,200 frame scalar comparisons, maximum absolute error `1.2507358282398684e-7`. Full source/GLB correspondence checks cover every one of6,092 vertices. This does not capture live native dispatch or an original game frame.

`web/test/source-tangent-ceiling.test.js` checks RVM bindings, raw source field offsets, source vectors, exact GLTF associations and all four WARP outputs. Its three source-proof tests pass, plus a fourth runtime regression loading every actual ceiling section/LOD and preserving all five constants, source emission, the three interpolated columns and derivative fallback. Independent source candidates remain under `exports/materials/native-tangent-ceiling32` and `native-tangent-ceiling44`; explicit merged publication and the scoped material hook now activate only these records.

The scoped runtime integration adds21 records and493 instances to the138-record checkpoint, producing159 records and3,786 instances:3,743 signed-cross and43 explicit-binormal. Its3,952,016-byte payload SHA-256 is `b47fe000346e8f5a7d6b93ac5f483f2b24282b8951010171c651c336c15d0600`. All228,442 source vertices and35 current lower-LOD alternatives are retained. Forty-six focused tangent/LOD/material tests pass. None overlaps an existing source record. Ceiling lacked a geometric-N varying. Its native variant now provides the complete T/B/N interpolated columns; derivative fallback retains its previous inputs and allocates no frame varyings. The material's five constants, source textures, metalness, emission addition before native prelighting response, static atlas, sky state and diffuse response remain unchanged.

Reproduce from the repository root:

```powershell
python tools/materials/native-tangent-ceiling-select.py
powershell -NoProfile -ExecutionPolicy Bypass -File tools/materials/native-tangent-ceiling.ps1
python tools/materials/native-tangent-ceiling-prepare.py
powershell -NoProfile -ExecutionPolicy Bypass -File tools/materials/native-tangent-ceiling-warp.ps1
python tools/materials/native-tangent-merge.py --publish
node --test web/test/source-tangent-ceiling.test.js web/test/ceiling-material.test.js
```

All extraction is bounded to the21 selected source sections. Native WARP is CPU-only; hardware GPU and actual-map validation remain separate. No floor, sky or prelighting runtime code changes. The159-record full-map GPU checkpoint passed at18:38:27UTC with3,786 instances,711 draws,125 native materials,138 compile events and zero mismatches in bothLOD modes. Later expansions retain this checkpoint as separate evidence.
