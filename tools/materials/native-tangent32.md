# Original 32-byte tangent permutation

Evidence `BF2-NATIVE-TANGENT32-001` recovers a separate original Master1UV vertex permutation. This is not a conversion inferred from the earlier 36-byte witness.

RVM input-layout `ad2dd1141c` declares four `TEXCOORD` Half4 values at offsets 0, 8, 16 and 24. The source stream is exactly 32 bytes: Half3 position and a separate Half BinormalSign occupy input0; Half4 normal and tangent occupy input1/input2; Half2 UV0 and Half2 RadiosityTexCoord occupy input3.xy/zw. All attributes are per-vertex in slot0. Normal/tangent W lanes are not used to infer handedness.

The original parameter graphs provide direct paired shader routes:

| Pass | Parameter block → defaults | Vertex shader | Pixel shader |
| --- | --- | --- | --- |
| Ordinary | `5801d6e1eb` → `de7623716b` | `282854795b` | `6d0dd89b35` |
| Static atlas | `fcb3b64cb2` → `f628f00254` | `69a5d07239` | `965fbe264b` |

`exports/materials/native-tangent32/shader-routing.json` retains every graph edge, original serialized pointer, source RVM/input-layout/DXBC hashes and input-field binding. Source-byte pointer checks prove the routes independently of the extracted graph labels. The ordinary VS reads UV0.xy; the atlas VS additionally forwards input3.zw as radiosity coordinates. Both use the same recovered forward-transform frame equations as the 36-byte witness.

All 75 selected sections are rigid and exact-layout compatible: 62 LOD0, seven LOD1 and six LOD2, across 54 assets. Source positions, normals, UV0 and indices match every corresponding browser GLB byte-for-byte. The sidecar retains all 112,518 original tangent/sign vectors in 1,800,288 bytes. These base sections represent 1,270 material-section placements. No texture or GLB is changed.

Unchanged original VS execution on CPU WARP covers 4,575 sampled source vertices distributed across all 75 sections, including both source handedness values wherever present, and 12 transforms. The helper agrees with 1,317,600 frame scalar outputs with maximum absolute error 1.460572626177381e-7. Normal/frame XYZ are bit-identical between ordinary and atlas VS outputs. Another 109,800 captured output checks verify ordinary UV Y versus atlas radiosity Y exactly. WARP samples the vertex population; raw payload and GLB correspondence checks include every vertex. No running original application frame or live native dispatch is claimed.

The deterministic merger combines this proof with the prior 19-section 36-byte coverage. Current public totals are 94 section/LOD records, 75 base sections, 19 lower-LOD sections, 63 mesh assets, 139,139 original vertices and a 2,226,224-byte payload. SHA-256: `5d1da24b689750e19547618181c87967496b197e66836fcf3b6a9d164897815e`. Both LOD modes should retain 2,071 native/proven section instances across 1,739 placements because every currently published lower-LOD alternative of a covered section is included.

Each merged record preserves source layout/stride, coverage evidence ID and original part offset. Runtime provenance retains both source documents and evidence hashes, payload hashes and byte ranges. Source geometric N remains interpolated for grunge; no extra samplers, duplicate normals or changed collision are introduced. Other layouts and material families keep their previous paths.

Reproduce from the repository root:

```powershell
python tools/materials/native-tangent32-select.py
powershell -NoProfile -ExecutionPolicy Bypass -File tools/materials/native-tangent32.ps1
python tools/materials/native-tangent32-prepare.py
powershell -NoProfile -ExecutionPolicy Bypass -File tools/materials/native-tangent32-warp.ps1
python tools/materials/native-tangent-merge.py --publish
node --test web/test/source-tangent-frame.test.js web/test/source-tangent-coverage.test.js web/test/source-tangent32.test.js web/test/source-tangent-integration.test.js web/test/source-lods.test.js
```

Preparation stays under `exports/materials/native-tangent32`; only the explicit merger publication changes public assets. Existing original two-section evidence remains under `exports/materials/native-tangent-witness`, and the 19-section proof remains under `exports/materials/native-tangent-coverage`.
