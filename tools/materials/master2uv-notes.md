# Master2UV source recovery

Evidence: `LOCAL-MASTER2UV-SHADER-001`, retained local artifacts only. No native execution or GPU claim is made by this recovery.

The selected `Objects/Architecture/_GalacticEmpire/_Shaders/SS_DSI_Master_2UV` shader (`779b5cbe-1506-41b0-857d-1fe6587182e3`, name hash 2187313360) covers eight material sections and 680 placed sections. The retained camera-frustum audit counts 253,764 visible LOD0 triangles. Its RVM surface identity is separately `3eb625cd-c165-9adb-d4af-d3f3fc3143f3`.

`master2uv-analyze.py` validates the RVM permutation/function/default-value chain to deferred PS `2304f89b0d`, its paired VS `894409a19e`, the executable input read-view key table, texture conversion/register writes, constant writes, exact per-section override bytes, and the source sampler record. It does not substitute the differently ordered filter/hash key table. All source offsets, identities, hashes and chains are retained in `exports/materials/master2uv-shader/material-analysis.json`.

The eleven sampled roles are base normal, global wear, local wear, surface ID, normal/AO, grunge, anodized, rubber, metal color/smoothness, metal normal and aluminium. Fifteen distinct source textures supply the eight recipes. Twelve published payloads are reused; only three elevator maps were added (1,300,573 PNG bytes). Existing native DDS mips at or below 1024 are retained before decoding; browser lower PNG mipmaps regenerate. Source SRGB/UNORM format distinctions are preserved. Sampler s0 retains repeat addressing; packed filter 0x55 corresponds to D3D anisotropic, while browser filtering currently uses linear mipmaps. Native resource-view overrides and filter conversion remain unresolved.

The source PS samples its base normal from the first converted UV pair and all remaining surface/detail maps from the second pair. Its tangent XY sums base normal, normal/AO XY and selected detail normal; tangent Z comes only from the base normal. Tangent and final world normals are each explicitly normalized. Grunge instead consumes the vertex-normalized, interpolated geometric normal without fragment renormalization. Normal/AO alpha supplies ambient occlusion; blue is unused and this permutation has no emission.

The original UV1 is recovered for all 14 selected mesh/LOD primitives, preserving original half-to-float values without a V flip. `master2uv-uv1.bin` contains 65,600 bytes. The publisher checks exact UV0 and index correspondence against retained GLBs. The adapter also checks vertex/index counts and fingerprints before attaching a separate `bf2Master2Uv1` attribute; it preserves the existing geometry and unrelated primitives. The native converter that associates original Half2 TexCoord0/1 with converted float4 v3.xy/zw is not decoded: that association remains an explicit reconstruction inference. Native packed tangent parity is also unresolved; the browser uses a derivative UV0 frame.

Native GBuffer consumer evidence establishes ordinary material ID0, metalness and reflectance0.5. The adapter maps smoothness to `1-clamp(smoothness,0,1)` roughness, clamps metalness and applies source AO to indirect diffuse. Its marker exposes `nativeLightingInputs`; parent integration supplies native SH, DFG and reflection consumers. Native framebuffer quantization and live pass selection remain outside this material-algebra result.

Integration: load `/assets/recovered-master2uv-materials.json`, call `prepareRecoveredMaster2UvMaterials(document, manager)`, apply materials before probe decoration, and call `applyGeometry(gltf, asset, sourceLod)` on each LOD. The adapter marks only exact asset/material routes as `recoveredMaster2UvShader`. Generated cache version v2 preserves interpolated geometric normals for grunge.

Validation:

```text
python tools/materials/master2uv-analyze.py
python tools/materials/master2uv-test.py
python tools/materials/master2uv-prepare.py
node --test web/test/master2uv-material.test.js
```

The independent text-DXBC arithmetic comparison passes 2,400 cases, including UV-dependent samples, independent UV0/UV1, all eight exact constant sets and nonunit interpolated geometric normals; maximum absolute error is 7.77e-16. This compares algebra under double arithmetic, not native IEEE32/FMA or GPU filtering. Six Node tests pass source routing/hashes/override bytes, compressed texture mip retention, all actual GLB UV1 correspondences, rejection of topology changes, exact material routing, instancing and probe-hook composition. No shared runtime files were edited by this recovery.
