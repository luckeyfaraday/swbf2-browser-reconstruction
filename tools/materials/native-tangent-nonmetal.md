# Exact nonmetal emissive wall tangent frame

`BF2-NATIVE-TANGENT-NONMETAL-001` proves the source frame for the sole nonmetal emissive material: `dsi_wall_02_384_c_mesh`, asset `0d921b30-7219-f923-2c82-67c9ecca0280`, material0. LOD0 contains 968 vertices and its published native LOD1 contains 42. The 202 source placements retain their original geometry, collision and material constants.

The source graph directly pairs ordinary PS `17069bc692` with VS `282854795b`, and atlas PS `90de297532` with VS `69a5d07239`. Both VS bytecodes are identical to the independently validated 32-byte Master1UV permutation. The common input-layout `ad2dd1141c` declares four Half4 inputs; original normal/tangent/sign/UV0/radiosity fields match every source offset. Every original position, normal, UV0 and index equals its current GLB bytes. The candidate contains 16,160 tangent/sign bytes for all 1,010 vertices.

Both pixel shaders consume interpolated frame rows directly and normalize only the final mapped normal. Ordinary PS lines133–138 use v3/v4/v5; atlas PS lines138–143 use v4/v5/v6. Neither normalizes each interpolated column. Grunge consumes the interpolated geometric normal without fragment renormalization. Complete parameter paths, pointer checks, shader hashes and the existing static-atlas binding evidence hash are in `exports/materials/native-tangent-nonmetal/shader-routing.json`.

Unchanged CPU WARP execution covers 107 sampled original vertices spanning both LODs and handedness states, across 12 transforms. All 30,816 frame scalar comparisons pass with maximum absolute error 1.1002444844088188e-7. Raw source and GLB correspondence checks cover all 1,010 vertices. This does not claim a running original game frame or captured native dispatch.

The material/template now select the common source helper only when the exact sidecar is attached. The helper reuses the geometric N varying, transforms the original frame with the forward model/instance matrix, and converts the final mapped normal into the renderer's view basis. Existing derivative fallback remains a distinct cache permutation. Source emission still enters atlas/SH prelighting before native DFG/albedo; separate Three emission remains zero. All thirteen material constants, source textures and exposure behavior are preserved.

The merged runtime now has 96 prepared sections (76 base, 20 lower LODs), 140,149 source vertices and 2,273 native section instances in either LOD mode. Payload bytes: 2,242,384; SHA-256 `85f977cd15617cd8882e2929434c0e91b87f2cb24b31d99b7bdc80ca531eb7ac`. Each of three coverage parts retains its own document/evidence/payload hashes and byte range. The prior 94-record actual-map checkpoint passed with 2,071 native instances and no mismatches; the extra two nonmetal sections receive a separate actual-map check.

Tests in `web/test/source-tangent-nonmetal.test.js` verify original RVM pointer routes, shader identity, pixel normalization operations, all tangent/sign bytes, retained WARP outputs, public payload composition, actual GLTFLoader associations, original normal/material identity and base↔native-LOD1 transitions through the real material/probe hooks, including unchanged emission placement.

Reproduce from the repository root:

```powershell
python tools/materials/native-tangent-nonmetal-prepare.py select
powershell -NoProfile -ExecutionPolicy Bypass -File tools/materials/native-tangent-nonmetal.ps1
python tools/materials/native-tangent-nonmetal-prepare.py prepare
powershell -NoProfile -ExecutionPolicy Bypass -File tools/materials/native-tangent32-warp.ps1 -EvidenceDirectory exports/materials/native-tangent-nonmetal
python tools/materials/native-tangent-merge.py --publish
node --test web/test/source-tangent-nonmetal.test.js web/test/master1uv-emissive-nonmetal-material.test.js
```

Source extraction/preparation stays outside the public tree. Runtime activation is performed only by explicit merged publication and the scoped material hook.
