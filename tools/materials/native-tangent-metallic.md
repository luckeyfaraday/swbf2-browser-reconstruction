# Metallic emissive source tangent frames

`BF2-NATIVE-TANGENT-METALLIC-001` proves thirteen rigid32-byte records across ten assets: ten base sections, two LOD1 sections and one LOD2 section. They cover 104 base section instances. All 29,933 source positions, normals, UV0 values and indices match the corresponding published GLBs byte-for-byte. The 478,928-byte tangent/sign part preserves the original Half4 tangent XYZ and independently stored BinormalSign, expanded exactly to Float32.

The original parameter routes pair ordinary VS `282854795b` with PS `5ffbbd02c2` through parameter block `e331499a2d`, and atlas VS `69a5d07239` with PS `d1092739db` through `76c9dfc8b2`. Input layout `ad2dd1141c` directly declares the four Half4 inputs at offsets0/8/16/24. Both unchanged vertex shaders have already been proven for the Master1UV 32-byte frame. The metallic proof additionally executes 844 sampled vertices from every new section under twelve source/synthetic transforms: 243,072 frame scalar comparisons, maximum error `1.4579382190405e-7`. Full source/GLB correspondence covers every vertex; WARP does not claim a running original frame or captured native dispatch.

The bounded material hook uses the existing forward model/instance frame, preserves geometric-N interpolation for grunge, and normalizes only the final mapped world normal. Native and derivative variants remain separate cache permutations. Source emission still joins atlas/SH before DFG, albedo and nonmetal response; separate Three emission remains zero. All twelve source constants and all sixteen source textures are unchanged. The three 44-byte explicit-binormal, one48-byte explicit-binormal/UV1 and one36-byte color/sign source records remain excluded.

The merged runtime document contains 109 records, 170,082 source vertices and 2,377 base section instances. Its 2,721,312-byte payload SHA-256 is `6f3eb5acf626780896eeb44cbb006d5db5013abcd69e4b5ac54d937a3ef5edab`. Four independent coverage parts retain original document/evidence/payload hashes and byte ranges. All thirty focused tangent, LOD and emissive tests pass. The metallic regression loads the actual source GLBs, switches the doorframe through LOD0/1/2/0, verifies source frame and emission hooks, and gives an actual excluded explicit-binormal geometry a distinct fallback material despite shared source material identity.

Reproduce from the repository root:

```powershell
python tools/materials/native-tangent-metallic-prepare.py select
powershell -NoProfile -ExecutionPolicy Bypass -File tools/materials/native-tangent-nonmetal.ps1 -EvidenceDirectory exports/materials/native-tangent-metallic
python tools/materials/native-tangent-metallic-prepare.py prepare
powershell -NoProfile -ExecutionPolicy Bypass -File tools/materials/native-tangent32-warp.ps1 -EvidenceDirectory exports/materials/native-tangent-metallic
python tools/materials/native-tangent-merge.py --publish
node --test web/test/source-tangent-metallic.test.js web/test/master1uv-emissive-material.test.js
```

Source preparation remains outside the public tree; only the explicit merged publication writes the runtime payload. This document records the 109-record checkpoint; later coverage must preserve these part hashes and proof limits.
