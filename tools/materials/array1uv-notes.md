# Original one-UV texture-array props

`LOCAL-ARRAY1UV-SHADER-001` recovers `Shaders/Presets/SS_PropsMetallicPreset_1UV_TextureArray_01`, hash666991456, shaderGUIDc7d30ee4-2ac7-7b8b-6e71-5fc74bb1fc38. Its selected deferred PS isdfa7a16109 and paired VS58a22ef3c1. The full native permutation/function/default selection chain and byte offsets are retained in material-analysis.json. This covers13 material sections and314 section placements; the retained frozen frustum includes all13,225 section instances and359,885 original LOD0 triangles. These counts are not occlusion-tested pixels.

The family shares the exactly identified `Objects/Props/_CommonTextures/A_Generic_01` ten-layer array recovered for Array2UV. It has26 distinct original CS/NAM textures. Texture conversion source slots[0,20,9] become[41,42,43], applied to t2/t3/t4 as[42,43,41]: NAM,array,CS. Pixel CB1 is table39 and vertex table38. Inputs13 and1 supply detail tiling and normal-detail weight. Ten vectors are exact section overrides; sixteen are exact defaults. All texture and constant selections are verified against the original RVM and source split material records.

This family uses one UV pair for every sample. Native VS moves v5.x/y to the two UV output components. Its packed equations differ from Array2UV:

```text
NAM = t2(UV0)
detail = t3(UV0 * cb0.xy, NAM.b * 10)
CS = t4(UV0)
color = 2 * CS.rgb * detail.b
smoothness = 2 * CS.a * detail.b
xy = 2*NAM.rg - 1
z = sqrt(max(1-dot(xy,xy),0))
normal = normalize(xy + (2*detail.rg-1)*cb1.x, z)
metalness = NAM.a
```

The detail weight affects only normals. It is unsaturated, including source weights2 and3 on the wall light and gas flask. No clamped-weight color/smoothness interpolation from the two-UV variant is applied here. The transformed world normal is normalized before native SH/prelighting. Ordinary materialID0 and reflectance0.5 are explicit; `BF2-NATIVE-GBUFFER-001` supplies the independently proven diffuse and F0 consumer equations. There is no separate AO or emission.

The native sampler references are also retained: PSs0 maps input17/default sampler5993a514cd; PSs1 maps input23/default sampler0a829c84fa. Their packed filter/address bytes are[0x55,1,1,1] and[0x55,1,3,1]. NAM uses s1; the array and CS use s0. These match D3D anisotropic filter and wrap/clamp address enums. The browser applies wrapU/clampV to NAM and repeat to other textures. The packed-to-D3D descriptor conversion and original anisotropy amount remain unobserved; the adapter retains the common browser linear mip filter rather than inventing a recovered amount.

The publisher reuses the unchanged Array2UV ten-layer nativeMip1 array. The26 new PNGs total11,674,970bytes and select existing native mips at most1024 without resizing or channel changes. Every compressed selected slice is retained and checked byte-for-byte against its source DDS. Normal/tangent parity, source sampler implementation, resource-view overrides, regenerated browser lower mips and remaining native rendering differences stay explicit limitations.

Integration uses `prepareRecoveredArray1UvMaterials(document, manager)` from web/src/array1uv-material.js with /assets/recovered-array1uv-materials.json. Apply through the existing per-material base-GLB pass. No additional geometry or native LOD hook is required because UV0 already exists at every level. Include `recoveredArray1UvShader` in the proven ordinary native DFG/reflection scope; it uses the common normalized SH convention.

`python tools/materials/array1uv-test.py` passes3,900 independent original-DXBC arithmetic fixtures over all thirteen selections and ten array layers, with maximum error3.33e-16. In web, `node --test test/array1uv-material.test.js` passes five checks covering native hashes/routing, selected mip bytes and reused array, packed sampler records, all thirteen actual GLTF material associations, and instanced source-probe composition. GPU compilation and live controls are left to the root integration; this worker launched no browser.

Native-frame update: `native-tangent-arrays.md` records the exact rigid32 subset now active:7 section/LOD records,78 base instances. Other layouts remain derivative; material equations and sampler bindings are unchanged.
