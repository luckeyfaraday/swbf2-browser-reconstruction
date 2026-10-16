# Original explicit-binormal frames

`BF2-NATIVE-TANGENT44-001` proves three metallic-emissive sections with a directly consumable44-byte rigid layout:

| Source asset | Source vertices | Section instances |
| --- | ---: | ---: |
| `2fa8946c-86fc-5c4c-8056-955e15e3c191`, platform stair384x128 | 1,167 | 12 |
| `912e17b2-1aed-8caa-3a33-e11d4d779123`, meeting room01B | 10,313 | 2 |
| `56b8d481-45ff-98bd-abf0-782686184cfb`, corridor S-bend768 | 18,895 | 1 |

Each is source material0, primitive0, LOD0. No currently published native lower LOD corresponds to these three sections. All30,375 original positions, normals, UV0 values and indices are bit-identical to their current GLBs. Source hashes, chunk identities, declaration offsets, GLB hashes and complete material routing are retained under `exports/materials/native-tangent44`.

The source declaration is Float3 position at0; Half4 Binormal at12; Half4 Normal at20; Half4 Tangent at28; Half2 UV0 at36; Half2 RadiosityTexCoord at40. Original RVM input layout `21d0b76a8c` declares Float3 at0 followed by Half4 inputs at12/20/28/36, slot0, per-vertex. These directly match the retained source bytes. Ordinary parameter `ffaedac3ce` pairs VS `d4f2fe6832` with metallic PS `5ffbbd02c2`; atlas parameter `a812ad74e3` pairs VS `5a2ec69557` with PS `d1092739db`. Every pointer edge is checked against raw RVM bytes and each unchanged DXBC is checked against its containing block.

Both vertex shaders implement:

```
N = normalize(M * sourceNormal)
T = normalize(M * -sourceTangent)
B = normalize(M * sourceBinormal)
```

`M` is the original forward instance matrix. The pixel shaders consume interpolated frame columns and normalize only the final mapped normal. Geometric N remains interpolated for grunge. Unlike the signed32/36-byte layouts, B is an independently stored source vector. Even the best choice between positive and negative normalized cross product differs from source B by up to `0.0004595793046247021`;9,565 source vertices differ by over1e-6. Neither a constant tangent-W sign nor a reconstructed cross is an exact substitute.

Unchanged ordinary/atlas vertex shaders executed on CPU D3D11 WARP for195 sampled original vertices spanning all three sections and the largest B/cross discrepancy in each, under twelve source/synthetic transforms. The runtime CPU counterpart agrees on56,160 frame scalars with maximum error `1.3503875029297063e-7`;4,680 UV/radiosity output comparisons are exact. This proves the sampled shader equations, with complete raw source/GLB correspondence for all vertices. It does not capture native pass dispatch or a running original game frame. The source-only helper remains independently retained in `native-tangent44-equations.mjs`; production equations are in `source-tangent-frame.js` and tested against the unchanged WARP output.

The candidate payload holds729,000 bytes: original T XYZ and original B XYZ expanded exactly from Half to Float32. It remains independently retained as `native-tangent-explicit.json/.bin`. Explicit merged publication rebases both ranges, retains both original offsets, hashes each source part and writes the common runtime document. The112-record checkpoint contains200,457 source vertices and2,392 section instances, with3,450,312 bytes and SHA-256 `0470d8a8d6e499cddfe6e33db5763382f0e6643b58f225746b1e3b1c550f59c5`. Per-record `frameKind` separates `signed-cross` from `explicit-binormal`; the document preserves both equations. Existing32/36-byte sidecar bytes are unchanged.

Runtime support is restricted to the three proven metallic sections. The loader validates independent T/B ranges, alignment, finite/nondegenerate vectors and original GLTF fingerprints before attaching `bf2SourceTangent` and `bf2SourceBinormal`. Source normals remain the original GLB attribute. Source-probe materials cache signed, explicit and derivative variants separately, including original diagnostic mode. Unsupported48-byte and color/sign layouts retain their prior derivative frames. Metallic emission still enters atlas/SH before native DFG/albedo/metalness response; separate Three emission is zero. No original material constants, textures, geometry topology, placement matrices or collision data change.

The actual atlas, original placement batching and probe decorators were exercised on CPU for all15 section instances. These GLBs have exactly position/normal/UV0, so the full instanced layout consumes12 attribute locations:

| Input | Locations |
| --- | ---: |
| Original position, normal, UV0 | 3 |
| Source tangent, independent binormal | 2 |
| Original radiosity UV, atlas transform | 2 |
| Probe row offset | 1 |
| Instance matrix | 4 |
| **Total** | **12** |

The helper reuses existing geometric N and T/B varyings; it adds no sampler or varying. Optional instance color would take a thirteenth location, but these actual batches have no instance color. No broader attribute-layout claim is made. Runtime diagnostics report `sourceTangents.frameKinds` with2,377 signed and15 explicit section instances in either native-LOD mode. The CPU budget fixture observes three instanced draws and checks every attribute name, real shader hooks, atlas binding, source emission placement and cache key.

Thirty-six focused tangent/LOD/emissive tests pass. New regressions reject malformed/overlapping B ranges, zero B vectors and unknown frame kinds; they also exercise real source geometries sharing one material through signed/explicit/derivative transitions in smooth/original/bypass/flat modes. The transition fixture does not publish invented LODs. The112-record full-map GPU validation passed at18:19:38UTC:2,392 instances,472 draws,90 native materials, exact2,377/15 frame-kind counts in bothLOD modes, no mismatches. Root retained the report as `web/test-results/actual-map-original-explicit-binormals.json`. Later coverage may supersede this checkpoint.

Reproduce from the repository root:

```powershell
python tools/materials/native-tangent44-select.py
powershell -NoProfile -ExecutionPolicy Bypass -File tools/materials/native-tangent44.ps1
python tools/materials/native-tangent44-prepare.py
powershell -NoProfile -ExecutionPolicy Bypass -File tools/materials/native-tangent44-warp.ps1
python tools/materials/native-tangent-merge.py --publish
node --test web/test/source-tangent44.test.js web/test/source-tangent-metallic.test.js web/test/source-tangent-integration.test.js
```

Extraction/preparation is bounded to these three sections, writes only its evidence directory and never invokes hardware GPU. Runtime activation happens only through the explicit merger and scoped material support.
