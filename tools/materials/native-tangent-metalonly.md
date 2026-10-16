# MetalOnly original tangent frames

The MetalOnly family has950 base section instances. Exact source routing now proves901 of them across26 records:15 base sections and all11 currently published lower-LOD alternatives. The remaining two48-byte sections, accounting for49 instances, remain on the derivative frame. No48-byte declaration is inferred from the44-byte proof.

| Independent proof | Records | Base section instances | Source vertices | Original sampled vertices |
| --- | ---: | ---: | ---: | ---: |
| `BF2-NATIVE-TANGENT-METALONLY32-001` | 20 | 642 | 15,350 | 1,295 |
| `BF2-NATIVE-TANGENT-METALONLY36-001` | 4 | 232 | 1,728 | 260 |
| `BF2-NATIVE-TANGENT-METALONLY44-001` | 2 | 27 | 4,815 | 130 |

The original RVM parameter blocks pair each source layout with ordinary PS `85476b5805` and atlas PS `2db6de846b`:

| Layout | Ordinary VS / parameter | Atlas VS / parameter | Input-layout block |
| --- | --- | --- | --- |
| Signed32 | `282854795b` / `41e6803068` | `69a5d07239` / `a765161f8c` | `ad2dd1141c` |
| Signed36 | `3eba974d4e` / `16d44ad04d` | `007bb70865` / `9f3d8e62d5` | `07a62c2c96` |
| Explicit44 | `d4f2fe6832` / `f2481069b5` | `5a2ec69557` / `22b0aec778` | `21d0b76a8c` |

Each parameter pairing is unique in the retained graph. Pointer values and targets are checked against original RVM bytes; every original DXBC is checked against its containing resource block. Source element usage, format, stream, declared offset and traversed offset must match the prepared declaration exactly. All21,893 original positions, normals, UV0 values and indices equal the corresponding browser GLB bytes. Source tangent/sign or independent-binormal values are expanded from Half to Float32 exactly. Original lower-LOD material parameter equality and shared parameter roots are retained for each alternative.

Signed32/36 use `N=normalize(M*N)`, `T=normalize(M*(-T))`, `B=normalize(M*(-cross(N,T)*BinormalSign))`. Explicit44 preserves the independent source Binormal and uses `B=normalize(M*B)`. Both original pixel shaders multiply the interpolated frame and normalize only the final mapped normal: ordinary lines112–117 consume v3/v4/v5; atlas lines117–122 consume v4/v5/v6. Geometric N remains interpolated without fragment renormalization for world grunge.

All six unchanged original VS permutations executed on CPU D3D11 WARP, using1,685 distributed original vertices across twelve source/synthetic transforms. The runtime frame helper matches485,280 scalar comparisons with maximum error `1.406775097523294e-7`. Raw correspondence covers every recovered vertex. The proof does not capture live native dispatch, native converter execution or a running original frame.

The three independent payloads total388,808 bytes. Explicit merged publication retains their document/evidence/payload hashes and rebases original T/B offsets. The138-record runtime checkpoint contains222,350 source vertices and3,293 section instances:3,251 signed-cross and42 explicit-binormal. Its3,839,120-byte payload SHA-256 is `f28193983e564cffddfa965b9db5d7f85770d02bd1d3c333b7895077ea69a675`. All34 current lower-LOD alternatives of the complete covered set remain supported. Earlier source payload prefixes remain unchanged.

The MetalOnly adapter and its generator template use the existing exact frame helper, with dynamic material context and distinct program keys for signed/explicit/derivative variants. Original five material constants, ten texture resources, ordinary material scalar and single AO multiplication are unchanged. Neither shader introduces emission. Native geometric N remains interpolated. The existing source-probe frame-kind cache handles lower-LOD and diagnostic switches without another shared renderer change. Both unsupported48-byte sections keep the derivative hook.

`web/test/source-tangent-metalonly.test.js` verifies raw RVM routes and input layouts, all raw T/B/sign values, actual GLTF associations and source attributes, all six retained WARP executions, public payload composition, every current lower-LOD transition through actual material/probe hooks, constant counts, one AO application, grunge interpolation and the two unsupported fallbacks. Forty-five focused tangent/LOD/material tests pass. The root-owned full-map GPU check is separate from these CPU proofs.

Reproduce from the repository root:

```powershell
python tools/materials/native-tangent-metalonly-select.py
powershell -NoProfile -ExecutionPolicy Bypass -File tools/materials/native-tangent-metalonly.ps1
python tools/materials/native-tangent-metalonly-prepare.py
powershell -NoProfile -ExecutionPolicy Bypass -File tools/materials/native-tangent-metalonly-warp.ps1
python tools/materials/native-tangent-merge.py --publish
node --test web/test/source-tangent-metalonly.test.js web/test/metalonly-material.test.js
```

The selector, extractors and preparation scripts write only their bounded source evidence directories. Runtime publication is explicit. The first selection attempt used a rejected declaration as its36-byte comparison pattern and selected zero rows; the selector now requires a rigid, accepted witness. The retained final evidence contains the corrected four36-byte records and all three bounded extraction passes complete normally.
