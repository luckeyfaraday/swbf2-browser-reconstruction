# CorvetteDamage original static atlas variant

The retained RVM selects pixel shader `cf1ffd68fd` (SHA256 `3601962b8f738b1888a345755506aeac27fb35857534a1e90166cc51e4554e77`) through function instance `7c883e8ed1`, function `e9728c75e0`, and pairs it with vertex shader `4529e9e8bd`. This is static shipped-source evidence; original-game runtime permutation activation has not been captured.

`exports/materials/corvette-damage-static-atlas/integration-recipe.json` is the integration contract. The family is `corvette-damage`; its shader name retains the source spelling `SS_CovetteCR90_Interior_01_Damage_01`.

## Binding and input boundaries

The original atlas textures occupy `t2..t6`, backed by native selectors 18..22: irradiance, R/G/B directions, sky visibility. Material textures relocate from ordinary `t2..t6` to `t7..t11` in the same order: dirt, normal/metal, color, detail array, wreck. Atlas sampler `s0` resolves to `9216198462`; material `s1` resolves to the ordinary sampler `5993a514cd`. All sampler bytes are retained and compared.

WriteOp `c156098acf` fills eight pixel constant vectors from input slot 10. Table assembly `c3635b4e36` sends output slot 58 to pixel `cb1` and slot 57 to vertex `cb0`. The selected vector payload `a9d75501f0` is byte-identical to the ordinary route. All eight X defaults equal zero. The shader still uses the flat unsigned submaterial index to select `cb1[index].x`; it does not use the index directly as an array layer. The typed texture array is the original two-layer `A_CorevetteCR90_01`, independently hashed against its retained TextureArrayAsset EBX and BC7_UNORM DDS. Existing browser mip1 is 512×512×2.

The paired VS routes material base/tiled UVs to PS `v7.xy/zw`, original damage color to `v1.x`, and flat submaterial index to `v8.x`. Source radiosity UV is separate: VS `v7.xy` becomes PS `v3.w/v4.w`; instance scale is PS `v2.x/w` and offset is `v5.w/v6.w`. The atlas UV is therefore `(v2.x*v3.w+v5.w, v2.w*v4.w+v6.w)`. The VS also has a structured-buffer visibility condition with a zero-output branch; no runtime branch state is inferred.

## Arithmetic and composition

The ordinary and atlas material producers have identical symbolic outputs for smoothness, final world normal, damage weight, metalness, albedo and exposed prelighting. The proof retains independent symbols for both material UVs, all TBN rows, all eight layer-table entries and the integer selector. It preserves the unsaturated damage expression `Color0.r*(1+wreck.a)`.

Both source variants normalize the final world normal before lighting. The atlas normal is `r2.xyz`; pass final browser `inverseTransformDirection(geometryNormal, viewMatrix)` to the shared atlas helper. Use raw `bf2_corvette_damage_surface.smoothness`: the kernel performs the source saturation internally. No material AO or emission term exists. Metalness is normal/metal texture blue, material ID is zero, and reflectance is 0.5.

The atlas directional/broad-specular kernel has exactly the same symbolic expressions and original float32 literal bits as floor PS `f789fdaafa`; no algebraic rewrite or restricted smoothness-domain equivalence is needed. It applies `LightMapPreExposure` internally. The tail writes `o3.rgb = atlasRGB * cb2[40].x`; there is no material multiply or extra max-zero. Sky comes independently from atlas `t6.r` to `o2.w`. The ordinary SH route has its own final max-zero and remains separate.

## Validation and supported scope

- `python tools/materials/corvette-damage-static-atlas-analyze.py`: exact RVM bindings, constants, sampler identities, paired VS and source array hashes.
- `python tools/materials/corvette-damage-static-atlas-parity.py`: six equal material outputs plus exact common kernel; 550 symbolic nodes.
- `python tools/materials/test-corvette-damage-static-atlas.py`: seven tests, including mutations that replace dynamic layer selection, clamp damage, collapse UVs, remove normalization, omit saturation or drop source preexposure. A complete kernel execution also verifies the material lanes survive unchanged before the original composition tail.
- Existing ordinary material validation: 3,600 arithmetic cases, including 1,043 damage weights above one; maximum error `7.602e-15`. All six existing Node material/real-GLB tests pass.

No shared runtime files or browser GPU checks were changed or run. Only primitives with matching original radiosity attributes and nonzero matched atlas transforms are eligible. Six recovered material sections do not imply six atlas-capable sections; unmatched geometry and other material permutations retain their existing paths. Native runtime layer overrides, indices outside 0..7, native packed tangent equivalence, sampler GPU precision, lower-mip regeneration and GBuffer quantization remain outside this proof.
