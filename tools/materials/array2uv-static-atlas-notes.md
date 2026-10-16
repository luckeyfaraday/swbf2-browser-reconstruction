# TextureArray2UV original static-atlas variant

This recovery uses the retained RVM, shader bytecode, exact texture-array identity and original DDS. It performs no new extraction or GPU/browser execution.

The atlas deferred pixel shader is `b398fb7ed2`, SHA256 `f98220d078930fb93d0064fd60110dba4d32d7c5f9707d5ff01c36f1dd4bc399`, for `Shaders/Presets/SS_PropsMetallicPreset_2UV_TextureArray_01`. Six retained function instances select this shader. Their complete selection paths, paired VS identities and authored-output UV routing are in `exports/materials/array2uv-static-atlas/binding-evidence.json`.

All six routes bind `t2..t6` to native selectors18–22: irradiance, direction R/G/B and sky visibility. The ordinary three material texture keys retain their +5 register shift: NAM `t2→t7`, detail array `t3→t8`, color/smoothness `t4→t9`. Both detail-scale and detail-weight constant keys retain their original `cb1` offsets. Material sampler `s1` resolves independently to the same `5993a514cd` bytes as ordinary `s0`; atlas `s0` remains `9216198462`.

The detail resource is declared and sampled as `texture2darray`, not a tiled 2D atlas. Its exact source `TextureArrayAsset` root `d72f699d-b7ad-f0da-de8e-7f2741b3ef4c` identifies file `15a8c654-a0e2-11e6-9bec-d439480edcea`, resource `4455661931807515919`. The retained original DDS has ten1024×1024 BC7_UNORM layers and eleven mip levels; its full hash and original EBX hash are verified. Existing browser publication retains the original layer order at an explicitly bounded native mip; this recovery does not republish it.

Atlas PS `v6.xy` is the normal/detail UV pair, while `v6.zw` is the surface pair. The exact array coordinate is:

```
vec3(v6.xy * cb1[0].xy, NAM(v6.zw).b * 10)
```

There is no explicit shader rounding or layer clamp; the raw floating coordinate goes to the native array sample operation. The browser retains a real texture array. Native API tie rounding and live texture-view construction are not executed or claimed by this static proof. NAM's normal is sampled separately at `saturate(v6.xy)`; NAM surface alpha supplies metalness. Color/smoothness use `v6.zw`. Detail weight is saturated only for color/smoothness and remains raw for normal perturbation, including source weights3 and5.

The symbolic interpreter now represents typed array samples with all three coordinates. Arbitrary independent UV pairs, constants and TBN rows produce identical material albedo, raw smoothness, normalized tangent normal, normalized final world normal and metalness in ordinary `52d055444c` and atlas `b398fb7ed2`. A changed layer multiplier demonstrably fails parity; a checker discarding Z could not detect it. No algebraic canonicalization is required. The atlas lighting kernel is identical to validated floor `f789fdaafa` with exact source float32 literals; the complete comparison interns448 nodes.

Final normalized world normal is `r3.xzw`. Raw smoothness is `r2.w`, written unchanged to `o0.z`, then saturated inside the kernel with `mov_sat r4.w, r2.w`. Register `r1.w` is the bounded material detail weight, not smoothness. Material ID is0, reflectance0.5 and metalness is `r3.y = NAM(surfaceUV).a`. There is no material AO multiply or emissive addition. Complete atlas RGB goes directly through frame exposure to `o3.rgb`; source color/detail/metalness registers survive the lighting kernel. Sky visibility `t6.r` goes directly to `o2.w`. No final nonnegative RGB clamp is added.

All six paired vertex variants forward their material float4 to PS `v6.xyzw` and a distinct input pair to `v2.w/v3.w` for radiosity. Two conditional variants also have a separate zero-output branch; recorded routing describes their authored-output branch. The common atlas lookup is `(v1.x*v2.w+v4.w, v1.w*v3.w+v5.w)`. Original UV0/UV1-to-converted-input association remains the existing explicit inference; no new native vertex-conversion claim is introduced.

Runtime recipe: `exports/materials/array2uv-static-atlas/integration-recipe.json`. Use final world `inverseTransformDirection(geometryNormal, viewMatrix)` and raw `bf2_array2uv_surface.smoothness`. AO is `applications:0`, `value:1`, `existingHook:null`; emissive is zero. Preserve original compressed atlas dimensions and affine UV transforms.

Six focused tests cover typed array/material parity, layer/UV/detail-weight mutations, common-kernel smoothness saturation, full composition, all six RVM routes and original ten-layer payload, plus every VS UV layout. Existing material tests separately cover4200 numeric fixtures and the public UV1/texture payloads. Reproduce with:

```
python tools/materials/array2uv-static-atlas-analyze.py
python tools/materials/array2uv-static-atlas-parity.py
python tools/materials/test-array2uv-static-atlas.py
```

Limits remain native runtime pass selection, sampler execution/tie behavior, texture-view overrides, framebuffer quantization and browser derivative tangent parity. The original compressed atlas sampling and LightMapPreExposure come from the separate floor/original-atlas recovery.
