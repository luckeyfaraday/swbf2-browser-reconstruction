# Original PropsPreset tangent frames

The published addition contains19 exact base section records,376 placed section instances and31,051 source vertices. Eighteen sections use the original32-byte signed frame; the alarm uses the36-byte signed frame with UV0 and UV1. Their raw position, normal, UV0 and index bytes match their current GLBs exactly. No current native lower LOD alternative belongs to these19 sections. Eight other base sections/98 instances and their two selected lower LODs retain derivative TBN.

Evidence is retained separately under `exports/materials/native-tangent-propspreset32` and `native-tangent-propspreset36`, IDs `BF2-NATIVE-TANGENT-PROPSPRESET32-001` and `BF2-NATIVE-TANGENT-PROPSPRESET36-001`. The selector follows each exact section's selected RVM permutation into its shader instance, paired vertex shader and input layout; it does not choose a vertex program from the shader-family name alone. Every retained edge is checked against its original RVM pointer bytes.

| Source layout | Ordinary VS / PS | Atlas VS / PS | Coverage |
| --- | --- | --- | --- |
|32-byte signed, input `ad2dd1141c` | `dfb8f760fb` / `c13680b516` or `93681d7ffd` | `13f25cb3dd` / `b5b53e93ab` or `2561af268e` |18 sections,328 instances |
|36-byte signed, input `07a62c2c96` | `9d03671509` / `3352783e34` | `18d0bd9bee` / `d390b460db` |1 section,48 instances |

The exact vertex equations are `N=normalize(M*Nsource)`, `T=normalize(M*(-Tsource))`, and `B=normalize(M*(-cross(Nsource,Tsource)*sourceSign))`, using the original forward instance transform. The pixel shader multiplies its raw tangent normal by the interpolated frame and then normalizes the result. It does not independently normalize the interpolated frame columns. Original mesh normals remain unchanged; the sidecar adds the source tangent XYZ and separate handedness only.

Four unchanged source vertex shaders were executed through D3D11 CPU WARP with a driver-generated stream-output passthrough. The fixture covers1,220 sampled vertices across12 transforms, including reflected/nonuniform transforms and original placement matrices. All263,520 frame scalars agree with the algebraic browser helper within1.514e-7;30,840 retained UV outputs agree exactly, including the alarm UV1 lanes. This is not a captured native game frame, converter execution or live pass dispatch. All source vertices, rather than only the sampled vertices, pass the payload/GLB identity checks.

The material/template integration selects the native frame only on proven geometry. It retains source UV routing, all four material branches, constants, source prelighting emission, texture bindings and derivative fallback. Its program key distinguishes native and derivative frames; existing probe/LOD decorators preserve this identity. No sampler is added. The alarm has12 instanced attribute slots at most: position/normal/UV0, source tangent, source UV1, radiosity UV, atlas transform, probe offset and four instance-matrix slots. Other signed Props sections require at most11. The three native frame varyings are N/T/B.

The deterministic public merge is213 records,4,543 base section instances,350,525 vertices and5,905,344 bytes. Payload SHA-256: `a5c5eb66d5dd401a0b9170cd85c3bbf9db62315abc82cbb5f4e591506f005187`. Expected frameKinds are4,500 signed-cross and43 explicit-binormal instances in either native-LOD mode. Focused tangent/LOD/Props material verification passes52 tests; the parent owns the subsequent actual-map GPU check.

Reproduction, from the project root:

```powershell
python tools/materials/native-tangent-propspreset-select.py
powershell -NoProfile -ExecutionPolicy Bypass -File tools/materials/native-tangent-propspreset.ps1
python tools/materials/native-tangent-propspreset-prepare.py
powershell -NoProfile -ExecutionPolicy Bypass -File tools/materials/native-tangent-propspreset-warp.ps1
python tools/materials/native-tangent-merge.py --publish
```

The per-family builders write only retained candidate evidence. Publication occurs explicitly in the final merge command.
