# Original Death Star MetalOnly material

`LOCAL-METALONLY-SHADER-001` recovers `Objects/Architecture/_GalacticEmpire/_Shaders/SS_DSI_Master_1UV_MetalOnly_01` from retained source RVM bytes. Lowercase DJB2Xor hash: `1443790615`; shader GUID: `5e3bc049-229a-d7e5-2fbe-a7e9f06a4145`; selected deferred PS: `85476b5805`; paired VS: `282854795b`.

This was the largest remaining unconverted family by placed section count: 17 sections across 950 placed section instances. General Master1UV, already recovered, covers 1,629; the next families are PropsPreset (817) and Master2UV (680). Full family counts are retained in `exports/materials/metalonly-shader/material-analysis.json`. The frozen native-LOD profile sees all 17 mesh assets containing these sections, totaling 363,473 visible triangles across those full assets. That number includes their other material sections; it is not an isolated MetalOnly triangle count.

Selection is verified through the exact RVM permutation/function/default-value chain, with block offsets and shader hashes. The paired vertex shader is a default value in the same function instance. Seven conversion/apply slot bindings identify `t2 globalWear`, `t3 wear`, `t4 normalAO`, `t5 grunge`, `t6 metalCS`, `t7 metalNormal`, and `t8 aluminium`. Constant-table writes select five vectors: deposited color, UV scale, restore divisor, scratch color and metal color. Exact section parameter roots supply 31 overrides; the other 54 vectors come from shader defaults. Override values are decoded directly from retained raw float32 bytes, avoiding decimal JSON rounding.

The source tiles its metal/aluminium inputs by the section scale (4, 6 or 10 here), metal normal by twice that scale, and global wear by three times that scale. Wear and base normal/AO use original UV0. Grunge samples source world-position ZY and XY, with interpolation controlled by source geometric-normal X/Y. The source normal is normalized at vertices and remains unnormalized after interpolation for this calculation. No browser coordinate rebasing or axis swapping is introduced.

The packed math is in `metalonly-equations.glsl`. Color combines exact stored linear colors, source wear channels, and exact source float literals. Smoothness includes packed metal G, wear, aluminium A and world grunge. Base normal XY is added to the blended detail normal; normal-X from the metal input uses R*A packing. Unlike the general Master1UV shader, this family saturates `wear.r+wear.g` when blending detail normals. Base alpha is AO; base blue is unused and there is no emissive term.

The native deferred `o2.y` scalar is metalness for this family. Its producer writes ordinary materialID0 in `o0.w` and reflectance0.5 in `o2.z`. Independently recovered `BF2-NATIVE-GBUFFER-001` evidence identifies two native `gbLayout=0` consumers (`point-specular`, SHA256 `de3d9773244e2457c97c34647b9b611ac3a21e834a85745818c992a810430041`, and `combine-ibl`, SHA256 `f6d46545dbcf8a4f76dd1e264b5accaba29715d737d8314b431f220793cf2569`). Their exact bindings and instructions establish `diffuse=(1-metalness)*baseColor` and `F0=mix(0.16*reflectance^2,baseColor,metalness)` for ID0. Therefore this family's dielectric F0 is0.04, matching Three's material parameter conversion. The browser supplies clamped per-pixel source metalness through the shader hook. This supersedes the earlier unresolved-scalar/neutral-metalness staging, without claiming full native BRDF or reflection equivalence.

Companion forward PS `a5440e5203` clamps the final source smoothness, complements it, and squares that complement before a native DFG lookup. Source hashes and the exact instruction sequence are retained. The adapter uses `1-clamp(smoothness,0,1)` as roughness; that does not establish equivalence between native and Three lighting.

`metalonly-test.py` compares compact equations with an independent disassembly arithmetic interpreter over 3,400 fixtures, all 17 source constant sets, UV-dependent channel-distinct samples, source world positions and non-unit interpolated normals. The maximum error is `8.88e-16`; 1,720 fixtures exercise the saturated detail-normal blend. These are static arithmetic comparisons, not native execution or float32/FMA bit identity.

All ten unique textures already exist in the verified Master1UV package. `metalonly-prepare.py` verifies their original DDS hashes, selected native mip payloads and PNG hashes before reusing the existing URLs. No new texture files or texture bytes are introduced. Browser regeneration of lower PNG mip levels and native resource-view/sampler choices remain explicit limits.

Integration: load `/assets/recovered-metalonly-materials.json`, import `prepareRecoveredMetalOnlyMaterials` from `web/src/metalonly-material.js`, prepare it with the shared loading manager, and call `apply(gltf,asset)` before static batching and source-probe decoration. `applied` and `provenance` follow the existing material adapter API. Source LOD material reuse remains compatible because the original material objects and identities are preserved by the LOD controller.

Five Node tests verify exact source hashes/routing/float32 overrides, all ten reused texture payloads, the numerical validation record, actual GLTFLoader parsing of all 17 source material associations, and instanced world-coordinate/probe shader-hook composition. In the GLTFLoader test only unrelated image decoding is stubbed; geometry, material extras and object associations are parsed by the actual loader. Packed source tangents remain undecoded, so the derivative tangent frame remains an approximation. Source AO multiplies native prelighting while the browser applies it to indirect diffuse; exact indirect specular behavior is unresolved.

Reproduce:

```powershell
python tools/materials/metalonly-analyze.py
python tools/materials/metalonly-test.py
python tools/materials/metalonly-prepare.py
cd web
node --test test/metalonly-material.test.js
```

The runtime integration step covers shared integration and actual GPU validation. No GPU run was started for this step.
